import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import {
  MilitaryError,
  TERMINAL_TOOL_NAMES,
  flashReadiness,
  resolveDepartmentRolePrompt,
  type AgentExecutionBinding,
  type AgentTemplateProfile,
  type FlashReadinessReport,
  type MilitaryModelValidationStatus,
  type PortableRoleConfiguration,
  type ToolSchemaSummary,
} from '@dsh-military/contracts'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'

export const DISPATCH_READINESS_NAMESPACE = 'military-role-dispatch-readiness'

export interface ToolContract {
  readonly schema: ToolSchema
  readonly summary: ToolSchemaSummary
}

export interface DispatchReadinessRecord {
  readonly schemaVersion: '1.0.0'
  readonly bindingId: string
  readonly roleId: string
  readonly provider: string
  readonly model: string
  readonly toolProfileRef: string
  readonly visibleTools: readonly string[]
  readonly report: FlashReadinessReport
  readonly checkedAt: string
}

/**
 * Resolve the exact Host tool schemas for one immutable profile. The RC.2
 * continuable-child `report` tool is scoped after child construction, so its
 * fixed upstream contract is represented explicitly when it is not yet in the
 * root registry.
 */
export async function roleToolContracts(
  ctx: Context,
  host: MilitaryHostRuntime,
  configuration: Pick<
    PortableRoleConfiguration,
    'toolProfileId' | 'toolProfileRevision'
  >,
  visibleNames?: readonly string[],
): Promise<readonly ToolContract[]> {
  const profile = await host.application.policies.toolProfile(
    configuration.toolProfileId,
    configuration.toolProfileRevision,
  )
  const denied = new Set(profile.denyTools)
  const admitted = new Set(profile.allowTools.filter(name => !denied.has(name)))
  const names = visibleNames === undefined
    ? [...admitted]
    : visibleNames.filter(name => admitted.has(name))
  // Prefer the exact schema snapshot contributed by the installed Military
  // preset. The Host plugin is a sibling Cordis scope and its unscoped
  // ToolRuntime view intentionally cannot observe preset-local definitions.
  const observed = host.roleToolSchemas()
  const schemas = new Map(
    (observed.length > 0 ? observed : ctx.tools.schemas())
      .map(value => [value.name, value]),
  )
  return names.map((name): ToolContract => {
    const scoped = name === 'report' ? reportToolSchema() : undefined
    const schema = schemas.get(name) ?? scoped ?? {
      name,
      description: 'Host 工具 Schema 当前不可用。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    }
    return {
      schema,
      summary: summarizeToolSchema(schema, schemas.has(name) || scoped !== undefined),
    }
  })
}

export function summarizeToolSchema(
  schema: ToolSchema,
  available: boolean,
): ToolSchemaSummary {
  const stats = schemaStats(schema.parameters)
  return {
    name: schema.name,
    available,
    propertyCount: stats.properties,
    requiredCount: stats.required,
    maximumDepth: stats.depth,
    schemaBytes: Buffer.byteLength(JSON.stringify(schema.parameters), 'utf8'),
    terminal: TERMINAL_TOOL_NAMES.has(schema.name),
  }
}

/**
 * Persist a deterministic readiness decision before a child reaches the paid
 * model boundary. Replaying the same immutable binding reuses the first
 * decision; a changed role/template produces a different binding.
 */
export async function assertDispatchFlashReady(input: {
  readonly ctx: Context
  readonly host: MilitaryHostRuntime
  readonly template: AgentTemplateProfile
  readonly binding: AgentExecutionBinding
  readonly visibleTools: readonly string[]
}): Promise<DispatchReadinessRecord> {
  const records = new SqliteStateRecords(input.host.database, input.host.tenantId)
  const existing = records.readSync<DispatchReadinessRecord>(
    DISPATCH_READINESS_NAMESPACE,
    input.binding.bindingId,
  )
  if (existing !== null) {
    assertNotBlocked(existing.report)
    return existing
  }
  const contracts = await roleToolContracts(
    input.ctx,
    input.host,
    {
      toolProfileId: input.binding.toolProfile.id,
      toolProfileRevision: Number(input.binding.toolProfile.revision),
    },
    input.visibleTools,
  )
  const modelStatus = await dispatchModelStatus(
    input.ctx,
    input.host,
    input.binding.provider,
    input.binding.model,
    input.binding.modelCapabilityProfileRevision,
  )
  const checkedAt = new Date().toISOString()
  const report = flashReadiness({
    roleId: String(input.template.templateId),
    prompt: resolveDepartmentRolePrompt(input.template),
    modelStatus,
    toolSchemas: contracts.map(value => value.summary),
    maxOutputTokens: input.template.modelPolicy.maxOutputTokens,
    contextBudgetTokens: input.template.contextPolicy.contextBudgetTokens,
  }, checkedAt)
  const record: DispatchReadinessRecord = {
    schemaVersion: '1.0.0',
    bindingId: input.binding.bindingId,
    roleId: String(input.template.templateId),
    provider: input.binding.provider,
    model: input.binding.model,
    toolProfileRef: `${input.binding.toolProfile.id}@${Number(input.binding.toolProfile.revision)}`,
    visibleTools: contracts.map(value => value.schema.name),
    report,
    checkedAt,
  }
  records.putSync(
    DISPATCH_READINESS_NAMESPACE,
    input.binding.bindingId,
    record,
    { createOnly: true },
  )
  assertNotBlocked(report)
  return record
}

async function dispatchModelStatus(
  ctx: Context,
  host: MilitaryHostRuntime,
  provider: string,
  model: string,
  revision?: number,
): Promise<MilitaryModelValidationStatus> {
  try {
    await ctx.llm.resolveModelInfo(provider, model)
  } catch {
    return 'UNAVAILABLE'
  }
  try {
    const profile = await host.application.policies.modelCapability(
      provider,
      model,
      revision,
    )
    return profile.status === 'VALIDATED'
      ? 'VALIDATED'
      : profile.status === 'CANARY'
        ? 'CANARY'
        : profile.status === 'DEPRECATED'
          ? 'DEPRECATED'
          : 'UNVERIFIED'
  } catch {
    return 'UNVERIFIED'
  }
}

function assertNotBlocked(report: FlashReadinessReport): void {
  if (report.disposition !== 'BLOCKED') return
  throw new MilitaryError(
    'POLICY_DENIED',
    `部门派遣被 Flash 就绪门阻断：${report.issues
      .filter(value => value.severity === 'ERROR')
      .map(value => `${value.code}: ${value.message}`)
      .join('；')}`,
  )
}

function reportToolSchema(): ToolSchema {
  return {
    name: 'report',
    description: '向直接父级发送一次自包含结果；该调用本身不扩大权限。',
    parameters: {
      type: 'object',
      properties: {
        output: {
          type: 'string',
          description: '供直接父级继续执行的自包含结果。',
        },
      },
      required: ['output'],
      additionalProperties: false,
    },
  }
}

function schemaStats(value: unknown): {
  readonly properties: number
  readonly required: number
  readonly depth: number
} {
  if (typeof value !== 'object' || value === null) {
    return { properties: 0, required: 0, depth: 0 }
  }
  if (Array.isArray(value)) {
    const children = value.map(schemaStats)
    return {
      properties: children.reduce((sum, item) => sum + item.properties, 0),
      required: children.reduce((sum, item) => sum + item.required, 0),
      depth: 1 + Math.max(0, ...children.map(item => item.depth)),
    }
  }
  const object = value as Record<string, unknown>
  const properties = recordOrEmpty(object.properties)
  const children = [
    ...Object.values(properties).map(schemaStats),
    ...(Array.isArray(object.oneOf) ? object.oneOf.map(schemaStats) : []),
    ...(object.items === undefined ? [] : [schemaStats(object.items)]),
  ]
  return {
    properties: Object.keys(properties).length
      + children.reduce((sum, item) => sum + item.properties, 0),
    required: (Array.isArray(object.required) ? object.required.length : 0)
      + children.reduce((sum, item) => sum + item.required, 0),
    depth: 1 + Math.max(0, ...children.map(item => item.depth)),
  }
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
