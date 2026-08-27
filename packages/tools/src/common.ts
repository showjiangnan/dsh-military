import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import {
  defineTool,
  type DefineToolOptions,
  type InferArgs,
  type ParameterSchemaSpec,
  type ToolDefinition,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import type {} from '@dsh-military/runtime'
import {
  MilitaryError,
  militaryErrorMetadata,
  type AgentIdentity,
  type MissionId,
  type MissionSnapshot,
  type TaskId,
  type TaskVersion,
} from '@dsh-military/contracts'
import {
  createMissionCommand,
  serializeToolErrorEnvelope,
  sha256,
  stableJson,
  toolCorrectionShape,
} from '@dsh-military/core'

export function text(value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

type JsonToolOptions<S extends ParameterSchemaSpec> =
  Omit<DefineToolOptions<S, { readonly type: 'json' }>, 'execute'>
  & {
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<unknown>
  }

/**
 * Define a tool whose domain result is snapshotted at the RC.2 JSON boundary.
 * Branded and readonly domain objects become the canonical JsonValue tree that
 * the DSH registry validates, records and renders.
 */
export function defineJsonTool<const S extends ParameterSchemaSpec>(options: JsonToolOptions<S>): ToolDefinition {
  const {
    execute,
    finalizeContent: userFinalizeContent,
    ...definition
  } = options
  const correction = correctionForParameterSpec(options.name, options.parameters)
  return defineTool({
    ...definition,
    async execute(args, exec) {
      let executed: unknown
      try {
        executed = await execute(args, exec)
      } catch (error) {
        if (!(error instanceof MilitaryError)) throw error
        const failure = error.failure
        throw new Error(serializeToolErrorEnvelope({
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          nextTool: options.name,
          correctedShape: correction,
          recovery: [
            militaryErrorMetadata[failure.code].recovery,
            `If correction is permitted, call only ${options.name} with the correctedShape; never resend identical arguments.`,
          ].join(' '),
          ...(failure.details === undefined ? {} : { details: failure.details }),
        }), { cause: error })
      }
      const value = snapshotJsonValue(executed)
      if (value === undefined) {
        throw new MilitaryError('INVALID_ARGUMENT', 'Military tool returned an undefined canonical value')
      }
      return value as JsonValue
    },
    finalizeContent(exec, result) {
      if (result.isError) {
        const existing = existingMilitaryEnvelope(result)
        if (existing !== undefined) return [{ type: 'text', text: existing }]
        const info = asSchemaRecord(result.error.info)
        const code = typeof info.code === 'string' ? info.code : 'TOOL_EXECUTION_FAILED'
        const invalidArguments = code === 'INVALID_ARGS'
          || /invalid arguments|is required|must be/iu.test(result.error.message)
        const nextTool = invalidArguments ? options.name : 'WAIT_FOR_HOST'
        return [{
          type: 'text',
          text: serializeToolErrorEnvelope({
            code: invalidArguments ? 'INVALID_ARGUMENT' : code,
            message: invalidArguments
              ? 'tool arguments do not match the installed schema'
              : result.error.message,
            retryable: false,
            nextTool,
            correctedShape: invalidArguments
              ? correction
              : toolCorrectionShape(nextTool),
            recovery: invalidArguments
              ? `Call only ${options.name} with correctedShape; do not resend identical arguments.`
              : 'Wait for a Host recovery receipt; do not repeat an operation whose outcome is unknown.',
          }),
        }]
      }
      return userFinalizeContent?.(exec, result)
    },
  })
}

function existingMilitaryEnvelope(
  result: Readonly<{ readonly content: readonly ContentBlock[] }>,
): string | undefined {
  for (const block of result.content) {
    if (block.type !== 'text') continue
    const source = block.text.startsWith('Error: ')
      ? block.text.slice('Error: '.length)
      : block.text
    try {
      const parsed = JSON.parse(source) as {
        readonly error?: {
          readonly code?: unknown
          readonly nextTool?: unknown
          readonly correctedShape?: unknown
        }
      }
      if (typeof parsed.error?.code === 'string'
        && typeof parsed.error.nextTool === 'string'
        && parsed.error.correctedShape !== undefined) return source
    } catch {
      // Non-Military upstream failure: normalize below.
    }
  }
  return undefined
}

/**
 * Compile an author-facing RC.2 parameter map into a bounded correction
 * example.  Required fields are concrete enough for a small model to copy,
 * while the optional list preserves discoverability without bloating the
 * retry payload.
 */
export function correctionForParameterSpec(
  tool: string,
  parameters: ParameterSchemaSpec,
): ReturnType<typeof toolCorrectionShape> {
  const entries = Object.entries(parameters)
  const required = entries
    .filter(([, value]) => value.required === true)
    .map(([key]) => key)
  const optional = entries
    .filter(([, value]) => value.required !== true)
    .map(([key]) => key)
  const args = Object.fromEntries(
    entries
      .filter(([, value]) => value.required === true)
      .map(([key, value]) => [
        key,
        parameterPlaceholder(key, asSchemaRecord(value)),
      ]),
  )
  return toolCorrectionShape(tool, args, required, optional)
}

function parameterPlaceholder(
  key: string,
  schema: Record<string, unknown>,
): unknown {
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if ('default' in schema) return schema.default
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0]
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return parameterPlaceholder(key, asSchemaRecord(schema.oneOf[0]))
  }
  switch (schema.type) {
    case 'string':
      if (/path|file|document/iu.test(key)) return 'project/relative/path'
      if (/id|key/iu.test(key)) return '<host-issued-id>'
      return `<${key}>`
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object': {
      const properties = asSchemaRecord(schema.properties)
      return Object.fromEntries(
        Object.entries(properties)
          .filter(([, value]) =>
            typeof value === 'object'
            && value !== null
            && (value as Record<string, unknown>).required === true)
          .map(([childKey, value]) => [
            childKey,
            parameterPlaceholder(childKey, asSchemaRecord(value)),
          ]),
      )
    }
    default:
      return `<${key}>`
  }
}

function asSchemaRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function registerTools(ctx: Context, tools: readonly ToolDefinition[]): () => void {
  const runtime = ctx.tools
  if (runtime === undefined) throw new Error('dsh-military tools require ctx.tools')
  const disposers = tools.map(tool => runtime.register(tool))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

export function requireCallingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new MilitaryError('UNAUTHORIZED', 'Military tool requires an Agent caller')
  return agent
}

export function identityFor(ctx: Context, agent: Agent): AgentIdentity {
  const directory = ctx.militaryHost.identities
  if (directory === undefined) throw new MilitaryError('MILITARY_PRESET_REQUIRED', 'Military identity directory is unavailable')
  return directory.require(agent)
}

export function requireRole(identity: AgentIdentity, roles: readonly AgentIdentity['role'][]): void {
  if (!roles.includes(identity.role)) throw new MilitaryError('UNAUTHORIZED', `role ${identity.role} cannot call this tool`)
}

export interface ParentTerminalReport {
  readonly state: 'DELIVERED' | 'NOT_APPLICABLE'
  readonly messageId?: string
}

/**
 * Fence a terminal domain mutation behind a durable Host receipt. Parent
 * delivery intentionally happens after this helper returns so a delivery retry
 * reuses the exact mutation result instead of touching files or domain state.
 */
export async function runDurableTerminalMutation<T>(
  ctx: Context,
  input: {
    readonly identity: AgentIdentity
    readonly actionKey: string
    readonly draft: unknown
    readonly operation: () => Promise<T>
  },
): Promise<{
  readonly value: T
  readonly replayed: boolean
}> {
  return await ctx.militaryHost.runTerminalMutation({
    identity: input.identity,
    actionKey: input.actionKey,
    fingerprint: sha256(stableJson(input.draft)),
    operation: input.operation,
  })
}

/**
 * Deliver one concise, Host-authored terminal receipt to a department Agent's
 * direct parent. A delivery failure fails the terminal call before it can
 * conclude the turn; retrying the same terminal draft is safe because the
 * stable key and each domain mutation are durable and idempotent.
 */
export async function reportTerminalOutcome(
  ctx: Context,
  agent: Agent,
  input: {
    readonly kind: string
    readonly idempotencyKey: string
    readonly summary: string
    readonly details?: Record<string, unknown>
    readonly priority?: 'ordinary' | 'critical'
    readonly signal: AbortSignal
  },
): Promise<ParentTerminalReport> {
  const identity = identityFor(ctx, agent)
  if (identity.role === 'general' || identity.role === 'harness') {
    return { state: 'NOT_APPLICABLE' }
  }
  const content: ContentBlock[] = [{
    type: 'text',
    text: JSON.stringify({
      militaryTerminalReceipt: {
        kind: input.kind,
        receiptKey: input.idempotencyKey,
        summary: input.summary,
        ...(input.details === undefined ? {} : { details: input.details }),
      },
    }),
  }]
  try {
    const messageId = await ctx.militaryHost.departmentAgents.report({
      child: agent,
      content,
      priority: input.priority ?? 'ordinary',
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
    })
    return { state: 'DELIVERED', messageId }
  } catch (error) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'terminal result is durable, but its parent receipt was not delivered; retry the identical terminal call once so the Host can reconcile and wake the parent',
      {
        terminalKind: input.kind,
        idempotencyKey: input.idempotencyKey,
        cause: error instanceof Error ? error.message : String(error),
      },
      { cause: error },
    )
  }
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MilitaryError('INVALID_ARGUMENT', `${label} must be an object`)
  return value as Record<string, unknown>
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new MilitaryError('INVALID_ARGUMENT', `${label} must be a non-empty string`)
  return value
}

export function asInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new MilitaryError('INVALID_ARGUMENT', `${label} must be a safe integer`)
  return value as number
}

export function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new MilitaryError('INVALID_ARGUMENT', `${label} must be a string array`)
  return [...value]
}

/** Convert the domain Map projection into a stable lossless-JSON tool value. */
export function missionSnapshotValue(snapshot: MissionSnapshot): {
  readonly missionId: string
  readonly revision: number
  readonly activeWaveIds: readonly string[]
  readonly tasks: readonly {
    readonly taskId: string
    readonly taskVersion: number
    readonly state: string
    readonly assignedAgent?: AgentIdentity
  }[]
} {
  return {
    missionId: String(snapshot.missionId),
    revision: Number(snapshot.revision),
    activeWaveIds: snapshot.activeWaveIds.map(String),
    tasks: [...snapshot.tasks.entries()]
      .map(([taskId, task]) => ({
        taskId: String(taskId),
        taskVersion: Number(task.taskVersion),
        state: task.state,
        ...(task.assignedAgent === undefined ? {} : { assignedAgent: task.assignedAgent }),
      }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
  }
}


/** Run one authoritative Mission mutation through the single-writer kernel. */
export async function runMissionCommand<T>(
  ctx: Context,
  input: {
    readonly identity: AgentIdentity
    readonly missionId: MissionId
    readonly type: string
    readonly payload: Record<string, unknown>
    readonly idempotencyKey: string
    readonly operation: () => Promise<T>
    readonly taskId?: TaskId
    readonly taskVersion?: TaskVersion
  },
): Promise<T> {
  const authorityContext = await ctx.militaryHost.application.authorization.resolve(
    String(input.identity.agentId),
    ctx.militaryHost.tenantId,
  )
  const authority = await ctx.militaryHost.application.authorization.authorize({
    context: authorityContext,
    action: `mission.command.${input.type}`,
    resource: input.taskId === undefined
      ? String(input.missionId)
      : `${String(input.missionId)}:${String(input.taskId)}@${Number(input.taskVersion ?? 0)}`,
    classification: 'internal',
  })
  if (!authority.allowed) {
    throw new MilitaryError(
      'UNAUTHORIZED',
      `mission command authority denied: ${authority.reason ?? 'no matching authority'}`,
    )
  }
  const snapshot = await ctx.militaryHost.application.ledger.readMission(input.missionId)
  const command = createMissionCommand({
    tenantId: ctx.militaryHost.tenantId, missionId: input.missionId, expectedRevision: snapshot.revision,
    actor: input.identity,
    actorAuthorityRef: authority.receiptRef ?? authorityContext.authorityContextId,
    type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.taskVersion === undefined ? {} : { taskVersion: input.taskVersion }),
    activationId: `${String(input.identity.agentId)}:${input.identity.generation}`,
  })
  const result = await ctx.militaryHost.application.missionKernel.execute(command, input.operation)
  return result.value
}
