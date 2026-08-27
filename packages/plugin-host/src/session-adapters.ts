import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compaction'
import type {
  SessionEvent,
  SessionId as DshSessionId,
} from '@deepseek-ai/dsh-session'
import {
  MilitaryError,
  TERMINAL_TOOL_NAMES,
  brand,
  type AgentExecutionBinding,
  type EvaluationAttemptRecord,
  type EvaluationFailureStage,
  type EvaluationMissingReason,
  type PerformanceEvaluationRequest,
  type TaskComplexityVector,
  type TaskOrder,
} from '@dsh-military/contracts'
import {
  sha256,
  stableJson,
  type EvaluationDataCollection,
  type EvaluationDataSource,
} from '@dsh-military/core'
import {
  SqliteStateRecords,
  type SqliteMilitaryDatabase,
} from '@dsh-military/storage-sqlite'
import type { SessionSourceReader } from '@dsh-military/runtime'
import {
  ROLE_REVISION_USE_NAMESPACE,
  type RoleRevisionUseRecord,
} from './role-usage.js'

interface PersistenceLike {
  inspect(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly meta: Record<string, unknown>
    readonly events: readonly SessionEvent[]
  }>
}

interface MissionEventRow {
  readonly seq: number
  readonly eventId: string
  readonly type: string
  readonly actor: Record<string, unknown>
  readonly payload: Record<string, unknown>
  readonly occurredAt: string
}

interface SessionSnapshot {
  readonly meta: Record<string, unknown>
  readonly events: readonly SessionEvent[]
}

interface SessionMetrics {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly exactRouteObserved: boolean
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly modelSteps: number
  readonly toolCalls: number
  readonly correctionCount: number
  readonly queueLatencyMs: number
  readonly modelLatencyMs: number
  readonly toolLatencyMs: number
  readonly totalLatencyMs: number
  readonly fallbackCount: number
  readonly retryCount: number
  readonly compactionAttempts: number
  readonly compactionSuccesses: number
  readonly successfulTerminalCall: boolean
  readonly terminalDuplicate: boolean
  readonly recoveryAttempted: boolean
  readonly recoverySucceeded: boolean
  readonly recoveryDrift: boolean
  readonly failure: {
    readonly stage: EvaluationFailureStage
    readonly code?: string
  }
  readonly evidenceRefs: EvaluationAttemptRecord['evidenceRefs']
}

/** Reads live sessions first, then the RC.2 session-persistence seam. */
export class DshSessionSourceReader implements SessionSourceReader {
  readonly #ctx: Context

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  async read(input: {
    readonly sessionId: string
    readonly startSeq?: number
    readonly endSeq?: number
    readonly includeToolResults: boolean
  }): Promise<Uint8Array> {
    const live = this.#ctx.agents?.get(input.sessionId as DshSessionId)
    const snapshot = live === undefined
      ? await this.#inspectCold(input.sessionId)
      : {
          meta: live.session.header as unknown as Record<string, unknown>,
          events: live.session.events,
        }
    const selected = snapshot.events.filter(event =>
      (input.startSeq === undefined || event.seq >= input.startSeq)
      && (input.endSeq === undefined || event.seq <= input.endSeq)
      && (input.includeToolResults || event.type !== 'tool/result'))
    return new TextEncoder().encode(JSON.stringify({
      header: snapshot.meta,
      events: selected,
    }, null, 2))
  }

  async #inspectCold(sessionId: string): Promise<SessionSnapshot> {
    const persistence = asPersistence(this.#ctx.sessionPersistence)
    if (persistence === undefined) {
      throw new MilitaryError(
        'NOT_FOUND',
        'session is not live and RC.2 session persistence is unavailable',
      )
    }
    return await persistence.inspect(sessionId)
  }
}

/**
 * Reconstructs immutable Task Attempts from exact lease/version windows.
 *
 * Outcome events are never allowed to cross a Task version fence. Session
 * prose and child self-reports supply diagnostics only; acceptance and
 * integration must be present in the Military ledger.
 */
export class DshEvaluationObservationSource implements EvaluationDataSource {
  readonly #ctx: Context
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  readonly #sessionCache = new Map<string, Promise<SessionSnapshot | null>>()

  constructor(
    ctx: Context,
    database: SqliteMilitaryDatabase,
    tenantId: string,
  ) {
    this.#ctx = ctx
    this.#database = database
    this.#tenantId = tenantId
  }

  async collect(
    request: PerformanceEvaluationRequest,
    signal: AbortSignal,
  ): Promise<EvaluationDataCollection> {
    signal.throwIfAborted()
    // A dataset build is one immutable observation pass. Never reuse live
    // Session snapshots captured by an earlier request.
    this.#sessionCache.clear()
    const from = Date.parse(String(request.period.from))
    const to = Date.parse(String(request.period.to))
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      throw new MilitaryError('INVALID_ARGUMENT', 'evaluation period is invalid')
    }

    const attempts: EvaluationAttemptRecord[] = []
    const includedSessions = new Map<string, {
      readonly sessionId: string
      readonly rootSessionId: string
      readonly templateIds: Set<string>
      readonly inclusionReason: string
    }>()
    const excludedSessions = new Map<string, {
      readonly sessionId: string
      readonly reasonCode: string
      readonly details: string
    }>()
    const missing = new Map<string, {
      field: string
      count: number
      mechanism: 'MCAR' | 'MAR' | 'MNAR' | 'UNKNOWN'
    }>()
    const sourceArtifactRefs = new Set<string>()
    const roleUses = new SqliteStateRecords(this.#database, this.#tenantId)
      .listSync<RoleRevisionUseRecord>(ROLE_REVISION_USE_NAMESPACE)

    for (const binding of this.#bindings()) {
      signal.throwIfAborted()
      if (!matchesBindingFilters(request, binding)) continue
      const workspaceKey = this.#workspaceKey(binding.rootSessionId)
      if (
        request.filters.workspaceKeys.length > 0
        && !request.filters.workspaceKeys.includes(workspaceKey)
      ) continue

      const missionEvents = this.#events(binding.missionId, to)
      const leases = missionEvents.filter(event =>
        event.type === 'task/leased'
        && eventTime(event) >= from
        && eventTime(event) <= to
        && sameActor(event.payload, binding)
        && matchesBoundTask(event.payload, binding))
      if (leases.length === 0) continue

      const snapshot = await this.#session(binding.agent.sessionId, signal)
      if (snapshot === null) {
        excludedSessions.set(String(binding.agent.sessionId), {
          sessionId: String(binding.agent.sessionId),
          reasonCode: 'SESSION_NOT_MATERIALIZED',
          details: 'neither live nor readable through RC.2 session persistence',
        })
        incrementMissing(missing, 'session-events', 'UNKNOWN')
      } else {
        const current = includedSessions.get(String(binding.agent.sessionId)) ?? {
          sessionId: String(binding.agent.sessionId),
          rootSessionId: binding.rootSessionId,
          templateIds: new Set<string>(),
          inclusionReason: this.#ctx.agents?.get(
            String(binding.agent.sessionId) as DshSessionId,
          ) === undefined
            ? 'durable Military execution binding and cold RC.2 Session'
            : 'durable Military execution binding and live RC.2 Session',
        }
        current.templateIds.add(binding.templateId)
        includedSessions.set(current.sessionId, current)
      }

      for (const lease of leases) {
        signal.throwIfAborted()
        const taskId = stringField(lease.payload, 'taskId')
        const taskVersion = positiveInteger(lease.payload.taskVersion, 1)
        const nextLease = missionEvents.find(event =>
          event.seq > lease.seq
          && event.type === 'task/leased'
          && stringField(event.payload, 'taskId') === taskId)
        const endSeq = nextLease?.seq ?? Number.POSITIVE_INFINITY
        const taskEvents = missionEvents.filter(event =>
          event.seq >= lease.seq
          && event.seq < endSeq
          && belongsToAttempt(event, taskId, taskVersion))
        const completedAt = attemptCompletedAt(taskEvents)
        const leaseAt = eventTime(lease)
        const leaseBoundary = nextLease === undefined ? to : eventTime(nextLease)
        const attemptEnd = completedAt === undefined
          ? leaseBoundary
          : Date.parse(completedAt)
        const sessionEvents = snapshot === null
          ? []
          : selectEvaluationSessionEvents(
              snapshot.events,
              leaseAt,
              attemptEnd,
            )
        const metrics = inspectSession(
          sessionEvents,
          binding,
          leaseAt,
        )
        const order = this.#taskOrder(taskId, taskVersion)
        if (order === null) incrementMissing(missing, 'task-order', 'MAR')
        const configuration = configurationFor(
          binding,
          roleUses,
          metrics,
          lease.occurredAt,
          new Date(attemptEnd).toISOString(),
          this.#bundleVersion(binding.presetGeneration),
        )
        const parentWakeup = await this.#parentWakeup(
          binding.rootSessionId,
          binding.agent.sessionId,
          completedAt === undefined ? leaseAt : Date.parse(completedAt),
          leaseBoundary,
          signal,
        )
        const outcome = attemptOutcome(
          taskEvents,
          binding,
          metrics,
          parentWakeup,
        )
        const missingReason = missingReasonFor(
          taskEvents,
          snapshot,
          outcome.completed,
          metrics.failure,
        )
        const attributed = attemptFailure(
          taskEvents,
          metrics.failure,
          outcome,
          order,
        )
        const failure = {
          ...attributed,
          ...(missingReason === undefined ? {} : { missingReason }),
        }
        if (missingReason !== undefined) {
          incrementMissing(
            missing,
            `attempt:${missingReason.toLowerCase()}`,
            missingMechanism(missingReason),
          )
        }
        const record: EvaluationAttemptRecord = {
          schemaVersion: '1.0.0',
          attemptId: [
            this.#tenantId,
            binding.rootSessionId,
            String(binding.missionId),
            `${taskId}@${taskVersion}`,
            `${String(binding.agent.agentId)}@${binding.agent.generation}`,
            `lease-${lease.seq}`,
          ].join('/'),
          identity: {
            rootSessionId: binding.rootSessionId,
            sessionId: String(binding.agent.sessionId),
            missionId: String(binding.missionId),
            workspaceKey,
            taskId,
            taskVersion,
            agentId: String(binding.agent.agentId),
            agentGeneration: binding.agent.generation,
            leaseSeq: lease.seq,
          },
          configuration,
          task: taskSnapshot(order),
          outcome,
          usage: {
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            reasoningTokens: metrics.reasoningTokens,
            modelSteps: metrics.modelSteps,
            toolCalls: metrics.toolCalls,
            correctionCount: metrics.correctionCount,
            queueLatencyMs: metrics.queueLatencyMs,
            modelLatencyMs: metrics.modelLatencyMs,
            toolLatencyMs: metrics.toolLatencyMs,
            verificationLatencyMs: verificationLatency(taskEvents),
            totalLatencyMs: Math.max(
              metrics.totalLatencyMs,
              Math.max(0, (Date.parse(completedAt ?? lease.occurredAt)
                - eventTime(lease))),
            ),
            fallbackCount: metrics.fallbackCount
              + taskEvents.filter(value => value.type === 'model/fallback').length,
            retryCount: metrics.retryCount,
            compactionAttempts: metrics.compactionAttempts,
            compactionSuccesses: metrics.compactionSuccesses,
            costStatus: 'PROVIDER_PRICING_UNAVAILABLE',
          },
          failure,
          evidenceRefs: [
            {
              kind: 'event',
              ref: `mission-event:${lease.eventId}`,
              claim: `Attempt lease ${taskId}@${taskVersion}`,
            },
            ...taskEvents
              .filter(value => value.seq !== lease.seq)
              .map(value => ({
                kind: 'event' as const,
                ref: `mission-event:${value.eventId}`,
                claim: `Attempt outcome ${value.type}`,
              })),
            ...metrics.evidenceRefs,
          ],
          startedAt: brand<string, 'IsoDateTime'>(lease.occurredAt),
          ...(completedAt === undefined
            ? {}
            : { completedAt: brand<string, 'IsoDateTime'>(completedAt) }),
        }
        if (!request.filters.includeIncompleteSessions && !record.outcome.completed) {
          continue
        }
        attempts.push(record)
        sourceArtifactRefs.add(`session:${record.identity.sessionId}`)
        for (const evidence of record.evidenceRefs) {
          if (evidence.kind === 'event') sourceArtifactRefs.add(evidence.ref)
        }
      }
    }

    return {
      attempts,
      includedSessions: [...includedSessions.values()]
        .map(value => ({
          sessionId: value.sessionId,
          rootSessionId: value.rootSessionId,
          templateIds: [...value.templateIds].sort(),
          inclusionReason: value.inclusionReason,
        }))
        .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
      excludedSessions: [...excludedSessions.values()]
        .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
      missingness: [...missing.values()]
        .sort((left, right) => left.field.localeCompare(right.field)),
      sourceArtifactRefs: [...sourceArtifactRefs].sort(),
    }
  }

  #bindings(): readonly AgentExecutionBinding[] {
    const rows = this.#database.db.prepare(`
      SELECT binding_json
      FROM agent_execution_bindings
      WHERE tenant_id = ?
      ORDER BY created_at ASC, binding_id ASC
    `).all(this.#tenantId) as unknown as Array<{ readonly binding_json: string }>
    return rows.map(row => JSON.parse(row.binding_json) as AgentExecutionBinding)
  }

  #events(missionId: string, to: number): readonly MissionEventRow[] {
    const rows = this.#database.db.prepare(`
      SELECT seq, event_id, event_type, actor_json, payload_json, occurred_at
      FROM mission_events
      WHERE tenant_id = ? AND mission_id = ? AND occurred_at <= ?
      ORDER BY seq ASC
    `).all(
      this.#tenantId,
      missionId,
      new Date(to).toISOString(),
    ) as unknown as Array<{
      readonly seq: number
      readonly event_id: string
      readonly event_type: string
      readonly actor_json: string
      readonly payload_json: string
      readonly occurred_at: string
    }>
    return rows.map(row => ({
      seq: row.seq,
      eventId: row.event_id,
      type: row.event_type,
      actor: parseRecord(row.actor_json),
      payload: parseRecord(row.payload_json),
      occurredAt: row.occurred_at,
    }))
  }

  #workspaceKey(rootSessionId: string): string {
    const row = this.#database.db.prepare(`
      SELECT binding_json
      FROM military_session_bindings
      WHERE tenant_id = ? AND session_id = ?
    `).get(this.#tenantId, rootSessionId) as { readonly binding_json: string } | undefined
    if (row === undefined) return `session:${rootSessionId}`
    const binding = parseRecord(row.binding_json)
    return typeof binding.workspaceKey === 'string'
      ? binding.workspaceKey
      : `session:${rootSessionId}`
  }

  #taskOrder(taskId: string, taskVersion: number): TaskOrder | null {
    const row = this.#database.db.prepare(`
      SELECT task_version, state_json
      FROM mission_runtime_tasks
      WHERE tenant_id = ? AND task_id = ?
    `).get(this.#tenantId, taskId) as {
      readonly task_version: number
      readonly state_json: string
    } | undefined
    if (row === undefined || row.task_version !== taskVersion) return null
    const runtime = parseRecord(row.state_json)
    return isTaskOrder(runtime.order) ? runtime.order : null
  }

  #bundleVersion(presetGeneration: string): string {
    const row = this.#database.db.prepare(`
      SELECT bundle_version
      FROM preset_generations
      WHERE generation = ?
    `).get(presetGeneration) as { readonly bundle_version: string } | undefined
    return row?.bundle_version ?? 'unknown'
  }

  async #session(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<SessionSnapshot | null> {
    const cached = this.#sessionCache.get(sessionId)
    if (cached !== undefined) return await cached
    const loading = (async (): Promise<SessionSnapshot | null> => {
      const live = this.#ctx.agents?.get(sessionId as DshSessionId)
      if (live !== undefined) {
        return {
          meta: live.session.header as unknown as Record<string, unknown>,
          events: live.session.events,
        }
      }
      const persistence = asPersistence(this.#ctx.sessionPersistence)
      if (persistence === undefined) return null
      try {
        return await persistence.inspect(sessionId, signal)
      } catch {
        return null
      }
    })()
    this.#sessionCache.set(sessionId, loading)
    return await loading
  }

  async #parentWakeup(
    rootSessionId: string,
    childSessionId: string,
    from: number,
    to: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const parent = await this.#session(rootSessionId, signal)
    return parent?.events.some(event =>
      event.time >= from
      && event.time <= to
      && event.type === 'user/message'
      && event.data.source.kind === 'subagent-report'
      && String(event.data.source.senderSessionId) === childSessionId) ?? false
  }
}

function matchesBindingFilters(
  request: PerformanceEvaluationRequest,
  binding: AgentExecutionBinding,
): boolean {
  if (
    request.filters.templateIds.length > 0
    && !request.filters.templateIds.some(value =>
      String(value) === binding.templateId)
  ) return false
  if (
    request.filters.departments.length > 0
    && !request.filters.departments.some(value =>
      String(value) === String(binding.departmentId))
  ) return false
  if (
    request.filters.missionIds.length > 0
    && !request.filters.missionIds.some(value =>
      String(value) === String(binding.missionId))
  ) return false
  return true
}

function matchesBoundTask(
  payload: Record<string, unknown>,
  binding: AgentExecutionBinding,
): boolean {
  if (binding.workspace === undefined) return true
  return stringField(payload, 'taskId') === binding.workspace.taskId
    && positiveInteger(payload.taskVersion, 1) === binding.workspace.taskVersion
}

function sameActor(
  payload: Record<string, unknown>,
  binding: AgentExecutionBinding,
): boolean {
  const agent = asRecord(payload.agent)
  return String(agent.agentId ?? '') === String(binding.agent.agentId)
    && Number(agent.generation ?? -1) === binding.agent.generation
}

function belongsToAttempt(
  event: MissionEventRow,
  taskId: string,
  taskVersion: number,
): boolean {
  if (event.type === 'mission/completed' || event.type === 'mission/cancelled') {
    return true
  }
  if (event.type === 'model/fallback') return true
  const eventTaskId = event.payload.taskId
  if (eventTaskId !== undefined && String(eventTaskId) !== taskId) return false
  if (event.type === 'task/rework-requested') {
    return Number(event.payload.previousVersion) === taskVersion
  }
  if (event.payload.taskVersion !== undefined) {
    return Number(event.payload.taskVersion) === taskVersion
  }
  return String(eventTaskId ?? '') === taskId
}

function attemptOutcome(
  events: readonly MissionEventRow[],
  binding: AgentExecutionBinding,
  metrics: SessionMetrics,
  parentWakeup: boolean,
): EvaluationAttemptRecord['outcome'] {
  const verifications = events.filter(value =>
    value.type === 'verification/completed')
  const acceptedEvent = events.find(value => value.type === 'task/accepted')
  const integrated = events.some(value => value.type === 'task/integrated')
  const completed = acceptedEvent !== undefined
    && (acceptedEvent.payload.integrationRequired === false || integrated)
  const frozen = events.some(value =>
    value.type === 'oversight/frozen'
    && String(value.payload.targetAgentId ?? '') === String(binding.agent.agentId))
  const released = events.some(value =>
    value.type === 'oversight/released'
    && String(value.payload.targetAgentId ?? '') === String(binding.agent.agentId))
  const regressionEscape = events.some(value =>
    value.type === 'integration/regression-failed'
    || value.type === 'integration/conflict-detected')
  return {
    firstPassAccepted: String(verifications[0]?.payload.disposition ?? '') === 'ACCEPTED',
    finalAccepted: acceptedEvent !== undefined,
    completed,
    missionCompleted: events.some(value => value.type === 'mission/completed'),
    declaredCompleteWithoutEvidence: metrics.successfulTerminalCall
      && acceptedEvent === undefined,
    terminalDuplicate: metrics.terminalDuplicate,
    frozen,
    permissionViolation: metrics.failure.stage === 'PERMISSION_DENIED'
      || metrics.failure.stage === 'PATH_SCOPE_REJECTION',
    staleSubmission: metrics.failure.code?.includes('STALE') === true
      || events.some(value => value.type === 'decision/stale'),
    regressionEscape,
    handoffComplete: completed,
    parentWakeup: !completed || parentWakeup,
    recoveryAttempted: metrics.recoveryAttempted || frozen,
    recoverySucceeded: metrics.recoverySucceeded || (frozen && released),
    recoveryDrift: metrics.recoveryDrift,
    verifierObserved: verifications.length > 0,
    reworkCount: events.filter(value =>
      value.type === 'task/rework-requested').length,
    blockerCount: events.filter(value =>
      value.type === 'task/blocker-submitted').length,
    radioCount: events.filter(value =>
      value.type === 'radio/requested').length,
    userInterventionCount: events.filter(value =>
      value.type === 'decision/answered').length,
  }
}

function taskSnapshot(order: TaskOrder | null): EvaluationAttemptRecord['task'] {
  if (order === null) {
    return {
      taskType: 'unknown',
      preExecutionDifficulty: 1,
      difficultyModelVersion: 'difficulty-v2-pre-execution',
      riskClass: 'UNKNOWN',
      acceptanceClauseCount: 0,
      dependencyCount: 0,
      allowedToolCount: 0,
      verifierStrength: 0,
      workspaceDrift: false,
      tacticalCoverage: false,
    }
  }
  const values = complexityValues(order.complexity)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const dependencyPenalty = Math.min(2, order.dependencies.length * 0.25)
  const acceptancePenalty = Math.min(1.5, order.requiredEvidence.length * 0.15)
  const difficulty = Math.max(
    1,
    Math.min(10, 1 + mean * 1.25 + dependencyPenalty + acceptancePenalty),
  )
  const peak = Math.max(...values)
  const riskClass = peak >= 5 || order.complexity.contextFootprint === 'large'
    ? 'CRITICAL' as const
    : peak >= 4
      ? 'HIGH' as const
      : peak >= 2
        ? 'MEDIUM' as const
        : 'LOW' as const
  return {
    taskType: order.taskType,
    preExecutionDifficulty: Number(difficulty.toFixed(3)),
    difficultyModelVersion: 'difficulty-v2-pre-execution',
    complexity: order.complexity,
    riskClass,
    acceptanceClauseCount: order.requiredEvidence.length,
    dependencyCount: order.dependencies.length,
    allowedToolCount: order.allowedTools.length,
    verifierStrength: order.requiredEvidence.length === 0 ? 0 : 1,
    workspaceDrift: false,
    tacticalCoverage: order.tactics.length > 0,
  }
}

function complexityValues(value: TaskComplexityVector): readonly number[] {
  return [
    value.semanticDecisions,
    value.unknownDependencies,
    value.writeDomains,
    value.toolFamilies,
    value.acceptanceAmbiguity,
    value.integrationFanOut,
    value.contextFootprint === 'large'
      ? 5
      : value.contextFootprint === 'medium' ? 3 : 1,
  ]
}

function configurationFor(
  binding: AgentExecutionBinding,
  roleUses: readonly RoleRevisionUseRecord[],
  metrics: SessionMetrics,
  startedAt: string,
  endedAt: string,
  bundleVersion: string,
): EvaluationAttemptRecord['configuration'] {
  const cutoff = Date.parse(startedAt)
  const upperBound = Date.parse(endedAt)
  const roleUse = roleUses
    .filter(value =>
      value.sessionId === String(binding.agent.sessionId)
      && Date.parse(value.recordedAt) >= cutoff
      && Date.parse(value.recordedAt) <= upperBound)
    .sort((left, right) =>
      Date.parse(left.recordedAt) - Date.parse(right.recordedAt))[0]
  const provider = metrics.exactRouteObserved ? metrics.provider : binding.provider
  const model = metrics.exactRouteObserved ? metrics.model : binding.model
  const configurationHash = roleUse?.configurationHash
    ?? sha256(stableJson({
      templateId: binding.templateId,
      templateRevision: Number(binding.templateRevision),
      provider,
      model,
      reasoningEffort: metrics.reasoningEffort,
      toolProfile: binding.toolProfile,
      permissionProfile: binding.permissionProfile,
      presetGeneration: binding.presetGeneration,
    }))
  return {
    templateId: brand<string, 'AgentTemplateId'>(binding.templateId),
    templateRevision: binding.templateRevision,
    role: evaluatedRole(binding.agent.role),
    department: binding.departmentId,
    promptRevision: roleUse?.roleRevision ?? Number(binding.templateRevision),
    configurationHash: brand<string, 'Sha256'>(configurationHash),
    provider,
    model,
    aliasStatus: metrics.exactRouteObserved
      ? metrics.fallbackCount > 0
        ? 'FALLBACK_CHAIN_OBSERVED'
        : 'EXACT_ROUTE_OBSERVED'
      : 'ALIAS_UNPROVEN',
    reasoningEffort: reasoningEffortValue(
      metrics.reasoningEffort,
      binding.reasoningEffort,
    ),
    toolProfile: binding.toolProfile,
    permissionProfile: binding.permissionProfile,
    presetGeneration: binding.presetGeneration,
    bundleVersion,
    dshRelease: '0.1.1-rc.2',
    dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  }
}

function inspectSession(
  events: readonly SessionEvent[],
  binding: AgentExecutionBinding,
  leaseAt: number,
): SessionMetrics {
  let provider = binding.provider
  let model = binding.model
  let reasoningEffort = binding.reasoningEffort
  let exactRouteObserved = false
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let modelSteps = 0
  let modelLatencyMs = 0
  let toolLatencyMs = 0
  let fallbackCount = 0
  let recoveryAttempted = false
  let recoverySucceeded = false
  let recoveryDrift = false
  let compactionAttempts = 0
  let compactionSuccesses = 0
  const stepStarts = new Map<string, number>()
  const toolStarts = new Map<string, { readonly name: string; readonly time: number }>()
  const pendingFailedToolNames = new Set<string>()
  const correctedToolNames = new Set<string>()
  const evidenceRefs: EvaluationAttemptRecord['evidenceRefs'][number][] = []
  let successfulTerminalCall = false
  let successfulTerminalCallCount = 0
  let retryCount = 0
  let failure: SessionMetrics['failure'] = { stage: 'NONE' }

  for (const event of events) {
    if (event.type === 'step/start') {
      stepStarts.set(`${event.data.turn}:${event.data.step}`, event.time)
      modelSteps += 1
    }
    if (event.type === 'compaction/start') compactionAttempts += 1
    if (event.type === 'compaction/end' && event.data.error === undefined) {
      compactionSuccesses += 1
    }
    if (event.type === 'request/context') {
      if (
        (exactRouteObserved
          || (provider !== 'unknown' && model !== 'unknown'))
        && (
          provider !== event.data.provider
          || model !== event.data.model
        )
      ) fallbackCount += 1
      provider = event.data.provider
      model = event.data.model
      exactRouteObserved = true
    }
    if (event.type === 'request/header') {
      if (event.data.reason === 'resume') recoveryAttempted = true
      provider = String(event.data.header.config.provider ?? provider)
      model = String(event.data.header.config.model ?? model)
      reasoningEffort = reasoningEffortValue(
        event.data.header.config.reasoningEffort,
        reasoningEffort,
      )
    }
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      inputTokens += (usage?.inputTokens ?? 0)
        + (usage?.cacheReadTokens ?? 0)
        + (usage?.cacheWriteTokens ?? 0)
      outputTokens += usage?.outputTokens ?? 0
      reasoningTokens += usage?.reasoningTokens ?? 0
      const started = stepStarts.get(`${event.data.turn}:${event.data.step}`)
      if (started !== undefined) {
        modelLatencyMs += Math.max(0, event.time - started)
      }
      if (event.data.interrupted === true && failure.stage === 'NONE') {
        failure = { stage: 'PROVIDER_FAILURE', code: 'MODEL_STREAM_INTERRUPTED' }
      }
    }
    if (event.type === 'tool/call') {
      const callId = String(event.data.callId)
      toolStarts.set(callId, { name: event.data.name, time: event.time })
      if (pendingFailedToolNames.has(event.data.name)) retryCount += 1
      evidenceRefs.push({
        kind: 'tool-call',
        ref: `session:${String(binding.agent.sessionId)}:tool-call:${callId}`,
        claim: `Model selected ${event.data.name}`,
      })
    }
    if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      const callId = String(block.toolCallId)
      const call = toolStarts.get(callId)
      if (call !== undefined) toolLatencyMs += Math.max(0, event.time - call.time)
      const failed = block.isError === true || event.data.error !== undefined
      if (failed) {
        if (call !== undefined) pendingFailedToolNames.add(call.name)
        const diagnostic = `${event.data.error?.code ?? ''} ${toolResultText(event)}`
        if (
          recoveryAttempted
          && /DRIFT|STALE_(?:FENCE|IDENTITY|VERSION|WORKSPACE)/iu.test(
            diagnostic,
          )
        ) recoveryDrift = true
        if (failure.stage === 'NONE') {
          failure = classifyToolFailure(
            event.data.error?.code,
            toolResultText(event),
          )
        }
      } else if (call !== undefined) {
        if (pendingFailedToolNames.delete(call.name)) {
          correctedToolNames.add(call.name)
        }
        if (TERMINAL_TOOL_NAMES.has(call.name)) {
          successfulTerminalCall = true
          successfulTerminalCallCount += 1
        }
      }
    }
    if (event.type === 'turn/end') {
      const kind = event.data.reason.kind
      if (kind === 'completed' && recoveryAttempted) recoverySucceeded = true
      if (kind === 'aborted' && failure.stage === 'NONE') {
        failure = {
          stage: 'USER_CANCELLATION',
          code: 'TURN_ABORTED',
        }
      }
      if (kind === 'interrupted' && failure.stage === 'NONE') {
        failure = {
          stage: 'SYSTEM_CRASH',
          code: 'TURN_CRASH_INTERRUPTED',
        }
      }
      if (
        (kind === 'error' || kind === 'blocked' || kind === 'max-tokens')
        && failure.stage === 'NONE'
      ) {
        failure = {
          stage: kind === 'error' || kind === 'max-tokens'
            ? 'PROVIDER_FAILURE'
            : 'UNKNOWN',
          code: kind === 'error'
            ? `PROVIDER_${event.data.reason.error.code}`
            : `TURN_${kind.toUpperCase().replaceAll('-', '_')}`,
        }
      }
    }
  }
  const firstEventAt = events[0]?.time ?? leaseAt
  const lastEventAt = events.at(-1)?.time ?? firstEventAt
  return {
    provider,
    model,
    reasoningEffort,
    exactRouteObserved,
    inputTokens,
    outputTokens,
    reasoningTokens,
    modelSteps,
    toolCalls: toolStarts.size,
    correctionCount: correctedToolNames.size,
    queueLatencyMs: Math.max(0, firstEventAt - leaseAt),
    modelLatencyMs,
    toolLatencyMs,
    totalLatencyMs: Math.max(0, lastEventAt - leaseAt),
    fallbackCount,
    retryCount,
    compactionAttempts,
    compactionSuccesses,
    successfulTerminalCall,
    terminalDuplicate: successfulTerminalCallCount > 1,
    recoveryAttempted,
    recoverySucceeded,
    recoveryDrift,
    failure,
    evidenceRefs,
  }
}

function classifyToolFailure(
  code: string | undefined,
  text: string,
): SessionMetrics['failure'] {
  const normalized = `${code ?? ''} ${text}`.toUpperCase()
  if (/UNKNOWN_TOOL|TOOL_NOT_FOUND|NOT_ALLOWED_TOOL/.test(normalized)) {
    return { stage: 'MODEL_TOOL_SELECTION', ...(code === undefined ? {} : { code }) }
  }
  if (/PATH_SCOPE|OUTSIDE.*SCOPE|FORBIDDEN_PATH/.test(normalized)) {
    return { stage: 'PATH_SCOPE_REJECTION', ...(code === undefined ? {} : { code }) }
  }
  if (/PERMISSION|POLICY_DENIED|AUTHORIZATION|CAPABILITY_GRANT/.test(normalized)) {
    return { stage: 'PERMISSION_DENIED', ...(code === undefined ? {} : { code }) }
  }
  if (/STALE|REVISION|TASK_VERSION/.test(normalized)) {
    return { stage: 'HOST_VALIDATION', ...(code === undefined ? {} : { code }) }
  }
  if (/WORKTREE|WORKSPACE|GIT|DIRTY/.test(normalized)) {
    return { stage: 'WORKSPACE_STATE', ...(code === undefined ? {} : { code }) }
  }
  if (
    /ARGUMENT|ARG_SCHEMA|SCHEMA|JSON_PARSE|MALFORMED_JSON|INVALID_(?:ARGUMENT|INPUT)/u
      .test(normalized)
    || /\bVALIDATION_ERROR\b/u.test(normalized)
  ) {
    return {
      stage: 'MODEL_ARGUMENT_SCHEMA',
      ...(code === undefined ? {} : { code }),
    }
  }
  if (/HOST|VALIDATION|CONTRACT|FENCE/u.test(normalized)) {
    return {
      stage: 'HOST_VALIDATION',
      ...(code === undefined ? {} : { code }),
    }
  }
  return {
    stage: 'TOOL_RUNTIME',
    code: code ?? 'TOOL_RESULT_ERROR',
  }
}

function missingReasonFor(
  events: readonly MissionEventRow[],
  snapshot: SessionSnapshot | null,
  completed: boolean,
  failure: SessionMetrics['failure'],
): EvaluationMissingReason | undefined {
  const cancelled = events.find(value => value.type === 'task/cancelled')
  if (cancelled !== undefined) {
    const reason = String(
      cancelled.payload.reasonCode ?? cancelled.payload.reason ?? '',
    ).toUpperCase()
    if (/USER|PARENT_CANCEL/u.test(reason)) {
      return 'USER_CANCELLED'
    }
    if (/PROVIDER|RATE_LIMIT|MODEL_UNAVAILABLE/u.test(reason)) {
      return 'PROVIDER_UNAVAILABLE'
    }
    if (/SYSTEM|CRASH|PERSIST/u.test(reason)) return 'SYSTEM_CRASH'
    if (/EXTERNAL|DEPENDENCY/u.test(reason)) return 'EXTERNAL_DEPENDENCY'
    if (/SCOPE|SUPERSEDE/u.test(reason)) return 'MISSION_SCOPE_CHANGE'
    return 'AGENT_FAILURE'
  }
  if (events.some(value => value.type === 'mission/cancelled')) {
    return 'MISSION_SCOPE_CHANGE'
  }
  if (snapshot === null) return 'SESSION_NOT_MATERIALIZED'
  if (completed) return undefined
  switch (failure.stage) {
    case 'USER_CANCELLATION':
      return 'USER_CANCELLED'
    case 'SYSTEM_CRASH':
      return 'SYSTEM_CRASH'
    case 'PROVIDER_FAILURE':
      return 'PROVIDER_UNAVAILABLE'
    case 'EXTERNAL_DEPENDENCY':
      return 'EXTERNAL_DEPENDENCY'
    case 'MISSION_SCOPE_CHANGE':
      return 'MISSION_SCOPE_CHANGE'
    case 'MODEL_TOOL_SELECTION':
    case 'MODEL_ARGUMENT_SCHEMA':
    case 'VERIFICATION_FAILURE':
      return 'AGENT_FAILURE'
    default:
      return 'EVENT_GAP'
  }
}

function attemptFailure(
  events: readonly MissionEventRow[],
  sessionFailure: SessionMetrics['failure'],
  outcome: EvaluationAttemptRecord['outcome'],
  order: TaskOrder | null,
): SessionMetrics['failure'] {
  // A corrected tool error remains valuable funnel evidence even when the
  // final Candidate is accepted. Never erase it merely because the terminal
  // Task outcome succeeded.
  if (sessionFailure.stage !== 'NONE') return sessionFailure
  if (order === null) {
    return { stage: 'TASK_ORDER_AMBIGUITY', code: 'TASK_ORDER_UNAVAILABLE' }
  }
  if (events.some(value =>
    value.type === 'integration/regression-failed'
    || value.type === 'integration/conflict-detected')) {
    return { stage: 'INTEGRATION_FAILURE', code: 'INTEGRATION_REJECTED' }
  }
  const verification = [...events].reverse().find(value =>
    value.type === 'verification/completed')
  if (
    verification !== undefined
    && String(verification.payload.disposition ?? '') !== 'ACCEPTED'
  ) {
    return {
      stage: 'VERIFICATION_FAILURE',
      code: `VERIFICATION_${String(
        verification.payload.disposition ?? 'REJECTED',
      ).toUpperCase()}`,
    }
  }
  if (outcome.completed && !outcome.parentWakeup) {
    return { stage: 'PARENT_WAKEUP_FAILURE', code: 'PARENT_NOT_RESUMED' }
  }
  if (!outcome.finalAccepted) {
    return { stage: 'UNKNOWN', code: 'NO_AUTHORITATIVE_TERMINAL_OUTCOME' }
  }
  return { stage: 'NONE' }
}

function verificationLatency(events: readonly MissionEventRow[]): number {
  const submitted = events.find(value => value.type === 'task/candidate-submitted')
  const verified = events.find(value =>
    value.type === 'verification/completed'
    && (submitted === undefined
      || String(value.payload.candidateId ?? '')
        === String(submitted.payload.candidateId ?? '')))
  if (submitted === undefined || verified === undefined) return 0
  return Math.max(0, eventTime(verified) - eventTime(submitted))
}

function attemptCompletedAt(
  events: readonly MissionEventRow[],
): string | undefined {
  return [...events].reverse().find(value =>
    value.type === 'task/integrated'
    || value.type === 'task/accepted'
    || value.type === 'task/cancelled'
    || value.type === 'task/rework-requested')?.occurredAt
}

export function selectEvaluationSessionEvents(
  events: readonly SessionEvent[],
  from: number,
  to: number,
): readonly SessionEvent[] {
  // RC.2 may open a child Session just before the durable lease is appended.
  // A bounded two-second skew admits only request setup events (header,
  // observed route and step start) without admitting an earlier Attempt's
  // tool/result or terminal events.
  const lowerBound = Math.max(0, from - 2_000)
  return events.filter(value =>
    value.time <= to
    && (
      value.time >= from
      || (
        value.time >= lowerBound
        && (
          value.type === 'request/header'
          || value.type === 'request/context'
          || value.type === 'step/start'
        )
      )
    ))
}

function incrementMissing(
  values: Map<string, {
    field: string
    count: number
    mechanism: 'MCAR' | 'MAR' | 'MNAR' | 'UNKNOWN'
  }>,
  field: string,
  mechanism: 'MCAR' | 'MAR' | 'MNAR' | 'UNKNOWN',
): void {
  const current = values.get(field)
  values.set(field, {
    field,
    count: (current?.count ?? 0) + 1,
    mechanism,
  })
}

function missingMechanism(
  reason: EvaluationMissingReason,
): 'MCAR' | 'MAR' | 'MNAR' | 'UNKNOWN' {
  switch (reason) {
    case 'PROVIDER_UNAVAILABLE':
    case 'SYSTEM_CRASH':
    case 'EXTERNAL_DEPENDENCY':
    case 'MISSION_SCOPE_CHANGE':
    case 'SESSION_NOT_MATERIALIZED':
      return 'MAR'
    case 'USER_CANCELLED':
    case 'AGENT_FAILURE':
      return 'MNAR'
    case 'EVENT_GAP':
    case 'UNKNOWN':
      return 'UNKNOWN'
  }
}

function parseRecord(source: string): Record<string, unknown> {
  return asRecord(JSON.parse(source))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asPersistence(value: unknown): PersistenceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PersistenceLike>
  return typeof candidate.inspect === 'function'
    ? candidate as PersistenceLike
    : undefined
}

function stringField(value: Record<string, unknown>, field: string): string {
  return typeof value[field] === 'string' ? value[field] : ''
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function reasoningEffortValue(
  value: unknown,
  fallback: AgentExecutionBinding['reasoningEffort'],
): AgentExecutionBinding['reasoningEffort'] {
  return value === 'low' || value === 'high' || value === 'max'
    ? value
    : fallback
}

function eventTime(value: MissionEventRow): number {
  return Date.parse(value.occurredAt)
}

function toolResultText(
  event: Extract<SessionEvent, { readonly type: 'tool/result' }>,
): string {
  return event.data.message.content[0].content
    .filter(value => value.type === 'text')
    .map(value => value.text)
    .join('\n')
}

function evaluatedRole(
  role: AgentExecutionBinding['agent']['role'],
): EvaluationAttemptRecord['configuration']['role'] {
  if (role === 'general' || role === 'harness') {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISMATCH',
      `non-General execution binding has invalid role ${role}`,
    )
  }
  return role
}

function isTaskOrder(value: unknown): value is TaskOrder {
  const record = asRecord(value)
  return record.schemaVersion === '1.0.0'
    && typeof record.taskId === 'string'
    && Number.isInteger(record.taskVersion)
    && typeof record.taskType === 'string'
    && typeof record.complexity === 'object'
    && record.complexity !== null
}
