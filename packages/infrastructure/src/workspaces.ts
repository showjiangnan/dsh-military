import { access, mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  MilitaryError,
  type CandidatePatch,
  type MilitaryArtifacts,
  type MilitaryWorkspaces,
  type MilitaryWorkspaceStateStore,
  type WorkspaceLease,
  type WorkspaceLeaseStateRecord,
  type WorkspaceSnapshotStateRecord,
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

export class InMemoryWorkspaceStateStore
implements MilitaryWorkspaceStateStore {
  readonly #snapshots = new Map<string, WorkspaceSnapshotStateRecord>()
  readonly #leases = new Map<string, WorkspaceLeaseStateRecord>()
  readonly #patches = new Map<string, CandidatePatch>()

  listSnapshots(): readonly WorkspaceSnapshotStateRecord[] {
    return cloneFrozen([...this.#snapshots.values()])
  }

  putSnapshot(record: WorkspaceSnapshotStateRecord): void {
    this.#snapshots.set(
      record.snapshot.workspaceSnapshotId,
      cloneFrozen(record),
    )
  }

  listLeases(): readonly WorkspaceLeaseStateRecord[] {
    return cloneFrozen([...this.#leases.values()])
  }

  putLease(record: WorkspaceLeaseStateRecord): void {
    this.#leases.set(
      record.lease.workspaceLeaseId,
      cloneFrozen(record),
    )
  }

  listPatches(): readonly CandidatePatch[] {
    return cloneFrozen([...this.#patches.values()])
  }

  putPatch(patch: CandidatePatch): void {
    this.#patches.set(patch.candidatePatchId, cloneFrozen(patch))
  }
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
  readonly #state: MilitaryWorkspaceStateStore
  readonly #snapshots = new Map<string, SnapshotRecord>()
  readonly #leases = new Map<string, LiveLease>()
  readonly #patches = new Map<string, CandidatePatch>()

  constructor(input: {
    readonly repositoryRoot: string
    readonly stateRoot: string
    readonly artifacts: MilitaryArtifacts
    readonly state?: MilitaryWorkspaceStateStore
    readonly clock?: Clock
  }) {
    this.#fallbackGit = new LocalMainGit(resolve(input.repositoryRoot))
    this.#stateRoot = resolve(input.stateRoot)
    this.#artifacts = input.artifacts
    this.#clock = input.clock ?? (() => new Date())
    this.#state = input.state ?? new InMemoryWorkspaceStateStore()
    for (const record of this.#state.listSnapshots()) {
      this.#snapshots.set(record.snapshot.workspaceSnapshotId, {
        snapshot: cloneFrozen(record.snapshot),
        git: new LocalMainGit(resolve(record.repositoryPath)),
      })
    }
    for (const record of this.#state.listLeases()) {
      if (record.phase !== 'ACTIVE') continue
      this.#leases.set(record.lease.workspaceLeaseId, {
        lease: cloneFrozen(record.lease),
        ...(record.worktreePath === undefined
          ? {}
          : { worktreePath: record.worktreePath }),
      })
    }
    for (const patch of this.#state.listPatches()) {
      this.#patches.set(patch.candidatePatchId, cloneFrozen(patch))
    }
  }

  /** Complete interrupted worktree create/remove phases after Host restart. */
  async reconcile(signal: AbortSignal): Promise<void> {
    for (const state of this.#state.listLeases()) {
      if (state.phase === 'RELEASED') {
        this.#leases.delete(state.lease.workspaceLeaseId)
        continue
      }
      const snapshot = this.#snapshots.get(state.lease.workspaceSnapshotId)
      if (snapshot === undefined) {
        this.#markWorkspaceRecovery(state, 'WORKSPACE_SNAPSHOT_MISSING')
        continue
      }
      if (
        state.phase === 'ACTIVE'
        && Date.parse(String(state.lease.expiresAt)) <= this.#clock().getTime()
      ) {
        this.#markWorkspaceRecovery(state, 'WORKSPACE_LEASE_EXPIRED')
        continue
      }
      if (state.phase === 'RELEASING') {
        if (state.worktreePath !== undefined) {
          let worktreePath: string
          try {
            worktreePath = this.#managedWorktreePath(
              state.lease.workspaceLeaseId,
              state.worktreePath,
            )
          } catch {
            this.#markWorkspaceRecovery(
              state,
              'WORKTREE_PATH_OUTSIDE_MANAGED_ROOT',
            )
            continue
          }
          if (await pathExists(worktreePath)) {
            if (!await registeredWorktree(
              snapshot.git.root(),
              worktreePath,
              snapshot.snapshot.git.head,
              signal,
            )) {
              this.#markWorkspaceRecovery(
                state,
                'WORKTREE_NOT_REGISTERED_WITH_EXPECTED_HEAD',
              )
              continue
            }
            try {
              await requireProcess(
                'git',
                ['worktree', 'remove', '--force', worktreePath],
                { cwd: snapshot.git.root(), signal },
                'PERSISTENCE_FAILED',
              )
            } catch {
              this.#markWorkspaceRecovery(
                state,
                'WORKTREE_RELEASE_FAILED',
              )
              continue
            }
            // Git owns the primary removal. A residual directory is deleted
            // only after the exact managed path and repository registration
            // have both been proven.
            await rm(worktreePath, { recursive: true, force: true })
          } else {
            await requireProcess(
              'git',
              ['worktree', 'prune'],
              { cwd: snapshot.git.root(), signal },
              'PERSISTENCE_FAILED',
            )
          }
        }
        const {
          recoveryReason: _recoveryReason,
          ...releasedState
        } = state
        this.#state.putLease({
          ...releasedState,
          phase: 'RELEASED',
          updatedAt: now(this.#clock),
        })
        this.#leases.delete(state.lease.workspaceLeaseId)
        continue
      }
      if (state.phase === 'RECOVERY_REQUIRED'
        && state.lease.mode === 'WRITE'
        && state.worktreePath === undefined) {
        continue
      }
      let worktreePath = state.worktreePath
      if (state.lease.mode === 'WRITE') {
        try {
          worktreePath = this.#managedWorktreePath(
            state.lease.workspaceLeaseId,
            worktreePath ?? this.#expectedWorktreePath(
              state.lease.workspaceLeaseId,
            ),
          )
        } catch {
          this.#markWorkspaceRecovery(
            state,
            'WORKTREE_PATH_OUTSIDE_MANAGED_ROOT',
          )
          continue
        }
        if (await pathExists(worktreePath)) {
          if (!await registeredWorktree(
            snapshot.git.root(),
            worktreePath,
            snapshot.snapshot.git.head,
            signal,
          )) {
            this.#markWorkspaceRecovery(
              { ...state, worktreePath },
              'WORKTREE_NOT_REGISTERED_WITH_EXPECTED_HEAD',
            )
            continue
          }
        } else if (state.phase === 'RECOVERY_REQUIRED') {
          // Recovery state does not authorize reconstructing or deleting an
          // unknown filesystem object. Operations Center must explicitly
          // inspect and retry it.
          continue
        } else {
          await mkdir(join(this.#stateRoot, 'worktrees'), { recursive: true })
          try {
            await requireProcess(
              'git',
              [
                'worktree',
                'add',
                '--detach',
                worktreePath,
                snapshot.snapshot.git.head,
              ],
              { cwd: snapshot.git.root(), signal },
              'PERSISTENCE_FAILED',
            )
          } catch {
            this.#markWorkspaceRecovery(
              { ...state, worktreePath },
              'WORKTREE_CREATE_FAILED',
            )
            continue
          }
        }
      } else if (state.phase === 'RECOVERY_REQUIRED') {
        // A read lease has no external worktree. Once its immutable snapshot
        // is present, it is safe to adopt without filesystem mutation.
        worktreePath = undefined
      }
      const {
        recoveryReason: _recoveryReason,
        ...adoptedState
      } = state
      const active: WorkspaceLeaseStateRecord = {
        ...adoptedState,
        phase: 'ACTIVE',
        ...(worktreePath === undefined ? {} : { worktreePath }),
        updatedAt: now(this.#clock),
      }
      this.#state.putLease(active)
      this.#leases.set(state.lease.workspaceLeaseId, {
        lease: cloneFrozen(state.lease),
        ...(worktreePath === undefined ? {} : { worktreePath }),
      })
    }
  }

  #expectedWorktreePath(workspaceLeaseId: string): string {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(workspaceLeaseId)
      || workspaceLeaseId === '.'
      || workspaceLeaseId === '..'
    ) {
      throw new MilitaryError(
        'FORBIDDEN_SCOPE',
        'workspace lease id cannot name a managed worktree path',
      )
    }
    return resolve(this.#stateRoot, 'worktrees', workspaceLeaseId)
  }

  #managedWorktreePath(
    workspaceLeaseId: string,
    candidate: string,
  ): string {
    const expected = this.#expectedWorktreePath(workspaceLeaseId)
    const observed = resolve(candidate)
    if (observed !== expected) {
      throw new MilitaryError(
        'FORBIDDEN_SCOPE',
        'persisted worktree path is outside its exact managed lease path',
      )
    }
    return observed
  }

  #markWorkspaceRecovery(
    state: WorkspaceLeaseStateRecord,
    recoveryReason: string,
  ): void {
    this.#leases.delete(state.lease.workspaceLeaseId)
    this.#state.putLease({
      ...state,
      phase: 'RECOVERY_REQUIRED',
      recoveryReason,
      updatedAt: now(this.#clock),
    })
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
      tenantId: input.tenantId,
      ownerPrincipalId: 'military-host',
      audiencePrincipalIds: ['military-host'],
      audienceScopes: ['artifact:read', 'military:workspace-snapshot'],
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
      tenantId: input.tenantId,
      ownerPrincipalId: 'military-host',
      audiencePrincipalIds: ['military-host'],
      audienceScopes: ['artifact:read', 'military:workspace-snapshot'],
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
    this.#state.putSnapshot({
      snapshot: cloneFrozen(value),
      repositoryPath: git.root(),
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
    this.#state.putLease({
      lease: cloneFrozen(lease),
      phase: 'PREPARING',
      updatedAt: now(this.#clock),
    })
    try {
      if (lease.mode === 'WRITE') {
        const worktreeRoot = join(this.#stateRoot, 'worktrees')
        await mkdir(worktreeRoot, { recursive: true })
        worktreePath = this.#managedWorktreePath(
          lease.workspaceLeaseId,
          join(worktreeRoot, lease.workspaceLeaseId),
        )
        if (await pathExists(worktreePath)) {
          this.#markWorkspaceRecovery({
            lease: cloneFrozen(lease),
            phase: 'PREPARING',
            worktreePath,
            updatedAt: now(this.#clock),
          }, 'WORKTREE_PATH_COLLISION')
          throw new MilitaryError(
            'RESOURCE_LOCKED',
            'managed worktree path already exists and requires recovery',
          )
        }
        this.#state.putLease({
          lease: cloneFrozen(lease),
          phase: 'PREPARING',
          worktreePath,
          updatedAt: now(this.#clock),
        })
        await requireProcess('git', ['worktree', 'add', '--detach', worktreePath, snapshot.git.head], { cwd: record.git.root() }, 'PERSISTENCE_FAILED')
      }
    } catch (error) {
      this.#state.putLease({
        lease: cloneFrozen(lease),
        phase: 'RECOVERY_REQUIRED',
        ...(worktreePath === undefined ? {} : { worktreePath }),
        updatedAt: now(this.#clock),
      })
      throw error
    }
    this.#leases.set(lease.workspaceLeaseId, { lease: cloneFrozen(lease), ...(worktreePath === undefined ? {} : { worktreePath }) })
    this.#state.putLease({
      lease: cloneFrozen(lease),
      phase: 'ACTIVE',
      ...(worktreePath === undefined ? {} : { worktreePath }),
      updatedAt: now(this.#clock),
    })
  }

  async release(workspaceLeaseId: string): Promise<void> {
    const live = this.#leases.get(workspaceLeaseId)
    if (live === undefined) return
    const record = this.#snapshots.get(live.lease.workspaceSnapshotId)
    if (record === undefined) throw new MilitaryError('NOT_FOUND', 'workspace snapshot not found')
    this.#state.putLease({
      lease: cloneFrozen(live.lease),
      phase: 'RELEASING',
      ...(live.worktreePath === undefined
        ? {}
        : { worktreePath: live.worktreePath }),
      updatedAt: now(this.#clock),
    })
    if (live.worktreePath !== undefined) {
      let worktreePath: string
      try {
        worktreePath = this.#managedWorktreePath(
          live.lease.workspaceLeaseId,
          live.worktreePath,
        )
      } catch (error) {
        this.#markWorkspaceRecovery({
          lease: cloneFrozen(live.lease),
          phase: 'RELEASING',
          worktreePath: live.worktreePath,
          updatedAt: now(this.#clock),
        }, 'WORKTREE_PATH_OUTSIDE_MANAGED_ROOT')
        throw error
      }
      if (await pathExists(worktreePath)) {
        if (!await registeredWorktree(
          record.git.root(),
          worktreePath,
          record.snapshot.git.head,
        )) {
          this.#markWorkspaceRecovery({
            lease: cloneFrozen(live.lease),
            phase: 'RELEASING',
            worktreePath,
            updatedAt: now(this.#clock),
          }, 'WORKTREE_NOT_REGISTERED_WITH_EXPECTED_HEAD')
          throw new MilitaryError(
            'RESOURCE_LOCKED',
            'worktree release requires exact repository registration',
          )
        }
        await requireProcess(
          'git',
          ['worktree', 'remove', '--force', worktreePath],
          { cwd: record.git.root() },
          'PERSISTENCE_FAILED',
        )
        await rm(worktreePath, { recursive: true, force: true })
      } else {
        await requireProcess(
          'git',
          ['worktree', 'prune'],
          { cwd: record.git.root() },
          'PERSISTENCE_FAILED',
        )
      }
    }
    this.#leases.delete(workspaceLeaseId)
    this.#state.putLease({
      lease: cloneFrozen(live.lease),
      phase: 'RELEASED',
      ...(live.worktreePath === undefined
        ? {}
        : { worktreePath: live.worktreePath }),
      updatedAt: now(this.#clock),
    })
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
      tenantId: live.lease.tenantId,
      missionId: input.missionId,
      taskId: input.taskId,
      ownerPrincipalId: String(live.lease.agent.agentId),
      audiencePrincipalIds: ['military-host', String(live.lease.agent.agentId)],
      audienceScopes: ['artifact:read', 'military:candidate-patch'],
      idempotencyKey: `candidate-patch:${deterministicCandidatePatchId(
        input.candidateId,
        String(snapshot.workspaceSnapshotId),
        sha256(patchBytes),
      )}`,
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
    this.#state.putPatch(patch)
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
  expectedHead: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // Git canonicalizes macOS' `/var` symlink to `/private/var` in porcelain
  // output. `path.resolve()` is lexical only and therefore cannot compare a
  // persisted manager path with Git's canonical registration reliably.
  const canonicalExpectedPath = await realpath(worktreePath)
  const result = await requireProcess(
    'git',
    ['worktree', 'list', '--porcelain'],
    {
      cwd: repositoryRoot,
      ...(signal === undefined ? {} : { signal }),
    },
    'PERSISTENCE_FAILED',
  )
  for (const block of result.stdout.split(/\n\n+/u)) {
    let observedPath: string | undefined
    let observedHead: string | undefined
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) observedPath = line.slice(9)
      else if (line.startsWith('HEAD ')) observedHead = line.slice(5)
    }
    if (observedPath === undefined) continue
    let canonicalObservedPath: string
    try {
      canonicalObservedPath = await realpath(observedPath)
    } catch {
      // A stale registration for another missing worktree is unrelated to the
      // exact live path being validated; `git worktree prune` owns its cleanup.
      continue
    }
    if (canonicalObservedPath === canonicalExpectedPath) {
      return observedHead === expectedHead
    }
  }
  return false
}
