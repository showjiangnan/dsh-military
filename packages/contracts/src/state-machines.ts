export const taskStates = [
  'CREATED', 'READY', 'LEASED', 'EXECUTING', 'CANDIDATE_SUBMITTED',
  'VERIFYING', 'WAITING_INTEGRATION', 'INTEGRATING', 'INTEGRATION_FAILED',
  'REWORK', 'BLOCKED', 'GUIDANCE_PENDING', 'WAITING_DECISION',
  'PAUSED', 'RECOVERY_REQUIRED', 'FROZEN',
  'ACCEPTED', 'CANCELLED', 'FAILED',
] as const
export type TaskState = typeof taskStates[number]

export const taskTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  CREATED: ['READY', 'CANCELLED'],
  READY: ['LEASED', 'PAUSED', 'CANCELLED'],
  LEASED: ['EXECUTING', 'READY', 'PAUSED', 'RECOVERY_REQUIRED', 'CANCELLED'],
  EXECUTING: ['READY', 'CANDIDATE_SUBMITTED', 'BLOCKED', 'WAITING_DECISION', 'PAUSED', 'RECOVERY_REQUIRED', 'FROZEN', 'CANCELLED', 'FAILED'],
  CANDIDATE_SUBMITTED: ['VERIFYING', 'PAUSED', 'RECOVERY_REQUIRED', 'FROZEN', 'CANCELLED'],
  VERIFYING: ['WAITING_INTEGRATION', 'ACCEPTED', 'REWORK', 'BLOCKED', 'PAUSED', 'RECOVERY_REQUIRED', 'FROZEN', 'CANCELLED', 'FAILED'],
  WAITING_INTEGRATION: ['INTEGRATING', 'ACCEPTED', 'REWORK', 'PAUSED', 'RECOVERY_REQUIRED', 'CANCELLED', 'FAILED'],
  INTEGRATING: ['ACCEPTED', 'INTEGRATION_FAILED', 'RECOVERY_REQUIRED', 'CANCELLED', 'FAILED'],
  INTEGRATION_FAILED: ['REWORK', 'READY', 'PAUSED', 'CANCELLED', 'FAILED'],
  // The existing Worker keeps its immutable lease while deterministic
  // verification requests a bounded correction, so a corrected Candidate can
  // be submitted directly without fabricating a lease-release/re-lease cycle.
  REWORK: ['READY', 'CANDIDATE_SUBMITTED', 'PAUSED', 'RECOVERY_REQUIRED', 'CANCELLED'],
  BLOCKED: ['GUIDANCE_PENDING', 'WAITING_DECISION', 'READY', 'PAUSED', 'RECOVERY_REQUIRED', 'CANCELLED', 'FAILED'],
  GUIDANCE_PENDING: ['READY', 'BLOCKED', 'PAUSED', 'RECOVERY_REQUIRED', 'CANCELLED'],
  WAITING_DECISION: ['READY', 'BLOCKED', 'PAUSED', 'RECOVERY_REQUIRED', 'CANCELLED', 'FAILED'],
  PAUSED: ['READY', 'CANCELLED', 'FAILED'],
  RECOVERY_REQUIRED: ['READY', 'PAUSED', 'CANCELLED', 'FAILED'],
  FROZEN: ['READY', 'CANCELLED', 'FAILED'],
  ACCEPTED: [],
  CANCELLED: [],
  FAILED: [],
}

export const waveStates = [
  'DRAFT', 'READY', 'ACTIVE', 'BARRIER_PENDING', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const
export type WaveState = typeof waveStates[number]

export const waveTransitions: Readonly<
  Record<WaveState, readonly WaveState[]>
> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['ACTIVE', 'FAILED', 'CANCELLED'],
  ACTIVE: ['BARRIER_PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  BARRIER_PENDING: ['ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
}

export const tacticalLifecycle = [
  'DRAFT', 'SIMULATION', 'CANARY', 'TESTING', 'STABLE', 'QUARANTINED', 'DEPRECATED',
] as const
export type TacticalLifecycle = typeof tacticalLifecycle[number]

export const tacticalLifecycleTransitions: Readonly<
  Record<TacticalLifecycle, readonly TacticalLifecycle[]>
> = {
  DRAFT: ['SIMULATION', 'QUARANTINED', 'DEPRECATED'],
  SIMULATION: ['CANARY', 'DRAFT', 'QUARANTINED', 'DEPRECATED'],
  CANARY: ['TESTING', 'SIMULATION', 'QUARANTINED', 'DEPRECATED'],
  TESTING: ['STABLE', 'CANARY', 'QUARANTINED', 'DEPRECATED'],
  STABLE: ['QUARANTINED', 'DEPRECATED'],
  QUARANTINED: ['DRAFT', 'DEPRECATED'],
  DEPRECATED: [],
}

export const militarySessionStates = [
  'UNBOUND', 'BINDING', 'ACTIVE', 'QUARANTINED', 'CLOSING', 'CLOSED',
] as const
export type MilitarySessionState = typeof militarySessionStates[number]

export const militarySessionTransitions: Readonly<
  Record<MilitarySessionState, readonly MilitarySessionState[]>
> = {
  UNBOUND: ['BINDING'],
  BINDING: ['ACTIVE', 'QUARANTINED', 'CLOSED'],
  ACTIVE: ['QUARANTINED', 'CLOSING'],
  QUARANTINED: ['BINDING', 'CLOSING'],
  CLOSING: ['CLOSED'],
  CLOSED: [],
}

export const tacticalTagStates = ['ACTIVE', 'PAUSED', 'DELETED'] as const
export type TacticalTagState = typeof tacticalTagStates[number]

export const tacticalTagTransitions: Readonly<
  Record<TacticalTagState, readonly TacticalTagState[]>
> = {
  ACTIVE: ['PAUSED', 'DELETED'],
  PAUSED: ['ACTIVE', 'DELETED'],
  DELETED: [],
}

export const ingestionStates = [
  'REQUESTED', 'SNAPSHOTTING', 'SCANNING', 'EXTRACTING', 'VALIDATING',
  'PENDING_REVIEW', 'APPROVED_AS_DRAFT', 'RETURNED', 'REJECTED', 'FAILED', 'CANCELLED',
] as const
export type IngestionState = typeof ingestionStates[number]

export const ingestionTransitions: Readonly<
  Record<IngestionState, readonly IngestionState[]>
> = {
  REQUESTED: ['SNAPSHOTTING', 'FAILED', 'CANCELLED'],
  SNAPSHOTTING: ['SCANNING', 'FAILED', 'CANCELLED'],
  SCANNING: ['EXTRACTING', 'FAILED', 'CANCELLED'],
  EXTRACTING: ['VALIDATING', 'FAILED', 'CANCELLED'],
  VALIDATING: ['PENDING_REVIEW', 'FAILED', 'CANCELLED'],
  PENDING_REVIEW: [
    'APPROVED_AS_DRAFT',
    'RETURNED',
    'REJECTED',
    'FAILED',
    'CANCELLED',
  ],
  APPROVED_AS_DRAFT: [],
  RETURNED: ['EXTRACTING', 'PENDING_REVIEW', 'REJECTED', 'CANCELLED'],
  REJECTED: [],
  FAILED: [],
  CANCELLED: [],
}

export const brainstormStates = [
  'OPEN', 'QUESTIONING', 'STAFF_REVIEW', 'SPECS_HANDOFF', 'COMPLETED', 'CANCELLED',
] as const
export type BrainstormState = typeof brainstormStates[number]

export const brainstormTransitions: Readonly<
  Record<BrainstormState, readonly BrainstormState[]>
> = {
  OPEN: ['QUESTIONING', 'STAFF_REVIEW', 'CANCELLED'],
  QUESTIONING: ['QUESTIONING', 'STAFF_REVIEW', 'CANCELLED'],
  STAFF_REVIEW: ['QUESTIONING', 'SPECS_HANDOFF', 'CANCELLED'],
  SPECS_HANDOFF: ['COMPLETED', 'STAFF_REVIEW', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export const evaluationRunStates = [
  'DISCOVERING_SESSIONS', 'BUILDING_DATASET', 'EVALUATING_TEMPLATES',
  'SYNTHESIZING', 'VALIDATING_REPORT', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const
export type EvaluationRunState = typeof evaluationRunStates[number]

export const evaluationRunTransitions: Readonly<
  Record<EvaluationRunState, readonly EvaluationRunState[]>
> = {
  DISCOVERING_SESSIONS: ['BUILDING_DATASET', 'FAILED', 'CANCELLED'],
  BUILDING_DATASET: ['EVALUATING_TEMPLATES', 'FAILED', 'CANCELLED'],
  EVALUATING_TEMPLATES: ['SYNTHESIZING', 'FAILED', 'CANCELLED'],
  SYNTHESIZING: ['VALIDATING_REPORT', 'FAILED', 'CANCELLED'],
  VALIDATING_REPORT: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
}

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

export const decisionBrokerTransitions: Readonly<
  Record<DecisionBrokerState, readonly DecisionBrokerState[]>
> = {
  CREATED: ['QUEUED', 'CANCELLED', 'STALE'],
  QUEUED: ['PRESENTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED', 'STALE'],
  PRESENTED: [
    'PARTIALLY_ANSWERED',
    'ANSWERED',
    'EXPIRED',
    'CANCELLED',
    'SUPERSEDED',
    'STALE',
    'DELIVERY_FAILED',
  ],
  PARTIALLY_ANSWERED: [
    'ANSWERED',
    'EXPIRED',
    'CANCELLED',
    'SUPERSEDED',
    'STALE',
    'DELIVERY_FAILED',
  ],
  ANSWERED: [],
  EXPIRED: [],
  CANCELLED: [],
  SUPERSEDED: [],
  STALE: [],
  DELIVERY_FAILED: [],
}

export const presetResumeStates = [
  'MATCHED', 'ARCHIVE_REBOUND', 'QUARANTINED',
] as const
export type PresetResumeState = typeof presetResumeStates[number]

export const presetResumeTransitions: Readonly<
  Record<PresetResumeState, readonly PresetResumeState[]>
> = {
  MATCHED: [],
  ARCHIVE_REBOUND: [],
  QUARANTINED: [],
}

export const integrationStates = [
  'QUEUED', 'LEASED', 'APPLYING', 'REGRESSION', 'APPLIED',
  'CONFLICT', 'REGRESSION_FAILED', 'STALE', 'CANCELLED',
] as const
export type IntegrationState = typeof integrationStates[number]

export const integrationTransitions: Readonly<
  Record<IntegrationState, readonly IntegrationState[]>
> = {
  QUEUED: ['LEASED', 'STALE', 'CANCELLED'],
  LEASED: ['APPLYING', 'STALE', 'CANCELLED'],
  APPLYING: ['REGRESSION', 'APPLIED', 'CONFLICT', 'STALE', 'CANCELLED'],
  REGRESSION: ['APPLIED', 'REGRESSION_FAILED', 'STALE', 'CANCELLED'],
  APPLIED: [],
  CONFLICT: [],
  REGRESSION_FAILED: [],
  STALE: [],
  CANCELLED: [],
}

export const bundleLifecycleStates = [
  'PLANNED', 'APPLYING', 'VALIDATING', 'SUCCEEDED', 'ROLLING_BACK',
  'ROLLED_BACK', 'FAILED',
] as const
export type BundleLifecycleState = typeof bundleLifecycleStates[number]

export const bundleLifecycleTransitions: Readonly<
  Record<BundleLifecycleState, readonly BundleLifecycleState[]>
> = {
  PLANNED: ['APPLYING', 'FAILED'],
  APPLYING: ['VALIDATING', 'ROLLING_BACK', 'FAILED'],
  VALIDATING: ['SUCCEEDED', 'ROLLING_BACK', 'FAILED'],
  SUCCEEDED: [],
  ROLLING_BACK: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: [],
  FAILED: [],
}

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

export type AggregateStateMachineId =
  | 'TASK'
  | 'WAVE'
  | 'TACTIC'
  | 'SESSION'
  | 'TAG'
  | 'INGESTION'
  | 'BRAINSTORM'
  | 'EVALUATION'
  | 'DECISION'
  | 'PRESET_RESUME'
  | 'INTEGRATION'
  | 'BUNDLE'
  | 'BUDGET'
  | 'PERFORMANCE_APPEAL'

export interface AggregateStateMachineContract {
  readonly schemaVersion: '1.0.0'
  readonly aggregate: AggregateStateMachineId
  readonly initialStates: readonly string[]
  readonly states: readonly string[]
  readonly transitions: Readonly<Record<string, readonly string[]>>
  readonly terminalStates: readonly string[]
  /**
   * UI actions are projections of authoritative commands. They never mutate
   * state directly and are absent when no governed command is available.
   */
  readonly uiActions: Readonly<Record<string, readonly string[]>>
}

/**
 * One canonical vocabulary consumed by reducers, recovery projections and
 * Web action affordances. Feature code must not invent a parallel state name.
 */
export const aggregateStateMachineCatalog:
readonly AggregateStateMachineContract[] = [
  machine('TASK', ['CREATED'], taskStates, taskTransitions, {
    CREATED: ['task.cancel'],
    READY: ['task.dispatch', 'task.pause', 'task.cancel'],
    LEASED: ['task.pause', 'task.cancel'],
    EXECUTING: ['task.pause', 'task.cancel'],
    REWORK: ['task.redispatch', 'task.pause', 'task.cancel'],
    BLOCKED: ['task.resume', 'task.cancel'],
    GUIDANCE_PENDING: ['task.resume', 'task.cancel'],
    WAITING_DECISION: ['task.cancel'],
    PAUSED: ['task.resume', 'task.cancel'],
    RECOVERY_REQUIRED: ['task.recover', 'task.cancel'],
    FROZEN: ['task.unfreeze', 'task.cancel'],
    INTEGRATION_FAILED: ['task.redispatch', 'task.cancel'],
  }),
  machine('WAVE', ['DRAFT'], waveStates, waveTransitions, {
    DRAFT: ['wave.validate', 'wave.cancel'],
    READY: ['wave.open', 'wave.cancel'],
    ACTIVE: ['wave.evaluate-barrier', 'wave.cancel'],
    BARRIER_PENDING: ['wave.evaluate-barrier', 'wave.cancel'],
  }),
  machine('TACTIC', ['DRAFT'], tacticalLifecycle, tacticalLifecycleTransitions, {
    DRAFT: ['tactic.simulate', 'tactic.deprecate'],
    SIMULATION: ['tactic.promote-canary', 'tactic.return-draft'],
    CANARY: ['tactic.promote-testing', 'tactic.quarantine'],
    TESTING: ['tactic.promote-stable', 'tactic.quarantine'],
    STABLE: ['tactic.quarantine', 'tactic.deprecate'],
    QUARANTINED: ['tactic.return-draft', 'tactic.deprecate'],
  }),
  machine('SESSION', ['UNBOUND'], militarySessionStates, militarySessionTransitions, {
    UNBOUND: ['session.bind'],
    BINDING: ['session.retry-bind', 'session.close'],
    ACTIVE: ['session.quarantine', 'session.close'],
    QUARANTINED: ['session.retry-bind', 'session.close'],
    CLOSING: ['session.finish-close'],
  }),
  machine('TAG', ['ACTIVE'], tacticalTagStates, tacticalTagTransitions, {
    ACTIVE: ['tag.pause', 'tag.delete'],
    PAUSED: ['tag.resume', 'tag.delete'],
  }),
  machine('INGESTION', ['REQUESTED'], ingestionStates, ingestionTransitions, {
    REQUESTED: ['ingestion.start', 'ingestion.cancel'],
    SNAPSHOTTING: ['ingestion.cancel'],
    SCANNING: ['ingestion.cancel'],
    EXTRACTING: ['ingestion.cancel'],
    VALIDATING: ['ingestion.cancel'],
    PENDING_REVIEW: [
      'ingestion.approve-draft',
      'ingestion.return',
      'ingestion.reject',
    ],
    RETURNED: ['ingestion.reextract', 'ingestion.reject'],
  }),
  machine('BRAINSTORM', ['OPEN'], brainstormStates, brainstormTransitions, {
    OPEN: ['brainstorm.ask', 'brainstorm.review', 'brainstorm.cancel'],
    QUESTIONING: ['brainstorm.answer', 'brainstorm.review', 'brainstorm.cancel'],
    STAFF_REVIEW: ['brainstorm.handoff-specs', 'brainstorm.ask', 'brainstorm.cancel'],
    SPECS_HANDOFF: ['brainstorm.complete', 'brainstorm.return-review'],
  }),
  machine(
    'EVALUATION',
    ['DISCOVERING_SESSIONS'],
    evaluationRunStates,
    evaluationRunTransitions,
    {
      DISCOVERING_SESSIONS: ['evaluation.cancel'],
      BUILDING_DATASET: ['evaluation.cancel'],
      EVALUATING_TEMPLATES: ['evaluation.cancel'],
      SYNTHESIZING: ['evaluation.cancel'],
      VALIDATING_REPORT: ['evaluation.cancel'],
      FAILED: ['evaluation.retry'],
    },
  ),
  machine('DECISION', ['CREATED'], decisionBrokerStates, decisionBrokerTransitions, {
    CREATED: ['decision.queue', 'decision.cancel'],
    QUEUED: ['decision.present', 'decision.cancel'],
    PRESENTED: ['decision.answer', 'decision.cancel'],
    PARTIALLY_ANSWERED: ['decision.answer', 'decision.cancel'],
    DELIVERY_FAILED: ['decision.retry-delivery'],
  }),
  machine(
    'PRESET_RESUME',
    presetResumeStates,
    presetResumeStates,
    presetResumeTransitions,
    {},
  ),
  machine('INTEGRATION', ['QUEUED'], integrationStates, integrationTransitions, {
    QUEUED: ['integration.lease', 'integration.cancel'],
    LEASED: ['integration.apply', 'integration.cancel'],
    APPLYING: ['integration.cancel'],
    REGRESSION: ['integration.cancel'],
  }),
  machine('BUNDLE', ['PLANNED'], bundleLifecycleStates, bundleLifecycleTransitions, {
    PLANNED: ['bundle.apply'],
    APPLYING: ['bundle.rollback'],
    VALIDATING: ['bundle.rollback'],
    ROLLING_BACK: ['bundle.finish-rollback'],
  }),
  machine(
    'BUDGET',
    ['RESERVED', 'REJECTED'],
    budgetReservationStates,
    budgetReservationTransitions,
    { RESERVED: ['budget.settle', 'budget.revoke'] },
  ),
  machine(
    'PERFORMANCE_APPEAL',
    ['SUBMITTED'],
    performanceAppealStates,
    performanceAppealTransitions,
    {
      SUBMITTED: ['appeal.begin-review', 'appeal.withdraw'],
      UNDER_REVIEW: [
        'appeal.uphold',
        'appeal.partially-uphold',
        'appeal.deny',
        'appeal.withdraw',
      ],
    },
  ),
]

export function stateMachineContract(
  aggregate: AggregateStateMachineId,
): AggregateStateMachineContract {
  const found = aggregateStateMachineCatalog.find(value =>
    value.aggregate === aggregate)
  if (found === undefined) {
    throw new TypeError(`unknown aggregate state machine ${aggregate}`)
  }
  return found
}

export function canTransitionAggregate(
  aggregate: AggregateStateMachineId,
  from: string,
  to: string,
): boolean {
  return stateMachineContract(aggregate).transitions[from]?.includes(to)
    ?? false
}

function machine<S extends string>(
  aggregate: AggregateStateMachineId,
  initialStates: readonly S[],
  states: readonly S[],
  transitions: Readonly<Record<S, readonly S[]>>,
  uiActions: Partial<Readonly<Record<S, readonly string[]>>>,
): AggregateStateMachineContract {
  const stateSet = new Set<string>(states)
  for (const initial of initialStates) {
    if (!stateSet.has(initial)) {
      throw new TypeError(`${aggregate} has unknown initial state ${initial}`)
    }
  }
  for (const [from, targets] of Object.entries(transitions) as Array<
    [string, readonly S[]]
  >) {
    if (!stateSet.has(from)) {
      throw new TypeError(`${aggregate} has unknown transition source ${from}`)
    }
    for (const target of targets) {
      if (!stateSet.has(target)) {
        throw new TypeError(
          `${aggregate} has unknown transition target ${target}`,
        )
      }
    }
  }
  return Object.freeze({
    schemaVersion: '1.0.0',
    aggregate,
    initialStates: [...initialStates],
    states: [...states],
    transitions,
    terminalStates: states.filter(state =>
      transitions[state].length === 0),
    uiActions: Object.fromEntries(states.map(state => [
      state,
      [...(uiActions[state] ?? [])],
    ])),
  })
}
