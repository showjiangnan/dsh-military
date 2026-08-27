import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  GENERAL_ROLE_ID,
  ROLE_BUDGET_PRESETS,
  applySimplifiedChineseFixes,
  estimateUsdCost,
  lintSimplifiedChinese,
  type FlashReadinessReport,
  type MilitaryModelCatalogEntry,
  type PromptDiffSummary,
  type RoleDraft,
  type RoleSimulationReport,
  type SimplifiedChineseLintReport,
  type SimplifiedChineseReviewInput,
  type RoleWorkbenchRoleSnapshot,
  type RoleWorkbenchSnapshot,
} from '@dsh-military/contracts/control-plane'

interface Props {
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
  readonly onDirtyChange?: (dirty: boolean) => void
}

interface DraftPreview {
  readonly expectedRevision: number
  readonly roleId: string
  readonly preview: RoleWorkbenchRoleSnapshot['preview']
  readonly readiness: FlashReadinessReport
  readonly diff: PromptDiffSummary
  readonly simplifiedChineseLint?: SimplifiedChineseLintReport
  readonly model?: MilitaryModelCatalogEntry
}

interface RevisionConflict {
  readonly code: 'REVISION_CONFLICT'
  readonly expectedRevision: number
  readonly current: RoleWorkbenchSnapshot
}

interface ImportPreview {
  readonly expectedRevision: number
  readonly drafts: readonly RoleDraft[]
  readonly roles: readonly {
    readonly roleId: string
    readonly diff: PromptDiffSummary
    readonly readiness: FlashReadinessReport
  }[]
  readonly blocked: boolean
}

export function RoleWorkbench(props: Props): ReactNode {
  const { connection, onResult, onDirtyChange } = props
  const [snapshot, setSnapshot] = useState<RoleWorkbenchSnapshot>()
  const [selectedRoleId, setSelectedRoleId] = useState<string>(GENERAL_ROLE_ID)
  const [baseline, setBaseline] = useState<RoleDraft>()
  const [draft, setDraft] = useState<RoleDraft>()
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('all')
  const [readinessFilter, setReadinessFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<DraftPreview>()
  const [simulation, setSimulation] = useState<RoleSimulationReport>()
  const [conflict, setConflict] = useState<RevisionConflict>()
  const [pendingRoleId, setPendingRoleId] = useState<string>()
  const [externalRevision, setExternalRevision] = useState<number>()
  const [canaryDisclosure, setCanaryDisclosure] = useState(false)
  const [canaryConfirmed, setCanaryConfirmed] = useState(false)
  const [portable, setPortable] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview>()
  const [selectedLintStarts, setSelectedLintStarts] = useState<readonly number[]>([])
  const [appliedLintReview, setAppliedLintReview] = useState<{
    readonly sourcePrompt: string
    readonly confirmedStarts: readonly number[]
  }>()
  const [lintAcknowledged, setLintAcknowledged] = useState(false)
  const refreshInFlight = useRef(false)
  const snapshotRevisionRef = useRef(0)
  const busyRef = useRef(false)
  const dirtyRef = useRef(false)
  const selectedRoleIdRef = useRef<string>(GENERAL_ROLE_ID)
  const dirty = useMemo(
    () => draft !== undefined && baseline !== undefined && !sameDraft(draft, baseline),
    [draft, baseline],
  )
  busyRef.current = busy
  dirtyRef.current = dirty
  selectedRoleIdRef.current = selectedRoleId

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const adoptRole = useCallback((
    next: RoleWorkbenchSnapshot,
    roleId: string,
  ): void => {
    const role = next.roles.find(value => value.configuration.roleId === roleId)
      ?? next.roles[0]
    if (role === undefined) return
    const nextDraft = draftFromRole(role)
    setSelectedRoleId(role.configuration.roleId)
    setBaseline(nextDraft)
    setDraft(nextDraft)
    setPreview(undefined)
    setSimulation(undefined)
    setConflict(undefined)
    setExternalRevision(undefined)
    setPendingRoleId(undefined)
    setCanaryDisclosure(false)
    setCanaryConfirmed(false)
    setSelectedLintStarts([])
    setAppliedLintReview(undefined)
    setLintAcknowledged(false)
  }, [])

  const refresh = useCallback(async (
    signal?: AbortSignal,
    options?: { readonly adopt?: boolean; readonly roleId?: string },
  ): Promise<RoleWorkbenchSnapshot | undefined> => {
    if (refreshInFlight.current) return undefined
    refreshInFlight.current = true
    try {
      const next = await fetchMilitaryControlSnapshot(connection, signal)
      if (next.documentRevision < snapshotRevisionRef.current) return undefined
      snapshotRevisionRef.current = next.documentRevision
      setSnapshot(previous => {
        if (
          previous !== undefined
          && previous.documentRevision < next.documentRevision
          && dirtyRef.current
        ) setExternalRevision(next.documentRevision)
        return next
      })
      setError('')
      if (options?.adopt === true) {
        adoptRole(next, options.roleId ?? selectedRoleIdRef.current)
      }
      return next
    } catch (refreshError) {
      if (signal?.aborted !== true) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
      }
      return undefined
    } finally {
      refreshInFlight.current = false
    }
  }, [adoptRole, connection])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal, { adopt: true })
    const timer = globalThis.setInterval(() => {
      if (!busyRef.current) void refresh(controller.signal)
    }, 5_000)
    return () => {
      controller.abort()
      globalThis.clearInterval(timer)
      refreshInFlight.current = false
    }
  }, [refresh])

  const run = useCallback(async <T,>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (busy) return undefined
    setBusy(true)
    setError('')
    try {
      return await operation()
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

  const role = snapshot?.roles.find(value =>
    value.configuration.roleId === selectedRoleId)
  const simplifiedChineseLint = useMemo(
    () => lintSimplifiedChinese(draft?.prompt ?? ''),
    [draft?.prompt],
  )
  const models = snapshot?.models ?? []
  const departments = useMemo(() => [
    ...new Set((snapshot?.roles ?? []).map(value => value.configuration.department)),
  ].sort(), [snapshot])
  const visibleRoles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    return (snapshot?.roles ?? []).filter(value => {
      const configuration = value.configuration
      return (department === 'all' || configuration.department === department)
        && (readinessFilter === 'all' || value.readiness.disposition === readinessFilter)
        && (
          normalized === ''
          || configuration.displayName.toLocaleLowerCase('zh-CN').includes(normalized)
          || configuration.roleId.toLocaleLowerCase('zh-CN').includes(normalized)
          || configuration.role.toLocaleLowerCase('zh-CN').includes(normalized)
        )
    })
  }, [department, query, readinessFilter, snapshot])

  const chooseRole = (roleId: string): boolean => {
    if (snapshot === undefined) return false
    if (roleId === selectedRoleId) return true
    if (dirty) {
      setPendingRoleId(roleId)
      return false
    }
    adoptRole(snapshot, roleId)
    return true
  }

  const reviewDraft = async (): Promise<void> => {
    if (draft === undefined) return
    if (simplifiedChineseLint.issues.length > 0 && !lintAcknowledged) {
      const message = `仍有 ${simplifiedChineseLint.issues.length} 个简体中文检查项；请应用建议或明确确认保留。`
      setError(message)
      onResult(message)
      return
    }
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'PREVIEW_ROLE',
        draft,
      }) as DraftPreview)
    if (value === undefined) return
    setPreview(value)
    setConflict(undefined)
    onResult(`${role?.configuration.displayName ?? draft.roleId}：Host 已生成保存 Diff、有效提示词与 Flash 就绪报告。`)
  }

  const commitDraft = async (): Promise<void> => {
    if (draft === undefined || preview === undefined) return
    const lintReview: SimplifiedChineseReviewInput = {
      sourcePrompt: appliedLintReview?.sourcePrompt ?? draft.prompt,
      confirmedStarts: appliedLintReview?.confirmedStarts ?? [],
      acknowledgeRemaining: lintAcknowledged,
    }
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'SAVE_ROLE',
        expectedRevision: preview.expectedRevision,
        draft,
        lintReview,
      }))
    if (value === undefined) return
    const result = asRecord(value)
    if (result.completed === false && result.code === 'REVISION_CONFLICT') {
      setConflict(result as unknown as RevisionConflict)
      const current = (result as unknown as RevisionConflict).current
      snapshotRevisionRef.current = current.documentRevision
      setSnapshot(current)
      onResult('保存被 Host revision fence 拒绝：检测到其他标签页或外部设置变更。')
      return
    }
    const targetAfterSave = pendingRoleId ?? selectedRoleId
    try {
      const next = await fetchMilitaryControlSnapshot(connection)
      if (next.documentRevision <= preview.expectedRevision) {
        throw new Error(
          `Host 保存后仍返回旧 revision ${next.documentRevision}`,
        )
      }
      snapshotRevisionRef.current = next.documentRevision
      setSnapshot(next)
      adoptRole(next, targetAfterSave)
      onResult(`${role?.configuration.displayName ?? draft.roleId}：配置已由 Host 原子保存、运行时回读并生成不可变 revision。`)
    } catch (refreshError) {
      const message = refreshError instanceof Error
        ? refreshError.message
        : String(refreshError)
      setError(`配置已提交，但 Host 权威回读失败：${message}`)
      onResult(`配置保存后的权威回读失败：${message}`)
    }
  }

  const applyLintSuggestions = (starts: readonly number[]): void => {
    if (draft === undefined || starts.length === 0 || appliedLintReview !== undefined) return
    const sourcePrompt = draft.prompt
    const confirmedStarts = [...new Set(starts)].sort((left, right) => left - right)
    const resultPrompt = applySimplifiedChineseFixes(sourcePrompt, confirmedStarts)
    setDraft({ ...draft, prompt: resultPrompt })
    setAppliedLintReview({ sourcePrompt, confirmedStarts })
    setSelectedLintStarts([])
    setLintAcknowledged(lintSimplifiedChinese(resultPrompt).issues.length === 0)
    setPreview(undefined)
    setError('')
  }

  const resetLintState = (): void => {
    setSelectedLintStarts([])
    setAppliedLintReview(undefined)
    setLintAcknowledged(false)
  }

  const rebaseDraft = async (): Promise<void> => {
    if (draft === undefined || conflict === undefined) return
    const local = draft
    snapshotRevisionRef.current = conflict.current.documentRevision
    setSnapshot(conflict.current)
    setConflict(undefined)
    setExternalRevision(undefined)
    setBaseline(draftFromRole(requiredRole(conflict.current, selectedRoleId)))
    setDraft(local)
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'PREVIEW_ROLE',
        draft: local,
      }) as DraftPreview)
    if (value !== undefined) setPreview(value)
  }

  const simulate = async (): Promise<void> => {
    if (role === undefined) return
    const operationId = `simulation-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'SIMULATE_ROLE',
        operationId,
        roleId: role.configuration.roleId,
      }) as RoleSimulationReport)
    if (value !== undefined) {
      setSimulation(value)
      onResult(`${role.configuration.displayName}：离线工具合同模拟 ${value.status}，未调用模型且费用为 0。`)
    }
  }

  const runLiveCanary = async (): Promise<void> => {
    if (role === undefined || !canaryConfirmed) return
    const operationId = `canary-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'RUN_LIVE_CANARY',
        operationId,
        roleId: role.configuration.roleId,
        confirmation: 'RUN_SAFE_READ_ONLY_CANARY',
      }) as RoleSimulationReport)
    if (value !== undefined) {
      setSimulation(value)
      setCanaryDisclosure(false)
      setCanaryConfirmed(false)
      onResult(`${role.configuration.displayName}：在线只读 Canary ${value.status}；结果不会自动晋升模型。`)
    }
  }

  const exportPortable = async (): Promise<void> => {
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, { type: 'EXPORT_PORTABLE' }))
    if (value === undefined) return
    setPortable(JSON.stringify(value, null, 2))
    setImportPreview(undefined)
    onResult('已生成可移植配置；凭据、绝对路径、receipt 和运行历史均已排除。')
  }

  const previewImport = async (): Promise<void> => {
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'IMPORT_PREVIEW',
        portable,
      }) as ImportPreview)
    if (value !== undefined) {
      setImportPreview(value)
      onResult('Host 已完成导入预览与逐角色 Flash 就绪检查；尚未写入。')
    }
  }

  const commitImport = async (): Promise<void> => {
    if (importPreview === undefined) return
    const value = await run(async () =>
      await dispatchMilitaryControlAction(connection, {
        type: 'IMPORT_COMMIT',
        expectedRevision: importPreview.expectedRevision,
        portable,
      }))
    if (value === undefined) return
    const result = asRecord(value)
    if (result.completed === false && result.code === 'REVISION_CONFLICT') {
      setConflict(result as unknown as RevisionConflict)
      return
    }
    await refresh(undefined, { adopt: true, roleId: selectedRoleId })
    setImportPreview(undefined)
    onResult('可移植配置已作为一个 Host 原子事务写入。')
  }

  if (snapshot === undefined || role === undefined || draft === undefined) {
    return (
      <section data-role-workbench="true" aria-busy="true" style={loadingStyle}>
        <StateDot state={error === '' ? 'ongoing' : 'error'} />
        {error === '' ? '正在读取 Host 角色工作台…' : `角色工作台不可用：${error}`}
      </section>
    )
  }

  const selectedModel = models.find(value =>
    value.provider === draft.provider && value.model === draft.model)
  const budgetPreset = roleBudgetPreset(
    draft,
    selectedRoleId === GENERAL_ROLE_ID,
  )
  const promptEstimate = preview?.preview ?? role.preview
  const estimatedInputTokens = Math.min(
    draft.contextBudgetTokens,
    promptEstimate.estimatedTokens + 2_048,
  )
  const estimatedCost = estimateUsdCost({
    inputTokens: estimatedInputTokens,
    outputTokens: draft.maxOutputTokens,
    pricing: selectedModel?.pricing ?? { status: 'UNAVAILABLE', currency: 'USD' },
  })
  return (
    <div data-role-workbench="true" style={workbenchStyle}>
      <aside style={catalogStyle} data-role-catalog="true" aria-label="Military 角色目录">
        <div style={catalogFiltersStyle}>
          <label style={fieldStyle}>
            <span>搜索角色</span>
            <input
              aria-label="搜索 Military 角色"
              value={query}
              placeholder="名称、职责或 ID"
              onChange={event => { setQuery(event.target.value) }}
            />
          </label>
          <label style={fieldStyle}>
            <span>部门</span>
            <select
              aria-label="按部门筛选角色"
              value={department}
              onChange={event => { setDepartment(event.target.value) }}
            >
              <option value="all">全部部门</option>
              {departments.map(value => <option key={value} value={value}>{departmentLabel(value)}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span>就绪状态</span>
            <select
              aria-label="按就绪状态筛选角色"
              value={readinessFilter}
              onChange={event => { setReadinessFilter(event.target.value) }}
            >
              <option value="all">全部状态</option>
              <option value="READY">就绪</option>
              <option value="REVIEW">需复核</option>
              <option value="BLOCKED">已阻断</option>
            </select>
          </label>
        </div>
        <div
          style={roleListStyle}
          role="listbox"
          aria-label="Military 角色"
          aria-activedescendant={`military-role-option-${selectedRoleId}`}
        >
          {visibleRoles.map(value => {
            const configuration = value.configuration
            const active = configuration.roleId === selectedRoleId
            return (
              <button
                type="button"
                role="option"
                key={configuration.roleId}
                id={`military-role-option-${configuration.roleId}`}
                data-role-catalog-item={configuration.roleId}
                aria-selected={active}
                aria-controls={`military-role-editor-${configuration.roleId}`}
                tabIndex={active ? 0 : -1}
                style={active ? roleItemActiveStyle : roleItemStyle}
                onClick={() => { chooseRole(configuration.roleId) }}
                onKeyDown={event => {
                  navigateRoleOptions(
                    event,
                    configuration.roleId,
                    visibleRoles.map(value => value.configuration.roleId),
                    chooseRole,
                  )
                }}
              >
                <span style={roleItemHeadingStyle}>
                  <strong>{configuration.displayName}</strong>
                  <StateDot state={readinessDot(value.readiness.disposition)} />
                </span>
                <span style={roleItemMetaStyle}>{departmentLabel(configuration.department)}</span>
                <span style={roleItemMetaStyle}>{shortModel(configuration.model)}</span>
                {configuration.promptOverride === '' ? null : <span style={draftBadgeStyle}>自定义提示词</span>}
              </button>
            )
          })}
          {visibleRoles.length === 0 ? <p style={emptyStyle}>没有匹配角色。</p> : null}
        </div>
      </aside>

      <section
        id={`military-role-editor-${selectedRoleId}`}
        role="region"
        aria-labelledby={`military-role-heading-${selectedRoleId}`}
        style={editorStyle}
        data-role-editor={selectedRoleId}
      >
        <header style={editorHeaderStyle}>
          <div>
            <div style={headingRowStyle}>
              <h3
                id={`military-role-heading-${selectedRoleId}`}
                style={headingStyle}
              >
                {role.configuration.displayName}
              </h3>
              <Pill className="dshm-status">
                <StateDot state={readinessDot(role.readiness.disposition)} />
                {readinessLabel(role.readiness.disposition)}
              </Pill>
              {dirty ? <Pill>未保存草稿</Pill> : null}
            </div>
            <p style={hintStyle}>
              {departmentLabel(role.configuration.department)} · {role.configuration.roleId} ·
              配置 revision {role.history[0]?.revision ?? 0}
            </p>
          </div>
          <div style={actionRowStyle}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft(draftFromConfiguration(role.bundledConfiguration, role.bundledPrompt))
                setPreview(undefined)
                resetLintState()
              }}
            >
              恢复全部自带配置
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || draft.prompt === role.bundledPrompt}
              onClick={() => {
                setDraft(current => current === undefined
                  ? current
                  : { ...current, prompt: role.bundledPrompt })
                setPreview(undefined)
                resetLintState()
              }}
            >
              恢复自带提示词
            </Button>
          </div>
        </header>

        {pendingRoleId === undefined ? null : (
          <div role="alert" style={warningStyle}>
            <strong>当前角色有未保存草稿。</strong>
            <span>切换角色前请保存或明确放弃；草稿不会被静默丢弃。</span>
            <div style={actionRowStyle}>
              <Button variant="primary" size="sm" onClick={() => { void reviewDraft() }}>
                检查草稿后进入保存
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                adoptRole(snapshot, pendingRoleId)
              }}>
                放弃草稿并切换
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setPendingRoleId(undefined) }}>
                取消
              </Button>
            </div>
          </div>
        )}
        {externalRevision === undefined ? null : (
          <div role="status" style={warningStyle}>
            <strong>检测到外部 revision {externalRevision}。</strong>
            <span>本地草稿仍被保留；保存时 Host 会要求变基或采用外部版本。</span>
          </div>
        )}
        {conflict === undefined ? null : (
          <div role="alert" style={errorStyle}>
            <strong>配置 revision 冲突</strong>
            <span>
              打开时为 {conflict.expectedRevision}，当前 Host 已是 {conflict.current.documentRevision}。
            </span>
            <div style={actionRowStyle}>
              <Button variant="primary" size="sm" onClick={() => { void rebaseDraft() }}>
                将草稿变基并重新审阅
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                snapshotRevisionRef.current = conflict.current.documentRevision
                setSnapshot(conflict.current)
                adoptRole(conflict.current, selectedRoleId)
              }}>
                采用外部版本
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                setConflict(undefined)
                setPreview(undefined)
              }}>
                保留草稿，暂不保存
              </Button>
            </div>
          </div>
        )}
        {error === '' ? null : <p role="alert" style={errorTextStyle}>{error}</p>}

        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span>执行模型</span>
            <select
              aria-label={`${role.configuration.displayName} 模型`}
              value={routeKey(draft.provider, draft.model)}
              disabled={busy}
              onChange={event => {
                const model = models.find(value => value.exactRoute === event.target.value)
                if (model === undefined) return
                setDraft(current => current === undefined
                  ? current
                  : {
                      ...current,
                      provider: model.provider,
                      model: model.model,
                      maxOutputTokens: Math.min(
                        current.maxOutputTokens,
                        model.maxOutputTokens ?? current.maxOutputTokens,
                      ),
                      contextBudgetTokens: Math.min(
                        current.contextBudgetTokens,
                        model.contextWindowTokens ?? current.contextBudgetTokens,
                      ),
                    })
                setPreview(undefined)
              }}
            >
              {models.map(model => (
                <option
                  key={model.exactRoute}
                  value={model.exactRoute}
                  disabled={!model.selectable && model.exactRoute !== routeKey(draft.provider, draft.model)}
                >
                  {model.modelName} · {model.providerName} · {modelStatusLabel(model.status)}
                </option>
              ))}
            </select>
            <small style={microStyle}>
              {selectedModel?.statusReason ?? 'Host 未解析该 exact route。'}
            </small>
          </label>
          <label style={fieldStyle}>
            <span>推理强度</span>
            <select
              aria-label={`${role.configuration.displayName} 推理强度`}
              value={draft.reasoningEffort}
              onChange={event => {
                const value = event.target.value === 'max' ? 'max' : 'high'
                setDraft(current => current === undefined ? current : { ...current, reasoningEffort: value })
                setPreview(undefined)
              }}
            >
              <option value="high">High（轻量主力推荐）</option>
              <option value="max">Max（显式深度）</option>
            </select>
          </label>
          <label style={fieldStyle}>
            <span>预算预设</span>
            <select
              aria-label={`${role.configuration.displayName} 预算预设`}
              value={budgetPreset}
              onChange={event => {
                const preset = ROLE_BUDGET_PRESETS.find(value =>
                  value.id === event.target.value)
                if (preset === undefined) return
                setDraft(current => current === undefined
                  ? current
                  : {
                      ...current,
                      maxOutputTokens: Math.min(
                        preset.maxOutputTokens,
                        selectedModel?.maxOutputTokens ?? preset.maxOutputTokens,
                      ),
                      contextBudgetTokens: Math.min(
                        preset.contextBudgetTokens,
                        selectedModel?.contextWindowTokens ?? preset.contextBudgetTokens,
                      ),
                      concurrencyLimit: selectedRoleId === GENERAL_ROLE_ID
                        ? 1
                        : preset.concurrencyLimit,
                    })
                setPreview(undefined)
              }}
            >
              {ROLE_BUDGET_PRESETS.map(value => (
                <option key={value.id} value={value.id}>
                  {value.label} · {value.description}
                </option>
              ))}
              <option value="CUSTOM">自定义 · 保留当前数字</option>
            </select>
          </label>
          <NumberDraftField
            label="最大输出 tokens"
            value={draft.maxOutputTokens}
            min={1_024}
            max={selectedModel?.maxOutputTokens ?? 256_000}
            step={1_024}
            onChange={value => {
              setDraft(current => current === undefined ? current : { ...current, maxOutputTokens: value })
              setPreview(undefined)
            }}
          />
          <NumberDraftField
            label="上下文预算 tokens"
            value={draft.contextBudgetTokens}
            min={4_096}
            max={selectedModel?.contextWindowTokens ?? 1_000_000}
            step={1_024}
            onChange={value => {
              setDraft(current => current === undefined ? current : { ...current, contextBudgetTokens: value })
              setPreview(undefined)
            }}
          />
          {selectedRoleId === GENERAL_ROLE_ID ? null : (
            <NumberDraftField
              label="部门并发上限"
              value={draft.concurrencyLimit}
              min={1}
              max={64}
              step={1}
              onChange={value => {
                setDraft(current => current === undefined ? current : { ...current, concurrencyLimit: value })
                setPreview(undefined)
              }}
            />
          )}
        </div>

        <div style={budgetSummaryStyle} aria-label="角色预算影响与费用估算">
          <div>
            <strong>预算影响（估算）</strong>
            <p style={microStyle}>
              输入按“有效提示词 + 2,048 task tokens”估算为 {estimatedInputTokens.toLocaleString('zh-CN')}；
              最大输出 {draft.maxOutputTokens.toLocaleString('zh-CN')} tokens，约
              {Math.floor(draft.maxOutputTokens / 1.05).toLocaleString('zh-CN')} 个简体中文字符。
            </p>
          </div>
          <Pill>
            {estimatedCost.status === 'ESTIMATED'
              ? `预计 $${estimatedCost.value.toFixed(6)} USD`
              : 'Provider 价格与时间戳不可用'}
          </Pill>
          <p style={microStyle}>
            这是上限估算，不是 Host 观察账单。预算预设不会改变工具权限、验证强度、证据要求或终止规则；
            maximumSteps 由执行策略决定，最大无进展轮数由“安全与恢复”门禁统一控制。
          </p>
        </div>

        {selectedModel === undefined ? null : (
          <details style={detailsStyle}>
            <summary>模型能力与状态证据</summary>
            <div style={historyItemStyle}>
              <p style={microStyle}>
                exact route：{selectedModel.exactRoute} · 状态 {modelStatusLabel(selectedModel.status)}
                {selectedModel.statusRevision === undefined
                  ? ''
                  : ` @${selectedModel.statusRevision}`}
                {selectedModel.statusChangedAt === undefined
                  ? ''
                  : ` · ${formatDate(selectedModel.statusChangedAt)}`}
              </p>
              <p style={microStyle}>
                工具调用 {selectedModel.toolCalling} · 推理
                {selectedModel.supportedReasoning.length === 0
                  ? ' 未披露'
                  : ` ${selectedModel.supportedReasoning.join('/')}`} ·
                上下文 {selectedModel.contextWindowTokens?.toLocaleString('zh-CN') ?? '未披露'} ·
                最大输出 {selectedModel.maxOutputTokens?.toLocaleString('zh-CN') ?? '未披露'} ·
                输入模态 {selectedModel.inputModalities.join('/') || '未披露'}
              </p>
              <ul style={compactListStyle}>
                {selectedModel.evidence.map(value => <li key={value}>{value}</li>)}
              </ul>
              <p style={microStyle}>
                aliases：{selectedModel.aliases?.length === 0
                  ? 'Host 未证明任何别名'
                  : selectedModel.aliases?.join('、') ?? 'Host 未证明任何别名'}；
                价格：{selectedModel.pricing.status === 'AVAILABLE'
                  ? `${selectedModel.pricing.currency} · ${selectedModel.pricing.observedAt ?? '无时间戳'}`
                  : 'Provider 未公开，Military 不猜测'}。
              </p>
            </div>
          </details>
        )}

        <label style={promptFieldStyle} data-role-prompt-editor={role.configuration.displayName}>
          <span style={promptLabelStyle}>
            <strong>角色提示词（简体中文）</strong>
            <span>{draft.prompt.length} 字符</span>
          </span>
          <textarea
            aria-label={`${role.configuration.displayName} 角色提示词`}
            rows={12}
            value={draft.prompt}
            spellCheck={false}
            disabled={busy}
            onChange={event => {
              setDraft(current => current === undefined
                ? current
                : { ...current, prompt: event.target.value })
              setPreview(undefined)
              resetLintState()
            }}
          />
          <small style={hintStyle}>
            这里只编辑角色指导；Host 身份、工具、Workspace、Evidence、终态和运行预算层不可修改。
          </small>
        </label>

        <section style={budgetSummaryStyle} aria-label="简体中文提示词辅助检查">
          <div style={headingRowStyle}>
            <strong>简体中文辅助检查</strong>
            <Pill>
              {simplifiedChineseLint.issues.length === 0
                ? '未发现问题'
                : `${simplifiedChineseLint.issues.length} 项待确认`}
            </Pill>
            <span style={microStyle}>
              已检查 {simplifiedChineseLint.checkedCharacters.toLocaleString('zh-CN')} 字符，
              跳过 {simplifiedChineseLint.skippedRanges.length} 个代码/路径/标识符区间
            </span>
          </div>
          <p style={microStyle}>
            建议仅作用于自然语言位置；Host 会重新计算替换、最终文本和 SHA-256，
            不接受浏览器伪造的检查回执。不会静默全文转换。
          </p>
          {appliedLintReview === undefined ? null : (
            <div role="status" style={warningStyle}>
              <span>
                已应用 {appliedLintReview.confirmedStarts.length} 项确认建议。
                如需改变选择，请先撤销本批次。
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraft(current => current === undefined
                    ? current
                    : { ...current, prompt: appliedLintReview.sourcePrompt })
                  resetLintState()
                  setPreview(undefined)
                }}
              >
                撤销本批次
              </Button>
            </div>
          )}
          {simplifiedChineseLint.issues.length === 0 ? null : (
            <div>
              <div style={historyStyle}>
                {simplifiedChineseLint.issues.map(issue => {
                  const selected = selectedLintStarts.includes(issue.start)
                  return (
                    <article
                      key={`${issue.start}-${issue.original}`}
                      style={historyItemStyle}
                      data-simplified-chinese-issue={issue.start}
                    >
                      <label style={checkStyle}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={busy || appliedLintReview !== undefined}
                          onChange={event => {
                            setSelectedLintStarts(current => event.target.checked
                              ? [...current, issue.start]
                              : current.filter(value => value !== issue.start))
                          }}
                        />
                        位置 {issue.start}：“{issue.original}” → “{issue.replacement}”
                      </label>
                      <span style={microStyle}>{issue.message}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || appliedLintReview !== undefined}
                        onClick={() => { applyLintSuggestions([issue.start]) }}
                      >
                        仅应用此项
                      </Button>
                    </article>
                  )
                })}
              </div>
              <div style={actionRowStyle}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    busy
                    || appliedLintReview !== undefined
                    || selectedLintStarts.length === 0
                  }
                  onClick={() => { applyLintSuggestions(selectedLintStarts) }}
                >
                  应用全部已确认项（{selectedLintStarts.length}）
                </Button>
                <label style={checkStyle}>
                  <input
                    type="checkbox"
                    checked={lintAcknowledged}
                    onChange={event => { setLintAcknowledged(event.target.checked) }}
                  />
                  我已逐项审阅，并明确保留其余提示
                </label>
              </div>
            </div>
          )}
        </section>

        <div style={saveBarStyle}>
          <div style={actionRowStyle}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { void simulate() }}>
              离线工具模拟（0 费用）
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setCanaryDisclosure(value => !value)
                setCanaryConfirmed(false)
              }}
            >
              准备在线 Canary
            </Button>
          </div>
          <div style={actionRowStyle}>
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty || busy}
              onClick={() => {
                setDraft(baseline)
                setPreview(undefined)
                setError('')
                resetLintState()
              }}
            >
              放弃草稿
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={
                !dirty
                || busy
                || (simplifiedChineseLint.issues.length > 0 && !lintAcknowledged)
              }
              onClick={() => { void reviewDraft() }}
            >
              检查并进入保存确认
            </Button>
          </div>
        </div>

        {canaryDisclosure ? (
          <div style={warningStyle} data-live-canary-disclosure="true">
            <strong>显式在线 Canary（可能产生模型费用）</strong>
            <span>
              exact route：{draft.provider}/{draft.model}；最大输出 256 tokens；只暴露一个无副作用
              `military_canary_report` 工具，不读取、不写入、不执行项目操作，也不会自动晋升或 fallback。
              当前 Provider 未公开 Host 可用价格，因此运行前金额只能标记为“价格不可用”。
            </span>
            <label style={checkStyle}>
              <input
                type="checkbox"
                aria-label="确认运行安全在线 Canary"
                checked={canaryConfirmed}
                onChange={event => { setCanaryConfirmed(event.target.checked) }}
              />
              我确认主动发起这一次付费只读调用
            </label>
            <Button
              variant="primary"
              size="sm"
              disabled={!canaryConfirmed || busy}
              onClick={() => { void runLiveCanary() }}
            >
              确认运行一次
            </Button>
          </div>
        ) : null}

        {preview === undefined ? (
          <CurrentReadiness role={role} />
        ) : (
          <SaveReview
            preview={preview}
            busy={busy}
            onConfirm={() => { void commitDraft() }}
            onCancel={() => { setPreview(undefined) }}
          />
        )}
        {simulation === undefined ? null : <SimulationResult report={simulation} />}
        {role.simulations.length === 0 ? null : (
          <details style={detailsStyle}>
            <summary>已保留的角色模拟（{role.simulations.length}）</summary>
            <div style={historyStyle}>
              {role.simulations.map(value => (
                <article key={value.simulationId} style={historyItemStyle}>
                  <div style={headingRowStyle}>
                    <strong>{value.mode === 'DETERMINISTIC' ? '离线' : '在线 Canary'}</strong>
                    <Pill>{value.status}</Pill>
                    <span>{formatDate(value.createdAt)}</span>
                  </div>
                  <p style={microStyle}>
                    {value.provider}/{value.model} · {value.toolProfileRef} ·
                    角色 revision {value.roleRevision} · {value.latencyMs} ms
                  </p>
                  <code>{value.simulationId}</code>
                </article>
              ))}
            </div>
          </details>
        )}

        <details style={detailsStyle}>
          <summary>提示词 revision 历史（{role.history.length}）</summary>
          <div style={historyStyle}>
            {role.history.length === 0 ? <p style={emptyStyle}>尚无用户 revision。</p> : null}
            {role.history.slice(0, 12).map(revision => {
              const metrics = role.revisionMetrics.find(value =>
                value.roleRevision === revision.revision)
              return (
              <article key={revision.revision} style={historyItemStyle}>
                <div style={headingRowStyle}>
                  <strong>revision {revision.revision}</strong>
                  <Pill>{revision.source}</Pill>
                  <span>{formatDate(revision.createdAt)}</span>
                </div>
                <p style={microStyle}>
                  {revision.configuration.provider}/{revision.configuration.model} ·
                  {revision.configuration.reasoningEffort} ·
                  {revision.configuration.maxOutputTokens} tokens ·
                  就绪 {revision.readiness.score}
                </p>
                <p style={microStyle}>
                  使用：{metrics?.sessionIds.length ?? 0} Sessions ·
                  {metrics?.modelRequests ?? 0} 模型请求 ·
                  {(metrics?.inputTokens ?? 0).toLocaleString('zh-CN')} 输入 /
                  {(metrics?.outputTokens ?? 0).toLocaleString('zh-CN')} 输出 tokens ·
                  工具成功率 {metrics?.successRate === undefined
                    ? '无样本'
                    : `${(metrics.successRate * 100).toFixed(1)}%`} ·
                  费用 {metrics?.costStatus === 'ESTIMATED'
                    ? `$${(metrics.estimatedCostUsd ?? 0).toFixed(6)}`
                    : 'Provider 价格不可用'}
                </p>
                {metrics === undefined || (
                  metrics.simulationIds.length === 0
                  && metrics.evaluationRefs.length === 0
                ) ? null : (
                  <p style={microStyle}>
                    模拟 {metrics.simulationIds.length} · 评测 {metrics.evaluationRefs.length}
                  </p>
                )}
                <p style={microStyle}>
                  简体中文检查：
                  {revision.simplifiedChineseReview === undefined
                    ? '旧 revision 无回执'
                    : (
                        `${simplifiedChineseReviewLabel(revision.simplifiedChineseReview.mode)} · `
                        + `应用 ${revision.simplifiedChineseReview.appliedCount} · `
                        + `保留 ${revision.simplifiedChineseReview.remainingCount} · `
                        + `结果 ${revision.simplifiedChineseReview.resultHash.slice(0, 12)}…`
                      )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const target = draftFromConfiguration(
                      revision.configuration,
                      revision.configuration.promptOverride === ''
                        ? role.bundledPrompt
                        : revision.configuration.promptOverride,
                    )
                    setDraft(target)
                    setPreview(undefined)
                    resetLintState()
                    onResult(`已把 revision ${revision.revision} 放入草稿；确认保存后会创建新 revision，不覆盖历史。`)
                  }}
                >
                  载入为回滚草稿
                </Button>
              </article>
              )
            })}
          </div>
        </details>

        <details style={detailsStyle}>
          <summary>可移植配置导出 / 导入</summary>
          <div style={portableStyle}>
            <div style={actionRowStyle}>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { void exportPortable() }}>
                生成安全导出
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || portable.trim() === ''}
                onClick={() => { void previewImport() }}
              >
                预览导入
              </Button>
            </div>
            <textarea
              aria-label="Military 可移植配置"
              rows={8}
              value={portable}
              placeholder="粘贴由 Military 生成的可移植 JSON。"
              spellCheck={false}
              onChange={event => {
                setPortable(event.target.value)
                setImportPreview(undefined)
              }}
            />
            {importPreview === undefined ? null : (
              <div style={importReviewStyle}>
                <strong>
                  {importPreview.drafts.length} 个角色 ·
                  {importPreview.blocked ? '存在阻断问题' : 'Host 校验通过'}
                </strong>
                {importPreview.roles.map(value => (
                  <p key={value.roleId} style={microStyle}>
                    {value.roleId}：+{value.diff.addedLines}/-{value.diff.removedLines} ·
                    {readinessLabel(value.readiness.disposition)} · {value.readiness.score}
                  </p>
                ))}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || importPreview.blocked}
                  onClick={() => { void commitImport() }}
                >
                  确认原子导入
                </Button>
              </div>
            )}
          </div>
        </details>
      </section>
    </div>
  )
}

function CurrentReadiness({ role }: { readonly role: RoleWorkbenchRoleSnapshot }): ReactNode {
  return (
    <section style={reviewStyle} aria-label="当前 Flash 就绪报告">
      <div style={headingRowStyle}>
        <strong>当前 Flash 就绪度：{role.readiness.score}</strong>
        <Pill className="dshm-status">
          <StateDot state={readinessDot(role.readiness.disposition)} />
          {readinessLabel(role.readiness.disposition)}
        </Pill>
        <span>{role.preview.estimatedTokens} 估算 tokens</span>
      </div>
      <p style={hintStyle}>
        {role.readiness.errorCount} 阻断 · {role.readiness.warningCount} 警告 ·
        {role.tools.length} 个工具 Schema
      </p>
      {role.readiness.issues.slice(0, 6).map(value => (
        <p key={`${value.code}-${value.start ?? 0}`} style={issueStyle(value.severity)}>
          <strong>{value.code}</strong>：{value.message} {value.suggestion}
        </p>
      ))}
      <EffectivePromptLayers preview={role.preview} />
    </section>
  )
}

function SaveReview(props: {
  readonly preview: DraftPreview
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): ReactNode {
  const { preview } = props
  return (
    <section style={reviewStyle} data-save-review="true" aria-label="配置保存预览">
      <div style={headingRowStyle}>
        <strong>保存预览 · Host revision {preview.expectedRevision}</strong>
        <Pill className="dshm-status">
          <StateDot state={readinessDot(preview.readiness.disposition)} />
          {readinessLabel(preview.readiness.disposition)} {preview.readiness.score}
        </Pill>
      </div>
      <p style={hintStyle}>
        Diff：新增 {preview.diff.addedLines} 行，删除 {preview.diff.removedLines} 行；
        有效提示词约 {preview.preview.estimatedTokens} tokens /
        {preview.preview.estimatedChineseCharacters} 个汉字；
        简体中文检查 {preview.simplifiedChineseLint?.issues.length ?? 'Host 未披露'} 项。
      </p>
      <DiffView diff={preview.diff} />
      {preview.readiness.issues.map(value => (
        <p key={`${value.code}-${value.start ?? 0}`} style={issueStyle(value.severity)}>
          <strong>{value.code}</strong>：{value.message}<br />
          建议：{value.suggestion}
        </p>
      ))}
      <EffectivePromptLayers preview={preview.preview} />
      <div style={actionRowStyle}>
        <Button
          variant="primary"
          size="sm"
          disabled={props.busy || preview.readiness.disposition === 'BLOCKED'}
          onClick={props.onConfirm}
        >
          保存配置
        </Button>
        <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onCancel}>
          返回编辑
        </Button>
      </div>
    </section>
  )
}

function EffectivePromptLayers(props: {
  readonly preview: RoleWorkbenchRoleSnapshot['preview']
}): ReactNode {
  return (
    <details style={detailsStyle} data-effective-prompt-preview="true">
      <summary>
        查看最终有效提示词（{props.preview.layers.length} 层）
      </summary>
      <div style={layersStyle}>
        {props.preview.layers.map(layer => (
          <article key={layer.id} style={layerStyle}>
            <div style={headingRowStyle}>
              <strong>{layer.label}</strong>
              <Pill>{layer.editable ? '可编辑' : 'Host 固定'}</Pill>
              {layer.runtimeBound ? <Pill>运行时绑定</Pill> : null}
              <span>{layer.estimatedTokens} tokens</span>
            </div>
            <pre style={promptPreviewStyle}>{layer.text}</pre>
          </article>
        ))}
      </div>
    </details>
  )
}

function DiffView({ diff }: { readonly diff: PromptDiffSummary }): ReactNode {
  const changed = diff.lines.filter(value => value.kind !== 'UNCHANGED')
  return (
    <details style={detailsStyle}>
      <summary>查看提示词 Diff（{changed.length} 个变更行）</summary>
      <pre style={diffStyle}>
        {changed.length === 0
          ? '提示词没有行级变化。'
          : changed.slice(0, 160).map(value =>
              `${value.kind === 'ADDED' ? '+' : '-'} ${value.text}`).join('\n')}
      </pre>
    </details>
  )
}

function SimulationResult({ report }: { readonly report: RoleSimulationReport }): ReactNode {
  return (
    <section style={reviewStyle} data-role-simulation-result={report.mode}>
      <div style={headingRowStyle}>
        <strong>{report.mode === 'DETERMINISTIC' ? '离线合同模拟' : '在线只读 Canary'}</strong>
        <Pill className="dshm-status">
          <StateDot state={report.status === 'PASSED' ? 'done' : 'error'} />
          {report.status}
        </Pill>
        <span>{report.latencyMs} ms</span>
      </div>
      <p style={microStyle}>
        {report.provider}/{report.model} · {report.modelStatus} · {report.toolProfileRef} ·
        角色 revision {report.roleRevision} · {report.simulationId}
      </p>
      {report.steps.map(step => (
        <p key={step.id} style={simulationStepStyle}>
          <StateDot state={step.status === 'PASSED' ? 'done' : step.status === 'FAILED' ? 'error' : 'warning'} />
          <strong>{step.id}</strong>
          {step.toolName === undefined ? '' : ` · ${step.toolName}`}：{step.message}
        </p>
      ))}
      <p style={hintStyle}>
        tokens：{report.inputTokens ?? '不适用'} 输入 / {report.outputTokens ?? '不适用'} 输出；
        费用：{report.estimatedCostUsd === undefined
          ? report.costStatus === 'NOT_APPLICABLE' ? '¥0 / $0（未调用模型）' : 'Provider 价格不可用'
          : `$${report.estimatedCostUsd.toFixed(6)}（估算）`}
      </p>
      {report.rawToolChoice === undefined ? null : (
        <pre style={diffStyle}>
          {report.rawToolChoice.name}({report.rawToolChoice.arguments})
        </pre>
      )}
    </section>
  )
}

function NumberDraftField(props: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly onChange: (value: number) => void
}): ReactNode {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <input
        type="number"
        aria-label={props.label}
        value={String(props.value)}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={event => {
          const value = Number(event.target.value)
          if (Number.isSafeInteger(value)) props.onChange(value)
        }}
      />
    </label>
  )
}

export async function fetchMilitaryControlSnapshot(
  connection: Pick<ConnectionHandle, 'rpc'>,
  signal?: AbortSignal,
): Promise<RoleWorkbenchSnapshot> {
  const response = await connection.rpc.call(
    '/api',
    'militaryControlPlane/snapshot',
    { args: {} },
    signal,
  )
  if (!response.ok) throw new Error(response.error.message)
  return response.value as RoleWorkbenchSnapshot
}

export async function dispatchMilitaryControlAction(
  connection: Pick<ConnectionHandle, 'rpc'>,
  action: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await connection.rpc.call(
    '/api',
    'militaryControlPlane/execute',
    { args: { action } },
    signal,
  )
  if (!response.ok) throw new Error(response.error.message)
  return response.value
}

function draftFromRole(role: RoleWorkbenchRoleSnapshot): RoleDraft {
  return draftFromConfiguration(role.configuration, role.effectivePrompt)
}

function draftFromConfiguration(
  configuration: RoleWorkbenchRoleSnapshot['configuration'],
  prompt: string,
): RoleDraft {
  return {
    roleId: configuration.roleId,
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    maxOutputTokens: configuration.maxOutputTokens,
    contextBudgetTokens: configuration.contextBudgetTokens,
    concurrencyLimit: configuration.concurrencyLimit,
    prompt,
  }
}

function sameDraft(left: RoleDraft, right: RoleDraft): boolean {
  return left.roleId === right.roleId
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
    && left.maxOutputTokens === right.maxOutputTokens
    && left.contextBudgetTokens === right.contextBudgetTokens
    && left.concurrencyLimit === right.concurrencyLimit
    && left.prompt === right.prompt
}

function roleBudgetPreset(
  draft: Pick<RoleDraft, 'maxOutputTokens' | 'contextBudgetTokens' | 'concurrencyLimit'>,
  general: boolean,
): string {
  return ROLE_BUDGET_PRESETS.find(value =>
    value.maxOutputTokens === draft.maxOutputTokens
    && value.contextBudgetTokens === draft.contextBudgetTokens
    && (general || value.concurrencyLimit === draft.concurrencyLimit))?.id ?? 'CUSTOM'
}

function requiredRole(
  snapshot: RoleWorkbenchSnapshot,
  roleId: string,
): RoleWorkbenchRoleSnapshot {
  const role = snapshot.roles.find(value => value.configuration.roleId === roleId)
  if (role === undefined) throw new Error(`Host snapshot missing role ${roleId}`)
  return role
}

function routeKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

function shortModel(model: string): string {
  return model.length <= 30 ? model : `${model.slice(0, 27)}…`
}

function departmentLabel(value: string): string {
  return {
    command: '指挥',
    staff: '参谋部',
    'worker-forces': '快速反应部队',
    'engineer-corps': '工兵部',
    oversight: '督战队',
    'logistics-research': '后勤研究',
    'evaluation-committee': '评估委员会',
  }[value] ?? value
}

function readinessLabel(value: FlashReadinessReport['disposition']): string {
  return value === 'READY' ? '就绪' : value === 'REVIEW' ? '需复核' : '已阻断'
}

function readinessDot(value: FlashReadinessReport['disposition']): 'done' | 'ongoing' | 'error' {
  return value === 'READY' ? 'done' : value === 'REVIEW' ? 'ongoing' : 'error'
}

function modelStatusLabel(value: MilitaryModelCatalogEntry['status']): string {
  return {
    VALIDATED: 'DSH 已接入',
    CANARY: 'DSH 已接入',
    UNVERIFIED: 'DSH 已接入',
    INCOMPATIBLE: 'DSH 已接入（参数适配）',
    UNAVAILABLE: '当前 DSH 目录不可用',
    DEPRECATED: 'DSH 已接入（旧路线）',
  }[value]
}

function simplifiedChineseReviewLabel(
  value: 'NO_FINDINGS' | 'APPLIED_SELECTION' | 'ACKNOWLEDGED_WITH_FINDINGS' | 'NOT_USER_REVIEWED',
): string {
  return {
    NO_FINDINGS: '用户检查，无发现',
    APPLIED_SELECTION: '用户确认并应用',
    ACKNOWLEDGED_WITH_FINDINGS: '用户确认保留',
    NOT_USER_REVIEWED: '非用户变更',
  }[value]
}

function navigateRoleOptions(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: string,
  roleIds: readonly string[],
  select: (roleId: string) => boolean,
): void {
  if (event.nativeEvent.isComposing || roleIds.length === 0) return
  const index = roleIds.indexOf(current)
  let target: string | undefined
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      target = roleIds[(index + 1) % roleIds.length]
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      target = roleIds[(index - 1 + roleIds.length) % roleIds.length]
      break
    case 'Home':
      target = roleIds[0]
      break
    case 'End':
      target = roleIds.at(-1)
      break
    default:
      return
  }
  if (target === undefined) return
  event.preventDefault()
  if (!select(target)) return
  event.currentTarget.parentElement?.querySelector<HTMLElement>(
    `#military-role-option-${target}`,
  )?.focus()
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : value
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function issueStyle(
  severity: FlashReadinessReport['issues'][number]['severity'],
): CSSProperties {
  return {
    margin: '6px 0',
    padding: '8px 10px',
    borderRadius: 8,
    background: severity === 'ERROR'
      ? 'var(--dsw-alias-state-error-bg)'
      : severity === 'WARNING'
        ? 'var(--dsw-alias-bg-module-platform)'
        : 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 12,
    lineHeight: '18px',
  }
}

const workbenchStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '250px minmax(0, 1fr)',
  minHeight: 0,
  gap: 16,
}

const loadingStyle: CSSProperties = {
  minHeight: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  color: 'var(--dsw-alias-label-secondary)',
}

const catalogStyle: CSSProperties = {
  minWidth: 0,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  overflow: 'hidden',
  alignSelf: 'start',
  position: 'sticky',
  top: 0,
}

const catalogFiltersStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 10,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-2)',
}

const roleListStyle: CSSProperties = {
  display: 'grid',
  maxHeight: 520,
  overflowY: 'auto',
}

const roleItemStyle: CSSProperties = {
  display: 'grid',
  justifyContent: 'stretch',
  height: 'auto',
  minHeight: 72,
  padding: '9px 10px',
  border: 'none',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 0,
  textAlign: 'left',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
}

const roleItemActiveStyle: CSSProperties = {
  ...roleItemStyle,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  boxShadow: 'inset 3px 0 0 var(--dsw-alias-brand-primary)',
}

const roleItemHeadingStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const roleItemMetaStyle: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '16px',
}

const draftBadgeStyle: CSSProperties = {
  color: 'var(--dsw-alias-brand-primary)',
  fontSize: 11,
}

const editorStyle: CSSProperties = {
  display: 'grid',
  minWidth: 0,
  gap: 14,
  alignContent: 'start',
}

const editorHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
}

const headingRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
}

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: '26px',
}

const hintStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}

const microStyle: CSSProperties = {
  margin: '2px 0',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '16px',
}

const actionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
}

const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  minWidth: 0,
  gap: 4,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
}

const promptFieldStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
}

const promptLabelStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
}

const saveBarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  paddingTop: 4,
}

const budgetSummaryStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 10,
  padding: 12,
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-2)',
}

const warningStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
}

const errorStyle: CSSProperties = {
  ...warningStyle,
  borderColor: 'var(--dsw-alias-state-error-primary)',
  background: 'var(--dsw-alias-state-error-bg)',
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-state-error-primary)',
}

const checkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const reviewStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
}

const detailsStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  padding: '8px 10px',
}

const layersStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 8,
}

const layerStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}

const promptPreviewStyle: CSSProperties = {
  margin: 0,
  maxHeight: 220,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  color: 'var(--dsw-alias-label-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
}

const diffStyle: CSSProperties = {
  margin: '8px 0 0',
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}

const simulationStepStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
}

const historyStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 8,
}

const historyItemStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
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

const portableStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 8,
}

const importReviewStyle: CSSProperties = {
  padding: 10,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}

const emptyStyle: CSSProperties = {
  margin: 0,
  padding: 12,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
}
