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
  EvaluationCenterSnapshot,
  EvaluationNumericInterval,
  EvaluationReportRevisionSummary,
  FrozenEvaluationDataset,
  MilitaryPerformanceReport,
  PerformanceEvaluationAppeal,
} from '@dsh-military/contracts'
import { MilitaryBenchmarkCenter } from './benchmark-center.js'

type ViewId =
  | 'overview'
  | 'comparisons'
  | 'scenarios'
  | 'funnel'
  | 'economics'
  | 'evidence'
  | 'history'

const VIEWS: readonly {
  readonly id: ViewId
  readonly label: string
}[] = [
  { id: 'overview', label: '决策总览' },
  { id: 'comparisons', label: '角色 / 模型比较' },
  { id: 'scenarios', label: '九场景热力图' },
  { id: 'funnel', label: '工具调用漏斗' },
  { id: 'economics', label: '成本 / 延迟 Pareto' },
  { id: 'evidence', label: '数据与 Evidence' },
  { id: 'history', label: '历史 / 申诉 / 实验' },
]

/** Host-owned Workspace/Mission catalog; the browser cannot invent paths. */
export function EvaluationCatalogSelectors(props: {
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly workspaceKeys: readonly string[]
  readonly missionIds: readonly string[]
  readonly onWorkspaces: (values: readonly string[]) => void
  readonly onMissions: (values: readonly string[]) => void
  readonly onError: (message: string) => void
}): ReactNode {
  const [catalog, setCatalog] = useState<EvaluationCenterSnapshot['catalog']>()
  useEffect(() => {
    const controller = new AbortController()
    void evaluationSnapshot(props.connection, controller.signal)
      .then(value => setCatalog(value.catalog))
      .catch(failure => {
        if (!controller.signal.aborted) props.onError(messageOf(failure))
      })
    return () => controller.abort()
  }, [props.connection, props.onError])
  return (
    <div style={formGridStyle}>
      <label style={fieldStyle}>
        <span>Host 已绑定工作区（可多选；留空为全部）</span>
        <select
          multiple
          size={Math.min(5, Math.max(2, catalog?.workspaces.length ?? 2))}
          value={[...props.workspaceKeys]}
          onChange={event => props.onWorkspaces(
            [...event.currentTarget.selectedOptions].map(option =>
              option.value),
          )}
        >
          {catalog?.workspaces.map(item => (
            <option key={item.workspaceKey} value={item.workspaceKey}>
              {item.label} · {item.sessionCount} Sessions
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        <span>Host 已知 Mission（可多选；留空为全部）</span>
        <select
          multiple
          size={Math.min(5, Math.max(2, catalog?.missions.length ?? 2))}
          value={[...props.missionIds]}
          onChange={event => props.onMissions(
            [...event.currentTarget.selectedOptions].map(option =>
              option.value),
          )}
        >
          {catalog?.missions.map(item => (
            <option key={item.missionId} value={item.missionId}>
              {item.label} · {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function MilitaryEvaluationCenter(props: {
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
  /**
   * Settings execution is owned by the Host scope. Its state transition must
   * invalidate this independent Remote projection so a completed background
   * job becomes visible without closing and reopening the dialog.
   */
  readonly refreshToken?: string
}): ReactNode {
  const [snapshot, setSnapshot] = useState<EvaluationCenterSnapshot>()
  const [report, setReport] = useState<MilitaryPerformanceReport | null>(null)
  const [dataset, setDataset] = useState<FrozenEvaluationDataset>()
  const [view, setView] = useState<ViewId>('overview')
  const [selectedReport, setSelectedReport] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const next = await evaluationSnapshot(props.connection, signal)
      setSnapshot(next)
      const latest = next.reports.find(item => item.state === 'CURRENT')
        ?? next.reports[0]
      setSelectedReport(latest === undefined ? '' : reportKey(latest))
      setReport(next.latestReport)
      setDataset(undefined)
      setError('')
    } catch (failure) {
      if (signal?.aborted !== true) setError(messageOf(failure))
    }
  }, [props.connection])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => { controller.abort() }
  }, [props.refreshToken, refresh])

  useEffect(() => {
    const summary = snapshot?.reports.find(item =>
      reportKey(item) === selectedReport)
    if (summary === undefined) return
    const controller = new AbortController()
    void evaluationAction(props.connection, {
      type: 'GET_REPORT',
      operationId: operationId('get-report'),
      reportId: String(summary.reportId),
      reportRevision: Number(summary.reportRevision),
    }, controller.signal).then(value => {
      setReport(value as MilitaryPerformanceReport)
      setDataset(undefined)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(messageOf(failure))
    })
    return () => { controller.abort() }
  }, [props.connection, selectedReport, snapshot?.reports])

  useEffect(() => {
    if (
      report === null
      || (view !== 'evidence' && view !== 'history')
      || dataset !== undefined
    ) return
    const controller = new AbortController()
    void evaluationAction(props.connection, {
      type: 'GET_DATASET',
      operationId: operationId('get-dataset'),
      reportId: String(report.reportId),
      reportRevision: Number(report.reportRevision),
    }, controller.signal).then(value => {
      const wrapped = value as { readonly dataset: FrozenEvaluationDataset }
      setDataset(wrapped.dataset)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(messageOf(failure))
    })
    return () => { controller.abort() }
  }, [dataset, props.connection, report, view])

  const execute = async (
    action: Record<string, unknown>,
    success: string,
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await evaluationAction(props.connection, action)
      await refresh()
      props.onResult(success)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const currentSummary = snapshot?.reports.find(item =>
    reportKey(item) === selectedReport)

  return (
    <div style={stackStyle} data-military-evaluation-center="true">
      {error === '' ? null : <p role="alert" style={errorStyle}>{error}</p>}
      <section style={cardStyle}>
        <div style={headerStyle}>
          <div>
            <h3 style={headingStyle}>绩效评估决策中心</h3>
            <p style={hintStyle}>
              所有指标来自同一冻结数据集，并按 exact execution configuration
              分层。评估只能提出 Canary / 晋升建议，不能自动更改默认模型。
            </p>
          </div>
          <DecisionPill report={report} />
        </div>
        <div style={toolbarStyle}>
          <label style={fieldStyle}>
            <span>不可变报告修订</span>
            <select
              aria-label="选择绩效评估报告修订"
              value={selectedReport}
              onChange={event => setSelectedReport(event.target.value)}
            >
              {(snapshot?.reports.length ?? 0) === 0
                ? <option value="">尚无报告</option>
                : null}
              {snapshot?.reports.map(item => (
                <option key={reportKey(item)} value={reportKey(item)}>
                  {item.state} · {short(String(item.reportId))} ·
                  r{Number(item.reportRevision)} · {item.decisionStatus}
                </option>
              ))}
            </select>
          </label>
          <span style={hashStyle}>
            dataset {currentSummary?.datasetHash.slice(0, 16)
              ?? report?.datasetHash.slice(0, 16)
              ?? '—'}
          </span>
        </div>
        <div
          role="tablist"
          aria-label="绩效评估决策中心视图"
          style={tabsStyle}
        >
          {VIEWS.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              style={{
                ...tabStyle,
                ...(view === item.id ? activeTabStyle : {}),
              }}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {view === 'overview'
        ? <Overview
            report={report}
            snapshot={snapshot}
            busy={busy}
            onRunAction={(type, id) => {
              void execute({
                type,
                operationId: operationId(
                  type === 'RETRY_RUN' ? 'retry-run' : 'cancel-run',
                ),
                evaluationRequestId: id,
              }, type === 'RETRY_RUN'
                ? '评估任务已从冻结数据集继续执行。'
                : '评估任务已取消。')
            }}
          />
        : null}
      {view === 'comparisons' ? <Comparisons report={report} /> : null}
      {view === 'scenarios'
        ? <MilitaryBenchmarkCenter
            connection={props.connection}
            onResult={props.onResult}
          />
        : null}
      {view === 'funnel' ? <ToolFunnel report={report} /> : null}
      {view === 'economics' ? <Economics report={report} /> : null}
      {view === 'evidence'
        ? <Evidence report={report} dataset={dataset} />
        : null}
      {view === 'history'
        ? <HistoryAndAppeals
            report={report}
            dataset={dataset}
            snapshot={snapshot}
            busy={busy}
            onExecute={execute}
          />
        : null}
    </div>
  )
}

function Overview(props: {
  readonly report: MilitaryPerformanceReport | null
  readonly snapshot: EvaluationCenterSnapshot | undefined
  readonly busy: boolean
  readonly onRunAction: (
    type: 'CANCEL_RUN' | 'RETRY_RUN',
    evaluationRequestId: string,
  ) => void
}): ReactNode {
  const report = props.report
  if (report === null) {
    return <Empty text="尚无绩效评估报告。运行评估后，这里会显示数据充分性和决策门。" />
  }
  return (
    <section style={cardStyle}>
      <div style={metricGridStyle}>
        <Metric label="唯一 Mission" value={String(report.dataQuality.uniqueMissions)} />
        <Metric label="唯一 Attempt" value={String(report.dataQuality.uniqueAttempts)} />
        <Metric label="Mission 完成率" value={percent(report.overallPerformance.missionCompletionRate)} />
        <Metric label="Task 最终验收率" value={percent(report.overallPerformance.taskFinalAcceptanceRate)} />
        <Metric label="跨部门交接率" value={percent(report.overallPerformance.crossDepartmentHandoffRate)} />
        <Metric label="父级 / 恢复检查" value={percent(report.overallPerformance.freezeRecoveryRate)} />
      </div>
      <div style={decisionBoxStyle}>
        <strong>{decisionLabel(report.decision.status)}</strong>
        <span>{report.decision.recommendation}</span>
        <small>promotionAllowed = false（始终需要显式治理批准）</small>
      </div>
      {report.decision.blockers.length === 0 ? (
        <p style={successStyle}>当前没有新增决策阻断项；这仍不等于自动晋升。</p>
      ) : (
        <div>
          <h4 style={subheadingStyle}>晋升阻断原因</h4>
          <ul style={listStyle}>
            {report.decision.blockers.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      <div>
        <h4 style={subheadingStyle}>委员会分析</h4>
        <ul style={listStyle}>
          {report.overallPerformance.analysisPoints.map(item =>
            <li key={item}>{item}</li>)}
        </ul>
      </div>
      {(props.snapshot?.runs ?? []).filter(run =>
        run.state !== 'COMPLETED' && run.state !== 'CANCELLED').map(run => (
        <div key={String(run.evaluationRequestId)} style={runStyle}>
          <div>
            <span>
              {String(run.evaluationRequestId)} · {run.state} ·
              {' '}{run.templatesCompleted}/{run.templatesTotal}
            </span>
            {run.failure === undefined ? null : (
              <small style={blockStyle}>
                {run.failure.code} · {run.failure.message} ·
                {' '}{run.failure.retryable ? '可从已完成分片重试' : '需要修正请求'}
              </small>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={props.busy || (
              run.state === 'FAILED' && run.failure?.retryable !== true
            )}
            onClick={() => props.onRunAction(
              run.state === 'FAILED' ? 'RETRY_RUN' : 'CANCEL_RUN',
              String(run.evaluationRequestId),
            )}
          >
            {run.state === 'FAILED' ? '从冻结分片重试' : '取消'}
          </Button>
        </div>
      ))}
    </section>
  )
}

function Comparisons(props: {
  readonly report: MilitaryPerformanceReport | null
}): ReactNode {
  const report = props.report
  if (report === null) return <Empty text="尚无报告。" />
  return (
    <section style={cardStyle}>
      <h3 style={headingStyle}>Flash / Pro 受控比较</h3>
      <p style={hintStyle}>
        只比较同角色、任务类型和预执行难度可比的 exact route。质量和安全硬门
        先于成本；观察性结果不会被表述为因果结论。
      </p>
      {report.comparisons.length === 0
        ? <Empty text="当前没有可验证的 Flash / Pro 配对；请收集同角色、同难度样本。" />
        : report.comparisons.map(item => (
            <article key={item.comparisonId} style={comparisonStyle}>
              <div style={headerStyle}>
                <strong>{item.role} · {item.design}</strong>
                <Pill>
                  <StateDot state={item.decision === 'DECISION_ELIGIBLE'
                    ? 'done'
                    : item.decision === 'REGRESSION_ALERT'
                      ? 'error'
                      : 'warning'} />
                  {decisionLabel(item.decision)}
                </Pill>
              </div>
              <div style={metricGridStyle}>
                <Metric
                  label="Flash 最终验收"
                  value={interval(item.quality.candidateFinalAcceptance)}
                />
                <Metric
                  label="Pro 最终验收"
                  value={interval(item.quality.baselineFinalAcceptance)}
                />
                <Metric
                  label="差异区间"
                  value={`${signedPercent(item.quality.difference.estimate)} [${signedPercent(item.quality.difference.low)}, ${signedPercent(item.quality.difference.high)}]`}
                />
                <Metric
                  label="非劣界限"
                  value={`${item.quality.nonInferior ? '通过' : '未通过'} · -${percent(item.quality.nonInferiorityMargin)}`}
                />
                <Metric
                  label="协变量平衡"
                  value={item.covariateBalance.balanced ? '通过' : '未通过'}
                />
                <Metric
                  label="安全硬门"
                  value={item.safety.hardGatePassed ? '通过' : '阻断'}
                />
              </div>
              <details>
                <summary>配置、样本与阻断细节</summary>
                <p style={hashStyle}>candidate: {printableKey(item.candidateConfigurationKey)}</p>
                <p style={hashStyle}>baseline: {printableKey(item.baselineConfigurationKey)}</p>
                <p style={hintStyle}>
                  Candidate N={item.sample.candidateAttempts} /
                  Missions={item.sample.candidateMissions}；Baseline
                  N={item.sample.baselineAttempts} /
                  Missions={item.sample.baselineMissions}。
                </p>
                <ul style={listStyle}>
                  {[...item.covariateBalance.notes, ...item.blockers].map(value =>
                    <li key={value}>{value}</li>)}
                </ul>
              </details>
            </article>
          ))}
    </section>
  )
}

function ToolFunnel(props: {
  readonly report: MilitaryPerformanceReport | null
}): ReactNode {
  const report = props.report
  if (report === null) return <Empty text="尚无报告。" />
  const total = report.dataQuality.uniqueAttempts
  const stageCounts = aggregateFailures(report)
  const rows = [
    ['进入 Attempt', total],
    ['任务合同可执行', total - count(stageCounts, ['TASK_ORDER_AMBIGUITY'])],
    ['工具选择正确', total - count(stageCounts, [
      'TASK_ORDER_AMBIGUITY',
      'MODEL_TOOL_SELECTION',
    ])],
    ['参数 Schema 通过', total - count(stageCounts, [
      'TASK_ORDER_AMBIGUITY',
      'MODEL_TOOL_SELECTION',
      'MODEL_ARGUMENT_SCHEMA',
    ])],
    ['Host / 权限 / 路径通过', total - count(stageCounts, [
      'TASK_ORDER_AMBIGUITY',
      'MODEL_TOOL_SELECTION',
      'MODEL_ARGUMENT_SCHEMA',
      'HOST_VALIDATION',
      'PERMISSION_DENIED',
      'PATH_SCOPE_REJECTION',
    ])],
    ['工具与 Workspace 运行成功', total - count(stageCounts, [
      'TASK_ORDER_AMBIGUITY',
      'MODEL_TOOL_SELECTION',
      'MODEL_ARGUMENT_SCHEMA',
      'HOST_VALIDATION',
      'PERMISSION_DENIED',
      'PATH_SCOPE_REJECTION',
      'TOOL_RUNTIME',
      'WORKSPACE_STATE',
    ])],
    ['最终验收', Math.round(
      report.overallPerformance.taskFinalAcceptanceRate * total,
    )],
  ] as const
  return (
    <section style={cardStyle}>
      <h3 style={headingStyle}>工具调用与验收漏斗</h3>
      <p style={hintStyle}>
        失败按首次权威阶段归因；不会把权限拒绝、路径拒绝或 Provider 故障误记为
        模型参数 Schema 错误。
      </p>
      <div style={funnelStyle}>
        {rows.map(([label, rawCount]) => {
          const value = Math.max(0, rawCount)
          return (
            <div key={label} style={funnelRowStyle}>
              <span>{label}</span>
              <div style={barTrackStyle}>
                <span style={{
                  ...barStyle,
                  width: `${total === 0 ? 0 : value / total * 100}%`,
                }} />
              </div>
              <strong>{value}/{total}</strong>
            </div>
          )
        })}
      </div>
      <details>
        <summary>阶段失败明细</summary>
        <div style={metricGridStyle}>
          {Object.entries(stageCounts)
            .sort(([, left], [, right]) => right - left)
            .map(([stage, value]) =>
              <Metric key={stage} label={stage} value={String(value)} />)}
        </div>
      </details>
    </section>
  )
}

function Economics(props: {
  readonly report: MilitaryPerformanceReport | null
}): ReactNode {
  const report = props.report
  if (report === null) return <Empty text="尚无报告。" />
  const frontier = paretoStatuses(report.individualPerformance)
  return (
    <section style={cardStyle}>
      <h3 style={headingStyle}>Accepted Outcome 成本 / 延迟 Pareto</h3>
      <p style={hintStyle}>
        每个最终验收结果包含同一 Mission/Task 下的失败尝试、返工和重试。
        Provider 价格未知时显示“不可用”，不会用 0 美元参与排序。
      </p>
      <div style={tableShellStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>角色 / exact route</th>
              <th>验收结果</th>
              <th>Tokens / 结果</th>
              <th>成本 / 结果</th>
              <th>p50 / p95 延迟</th>
              <th>质量区间</th>
              <th>数据资格</th>
              <th>Pareto</th>
            </tr>
          </thead>
          <tbody>
            {[...report.individualPerformance]
              .sort((left, right) =>
                right.accuracy.finalAcceptanceRate
                  - left.accuracy.finalAcceptanceRate
                || left.efficiency.meanTokensPerAcceptedOutcome
                  - right.efficiency.meanTokensPerAcceptedOutcome)
              .map(item => (
                <tr key={item.template.configurationKey}>
                  <td>
                    <strong>{item.template.role}</strong>
                    <small style={blockStyle}>
                      {item.template.provider}/{item.template.model}
                    </small>
                  </td>
                  <td>{item.efficiency.acceptedOutcomeCount}</td>
                  <td>
                    {formatNumber(item.efficiency.meanTokensPerAcceptedOutcome)}
                    <small style={blockStyle}>
                      {numericInterval(
                        item.efficiency.intervals.tokensPerAcceptedOutcome,
                      )}
                    </small>
                  </td>
                  <td>
                    {cost(item)}
                    <small style={blockStyle}>
                      {item.efficiency.intervals.costPerAcceptedOutcomeUsd
                        === undefined
                        ? '价格不可用，无成本区间'
                        : numericInterval(
                            item.efficiency.intervals
                              .costPerAcceptedOutcomeUsd,
                            6,
                          )}
                    </small>
                  </td>
                  <td>
                    {item.efficiency.p50LatencySeconds.toFixed(2)}s /
                    {' '}{item.efficiency.p95LatencySeconds.toFixed(2)}s
                    <small style={blockStyle}>
                      均值 {numericInterval(
                        item.efficiency.intervals
                          .latencyPerAcceptedOutcomeSeconds,
                        2,
                      )}
                    </small>
                  </td>
                  <td>{interval(item.accuracy.intervals.finalAcceptance)}</td>
                  <td>{item.status}</td>
                  <td>{paretoLabel(frontier.get(
                    item.template.configurationKey,
                  ))}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Evidence(props: {
  readonly report: MilitaryPerformanceReport | null
  readonly dataset: FrozenEvaluationDataset | undefined
}): ReactNode {
  if (props.report === null) return <Empty text="尚无报告。" />
  const dataset = props.dataset
  if (dataset === undefined) return <Empty text="正在校验并加载冻结数据集…" />
  return (
    <section style={cardStyle}>
      <div style={metricGridStyle}>
        <Metric label="Dataset hash" value={short(String(dataset.datasetHash))} />
        <Metric label="纳入 Session" value={String(dataset.includedSessions.length)} />
        <Metric label="排除 Session" value={String(dataset.excludedSessions.length)} />
        <Metric label="申诉排除 Attempt" value={String(dataset.excludedAttempts.length)} />
        <Metric label="Strata" value={String(dataset.strata.length)} />
        <Metric label="来源引用" value={String(dataset.sourceArtifactRefs.length)} />
      </div>
      <details open>
        <summary>纳入 / 排除与缺失机制</summary>
        <ul style={listStyle}>
          {dataset.missingness.length === 0
            ? <li>未记录结构性缺失。</li>
            : dataset.missingness.map(item => (
                <li key={`${item.field}:${item.mechanism}`}>
                  {item.field}: {item.count}（{item.mechanism}）
                </li>
              ))}
          {dataset.excludedAttempts.map(item => (
            <li key={item.attemptId}>
              排除 {short(item.attemptId)}：{item.details}
            </li>
          ))}
        </ul>
      </details>
      <div style={tableShellStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th>Attempt</th>
              <th>Mission / Task</th>
              <th>Exact route</th>
              <th>版本 / lease</th>
              <th>结果</th>
              <th>失败阶段</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {dataset.attempts.map(item => (
              <tr key={item.attemptId}>
                <td title={item.attemptId}>{short(item.attemptId)}</td>
                <td>{short(item.identity.missionId)} / {short(item.identity.taskId)}</td>
                <td>
                  {item.configuration.provider}/{item.configuration.model}
                  <small style={blockStyle}>
                    {item.configuration.aliasStatus}
                  </small>
                </td>
                <td>v{item.identity.taskVersion} / {item.identity.leaseSeq}</td>
                <td>{item.outcome.finalAccepted ? '已验收' : item.outcome.completed ? '已完成' : '未完成'}</td>
                <td>{item.failure.stage}</td>
                <td>{item.evidenceRefs.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function HistoryAndAppeals(props: {
  readonly report: MilitaryPerformanceReport | null
  readonly dataset: FrozenEvaluationDataset | undefined
  readonly snapshot: EvaluationCenterSnapshot | undefined
  readonly busy: boolean
  readonly onExecute: (
    action: Record<string, unknown>,
    success: string,
  ) => Promise<void>
}): ReactNode {
  const [statement, setStatement] = useState('')
  const [grounds, setGrounds] =
    useState<PerformanceEvaluationAppeal['grounds']>('ATTRIBUTION_ERROR')
  const [remedy, setRemedy] =
    useState<PerformanceEvaluationAppeal['requestedRemedy']>('RECOMPUTE_DATASET')
  const [evidenceRefs, setEvidenceRefs] = useState('')
  const [excluded, setExcluded] = useState<readonly string[]>([])
  const report = props.report
  const submit = async (): Promise<void> => {
    if (report === null || statement.trim().length === 0) return
    await props.onExecute({
      type: 'SUBMIT_APPEAL',
      operationId: operationId('submit-appeal'),
      reportId: String(report.reportId),
      reportRevision: Number(report.reportRevision),
      grounds,
      statement,
      requestedRemedy: remedy,
      findingPath: '/decision',
      excludedAttemptIds: excluded,
      evidenceRefs: splitList(evidenceRefs),
    }, '申诉已提交；原报告保持不可变。')
    setStatement('')
    setEvidenceRefs('')
    setExcluded([])
  }
  return (
    <div style={stackStyle}>
      <section style={cardStyle}>
        <h3 style={headingStyle}>不可变报告链</h3>
        {(props.snapshot?.reports.length ?? 0) === 0
          ? <Empty text="尚无报告历史。" />
          : props.snapshot?.reports.map(item => (
              <div key={reportKey(item)} style={lineageStyle}>
                <div>
                  <strong>{item.state} · {short(String(item.reportId))}</strong>
                  <small style={blockStyle}>
                    revision {Number(item.reportRevision)} · {item.decisionStatus} ·
                    {' '}N={item.uniqueAttempts} / Missions={item.uniqueMissions}
                  </small>
                </div>
                <span style={hashStyle}>{item.datasetHash.slice(0, 16)}</span>
              </div>
            ))}
      </section>
      <section style={cardStyle}>
        <h3 style={headingStyle}>提交数据 / 归因申诉</h3>
        <p style={hintStyle}>
          申诉不会原地修改旧报告。勾选的错误 Attempt 只会进入新的冻结请求；
          复算成功后发布 superseding report，并保留双向 lineage。
        </p>
        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span>申诉理由</span>
            <select value={grounds} onChange={event => {
              setGrounds(event.target.value as PerformanceEvaluationAppeal['grounds'])
            }}>
              <option value="DATASET_ERROR">数据集错误</option>
              <option value="RUBRIC_ERROR">Rubric 错误</option>
              <option value="ATTRIBUTION_ERROR">归因错误</option>
              <option value="MISSING_CONTEXT">上下文缺失</option>
              <option value="OTHER">其他</option>
            </select>
          </label>
          <label style={fieldStyle}>
            <span>请求处置</span>
            <select value={remedy} onChange={event => {
              setRemedy(event.target.value as PerformanceEvaluationAppeal['requestedRemedy'])
            }}>
              <option value="RECOMPUTE_DATASET">重建数据集</option>
              <option value="RE_EVALUATE_TEMPLATE">重评配置</option>
              <option value="RE_SYNTHESIZE_REPORT">重写叙事</option>
              <option value="ANNOTATE_REPORT">追加注释</option>
              <option value="NO_CHANGE_REVIEW">只复核</option>
            </select>
          </label>
        </div>
        <label style={fieldStyle}>
          <span>事实说明（必填）</span>
          <textarea
            value={statement}
            rows={4}
            maxLength={4000}
            onChange={event => setStatement(event.target.value)}
          />
        </label>
        <label style={fieldStyle}>
          <span>附加 Evidence 引用（逗号或换行分隔）</span>
          <input
            value={evidenceRefs}
            onChange={event => setEvidenceRefs(event.target.value)}
          />
        </label>
        {(props.dataset?.attempts.length ?? 0) === 0 ? null : (
          <details>
            <summary>标记要在替代数据集中排除的错误 Attempt（{excluded.length}）</summary>
            <div style={checkGridStyle}>
              {props.dataset?.attempts.map(item => (
                <label key={item.attemptId} style={checkStyle}>
                  <input
                    type="checkbox"
                    checked={excluded.includes(item.attemptId)}
                    onChange={event => setExcluded(current =>
                      event.target.checked
                        ? [...new Set([...current, item.attemptId])]
                        : current.filter(value => value !== item.attemptId))}
                  />
                  <span>
                    {short(item.attemptId)} · {item.failure.stage} ·
                    {' '}{item.outcome.finalAccepted ? '已验收' : '未验收'}
                  </span>
                </label>
              ))}
            </div>
          </details>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={props.busy || report === null || statement.trim().length === 0}
          onClick={() => { void submit() }}
        >
          提交不可变申诉
        </Button>
      </section>
      <section style={cardStyle}>
        <h3 style={headingStyle}>申诉与改进实验</h3>
        {(props.snapshot?.appeals.length ?? 0) === 0
          ? <Empty text="尚无申诉。" />
          : props.snapshot?.appeals.map(appeal => (
              <AppealRow
                key={appeal.appealId}
                appeal={appeal}
                busy={props.busy}
                onExecute={props.onExecute}
              />
            ))}
      </section>
    </div>
  )
}

function AppealRow(props: {
  readonly appeal: PerformanceEvaluationAppeal
  readonly busy: boolean
  readonly onExecute: (
    action: Record<string, unknown>,
    success: string,
  ) => Promise<void>
}): ReactNode {
  const appeal = props.appeal
  const actionable = appeal.state === 'SUBMITTED'
    || appeal.state === 'UNDER_REVIEW'
  return (
    <article style={appealStyle}>
      <div style={headerStyle}>
        <div>
          <strong>{appeal.grounds} · {appeal.state}</strong>
          <p style={hintStyle}>{appeal.statement}</p>
        </div>
        <Pill>{appeal.requestedRemedy}</Pill>
      </div>
      <small>
        {short(appeal.reportId)} r{Number(appeal.reportRevision)} ·
        {' '}{appeal.challengedFindings.length} findings
      </small>
      {appeal.resolutionSummary === undefined
        ? null
        : <p style={successStyle}>{appeal.resolutionSummary}</p>}
      {!actionable ? null : (
        <div style={buttonRowStyle}>
          <Button
            variant="outline"
            size="sm"
            disabled={props.busy}
            onClick={() => {
              void props.onExecute({
                type: 'WITHDRAW_APPEAL',
                operationId: operationId('withdraw-appeal'),
                appealId: appeal.appealId,
              }, '申诉已撤回。')
            }}
          >
            撤回
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={props.busy}
            onClick={() => {
              if (!globalThis.confirm?.('确认驳回这份申诉？原报告不会被修改。')) return
              void props.onExecute({
                type: 'DENY_APPEAL',
                operationId: operationId('deny-appeal'),
                appealId: appeal.appealId,
                resolutionSummary: '经复核，当前证据不足以改变冻结报告。',
              }, '申诉已驳回。')
            }}
          >
            驳回
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            onClick={() => {
              if (!globalThis.confirm?.(
                '确认按申诉重建冻结数据集并发布替代报告？旧报告会保留为 SUPERSEDED。',
              )) return
              void props.onExecute({
                type: 'RECOMPUTE_AND_SUPERSEDE',
                operationId: operationId('recompute-appeal'),
                appealId: appeal.appealId,
                resolutionSummary: '申诉成立；已重建数据集并发布替代报告。',
              }, '已发布 superseding report；旧报告保持可审计。')
            }}
          >
            复算并替代
          </Button>
        </div>
      )}
    </article>
  )
}

function DecisionPill(props: {
  readonly report: MilitaryPerformanceReport | null
}): ReactNode {
  const status = props.report?.decision.status
  return (
    <Pill>
      <StateDot state={status === 'DECISION_ELIGIBLE'
        ? 'done'
        : status === 'REGRESSION_ALERT'
          ? 'error'
          : 'warning'} />
      {status === undefined ? '尚无报告' : decisionLabel(status)}
    </Pill>
  )
}

function Metric(props: {
  readonly label: string
  readonly value: string
}): ReactNode {
  return (
    <div style={metricStyle}>
      <span>{props.label}</span>
      <strong title={props.value}>{props.value}</strong>
    </div>
  )
}

function Empty({ text }: { readonly text: string }): ReactNode {
  return <section style={cardStyle}><p style={hintStyle}>{text}</p></section>
}

async function evaluationSnapshot(
  connection: Pick<ConnectionHandle, 'rpc'>,
  signal?: AbortSignal,
): Promise<EvaluationCenterSnapshot> {
  const response = await connection.rpc.call(
    '/api',
    'militaryEvaluationCenter/snapshot',
    { args: {} },
    signal,
  )
  if (!response.ok) throw new Error(response.error.message)
  return response.value as EvaluationCenterSnapshot
}

async function evaluationAction(
  connection: Pick<ConnectionHandle, 'rpc'>,
  action: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await connection.rpc.call(
    '/api',
    'militaryEvaluationCenter/execute',
    { args: { action } },
    signal,
  )
  if (!response.ok) throw new Error(response.error.message)
  return response.value
}

function aggregateFailures(
  report: MilitaryPerformanceReport,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const performance of report.individualPerformance) {
    for (const [stage, countValue] of Object.entries(
      performance.failureAttribution.byStage,
    )) result[stage] = (result[stage] ?? 0) + (countValue ?? 0)
  }
  return result
}

function count(
  values: Record<string, number>,
  stages: readonly string[],
): number {
  return stages.reduce((total, stage) => total + (values[stage] ?? 0), 0)
}

function cost(
  performance: MilitaryPerformanceReport['individualPerformance'][number],
): string {
  if (
    performance.efficiency.costStatus === 'PROVIDER_PRICING_UNAVAILABLE'
    || performance.efficiency.meanCostPerAcceptedOutcomeUsd === undefined
  ) return '价格不可用'
  return `$${performance.efficiency.meanCostPerAcceptedOutcomeUsd.toFixed(6)} · ${performance.efficiency.costStatus}`
}

function numericInterval(
  value: EvaluationNumericInterval,
  digits = 1,
): string {
  if (
    value.status !== 'AVAILABLE'
    || value.low === undefined
    || value.high === undefined
  ) {
    return value.status === 'NO_DATA'
      ? '无 Accepted Outcome'
      : `独立 Mission=${value.clusterCount}，暂不估计区间`
  }
  return `${value.estimate.toFixed(digits)} [${value.low.toFixed(digits)}, ${value.high.toFixed(digits)}]`
}

type PerformanceRow =
  MilitaryPerformanceReport['individualPerformance'][number]
type ParetoStatus = 'FRONTIER' | 'DOMINATED' | 'GATE_BLOCKED'

function paretoStatuses(
  values: readonly PerformanceRow[],
): ReadonlyMap<string, ParetoStatus> {
  const eligible = values.filter(passesEconomicQualityGate)
  return new Map(values.map(value => {
    if (!passesEconomicQualityGate(value)) {
      return [value.template.configurationKey, 'GATE_BLOCKED'] as const
    }
    const dominated = eligible.some(other =>
      other.template.configurationKey !== value.template.configurationKey
      && dominates(other, value))
    return [
      value.template.configurationKey,
      dominated ? 'DOMINATED' : 'FRONTIER',
    ] as const
  }))
}

function passesEconomicQualityGate(value: PerformanceRow): boolean {
  return value.status === 'VALID'
    && value.accuracy.falseCompletionRate === 0
    && value.accuracy.regressionEscapeRate === 0
    && value.reliability.permissionViolationRate === 0
    && value.reliability.terminalDuplicateRate === 0
    && value.reliability.recoveryDriftRate === 0
    && (
      value.sample.completedAttempts === 0
      || value.completion.parentWakeupRate === 1
    )
}

function dominates(left: PerformanceRow, right: PerformanceRow): boolean {
  const qualityNoWorse =
    left.accuracy.finalAcceptanceRate >= right.accuracy.finalAcceptanceRate
  const tokensNoWorse =
    left.efficiency.meanTokensPerAcceptedOutcome
      <= right.efficiency.meanTokensPerAcceptedOutcome
  const latencyNoWorse =
    left.efficiency.meanLatencySeconds <= right.efficiency.meanLatencySeconds
  const bothCostsKnown =
    left.efficiency.meanCostPerAcceptedOutcomeUsd !== undefined
    && right.efficiency.meanCostPerAcceptedOutcomeUsd !== undefined
  const costNoWorse = !bothCostsKnown
    || left.efficiency.meanCostPerAcceptedOutcomeUsd!
      <= right.efficiency.meanCostPerAcceptedOutcomeUsd!
  if (!qualityNoWorse || !tokensNoWorse || !latencyNoWorse || !costNoWorse) {
    return false
  }
  return left.accuracy.finalAcceptanceRate
      > right.accuracy.finalAcceptanceRate
    || left.efficiency.meanTokensPerAcceptedOutcome
      < right.efficiency.meanTokensPerAcceptedOutcome
    || left.efficiency.meanLatencySeconds
      < right.efficiency.meanLatencySeconds
    || (
      bothCostsKnown
      && left.efficiency.meanCostPerAcceptedOutcomeUsd!
        < right.efficiency.meanCostPerAcceptedOutcomeUsd!
    )
}

function paretoLabel(value: ParetoStatus | undefined): string {
  if (value === 'FRONTIER') return '前沿'
  if (value === 'DOMINATED') return '被支配'
  return '质量 / 安全门阻断'
}

function interval(value: {
  readonly estimate: number
  readonly low: number
  readonly high: number
}): string {
  return `${percent(value.estimate)} [${percent(value.low)}, ${percent(value.high)}]`
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 1,
  }).format(value)
}

function decisionLabel(value: string): string {
  if (value === 'NO_DATA') return '无数据'
  if (value === 'EARLY_SIGNAL') return '早期信号'
  if (value === 'EXPLORATORY') return '探索性'
  if (value === 'DECISION_ELIGIBLE') return '达到建议资格'
  if (value === 'REGRESSION_ALERT') return '回归警报'
  return value
}

function reportKey(value: EvaluationReportRevisionSummary): string {
  return `${String(value.reportId)}@${Number(value.reportRevision)}`
}

function short(value: string): string {
  return value.length <= 24
    ? value
    : `${value.slice(0, 11)}…${value.slice(-9)}`
}

function printableKey(value: string): string {
  return value.replaceAll('\u0000', ' · ')
}

function operationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2)}`
}

function splitList(value: string): readonly string[] {
  return [...new Set(value.split(/[\n,，]+/u)
    .map(item => item.trim())
    .filter(Boolean))]
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

const stackStyle: CSSProperties = { display: 'grid', gap: 12 }
const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 12,
  padding: 16,
  background: 'var(--dsw-surface-elevated)',
  minWidth: 0,
}
const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 10,
  flexWrap: 'wrap',
}
const headingStyle: CSSProperties = { margin: 0, fontSize: 15 }
const subheadingStyle: CSSProperties = { margin: '0 0 6px', fontSize: 13 }
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
const successStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-text-success)',
  fontSize: 12,
  lineHeight: 1.5,
}
const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'end',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 10,
}
const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 'min(260px, 100%)',
  fontSize: 12,
}
const hashStyle: CSSProperties = {
  overflowWrap: 'anywhere',
  color: 'var(--dsw-text-muted)',
  fontSize: 11,
}
const tabsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  borderTop: '1px solid var(--dsw-border-subtle)',
  paddingTop: 12,
}
const tabStyle: CSSProperties = {
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 12,
}
const activeTabStyle: CSSProperties = {
  borderColor: 'var(--dsw-accent)',
  background: 'var(--dsw-surface-sunken)',
  fontWeight: 600,
}
const metricGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
  gap: 8,
}
const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
  padding: 9,
  minWidth: 0,
  fontSize: 11,
  overflowWrap: 'anywhere',
}
const decisionBoxStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  padding: 12,
  borderRadius: 9,
  background: 'var(--dsw-surface-sunken)',
  fontSize: 12,
}
const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 12,
  lineHeight: 1.65,
}
const runStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: 9,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
  fontSize: 12,
}
const comparisonStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  borderTop: '1px solid var(--dsw-border-subtle)',
  paddingTop: 12,
}
const funnelStyle: CSSProperties = { display: 'grid', gap: 9 }
const funnelRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(145px, 1fr) minmax(100px, 3fr) auto',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
}
const barTrackStyle: CSSProperties = {
  height: 10,
  borderRadius: 999,
  background: 'var(--dsw-surface-sunken)',
  overflow: 'hidden',
}
const barStyle: CSSProperties = {
  display: 'block',
  height: '100%',
  borderRadius: 999,
  background: 'var(--dsw-accent)',
}
const tableShellStyle: CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 8,
}
const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 760,
  borderCollapse: 'collapse',
  fontSize: 11,
}
const blockStyle: CSSProperties = { display: 'block', marginTop: 3 }
const lineageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  borderBottom: '1px solid var(--dsw-border-subtle)',
  padding: '8px 0',
  fontSize: 12,
}
const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
  gap: 10,
}
const checkGridStyle: CSSProperties = {
  display: 'grid',
  gap: 7,
  maxHeight: 260,
  overflowY: 'auto',
  marginTop: 8,
}
const checkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 11,
}
const appealStyle: CSSProperties = {
  display: 'grid',
  gap: 9,
  padding: 11,
  border: '1px solid var(--dsw-border-subtle)',
  borderRadius: 9,
}
const buttonRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}
