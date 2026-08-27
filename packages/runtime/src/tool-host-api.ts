import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import type {
  AgentIdentity,
  AgentTemplateId,
  IntegrationReceipt,
  TaskId,
} from '@dsh-military/contracts'
import type { InMemoryTacticalRegistry } from '@dsh-military/core'
import type {
  SpecsMaintenanceOrder,
  SpecsMaintenanceReceipt,
} from '@dsh-military/infrastructure'
import type { MilitaryApplication } from './application.js'

/**
 * Stable capability surface consumed by model-facing packages.
 *
 * It deliberately lives below plugin-host: tools and commands depend on
 * application capabilities, never on the concrete Cordis composition root,
 * SQLite class, settings implementation, or Web remotes.
 */
export interface MilitaryToolHostRuntime {
  readonly tenantId: string
  readonly application: MilitaryApplication
  readonly identities: MilitaryToolIdentityDirectory
  readonly tactics: InMemoryTacticalRegistry
  readonly specs: MilitaryToolSpecsControl
  readonly departmentAgents: MilitaryToolDepartmentAgents
  isMilitaryAgent(agent: Agent): boolean
  identity(agent: Agent): AgentIdentity
  identityFor(agent: Agent): Promise<AgentIdentity>
  ensureSessionBinding(agent: Agent): Promise<void>
  featureSettings(): MilitaryToolFeatureSettings
  registerRoleToolSchemas(schemas: readonly ToolSchema[]): void
  runTerminalMutation<T>(
    input: MilitaryToolTerminalMutationInput<T>,
  ): Promise<MilitaryToolTerminalMutationReceipt<T>>
  readMutationReceipt<T>(
    identity: AgentIdentity,
    actionKey: string,
  ): { readonly fingerprint: string; readonly value: T } | null
}

export interface MilitaryToolIdentityDirectory {
  get(sessionId: string): AgentIdentity | undefined
  require(agent: Agent): AgentIdentity
}

export interface MilitaryToolDepartmentAgents {
  spawn(input: {
    readonly parent: Agent
    readonly templateId: AgentTemplateId
    readonly prompt: string
    readonly label: string
    readonly taskId?: TaskId
    readonly idempotencyKey?: string
    readonly signal: AbortSignal
  }): Promise<unknown>
  report(input: {
    readonly child: Agent
    readonly content: ContentBlock[]
    readonly priority?: 'ordinary' | 'critical'
    readonly idempotencyKey?: string
    readonly signal: AbortSignal
  }): Promise<string>
  drain(input: {
    readonly parent: Agent
    readonly childSessionIds: readonly string[]
  }): Promise<void>
}

export interface MilitaryToolFeatureSettings {
  readonly radio: {
    readonly maxAttempts: number
    readonly leaseSeconds: number
  }
  readonly staff: {
    readonly chiefOfStaffFallbackEnabled: boolean
  }
  readonly tactics: {
    readonly candidateRecallMinimum: number
    readonly candidateRecallMaximum: number
    readonly allowCanaryDelivery: boolean
  }
  readonly memory: {
    readonly trajectoryAfterWave: boolean
    readonly effectivenessAfterGeneralCompaction: boolean
  }
  readonly specs: {
    readonly commitMessagePrefix: string
  }
}

export interface MilitaryToolSpecsControl {
  read(input: {
    readonly workspaceRoot: string
    readonly paths: readonly string[]
    readonly signal: AbortSignal
  }): Promise<{
    readonly root: string
    readonly files: Readonly<Record<string, string>>
    readonly missingPaths: readonly string[]
  }>
  apply(
    workspace: string,
    order: SpecsMaintenanceOrder,
    contentByDocument: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<unknown>
  recordIntegration(input: {
    readonly workspaceRoot: string
    readonly missionId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly verificationReceiptId: string
    readonly integration: IntegrationReceipt
    readonly signal: AbortSignal
  }): Promise<SpecsMaintenanceReceipt>
}

export interface MilitaryToolTerminalMutationInput<T> {
  readonly identity: AgentIdentity
  readonly actionKey: string
  readonly fingerprint: string
  readonly operation: () => Promise<T>
}

export interface MilitaryToolTerminalMutationReceipt<T> {
  readonly value: T
  readonly replayed: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryHost: MilitaryToolHostRuntime
  }
}

/** Fail with one explicit composition error instead of an undefined property. */
export function requireMilitaryToolHost(ctx: Context): MilitaryToolHostRuntime {
  const host = (ctx as Context & {
    readonly militaryHost?: MilitaryToolHostRuntime
  }).militaryHost
  if (host === undefined) {
    throw new Error('dsh-military stable Host capability is unavailable')
  }
  return host
}
