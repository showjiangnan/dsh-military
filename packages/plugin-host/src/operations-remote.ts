import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionEvent,
  SessionHeader,
  SessionId as DshSessionId,
} from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  MILITARY_OPERATIONS_SCHEMA_VERSION,
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type AgentIdentity,
  type MilitaryDiagnosticReport,
  type MilitaryDiagnosticSession,
  type MilitaryOperationMission,
  type MilitaryOperationsSnapshot,
  type MilitarySessionBinding,
  type RecoveryHealthItem,
  type RecoveryOperationKind,
  type RecoveryOperationPreview,
  type RecoveryOperationReceipt,
} from '@dsh-military/contracts'
import { createMissionCommand, sha256, stableJson } from '@dsh-military/core'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import { requireWebAuthority } from './web-authority.js'
import {
  buildDiagnosticReport,
  redactDiagnosticText,
} from './session-diagnostics.js'

const RECOVERY_RECEIPT_NAMESPACE = 'military-recovery-operation'
const RECOVERY_PREVIEW_NAMESPACE = 'military-recovery-preview'
const RECOVERY_PREVIEW_TTL_MS = 5 * 60 * 1_000
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SOURCE_VERSION = '0.9.0-alpha.28'

interface PersistenceInspection {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
}

interface PersistenceLike {
  inspect(id: DshSessionId, signal?: AbortSignal): Promise<PersistenceInspection>
}

interface SessionBindingRow {
  readonly session_id: string
  readonly root_session_id: string
  readonly binding_json: string
  readonly created_at: string
}

/** Read-only diagnostics plus narrowly governed, durable recovery operations. */
export class MilitaryOperationsRemoteService extends TypertRemoteService {
  private readonly state: SqliteStateRecords

  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryOperations')
    this.state = new SqliteStateRecords(host.database, host.tenantId)
  }

  @Remote
  async snapshot(signal: AbortSignal): Promise<MilitaryOperationsSnapshot> {
    requireWebAuthority(this.host, 'military.recovery.manage')
    signal.throwIfAborted()
    const [sessions, missions, recovery] = await Promise.all([
      this.sessions(signal),
      this.missions(signal),
      this.recoveryHealth(signal),
    ])
    return {
      schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
      sessions,
      missions,
      recovery,
      generatedAt: new Date().toISOString(),
    }
  }

  private missions(signal: AbortSignal): readonly MilitaryOperationMission[] {
    signal.throwIfAborted()
    const rows = this.host.database.db.prepare(`
      SELECT
        stream.mission_id,
        stream.aggregate_revision,
        stream.updated_at,
        started.payload_json AS started_payload,
        terminal.event_type AS terminal_type
      FROM mission_streams AS stream
      LEFT JOIN mission_events AS started
        ON started.tenant_id = stream.tenant_id
        AND started.mission_id = stream.mission_id
        AND started.event_type = 'mission/started'
      LEFT JOIN mission_events AS terminal
        ON terminal.tenant_id = stream.tenant_id
        AND terminal.mission_id = stream.mission_id
        AND terminal.event_type IN ('mission/completed', 'mission/cancelled')
      WHERE stream.tenant_id = ?
      ORDER BY stream.updated_at DESC, stream.mission_id
    `).all(this.host.tenantId) as unknown as Array<{
      readonly mission_id: string
      readonly aggregate_revision: number
      readonly updated_at: string
      readonly started_payload?: string | null
      readonly terminal_type?: string | null
    }>
    return rows.map(row => {
      let title = row.mission_id
      if (row.started_payload !== null && row.started_payload !== undefined) {
        try {
          const payload = JSON.parse(row.started_payload) as {
            readonly title?: unknown
          }
          if (typeof payload.title === 'string' && payload.title.trim() !== '') {
            title = payload.title
          }
        } catch {
          // Corrupt payload remains visible by Mission ID; health checks report
          // the underlying database drift separately.
        }
      }
      return {
        missionId: row.mission_id,
        title,
        state: row.terminal_type === 'mission/completed'
          ? 'COMPLETED'
          : row.terminal_type === 'mission/cancelled'
            ? 'CANCELLED'
            : 'ACTIVE',
        revision: Number(row.aggregate_revision),
        updatedAt: row.updated_at,
      }
    })
  }

  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<unknown> {
    requireWebAuthority(this.host, 'military.recovery.manage')
    signal.throwIfAborted()
    const value = record(action, 'Military operations action')
    const type = text(value.type, 'Military operations action.type', 64)
    switch (type) {
      case 'SESSION_TIMELINE':
        return await this.timeline(text(value.sessionId, 'sessionId', 180), signal)
      case 'PREVIEW_RECOVERY':
        return await this.previewRecovery(value, signal)
      case 'EXECUTE_RECOVERY':
        return await this.executeRecovery(value, signal)
      default:
        throw new TypeError(`unknown Military operations action ${type}`)
    }
  }

  private async sessions(signal: AbortSignal): Promise<readonly MilitaryDiagnosticSession[]> {
    const rows = this.host.database.db.prepare(`
      SELECT session_id, root_session_id, binding_json, created_at
      FROM military_session_bindings
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 80
    `).all(this.host.tenantId) as unknown as SessionBindingRow[]
    const executionRows = this.host.database.db.prepare(`
      SELECT binding_json
      FROM agent_execution_bindings
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(this.host.tenantId) as unknown as Array<{ readonly binding_json: string }>
    const executions = executionRows.map(row =>
      JSON.parse(row.binding_json) as AgentExecutionBinding)
    const selections = this.host.database.db.prepare(`
      SELECT session_id, provider, model, reasoning_effort
      FROM model_selection_receipts
      WHERE tenant_id = ?
      ORDER BY selected_at DESC
    `).all(this.host.tenantId) as unknown as Array<{
      readonly session_id: string
      readonly provider: string
      readonly model: string
      readonly reasoning_effort: string
    }>
    const result: MilitaryDiagnosticSession[] = []
    for (const row of rows) {
      signal.throwIfAborted()
      const sessionBinding = JSON.parse(row.binding_json) as MilitarySessionBinding
      const execution = executions.find(value =>
        String(value.agent.sessionId) === row.session_id)
      const selection = selections.find(value => value.session_id === row.session_id)
      const live = this.ctx.agents?.get(row.session_id as DshSessionId)
      let events: readonly SessionEvent[] = live?.session.events ?? []
      if (live === undefined) {
        const persistence = asPersistence(this.ctx.sessionPersistence)
        if (persistence !== undefined) {
          try {
            events = (await persistence.inspect(row.session_id as DshSessionId, signal)).events
          } catch {
            events = []
          }
        }
      }
      const usage = sessionUsage(events)
      result.push({
        sessionId: row.session_id,
        rootSessionId: row.root_session_id,
        ...(sessionBinding.parentSessionId === undefined
          ? {}
          : { parentSessionId: String(sessionBinding.parentSessionId) }),
        ...(execution === undefined ? {} : { missionId: execution.missionId }),
        roleId: execution?.templateId ?? 'general',
        displayName: execution?.templateId ?? 'General 总指挥',
        templateRevision: Number(execution?.templateRevision ?? 0),
        provider: execution?.provider ?? selection?.provider ?? String(live?.options.provider ?? 'unknown'),
        model: execution?.model ?? selection?.model ?? String(live?.options.model ?? 'unknown'),
        reasoningEffort: String(
          execution?.reasoningEffort
          ?? selection?.reasoning_effort
          ?? 'unknown',
        ),
        live: live !== undefined,
        eventCount: events.length,
        errorCount: usage.errors,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        startedAt: events[0] === undefined
          ? row.created_at
          : new Date(events[0].time).toISOString(),
        updatedAt: events.at(-1) === undefined
          ? row.created_at
          : new Date(events.at(-1)!.time).toISOString(),
      })
    }
    return result
  }

  private async timeline(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<MilitaryDiagnosticReport> {
    const sessions = await this.sessions(signal)
    const session = sessions.find(value => value.sessionId === sessionId)
    if (session === undefined) throw new MilitaryError('NOT_FOUND', 'Military Session 不存在')
    const live = this.ctx.agents?.get(sessionId as DshSessionId)
    let events: readonly SessionEvent[]
    if (live !== undefined) events = live.session.events
    else {
      const persistence = asPersistence(this.ctx.sessionPersistence)
      if (persistence === undefined) {
        throw new MilitaryError('NOT_FOUND', 'Session 已离线且 RC.2 persistence 不可用')
      }
      events = (await persistence.inspect(sessionId as DshSessionId, signal)).events
    }
    const binding = await this.host.application.executionBindings.forSession(sessionId)
      ?? undefined
    const callIds = events
      .filter((event): event is Extract<SessionEvent, { readonly type: 'tool/call' }> =>
        event.type === 'tool/call')
      .map(event => String(event.data.callId))
    const receipts = await this.host.application.observedEvidence.toolCalls(callIds)
    return buildDiagnosticReport({
      session,
      events,
      ...(binding === undefined ? {} : { binding }),
      receipts,
    })
  }

  private async recoveryHealth(
    signal: AbortSignal,
  ): Promise<MilitaryOperationsSnapshot['recovery']> {
    signal.throwIfAborted()
    const databasePath = this.databasePath()
    const [databaseBytes, walBytes, worktrees] = await Promise.all([
      fileBytes(databasePath),
      fileBytes(`${databasePath}-wal`),
      directoryNames(join(this.host.config.dataRoot, 'workspace-state', 'worktrees')),
    ])
    const quickCheck = this.host.database.db.prepare('PRAGMA quick_check(1)').get() as
      | Record<string, unknown>
      | undefined
    const quickResult = String(Object.values(quickCheck ?? {})[0] ?? 'unknown')
    const missionStates = groupedCounts(
      this.host.database.db.prepare(`
        SELECT status AS state, COUNT(*) AS count
        FROM mission_streams WHERE tenant_id = ? GROUP BY status
      `).all(this.host.tenantId),
    )
    const taskStates = groupedCounts(
      this.host.database.db.prepare(`
        SELECT state, COUNT(*) AS count
        FROM mission_runtime_tasks WHERE tenant_id = ? GROUP BY state
      `).all(this.host.tenantId),
    )
    const currentPreset = await this.host.application.presetGenerations.current()
    const presetRows = this.host.database.db.prepare(`
      SELECT generation, bundle_version, dsh_commit, status
      FROM preset_generations ORDER BY created_at DESC LIMIT 4
    `).all() as unknown as Array<{
      readonly generation: string
      readonly bundle_version: string
      readonly dsh_commit: string
      readonly status: string
    }>
    const indexedCurrentPreset = presetRows.find(value =>
      value.generation === currentPreset.generation)
    const activeLeases = this.host.database.db.prepare(`
      SELECT workspace_lease_id, expires_at
      FROM workspace_leases
      WHERE tenant_id = ? AND state = 'ACTIVE'
    `).all(this.host.tenantId) as unknown as Array<{
      readonly workspace_lease_id: string
      readonly expires_at: string
    }>
    const activeLeaseIds = new Set(activeLeases.map(value => value.workspace_lease_id))
    const orphanWorktrees = worktrees.filter(name => !activeLeaseIds.has(name))
    const receiptCount = scalarCount(this.host.database.db.prepare(`
      SELECT COUNT(*) AS count FROM durable_state_records
      WHERE tenant_id = ? AND namespace IN (
        'observed-tool-call',
        'terminal-parent-report',
        'terminal-domain-mutation',
        'military-role-dispatch-readiness'
      )
    `).get(this.host.tenantId))
    const grantRows = this.host.database.db.prepare(`
      SELECT value_json FROM durable_state_records
      WHERE tenant_id = ? AND namespace = 'capability-grant'
    `).all(this.host.tenantId) as unknown as Array<{ readonly value_json: string }>
    const grantStates = countJsonStates(grantRows)
    const outbox = this.host.database.db.prepare(`
      SELECT
        SUM(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL
          THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL
          AND claimed_until IS NOT NULL
          AND claimed_until < ? THEN 1 ELSE 0 END) AS stale
        ,SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) AS dead
        ,MIN(CASE WHEN delivered_at IS NULL AND dead_lettered_at IS NULL
          THEN available_at END) AS oldest_at
      FROM transactional_outbox WHERE tenant_id = ?
    `).get(new Date().toISOString(), this.host.tenantId) as
      | {
          readonly pending?: number
          readonly stale?: number
          readonly dead?: number
          readonly oldest_at?: string | null
        }
      | undefined
    const commandEffectCounts = groupedCounts(
      this.host.database.db.prepare(`
        SELECT state, COUNT(*) AS count
        FROM mission_command_operations
        WHERE tenant_id = ? AND state <> 'COMMITTED'
        GROUP BY state
      `).all(this.host.tenantId),
    )
    const commandEffects = this.host.database.db.prepare(`
      SELECT
        COUNT(*) AS pending,
        SUM(CASE WHEN state = 'PENDING_EFFECT'
          AND lease_until IS NOT NULL AND lease_until <= ? THEN 1 ELSE 0 END)
          AS expired_leases,
        MIN(updated_at) AS oldest_at
      FROM mission_command_operations
      WHERE tenant_id = ? AND state <> 'COMMITTED'
    `).get(new Date().toISOString(), this.host.tenantId) as
      | {
          readonly pending?: number
          readonly expired_leases?: number
          readonly oldest_at?: string | null
        }
      | undefined
    const radioState = this.state.readSync<{
      readonly entries?: Readonly<Record<string, {
        readonly state?: string
        readonly attempts?: number
        readonly leaseUntil?: number
        readonly request?: {
          readonly createdAt?: string
          readonly expiresAt?: string
        }
      }>>
    }>('radio', 'state')
    const radioEntries = Object.values(radioState?.entries ?? {})
    const queuedRadio = radioEntries.filter(value =>
      value.state === 'QUEUED' || value.state === 'LEASED')
    const deadRadio = radioEntries.filter(value =>
      value.state === 'DEAD_LETTERED')
    const radioOldestAt = queuedRadio
      .map(value => value.request?.createdAt)
      .filter((value): value is string => value !== undefined)
      .sort()[0]
    const nowMs = Date.now()
    const expiredWorkspaceLeases = activeLeases.filter(value =>
      Date.parse(value.expires_at) <= nowMs)
    const expiredRadioLeases = radioEntries.filter(value =>
      value.state === 'LEASED'
      && value.leaseUntil !== undefined
      && value.leaseUntil <= nowMs)
    const recoveryReceipts = [...this.state.listSync<RecoveryOperationReceipt>(
      RECOVERY_RECEIPT_NAMESPACE,
    )].sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt))
    const recoveryFailures = recoveryReceipts.filter(value =>
      value.status === 'FAILED')
    const outboxOldestAgeMs = ageMs(outbox?.oldest_at)
    const radioOldestAgeMs = ageMs(radioOldestAt)
    const commandEffectOldestAgeMs = ageMs(commandEffects?.oldest_at)
    const expiredCommandLeases = Number(commandEffects?.expired_leases ?? 0)
    const stalledCommandEffects = Number(commandEffectCounts.RETRYABLE ?? 0)
      + Number(commandEffectCounts.EFFECT_APPLIED ?? 0)
      + expiredCommandLeases
    this.host.application.production.telemetry.recordMetric({
      name: 'military.outbox.pending',
      kind: 'GAUGE',
      value: Number(outbox?.pending ?? 0),
      unit: 'messages',
      attributes: { tenantId: this.host.tenantId },
    })
    this.host.application.production.telemetry.recordMetric({
      name: 'military.outbox.oldest_age',
      kind: 'GAUGE',
      value: outboxOldestAgeMs,
      unit: 'ms',
      attributes: { tenantId: this.host.tenantId },
    })
    this.host.application.production.telemetry.recordMetric({
      name: 'military.radio.oldest_age',
      kind: 'GAUGE',
      value: radioOldestAgeMs,
      unit: 'ms',
      attributes: { tenantId: this.host.tenantId },
    })
    this.host.application.production.telemetry.recordMetric({
      name: 'military.command_saga.pending',
      kind: 'GAUGE',
      value: Number(commandEffects?.pending ?? 0),
      unit: 'operations',
      attributes: { tenantId: this.host.tenantId },
    })
    this.host.application.production.telemetry.recordMetric({
      name: 'military.lease.expired',
      kind: 'GAUGE',
      value: expiredWorkspaceLeases.length
        + expiredRadioLeases.length
        + expiredCommandLeases,
      unit: 'leases',
      attributes: { tenantId: this.host.tenantId },
    })
    this.host.application.production.telemetry.recordMetric({
      name: 'military.recovery.drift',
      kind: 'GAUGE',
      value: orphanWorktrees.length
        + recoveryFailures.length
        + stalledCommandEffects,
      unit: 'items',
      attributes: { tenantId: this.host.tenantId },
    })
    const production = await this.host.application.production.snapshot(
      this.host.tenantId,
    )
    const backups = production.backups
    const maximumSaturation = Math.max(
      ...Object.values(production.capacity.saturation),
      0,
    )
    const unhealthyProviders = production.providers.filter(value =>
      value.status !== 'READY')
    const sloBreaches = [
      ...(outboxOldestAgeMs > 30_000
        ? [`Outbox oldest ${formatDuration(outboxOldestAgeMs)} > 30 秒`]
        : []),
      ...(radioOldestAgeMs > 120_000
        ? [`Radio oldest ${formatDuration(radioOldestAgeMs)} > 120 秒`]
        : []),
      ...(expiredWorkspaceLeases.length + expiredRadioLeases.length > 0
        ? ['存在已过期但尚未收敛的 lease']
        : []),
      ...(commandEffectOldestAgeMs > 60_000
        ? [`Command Saga oldest ${formatDuration(
          commandEffectOldestAgeMs,
        )} > 60 秒`]
        : []),
    ]
    const liveChildren = this.ctx.agents?.list().filter(agent =>
      agent.session.header.parentSession !== undefined
      && this.host.isMilitaryAgent(agent)) ?? []
    const items: RecoveryHealthItem[] = [
      {
        id: 'SQLITE',
        label: 'Military SQLite',
        status: quickResult === 'ok' ? 'HEALTHY' : 'BLOCKED',
        summary: quickResult === 'ok' ? 'quick_check 通过' : `quick_check: ${quickResult}`,
        details: [`数据库 ${formatBytes(databaseBytes)}`, '原始数据库编辑已禁用。'],
      },
      {
        id: 'WAL',
        label: 'SQLite WAL',
        status: walBytes > 64 * 1024 * 1024 ? 'ATTENTION' : 'HEALTHY',
        summary: formatBytes(walBytes),
        details: ['WAL 由 SQLite 管理；恢复中心不会手工截断。'],
      },
      {
        id: 'BACKUPS',
        label: '受治理备份',
        status: backups.length === 0 ? 'ATTENTION' : 'HEALTHY',
        summary: `${backups.length} 份`,
        count: backups.length,
        details: backups.slice(0, 3).map(value =>
          `${value.backupId} · ${value.status} · ${formatBytes(
            value.byteLength,
          )}`),
      },
      {
        id: 'PRESET',
        label: '插件与 Preset',
        status: currentPreset.status === 'CURRENT'
          && currentPreset.dshBaseline.commit === 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
          && indexedCurrentPreset?.dsh_commit === currentPreset.dshBaseline.commit
          ? 'HEALTHY'
          : 'BLOCKED',
        summary: `${SOURCE_VERSION} · ${currentPreset.generation.slice(0, 20)}`,
        details: [
          `运行 Bundle ${SOURCE_VERSION}`,
          `当前 ${currentPreset.generation.slice(0, 20)} · 初始归档 ${currentPreset.bundleVersion}`,
          ...presetRows
            .filter(value => value.generation !== currentPreset.generation)
            .map(value =>
              `${value.generation.slice(0, 20)} · 可恢复归档 · 初始 ${value.bundle_version}`),
        ],
      },
      {
        id: 'MISSIONS',
        label: 'Mission',
        status: 'HEALTHY',
        summary: renderCounts(missionStates),
        count: sumCounts(missionStates),
        details: countDetails(missionStates),
      },
      {
        id: 'TASKS',
        label: 'Task',
        status: 'HEALTHY',
        summary: renderCounts(taskStates),
        count: sumCounts(taskStates),
        details: countDetails(taskStates),
      },
      {
        id: 'CHILD_AGENTS',
        label: '活动子 Agent',
        status: 'HEALTHY',
        summary: `${liveChildren.length} 个 live child`,
        count: liveChildren.length,
        details: liveChildren.slice(0, 8).map(agent => String(agent.id)),
      },
      {
        id: 'WORKTREES',
        label: '受控 worktree',
        status: orphanWorktrees.length === 0 ? 'HEALTHY' : 'ATTENTION',
        summary: `${worktrees.length} 个目录，${orphanWorktrees.length} 个无活动 lease`,
        count: worktrees.length,
        details: orphanWorktrees.slice(0, 8).map(value => `待人工核验：${value}`),
      },
      {
        id: 'RECEIPTS',
        label: '权威 receipt',
        status: 'HEALTHY',
        summary: `${receiptCount} 条`,
        count: receiptCount,
        details: ['只读历史不会被恢复操作改写。'],
      },
      {
        id: 'GRANTS',
        label: 'Capability Grants',
        status: Number(grantStates.ACTIVE ?? 0) > 0 ? 'ATTENTION' : 'HEALTHY',
        summary: renderCounts(grantStates),
        count: sumCounts(grantStates),
        details: countDetails(grantStates),
      },
      {
        id: 'OUTBOX',
        label: '事务 Outbox',
        status: Number(outbox?.stale ?? 0) > 0
          || Number(outbox?.dead ?? 0) > 0
          || outboxOldestAgeMs > 30_000
          ? 'ATTENTION'
          : 'HEALTHY',
        summary: `${Number(outbox?.pending ?? 0)} 待投递，${Number(
          outbox?.stale ?? 0,
        )} 过期 claim，${Number(outbox?.dead ?? 0)} dead letter`,
        count: Number(outbox?.pending ?? 0),
        details: [
          `最老待投递 ${formatDuration(outboxOldestAgeMs)}`,
          '只能释放已过期 claim；不会伪造 delivered 状态。',
        ],
      },
      {
        id: 'COMMAND_SAGA',
        label: 'Command Saga',
        status: stalledCommandEffects > 0 || commandEffectOldestAgeMs > 60_000
          ? 'ATTENTION'
          : 'HEALTHY',
        summary: `${Number(commandEffects?.pending ?? 0)} 未收敛，${
          stalledCommandEffects
        } 需恢复`,
        count: Number(commandEffects?.pending ?? 0),
        details: [
          renderCounts(commandEffectCounts),
          `${expiredCommandLeases} 个 effect lease 已过期`,
          `最老操作 ${formatDuration(commandEffectOldestAgeMs)}`,
          '恢复时必须以原 idempotency key 重试；不会猜测外部副作用。',
        ],
      },
      {
        id: 'RADIO',
        label: 'Staff Radio',
        status: deadRadio.length > 0 || radioOldestAgeMs > 120_000
          ? 'ATTENTION'
          : 'HEALTHY',
        summary: `${queuedRadio.length} 待处理，${deadRadio.length} dead letter`,
        count: queuedRadio.length,
        details: [
          `最老请求 ${formatDuration(radioOldestAgeMs)}`,
          `${expiredRadioLeases.length} 个过期 advisor lease`,
        ],
      },
      {
        id: 'LEASES',
        label: 'Lease 与并发占位',
        status: expiredWorkspaceLeases.length
          + expiredRadioLeases.length
          + expiredCommandLeases > 0
          ? 'ATTENTION'
          : 'HEALTHY',
        summary: `${activeLeases.length} workspace active，${
          expiredWorkspaceLeases.length
            + expiredRadioLeases.length
            + expiredCommandLeases
        } 已过期`,
        count: activeLeases.length,
        details: [
          ...expiredWorkspaceLeases.slice(0, 4).map(value =>
            `过期 workspace：${value.workspace_lease_id}`),
          ...expiredRadioLeases.slice(0, 4).map(value =>
            `过期 Radio lease，attempts=${Number(value.attempts ?? 0)}`),
          ...(expiredCommandLeases > 0
            ? [`${expiredCommandLeases} 个过期 Command effect lease`]
            : []),
        ],
      },
      {
        id: 'RECOVERY_DRIFT',
        label: '恢复漂移',
        status: orphanWorktrees.length
          + recoveryFailures.length
          + stalledCommandEffects > 0
          ? 'ATTENTION'
          : 'HEALTHY',
        summary: `${orphanWorktrees.length} orphan worktree，${
          recoveryFailures.length
        } 失败恢复，${stalledCommandEffects} Command Saga`,
        count: orphanWorktrees.length
          + recoveryFailures.length
          + stalledCommandEffects,
        details: [
          ...recoveryFailures.slice(0, 4).map(value =>
            `${value.operation}/${value.operationId}：${value.error ?? '失败'}`),
          ...(stalledCommandEffects > 0
            ? [`Command Saga：${renderCounts(commandEffectCounts)}`]
            : []),
        ],
      },
      {
        id: 'CAPACITY',
        label: '租户容量与 Backpressure',
        status: maximumSaturation >= 1
          ? 'BLOCKED'
          : maximumSaturation >= 0.8
            ? 'ATTENTION'
            : 'HEALTHY',
        summary: `峰值饱和度 ${(maximumSaturation * 100).toFixed(1)}%`,
        count: production.capacity.activeReservations,
        details: Object.entries(production.capacity.saturation).map(
          ([key, value]) => `${key} ${(value * 100).toFixed(1)}%`,
        ),
      },
      {
        id: 'TELEMETRY',
        label: 'Trace / Metric / Log',
        status: production.telemetry.exporter === 'OTEL_DEGRADED'
          ? 'ATTENTION'
          : 'HEALTHY',
        summary: `${production.telemetry.exporter} · ${production.telemetry.spans.length} spans`,
        count: production.telemetry.droppedRecords,
        details: [
          `${production.telemetry.metrics.length} metrics`,
          `${production.telemetry.logs.length} logs`,
          `${production.telemetry.droppedRecords} dropped`,
        ],
      },
      {
        id: 'PROVIDERS',
        label: 'Production Provider 拓扑',
        status: unhealthyProviders.some(value =>
          value.status === 'UNCONFIGURED')
          ? 'BLOCKED'
          : unhealthyProviders.length > 0
            ? 'ATTENTION'
            : 'HEALTHY',
        summary: `${production.providers.length} providers，${unhealthyProviders.length} 非 READY`,
        count: production.providers.length,
        details: production.providers.map(value =>
          `${value.kind} · ${value.implementation} · ${value.deployment}/${value.durability}`),
      },
      {
        id: 'SLO',
        label: '关键运行 SLO',
        status: sloBreaches.length > 0 ? 'ATTENTION' : 'HEALTHY',
        summary: sloBreaches.length === 0
          ? 'Outbox、Radio 与 lease 目标内'
          : `${sloBreaches.length} 项超标`,
        count: sloBreaches.length,
        details: sloBreaches.length === 0
          ? ['Outbox oldest < 30 秒；Radio oldest < 120 秒；无过期 lease。']
          : sloBreaches,
      },
    ]
    return {
      databasePathLabel: basename(databasePath),
      dataRootLabel: basename(resolve(this.host.config.dataRoot)),
      bundleVersion: SOURCE_VERSION,
      dshRelease: '0.1.1-rc.2',
      dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      items,
      production,
      recentReceipts: recoveryReceipts.slice(0, 20),
    }
  }

  private async previewRecovery(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RecoveryOperationPreview> {
    signal.throwIfAborted()
    const operation = recoveryOperation(action.operation)
    const operationId = operationIdentifier(action.operationId)
    const scope = recoveryOperationUsesTarget(operation)
      ? recoveryScope(action.scope)
      : `tenant:${this.host.tenantId}`
    const reason = operation === 'CANCEL_MISSION'
      ? missionCancellationReason(action.reason)
      : undefined
    const changes = await this.plannedChanges(operation, scope, reason)
    const generatedAt = new Date().toISOString()
    const expiresAt = new Date(
      Date.parse(generatedAt) + RECOVERY_PREVIEW_TTL_MS,
    ).toISOString()
    const expectedStateHash = await this.recoveryStateHash(operation, scope)
    const body = {
      schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
      operation,
      operationId,
      scope,
      ...(reason === undefined ? {} : { reason }),
      expectedStateHash,
      expiresAt,
      confirmationPhrase: confirmationPhrase(operation, scope),
      risk: recoveryRisk(operation),
      changes,
      refusedChanges: [
        '不会直接编辑任意 SQLite 字段或删除历史。',
        '不会标记 Mission、Task、验证或子 Agent 为完成。',
        '不会删除无法由过期 lease/claim 证明安全的 worktree 或文件。',
      ],
      idempotent: true as const,
      generatedAt,
    }
    const preview: RecoveryOperationPreview = {
      ...body,
      previewHash: sha256Json(body),
    }
    this.state.putSync(
      RECOVERY_PREVIEW_NAMESPACE,
      operationId,
      preview,
    )
    return preview
  }

  private async plannedChanges(
    operation: RecoveryOperationKind,
    scope: string,
    reason?: string,
  ): Promise<readonly string[]> {
    switch (operation) {
      case 'VERIFY_DATABASE':
        return ['运行 SQLite integrity_check；只写审计 receipt。']
      case 'CREATE_BACKUP':
        return [
          '使用 SQLite VACUUM INTO 创建一致性副本，计算 SHA-256 并用 Ed25519 签名；不覆盖已有文件。',
        ]
      case 'VERIFY_BACKUP':
        return [
          `验证备份 ${scope} 的字节长度、SHA-256、SQLite integrity_check 与 Ed25519 签名。`,
        ]
      case 'DRILL_BACKUP_RESTORE':
        return [
          `将备份 ${scope} 复制到隔离临时数据库，执行完整性与模式演练，然后删除临时副本；不覆盖 live 数据库。`,
        ]
      case 'RECONCILE':
        return ['重放未完成的本地 integration reconciliation；不触发远程 Git 写入。']
      case 'REQUEUE_STALE_OUTBOX':
        return ['仅清除已过期且未 delivered 的 outbox claim，使原事件可重投。']
      case 'RELEASE_EXPIRED_RESOURCES':
        return ['撤销已到期的预算/Grant，并释放已到期的 workspace lease。']
      case 'WAKE_PARENT':
        return [`由 live child ${scope} 发送一次 Host-authored next-step 恢复通知。`]
      case 'CANCEL_MISSION': {
        await this.host.application.ledger.readMission(
          brand<string, 'MissionId'>(scope),
        )
        const bindings = this.missionExecutionBindings(scope)
        return [
          `显式取消 Mission ${scope}；原因：${reason ?? '未提供'}。`,
          '取消所有非终态 Task，关闭 Radio/Decision continuation，并写入权威 mission/cancelled receipt。',
          `撤销并清理 ${bindings.length} 个已绑定 Activation 的 exact Grant、预算、容量和 Workspace lease；live child 将被选择性 drain。`,
          '不会终止稳定 General identity，也不会把取消解释为完成。',
        ]
      }
    }
  }

  private async executeRecovery(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RecoveryOperationReceipt> {
    signal.throwIfAborted()
    const operationId = operationIdentifier(action.operationId)
    const suppliedPreviewHash = text(
      action.previewHash,
      'recovery previewHash',
      128,
    )
    const preview = this.state.readSync<RecoveryOperationPreview>(
      RECOVERY_PREVIEW_NAMESPACE,
      operationId,
    )
    if (preview === null || preview.previewHash !== suppliedPreviewHash) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        '恢复预览不存在或 previewHash 已失效；请重新预览当前 Diff',
      )
    }
    const previous = this.state.readSync<RecoveryOperationReceipt>(
      RECOVERY_RECEIPT_NAMESPACE,
      preview.operationId,
    )
    if (previous !== null) {
      if (previous.operation !== preview.operation || previous.scope !== preview.scope) {
        throw new MilitaryError('IDEMPOTENCY_CONFLICT', 'operationId 已用于另一恢复作用域')
      }
      return previous
    }
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        '恢复预览已过期；请重新预览当前 Diff',
      )
    }
    const actionOperation = recoveryOperation(action.operation)
    const actionScope = recoveryOperationUsesTarget(actionOperation)
      ? recoveryScope(action.scope)
      : `tenant:${this.host.tenantId}`
    if (actionOperation !== preview.operation || actionScope !== preview.scope) {
      throw new MilitaryError(
        'IDEMPOTENCY_CONFLICT',
        '执行请求与已确认恢复预览的操作或作用域不一致',
      )
    }
    const currentStateHash = await this.recoveryStateHash(
      preview.operation,
      preview.scope,
    )
    if (currentStateHash !== preview.expectedStateHash) {
      throw new MilitaryError(
        'REVISION_CONFLICT',
        '预览后 Host 权威状态已变化；请重新展示 Diff 并确认',
      )
    }
    const supplied = text(action.confirmation, 'recovery confirmation', 512)
    if (supplied !== preview.confirmationPhrase) {
      throw new MilitaryError('POLICY_DENIED', '恢复操作确认短语不匹配')
    }
    const startedAt = new Date().toISOString()
    let changes: readonly string[] = []
    let evidence: readonly string[] = []
    try {
      const result = await this.perform(
        preview.operation,
        preview.operationId,
        preview.scope,
        preview.reason,
        signal,
      )
      changes = result.changes
      evidence = result.evidence
      const receipt: RecoveryOperationReceipt = {
        schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
        operation: preview.operation,
        operationId: preview.operationId,
        scope: preview.scope,
        ...(preview.reason === undefined ? {} : { reason: preview.reason }),
        status: 'COMPLETED',
        changes,
        evidence,
        startedAt,
        completedAt: new Date().toISOString(),
      }
      this.state.putSync(RECOVERY_RECEIPT_NAMESPACE, preview.operationId, receipt, {
        createOnly: true,
      })
      return receipt
    } catch (error) {
      const receipt: RecoveryOperationReceipt = {
        schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
        operation: preview.operation,
        operationId: preview.operationId,
        scope: preview.scope,
        ...(preview.reason === undefined ? {} : { reason: preview.reason }),
        status: 'FAILED',
        changes,
        evidence,
        startedAt,
        completedAt: new Date().toISOString(),
        error: redactDiagnosticText(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 1_000),
      }
      this.state.putSync(RECOVERY_RECEIPT_NAMESPACE, preview.operationId, receipt, {
        createOnly: true,
      })
      return receipt
    }
  }

  private async recoveryStateHash(
    operation: RecoveryOperationKind,
    scope: string,
  ): Promise<string> {
    const tables = operation === 'WAKE_PARENT'
      ? ['military_session_bindings', 'agent_execution_bindings']
      : operation === 'CANCEL_MISSION'
        ? [
            'mission_streams',
            'mission_events',
            'mission_command_operations',
            'mission_command_receipts',
            'mission_runtime_missions',
            'mission_runtime_tasks',
            'agent_execution_bindings',
            'workspace_leases',
            'transactional_outbox',
            'durable_state_records',
          ]
      : operation === 'REQUEUE_STALE_OUTBOX'
        ? ['transactional_outbox', 'outbox_delivery_receipts']
        : operation === 'RELEASE_EXPIRED_RESOURCES'
          ? ['workspace_leases', 'durable_state_records']
          : operation === 'RECONCILE'
            ? [
                'integration_orders',
                'integration_receipts',
                'workspace_leases',
                'workspace_snapshots',
                'candidate_patches',
              ]
            : [
                'mission_streams',
                'mission_runtime_tasks',
                'transactional_outbox',
                'workspace_leases',
                'integration_orders',
                'integration_receipts',
                'durable_state_records',
              ]
    const snapshots: Array<{
      readonly table: string
      readonly rows: readonly unknown[]
    }> = []
    for (const table of tables) {
      const exists = this.host.database.db.prepare(`
        SELECT 1 AS present FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `).get(table)
      if (exists === undefined) continue
      const columns = this.host.database.db.prepare(
        `PRAGMA table_info("${table}")`,
      ).all() as unknown as Array<{ readonly name: string }>
      const predicates: string[] = []
      const parameters: string[] = []
      if (columns.some(value => value.name === 'tenant_id')) {
        predicates.push('tenant_id = ?')
        parameters.push(this.host.tenantId)
      }
      if (operation === 'CANCEL_MISSION'
        && columns.some(value => value.name === 'mission_id')) {
        predicates.push('mission_id = ?')
        parameters.push(scope)
      }
      // The preview and operation receipts are control-plane metadata, not
      // part of the state being previewed. Including the just-written preview
      // would invalidate its own CAS fence immediately.
      if (table === 'durable_state_records') {
        predicates.push('namespace NOT IN (?, ?)')
        parameters.push(
          RECOVERY_PREVIEW_NAMESPACE,
          RECOVERY_RECEIPT_NAMESPACE,
        )
      }
      const where = predicates.length === 0
        ? ''
        : ` WHERE ${predicates.join(' AND ')}`
      const rows = this.host.database.db.prepare(
        `SELECT * FROM "${table}"${where} ORDER BY rowid`,
      ).all(...parameters) as readonly unknown[]
      snapshots.push({ table, rows })
    }
    const cancellationSessions = operation === 'CANCEL_MISSION'
      ? new Set(this.missionExecutionBindings(scope)
          .map(value => String(value.agent.sessionId)))
      : new Set<string>()
    const live = operation === 'WAKE_PARENT' || operation === 'CANCEL_MISSION'
      ? this.ctx.agents?.list()
        .filter(agent => operation === 'WAKE_PARENT'
          || cancellationSessions.has(String(agent.id)))
        .map(agent => ({
          id: String(agent.id),
          parent: String(agent.session.header.parentSession ?? ''),
        })).sort((left, right) => left.id.localeCompare(right.id)) ?? []
      : []
    const backups = operation === 'CREATE_BACKUP'
      || operation === 'VERIFY_BACKUP'
      || operation === 'DRILL_BACKUP_RESTORE'
      ? await this.host.application.production.backups.list(
          this.host.tenantId,
        )
      : []
    return sha256Json({
      tenantId: this.host.tenantId,
      operation,
      scope,
      snapshots,
      live,
      backups,
    })
  }

  private async perform(
    operation: RecoveryOperationKind,
    operationId: string,
    scope: string,
    reason: string | undefined,
    signal: AbortSignal,
  ): Promise<{ readonly changes: readonly string[]; readonly evidence: readonly string[] }> {
    signal.throwIfAborted()
    switch (operation) {
      case 'VERIFY_DATABASE': {
        const rows = this.host.database.db.prepare('PRAGMA integrity_check').all() as
          unknown as Array<Record<string, unknown>>
        const results = rows.flatMap(row => Object.values(row).map(String))
        if (results.length !== 1 || results[0] !== 'ok') {
          throw new Error(`SQLite integrity_check failed: ${results.join('; ')}`)
        }
        return {
          changes: ['数据库未修改。'],
          evidence: ['PRAGMA integrity_check = ok'],
        }
      }
      case 'CREATE_BACKUP': {
        const manifest = await this.host.application.production.backups.create({
          operationId,
          tenantId: this.host.tenantId,
        })
        return {
          changes: [
            `备份 ${manifest.backupId} 状态为 ${manifest.status}。`,
          ],
          evidence: [
            `backup-bytes:${manifest.byteLength}`,
            `backup-sha256:${manifest.sha256}`,
            `backup-source-revision:${manifest.sourceRevision}`,
            ...(manifest.signature === undefined
              ? []
              : [`backup-signature-key:${manifest.signature.keyId}`]),
            ...manifest.evidence,
          ],
        }
      }
      case 'VERIFY_BACKUP': {
        const manifest = await this.host.application.production.backups.verify(
          scope,
          this.host.tenantId,
        )
        return {
          changes: [`备份 ${manifest.backupId} 已验证。`],
          evidence: manifest.evidence,
        }
      }
      case 'DRILL_BACKUP_RESTORE': {
        const manifest = await this.host.application.production.backups
          .restoreDrill(scope, this.host.tenantId)
        if (manifest.status !== 'DRILL_PASSED') {
          throw new Error(
            `backup restore drill failed: ${manifest.error ?? 'unknown'}`,
          )
        }
        return {
          changes: [
            `备份 ${manifest.backupId} 已在隔离临时数据库完成恢复演练；live 数据库未修改。`,
          ],
          evidence: manifest.evidence,
        }
      }
      case 'RECONCILE': {
        const integration = this.host.application.integration as typeof this.host.application.integration & {
          reconcilePending?(signal: AbortSignal): Promise<void>
        }
        if (integration.reconcilePending === undefined) {
          throw new Error('当前 integration provider 未公开 reconcilePending seam')
        }
        await integration.reconcilePending(signal)
        return {
          changes: ['已运行 pending integration reconciliation。'],
          evidence: ['integration.reconcilePending completed'],
        }
      }
      case 'REQUEUE_STALE_OUTBOX': {
        const now = new Date().toISOString()
        const result = this.host.database.transaction(() =>
          this.host.database.db.prepare(`
            UPDATE transactional_outbox
            SET claimed_by = NULL, claimed_until = NULL, available_at = ?
            WHERE tenant_id = ?
              AND delivered_at IS NULL
              AND claimed_until IS NOT NULL
              AND claimed_until < ?
          `).run(now, this.host.tenantId, now))
        return {
          changes: [`释放 ${Number(result.changes)} 个过期 outbox claim。`],
          evidence: [`sqlite-changes:${Number(result.changes)}`, 'delivered_at remained unchanged'],
        }
      }
      case 'RELEASE_EXPIRED_RESOURCES':
        return await this.releaseExpired(signal)
      case 'WAKE_PARENT': {
        const child = this.ctx.agents?.get(scope as DshSessionId)
        if (child === undefined || child.session.header.parentSession === undefined) {
          throw new Error('指定 child 当前不在线或没有直接父级')
        }
        const messageId = await this.host.departmentAgents.report({
          child,
          content: [{
            type: 'text',
            text: 'Military 恢复中心通知：请重新读取权威 Mission、Task、子 Agent receipt 与验证状态，再决定下一步。不要根据本通知直接标记完成。',
          }],
          priority: 'critical',
          idempotencyKey: `recovery-wake:${operationId}`,
          signal,
        })
        return {
          changes: ['已向直接父 General 交付一次 next-step 恢复通知。'],
          evidence: [`session-message:${messageId}`, `child-session:${scope}`],
        }
      }
      case 'CANCEL_MISSION': {
        const missionId = brand<string, 'MissionId'>(scope)
        const cancellationReason = missionCancellationReason(reason)
        const actor = this.missionCancellationActor()
        const cancellationReceiptRef = `mission-cancellation-${sha256(stableJson({
          tenantId: this.host.tenantId,
          missionId: scope,
          reason: cancellationReason,
          principalId: this.host.webPrincipal.principalId,
        })).slice(0, 40)}`
        const snapshot = await this.host.application.ledger.readMission(missionId)
        const command = createMissionCommand({
          tenantId: this.host.tenantId,
          missionId,
          expectedRevision: snapshot.revision,
          actor,
          actorAuthorityRef: `web-principal:${this.host.webPrincipal.principalId}`,
          type: 'mission.cancel',
          payload: {
            reason: cancellationReason,
            cancellationReceiptRef,
          },
          idempotencyKey: cancellationReceiptRef,
        })
        await this.host.application.missionKernel.execute(
          command,
          () => this.host.application.runtime.cancelMission({
            missionId,
            actor,
            reason: cancellationReason,
            cancellationReceiptRef,
          }),
        )

        const bindings = this.missionExecutionBindings(scope)
        const released: string[] = []
        for (const binding of bindings) {
          // Mission cancellation is already committed and irreversible at
          // this point. Browser disconnect/caller abort must not strand
          // Grants, capacity, lifecycle rows or workspaces halfway through
          // convergence; cleanup failures are recorded by the operation
          // receipt and may be retried from a new authoritative preview.
          const childSessionId = String(binding.agent.sessionId)
          const child = this.ctx.agents?.get(childSessionId as DshSessionId)
          if (child !== undefined && this.host.isMilitaryAgent(child)) {
            await this.host.abortMilitaryAgent(
              child,
              `MISSION_CANCELLED:${cancellationReceiptRef}`,
            )
          } else {
            await this.host.forgetDepartmentChild(
              childSessionId,
              `MISSION_CANCELLED:${cancellationReceiptRef}`,
            )
          }
          released.push(childSessionId)
        }
        return {
          changes: [
            `Mission ${scope} 已显式取消；${bindings.length} 个 Activation 资源已收敛。`,
          ],
          evidence: [
            `mission-cancellation-receipt:${cancellationReceiptRef}`,
            `mission-command:${command.commandId}`,
            `released-activation-count:${released.length}`,
            ...released.map(value => `released-child-session:${value}`),
          ],
        }
      }
    }
  }

  private missionExecutionBindings(
    missionId: string,
  ): readonly AgentExecutionBinding[] {
    const rows = this.host.database.db.prepare(`
      SELECT binding_json
      FROM agent_execution_bindings
      WHERE tenant_id = ? AND mission_id = ?
      ORDER BY created_at, binding_id
    `).all(this.host.tenantId, missionId) as unknown as Array<{
      readonly binding_json: string
    }>
    return rows.map(row => JSON.parse(row.binding_json) as AgentExecutionBinding)
  }

  private missionCancellationActor(): AgentIdentity {
    return {
      agentId: brand<string, 'AgentId'>(
        `web-control:${this.host.webPrincipal.principalId}`,
      ),
      sessionId: brand<string, 'SessionId'>(
        `web-operations:${this.host.tenantId}`,
      ),
      role: 'harness',
      displayName: 'Military 本机受治理操作中心',
      generation: 1,
    }
  }

  private async releaseExpired(
    signal: AbortSignal,
  ): Promise<{ readonly changes: readonly string[]; readonly evidence: readonly string[] }> {
    const now = Date.now()
    const changes: string[] = []
    const evidence: string[] = []
    const grants = this.host.database.db.prepare(`
      SELECT record_key, value_json FROM durable_state_records
      WHERE tenant_id = ? AND namespace = 'capability-grant'
    `).all(this.host.tenantId) as unknown as Array<{
      readonly record_key: string
      readonly value_json: string
    }>
    for (const row of grants) {
      signal.throwIfAborted()
      const stored = record(JSON.parse(row.value_json) as unknown, 'capability grant')
      const grant = record(stored.grant ?? stored, 'capability grant value')
      if (grant.state === 'ACTIVE' && Date.parse(String(grant.expiresAt ?? '')) <= now) {
        await this.host.application.capabilityGrants.revoke(row.record_key, 'RECOVERY_EXPIRED')
        changes.push(`撤销过期 Grant ${row.record_key}。`)
        evidence.push(`capability-grant:${row.record_key}`)
      }
    }
    const budgetStateRow = this.host.database.db.prepare(`
      SELECT value_json FROM durable_state_records
      WHERE tenant_id = ? AND namespace = 'resource-budget' AND record_key = 'state'
    `).get(this.host.tenantId) as { readonly value_json: string } | undefined
    if (budgetStateRow !== undefined) {
      const state = record(JSON.parse(budgetStateRow.value_json) as unknown, 'resource budget state')
      const reservations = record(state.reservations ?? {}, 'resource budget reservations')
      for (const [reservationId, candidate] of Object.entries(reservations)) {
        signal.throwIfAborted()
        const reservation = record(candidate, 'resource budget reservation')
        if (reservation.state === 'RESERVED'
          && Date.parse(String(reservation.expiresAt ?? '')) <= now) {
          await this.host.application.resourceBudgets.revoke(reservationId, 'RECOVERY_EXPIRED')
          changes.push(`撤销过期预算 ${reservationId}。`)
          evidence.push(`resource-budget:${reservationId}`)
        }
      }
    }
    const leases = this.host.database.db.prepare(`
      SELECT workspace_lease_id FROM workspace_leases
      WHERE tenant_id = ? AND state = 'ACTIVE' AND expires_at <= ?
    `).all(this.host.tenantId, new Date(now).toISOString()) as unknown as
      Array<{ readonly workspace_lease_id: string }>
    for (const lease of leases) {
      signal.throwIfAborted()
      await this.host.application.workspaces.release(lease.workspace_lease_id)
      changes.push(`释放过期 workspace lease ${lease.workspace_lease_id}。`)
      evidence.push(`workspace-lease:${lease.workspace_lease_id}`)
    }
    if (changes.length === 0) changes.push('没有找到可证明已经到期的资源。')
    return { changes, evidence }
  }

  private databasePath(): string {
    return resolve(
      this.host.config.databasePath
      ?? join(this.host.config.dataRoot, 'military.sqlite'),
    )
  }

}

function recoveryOperation(value: unknown): RecoveryOperationKind {
  const operation = text(value, 'recovery operation', 64)
  if (![
    'VERIFY_DATABASE',
    'CREATE_BACKUP',
    'VERIFY_BACKUP',
    'DRILL_BACKUP_RESTORE',
    'RECONCILE',
    'REQUEUE_STALE_OUTBOX',
    'RELEASE_EXPIRED_RESOURCES',
    'WAKE_PARENT',
    'CANCEL_MISSION',
  ].includes(operation)) throw new TypeError(`unsupported recovery operation ${operation}`)
  return operation as RecoveryOperationKind
}

function operationIdentifier(value: unknown): string {
  const identifier = text(value, 'operationId', 128)
  if (!OPERATION_ID.test(identifier)) throw new TypeError('operationId contains unsupported characters')
  return identifier
}

function recoveryScope(value: unknown): string {
  return text(value, 'recovery scope', 180)
}

function recoveryOperationUsesTarget(
  operation: RecoveryOperationKind,
): boolean {
  return operation === 'WAKE_PARENT'
    || operation === 'VERIFY_BACKUP'
    || operation === 'DRILL_BACKUP_RESTORE'
    || operation === 'CANCEL_MISSION'
}

function confirmationPhrase(operation: RecoveryOperationKind, scope: string): string {
  return `确认 ${operation} ${scope}`
}

function recoveryRisk(operation: RecoveryOperationKind): RecoveryOperationPreview['risk'] {
  if (operation === 'VERIFY_DATABASE'
    || operation === 'CREATE_BACKUP'
    || operation === 'VERIFY_BACKUP'
    || operation === 'DRILL_BACKUP_RESTORE') return 'LOW'
  if (operation === 'WAKE_PARENT' || operation === 'CANCEL_MISSION') return 'HIGH'
  return 'MEDIUM'
}

function missionCancellationReason(value: unknown): string {
  const reason = text(value, 'Mission cancellation reason', 500)
    .trim()
    .replace(/\s+/gu, ' ')
  if (reason.length < 3) {
    throw new TypeError('Mission cancellation reason must contain at least 3 characters')
  }
  return redactDiagnosticText(reason)
}

function sessionUsage(events: readonly SessionEvent[]): {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly errors: number
} {
  let inputTokens = 0
  let outputTokens = 0
  let errors = 0
  for (const event of events) {
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      inputTokens += event.data.usage.inputTokens
        + (event.data.usage.cacheReadTokens ?? 0)
        + (event.data.usage.cacheWriteTokens ?? 0)
      outputTokens += event.data.usage.outputTokens
    }
    if (event.type === 'tool/result'
      && (event.data.message.content[0].isError === true || event.data.error !== undefined)) {
      errors += 1
    }
  }
  return { inputTokens, outputTokens, errors }
}

function asPersistence(value: unknown): PersistenceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PersistenceLike>
  return typeof candidate.inspect === 'function' ? candidate as PersistenceLike : undefined
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function directoryNames(path: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter(value => value.isFile() || value.isDirectory())
      .map(value => value.name)
      .sort()
  } catch {
    return []
  }
}

function groupedCounts(rows: readonly unknown[]): Readonly<Record<string, number>> {
  return Object.fromEntries(rows.map((row) => {
    const value = record(row, 'group count')
    return [String(value.state ?? 'UNKNOWN'), Number(value.count ?? 0)]
  }))
}

function countJsonStates(
  rows: readonly { readonly value_json: string }[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const value = record(JSON.parse(row.value_json) as unknown, 'state record')
    const nested = value.grant === undefined ? value : record(value.grant, 'grant')
    const state = String(nested.state ?? 'UNKNOWN')
    counts[state] = (counts[state] ?? 0) + 1
  }
  return counts
}

function scalarCount(row: unknown): number {
  return Number(record(row, 'count row').count ?? 0)
}

function renderCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts)
  return entries.length === 0
    ? '0'
    : entries.map(([state, count]) => `${state} ${count}`).join('，')
}

function countDetails(counts: Readonly<Record<string, number>>): readonly string[] {
  return Object.entries(counts).map(([state, count]) => `${state}: ${count}`)
}

function sumCounts(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`
  return `${(value / 1_048_576).toFixed(1)} MiB`
}

function ageMs(value: string | null | undefined): number {
  if (value === undefined || value === null) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} 秒`
  if (value < 3_600_000) return `${(value / 60_000).toFixed(1)} 分钟`
  return `${(value / 3_600_000).toFixed(1)} 小时`
}

function sha256Json(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, at: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new TypeError(`${at} must be a non-empty string up to ${maximum} characters`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${at} contains control characters`)
  return value.trim()
}
