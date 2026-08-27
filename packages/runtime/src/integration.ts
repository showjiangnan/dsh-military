import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  MilitaryError,
  type IntegrationOrder,
  type IntegrationReceipt,
  type MilitaryArtifacts,
  type MilitaryIntegration,
} from '@dsh-military/contracts'
import { cloneFrozen, now, uuid, type Clock } from '@dsh-military/core'
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

  constructor(input: { readonly resolver: WorkspaceResolver; readonly workspaces: LocalWorkspaceRuntime; readonly artifacts: MilitaryArtifacts; readonly checks: IntegrationCheckRunner; readonly clock?: Clock }) {
    this.#resolver = input.resolver; this.#workspaces = input.workspaces; this.#artifacts = input.artifacts; this.#checks = input.checks; this.#clock = input.clock ?? (() => new Date())
  }

  async queue(order: IntegrationOrder): Promise<void> {
    const existing = this.#records.get(order.integrationOrderId)
    if (existing !== undefined) {
      if (JSON.stringify(existing.order) !== JSON.stringify(order)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
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
    const patchBytes = await this.#artifacts.get(patch.patchArtifact.artifactId)
    const integrationDir = join(root, '.dsh-military', 'integration', integrationOrderId)
    await mkdir(join(root, '.dsh-military', 'integration'), { recursive: true })
    await rm(integrationDir, { recursive: true, force: true })
    const add = await runProcess('git', ['worktree', 'add', '--detach', integrationDir, beforeHead], { cwd: root, signal })
    if (add.exitCode !== 0) throw new MilitaryError('PERSISTENCE_FAILED', add.stderr)
    try {
      const patchFile = join(integrationDir, '.dsh-military-candidate.patch')
      await writeFile(patchFile, patchBytes)
      const applied = await runProcess('git', ['apply', '--index', '--3way', patchFile], { cwd: integrationDir, signal })
      if (applied.exitCode !== 0) {
        const conflict = await this.#artifacts.put({ bytes: new TextEncoder().encode(applied.stderr), mediaType: 'text/plain', classification: 'internal', description: 'Integration conflict report' })
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'CONFLICT', beforeHead, checkReceiptRefs: [], conflictReportRef: String(conflict.artifactId), startedAt, completedAt: now(this.#clock) })
      }
      await rm(patchFile, { force: true })
      const checks = await this.#checks.run({ cwd: integrationDir, verifierProfileRefs: record.order.verifierProfileRefs, signal })
      const checkRefs: string[] = []
      for (const check of checks) {
        const artifact = await this.#artifacts.put({ bytes: new TextEncoder().encode(check.output), mediaType: 'text/plain', classification: 'internal', description: `Integration check ${check.id}` })
        checkRefs.push(String(artifact.artifactId))
      }
      if (checks.some(check => !check.passed)) {
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'REGRESSION_FAILED', beforeHead, checkReceiptRefs: checkRefs, startedAt, completedAt: now(this.#clock) })
      }
      const commit = await requireProcess('git', ['commit', '-m', `dsh-military: integrate task ${record.order.taskId}`], {
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
        const conflict = await this.#artifacts.put({ bytes: new TextEncoder().encode(cherryPick.stderr), mediaType: 'text/plain', classification: 'internal', description: 'Main integration conflict' })
        return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
          disposition: 'CONFLICT', beforeHead, checkReceiptRefs: checkRefs, conflictReportRef: String(conflict.artifactId), startedAt, completedAt: now(this.#clock) })
      }
      const afterHead = await gitValue(root, ['rev-parse', 'HEAD'], signal, '')
      const treeHash = await gitValue(root, ['rev-parse', 'HEAD^{tree}'], signal, '')
      return this.#commit(record, { schemaVersion: '1.0.0', integrationReceiptId: uuid('integration-receipt'), integrationOrderId,
        disposition: 'APPLIED', beforeHead, afterHead, commit: afterHead, treeHash, checkReceiptRefs: checkRefs, startedAt, completedAt: now(this.#clock) })
    } finally {
      await runProcess('git', ['worktree', 'remove', '--force', integrationDir], { cwd: root, signal: new AbortController().signal })
    }
  }

  async get(integrationOrderId: string): Promise<IntegrationReceipt | null> {
    const value = this.#records.get(integrationOrderId)?.receipt
    return value === undefined || value === null ? null : cloneFrozen(value)
  }

  #commit(record: RecordValue, receipt: IntegrationReceipt): IntegrationReceipt { record.receipt = cloneFrozen(receipt); return cloneFrozen(receipt) }
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
