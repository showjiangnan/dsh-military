import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
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
  type AgentExecutionBinding,
  type MilitaryDiagnosticReport,
  type MilitaryDiagnosticSession,
  type MilitaryOperationsSnapshot,
  type MilitarySessionBinding,
  type RecoveryHealthItem,
  type RecoveryOperationKind,
  type RecoveryOperationPreview,
  type RecoveryOperationReceipt,
} from '@dsh-military/contracts'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import { buildDiagnosticReport } from './session-diagnostics.js'

const RECOVERY_RECEIPT_NAMESPACE = 'military-recovery-operation'
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SOURCE_VERSION = '0.9.0-alpha.24'

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
    signal.throwIfAborted()
    const [sessions, recovery] = await Promise.all([
      this.sessions(signal),
      this.recoveryHealth(signal),
    ])
    return {
      schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
      sessions,
      recovery,
      generatedAt: new Date().toISOString(),
    }
  }

  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<unknown> {
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
    const [databaseBytes, walBytes, backups, worktrees] = await Promise.all([
      fileBytes(databasePath),
      fileBytes(`${databasePath}-wal`),
      directoryNames(join(this.host.config.dataRoot, 'backups')),
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
        SUM(CASE WHEN delivered_at IS NULL THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN delivered_at IS NULL AND claimed_until IS NOT NULL
          AND claimed_until < ? THEN 1 ELSE 0 END) AS stale
      FROM transactional_outbox WHERE tenant_id = ?
    `).get(new Date().toISOString(), this.host.tenantId) as
      | { readonly pending?: number; readonly stale?: number }
      | undefined
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
        details: backups.slice(-3).map(name => safeFileLabel(name)),
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
        status: Number(outbox?.stale ?? 0) > 0 ? 'ATTENTION' : 'HEALTHY',
        summary: `${Number(outbox?.pending ?? 0)} 待投递，${Number(outbox?.stale ?? 0)} 过期 claim`,
        count: Number(outbox?.pending ?? 0),
        details: ['只能释放已过期 claim；不会伪造 delivered 状态。'],
      },
    ]
    return {
      databasePathLabel: basename(databasePath),
      dataRootLabel: basename(resolve(this.host.config.dataRoot)),
      bundleVersion: SOURCE_VERSION,
      dshRelease: '0.1.1-rc.2',
      dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      items,
      recentReceipts: [...this.state.listSync<RecoveryOperationReceipt>(
        RECOVERY_RECEIPT_NAMESPACE,
      )].sort((left, right) => right.completedAt.localeCompare(left.completedAt)).slice(0, 20),
    }
  }

  private async previewRecovery(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RecoveryOperationPreview> {
    signal.throwIfAborted()
    const operation = recoveryOperation(action.operation)
    const operationId = operationIdentifier(action.operationId)
    const scope = operation === 'WAKE_PARENT'
      ? recoveryScope(action.scope)
      : `tenant:${this.host.tenantId}`
    const changes = await this.plannedChanges(operation, scope)
    return {
      schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
      operation,
      operationId,
      scope,
      confirmationPhrase: confirmationPhrase(operation, scope),
      risk: recoveryRisk(operation),
      changes,
      refusedChanges: [
        '不会直接编辑任意 SQLite 字段或删除历史。',
        '不会标记 Mission、Task、验证或子 Agent 为完成。',
        '不会删除无法由过期 lease/claim 证明安全的 worktree 或文件。',
      ],
      idempotent: true,
      generatedAt: new Date().toISOString(),
    }
  }

  private async plannedChanges(
    operation: RecoveryOperationKind,
    scope: string,
  ): Promise<readonly string[]> {
    switch (operation) {
      case 'VERIFY_DATABASE':
        return ['运行 SQLite integrity_check；只写审计 receipt。']
      case 'CREATE_BACKUP':
        return ['使用 SQLite VACUUM INTO 创建一致性副本；不覆盖已有文件。']
      case 'RECONCILE':
        return ['重放未完成的本地 integration reconciliation；不触发远程 Git 写入。']
      case 'REQUEUE_STALE_OUTBOX':
        return ['仅清除已过期且未 delivered 的 outbox claim，使原事件可重投。']
      case 'RELEASE_EXPIRED_RESOURCES':
        return ['撤销已到期的预算/Grant，并释放已到期的 workspace lease。']
      case 'WAKE_PARENT':
        return [`由 live child ${scope} 发送一次 Host-authored next-step 恢复通知。`]
    }
  }

  private async executeRecovery(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RecoveryOperationReceipt> {
    const preview = await this.previewRecovery(action, signal)
    const supplied = text(action.confirmation, 'recovery confirmation', 512)
    if (supplied !== preview.confirmationPhrase) {
      throw new MilitaryError('POLICY_DENIED', '恢复操作确认短语不匹配')
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
    const startedAt = new Date().toISOString()
    let changes: readonly string[] = []
    let evidence: readonly string[] = []
    try {
      const result = await this.perform(preview.operation, preview.operationId, preview.scope, signal)
      changes = result.changes
      evidence = result.evidence
      const receipt: RecoveryOperationReceipt = {
        schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
        operation: preview.operation,
        operationId: preview.operationId,
        scope: preview.scope,
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
        status: 'FAILED',
        changes,
        evidence,
        startedAt,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }
      this.state.putSync(RECOVERY_RECEIPT_NAMESPACE, preview.operationId, receipt, {
        createOnly: true,
      })
      return receipt
    }
  }

  private async perform(
    operation: RecoveryOperationKind,
    operationId: string,
    scope: string,
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
        const directory = join(this.host.config.dataRoot, 'backups')
        await mkdir(directory, { recursive: true })
        const target = join(directory, `military-${operationId}.sqlite`)
        const previousBytes = await fileBytes(target)
        if (previousBytes === 0) {
          this.host.database.db.prepare('VACUUM INTO ?').run(target)
        }
        const bytes = await fileBytes(target)
        if (bytes === 0) throw new Error('SQLite backup was not created')
        this.verifyBackup(target)
        const digest = await fileSha256(target)
        return {
          changes: [
            previousBytes === 0
              ? `创建 ${safeFileLabel(basename(target))}`
              : `复用同一 operationId 已创建的 ${safeFileLabel(basename(target))}`,
          ],
          evidence: [
            `backup-bytes:${bytes}`,
            `backup-sha256:${digest}`,
            'sqlite-vacuum-into-consistent-snapshot',
            'backup-integrity-check:ok',
          ],
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
      this.host.database.db.prepare(`
        UPDATE workspace_leases
        SET state = 'RELEASED', lease_version = lease_version + 1
        WHERE tenant_id = ? AND workspace_lease_id = ?
          AND state = 'ACTIVE' AND expires_at <= ?
      `).run(this.host.tenantId, lease.workspace_lease_id, new Date(now).toISOString())
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

  private verifyBackup(path: string): void {
    this.host.database.db.prepare('ATTACH DATABASE ? AS military_recovery_backup').run(path)
    try {
      const rows = this.host.database.db
        .prepare('PRAGMA military_recovery_backup.integrity_check')
        .all() as unknown as Array<Record<string, unknown>>
      const values = rows.flatMap(row => Object.values(row).map(String))
      if (values.length !== 1 || values[0] !== 'ok') {
        throw new Error(`SQLite backup integrity_check failed: ${values.join('; ')}`)
      }
    } finally {
      this.host.database.db.exec('DETACH DATABASE military_recovery_backup')
    }
  }
}

function recoveryOperation(value: unknown): RecoveryOperationKind {
  const operation = text(value, 'recovery operation', 64)
  if (![
    'VERIFY_DATABASE',
    'CREATE_BACKUP',
    'RECONCILE',
    'REQUEUE_STALE_OUTBOX',
    'RELEASE_EXPIRED_RESOURCES',
    'WAKE_PARENT',
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

function confirmationPhrase(operation: RecoveryOperationKind, scope: string): string {
  return `确认 ${operation} ${scope}`
}

function recoveryRisk(operation: RecoveryOperationKind): RecoveryOperationPreview['risk'] {
  if (operation === 'VERIFY_DATABASE' || operation === 'CREATE_BACKUP') return 'LOW'
  if (operation === 'WAKE_PARENT') return 'HIGH'
  return 'MEDIUM'
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

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
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

function safeFileLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]+/gu, '＿').slice(0, 160)
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`
  return `${(value / 1_048_576).toFixed(1)} MiB`
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
