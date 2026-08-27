import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionEvent,
  SessionHeader,
  SessionId as DshSessionId,
} from '@deepseek-ai/dsh-session'
import {
  GENERAL_ROLE_ID,
  MILITARY_CONTROL_SCHEMA_VERSION,
  applySimplifiedChineseFixes,
  lintSimplifiedChinese,
  type MilitaryModelCatalogEntry,
  type MilitaryModelValidationStatus,
  type PortableRoleConfiguration,
  type RoleDraft,
  type SimplifiedChineseReviewReceipt,
} from '@dsh-military/contracts'
import { roleDraftFromUnknown } from './role-workbench.js'
import {
  type ToolContract,
} from './role-readiness.js'

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

interface PersistenceLike {
  inspect(id: DshSessionId, signal?: AbortSignal): Promise<{
    readonly meta: SessionHeader
    readonly events: readonly SessionEvent[]
  }>
}

export function minimalJsonValue(schema: unknown, hint: string): unknown {
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

export function stringSeed(hint: string): string {
  const lower = hint.toLowerCase()
  if (lower.includes('path')) return 'README.md'
  if (lower.includes('idempotency')) return 'canary-idempotency-key'
  if (lower.endsWith('id') || lower.includes('.id')) return 'canary-id'
  if (lower.includes('hash')) return '0'.repeat(64)
  if (lower.includes('time') || lower.includes('at')) return '2026-08-26T00:00:00.000Z'
  if (lower.includes('content') || lower.includes('text')) return '只读合同模拟内容'
  return 'canary'
}

export function preferredFirstTool(contracts: readonly ToolContract[]): ToolContract | undefined {
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

export function preferredTerminalTool(
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

export function statusForRoute(
  models: readonly MilitaryModelCatalogEntry[],
  provider: string,
  model: string,
): MilitaryModelValidationStatus {
  return models.find(value => value.provider === provider && value.model === model)?.status
    ?? 'UNAVAILABLE'
}

export function requiredCapabilityProfileId(
  model: MilitaryModelCatalogEntry,
): string {
  if (model.capabilityProfileId === undefined
    || model.capabilityProfileId.trim() === '') {
    throw new TypeError(
      `${model.exactRoute} 缺少精确 capabilityProfileId，不能持久化运行配置`,
    )
  }
  return model.capabilityProfileId
}

export function requiredCapabilityProfileRevision(
  model: MilitaryModelCatalogEntry,
): number {
  if (model.capabilityProfileRevision === undefined
    || !Number.isSafeInteger(model.capabilityProfileRevision)
    || model.capabilityProfileRevision < 1) {
    throw new TypeError(
      `${model.exactRoute} 缺少精确 capabilityProfileRevision，不能持久化运行配置`,
    )
  }
  return model.capabilityProfileRevision
}

export function latestRoleRevision(
  history: readonly { readonly roleId: string; readonly revision: number }[],
  roleId: string,
): number {
  return history
    .filter(value => value.roleId === roleId)
    .reduce((maximum, value) => Math.max(maximum, value.revision), 0)
}

export function exactModel(
  models: readonly MilitaryModelCatalogEntry[],
  provider: string,
  model: string,
): MilitaryModelCatalogEntry {
  const value = models.find(candidate =>
    candidate.provider === provider && candidate.model === model)
  if (value === undefined) throw new TypeError(`unknown DSH model route ${provider}/${model}`)
  return value
}

export function assertDraftFitsModel(
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

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function modelCompatibility(
  value: Awaited<ReturnType<Context['llm']['resolveModelInfo']>> | undefined,
): { readonly compatible: boolean; readonly reason: string } {
  if (value === undefined) {
    return {
      compatible: true,
      reason: 'DSH adapter 已公开该模型，但上下文、推理、模态和工具发射能力尚未声明；可选择，执行证据单独记录。',
    }
  }
  if (value.inputModalities !== undefined && !value.inputModalities.includes('text')) {
    return { compatible: false, reason: '模型未声明 text 输入能力。' }
  }
  if (value.context !== undefined && value.context.contextWindow < 4_096) {
    return { compatible: false, reason: '模型上下文窗口低于 Military 最小预算。' }
  }
  return {
    compatible: true,
    reason: 'DSH exact-route 已声明部分能力；工具协议与绩效证据独立记录。',
  }
}

export function modelStatusRank(status: MilitaryModelValidationStatus): number {
  return {
    VALIDATED: 0,
    CANARY: 1,
    UNVERIFIED: 2,
    INCOMPATIBLE: 3,
    UNAVAILABLE: 4,
    DEPRECATED: 5,
  }[status]
}

export function portableDrafts(value: unknown): readonly RoleDraft[] {
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

export function parsePortableJson(value: string): unknown {
  if (Buffer.byteLength(value, 'utf8') > 512 * 1_024) {
    throw new TypeError('portable Military settings exceed 512 KiB')
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new TypeError('portable Military settings must be valid JSON')
  }
}

export function role(
  roles: readonly PortableRoleConfiguration[],
  roleId: string,
): PortableRoleConfiguration {
  const value = roles.find(candidate => candidate.roleId === roleId)
  if (value === undefined) throw new TypeError(`unknown Military role ${roleId}`)
  return value
}

export function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asSessionPersistence(value: unknown): PersistenceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PersistenceLike>
  return typeof candidate.inspect === 'function'
    ? candidate as PersistenceLike
    : undefined
}

export function text(value: unknown, at: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new TypeError(`${at} must be a non-empty string up to ${maximum} characters`)
  }
  return value.trim()
}

export function identifier(value: unknown, at: string): string {
  const result = text(value, at, 128)
  if (!CONTROL_ACTION_PATTERN.test(result)) throw new TypeError(`${at} is invalid`)
  return result
}

export function integer(value: unknown, minimum: number, maximum: number, at: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${at} must be an integer from ${minimum} through ${maximum}`)
  }
  return Number(value)
}
