import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button,
  IconCloseOutline16,
  IconSkillOutline16,
  Modal,
  Pill,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PrivateSkillIngestionJob,
  PrivateSkillOperationSnapshot,
  MilitaryPrivateSkillPipelineTransparency,
  MilitaryRecallSimulationResult,
  TacticalExtractionCandidate,
  TacticalTag,
} from '@dsh-military/contracts'
import { useDialogFocus } from './dialog-accessibility.js'
import {
  callMilitaryRpc,
  useMilitaryRefreshLoop,
} from './query-client.js'

type Scope = SettingsScope<Record<string, unknown>>

interface CandidateView extends TacticalExtractionCandidate {
  readonly reviewHash: string
  readonly diffHash: string
  readonly diffText: string
}

interface KnowledgeSnapshot {
  readonly operation: Omit<PrivateSkillOperationSnapshot, 'candidates'> & {
    readonly candidates: readonly CandidateView[]
  }
  readonly tags: readonly TacticalTag[]
  readonly transparency: readonly MilitaryPrivateSkillPipelineTransparency[]
  readonly recallSimulations: readonly MilitaryRecallSimulationResult[]
}

type ViewId = 'sources' | 'jobs' | 'reviews' | 'library' | 'recall' | 'promotion' | 'revocation'

const VIEWS: readonly { readonly id: ViewId; readonly label: string }[] = [
  { id: 'sources', label: '来源资料' },
  { id: 'jobs', label: '提炼任务' },
  { id: 'reviews', label: '待审候选' },
  { id: 'library', label: '私有技能库' },
  { id: 'recall', label: '模拟召回' },
  { id: 'promotion', label: '版本与晋升' },
  { id: 'revocation', label: '撤回与影响' },
]

let centreOpen = false
let knowledgeReturnFocus: HTMLElement | null = null
const centreListeners = new Set<() => void>()

export function openKnowledgeCenter(): void {
  centreOpen = true
  for (const listener of centreListeners) listener()
}

export function closeKnowledgeCenter(): void {
  centreOpen = false
  for (const listener of centreListeners) listener()
  const target = knowledgeReturnFocus
  knowledgeReturnFocus = null
  globalThis.queueMicrotask(() => { target?.focus() })
}

export function KnowledgeCenterTrigger({ wide }: { readonly wide: boolean }): ReactNode {
  const open = useKnowledgeCenterOpen()
  return (
    <button
      type="button"
      title="知识与技能"
      aria-label="打开 Military 知识与技能"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={event => {
        knowledgeReturnFocus = event.currentTarget
        openKnowledgeCenter()
      }}
      data-military-knowledge-trigger="true"
      data-wide={String(wide)}
    >
      <IconSkillOutline16 size={wide ? 16 : 18} />
      {wide ? <span className="dshm-trigger-label">知识与技能</span> : null}
    </button>
  )
}

export function KnowledgeCenterOverlay(props: {
  readonly scope: Scope
  readonly connection: ConnectionHandle
}): ReactNode {
  const open = useKnowledgeCenterOpen()
  useDialogFocus(open, '.dshm-knowledge-dialog')
  return (
    <Modal
      open={open}
      onClose={closeKnowledgeCenter}
      title="Military 知识与技能"
      closeLabel="关闭知识与技能"
      className="dshm-knowledge-dialog"
      headless
    >
      <KnowledgeCenter scope={props.scope} connection={props.connection} />
    </Modal>
  )
}

function KnowledgeCenter(props: {
  readonly scope: Scope
  readonly connection: ConnectionHandle
}): ReactNode {
  const { scope, connection } = props
  const settings = useScopeValue(scope)
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot>(() => parseKnowledgeSnapshot(undefined))
  const [view, setView] = useState<ViewId>('sources')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refreshInFlight = useRef(false)
  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    if (refreshInFlight.current) return true
    refreshInFlight.current = true
    try {
      const next = await fetchKnowledgeSnapshot(connection, signal)
      if (signal?.aborted !== true) {
        setSnapshot(next)
        setError('')
      }
      return signal?.aborted !== true
    } catch (refreshError) {
      if (signal?.aborted !== true) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
      }
      return false
    } finally {
      refreshInFlight.current = false
      if (signal?.aborted !== true) setLoading(false)
    }
  }, [connection])
  useMilitaryRefreshLoop({
    key: 'military-knowledge-snapshot',
    refresh,
    intervalMs: 5_000,
  })
  const dispatch = useCallback(async (action: Record<string, unknown>, message: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice('正在提交…')
    setError('')
    try {
      await dispatchKnowledgeAction(connection, action)
      await refresh()
      setNotice(message)
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : String(actionError)
      setError(message)
      setNotice('')
    } finally {
      setBusy(false)
    }
  }, [busy, connection, refresh])

  const activityState: StateDotState = busy || loading ? 'ongoing' : error === '' ? 'done' : 'error'
  return (
    <section
      className="dshm-knowledge-shell"
      data-military-knowledge-center="true"
      lang="zh-CN"
      aria-labelledby="military-knowledge-title"
    >
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>MILITARY PRIVATE KNOWLEDGE</p>
            <h2 id="military-knowledge-title" style={titleStyle}>知识与技能</h2>
            <p style={subtitleStyle}>来源隔离、Flash 分块提炼、人工审批、生命周期与撤回都由 Host 治理。</p>
          </div>
          <div style={headerActionsStyle}>
            <Pill className="dshm-status">
              <StateDot state={activityState} />
              {busy ? '处理中' : loading ? '加载中' : `${snapshot.operation.bundles.length} 个版本`}
            </Pill>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => {
              setLoading(true)
              void refresh()
            }}>刷新</Button>
            <button
              type="button"
              data-dshm-close
              aria-label="关闭知识与技能"
              style={closeStyle}
              onClick={closeKnowledgeCenter}
            >
              <IconCloseOutline16 className="dshm-close-icon" size={14} />
            </button>
          </div>
        </header>

        <div style={bodyStyle} data-dshm-body>
          <nav
            aria-label="知识与技能分类"
            aria-orientation="vertical"
            role="tablist"
            style={navStyle}
            data-dshm-sidebar
          >
            {VIEWS.map(item => (
              <button
                type="button"
                role="tab"
                data-dshm-nav
                key={item.id}
                id={`military-knowledge-tab-${item.id}`}
                aria-controls={`military-knowledge-panel-${item.id}`}
                aria-selected={view === item.id}
                tabIndex={view === item.id ? 0 : -1}
                style={view === item.id ? navActiveStyle : navButtonStyle}
                onClick={() => { setView(item.id); setNotice('') }}
                onKeyDown={event => {
                  navigateKnowledgeTabs(event, item.id, next => {
                    setView(next)
                    setNotice('')
                  })
                }}
              >
                <span>{item.label}</span>
                <span style={countStyle}>{viewCount(item.id, snapshot.operation)}</span>
              </button>
            ))}
            <div style={policyStyle} data-dshm-policy>
              <strong>提炼路线</strong>
              <span>{String(settings.extractionModel ?? 'deepseek-v4-flash')}</span>
              <span>{String(settings.defaultVisibility ?? 'user-private')}</span>
              <span>人工审批不可由模型代替</span>
            </div>
          </nav>

          <main
            id={`military-knowledge-panel-${view}`}
            role="tabpanel"
            aria-labelledby={`military-knowledge-tab-${view}`}
            tabIndex={0}
            style={contentStyle}
          >
            {notice !== '' ? <p role="status" style={noticeStyle}>{notice}</p> : null}
            {error !== '' ? <p role="alert" style={errorStyle}>{error}</p> : null}
            {view === 'sources' ? <SourcesView snapshot={snapshot} dispatch={dispatch} disabled={busy} /> : null}
            {view === 'jobs' ? <JobsView snapshot={snapshot} dispatch={dispatch} disabled={busy} /> : null}
            {view === 'reviews' ? <ReviewsView snapshot={snapshot} dispatch={dispatch} disabled={busy} /> : null}
            {view === 'library' ? <LibraryView snapshot={snapshot} /> : null}
            {view === 'recall' ? <RecallView snapshot={snapshot} dispatch={dispatch} disabled={busy} /> : null}
            {view === 'promotion' ? <PromotionView snapshot={snapshot} dispatch={dispatch} disabled={busy} /> : null}
            {view === 'revocation' ? <RevocationView snapshot={snapshot} dispatch={dispatch} disabled={busy} /> : null}
          </main>
        </div>
    </section>
  )
}

function navigateKnowledgeTabs(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: ViewId,
  select: (view: ViewId) => void,
): void {
  if (event.nativeEvent.isComposing) return
  const index = VIEWS.findIndex(value => value.id === current)
  let target: ViewId | undefined
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      target = VIEWS[(index + 1) % VIEWS.length]?.id
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      target = VIEWS[(index - 1 + VIEWS.length) % VIEWS.length]?.id
      break
    case 'Home':
      target = VIEWS[0]?.id
      break
    case 'End':
      target = VIEWS.at(-1)?.id
      break
    default:
      return
  }
  if (target === undefined) return
  event.preventDefault()
  select(target)
  event.currentTarget.parentElement?.querySelector<HTMLElement>(
    `#military-knowledge-tab-${target}`,
  )?.focus()
}

function SourcesView(props: ViewProps): ReactNode {
  const [kind, setKind] = useState<'DIRECT_TEXT' | 'SESSION_RANGE' | 'ARTIFACT'>('DIRECT_TEXT')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [sessionStart, setSessionStart] = useState('')
  const [sessionEnd, setSessionEnd] = useState('')
  const [includeToolResults, setIncludeToolResults] = useState(false)
  const [artifactId, setArtifactId] = useState('')
  const [artifactMediaType, setArtifactMediaType] = useState('text/plain')
  const [classification, setClassification] = useState('internal')
  const [license, setLicense] = useState('USER_OWNED')
  const [dependencyVersions, setDependencyVersions] = useState('')
  const [externalModelProcessingAllowed, setExternalModelProcessingAllowed] = useState(false)
  const create = async (): Promise<void> => {
    const dependencies = dependencyVersions
      .split(/[,\n]/u)
      .map(value => value.trim())
      .filter(Boolean)
    const common = {
      title,
      classification,
      license,
      externalModelProcessingAllowed,
      dependencyVersions: dependencies,
    }
    const action = kind === 'DIRECT_TEXT'
      ? { type: 'CREATE_DIRECT_SOURCE', ...common, content }
      : kind === 'SESSION_RANGE'
        ? {
            type: 'CREATE_SESSION_SOURCE',
            ...common,
            sessionId,
            includeToolResults,
            ...(sessionStart.trim() === '' ? {} : { startSeq: Number(sessionStart) }),
            ...(sessionEnd.trim() === '' ? {} : { endSeq: Number(sessionEnd) }),
          }
        : {
            type: 'CREATE_ARTIFACT_SOURCE',
            ...common,
            artifactId,
            mediaType: artifactMediaType,
          }
    await props.dispatch(action, '来源已进入隔离 Raw Vault。')
    setTitle('')
    setContent('')
    setSessionId('')
    setSessionStart('')
    setSessionEnd('')
    setIncludeToolResults(false)
    setArtifactId('')
    setDependencyVersions('')
  }
  return (
    <div style={stackStyle}>
      <SectionHeading title="导入来源" description="原始内容进入独立 Raw Vault；任何模型调用前都会生成脱敏快照与 Injection 扫描回执。" />
      <article style={formCardStyle}>
        <div style={formGridStyle}>
          <Labeled label="来源类型">
            <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
              <option value="DIRECT_TEXT">粘贴文本</option>
              <option value="SESSION_RANGE">历史 / 当前 Session</option>
              <option value="ARTIFACT">Military Artifact</option>
            </select>
          </Labeled>
          <Labeled label="标题">
            <input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：React 大型表单实践" />
          </Labeled>
          <Labeled label="分类">
            <select value={classification} onChange={event => setClassification(event.target.value)}>
              <option value="public">公开</option>
              <option value="internal">内部</option>
              <option value="confidential">机密</option>
              <option value="restricted">受限</option>
            </select>
          </Labeled>
          <Labeled label="来源权利">
            <select value={license} onChange={event => setLicense(event.target.value)}>
              <option value="USER_OWNED">用户拥有</option>
              <option value="ENTERPRISE_INTERNAL">企业内部</option>
              <option value="LICENSED">已获许可</option>
              <option value="UNKNOWN">未知（仅私有草稿）</option>
            </select>
          </Labeled>
        </div>
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={externalModelProcessingAllowed}
            onChange={event => setExternalModelProcessingAllowed(event.target.checked)}
          />
          允许将脱敏后的机密/受限分块发送给所选模型提供商
        </label>
        <p style={descriptionStyle}>
          “内部/公开”资料可直接使用 Flash；“机密/受限”资料未勾选时只允许显式启用的本地确定性 fallback。
        </p>
        <Labeled label="依赖版本约束（可选）">
          <input
            value={dependencyVersions}
            onChange={event => setDependencyVersions(event.target.value)}
            placeholder="例如：react@19.1.1, node@22"
          />
        </Labeled>
        {kind === 'DIRECT_TEXT' ? (
          <Labeled label="资料正文">
            <textarea style={largeTextareaStyle} value={content} onChange={event => setContent(event.target.value)} placeholder="粘贴文档、复盘或操作经验…" />
          </Labeled>
        ) : kind === 'SESSION_RANGE' ? (
          <div style={stackStyle}>
            <Labeled label="Session ID">
              <input value={sessionId} onChange={event => setSessionId(event.target.value)} placeholder="session-…" />
            </Labeled>
            <div style={formGridStyle}>
              <Labeled label="起始事件序号（可选）">
                <input type="number" min={0} step={1} value={sessionStart} onChange={event => setSessionStart(event.target.value)} />
              </Labeled>
              <Labeled label="结束事件序号（可选）">
                <input type="number" min={0} step={1} value={sessionEnd} onChange={event => setSessionEnd(event.target.value)} />
              </Labeled>
            </div>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={includeToolResults}
                onChange={event => setIncludeToolResults(event.target.checked)}
              />
              包含工具结果（仍会先脱敏并扫描）
            </label>
          </div>
        ) : (
          <div style={formGridStyle}>
            <Labeled label="Artifact ID">
              <input value={artifactId} onChange={event => setArtifactId(event.target.value)} placeholder="artifact-…" />
            </Labeled>
            <Labeled label="媒体类型">
              <select value={artifactMediaType} onChange={event => setArtifactMediaType(event.target.value)}>
                <option value="text/plain">纯文本</option>
                <option value="text/markdown">Markdown</option>
                <option value="application/json">JSON</option>
                <option value="application/yaml">YAML</option>
                <option value="application/xml">XML</option>
              </select>
            </Labeled>
          </div>
        )}
        <button
          type="button"
          className="dshm-button-primary"
          style={primaryButtonStyle}
          disabled={props.disabled || title.trim() === '' || (
            kind === 'DIRECT_TEXT'
              ? content.trim() === ''
              : kind === 'SESSION_RANGE'
                ? sessionId.trim() === ''
                : artifactId.trim() === ''
          )}
          onClick={() => { void create() }}
        >
          导入并隔离
        </button>
      </article>

      <SectionHeading title="已导入来源" description="这里不显示 Raw Vault 地址或原始秘密；只显示可审计的来源、扫描和权利状态。" />
      {props.snapshot.operation.sources.length === 0 ? <Empty text="尚无来源资料。" /> : (
        <div style={listGridStyle}>
          {props.snapshot.operation.sources.map(source => (
            <SourceCard
              key={String(source.sourceHandle)}
              source={source}
              tags={props.snapshot.tags}
              bundles={props.snapshot.operation.bundles}
              pipelines={props.snapshot.transparency.filter(value =>
                value.sourceHandle === String(source.sourceHandle))}
              dispatch={props.dispatch}
              disabled={props.disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceCard(props: {
  readonly source: KnowledgeSnapshot['operation']['sources'][number]
  readonly tags: readonly TacticalTag[]
  readonly bundles: KnowledgeSnapshot['operation']['bundles']
  readonly pipelines: readonly MilitaryPrivateSkillPipelineTransparency[]
  readonly dispatch: Dispatch
  readonly disabled: boolean
}): ReactNode {
  const [goal, setGoal] = useState(props.source.title)
  const [tag, setTag] = useState(String(props.tags.find(value => value.status === 'ACTIVE')?.tagId ?? ''))
  const [additionalTags, setAdditionalTags] = useState<readonly string[]>([])
  const [targetIndex, setTargetIndex] = useState('')
  const start = async (): Promise<void> => {
    const target = targetIndex === '' ? undefined : props.bundles[Number(targetIndex)]
    await props.dispatch({
      type: 'START_EXTRACTION',
      sourceHandle: String(props.source.sourceHandle),
      goal,
      primaryTagId: tag,
      additionalTagIds: additionalTags.filter(value => value !== tag),
      ...(target === undefined
        ? {}
        : {
            targetSkillId: String(target.skill.skillId),
            targetVersion: String(target.skill.version),
          }),
    }, '提炼任务已启动；Host 将按稳定分块调用轻量模型。')
  }
  return (
    <article style={cardStyle}>
      <div style={rowBetweenStyle}>
        <div>
          <h3 style={cardTitleStyle}>{props.source.title}</h3>
          <p style={metaStyle}>{props.source.sourceKind} · {props.source.classification} · {props.source.visibility}</p>
        </div>
        <StateBadge value={props.source.status} />
      </div>
      <div style={metricRowStyle}>
        <MiniMetric label="权利" value={props.source.rights.license} />
        <MiniMetric label="扫描" value={props.source.promptInjectionScan?.status ?? '待执行'} />
        <MiniMetric label="Hash" value={String(props.source.sourceHash).slice(0, 12)} />
      </div>
      {props.pipelines.length === 0 ? null : (
        <details>
          <summary style={summaryStyle}>
            脱敏快照、分块与派生谱系（{props.pipelines.length}）
          </summary>
          {props.pipelines.map(pipeline => (
            <div key={pipeline.requestId} style={formCardStyle}>
              <p style={metaStyle}>{pipeline.requestId}</p>
              {pipeline.snapshot === undefined ? (
                <p style={descriptionStyle}>尚未生成 sanitized snapshot。</p>
              ) : (
                <div>
                  <p style={descriptionStyle}>
                    snapshot {pipeline.snapshot.contentHash.slice(0, 12)} ·
                    {pipeline.snapshot.sanitized.verified ? ' SHA-256 已验证' : ' SHA-256 不匹配'}
                    {pipeline.snapshot.sanitized.truncated ? ' · 预览已截断' : ''}
                  </p>
                  <pre style={diffStyle}>{pipeline.snapshot.sanitized.text}</pre>
                  <details>
                    <summary style={summaryStyle}>脱敏 / Injection 扫描回执</summary>
                    <pre style={diffStyle}>{pipeline.snapshot.redactionReceipt.text}</pre>
                  </details>
                </div>
              )}
              <p style={descriptionStyle}>
                chunks {pipeline.chunks.length}
                {pipeline.truncatedChunkCount === 0
                  ? ''
                  : `（另有 ${pipeline.truncatedChunkCount} 项未在此轮投影）`} ·
                candidate {pipeline.lineage.candidateId ?? '—'} ·
                reviews {pipeline.lineage.reviewReceiptIds.length} ·
                versions {pipeline.lineage.skillVersions.length}
              </p>
            </div>
          ))}
        </details>
      )}
      <div style={formGridStyle}>
        <Labeled label="提炼目标">
          <input value={goal} onChange={event => setGoal(event.target.value)} />
        </Labeled>
        <Labeled label="主标签">
          <select
            value={tag}
            onChange={event => {
              const value = event.target.value
              setTag(value)
              setAdditionalTags(current => current.filter(item => item !== value))
            }}
          >
            {props.tags.filter(value => value.status === 'ACTIVE').map(value => (
              <option key={String(value.tagId)} value={String(value.tagId)}>{value.displayName}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="目标技能版本">
          <select value={targetIndex} onChange={event => setTargetIndex(event.target.value)}>
            <option value="">新建技能</option>
            {props.bundles.map((bundle, index) => (
              bundle.lifecycle === 'DEPRECATED' || bundle.lifecycle === 'QUARANTINED'
                ? null
                : (
                    <option key={`${String(bundle.skill.skillId)}@${String(bundle.skill.version)}`} value={String(index)}>
                      {bundle.name}@{String(bundle.skill.version)} · {bundle.lifecycle}
                    </option>
                  )
            ))}
          </select>
        </Labeled>
      </div>
      <fieldset style={tagFieldsetStyle}>
        <legend style={tagLegendStyle}>补充标签（可选，最多 8 个）</legend>
        <div style={tagOptionsStyle}>
          {props.tags
            .filter(value => value.status === 'ACTIVE' && String(value.tagId) !== tag)
            .map(value => {
              const id = String(value.tagId)
              const checked = additionalTags.includes(id)
              return (
                <label key={id} style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && additionalTags.length >= 8}
                    onChange={event => {
                      setAdditionalTags(current => event.target.checked
                        ? [...current, id].slice(0, 8)
                        : current.filter(item => item !== id))
                    }}
                  />
                  {value.displayName}
                </label>
              )
            })}
          {props.tags.filter(value => value.status === 'ACTIVE' && String(value.tagId) !== tag).length === 0
            ? <span style={metaStyle}>没有其他可用标签。</span>
            : null}
        </div>
      </fieldset>
      <button
        type="button"
        className="dshm-button-outline"
        style={secondaryButtonStyle}
        disabled={
          props.disabled
          || props.source.status === 'REVOKED'
          || props.source.status === 'QUARANTINED'
          || goal.trim() === ''
          || tag === ''
        }
        onClick={() => { void start() }}
      >
        开始 Flash 提炼
      </button>
    </article>
  )
}

function JobsView(props: ViewProps): ReactNode {
  return (
    <div style={stackStyle}>
      <SectionHeading title="提炼任务" description="每个阶段与分块都写入 SQLite。进程重启后继续同一个 requestId，不重建隐式状态。" />
      {props.snapshot.operation.jobs.length === 0 ? <Empty text="尚无提炼任务。" /> : (
        <div style={listGridStyle}>
          {props.snapshot.operation.jobs.map(job => (
            <article style={cardStyle} key={String(job.requestId)}>
              <div style={rowBetweenStyle}>
                <div>
                  <h3 style={cardTitleStyle}>{job.extractionGoal}</h3>
                  <p style={metaStyle}>{String(job.requestId)}</p>
                </div>
                <StateBadge value={job.state} />
              </div>
              <Progress completed={job.completedChunkCount} total={job.chunkCount} />
              <div style={metricRowStyle}>
                <MiniMetric label="路线" value={job.extractorRoute.model ?? job.extractorRoute.mode} />
                <MiniMetric label="主标签" value={String(job.primaryTagId)} />
                <MiniMetric label="候选" value={job.candidateId === undefined ? '—' : String(job.candidateId).slice(-12)} />
              </div>
              <PipelineChunks
                pipeline={props.snapshot.transparency.find(value =>
                  value.requestId === String(job.requestId))}
              />
              {job.failureMessage === undefined ? null : <p style={errorStyle}>{job.failureCode}: {job.failureMessage}</p>}
              <div style={buttonRowStyle}>
                {job.state === 'AWAITING_INJECTION_ACK' ? (
                  <button type="button" disabled={props.disabled} onClick={() => {
                    void props.dispatch({ type: 'ACKNOWLEDGE_INJECTION', requestId: String(job.requestId) }, '已确认 WARN；可继续提炼。')
                  }}>确认风险并继续</button>
                ) : null}
                {resumable(job) ? (
                  <button type="button" disabled={props.disabled} onClick={() => {
                    void props.dispatch({ type: 'PROCESS_JOB', requestId: String(job.requestId) }, '任务已从最后持久化阶段继续。')
                  }}>继续同一任务</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function PipelineChunks(props: {
  readonly pipeline: MilitaryPrivateSkillPipelineTransparency | undefined
}): ReactNode {
  const pipeline = props.pipeline
  if (pipeline === undefined) return null
  return (
    <details>
      <summary style={summaryStyle}>
        查看 sanitized chunks（{pipeline.chunks.length}）
      </summary>
      <div style={stackStyle}>
        {pipeline.chunks.map(chunk => (
          <article key={chunk.chunkId} style={formCardStyle}>
            <div style={rowBetweenStyle}>
              <strong>chunk {chunk.ordinal + 1}</strong>
              <StateBadge value={chunk.extractionState} />
            </div>
            <p style={metaStyle}>
              {chunk.chunkId} · offsets {chunk.startOffset}–{chunk.endOffset} ·
              attempts {chunk.attempts} · {chunk.extractorRoute?.provider ?? ''}
              {chunk.extractorRoute?.model ?? chunk.extractorRoute?.mode ?? ''}
            </p>
            <pre style={diffStyle}>{chunk.sanitized.text}</pre>
            {chunk.extraction === undefined ? null : (
              <details>
                <summary style={summaryStyle}>Flash 提炼回执预览</summary>
                <pre style={diffStyle}>{chunk.extraction.text}</pre>
              </details>
            )}
            {chunk.lastError === undefined
              ? null
              : <p style={errorStyle}>{chunk.lastError}</p>}
          </article>
        ))}
        {pipeline.returnedInstructions.length === 0 ? null : (
          <div>
            <strong>人工退回指令</strong>
            <ul style={plainListStyle}>
              {pipeline.returnedInstructions.map((value, index) =>
                <li key={`${index}-${value}`}>{value}</li>)}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

function ReviewsView(props: ViewProps): ReactNode {
  const candidates = props.snapshot.operation.candidates.filter(value => (
    value.status === 'PENDING_REVIEW' || value.status === 'RETURNED'
  ))
  return (
    <div style={stackStyle}>
      <SectionHeading title="待审候选" description="审批绑定 Candidate hash 与 Diff hash；下面的按钮是用户 UI 动作，General 工具没有批准能力。" />
      {candidates.length === 0 ? <Empty text="没有等待人工审阅的候选。" /> : candidates.map(candidate => (
        <CandidateEditor
          key={String(candidate.candidateId)}
          candidate={candidate}
          dispatch={props.dispatch}
          disabled={props.disabled}
        />
      ))}
    </div>
  )
}

function CandidateEditor(props: {
  readonly candidate: CandidateView
  readonly dispatch: Dispatch
  readonly disabled: boolean
}): ReactNode {
  const [title, setTitle] = useState(props.candidate.proposedTitle)
  const [claims, setClaims] = useState(props.candidate.highValueClaims.map(value => value.claim).join('\n\n'))
  const [risks, setRisks] = useState(props.candidate.risks.join('\n'))
  const [validation, setValidation] = useState(props.candidate.validationPlan.join('\n'))
  const [instructions, setInstructions] = useState('')
  useEffect(() => {
    setTitle(props.candidate.proposedTitle)
    setClaims(props.candidate.highValueClaims.map(value => value.claim).join('\n\n'))
    setRisks(props.candidate.risks.join('\n'))
    setValidation(props.candidate.validationPlan.join('\n'))
  }, [props.candidate])
  const save = async (): Promise<void> => {
    await props.dispatch({
      type: 'EDIT_CANDIDATE',
      candidateId: String(props.candidate.candidateId),
      candidateHash: props.candidate.reviewHash,
      title,
      claims: splitParagraphs(claims),
      risks: splitLines(risks),
      validationPlan: splitLines(validation),
    }, '候选已形成新 hash；请按新 Diff 复核后批准。')
  }
  const review = async (action: 'APPROVE_AS_DRAFT' | 'RETURN' | 'REJECT'): Promise<void> => {
    await props.dispatch({
      type: 'REVIEW_CANDIDATE',
      candidateId: String(props.candidate.candidateId),
      candidateHash: props.candidate.reviewHash,
      diffHash: props.candidate.diffHash,
      action,
      ...(instructions.trim() === '' ? {} : { instructions }),
    }, action === 'APPROVE_AS_DRAFT' ? '用户审批回执与 DRAFT 已原子提交。' : '审阅决定已记录。')
  }
  return (
    <article style={reviewCardStyle}>
      <div style={rowBetweenStyle}>
        <div>
          <p style={eyebrowStyle}>CANDIDATE · {String(props.candidate.candidateId).slice(-12)}</p>
          <h3 style={cardTitleStyle}>{props.candidate.proposedTitle}</h3>
        </div>
        <StateBadge value={props.candidate.status} />
      </div>
      <div style={metricRowStyle}>
        <MiniMetric label="Claims" value={String(props.candidate.highValueClaims.length)} />
        <MiniMetric label="Candidate hash" value={props.candidate.reviewHash.slice(0, 12)} />
        <MiniMetric label="Diff hash" value={props.candidate.diffHash.slice(0, 12)} />
      </div>
      <details open>
        <summary style={summaryStyle}>来源与 Diff</summary>
        <pre style={diffStyle}>{props.candidate.diffText}</pre>
      </details>
      <Labeled label="标题">
        <input value={title} onChange={event => setTitle(event.target.value)} />
      </Labeled>
      <Labeled label="可执行 Claims（段落分隔）">
        <textarea style={mediumTextareaStyle} value={claims} onChange={event => setClaims(event.target.value)} />
      </Labeled>
      <div style={twoColumnStyle} data-dshm-columns="2">
        <Labeled label="风险 / Stop conditions（逐行）">
          <textarea style={smallTextareaStyle} value={risks} onChange={event => setRisks(event.target.value)} />
        </Labeled>
        <Labeled label="验证计划（逐行）">
          <textarea style={smallTextareaStyle} value={validation} onChange={event => setValidation(event.target.value)} />
        </Labeled>
      </div>
      <div style={buttonRowStyle}>
        <button type="button" disabled={props.disabled} onClick={() => { void save() }}>保存编辑</button>
        <button type="button" className="dshm-button-success" style={approveButtonStyle} disabled={props.disabled} onClick={() => { void review('APPROVE_AS_DRAFT') }}>批准为 DRAFT</button>
      </div>
      <Labeled label="退回 / 拒绝理由">
        <input value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="说明需要修订的事实或风险" />
      </Labeled>
      <div style={buttonRowStyle}>
        <button type="button" disabled={props.disabled || instructions.trim() === ''} onClick={() => { void review('RETURN') }}>退回修订</button>
        <button type="button" className="dshm-button-danger" style={dangerButtonStyle} disabled={props.disabled || instructions.trim() === ''} onClick={() => { void review('REJECT') }}>拒绝候选</button>
      </div>
    </article>
  )
}

function LibraryView({ snapshot }: { readonly snapshot: KnowledgeSnapshot }): ReactNode {
  return (
    <div style={stackStyle}>
      <SectionHeading title="私有技能库" description="每个版本都是完整快照。全局 DSH Skill 目录只投放 Stable；Canary/Testing 仅通过显式治理召回，DRAFT 永不进入任务。" />
      {snapshot.operation.bundles.length === 0 ? <Empty text="尚无已批准的私有技能版本。" /> : (
        <div style={listGridStyle}>
          {snapshot.operation.bundles.map(bundle => {
            const exactSkill = `${String(bundle.skill.skillId)}@${String(bundle.skill.version)}`
            const pipelines = snapshot.transparency.filter(value =>
              value.lineage.skillVersions.includes(exactSkill))
            const reviewIds = new Set(pipelines.flatMap(value =>
              value.lineage.reviewReceiptIds))
            const reviews = snapshot.operation.reviews.filter(value =>
              reviewIds.has(String(value.receiptId)))
            const promotions = snapshot.operation.promotions.filter(value =>
              value.skill.skillId === bundle.skill.skillId
              && value.skill.version === bundle.skill.version)
            const revocations = snapshot.operation.revocations.filter(value =>
              value.affectedTacticVersions.includes(exactSkill)
              || bundle.sourceSnapshotIds.includes(value.snapshotId))
            const usage = snapshot.operation.usages.filter(value => (
              value.skill.skillId === bundle.skill.skillId && value.skill.version === bundle.skill.version
            ))
            const successful = usage.filter(value => value.outcome === 'SUCCEEDED').length
            const adverse = usage.filter(value => (
              value.outcome === 'REWORK'
              || value.outcome === 'ROLLED_BACK'
              || value.outcome === 'FAILED'
            )).length
            const observedTokens = usage.reduce(
              (sum, value) => sum + (value.inputTokens ?? 0) + (value.outputTokens ?? 0),
              0,
            )
            return (
              <article style={cardStyle} key={`${String(bundle.skill.skillId)}@${String(bundle.skill.version)}`}>
                <div style={rowBetweenStyle}>
                  <div>
                    <h3 style={cardTitleStyle}>{bundle.name}</h3>
                    <p style={metaStyle}>{String(bundle.skill.skillId)}@{String(bundle.skill.version)}</p>
                  </div>
                  <StateBadge value={bundle.lifecycle} />
                </div>
                <p style={descriptionStyle}>{bundle.description}</p>
                <div style={metricRowStyle}>
                  <MiniMetric label="文件" value={String(bundle.files.length)} />
                  <MiniMetric label="使用" value={String(usage.length)} />
                  <MiniMetric label="成功 / 异常" value={`${successful} / ${adverse}`} />
                  <MiniMetric label="观测 Tokens" value={String(observedTokens)} />
                  <MiniMetric label="Hash" value={String(bundle.contentHash).slice(0, 12)} />
                </div>
                <details>
                  <summary style={summaryStyle}>版本文件与来源</summary>
                  <ul style={plainListStyle}>
                    {bundle.files.map(file => <li key={file.path}>{file.path}{file.executable ? ' · executable' : ''}</li>)}
                    {bundle.sourceSnapshotIds.map(value => <li key={value}>source: {value}</li>)}
                  </ul>
                </details>
                <details>
                  <summary style={summaryStyle}>审批、继承谱系与撤回影响</summary>
                  <ul style={plainListStyle}>
                    {reviews.map(value => (
                      <li key={String(value.receiptId)}>
                        审批 {String(value.receiptId)} · {value.action} ·
                        {value.actor.kind}:{value.actor.id} · {String(value.createdAt)}
                      </li>
                    ))}
                    {promotions.map(value => (
                      <li key={String(value.receiptId)}>
                        晋升 {value.from} → {value.to} · {value.requestedBy} ·
                        evidence {value.evidenceRefs.join('、') || '(none)'}
                      </li>
                    ))}
                    {pipelines.flatMap(value =>
                      value.lineage.inheritedSourceHandles.map(source => (
                        <li key={`${value.requestId}-${source}`}>
                          继承来源：{source}（通过 {value.requestId}）
                        </li>
                      )))}
                    {revocations.map(value => (
                      <li key={value.revocationOrderId}>
                        撤回影响：{value.revocationOrderId} · {value.reason} ·
                        {value.requiredActions.join('、')}
                      </li>
                    ))}
                    {reviews.length + promotions.length + revocations.length === 0
                      && pipelines.every(value =>
                        value.lineage.inheritedSourceHandles.length === 0)
                      ? <li>尚无额外谱系事件。</li>
                      : null}
                  </ul>
                </details>
                {usage.length === 0 ? null : (
                  <details>
                    <summary style={summaryStyle}>效果与成本证据</summary>
                    <ul style={plainListStyle}>
                      {usage.map(value => (
                        <li key={String(value.usageId)}>
                          {value.outcome} · {value.provider}/{value.model}
                          {' · '}{(value.inputTokens ?? 0) + (value.outputTokens ?? 0)} tokens
                          {' · '}{value.costStatus ?? 'cost status unavailable'}
                          {' · verifier '}{value.verifierReceiptRefs.join(', ') || '(none)'}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RecallView(props: ViewProps): ReactNode {
  const [taskText, setTaskText] = useState('')
  const [stateTokenBudget, setStateTokenBudget] = useState(4_096)
  const run = async (): Promise<void> => {
    await props.dispatch({
      type: 'SIMULATE_RECALL',
      taskText,
      stateTokenBudget,
    }, 'Host 已使用真实 Task 召回与投放规则完成模拟；没有创建 Task，也没有调用模型。')
  }
  return (
    <div style={stackStyle}>
      <SectionHeading
        title="模拟召回"
        description="输入任务文本后，Host 使用与真实 Task 编译完全相同的标签、生命周期、来源权利、租户和 token 投放规则；模拟不会启动 Task。"
      />
      <article style={formCardStyle}>
        <Labeled label="任务文本">
          <textarea
            style={largeTextareaStyle}
            value={taskText}
            maxLength={20_000}
            placeholder="例如：在授权工作区创建 TypeScript 文件，修改多个模块并运行验证。"
            onChange={event => { setTaskText(event.target.value) }}
          />
        </Labeled>
        <Labeled label="状态投放 token 预算">
          <input
            type="number"
            min={512}
            max={100_000}
            step={256}
            value={stateTokenBudget}
            onChange={event => {
              const value = Number(event.target.value)
              if (Number.isSafeInteger(value)) setStateTokenBudget(value)
            }}
          />
        </Labeled>
        <button
          type="button"
          className="dshm-button-outline"
          style={secondaryButtonStyle}
          disabled={
            props.disabled
            || taskText.trim() === ''
            || stateTokenBudget < 512
            || stateTokenBudget > 100_000
          }
          onClick={() => { void run() }}
        >
          使用真实规则模拟（0 模型费用）
        </button>
      </article>
      {props.snapshot.recallSimulations.length === 0 ? (
        <Empty text="尚无召回模拟。" />
      ) : props.snapshot.recallSimulations.map(result => (
        <article style={cardStyle} key={result.simulationId}>
          <div style={rowBetweenStyle}>
            <div>
              <h3 style={cardTitleStyle}>
                {result.selected.length} 个 exact Skill 被召回
              </h3>
              <p style={metaStyle}>
                {result.simulationId} · text {result.textHash.slice(0, 12)} ·
                {result.stateTokenBudget} tokens · {result.inputCharacters} 字符
              </p>
            </div>
            <StateBadge value={result.selected.length > 0 ? 'MATCHED' : 'NO_MATCH'} />
          </div>
          <p style={descriptionStyle}>
            标签：{result.matchedTagIds.join('、') || '无'} ·
            候选上限 {result.policy.maximumCandidates} ·
            {result.policy.includeTesting ? '允许 Canary/Testing' : '仅 Stable'} ·
            当前 Host tenant 隔离 · 未创建 Task
          </p>
          <div style={listGridStyle}>
            {result.selected.map(value => (
              <div style={formCardStyle} key={value.exactSkill}>
                <strong>#{value.rank} {value.title}</strong>
                <code style={metaStyle}>{value.exactSkill}</code>
                <span style={descriptionStyle}>{value.lifecycle}</span>
                <ul style={plainListStyle}>
                  {value.reasons.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <details open>
            <summary style={summaryStyle}>真实 Task 将收到的精确投放片段</summary>
            <pre style={diffStyle}>
              {result.deliveryBlocks.join('\n\n') || '没有符合权限与生命周期的投放片段。'}
            </pre>
          </details>
          <details>
            <summary style={summaryStyle}>排除明细（{result.excluded.length}）</summary>
            <ul style={plainListStyle}>
              {result.excluded.map(value => (
                <li key={value.exactSkill}>
                  {value.exactSkill} · {value.lifecycle} · {value.reasons.join('、')}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </div>
  )
}

function PromotionView(props: ViewProps): ReactNode {
  return (
    <div style={stackStyle}>
      <SectionHeading title="版本与晋升" description="晋升是 exact-version 状态机，需要证据引用；不能跳级。隔离与退役立即停止新的 Skill 召回。" />
      {props.snapshot.operation.bundles.length === 0 ? <Empty text="尚无可管理版本。" /> : (
        <div style={listGridStyle}>
          {props.snapshot.operation.bundles.map(bundle => (
            <PromotionCard
              key={`${String(bundle.skill.skillId)}@${String(bundle.skill.version)}`}
              bundle={bundle}
              source={props.snapshot.operation.sources.find(source => (
                bundle.sourceSnapshotIds.includes(String(source.sourceHandle))
              ))}
              dispatch={props.dispatch}
              disabled={props.disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PromotionCard(props: {
  readonly bundle: KnowledgeSnapshot['operation']['bundles'][number]
  readonly source: KnowledgeSnapshot['operation']['sources'][number] | undefined
  readonly dispatch: Dispatch
  readonly disabled: boolean
}): ReactNode {
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const next = (
    props.source?.rights.license === 'UNKNOWN'
    && props.bundle.lifecycle === 'SIMULATION'
  ) ? null : nextLifecycle(props.bundle.lifecycle)
  const rollback = rollbackLifecycle(props.bundle.lifecycle)
  const promote = async (to: string): Promise<void> => {
    await props.dispatch({
      type: 'PROMOTE_SKILL',
      skillId: String(props.bundle.skill.skillId),
      version: String(props.bundle.skill.version),
      to,
      reason: reason.trim() === '' ? `${props.bundle.lifecycle} governance transition` : reason,
      evidenceRefs: splitList(evidence),
    }, `版本已提交 ${props.bundle.lifecycle} → ${to}。`)
  }
  return (
    <article style={cardStyle}>
      <div style={rowBetweenStyle}>
        <div>
          <h3 style={cardTitleStyle}>{props.bundle.name}</h3>
          <p style={metaStyle}>{String(props.bundle.skill.version)}</p>
        </div>
        <StateBadge value={props.bundle.lifecycle} />
      </div>
      <Labeled label="验证证据引用（逗号分隔）">
        <input value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="artifact-… , verifier-receipt-…" />
      </Labeled>
      <Labeled label="晋升 / 治理理由">
        <input value={reason} onChange={event => setReason(event.target.value)} />
      </Labeled>
      <div style={buttonRowStyle}>
        {next === null ? null : (
          <button type="button" className="dshm-button-success" style={approveButtonStyle} disabled={props.disabled || splitList(evidence).length === 0} onClick={() => { void promote(next) }}>
            晋升到 {next}
          </button>
        )}
        {rollback === null || props.source?.status === 'REVOKED' ? null : (
          <button
            type="button"
            disabled={props.disabled || splitList(evidence).length === 0}
            onClick={() => { void promote(rollback) }}
          >
            回滚到 {rollback}
          </button>
        )}
        {!['QUARANTINED', 'DEPRECATED'].includes(props.bundle.lifecycle) ? (
          <button type="button" className="dshm-button-danger" style={dangerButtonStyle} disabled={props.disabled} onClick={() => { void promote('QUARANTINED') }}>隔离</button>
        ) : null}
        {props.bundle.lifecycle !== 'DEPRECATED' ? (
          <button type="button" disabled={props.disabled} onClick={() => { void promote('DEPRECATED') }}>退役</button>
        ) : null}
      </div>
    </article>
  )
}

function RevocationView(props: ViewProps): ReactNode {
  return (
    <div style={stackStyle}>
      <SectionHeading title="撤回与影响" description="撤回会先阻断新召回并隔离全部派生 exact version；历史使用与影响报告仍保留供审计。" />
      <div style={listGridStyle}>
        {props.snapshot.operation.sources.map(source => (
          <RevocationSourceCard
            key={String(source.sourceHandle)}
            source={source}
            dispatch={props.dispatch}
            disabled={props.disabled}
          />
        ))}
      </div>
      <SectionHeading title="撤回记录" description="Impact 报告由 Host 从来源→版本→使用派生图生成。" />
      {props.snapshot.operation.revocations.length === 0 ? <Empty text="尚无撤回记录。" /> : (
        <div style={listGridStyle}>
          {props.snapshot.operation.revocations.map(order => (
            <article style={cardStyle} key={order.revocationOrderId}>
              <div style={rowBetweenStyle}>
                <div>
                  <h3 style={cardTitleStyle}>{order.reason}</h3>
                  <p style={metaStyle}>{order.revocationOrderId}</p>
                </div>
                <StateBadge value="REVOKED" />
              </div>
              <p style={descriptionStyle}>{order.affectedTacticVersions.length} 个派生版本 · {order.requiredActions.join('、')}</p>
              <button type="button" disabled={props.disabled} onClick={() => {
                void props.dispatch({ type: 'ASSESS_REVOCATION', revocationOrderId: order.revocationOrderId }, '影响报告已重新生成。')
              }}>重新生成影响报告</button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function RevocationSourceCard(props: {
  readonly source: KnowledgeSnapshot['operation']['sources'][number]
  readonly dispatch: Dispatch
  readonly disabled: boolean
}): ReactNode {
  const [reason, setReason] = useState(
    'OWNER_REQUEST' as 'OWNER_REQUEST' | 'LICENSE_CHANGE' | 'SECURITY_INCIDENT' | 'PROVEN_INCORRECT' | 'RETENTION_EXPIRY',
  )
  return (
    <article style={cardStyle}>
      <div style={rowBetweenStyle}>
        <div>
          <h3 style={cardTitleStyle}>{props.source.title}</h3>
          <p style={metaStyle}>{String(props.source.sourceHandle)}</p>
        </div>
        <StateBadge value={props.source.status} />
      </div>
      <p style={descriptionStyle}>
        {props.source.rights.license} · {props.source.rights.retentionPolicyRef}
        {' · valid until '}{props.source.rights.validUntil ?? 'revoked'}
      </p>
      <Labeled label="撤回原因">
        <select value={reason} onChange={event => setReason(event.target.value as typeof reason)}>
          <option value="OWNER_REQUEST">所有者请求</option>
          <option value="LICENSE_CHANGE">许可变化</option>
          <option value="SECURITY_INCIDENT">安全事件</option>
          <option value="PROVEN_INCORRECT">已证明不正确</option>
          <option value="RETENTION_EXPIRY">保留期届满</option>
        </select>
      </Labeled>
      <button
        type="button"
        className="dshm-button-danger"
        style={dangerButtonStyle}
        disabled={props.disabled || props.source.status === 'REVOKED'}
        onClick={() => {
          void props.dispatch({
            type: 'REVOKE_SOURCE',
            sourceHandle: String(props.source.sourceHandle),
            reason,
          }, '来源已撤回；新召回已阻断并生成影响结果。')
        }}
      >
        撤回来源并隔离派生版本
      </button>
    </article>
  )
}

interface ViewProps {
  readonly snapshot: KnowledgeSnapshot
  readonly dispatch: Dispatch
  readonly disabled: boolean
}

type Dispatch = (action: Record<string, unknown>, message: string) => Promise<void>

function SectionHeading(props: { readonly title: string; readonly description: string }): ReactNode {
  return <div><h3 style={sectionTitleStyle}>{props.title}</h3><p style={sectionDescriptionStyle}>{props.description}</p></div>
}

function Labeled(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return <label style={labelStyle}><span style={labelTextStyle}>{props.label}</span>{props.children}</label>
}

function StateBadge({ value }: { readonly value: string }): ReactNode {
  const positive = ['SANITIZED', 'COMPLETED', 'APPROVED_AS_DRAFT', 'STABLE', 'ACTIVE', 'PASS'].includes(value)
  const danger = ['FAILED', 'REJECTED', 'QUARANTINED', 'REVOKED', 'FAIL'].includes(value)
  const running = ['RUNNING', 'PROCESSING', 'EXTRACTING', 'CANARY'].includes(value)
  return (
    <Pill className="dshm-status">
      <StateDot state={danger ? 'error' : positive ? 'done' : running ? 'ongoing' : 'warning'} />
      {value}
    </Pill>
  )
}

function MiniMetric(props: { readonly label: string; readonly value: string }): ReactNode {
  return <div style={miniMetricStyle}><span>{props.label}</span><strong>{props.value}</strong></div>
}

function Progress({ completed, total }: { readonly completed: number; readonly total: number }): ReactNode {
  const percent = total === 0 ? 0 : Math.round(completed / total * 100)
  return (
    <div style={progressShellStyle} aria-label={`提炼进度 ${percent}%`}>
      <div style={{ ...progressFillStyle, width: `${percent}%` }} />
    </div>
  )
}

function Empty({ text }: { readonly text: string }): ReactNode {
  return <div style={emptyStyle}>{text}</div>
}

function useKnowledgeCenterOpen(): boolean {
  const subscribe = useCallback((listener: () => void) => {
    centreListeners.add(listener)
    return () => { centreListeners.delete(listener) }
  }, [])
  const getSnapshot = useCallback(() => centreOpen, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useScopeValue(scope: Scope): Record<string, unknown> {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).value ?? {}
}

export function parseKnowledgeSnapshot(source: unknown): KnowledgeSnapshot {
  let value: unknown = source
  if (typeof source === 'string' && source.trim() !== '') {
    try {
      value = JSON.parse(source)
    } catch { /* fail closed to an empty projection */ }
  }
  if (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'operation' in value
    && 'tags' in value
    && Array.isArray((value as { readonly tags?: unknown }).tags)
  ) {
    const operation = (value as { readonly operation?: unknown }).operation
    if (
      operation !== null
      && typeof operation === 'object'
      && !Array.isArray(operation)
      && Array.isArray((operation as { readonly sources?: unknown }).sources)
      && Array.isArray((operation as { readonly jobs?: unknown }).jobs)
      && Array.isArray((operation as { readonly candidates?: unknown }).candidates)
      && Array.isArray((operation as { readonly bundles?: unknown }).bundles)
    ) {
      const parsed = value as Partial<KnowledgeSnapshot> & {
        readonly operation: KnowledgeSnapshot['operation']
        readonly tags: readonly TacticalTag[]
      }
      return {
        operation: {
          ...parsed.operation,
          pipelines: Array.isArray(parsed.operation.pipelines)
            ? parsed.operation.pipelines
            : [],
        },
        tags: parsed.tags,
        transparency: Array.isArray(parsed.transparency) ? parsed.transparency : [],
        recallSimulations: Array.isArray(parsed.recallSimulations)
          ? parsed.recallSimulations
          : [],
      }
    }
  }
  return {
    operation: {
      schemaVersion: '1.0.0',
      sources: [],
      jobs: [],
      candidates: [],
      reviews: [],
      promotions: [],
      bundles: [],
      usages: [],
      revocations: [],
      pipelines: [],
      generatedAt: '' as PrivateSkillOperationSnapshot['generatedAt'],
    },
    tags: [],
    transparency: [],
    recallSimulations: [],
  }
}

export async function fetchKnowledgeSnapshot(
  connection: Pick<ConnectionHandle, 'rpc'>,
  signal?: AbortSignal,
): Promise<KnowledgeSnapshot> {
  return parseKnowledgeSnapshot(await callMilitaryRpc(
    connection,
    'militaryPrivateSkills',
    'snapshot',
    {},
    { signal, key: 'military-private-skills-snapshot' },
  ))
}

export async function dispatchKnowledgeAction(
  connection: Pick<ConnectionHandle, 'rpc'>,
  action: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const operationId = typeof action.operationId === 'string'
    ? action.operationId
    : `web-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  const invoke = async () => await callMilitaryRpc(
      connection,
      'militaryPrivateSkills',
      'execute',
      { action: { ...action, operationId } },
      { signal, dedupe: false },
    )
  let response: unknown
  try {
    response = await invoke()
  } catch (error) {
    signal?.throwIfAborted()
    // One transport retry reuses the exact operation identity. Domain errors
    // arrive as structured responses and are never retried here.
    response = await invoke().catch(() => { throw error })
  }
  return response
}

function viewCount(view: ViewId, operation: KnowledgeSnapshot['operation']): number {
  switch (view) {
    case 'sources': return operation.sources.length
    case 'jobs': return operation.jobs.length
    case 'reviews': return operation.candidates.filter(value => value.status === 'PENDING_REVIEW' || value.status === 'RETURNED').length
    case 'library': return operation.bundles.length
    case 'recall': return operation.bundles.filter(value =>
      ['CANARY', 'TESTING', 'STABLE'].includes(value.lifecycle)).length
    case 'promotion': return operation.bundles.filter(value => value.lifecycle !== 'DEPRECATED').length
    case 'revocation': return operation.revocations.length
  }
}

function resumable(job: PrivateSkillIngestionJob): boolean {
  return ![
    'PENDING_REVIEW',
    'APPROVED_AS_DRAFT',
    'RETURNED',
    'REJECTED',
    'CANCELLED',
    'AWAITING_INJECTION_ACK',
  ].includes(job.state)
}

function nextLifecycle(value: string): 'SIMULATION' | 'CANARY' | 'TESTING' | 'STABLE' | null {
  switch (value) {
    case 'DRAFT': return 'SIMULATION'
    case 'SIMULATION': return 'CANARY'
    case 'CANARY': return 'TESTING'
    case 'TESTING': return 'STABLE'
    default: return null
  }
}

function rollbackLifecycle(value: string): 'DRAFT' | 'SIMULATION' | 'CANARY' | 'TESTING' | null {
  switch (value) {
    case 'SIMULATION': return 'DRAFT'
    case 'CANARY': return 'SIMULATION'
    case 'TESTING': return 'CANARY'
    case 'STABLE': return 'TESTING'
    case 'QUARANTINED': return 'DRAFT'
    default: return null
  }
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean)
}

function splitParagraphs(value: string): string[] {
  return value.split(/\n\s*\n/u).map(item => item.replace(/\s+/gu, ' ').trim()).filter(Boolean)
}

function splitList(value: string): string[] {
  return value.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '8px 14px 6px 20px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const headerActionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.12em',
  lineHeight: '12px',
}
const titleStyle: CSSProperties = {
  margin: '2px 0 0',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 16,
  fontWeight: 500,
  lineHeight: '24px',
}
const subtitleStyle: CSSProperties = {
  margin: '1px 0 0',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}
const closeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 28,
  height: 28,
  padding: 0,
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}
const bodyStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '188px minmax(0, 1fr)',
  minHeight: 0,
}
const navStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 12px 10px',
  borderRight: '1px solid var(--dsw-alias-border-l2)',
  minHeight: 0,
}
const navButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  height: 40,
  padding: '9px 12px',
  border: 0,
  borderRadius: 12,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  textAlign: 'left',
  cursor: 'pointer',
}
const navActiveStyle: CSSProperties = {
  ...navButtonStyle,
  background: 'var(--dsw-specific-sidebar-nav-item-active)',
  fontWeight: 500,
}
const countStyle: CSSProperties = {
  minWidth: 20,
  height: 18,
  padding: '0 6px',
  borderRadius: 9,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  textAlign: 'center',
  fontSize: 11,
  lineHeight: '18px',
}
const policyStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  marginTop: 'auto',
  padding: '10px 4px 0',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
}
const contentStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'auto',
  padding: 24,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}
const noticeStyle: CSSProperties = {
  margin: '0 0 12px',
  padding: '9px 12px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}
const errorStyle: CSSProperties = {
  margin: '0 0 12px',
  padding: '9px 12px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-state-error-primary)',
  fontSize: 12,
  lineHeight: '18px',
}
const stackStyle: CSSProperties = { display: 'grid', gap: 14 }
const sectionTitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 16,
  fontWeight: 500,
  lineHeight: '24px',
}
const sectionDescriptionStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}
const formCardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform)',
}
const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
  alignSelf: 'start',
}
const reviewCardStyle: CSSProperties = { ...cardStyle, padding: '16px 18px' }
const listGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 11, alignItems: 'start' }
const formGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }
const twoColumnStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
const checkboxLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}
const tagFieldsetStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  margin: 0,
  padding: '8px 10px 10px',
}
const tagLegendStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
  padding: '0 4px',
}
const tagOptionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }
const labelStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0 }
const labelTextStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
}
const largeTextareaStyle: CSSProperties = { minHeight: 150, resize: 'vertical' }
const mediumTextareaStyle: CSSProperties = { minHeight: 125, resize: 'vertical' }
const smallTextareaStyle: CSSProperties = { minHeight: 90, resize: 'vertical' }
const primaryButtonStyle: CSSProperties = {
  justifySelf: 'start',
  height: 36,
  padding: '0 14px',
  border: 0,
  borderRadius: 18,
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
  cursor: 'pointer',
}
const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
}
const approveButtonStyle: CSSProperties = { ...primaryButtonStyle, color: 'var(--dsw-alias-state-success-primary)' }
const dangerButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: 'transparent',
  color: 'var(--dsw-alias-state-error-primary)',
}
const buttonRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }
const rowBetweenStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }
const cardTitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '22px',
}
const metaStyle: CSSProperties = {
  margin: '3px 0 0',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
  wordBreak: 'break-all',
}
const descriptionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}
const metricRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }
const miniMetricStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  minWidth: 0,
  padding: '7px 8px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '16px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const summaryStyle: CSSProperties = {
  width: 'fit-content',
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
}
const diffStyle: CSSProperties = {
  maxHeight: 230,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  padding: 10,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '17px',
}
const plainListStyle: CSSProperties = {
  margin: '8px 0 0',
  paddingLeft: 18,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}
const emptyStyle: CSSProperties = {
  padding: 35,
  border: '1px dashed var(--dsw-alias-border-l3)',
  borderRadius: 12,
  color: 'var(--dsw-alias-label-tertiary)',
  textAlign: 'center',
  fontSize: 12,
  lineHeight: '18px',
}
const progressShellStyle: CSSProperties = {
  height: 5,
  borderRadius: 999,
  overflow: 'hidden',
  background: 'var(--dsw-alias-bg-module-platform)',
}
const progressFillStyle: CSSProperties = { height: '100%', background: 'var(--dsw-alias-state-success-primary)', transition: 'width 180ms ease' }
