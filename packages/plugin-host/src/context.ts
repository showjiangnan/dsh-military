import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import type {
  AgentIdentity,
  AgentTemplateId,
  TaskId,
  MilitaryAdministrativeLedger,
  MilitaryAgentExecutionBindings,
  MilitaryAgentTemplates,
  MilitaryAuthorization,
  MilitaryBrainstorm,
  MilitaryChiefOfStaff,
  MilitaryCompactionAttempts,
  MilitaryCompatibility,
  MilitaryDecisionBrokerV2,
  MilitaryEvaluation,
  MilitaryEvaluationAppeals,
  MilitaryEvaluationDataset,
  MilitaryGeneralRouting,
  MilitaryIngestion,
  MilitaryKnowledgeSupplyChain,
  MilitaryMissionKernel, MilitaryContextCompiler, MilitaryExecutionRouter, MilitaryCapabilityGrants,
  MilitaryObservedEvidence,
  MilitaryLedger,
  MilitaryPolicyRegistry,
  MilitaryPresetGenerations,
  MilitaryRadio,
  MilitaryResourceBudgets,
  MilitaryRuntime,
  MilitarySessionGate,
  MilitaryTags,
  MilitaryVerification,
  MilitaryWebPrincipal,
} from '@dsh-military/contracts'
import type { InMemoryTacticalRegistry } from '@dsh-military/core'
import type {
  MilitaryApplication,
  MilitaryToolHostRuntime,
  SpecialDepartmentAutomation,
  SpawnedDepartmentAgent,
} from '@dsh-military/runtime'
import type {
  SqliteMilitaryDatabase,
  SqliteOutboxDispatcher,
} from '@dsh-military/storage-sqlite'
import type { Config } from './config.js'
import type { AgentIdentityDirectory } from './identity.js'
import type { MilitarySpecsControl } from './specs-control.js'

export interface MilitaryDepartmentAgentSpawnInput {
  readonly parent: Agent
  readonly templateId: AgentTemplateId
  readonly prompt: string
  readonly label: string
  /** Required when the chosen template is a Task-bound Worker or Engineer. */
  readonly taskId?: TaskId
  /** Durable internal dispatch key for event-driven special departments. */
  readonly idempotencyKey?: string
  readonly signal: AbortSignal
}

export interface MilitaryDepartmentAgentReportInput {
  /** Exact live continuable child authorizing the report. */
  readonly child: Agent
  readonly content: ContentBlock[]
  /** Both priorities wake/steer the parent; priority remains durable report metadata. */
  readonly priority?: 'ordinary' | 'critical'
  /** Stable terminal-artifact key; duplicate delivery returns the durable receipt. */
  readonly idempotencyKey?: string
  readonly signal: AbortSignal
}

export interface MilitaryDepartmentAgentDrainInput {
  /** Exact live direct parent authorizing selective teardown. */
  readonly parent: Agent
  readonly childSessionIds: readonly string[]
}

export interface MilitaryDepartmentAgents {
  spawn(input: MilitaryDepartmentAgentSpawnInput): Promise<SpawnedDepartmentAgent>
  report(input: MilitaryDepartmentAgentReportInput): Promise<string>
  drain(input: MilitaryDepartmentAgentDrainInput): Promise<void>
}

export interface MilitaryOversightSettings {
  readonly completionInterlockEnabled: boolean
  readonly freezeOnSecondMissingSubmission: boolean
  readonly requireObservedToolEvidence: boolean
  readonly maximumNoProgressTurns: number
}

/** Live, user-facing feature policy. Security invariants remain outside this mutable surface. */
export interface MilitaryFeatureSettings {
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

export interface MilitaryTerminalMutationInput<T> {
  /** Exact immutable caller identity; terminal state never crosses generations. */
  readonly identity: AgentIdentity
  /** Stable semantic action key derived before any mutation. */
  readonly actionKey: string
  /** Hash of the complete shallow model draft and immutable authority context. */
  readonly fingerprint: string
  /** Idempotent domain operation whose canonical result becomes the retry receipt. */
  readonly operation: () => Promise<T>
}

export interface MilitaryTerminalMutationReceipt<T> {
  readonly value: T
  readonly replayed: boolean
}

export interface MilitaryHostRuntime extends MilitaryToolHostRuntime {
  readonly tenantId: string
  readonly config: Config
  readonly application: MilitaryApplication
  readonly database: SqliteMilitaryDatabase
  readonly outbox: SqliteOutboxDispatcher
  readonly identities: AgentIdentityDirectory
  readonly tactics: InMemoryTacticalRegistry
  readonly specs: MilitarySpecsControl
  readonly departmentAgents: MilitaryDepartmentAgents
  readonly specialDepartments: SpecialDepartmentAutomation<Agent>
  /**
   * Trusted Host-attached authority for RC.2 Web remotes. This is explicitly
   * local single-user authority, not a fabricated request identity.
   */
  readonly webPrincipal: MilitaryWebPrincipal
  isMilitaryAgent(agent: Agent): boolean
  identity(agent: Agent): AgentIdentity
  identityFor(agent: Agent): Promise<AgentIdentity>
  ensureSessionBinding(agent: Agent): Promise<void>
  /** Record a DSH-owned continuable child for exact-parent teardown and workspace cleanup. */
  trackDepartmentChild(parent: Agent, childSessionId: string): void
  /** Forget a child after DSH has drained it and release Military-owned resources. */
  forgetDepartmentChild(childSessionId: string, reason?: string): Promise<void>
  /** Converge one user/policy-aborted Military Agent and every owned resource. */
  abortMilitaryAgent(agent: Agent, reason: string): Promise<void>
  oversightSettings(): MilitaryOversightSettings
  updateOversightSettings(settings: MilitaryOversightSettings): void
  /** Effective editable General guidance; immutable Host boundaries are separate. */
  generalRolePrompt(): string
  updateGeneralRolePrompt(prompt: string): void
  updatePrivateSkillExtractionSettings(settings: {
    readonly provider: string
    readonly model: string
    readonly maxOutputTokens: number
  }): void
  /**
   * Ensure one model exposed by the current DSH adapter catalog has a durable
   * runtime capability record. Availability comes from DSH catalog presence;
   * performance validation remains separate evaluation evidence.
   */
  ensureDshModelCapability(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<import('@dsh-military/contracts').ModelCapabilityProfile>
  /** Promote only exact-route tool protocol evidence produced by a live canary. */
  recordDshModelProtocolCanary(
    provider: string,
    model: string,
    passed: boolean,
    observedAt?: string,
  ): Promise<import('@dsh-military/contracts').ModelCapabilityProfile>
  /**
   * Snapshot the exact RC.2 preset-scoped tool schemas while the Military
   * agent plane is being composed. The Host plane cannot otherwise observe
   * tools registered in the sibling preset scope.
   */
  registerRoleToolSchemas(schemas: readonly ToolSchema[]): void
  /** Exact schemas most recently observed from the installed Military preset. */
  roleToolSchemas(): readonly ToolSchema[]
  featureSettings(): MilitaryFeatureSettings
  updateFeatureSettings(settings: Partial<{
    readonly radio: MilitaryFeatureSettings['radio']
    readonly staff: MilitaryFeatureSettings['staff']
    readonly tactics: MilitaryFeatureSettings['tactics']
    readonly memory: MilitaryFeatureSettings['memory']
    readonly specs: MilitaryFeatureSettings['specs']
  }>): void
  /**
   * Persist a terminal domain result before parent delivery. Exact retries
   * reuse this receipt and therefore never repeat file/Git/domain mutation.
   */
  runTerminalMutation<T>(
    input: MilitaryTerminalMutationInput<T>,
  ): Promise<MilitaryTerminalMutationReceipt<T>>
  readMutationReceipt<T>(
    identity: AgentIdentity,
    actionKey: string,
  ): { readonly fingerprint: string; readonly value: T } | null
  close(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryHost: MilitaryToolHostRuntime
    military: MilitaryRuntime
    militaryMissionKernel: MilitaryMissionKernel
    militaryContextCompiler: MilitaryContextCompiler
    militaryExecutionRouter: MilitaryExecutionRouter
    militaryCapabilityGrants: MilitaryCapabilityGrants
    militaryLedger: MilitaryLedger
    militaryAdministrativeLedger: MilitaryAdministrativeLedger
    militaryVerification: MilitaryVerification
    militaryObservedEvidence: MilitaryObservedEvidence
    militarySessionGate: MilitarySessionGate
    militaryRadio: MilitaryRadio
    militaryAgentTemplates: MilitaryAgentTemplates
    militaryTags: MilitaryTags
    militaryIngestion: MilitaryIngestion
    militaryDecisionBroker: MilitaryDecisionBrokerV2
    militaryBrainstorm: MilitaryBrainstorm
    militaryChiefOfStaff: MilitaryChiefOfStaff
    militaryEvaluation: MilitaryEvaluation
    militaryEvaluationDataset: MilitaryEvaluationDataset
    militaryEvaluationAppeals: MilitaryEvaluationAppeals
    militaryAuthorization: MilitaryAuthorization
    militaryPolicies: MilitaryPolicyRegistry
    militaryGeneralRouting: MilitaryGeneralRouting
    militaryPresetGenerations: MilitaryPresetGenerations
    militaryCompatibility: MilitaryCompatibility
    militaryKnowledge: MilitaryKnowledgeSupplyChain
    militaryExecutionBindings: MilitaryAgentExecutionBindings
    militaryResourceBudgets: MilitaryResourceBudgets
    militaryCompactionAttempts: MilitaryCompactionAttempts
    militaryAgentIdentities: AgentIdentityDirectory
    militaryDepartmentAgents: MilitaryDepartmentAgents
    militaryTactics: InMemoryTacticalRegistry
    militarySpecs: MilitarySpecsControl
  }
}

export function provideMilitaryServices(ctx: Context, host: MilitaryHostRuntime): () => void {
  const app = host.application
  const values: ReadonlyArray<readonly [string, unknown]> = [
    ['militaryHost', host], ['military', app.runtime], ['militaryMissionKernel', app.missionKernel],
    ['militaryContextCompiler', app.contextCompiler], ['militaryExecutionRouter', app.executionRouter],
    ['militaryCapabilityGrants', app.capabilityGrants], ['militaryLedger', app.ledger],
    ['militaryAdministrativeLedger', app.administrativeLedger], ['militaryVerification', app.verification],
    ['militaryObservedEvidence', app.observedEvidence],
    ['militarySessionGate', app.sessionGate], ['militaryRadio', app.radio], ['militaryAgentTemplates', app.templates],
    ['militaryTags', app.tags], ['militaryIngestion', app.ingestion], ['militaryDecisionBroker', app.decisionBroker],
    ['militaryBrainstorm', app.brainstorm], ['militaryChiefOfStaff', app.chiefOfStaff], ['militaryEvaluation', app.evaluation],
    ['militaryEvaluationDataset', app.evaluationDataset], ['militaryEvaluationAppeals', app.evaluationAppeals],
    ['militaryAuthorization', app.authorization], ['militaryPolicies', app.policies], ['militaryGeneralRouting', app.generalRouting],
    ['militaryPresetGenerations', app.presetGenerations], ['militaryCompatibility', app.compatibility],
    ['militaryKnowledge', app.knowledge], ['militaryExecutionBindings', app.executionBindings],
    ['militaryResourceBudgets', app.resourceBudgets], ['militaryCompactionAttempts', app.compactionAttempts],
    ['militaryAgentIdentities', host.identities], ['militaryDepartmentAgents', host.departmentAgents],
    ['militaryTactics', host.tactics], ['militarySpecs', host.specs],
  ]
  const disposers = values.map(([serviceName, value]) => ctx.provide(serviceName, value))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
