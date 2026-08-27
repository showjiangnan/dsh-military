import type {
  MilitaryAdministrativeLedger,
  MilitaryAgentExecutionBindings,
  MilitaryAgentTemplates,
  MilitaryArtifacts,
  MilitaryAuthorization,
  MilitaryBrainstorm,
  MilitaryChiefOfStaff,
  MilitaryCompatibility,
  MilitaryCompactionAttempts,
  MilitaryDecisionBrokerV2,
  MilitaryEvaluation,
  MilitaryEvaluationAppeals,
  MilitaryEvaluationDataset,
  MilitaryGeneralRouting,
  MilitaryIngestion,
  MilitaryIntegration,
  MilitaryKnowledgeSupplyChain,
  MilitaryMissionKernel,
  MilitaryObservedEvidence,
  MilitaryContextCompiler,
  MilitaryExecutionLifecycle,
  MilitaryExecutionRouter,
  MilitaryCapabilityGrants,
  MilitaryLedger,
  MilitaryPolicyRegistry,
  MilitaryProductionPlane,
  MilitaryPresetGenerations,
  MilitaryRadio,
  MilitaryResourceBudgets,
  MilitaryRuntime,
  MilitarySessionGate,
  MilitaryTags,
  MilitaryVerification,
  MilitaryWorkspaces,
} from '@dsh-military/contracts'
import type { OversightController } from '@dsh-military/core'

/**
 * Complete service graph exposed by the host plugin.  The interface deliberately
 * contains capabilities rather than implementation classes, so storage, model,
 * and transport providers can be replaced without changing Military tools.
 */
export interface MilitaryApplication {
  readonly production: MilitaryProductionPlane
  readonly ledger: MilitaryLedger
  readonly missionKernel: MilitaryMissionKernel
  readonly contextCompiler: MilitaryContextCompiler
  readonly executionLifecycle: MilitaryExecutionLifecycle
  readonly executionRouter: MilitaryExecutionRouter
  readonly capabilityGrants: MilitaryCapabilityGrants
  readonly administrativeLedger: MilitaryAdministrativeLedger
  readonly artifacts: MilitaryArtifacts
  readonly sessionGate: MilitarySessionGate
  readonly compatibility: MilitaryCompatibility
  readonly presetGenerations: MilitaryPresetGenerations
  readonly authorization: MilitaryAuthorization
  readonly policies: MilitaryPolicyRegistry
  readonly generalRouting: MilitaryGeneralRouting
  readonly templates: MilitaryAgentTemplates
  readonly executionBindings: MilitaryAgentExecutionBindings
  readonly resourceBudgets: MilitaryResourceBudgets
  readonly verification: MilitaryVerification
  readonly observedEvidence: MilitaryObservedEvidence
  readonly oversight: OversightController
  readonly radio: MilitaryRadio
  readonly decisionBroker: MilitaryDecisionBrokerV2
  readonly brainstorm: MilitaryBrainstorm
  readonly chiefOfStaff: MilitaryChiefOfStaff
  readonly tags: MilitaryTags
  readonly ingestion: MilitaryIngestion
  readonly knowledge: MilitaryKnowledgeSupplyChain
  readonly evaluationDataset: MilitaryEvaluationDataset
  readonly evaluation: MilitaryEvaluation
  readonly evaluationAppeals: MilitaryEvaluationAppeals
  readonly compactionAttempts: MilitaryCompactionAttempts
  readonly workspaces: MilitaryWorkspaces
  readonly integration: MilitaryIntegration
  readonly runtime: MilitaryRuntime
}

/** Validate that a manually assembled application has every mandatory seam. */
export function assertCompleteApplication(application: MilitaryApplication): MilitaryApplication {
  const keys = [
    'production', 'ledger', 'missionKernel', 'contextCompiler', 'executionLifecycle', 'executionRouter', 'capabilityGrants', 'administrativeLedger', 'artifacts', 'sessionGate', 'compatibility',
    'presetGenerations', 'authorization', 'policies', 'generalRouting', 'templates',
    'executionBindings', 'resourceBudgets', 'verification', 'observedEvidence', 'oversight', 'radio',
    'decisionBroker', 'brainstorm', 'chiefOfStaff', 'tags', 'ingestion', 'knowledge',
    'evaluationDataset', 'evaluation', 'evaluationAppeals', 'compactionAttempts',
    'workspaces', 'integration', 'runtime',
  ] as const satisfies readonly (keyof MilitaryApplication)[]
  for (const key of keys) {
    if (application[key] === undefined || application[key] === null) {
      throw new TypeError(`dsh-military application is missing capability ${key}`)
    }
  }
  return application
}
