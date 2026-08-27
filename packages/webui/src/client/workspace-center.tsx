import {
  createElement,
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
  MilitaryWorkspaceSnapshot,
  MilitaryWorkspaceStatus,
} from '@dsh-military/contracts/workspace-control'
import {
  callMilitaryRpc,
  useMilitaryRefreshLoop,
} from './query-client.js'

export function MilitaryWorkspaceCenter(props: {
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
}): ReactNode {
  const [snapshot, setSnapshot] = useState<MilitaryWorkspaceSnapshot>()
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<MilitaryWorkspaceStatus>()
  const [scopeFilter, setScopeFilter] = useState('all')
  const [gitFilter, setGitFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    try {
      const next = await fetchWorkspaceSnapshot(props.connection, signal)
      setSnapshot(next)
      setSelectedId(current => next.workspaces.some(value =>
        value.workspaceId === current)
        ? current
        : next.workspaces[0]?.workspaceId ?? '')
      setError('')
      return true
    } catch (value) {
      if (signal?.aborted !== true) {
        setError(value instanceof Error ? value.message : String(value))
      }
      return false
    }
  }, [props.connection])

  useMilitaryRefreshLoop({
    key: 'military-workspace-snapshot',
    refresh,
    intervalMs: 15_000,
  })

  const inspect = async (): Promise<void> => {
    if (selectedId === '' || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await inspectWorkspace(props.connection, selectedId)
      setStatus(next)
      props.onResult(`${next.workspace.label}：Host 已从 canonicalization、Git 与 receipt 执行链重建只读状态。`)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setBusy(false)
    }
  }

  const paths = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    return (status?.pathEntries ?? []).filter(value =>
      (scopeFilter === 'all' || value.scope === scopeFilter)
      && (gitFilter === 'all' || value.gitState === gitFilter)
      && (normalized === '' || value.path.toLocaleLowerCase('zh-CN').includes(normalized)))
  }, [gitFilter, query, scopeFilter, status])
  const selected = snapshot?.workspaces.find(value => value.workspaceId === selectedId)

  return (
    <div style={stackStyle} data-military-workspace-center="true">
      {error === '' ? null : <p role="alert" style={errorStyle}>{error}</p>}
      <section style={cardStyle}>
        <div style={headerStyle}>
          <div>
            <h3 style={headingStyle}>权威 Specs 工作区</h3>
            <p style={hintStyle}>
              RC.2 没有可供插件调用的原生目录选择 seam，因此这里只允许选择已经由
              Military Session 绑定并经 Host realpath 验证的目录；浏览器不能提交任意绝对路径。
            </p>
          </div>
          <Pill>{snapshot?.workspaces.length ?? 0} 个目录</Pill>
        </div>
        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span>Session 工作区</span>
            <select
              aria-label="选择 Military Specs 工作区"
              value={selectedId}
              onChange={event => {
                setSelectedId(event.target.value)
                setStatus(undefined)
              }}
            >
              {(snapshot?.workspaces.length ?? 0) === 0
                ? <option value="">没有已绑定工作区</option>
                : null}
              {snapshot?.workspaces.map(value => (
                <option
                  key={value.workspaceId}
                  value={value.workspaceId}
                  disabled={!value.available}
                >
                  {value.label} · {value.repository ? 'Git' : '非 Git'} · {value.sessionIds.length} Sessions
                </option>
              ))}
            </select>
          </label>
          <div style={rootStyle}>
            <span>Host canonical root</span>
            <code title={selected?.canonicalRoot}>{selected?.canonicalRoot ?? '—'}</code>
            <small>hash {selected?.rootPathHash.slice(0, 16) ?? '—'}</small>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || selectedId === ''}
          onClick={() => { void inspect() }}
        >
          {busy ? '读取中…' : '读取权威 Git / Scope / Receipt'}
        </Button>
      </section>

      {status === undefined ? null : (
        <section style={cardStyle} aria-labelledby="military-workspace-status-heading">
          <div style={headerStyle}>
            <div>
              <h3 id="military-workspace-status-heading" style={headingStyle}>当前状态</h3>
              <p style={hintStyle}>{status.git.summary}</p>
            </div>
            <Pill>
              <StateDot state={status.git.available ? 'done' : 'warning'} />
              {status.git.available ? `${status.git.branch} · ${short(status.git.head)}` : '非 Git'}
            </Pill>
          </div>
          <div style={metricsStyle}>
            <Metric label="Git HEAD" value={short(status.git.head)} />
            <Metric label="Tree" value={short(status.git.tree)} />
            <Metric label="Dirty" value={String(status.git.dirty)} />
            <Metric label="Untracked" value={String(status.git.untracked)} />
            <Metric label="Worktree / Lease" value={String(status.leases.length)} />
            <Metric label="Candidate / Integration" value={String(status.integrations.length)} />
          </div>
          <div style={formGridStyle}>
            <label style={fieldStyle}>
              <span>搜索路径</span>
              <input value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <Filter
              label="Scope"
              value={scopeFilter}
              values={['READ_WRITE', 'READ_ONLY', 'FORBIDDEN', 'SPECS_DEFAULT', 'UNSCOPED']}
              onChange={setScopeFilter}
            />
            <Filter
              label="Git"
              value={gitFilter}
              values={['MODIFIED', 'ADDED', 'DELETED', 'RENAMED', 'UNTRACKED', 'CLEAN']}
              onChange={setGitFilter}
            />
          </div>
          <div style={tableShellStyle}>
            <table style={tableStyle}>
              <thead>
                <tr><th>路径</th><th>类型</th><th>Git</th><th>权威 Scope</th><th>解释</th></tr>
              </thead>
              <tbody>
                {paths.map(value => (
                  <tr key={value.path}>
                    <td><code>{value.path}</code></td>
                    <td>{value.kind}</td>
                    <td>{value.gitState}</td>
                    <td>{value.scope}</td>
                    <td>{value.scopeReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status.truncatedPathCount === 0
            ? null
            : <p style={hintStyle}>另有 {status.truncatedPathCount} 个路径未展开；Host 上限为 500。</p>}
        </section>
      )}

      {status === undefined || status.leases.length === 0 ? null : (
        <section style={cardStyle}>
          <h3 style={headingStyle}>Lease、worktree 与实际角色路径</h3>
          <div style={listStyle}>
            {status.leases.map(value => (
              <article key={value.leaseId} style={itemStyle}>
                <div style={headerStyle}>
                  <strong>{value.roleId} · Task {value.taskId}@{value.taskVersion}</strong>
                  <Pill>{value.mode} · {value.state}</Pill>
                </div>
                <p style={hintStyle}>
                  read: {value.readPaths.join('、') || '无'}；
                  write: {value.writePaths.join('、') || '无'}；
                  forbidden: {value.forbiddenPaths.join('、') || '无'}。
                </p>
                <code>{value.worktreeLabel === undefined ? value.leaseId : `worktree ${value.worktreeLabel}`}</code>
              </article>
            ))}
          </div>
        </section>
      )}

      {status === undefined || status.integrations.length === 0 ? null : (
        <section style={cardStyle}>
          <h3 style={headingStyle}>Candidate、integration 与最近 receipt</h3>
          <div style={listStyle}>
            {status.integrations.map(value => (
              <article key={value.integrationOrderId} style={itemStyle}>
                <div style={headerStyle}>
                  <strong>Task {value.taskId}@{value.taskVersion}</strong>
                  <Pill>{value.disposition ?? value.state}</Pill>
                </div>
                <p style={hintStyle}>
                  Candidate {value.candidatePatchId} · order {value.integrationOrderId}
                  {value.receiptId === undefined ? '' : ` · receipt ${value.receiptId}`}
                </p>
                <p style={hintStyle}>
                  {short(value.beforeHead)} → {short(value.afterHead ?? value.commit)}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

async function fetchWorkspaceSnapshot(
  connection: Pick<ConnectionHandle, 'rpc'>,
  signal?: AbortSignal,
): Promise<MilitaryWorkspaceSnapshot> {
  return await callMilitaryRpc<MilitaryWorkspaceSnapshot>(
    connection,
    'militaryWorkspace',
    'snapshot',
    {},
    { signal, key: 'military-workspace-snapshot' },
  )
}

async function inspectWorkspace(
  connection: Pick<ConnectionHandle, 'rpc'>,
  workspaceId: string,
): Promise<MilitaryWorkspaceStatus> {
  return await callMilitaryRpc<MilitaryWorkspaceStatus>(
    connection,
    'militaryWorkspace',
    'execute',
    { action: { type: 'INSPECT_WORKSPACE', workspaceId } },
    { dedupe: false },
  )
}

function Filter(props: {
  readonly label: string
  readonly value: string
  readonly values: readonly string[]
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <select value={props.value} onChange={event => props.onChange(event.target.value)}>
        <option value="all">全部</option>
        {props.values.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
  )
}

function Metric(props: { readonly label: string; readonly value: string }): ReactNode {
  return <div style={metricStyle}><span>{props.label}</span><strong>{props.value}</strong></div>
}

function short(value: string | undefined): string {
  return value === undefined || value === '' ? '—' : value.slice(0, 12)
}

const stackStyle: CSSProperties = { display: 'grid', gap: 14 }
const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 12,
  padding: 16,
  background: 'var(--dsw-surface-elevated)',
}
const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
}
const headingStyle: CSSProperties = { margin: 0, fontSize: 15 }
const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--dsw-text-muted)',
  fontSize: 12,
  lineHeight: 1.55,
}
const errorStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-text-danger)',
  fontSize: 13,
}
const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: 10,
}
const fieldStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0, fontSize: 12 }
const rootStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
  fontSize: 12,
  overflow: 'hidden',
}
const metricsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 8,
}
const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  borderRadius: 8,
  padding: 9,
  background: 'var(--dsw-surface-sunken)',
  minWidth: 0,
  fontSize: 11,
}
const tableShellStyle: CSSProperties = {
  overflow: 'auto',
  maxHeight: 360,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
}
const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
  textAlign: 'left',
}
const listStyle: CSSProperties = { display: 'grid', gap: 8 }
const itemStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
  padding: 10,
  minWidth: 0,
}
