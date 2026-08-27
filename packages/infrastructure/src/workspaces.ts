import { mkdir, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  MilitaryError,
  type CandidatePatch,
  type MilitaryArtifacts,
  type MilitaryWorkspaces,
  type WorkspaceLease,
  type WorkspaceSnapshot,
  brand,
} from '@dsh-military/contracts'
import { cloneFrozen, now, pathWithinAny, sha256, uuid, type Clock } from '@dsh-military/core'
import { LocalMainGit } from './git.js'
import { requireProcess } from './process.js'

interface LiveLease {
  lease: WorkspaceLease
  worktreePath?: string
}

interface SnapshotRecord {
  readonly snapshot: WorkspaceSnapshot
  readonly git: LocalMainGit
}

export class GitWorktreeManager implements MilitaryWorkspaces {
  readonly #fallbackGit: LocalMainGit
  readonly #artifacts: MilitaryArtifacts
  readonly #stateRoot: string
  readonly #clock: Clock
  readonly #snapshots = new Map<string, SnapshotRecord>()
  readonly #leases = new Map<string, LiveLease>()
  readonly #patches = new Map<string, CandidatePatch>()

  constructor(input: {
    readonly repositoryRoot: string
    readonly stateRoot: string
    readonly artifacts: MilitaryArtifacts
    readonly clock?: Clock
  }) {
    this.#fallbackGit = new LocalMainGit(resolve(input.repositoryRoot))
    this.#stateRoot = resolve(input.stateRoot)
    this.#artifacts = input.artifacts
    this.#clock = input.clock ?? (() => new Date())
  }

  async snapshot(input: {
    readonly tenantId: string
    readonly workspaceKey: string
    readonly signal: AbortSignal
  }): Promise<WorkspaceSnapshot> {
    const git = this.#gitForWorkspace(input.workspaceKey)
    await git.ensureRepository(input.signal)
    const head = await this.#ensureHead(git, input.signal)
    const branch = (await requireProcess('git', ['branch', '--show-current'], { cwd: git.root(), signal: input.signal })).stdout.trim()
    const treeHash = await git.treeHash(input.signal)
    const status = (await requireProcess('git', ['status', '--porcelain=v2', '-z'], { cwd: git.root(), signal: input.signal })).stdout
    const manifest = (await requireProcess('git', ['ls-files', '-s', '-z'], { cwd: git.root(), signal: input.signal })).stdout
    const manifestArtifact = await this.#artifacts.put({
      bytes: new TextEncoder().encode(manifest), mediaType: 'application/x-git-index-manifest', classification: 'internal',
      description: `workspace ${input.workspaceKey} file manifest`,
    })
    const environment = JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      git: (await requireProcess('git', ['--version'], { cwd: git.root(), signal: input.signal })).stdout.trim(),
    })
    const environmentArtifact = await this.#artifacts.put({
      bytes: new TextEncoder().encode(environment), mediaType: 'application/json', classification: 'internal',
      description: `workspace ${input.workspaceKey} environment`,
    })
    const value: WorkspaceSnapshot = {
      schemaVersion: '1.0.0',
      workspaceSnapshotId: uuid('workspace-snapshot'),
      tenantId: input.tenantId,
      workspaceKey: input.workspaceKey,
      rootPathHash: brand<string, 'Sha256'>(sha256(git.root())),
      git: {
        repositoryId: brand<string, 'Sha256'>(sha256(git.root())),
        head,
        branch,
        treeHash,
        dirtyStateHash: brand<string, 'Sha256'>(sha256(status)),
      },
      fileManifest: manifestArtifact,
      environmentArtifact,
      createdAt: now(this.#clock),
    }
    this.#snapshots.set(value.workspaceSnapshotId, {
      snapshot: cloneFrozen(value),
      git,
    })
    return cloneFrozen(value)
  }

  async lease(lease: WorkspaceLease): Promise<void> {
    const existing = this.#leases.get(lease.workspaceLeaseId)
    if (existing !== undefined) {
      if (existing.lease.leaseVersion !== lease.leaseVersion) throw new MilitaryError('REVISION_CONFLICT')
      return
    }
    const record = this.#snapshots.get(lease.workspaceSnapshotId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    const snapshot = record.snapshot
    if (lease.state !== 'ACTIVE') throw new MilitaryError('INVALID_ARGUMENT')
    let worktreePath: string | undefined
    if (lease.mode === 'WRITE') {
      const worktreeRoot = join(this.#stateRoot, 'worktrees')
      await mkdir(worktreeRoot, { recursive: true })
      worktreePath = join(worktreeRoot, lease.workspaceLeaseId)
      await rm(worktreePath, { recursive: true, force: true })
      await requireProcess('git', ['worktree', 'add', '--detach', worktreePath, snapshot.git.head], { cwd: record.git.root() }, 'PERSISTENCE_FAILED')
    }
    this.#leases.set(lease.workspaceLeaseId, { lease: cloneFrozen(lease), ...(worktreePath === undefined ? {} : { worktreePath }) })
  }

  async release(workspaceLeaseId: string): Promise<void> {
    const live = this.#leases.get(workspaceLeaseId)
    if (live === undefined) return
    const record = this.#snapshots.get(live.lease.workspaceSnapshotId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    if (live.worktreePath !== undefined) {
      await requireProcess('git', ['worktree', 'remove', '--force', live.worktreePath], { cwd: record.git.root() }, 'PERSISTENCE_FAILED')
      await rm(live.worktreePath, { recursive: true, force: true })
    }
    this.#leases.delete(workspaceLeaseId)
  }

  executionPath(workspaceLeaseId: string): string {
    const live = this.#leases.get(workspaceLeaseId)
    if (live === undefined || live.lease.state !== 'ACTIVE') throw new MilitaryError('RESOURCE_LOCKED', 'workspace lease is not active')
    const record = this.#snapshots.get(live.lease.workspaceSnapshotId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    return live.worktreePath ?? record.git.root()
  }

  /** Backward-compatible concrete-provider alias. */
  worktreePath(workspaceLeaseId: string): string { return this.executionPath(workspaceLeaseId) }

  async createCandidatePatch(input: {
    readonly workspaceLeaseId: string
    readonly candidateId: string
    readonly missionId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly signal: AbortSignal
  }): Promise<CandidatePatch> {
    const live = this.#leases.get(input.workspaceLeaseId)
    if (live === undefined || live.worktreePath === undefined) throw new MilitaryError('RESOURCE_LOCKED', 'write worktree lease required')
    const record = this.#snapshots.get(live.lease.workspaceSnapshotId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND')
    const snapshot = record.snapshot
    const changed = await changedPaths(live.worktreePath, input.signal)
    if (changed.length === 0) throw new MilitaryError('INVALID_ARGUMENT', 'write-task candidate contains no workspace changes')
    const forbidden = changed.filter(path => !pathWithinAny(path, live.lease.pathScope.writePaths)
      || live.lease.pathScope.forbiddenPaths.some(denied => pathWithinAny(path, [denied])))
    if (forbidden.length > 0) throw new MilitaryError('FORBIDDEN_SCOPE', 'candidate changed forbidden paths', { forbidden })
    await requireProcess('git', ['add', '--intent-to-add', '--', ...changed], {
      cwd: live.worktreePath, signal: input.signal,
    })
    const diff = await requireProcess('git', ['diff', '--binary', '--full-index', '--no-ext-diff', snapshot.git.head, '--'], {
      cwd: live.worktreePath, signal: input.signal,
    })
    const patchBytes = new TextEncoder().encode(diff.stdout)
    const patchArtifact = await this.#artifacts.put({
      bytes: patchBytes,
      mediaType: 'text/x-diff',
      classification: 'internal',
      description: `candidate patch ${input.candidateId}`,
    })
    const patch: CandidatePatch = {
      schemaVersion: '1.0.0',
      candidatePatchId: deterministicCandidatePatchId(
        input.candidateId,
        String(snapshot.workspaceSnapshotId),
        sha256(patchBytes),
      ),
      candidateId: input.candidateId,
      missionId: input.missionId,
      taskId: input.taskId,
      taskVersion: input.taskVersion,
      baseWorkspaceSnapshotId: snapshot.workspaceSnapshotId,
      patchArtifact,
      changedPaths: changed,
      applyMode: 'GIT_BINARY_PATCH',
      preconditions: [`HEAD=${snapshot.git.head}`, `TREE=${snapshot.git.treeHash}`],
      patchHash: brand<string, 'Sha256'>(sha256(patchBytes)),
      createdAt: now(this.#clock),
    }
    this.#patches.set(patch.candidatePatchId, cloneFrozen(patch))
    return cloneFrozen(patch)
  }

  async candidatePatch(candidateId: string): Promise<CandidatePatch> {
    const patch = [...this.#patches.values()].find(item => item.candidateId === candidateId || item.candidatePatchId === candidateId)
    if (patch === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(patch)
  }

  snapshotById(id: string): WorkspaceSnapshot {
    const record = this.#snapshots.get(id)
    if (record === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    return cloneFrozen(record.snapshot)
  }

  repositoryPath(workspaceSnapshotId: string): string {
    const record = this.#snapshots.get(workspaceSnapshotId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    return record.git.root()
  }

  #gitForWorkspace(workspaceKey: string): LocalMainGit {
    // Root Military Session bindings are absolute. Keep the constructor root
    // only as a compatibility fallback for non-path fixture/deployment keys.
    return isAbsolute(workspaceKey)
      ? new LocalMainGit(resolve(workspaceKey))
      : this.#fallbackGit
  }

  async #ensureHead(git: LocalMainGit, signal: AbortSignal): Promise<string> {
    const head = await git.head(signal)
    if (head !== 'UNBORN') return head
    await requireProcess('git', ['commit', '--allow-empty', '-m', 'chore: initialize dsh-military local main'], {
      cwd: git.root(), signal,
      env: {
        GIT_AUTHOR_NAME: 'dsh-military engineer', GIT_AUTHOR_EMAIL: 'dsh-military@localhost',
        GIT_COMMITTER_NAME: 'dsh-military engineer', GIT_COMMITTER_EMAIL: 'dsh-military@localhost',
      },
    }, 'GIT_COMMIT_FAILED')
    return await git.head(signal)
  }
}

function deterministicCandidatePatchId(
  candidateId: string,
  workspaceSnapshotId: string,
  patchHash: string,
): string {
  return `candidate-patch-${sha256(`${candidateId}\u0000${workspaceSnapshotId}\u0000${patchHash}`).slice(0, 40)}`
}

async function changedPaths(cwd: string, signal: AbortSignal): Promise<readonly string[]> {
  const result = await requireProcess('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, signal })
  const records = result.stdout.split('\0')
  const paths: string[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length < 4) continue
    const status = record.slice(0, 2)
    const path = record.slice(3)
    if (path !== '') paths.push(path)
    if (/[RC]/u.test(status)) {
      const original = records[index + 1]
      if (original !== undefined && original !== '') paths.push(original)
      index += 1
    }
  }
  return [...new Set(paths)].sort()
}
