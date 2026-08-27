import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type {
  ConnectionHandle,
  IApiClient,
  ModelProviderGroup,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button,
  IconCloseOutline16,
  IconSettingsOutline14,
  IconSettingsOutline16,
  Modal,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AgentTemplateProfile,
  TacticalTag,
} from '@dsh-military/contracts'
import type {
  MilitaryModelCatalogEntry,
} from '@dsh-military/contracts/control-plane'
import {
  DEFAULT_GENERAL_ROLE_PROMPT,
  ROLE_PROMPT_MAX_CHARS,
  resolveDepartmentRolePrompt,
  resolveGeneralRolePrompt,
  validateRolePrompt,
} from '@dsh-military/contracts/role-prompts'
import {
  fetchMilitaryControlSnapshot,
  RoleWorkbench,
} from './role-workbench.js'
import { MilitaryOperationsCenter } from './operations-center.js'
import { MilitaryWorkspaceCenter } from './workspace-center.js'
import {
  EvaluationCatalogSelectors,
  MilitaryEvaluationCenter,
} from './evaluation-center.js'
import { useDialogFocus } from './dialog-accessibility.js'

type AnyScope = SettingsScope<Record<string, unknown>>
const scopeMutationTails = new WeakMap<object, Promise<void>>()

export interface MilitarySettingsScopes {
  readonly 'military-model-routing': AnyScope
  readonly 'military-agent-templates': AnyScope
  readonly 'military-core': AnyScope
  readonly 'military-staff': AnyScope
  readonly 'military-tags': AnyScope
  readonly 'military-tactics': AnyScope
  readonly 'military-private-skills': AnyScope
  readonly 'military-oversight': AnyScope
  readonly 'military-specs': AnyScope
  readonly 'military-memory': AnyScope
  readonly 'military-evaluation': AnyScope
  readonly 'military-presentation': AnyScope
}

interface Props {
  readonly scopes: MilitarySettingsScopes
  readonly connection: ConnectionHandle
}

type SectionId = 'models' | 'execution' | 'workspace' | 'safety' | 'tactics' | 'evaluation' | 'presentation'

const SECTIONS: readonly { readonly id: SectionId; readonly label: string; readonly description: string }[] = [
  { id: 'models', label: 'Military-部门模型', description: '为 General 和每个部门选择模型、推理强度、上下文预算，并维护简体中文角色提示词。' },
  { id: 'execution', label: 'Military-执行与成本', description: '控制并发、会商规模、压缩与轻量模型的资源边界。' },
  { id: 'workspace', label: 'Military-Specs 工作区', description: '查看 Host 绑定的权威工作区、Git、路径权限、租约与集成回执。' },
  { id: 'safety', label: 'Military-安全与恢复', description: '沿权威时间线诊断会话，并预览、确认和审计受治理恢复操作。' },
  { id: 'tactics', label: 'Military-战术与标签', description: '管理私有战术召回和可视化标签库。' },
  { id: 'evaluation', label: 'Military-绩效评估', description: '运行固定九场景基准，并分开评估真实 Provider 会话样本。' },
  { id: 'presentation', label: 'Military-显示与进阶', description: '术语、审计密度和只读治理信息。' },
]

let settingsOpen = false
let settingsDirty = false
let settingsReturnFocus: HTMLElement | null = null
let blockedCloseRevision = 0
const settingsOpenListeners = new Set<() => void>()
const blockedCloseListeners = new Set<() => void>()

export function openMilitarySettings(): void {
  settingsOpen = true
  for (const listener of settingsOpenListeners) listener()
}

export function closeMilitarySettings(): void {
  if (settingsDirty) {
    blockedCloseRevision += 1
    for (const listener of blockedCloseListeners) listener()
    return
  }
  forceCloseMilitarySettings()
}

function forceCloseMilitarySettings(): void {
  settingsOpen = false
  for (const listener of settingsOpenListeners) listener()
  const target = settingsReturnFocus
  settingsReturnFocus = null
  globalThis.queueMicrotask(() => { target?.focus() })
}

export function MilitarySettingsTrigger({ wide }: { readonly wide: boolean }): ReactNode {
  const open = useMilitarySettingsOpen()
  return (
    <button
      type="button"
      title="Military 设置中心"
      aria-label="打开 Military 设置中心"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={event => {
        settingsReturnFocus = event.currentTarget
        openMilitarySettings()
      }}
      data-military-settings-trigger="true"
      data-wide={String(wide)}
    >
      {wide ? <IconSettingsOutline16 size={16} /> : <IconSettingsOutline14 size={18} />}
      {wide ? <span className="dshm-trigger-label">Military 设置中心</span> : null}
    </button>
  )
}

export function MilitarySettingsOverlay({ scopes, connection }: Props): ReactNode {
  const open = useMilitarySettingsOpen()
  useDialogFocus(open, '.dshm-settings-dialog')
  return (
    <Modal
      open={open}
      onClose={closeMilitarySettings}
      title="Military 设置中心"
      closeLabel="关闭 Military 设置中心"
      className="dshm-settings-dialog"
      headless
    >
      <MilitarySettingsSection scopes={scopes} connection={connection} />
    </Modal>
  )
}

export interface ApprovedModelOption {
  readonly provider: string
  readonly model: string
  readonly capabilityProfileId: string
  readonly label: string
  readonly catalogConfirmed: boolean
  readonly canary: boolean
}

/** Join Military-governed routes with the real DSH provider catalog. */
export function approvedModelOptions(groups: readonly ModelProviderGroup[]): readonly ApprovedModelOption[] {
  // Legacy visual-editor compatibility only. The active RoleWorkbench obtains
  // validation/selectability from the Host `militaryControlPlane` catalog;
  // this projection never invents a Military approval allowlist.
  return groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    model: model.id,
    capabilityProfileId: `unverified-${group.id}-${model.id}`.replace(
      /[^A-Za-z0-9_.-]+/gu,
      '-',
    ),
    label: `${model.name} · ${group.name}`,
    catalogConfirmed: true,
    canary: false,
  })))
}

/** Parse the versioned registry for visual rendering; malformed Host data fails closed. */
export function parseTemplateProfilesForUi(source: unknown): readonly AgentTemplateProfile[] {
  if (typeof source !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(source)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is AgentTemplateProfile => (
          typeof item === 'object' && item !== null && 'templateId' in item
        ))
      : []
  } catch {
    return []
  }
}

/** Every visual template edit emits the next immutable revision. */
export function reviseTemplateProfile(
  profile: AgentTemplateProfile,
  patch: (profile: AgentTemplateProfile) => AgentTemplateProfile,
  timestamp = new Date().toISOString(),
): AgentTemplateProfile {
  const revised = patch(profile)
  return {
    ...revised,
    revision: (Number(profile.revision) + 1) as AgentTemplateProfile['revision'],
    supersedesRevision: profile.revision,
    updatedAt: timestamp as NonNullable<AgentTemplateProfile['updatedAt']>,
  }
}

export function MilitarySettingsSection({ scopes, connection }: Props): ReactNode {
  const [active, setActive] = useState<SectionId>('models')
  const [notice, setNotice] = useState('')
  const [modelsDirty, setModelsDirty] = useState(false)
  const [pendingSection, setPendingSection] = useState<SectionId>()
  const [resetRoleDraftSignal, setResetRoleDraftSignal] = useState(0)
  const closeBlocked = useSyncExternalStore(
    subscribeBlockedClose,
    () => blockedCloseRevision,
    () => blockedCloseRevision,
  )
  const presentation = useScopeValue(scopes['military-presentation'])
  const compact = Boolean(presentation.compactEventCards ?? true)
  const showAdvancedAudit = Boolean(presentation.showAdvancedAudit ?? false)
  const templatesSnapshot = useScopeSnapshot(scopes['military-agent-templates'])
  const templates = useMemo(
    () => parseTemplateProfilesForUi(templatesSnapshot.value?.profilesJson),
    [templatesSnapshot],
  )
  const report = useCallback((message: string) => { setNotice(message) }, [])
  useEffect(() => {
    settingsDirty = modelsDirty
    return () => {
      if (settingsDirty === modelsDirty) settingsDirty = false
    }
  }, [modelsDirty])

  const selectSection = (section: SectionId): boolean => {
    if (section === active) return true
    if (active === 'models' && modelsDirty) {
      setPendingSection(section)
      setNotice('部门模型中有未保存草稿；切换前请保存或明确放弃。')
      return false
    }
    setActive(section)
    setPendingSection(undefined)
    setNotice('')
    return true
  }

  return (
    <section
      className="dshm-settings-shell"
      data-military-settings-center="true"
      data-terminology={presentation.terminology === 'neutral' ? 'neutral' : 'military'}
      data-compact={String(compact)}
      lang="zh-CN"
      aria-labelledby="military-settings-title"
    >
      <header style={dialogHeaderStyle}>
        <div>
          <p style={eyebrowStyle}>MILITARY CONTROL CENTER</p>
          <h2 id="military-settings-title" style={dialogTitleStyle}>Military 设置中心</h2>
          <p style={dialogSubtitleStyle}>
            轻量模型是默认执行路径；重量模型仅在你明确选择时启用。所有能力、权限和验证门禁保持不变。
          </p>
        </div>
        <div style={dialogHeaderActionsStyle}>
          {showAdvancedAudit ? (
            <Pill className="dshm-status">
              <StateDot state="done" />
              DSH RC.2 · governed
            </Pill>
          ) : null}
          <button
            type="button"
            data-dshm-close
            aria-label="关闭 Military 设置中心"
            style={dialogCloseStyle}
            onClick={closeMilitarySettings}
          >
            <IconCloseOutline16 className="dshm-close-icon" size={14} />
          </button>
        </div>
      </header>

      <div style={settingsBodyStyle} data-dshm-body>
        <nav
          aria-label="Military 设置分类"
          aria-orientation="vertical"
          role="tablist"
          style={settingsNavStyle}
          data-dshm-sidebar
        >
          {SECTIONS.map(section => (
            <button
              type="button"
              role="tab"
              data-dshm-nav
              key={section.id}
              id={`military-settings-tab-${section.id}`}
              aria-controls={`military-settings-panel-${section.id}`}
              aria-selected={active === section.id}
              tabIndex={active === section.id ? 0 : -1}
              style={active === section.id ? settingsNavActiveStyle : settingsNavButtonStyle}
              onClick={() => { selectSection(section.id) }}
              onKeyDown={event => {
                navigateSettingsTabs(event, section.id, selectSection)
              }}
            >
              {section.label}
            </button>
          ))}
          <div style={settingsPolicyStyle} data-dshm-policy>
            <strong>配置原则</strong>
            <span>Flash 为默认主力</span>
            <span>提示词不授予工具或权限</span>
            <span>安全门禁不可在此降级</span>
          </div>
        </nav>

        <main
          id={`military-settings-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`military-settings-tab-${active}`}
          tabIndex={0}
          style={compact ? { ...settingsContentStyle, padding: 18 } : settingsContentStyle}
        >
          <p style={sectionDescriptionStyle}>{SECTIONS.find(section => section.id === active)?.description}</p>
          {notice === '' ? null : <p role="status" style={noticeStyle}>{notice}</p>}
          {pendingSection === undefined ? null : (
            <div role="alert" style={settingsGuardStyle}>
              <strong>未保存的角色草稿受到保护</strong>
              <span>保存后再切换，或明确放弃本地草稿。</span>
              <div style={rowStyle}>
                <Button variant="outline" size="sm" onClick={() => { setPendingSection(undefined) }}>
                  返回保存
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setResetRoleDraftSignal(value => value + 1)
                  setModelsDirty(false)
                  setActive(pendingSection)
                  setPendingSection(undefined)
                  setNotice('已放弃未保存角色草稿。')
                }}>
                  放弃草稿并切换
                </Button>
              </div>
            </div>
          )}
          {closeBlocked === 0 || !modelsDirty ? null : (
            <div role="alert" style={settingsGuardStyle}>
              <strong>弹窗未关闭：存在未保存角色草稿</strong>
              <span>请先保存；也可以明确放弃草稿后关闭。</span>
              <div style={rowStyle}>
                <Button variant="outline" size="sm" onClick={() => {
                  setResetRoleDraftSignal(value => value + 1)
                  settingsDirty = false
                  setModelsDirty(false)
                  forceCloseMilitarySettings()
                }}>
                  放弃草稿并关闭
                </Button>
              </div>
            </div>
          )}

          {active === 'models' ? (
            <RoleWorkbench
              key={resetRoleDraftSignal}
              connection={connection}
              onResult={report}
              onDirtyChange={setModelsDirty}
            />
          ) : null}
          {active === 'execution' ? <ExecutionPanel scopes={scopes} templates={templates} onResult={report} /> : null}
          {active === 'workspace' ? (
            <WorkspacePanel
              scope={scopes['military-specs']}
              connection={connection}
              onResult={report}
            />
          ) : null}
          {active === 'safety' ? (
            <SafetyPanel scopes={scopes} connection={connection} onResult={report} />
          ) : null}
          {active === 'tactics' ? (
            <TacticsPanel
              scopes={scopes}
              connection={connection}
              onResult={report}
            />
          ) : null}
          {active === 'evaluation' ? (
            <EvaluationPanel
              scope={scopes['military-evaluation']}
              connection={connection}
              templates={templates}
              onResult={report}
            />
          ) : null}
          {active === 'presentation' ? <PresentationPanel scope={scopes['military-presentation']} templates={templates} onResult={report} /> : null}
        </main>
      </div>
    </section>
  )
}

function navigateSettingsTabs(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: SectionId,
  select: (section: SectionId) => boolean,
): void {
  if (event.nativeEvent.isComposing) return
  const index = SECTIONS.findIndex(value => value.id === current)
  let target: SectionId | undefined
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      target = SECTIONS[(index + 1) % SECTIONS.length]?.id
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      target = SECTIONS[(index - 1 + SECTIONS.length) % SECTIONS.length]?.id
      break
    case 'Home':
      target = SECTIONS[0]?.id
      break
    case 'End':
      target = SECTIONS.at(-1)?.id
      break
    default:
      return
  }
  if (target === undefined) return
  event.preventDefault()
  if (!select(target)) return
  const tab = event.currentTarget.parentElement?.querySelector<HTMLElement>(
    `#military-settings-tab-${target}`,
  )
  tab?.focus()
}

function ModelsPanel(props: {
  readonly routing: AnyScope
  readonly templatesScope: AnyScope
  readonly templates: readonly AgentTemplateProfile[]
  readonly modelOptions: readonly ApprovedModelOption[]
  readonly catalogStatus: 'loading' | 'ready' | 'error'
  readonly catalogMessage: string
  readonly onResult: (message: string) => void
}): ReactNode {
  const [promptResetEpoch, setPromptResetEpoch] = useState(0)
  const route = useScopeValue(props.routing)
  const selectedGeneral = routeKey(String(route.provider ?? ''), String(route.model ?? ''))
  const generalPromptOverride = typeof route.generalPromptOverride === 'string'
    ? route.generalPromptOverride
    : ''
  const catalogText = props.catalogStatus === 'loading'
    ? '正在读取 DSH 模型目录…'
    : props.catalogStatus === 'error'
      ? `模型目录暂不可用：${props.catalogMessage}。仍可使用 Military 内置兼容路线。`
      : '下拉选项已与当前 DSH 模型目录核对。'
  const updateGeneralRoute = async (selected: string): Promise<void> => {
    const option = props.modelOptions.find(candidate => routeKey(candidate.provider, candidate.model) === selected)
    if (option === undefined) return
    if (props.catalogStatus === 'ready' && !option.catalogConfirmed) {
      throw new Error(`${option.label} 当前不在 DSH 模型目录中`)
    }
    await setMany(props.routing, [
      ['provider', option.provider],
      ['model', option.model],
      ['maxOutputTokens', Math.min(Number(route.maxOutputTokens ?? 16_384), 256_000)],
    ])
    props.onResult(`General 默认已切换为 ${option.label}。新建且未显式选模的 Military 会话将使用该路线。`)
  }
  return (
    <div style={stackStyle}>
      <div style={rolePromptToolbarStyle}>
        <div>
          <strong style={toolbarHeadingStyle}>角色提示词</strong>
          <p style={hintStyle}>默认内容由插件提供并使用简体中文；编辑只改变角色指导，不会扩大工具、文件或验收权限。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          runUiAction(
            (async () => {
              await resetAllRolePrompts(
                props.routing,
                props.templatesScope,
                props.templates,
                props.onResult,
              )
              setPromptResetEpoch(value => value + 1)
            })(),
            props.onResult,
          )
        }}>
          恢复全部角色自带提示词
        </Button>
      </div>
      <SettingsCard
        title="General 总指挥模型"
        description="用于拆解 Mission、派遣部门和汇总结果。Flash 为默认主力，Pro 仅是显式选项。"
        onReset={() => {
          runUiAction(
            resetFields(props.routing, ['provider', 'model', 'reasoningEffort', 'maxOutputTokens'], props.onResult),
            props.onResult,
          )
        }}
      >
        <div style={formGridStyle}>
          <Labeled label="模型">
            <select aria-label="General 模型" value={selectedGeneral} onChange={event => {
              runUiAction(updateGeneralRoute(event.target.value), props.onResult)
            }}>
              {withCurrentRoute(props.modelOptions, selectedGeneral).map(option => (
                <option
                  key={routeKey(option.provider, option.model)}
                  value={routeKey(option.provider, option.model)}
                  disabled={props.catalogStatus === 'ready' && !option.catalogConfirmed && routeKey(option.provider, option.model) !== selectedGeneral}
                >
                  {option.label}{option.catalogConfirmed ? '' : '（目录未确认）'}
                </option>
              ))}
            </select>
          </Labeled>
          <SelectSetting
            label="推理强度"
            field="reasoningEffort"
            scope={props.routing}
            value={String(route.reasoningEffort ?? 'high')}
            options={[['high', 'High（推荐）'], ['max', 'Max（更慢、更贵）']]}
            onResult={props.onResult}
          />
          <NumberSetting
            label="最大输出 tokens"
            field="maxOutputTokens"
            scope={props.routing}
            value={Number(route.maxOutputTokens ?? 16_384)}
            min={1_024}
            max={256_000}
            step={1_024}
            onResult={props.onResult}
          />
        </div>
        <p style={hintStyle}>{catalogText}</p>
        <RolePromptEditor
          roleName="General 总指挥"
          value={resolveGeneralRolePrompt(generalPromptOverride)}
          bundledValue={DEFAULT_GENERAL_ROLE_PROMPT}
          isBundled={generalPromptOverride.trim() === ''}
          resetSignal={promptResetEpoch}
          onSave={async value => {
            await setField(props.routing, 'generalPromptOverride', value)
            props.onResult('General 总指挥：角色提示词已保存，并将在下一次提示词组装时生效。')
          }}
          onReset={async () => {
            await unsetField(props.routing, 'generalPromptOverride')
            props.onResult('General 总指挥：已恢复插件自带的简体中文提示词。')
          }}
          onError={props.onResult}
        />
      </SettingsCard>

      <div style={templateGridStyle}>
        {props.templates.map(profile => (
          <TemplateModelCard
            key={String(profile.templateId)}
            profile={profile}
            profiles={props.templates}
            scope={props.templatesScope}
            modelOptions={props.modelOptions}
            catalogReady={props.catalogStatus === 'ready'}
            promptResetSignal={promptResetEpoch}
            onResult={props.onResult}
          />
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => {
        runUiAction(
          resetTemplateRegistry(props.templatesScope, props.templates, props.onResult),
          props.onResult,
        )
      }}>
        恢复全部部门默认模型与预算
      </Button>
    </div>
  )
}

function TemplateModelCard(props: {
  readonly profile: AgentTemplateProfile
  readonly profiles: readonly AgentTemplateProfile[]
  readonly scope: AnyScope
  readonly modelOptions: readonly ApprovedModelOption[]
  readonly catalogReady: boolean
  readonly promptResetSignal: number
  readonly onResult: (message: string) => void
}): ReactNode {
  const profile = props.profile
  const { rolePromptOverride: _bundledOverride, ...bundledProfile } = profile
  const bundledPrompt = resolveDepartmentRolePrompt(bundledProfile)
  const selected = routeKey(profile.modelPolicy.provider, profile.modelPolicy.model)
  const save = async (
    mutate: (current: AgentTemplateProfile) => AgentTemplateProfile,
    message: string,
  ): Promise<void> => {
    await mutateTemplateProfile(
      props.scope,
      props.profiles,
      String(profile.templateId),
      mutate,
    )
    props.onResult(`${profile.displayName}：${message}`)
  }
  const selectModel = async (value: string): Promise<void> => {
    const option = props.modelOptions.find(candidate => routeKey(candidate.provider, candidate.model) === value)
    if (option === undefined) return
    if (props.catalogReady && !option.catalogConfirmed) {
      throw new Error(`${option.label} 当前不在 DSH 模型目录中`)
    }
    await save(current => ({
      ...current,
      modelPolicy: {
        ...current.modelPolicy,
        provider: option.provider,
        model: option.model,
        modelCapabilityProfileId: option.capabilityProfileId,
        allowCanaryModel: option.canary,
      },
    }), `模型已切换为 ${option.label}`)
  }
  return (
    <article style={templateCardStyle} data-template-id={String(profile.templateId)}>
      <div style={rowBetweenStyle}>
        <div>
          <h3 style={cardHeadingStyle}>{profile.displayName}</h3>
          <p style={microStyle}>{departmentName(profile.department)} · {String(profile.templateId)}</p>
        </div>
        <Pill className="dshm-status">
          <StateDot state={profile.status === 'ACTIVE' ? 'done' : profile.status === 'CANARY' ? 'ongoing' : 'warning'} />
          {profile.status}
        </Pill>
      </div>
      <Labeled label="执行模型">
        <select aria-label={`${profile.displayName} 模型`} value={selected} onChange={event => {
          runUiAction(selectModel(event.target.value), props.onResult)
        }}>
          {withCurrentRoute(props.modelOptions, selected).map(option => (
            <option
              key={routeKey(option.provider, option.model)}
              value={routeKey(option.provider, option.model)}
              disabled={props.catalogReady && !option.catalogConfirmed && routeKey(option.provider, option.model) !== selected}
            >
              {option.label}{option.catalogConfirmed ? '' : '（目录未确认）'}
            </option>
          ))}
        </select>
      </Labeled>
      <div style={twoColumnStyle} data-dshm-columns="2">
        <LocalSelect
          label={`${profile.displayName} 推理强度`}
          value={profile.modelPolicy.reasoningEffort}
          options={[['high', 'High'], ['max', 'Max']]}
          onChange={value => save(current => ({
            ...current,
            modelPolicy: { ...current.modelPolicy, reasoningEffort: value as 'high' | 'max' },
          }), `推理强度已设为 ${value}`)}
          onError={props.onResult}
        />
        <LocalNumber
          label={`${profile.displayName} 输出 tokens`}
          value={profile.modelPolicy.maxOutputTokens}
          min={1_024}
          max={256_000}
          step={1_024}
          onCommit={value => save(current => ({
            ...current,
            modelPolicy: { ...current.modelPolicy, maxOutputTokens: value },
          }), `输出上限已设为 ${value}`)}
          onError={props.onResult}
        />
        <LocalNumber
          label={`${profile.displayName} 上下文 tokens`}
          value={profile.contextPolicy.contextBudgetTokens}
          min={16_384}
          max={1_000_000}
          step={1_024}
          onCommit={value => save(current => ({
            ...current,
            contextPolicy: {
              ...current.contextPolicy,
              contextBudgetTokens: value,
              retainedTailTokens: Math.min(current.contextPolicy.retainedTailTokens, value - 1),
            },
          }), `上下文预算已设为 ${value}`)}
          onError={props.onResult}
        />
        <LocalNumber
          label={`${profile.displayName} 并发上限`}
          value={profile.concurrencyLimit}
          min={1}
          max={64}
          step={1}
          onCommit={value => save(current => ({ ...current, concurrencyLimit: value }), `并发上限已设为 ${value}`)}
          onError={props.onResult}
        />
      </div>
      <RolePromptEditor
        roleName={profile.displayName}
        value={resolveDepartmentRolePrompt(profile)}
        bundledValue={bundledPrompt}
        isBundled={profile.rolePromptOverride === undefined || profile.rolePromptOverride.trim() === ''}
        resetSignal={props.promptResetSignal}
        onSave={async value => {
          await save(current => ({
            ...current,
            rolePromptOverride: value,
          }), '角色提示词已保存；新派遣的该角色将使用此修订')
        }}
        onReset={async () => {
          await save(current => {
            const { rolePromptOverride: _removed, ...rest } = current
            return rest
          }, '已恢复插件自带的简体中文提示词')
        }}
        onError={props.onResult}
      />
      <details>
        <summary style={detailsSummaryStyle}>压缩与治理详情</summary>
        <div style={formGridStyle}>
          <LocalNumber
            label={`${profile.displayName} 压缩触发百分比`}
            value={profile.contextPolicy.compactionTriggerPercent}
            min={50}
            max={99}
            step={1}
            onCommit={value => save(current => ({
              ...current,
              contextPolicy: { ...current.contextPolicy, compactionTriggerPercent: value },
            }), `压缩阈值已设为 ${value}%`)}
            onError={props.onResult}
          />
          <LocalNumber
            label={`${profile.displayName} 压缩后保留 tokens`}
            value={profile.contextPolicy.retainedTailTokens}
            min={0}
            max={Math.max(0, profile.contextPolicy.contextBudgetTokens - 1)}
            step={1_024}
            onCommit={value => save(current => ({
              ...current,
              contextPolicy: { ...current.contextPolicy, retainedTailTokens: value },
            }), `保留尾部已设为 ${value}`)}
            onError={props.onResult}
          />
          <LocalSelect
            label={`${profile.displayName} 模板状态`}
            value={profile.status}
            options={[['ACTIVE', '启用'], ['CANARY', '小流量验证'], ['PAUSED', '暂停'], ['RETIRED', '退役']]}
            onChange={value => save(current => ({
              ...current,
              status: value as AgentTemplateProfile['status'],
            }), `状态已设为 ${value}`)}
            onError={props.onResult}
          />
        </div>
        <p style={governanceStyle}>
          工具权限：{profile.capabilities.toolProfileId}@{Number(profile.capabilities.toolProfileRevision)}
          {' · '}文件权限：{profile.capabilities.permissionProfileId}@{Number(profile.capabilities.permissionProfileRevision)}
          {' · '}任务类型：{profile.taskTypes.join('、')}
        </p>
        <p style={hintStyle}>
          权限与终止工具由 Host 按角色编译；隐式模型回退固定关闭。需要升级时请直接选择 Pro，
          避免运行中静默换模或误配削弱流程能力。
        </p>
      </details>
    </article>
  )
}

function RolePromptEditor(props: {
  readonly roleName: string
  readonly value: string
  readonly bundledValue: string
  readonly isBundled: boolean
  readonly resetSignal: number
  readonly onSave: (value: string) => Promise<void>
  readonly onReset: () => Promise<void>
  readonly onError: (message: string) => void
}): ReactNode {
  const [draft, setDraft] = useExternalText(props.value)
  const [busy, setBusy] = useState(false)
  const normalizedDraft = draft.trim()
  const changed = normalizedDraft !== props.value.trim()
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      props.onError(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const save = async (): Promise<void> => {
    const validated = validateRolePrompt(draft, `${props.roleName} 角色提示词`)
    await props.onSave(validated)
  }
  useEffect(() => {
    setDraft(props.value)
  }, [props.resetSignal, props.value, setDraft])
  return (
    <section style={rolePromptEditorStyle} data-role-prompt-editor={props.roleName}>
      <div style={rowBetweenStyle}>
        <div>
          <strong style={rolePromptLabelStyle}>角色提示词（简体中文）</strong>
          <p style={microStyle}>
            {props.isBundled ? '当前使用插件自带提示词' : '当前使用自定义提示词'}
            {' · '}{normalizedDraft.length}/{ROLE_PROMPT_MAX_CHARS} 字符
          </p>
        </div>
        <Pill className="dshm-status">
          <StateDot state={props.isBundled ? 'done' : 'ongoing'} />
          {props.isBundled ? '自带' : '自定义'}
        </Pill>
      </div>
      <textarea
        aria-label={`${props.roleName} 角色提示词`}
        value={draft}
        rows={8}
        maxLength={ROLE_PROMPT_MAX_CHARS}
        spellCheck={false}
        disabled={busy}
        onChange={event => { setDraft(event.target.value) }}
      />
      <div style={rowBetweenStyle}>
        <p style={promptBoundaryHintStyle}>Host 会在此文本之后追加不可编辑的工具、工作区、证据和终态边界。</p>
        <div style={rowStyle}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || (props.isBundled && !changed)}
            onClick={() => {
              if (props.isBundled) {
                setDraft(props.bundledValue)
                return
              }
              void run(async () => {
                await props.onReset()
                setDraft(props.bundledValue)
              })
            }}
          >
            恢复自带提示词
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !changed}
            onClick={() => { void run(save) }}
          >
            保存提示词
          </Button>
        </div>
      </div>
    </section>
  )
}

function ExecutionPanel(props: {
  readonly scopes: MilitarySettingsScopes
  readonly templates: readonly AgentTemplateProfile[]
  readonly onResult: (message: string) => void
}): ReactNode {
  const core = useScopeValue(props.scopes['military-core'])
  const staff = useScopeValue(props.scopes['military-staff'])
  const memory = useScopeValue(props.scopes['military-memory'])
  return (
    <div style={panelGridStyle}>
      <SettingsCard
        title="电台与运行节奏"
        description="轻量模型遇到阻塞时通过电台一次提问，不依赖忙等或重复猜测。"
        onReset={() => {
          runUiAction(resetFields(props.scopes['military-core'], ['maxRadioAttempts', 'radioLeaseSeconds'], props.onResult), props.onResult)
        }}
      >
        <NumberSetting label="每任务最多电台尝试" field="maxRadioAttempts" scope={props.scopes['military-core']} value={Number(core.maxRadioAttempts ?? 5)} min={1} max={32} step={1} onResult={props.onResult} />
        <NumberSetting label="电台租约（秒）" field="radioLeaseSeconds" scope={props.scopes['military-core']} value={Number(core.radioLeaseSeconds ?? 120)} min={10} max={3600} step={10} onResult={props.onResult} />
      </SettingsCard>
      <SettingsCard
        title="参谋部"
        description="当私有战术候选不足时，可使用受治理的参谋长兜底。"
        onReset={() => {
          runUiAction(resetFields(props.scopes['military-staff'], ['chiefOfStaffFallbackEnabled'], props.onResult), props.onResult)
        }}
      >
        <ToggleSetting label="参谋长兜底" field="chiefOfStaffFallbackEnabled" scope={props.scopes['military-staff']} checked={Boolean(staff.chiefOfStaffFallbackEnabled ?? true)} onResult={props.onResult} />
      </SettingsCard>
      <SettingsCard
        title="研究与记忆"
        description="控制有真实事件触发器的轨迹摘要和压缩后效能评估。"
        onReset={() => {
          runUiAction(resetFields(props.scopes['military-memory'], ['trajectoryAfterWave', 'effectivenessAfterGeneralCompaction'], props.onResult), props.onResult)
        }}
      >
        <ToggleSetting label="Wave 完成后记录战术轨迹" field="trajectoryAfterWave" scope={props.scopes['military-memory']} checked={Boolean(memory.trajectoryAfterWave ?? true)} onResult={props.onResult} />
        <ToggleSetting label="General 压缩后评估效能" field="effectivenessAfterGeneralCompaction" scope={props.scopes['military-memory']} checked={Boolean(memory.effectivenessAfterGeneralCompaction ?? true)} onResult={props.onResult} />
      </SettingsCard>
      <SettingsCard title="部门预算总览" description="详细预算在“部门模型”中逐部门配置；能力与权限不会随模型变轻而减少。">
        <div style={metricGridStyle}>
          <Metric label="部门模板" value={String(props.templates.length)} />
          <Metric label="Flash 默认" value={String(props.templates.filter(item => item.modelPolicy.model === 'deepseek-v4-flash').length)} />
          <Metric label="最大并发总和" value={String(props.templates.reduce((sum, item) => sum + item.concurrencyLimit, 0))} />
        </div>
      </SettingsCard>
    </div>
  )
}

function WorkspacePanel(props: {
  readonly scope: AnyScope
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
}): ReactNode {
  const value = useScopeValue(props.scope)
  return (
    <div style={panelGridStyle}>
      <SettingsCard
        title="Specs 工作区"
        description="所有路径都由 Task 和当前 DSH Session 工作区决定；这里只配置安全的本地提交前缀。"
        onReset={() => {
          runUiAction(resetFields(props.scope, ['commitMessagePrefix'], props.onResult), props.onResult)
        }}
      >
        <TextSetting label="本地提交前缀" field="commitMessagePrefix" scope={props.scope} value={String(value.commitMessagePrefix ?? 'docs(specs):')} onResult={props.onResult} />
      </SettingsCard>
      <SettingsCard title="固定安全边界" description="这些边界属于插件能力合同，不能在设置页降级。">
        <ul style={listStyle}>
          <li>禁止远程 Git 写入、破坏性 reset 和越过 Session 工作区。</li>
          <li>Engineer 通过 Host 原子事务写入、验证、提交并向父级报告。</li>
          <li>失败会回滚工作区文件、索引和 HEAD，不遗留半完成状态。</li>
        </ul>
      </SettingsCard>
      <MilitaryWorkspaceCenter
        connection={props.connection}
        onResult={props.onResult}
      />
    </div>
  )
}

function SafetyPanel(props: {
  readonly scopes: MilitarySettingsScopes
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
}): ReactNode {
  const oversight = useScopeValue(props.scopes['military-oversight'])
  const tactics = useScopeValue(props.scopes['military-tactics'])
  return (
    <div style={stackStyle}>
      <div style={panelGridStyle}>
        <SettingsCard
        title="兼容与完成门禁"
        description="保证轻量模型不能用文本声称成功，必须提交可验证终态。"
        onReset={() => {
          runUiAction(resetFields(props.scopes['military-oversight'], ['completionInterlockEnabled', 'freezeOnSecondMissingSubmission', 'requireObservedToolEvidence', 'maximumNoProgressTurns'], props.onResult), props.onResult)
        }}
      >
        <ToggleSetting label="完成联锁" field="completionInterlockEnabled" scope={props.scopes['military-oversight']} checked={Boolean(oversight.completionInterlockEnabled ?? true)} onResult={props.onResult} />
        <ToggleSetting label="要求宿主观察到工具证据" field="requireObservedToolEvidence" scope={props.scopes['military-oversight']} checked={Boolean(oversight.requireObservedToolEvidence ?? true)} onResult={props.onResult} />
        <ToggleSetting label="第二次缺少终态时冻结" field="freezeOnSecondMissingSubmission" scope={props.scopes['military-oversight']} checked={Boolean(oversight.freezeOnSecondMissingSubmission ?? true)} onResult={props.onResult} />
        <NumberSetting label="最大无进展轮数" field="maximumNoProgressTurns" scope={props.scopes['military-oversight']} value={Number(oversight.maximumNoProgressTurns ?? 3)} min={1} max={32} step={1} onResult={props.onResult} />
        </SettingsCard>
        <SettingsCard
        title="战术发布安全"
        description="草稿战术默认需要人工审核；Canary 只允许显式投放。"
        onReset={() => {
          runUiAction(resetFields(props.scopes['military-tactics'], ['allowCanaryDelivery'], props.onResult), props.onResult)
        }}
      >
        <ToggleSetting label="允许 Canary 投放" field="allowCanaryDelivery" scope={props.scopes['military-tactics']} checked={Boolean(tactics.allowCanaryDelivery ?? true)} onResult={props.onResult} />
        <p style={hintStyle}>战术草稿人工审核属于固定安全合同，不能在设置中关闭。</p>
        </SettingsCard>
        <SettingsCard title="父子恢复与通知" description="终态 receipt 是可靠性合同，不允许关闭。">
          <ul style={listStyle}>
            <li>子 Agent 的成功、失败、阻塞和提问都持久化后再唤醒父 General。</li>
            <li>重复或乱序报告按幂等键去重；用户明确取消不会被迟到报告重启。</li>
            <li>终止工具成功后，同一模型消息中的额外调用会被单调闩锁拒绝。</li>
          </ul>
        </SettingsCard>
      </div>
      <MilitaryOperationsCenter
        connection={props.connection}
        onResult={props.onResult}
      />
    </div>
  )
}

function TacticsPanel(props: {
  readonly scopes: MilitarySettingsScopes
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly onResult: (message: string) => void
}): ReactNode {
  const tactics = useScopeValue(props.scopes['military-tactics'])
  const privateSkills = useScopeValue(props.scopes['military-private-skills'])
  const [models, setModels] = useState<readonly MilitaryModelCatalogEntry[]>([])
  const [catalogError, setCatalogError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void fetchMilitaryControlSnapshot(props.connection, controller.signal)
      .then(snapshot => {
        setModels(snapshot.models.filter(model => model.available))
        setCatalogError('')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setCatalogError(error instanceof Error ? error.message : String(error))
      })
    return () => { controller.abort() }
  }, [props.connection])
  const selectedRoute = `${
    String(privateSkills.extractionProvider ?? 'deepseek-official')
  }/${
    String(privateSkills.extractionModel ?? 'deepseek-v4-flash')
  }`
  const catalogModels = models.some(model => model.exactRoute === selectedRoute)
    ? models
    : [
        ...models,
        {
          provider: String(privateSkills.extractionProvider ?? 'deepseek-official'),
          providerName: String(privateSkills.extractionProvider ?? 'deepseek-official'),
          model: String(privateSkills.extractionModel ?? 'deepseek-v4-flash'),
          modelName: String(privateSkills.extractionModel ?? 'deepseek-v4-flash'),
          status: 'UNAVAILABLE' as const,
          statusReason: '当前保存路线尚未出现在最新 DSH live 目录中。',
          supportedReasoning: [],
          toolCalling: 'UNKNOWN' as const,
          inputModalities: [],
          available: false,
          selectable: false,
          exactRoute: selectedRoute,
          evidence: [],
          pricing: { status: 'UNAVAILABLE' as const, currency: 'USD' },
        },
      ]
  const selectExtractionModel = async (exactRoute: string): Promise<void> => {
    const model = models.find(candidate => candidate.exactRoute === exactRoute)
    if (model === undefined) {
      throw new Error(`${exactRoute} 当前不在 DSH live 模型目录中`)
    }
    const currentMax = Number(privateSkills.maxOutputTokens ?? 2_048)
    await setMany(props.scopes['military-private-skills'], [
      ['extractionProvider', model.provider],
      ['extractionModel', model.model],
      ['maxOutputTokens', Math.min(currentMax, model.maxOutputTokens ?? currentMax)],
    ])
    props.onResult(`私有技能提炼模型已保存为 ${model.modelName} · ${model.providerName}。`)
  }
  return (
    <div style={stackStyle}>
      <SettingsCard
        title="私有技能提炼"
        description="默认使用 Flash；也可选择当前 DSH 已接入的任意 Provider/model。设置不改变人工审批与来源权利门禁。"
        onReset={() => {
          runUiAction(resetFields(
            props.scopes['military-private-skills'],
            ['extractionProvider', 'extractionModel', 'maxOutputTokens', 'allowDeterministicFallback', 'defaultVisibility', 'defaultRetentionDays'],
            props.onResult,
          ), props.onResult)
        }}
      >
        <div style={formGridStyle}>
          <Labeled label="提炼模型">
            <select
              aria-label="私有技能提炼模型"
              value={selectedRoute}
              onChange={event => {
                runUiAction(
                  selectExtractionModel(event.target.value),
                  props.onResult,
                )
              }}
            >
              {catalogModels.map(model => (
                <option
                  key={model.exactRoute}
                  value={model.exactRoute}
                  disabled={!model.available}
                >
                  {model.modelName} · {model.providerName}
                  {model.available ? '' : '（当前 DSH 未接入）'}
                </option>
              ))}
            </select>
            <small style={microStyle}>
              {catalogError === ''
                ? '列表来自当前 DSH live adapter 目录；绩效样本不影响选择。'
                : `模型目录读取失败：${catalogError}`}
            </small>
          </Labeled>
          <NumberSetting
            label="每分块最大输出 tokens"
            field="maxOutputTokens"
            scope={props.scopes['military-private-skills']}
            value={Number(privateSkills.maxOutputTokens ?? 2_048)}
            min={512}
            max={8_192}
            step={256}
            onResult={props.onResult}
          />
          <SelectSetting
            label="默认可见范围"
            field="defaultVisibility"
            scope={props.scopes['military-private-skills']}
            value={String(privateSkills.defaultVisibility ?? 'user-private')}
            options={[
              ['user-private', '仅当前用户'],
              ['workspace-private', '当前工作区'],
              ['organization-private', '当前组织'],
            ]}
            onResult={props.onResult}
          />
          <NumberSetting
            label="默认保留天数"
            field="defaultRetentionDays"
            scope={props.scopes['military-private-skills']}
            value={Number(privateSkills.defaultRetentionDays ?? 365)}
            min={1}
            max={3_650}
            step={1}
            onResult={props.onResult}
          />
        </div>
        <ToggleSetting
          label="模型失败时允许确定性 fallback（不会冒充语义提炼）"
          field="allowDeterministicFallback"
          scope={props.scopes['military-private-skills']}
          checked={Boolean(privateSkills.allowDeterministicFallback ?? false)}
          onResult={props.onResult}
        />
      </SettingsCard>
      <SettingsCard
        title="私有战术召回"
        description="限定轻量模型每次看到的候选数量，保留完整战术库能力。"
        onReset={() => {
          runUiAction(resetFields(props.scopes['military-tactics'], ['candidateRecallMinimum', 'candidateRecallMaximum'], props.onResult), props.onResult)
        }}
      >
        <div style={twoColumnStyle} data-dshm-columns="2">
          <LocalNumber
            label="最少召回"
            value={Number(tactics.candidateRecallMinimum ?? 3)}
            min={1}
            max={10}
            step={1}
            onCommit={async (nextMinimum) => {
              const currentMaximum = Number(tactics.candidateRecallMaximum ?? 5)
              if (nextMinimum > currentMaximum) {
                await setField(props.scopes['military-tactics'], 'candidateRecallMaximum', nextMinimum)
              }
              await setField(props.scopes['military-tactics'], 'candidateRecallMinimum', nextMinimum)
              props.onResult('最少召回已保存。')
            }}
            onError={props.onResult}
          />
          <LocalNumber
            label="最多召回"
            value={Number(tactics.candidateRecallMaximum ?? 5)}
            min={1}
            max={20}
            step={1}
            onCommit={async (nextMaximum) => {
              const currentMinimum = Number(tactics.candidateRecallMinimum ?? 3)
              if (nextMaximum < currentMinimum) {
                await setField(props.scopes['military-tactics'], 'candidateRecallMinimum', nextMaximum)
              }
              await setField(props.scopes['military-tactics'], 'candidateRecallMaximum', nextMaximum)
              props.onResult('最多召回已保存。')
            }}
            onError={props.onResult}
          />
        </div>
      </SettingsCard>
      <TagManager scope={props.scopes['military-tags']} onResult={props.onResult} />
    </div>
  )
}

function TagManager(props: { readonly scope: AnyScope; readonly onResult: (message: string) => void }): ReactNode {
  const snapshot = useScopeSnapshot(props.scope)
  const tags = useMemo(() => parseTags(snapshot.value?.tagsJson), [snapshot])
  const [name, setName] = useState('')
  const [terms, setTerms] = useState('')
  const persist = async (
    mutate: (latest: readonly TacticalTag[]) => readonly TacticalTag[],
    message: string,
  ): Promise<void> => {
    await enqueueScopeMutation(props.scope, async () => {
      const latest = parseTags(props.scope.getSnapshot().value?.tagsJson)
      await setField(props.scope, 'tagsJson', JSON.stringify(mutate(latest), null, 2))
    })
    props.onResult(message)
  }
  const create = async (): Promise<void> => {
    const displayName = name.trim()
    if (displayName === '') {
      props.onResult('标签名称不能为空。')
      return
    }
    const now = new Date().toISOString()
    const tag: TacticalTag = {
      schemaVersion: '1.0.0',
      tagId: (`tag-${slug(displayName)}-${randomSuffix()}`) as TacticalTag['tagId'],
      revision: 1 as TacticalTag['revision'],
      displayName,
      status: 'ACTIVE',
      aliases: [],
      matchTerms: splitList(terms),
      parentTagIds: [],
      createdAt: now as TacticalTag['createdAt'],
      updatedAt: now as TacticalTag['updatedAt'],
    }
    await persist(latest => [...latest, tag], `已创建战术标签“${displayName}”。`)
    setName('')
    setTerms('')
  }
  const changeStatus = async (tag: TacticalTag, status: TacticalTag['status']): Promise<void> => {
    const now = new Date().toISOString()
    await persist(latest => latest.map(candidate => candidate.tagId === tag.tagId ? ({
      ...candidate,
      revision: (Number(candidate.revision) + 1) as TacticalTag['revision'],
      status,
      updatedAt: now as TacticalTag['updatedAt'],
      ...(status === 'DELETED' ? { deletedAt: now as TacticalTag['deletedAt'] } : {}),
    } as TacticalTag) : candidate), `${tag.displayName} 已${status === 'ACTIVE' ? '启用' : status === 'PAUSED' ? '暂停' : '删除'}。`)
  }
  const visible = tags.filter(tag => tag.status !== 'DELETED')
  return (
    <SettingsCard
      title="战术标签库"
      description="通过名称和匹配词管理标签，不需要编辑版本化 JSON。"
      onReset={() => {
        runUiAction(deleteAllTags(props.scope, tags, props.onResult), props.onResult)
      }}
    >
      <div style={formGridStyle}>
        <Labeled label="新标签名称">
          <input aria-label="新标签名称" value={name} onChange={event => setName(event.target.value)} />
        </Labeled>
        <Labeled label="匹配词（逗号分隔）">
          <input aria-label="新标签匹配词" value={terms} onChange={event => setTerms(event.target.value)} />
        </Labeled>
      </div>
      <Button variant="primary" size="sm" onClick={() => {
        runUiAction(create(), props.onResult)
      }}>添加标签</Button>
      {visible.length === 0 ? <p style={hintStyle}>尚未创建私有战术标签。</p> : (
        <div style={stackStyle}>
          {visible.map(tag => (
            <div key={String(tag.tagId)} style={tagRowStyle}>
              <div>
                <strong>{tag.displayName}</strong>
                <p style={microStyle}>{tag.matchTerms.length === 0 ? '无匹配词' : tag.matchTerms.join('、')}</p>
              </div>
              <div style={rowStyle}>
                <button type="button" onClick={() => {
                  runUiAction(changeStatus(tag, tag.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED'), props.onResult)
                }}>
                  {tag.status === 'PAUSED' ? '恢复' : '暂停'}
                </button>
                <button type="button" onClick={() => {
                  runUiAction(changeStatus(tag, 'DELETED'), props.onResult)
                }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}

function EvaluationPanel(props: {
  readonly scope: AnyScope
  readonly connection: Pick<ConnectionHandle, 'rpc'>
  readonly templates: readonly AgentTemplateProfile[]
  readonly onResult: (message: string) => void
}): ReactNode {
  const value = useScopeValue(props.scope)
  const [from, setFrom] = useExternalText(toLocalInput(String(value.periodFrom ?? ''), -30))
  const [to, setTo] = useExternalText(toLocalInput(String(value.periodTo ?? ''), 0))
  const templateIds = parseStringArray(value.templateIdsJson)
  const departments = parseStringArray(value.departmentsJson)
  const workspaceKeys = parseStringArray(value.workspaceKeysJson)
  const missionIds = parseStringArray(value.missionIdsJson)
  const runState = String(value.lastRunState ?? 'IDLE')
  const start = async (): Promise<void> => {
    const fromDate = new Date(from)
    const toDate = new Date(to)
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || fromDate >= toDate) {
      props.onResult('评估时间范围无效：开始时间必须早于结束时间。')
      return
    }
    await setMany(props.scope, [
      ['periodFrom', fromDate.toISOString()],
      ['periodTo', toDate.toISOString()],
      ['runNonce', Number(value.runNonce ?? 0) + 1],
    ])
    props.onResult('已提交绩效评估请求。')
  }
  const departmentOptions = unique(props.templates.map(item => item.department))
  return (
    <div style={stackStyle}>
      <SettingsCard
        title="评估范围"
        description="留空模板或部门表示全部。筛选项以可读选择器存储，报告仍由 Host 生成和校验。"
        onReset={() => { runUiAction(resetFields(props.scope, [
          'minimumSampleSize',
          'includeIncompleteByDefault', 'periodFrom', 'periodTo',
          'templateIdsJson', 'departmentsJson', 'workspaceKeysJson', 'missionIdsJson',
          'splitByRevision', 'comparisonBaseline', 'reportClassification',
          'confidenceLevel', 'nonInferiorityMargin', 'timeoutSeconds',
          'narrativeMode',
          'examinerTemplateId', 'chairTemplateId',
        ], props.onResult), props.onResult) }}
      >
        <div style={formGridStyle}>
          <Labeled label="开始时间"><input type="datetime-local" aria-label="评估开始时间" value={from} onChange={event => setFrom(event.target.value)} /></Labeled>
          <Labeled label="结束时间"><input type="datetime-local" aria-label="评估结束时间" value={to} onChange={event => setTo(event.target.value)} /></Labeled>
          <NumberSetting label="最低 Attempt 数" field="minimumSampleSize" scope={props.scope} value={Number(value.minimumSampleSize ?? 20)} min={1} max={10_000} step={1} onResult={props.onResult} />
          <SelectSetting label="比较基线" field="comparisonBaseline" scope={props.scope} value={String(value.comparisonBaseline ?? 'same-role-same-difficulty')} options={[
            ['same-role-same-difficulty', '同角色、同难度 Flash / Pro'],
            ['previous-period', '上一周期（需冻结历史基线）'],
            ['previous-revision', '上一模板修订（需冻结历史基线）'],
            ['organization-baseline', '组织基线（需冻结历史基线）'],
            ['none', '不比较'],
          ]} onResult={props.onResult} />
          <Labeled label="置信水平">
            <select
              aria-label="绩效评估置信水平"
              value={String(value.confidenceLevel ?? 0.95)}
              onChange={event => {
                runUiAction(setField(
                  props.scope,
                  'confidenceLevel',
                  Number(event.target.value),
                ), props.onResult)
              }}
            >
              <option value="0.9">90%</option>
              <option value="0.95">95%</option>
              <option value="0.99">99%</option>
            </select>
          </Labeled>
          <NumberSetting label="质量非劣界限" field="nonInferiorityMargin" scope={props.scope} value={Number(value.nonInferiorityMargin ?? 0.05)} min={0} max={0.5} step={0.01} onResult={props.onResult} />
          <NumberSetting label="单次执行超时（秒）" field="timeoutSeconds" scope={props.scope} value={Number(value.timeoutSeconds ?? 1_800)} min={30} max={86_400} step={30} onResult={props.onResult} />
          <SelectSetting label="报告叙事" field="narrativeMode" scope={props.scope} value={String(value.narrativeMode ?? 'DETERMINISTIC')} options={[
            ['DETERMINISTIC', '确定性（默认，不调用模型）'],
            ['COMMITTEE_MODEL', '委员会模型（可选，产生费用）'],
          ]} onResult={props.onResult} />
          <SelectSetting label="报告分类" field="reportClassification" scope={props.scope} value={String(value.reportClassification ?? 'confidential')} options={[
            ['public', '公开'], ['internal', '内部'], ['confidential', '机密'], ['restricted', '受限'],
          ]} onResult={props.onResult} />
          <SelectSetting label="评估委员模板" field="examinerTemplateId" scope={props.scope} value={String(value.examinerTemplateId ?? 'evaluation-examiner')} options={templateChoices(props.templates, 'evaluation-examiner')} onResult={props.onResult} />
          <SelectSetting label="委员会主席模板" field="chairTemplateId" scope={props.scope} value={String(value.chairTemplateId ?? 'evaluation-chair')} options={templateChoices(props.templates, 'evaluation-chair')} onResult={props.onResult} />
        </div>
        <p style={hintStyle}>
          模板、提示词、ToolProfile、PermissionProfile、Preset generation、
          Bundle 与 DSH commit 始终按不可变 revision 强制拆分。
        </p>
        <EvaluationCatalogSelectors
          connection={props.connection}
          workspaceKeys={workspaceKeys}
          missionIds={missionIds}
          onWorkspaces={next => {
            runUiAction(setField(
              props.scope,
              'workspaceKeysJson',
              JSON.stringify(next),
            ), props.onResult)
          }}
          onMissions={next => {
            runUiAction(setField(
              props.scope,
              'missionIdsJson',
              JSON.stringify(next),
            ), props.onResult)
          }}
          onError={props.onResult}
        />
        <MultiChoice
          label="模板筛选"
          selected={templateIds}
          choices={props.templates.map(item => [String(item.templateId), item.displayName] as const)}
          onChange={next => setField(props.scope, 'templateIdsJson', JSON.stringify(next))}
          onError={props.onResult}
        />
        <MultiChoice
          label="部门筛选"
          selected={departments}
          choices={departmentOptions.map(item => [String(item), departmentName(item)] as const)}
          onChange={next => setField(props.scope, 'departmentsJson', JSON.stringify(next))}
          onError={props.onResult}
        />
        <ToggleSetting label="纳入未完成会话" field="includeIncompleteByDefault" scope={props.scope} checked={Boolean(value.includeIncompleteByDefault ?? false)} onResult={props.onResult} />
        <Button variant="primary" size="sm" disabled={runState === 'RUNNING'} onClick={() => {
          runUiAction(start(), props.onResult)
        }}>
          {runState === 'RUNNING' ? '评估中…' : '运行绩效评估'}
        </Button>
        {String(value.lastError ?? '') === '' ? null : <p style={errorStyle}>{String(value.lastError)}</p>}
      </SettingsCard>
      <MilitaryEvaluationCenter
        connection={props.connection}
        onResult={props.onResult}
        refreshToken={[
          Number(value.runNonce ?? 0),
          runState,
          String(value.lastReportId ?? ''),
          String(value.lastDatasetHash ?? ''),
          String(value.lastError ?? ''),
        ].join(':')}
      />
    </div>
  )
}

function PresentationPanel(props: {
  readonly scope: AnyScope
  readonly templates: readonly AgentTemplateProfile[]
  readonly onResult: (message: string) => void
}): ReactNode {
  const value = useScopeValue(props.scope)
  return (
    <div style={panelGridStyle}>
      <SettingsCard
        title="显示偏好"
        description="只影响界面表达，不改变 Mission、权限、验证或终止语义。"
        onReset={() => {
          runUiAction(resetFields(props.scope, ['terminology', 'showAdvancedAudit', 'compactEventCards'], props.onResult), props.onResult)
        }}
      >
        <SelectSetting label="术语风格" field="terminology" scope={props.scope} value={String(value.terminology ?? 'military')} options={[
          ['military', '军事术语'], ['neutral', '中性术语'],
        ]} onResult={props.onResult} />
        <ToggleSetting label="显示高级审计信息" field="showAdvancedAudit" scope={props.scope} checked={Boolean(value.showAdvancedAudit ?? false)} onResult={props.onResult} />
        <ToggleSetting label="紧凑事件卡片" field="compactEventCards" scope={props.scope} checked={Boolean(value.compactEventCards ?? true)} onResult={props.onResult} />
      </SettingsCard>
      <SettingsCard title="治理清单" description="以下字段由 Host 编译，普通用户无需接触配置文本。">
        <div style={metricGridStyle}>
          <Metric label="模板数量" value={String(props.templates.length)} />
          <Metric label="活动模板" value={String(props.templates.filter(item => item.status === 'ACTIVE').length)} />
          <Metric label="独立工具配置" value={String(unique(props.templates.map(item => item.capabilities.toolProfileId)).length)} />
          <Metric label="独立权限配置" value={String(unique(props.templates.map(item => item.capabilities.permissionProfileId)).length)} />
        </div>
        <p style={hintStyle}>
          Agent identity、Task revision、ToolProfile、PermissionProfile、终止工具、幂等键和父级 receipt
          均由 Host 自动生成，设置页不会暴露容易误配的内部 ID。
        </p>
      </SettingsCard>
    </div>
  )
}

function SettingsCard(props: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
  readonly onReset?: () => void
}): ReactNode {
  return (
    <section style={cardStyle}>
      <div style={rowBetweenStyle}>
        <div>
          <h3 style={cardHeadingStyle}>{props.title}</h3>
          <p style={mutedStyle}>{props.description}</p>
        </div>
        {props.onReset === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={props.onReset}>恢复默认</Button>
        )}
      </div>
      {props.children}
    </section>
  )
}

function Labeled(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return <label style={labelStyle}><span style={labelTextStyle}>{props.label}</span>{props.children}</label>
}

function ToggleSetting(props: {
  readonly label: string
  readonly field: string
  readonly scope: AnyScope
  readonly checked: boolean
  readonly onResult: (message: string) => void
}): ReactNode {
  return (
    <label style={toggleRowStyle}>
      <input
        type="checkbox"
        aria-label={props.label}
        checked={props.checked}
        onChange={event => {
          runUiAction(
            setField(props.scope, props.field, event.target.checked)
              .then(() => props.onResult(`${props.label}已保存。`)),
            props.onResult,
          )
        }}
      />
      <span>{props.label}</span>
    </label>
  )
}

function SelectSetting(props: {
  readonly label: string
  readonly field: string
  readonly scope: AnyScope
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onResult: (message: string) => void
}): ReactNode {
  return (
    <Labeled label={props.label}>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={event => {
          runUiAction(
            setField(props.scope, props.field, event.target.value)
              .then(() => props.onResult(`${props.label}已保存。`)),
            props.onResult,
          )
        }}
      >
        {props.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </Labeled>
  )
}

function NumberSetting(props: {
  readonly label: string
  readonly field: string
  readonly scope: AnyScope
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly onResult: (message: string) => void
}): ReactNode {
  return (
    <LocalNumber
      label={props.label}
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      onCommit={async value => {
        await setField(props.scope, props.field, value)
        props.onResult(`${props.label}已保存。`)
      }}
      onError={props.onResult}
    />
  )
}

function TextSetting(props: {
  readonly label: string
  readonly field: string
  readonly scope: AnyScope
  readonly value: string
  readonly serialize?: (value: string) => unknown
  readonly onResult: (message: string) => void
}): ReactNode {
  const [draft, setDraft] = useExternalText(props.value)
  return (
    <Labeled label={props.label}>
      <input
        aria-label={props.label}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          const value = props.serialize?.(draft) ?? draft
          runUiAction(
            setField(props.scope, props.field, value)
              .then(() => props.onResult(`${props.label}已保存。`)),
            props.onResult,
          )
        }}
      />
    </Labeled>
  )
}

function LocalSelect(props: {
  readonly label: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => Promise<void>
  readonly onError: (message: string) => void
}): ReactNode {
  return (
    <Labeled label={props.label}>
      <select aria-label={props.label} value={props.value} onChange={event => {
        runUiAction(props.onChange(event.target.value), props.onError)
      }}>
        {props.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </Labeled>
  )
}

function LocalNumber(props: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly onCommit: (value: number) => Promise<void>
  readonly onError: (message: string) => void
}): ReactNode {
  const [draft, setDraft] = useExternalText(String(props.value))
  const commit = (): void => {
    const parsed = Number(draft)
    const value = Math.min(props.max, Math.max(props.min, parsed))
    if (!Number.isFinite(value)) {
      setDraft(String(props.value))
      return
    }
    setDraft(String(value))
    if (value !== props.value) runUiAction(props.onCommit(value), props.onError)
  }
  return (
    <Labeled label={props.label}>
      <input
        type="number"
        aria-label={props.label}
        value={draft}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
    </Labeled>
  )
}

function MultiChoice(props: {
  readonly label: string
  readonly selected: readonly string[]
  readonly choices: readonly (readonly [string, string])[]
  readonly onChange: (value: readonly string[]) => Promise<void>
  readonly onError: (message: string) => void
}): ReactNode {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={labelTextStyle}>{props.label}</legend>
      <div style={choiceGridStyle}>
        {props.choices.map(([value, label]) => (
          <label key={value} style={toggleRowStyle}>
            <input
              type="checkbox"
              checked={props.selected.includes(value)}
              onChange={event => {
                const next = event.target.checked
                  ? unique([...props.selected, value])
                  : props.selected.filter(item => item !== value)
                runUiAction(props.onChange(next), props.onError)
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Metric(props: { readonly label: string; readonly value: string }): ReactNode {
  return <div style={metricStyle}><span style={microStyle}>{props.label}</span><strong>{props.value}</strong></div>
}

function useMilitarySettingsOpen(): boolean {
  return useSyncExternalStore(
    callback => {
      settingsOpenListeners.add(callback)
      return () => { settingsOpenListeners.delete(callback) }
    },
    () => settingsOpen,
    () => false,
  )
}

function subscribeBlockedClose(callback: () => void): () => void {
  blockedCloseListeners.add(callback)
  return () => { blockedCloseListeners.delete(callback) }
}

function useScopeSnapshot(scope: AnyScope): ReturnType<AnyScope['getSnapshot']> {
  const subscribe = useCallback((callback: () => void) => scope.subscribe(callback), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useScopeValue(scope: AnyScope): Record<string, unknown> {
  return useScopeSnapshot(scope).value ?? {}
}

function useExternalText(value: string): [string, (value: string) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return [draft, setDraft]
}

function useModelCatalog(api: Pick<IApiClient['llm'], 'models'>): {
  readonly status: 'loading' | 'ready' | 'error'
  readonly groups: readonly ModelProviderGroup[]
  readonly message: string
} {
  const [state, setState] = useState<{
    readonly status: 'loading' | 'ready' | 'error'
    readonly groups: readonly ModelProviderGroup[]
    readonly message: string
  }>({ status: 'loading', groups: [], message: '' })
  useEffect(() => {
    const controller = new AbortController()
    void api.models({}, controller.signal).then((response) => {
      if (!response.result.ok) {
        setState({ status: 'error', groups: [], message: response.result.error.message })
        return
      }
      const failures = response.result.value.failures.map(item => `${item.name}: ${item.message}`).join('；')
      setState({ status: 'ready', groups: response.result.value.groups, message: failures })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', groups: [], message: error instanceof Error ? error.message : String(error) })
      }
    })
    return () => { controller.abort() }
  }, [api])
  return state
}

async function setMany(scope: AnyScope, fields: readonly (readonly [string, unknown])[]): Promise<void> {
  for (const [field, value] of fields) await setField(scope, field, value)
}

async function resetFields(scope: AnyScope, fields: readonly string[], onResult: (message: string) => void): Promise<void> {
  for (const field of fields) await unsetField(scope, field)
  onResult('已恢复该分组的默认值。')
}

async function resetTemplateRegistry(
  scope: AnyScope,
  current: readonly AgentTemplateProfile[],
  onResult: (message: string) => void,
): Promise<void> {
  await enqueueScopeMutation(scope, async () => {
    const baseValue = scope.getSnapshot().base
    const base = parseTemplateProfilesForUi(
      typeof baseValue === 'object' && baseValue !== null && !Array.isArray(baseValue)
        ? (baseValue as Record<string, unknown>).profilesJson
        : undefined,
    )
    if (base.length === 0) throw new Error('无法读取内置模板默认值')
    const latest = parseTemplateProfilesForUi(scope.getSnapshot().value?.profilesJson)
    const source = latest.length === 0 ? current : latest
    const now = new Date().toISOString()
    const next = base.map((baseline) => {
      const existing = source.find(item => item.templateId === baseline.templateId)
      return existing === undefined ? baseline : {
        ...baseline,
        ...(existing.rolePromptOverride === undefined
          ? {}
          : { rolePromptOverride: existing.rolePromptOverride }),
        revision: (Number(existing.revision) + 1) as AgentTemplateProfile['revision'],
        supersedesRevision: existing.revision,
        createdAt: existing.createdAt,
        updatedAt: now as AgentTemplateProfile['updatedAt'],
      }
    })
    await setField(scope, 'profilesJson', JSON.stringify(next, null, 2))
  })
  onResult('已用新的不可变修订恢复全部部门默认模型与预算。')
}

async function resetAllRolePrompts(
  routingScope: AnyScope,
  templatesScope: AnyScope,
  current: readonly AgentTemplateProfile[],
  onResult: (message: string) => void,
): Promise<void> {
  await unsetField(routingScope, 'generalPromptOverride')
  await enqueueScopeMutation(templatesScope, async () => {
    const latest = parseTemplateProfilesForUi(templatesScope.getSnapshot().value?.profilesJson)
    const profiles = latest.length === 0 ? current : latest
    const now = new Date().toISOString()
    const next = profiles.map((profile) => {
      if (profile.rolePromptOverride === undefined || profile.rolePromptOverride.trim() === '') {
        return profile
      }
      const { rolePromptOverride: _removed, ...rest } = profile
      return {
        ...rest,
        revision: (Number(profile.revision) + 1) as AgentTemplateProfile['revision'],
        supersedesRevision: profile.revision,
        updatedAt: now as AgentTemplateProfile['updatedAt'],
      }
    })
    await setField(templatesScope, 'profilesJson', JSON.stringify(next, null, 2))
  })
  onResult('已恢复 General 和全部部门角色的插件自带简体中文提示词。')
}

async function deleteAllTags(
  scope: AnyScope,
  tags: readonly TacticalTag[],
  onResult: (message: string) => void,
): Promise<void> {
  await enqueueScopeMutation(scope, async () => {
    const latest = parseTags(scope.getSnapshot().value?.tagsJson)
    const source = latest.length === 0 ? tags : latest
    const now = new Date().toISOString()
    const next = source.map(tag => tag.status === 'DELETED' ? tag : {
      ...tag,
      revision: (Number(tag.revision) + 1) as TacticalTag['revision'],
      status: 'DELETED' as const,
      updatedAt: now as TacticalTag['updatedAt'],
      deletedAt: now as TacticalTag['deletedAt'],
    })
    await setField(scope, 'tagsJson', JSON.stringify(next, null, 2))
  })
  onResult('已停用并删除全部用户战术标签。')
}

async function mutateTemplateProfile(
  scope: AnyScope,
  fallbackProfiles: readonly AgentTemplateProfile[],
  templateId: string,
  mutate: (current: AgentTemplateProfile) => AgentTemplateProfile,
): Promise<AgentTemplateProfile> {
  let saved: AgentTemplateProfile | undefined
  await enqueueScopeMutation(scope, async () => {
    const latest = parseTemplateProfilesForUi(scope.getSnapshot().value?.profilesJson)
    const profiles = latest.length === 0 ? fallbackProfiles : latest
    const current = profiles.find(candidate => String(candidate.templateId) === templateId)
    if (current === undefined) throw new Error(`模板 ${templateId} 不存在`)
    saved = reviseTemplateProfile(current, mutate)
    const next = profiles.map(candidate => String(candidate.templateId) === templateId
      ? saved!
      : candidate)
    await setField(scope, 'profilesJson', JSON.stringify(next, null, 2))
  })
  if (saved === undefined) throw new Error(`模板 ${templateId} 未保存`)
  return saved
}

async function setField(scope: AnyScope, field: string, value: unknown): Promise<void> {
  await scope.set(field, value)
  const resolved = scope.getSnapshot().value?.[field]
  if (!jsonEqual(resolved, value)) {
    throw new Error(`Host 未接受字段 ${field}`)
  }
}

async function unsetField(scope: AnyScope, field: string): Promise<void> {
  await scope.unset(field)
  const user = scope.getSnapshot().user
  if (typeof user === 'object'
    && user !== null
    && !Array.isArray(user)
    && Object.hasOwn(user, field)) {
    throw new Error(`Host 未清除字段 ${field}`)
  }
}

function enqueueScopeMutation(scope: AnyScope, operation: () => Promise<void>): Promise<void> {
  const previous = scopeMutationTails.get(scope) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  scopeMutationTails.set(scope, current)
  return current.finally(() => {
    if (scopeMutationTails.get(scope) === current) scopeMutationTails.delete(scope)
  })
}

function runUiAction(action: Promise<void>, onResult: (message: string) => void): void {
  void action.catch((error: unknown) => {
    onResult(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  })
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function withCurrentRoute(options: readonly ApprovedModelOption[], current: string): readonly ApprovedModelOption[] {
  if (options.some(option => routeKey(option.provider, option.model) === current) || !current.includes('/')) return options
  const slash = current.indexOf('/')
  return [...options, {
    provider: current.slice(0, slash),
    model: current.slice(slash + 1),
    capabilityProfileId: 'unknown',
    label: `${current}（当前旧配置）`,
    catalogConfirmed: false,
    canary: false,
  }]
}

function routeKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

function parseTags(source: unknown): readonly TacticalTag[] {
  if (typeof source !== 'string') return []
  try {
    const value: unknown = JSON.parse(source)
    return Array.isArray(value)
      ? value.filter((item): item is TacticalTag => typeof item === 'object' && item !== null && 'tagId' in item)
      : []
  } catch {
    return []
  }
}

function parseStringArray(source: unknown): readonly string[] {
  if (typeof source !== 'string') return []
  try {
    const value: unknown = JSON.parse(source)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function joinStringArray(source: unknown): string {
  return parseStringArray(source).join(', ')
}

function splitList(value: string): string[] {
  return unique(value.split(/[，,\n]/u).map(item => item.trim()).filter(Boolean))
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/gu, '')
  return normalized === '' ? 'custom' : normalized.slice(0, 40)
}

function randomSuffix(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toLocalInput(source: string, offsetDays: number): string {
  const fallback = new Date(Date.now() + offsetDays * 86_400_000)
  const parsed = source.trim() === '' ? fallback : new Date(source)
  const safe = Number.isFinite(parsed.getTime()) ? parsed : fallback
  const local = new Date(safe.getTime() - safe.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function templateChoices(
  templates: readonly AgentTemplateProfile[],
  fallback: string,
): readonly (readonly [string, string])[] {
  const choices = templates.map(item => [String(item.templateId), item.displayName] as const)
  return choices.some(([id]) => id === fallback) ? choices : [[fallback, fallback], ...choices]
}

function departmentName(value: string): string {
  return ({
    staff: '参谋部',
    'worker-forces': '快速反应部队',
    'engineer-corps': '工兵部',
    oversight: '督战队',
    'logistics-research': '后勤与研究',
    'evaluation-committee': '评估委员会',
  } as Record<string, string>)[value] ?? value
}

function parseRecord(source: unknown): Record<string, unknown> | null {
  if (typeof source !== 'string' || source.trim() === '') return null
  try {
    const value: unknown = JSON.parse(source)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function summaryOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value !== 'object' || value === null) return '—'
  const record = value as Record<string, unknown>
  for (const key of ['summary', 'score', 'acceptanceRate', 'status']) {
    if (record[key] !== undefined) return String(record[key])
  }
  return `${Object.keys(record).length} 项指标`
}

const dialogHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '8px 14px 6px 20px',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const dialogHeaderActionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.12em',
  lineHeight: '12px',
}
const dialogTitleStyle: CSSProperties = {
  margin: '2px 0 0',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 16,
  fontWeight: 500,
  lineHeight: '24px',
}
const dialogSubtitleStyle: CSSProperties = {
  margin: '1px 0 0',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: '18px',
}
const dialogCloseStyle: CSSProperties = {
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
const settingsBodyStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '224px minmax(0, 1fr)',
  minHeight: 0,
}
const settingsNavStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 12px 10px',
  borderRight: '1px solid var(--dsw-alias-border-l2)',
  minHeight: 0,
}
const settingsNavButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 40,
  padding: '8px 12px',
  border: 0,
  borderRadius: 12,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'left',
  cursor: 'pointer',
}
const settingsNavActiveStyle: CSSProperties = {
  ...settingsNavButtonStyle,
  background: 'var(--dsw-specific-sidebar-nav-item-active)',
  fontWeight: 500,
}
const settingsPolicyStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  marginTop: 'auto',
  padding: '10px 4px 0',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
}
const settingsContentStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 16,
  width: '100%',
  minWidth: 0,
  overflow: 'auto',
  padding: 24,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
}
const mutedStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  margin: '4px 0 0',
  lineHeight: '18px',
}
const sectionDescriptionStyle: CSSProperties = { ...mutedStyle, margin: 0 }
const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '9px 12px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}
const settingsGuardStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: '18px',
}
const stackStyle: CSSProperties = { display: 'grid', gap: 12 }
const rolePromptToolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 14px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
}
const toolbarHeadingStyle: CSSProperties = {
  display: 'block',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
}
const panelGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignItems: 'start' }
const templateGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }
const formGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }
const twoColumnStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
const cardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
}
const templateCardStyle: CSSProperties = { ...cardStyle, alignSelf: 'start' }
const rolePromptEditorStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 12,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}
const rolePromptLabelStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
}
const promptBoundaryHintStyle: CSSProperties = {
  maxWidth: 390,
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
}
const cardHeadingStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '22px',
}
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }
const rowBetweenStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }
const labelStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0 }
const labelTextStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
}
const toggleRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: '20px',
}
const hintStyle: CSSProperties = { ...mutedStyle, margin: 0 }
const microStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
  margin: '3px 0 0',
}
const governanceStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 11,
  lineHeight: '16px',
  margin: '10px 0 0',
  wordBreak: 'break-word',
}
const detailsSummaryStyle: CSSProperties = {
  width: 'fit-content',
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
  marginBottom: 10,
}
const fieldsetStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: 10,
  margin: 0,
}
const choiceGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 6 }
const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  display: 'grid',
  gap: 7,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: '20px',
}
const metricGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }
const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 10,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-module-platform)',
  minWidth: 0,
  wordBreak: 'break-word',
}
const tagRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  paddingTop: 10,
}
const errorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
  fontSize: 12,
  lineHeight: '18px',
  margin: 0,
}
