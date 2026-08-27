import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  MILITARY_RUNTIME_CONTROL_SCHEMA_VERSION,
  type CandidatePatch,
  type MilitaryRuntimeBudgetView,
  type MilitaryRuntimeCenterSnapshot,
  type MilitaryRuntimeNode,
  type MilitaryRuntimeQueueItem,
  type MilitaryRuntimeReceiptView,
  type WorkflowObligation,
} from '@dsh-military/contracts'
import type {
  RuntimeTaskRecord,
  TaskExecutionLifecycleAggregate,
} from '@dsh-military/core'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import { requireWebAuthority } from './web-authority.js'

const STALE_MS = 15_000

interface StateRow {
  readonly storage_revision: number
  readonly value_json: string
  readonly updated_at: string
}

interface MissionRow {
  readonly mission_id: string
  readonly aggregate_revision: number
  readonly status: string
  readonly updated_at: string
}

interface EventRow {
  readonly mission_id: string
  readonly seq: number
  readonly event_id: string
  readonly event_type: string
  readonly payload_json: string
  readonly occurred_at: string
  readonly correlation_id?: string
}

/** Canonical read model for the independent Military Session runtime centre. */
export class MilitaryRuntimeRemoteService extends TypertRemoteService {
  private readonly state: SqliteStateRecords

  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryRuntime')
    this.state = new SqliteStateRecords(host.database, host.tenantId)
  }

  @Remote
  async snapshot(signal: AbortSignal): Promise<MilitaryRuntimeCenterSnapshot> {
    requireWebAuthority(this.host, 'military.runtime.read')
    signal.throwIfAborted()
    const generated = new Date()
    const generatedAt = generated.toISOString()
    const staleAfter = new Date(generated.getTime() + STALE_MS).toISOString()
    const warnings: string[] = []
    const nodes: MilitaryRuntimeNode[] = []

    const workflows = this.state.listSync<WorkflowObligation>(
      'execution-workflow-obligation',
    )
    const lifecycle = this.state.listSync<TaskExecutionLifecycleAggregate>(
      'execution-task-lifecycle',
    )
    const patches = this.state.listSync<CandidatePatch>(
      'workspace-candidate-patch',
    )
    const missionRows = this.rows<MissionRow>(`
      SELECT mission_id, aggregate_revision, status, updated_at
      FROM mission_streams WHERE tenant_id = ?
      ORDER BY updated_at DESC
    `)
    const taskRows = this.rows<{
      readonly state_json: string
      readonly updated_at: string
    }>(`
      SELECT state_json, updated_at
      FROM mission_runtime_tasks WHERE tenant_id = ?
      ORDER BY updated_at DESC
    `)
    const events = this.rows<EventRow>(`
      SELECT mission_id, seq, event_id, event_type, payload_json,
        occurred_at, correlation_id
      FROM mission_events WHERE tenant_id = ?
      ORDER BY mission_id, seq
    `)

    for (const workflow of workflows) {
      nodes.push({
        id: workflow.obligationId,
        kind: 'REQUEST',
        label: workflow.requestSummary,
        state: `${workflow.state} · ${workflow.stage}`,
        revision: workflow.revision,
        updatedAt: String(workflow.updatedAt),
        ...(workflow.stage === 'SUMMARIZE'
          ? {}
          : { nextTool: workflowStageTool(workflow.stage) }),
        receiptRefs: [],
      })
    }
    for (const mission of missionRows) {
      const parent = workflows.find(value =>
        String(value.missionId ?? '') === mission.mission_id)
      nodes.push({
        id: mission.mission_id,
        kind: 'MISSION',
        ...(parent === undefined ? {} : { parentId: parent.obligationId }),
        label: mission.mission_id,
        state: mission.status,
        revision: mission.aggregate_revision,
        updatedAt: mission.updated_at,
        receiptRefs: events
          .filter(value => value.mission_id === mission.mission_id)
          .slice(-8)
          .map(value => value.event_id),
      })
    }

    const directionNodes = new Map<string, MilitaryRuntimeNode>()
    const waveNodes = new Map<string, MilitaryRuntimeNode>()
    for (const event of events) {
      const payload = parseRecord(event.payload_json)
      if (event.event_type === 'direction/ratified') {
        const id = stringField(payload, 'directionId')
        if (id !== undefined) {
          directionNodes.set(id, {
            id,
            kind: 'DIRECTION',
            parentId: event.mission_id,
            label: id,
            state: 'RATIFIED',
            revision: event.seq,
            updatedAt: event.occurred_at,
            receiptRefs: [event.event_id],
          })
        }
      } else if (event.event_type === 'wave/opened') {
        const id = stringField(payload, 'waveId')
        if (id !== undefined) {
          waveNodes.set(id, {
            id,
            kind: 'WAVE',
            parentId: stringField(payload, 'directionId') ?? event.mission_id,
            label: id,
            state: 'OPEN',
            revision: event.seq,
            updatedAt: event.occurred_at,
            receiptRefs: [event.event_id],
          })
        }
      } else if (event.event_type === 'wave/barrier-satisfied') {
        const id = stringField(payload, 'waveId')
        const current = id === undefined ? undefined : waveNodes.get(id)
        if (id !== undefined) {
          waveNodes.set(id, {
            id,
            kind: 'WAVE',
            parentId: current?.parentId ?? event.mission_id,
            label: id,
            state: 'BARRIER_SATISFIED',
            revision: event.seq,
            updatedAt: event.occurred_at,
            receiptRefs: [...(current?.receiptRefs ?? []), event.event_id],
          })
        }
      }
    }
    nodes.push(...directionNodes.values(), ...waveNodes.values())

    const tasks: Array<{
      readonly task: RuntimeTaskRecord
      readonly updatedAt: string
    }> = []
    for (const row of taskRows) {
      try {
        tasks.push({
          task: JSON.parse(row.state_json) as RuntimeTaskRecord,
          updatedAt: row.updated_at,
        })
      } catch {
        warnings.push('存在无法解析的 canonical Task projection。')
      }
    }
    for (const value of tasks) {
      const task = value.task
      const taskId = String(task.order.taskId)
      nodes.push({
        id: taskId,
        kind: 'TASK',
        parentId: String(task.order.waveId),
        label: task.order.objective,
        state: task.state,
        revision: Number(task.order.taskVersion),
        updatedAt: value.updatedAt ?? task.createdAt ?? generatedAt,
        taskId,
        receiptRefs: [
          ...(task.verification === undefined
            ? []
            : [String(task.verification.receiptId)]),
          ...(task.integration === undefined
            ? []
            : [String(task.integration.integrationReceiptId)]),
        ],
      })
      if (task.candidate !== undefined) {
        nodes.push({
          id: String(task.candidate.candidateId),
          kind: 'CANDIDATE',
          parentId: taskId,
          label: task.candidate.summary,
          state: 'SUBMITTED',
          revision: Number(task.order.taskVersion),
          updatedAt: String(task.candidate.submittedAt),
          taskId,
          attemptId: String(task.candidate.location.attemptId),
          receiptRefs: [
            ...task.candidate.outputs.map(output =>
              String(output.artifactId)),
            ...task.candidate.evidence.map(evidence =>
              evidence.ref),
          ],
        })
      }
      if (task.verification !== undefined) {
        nodes.push({
          id: String(task.verification.receiptId),
          kind: 'VERIFICATION',
          parentId: String(task.verification.candidateId),
          label: '验证回执',
          state: task.verification.disposition,
          revision: Number(task.order.taskVersion),
          updatedAt: value.updatedAt ?? task.createdAt ?? generatedAt,
          taskId,
          receiptRefs: [String(task.verification.receiptId)],
        })
      }
    }

    for (const aggregate of lifecycle) {
      const taskId = String(aggregate.taskId)
      for (const attempt of aggregate.attempts) {
        nodes.push({
          id: attempt.attemptId,
          kind: 'ATTEMPT',
          parentId: taskId,
          label: `Attempt ${attempt.attemptNo} · ${attempt.cause}`,
          state: attempt.state,
          revision: attempt.attemptNo,
          updatedAt: String(attempt.updatedAt),
          taskId,
          attemptId: attempt.attemptId,
          receiptRefs: [],
        })
      }
      for (const activation of aggregate.activations) {
        if (
          (activation.state === 'RUNNING'
            || activation.state === 'STARTING'
            || activation.state === 'WAITING')
          && activation.heartbeatExpiresAt !== undefined
          && Date.parse(String(activation.heartbeatExpiresAt))
            <= generated.getTime()
        ) {
          warnings.push(
            `Activation ${activation.activationId} heartbeat 已过期，等待恢复对账。`,
          )
        }
        nodes.push({
          id: activation.activationId,
          kind: 'ACTIVATION',
          parentId: activation.attemptId,
          label: activation.agent === undefined
            ? '尚未绑定 Agent'
            : String(activation.agent.agentId),
          state: activation.state,
          revision: activation.currentDispatchSequence,
          updatedAt: String(activation.updatedAt),
          taskId,
          attemptId: activation.attemptId,
          receiptRefs: activation.settlementReceiptId === undefined
            ? activation.heartbeatSequence === undefined
              ? []
              : [
                  `activation-heartbeat:${activation.activationId}:${activation.heartbeatSequence}`,
                ]
            : [activation.settlementReceiptId],
        })
      }
      for (const dispatch of aggregate.dispatches) {
        nodes.push({
          id: dispatch.dispatchId,
          kind: 'DISPATCH',
          parentId: dispatch.activationId,
          label: `Dispatch ${dispatch.sequence}`,
          state: dispatch.state,
          revision: dispatch.sequence,
          updatedAt: String(dispatch.updatedAt),
          taskId,
          attemptId: dispatch.attemptId,
          receiptRefs: [
            ...(dispatch.transportReceiptId === undefined
              ? []
              : [dispatch.transportReceiptId]),
            ...(dispatch.settlementReceiptId === undefined
              ? []
              : [dispatch.settlementReceiptId]),
          ],
        })
      }
    }

    for (const patch of patches) {
      const candidateExists = nodes.some(node =>
        node.kind === 'CANDIDATE' && node.id === patch.candidateId)
      nodes.push({
        id: patch.candidatePatchId,
        kind: 'CANDIDATE',
        parentId: candidateExists ? patch.candidateId : patch.taskId,
        label: `${patch.applyMode} · ${patch.changedPaths.length} paths`,
        state: 'SUBMITTED',
        revision: patch.taskVersion,
        updatedAt: String(patch.createdAt),
        taskId: patch.taskId,
        receiptRefs: [String(patch.patchArtifact.artifactId)],
      })
    }
    this.integrationNodes(nodes)

    const queues = this.queueItems()
    const budgets = this.budgetViews()
    const receipts = this.receiptViews(events)
    const outbox = this.outboxView()
    const sourceRevision = sourceRevisionOf(
      missionRows,
      this.stateRows(),
      events,
    )
    return {
      schemaVersion: MILITARY_RUNTIME_CONTROL_SCHEMA_VERSION,
      authority: this.host.webPrincipal,
      projection: {
        sourceRevision,
        generatedAt,
        staleAfter,
        health: warnings.length === 0 ? 'FRESH' : 'DEGRADED',
        warnings,
      },
      nodes: nodes.sort(compareNodes),
      queues,
      budgets,
      receipts,
      outbox,
    }
  }

  private integrationNodes(nodes: MilitaryRuntimeNode[]): void {
    const rows = this.rows<{
      readonly integration_order_id: string
      readonly task_id: string
      readonly task_version: number
      readonly state: string
      readonly updated_at: string
      readonly payload_json: string
    }>(`
      SELECT integration_order_id, task_id, task_version, state,
        updated_at, payload_json
      FROM integration_orders WHERE tenant_id = ?
      ORDER BY updated_at
    `)
    for (const row of rows) {
      const record = parseRecord(row.payload_json)
      const order = asRecord(record.order)
      const receipt = record.receipt
      nodes.push({
        id: row.integration_order_id,
        kind: 'INTEGRATION',
        parentId: typeof order?.candidatePatchId === 'string'
          ? order.candidatePatchId
          : row.task_id,
        label: row.integration_order_id,
        state: isRecord(receipt)
          ? String(receipt.disposition ?? row.state)
          : row.state,
        revision: row.task_version,
        updatedAt: row.updated_at,
        taskId: row.task_id,
        receiptRefs: isRecord(receipt)
          && typeof receipt.integrationReceiptId === 'string'
          ? [receipt.integrationReceiptId]
          : [],
      })
    }
  }

  private queueItems(): readonly MilitaryRuntimeQueueItem[] {
    const radio = this.state.readSync<{
      readonly entries?: Readonly<Record<string, {
        readonly state?: string
        readonly request?: unknown
        readonly guidance?: unknown
      }>>
    }>('radio', 'state')
    const decisions = this.state.readSync<{
      readonly records?: Readonly<Record<string, {
        readonly record?: unknown
      }>>
    }>('decision-broker', 'state')
    const result: MilitaryRuntimeQueueItem[] = []
    for (const [id, entry] of Object.entries(radio?.entries ?? {})) {
      const request = asRecord(entry.request)
      const location = asRecord(request?.location)
      result.push({
        id,
        kind: 'RADIO',
        missionId: String(location?.missionId ?? 'unbound'),
        ...(location?.taskId === undefined
          ? {}
          : { taskId: String(location.taskId) }),
        ...(location?.attemptId === undefined
          ? {}
          : { attemptId: String(location.attemptId) }),
        state: String(entry.state ?? 'UNKNOWN'),
        updatedAt: String(
          asRecord(entry.guidance)?.createdAt
          ?? request?.createdAt
          ?? '1970-01-01T00:00:00.000Z',
        ),
        ...(request?.expiresAt === undefined
          ? {}
          : { expiresAt: String(request.expiresAt) }),
      })
    }
    for (const [id, stored] of Object.entries(decisions?.records ?? {})) {
      const value = asRecord(stored.record)
      if (value === undefined) continue
      result.push({
        id,
        kind: 'DECISION',
        missionId: String(value.missionId ?? 'unbound'),
        ...(value.taskId === undefined ? {} : { taskId: String(value.taskId) }),
        ...(value.attemptId === undefined
          ? {}
          : { attemptId: String(value.attemptId) }),
        state: String(value.state ?? 'UNKNOWN'),
        ...(value.priority === undefined
          ? {}
          : { priority: String(value.priority) }),
        updatedAt: String(value.updatedAt ?? '1970-01-01T00:00:00.000Z'),
        ...(value.expiresAt === undefined
          ? {}
          : { expiresAt: String(value.expiresAt) }),
      })
    }
    return result.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt))
  }

  private budgetViews(): readonly MilitaryRuntimeBudgetView[] {
    const value = this.state.readSync<{
      readonly scopes?: Readonly<Record<string, {
        readonly consumed?: Readonly<Record<string, number>>
        readonly reserved?: Readonly<Record<string, number>>
      }>>
    }>('resource-budget', 'state')
    return Object.entries(value?.scopes ?? {}).map(([scope, budget]) => ({
      scope,
      consumed: budget.consumed ?? {},
      reserved: budget.reserved ?? {},
      status: 'AVAILABLE' as const,
    })).sort((left, right) => left.scope.localeCompare(right.scope))
  }

  private receiptViews(
    events: readonly EventRow[],
  ): readonly MilitaryRuntimeReceiptView[] {
    const eventReceipts = events.slice(-120).map(event => ({
      id: event.event_id,
      kind: event.event_type,
      state: 'RECORDED',
      updatedAt: event.occurred_at,
      ...(event.correlation_id === undefined
        ? {}
        : { correlationId: event.correlation_id }),
    }))
    const deliveries = this.rows<{
      readonly event_id: string
      readonly topic: string
      readonly delivered_at: string
    }>(`
      SELECT event_id, topic, delivered_at
      FROM outbox_delivery_receipts
      WHERE tenant_id = ?
      ORDER BY delivered_at DESC LIMIT 120
    `).map(value => ({
      id: value.event_id,
      kind: `outbox:${value.topic}`,
      state: 'DELIVERED',
      updatedAt: value.delivered_at,
    }))
    return [...eventReceipts, ...deliveries]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 160)
  }

  private outboxView(): MilitaryRuntimeCenterSnapshot['outbox'] {
    const row = this.host.database.db.prepare(`
      SELECT
        SUM(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL
          THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL
          AND claimed_until IS NOT NULL THEN 1 ELSE 0 END) AS claimed,
        SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END)
          AS dead_lettered,
        MIN(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL
          THEN available_at ELSE NULL END) AS oldest
      FROM transactional_outbox WHERE tenant_id = ?
    `).get(this.host.tenantId) as {
      readonly pending?: number
      readonly claimed?: number
      readonly dead_lettered?: number
      readonly oldest?: string
    } | undefined
    return {
      pending: Number(row?.pending ?? 0),
      claimed: Number(row?.claimed ?? 0),
      deadLettered: Number(row?.dead_lettered ?? 0),
      ...(row?.oldest === undefined || row.oldest === null
        ? {}
        : { oldestPendingAt: String(row.oldest) }),
    }
  }

  private stateRows(): readonly StateRow[] {
    return this.rows<StateRow>(`
      SELECT storage_revision, value_json, updated_at
      FROM durable_state_records WHERE tenant_id = ?
      ORDER BY namespace, record_key
    `)
  }

  private rows<T>(sql: string): readonly T[] {
    return this.host.database.db.prepare(sql)
      .all(this.host.tenantId) as unknown as readonly T[]
  }
}

function workflowStageTool(stage: WorkflowObligation['stage']): string {
  const tools: Record<WorkflowObligation['stage'], string> = {
    START_MISSION: 'military_start_mission',
    CREATE_TASK: 'military_create_task',
    READ_DEPARTMENT_STATUS: 'military_read_department_status',
    SPAWN_DEPARTMENT: 'military_spawn_department',
    POLL_TACTICAL_REQUEST: 'military_poll_tactical_request',
    ISSUE_TACTICAL_GUIDANCE: 'military_issue_tactical_guidance',
    PRESENT_DECISION: 'military_present_decision',
    ASK_USER_DECISION: 'ask_user',
    RECORD_DECISION: 'military_record_decision',
    WAIT_FOR_SETTLEMENT: 'military_read_department_status',
    VERIFY_AND_INTEGRATE: 'military_read_department_status',
    SUMMARIZE: 'report',
  }
  return tools[stage]
}

function sourceRevisionOf(
  missions: readonly MissionRow[],
  states: readonly StateRow[],
  events: readonly EventRow[],
): number {
  return missions.reduce((sum, value) => sum + value.aggregate_revision, 0)
    + states.reduce((sum, value) => sum + value.storage_revision, 0)
    + events.length
}

function compareNodes(
  left: MilitaryRuntimeNode,
  right: MilitaryRuntimeNode,
): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = safeParse(value)
  return isRecord(parsed) ? parsed : {}
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  return typeof value[field] === 'string' ? value[field] : undefined
}

function recordPath(
  value: unknown,
  parent: string,
  child: string,
): unknown {
  const record = asRecord(value)
  return asRecord(record?.[parent])?.[child]
}
