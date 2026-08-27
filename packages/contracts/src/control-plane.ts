import {
  ROLE_PROMPT_MAX_CHARS,
  validateRolePrompt,
} from './role-prompts.js'

export const MILITARY_CONTROL_SCHEMA_VERSION = '1.0.0' as const
export const GENERAL_ROLE_ID = 'general' as const

export type MilitaryModelValidationStatus =
  | 'VALIDATED'
  | 'CANARY'
  | 'UNVERIFIED'
  | 'INCOMPATIBLE'
  | 'UNAVAILABLE'
  | 'DEPRECATED'

export type RoleConfigurationSource =
  | 'BUNDLED'
  | 'USER_SAVE'
  | 'ROLLBACK'
  | 'IMPORT'

export interface PortableRoleConfiguration {
  readonly roleId: string
  readonly displayName: string
  readonly department: string
  readonly role: string
  readonly status: 'DRAFT' | 'CANARY' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: 'high' | 'max'
  readonly maxOutputTokens: number
  readonly contextBudgetTokens: number
  readonly concurrencyLimit: number
  /** Empty means “inherit the bundled Simplified-Chinese prompt”. */
  readonly promptOverride: string
  /** Underlying immutable template revision; General uses zero. */
  readonly templateRevision: number
  readonly toolProfileId: string
  readonly toolProfileRevision: number
  readonly permissionProfileId: string
  readonly permissionProfileRevision: number
  readonly modelCapabilityProfileId: string
  readonly allowCanaryModel: boolean
}

export interface RoleConfigurationRevision {
  readonly schemaVersion: typeof MILITARY_CONTROL_SCHEMA_VERSION
  readonly revision: number
  readonly workbenchRevision: number
  readonly roleId: string
  readonly source: RoleConfigurationSource
  readonly createdAt: string
  readonly configuration: PortableRoleConfiguration
  /** Exact head before this revision, retained for deterministic undo. */
  readonly previousConfiguration?: PortableRoleConfiguration
  readonly promptDiff: PromptDiffSummary
  readonly readiness: Pick<FlashReadinessReport, 'disposition' | 'score' | 'errorCount' | 'warningCount'>
  /** Full immutable report for revisions created by the governed workbench. */
  readonly readinessReport?: FlashReadinessReport
  readonly actor: 'web-user' | 'plugin-migration'
  readonly rollbackOfRevision?: number
  readonly simplifiedChineseReview?: SimplifiedChineseReviewReceipt
}

export interface RoleRevisionMetrics {
  readonly roleRevision: number
  readonly sessionIds: readonly string[]
  readonly modelRequests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly toolCalls: number
  readonly successfulToolCalls: number
  readonly failedToolCalls: number
  readonly successRate?: number
  readonly simulationIds: readonly string[]
  readonly evaluationRefs: readonly string[]
  readonly costStatus: 'PROVIDER_PRICING_UNAVAILABLE' | 'ESTIMATED'
  readonly estimatedCostUsd?: number
}

/**
 * One atomically persisted role-configuration document.
 *
 * Credentials, absolute workspace paths, live grants, receipts, Session ids,
 * and provider responses are intentionally not representable here.
 */
export interface RoleWorkbenchDocument {
  readonly schemaVersion: typeof MILITARY_CONTROL_SCHEMA_VERSION
  readonly revision: number
  readonly roles: readonly PortableRoleConfiguration[]
  readonly history: readonly RoleConfigurationRevision[]
  readonly updatedAt: string
}

export interface RoleDraft {
  readonly roleId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: 'high' | 'max'
  readonly maxOutputTokens: number
  readonly contextBudgetTokens: number
  readonly concurrencyLimit: number
  readonly prompt: string
}

export interface MilitaryModelCatalogEntry {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  readonly description?: string
  readonly status: MilitaryModelValidationStatus
  readonly statusReason: string
  readonly capabilityProfileId?: string
  readonly supportedReasoning: readonly string[]
  readonly contextWindowTokens?: number
  readonly maxOutputTokens?: number
  readonly toolCalling: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN'
  readonly inputModalities: readonly string[]
  readonly available: boolean
  readonly selectable: boolean
  readonly exactRoute: string
  /** RC.2 exposes exact routes; aliases remain empty unless an adapter proves them. */
  readonly aliases?: readonly string[]
  readonly evidence: readonly string[]
  readonly statusRevision?: number
  readonly statusChangedAt?: string
  readonly pricing: {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE'
    readonly currency: 'USD'
    readonly inputPerMillionTokens?: number
    readonly outputPerMillionTokens?: number
    readonly observedAt?: string
  }
}

export type EffectivePromptLayerId =
  | 'editable-guidance'
  | 'host-authority'
  | 'tool-surface'
  | 'workspace'
  | 'evidence'
  | 'runtime'

export interface EffectivePromptLayer {
  readonly id: EffectivePromptLayerId
  readonly label: string
  readonly editable: boolean
  readonly runtimeBound: boolean
  readonly text: string
  readonly estimatedTokens: number
  readonly estimatedChineseCharacters: number
}

export interface EffectivePromptPreview {
  readonly schemaVersion: typeof MILITARY_CONTROL_SCHEMA_VERSION
  readonly roleId: string
  readonly layers: readonly EffectivePromptLayer[]
  readonly text: string
  readonly estimatedTokens: number
  readonly estimatedChineseCharacters: number
}

export interface CompileEffectivePromptInput {
  readonly roleId: string
  readonly rolePrompt: string
  readonly displayName: string
  readonly templateRevision: number
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: 'off' | 'low' | 'high' | 'max'
  readonly maxOutputTokens: number
  readonly contextBudgetTokens: number
  readonly toolNames: readonly string[]
  readonly permissionProfileId: string
  readonly bindingId?: string
  readonly capabilityGrantId?: string
  readonly workspaceRoot?: string
}

export type PromptDiffKind = 'UNCHANGED' | 'ADDED' | 'REMOVED'

export interface PromptDiffLine {
  readonly kind: PromptDiffKind
  readonly beforeLine?: number
  readonly afterLine?: number
  readonly text: string
}

export interface PromptDiffSummary {
  readonly addedLines: number
  readonly removedLines: number
  readonly unchangedLines: number
  readonly lines: readonly PromptDiffLine[]
}

export type FlashReadinessIssueSeverity = 'ERROR' | 'WARNING' | 'INFO'

export interface FlashReadinessIssue {
  readonly code: string
  readonly severity: FlashReadinessIssueSeverity
  readonly message: string
  readonly suggestion: string
  readonly field: 'prompt' | 'model' | 'tools' | 'workspace' | 'runtime'
  readonly start?: number
  readonly end?: number
}

export interface ToolSchemaSummary {
  readonly name: string
  readonly available: boolean
  readonly propertyCount: number
  readonly requiredCount: number
  readonly maximumDepth: number
  readonly schemaBytes: number
  readonly terminal: boolean
}

export interface FlashReadinessInput {
  readonly roleId: string
  readonly prompt: string
  readonly modelStatus: MilitaryModelValidationStatus
  readonly toolSchemas: readonly ToolSchemaSummary[]
  readonly maxOutputTokens: number
  readonly contextBudgetTokens: number
}

export interface FlashReadinessReport {
  readonly schemaVersion: typeof MILITARY_CONTROL_SCHEMA_VERSION
  readonly disposition: 'READY' | 'REVIEW' | 'BLOCKED'
  readonly score: number
  readonly errorCount: number
  readonly warningCount: number
  readonly issues: readonly FlashReadinessIssue[]
  readonly checkedAt: string
}

export interface SimplifiedChineseLintIssue {
  readonly code: 'TRADITIONAL_CHARACTER'
  readonly start: number
  readonly end: number
  readonly original: string
  readonly replacement: string
  readonly message: string
}

export interface SimplifiedChineseLintReport {
  readonly issues: readonly SimplifiedChineseLintIssue[]
  readonly checkedCharacters: number
  readonly skippedRanges: readonly { readonly start: number; readonly end: number; readonly reason: string }[]
}

export interface SimplifiedChineseReviewReceipt {
  readonly mode:
    | 'NO_FINDINGS'
    | 'APPLIED_SELECTION'
    | 'ACKNOWLEDGED_WITH_FINDINGS'
    | 'NOT_USER_REVIEWED'
  readonly reviewedByUser: boolean
  readonly sourceHash: string
  readonly resultHash: string
  readonly confirmedStarts: readonly number[]
  readonly appliedCount: number
  readonly remainingCount: number
  readonly confirmedAt: string
}

/**
 * Browser review intent. The Host recomputes every issue, replacement and
 * hash; callers cannot submit a pre-forged receipt.
 */
export interface SimplifiedChineseReviewInput {
  readonly sourcePrompt: string
  readonly confirmedStarts: readonly number[]
  readonly acknowledgeRemaining: boolean
}

export interface RoleSimulationStep {
  readonly id: 'TOOL_VISIBILITY' | 'FIRST_CALL' | 'SCHEMA_VALIDATION' | 'CORRECTION' | 'TERMINAL' | 'PARENT_RECEIPT'
  readonly status: 'PASSED' | 'FAILED' | 'SKIPPED'
  readonly message: string
  readonly toolName?: string
}

export interface RoleSimulationReport {
  readonly schemaVersion: typeof MILITARY_CONTROL_SCHEMA_VERSION
  readonly simulationId: string
  readonly roleId: string
  readonly workbenchRevision: number
  readonly roleRevision: number
  readonly toolProfileRef: string
  readonly modelStatus: MilitaryModelValidationStatus
  readonly mode: 'DETERMINISTIC' | 'LIVE_CANARY'
  readonly status: 'PASSED' | 'FAILED'
  readonly steps: readonly RoleSimulationStep[]
  readonly provider?: string
  readonly model?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly estimatedCostUsd?: number
  readonly costStatus: 'NOT_APPLICABLE' | 'ESTIMATED' | 'PROVIDER_PRICING_UNAVAILABLE'
  readonly latencyMs: number
  readonly rawToolChoice?: {
    readonly name: string
    readonly arguments: string
  }
  readonly normalizedArguments?: unknown
  readonly createdAt: string
}

export interface RoleWorkbenchRoleSnapshot {
  readonly configuration: PortableRoleConfiguration
  readonly bundledConfiguration: PortableRoleConfiguration
  readonly bundledPrompt: string
  readonly effectivePrompt: string
  readonly customPrompt: boolean
  readonly tools: readonly ToolSchemaSummary[]
  readonly preview: EffectivePromptPreview
  readonly readiness: FlashReadinessReport
  readonly history: readonly RoleConfigurationRevision[]
  readonly revisionMetrics: readonly RoleRevisionMetrics[]
  readonly simulations: readonly RoleSimulationReport[]
}

export type RoleBudgetPresetId = 'ECONOMY' | 'STANDARD' | 'DEEP' | 'CUSTOM'

export interface RoleBudgetPreset {
  readonly id: Exclude<RoleBudgetPresetId, 'CUSTOM'>
  readonly label: string
  readonly description: string
  readonly maxOutputTokens: number
  readonly contextBudgetTokens: number
  readonly concurrencyLimit: number
}

export const ROLE_BUDGET_PRESETS: readonly RoleBudgetPreset[] = Object.freeze([
  {
    id: 'ECONOMY',
    label: '经济',
    description: '适合边界清晰、工具面较小的主力 Flash 任务。',
    maxOutputTokens: 8_192,
    contextBudgetTokens: 64_000,
    concurrencyLimit: 2,
  },
  {
    id: 'STANDARD',
    label: '标准',
    description: '默认均衡预算；不改变验证、证据、权限或终止规则。',
    maxOutputTokens: 16_384,
    contextBudgetTokens: 128_000,
    concurrencyLimit: 4,
  },
  {
    id: 'DEEP',
    label: '深度',
    description: '为长上下文与复杂交付保留更多容量，费用风险更高。',
    maxOutputTokens: 32_768,
    contextBudgetTokens: 256_000,
    concurrencyLimit: 2,
  },
])

export function detectRoleBudgetPreset(
  draft: Pick<RoleDraft, 'maxOutputTokens' | 'contextBudgetTokens' | 'concurrencyLimit'>,
): RoleBudgetPresetId {
  return ROLE_BUDGET_PRESETS.find(value =>
    value.maxOutputTokens === draft.maxOutputTokens
    && value.contextBudgetTokens === draft.contextBudgetTokens
    && value.concurrencyLimit === draft.concurrencyLimit)?.id ?? 'CUSTOM'
}

export interface RoleWorkbenchSnapshot {
  readonly schemaVersion: typeof MILITARY_CONTROL_SCHEMA_VERSION
  readonly documentRevision: number
  readonly document: RoleWorkbenchDocument
  readonly roles: readonly RoleWorkbenchRoleSnapshot[]
  readonly models: readonly MilitaryModelCatalogEntry[]
  readonly generatedAt: string
}

export const TERMINAL_TOOL_NAMES = Object.freeze(new Set([
  'military_submit_candidate',
  'military_submit_blocker',
  'military_radio_request',
  'military_submit_decision_questions',
  'military_specs_apply_order',
  'military_radio_issue',
  'military_staff_issue_guidance',
  'military_submit_inspection',
  'military_submit_research_artifact',
  'report',
]))

/**
 * Compile the same six policy layers used by the Host persona assembly.
 * Runtime-only identifiers remain explicit placeholders in a settings preview.
 */
export function compileEffectivePrompt(input: CompileEffectivePromptInput): EffectivePromptPreview {
  const rolePrompt = validateRolePrompt(input.rolePrompt, `${input.displayName} 角色提示词`)
  const isGeneral = input.roleId === GENERAL_ROLE_ID
  const binding = input.bindingId ?? '＜运行时由 Host 注入＞'
  const grant = input.capabilityGrantId ?? '＜运行时由 Host 注入＞'
  const workspace = input.workspaceRoot ?? '＜任务执行绑定中的权威工作区＞'
  const exactTools = [...new Set(input.toolNames)].sort()
  const layers: EffectivePromptLayer[] = [
    layer('editable-guidance', '可编辑角色指导', true, false, rolePrompt),
    layer(
      'host-authority',
      'Host 身份与权限边界',
      false,
      !isGeneral,
      isGeneral
        ? [
            '以下运行边界由 Host 固定，角色提示词不能修改：',
            '用户是任务授权者；设置、模型输出和子智能体自述都不能扩大授权。',
            '不得扩大任务范围、权限、验收标准或 preset generation。',
          ].join('\n')
        : [
            '以下运行身份与权限边界由 Host 固定，角色提示词不能修改：',
            `模板：${input.roleId}@${input.templateRevision}；执行绑定：${binding}。`,
            `能力授权：${grant}；权限配置：${input.permissionProfileId}。`,
            '不得扩大任务范围、权限、验收标准或 preset generation。',
          ].join('\n'),
    ),
    layer(
      'tool-surface',
      '工具面与终态边界',
      false,
      false,
      [
        `本轮唯一可调用的工具名称：${exactTools.length === 0 ? '（无）' : exactTools.join('、')}。`,
        '只能使用请求头真实存在的工具；不得猜测名称、参数或 Host 字段。',
        '终态工具成功后立即停止，不得在同一响应继续调用或重复提交。',
      ].join('\n'),
    ),
    layer(
      'workspace',
      'Workspace 与路径边界',
      false,
      input.workspaceRoot === undefined,
      [
        `权威工作区：${workspace}。`,
        '只使用任务上下文给出的相对路径；不得猜测绝对路径、父目录、插件源码目录或主工作区。',
        '路径授权与 canonicalization 由 Host 判定，模型不得自行解释为已授权。',
      ].join('\n'),
    ),
    layer(
      'evidence',
      '证据与完成边界',
      false,
      false,
      [
        '关键事实和完成判断必须由工具回执、独立验证和 Military 权威账本支持。',
        '子智能体自述、文字计划或未经观察的命令输出不构成完成证据。',
        '证据缺失、状态漂移或权限拒绝时必须停止猜测并提交一次明确的阻塞或纠正请求。',
      ].join('\n'),
    ),
    layer(
      'runtime',
      '模型与运行预算',
      false,
      false,
      [
        `模型：${input.provider}/${input.model}；推理强度：${input.reasoningEffort}。`,
        `最大输出：${input.maxOutputTokens} tokens；上下文预算：${input.contextBudgetTokens} tokens。`,
        '预算变化不改变权限、验证强度、证据要求或安全门禁。',
      ].join('\n'),
    ),
  ]
  const text = layers.map(value => value.text).join('\n\n')
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    roleId: input.roleId,
    layers,
    text,
    estimatedTokens: estimateTokens(text),
    estimatedChineseCharacters: estimateChineseCharacters(text),
  }
}

export function flashReadiness(
  input: FlashReadinessInput,
  checkedAt = new Date().toISOString(),
): FlashReadinessReport {
  const issues: FlashReadinessIssue[] = []
  try {
    validateRolePrompt(input.prompt)
  } catch (error) {
    issues.push(issue(
      'PROMPT_INVALID',
      'ERROR',
      error instanceof Error ? error.message : String(error),
      '修正提示词后重新检查；不要通过缩短安全边界规避校验。',
      'prompt',
    ))
  }

  const lint = lintSimplifiedChinese(input.prompt)
  for (const value of lint.issues) {
    issues.push({
      code: value.code,
      severity: 'WARNING',
      message: value.message,
      suggestion: `确认语义后将“${value.original}”改为“${value.replacement}”。`,
      field: 'prompt',
      start: value.start,
      end: value.end,
    })
  }

  for (const pattern of HOST_FIELD_PATTERNS) {
    const match = pattern.expression.exec(input.prompt)
    if (match !== null) {
      issues.push({
        ...issue(
          pattern.code,
          'ERROR',
          pattern.message,
          '删除模型需要填写或猜测 Host 字段的要求；这些字段必须由 Host 注入。',
          'prompt',
        ),
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }
  for (const pattern of PATH_GUESS_PATTERNS) {
    const match = pattern.expression.exec(input.prompt)
    if (match !== null) {
      issues.push({
        ...issue(
          pattern.code,
          'ERROR',
          pattern.message,
          '改为只使用任务上下文中的权威工作区和已授权相对路径。',
          'workspace',
        ),
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }
  if (PERMISSION_WIDENING_PATTERN.test(input.prompt)) {
    issues.push(issue(
      'PROMPT_PERMISSION_WIDENING',
      'ERROR',
      '提示词包含绕过、任意访问或扩大权限的表述。',
      '删除该表述；权限只能来自 Host 的 PermissionProfile 与 Capability Grant。',
      'prompt',
    ))
  }
  if (!STOP_RULE_PATTERN.test(input.prompt)) {
    issues.push(issue(
      'PROMPT_STOP_RULE_MISSING',
      'ERROR',
      '提示词没有明确说明终态成功后立即停止。',
      '增加“一次终态提交成功后立即停止，不再调用其他工具”的明确规则。',
      'prompt',
    ))
  }
  if (!RECEIPT_RULE_PATTERN.test(input.prompt)) {
    issues.push(issue(
      'PROMPT_RECEIPT_RULE_WEAK',
      'WARNING',
      '提示词没有明确要求以工具回执或权威证据推进。',
      '明确要求读取 Host 回执，并禁止用文字自述替代执行结果。',
      'prompt',
    ))
  }

  const unavailable = input.toolSchemas.filter(schema => !schema.available)
  if (unavailable.length > 0) {
    issues.push(issue(
      'TOOL_UNAVAILABLE',
      'ERROR',
      `ToolProfile 中有 ${unavailable.length} 个工具未在 Host 合同中解析：${unavailable.map(value => value.name).join('、')}。`,
      '修复插件组合或 ToolProfile；不要让模型看到不存在的工具说明。',
      'tools',
    ))
  }
  if (input.toolSchemas.length === 0) {
    issues.push(issue(
      'TOOL_SURFACE_EMPTY',
      'ERROR',
      '角色没有可见工具，无法完成受治理流程。',
      '恢复插件自带 ToolProfile 或修复 Host 工具注册。',
      'tools',
    ))
  } else if (input.toolSchemas.length > 20) {
    issues.push(issue(
      'TOOL_SURFACE_TOO_WIDE',
      'WARNING',
      `角色一次可见 ${input.toolSchemas.length} 个工具，轻量模型首调用准确率可能下降。`,
      '按执行阶段收窄可见工具面，不要删除角色所需能力。',
      'tools',
    ))
  }
  const terminals = input.toolSchemas.filter(schema => schema.terminal)
  if (terminals.length === 0 && input.roleId !== GENERAL_ROLE_ID) {
    issues.push(issue(
      'TERMINAL_TOOL_MISSING',
      'ERROR',
      '角色工具面没有职责允许的终态工具。',
      '恢复该角色的终态提交或报告工具。',
      'tools',
    ))
  } else if (terminals.length > 2) {
    issues.push(issue(
      'TERMINAL_TOOL_AMBIGUOUS',
      'WARNING',
      `同时可见 ${terminals.length} 个终态工具：${terminals.map(value => value.name).join('、')}。`,
      '用阶段化工具面或角色提示明确每个状态唯一允许的终态动作。',
      'tools',
    ))
  }
  const complex = input.toolSchemas.filter(schema =>
    schema.maximumDepth > 4
    || schema.requiredCount > 12
    || schema.propertyCount > 28
    || schema.schemaBytes > 7_500)
  if (complex.length > 0) {
    issues.push(issue(
      'TOOL_SCHEMA_COMPLEX',
      'WARNING',
      `以下 Schema 超出轻量模型推荐预算：${complex.map(value => value.name).join('、')}。`,
      '使用浅层模型草稿，并由 Host 补全内部 ID、Hash、时间和权限字段。',
      'tools',
    ))
  }

  const promptTokens = estimateTokens(input.prompt)
  if (input.prompt.length > ROLE_PROMPT_MAX_CHARS || promptTokens > 3_500) {
    issues.push(issue(
      'PROMPT_TOO_LONG',
      'ERROR',
      `角色提示词约 ${promptTokens} tokens，超过轻量模型角色层预算。`,
      '把参考资料放入受治理 Skill/Context，仅保留职责、顺序、证据和停止规则。',
      'prompt',
    ))
  } else if (promptTokens > 1_800) {
    issues.push(issue(
      'PROMPT_LENGTH_WARNING',
      'WARNING',
      `角色提示词约 ${promptTokens} tokens，可能挤压轻量模型执行上下文。`,
      '删除重复说明，把扩展知识移动到按需召回层。',
      'prompt',
    ))
  }
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1_024) {
    issues.push(issue(
      'OUTPUT_BUDGET_INVALID',
      'ERROR',
      '最大输出 token 预算无效或过低。',
      '使用至少 1024 tokens 的整数预算，并保持 Host 硬上限。',
      'runtime',
    ))
  }
  if (!Number.isSafeInteger(input.contextBudgetTokens) || input.contextBudgetTokens < 4_096) {
    issues.push(issue(
      'CONTEXT_BUDGET_INVALID',
      'ERROR',
      '上下文预算无效或低于 Military 最小值。',
      '使用至少 4096 tokens 的整数预算。',
      'runtime',
    ))
  }
  if (input.modelStatus === 'UNAVAILABLE') {
    issues.push(issue(
      'MODEL_NOT_RUNNABLE',
      'ERROR',
      '所选模型不在当前 DSH live 目录中，不能进入执行。',
      '先在 DSH 中接入并启用该 Provider/model，再刷新 Military 模型目录。',
      'model',
    ))
  } else if (input.modelStatus === 'UNVERIFIED') {
    issues.push(issue(
      'MODEL_UNVERIFIED',
      'INFO',
      '该模型已由 DSH 接入，可以正常选择和执行；尚无 Military 绩效样本。',
      '绩效样本只影响评估结论，不影响模型可用性。',
      'model',
    ))
  } else if (input.modelStatus === 'CANARY') {
    issues.push(issue(
      'MODEL_CANARY',
      'INFO',
      '该模型已由 DSH 接入，可以正常选择和执行；Canary 只表示 Military 绩效样本仍在积累。',
      '绩效样本用于成本与质量评估，不作为模型可用性、保存或执行的前置门禁。',
      'model',
    ))
  } else if (
    input.modelStatus === 'INCOMPATIBLE'
    || input.modelStatus === 'DEPRECATED'
  ) {
    issues.push(issue(
      'MODEL_CATALOG_ADVISORY',
      'WARNING',
      `该模型已由 DSH 接入并保持可用；能力元数据状态为 ${input.modelStatus}。`,
      '保留当前可用性；实际 Provider 错误按 exact route 记录，不以历史标签阻断保存。',
      'model',
    ))
  }

  const errorCount = issues.filter(value => value.severity === 'ERROR').length
  const warningCount = issues.filter(value => value.severity === 'WARNING').length
  const score = Math.max(0, 100
    - errorCount * 25
    - warningCount * 7
    - issues.filter(value => value.severity === 'INFO').length)
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    disposition: errorCount > 0 ? 'BLOCKED' : warningCount > 0 ? 'REVIEW' : 'READY',
    score,
    errorCount,
    warningCount,
    issues,
    checkedAt,
  }
}

export function lintSimplifiedChinese(text: string): SimplifiedChineseLintReport {
  const skippedRanges = findSkippedNaturalLanguageRanges(text)
  const issues: SimplifiedChineseLintIssue[] = []
  let checkedCharacters = 0
  for (let index = 0; index < text.length; index += 1) {
    if (skippedRanges.some(range => index >= range.start && index < range.end)) continue
    checkedCharacters += 1
    const original = text[index]!
    const replacement = TRADITIONAL_TO_SIMPLIFIED[original]
    // The curated table may retain identity entries as lexical context. They
    // are not conversion findings and must never burden a user with a
    // meaningless “必 → 必” confirmation.
    if (replacement === undefined || replacement === original) continue
    issues.push({
      code: 'TRADITIONAL_CHARACTER',
      start: index,
      end: index + 1,
      original,
      replacement,
      message: `自然语言中疑似使用繁体字“${original}”。`,
    })
  }
  return { issues, checkedCharacters, skippedRanges }
}

export function applySimplifiedChineseFixes(
  text: string,
  acceptedStarts: readonly number[],
): string {
  const accepted = new Set(acceptedStarts)
  const report = lintSimplifiedChinese(text)
  // Lint locations are UTF-16 offsets because they address textarea
  // selections. Apply from right to left so astral symbols and multi-code-unit
  // replacements cannot shift any remaining location.
  let result = text
  for (const value of [...report.issues].reverse()) {
    if (!accepted.has(value.start)) continue
    result = `${result.slice(0, value.start)}${value.replacement}${result.slice(value.end)}`
  }
  return result
}

/** Bounded line LCS used by settings preview and immutable revision receipts. */
export function diffPrompt(before: string, after: string): PromptDiffSummary {
  const left = before.split('\n')
  const right = after.split('\n')
  const rows = left.length + 1
  const columns = right.length + 1
  const table = Array.from({ length: rows }, () => new Uint16Array(columns))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] = left[i] === right[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const lines: PromptDiffLine[] = []
  let beforeLine = 0
  let afterLine = 0
  while (beforeLine < left.length || afterLine < right.length) {
    if (
      beforeLine < left.length
      && afterLine < right.length
      && left[beforeLine] === right[afterLine]
    ) {
      lines.push({
        kind: 'UNCHANGED',
        beforeLine: beforeLine + 1,
        afterLine: afterLine + 1,
        text: left[beforeLine]!,
      })
      beforeLine += 1
      afterLine += 1
    } else if (
      afterLine < right.length
      && (beforeLine >= left.length
        || table[beforeLine]![afterLine + 1]! >= table[beforeLine + 1]![afterLine]!)
    ) {
      lines.push({ kind: 'ADDED', afterLine: afterLine + 1, text: right[afterLine]! })
      afterLine += 1
    } else {
      lines.push({ kind: 'REMOVED', beforeLine: beforeLine + 1, text: left[beforeLine]! })
      beforeLine += 1
    }
  }
  return {
    addedLines: lines.filter(value => value.kind === 'ADDED').length,
    removedLines: lines.filter(value => value.kind === 'REMOVED').length,
    unchangedLines: lines.filter(value => value.kind === 'UNCHANGED').length,
    lines,
  }
}

export function estimateTokens(text: string): number {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const other = Math.max(0, text.length - han)
  return Math.max(1, Math.ceil(han * 1.05 + other / 3.7))
}

export function estimateChineseCharacters(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0
}

export function estimateUsdCost(input: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly pricing: MilitaryModelCatalogEntry['pricing']
}): { readonly status: 'ESTIMATED'; readonly value: number } | {
  readonly status: 'PROVIDER_PRICING_UNAVAILABLE'
} {
  if (
    input.pricing.status !== 'AVAILABLE'
    || input.pricing.inputPerMillionTokens === undefined
    || input.pricing.outputPerMillionTokens === undefined
  ) {
    return { status: 'PROVIDER_PRICING_UNAVAILABLE' }
  }
  return {
    status: 'ESTIMATED',
    value: (
      input.inputTokens * input.pricing.inputPerMillionTokens
      + input.outputTokens * input.pricing.outputPerMillionTokens
    ) / 1_000_000,
  }
}

function layer(
  id: EffectivePromptLayerId,
  label: string,
  editable: boolean,
  runtimeBound: boolean,
  text: string,
): EffectivePromptLayer {
  return {
    id,
    label,
    editable,
    runtimeBound,
    text,
    estimatedTokens: estimateTokens(text),
    estimatedChineseCharacters: estimateChineseCharacters(text),
  }
}

function issue(
  code: string,
  severity: FlashReadinessIssueSeverity,
  message: string,
  suggestion: string,
  field: FlashReadinessIssue['field'],
): FlashReadinessIssue {
  return { code, severity, message, suggestion, field }
}

function findSkippedNaturalLanguageRanges(text: string): Array<{
  readonly start: number
  readonly end: number
  readonly reason: string
}> {
  const ranges: Array<{ start: number; end: number; reason: string }> = []
  const patterns: readonly { readonly expression: RegExp; readonly reason: string }[] = [
    { expression: /```[\s\S]*?```/gu, reason: 'fenced-code' },
    { expression: /`[^`\r\n]+`/gu, reason: 'inline-code' },
    { expression: /\{\{[^}\r\n]+\}\}/gu, reason: 'template-variable' },
    { expression: /(?:https?:\/\/|file:\/\/)[^\s)>\]]+/gu, reason: 'url' },
    {
      expression: /(?:^|[\s("'=])(?:\.{0,2}\/|~\/|\/)[A-Za-z0-9_@.+~/-]+/gmu,
      reason: 'path',
    },
    {
      expression: /\b(?:military|dsh|deepseek)_[A-Za-z0-9_.:-]+\b/gu,
      reason: 'tool-or-identifier',
    },
    {
      expression: /\b[A-Za-z_][A-Za-z0-9_]*(?:Id|Ref|Hash|Path|URL|Json)\b/gu,
      reason: 'technical-identifier',
    },
  ]
  for (const { expression, reason } of patterns) {
    for (const match of text.matchAll(expression)) {
      const start = (match.index ?? 0) + Math.max(0, match[0].search(/[^\s("'=]/u))
      ranges.push({ start, end: (match.index ?? 0) + match[0].length, reason })
    }
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  return ranges.filter((range, index) => (
    index === 0
    || range.start >= ranges[index - 1]!.end
    || range.end > ranges[index - 1]!.end
  ))
}

const HOST_FIELD_PATTERNS = [
  {
    code: 'HOST_FIELD_IN_EDITABLE_PROMPT',
    expression: /\b(?:bindingId|capabilityGrantId|authorityContextRef|receiptId|missionId|taskId|workspaceLeaseId)\b/u,
    message: '可编辑提示词要求模型处理 Host 内部字段或 ID。',
  },
  {
    code: 'HOST_ID_GUESSING',
    expression: /(?:猜测|生成|自行填写|自己填写).{0,16}(?:ID|Id|哈希|Hash|receipt|grant)/u,
    message: '可编辑提示词要求模型猜测或生成 Host 权威标识。',
  },
] as const

const PATH_GUESS_PATTERNS = [
  {
    code: 'ABSOLUTE_PATH_IN_PROMPT',
    expression: /(?:\/Users\/|\/home\/|[A-Za-z]:\\|file:\/\/)/u,
    message: '可编辑提示词硬编码了绝对路径。',
  },
  {
    code: 'PARENT_PATH_IN_PROMPT',
    expression: /(?:^|[\s"'`])\.\.(?:\/|\\)/mu,
    message: '可编辑提示词包含父目录路径。',
  },
  {
    code: 'HOME_PATH_IN_PROMPT',
    expression: /(?:^|[\s"'`])~\//mu,
    message: '可编辑提示词包含用户主目录缩写。',
  },
] as const

const PERMISSION_WIDENING_PATTERN = /(?:绕过|忽略|跳过).{0,12}(?:权限|授权|安全|验证)|(?:任意|所有).{0,8}(?:路径|文件|工具).{0,8}(?:访问|修改|调用)/u
const STOP_RULE_PATTERN = /(?:终态|提交|报告|回执).{0,28}(?:成功|完成).{0,20}(?:立即停止|停止|不再调用|不得继续)|(?:提交|报告).{0,32}(?:一次).{0,32}(?:立即停止|停止)|(?:成功回执).{0,20}(?:立即停止|停止)/u
const RECEIPT_RULE_PATTERN = /(?:工具回执|权威账本|执行证据|独立验证|工具证据)/u

const TRADITIONAL_TO_SIMPLIFIED: Readonly<Record<string, string>> = Object.freeze({
  體: '体', 總: '总', 為: '为', 與: '与', 這: '这', 個: '个', 們: '们', 來: '来',
  時: '时', 會: '会', 後: '后', 裡: '里', 裏: '里', 還: '还', 對: '对', 發: '发',
  實: '实', 應: '应', 當: '当', 進: '进', 過: '过', 從: '从', 將: '将', 於: '于',
  學: '学', 術: '术', 據: '据', 證: '证', 權: '权', 務: '务', 處: '处', 復: '复',
  寫: '写', 開: '开', 關: '关', 顯: '显', 設: '设', 選: '选', 擇: '择', 檔: '档',
  調: '调', 試: '试', 驗: '验', 認: '认', 較: '较', 僅: '仅', 讓: '让', 點: '点',
  擊: '击', 預: '预', 內: '内', 啟: '启', 動: '动', 執: '执', 階: '阶', 網: '网',
  頁: '页', 編: '编', 輯: '辑', 標: '标', 籤: '签', 評: '评', 績: '绩', 續: '续',
  導: '导', 護: '护', 擴: '扩', 確: '确', 專: '专', 業: '业', 必: '必', 須: '须',
  報: '报', 告: '告', 結: '结', 果: '果', 資: '资', 料: '料', 線: '线', 歷: '历',
  史: '史', 變: '变', 更: '更', 檢: '检', 查: '查', 異: '异', 常: '常', 類: '类',
  語: '语',
})
