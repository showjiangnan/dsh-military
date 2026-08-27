import type {
  CandidatePatch,
  MilitaryWorkspaceStateStore,
  WorkspaceLeaseStateRecord,
  WorkspaceSnapshotStateRecord,
} from '@dsh-military/contracts'
import { stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'
import { SqliteStateRecords } from './state-records.js'

const SNAPSHOT_NAMESPACE = 'workspace-snapshot-state'
const LEASE_NAMESPACE = 'workspace-lease-state'
const PATCH_NAMESPACE = 'workspace-candidate-patch'

/**
 * Durable Workspace state with compatibility mirrors in the original RC.2
 * relational projection tables used by the operations UI.
 */
export class SqliteWorkspaceStateStore
implements MilitaryWorkspaceStateStore {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #records: SqliteStateRecords

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  listSnapshots(): readonly WorkspaceSnapshotStateRecord[] {
    return this.#records.listSync<WorkspaceSnapshotStateRecord>(
      SNAPSHOT_NAMESPACE,
    )
  }

  putSnapshot(record: WorkspaceSnapshotStateRecord): void {
    this.#database.transaction(() => {
      this.#records.putSync(
        SNAPSHOT_NAMESPACE,
        record.snapshot.workspaceSnapshotId,
        record,
      )
      this.#database.db.prepare(`
        INSERT INTO workspace_snapshots(
          tenant_id, workspace_snapshot_id, workspace_key, root_path_hash,
          git_head, tree_hash, dirty_state_hash, snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, workspace_snapshot_id) DO UPDATE SET
          snapshot_json = excluded.snapshot_json
      `).run(
        this.#tenantId,
        record.snapshot.workspaceSnapshotId,
        record.snapshot.workspaceKey,
        String(record.snapshot.rootPathHash),
        record.snapshot.git.head,
        record.snapshot.git.treeHash,
        String(record.snapshot.git.dirtyStateHash),
        stableJson(record.snapshot),
        String(record.snapshot.createdAt),
      )
    })
  }

  listLeases(): readonly WorkspaceLeaseStateRecord[] {
    return this.#records.listSync<WorkspaceLeaseStateRecord>(LEASE_NAMESPACE)
  }

  putLease(record: WorkspaceLeaseStateRecord): void {
    this.#database.transaction(() => {
      this.#records.putSync(
        LEASE_NAMESPACE,
        record.lease.workspaceLeaseId,
        record,
      )
      this.#database.db.prepare(`
        INSERT INTO workspace_leases(
          tenant_id, workspace_lease_id, mission_id, task_id, task_version,
          agent_id, workspace_snapshot_id, mode, path_scope_json, state,
          lease_version, acquired_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, workspace_lease_id) DO UPDATE SET
          state = excluded.state,
          lease_version = excluded.lease_version,
          expires_at = excluded.expires_at
      `).run(
        this.#tenantId,
        record.lease.workspaceLeaseId,
        record.lease.missionId,
        record.lease.taskId,
        record.lease.taskVersion,
        String(record.lease.agent.agentId),
        record.lease.workspaceSnapshotId,
        record.lease.mode,
        stableJson(record.lease.pathScope),
        record.phase,
        record.lease.leaseVersion,
        String(record.lease.acquiredAt),
        String(record.lease.expiresAt),
      )
    })
  }

  listPatches(): readonly CandidatePatch[] {
    return this.#records.listSync<CandidatePatch>(PATCH_NAMESPACE)
  }

  putPatch(patch: CandidatePatch): void {
    this.#records.putSync(PATCH_NAMESPACE, patch.candidatePatchId, patch)
  }
}
