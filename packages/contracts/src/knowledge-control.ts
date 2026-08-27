import type {
  PrivateSkillOperationSnapshot,
} from './domain.js'
import type { TacticalLifecycle } from './state-machines.js'

export const MILITARY_KNOWLEDGE_CONTROL_SCHEMA_VERSION = '1.0.0' as const

export interface MilitarySanitizedTextPreview {
  readonly sha256: string
  readonly mediaType: string
  readonly byteLength: number
  readonly verified: boolean
  readonly text: string
  readonly truncated: boolean
}

export interface MilitaryPrivateSkillPipelineTransparency {
  readonly requestId: string
  readonly sourceHandle: string
  readonly snapshot?: {
    readonly contentHash: string
    readonly sanitized: MilitarySanitizedTextPreview
    readonly redactionReceipt: MilitarySanitizedTextPreview
  }
  readonly chunks: readonly {
    readonly chunkId: string
    readonly ordinal: number
    readonly startOffset: number
    readonly endOffset: number
    readonly contentHash: string
    readonly extractionState: string
    readonly attempts: number
    readonly extractorRoute?: {
      readonly mode: 'FLASH' | 'DETERMINISTIC_FALLBACK'
      readonly provider?: string
      readonly model?: string
    }
    readonly sanitized: MilitarySanitizedTextPreview
    readonly extraction?: MilitarySanitizedTextPreview
    readonly lastError?: string
  }[]
  readonly truncatedChunkCount: number
  readonly lineage: {
    readonly candidateId?: string
    readonly reviewReceiptIds: readonly string[]
    readonly skillVersions: readonly string[]
    readonly promotionReceiptIds: readonly string[]
    readonly usageIds: readonly string[]
    readonly revocationOrderIds: readonly string[]
    readonly inheritedSourceHandles: readonly string[]
  }
  readonly returnedInstructions: readonly string[]
}

export interface MilitaryRecallSimulationResult {
  readonly schemaVersion: typeof MILITARY_KNOWLEDGE_CONTROL_SCHEMA_VERSION
  readonly simulationId: string
  readonly textHash: string
  readonly inputCharacters: number
  readonly stateTokenBudget: number
  readonly matchedTagIds: readonly string[]
  readonly selected: readonly {
    readonly exactSkill: string
    readonly title: string
    readonly lifecycle: TacticalLifecycle
    readonly rank: number
    readonly matchedTagIds: readonly string[]
    readonly reasons: readonly string[]
  }[]
  readonly excluded: readonly {
    readonly exactSkill: string
    readonly title: string
    readonly lifecycle: TacticalLifecycle
    readonly matchedTagIds: readonly string[]
    readonly reasons: readonly string[]
  }[]
  /** Exact bytes the real Task context renderer would disclose. */
  readonly deliveryBlocks: readonly string[]
  readonly policy: {
    readonly tenantIsolation: 'CURRENT_HOST_TENANT'
    readonly includeTesting: boolean
    readonly maximumTagMatches: number
    readonly maximumCandidates: number
    readonly sourceRightsChecked: true
    readonly createsTask: false
  }
  readonly createdAt: string
}

export interface MilitaryKnowledgeCenterProjection {
  readonly operation: PrivateSkillOperationSnapshot
  readonly transparency: readonly MilitaryPrivateSkillPipelineTransparency[]
  readonly recallSimulations: readonly MilitaryRecallSimulationResult[]
}
