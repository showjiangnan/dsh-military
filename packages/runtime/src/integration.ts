import { createHash } from 'node:crypto'
import { access, mkdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  MilitaryError,
  type IntegrationOrder,
  type IntegrationReceipt,
  type MilitaryArtifacts,
  type MilitaryIntegration,
} from '@dsh-military/contracts'
import { cloneFrozen, now, stableJson, uuid, type Clock } from '@dsh-military/core'
import { requireProcess, runProcess } from '@dsh-military/infrastructure'
import type { LocalWorkspaceRuntime, WorkspaceResolver } from './workspace.js'

export interface IntegrationCheckRunner {
  run(input: { readonly cwd: string; readonly verifierProfileRefs: readonly string[]; readonly signal: AbortSignal }): Promise<readonly { readonly id: string; readonly passed: boolean; readonly output: string }[]>
}

interface RecordValue { readonly order: IntegrationOrder; receipt: IntegrationReceipt | null }

export class LocalIntegrationRuntime implements MilitaryIntegration {
  readonly #resolver: WorkspaceResolver
  readonly #workspaces: LocalWorkspaceRuntime
  readonly #artifacts: MilitaryArtifacts
  readonly #checks: IntegrationCheckRunner
  readonly #clock: Clock
  readonly #records = new Map<string, RecordValue>()
  readonly #tenantId: string

  constructor(input: { readonly resolver: WorkspaceResolver; readonly workspaces: LocalWorkspaceRuntime; readonly artifacts: MilitaryArtifacts; readonly checks: IntegrationCheckRunner; readonly clock?: Clock; readonly tenantId?: string }) {
    this.#resolver = input.resolver; this.#workspaces = input.workspaces; this.#artifacts = input.artifacts; this.#checks = input.checks; this.#clock = input.clock ?? (() => new Date()); this.#tenantId = input.tenantId ?? 'local'
  }

  async queue(order: IntegrationOrder): Promise<void> {
    if (order.targetBranch !== 'main') {
      throw new MilitaryError('GIT_NON_MAIN_FORBIDDEN')
    }
    const existing = this.#records.get(order.integrationOrderId)
    if (existing !== undefined) {
      if (integrationOrderFingerprint(existing.order)
        !== integrationOrderFingerprint(order)) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      }
      return
    }
    this.#records.set(order.integrationOrderId, { order: cloneFrozen(order), receipt: null })
  }

  async execute(integrationOrderId: string, signal: AbortSignal): Promise<IntegrationReceipt> {
    const record = this.#records.get(integrationOrderId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND')
    if (record.receipt !== null) return cloneFrozen(record.receipt)
    const startedAt = now(this.#clock)
    const root = resolve(await this.#resolver.resolve(record.order.missionId))
    const beforeHead = await gitValue(root, ['rev-parse', 'HEAD'], signal, 'UNBORN')
    const beforeTree = await gitValue(root, ['rev-parse', 'HEAD^{tree}'], signal, 'EMPTY')
    if (beforeHead !== record.order.expectedHead || beforeTree !== record.order.expectedTreeHash) {
      return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
        disposition: 'STALE', beforeHead, checkReceiptRefs: [], startedAt, completedAt: now(this.#clock) })
    }
    const clean = await requireProcess('git', ['status', '--porcelain=v1'], { cwd: root, signal })
    if (clean.stdout.trim().length > 0) throw new MilitaryError('GIT_WORKTREE_DIRTY')
    const patch = await this.#workspaces.candidatePatch(record.order.candidatePatchId)
    if (
      patch.candidatePatchId !== record.order.candidatePatchId
      || patch.missionId !== record.order.missionId
      || patch.taskId !== record.order.taskId
      || patch.taskVersion !== record.order.taskVersion
    ) {
      throw new MilitaryError(
        'AGENT_EXECUTION_BINDING_MISMATCH',
        'integration order does not match its immutable Candidate Patch',
      )
    }
    const patchBytes = await this.#artifacts.get(patch.patchArtifact.artifactId)
    const integrationRoot = join(
      dirname(root),
      '.dsh-military-integration',
    )
    const integrationDir = join(
      integrationRoot,
      digest(`${root}\u0000${integrationOrderId}`).slice(0, 40),
    )
    await mkdir(integrationRoot, { recursive: true, mode: 0o700 })
    if (await pathExists(integrationDir)) {
      throw new MilitaryError(
        'RESOURCE_LOCKED',
        'integration staging path already exists and requires recovery',
      )
    }
    await requireProcess(
      'git',
      ['worktree', 'prune'],
      { cwd: root, signal },
      'PERSISTENCE_FAILED',
    )
    const add = await runProcess('git', ['worktree', 'add', '--detach', integrationDir, beforeHead], { cwd: root, signal })
    if (add.exitCode !== 0) throw new MilitaryError('PERSISTENCE_FAILED', add.stderr)
    try {
      const applied = await runProcess(
        'git',
        ['apply', '--index', '--3way', '--whitespace=error-all', '-'],
        {
          cwd: integrationDir,
          signal,
          input: new TextDecoder().decode(patchBytes),
        },
      )
      if (applied.exitCode !== 0) {
        const conflict = await this.#artifacts.put({ bytes: new TextEncoder().encode(applied.stderr), mediaType: 'text/plain', classification: 'internal', description: 'Integration conflict report', idempotencyKey: `integration:${integrationOrderId}:apply-conflict`, ...this.#artifactContext(record.order) })
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'CONFLICT', beforeHead, checkReceiptRefs: [], conflictReportRef: String(conflict.artifactId), startedAt, completedAt: now(this.#clock) })
      }
      const checks = await this.#checks.run({ cwd: integrationDir, verifierProfileRefs: record.order.verifierProfileRefs, signal })
      const checkRefs: string[] = []
      for (const [checkIndex, check] of checks.entries()) {
        const checkBytes = new TextEncoder().encode(check.output)
        const artifact = await this.#artifacts.put({ bytes: checkBytes, mediaType: 'text/plain', classification: 'internal', description: `Integration check ${check.id}`, idempotencyKey: `integration:${integrationOrderId}:check:${checkIndex}:${digest(checkBytes)}`, ...this.#artifactContext(record.order) })
        checkRefs.push(String(artifact.artifactId))
      }
      if (checks.some(check => !check.passed)) {
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'REGRESSION_FAILED', beforeHead, checkReceiptRefs: checkRefs, startedAt, completedAt: now(this.#clock) })
      }
      const commit = await requireProcess('git', [
        'commit',
        '-m', `dsh-military: integrate task ${record.order.taskId}`,
        '-m', `DSH-Military-Integration-Order: ${record.order.integrationOrderId}`,
        '-m', `DSH-Military-Candidate-Patch: ${record.order.candidatePatchId}`,
      ], {
        cwd: integrationDir, signal,
        env: { GIT_AUTHOR_NAME: 'dsh-military integration', GIT_AUTHOR_EMAIL: 'dsh-military@localhost', GIT_COMMITTER_NAME: 'dsh-military integration', GIT_COMMITTER_EMAIL: 'dsh-military@localhost' },
      }, 'GIT_COMMIT_FAILED')
      void commit
      const candidateCommit = await gitValue(integrationDir, ['rev-parse', 'HEAD'], signal, '')
      const headRecheck = await gitValue(root, ['rev-parse', 'HEAD'], signal, 'UNBORN')
      if (headRecheck !== beforeHead) {
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'STALE', beforeHead, checkReceiptRefs: checkRefs, startedAt, completedAt: now(this.#clock) })
      }
      const cherryPick = await runProcess('git', ['cherry-pick', candidateCommit], { cwd: root, signal })
      if (cherryPick.exitCode !== 0) {
        await runProcess('git', ['cherry-pick', '--abort'], { cwd: root, signal })
        const conflictBytes = new TextEncoder().encode(cherryPick.stderr)
        const conflict = await this.#artifacts.put({ bytes: conflictBytes, mediaType: 'text/plain', classification: 'internal', description: 'Main integration conflict', idempotencyKey: `integration:${integrationOrderId}:main-conflict:${digest(conflictBytes)}`, ...this.#artifactContext(record.order) })
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'CONFLICT', beforeHead, checkReceiptRefs: checkRefs, conflictReportRef: String(conflict.artifactId), startedAt, completedAt: now(this.#clock) })
      }
      const afterHead = await gitValue(root, ['rev-parse', 'HEAD'], signal, '')
      const treeHash = await gitValue(root, ['rev-parse', 'HEAD^{tree}'], signal, '')
      return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
        disposition: 'APPLIED', beforeHead, afterHead, commit: afterHead, treeHash, checkReceiptRefs: checkRefs, startedAt, completedAt: now(this.#clock) })
    } finally {
      if (await registeredWorktree(root, integrationDir)) {
        await runProcess('git', ['worktree', 'remove', '--force', integrationDir], { cwd: root, signal: new AbortController().signal })
      }
    }
  }

  async get(integrationOrderId: string): Promise<IntegrationReceipt | null> {
    const value = this.#records.get(integrationOrderId)?.receipt
    return value === undefined || value === null ? null : cloneFrozen(value)
  }

  #artifactContext(order: IntegrationOrder) {
    return {
      tenantId: this.#tenantId,
      missionId: order.missionId,
      taskId: order.taskId,
      ownerPrincipalId: order.authorizedBy,
      audiencePrincipalIds: ['military-host', order.authorizedBy],
      audienceScopes: ['artifact:read', 'military:integration'],
    } as const
  }

  #commit(record: RecordValue, receipt: IntegrationReceipt): IntegrationReceipt { record.receipt = cloneFrozen(receipt); return cloneFrozen(receipt) }
}

function integrationOrderFingerprint(order: IntegrationOrder): string {
  const { createdAt: _createdAt, ...semantic } = order
  return stableJson(semantic)
}

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
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

async function registeredWorktree(
  repositoryRoot: string,
  worktreePath: string,
): Promise<boolean> {
  if (!await pathExists(worktreePath)) return false
  const expected = await realpath(worktreePath)
  const listing = await runProcess(
    'git',
    ['worktree', 'list', '--porcelain'],
    { cwd: repositoryRoot },
  )
  if (listing.exitCode !== 0) return false
  for (const line of listing.stdout.split('\n')) {
    if (!line.startsWith('worktree ')) continue
    try {
      if (await realpath(line.slice(9)) === expected) return true
    } catch {
      // Ignore stale registrations for unrelated missing worktrees.
    }
  }
  return false
}

async function gitValue(cwd: string, args: readonly string[], signal: AbortSignal, fallback: string): Promise<string> {
  const result = await runProcess('git', args, { cwd, signal })
  return result.exitCode === 0 ? result.stdout.trim() : fallback
}

export class CommandIntegrationChecks implements IntegrationCheckRunner {
  readonly #commands: Readonly<Record<string, readonly string[]>>
  constructor(commands: Readonly<Record<string, readonly string[]>>) { this.#commands = commands }
  async run(input: Parameters<IntegrationCheckRunner['run']>[0]): Promise<readonly { readonly id: string; readonly passed: boolean; readonly output: string }[]> {
    const results = []
    for (const id of input.verifierProfileRefs) {
      const command = this.#commands[id]
      if (command === undefined || command.length === 0) { results.push({ id, passed: false, output: `Unknown verifier profile ${id}` }); continue }
      const [binary, ...args] = command
      if (binary === undefined) continue
      const result = await runProcess(binary, args, { cwd: input.cwd, signal: input.signal })
      results.push({ id, passed: result.exitCode === 0, output: `${result.stdout}\n${result.stderr}`.trim() })
    }
    return results
  }
}
