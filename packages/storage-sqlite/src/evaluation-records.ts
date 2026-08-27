import {
  MilitaryError,
  brand,
  type ArtifactRef,
  type EvaluationDatasetManifest,
  type EvaluationReportRevisionSummary,
  type EvaluationRequestId,
  type EvaluationRunSummary,
  type MilitaryArtifacts,
  type MilitaryPerformanceReport,
  type PerformanceReportId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  stableJson,
  type EvaluationLeaseFence,
  type EvaluationRecordStore,
  type PersistedEvaluationRecord,
} from '@dsh-military/core'
import type { EvaluationDatasetArchive } from '@dsh-military/runtime'
import type { SqliteMilitaryDatabase } from './database.js'

interface RunRow {
  readonly record_json: string
}

interface ManifestRow {
  readonly manifest_json: string
}

interface LineageRow {
  readonly summary_json: string
}

/** Durable manifest index; canonical dataset bytes remain in MilitaryArtifacts. */
export class SqliteEvaluationDatasetArchive implements EvaluationDatasetArchive {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string

  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#tenantId = tenantId
  }

  async read(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<EvaluationDatasetManifest | null> {
    const row = this.#database.db.prepare(`
      SELECT manifest_json
      FROM evaluation_dataset_manifests
      WHERE tenant_id = ? AND evaluation_request_id = ?
    `).get(
      this.#tenantId,
      String(evaluationRequestId),
    ) as ManifestRow | undefined
    return row === undefined
      ? null
      : cloneFrozen(JSON.parse(row.manifest_json) as EvaluationDatasetManifest)
  }

  async write(manifest: EvaluationDatasetManifest): Promise<void> {
    this.#database.transaction(() => {
      const row = this.#database.db.prepare(`
        SELECT manifest_json
        FROM evaluation_dataset_manifests
        WHERE tenant_id = ? AND evaluation_request_id = ?
      `).get(
        this.#tenantId,
        manifest.evaluationRequestId,
      ) as ManifestRow | undefined
      if (row !== undefined) {
        const current = JSON.parse(
          row.manifest_json,
        ) as EvaluationDatasetManifest
        if (stableJson(current) !== stableJson(manifest)) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            'evaluation request already owns another frozen dataset manifest',
          )
        }
        return
      }
      this.#database.db.prepare(`
        INSERT INTO evaluation_dataset_manifests(
          tenant_id, evaluation_request_id, dataset_hash, manifest_json, frozen_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        this.#tenantId,
        manifest.evaluationRequestId,
        String(manifest.datasetHash),
        stableJson(manifest),
        String(manifest.frozenAt),
      )
    })
  }
}

/**
 * Crash-resumable evaluation job and immutable report-revision repository.
 * Report bytes are stored before the SQLite pointer is committed, so a crash
 * can leave only an unreferenced content-addressed artifact, never a dangling
 * report row.
 */
export class SqliteEvaluationRecordStore implements EvaluationRecordStore {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #artifacts: MilitaryArtifacts

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    artifacts: MilitaryArtifacts,
  ) {
    this.#database = database
    this.#tenantId = tenantId
    this.#artifacts = artifacts
  }

  async read(
    evaluationRequestId: EvaluationRequestId,
  ): Promise<PersistedEvaluationRecord | null> {
    const row = this.#database.db.prepare(`
      SELECT record_json
      FROM evaluation_run_records
      WHERE tenant_id = ? AND evaluation_request_id = ?
    `).get(
      this.#tenantId,
      String(evaluationRequestId),
    ) as RunRow | undefined
    return row === undefined
      ? null
      : cloneFrozen(JSON.parse(row.record_json) as PersistedEvaluationRecord)
  }

  async write(
    record: PersistedEvaluationRecord,
    lease?: EvaluationLeaseFence,
  ): Promise<void> {
    const reportArtifact = record.report === null
      ? null
      : await this.#artifacts.put({
          bytes: new TextEncoder().encode(stableJson(record.report)),
          mediaType: 'application/vnd.dsh-military.performance-report+json',
          classification: record.report.classification,
          description: `Military performance report ${String(record.report.reportId)} revision ${Number(record.report.reportRevision)}`,
          tenantId: this.#tenantId,
          ownerPrincipalId: 'military-evaluation-engine',
          audiencePrincipalIds: ['military-host', 'military-evaluation-engine'],
          audienceScopes: ['artifact:read', 'military:evaluation-report'],
        })
    this.#database.transaction(() => {
      const key = String(record.request.evaluationRequestId)
      const previous = this.#database.db.prepare(`
        SELECT storage_revision, record_json
        FROM evaluation_run_records
        WHERE tenant_id = ? AND evaluation_request_id = ?
      `).get(this.#tenantId, key) as {
        readonly storage_revision: number
        readonly record_json: string
      } | undefined
      const previousRecord = previous === undefined
        ? null
        : JSON.parse(previous.record_json) as PersistedEvaluationRecord
      if (lease !== undefined) {
        const active = this.#database.db.prepare(`
          SELECT state, lease_owner, lease_version, lease_until
          FROM evaluation_jobs
          WHERE tenant_id = ? AND evaluation_request_id = ?
        `).get(this.#tenantId, key) as {
          readonly state: string
          readonly lease_owner: string | null
          readonly lease_version: number
          readonly lease_until: string | null
        } | undefined
        if (
          active === undefined
          || active.lease_owner !== lease.owner
          || active.lease_version !== lease.version
          || active.lease_until === null
          || Date.parse(active.lease_until) < Date.now()
        ) {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            'evaluation worker lease is stale',
          )
        }
        if (active.state === 'CANCELLED') {
          throw new MilitaryError('POLICY_DENIED', 'evaluation is cancelled')
        }
      }
      if (
        previousRecord?.report !== null
        && previousRecord?.report !== undefined
        && record.report !== null
        && stableJson(previousRecord.report) !== stableJson(record.report)
      ) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          'completed evaluation report is immutable',
        )
      }
      const timestamp = record.updatedAt
      this.#database.db.prepare(`
        INSERT INTO evaluation_jobs(
          tenant_id, evaluation_request_id, state, request_json,
          lease_owner, lease_version, lease_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, ?)
        ON CONFLICT(tenant_id, evaluation_request_id) DO UPDATE SET
          state = excluded.state,
          request_json = excluded.request_json,
          updated_at = excluded.updated_at
      `).run(
        this.#tenantId,
        key,
        record.run.state,
        stableJson(record.request),
        String(record.request.createdAt),
        timestamp,
      )
      this.#database.db.prepare(`
        INSERT INTO evaluation_run_records(
          tenant_id, evaluation_request_id, storage_revision, state,
          record_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, evaluation_request_id) DO UPDATE SET
          storage_revision = excluded.storage_revision,
          state = excluded.state,
          record_json = excluded.record_json,
          updated_at = excluded.updated_at
      `).run(
        this.#tenantId,
        key,
        (previous?.storage_revision ?? 0) + 1,
        record.run.state,
        stableJson(record),
        timestamp,
      )
      if (record.report !== null && reportArtifact !== null) {
        this.#recordReport(record.report, reportArtifact)
      }
    })
  }

  async acquire(
    evaluationRequestId: EvaluationRequestId,
    owner: string,
    leaseUntil: string,
  ): Promise<EvaluationLeaseFence | null> {
    if (
      owner.trim().length === 0
      || !Number.isFinite(Date.parse(leaseUntil))
      || Date.parse(leaseUntil) <= Date.now()
    ) throw new MilitaryError('INVALID_ARGUMENT', 'evaluation lease is invalid')
    return this.#database.transaction(() => {
      const now = new Date().toISOString()
      const changed = this.#database.db.prepare(`
        UPDATE evaluation_jobs
        SET lease_owner = ?, lease_version = lease_version + 1,
            lease_until = ?, updated_at = ?
        WHERE tenant_id = ? AND evaluation_request_id = ?
          AND state NOT IN ('COMPLETED', 'CANCELLED')
          AND (lease_until IS NULL OR lease_until <= ?)
      `).run(
        owner,
        leaseUntil,
        now,
        this.#tenantId,
        String(evaluationRequestId),
        now,
      )
      if (Number(changed.changes) !== 1) return null
      const row = this.#database.db.prepare(`
        SELECT lease_version
        FROM evaluation_jobs
        WHERE tenant_id = ? AND evaluation_request_id = ?
      `).get(
        this.#tenantId,
        String(evaluationRequestId),
      ) as { readonly lease_version: number } | undefined
      if (row === undefined) return null
      return {
        evaluationRequestId,
        owner,
        version: row.lease_version,
      }
    })
  }

  async renew(
    lease: EvaluationLeaseFence,
    leaseUntil: string,
  ): Promise<void> {
    this.#database.transaction(() => {
      const changed = this.#database.db.prepare(`
        UPDATE evaluation_jobs
        SET lease_until = ?, updated_at = ?
        WHERE tenant_id = ? AND evaluation_request_id = ?
          AND lease_owner = ? AND lease_version = ?
          AND state NOT IN ('COMPLETED', 'CANCELLED')
      `).run(
        leaseUntil,
        new Date().toISOString(),
        this.#tenantId,
        String(lease.evaluationRequestId),
        lease.owner,
        lease.version,
      )
      if (Number(changed.changes) !== 1) {
        throw new MilitaryError('REVISION_CONFLICT', 'evaluation lease renewal failed')
      }
    })
  }

  async release(lease: EvaluationLeaseFence): Promise<void> {
    this.#database.transaction(() => {
      this.#database.db.prepare(`
        UPDATE evaluation_jobs
        SET lease_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE tenant_id = ? AND evaluation_request_id = ?
          AND lease_owner = ? AND lease_version = ?
      `).run(
        new Date().toISOString(),
        this.#tenantId,
        String(lease.evaluationRequestId),
        lease.owner,
        lease.version,
      )
    })
  }

  #recordReport(
    report: MilitaryPerformanceReport,
    artifact: ArtifactRef,
  ): void {
    this.#database.db.prepare(`
      INSERT INTO evaluation_reports(
        tenant_id, report_id, evaluation_request_id, report_revision,
        dataset_hash, report_artifact_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, report_id, report_revision) DO NOTHING
    `).run(
      this.#tenantId,
      String(report.reportId),
      String(report.evaluationRequestId),
      Number(report.reportRevision),
      String(report.datasetHash),
      String(artifact.artifactId),
      String(report.createdAt),
    )
    const summary: EvaluationReportRevisionSummary = {
      reportId: report.reportId,
      reportRevision: report.reportRevision,
      evaluationRequestId: report.evaluationRequestId,
      datasetHash: report.datasetHash,
      state: 'CURRENT',
      decisionStatus: report.decision.status,
      uniqueAttempts: report.dataQuality.uniqueAttempts,
      uniqueMissions: report.dataQuality.uniqueMissions,
      artifact,
      createdAt: report.createdAt,
    }
    this.#database.db.prepare(`
      INSERT INTO evaluation_report_lineage(
        tenant_id, report_id, report_revision, evaluation_request_id,
        state, supersedes_report_id, superseded_by_report_id,
        artifact_ref_json, summary_json, created_at
      ) VALUES (?, ?, ?, ?, 'CURRENT', NULL, NULL, ?, ?, ?)
      ON CONFLICT(tenant_id, report_id, report_revision) DO NOTHING
    `).run(
      this.#tenantId,
      String(report.reportId),
      Number(report.reportRevision),
      String(report.evaluationRequestId),
      stableJson(artifact),
      stableJson(summary),
      String(report.createdAt),
    )
  }
}

/** Read-only report lineage plus explicit superseding links for upheld appeals. */
export class SqliteEvaluationHistory {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #artifacts: MilitaryArtifacts

  constructor(
    database: SqliteMilitaryDatabase,
    tenantId: string,
    artifacts: MilitaryArtifacts,
  ) {
    this.#database = database
    this.#tenantId = tenantId
    this.#artifacts = artifacts
  }

  list(limit = 100): readonly EvaluationReportRevisionSummary[] {
    const bounded = Math.max(1, Math.min(500, Math.floor(limit)))
    const rows = this.#database.db.prepare(`
      SELECT summary_json
      FROM evaluation_report_lineage
      WHERE tenant_id = ?
      ORDER BY created_at DESC, report_revision DESC
      LIMIT ?
    `).all(this.#tenantId, bounded) as unknown as LineageRow[]
    return cloneFrozen(rows.map(row =>
      JSON.parse(row.summary_json) as EvaluationReportRevisionSummary))
  }

  runs(limit = 100): readonly EvaluationRunSummary[] {
    const bounded = Math.max(1, Math.min(500, Math.floor(limit)))
    const rows = this.#database.db.prepare(`
      SELECT record_json
      FROM evaluation_run_records
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(this.#tenantId, bounded) as unknown as RunRow[]
    return cloneFrozen(rows.map(row => {
      const record = JSON.parse(row.record_json) as PersistedEvaluationRecord
      return {
        evaluationRequestId: record.request.evaluationRequestId,
        state: record.run.state,
        requestedBy: record.request.requestedBy,
        period: record.request.period,
        templatesCompleted: record.run.templatesCompleted,
        templatesTotal: record.run.templatesTotal,
        ...(record.run.datasetHash === undefined
          ? {}
          : { datasetHash: record.run.datasetHash }),
        ...(record.run.reportId === undefined
          ? {}
          : { reportId: record.run.reportId }),
        ...(record.run.failure === undefined
          ? {}
          : { failure: record.run.failure }),
        updatedAt: brand<string, 'IsoDateTime'>(record.updatedAt),
      }
    }))
  }

  async report(
    reportId: PerformanceReportId,
    reportRevision?: number,
  ): Promise<MilitaryPerformanceReport> {
    const row = this.#database.db.prepare(`
      SELECT artifact_ref_json
      FROM evaluation_report_lineage
      WHERE tenant_id = ? AND report_id = ?
        AND (? IS NULL OR report_revision = ?)
      ORDER BY report_revision DESC
      LIMIT 1
    `).get(
      this.#tenantId,
      String(reportId),
      reportRevision ?? null,
      reportRevision ?? null,
    ) as { readonly artifact_ref_json: string } | undefined
    if (row === undefined) throw new MilitaryError('NOT_FOUND')
    const artifact = JSON.parse(row.artifact_ref_json) as ArtifactRef
    const bytes = await this.#artifacts.get(artifact.artifactId)
    if (!await this.#artifacts.verify(artifact)) {
      throw new MilitaryError(
        'EVALUATION_REPORT_MISMATCH',
        'report history artifact failed integrity verification',
      )
    }
    return cloneFrozen(
      JSON.parse(new TextDecoder().decode(bytes)) as MilitaryPerformanceReport,
    )
  }

  supersede(input: {
    readonly previousReportId: PerformanceReportId
    readonly previousRevision: number
    readonly nextReportId: PerformanceReportId
    readonly nextRevision: number
  }): void {
    this.#database.transaction(() => {
      const previous = this.#summary(
        input.previousReportId,
        input.previousRevision,
      )
      const next = this.#summary(input.nextReportId, input.nextRevision)
      if (String(previous.evaluationRequestId)
        === String(next.evaluationRequestId)
        && String(previous.reportId) === String(next.reportId)
        && Number(previous.reportRevision) === Number(next.reportRevision)) {
        throw new MilitaryError('INVALID_ARGUMENT', 'report cannot supersede itself')
      }
      if (
        previous.state === 'SUPERSEDED'
        && previous.supersededByReportId === next.reportId
        && next.state === 'CURRENT'
        && next.supersedesReportId === previous.reportId
      ) {
        return
      }
      if (previous.state !== 'CURRENT') {
        throw new MilitaryError(
          'REVISION_CONFLICT',
          'only the current report revision can be superseded',
        )
      }
      if (
        next.supersedesReportId !== undefined
        && next.supersedesReportId !== previous.reportId
      ) {
        throw new MilitaryError(
          'REVISION_CONFLICT',
          'replacement report already supersedes a different report',
        )
      }
      const previousSummary: EvaluationReportRevisionSummary = {
        ...previous,
        state: 'SUPERSEDED',
        supersededByReportId: next.reportId,
      }
      const nextSummary: EvaluationReportRevisionSummary = {
        ...next,
        state: 'CURRENT',
        supersedesReportId: previous.reportId,
      }
      const changedPrevious = this.#database.db.prepare(`
        UPDATE evaluation_report_lineage
        SET state = 'SUPERSEDED', superseded_by_report_id = ?, summary_json = ?
        WHERE tenant_id = ? AND report_id = ? AND report_revision = ?
          AND state = 'CURRENT'
      `).run(
        String(next.reportId),
        stableJson(previousSummary),
        this.#tenantId,
        String(previous.reportId),
        Number(previous.reportRevision),
      )
      if (Number(changedPrevious.changes) !== 1) {
        throw new MilitaryError('REVISION_CONFLICT')
      }
      this.#database.db.prepare(`
        UPDATE evaluation_report_lineage
        SET state = 'CURRENT', supersedes_report_id = ?, summary_json = ?
        WHERE tenant_id = ? AND report_id = ? AND report_revision = ?
      `).run(
        String(previous.reportId),
        stableJson(nextSummary),
        this.#tenantId,
        String(next.reportId),
        Number(next.reportRevision),
      )
    })
  }

  #summary(
    reportId: PerformanceReportId,
    revision: number,
  ): EvaluationReportRevisionSummary {
    const row = this.#database.db.prepare(`
      SELECT summary_json
      FROM evaluation_report_lineage
      WHERE tenant_id = ? AND report_id = ? AND report_revision = ?
    `).get(
      this.#tenantId,
      String(reportId),
      revision,
    ) as LineageRow | undefined
    if (row === undefined) throw new MilitaryError('NOT_FOUND')
    return JSON.parse(row.summary_json) as EvaluationReportRevisionSummary
  }
}

export function performanceReportId(value: string): PerformanceReportId {
  return brand<string, 'PerformanceReportId'>(value)
}
