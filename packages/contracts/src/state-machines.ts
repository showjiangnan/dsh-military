export const taskStates = [
  'CREATED', 'READY', 'LEASED', 'EXECUTING', 'CANDIDATE_SUBMITTED',
  'VERIFYING', 'REWORK', 'BLOCKED', 'GUIDANCE_PENDING', 'FROZEN',
  'ACCEPTED', 'CANCELLED', 'FAILED',
] as const
export type TaskState = typeof taskStates[number]

export const taskTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  CREATED: ['READY', 'CANCELLED'],
  READY: ['LEASED', 'CANCELLED'],
  LEASED: ['EXECUTING', 'READY', 'CANCELLED'],
  EXECUTING: ['READY', 'CANDIDATE_SUBMITTED', 'BLOCKED', 'FROZEN', 'CANCELLED', 'FAILED'],
  CANDIDATE_SUBMITTED: ['VERIFYING', 'FROZEN', 'CANCELLED'],
  VERIFYING: ['ACCEPTED', 'REWORK', 'BLOCKED', 'FROZEN', 'CANCELLED', 'FAILED'],
  // The existing Worker keeps its immutable lease while deterministic
  // verification requests a bounded correction, so a corrected Candidate can
  // be submitted directly without fabricating a lease-release/re-lease cycle.
  REWORK: ['READY', 'CANDIDATE_SUBMITTED', 'CANCELLED'],
  BLOCKED: ['GUIDANCE_PENDING', 'READY', 'CANCELLED', 'FAILED'],
  GUIDANCE_PENDING: ['READY', 'BLOCKED', 'CANCELLED'],
  FROZEN: ['READY', 'CANCELLED', 'FAILED'],
  ACCEPTED: [],
  CANCELLED: [],
  FAILED: [],
}

export const waveStates = [
  'DRAFT', 'READY', 'ACTIVE', 'BARRIER_PENDING', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const
export type WaveState = typeof waveStates[number]

export const tacticalLifecycle = [
  'DRAFT', 'SIMULATION', 'CANARY', 'TESTING', 'STABLE', 'QUARANTINED', 'DEPRECATED',
] as const
export type TacticalLifecycle = typeof tacticalLifecycle[number]

export const militarySessionStates = [
  'UNBOUND', 'BINDING', 'ACTIVE', 'QUARANTINED', 'CLOSING', 'CLOSED',
] as const
export type MilitarySessionState = typeof militarySessionStates[number]

export const tacticalTagStates = ['ACTIVE', 'PAUSED', 'DELETED'] as const
export type TacticalTagState = typeof tacticalTagStates[number]

export const ingestionStates = [
  'REQUESTED', 'SNAPSHOTTING', 'SCANNING', 'EXTRACTING', 'VALIDATING',
  'PENDING_REVIEW', 'APPROVED_AS_DRAFT', 'RETURNED', 'REJECTED', 'FAILED', 'CANCELLED',
] as const
export type IngestionState = typeof ingestionStates[number]

export const brainstormStates = [
  'OPEN', 'QUESTIONING', 'STAFF_REVIEW', 'SPECS_HANDOFF', 'COMPLETED', 'CANCELLED',
] as const
export type BrainstormState = typeof brainstormStates[number]

export const evaluationRunStates = [
  'DISCOVERING_SESSIONS', 'BUILDING_DATASET', 'EVALUATING_TEMPLATES',
  'SYNTHESIZING', 'VALIDATING_REPORT', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const
export type EvaluationRunState = typeof evaluationRunStates[number]

export const tacticalSufficiencyStates = [
  'SUFFICIENT', 'PARTIAL', 'INSUFFICIENT', 'CONFLICTED', 'UNKNOWN',
] as const
export type TacticalSufficiency = typeof tacticalSufficiencyStates[number]

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return taskTransitions[from].includes(to)
}


export const decisionBrokerStates = [
  'CREATED', 'QUEUED', 'PRESENTED', 'PARTIALLY_ANSWERED', 'ANSWERED',
  'EXPIRED', 'CANCELLED', 'SUPERSEDED', 'STALE', 'DELIVERY_FAILED',
] as const
export type DecisionBrokerState = typeof decisionBrokerStates[number]

export const presetResumeStates = [
  'MATCHED', 'ARCHIVE_REBOUND', 'QUARANTINED',
] as const
export type PresetResumeState = typeof presetResumeStates[number]

export const integrationStates = [
  'QUEUED', 'LEASED', 'APPLYING', 'REGRESSION', 'APPLIED',
  'CONFLICT', 'REGRESSION_FAILED', 'STALE', 'CANCELLED',
] as const
export type IntegrationState = typeof integrationStates[number]

export const bundleLifecycleStates = [
  'PLANNED', 'APPLYING', 'VALIDATING', 'SUCCEEDED', 'ROLLING_BACK',
  'ROLLED_BACK', 'FAILED',
] as const
export type BundleLifecycleState = typeof bundleLifecycleStates[number]

export const budgetReservationStates = [
  'RESERVED', 'SETTLED', 'EXPIRED', 'REVOKED', 'REJECTED',
] as const
export type BudgetReservationState = typeof budgetReservationStates[number]

export const budgetReservationTransitions: Readonly<Record<BudgetReservationState, readonly BudgetReservationState[]>> = {
  RESERVED: ['SETTLED', 'EXPIRED', 'REVOKED'],
  SETTLED: [],
  EXPIRED: [],
  REVOKED: [],
  REJECTED: [],
}

export const performanceAppealStates = [
  'SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'PARTIALLY_UPHELD', 'DENIED', 'WITHDRAWN',
] as const
export type PerformanceAppealState = typeof performanceAppealStates[number]

export const performanceAppealTransitions: Readonly<Record<PerformanceAppealState, readonly PerformanceAppealState[]>> = {
  SUBMITTED: ['UNDER_REVIEW', 'WITHDRAWN'],
  UNDER_REVIEW: ['UPHELD', 'PARTIALLY_UPHELD', 'DENIED', 'WITHDRAWN'],
  UPHELD: [],
  PARTIALLY_UPHELD: [],
  DENIED: [],
  WITHDRAWN: [],
}
