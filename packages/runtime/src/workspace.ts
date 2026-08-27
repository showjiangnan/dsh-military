import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import {
  MilitaryError,
  brand,
  type CandidatePatch,
  type MilitaryArtifacts,
  type MilitaryWorkspaces,
  type WorkspaceLease,
  type WorkspaceSnapshot,
} from '@dsh-military/contracts'
import { cloneFrozen, now, pathWithinAny, sha256, stableJson, uuid, type Clock } from '@dsh-military/core'
import { requireProcess, runProcess } from '@dsh-military/infrastructure'

export interface WorkspaceResolver { resolve(workspaceKey: string): Promise<string> }

interface AttemptWorkspace {
  readonly candidateId: string
  readonly missionId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly path: string
  readonly baseSnapshot: WorkspaceSnapshot
}

export class LocalWorkspaceRuntime implements MilitaryWorkspaces {
  readonly #resolver: WorkspaceResolver
  readonly #artifacts: MilitaryArtifacts
  readonly #clock: Clock
  readonly #leases = new Map<string, WorkspaceLease>()
  readonly #leasePaths = new Map<string, string>()
  readonly #snapshots = new Map<string, WorkspaceSnapshot>()
  readonly #attempts = new Map<string, AttemptWorkspace>()
  readonly #patches = new Map<string, CandidatePatch>()
  readonly #roots = new Map<string, string>()

  constructor(input: { readonly resolver: WorkspaceResolver; readonly artifacts: MilitaryArtifacts; readonly clock?: Clock }) {
    this.#resolver = input.resolver
    this.#artifacts = input.artifacts
    this.#clock = input.clock ?? (() => new Date())
  }

  async snapshot(input: { readonly tenantId: string; readonly workspaceKey: string; readonly signal: AbortSignal }): Promise<WorkspaceSnapshot> {
    if (input.signal.aborted) throw input.signal.reason
    const root = resolve(await this.#resolver.resolve(input.workspaceKey))
    this.#roots.set(input.workspaceKey, root)
    const git = await readGitState(root, input.signal)
    const files = await fileManifest(root, input.signal)
    const fileManifestRef = await this.#artifacts.put({
      bytes: new TextEncoder().encode(JSON.stringify(files, null, 2)), mediaType: 'application/json', classification: 'internal',
      description: `Workspace manifest for ${input.workspaceKey}`,
    })
    const environment = {
      node: process.version, platform: process.platform, arch: process.arch,
      cwd: root, environmentNames: Object.keys(process.env).filter(name => !/key|secret|token|password/iu.test(name)).sort(),
    }
    const environmentArtifact = await this.#artifacts.put({
      bytes: new TextEncoder().encode(JSON.stringify(environment, null, 2)), mediaType: 'application/json', classification: 'internal',
      description: `Environment snapshot for ${input.workspaceKey}`,
    })
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: '1.0.0', workspaceSnapshotId: uuid('workspace-snapshot'), tenantId: input.tenantId, workspaceKey: input.workspaceKey,
      rootPathHash: brand<string, 'Sha256'>(sha256(root)), git, fileManifest: fileManifestRef, environmentArtifact,
      createdAt: now(this.#clock),
    }
    this.#snapshots.set(snapshot.workspaceSnapshotId, cloneFrozen(snapshot))
    return cloneFrozen(snapshot)
  }

  async lease(input: WorkspaceLease): Promise<void> {
    const existing = this.#leases.get(input.workspaceLeaseId)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(input)) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
      return
    }
    if (input.state !== 'ACTIVE') throw new MilitaryError('INVALID_ARGUMENT', 'new workspace lease must be ACTIVE')
    if (Date.parse(input.expiresAt) <= Date.now()) throw new MilitaryError('RESOURCE_LOCKED')
    for (const lease of this.#leases.values()) {
      if (lease.state !== 'ACTIVE' || lease.tenantId !== input.tenantId || lease.workspaceSnapshotId !== input.workspaceSnapshotId) continue
      if (lease.mode === 'READ' && input.mode === 'READ') continue
      if (scopesOverlap(lease.pathScope.writePaths, input.pathScope.writePaths)) throw new MilitaryError('RESOURCE_LOCKED')
    }
    const snapshot = this.#snapshots.get(input.workspaceSnapshotId)
    if (snapshot === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    if (input.mode === 'WRITE') {
      const root = this.#roots.get(snapshot.workspaceKey) ?? resolve(await this.#resolver.resolve(snapshot.workspaceKey))
      const leaseRoot = join(root, '.dsh-military', 'leased-worktrees')
      await mkdir(leaseRoot, { recursive: true })
      const path = join(leaseRoot, safeSegment(input.workspaceLeaseId))
      await rm(path, { recursive: true, force: true })
      const base = snapshot.git.head === 'UNBORN' ? 'HEAD' : snapshot.git.head
      const result = await runProcess('git', ['worktree', 'add', '--detach', path, base], { cwd: root })
      if (result.exitCode !== 0) throw new MilitaryError('PERSISTENCE_FAILED', result.stderr, { root, path, base })
      this.#leasePaths.set(input.workspaceLeaseId, path)
    }
    this.#leases.set(input.workspaceLeaseId, cloneFrozen(input))
  }

  executionPath(workspaceLeaseId: string): string {
    const lease = this.#leases.get(workspaceLeaseId)
    if (lease === undefined || lease.state !== 'ACTIVE') throw new MilitaryError('RESOURCE_LOCKED', 'workspace lease is not active')
    const isolated = this.#leasePaths.get(workspaceLeaseId)
    if (isolated !== undefined) return isolated
    const snapshot = this.#snapshots.get(lease.workspaceSnapshotId)
    if (snapshot === undefined) throw new MilitaryError('NOT_FOUND')
    const root = this.#roots.get(snapshot.workspaceKey)
    if (root === undefined) throw new MilitaryError('NOT_FOUND')
    return root
  }

  snapshotById(workspaceSnapshotId: string): WorkspaceSnapshot {
    const snapshot = this.#snapshots.get(workspaceSnapshotId)
    if (snapshot === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    return cloneFrozen(snapshot)
  }

  repositoryPath(workspaceSnapshotId: string): string {
    const snapshot = this.#snapshots.get(workspaceSnapshotId)
    if (snapshot === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    const root = this.#roots.get(snapshot.workspaceKey)
    if (root === undefined) throw new MilitaryError('NOT_FOUND', 'workspace repository root not found')
    return root
  }

  async release(workspaceLeaseId: string): Promise<void> {
    const lease = this.#leases.get(workspaceLeaseId)
    if (lease === undefined) throw new MilitaryError('NOT_FOUND')
    if (lease.state !== 'ACTIVE') return
    const path = this.#leasePaths.get(workspaceLeaseId)
    if (path !== undefined) {
      const snapshot = this.#snapshots.get(lease.workspaceSnapshotId)
      const root = snapshot === undefined ? undefined : this.#roots.get(snapshot.workspaceKey)
      if (root !== undefined) await runProcess('git', ['worktree', 'remove', '--force', path], { cwd: root })
      await rm(path, { recursive: true, force: true })
      this.#leasePaths.delete(workspaceLeaseId)
    }
    this.#leases.set(workspaceLeaseId, cloneFrozen({ ...lease, state: 'RELEASED' as const, leaseVersion: lease.leaseVersion + 1 }))
  }

  async createCandidatePatch(input: {
    readonly workspaceLeaseId: string
    readonly candidateId: string
    readonly missionId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly signal: AbortSignal
  }): Promise<CandidatePatch> {
    const lease = this.#leases.get(input.workspaceLeaseId)
    if (lease === undefined || lease.state !== 'ACTIVE' || lease.mode !== 'WRITE') {
      throw new MilitaryError('RESOURCE_LOCKED', 'active write lease required')
    }
    const path = this.#leasePaths.get(input.workspaceLeaseId)
    if (path === undefined) throw new MilitaryError('RESOURCE_LOCKED', 'write lease has no isolated worktree')
    const snapshot = this.#snapshots.get(lease.workspaceSnapshotId)
    if (snapshot === undefined) throw new MilitaryError('NOT_FOUND')
    const status = (await requireProcess('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: path, signal: input.signal })).stdout
    const changed = parsePorcelainPaths(status)
    if (changed.length === 0) throw new MilitaryError('INVALID_ARGUMENT', 'candidate has no workspace changes')
    const forbidden = changed.filter(item => !pathWithinAny(item, lease.pathScope.writePaths)
      || lease.pathScope.forbiddenPaths.some(denied => pathWithinAny(item, [denied])))
    if (forbidden.length > 0) throw new MilitaryError('FORBIDDEN_SCOPE', 'candidate changed forbidden paths', { forbidden })
    const untracked = (await requireProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: path, signal: input.signal })).stdout
      .split('\0').filter(Boolean).map(normalizeGitPath).sort()
    if (untracked.length > 0) await requireProcess('git', ['add', '--intent-to-add', '--', ...untracked], { cwd: path, signal: input.signal })
    const diff = await requireProcess('git', ['diff', '--binary', '--full-index', '--no-ext-diff', snapshot.git.head, '--'], { cwd: path, signal: input.signal })
    const bytes = new TextEncoder().encode(diff.stdout)
    const patchArtifact = await this.#artifacts.put({ bytes, mediaType: 'text/x-diff', classification: 'internal', description: `Candidate patch ${input.candidateId}` })
    const patch: CandidatePatch = {
      schemaVersion: '1.0.0', candidatePatchId: deterministicCandidatePatchId(
        input.candidateId,
        String(snapshot.workspaceSnapshotId),
        sha256(bytes),
      ), candidateId: input.candidateId,
      missionId: input.missionId, taskId: input.taskId, taskVersion: input.taskVersion,
      baseWorkspaceSnapshotId: snapshot.workspaceSnapshotId, patchArtifact, changedPaths: changed,
      applyMode: 'GIT_BINARY_PATCH', preconditions: [`HEAD=${snapshot.git.head}`, `TREE=${snapshot.git.treeHash}`],
      patchHash: brand<string, 'Sha256'>(sha256(bytes)), createdAt: now(this.#clock),
    }
    this.#patches.set(patch.candidatePatchId, cloneFrozen(patch))
    return cloneFrozen(patch)
  }

  async prepareAttempt(input: {
    readonly candidateId: string
    readonly missionId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly baseSnapshot: WorkspaceSnapshot
    readonly signal: AbortSignal
  }): Promise<string> {
    const root = this.#roots.get(input.baseSnapshot.workspaceKey) ?? resolve(await this.#resolver.resolve(input.baseSnapshot.workspaceKey))
    const attemptsRoot = join(root, '.dsh-military', 'worktrees')
    await mkdir(attemptsRoot, { recursive: true })
    const attemptPath = join(attemptsRoot, safeSegment(`${input.missionId}-${input.taskId}-${input.taskVersion}-${input.candidateId}`))
    await rm(attemptPath, { recursive: true, force: true })
    const base = input.baseSnapshot.git.head === 'UNBORN' ? 'HEAD' : input.baseSnapshot.git.head
    const result = await runProcess('git', ['worktree', 'add', '--detach', attemptPath, base], { cwd: root, signal: input.signal })
    if (result.exitCode !== 0) throw new MilitaryError('PERSISTENCE_FAILED', result.stderr, { root, attemptPath, base })
    this.#attempts.set(input.candidateId, cloneFrozen({ candidateId: input.candidateId, missionId: input.missionId, taskId: input.taskId, taskVersion: input.taskVersion, path: attemptPath, baseSnapshot: input.baseSnapshot }))
    return attemptPath
  }

  async captureCandidatePatch(candidateId: string, signal: AbortSignal): Promise<CandidatePatch> {
    const attempt = this.#attempts.get(candidateId)
    if (attempt === undefined) throw new MilitaryError('NOT_FOUND', `no attempt workspace for candidate ${candidateId}`)
    const status = (await requireProcess('git', ['status', '--porcelain=v1', '-z'], { cwd: attempt.path, signal })).stdout
    const changed = parsePorcelainPaths(status)
    if (changed.length === 0) throw new MilitaryError('INVALID_ARGUMENT', 'candidate has no workspace changes')
    const diff = await requireProcess('git', ['diff', '--binary', '--no-ext-diff', '--', ...changed], { cwd: attempt.path, signal })
    const untracked = (await requireProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: attempt.path, signal })).stdout
      .split('\0').filter(Boolean).map(normalizeGitPath).sort()
    if (untracked.length > 0) {
      await requireProcess('git', ['add', '--intent-to-add', '--', ...untracked], { cwd: attempt.path, signal })
    }
    const complete = await requireProcess('git', ['diff', '--binary', '--no-ext-diff', '--', ...changed], { cwd: attempt.path, signal })
    const bytes = new TextEncoder().encode(complete.stdout || diff.stdout)
    const patchArtifact = await this.#artifacts.put({ bytes, mediaType: 'text/x-diff', classification: 'internal', description: `Candidate patch ${candidateId}` })
    const patch: CandidatePatch = {
      schemaVersion: '1.0.0', candidatePatchId: deterministicCandidatePatchId(
        candidateId,
        String(attempt.baseSnapshot.workspaceSnapshotId),
        sha256(bytes),
      ), candidateId,
      missionId: attempt.missionId, taskId: attempt.taskId, taskVersion: attempt.taskVersion,
      baseWorkspaceSnapshotId: attempt.baseSnapshot.workspaceSnapshotId, patchArtifact,
      changedPaths: changed, applyMode: 'GIT_BINARY_PATCH',
      preconditions: [`HEAD=${attempt.baseSnapshot.git.head}`, `TREE=${attempt.baseSnapshot.git.treeHash}`],
      patchHash: brand<string, 'Sha256'>(sha256(bytes)), createdAt: now(this.#clock),
    }
    this.#patches.set(patch.candidatePatchId, cloneFrozen(patch))
    return cloneFrozen(patch)
  }

  async candidatePatch(candidateId: string): Promise<CandidatePatch> {
    const direct = this.#patches.get(candidateId)
    if (direct !== undefined) return cloneFrozen(direct)
    const value = [...this.#patches.values()].find(patch => patch.candidateId === candidateId)
    if (value === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(value)
  }

  async disposeAttempt(candidateId: string, signal?: AbortSignal): Promise<void> {
    const attempt = this.#attempts.get(candidateId)
    if (attempt === undefined) return
    const root = this.#roots.get(attempt.baseSnapshot.workspaceKey) ?? resolve(await this.#resolver.resolve(attempt.baseSnapshot.workspaceKey))
    await runProcess('git', ['worktree', 'remove', '--force', attempt.path], { cwd: root, ...(signal === undefined ? {} : { signal }) })
    this.#attempts.delete(candidateId)
  }
}

function deterministicCandidatePatchId(
  candidateId: string,
  workspaceSnapshotId: string,
  patchHash: string,
): string {
  return `candidate-patch-${sha256(`${candidateId}\u0000${workspaceSnapshotId}\u0000${patchHash}`).slice(0, 40)}`
}

async function readGitState(root: string, signal: AbortSignal): Promise<WorkspaceSnapshot['git']> {
  const repositoryId = createHash('sha256').update(root).digest('hex').slice(0, 24)
  const headResult = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root, signal })
  const branchResult = await runProcess('git', ['branch', '--show-current'], { cwd: root, signal })
  const treeResult = await runProcess('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, signal })
  const dirtyResult = await runProcess('git', ['status', '--porcelain=v1', '-z'], { cwd: root, signal })
  return {
    repositoryId,
    head: headResult.exitCode === 0 ? headResult.stdout.trim() : 'UNBORN',
    branch: branchResult.exitCode === 0 && branchResult.stdout.trim().length > 0 ? branchResult.stdout.trim() : 'DETACHED',
    treeHash: treeResult.exitCode === 0 ? treeResult.stdout.trim() : 'EMPTY',
    dirtyStateHash: brand<string, 'Sha256'>(sha256(dirtyResult.stdout)),
  }
}

async function fileManifest(root: string, signal: AbortSignal): Promise<readonly { path: string; size: number; mtimeMs: number }[]> {
  const output: Array<{ path: string; size: number; mtimeMs: number }> = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (signal.aborted) throw signal.reason
      if (entry.name === '.git' || entry.name === '.dsh-military' || entry.name === 'node_modules') continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) { const value = await stat(absolute); output.push({ path: relative(root, absolute).replaceAll('\\', '/'), size: value.size, mtimeMs: value.mtimeMs }) }
    }
  }
  await walk(root)
  return output.sort((a, b) => a.path.localeCompare(b.path))
}

function safeSegment(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/gu, '-').slice(0, 180) }
function scopesOverlap(left: readonly string[], right: readonly string[]): boolean { return left.some(a => right.some(b => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`))) }
function normalizeGitPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '')
  if (normalized === '' || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new MilitaryError('FORBIDDEN_SCOPE', `unsafe Git path: ${value}`)
  }
  return normalized
}

function parsePorcelainPaths(raw: string): readonly string[] {
  const tokens = raw.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || token.length < 4) continue
    const status = token.slice(0, 2)
    const first = normalizeGitPath(token.slice(3))
    if (status.includes('R') || status.includes('C')) {
      const destination = tokens[index + 1]
      if (destination !== undefined) {
        paths.push(normalizeGitPath(destination))
        index += 1
      } else paths.push(first)
    } else paths.push(first)
  }
  return [...new Set(paths)].sort()
}
