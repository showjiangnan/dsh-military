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
  readonly checkReceiptRefs: readonly string[]
  readonly receipt?: IntegrationReceipt
}

export interface IntegrationStateStore {
  queue(order: IntegrationOrder): Promise<void>
  read(integrationOrderId: string): Promise<IntegrationExecutionRecord | null>
  acquire(integrationOrderId: string, startedAt: IntegrationReceipt['startedAt']): Promise<IntegrationExecutionRecord>
  checkpoint(
    integrationOrderId: string,
    input: { readonly beforeHead?: string; readonly checkReceiptRefs?: readonly string[] },
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
    input: { readonly beforeHead?: string; readonly checkReceiptRefs?: readonly string[] },
  ): Promise<void> {
    const record = this.#require(integrationOrderId)
    if (record.state !== 'RUNNING') throw new MilitaryError('REVISION_CONFLICT')
    this.#records.set(integrationOrderId, cloneFrozen({
      ...record,
      ...(input.beforeHead === undefined ? {} : { beforeHead: input.beforeHead }),
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

  constructor(input: {
    readonly repositoryRoot: string
    readonly workspaces: GitWorktreeManager
    readonly artifacts: MilitaryArtifacts
    readonly regressionChecks?: readonly (readonly string[])[]
    readonly state?: IntegrationStateStore
    readonly clock?: Clock
  }) {
    this.#workspaces = input.workspaces
    this.#artifacts = input.artifacts
    this.#checks = (input.regressionChecks ?? []).map(args => [...args])
    this.#state = input.state ?? new InMemoryIntegrationStateStore()
    this.#clock = input.clock ?? (() => new Date())
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
    await this.#state.checkpoint(integrationOrderId, { beforeHead })
    if (beforeHead !== order.expectedHead || beforeTree !== order.expectedTreeHash) {
      return await this.#finish(this.#receipt(order, 'STALE', beforeHead, startedAt))
    }
    const bytes = await this.#artifacts.get(patch.patchArtifact.artifactId)
    const apply = await runProcess('git', ['apply', '--index', '--3way', '--whitespace=error-all', '-'], {
      cwd: git.root(), signal, input: new TextDecoder().decode(bytes),
    })
    if (apply.exitCode !== 0) {
      await this.#restore(git, beforeHead, signal)
      const conflictArtifact = await this.#artifacts.put({
        bytes: new TextEncoder().encode(apply.stderr), mediaType: 'text/plain', classification: 'internal',
        description: `integration conflict ${integrationOrderId}`,
      })
      return await this.#finish(this.#receipt(order, 'CONFLICT', beforeHead, startedAt, {
        conflictReportRef: String(conflictArtifact.artifactId),
      }))
    }

    const checkReceiptRefs: string[] = []
    for (const command of this.#checks) {
      const [program, ...args] = command
      if (program === undefined) continue
      const result = await runProcess(program, args, { cwd: git.root(), signal })
      const artifact = await this.#artifacts.put({
        bytes: new TextEncoder().encode(JSON.stringify({ command, ...result })),
        mediaType: 'application/json', classification: 'internal', description: `integration check ${command.join(' ')}`,
      })
      checkReceiptRefs.push(String(artifact.artifactId))
      await this.#state.checkpoint(integrationOrderId, { checkReceiptRefs })
      if (result.exitCode !== 0) {
        await this.#restore(git, beforeHead, signal)
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
      cwd: git.root(), signal,
      env: {
        GIT_AUTHOR_NAME: 'dsh-military integration', GIT_AUTHOR_EMAIL: 'dsh-military@localhost',
        GIT_COMMITTER_NAME: 'dsh-military integration', GIT_COMMITTER_EMAIL: 'dsh-military@localhost',
      },
    })
    if (commitResult.exitCode !== 0) {
      await this.#restore(git, beforeHead, signal)
      throw new MilitaryError('GIT_COMMIT_FAILED', commitResult.stderr)
    }
    const afterHead = await git.head(signal)
    const treeHash = await git.treeHash(signal)
    return await this.#finish(this.#receipt(order, 'APPLIED', beforeHead, startedAt, {
      afterHead, commit: afterHead, treeHash, checkReceiptRefs,
    }))
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
      await this.#finish(this.#receipt(record.order, 'APPLIED', beforeHead, startedAt, {
        afterHead: discovered.commit,
        commit: discovered.commit,
        treeHash: discovered.treeHash,
        checkReceiptRefs: record.checkReceiptRefs,
      }))
      return
    }

    const currentHead = await git.head(signal)
    const status = await runProcess('git', ['status', '--porcelain=v1'], {
      cwd: git.root(),
      signal,
    })
    if (status.exitCode !== 0) throw new MilitaryError('PERSISTENCE_FAILED', status.stderr)
    if (discovered === null && currentHead === record.order.expectedHead && status.stdout.trim() === '') {
      // Acquisition was durable, but no Git mutation became observable.
      await this.#state.requeue(record.order.integrationOrderId)
      return
    }

    const recoveryArtifact = await this.#artifacts.put({
      bytes: new TextEncoder().encode(JSON.stringify({
        integrationOrderId: record.order.integrationOrderId,
        expectedHead: record.order.expectedHead,
        observedHead: currentHead,
        status: status.stdout,
        discoveredCommit: discovered,
      }, null, 2)),
      mediaType: 'application/json',
      classification: 'internal',
      description: `integration recovery ${record.order.integrationOrderId}`,
    })
    const disposition: IntegrationReceipt['disposition'] =
      currentHead === record.order.expectedHead ? 'CONFLICT' : 'STALE'
    await this.#finish(this.#receipt(record.order, disposition, beforeHead, startedAt, {
      checkReceiptRefs: record.checkReceiptRefs,
      conflictReportRef: String(recoveryArtifact.artifactId),
    }))
  }

  async #findIntegrationCommit(
    order: IntegrationOrder,
    git: LocalMainGit,
    signal: AbortSignal,
  ): Promise<{ readonly commit: string; readonly treeHash: string; readonly valid: boolean } | null> {
    const trailer = `DSH-Military-Integration-Order: ${order.integrationOrderId}`
    const search = await runProcess('git', [
      'log',
      '--all',
      '--fixed-strings',
      `--grep=${trailer}`,
      '--format=%H',
      '-n', '1',
    ], { cwd: git.root(), signal })
    const commit = search.exitCode === 0 ? search.stdout.trim().split('\n')[0] : undefined
    if (commit === undefined || commit === '') return null
    const details = await runProcess('git', ['show', '-s', '--format=%P%x00%T%x00%B', commit], {
      cwd: git.root(),
      signal,
    })
    if (details.exitCode !== 0) return { commit, treeHash: '', valid: false }
    const [parents = '', treeHash = '', ...messageParts] = details.stdout.split('\u0000')
    const message = messageParts.join('\u0000')
    const parent = parents.trim().split(/\s+/u).filter(Boolean)[0]
    const parentValid = order.expectedHead === 'UNBORN'
      ? parent === undefined
      : parent === order.expectedHead
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

  async #restore(git: LocalMainGit, beforeHead: string, signal: AbortSignal): Promise<void> {
    if (beforeHead === 'UNBORN') return
    // SAFETY: execute() proved the controlled local-main worktree was clean
    // before staging the candidate. This exact-head reset is the transaction
    // rollback and cannot discard user changes introduced before admission.
    await requireProcess('git', ['reset', '--hard', beforeHead], { cwd: git.root(), signal }, 'GIT_COMMIT_FAILED')
  }
}
