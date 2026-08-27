import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  serializeToolErrorEnvelope,
  toolCorrectionShape,
  type ToolCorrectionShape,
} from '@dsh-military/core'
import type { MilitaryRole } from '@dsh-military/contracts'

export interface HostToolFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly nextTool: string
  readonly recovery: string
  readonly details?: unknown
  readonly correctedShape?: ToolCorrectionShape
}

/** Serialize a Host admission failure with the exact currently installed schema. */
export function hostToolFailure(
  agent: Agent | undefined,
  input: HostToolFailure,
): string {
  const { correctedShape, ...failure } = input
  return serializeToolErrorEnvelope({
    ...failure,
    correctedShape: correctedShape
      ?? installedToolCorrection(agent, input.nextTool),
  })
}

/** The one safe escalation action for each department role. */
export function roleRecoveryTool(role: MilitaryRole): string {
  switch (role) {
    case 'worker':
    case 'engineer':
      return 'military_submit_blocker'
    case 'advisor':
    case 'chief-of-staff':
      return 'military_staff_issue_guidance'
    case 'inspector':
      return 'military_submit_inspection'
    case 'trajectory':
    case 'effectiveness':
    case 'museum':
    case 'evaluation-examiner':
    case 'evaluation-chair':
      return 'military_submit_research_artifact'
    case 'general':
      return 'military_status'
    case 'harness':
      return 'WAIT_FOR_HOST'
  }
}

/**
 * Read the scoped RC.2 schema registry—the same immutable ToolProfile/Task
 * grant view used for prompt assembly.  A structural fallback is kept only
 * for narrow unit fixtures.
 */
export function installedToolCorrection(
  agent: Agent | undefined,
  tool: string,
): ToolCorrectionShape {
  if (agent === undefined || isHostDirective(tool)) {
    return toolCorrectionShape(tool)
  }
  const scoped = agent as unknown as {
    readonly ctx?: {
      readonly tools?: {
        schemas?(scope?: unknown): readonly {
          readonly name: string
          readonly parameters?: unknown
        }[]
      }
    }
  }
  const schemas = scoped.ctx?.tools?.schemas
  const schema = schemas?.call(scoped.ctx?.tools, agent)
    .find(value => value.name === tool)
  if (schema === undefined) return toolCorrectionShape(tool)
  return correctionFromJsonSchema(tool, schema.parameters)
}

export function correctionFromJsonSchema(
  tool: string,
  parameters: unknown,
): ToolCorrectionShape {
  const root = asRecord(parameters)
  const properties = asRecord(root.properties)
  const required = Array.isArray(root.required)
    ? root.required.filter((value): value is string => typeof value === 'string')
    : []
  const optional = Object.keys(properties)
    .filter(key => !required.includes(key))
  const args = Object.fromEntries(required.map(key => [
    key,
    jsonSchemaPlaceholder(key, properties[key]),
  ]))
  return toolCorrectionShape(tool, args, required, optional)
}

function jsonSchemaPlaceholder(key: string, value: unknown): unknown {
  const schema = asRecord(value)
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if ('default' in schema) return schema.default
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0]
  }
  const branches = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  if (branches !== undefined && branches.length > 0) {
    return jsonSchemaPlaceholder(key, branches[0])
  }
  switch (schema.type) {
    case 'string':
      if (/path|file|document/iu.test(key)) return 'project/relative/path'
      if (/id|key/iu.test(key)) return '<host-issued-id>'
      return `<${key}>`
    case 'number':
    case 'integer':
      return typeof schema.minimum === 'number' ? schema.minimum : 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object': {
      const properties = asRecord(schema.properties)
      const required = Array.isArray(schema.required)
        ? schema.required.filter((child): child is string => typeof child === 'string')
        : []
      return Object.fromEntries(required.map(child => [
        child,
        jsonSchemaPlaceholder(child, properties[child]),
      ]))
    }
    default:
      return `<${key}>`
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isHostDirective(tool: string): boolean {
  return tool === 'WAIT_FOR_NEXT_MESSAGE' || tool === 'WAIT_FOR_HOST'
}
