import {
  createElement,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconQueueOutline14,
  Modal,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MilitaryRuntimeCenterSnapshot,
  MilitaryRuntimeNode,
  MilitaryRuntimeNodeKind,
} from '@dsh-military/contracts'
import { useDialogFocus } from './dialog-accessibility.js'
import { callMilitaryRpc, useMilitaryQuery } from './query-client.js'
import { Notice } from './ui-adapter.js'

let runtimeOpen = false
let runtimeReturnFocus: HTMLElement | null = null
const runtimeListeners = new Set<() => void>()

export function openMilitaryRuntimeCenter(): void {
  runtimeOpen = true
  for (const listener of runtimeListeners) listener()
}

export function closeMilitaryRuntimeCenter(): void {
  runtimeOpen = false
  for (const listener of runtimeListeners) listener()
  const target = runtimeReturnFocus
  runtimeReturnFocus = null
  globalThis.queueMicrotask(() => { target?.focus() })
}

export function MilitaryRuntimeTrigger(
  { wide }: { readonly wide: boolean },
): ReactNode {
  const open = useMilitaryRuntimeOpen()
  return (
    <button
      type="button"
      title="Military Session 运行中心"
      aria-label="打开 Military Session 运行中心"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={event => {
        runtimeReturnFocus = event.currentTarget
        openMilitaryRuntimeCenter()
      }}
      data-military-runtime-trigger="true"
      data-wide={String(wide)}
    >
      <IconQueueOutline14 size={wide ? 16 : 18} />
      {wide ? <span className="dshm-trigger-label">Session 运行中心</span> : null}
    </button>
  )
}

export function MilitaryRuntimeOverlay(props: {
  readonly connection: ConnectionHandle
}): ReactNode {
  const open = useMilitaryRuntimeOpen()
  useDialogFocus(open, '.dshm-runtime-dialog')
  return (
    <Modal
      open={open}
      onClose={closeMilitaryRuntimeCenter}
      title="Military Session 运行中心"
      closeLabel="关闭 Military Session 运行中心"
      className="dshm-runtime-dialog"
      headless
    >
      <MilitaryRuntimeCenter
        connection={props.connection}
        enabled={open}
      />
    </Modal>
  )
}

function MilitaryRuntimeCenter(props: {
  readonly connection: ConnectionHandle
  readonly enabled: boolean
}): ReactNode {
  const load = useCallback(async (signal: AbortSignal) =>
    await callMilitaryRpc<MilitaryRuntimeCenterSnapshot>(
      props.connection,
      'militaryRuntime',
      'snapshot',
      {},
      { signal, key: 'military-runtime-snapshot' },
    ), [props.connection])
  const revision = useCallback(
    (value: MilitaryRuntimeCenterSnapshot) =>
      value.projection.sourceRevision,
    [],
  )
  const query = useMilitaryQuery({
    key: 'military-runtime-snapshot',
    load,
    revision,
    intervalMs: 3_000,
    enabled: props.enabled,
  })
  const snapshot = query.data
  const roots = useMemo(
    () => snapshot?.nodes.filter(value => value.kind === 'REQUEST') ?? [],
    [snapshot],
  )
  const unbound = useMemo(
    () => snapshot?.nodes.filter(value =>
      value.kind !== 'REQUEST'
      && !hasAncestor(value, roots, snapshot.nodes)) ?? [],
    [roots, snapshot],
  )
  return (
    <section
      data-military-runtime-center="true"
      aria-busy={query.loading}
      lang="zh-CN"
      style={shellStyle}
    >
      <header style={toolbarStyle}>
        <div>
          <h2 style={headingStyle}>权威执行链</h2>
          <p style={hintStyle}>
            Request → Mission → Direction → Wave → Task → Attempt / Activation /
            Dispatch → Candidate / Verification / Integration。此页面只展示 Host
            canonical state，不从模型正文推断完成。
          </p>
        </div>
        <div style={rowStyle}>
          <Pill>
            <StateDot state={projectionDot(snapshot, query.stale)} />
            {query.offline
              ? '离线快照'
              : query.stale
                ? '快照已陈旧'
                : snapshot?.projection.health ?? '读取中'}
          </Pill>
          <Button
            variant="outline"
            size="sm"
            disabled={query.loading}
            onClick={() => { void query.refresh() }}
          >
            立即刷新
          </Button>
        </div>
      </header>

      {query.error === undefined ? null : (
        <Notice title="运行投影读取失败" tone="error" state="error">
          <span>{query.error.message}</span>
          <span>最后一次成功快照仍被保留，未被错误或较旧响应覆盖。</span>
        </Notice>
      )}
      {snapshot === undefined ? (
        <p role="status" style={emptyStyle}>正在读取运行投影…</p>
      ) : (
        <div style={contentsStyle}>
          <section style={summaryGridStyle} aria-label="运行摘要">
            <RuntimeMetric label="Source revision" value={snapshot.projection.sourceRevision} />
            <RuntimeMetric label="执行节点" value={snapshot.nodes.length} />
            <RuntimeMetric label="Radio / Decision" value={snapshot.queues.length} />
            <RuntimeMetric label="Outbox 待投递" value={snapshot.outbox.pending} />
            <RuntimeMetric label="Outbox Dead letter" value={snapshot.outbox.deadLettered} />
            <RuntimeMetric label="Budget scopes" value={snapshot.budgets.length} />
          </section>
          <p role="note" style={microStyle}>
            权限边界：{snapshot.authority.tenancyMode} ·
            {' '}{snapshot.authority.authoritySource} · principal
            {' '}<code>{snapshot.authority.principalId}</code>。DSH RC.2
            未向插件 Remote 暴露逐请求认证主体，此状态不代表多租户鉴权。
          </p>

          <section style={panelStyle} aria-labelledby="runtime-pipeline-heading">
            <header style={panelHeaderStyle}>
              <h3 id="runtime-pipeline-heading" style={subheadingStyle}>请求执行树</h3>
              <span style={microStyle}>
                generated {formatDate(snapshot.projection.generatedAt)} · stale after
                {' '}{formatDate(snapshot.projection.staleAfter)}
              </span>
            </header>
            {roots.length === 0 && unbound.length === 0 ? (
              <p style={emptyStyle}>尚无 Military Workflow Obligation。</p>
            ) : (
              <div style={treeStyle}>
                {roots.map(root => (
                  <RuntimeTree
                    key={root.id}
                    node={root}
                    nodes={snapshot.nodes}
                    depth={0}
                  />
                ))}
                {unbound.length === 0 ? null : (
                  <details>
                    <summary>尚未绑定到当前 Request 的 canonical 节点（{unbound.length}）</summary>
                    {unbound.map(node => (
                      <RuntimeNodeRow key={node.id} node={node} depth={0} />
                    ))}
                  </details>
                )}
              </div>
            )}
          </section>

          <div style={twoColumnStyle}>
            <section style={panelStyle} aria-labelledby="runtime-queue-heading">
              <h3 id="runtime-queue-heading" style={subheadingStyle}>Radio 与 Decision</h3>
              {snapshot.queues.length === 0 ? (
                <p style={emptyStyle}>当前没有排队、投递中或待确认项。</p>
              ) : snapshot.queues.map(value => (
                <article key={`${value.kind}:${value.id}`} style={itemStyle}>
                  <div style={rowStyle}>
                    <strong>{value.kind}</strong>
                    <Pill>{value.state}</Pill>
                    {value.priority === undefined ? null : <Pill>{value.priority}</Pill>}
                  </div>
                  <code>{value.id}</code>
                  <p style={microStyle}>
                    Mission {value.missionId}
                    {value.taskId === undefined ? '' : ` · Task ${value.taskId}`}
                    {value.attemptId === undefined ? '' : ` · Attempt ${value.attemptId}`}
                  </p>
                  <p style={microStyle}>
                    更新 {formatDate(value.updatedAt)}
                    {value.expiresAt === undefined
                      ? ''
                      : ` · 到期 ${formatDate(value.expiresAt)}`}
                  </p>
                </article>
              ))}
            </section>

            <section style={panelStyle} aria-labelledby="runtime-budget-heading">
              <h3 id="runtime-budget-heading" style={subheadingStyle}>预算与 Outbox</h3>
              <p style={microStyle}>
                pending {snapshot.outbox.pending} · claimed {snapshot.outbox.claimed} ·
                dead-letter {snapshot.outbox.deadLettered}
                {snapshot.outbox.oldestPendingAt === undefined
                  ? ''
                  : ` · oldest ${formatDate(snapshot.outbox.oldestPendingAt)}`}
              </p>
              {snapshot.budgets.length === 0 ? (
                <p style={emptyStyle}>尚无已建立的预算 scope。</p>
              ) : snapshot.budgets.map(value => (
                <details key={value.scope} style={itemStyle}>
                  <summary>{value.scope} · {value.status}</summary>
                  <pre style={preStyle}>
                    {JSON.stringify({
                      consumed: value.consumed,
                      reserved: value.reserved,
                    }, null, 2)}
                  </pre>
                </details>
              ))}
            </section>
          </div>

          <section style={panelStyle} aria-labelledby="runtime-receipts-heading">
            <h3 id="runtime-receipts-heading" style={subheadingStyle}>最近权威 Receipt / Event</h3>
            <ol style={receiptListStyle}>
              {snapshot.receipts.slice(0, 80).map(value => (
                <li key={`${value.kind}:${value.id}:${value.updatedAt}`}>
                  <time dateTime={value.updatedAt}>{formatDate(value.updatedAt)}</time>
                  {' · '}{value.kind} · {value.state} · <code>{value.id}</code>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </section>
  )
}

function RuntimeTree(props: {
  readonly node: MilitaryRuntimeNode
  readonly nodes: readonly MilitaryRuntimeNode[]
  readonly depth: number
}): ReactNode {
  const children = props.nodes.filter(value => value.parentId === props.node.id)
  return (
    <div role="group">
      <RuntimeNodeRow node={props.node} depth={props.depth} />
      {children.map(child => (
        <RuntimeTree
          key={child.id}
          node={child}
          nodes={props.nodes}
          depth={props.depth + 1}
        />
      ))}
    </div>
  )
}

function RuntimeNodeRow(props: {
  readonly node: MilitaryRuntimeNode
  readonly depth: number
}): ReactNode {
  return (
    <article
      style={{
        ...nodeStyle,
        marginInlineStart: Math.min(6, props.depth) * 20,
      }}
      data-runtime-node-kind={props.node.kind}
    >
      <div style={rowStyle}>
        <Pill>{runtimeKindLabel(props.node.kind)}</Pill>
        <strong>{props.node.label}</strong>
        <Pill>{props.node.state}</Pill>
      </div>
      <p style={microStyle}>
        revision {props.node.revision} · {formatDate(props.node.updatedAt)} ·
        {' '}<code>{props.node.id}</code>
      </p>
      {props.node.nextTool === undefined ? null : (
        <p style={microStyle}>唯一 nextTool：<code>{props.node.nextTool}</code></p>
      )}
      {props.node.receiptRefs.length === 0 ? null : (
        <p style={microStyle}>
          receipts：{props.node.receiptRefs.map(value =>
            <code key={value}>{value} </code>)}
        </p>
      )}
    </article>
  )
}

function RuntimeMetric(props: {
  readonly label: string
  readonly value: string | number
}): ReactNode {
  return (
    <div style={metricStyle}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function hasAncestor(
  node: MilitaryRuntimeNode,
  roots: readonly MilitaryRuntimeNode[],
  nodes: readonly MilitaryRuntimeNode[],
): boolean {
  let current: MilitaryRuntimeNode | undefined = node
  const visited = new Set<string>()
  while (current?.parentId !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    if (roots.some(root => root.id === current?.parentId)) return true
    current = nodes.find(value => value.id === current?.parentId)
  }
  return false
}

function runtimeKindLabel(kind: MilitaryRuntimeNodeKind): string {
  const labels: Record<MilitaryRuntimeNodeKind, string> = {
    REQUEST: 'Request',
    MISSION: 'Mission',
    DIRECTION: 'Direction',
    WAVE: 'Wave',
    TASK: 'Task',
    ATTEMPT: 'Attempt',
    ACTIVATION: 'Activation',
    DISPATCH: 'Dispatch',
    CANDIDATE: 'Candidate',
    VERIFICATION: 'Verification',
    INTEGRATION: 'Integration',
  }
  return labels[kind]
}

function projectionDot(
  snapshot: MilitaryRuntimeCenterSnapshot | undefined,
  stale: boolean,
): 'done' | 'error' | 'ongoing' | 'warning' {
  if (stale) return 'warning'
  if (snapshot?.projection.health === 'BLOCKED') return 'error'
  if (snapshot?.projection.health === 'DEGRADED') return 'warning'
  return snapshot === undefined ? 'ongoing' : 'done'
}

function useMilitaryRuntimeOpen(): boolean {
  return useSyncExternalStore(
    listener => {
      runtimeListeners.add(listener)
      return () => { runtimeListeners.delete(listener) }
    },
    () => runtimeOpen,
    () => false,
  )
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(parsed)
    : value
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
  maxHeight: 'min(820px, calc(100vh - 96px))',
  overflow: 'auto',
  padding: 20,
}
const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
}
const headingStyle: CSSProperties = { margin: 0, fontSize: 20 }
const subheadingStyle: CSSProperties = { margin: 0, fontSize: 15 }
const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--dsw-alias-label-secondary)',
}
const microStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  overflowWrap: 'anywhere',
}
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}
const summaryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
  gap: 8,
}
const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: 10,
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const panelStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
}
const panelHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
}
const treeStyle: CSSProperties = { display: 'grid', gap: 6 }
const nodeStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
  padding: 8,
  borderInlineStart: '2px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-2)',
}
const twoColumnStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
  gap: 12,
}
const itemStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 8,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const errorStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 10,
  border: '1px solid var(--dsw-alias-state-error-primary)',
  borderRadius: 10,
  background: 'var(--dsw-alias-state-error-bg)',
}
const emptyStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  color: 'var(--dsw-alias-label-secondary)',
}

const contentsStyle: CSSProperties = { display: 'contents' }
const preStyle: CSSProperties = {
  maxHeight: 180,
  overflow: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
}
const receiptListStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  maxHeight: 260,
  overflow: 'auto',
  margin: 0,
  paddingInlineStart: 24,
}
