import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  MilitaryError,
  brand,
  type EvaluationCenterSnapshot,
  type EvaluationRequestId,
  type PerformanceEvaluationAppeal,
  type PerformanceEvaluationRequest,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import {
  SqliteEvaluationHistory,
  performanceReportId,
} from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'

const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

/** User-facing decision centre over durable evaluation jobs and report lineage. */
export class MilitaryEvaluationRemoteService extends TypertRemoteService {
  /**
   * RC.2 Typert invokes Remote methods through a Cordis service proxy
   * receiver. Keep this as an ordinary TypeScript-private member: native
   * ECMAScript private branding would reject that proxy receiver.
   */
  private readonly history: SqliteEvaluationHistory

  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryEvaluationCenter')
    this.history = new SqliteEvaluationHistory(
      host.database,
      host.tenantId,
      host.application.artifacts,
    )
  }

  @Remote
  async snapshot(signal: AbortSignal): Promise<EvaluationCenterSnapshot> {
    signal.throwIfAborted()
    const reports = this.history.list(200)
    const appeals = new Map<string, PerformanceEvaluationAppeal>()
    for (const reportId of new Set(reports.map(value =>
      String(value.reportId)))) {
      for (const appeal of await this.host.application.evaluationAppeals.list(
        reportId,
      )) appeals.set(appeal.appealId, appeal)
    }
    const latest = reports.find(value => value.state === 'CURRENT')
      ?? reports[0]
    const latestReport = latest === undefined
      ? null
      : await this.history.report(
          latest.reportId,
          Number(latest.reportRevision),
        )
    return {
      schemaVersion: '1.0.0',
      runs: this.history.runs(200),
      reports,
      appeals: [...appeals.values()].sort((left, right) =>
        String(right.submittedAt).localeCompare(String(left.submittedAt))),
      latestReport,
      catalog: this.catalog(),
      generatedAt: brand<string, 'IsoDateTime'>(new Date().toISOString()),
    }
  }

  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const value = asRecord(action, 'evaluation action')
    const type = requiredText(value.type, 'type', 64)
    const operationId = operationIdentifier(value.operationId)
    switch (type) {
      case 'GET_REPORT':
        return await this.history.report(
          performanceReportId(requiredText(value.reportId, 'reportId', 180)),
          optionalPositiveInteger(value.reportRevision),
        )
      case 'GET_DATASET': {
        const report = await this.history.report(
          performanceReportId(requiredText(value.reportId, 'reportId', 180)),
          optionalPositiveInteger(value.reportRevision),
        )
        const frozen = await this.host.application.evaluationDataset.get(
          report.evaluationRequestId,
        )
        if (
          frozen === null
          || !await this.host.application.evaluationDataset.verify(
            frozen.manifest,
          )
        ) {
          throw new MilitaryError(
            'EVALUATION_DATASET_INCOMPLETE',
            'report dataset is unavailable or failed integrity verification',
          )
        }
        return frozen
      }
      case 'CANCEL_RUN': {
        const evaluationRequestId = brand<string, 'EvaluationRequestId'>(
          requiredText(value.evaluationRequestId, 'evaluationRequestId', 180),
        )
        await this.host.application.evaluation.cancel(evaluationRequestId)
        return await this.host.application.evaluation.get(evaluationRequestId)
      }
      case 'RETRY_RUN': {
        const evaluationRequestId = brand<string, 'EvaluationRequestId'>(
          requiredText(value.evaluationRequestId, 'evaluationRequestId', 180),
        )
        const run = await this.host.application.evaluation.get(
          evaluationRequestId,
        )
        if (run.state !== 'FAILED') {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            'only a FAILED evaluation job can be retried',
          )
        }
        return await this.host.application.evaluation.execute(
          evaluationRequestId,
          signal,
        )
      }
      case 'SUBMIT_APPEAL':
        return await this.submitAppeal(value, operationId)
      case 'WITHDRAW_APPEAL':
        return await this.host.application.evaluationAppeals.withdraw(
          requiredText(value.appealId, 'appealId', 180),
          'settings:web-user',
        )
      case 'DENY_APPEAL':
        return await this.denyAppeal(value)
      case 'RECOMPUTE_AND_SUPERSEDE':
        return await this.recompute(value, signal)
      default:
        throw new TypeError(`unknown evaluation action ${type}`)
    }
  }

  private async submitAppeal(
    value: Record<string, unknown>,
    operationId: string,
  ): Promise<PerformanceEvaluationAppeal> {
    const reportId = requiredText(value.reportId, 'reportId', 180)
    const reportRevision = requiredPositiveInteger(
      value.reportRevision,
      'reportRevision',
    )
    const report = await this.history.report(
      performanceReportId(reportId),
      reportRevision,
    )
    const statement = requiredText(value.statement, 'statement', 4_000)
    const grounds = appealGrounds(value.grounds)
    const requestedRemedy = appealRemedy(value.requestedRemedy)
    const excludedAttemptIds = optionalStringArray(
      value.excludedAttemptIds,
      'excludedAttemptIds',
      200,
    )
    const suppliedEvidenceRefs = optionalStringArray(
      value.evidenceRefs,
      'evidenceRefs',
      100,
    )
    const appealId = `evaluation-appeal-${sha256(stableJson({
      operationId,
      reportId,
      reportRevision,
      grounds,
      requestedRemedy,
      statement,
    })).slice(0, 32)}`
    const appeal: PerformanceEvaluationAppeal = {
      schemaVersion: '1.0.0',
      appealId,
      reportId,
      reportRevision: brand<number, 'Revision'>(reportRevision),
      tenantId: this.host.tenantId,
      submittedBy: 'settings:web-user',
      grounds,
      statement,
      challengedFindings: [
        {
          path: requiredText(
            value.findingPath ?? '/decision',
            'findingPath',
            500,
          ),
          reason: statement,
          evidenceRefs: [
            `dataset:${String(report.datasetHash)}`,
            `report:${reportId}@${reportRevision}`,
            ...suppliedEvidenceRefs,
          ],
        },
        ...excludedAttemptIds.map(attemptId => ({
          path: `/attempts/${encodeURIComponent(attemptId)}`,
          reason: statement,
          evidenceRefs: [
            `attempt:${attemptId}`,
            `dataset:${String(report.datasetHash)}`,
            ...suppliedEvidenceRefs,
          ],
        })),
      ],
      requestedRemedy,
      authorizationReceiptRef: `ui-confirmation:${operationId}`,
      state: 'SUBMITTED',
      submittedAt: brand<string, 'IsoDateTime'>(new Date().toISOString()),
    }
    await this.host.application.evaluationAppeals.submit(appeal)
    return await this.host.application.evaluationAppeals.get(appealId)
  }

  private async denyAppeal(
    value: Record<string, unknown>,
  ): Promise<PerformanceEvaluationAppeal> {
    const appeal = await this.host.application.evaluationAppeals.get(
      requiredText(value.appealId, 'appealId', 180),
    )
    if (appeal.state !== 'SUBMITTED' && appeal.state !== 'UNDER_REVIEW') {
      return appeal
    }
    return await this.host.application.evaluationAppeals.resolve({
      appealId: appeal.appealId,
      expectedState: appeal.state,
      disposition: 'DENIED',
      resolutionSummary: requiredText(
        value.resolutionSummary,
        'resolutionSummary',
        4_000,
      ),
    })
  }

  private async recompute(
    value: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{
    readonly appeal: PerformanceEvaluationAppeal
    readonly report: Awaited<ReturnType<MilitaryHostRuntime['application']['evaluation']['execute']>>
  }> {
    const appeal = await this.host.application.evaluationAppeals.get(
      requiredText(value.appealId, 'appealId', 180),
    )
    if (appeal.state === 'UPHELD' || appeal.state === 'PARTIALLY_UPHELD') {
      if (appeal.supersedingReportId === undefined) {
        throw new MilitaryError(
          'EVALUATION_REPORT_MISMATCH',
          'resolved appeal has no superseding report',
        )
      }
      return {
        appeal,
        report: await this.history.report(
          performanceReportId(appeal.supersedingReportId),
        ),
      }
    }
    if (appeal.state !== 'SUBMITTED' && appeal.state !== 'UNDER_REVIEW') {
      throw new MilitaryError('REVISION_CONFLICT', 'appeal is not reviewable')
    }
    const previous = await this.history.report(
      performanceReportId(appeal.reportId),
      Number(appeal.reportRevision),
    )
    const original = this.request(previous.evaluationRequestId)
    const evaluationRequestId = brand<string, 'EvaluationRequestId'>(
      `appeal-evaluation-${sha256(stableJson({
        appealId: appeal.appealId,
        previousDataset: String(previous.datasetHash),
      })).slice(0, 32)}`,
    )
    const timestamp = brand<string, 'IsoDateTime'>(new Date().toISOString())
    const request: PerformanceEvaluationRequest = {
      ...original,
      filters: {
        ...original.filters,
        excludedAttemptIds: [
          ...new Set([
            ...(original.filters.excludedAttemptIds ?? []),
            ...appeal.challengedFindings.flatMap(finding =>
              attemptIdFromFinding(finding.path)),
          ]),
        ].sort(),
      },
      evaluationRequestId,
      requestedBy: 'settings:appeal-recompute',
      createdAt: timestamp,
      // Stable across UI retries and process crashes. operationId proves this
      // click's confirmation, but must not manufacture another report.
      idempotencyKey: `appeal-recompute:${appeal.appealId}`,
    }
    await this.host.application.evaluation.request(request)
    const report = await this.host.application.evaluation.execute(
      evaluationRequestId,
      signal,
    )
    this.history.supersede({
      previousReportId: previous.reportId,
      previousRevision: Number(previous.reportRevision),
      nextReportId: report.reportId,
      nextRevision: Number(report.reportRevision),
    })
    const resolved = await this.host.application.evaluationAppeals.resolve({
      appealId: appeal.appealId,
      expectedState: appeal.state,
      disposition: 'UPHELD',
      resolutionSummary: requiredText(
        value.resolutionSummary
          ?? '已按冻结请求重新构建数据集、复算指标并发布替代报告。',
        'resolutionSummary',
        4_000,
      ),
      supersedingReportId: String(report.reportId),
    })
    return { appeal: resolved, report }
  }

  private request(evaluationRequestId: EvaluationRequestId): PerformanceEvaluationRequest {
    const row = this.host.database.db.prepare(`
      SELECT request_json
      FROM evaluation_jobs
      WHERE tenant_id = ? AND evaluation_request_id = ?
    `).get(
      this.host.tenantId,
      String(evaluationRequestId),
    ) as { readonly request_json: string } | undefined
    if (row === undefined) throw new MilitaryError('NOT_FOUND')
    return JSON.parse(row.request_json) as PerformanceEvaluationRequest
  }

  private catalog(): EvaluationCenterSnapshot['catalog'] {
    const workspaceRows = this.host.database.db.prepare(`
      SELECT session_id, binding_json
      FROM military_session_bindings
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(this.host.tenantId) as unknown as Array<{
      readonly session_id: string
      readonly binding_json: string
    }>
    const workspaces = new Map<string, Set<string>>()
    for (const row of workspaceRows) {
      const binding = JSON.parse(row.binding_json) as Record<string, unknown>
      if (typeof binding.workspaceKey !== 'string') continue
      const sessions = workspaces.get(binding.workspaceKey) ?? new Set<string>()
      sessions.add(row.session_id)
      workspaces.set(binding.workspaceKey, sessions)
    }
    const missionRows = this.host.database.db.prepare(`
      SELECT mission_id, MAX(occurred_at) AS updated_at
      FROM mission_events
      WHERE tenant_id = ?
      GROUP BY mission_id
      ORDER BY updated_at DESC
      LIMIT 500
    `).all(this.host.tenantId) as unknown as Array<{
      readonly mission_id: string
      readonly updated_at: string
    }>
    return {
      workspaces: [...workspaces.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([workspaceKey, sessions]) => ({
          workspaceKey,
          label: workspaceLabel(workspaceKey),
          sessionCount: sessions.size,
        })),
      missions: missionRows.map(row => ({
        missionId: row.mission_id,
        label: shortIdentifier(row.mission_id),
        updatedAt: brand<string, 'IsoDateTime'>(row.updated_at),
      })),
    }
  }
}

function appealGrounds(
  value: unknown,
): PerformanceEvaluationAppeal['grounds'] {
  if (
    value === 'DATASET_ERROR'
    || value === 'RUBRIC_ERROR'
    || value === 'ATTRIBUTION_ERROR'
    || value === 'MISSING_CONTEXT'
    || value === 'OTHER'
  ) return value
  throw new TypeError('grounds is invalid')
}

function appealRemedy(
  value: unknown,
): PerformanceEvaluationAppeal['requestedRemedy'] {
  if (
    value === 'RECOMPUTE_DATASET'
    || value === 'RE_EVALUATE_TEMPLATE'
    || value === 'RE_SYNTHESIZE_REPORT'
    || value === 'ANNOTATE_REPORT'
    || value === 'NO_CHANGE_REVIEW'
  ) return value
  throw new TypeError('requestedRemedy is invalid')
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > maximum
  ) throw new TypeError(`${label} must contain 1-${maximum} characters`)
  return value.trim()
}

function operationIdentifier(value: unknown): string {
  const result = requiredText(value, 'operationId', 128)
  if (!ACTION_ID.test(result)) {
    throw new TypeError('operationId contains unsupported characters')
  }
  return result
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return Number(value)
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return value === undefined
    ? undefined
    : requiredPositiveInteger(value, 'reportRevision')
}

function optionalStringArray(
  value: unknown,
  label: string,
  maximumItems: number,
): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} must be an array of at most ${maximumItems} values`)
  }
  return [...new Set(value.map((item, index) =>
    requiredText(item, `${label}[${index}]`, 500)))].sort()
}

function attemptIdFromFinding(path: string): readonly string[] {
  const prefix = '/attempts/'
  if (!path.startsWith(prefix)) return []
  try {
    const attemptId = decodeURIComponent(path.slice(prefix.length))
    return attemptId.trim().length === 0 ? [] : [attemptId]
  } catch {
    throw new TypeError('appeal attempt path is malformed')
  }
}

function workspaceLabel(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '')
  const last = normalized.split('/').filter(Boolean).at(-1)
  return last === undefined ? 'Military 工作区' : last.slice(0, 120)
}

function shortIdentifier(value: string): string {
  return value.length <= 28
    ? value
    : `${value.slice(0, 14)}…${value.slice(-10)}`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryEvaluationCenter: MilitaryEvaluationRemoteService
  }
}
