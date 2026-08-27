import {
  createElement,
  Fragment,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DiagnosticCategory,
  DiagnosticSeverity,
  MilitaryDiagnosticReport,
  MilitaryOperationsSnapshot,
  RecoveryOperationKind,
  RecoveryOperationPreview,
  RecoveryOperationReceipt,
} from '@dsh-military/contracts/operations-control'
import {
  callMilitaryRpc,
  useMilitaryRefreshLoop,
} from './query-client.js'

interface Props {
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
}

export function MilitaryOperationsCenter({ connection, onResult }: Props): ReactNode {
  const [snapshot, setSnapshot] = useState<MilitaryOperationsSnapshot>()
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [selectedBackupId, setSelectedBackupId] = useState('')
  const [selectedMissionId, setSelectedMissionId] = useState('')
  const [missionCancellationReason, setMissionCancellationReason] = useState('')
  const [timeline, setTimeline] = useState<MilitaryDiagnosticReport>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [taskFilter, setTaskFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [toolFilter, setToolFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [operation, setOperation] = useState<RecoveryOperationKind>('VERIFY_DATABASE')
  const [preview, setPreview] = useState<RecoveryOperationPreview>()
  const [confirmation, setConfirmation] = useState('')
  const [receipt, setReceipt] = useState<RecoveryOperationReceipt>()

  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    try {
      const next = await fetchOperationsSnapshot(connection, signal)
      setSnapshot(next)
      setSelectedSessionId(current =>
        next.sessions.some(value => value.sessionId === current)
          ? current
          : (next.sessions[0]?.sessionId ?? ''))
      setSelectedBackupId(current =>
        next.recovery.production.backups.some(value =>
          value.backupId === current)
          ? current
          : (next.recovery.production.backups[0]?.backupId ?? ''))
      const missionIds = next.missions
        .filter(value => value.state === 'ACTIVE')
        .map(value => value.missionId)
      setSelectedMissionId(current =>
        missionIds.includes(current) ? current : (missionIds[0] ?? ''))
      setError('')
      return true
    } catch (refreshError) {
      if (signal?.aborted !== true) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
      }
      return false
    }
  }, [connection])

  useMilitaryRefreshLoop({
    key: 'military-operations-snapshot',
    refresh,
    intervalMs: 10_000,
  })

  const run = useCallback(async <T,>(operationCall: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined
    setBusy(true)
    setError('')
    try {
      return await operationCall()
    } catch (operationError) {
      const message = operationError instanceof Error
        ? operationError.message
        : String(operationError)
      setError(message)
      onResult(`操作失败：${message}`)
      return undefined
    } finally {
      setBusy(false)
    }
  }, [busy, onResult])

  const loadTimeline = async (): Promise<void> => {
    if (selectedSessionId === '') return
    const value = await run(async () =>
      await dispatchOperationsAction(connection, {
        type: 'SESSION_TIMELINE',
        sessionId: selectedSessionId,
      }) as MilitaryDiagnosticReport)
    if (value !== undefined) {
      setTimeline(value)
      onResult(`已从权威事件和 receipt 重建 ${value.events.length} 条诊断时间线。`)
    }
  }

  const previewRecovery = async (): Promise<void> => {
    const operationId = `recovery-${Date.now().toString(36)}-${randomSuffix()}`
    const scope = operation === 'WAKE_PARENT'
      ? selectedSessionId
      : operation === 'CANCEL_MISSION'
        ? selectedMissionId
      : isBackupTargetOperation(operation)
        ? selectedBackupId
        : undefined
    const value = await run(async () =>
      await dispatchOperationsAction(connection, {
        type: 'PREVIEW_RECOVERY',
        operation,
        operationId,
        ...(scope === undefined ? {} : { scope }),
        ...(operation === 'CANCEL_MISSION'
          ? { reason: missionCancellationReason }
          : {}),
      }) as RecoveryOperationPreview)
    if (value !== undefined) {
      setPreview(value)
      setConfirmation('')
      setReceipt(undefined)
      onResult('Host 已生成受治理恢复预览；尚未执行任何变更。')
    }
  }

  const executeRecovery = async (): Promise<void> => {
    if (preview === undefined) return
    const value = await run(async () =>
      await dispatchOperationsAction(connection, {
        type: 'EXECUTE_RECOVERY',
        operation: preview.operation,
        operationId: preview.operationId,
        scope: preview.scope,
        previewHash: preview.previewHash,
        confirmation,
      }) as RecoveryOperationReceipt)
    if (value !== undefined) {
      setReceipt(value)
      setPreview(undefined)
      setConfirmation('')
      await refresh()
      onResult(`恢复操作 ${value.operation}：${value.status}。`)
    }
  }

  const sessions = snapshot?.sessions ?? []
  const backups = snapshot?.recovery.production.backups ?? []
  const missions = snapshot?.missions.filter(value =>
    value.state === 'ACTIVE') ?? []
  const missionIds = missions.map(value => value.missionId)
  const selected = sessions.find(value => value.sessionId === selectedSessionId)
  const roleIds = unique(sessions.map(value => value.roleId))
  const taskIds = unique(timeline?.events
    .flatMap(value => value.taskId === undefined ? [] : [value.taskId]) ?? [])
  const toolNames = unique(timeline?.events
    .flatMap(value => value.toolName === undefined ? [] : [value.toolName]) ?? [])
  const visibleEvents = useMemo(() => (timeline?.events ?? []).filter(event =>
    (roleFilter === 'all' || event.roleId === roleFilter)
    && (taskFilter === 'all' || event.taskId === taskFilter)
    && (severityFilter === 'all' || event.severity === severityFilter)
    && (toolFilter === 'all' || event.toolName === toolFilter)
    && (categoryFilter === 'all' || event.category === categoryFilter)),
  [categoryFilter, roleFilter, severityFilter, taskFilter, timeline, toolFilter])

  return (
    <div style={stackStyle} data-military-operations-center="true">
      {error === '' ? null : <p role="alert" style={errorStyle}>{error}</p>}
      <section style={cardStyle} aria-labelledby="military-diagnostic-heading">
        <header style={cardHeaderStyle}>
          <div>
            <h3 id="military-diagnostic-heading" style={headingStyle}>Session 诊断时间线</h3>
            <p style={hintStyle}>
              原始选择、Schema 结果、Host 补全、receipt、终止和父级唤醒均来自不可变事件；
              凭据和绝对路径在 Host 端脱敏。
            </p>
          </div>
          <Pill>{sessions.length} Sessions</Pill>
        </header>
        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span>Military Session</span>
            <select
              aria-label="选择诊断 Session"
              value={selectedSessionId}
              onChange={event => {
                setSelectedSessionId(event.target.value)
                setTimeline(undefined)
              }}
            >
              {sessions.length === 0 ? <option value="">没有可诊断 Session</option> : null}
              {sessions.map(session => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.displayName} · {shortId(session.sessionId)} · {session.live ? 'live' : 'cold'}
                </option>
              ))}
            </select>
          </label>
          <div style={metricGridStyle}>
            <Metric label="事件" value={String(selected?.eventCount ?? 0)} />
            <Metric label="错误" value={String(selected?.errorCount ?? 0)} />
            <Metric label="输入 tokens" value={formatNumber(selected?.inputTokens ?? 0)} />
            <Metric label="输出 tokens" value={formatNumber(selected?.outputTokens ?? 0)} />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || selectedSessionId === ''}
          onClick={() => { void loadTimeline() }}
        >
          从权威记录重建时间线
        </Button>
        {timeline === undefined ? null : (
          <Fragment>
            <div style={metricGridStyle}>
              <Metric label="工具调用" value={String(timeline.summary.toolCalls)} />
              <Metric label="成功" value={String(timeline.summary.successfulToolCalls)} />
              <Metric label="失败" value={String(timeline.summary.failedToolCalls)} />
              <Metric label="纠正" value={String(timeline.summary.correctedCalls)} />
              <Metric label="终态调用" value={String(timeline.summary.terminalCalls)} />
              <Metric label="父级唤醒" value={String(timeline.summary.parentWakeups)} />
              <Metric label="模型延迟" value={`${timeline.summary.latencyMs} ms`} />
              <Metric label="费用" value="Provider 价格不可用" />
            </div>
            <div style={filterGridStyle}>
              <FilterSelect
                label="角色"
                value={roleFilter}
                values={roleIds}
                onChange={setRoleFilter}
              />
              <FilterSelect
                label="Task"
                value={taskFilter}
                values={taskIds}
                onChange={setTaskFilter}
              />
              <FilterSelect
                label="严重度"
                value={severityFilter}
                values={['INFO', 'SUCCESS', 'WARNING', 'ERROR'] satisfies readonly DiagnosticSeverity[]}
                onChange={setSeverityFilter}
              />
              <FilterSelect
                label="工具"
                value={toolFilter}
                values={toolNames}
                onChange={setToolFilter}
              />
              <FilterSelect
                label="阶段"
                value={categoryFilter}
                values={[
                  'LIFECYCLE',
                  'MODEL',
                  'TOOL',
                  'AUTHORITY',
                  'WORKSPACE',
                  'RECEIPT',
                  'PARENT_DELIVERY',
                ] satisfies readonly DiagnosticCategory[]}
                onChange={setCategoryFilter}
              />
            </div>
            <ol style={timelineStyle} aria-label="Military Session 诊断事件">
              {visibleEvents.map(event => (
                <li key={event.id} style={timelineItemStyle}>
                  <span aria-hidden="true">
                    <StateDot state={severityDot(event.severity)} />
                  </span>
                  <div style={timelineBodyStyle}>
                    <div style={timelineHeadingStyle}>
                      <strong>{event.title}</strong>
                      <span>seq {event.seq}</span>
                      {event.taskId === undefined
                        ? null
                        : <span>Task {shortId(event.taskId)}</span>}
                      <span>{formatDate(event.occurredAt)}</span>
                    </div>
                    <p style={detailStyle}>{event.detail}</p>
                    {event.rawSelection === undefined ? null : (
                      <details>
                        <summary>Host 脱敏后的模型原始参数</summary>
                        <pre style={preStyle}>{event.rawSelection.arguments}</pre>
                      </details>
                    )}
                    {event.hostCompletion === undefined ? null : (
                      <p style={microStyle}>
                        Host receipt：
                        {event.receiptRef ?? '已观察'} ·
                        arguments {shortId(event.hostCompletion.argumentsHash ?? '—')} ·
                        outcome {shortId(event.hostCompletion.outcomeHash ?? '—')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Fragment>
        )}
      </section>

      <section style={cardStyle} aria-labelledby="military-recovery-heading">
        <header style={cardHeaderStyle}>
          <div>
            <h3 id="military-recovery-heading" style={headingStyle}>受治理安全与恢复</h3>
            <p style={hintStyle}>
              只允许可证明幂等的恢复动作；不开放原始 SQLite 编辑、手工完成或不安全删除。
            </p>
          </div>
          <Pill>
            {snapshot?.recovery.bundleVersion ?? '读取中'} · DSH {snapshot?.recovery.dshRelease ?? 'RC.2'}
          </Pill>
        </header>
        <div style={healthGridStyle}>
          {(snapshot?.recovery.items ?? []).map(item => (
            <article key={item.id} style={healthItemStyle}>
              <div style={timelineHeadingStyle}>
                <strong>{item.label}</strong>
                <StateDot state={healthDot(item.status)} />
              </div>
              <p style={detailStyle}>{item.summary}</p>
              {item.details.length === 0 ? null : (
                <ul style={compactListStyle}>
                  {item.details.slice(0, 4).map(detail => <li key={detail}>{detail}</li>)}
                </ul>
              )}
            </article>
          ))}
        </div>
        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span>恢复操作</span>
            <select
              aria-label="选择受治理恢复操作"
              value={operation}
              onChange={event => {
                setOperation(event.target.value as RecoveryOperationKind)
                setPreview(undefined)
                setConfirmation('')
              }}
            >
              <option value="VERIFY_DATABASE">验证 SQLite 完整性</option>
              <option value="CREATE_BACKUP">创建一致性备份</option>
              <option value="VERIFY_BACKUP">验证已签名备份</option>
              <option value="DRILL_BACKUP_RESTORE">隔离恢复演练</option>
              <option value="RECONCILE">Reconcile 本地 integration</option>
              <option value="REQUEUE_STALE_OUTBOX">重投已过期 Outbox claim</option>
              <option value="RELEASE_EXPIRED_RESOURCES">释放已证明过期资源</option>
              <option value="WAKE_PARENT">唤醒所选 live child 的父级</option>
              <option value="CANCEL_MISSION">显式取消 Mission</option>
            </select>
          </label>
          {operation !== 'WAKE_PARENT' ? null : (
            <p style={hintStyle}>
              作用域：{selectedSessionId === '' ? '未选择 Session' : selectedSessionId}。
              只有 live child 且存在直接父级时 Host 才会执行。
            </p>
          )}
          {operation !== 'CANCEL_MISSION' ? null : (
            <Fragment>
              <label style={fieldStyle}>
                <span>要取消的 Mission</span>
                <select
                  aria-label="选择要显式取消的 Mission"
                  value={selectedMissionId}
                  onChange={event => {
                    setSelectedMissionId(event.target.value)
                    setPreview(undefined)
                    setConfirmation('')
                  }}
                >
                  {missionIds.length === 0 ? (
                    <option value="">暂无绑定 Mission</option>
                  ) : missions.map(value => (
                    <option key={value.missionId} value={value.missionId}>
                      {value.title} · {value.missionId}
                    </option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                <span>取消原因（至少 3 个字符）</span>
                <textarea
                  aria-label="Mission 取消原因"
                  value={missionCancellationReason}
                  maxLength={500}
                  rows={3}
                  onChange={event => {
                    setMissionCancellationReason(event.target.value)
                    setPreview(undefined)
                    setConfirmation('')
                  }}
                />
              </label>
              <p style={hintStyle}>
                这是高风险显式命令：取消非终态 Task、关闭 continuation、释放
                exact Activation 资源，但不会把取消标记为完成，也不会终止稳定
                General identity。必须先预览 CAS Diff，再输入完整确认短语。
              </p>
            </Fragment>
          )}
          {!isBackupTargetOperation(operation) ? null : (
            <label style={fieldStyle}>
              <span>受治理备份</span>
              <select
                aria-label="选择受治理备份"
                value={selectedBackupId}
                onChange={event => {
                  setSelectedBackupId(event.target.value)
                  setPreview(undefined)
                  setConfirmation('')
                }}
              >
                {backups.length === 0 ? (
                  <option value="">暂无备份</option>
                ) : backups.map(value => (
                  <option key={value.backupId} value={value.backupId}>
                    {value.backupId} · {value.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy
            || (operation === 'WAKE_PARENT' && selectedSessionId === '')
            || (operation === 'CANCEL_MISSION'
              && (selectedMissionId === ''
                || missionCancellationReason.trim().length < 3))
            || (isBackupTargetOperation(operation)
              && selectedBackupId === '')}
          onClick={() => { void previewRecovery() }}
        >
          预览作用域与影响
        </Button>
        {preview === undefined ? null : (
          <div style={confirmationStyle} role="group" aria-labelledby="recovery-confirmation-heading">
            <strong id="recovery-confirmation-heading">
              {preview.operation} · {preview.risk} 风险 · {preview.scope}
            </strong>
            <p style={microStyle}>
              状态 fence {shortId(preview.expectedStateHash)} ·
              预览到期 {formatDate(preview.expiresAt)}。状态变化或过期时必须重新预览。
            </p>
            <ul style={compactListStyle}>
              {preview.changes.map(change => <li key={change}>{change}</li>)}
            </ul>
            <p style={microStyle}>{preview.refusedChanges.join(' ')}</p>
            <label style={fieldStyle}>
              <span>输入以下完整确认短语</span>
              <code>{preview.confirmationPhrase}</code>
              <input
                aria-label="恢复操作确认短语"
                value={confirmation}
                autoComplete="off"
                onChange={event => { setConfirmation(event.target.value) }}
              />
            </label>
            <div style={rowStyle}>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || confirmation !== preview.confirmationPhrase}
                onClick={() => { void executeRecovery() }}
              >
                执行并写入审计 receipt
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreview(undefined)
                  setConfirmation('')
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}
        {receipt === undefined ? null : (
          <div role="status" style={receiptStyle}>
            <strong>{receipt.operation} · {receipt.status}</strong>
            <p style={detailStyle}>{receipt.changes.join(' ')}</p>
            <code>{receipt.operationId}</code>
          </div>
        )}
        {(snapshot?.recovery.recentReceipts.length ?? 0) === 0 ? null : (
          <details>
            <summary>最近恢复 receipt</summary>
            <ul style={compactListStyle}>
              {snapshot?.recovery.recentReceipts.map(value => (
                <li key={value.operationId}>
                  {formatDate(value.completedAt)} · {value.operation} · {value.status} ·
                  <code>{value.operationId}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}

export async function fetchOperationsSnapshot(
  connection: Pick<ConnectionHandle, 'rpc'>,
  signal?: AbortSignal,
): Promise<MilitaryOperationsSnapshot> {
  return await callMilitaryRpc<MilitaryOperationsSnapshot>(
    connection,
    'militaryOperations',
    'snapshot',
    {},
    { signal, key: 'military-operations-snapshot' },
  )
}

export async function dispatchOperationsAction(
  connection: Pick<ConnectionHandle, 'rpc'>,
  action: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  return await callMilitaryRpc(
    connection,
    'militaryOperations',
    'execute',
    { action },
    { signal, dedupe: false },
  )
}

function FilterSelect(props: {
  readonly label: string
  readonly value: string
  readonly values: readonly string[]
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <select
        aria-label={`按${props.label}筛选诊断`}
        value={props.value}
        onChange={event => { props.onChange(event.target.value) }}
      >
        <option value="all">全部</option>
        {props.values.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
  )
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div style={metricStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function severityDot(value: DiagnosticSeverity): 'done' | 'error' | 'ongoing' | 'warning' {
  if (value === 'SUCCESS') return 'done'
  if (value === 'ERROR') return 'error'
  if (value === 'WARNING') return 'ongoing'
  return 'ongoing'
}

function healthDot(
  value: NonNullable<MilitaryOperationsSnapshot['recovery']['items'][number]>['status'],
): 'done' | 'error' | 'ongoing' | 'warning' {
  if (value === 'HEALTHY') return 'done'
  if (value === 'BLOCKED') return 'error'
  if (value === 'ATTENTION') return 'ongoing'
  return 'ongoing'
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function isBackupTargetOperation(
  operation: RecoveryOperationKind,
): boolean {
  return operation === 'VERIFY_BACKUP'
    || operation === 'DRILL_BACKUP_RESTORE'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
    : value
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function shortId(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`
}

function randomSuffix(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

const stackStyle: CSSProperties = { display: 'grid', gap: 16 }
const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 16,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
}
const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
}
const headingStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: '22px' }
const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}
const microStyle: CSSProperties = { ...hintStyle, margin: 0 }
const detailStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: '20px' }
const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
  alignItems: 'end',
}
const filterGridStyle: CSSProperties = {
  ...formGridStyle,
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
}
const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
}
const metricGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))',
  gap: 8,
}
const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '8px 10px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  fontSize: 12,
}
const timelineStyle: CSSProperties = {
  display: 'grid',
  gap: 0,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  maxHeight: 560,
  overflow: 'auto',
}
const timelineItemStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr)',
  gap: 8,
  padding: '10px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const timelineBodyStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0 }
const timelineHeadingStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
}
const preStyle: CSSProperties = {
  margin: '6px 0 0',
  padding: 10,
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 11,
}
const healthGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 8,
}
const healthItemStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 6,
  padding: 10,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const compactListStyle: CSSProperties = {
  margin: 0,
  paddingInlineStart: 18,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}
const confirmationStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
}
const receiptStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
}
const errorStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-state-error-primary)',
}
