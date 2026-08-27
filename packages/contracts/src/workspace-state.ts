import type {
  CandidatePatch,
  WorkspaceLease,
  WorkspaceSnapshot,
} from './governance.js'

export interface WorkspaceSnapshotStateRecord {
  readonly snapshot: WorkspaceSnapshot
  readonly repositoryPath: string
}

export interface WorkspaceLeaseStateRecord {
  readonly lease: WorkspaceLease
  readonly phase: 'PREPARING' | 'ACTIVE' | 'RELEASING' | 'RELEASED' | 'RECOVERY_REQUIRED'
  readonly worktreePath?: string
  readonly recoveryReason?: string
  readonly updatedAt: string
}

/** Durable state seam owned by the Workspace coordinator. */
export interface MilitaryWorkspaceStateStore {
  listSnapshots(): readonly WorkspaceSnapshotStateRecord[]
  putSnapshot(record: WorkspaceSnapshotStateRecord): void
  listLeases(): readonly WorkspaceLeaseStateRecord[]
  putLease(record: WorkspaceLeaseStateRecord): void
  listPatches(): readonly CandidatePatch[]
  putPatch(patch: CandidatePatch): void
}
