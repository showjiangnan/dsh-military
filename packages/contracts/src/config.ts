import type { EvaluationComparisonBaseline } from './domain.js'
import type { GeneralExecutionPolicy } from './governance.js'

/**
 * Root General model policy is delivered by the fixed military preset.
 * The preset default fills an unset route; a user selection in the DSH session
 * model UI wins and remains subject to capability, reasoning and residency gates.
 */
export type GeneralModelPolicy = GeneralExecutionPolicy

export interface MilitaryModelRoutingSettings {
  readonly provider?: 'deepseek-official'
  readonly model?: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  readonly reasoningEffort?: 'high' | 'max'
  readonly maxOutputTokens?: number
  /** Empty or absent selects the bundled Simplified Chinese General prompt. */
  readonly generalPromptOverride?: string
}

export interface DepartmentAgentTemplateSettings {
  /**
   * Versioned Host registry. The Military Settings client edits this through
   * model dropdowns and bounded controls; users never need to author JSON.
   */
  readonly profilesJson?: string
}

export interface MilitaryCoreSettings {
  readonly maxRadioAttempts?: number
  readonly radioLeaseSeconds?: number
}

export interface StaffSettings {
  readonly chiefOfStaffFallbackEnabled?: boolean
}

export interface TacticalTagSettings {
  /** Versioned tag registry managed by the visual tag editor. */
  readonly tagsJson?: string
}

export interface TacticsSettings {
  readonly candidateRecallMinimum?: number
  readonly candidateRecallMaximum?: number
  readonly allowCanaryDelivery?: boolean
}

export interface PrivateSkillSettings {
  readonly extractionProvider?: 'deepseek-official'
  readonly extractionModel?: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  readonly maxOutputTokens?: number
  readonly allowDeterministicFallback?: boolean
  readonly defaultVisibility?: 'user-private' | 'workspace-private' | 'organization-private'
  readonly defaultRetentionDays?: number
}

export interface OversightSettings {
  readonly completionInterlockEnabled?: boolean
  readonly freezeOnSecondMissingSubmission?: boolean
  readonly requireObservedToolEvidence?: boolean
  readonly maximumNoProgressTurns?: number
}

export interface SpecsSettings {
  readonly commitMessagePrefix?: string
}

export interface MemorySettings {
  readonly trajectoryAfterWave?: boolean
  readonly effectivenessAfterGeneralCompaction?: boolean
}

export interface EvaluationSettings {
  readonly minimumSampleSize?: number
  readonly includeIncompleteByDefault?: boolean
  readonly periodFrom?: string
  readonly periodTo?: string
  readonly templateIdsJson?: string
  readonly departmentsJson?: string
  readonly workspaceKeysJson?: string
  readonly missionIdsJson?: string
  readonly splitByRevision?: boolean
  readonly comparisonBaseline?: EvaluationComparisonBaseline
  readonly confidenceLevel?: 0.9 | 0.95 | 0.99
  readonly nonInferiorityMargin?: number
  readonly timeoutSeconds?: number
  readonly narrativeMode?: 'DETERMINISTIC' | 'COMMITTEE_MODEL'
  readonly reportClassification?: 'public' | 'internal' | 'confidential' | 'restricted'
  readonly examinerTemplateId?: string
  readonly chairTemplateId?: string
  readonly runNonce?: number
  readonly lastRunState?: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  readonly lastEvaluationRequestId?: string
  readonly lastDatasetHash?: string
  readonly lastReportId?: string
  /** @deprecated Reports are durable artifacts; retained only for migration. */
  readonly lastReportJson?: string
  readonly lastError?: string
}

export interface PresentationSettings {
  readonly terminology?: 'military' | 'neutral'
  readonly showAdvancedAudit?: boolean
  readonly compactEventCards?: boolean
}

/**
 * Exact namespace topology registered with DSH RC.2 Settings. Each field is
 * optional at the document boundary because the Host supplies validated
 * defaults. The independent Military Settings client owns all common edits;
 * security invariants and raw versioned registries are not free-form inputs.
 */
export interface MilitarySettingsDocument {
  readonly 'military-model-routing': MilitaryModelRoutingSettings
  readonly 'military-agent-templates': DepartmentAgentTemplateSettings
  readonly 'military-core': MilitaryCoreSettings
  readonly 'military-staff': StaffSettings
  readonly 'military-tags': TacticalTagSettings
  readonly 'military-tactics': TacticsSettings
  readonly 'military-private-skills': PrivateSkillSettings
  readonly 'military-oversight': OversightSettings
  readonly 'military-specs': SpecsSettings
  readonly 'military-memory': MemorySettings
  readonly 'military-evaluation': EvaluationSettings
  readonly 'military-presentation': PresentationSettings
}

export interface MilitaryConfig {
  /** Read from the immutable military preset generation, not Host settings. */
  readonly generalModel: GeneralModelPolicy
  readonly settings: MilitarySettingsDocument
}
