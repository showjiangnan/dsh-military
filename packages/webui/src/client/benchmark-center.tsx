import {
  createElement,
  useCallback,
  useEffect,
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
  MilitaryBenchmarkRun,
  MilitaryBenchmarkScenarioId,
  MilitaryBenchmarkSnapshot,
  MilitaryProviderSessionSample,
} from '@dsh-military/contracts/benchmark-control'

export function MilitaryBenchmarkCenter(props: {
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
}): ReactNode {
  const [snapshot, setSnapshot] = useState<MilitaryBenchmarkSnapshot>()
  const [run, setRun] = useState<MilitaryBenchmarkRun>()
  const [sample, setSample] = useState<MilitaryProviderSessionSample>()
  const [sessionId, setSessionId] = useState('')
  const [scenarioId, setScenarioId] = useState<MilitaryBenchmarkScenarioId>('READ_ONLY_ANALYSIS')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const next = await fetchBenchmarkSnapshot(props.connection, signal)
      setSnapshot(next)
      setSessionId(current => next.eligibleSessions.some(value =>
        value.sessionId === current)
        ? current
        : next.eligibleSessions[0]?.sessionId ?? '')
      setError('')
    } catch (value) {
      if (signal?.aborted !== true) {
        setError(value instanceof Error ? value.message : String(value))
      }
    }
  }, [props.connection])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => { controller.abort() }
  }, [refresh])

  const execute = async (
    action: Record<string, unknown>,
  ): Promise<unknown | undefined> => {
    if (busy) return undefined
    setBusy(true)
    setError('')
    try {
      const value = await dispatchBenchmarkAction(props.connection, action)
      await refresh()
      return value
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const runDeterministic = async (): Promise<void> => {
    const value = await execute({
      type: 'RUN_DETERMINISTIC',
      operationId: operationId('deterministic'),
    }) as MilitaryBenchmarkRun | undefined
    if (value === undefined) return
    setRun(value)
    props.onResult(`固定数据集 ${value.datasetHash.slice(0, 12)}：确定性合同门 ${value.status}。`)
  }
  const assessSession = async (): Promise<void> => {
    if (sessionId === '') return
    const value = await execute({
      type: 'ASSESS_PROVIDER_SESSION',
      operationId: operationId('provider-session'),
      sessionId,
      scenarioId,
    }) as MilitaryProviderSessionSample | undefined
    if (value === undefined) return
    setSample(value)
    props.onResult(`${value.provider}/${value.model} · ${scenarioId}：已从权威 Session/receipt 形成一份真实样本；N=1 不会被标记为稳定验证。`)
  }

  const latestRun = run ?? snapshot?.runs[0]
  const latestSample = sample ?? snapshot?.providerSamples[0]
  const selectedSession = snapshot?.eligibleSessions.find(value =>
    value.sessionId === sessionId)
  const compatibleScenarios = useMemo(() => (snapshot?.dataset.scenarios ?? [])
    .filter(value => value.roleId === selectedSession?.roleId), [
    selectedSession,
    snapshot,
  ])
  useEffect(() => {
    if (compatibleScenarios.length === 0) return
    if (!compatibleScenarios.some(value => value.id === scenarioId)) {
      setScenarioId(compatibleScenarios[0]!.id)
    }
  }, [compatibleScenarios, scenarioId])

  return (
    <div style={stackStyle} data-military-benchmark-center="true">
      {error === '' ? null : <p role="alert" style={errorStyle}>{error}</p>}
      <section style={cardStyle}>
        <div style={headerStyle}>
          <div>
            <h3 style={headingStyle}>固定数据集的确定性合同门</h3>
            <p style={hintStyle}>
              数据集、角色 revision、exact model、推理、预算与 ToolProfile 都被冻结。
              此门不调用模型、不收费，也不会冒充真实 Provider 表现。
            </p>
          </div>
          <Pill>{snapshot?.dataset.version ?? '加载中'}</Pill>
        </div>
        <code style={hashStyle}>dataset sha256: {snapshot?.dataset.hash ?? '—'}</code>
        <div style={scenarioGridStyle}>
          {snapshot?.dataset.scenarios.map(value => {
            const result = latestRun?.cases.find(item => item.scenarioId === value.id)
            return (
              <article key={value.id} style={scenarioStyle}>
                <div style={headerStyle}>
                  <strong>{value.label}</strong>
                  <Pill>
                    <StateDot state={result?.status === 'PASSED'
                      ? 'done'
                      : result?.status === 'FAILED' ? 'error' : 'warning'} />
                    {result?.status ?? '未运行'}
                  </Pill>
                </div>
                <p style={hintStyle}>{value.description}</p>
                <small>{value.roleId} · {value.requiredTools.join(' / ')}</small>
                {result === undefined ? null : (
                  <details>
                    <summary>确定性证据</summary>
                    <ul style={listStyle}>
                      {result.checks.map(check => (
                        <li key={check.id}>{check.status} · {check.id} · {check.evidence}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            )
          })}
        </div>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => {
          void runDeterministic()
        }}>
          {busy ? '运行中…' : '运行全部 9 个确定性场景'}
        </Button>
        {latestRun === undefined ? null : (
          <p style={hintStyle}>
            {latestRun.status} · bundle {latestRun.bundleVersion} · preset
            {' '}{latestRun.presetGeneration} · DSH {latestRun.dshRelease} ·
            {latestRun.roleConfigurations.length} 个冻结角色配置。
          </p>
        )}
      </section>

      <section style={cardStyle}>
        <div>
          <h3 style={headingStyle}>真实 Provider Session 样本</h3>
          <p style={hintStyle}>
            这里不发起付费调用。选择已经真实运行的 Military Session，Host 从 immutable
            request header、原始工具选择、结果、observed receipt、终态和父级报告评估；
            不允许手工填写“通过”。每个 exact configuration × 场景至少 10 个唯一
            Session，且 95% Wilson 区间宽度不超过 35pp，才显示稳定性结论。
          </p>
        </div>
        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span>已有真实 Session</span>
            <select value={sessionId} onChange={event => setSessionId(event.target.value)}>
              {(snapshot?.eligibleSessions.length ?? 0) === 0
                ? <option value="">没有可评估 Session</option>
                : null}
              {snapshot?.eligibleSessions.map(value => (
                <option key={value.sessionId} value={value.sessionId}>
                  {value.roleId} · {value.provider}/{value.model} · {short(value.sessionId)}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            <span>固定场景</span>
            <select
              value={scenarioId}
              disabled={compatibleScenarios.length === 0}
              onChange={event => setScenarioId(event.target.value as MilitaryBenchmarkScenarioId)}
            >
              {compatibleScenarios.map(value => (
                <option key={value.id} value={value.id}>{value.label}</option>
              ))}
            </select>
          </label>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || sessionId === '' || compatibleScenarios.length === 0}
          onClick={() => { void assessSession() }}
        >
          从权威记录生成样本
        </Button>
        {latestSample === undefined ? null : (
          <article style={sampleStyle}>
            <div style={headerStyle}>
              <strong>{latestSample.provider}/{latestSample.model} · {latestSample.scenarioId}</strong>
              <Pill>
                <StateDot state={latestSample.status === 'PASSED' ? 'done' : 'error'} />
                {latestSample.status}
              </Pill>
            </div>
            <div style={metricsStyle}>
              <Metric label="首调用命中" value={yesNo(latestSample.firstCallHit)} />
              <Metric label="首次 Schema" value={yesNo(latestSample.schemaFirstPass)} />
              <Metric label="自动纠正" value={yesNo(latestSample.corrected)} />
              <Metric label="完成" value={yesNo(latestSample.completed)} />
              <Metric label="父级唤醒" value={yesNo(latestSample.parentWakeup)} />
              <Metric label="写入 receipt" value={String(latestSample.writeReceiptCount)} />
              <Metric label="Tokens" value={`${latestSample.inputTokens}/${latestSample.outputTokens}`} />
              <Metric label="延迟" value={`${latestSample.latencyMs} ms`} />
            </div>
            <p style={hintStyle}>
              {latestSample.aliasStatus} · role revision {latestSample.roleRevision} ·
              {' '}{latestSample.toolProfileRef} · 价格不可用。
            </p>
          </article>
        )}
        {(snapshot?.providerStability.length ?? 0) === 0 ? null : (
          <div style={listGridStyle}>
            {snapshot?.providerStability.map(value => (
              <div key={`${value.exactRoute}:${value.scenarioId}`} style={stabilityStyle}>
                <strong>{value.exactRoute}</strong>
                <span>{value.scenarioId}</span>
                <span>
                  N={value.sampleCount}/{value.uniqueSessionCount} ·
                  {' '}{(value.passRate * 100).toFixed(1)}% · 95% CI
                  {' '}[{(value.confidenceInterval.low * 100).toFixed(1)}%,
                  {' '}{(value.confidenceInterval.high * 100).toFixed(1)}%]
                </span>
                <Pill>{value.conclusion}</Pill>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

async function fetchBenchmarkSnapshot(
  connection: Pick<ConnectionHandle, 'rpc'>,
  signal?: AbortSignal,
): Promise<MilitaryBenchmarkSnapshot> {
  const response = await connection.rpc.call(
    '/api',
    'militaryBenchmark/snapshot',
    { args: {} },
    signal,
  )
  if (!response.ok) throw new Error(response.error.message)
  return response.value as MilitaryBenchmarkSnapshot
}

async function dispatchBenchmarkAction(
  connection: Pick<ConnectionHandle, 'rpc'>,
  action: Record<string, unknown>,
): Promise<unknown> {
  const response = await connection.rpc.call(
    '/api',
    'militaryBenchmark/execute',
    { args: { action } },
  )
  if (!response.ok) throw new Error(response.error.message)
  return response.value
}

function Metric(props: { readonly label: string; readonly value: string }): ReactNode {
  return <div style={metricStyle}><span>{props.label}</span><strong>{props.value}</strong></div>
}

function operationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2)}`
}

function short(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`
}

function yesNo(value: boolean): string {
  return value ? '是' : '否'
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
  alignItems: 'flex-start',
  gap: 10,
  flexWrap: 'wrap',
}
const headingStyle: CSSProperties = { margin: 0, fontSize: 15 }
const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--dsw-text-muted)',
  fontSize: 12,
  lineHeight: 1.55,
}
const errorStyle: CSSProperties = { margin: 0, color: 'var(--dsw-text-danger)', fontSize: 13 }
const hashStyle: CSSProperties = { overflowWrap: 'anywhere', fontSize: 11 }
const scenarioGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))',
  gap: 8,
}
const scenarioStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
  padding: 10,
  minWidth: 0,
}
const listStyle: CSSProperties = { margin: '6px 0 0', paddingLeft: 18, fontSize: 11 }
const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: 10,
}
const fieldStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0, fontSize: 12 }
const sampleStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  borderRadius: 9,
  background: 'var(--dsw-surface-sunken)',
}
const metricsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 7,
}
const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: 8,
  borderRadius: 7,
  border: '1px solid var(--dsw-border-subtle)',
  fontSize: 11,
}
const listGridStyle: CSSProperties = { display: 'grid', gap: 7 }
const stabilityStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 1fr) minmax(140px, 1fr) auto auto',
  alignItems: 'center',
  gap: 8,
  padding: 8,
  borderRadius: 7,
  border: '1px solid var(--dsw-border-subtle)',
  fontSize: 11,
  overflow: 'hidden',
}
