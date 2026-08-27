import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionEvent,
  SessionHeader,
  SessionId as DshSessionId,
} from '@deepseek-ai/dsh-session'
import {
  BlockAssembler,
  ReasoningEffortId,
  createUserMessage,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import {
  SettingsConflictError,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import {
  validateJsonSchemaValue,
  type JsonSchemaNode,
} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  GENERAL_ROLE_ID,
  MILITARY_CONTROL_SCHEMA_VERSION,
  compileEffectivePrompt,
  diffPrompt,
  estimateUsdCost,
  applySimplifiedChineseFixes,
  lintSimplifiedChinese,
  type MilitaryModelCatalogEntry,
  type MilitaryModelValidationStatus,
  type PortableRoleConfiguration,
  type RoleDraft,
  type RoleSimulationReport,
  type RoleSimulationStep,
  type RoleRevisionMetrics,
  type SimplifiedChineseReviewReceipt,
  type RoleWorkbenchRoleSnapshot,
  type RoleWorkbenchSnapshot,
  type ObservedToolCallReceipt,
} from '@dsh-military/contracts'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import {
  ROLE_WORKBENCH_NAMESPACE,
  applyRoleDraft,
  bundledRoleConfiguration,
  bundledRolePrompt,
  draftForRole,
  effectiveRolePrompt,
  parseRoleWorkbenchDocument,
  previewForConfiguration,
  readinessForConfiguration,
  roleDraftFromUnknown,
  serializeRoleWorkbenchDocument,
  synchronizeRoleWorkbench,
} from './role-workbench.js'
import {
  roleToolContracts,
  type ToolContract,
} from './role-readiness.js'
import {
  ROLE_REVISION_USE_NAMESPACE,
  type RoleRevisionUseRecord,
} from './role-usage.js'

const ACTOR = 'web-user'
const LIVE_CANARY_NAMESPACE = 'military-control-live-canary'
const ROLE_SIMULATION_NAMESPACE = 'military-role-simulation'
const MODEL_CATALOG_STATE_NAMESPACE = 'military-model-catalog-state'
const MODEL_CATALOG_AUDIT_NAMESPACE = 'military-model-catalog-audit'
const CONTROL_ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PORTABLE_KEYS = new Set([
  'roleId',
  'provider',
  'model',
  'reasoningEffort',
  'maxOutputTokens',
  'contextBudgetTokens',
  'concurrencyLimit',
  'prompt',
])

interface WorkbenchRead {
  readonly descriptorRevision: number
  readonly document: ReturnType<typeof parseRoleWorkbenchDocument>
}

interface LiveCanaryRecord {
  readonly state: 'RUNNING' | 'COMPLETED' | 'FAILED'
  readonly roleId: string
  readonly provider: string
  readonly model: string
  readonly startedAt: string
  readonly report?: RoleSimulationReport
  readonly error?: string
}

interface ModelCatalogAuditState {
  readonly schemaVersion: '1.0.0'
  readonly routes: Readonly<Record<string, {
    readonly status: MilitaryModelValidationStatus
    readonly revision: number
    readonly changedAt: string
    readonly reason: string
  }>>
}

interface PersistenceLike {
  inspect(id: DshSessionId, signal?: AbortSignal): Promise<{
    readonly meta: SessionHeader
    readonly events: readonly SessionEvent[]
  }>
}

/**
 * Host-owned settings workbench and safe canary RPC.
 *
 * Browser callers submit only editable role fields and an expected Settings
 * revision. Every authority field, model capability, tool schema, history
 * revision and runtime projection is resolved again on the Host.
 */
export class MilitaryControlPlaneRemoteService extends TypertRemoteService {
  private readonly state: SqliteStateRecords
  private catalogCache: {
    readonly expiresAt: number
    readonly value: readonly MilitaryModelCatalogEntry[]
  } | undefined

  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryControlPlane')
    this.state = new SqliteStateRecords(host.database, host.tenantId)
    ctx.on('llm/adapters-updated', () => {
      this.catalogCache = undefined
    })
  }

  @Remote
  async snapshot(signal: AbortSignal): Promise<RoleWorkbenchSnapshot> {
    signal.throwIfAborted()
    return await this.buildSnapshot(signal)
  }

  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const value = record(action, 'Military control action')
    const type = text(value.type, 'Military control action.type', 64)
    switch (type) {
      case 'PREVIEW_ROLE':
        return await this.preview(value, signal)
      case 'SAVE_ROLE':
        return await this.save(value, 'USER_SAVE', signal)
      case 'RESTORE_ROLE_PROMPT':
        return await this.restorePrompt(value, signal)
      case 'RESTORE_ROLE_DEFAULTS':
        return await this.restoreDefaults(value, signal)
      case 'ROLLBACK_ROLE':
        return await this.rollback(value, signal)
      case 'UNDO_ROLE':
        return await this.undo(value, signal)
      case 'SIMULATE_ROLE':
        return await this.simulate(value, signal)
      case 'RUN_LIVE_CANARY':
        return await this.liveCanary(value, signal)
      case 'EXPORT_PORTABLE':
        return await this.export(signal)
      case 'IMPORT_PREVIEW':
        return await this.importPreview(value, signal)
      case 'IMPORT_COMMIT':
        return await this.importCommit(value, signal)
      default:
        throw new TypeError(`unknown Military control action ${type}`)
    }
  }

  private async buildSnapshot(signal: AbortSignal): Promise<RoleWorkbenchSnapshot> {
    const workbench = this.readWorkbench()
    const models = await this.models(signal)
    const simulations = this.state.listSync<RoleSimulationReport>(
      ROLE_SIMULATION_NAMESPACE,
    )
    const revisionMetrics = await this.revisionMetrics(
      workbench.document.history,
      simulations,
      models,
      signal,
    )
    const roles: RoleWorkbenchRoleSnapshot[] = []
    for (const configuration of workbench.document.roles) {
      signal.throwIfAborted()
      const contracts = await this.toolContracts(configuration)
      const modelStatus = statusForRoute(models, configuration.provider, configuration.model)
      roles.push({
        configuration,
        bundledConfiguration: bundledRoleConfiguration(configuration.roleId),
        bundledPrompt: bundledRolePrompt(configuration.roleId),
        effectivePrompt: effectiveRolePrompt(configuration),
        customPrompt: configuration.promptOverride.trim() !== '',
        tools: contracts.map(value => value.summary),
        preview: previewForConfiguration(
          configuration,
          contracts.map(value => value.summary.name),
        ),
        readiness: readinessForConfiguration(
          configuration,
          contracts.map(value => value.summary),
          modelStatus,
        ),
        history: workbench.document.history
          .filter(value => value.roleId === configuration.roleId)
          .sort((left, right) => right.revision - left.revision),
        revisionMetrics: revisionMetrics.filter(value =>
          value.roleId === configuration.roleId).map(value => value.metrics),
        simulations: simulations
          .filter(value => value.roleId === configuration.roleId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 20),
      })
    }
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      documentRevision: workbench.descriptorRevision,
      document: workbench.document,
      roles,
      models,
      generatedAt: new Date().toISOString(),
    }
  }

  private async preview(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const workbench = this.readWorkbench()
    const draft = roleDraftFromUnknown(action.draft)
    const current = role(workbench.document.roles, draft.roleId)
    const contracts = await this.toolContracts(current)
    const models = await this.models(signal)
    const modelStatus = statusForRoute(models, draft.provider, draft.model)
    const candidate: PortableRoleConfiguration = {
      ...current,
      provider: draft.provider,
      model: draft.model,
      reasoningEffort: draft.reasoningEffort,
      maxOutputTokens: draft.maxOutputTokens,
      contextBudgetTokens: draft.contextBudgetTokens,
      concurrencyLimit: current.roleId === GENERAL_ROLE_ID ? 1 : draft.concurrencyLimit,
      promptOverride: draft.prompt === bundledRolePrompt(current.roleId) ? '' : draft.prompt,
    }
    const readiness = readinessForConfiguration(
      candidate,
      contracts.map(value => value.summary),
      modelStatus,
    )
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      expectedRevision: workbench.descriptorRevision,
      roleId: current.roleId,
      preview: previewForConfiguration(
        candidate,
        contracts.map(value => value.summary.name),
      ),
      readiness,
      diff: diffPrompt(effectiveRolePrompt(current), draft.prompt),
      simplifiedChineseLint: lintSimplifiedChinese(draft.prompt),
      model: models.find(value =>
        value.provider === draft.provider && value.model === draft.model),
    }
  }

  private async save(
    action: Record<string, unknown>,
    source: 'USER_SAVE' | 'IMPORT' | 'ROLLBACK',
    signal: AbortSignal,
    options?: { readonly rollbackOfRevision?: number },
  ): Promise<unknown> {
    const expectedRevision = integer(
      action.expectedRevision,
      0,
      Number.MAX_SAFE_INTEGER,
      'SAVE_ROLE.expectedRevision',
    )
    const draft = roleDraftFromUnknown(action.draft)
    const workbench = this.readWorkbench()
    if (workbench.descriptorRevision !== expectedRevision) {
      return await this.conflict(expectedRevision, signal)
    }
    const current = role(workbench.document.roles, draft.roleId)
    const contracts = await this.toolContracts(current)
    const models = await this.models(signal)
    const model = exactModel(models, draft.provider, draft.model)
    if (!model.available) {
      throw new TypeError(
        `${draft.provider}/${draft.model} 不在当前 DSH live 模型目录中，不能保存`,
      )
    }
    assertDraftFitsModel(draft, model)
    const next = applyRoleDraft({
      document: workbench.document,
      draft,
      source,
      actor: ACTOR,
      toolSchemas: contracts.map(value => value.summary),
      modelStatus: model.status,
      simplifiedChineseReview: createSimplifiedChineseReviewReceipt(
        action.lintReview,
        draft.prompt,
        source,
      ),
      ...(options?.rollbackOfRevision === undefined
        ? {}
        : { rollbackOfRevision: options.rollbackOfRevision }),
    })
    try {
      await this.ctx.settings.update(
        settingsNamespace(ROLE_WORKBENCH_NAMESPACE),
        { stateJson: serializeRoleWorkbenchDocument(next) },
        expectedRevision,
      )
    } catch (error) {
      if (error instanceof SettingsConflictError) return await this.conflict(expectedRevision, signal)
      throw error
    }
    // Settings is the durable source of truth, but a successful save is not
    // reported until the exact runtime projection has also consumed it.
    await synchronizeRoleWorkbench(this.host, next)
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      completed: true,
      type: source,
      roleId: draft.roleId,
      previousDocumentRevision: expectedRevision,
      documentRevision: this.readWorkbench().descriptorRevision,
      workbenchRevision: next.revision,
    }
  }

  private async restorePrompt(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const roleId = identifier(action.roleId, 'RESTORE_ROLE_PROMPT.roleId')
    const current = role(this.readWorkbench().document.roles, roleId)
    return await this.save({
      ...action,
      draft: {
        ...draftForRole(current),
        prompt: bundledRolePrompt(roleId),
      },
    }, 'USER_SAVE', signal)
  }

  private async restoreDefaults(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const roleId = identifier(action.roleId, 'RESTORE_ROLE_DEFAULTS.roleId')
    const current = role(this.readWorkbench().document.roles, roleId)
    const defaults = bundledRoleConfiguration(roleId)
    return await this.save({
      ...action,
      draft: {
        roleId,
        provider: defaults.provider,
        model: defaults.model,
        reasoningEffort: defaults.reasoningEffort,
        maxOutputTokens: defaults.maxOutputTokens,
        contextBudgetTokens: defaults.contextBudgetTokens,
        concurrencyLimit: defaults.concurrencyLimit,
        prompt: bundledRolePrompt(roleId),
      } satisfies RoleDraft,
    }, 'USER_SAVE', signal)
  }

  private async rollback(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const roleId = identifier(action.roleId, 'ROLLBACK_ROLE.roleId')
    const revision = integer(
      action.revision,
      1,
      Number.MAX_SAFE_INTEGER,
      'ROLLBACK_ROLE.revision',
    )
    const workbench = this.readWorkbench()
    const target = workbench.document.history.find(value =>
      value.roleId === roleId && value.revision === revision)
    if (target === undefined) throw new TypeError(`unknown role revision ${roleId}@${revision}`)
    return await this.save({
      ...action,
      draft: draftForRole(target.configuration),
    }, 'ROLLBACK', signal, { rollbackOfRevision: revision })
  }

  private async undo(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const roleId = identifier(action.roleId, 'UNDO_ROLE.roleId')
    const workbench = this.readWorkbench()
    const latest = workbench.document.history
      .filter(value => value.roleId === roleId)
      .sort((left, right) => right.revision - left.revision)[0]
    if (latest?.previousConfiguration === undefined) {
      throw new TypeError(`${roleId} 没有可撤销的配置 revision`)
    }
    return await this.save({
      ...action,
      draft: draftForRole(latest.previousConfiguration),
    }, 'ROLLBACK', signal, { rollbackOfRevision: latest.revision })
  }

  private async simulate(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RoleSimulationReport> {
    const simulationId = identifier(action.operationId, 'SIMULATE_ROLE.operationId')
    const existing = this.state.readSync<RoleSimulationReport>(
      ROLE_SIMULATION_NAMESPACE,
      simulationId,
    )
    if (existing !== null) return existing
    const roleId = identifier(action.roleId, 'SIMULATE_ROLE.roleId')
    const started = Date.now()
    const workbench = this.readWorkbench()
    const configuration = role(workbench.document.roles, roleId)
    const contracts = await this.toolContracts(configuration)
    const models = await this.models(signal)
    const readiness = readinessForConfiguration(
      configuration,
      contracts.map(value => value.summary),
      statusForRoute(models, configuration.provider, configuration.model),
    )
    const steps: RoleSimulationStep[] = []
    const available = contracts.filter(value => value.summary.available)
    steps.push({
      id: 'TOOL_VISIBILITY',
      status: readiness.errorCount === 0 && available.length === contracts.length ? 'PASSED' : 'FAILED',
      message: readiness.errorCount === 0
        ? `Host 已解析 ${available.length} 个精确工具 Schema。`
        : `Flash 就绪检查有 ${readiness.errorCount} 个阻断问题。`,
    })
    const first = preferredFirstTool(available)
    let firstArguments: unknown
    if (first === undefined) {
      steps.push({
        id: 'FIRST_CALL',
        status: 'FAILED',
        message: '没有可用于首调用模拟的非终态工具。',
      })
    } else {
      steps.push({
        id: 'FIRST_CALL',
        status: 'PASSED',
        toolName: first.schema.name,
        message: `首调用选择 ${first.schema.name}，名称来自实际可见工具面。`,
      })
      const validArgs = minimalJsonValue(first.schema.parameters, first.schema.name)
      firstArguments = validArgs
      const violations = validateJsonSchemaValue(
        first.schema.parameters as JsonSchemaNode,
        validArgs,
        'args',
      )
      steps.push({
        id: 'SCHEMA_VALIDATION',
        status: violations.length === 0 ? 'PASSED' : 'FAILED',
        toolName: first.schema.name,
        message: violations.length === 0
          ? 'Host 生成的最小参数首次通过实际 JSON Schema。'
          : `最小参数仍有 Schema 问题：${violations.join('；')}`,
      })
      const invalidViolations = validateJsonSchemaValue(
        first.schema.parameters as JsonSchemaNode,
        {},
        'args',
      )
      steps.push({
        id: 'CORRECTION',
        status: invalidViolations.length === 0 ? 'SKIPPED' : violations.length === 0 ? 'PASSED' : 'FAILED',
        toolName: first.schema.name,
        message: invalidViolations.length === 0
          ? '该工具没有必填参数，无需构造纠错回合。'
          : violations.length === 0
            ? `Host 可将 ${invalidViolations.length} 条缺参错误一次纠正为有效调用。`
            : '缺参错误未能一次纠正。',
      })
    }
    const terminal = preferredTerminalTool(available, roleId)
    if (terminal === undefined) {
      steps.push({ id: 'TERMINAL', status: 'FAILED', message: '没有职责允许的终态工具。' })
    } else {
      const terminalArgs = minimalJsonValue(terminal.schema.parameters, terminal.schema.name)
      const violations = validateJsonSchemaValue(
        terminal.schema.parameters as JsonSchemaNode,
        terminalArgs,
        'args',
      )
      steps.push({
        id: 'TERMINAL',
        status: violations.length === 0 ? 'PASSED' : 'FAILED',
        toolName: terminal.schema.name,
        message: violations.length === 0
          ? `唯一终态 ${terminal.schema.name} 的最小参数通过实际 Schema；成功后必须停止。`
          : `终态参数未通过：${violations.join('；')}`,
      })
    }
    steps.push({
      id: 'PARENT_RECEIPT',
      status: roleId === GENERAL_ROLE_ID ? 'SKIPPED' : terminal === undefined ? 'FAILED' : 'PASSED',
      message: roleId === GENERAL_ROLE_ID
        ? 'General 是根角色，不需要父级回执。'
        : terminal === undefined
          ? '没有终态动作，无法生成父级 receipt。'
          : '模拟仅验证 Host receipt 路由，不写入 Session、不唤醒真实父代理。',
    })
    const report: RoleSimulationReport = {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      simulationId,
      roleId,
      workbenchRevision: workbench.document.revision,
      roleRevision: latestRoleRevision(workbench.document.history, roleId),
      toolProfileRef: `${configuration.toolProfileId}@${configuration.toolProfileRevision}`,
      modelStatus: statusForRoute(models, configuration.provider, configuration.model),
      mode: 'DETERMINISTIC',
      status: steps.some(value => value.status === 'FAILED') ? 'FAILED' : 'PASSED',
      steps,
      provider: configuration.provider,
      model: configuration.model,
      costStatus: 'NOT_APPLICABLE',
      latencyMs: Date.now() - started,
      ...(first === undefined
        ? {}
        : {
            rawToolChoice: {
              name: first.schema.name,
              arguments: JSON.stringify(firstArguments),
            },
            normalizedArguments: firstArguments,
          }),
      createdAt: new Date().toISOString(),
    }
    this.state.putSync(ROLE_SIMULATION_NAMESPACE, simulationId, report, {
      createOnly: true,
    })
    return report
  }

  private async liveCanary(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RoleSimulationReport> {
    if (action.confirmation !== 'RUN_SAFE_READ_ONLY_CANARY') {
      throw new TypeError('在线 Canary 需要显式确认 RUN_SAFE_READ_ONLY_CANARY')
    }
    const operationId = identifier(action.operationId, 'RUN_LIVE_CANARY.operationId')
    const roleId = identifier(action.roleId, 'RUN_LIVE_CANARY.roleId')
    const workbench = this.readWorkbench()
    const configuration = role(workbench.document.roles, roleId)
    const existing = this.state.readSync<LiveCanaryRecord>(
      LIVE_CANARY_NAMESPACE,
      operationId,
    )
    if (existing?.state === 'COMPLETED' && existing.report !== undefined) return existing.report
    if (existing !== null) {
      throw new TypeError(
        `在线 Canary ${operationId} 已处于 ${existing.state}；为避免重复计费不会自动重放`,
      )
    }
    const models = await this.models(signal)
    const catalog = exactModel(models, configuration.provider, configuration.model)
    if (!catalog.available) {
      throw new TypeError(`${catalog.exactRoute} 当前不能运行安全 Canary：${catalog.statusReason}`)
    }
    const contracts = await this.toolContracts(configuration)
    const readiness = readinessForConfiguration(
      configuration,
      contracts.map(value => value.summary),
      catalog.status,
    )
    if (readiness.errorCount > 0) {
      throw new TypeError('在线 Canary 被 Flash 就绪检查阻断；先修复确定性合同问题')
    }
    const startedAt = new Date().toISOString()
    this.state.putSync<LiveCanaryRecord>(
      LIVE_CANARY_NAMESPACE,
      operationId,
      {
        state: 'RUNNING',
        roleId,
        provider: configuration.provider,
        model: configuration.model,
        startedAt,
      },
      { createOnly: true },
    )
    const started = Date.now()
    try {
      const canaryTool: ToolSchema = {
        name: 'military_canary_report',
        description: '只读 Canary：报告是否理解角色工具调用合同。此工具不执行任何项目操作。',
        parameters: {
          type: 'object',
          properties: {
            roleId: { type: 'string', const: roleId },
            status: { type: 'string', const: 'ready' },
          },
          required: ['roleId', 'status'],
          additionalProperties: false,
        },
      }
      const assembler = new BlockAssembler()
      const canaryPrompt = compileEffectivePrompt({
        roleId: configuration.roleId,
        rolePrompt: effectiveRolePrompt(configuration),
        displayName: configuration.displayName,
        templateRevision: configuration.templateRevision,
        provider: configuration.provider,
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort,
        maxOutputTokens: 256,
        contextBudgetTokens: configuration.contextBudgetTokens,
        toolNames: [canaryTool.name],
        permissionProfileId: configuration.permissionProfileId,
      }).text
      for await (const chunk of this.ctx.llm.stream({
        provider: configuration.provider,
        model: configuration.model,
        reasoningEffort: ReasoningEffortId(configuration.reasoningEffort),
        system: [
          canaryPrompt,
          '',
          '这是用户明确启动的只读工具合同 Canary。不得调用、读取或修改项目。',
          '只调用一次 military_canary_report，参数必须精确为当前 roleId 和 status=ready；成功后立即停止。',
        ].join('\n'),
        messages: [createUserMessage({
          content: [{
            type: 'text',
            text: `请执行只读 Canary。当前 roleId 是 ${roleId}。`,
          }],
          source: { kind: 'plugin', plugin: 'dsh-military-control-plane' },
        })],
        tools: [canaryTool],
        temperature: 0,
        maxTokens: 256,
        signal,
      })) assembler.push(chunk)
      const blocks = assembler.blocks()
      const calls = blocks.filter((block): block is Extract<
        (typeof blocks)[number],
        { type: 'tool-call' }
      > => block.type === 'tool-call')
      const call = calls[0]
      let parsedArguments: unknown
      try {
        parsedArguments = call === undefined ? undefined : JSON.parse(call.arguments)
      } catch {
        parsedArguments = undefined
      }
      const violations = call === undefined
        ? ['model did not emit a tool call']
        : call.name !== canaryTool.name
          ? [`model selected ${call.name}`]
          : validateJsonSchemaValue(
              canaryTool.parameters as JsonSchemaNode,
              parsedArguments,
              'args',
            )
      const passed = calls.length === 1
        && violations.length === 0
        && assembler.finish.kind === 'tool-calls'
      const usage = assembler.usage
      const cost = usage === undefined
        ? { status: 'PROVIDER_PRICING_UNAVAILABLE' as const }
        : estimateUsdCost({
            inputTokens: usage.inputTokens
              + (usage.cacheReadTokens ?? 0)
              + (usage.cacheWriteTokens ?? 0),
            outputTokens: usage.outputTokens,
            pricing: catalog.pricing,
          })
      const report: RoleSimulationReport = {
        schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
        simulationId: operationId,
        roleId,
        workbenchRevision: workbench.document.revision,
        roleRevision: latestRoleRevision(workbench.document.history, roleId),
        toolProfileRef: `${configuration.toolProfileId}@${configuration.toolProfileRevision}`,
        modelStatus: catalog.status,
        mode: 'LIVE_CANARY',
        status: passed ? 'PASSED' : 'FAILED',
        steps: [
          {
            id: 'TOOL_VISIBILITY',
            status: 'PASSED',
            toolName: canaryTool.name,
            message: 'Provider 只收到一个无副作用 Canary 工具。',
          },
          {
            id: 'FIRST_CALL',
            status: call?.name === canaryTool.name ? 'PASSED' : 'FAILED',
            ...(call === undefined ? {} : { toolName: call.name }),
            message: call === undefined
              ? '模型没有选择工具。'
              : `模型原始选择：${call.name}。`,
          },
          {
            id: 'SCHEMA_VALIDATION',
            status: violations.length === 0 ? 'PASSED' : 'FAILED',
            ...(call === undefined ? {} : { toolName: call.name }),
            message: violations.length === 0
              ? '原始参数首次通过固定 Canary Schema。'
              : violations.join('；'),
          },
          {
            id: 'CORRECTION',
            status: 'SKIPPED',
            message: '在线 Canary 不自动发起第二次付费纠错调用。',
          },
          {
            id: 'TERMINAL',
            status: assembler.finish.kind === 'tool-calls' && calls.length === 1 ? 'PASSED' : 'FAILED',
            ...(call === undefined ? {} : { toolName: call.name }),
            message: `Provider finish=${assembler.finish.kind}，工具调用数=${calls.length}。`,
          },
          {
            id: 'PARENT_RECEIPT',
            status: 'SKIPPED',
            message: 'Canary 不执行工具、不创建 receipt，也不唤醒真实父代理。',
          },
        ],
        provider: configuration.provider,
        model: configuration.model,
        ...(usage === undefined
          ? {}
          : {
              inputTokens: usage.inputTokens
                + (usage.cacheReadTokens ?? 0)
                + (usage.cacheWriteTokens ?? 0),
              outputTokens: usage.outputTokens,
            }),
        ...(cost.status === 'ESTIMATED' ? { estimatedCostUsd: cost.value } : {}),
        costStatus: cost.status,
        latencyMs: Date.now() - started,
        ...(call === undefined
          ? {}
          : {
              rawToolChoice: {
                name: call.name,
                arguments: call.arguments,
              },
            }),
        createdAt: new Date().toISOString(),
      }
      this.state.putSync(
        ROLE_SIMULATION_NAMESPACE,
        operationId,
        report,
        { createOnly: true },
      )
      this.state.putSync<LiveCanaryRecord>(LIVE_CANARY_NAMESPACE, operationId, {
        state: 'COMPLETED',
        roleId,
        provider: configuration.provider,
        model: configuration.model,
        startedAt,
        report,
      })
      return report
    } catch (error) {
      this.state.putSync<LiveCanaryRecord>(LIVE_CANARY_NAMESPACE, operationId, {
        state: 'FAILED',
        roleId,
        provider: configuration.provider,
        model: configuration.model,
        startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async export(signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const workbench = this.readWorkbench()
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      kind: 'dsh-military-portable-role-settings',
      exportedAt: new Date().toISOString(),
      roles: workbench.document.roles.map(value => draftForRole(value)),
      excluded: [
        'credentials',
        'absolute workspace paths',
        'Session and Task ids',
        'Capability Grants',
        'receipts',
        'runtime history',
      ],
    }
  }

  private async importPreview(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const drafts = portableDrafts(action.portable)
    const workbench = this.readWorkbench()
    const models = await this.models(signal)
    const roles = []
    for (const draft of drafts) {
      const current = role(workbench.document.roles, draft.roleId)
      const contracts = await this.toolContracts(current)
      const status = statusForRoute(models, draft.provider, draft.model)
      const candidate: PortableRoleConfiguration = {
        ...current,
        provider: draft.provider,
        model: draft.model,
        reasoningEffort: draft.reasoningEffort,
        maxOutputTokens: draft.maxOutputTokens,
        contextBudgetTokens: draft.contextBudgetTokens,
        concurrencyLimit: current.roleId === GENERAL_ROLE_ID ? 1 : draft.concurrencyLimit,
        promptOverride: draft.prompt === bundledRolePrompt(draft.roleId) ? '' : draft.prompt,
      }
      roles.push({
        roleId: draft.roleId,
        diff: diffPrompt(effectiveRolePrompt(current), draft.prompt),
        readiness: readinessForConfiguration(
          candidate,
          contracts.map(value => value.summary),
          status,
        ),
      })
    }
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      expectedRevision: workbench.descriptorRevision,
      drafts,
      roles,
      blocked: roles.some(value => value.readiness.disposition === 'BLOCKED'),
    }
  }

  private async importCommit(
    action: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const expectedRevision = integer(
      action.expectedRevision,
      0,
      Number.MAX_SAFE_INTEGER,
      'IMPORT_COMMIT.expectedRevision',
    )
    const drafts = portableDrafts(action.portable)
    const workbench = this.readWorkbench()
    if (workbench.descriptorRevision !== expectedRevision) {
      return await this.conflict(expectedRevision, signal)
    }
    const models = await this.models(signal)
    let next = workbench.document
    for (const draft of drafts) {
      const current = role(next.roles, draft.roleId)
      const contracts = await this.toolContracts(current)
      const model = exactModel(models, draft.provider, draft.model)
      if (!model.available) {
        throw new TypeError(`${model.exactRoute} 不在当前 DSH live 模型目录中，导入被阻断`)
      }
      assertDraftFitsModel(draft, model)
      next = applyRoleDraft({
        document: next,
        draft,
        source: 'IMPORT',
        actor: ACTOR,
        toolSchemas: contracts.map(value => value.summary),
        modelStatus: model.status,
        simplifiedChineseReview: createSimplifiedChineseReviewReceipt(
          undefined,
          draft.prompt,
          'IMPORT',
        ),
      })
    }
    try {
      await this.ctx.settings.update(
        settingsNamespace(ROLE_WORKBENCH_NAMESPACE),
        { stateJson: serializeRoleWorkbenchDocument(next) },
        expectedRevision,
      )
    } catch (error) {
      if (error instanceof SettingsConflictError) return await this.conflict(expectedRevision, signal)
      throw error
    }
    await synchronizeRoleWorkbench(this.host, next)
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      completed: true,
      type: 'IMPORT',
      roles: drafts.map(value => value.roleId),
      documentRevision: this.readWorkbench().descriptorRevision,
      workbenchRevision: next.revision,
    }
  }

  private async conflict(expectedRevision: number, signal: AbortSignal): Promise<unknown> {
    return {
      schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
      completed: false,
      code: 'REVISION_CONFLICT',
      expectedRevision,
      current: await this.buildSnapshot(signal),
      choices: ['REBASE_DRAFT', 'TAKE_EXTERNAL', 'KEEP_DRAFT'],
    }
  }

  private readWorkbench(): WorkbenchRead {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(value => String(value.ns) === ROLE_WORKBENCH_NAMESPACE)
    if (descriptor === undefined) throw new Error('Military role workbench settings are unavailable')
    const value = record(descriptor.value, 'Military role workbench settings')
    return {
      descriptorRevision: descriptor.revision,
      document: parseRoleWorkbenchDocument(value.stateJson),
    }
  }

  private async toolContracts(
    configuration: PortableRoleConfiguration,
  ): Promise<readonly ToolContract[]> {
    return await roleToolContracts(this.ctx, this.host, configuration)
  }

  private async models(signal: AbortSignal): Promise<readonly MilitaryModelCatalogEntry[]> {
    const cached = this.catalogCache
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value
    const providers = this.ctx.llm.listProviders()
    const entries: MilitaryModelCatalogEntry[] = []
    for (const provider of providers) {
      signal.throwIfAborted()
      let models: Awaited<ReturnType<typeof this.ctx.llm.listModels>>
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        models = []
      }
      for (const model of models) {
        signal.throwIfAborted()
        let resolved: Awaited<ReturnType<typeof this.ctx.llm.resolveModelInfo>> | undefined
        try {
          resolved = await this.ctx.llm.resolveModelInfo(provider.id, model.id, signal)
        } catch {
          resolved = undefined
        }
        let capability: Awaited<ReturnType<
          MilitaryHostRuntime['ensureDshModelCapability']
        >> | undefined
        try {
          capability = await this.host.ensureDshModelCapability(
            provider.id,
            model.id,
            signal,
          )
        } catch {
          capability = undefined
        }
        const compatibility = modelCompatibility(resolved)
        const status = capability === undefined
          ? 'UNVERIFIED'
          : capability.status === 'VALIDATED'
            ? 'VALIDATED'
            : capability.status === 'CANARY'
              ? 'CANARY'
              : capability.status === 'DEPRECATED'
                ? 'DEPRECATED'
                : 'UNVERIFIED'
        const contextWindowTokens = capability?.contextWindowTokens
          ?? resolved?.context?.contextWindow
        const maxOutputTokens = capability?.maxOutputTokens
          ?? resolved?.defaultMaxTokens
        entries.push({
          provider: provider.id,
          providerName: provider.name,
          model: model.id,
          modelName: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          status,
          statusReason: capability === undefined
            ? `DSH 已接入该模型；${compatibility.reason}`
            : `DSH 已接入该模型；Military capability ${capability.profileId}@${Number(capability.revision)}。绩效验证只作为独立 Evidence，不影响可用性。`,
          ...(capability === undefined ? {} : { capabilityProfileId: capability.profileId }),
          supportedReasoning: capability?.supportedReasoning
            ?? resolved?.reasoning?.efforts.map(value => String(value.id))
            ?? [],
          ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
          toolCalling: capability?.toolCalling === true
            ? 'SUPPORTED'
            : capability?.toolCalling === false
              ? 'UNSUPPORTED'
              : 'UNKNOWN',
          inputModalities: capability?.inputModalities
            ?? resolved?.inputModalities
            ?? [],
          available: true,
          selectable: true,
          exactRoute: `${provider.id}/${model.id}`,
          evidence: [
            `DSH adapter route ${provider.id} is live`,
            `DSH adapter catalog contains ${model.id}`,
            capability === undefined
              ? 'Military performance evidence is not required for availability'
              : `Military profile ${capability.profileId}@${Number(capability.revision)}`,
          ],
          pricing: {
            status: 'UNAVAILABLE',
            currency: 'USD',
          },
        })
      }
    }
    const configured = this.readWorkbench().document.roles
    for (const configuration of configured) {
      if (entries.some(value =>
        value.provider === configuration.provider && value.model === configuration.model)) continue
      let capability: Awaited<ReturnType<
        MilitaryHostRuntime['application']['policies']['modelCapability']
      >> | undefined
      try {
        capability = await this.host.application.policies.modelCapability(
          configuration.provider,
          configuration.model,
        )
      } catch {
        capability = undefined
      }
      entries.push({
        provider: configuration.provider,
        providerName: configuration.provider,
        model: configuration.model,
        modelName: configuration.model,
        status: capability?.status === 'DEPRECATED' ? 'DEPRECATED' : 'UNAVAILABLE',
        statusReason: '模型未出现在当前 DSH live adapter 目录中。',
        ...(capability === undefined ? {} : { capabilityProfileId: capability.profileId }),
        supportedReasoning: capability?.supportedReasoning ?? [],
        ...(capability === undefined
          ? {}
          : {
              contextWindowTokens: capability.contextWindowTokens,
              maxOutputTokens: capability.maxOutputTokens,
            }),
        toolCalling: capability?.toolCalling === true
          ? 'SUPPORTED'
          : capability?.toolCalling === false
            ? 'UNSUPPORTED'
            : 'UNKNOWN',
        inputModalities: capability?.inputModalities ?? [],
        available: false,
        selectable: false,
        exactRoute: `${configuration.provider}/${configuration.model}`,
        evidence: ['current settings reference this exact route', 'DSH live catalog does not'],
        pricing: { status: 'UNAVAILABLE', currency: 'USD' },
      })
    }
    entries.sort((left, right) =>
      modelStatusRank(left.status) - modelStatusRank(right.status)
      || left.providerName.localeCompare(right.providerName)
      || left.modelName.localeCompare(right.modelName))
    const audited = this.auditModelCatalog(entries)
    const value = Object.freeze(audited.map(entry => Object.freeze(entry)))
    this.catalogCache = { expiresAt: Date.now() + 10_000, value }
    return value
  }

  private auditModelCatalog(
    entries: readonly MilitaryModelCatalogEntry[],
  ): readonly MilitaryModelCatalogEntry[] {
    const previous = this.state.readSync<ModelCatalogAuditState>(
      MODEL_CATALOG_STATE_NAMESPACE,
      'catalog',
    ) ?? { schemaVersion: '1.0.0', routes: {} }
    const routes: Record<string, ModelCatalogAuditState['routes'][string]> = {
      ...previous.routes,
    }
    const next = entries.map((entry): MilitaryModelCatalogEntry => {
      const current = previous.routes[entry.exactRoute]
      if (current !== undefined && current.status === entry.status
        && current.reason === entry.statusReason) {
        return {
          ...entry,
          aliases: entry.aliases ?? [],
          statusRevision: current.revision,
          statusChangedAt: current.changedAt,
        }
      }
      const changedAt = new Date().toISOString()
      const state = {
        status: entry.status,
        revision: (current?.revision ?? 0) + 1,
        changedAt,
        reason: entry.statusReason,
      }
      routes[entry.exactRoute] = state
      this.state.putSync(
        MODEL_CATALOG_AUDIT_NAMESPACE,
        `${entry.exactRoute}:${state.revision}`,
        {
          schemaVersion: '1.0.0',
          exactRoute: entry.exactRoute,
          ...(current === undefined ? {} : { previousStatus: current.status }),
          status: state.status,
          statusRevision: state.revision,
          reason: state.reason,
          changedAt,
          evidence: entry.evidence,
        },
        { createOnly: true },
      )
      return {
        ...entry,
        aliases: entry.aliases ?? [],
        statusRevision: state.revision,
        statusChangedAt: changedAt,
      }
    })
    this.state.putSync<ModelCatalogAuditState>(
      MODEL_CATALOG_STATE_NAMESPACE,
      'catalog',
      { schemaVersion: '1.0.0', routes },
    )
    return next
  }

  private async revisionMetrics(
    history: RoleWorkbenchSnapshot['document']['history'],
    simulations: readonly RoleSimulationReport[],
    models: readonly MilitaryModelCatalogEntry[],
    signal: AbortSignal,
  ): Promise<readonly {
    readonly roleId: string
    readonly metrics: RoleRevisionMetrics
  }[]> {
    const uses = this.state.listSync<RoleRevisionUseRecord>(
      ROLE_REVISION_USE_NAMESPACE,
    )
    const receipts = this.state.listSync<ObservedToolCallReceipt>(
      'observed-tool-call',
    )
    const sessionEvents = new Map<string, readonly SessionEvent[]>()
    const persistence = asSessionPersistence(this.ctx.sessionPersistence)
    const evaluationRefs = this.evaluationReferences()
    const result: Array<{ roleId: string; metrics: RoleRevisionMetrics }> = []
    for (const revision of history) {
      signal.throwIfAborted()
      const matching = uses.filter(value =>
        value.roleId === revision.roleId && value.roleRevision === revision.revision)
      const sessionIds = [...new Set(matching.map(value => value.sessionId))].sort()
      let inputTokens = 0
      let outputTokens = 0
      const callIds = new Set<string>()
      for (const use of matching) {
        signal.throwIfAborted()
        let events = sessionEvents.get(use.sessionId)
        if (events === undefined) {
          const live = this.ctx.agents?.get(use.sessionId as DshSessionId)
          if (live !== undefined) events = live.session.events
          else if (persistence !== undefined) {
            try {
              events = (await persistence.inspect(
                use.sessionId as DshSessionId,
                signal,
              )).events
            } catch {
              events = []
            }
          } else events = []
          sessionEvents.set(use.sessionId, events)
        }
        for (const event of events) {
          if (event.type === 'assistant/message'
            && event.data.turn === use.turn
            && event.data.step === use.step
            && event.data.usage !== undefined) {
            inputTokens += event.data.usage.inputTokens
              + (event.data.usage.cacheReadTokens ?? 0)
              + (event.data.usage.cacheWriteTokens ?? 0)
            outputTokens += event.data.usage.outputTokens
          }
          if (event.type === 'tool/call'
            && event.data.turn === use.turn
            && event.data.step === use.step) {
            callIds.add(String(event.data.callId))
          }
        }
      }
      const observed = receipts.filter(value =>
        callIds.has(value.callId))
      const successfulToolCalls = observed.filter(value => !value.isError).length
      const failedToolCalls = observed.filter(value => value.isError).length
      const route = models.find(value =>
        value.provider === revision.configuration.provider
        && value.model === revision.configuration.model)
      const cost = estimateUsdCost({
        inputTokens,
        outputTokens,
        pricing: route?.pricing ?? { status: 'UNAVAILABLE', currency: 'USD' },
      })
      result.push({
        roleId: revision.roleId,
        metrics: {
          roleRevision: revision.revision,
          sessionIds,
          modelRequests: matching.length,
          inputTokens,
          outputTokens,
          toolCalls: observed.length,
          successfulToolCalls,
          failedToolCalls,
          ...(observed.length === 0
            ? {}
            : { successRate: successfulToolCalls / observed.length }),
          simulationIds: simulations
            .filter(value =>
              value.roleId === revision.roleId
              && value.roleRevision === revision.revision)
            .map(value => value.simulationId)
            .sort(),
          evaluationRefs: [...new Set(sessionIds.flatMap(sessionId =>
            evaluationRefs.get(sessionId) ?? []))].sort(),
          costStatus: cost.status,
          ...(cost.status === 'ESTIMATED' ? { estimatedCostUsd: cost.value } : {}),
        },
      })
    }
    return result
  }

  private evaluationReferences(): ReadonlyMap<string, readonly string[]> {
    const rows = this.host.database.db.prepare(`
      SELECT dataset_hash, manifest_json
      FROM evaluation_dataset_manifests
      WHERE tenant_id = ?
      ORDER BY frozen_at DESC
    `).all(this.host.tenantId) as unknown as Array<{
      readonly dataset_hash: string
      readonly manifest_json: string
    }>
    const refs = new Map<string, string[]>()
    for (const row of rows) {
      let manifest: Record<string, unknown>
      try {
        manifest = recordOrEmpty(JSON.parse(row.manifest_json) as unknown)
      } catch {
        continue
      }
      const sessions = Array.isArray(manifest.includedSessions)
        ? manifest.includedSessions
        : []
      for (const candidate of sessions) {
        const sessionId = String(recordOrEmpty(candidate).sessionId ?? '')
        if (sessionId === '') continue
        const list = refs.get(sessionId) ?? []
        list.push(`evaluation-dataset:${row.dataset_hash}`)
        refs.set(sessionId, list)
      }
    }
    return refs
  }
}

function minimalJsonValue(schema: unknown, hint: string): unknown {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return {}
  const value = schema as Record<string, unknown>
  if (Array.isArray(value.oneOf) && value.oneOf.length > 0) {
    return minimalJsonValue(value.oneOf[0], hint)
  }
  if ('const' in value) return value.const
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0]
  switch (value.type) {
    case 'object': {
      const properties = recordOrEmpty(value.properties)
      const required = Array.isArray(value.required)
        ? value.required.filter((key): key is string => typeof key === 'string')
        : []
      return Object.fromEntries(required.map(key => [
        key,
        minimalJsonValue(properties[key], `${hint}.${key}`),
      ]))
    }
    case 'array': {
      const count = Number.isSafeInteger(value.minItems) ? Math.max(0, Number(value.minItems)) : 0
      return Array.from({ length: count }, () => minimalJsonValue(value.items, `${hint}[]`))
    }
    case 'string': {
      const minimum = Number.isSafeInteger(value.minLength) ? Math.max(1, Number(value.minLength)) : 1
      const seed = stringSeed(hint)
      return seed.length >= minimum
        ? seed
        : `${seed}${'x'.repeat(minimum - seed.length)}`
    }
    case 'integer':
      return Number.isFinite(value.minimum) ? Math.ceil(Number(value.minimum)) : 0
    case 'number':
      return Number.isFinite(value.minimum) ? Number(value.minimum) : 0
    case 'boolean':
      return false
    case 'null':
      return null
    default:
      return {}
  }
}

function stringSeed(hint: string): string {
  const lower = hint.toLowerCase()
  if (lower.includes('path')) return 'README.md'
  if (lower.includes('idempotency')) return 'canary-idempotency-key'
  if (lower.endsWith('id') || lower.includes('.id')) return 'canary-id'
  if (lower.includes('hash')) return '0'.repeat(64)
  if (lower.includes('time') || lower.includes('at')) return '2026-08-26T00:00:00.000Z'
  if (lower.includes('content') || lower.includes('text')) return '只读合同模拟内容'
  return 'canary'
}

function preferredFirstTool(contracts: readonly ToolContract[]): ToolContract | undefined {
  const preferred = [
    'military_status',
    'military_get_order',
    'read',
    'grep',
    'glob',
    'military_get_context',
  ]
  return preferred
    .map(name => contracts.find(value => value.schema.name === name))
    .find((value): value is ToolContract => value !== undefined)
    ?? contracts.find(value => !value.summary.terminal)
}

function preferredTerminalTool(
  contracts: readonly ToolContract[],
  roleId: string,
): ToolContract | undefined {
  const preferred = roleId === 'engineer-default'
    ? ['military_specs_apply_order']
    : roleId === 'worker-default'
      ? ['military_submit_candidate', 'military_submit_blocker']
      : roleId === 'inspector-default'
        ? ['military_submit_inspection']
        : roleId === GENERAL_ROLE_ID
          ? ['military_status']
          : ['military_staff_issue_guidance', 'military_submit_research_artifact', 'report']
  return preferred
    .map(name => contracts.find(value => value.schema.name === name))
    .find((value): value is ToolContract => value !== undefined)
    ?? contracts.find(value => value.summary.terminal)
}

function statusForRoute(
  models: readonly MilitaryModelCatalogEntry[],
  provider: string,
  model: string,
): MilitaryModelValidationStatus {
  return models.find(value => value.provider === provider && value.model === model)?.status
    ?? 'UNAVAILABLE'
}

function latestRoleRevision(
  history: readonly { readonly roleId: string; readonly revision: number }[],
  roleId: string,
): number {
  return history
    .filter(value => value.roleId === roleId)
    .reduce((maximum, value) => Math.max(maximum, value.revision), 0)
}

function exactModel(
  models: readonly MilitaryModelCatalogEntry[],
  provider: string,
  model: string,
): MilitaryModelCatalogEntry {
  const value = models.find(candidate =>
    candidate.provider === provider && candidate.model === model)
  if (value === undefined) throw new TypeError(`unknown DSH model route ${provider}/${model}`)
  return value
}

function assertDraftFitsModel(
  draft: RoleDraft,
  model: MilitaryModelCatalogEntry,
): void {
  // reasoningEffort is Military's logical workload intent. At the live
  // request boundary it is translated to the adapter's exact opaque effort
  // vocabulary, or omitted for models without a reasoning control.
  if (
    model.contextWindowTokens !== undefined
    && draft.contextBudgetTokens > model.contextWindowTokens
  ) {
    throw new TypeError(
      `${model.exactRoute} 的上下文窗口为 ${model.contextWindowTokens} tokens，`
      + `不能保存 ${draft.contextBudgetTokens} tokens 的角色上下文预算`,
    )
  }
  if (
    model.maxOutputTokens !== undefined
    && draft.maxOutputTokens > model.maxOutputTokens
  ) {
    throw new TypeError(
      `${model.exactRoute} 的最大输出为 ${model.maxOutputTokens} tokens，`
      + `不能保存 ${draft.maxOutputTokens} tokens 的角色输出预算`,
    )
  }
}

export function createSimplifiedChineseReviewReceipt(
  value: unknown,
  resultPrompt: string,
  source: 'USER_SAVE' | 'IMPORT' | 'ROLLBACK',
  confirmedAt = new Date().toISOString(),
): SimplifiedChineseReviewReceipt {
  const resultLint = lintSimplifiedChinese(resultPrompt)
  if (value === undefined) {
    if (source === 'USER_SAVE' && resultLint.issues.length > 0) {
      throw new TypeError(
        `角色提示词仍有 ${resultLint.issues.length} 个简体中文检查项；`
        + '请逐项应用建议，或明确确认保留后再保存',
      )
    }
    return {
      mode: source === 'USER_SAVE' ? 'NO_FINDINGS' : 'NOT_USER_REVIEWED',
      reviewedByUser: source === 'USER_SAVE',
      sourceHash: sha256Text(resultPrompt),
      resultHash: sha256Text(resultPrompt),
      confirmedStarts: [],
      appliedCount: 0,
      remainingCount: resultLint.issues.length,
      confirmedAt,
    }
  }
  if (source !== 'USER_SAVE') {
    throw new TypeError('只有用户保存操作可以提交简体中文检查确认')
  }
  const review = record(value, 'SAVE_ROLE.lintReview')
  if (
    typeof review.sourcePrompt !== 'string'
    || review.sourcePrompt.length === 0
    || review.sourcePrompt.length > 12_000
  ) {
    throw new TypeError('SAVE_ROLE.lintReview.sourcePrompt 必须是 1 至 12000 字符')
  }
  const sourcePrompt = review.sourcePrompt
  if (!Array.isArray(review.confirmedStarts) || review.confirmedStarts.length > 512) {
    throw new TypeError('SAVE_ROLE.lintReview.confirmedStarts 必须是最多 512 项的数组')
  }
  const confirmedStarts = review.confirmedStarts.map((entry, index) =>
    integer(
      entry,
      0,
      Math.max(0, sourcePrompt.length - 1),
      `SAVE_ROLE.lintReview.confirmedStarts[${index}]`,
    ))
  if (new Set(confirmedStarts).size !== confirmedStarts.length) {
    throw new TypeError('SAVE_ROLE.lintReview.confirmedStarts 不能重复')
  }
  const sourceLint = lintSimplifiedChinese(sourcePrompt)
  const issueStarts = new Set(sourceLint.issues.map(issue => issue.start))
  const unknownStarts = confirmedStarts.filter(start => !issueStarts.has(start))
  if (unknownStarts.length > 0) {
    throw new TypeError(
      `SAVE_ROLE.lintReview 包含 Host 未识别的建议位置：${unknownStarts.join('、')}`,
    )
  }
  const computed = applySimplifiedChineseFixes(sourcePrompt, confirmedStarts)
  if (computed !== resultPrompt) {
    throw new TypeError('角色提示词与 Host 按已确认建议计算的结果不一致；请重新检查')
  }
  if (resultLint.issues.length > 0 && review.acknowledgeRemaining !== true) {
    throw new TypeError(
      `角色提示词仍有 ${resultLint.issues.length} 个检查项；必须明确确认保留`,
    )
  }
  return {
    mode: confirmedStarts.length > 0
      ? 'APPLIED_SELECTION'
      : resultLint.issues.length > 0
        ? 'ACKNOWLEDGED_WITH_FINDINGS'
        : 'NO_FINDINGS',
    reviewedByUser: true,
    sourceHash: sha256Text(sourcePrompt),
    resultHash: sha256Text(resultPrompt),
    confirmedStarts,
    appliedCount: confirmedStarts.length,
    remainingCount: resultLint.issues.length,
    confirmedAt,
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function modelCompatibility(
  value: Awaited<ReturnType<Context['llm']['resolveModelInfo']>> | undefined,
): { readonly compatible: boolean; readonly reason: string } {
  if (value === undefined) {
    return {
      compatible: true,
      reason: 'DSH adapter 已公开该模型；Military 使用安全的目录默认能力，绩效样本另行积累。',
    }
  }
  if (value.inputModalities !== undefined && !value.inputModalities.includes('text')) {
    return { compatible: false, reason: '模型未声明 text 输入能力。' }
  }
  const efforts = value.reasoning?.efforts.map(item => String(item.id))
  if (efforts !== undefined && !efforts.includes('high') && !efforts.includes('max')) {
    return { compatible: false, reason: '模型未声明 Military 所需的 high/max 推理强度。' }
  }
  if (value.context !== undefined && value.context.contextWindow < 4_096) {
    return { compatible: false, reason: '模型上下文窗口低于 Military 最小预算。' }
  }
  return {
    compatible: true,
    reason: 'DSH exact-route metadata 可用；绩效样本独立记录，不影响模型可用性。',
  }
}

function modelStatusRank(status: MilitaryModelValidationStatus): number {
  return {
    VALIDATED: 0,
    CANARY: 1,
    UNVERIFIED: 2,
    INCOMPATIBLE: 3,
    UNAVAILABLE: 4,
    DEPRECATED: 5,
  }[status]
}

function portableDrafts(value: unknown): readonly RoleDraft[] {
  const portable = typeof value === 'string' ? parsePortableJson(value) : value
  const object = record(portable, 'portable Military settings')
  if (object.schemaVersion !== MILITARY_CONTROL_SCHEMA_VERSION
    || object.kind !== 'dsh-military-portable-role-settings') {
    throw new TypeError('portable Military settings schema or kind is unsupported')
  }
  if (!Array.isArray(object.roles) || object.roles.length === 0 || object.roles.length > 12) {
    throw new TypeError('portable Military settings roles must contain 1 through 12 entries')
  }
  const drafts = object.roles.map((entry, index) => {
    const candidate = record(entry, `portable roles[${index}]`)
    const unexpected = Object.keys(candidate).filter(key => !PORTABLE_KEYS.has(key))
    if (unexpected.length > 0) {
      throw new TypeError(
        `portable roles[${index}] contains non-portable fields: ${unexpected.join(', ')}`,
      )
    }
    return roleDraftFromUnknown(candidate)
  })
  const ids = drafts.map(value => value.roleId)
  if (new Set(ids).size !== ids.length) throw new TypeError('portable roles contain duplicate roleId')
  return drafts
}

function parsePortableJson(value: string): unknown {
  if (Buffer.byteLength(value, 'utf8') > 512 * 1_024) {
    throw new TypeError('portable Military settings exceed 512 KiB')
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new TypeError('portable Military settings must be valid JSON')
  }
}

function role(
  roles: readonly PortableRoleConfiguration[],
  roleId: string,
): PortableRoleConfiguration {
  const value = roles.find(candidate => candidate.roleId === roleId)
  if (value === undefined) throw new TypeError(`unknown Military role ${roleId}`)
  return value
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asSessionPersistence(value: unknown): PersistenceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PersistenceLike>
  return typeof candidate.inspect === 'function'
    ? candidate as PersistenceLike
    : undefined
}

function text(value: unknown, at: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new TypeError(`${at} must be a non-empty string up to ${maximum} characters`)
  }
  return value.trim()
}

function identifier(value: unknown, at: string): string {
  const result = text(value, at, 128)
  if (!CONTROL_ACTION_PATTERN.test(result)) throw new TypeError(`${at} is invalid`)
  return result
}

function integer(value: unknown, minimum: number, maximum: number, at: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${at} must be an integer from ${minimum} through ${maximum}`)
  }
  return Number(value)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryControlPlane: MilitaryControlPlaneRemoteService
  }
}
