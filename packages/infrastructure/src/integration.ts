import { createHash } from 'node:crypto'
import { access, mkdir, realpath, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  MilitaryError,
  type IntegrationOrder,
  type IntegrationReceipt,
  type MilitaryArtifacts,
  type MilitaryIntegration,
} from '@dsh-military/contracts'
import { cloneFrozen, now, stableJson, uuid, type Clock } from '@dsh-military/core'
import type { GitWorktreeManager } from './workspaces.js'
import { LocalMainGit } from './git.js'
import { requireProcess, runProcess } from './process.js'

export interface IntegrationExecutionRecord {
  readonly order: IntegrationOrder
  readonly state: 'QUEUED' | 'RUNNING' | 'DONE'
  readonly startedAt?: IntegrationReceipt['startedAt']
  readonly beforeHead?: string
  readonly stagingPath?: string
  readonly candidateCommit?: string
  readonly candidateTreeHash?: string
  readonly checkReceiptRefs: readonly string[]
  readonly receipt?: IntegrationReceipt
}

export interface IntegrationStateStore {
  queue(order: IntegrationOrder): Promise<void>
  read(integrationOrderId: string): Promise<IntegrationExecutionRecord | null>
  acquire(integrationOrderId: string, startedAt: IntegrationReceipt['startedAt']): Promise<IntegrationExecutionRecord>
  checkpoint(
    integrationOrderId: string,
    input: {
      readonly beforeHead?: string
      readonly stagingPath?: string
      readonly candidateCommit?: string
      readonly candidateTreeHash?: string
      readonly checkReceiptRefs?: readonly string[]
    },
  ): Promise<void>
  complete(integrationOrderId: string, receipt: IntegrationReceipt): Promise<void>
  requeue(integrationOrderId: string): Promise<void>
  running(): Promise<readonly IntegrationExecutionRecord[]>
}

export class InMemoryIntegrationStateStore implements IntegrationStateStore {
  readonly #records = new Map<string, IntegrationExecutionRecord>()

  async queue(order: IntegrationOrder): Promise<void> {
    const existing = this.#records.get(order.integrationOrderId)
    if (existing !== undefined) {
      if (integrationOrderFingerprint(existing.order) !== integrationOrderFingerprint(order)) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      }
      return
    }
    this.#records.set(order.integrationOrderId, {
      order: cloneFrozen(order),
      state: 'QUEUED',
      checkReceiptRefs: [],
    })
  }

  async read(integrationOrderId: string): Promise<IntegrationExecutionRecord | null> {
    const value = this.#records.get(integrationOrderId)
    return value === undefined ? null : cloneFrozen(value)
  }

  async acquire(
    integrationOrderId: string,
    startedAt: IntegrationReceipt['startedAt'],
  ): Promise<IntegrationExecutionRecord> {
    const record = this.#require(integrationOrderId)
    if (record.state === 'RUNNING') throw new MilitaryError('RESOURCE_LOCKED')
    if (record.state === 'DONE') return cloneFrozen(record)
    const running = cloneFrozen({ ...record, state: 'RUNNING' as const, startedAt })
    this.#records.set(integrationOrderId, running)
    return running
  }

  async checkpoint(
    integrationOrderId: string,
    input: {
      readonly beforeHead?: string
      readonly stagingPath?: string
      readonly candidateCommit?: string
      readonly candidateTreeHash?: string
      readonly checkReceiptRefs?: readonly string[]
    },
  ): Promise<void> {
    const record = this.#require(integrationOrderId)
    if (record.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
    this.#records.set(integrationOrderId, cloneFrozen({
      ...record,
      ...(input.beforeHead === undefined ? {} : { beforeHead: input.beforeHead }),
      ...(input.stagingPath === undefined ? {} : { stagingPath: input.stagingPath }),
      ...(input.candidateCommit === undefined
        ? {}
        : { candidateCommit: input.candidateCommit }),
      ...(input.candidateTreeHash === undefined
        ? {}
        : { candidateTreeHash: input.candidateTreeHash }),
      ...(input.checkReceiptRefs === undefined ? {} : { checkReceiptRefs: [...input.checkReceiptRefs] }),
    }))
  }

  async complete(integrationOrderId: string, receipt: IntegrationReceipt): Promise<void> {
    const record = this.#require(integrationOrderId)
    if (record.state === 'DONE') {
      if (stableJson(record.receipt) !== stableJson(receipt)) throw new MilitaryError('REVISION_CONFLICT')
      return
    }
    if (record.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
    this.#records.set(integrationOrderId, cloneFrozen({
      ...record,
      state: 'DONE' as const,
      receipt,
    }))
  }

  async requeue(integrationOrderId: string): Promise<void> {
    const record = this.#require(integrationOrderId)
    if (record.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
    this.#records.set(integrationOrderId, cloneFrozen({
      order: record.order,
      state: 'QUEUED' as const,
      checkReceiptRefs: [],
    }))
  }

  async running(): Promise<readonly IntegrationExecutionRecord[]> {
    return cloneFrozen([...this.#records.values()].filter(record => record.state === 'RUNNING'))
  }

  #require(integrationOrderId: string): IntegrationExecutionRecord {
    const record = this.#records.get(integrationOrderId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND')
    return record
  }
}

/** `createdAt` is observation metadata, not part of an integration command's semantic identity. */
export function integrationOrderFingerprint(order: IntegrationOrder): string {
  const { createdAt: _createdAt, ...semantic } = order
  return stableJson(semantic)
}

export class LocalMainIntegration implements MilitaryIntegration {
  readonly #workspaces: GitWorktreeManager
  readonly #artifacts: MilitaryArtifacts
  readonly #checks: readonly string[][]
  readonly #state: IntegrationStateStore
  readonly #clock: Clock
  readonly #tenantId: string
  readonly #integrationRoot: string

  constructor(input: {
    readonly repositoryRoot: string
    readonly workspaces: GitWorktreeManager
    readonly artifacts: MilitaryArtifacts
    readonly regressionChecks?: readonly (readonly string[])[]
    readonly state?: IntegrationStateStore
    readonly clock?: Clock
    readonly tenantId?: string
    readonly integrationRoot?: string
  }) {
    this.#workspaces = input.workspaces
    this.#artifacts = input.artifacts
    this.#checks = (input.regressionChecks ?? []).map(args => [...args])
    this.#state = input.state ?? new InMemoryIntegrationStateStore()
    this.#clock = input.clock ?? (() => new Date())
    this.#tenantId = input.tenantId ?? 'local'
    this.#integrationRoot = resolve(
      input.integrationRoot
        ?? resolve(dirname(input.repositoryRoot), '.dsh-military-integration'),
    )
  }

  async queue(order: IntegrationOrder): Promise<void> {
    if (order.targetBranch !== 'main') throw new MilitaryError('GIT_NON_MAIN_FORBIDDEN')
    await this.#state.queue(order)
  }

  async execute(integrationOrderId: string, signal: AbortSignal): Promise<IntegrationReceipt> {
    let record = await this.#state.read(integrationOrderId)
    if (record === null) throw new MilitaryError('NOT_FOUND')
    if (record.state === 'RUNNING') {
      await this.#reconcileRecord(record, signal)
      record = await this.#state.read(integrationOrderId)
      if (record === null) throw new MilitaryError('PERSISTENCE_FAILED')
    }
    if (record.state === 'DONE') {
      if (record.receipt === undefined) throw new MilitaryError('PERSISTENCE_FAILED')
      return cloneFrozen(record.receipt)
    }
    const startedAt = now(this.#clock)
    record = await this.#state.acquire(integrationOrderId, startedAt)
    if (record.state === 'DONE') {
      if (record.receipt === undefined) throw new MilitaryError('PERSISTENCE_FAILED')
      return cloneFrozen(record.receipt)
    }
    const order = record.order
    const { patch, git } = await this.#executionTarget(order)
    await git.ensureRepository(signal)
    await git.requireMaterialClean(signal)
    const beforeHead = await git.head(signal)
    const beforeTree = await git.treeHash(signal)
    if (beforeHead !== order.expectedHead || beforeTree !== order.expectedTreeHash) {
      return await this.#finish(this.#receipt(order, 'STALE', beforeHead, startedAt))
    }
    const stagingPath = this.#stagingPath(order, git.root())
    await this.#state.checkpoint(integrationOrderId, {
      beforeHead,
      stagingPath,
    })
    await this.#prepareStaging(
      git.root(),
      stagingPath,
      beforeHead,
      signal,
    )
    const bytes = await this.#artifacts.get(patch.patchArtifact.artifactId)
    const apply = await runProcess('git', ['apply', '--index', '--3way', '--whitespace=error-all', '-'], {
      cwd: stagingPath, signal, input: new TextDecoder().decode(bytes),
    })
    if (apply.exitCode !== 0) {
      const conflictArtifact = await this.#artifacts.put({
        bytes: new TextEncoder().encode(apply.stderr), mediaType: 'text/plain', classification: 'internal',
        description: `integration conflict ${integrationOrderId}`,
        idempotencyKey: `integration:${integrationOrderId}:apply-conflict`,
        ...this.#artifactContext(order),
      })
      await this.#cleanupStaging(
        git.root(),
        stagingPath,
        beforeHead,
        signal,
      )
      return await this.#finish(this.#receipt(order, 'CONFLICT', beforeHead, startedAt, {
        conflictReportRef: String(conflictArtifact.artifactId),
      }))
    }

    const checkReceiptRefs: string[] = []
    for (const [checkIndex, command] of this.#checks.entries()) {
      const [program, ...args] = command
      if (program === undefined) continue
      const result = await runProcess(program, args, { cwd: stagingPath, signal })
      const checkBytes = new TextEncoder().encode(JSON.stringify({
        command,
        ...result,
      }))
      const artifact = await this.#artifacts.put({
        bytes: checkBytes,
        mediaType: 'application/json', classification: 'internal', description: `integration check ${command.join(' ')}`,
        idempotencyKey: `integration:${integrationOrderId}:check:${checkIndex}:${sha256(checkBytes)}`,
        ...this.#artifactContext(order),
      })
      checkReceiptRefs.push(String(artifact.artifactId))
      await this.#state.checkpoint(integrationOrderId, { checkReceiptRefs })
      if (result.exitCode !== 0) {
        await this.#cleanupStaging(
          git.root(),
          stagingPath,
          beforeHead,
          signal,
        )
        return await this.#finish(this.#receipt(order, 'REGRESSION_FAILED', beforeHead, startedAt, {
          checkReceiptRefs,
        }))
      }
    }

    const commitResult = await runProcess('git', [
      'commit',
      '-m', `military: integrate task ${order.taskId}`,
      '-m', `DSH-Military-Integration-Order: ${order.integrationOrderId}`,
      '-m', `DSH-Military-Candidate-Patch: ${order.candidatePatchId}`,
    ], {
      cwd: stagingPath, signal,
      env: {
        GIT_AUTHOR_NAME: 'dsh-military integration', GIT_AUTHOR_EMAIL: 'dsh-military@localhost',
        GIT_COMMITTER_NAME: 'dsh-military integration', GIT_COMMITTER_EMAIL: 'dsh-military@localhost',
      },
    })
    if (commitResult.exitCode !== 0) {
      throw new MilitaryError('GIT_COMMIT_FAILED', commitResult.stderr)
    }
    const candidateCommit = await gitValue(stagingPath, 'HEAD', signal)
    const candidateTreeHash = await gitValue(
      stagingPath,
      'HEAD^{tree}',
      signal,
    )
    await this.#state.checkpoint(integrationOrderId, {
      candidateCommit,
      candidateTreeHash,
      checkReceiptRefs,
    })
    await git.requireMaterialClean(signal)
    const mergeHead = await git.head(signal)
    const mergeTree = await git.treeHash(signal)
    if (mergeHead !== beforeHead || mergeTree !== beforeTree) {
      await this.#cleanupStaging(
        git.root(),
        stagingPath,
        candidateCommit,
        signal,
      )
      return await this.#finish(this.#receipt(order, 'STALE', beforeHead, startedAt, {
        checkReceiptRefs,
      }))
    }
    const merge = await runProcess(
      'git',
      ['merge', '--ff-only', candidateCommit],
      { cwd: git.root(), signal },
    )
    if (merge.exitCode !== 0) {
      await runProcess(
        'git',
        ['merge', '--abort'],
        { cwd: git.root(), signal: new AbortController().signal },
      )
      const conflictBytes = new TextEncoder().encode(merge.stderr)
      const conflictArtifact = await this.#artifacts.put({
        bytes: conflictBytes,
        mediaType: 'text/plain',
        classification: 'internal',
        description: `integration main fast-forward conflict ${integrationOrderId}`,
        idempotencyKey: `integration:${integrationOrderId}:main-conflict:${sha256(conflictBytes)}`,
        ...this.#artifactContext(order),
      })
      await this.#cleanupStaging(
        git.root(),
        stagingPath,
        candidateCommit,
        signal,
      )
      return await this.#finish(this.#receipt(order, 'CONFLICT', beforeHead, startedAt, {
        checkReceiptRefs,
        conflictReportRef: String(conflictArtifact.artifactId),
      }))
    }
    const afterHead = await git.head(signal)
    const treeHash = await git.treeHash(signal)
    await this.#cleanupStaging(
      git.root(),
      stagingPath,
      candidateCommit,
      signal,
    )
    return await this.#finish(this.#receipt(order, 'APPLIED', beforeHead, startedAt, {
      afterHead, commit: afterHead, treeHash, checkReceiptRefs,
    }))
  }

  #artifactContext(order: IntegrationOrder): {
    readonly tenantId: string
    readonly missionId: string
    readonly taskId: string
    readonly ownerPrincipalId: string
    readonly audiencePrincipalIds: readonly string[]
    readonly audienceScopes: readonly string[]
  } {
    return {
      tenantId: this.#tenantId,
      missionId: order.missionId,
      taskId: order.taskId,
      ownerPrincipalId: order.authorizedBy,
      audiencePrincipalIds: ['military-host', order.authorizedBy],
      audienceScopes: ['artifact:read', 'military:integration'],
    }
  }

  async get(integrationOrderId: string): Promise<IntegrationReceipt | null> {
    const record = await this.#state.read(integrationOrderId)
    return record?.receipt === undefined ? null : cloneFrozen(record.receipt)
  }

  /** Reconcile every execution that lost its process after durable acquisition. */
  async reconcilePending(signal: AbortSignal): Promise<void> {
    for (const record of await this.#state.running()) {
      if (signal.aborted) throw signal.reason
      await this.#reconcileRecord(record, signal)
    }
  }

  async #reconcileRecord(record: IntegrationExecutionRecord, signal: AbortSignal): Promise<void> {
    const { git } = await this.#executionTarget(record.order)
    await git.ensureRepository(signal)
    const discovered = await this.#findIntegrationCommit(record.order, git, signal)
    const startedAt = record.startedAt ?? now(this.#clock)
    const beforeHead = record.beforeHead ?? record.order.expectedHead
    if (discovered !== null && discovered.valid) {
      if (record.stagingPath !== undefined) {
        await this.#cleanupStaging(
          git.root(),
          this.#requireExactStagingPath(
            record.order,
            git.root(),
            record.stagingPath,
          ),
          record.candidateCommit ?? discovered.commit,
          signal,
        )
      }
      await this.#finish(this.#receipt(record.order, 'APPLIED', beforeHead, startedAt, {
        afterHead: discovered.commit,
        commit: discovered.commit,
        treeHash: discovered.treeHash,
        checkReceiptRefs: record.checkReceiptRefs,
      }))
      return
    }

    const currentHead = await git.head(signal)
    const currentTree = await git.treeHash(signal)
    const status = await runProcess('git', ['status', '--porcelain=v1'], {
      cwd: git.root(),
      signal,
    })
    if (status.exitCode !== 0) throw new MilitaryError('PERSISTENCE_FAILED', status.stderr)
    if (
      discovered === null
      && currentHead === record.order.expectedHead
      && currentTree === record.order.expectedTreeHash
      && (await git.materialStatusPaths(signal)).length === 0
    ) {
      const recoveredCandidate = await this.#recoverStagingCandidate(
        record,
        git.root(),
        signal,
      )
      if (recoveredCandidate === null) {
        // Acquisition or an isolated apply was durable, but no validated
        // candidate or local-main mutation became observable.
        await this.#state.requeue(record.order.integrationOrderId)
        return
      }
      await this.#state.checkpoint(record.order.integrationOrderId, {
        candidateCommit: recoveredCandidate.commit,
        candidateTreeHash: recoveredCandidate.treeHash,
      })
      const merge = await runProcess(
        'git',
        ['merge', '--ff-only', recoveredCandidate.commit],
        { cwd: git.root(), signal },
      )
      if (merge.exitCode === 0) {
        if (record.stagingPath !== undefined) {
          await this.#cleanupStaging(
            git.root(),
            this.#requireExactStagingPath(
              record.order,
              git.root(),
              record.stagingPath,
            ),
            recoveredCandidate.commit,
            signal,
          )
        }
        await this.#finish(this.#receipt(record.order, 'APPLIED', beforeHead, startedAt, {
          afterHead: recoveredCandidate.commit,
          commit: recoveredCandidate.commit,
          treeHash: recoveredCandidate.treeHash,
          checkReceiptRefs: record.checkReceiptRefs,
        }))
        return
      }
      await runProcess(
        'git',
        ['merge', '--abort'],
        { cwd: git.root(), signal: new AbortController().signal },
      )
    }

    const recoveryBytes = new TextEncoder().encode(JSON.stringify({
        integrationOrderId: record.order.integrationOrderId,
        expectedHead: record.order.expectedHead,
        observedHead: currentHead,
        expectedTreeHash: record.order.expectedTreeHash,
        observedTreeHash: currentTree,
        status: status.stdout,
        discoveredCommit: discovered,
        stagingPath: record.stagingPath,
        candidateCommit: record.candidateCommit,
      }, null, 2))
    const recoveryArtifact = await this.#artifacts.put({
      bytes: recoveryBytes,
      mediaType: 'application/json',
      classification: 'internal',
      description: `integration recovery ${record.order.integrationOrderId}`,
      idempotencyKey: `integration:${record.order.integrationOrderId}:recovery:${sha256(recoveryBytes)}`,
      ...this.#artifactContext(record.order),
    })
    const disposition: IntegrationReceipt['disposition'] =
      currentHead === record.order.expectedHead ? 'CONFLICT' : 'STALE'
    await this.#finish(this.#receipt(record.order, disposition, beforeHead, startedAt, {
      checkReceiptRefs: record.checkReceiptRefs,
      conflictReportRef: String(recoveryArtifact.artifactId),
    }))
  }

  async #recoverStagingCandidate(
    record: IntegrationExecutionRecord,
    repositoryRoot: string,
    signal: AbortSignal,
  ): Promise<{
    readonly commit: string
    readonly treeHash: string
  } | null> {
    if (record.candidateCommit !== undefined) {
      const candidate = await this.#inspectIntegrationCommit(
        record.order,
        repositoryRoot,
        record.candidateCommit,
        signal,
      )
      if (!candidate.valid) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'persisted integration candidate failed immutable trailer validation',
        )
      }
      return {
        commit: candidate.commit,
        treeHash: candidate.treeHash,
      }
    }
    if (record.stagingPath === undefined) return null
    const stagingPath = this.#requireExactStagingPath(
      record.order,
      repositoryRoot,
      record.stagingPath,
    )
    if (!await pathExists(stagingPath)) {
      await requireProcess(
        'git',
        ['worktree', 'prune'],
        { cwd: repositoryRoot, signal },
        'PERSISTENCE_FAILED',
      )
      return null
    }
    const stagingHead = await registeredWorktreeHead(
      repositoryRoot,
      stagingPath,
      signal,
    )
    if (stagingHead === null) {
      throw new MilitaryError(
        'RESOURCE_LOCKED',
        'integration staging path exists without exact Git registration',
      )
    }
    if (stagingHead === record.order.expectedHead) {
      await this.#cleanupStaging(
        repositoryRoot,
        stagingPath,
        stagingHead,
        signal,
      )
      return null
    }
    const candidate = await this.#inspectIntegrationCommit(
      record.order,
      repositoryRoot,
      stagingHead,
      signal,
    )
    if (!candidate.valid) {
      throw new MilitaryError(
        'PERSISTENCE_FAILED',
        'recovered integration staging commit failed immutable trailer validation',
      )
    }
    return {
      commit: candidate.commit,
      treeHash: candidate.treeHash,
    }
  }

  async #findIntegrationCommit(
    order: IntegrationOrder,
    git: LocalMainGit,
    signal: AbortSignal,
  ): Promise<{ readonly commit: string; readonly treeHash: string; readonly valid: boolean } | null> {
    const trailer = `DSH-Military-Integration-Order: ${order.integrationOrderId}`
    const search = await runProcess('git', [
      'log',
      'HEAD',
      '--fixed-strings',
      `--grep=${trailer}`,
      '--format=%H',
      '-n', '1',
    ], { cwd: git.root(), signal })
    const commit = search.exitCode === 0 ? search.stdout.trim().split('\n')[0] : undefined
    if (commit === undefined || commit === '') return null
    return await this.#inspectIntegrationCommit(
      order,
      git.root(),
      commit,
      signal,
    )
  }

  async #inspectIntegrationCommit(
    order: IntegrationOrder,
    repositoryRoot: string,
    commit: string,
    signal: AbortSignal,
  ): Promise<{ readonly commit: string; readonly treeHash: string; readonly valid: boolean }> {
    const details = await runProcess(
      'git',
      ['show', '-s', '--format=%P%x00%T%x00%B', commit],
      { cwd: repositoryRoot, signal },
    )
    if (details.exitCode !== 0) {
      return { commit, treeHash: '', valid: false }
    }
    const [parents = '', treeHash = '', ...messageParts] = details.stdout.split('\u0000')
    const message = messageParts.join('\u0000')
    const parent = parents.trim().split(/\s+/u).filter(Boolean)[0]
    const parentValid = order.expectedHead === 'UNBORN'
      ? parent === undefined
      : parent === order.expectedHead
    const trailer = `DSH-Military-Integration-Order: ${order.integrationOrderId}`
    const trailersValid = message.split(/\r?\n/u).includes(trailer)
      && message.split(/\r?\n/u).includes(`DSH-Military-Candidate-Patch: ${order.candidatePatchId}`)
    return { commit, treeHash: treeHash.trim(), valid: parentValid && trailersValid }
  }

  async #finish(receipt: IntegrationReceipt): Promise<IntegrationReceipt> {
    await this.#state.complete(receipt.integrationOrderId, receipt)
    return cloneFrozen(receipt)
  }

  #receipt(
    order: IntegrationOrder,
    disposition: IntegrationReceipt['disposition'],
    beforeHead: string,
    startedAt: IntegrationReceipt['startedAt'],
    extras: Partial<Pick<IntegrationReceipt, 'afterHead' | 'commit' | 'treeHash' | 'checkReceiptRefs' | 'conflictReportRef'>> = {},
  ): IntegrationReceipt {
    return cloneFrozen({
      schemaVersion: '1.0.0',
      integrationReceiptId: uuid('integration-receipt'),
      integrationOrderId: order.integrationOrderId,
      disposition,
      beforeHead,
      checkReceiptRefs: extras.checkReceiptRefs ?? [],
      ...(extras.afterHead === undefined ? {} : { afterHead: extras.afterHead }),
      ...(extras.commit === undefined ? {} : { commit: extras.commit }),
      ...(extras.treeHash === undefined ? {} : { treeHash: extras.treeHash }),
      ...(extras.conflictReportRef === undefined ? {} : { conflictReportRef: extras.conflictReportRef }),
      startedAt,
      completedAt: now(this.#clock),
    })
  }

  async #executionTarget(order: IntegrationOrder): Promise<{
    readonly patch: Awaited<ReturnType<GitWorktreeManager['candidatePatch']>>
    readonly git: LocalMainGit
  }> {
    const patch = await this.#workspaces.candidatePatch(order.candidatePatchId)
    if (patch.candidatePatchId !== order.candidatePatchId
      || patch.missionId !== order.missionId
      || patch.taskId !== order.taskId
      || patch.taskVersion !== order.taskVersion) {
      throw new MilitaryError(
        'AGENT_EXECUTION_BINDING_MISMATCH',
        'integration order does not match its immutable Candidate Patch',
      )
    }
    const snapshot = this.#workspaces.snapshotById(patch.baseWorkspaceSnapshotId)
    if (snapshot.git.head !== order.expectedHead || snapshot.git.treeHash !== order.expectedTreeHash) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        'integration order expected Git state differs from the Candidate Patch base snapshot',
      )
    }
    return {
      patch,
      git: new LocalMainGit(this.#workspaces.repositoryPath(
        patch.baseWorkspaceSnapshotId,
      )),
    }
  }

  #stagingPath(order: IntegrationOrder, repositoryRoot: string): string {
    const operationPath = sha256(
      `${resolve(repositoryRoot)}\u0000${order.integrationOrderId}`,
    ).slice(0, 40)
    return resolve(this.#integrationRoot, operationPath)
  }

  #requireExactStagingPath(
    order: IntegrationOrder,
    repositoryRoot: string,
    observedPath: string,
  ): string {
    const expectedPath = this.#stagingPath(order, repositoryRoot)
    if (resolve(observedPath) !== expectedPath) {
      throw new MilitaryError(
        'FORBIDDEN_SCOPE',
        'persisted integration staging path is outside its exact operation path',
      )
    }
    return expectedPath
  }

  async #prepareStaging(
    repositoryRoot: string,
    stagingPath: string,
    expectedHead: string,
    signal: AbortSignal,
  ): Promise<void> {
    await mkdir(this.#integrationRoot, { recursive: true, mode: 0o700 })
    if (await pathExists(stagingPath)) {
      const registeredHead = await registeredWorktreeHead(
        repositoryRoot,
        stagingPath,
        signal,
      )
      throw new MilitaryError(
        'RESOURCE_LOCKED',
        registeredHead === null
          ? 'integration staging path collides with an unknown filesystem object'
          : 'integration staging worktree requires durable reconciliation',
      )
    }
    await requireProcess(
      'git',
      ['worktree', 'prune'],
      { cwd: repositoryRoot, signal },
      'PERSISTENCE_FAILED',
    )
    await requireProcess(
      'git',
      ['worktree', 'add', '--detach', stagingPath, expectedHead],
      { cwd: repositoryRoot, signal },
      'PERSISTENCE_FAILED',
    )
    const registeredHead = await registeredWorktreeHead(
      repositoryRoot,
      stagingPath,
      signal,
    )
    if (registeredHead !== expectedHead) {
      throw new MilitaryError(
        'PERSISTENCE_FAILED',
        'integration staging worktree was not registered at the expected head',
      )
    }
  }

  async #cleanupStaging(
    repositoryRoot: string,
    stagingPath: string,
    expectedHead: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!await pathExists(stagingPath)) {
      await requireProcess(
        'git',
        ['worktree', 'prune'],
        { cwd: repositoryRoot, signal },
        'PERSISTENCE_FAILED',
      )
      return
    }
    const registeredHead = await registeredWorktreeHead(
      repositoryRoot,
      stagingPath,
      signal,
    )
    if (registeredHead !== expectedHead) {
      throw new MilitaryError(
        'RESOURCE_LOCKED',
        'integration cleanup requires exact repository registration and head',
      )
    }
    await requireProcess(
      'git',
      ['worktree', 'remove', '--force', stagingPath],
      { cwd: repositoryRoot, signal },
      'PERSISTENCE_FAILED',
    )
    // Git owns removal; an exact residual is removed only after path,
    // repository registration and head were all proven above.
    if (await pathExists(stagingPath)) {
      await rm(stagingPath, { recursive: true, force: true })
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ENOENT'
      ? false
      : true
  }
}

async function registeredWorktreeHead(
  repositoryRoot: string,
  worktreePath: string,
  signal: AbortSignal,
): Promise<string | null> {
  const expectedPath = await realpath(worktreePath)
  const result = await requireProcess(
    'git',
    ['worktree', 'list', '--porcelain'],
    { cwd: repositoryRoot, signal },
    'PERSISTENCE_FAILED',
  )
  for (const block of result.stdout.split(/\n\n+/u)) {
    let observedPath: string | undefined
    let observedHead: string | undefined
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) observedPath = line.slice(9)
      else if (line.startsWith('HEAD ')) observedHead = line.slice(5)
    }
    if (observedPath === undefined || observedHead === undefined) continue
    try {
      if (await realpath(observedPath) === expectedPath) return observedHead
    } catch {
      // Ignore stale registrations for other missing worktrees. The exact
      // operation path exists because its canonical path was resolved above.
    }
  }
  return null
}

async function gitValue(
  cwd: string,
  revision: string,
  signal: AbortSignal,
): Promise<string> {
  return (await requireProcess(
    'git',
    ['rev-parse', revision],
    { cwd, signal },
    'PERSISTENCE_FAILED',
  )).stdout.trim()
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}
