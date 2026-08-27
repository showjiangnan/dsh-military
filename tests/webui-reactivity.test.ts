import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ComponentType } from 'react'
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer'
import { defaultTemplates } from '@dsh-military/plugin-host/defaults'
import {
  GENERAL_ROLE_ID,
  MILITARY_BENCHMARK_DATASET_VERSION,
  MILITARY_BENCHMARK_SCENARIOS,
  MILITARY_CONTROL_SCHEMA_VERSION,
  diffPrompt,
  type MilitaryModelCatalogEntry,
  type RoleDraft,
  type RoleSimulationReport,
  type RoleWorkbenchDocument,
  type RoleWorkbenchSnapshot,
  type ToolSchemaSummary,
} from '@dsh-military/contracts'
import {
  applyRoleDraft,
  bundledRoleConfiguration,
  bundledRolePrompt,
  effectiveRolePrompt,
  initialRoleWorkbenchDocument,
  previewForConfiguration,
  readinessForConfiguration,
} from '../packages/plugin-host/src/role-workbench.js'
import * as militaryWebClient from '../packages/webui/src/client/index.js'
import {
  dispatchKnowledgeAction,
  fetchKnowledgeSnapshot,
} from '../packages/webui/src/client/knowledge-center.js'
import { MilitarySettingsSection } from '../packages/webui/src/client/settings-center.js'
import { MilitaryEvaluationCenter } from '../packages/webui/src/client/evaluation-center.js'

interface SettingsScopeSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
  readonly base: unknown
  readonly user: unknown
  readonly revision: number | undefined
  readonly writable: boolean
  readonly mode: 'host' | 'memory'
}

interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

interface ErasedSlotEntry {
  readonly component: ComponentType
  readonly options: {
    readonly name?: string
    readonly id?: string
    readonly order?: number
    readonly label?: () => string
  }
}

class StubSlots {
  readonly #entries: ErasedSlotEntry[] = []

  register(options: object, component: ComponentType): () => void {
    const entry = { component, options: options as ErasedSlotEntry['options'] }
    this.#entries.push(entry)
    return () => {
      const index = this.#entries.indexOf(entry)
      if (index >= 0) this.#entries.splice(index, 1)
    }
  }

  inject(_name: string, callback: () => () => void): () => void {
    const dispose = callback()
    let active = true
    return () => {
      if (!active) return
      active = false
      dispose()
    }
  }

  entries(name: string): readonly ErasedSlotEntry[] {
    return this.#entries.filter(entry => entry.options.name === name)
  }
}

class StubModelsApi {
  calls = 0
  readonly llm = {
    models: async (_payload: object, _signal?: AbortSignal) => {
      this.calls += 1
      return {
        rpcId: 'models-1',
        result: {
          ok: true as const,
          value: {
            groups: [{
              id: 'deepseek-official',
              name: 'DeepSeek Official',
              models: [
                { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash GA' },
                { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
              ],
            }],
            failures: [],
          },
        },
      }
    },
  }
}

const STUB_TOOL_SCHEMAS: readonly ToolSchemaSummary[] = [
  {
    name: 'read',
    available: true,
    propertyCount: 1,
    requiredCount: 1,
    maximumDepth: 2,
    schemaBytes: 180,
    terminal: false,
  },
  {
    name: 'report',
    available: true,
    propertyCount: 1,
    requiredCount: 1,
    maximumDepth: 2,
    schemaBytes: 180,
    terminal: true,
  },
]

const STUB_MODELS: readonly MilitaryModelCatalogEntry[] = [
  {
    provider: 'deepseek-official',
    providerName: 'DeepSeek Official',
    model: 'deepseek-v4-flash',
    modelName: 'DeepSeek V4 Flash GA',
    status: 'CANARY',
    statusReason: 'Military Flash capability remains CANARY pending user Provider validation.',
    capabilityProfileId: 'deepseek-v4-flash-rc2',
    supportedReasoning: ['high', 'max'],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 256_000,
    toolCalling: 'SUPPORTED',
    inputModalities: ['text'],
    available: true,
    selectable: true,
    exactRoute: 'deepseek-official/deepseek-v4-flash',
    evidence: ['stub DSH catalog', 'stub Military CANARY profile'],
    pricing: { status: 'UNAVAILABLE', currency: 'USD' },
  },
  {
    provider: 'deepseek-official',
    providerName: 'DeepSeek Official',
    model: 'deepseek-v4-pro',
    modelName: 'DeepSeek V4 Pro',
    status: 'VALIDATED',
    statusReason: 'Military capability is VALIDATED.',
    capabilityProfileId: 'deepseek-v4-pro-rc2',
    supportedReasoning: ['high', 'max'],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 256_000,
    toolCalling: 'SUPPORTED',
    inputModalities: ['text'],
    available: true,
    selectable: true,
    exactRoute: 'deepseek-official/deepseek-v4-pro',
    evidence: ['stub DSH catalog', 'stub Military VALIDATED profile'],
    pricing: { status: 'UNAVAILABLE', currency: 'USD' },
  },
  {
    provider: 'third-party-provider',
    providerName: 'Third Party Gateway',
    model: 'economy-model',
    modelName: 'Economy Model',
    status: 'UNVERIFIED',
    statusReason: 'DSH 已接入该模型；绩效样本独立记录，不影响可用性。',
    supportedReasoning: ['economy'],
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_096,
    toolCalling: 'SUPPORTED',
    inputModalities: ['text'],
    available: true,
    selectable: true,
    exactRoute: 'third-party-provider/economy-model',
    evidence: ['stub live third-party DSH adapter'],
    pricing: { status: 'UNAVAILABLE', currency: 'USD' },
  },
]

class StubControlPlane {
  #descriptorRevision = 1
  #document: RoleWorkbenchDocument = initialRoleWorkbenchDocument({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    maxOutputTokens: 16_384,
    generalPromptOverride: '',
  }, defaultTemplates())

  readonly rpc = {
    call: async (
      _channel: string,
      endpoint: string,
      payload: unknown,
    ): Promise<{ readonly ok: true; readonly value: unknown }> => {
      if (endpoint === 'militaryControlPlane/snapshot') {
        return { ok: true, value: this.snapshot() }
      }
      if (endpoint !== 'militaryControlPlane/execute') {
        throw new Error(`unknown stub endpoint ${endpoint}`)
      }
      const action = ((payload as {
        readonly args?: { readonly action?: Record<string, unknown> }
      }).args?.action ?? {})
      return { ok: true, value: this.execute(action) }
    },
  }

  snapshot(): RoleWorkbenchSnapshot {
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      documentRevision: this.#descriptorRevision,
      document: this.#document,
      roles: this.#document.roles.map(configuration => ({
        configuration,
        bundledConfiguration: bundledRoleConfiguration(configuration.roleId),
        bundledPrompt: bundledRolePrompt(configuration.roleId),
        effectivePrompt: effectiveRolePrompt(configuration),
        customPrompt: configuration.promptOverride !== '',
        tools: STUB_TOOL_SCHEMAS,
        preview: previewForConfiguration(
          configuration,
          STUB_TOOL_SCHEMAS.map(value => value.name),
        ),
        readiness: readinessForConfiguration(
          configuration,
          STUB_TOOL_SCHEMAS,
          configuration.model === 'deepseek-v4-pro' ? 'VALIDATED' : 'CANARY',
        ),
        history: this.#document.history
          .filter(value => value.roleId === configuration.roleId)
          .sort((left, right) => right.revision - left.revision),
        revisionMetrics: [],
        simulations: [],
      })),
      models: STUB_MODELS,
      generatedAt: new Date().toISOString(),
    }
  }

  execute(action: Record<string, unknown>): unknown {
    const type = String(action.type ?? '')
    if (type === 'PREVIEW_ROLE') {
      const draft = action.draft as RoleDraft
      const configuration = this.#document.roles.find(value => value.roleId === draft.roleId)!
      const candidate = {
        ...configuration,
        provider: draft.provider,
        model: draft.model,
        reasoningEffort: draft.reasoningEffort,
        maxOutputTokens: draft.maxOutputTokens,
        contextBudgetTokens: draft.contextBudgetTokens,
        concurrencyLimit: draft.concurrencyLimit,
        promptOverride: draft.prompt === bundledRolePrompt(draft.roleId) ? '' : draft.prompt,
      }
      return {
        schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
        expectedRevision: this.#descriptorRevision,
        roleId: draft.roleId,
        preview: previewForConfiguration(candidate, STUB_TOOL_SCHEMAS.map(value => value.name)),
        readiness: readinessForConfiguration(
          candidate,
          STUB_TOOL_SCHEMAS,
          draft.model === 'deepseek-v4-pro' ? 'VALIDATED' : 'CANARY',
        ),
        diff: diffPrompt(effectiveRolePrompt(configuration), draft.prompt),
        model: STUB_MODELS.find(value => value.model === draft.model),
      }
    }
    if (type === 'SAVE_ROLE') {
      const expectedRevision = Number(action.expectedRevision)
      if (expectedRevision !== this.#descriptorRevision) {
        return {
          completed: false,
          code: 'REVISION_CONFLICT',
          expectedRevision,
          current: this.snapshot(),
        }
      }
      const draft = action.draft as RoleDraft
      this.#document = applyRoleDraft({
        document: this.#document,
        draft,
        source: 'USER_SAVE',
        toolSchemas: STUB_TOOL_SCHEMAS,
        modelStatus: draft.model === 'deepseek-v4-pro' ? 'VALIDATED' : 'CANARY',
      })
      this.#descriptorRevision += 1
      return { completed: true, documentRevision: this.#descriptorRevision }
    }
    if (type === 'SIMULATE_ROLE') {
      const role = this.snapshot().roles.find(value =>
        value.configuration.roleId === String(action.roleId))!
      return {
        schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
        simulationId: String(action.operationId ?? 'stub-simulation'),
        roleId: String(action.roleId),
        workbenchRevision: this.#document.revision,
        roleRevision: 0,
        toolProfileRef: `${role.configuration.toolProfileId}@${role.configuration.toolProfileRevision}`,
        modelStatus: 'CANARY',
        mode: 'DETERMINISTIC',
        status: 'PASSED',
        steps: [
          { id: 'TOOL_VISIBILITY', status: 'PASSED', message: 'stub visibility' },
          { id: 'FIRST_CALL', status: 'PASSED', toolName: 'read', message: 'stub first call' },
          { id: 'SCHEMA_VALIDATION', status: 'PASSED', toolName: 'read', message: 'stub schema' },
          { id: 'CORRECTION', status: 'PASSED', toolName: 'read', message: 'stub correction' },
          { id: 'TERMINAL', status: 'PASSED', toolName: 'report', message: 'stub terminal' },
          { id: 'PARENT_RECEIPT', status: 'PASSED', message: 'stub receipt' },
        ],
        costStatus: 'NOT_APPLICABLE',
        latencyMs: 1,
        createdAt: new Date().toISOString(),
      } satisfies RoleSimulationReport
    }
    if (type === 'EXPORT_PORTABLE') {
      return {
        schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
        kind: 'dsh-military-portable-role-settings',
        roles: this.#document.roles.map(configuration => ({
          roleId: configuration.roleId,
          provider: configuration.provider,
          model: configuration.model,
          reasoningEffort: configuration.reasoningEffort,
          maxOutputTokens: configuration.maxOutputTokens,
          contextBudgetTokens: configuration.contextBudgetTokens,
          concurrencyLimit: configuration.concurrencyLimit,
          prompt: effectiveRolePrompt(configuration),
        })),
      }
    }
    throw new Error(`unsupported stub action ${type}`)
  }
}

class StubClientFiber {
  readonly slots = new StubSlots()
  readonly settingsScope: StubSettingsBinder
  readonly models = new StubModelsApi()
  readonly control = new StubControlPlane()
  readonly #disposers: Array<() => void> = []

  constructor(settingsScope: StubSettingsBinder) {
    this.settingsScope = settingsScope
  }

  get(name: string): unknown {
    if (name === 'connection') return this.connection
    throw new Error(`unknown service ${name}`)
  }

  get connection(): unknown {
    return { api: this.models, rpc: this.control.rpc }
  }

  effect(callback: () => (() => void), _label?: string): () => void {
    const dispose = callback()
    this.#disposers.push(dispose)
    return dispose
  }

  apply(): void {
    militaryWebClient.apply(this as unknown as Parameters<typeof militaryWebClient.apply>[0])
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0).reverse()) dispose()
  }
}

class StubSettingsScope<T> implements SettingsScope<T> {
  #snapshot: SettingsScopeSnapshot<T>
  readonly #listeners = new Set<() => void>()
  readonly #ignoredWrites = new Set<string>()

  constructor(value: T) {
    this.#snapshot = {
      status: 'ready',
      value,
      base: value,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
    }
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    if (this.#ignoredWrites.delete(field)) return
    this.replace({ ...this.asRecord(), [field]: value } as T)
  }

  async unset(field: string): Promise<void> {
    const next = { ...this.asRecord() }
    delete next[field]
    const base = this.#snapshot.base
    if (typeof base === 'object' && base !== null && !Array.isArray(base) && field in base) {
      next[field] = (base as Record<string, unknown>)[field]
    }
    this.replace(next as T)
  }

  replace(value: T): void {
    this.#snapshot = {
      ...this.#snapshot,
      value,
      revision: (this.#snapshot.revision ?? 0) + 1,
    }
    for (const listener of [...this.#listeners]) listener()
  }

  get listenerCount(): number {
    return this.#listeners.size
  }

  ignoreNextWrite(field: string): void {
    this.#ignoredWrites.add(field)
  }

  private asRecord(): Record<string, unknown> {
    const value = this.#snapshot.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  }
}

class StubSettingsBinder {
  readonly scopes = new Map<string, StubSettingsScope<Record<string, unknown>>>()

  bind<T extends Record<string, unknown>>(spec: { readonly namespace: string }): SettingsScope<T> {
    let scope = this.scopes.get(spec.namespace)
    if (scope === undefined) {
      scope = new StubSettingsScope<Record<string, unknown>>(initialSettings(spec.namespace))
      this.scopes.set(spec.namespace, scope)
    }
    return scope as unknown as SettingsScope<T>
  }
}

test('Military owns a sidebar settings dialog with seven primary tabs and reactive visual controls', async t => {
  const binder = new StubSettingsBinder()
  const fiber = new StubClientFiber(binder)
  fiber.apply()
  let footerRenderer: ReactTestRenderer | undefined
  let renderer: ReactTestRenderer | undefined
  t.after(() => {
    footerRenderer?.unmount()
    renderer?.unmount()
    fiber.dispose()
  })

  assert.equal(fiber.slots.entries('settings.section').length, 0)
  assert.equal(binder.scopes.size, 12)
  const sidebarEntries = fiber.slots.entries('sidebar.footer.action')
  const overlayEntries = fiber.slots.entries('shell.overlay')
  assert.deepEqual(sidebarEntries.map(entry => entry.options.id), ['military-settings'])
  assert.equal(sidebarEntries[0]?.options.order, 35)
  assert.equal(sidebarEntries[0]?.options.label?.(), 'Military 设置与知识中心')
  await act(async () => {
    footerRenderer = TestRenderer.create(createElement(
      sidebarEntries[0]!.component as ComponentType<{ readonly wide: boolean }>,
      { wide: false },
    ))
  })
  const footerRoot = requiredRenderer(footerRenderer).root
  assert.equal(footerRoot.findAllByProps({ 'data-military-footer-actions': 'true' }).length, 1)
  assert.equal(footerRoot.findAllByProps({ 'data-military-settings-trigger': 'true' }).length, 1)
  assert.equal(footerRoot.findAllByProps({ 'data-military-knowledge-trigger': 'true' }).length, 1)
  await act(async () => { footerRenderer?.unmount() })
  assert.deepEqual(overlayEntries.map(entry => entry.options.id), [
    'military-settings',
    'military-knowledge',
  ])
  assert.equal(overlayEntries[0]?.options.order, 110)

  await act(async () => {
    renderer = TestRenderer.create(createElement(MilitarySettingsSection, {
      scopes: Object.fromEntries(
        [...binder.scopes.entries()].map(([namespace, scope]) => [namespace, scope]),
      ) as never,
      connection: fiber.connection as never,
    }))
    await Promise.resolve()
    await Promise.resolve()
  })
  const root = requiredRenderer(renderer).root
  assert.equal(fiber.models.calls, 0, 'Military model catalog is Host-owned, not a second frontend allowlist')
  assert.equal(root.findAllByProps({ 'data-military-settings-center': 'true' }).length, 1)
  assert.deepEqual(
    root.findAllByProps({ 'data-dshm-nav': true }).map(item => item.children.join('')),
    [
      'Military-部门模型',
      'Military-执行与成本',
      'Military-Specs 工作区',
      'Military-安全与恢复',
      'Military-战术与标签',
      'Military-绩效评估',
      'Military-显示与进阶',
    ],
  )

  assert.equal(root.findAllByProps({ 'data-role-catalog': 'true' }).length, 1)
  assert.equal(
    root.findAll(node => typeof node.props['data-role-catalog-item'] === 'string').length,
    12,
    'General and all 11 departments are represented in the searchable catalog',
  )
  assert.equal(
    root.findAll(node => typeof node.props['data-role-prompt-editor'] === 'string').length,
    1,
    'only the selected role editor is mounted',
  )
  const generalModel = root.findByProps({ 'aria-label': 'General 总指挥 模型' })
  assert.equal(generalModel.props.value, 'deepseek-official/deepseek-v4-flash')
  const generalOptions = generalModel.findAllByType('option').map(option => String(option.children.join('')))
  assert.ok(generalOptions.some(label => label.includes('DeepSeek V4 Flash GA')))
  assert.ok(generalOptions.some(label => label.includes('DeepSeek V4 Pro')))
  assert.ok(generalOptions.some(label =>
    label.includes('Economy Model')
    && label.includes('DSH 已接入')))
  assert.equal(
    generalOptions.some(label => label.includes('未验证')),
    false,
  )
  const generalPrompt = root.findByProps({ 'aria-label': 'General 总指挥 角色提示词' })
  assert.match(String(generalPrompt.props.value), /总指挥智能体/u)

  await act(async () => {
    root.findByProps({ 'data-role-catalog-item': 'worker-default' }).props.onClick()
  })
  const workerPrompt = root.findByProps({ 'aria-label': '快速反应部队 角色提示词' })
  const workerModel = root.findByProps({ 'aria-label': '快速反应部队 模型' })
  const workerReasoning = root.findByProps({ 'aria-label': '快速反应部队 推理强度' })
  assert.match(String(workerPrompt.props.value), /隔离工作区/u)
  const customWorkerPrompt = `${String(workerPrompt.props.value)}\n\n自定义要求：每次修改前再次核对任务写入范围，并在终态成功后立即停止。`
  await act(async () => {
    workerModel.props.onChange({ target: { value: 'third-party-provider/economy-model' } })
    workerReasoning.props.onChange({ target: { value: 'max' } })
    workerPrompt.props.onChange({ target: { value: customWorkerPrompt } })
  })
  assert.equal(
    root.findAllByProps({ 'data-role-prompt-editor': '快速反应部队' }).length,
    1,
  )
  assert.equal(
    root.findAllByProps({ 'data-role-catalog-item': 'advisor-react' }).length,
    1,
  )

  // Dirty role switching is explicit: the editor remains mounted until the
  // user saves or discards the local transaction.
  await act(async () => {
    root.findByProps({ 'data-role-catalog-item': 'advisor-react' }).props.onClick()
  })
  assert.equal(root.findAllByProps({ 'data-role-editor': 'worker-default' }).length, 1)
  assert.ok(root.findAllByProps({ role: 'alert' }).some(item =>
    item.findAllByType('strong').some(label =>
      label.children.join('').includes('未保存草稿'))))

  await act(async () => {
    button(root, '检查草稿后进入保存').props.onClick()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(root.findAllByProps({ 'data-save-review': 'true' }).length, 1)
  assert.equal(root.findAllByProps({ 'data-effective-prompt-preview': 'true' }).length >= 1, true)
  assert.ok(root.findAllByType('summary').some(item =>
    item.children.join('').includes('最终有效提示词')))

  await act(async () => {
    button(root, '保存配置').props.onClick()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(root.findAllByProps({ 'data-role-editor': 'advisor-react' }).length, 1)
  const savedWorker = fiber.control.snapshot().roles.find(value =>
    value.configuration.roleId === 'worker-default')
  assert.ok(savedWorker)
  assert.equal(savedWorker.configuration.provider, 'third-party-provider')
  assert.equal(savedWorker.configuration.model, 'economy-model')
  assert.equal(savedWorker.configuration.reasoningEffort, 'max')
  assert.equal(savedWorker.configuration.maxOutputTokens, 4_096)
  assert.equal(savedWorker.configuration.contextBudgetTokens, 32_768)
  assert.equal(savedWorker.configuration.promptOverride, customWorkerPrompt)
  assert.equal(savedWorker.history.length, 1)

  await act(async () => {
    button(root, 'Military-战术与标签').props.onClick()
    await Promise.resolve()
    await Promise.resolve()
  })
  const extractionModel = root.findByProps({ 'aria-label': '私有技能提炼模型' })
  assert.ok(extractionModel.findAllByType('option').some(option =>
    option.props.value === 'third-party-provider/economy-model'))
  await act(async () => {
    extractionModel.props.onChange({
      target: { value: 'third-party-provider/economy-model' },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  const privateSkills = requiredScope(binder, 'military-private-skills')
  assert.equal(
    privateSkills.getSnapshot().value?.extractionProvider,
    'third-party-provider',
  )
  assert.equal(
    privateSkills.getSnapshot().value?.extractionModel,
    'economy-model',
  )

  await act(async () => {
    button(root, 'Military-安全与恢复').props.onClick()
  })
  const core = requiredScope(binder, 'military-core')
  assert.equal(
    root.findAllByProps({ 'aria-label': '严格 RC.2 兼容检查（重启生效）' }).length,
    0,
    'fixed compatibility and safety contracts must not be exposed as mutable switches',
  )
  assert.ok(root.findAllByType('p').some(item => item.children.join('').includes('终态 receipt')))

  await act(async () => {
    button(root, 'Military-执行与成本').props.onClick()
  })
  assert.equal(root.findByProps({ 'aria-label': '每任务最多电台尝试' }).props.value, '5')
  await act(async () => {
    core.replace({ maxRadioAttempts: 8, radioLeaseSeconds: 120 })
  })
  assert.equal(root.findByProps({ 'aria-label': '每任务最多电台尝试' }).props.value, '8')

  await act(async () => {
    button(root, 'Military-显示与进阶').props.onClick()
  })
  const terminology = root.findByProps({ 'aria-label': '术语风格' })
  await act(async () => {
    terminology.props.onChange({ target: { value: 'neutral' } })
    await Promise.resolve()
  })
  assert.equal(root.findByProps({ 'data-military-settings-center': 'true' }).props['data-terminology'], 'neutral')
  assert.equal(root.findByType('h2').children.join(''), 'Military 设置中心')
  assert.equal(button(root, 'Military-部门模型').props['aria-selected'], false)
  assert.equal(button(root, 'Military-显示与进阶').props.role, 'tab')
  assert.equal(
    root.findByProps({ role: 'tabpanel' }).props['aria-labelledby'],
    'military-settings-tab-presentation',
  )
  let keyboardFocused = false
  await act(async () => {
    button(root, 'Military-显示与进阶').props.onKeyDown({
      key: 'Home',
      nativeEvent: { isComposing: false },
      preventDefault() {},
      currentTarget: {
        parentElement: {
          querySelector() {
            return { focus() { keyboardFocused = true } }
          },
        },
      },
    })
  })
  assert.equal(button(root, 'Military-部门模型').props['aria-selected'], true)
  assert.equal(keyboardFocused, true)
  await act(async () => {
    button(root, 'Military-显示与进阶').props.onClick()
  })

  const presentation = requiredScope(binder, 'military-presentation')
  presentation.ignoreNextWrite('showAdvancedAudit')
  await act(async () => {
    root.findByProps({ 'aria-label': '显示高级审计信息' }).props.onChange({ target: { checked: true } })
    await Promise.resolve()
    await Promise.resolve()
  })
  const notices = root.findAllByProps({ role: 'status' })
  assert.ok(notices.some(item => item.children.join('').includes('保存失败：Host 未接受字段 showAdvancedAudit')))

  await act(async () => { renderer?.unmount() })
  for (const scope of binder.scopes.values()) assert.equal(scope.listenerCount, 0)
  fiber.dispose()
  assert.equal(fiber.slots.entries('settings.section').length, 0)
  assert.equal(fiber.slots.entries('sidebar.footer.action').length, 0)
  assert.equal(fiber.slots.entries('shell.overlay').length, 0)

  const replacement = new StubClientFiber(binder)
  replacement.apply()
  assert.equal(replacement.slots.entries('settings.section').length, 0)
  assert.equal(replacement.slots.entries('sidebar.footer.action').length, 1)
  assert.equal(replacement.slots.entries('shell.overlay').length, 2)
  replacement.dispose()
  assert.equal(replacement.slots.entries('settings.section').length, 0)
})

test('performance decision center exposes all seven governed views without requiring a report', async () => {
  let evaluationSnapshotCalls = 0
  const connection = {
    rpc: {
      async call(
        _channel: string,
        endpoint: string,
      ): Promise<{ readonly ok: true; readonly value: unknown }> {
        if (endpoint === 'militaryEvaluationCenter/snapshot') {
          evaluationSnapshotCalls += 1
          return {
            ok: true,
            value: {
              schemaVersion: '1.0.0',
              runs: [],
              reports: [],
              appeals: [],
              latestReport: null,
              catalog: { workspaces: [], missions: [] },
              generatedAt: '2026-08-27T00:00:00.000Z',
            },
          }
        }
        if (endpoint === 'militaryBenchmark/snapshot') {
          return {
            ok: true,
            value: {
              schemaVersion: '1.0.0',
              dataset: {
                version: MILITARY_BENCHMARK_DATASET_VERSION,
                hash: 'fixture-benchmark-hash',
                scenarios: MILITARY_BENCHMARK_SCENARIOS,
              },
              runs: [],
              providerSamples: [],
              providerStability: [],
              eligibleSessions: [],
              generatedAt: '2026-08-27T00:00:00.000Z',
            },
          }
        }
        throw new Error(`unexpected endpoint ${endpoint}`)
      },
    },
  }
  let renderer: ReactTestRenderer | undefined
  await act(async () => {
    renderer = TestRenderer.create(createElement(MilitaryEvaluationCenter, {
      connection: connection as never,
      onResult() {},
      refreshToken: '0:IDLE:::',
    }))
    await Promise.resolve()
    await Promise.resolve()
  })
  const root = requiredRenderer(renderer).root
  const labels = [
    '决策总览',
    '角色 / 模型比较',
    '九场景热力图',
    '工具调用漏斗',
    '成本 / 延迟 Pareto',
    '数据与 Evidence',
    '历史 / 申诉 / 实验',
  ]
  assert.deepEqual(
    root.findAllByProps({ role: 'tab' }).map(item =>
      item.children.join('')),
    labels,
  )
  for (const label of labels) {
    await act(async () => {
      button(root, label).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(button(root, label).props['aria-selected'], true)
  }
  assert.equal(
    root.findAllByProps({ 'data-military-evaluation-center': 'true' }).length,
    1,
  )
  assert.equal(root.findAllByProps({ role: 'alert' }).length, 0)
  assert.equal(evaluationSnapshotCalls, 1)
  await act(async () => {
    renderer?.update(createElement(MilitaryEvaluationCenter, {
      connection: connection as never,
      onResult() {},
      refreshToken: '1:COMPLETED:report-1:dataset-1:',
    }))
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.equal(evaluationSnapshotCalls, 2)
  await act(async () => { renderer?.unmount() })
})

test('Knowledge Center sends source bytes only through the trusted RPC boundary', async () => {
  const calls: Array<{
    readonly channel: string
    readonly endpoint: string
    readonly payload: unknown
  }> = []
  const connection = {
    rpc: {
      async call(channel: string, endpoint: string, payload: unknown): Promise<{
        readonly ok: true
        readonly value: unknown
      }> {
        calls.push({ channel, endpoint, payload })
        if (endpoint === 'militaryPrivateSkills/snapshot') {
          return {
            ok: true,
            value: {
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
                generatedAt: '',
              },
              tags: [],
            },
          }
        }
        return { ok: true, value: { completed: true } }
      },
    },
  }
  const raw = 'private source bytes that must never enter Settings'
  await dispatchKnowledgeAction(connection as never, {
    type: 'CREATE_DIRECT_SOURCE',
    title: 'RPC-only source',
    content: raw,
  })
  const snapshot = await fetchKnowledgeSnapshot(connection as never)
  assert.equal(snapshot.operation.sources.length, 0)
  assert.equal(calls[0]?.channel, '/api')
  assert.equal(calls[0]?.endpoint, 'militaryPrivateSkills/execute')
  const firstPayload = calls[0]?.payload as {
    readonly args: {
      readonly action: {
        readonly content: string
        readonly operationId: string
      }
    }
  }
  assert.equal(firstPayload.args.action.content, raw)
  assert.ok(firstPayload.args.action.operationId.length > 0)
  assert.deepEqual(calls[1], {
    channel: '/api',
    endpoint: 'militaryPrivateSkills/snapshot',
    payload: { args: {} },
  })
})

function button(root: ReactTestRenderer['root'], label: string): ReturnType<ReactTestRenderer['root']['findByType']> {
  const result = root.findAllByType('button').find(candidate => candidate.children.join('') === label)
  if (result === undefined) throw new Error(`missing button ${label}`)
  return result
}

function requiredScope(
  binder: StubSettingsBinder,
  namespace: string,
): StubSettingsScope<Record<string, unknown>> {
  const scope = binder.scopes.get(namespace)
  if (scope === undefined) throw new Error(`missing settings scope ${namespace}`)
  return scope
}

function requiredRenderer(renderer: ReactTestRenderer | undefined): ReactTestRenderer {
  if (renderer === undefined) throw new Error('component did not render')
  return renderer
}

function parseProfiles(source: unknown): Array<{
  readonly templateId: string
  readonly revision: number
  readonly status: string
  readonly modelPolicy: {
    readonly model: string
    readonly modelCapabilityProfileId: string
    readonly allowCanaryModel?: boolean
    readonly reasoningEffort: string
  }
  readonly rolePromptOverride?: string
}> {
  assert.equal(typeof source, 'string')
  return JSON.parse(source as string) as ReturnType<typeof parseProfiles>
}

function initialSettings(namespace: string): Record<string, unknown> {
  if (namespace === 'military-model-routing') {
    return {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      maxOutputTokens: 16_384,
      generalPromptOverride: '',
    }
  }
  if (namespace === 'military-agent-templates') {
    return { profilesJson: JSON.stringify(defaultTemplates(), null, 2) }
  }
  if (namespace === 'military-core') {
    return { maxRadioAttempts: 5, radioLeaseSeconds: 120 }
  }
  if (namespace === 'military-staff') {
    return { chiefOfStaffFallbackEnabled: true }
  }
  if (namespace === 'military-oversight') {
    return {
      completionInterlockEnabled: true,
      freezeOnSecondMissingSubmission: true,
      requireObservedToolEvidence: true,
      maximumNoProgressTurns: 3,
    }
  }
  if (namespace === 'military-tactics') {
    return {
      candidateRecallMinimum: 3,
      candidateRecallMaximum: 5,
      allowCanaryDelivery: true,
    }
  }
  if (namespace === 'military-private-skills') {
    return {
      extractionProvider: 'deepseek-official',
      extractionModel: 'deepseek-v4-flash',
      maxOutputTokens: 2_048,
      allowDeterministicFallback: false,
      defaultVisibility: 'user-private',
      defaultRetentionDays: 365,
    }
  }
  if (namespace === 'military-specs') {
    return { commitMessagePrefix: 'docs(specs):' }
  }
  if (namespace === 'military-memory') {
    return {
      trajectoryAfterWave: true,
      effectivenessAfterGeneralCompaction: true,
    }
  }
  if (namespace === 'military-tags') return { tagsJson: '[]' }
  if (namespace === 'military-evaluation') {
    return {
      minimumSampleSize: 20,
      includeIncompleteByDefault: false,
      periodFrom: '',
      periodTo: '',
      templateIdsJson: '[]',
      departmentsJson: '[]',
      workspaceKeysJson: '[]',
      missionIdsJson: '[]',
      splitByRevision: true,
      comparisonBaseline: 'same-role-same-difficulty',
      confidenceLevel: 0.95,
      nonInferiorityMargin: 0.05,
      timeoutSeconds: 1_800,
      narrativeMode: 'DETERMINISTIC',
      reportClassification: 'confidential',
      examinerTemplateId: 'evaluation-examiner',
      chairTemplateId: 'evaluation-chair',
      runNonce: 0,
      lastRunState: 'IDLE',
    }
  }
  if (namespace === 'military-presentation') {
    return { terminology: 'military', showAdvancedAudit: false, compactEventCards: true }
  }
  return {}
}
