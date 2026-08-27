/**
 * @deprecated Evaluation authority lives in @dsh-military/core. This module is
 * retained only as a source-compatible import path for pre-v2 integrations.
 */
export {
  MilitaryEvaluationEngine,
  type EvaluationDataCollection,
  type EvaluationDataSource,
  type EvaluationObservation,
  type PerformanceNarrativeProvider,
} from '@dsh-military/core'

export type {
  EvaluationAttemptRecord as AgentAttemptMetric,
} from '@dsh-military/contracts'
