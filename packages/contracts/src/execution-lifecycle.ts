import type {
  AgentIdentity,
  IsoDateTime,
  MissionId,
  SessionId,
  TaskId,
  TaskVersion,
} from './domain.js'

/**
 * A durable obligation created from one exact user execution request.
 *
 * The obligation is deliberately separate from Mission state. A Mission may
 * contain several user requests, while one request must remain resumable
 * across parent turns, child wakeups and Host restarts until its own terminal
 * outcome has been observed.
 */
export interface WorkflowObligation {
  readonly schemaVersion: '1.0.0'
  readonly obligationId: string
  readonly tenantId: string
  readonly rootSessionId: SessionId
  readonly requestKey: string
  readonly requestHash: string
  readonly requestSummary: string
  readonly reason: 'USER_EXECUTION' | 'CONTINUATION' | 'CHILD_WAKE' | 'RECOVERY'
  readonly state:
    | 'OPEN'
    | 'PLANNING'
    | 'DISPATCHING'
    | 'WAITING_CHILD'
    | 'RECOVERING'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'FAILED'
  readonly stage:
    | 'START_MISSION'
    | 'CREATE_TASK'
    | 'READ_DEPARTMENT_STATUS'
    | 'SPAWN_DEPARTMENT'
    | 'POLL_TACTICAL_REQUEST'
    | 'ISSUE_TACTICAL_GUIDANCE'
    | 'PRESENT_DECISION'
    | 'ASK_USER_DECISION'
    | 'RECORD_DECISION'
    | 'WAIT_FOR_SETTLEMENT'
    | 'VERIFY_AND_INTEGRATE'
    | 'SUMMARIZE'
  readonly revision: number
  readonly missionId?: MissionId
  readonly taskIds: readonly TaskId[]
  readonly wakeCursor: number
  readonly lastTransitionReason: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly completedAt?: IsoDateTime
}

export const workflowObligationStates = [
  'OPEN',
  'PLANNING',
  'DISPATCHING',
  'WAITING_CHILD',
  'RECOVERING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const satisfies readonly WorkflowObligation['state'][]

export const workflowObligationTransitions: Readonly<Record<
  WorkflowObligation['state'],
  readonly WorkflowObligation['state'][]
>> = {
  OPEN: [
    'PLANNING',
    'DISPATCHING',
    'WAITING_CHILD',
    'RECOVERING',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ],
  PLANNING: [
    'DISPATCHING',
    'WAITING_CHILD',
    'RECOVERING',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ],
  DISPATCHING: [
    'WAITING_CHILD',
    'RECOVERING',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ],
  WAITING_CHILD: [
    'PLANNING',
    'DISPATCHING',
    'RECOVERING',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ],
  RECOVERING: [
    'PLANNING',
    'DISPATCHING',
    'WAITING_CHILD',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
}

export type TaskExecutionAttemptState =
  | 'RESERVED'
  | 'DISPATCHING'
  | 'RUNNING'
  | 'WAITING'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'LOST'

export const taskExecutionAttemptStates = [
  'RESERVED',
  'DISPATCHING',
  'RUNNING',
  'WAITING',
  'SETTLED',
  'FAILED',
  'CANCELLED',
  'LOST',
] as const satisfies readonly TaskExecutionAttemptState[]

export const taskExecutionAttemptTransitions: Readonly<Record<
  TaskExecutionAttemptState,
  readonly TaskExecutionAttemptState[]
>> = {
  RESERVED: ['DISPATCHING', 'FAILED', 'CANCELLED', 'LOST'],
  DISPATCHING: ['RUNNING', 'FAILED', 'CANCELLED', 'LOST'],
  RUNNING: ['WAITING', 'SETTLED', 'FAILED', 'CANCELLED', 'LOST'],
  WAITING: ['RUNNING', 'SETTLED', 'FAILED', 'CANCELLED', 'LOST'],
  SETTLED: [],
  FAILED: [],
  CANCELLED: [],
  LOST: [],
}

/** One logical execution try for one immutable Task version. */
export interface TaskExecutionAttempt {
  readonly schemaVersion: '1.0.0'
  readonly attemptId: string
  readonly tenantId: string
  readonly missionId: MissionId
  readonly taskId: TaskId
  readonly taskVersion: TaskVersion
  readonly attemptNo: number
  readonly state: TaskExecutionAttemptState
  readonly cause: 'INITIAL' | 'REWORK' | 'RECOVERY' | 'REDISPATCH'
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly settledAt?: IsoDateTime
  readonly settlementReason?: string
}

export type AgentActivationState =
  | 'RESERVED'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'LOST'

export const agentActivationStates = [
  'RESERVED',
  'STARTING',
  'RUNNING',
  'WAITING',
  'SETTLED',
  'FAILED',
  'CANCELLED',
  'LOST',
] as const satisfies readonly AgentActivationState[]

export const agentActivationTransitions: Readonly<Record<
  AgentActivationState,
  readonly AgentActivationState[]
>> = {
  RESERVED: ['STARTING', 'FAILED', 'CANCELLED', 'LOST'],
  STARTING: ['RUNNING', 'FAILED', 'CANCELLED', 'LOST'],
  RUNNING: ['WAITING', 'SETTLED', 'FAILED', 'CANCELLED', 'LOST'],
  WAITING: ['RUNNING', 'SETTLED', 'FAILED', 'CANCELLED', 'LOST'],
  SETTLED: [],
  FAILED: [],
  CANCELLED: [],
  LOST: [],
}

/** Runtime ownership of an Attempt by one immutable department identity. */
export interface AgentActivation {
  readonly schemaVersion: '1.0.0'
  readonly activationId: string
  readonly attemptId: string
  readonly agent?: AgentIdentity
  readonly state: AgentActivationState
  readonly currentDispatchSequence: number
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly startedAt?: IsoDateTime
  /** Monotonic Host-observed liveness receipt sequence. */
  readonly heartbeatSequence?: number
  readonly lastHeartbeatAt?: IsoDateTime
  readonly heartbeatExpiresAt?: IsoDateTime
  readonly settledAt?: IsoDateTime
  readonly settlementReceiptId?: string
  readonly settlementReason?: string
}

export type DispatchState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'STARTED'
  | 'SETTLED'
  | 'RECOVERY_REQUIRED'
  | 'FAILED'
  | 'CANCELLED'

export const dispatchStates = [
  'PENDING',
  'ACCEPTED',
  'STARTED',
  'SETTLED',
  'RECOVERY_REQUIRED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly DispatchState[]

export const dispatchTransitions: Readonly<Record<
  DispatchState,
  readonly DispatchState[]
>> = {
  PENDING: [
    'ACCEPTED',
    'STARTED',
    'RECOVERY_REQUIRED',
    'FAILED',
    'CANCELLED',
  ],
  ACCEPTED: ['STARTED', 'RECOVERY_REQUIRED', 'FAILED', 'CANCELLED'],
  STARTED: ['SETTLED', 'RECOVERY_REQUIRED', 'FAILED', 'CANCELLED'],
  SETTLED: [],
  RECOVERY_REQUIRED: [],
  FAILED: [],
  CANCELLED: [],
}

export const executionLifecycleUiActions = {
  workflow: {
    OPEN: ['workflow.plan', 'workflow.cancel'],
    PLANNING: ['workflow.dispatch', 'workflow.cancel'],
    DISPATCHING: ['workflow.wait-child', 'workflow.recover', 'workflow.cancel'],
    WAITING_CHILD: ['workflow.recover', 'workflow.cancel'],
    RECOVERING: ['workflow.resume', 'workflow.cancel'],
    COMPLETED: [],
    CANCELLED: [],
    FAILED: ['workflow.retry-as-new-obligation'],
  },
  attempt: {
    RESERVED: ['attempt.dispatch', 'attempt.cancel'],
    DISPATCHING: ['attempt.recover', 'attempt.cancel'],
    RUNNING: ['attempt.pause', 'attempt.cancel'],
    WAITING: ['attempt.resume', 'attempt.cancel'],
    SETTLED: [],
    FAILED: ['attempt.create-continuation'],
    CANCELLED: [],
    LOST: ['attempt.create-recovery'],
  },
  activation: {
    RESERVED: ['activation.start', 'activation.cancel'],
    STARTING: ['activation.recover', 'activation.cancel'],
    RUNNING: ['activation.pause', 'activation.cancel'],
    WAITING: ['activation.resume', 'activation.cancel'],
    SETTLED: [],
    FAILED: [],
    CANCELLED: [],
    LOST: ['activation.recover-as-new'],
  },
  dispatch: {
    PENDING: ['dispatch.publish', 'dispatch.cancel'],
    ACCEPTED: ['dispatch.observe-start', 'dispatch.recover', 'dispatch.cancel'],
    STARTED: ['dispatch.settle', 'dispatch.recover', 'dispatch.cancel'],
    SETTLED: [],
    RECOVERY_REQUIRED: ['dispatch.create-continuation'],
    FAILED: ['dispatch.create-continuation'],
    CANCELLED: [],
  },
} as const

/**
 * One transport publication. Dispatch is intentionally not synonymous with
 * Attempt or Activation: transport retries retain the same immutable record,
 * while a governed rework creates a new Attempt.
 */
export interface DispatchRecord {
  readonly schemaVersion: '1.0.0'
  readonly dispatchId: string
  readonly dispatchKey: string
  readonly attemptId: string
  readonly activationId: string
  readonly sequence: number
  readonly payloadHash: string
  readonly state: DispatchState
  readonly childSessionId?: SessionId
  readonly transportReceiptId?: string
  readonly settlementReceiptId?: string
  readonly failureCode?: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface TaskDispatchReservation {
  readonly attempt: TaskExecutionAttempt
  readonly activation: AgentActivation
  readonly dispatch: DispatchRecord
  /** True when an exact prior reservation was recovered idempotently. */
  readonly recovered: boolean
}

export interface MilitaryExecutionLifecycle {
  openWorkflowObligation(input: {
    readonly tenantId: string
    readonly rootSessionId: SessionId
    readonly requestKey: string
    readonly requestHash: string
    readonly requestSummary: string
    readonly reason: WorkflowObligation['reason']
  }): Promise<WorkflowObligation>
  activeWorkflowObligation(rootSessionId: SessionId): Promise<WorkflowObligation | null>
  getWorkflowObligation(obligationId: string): Promise<WorkflowObligation | null>
  advanceWorkflowObligation(input: {
    readonly obligationId: string
    readonly expectedRevision: number
    readonly state?: WorkflowObligation['state']
    readonly stage?: WorkflowObligation['stage']
    readonly missionId?: MissionId
    readonly taskIds?: readonly TaskId[]
    readonly transitionReason: string
    readonly incrementWakeCursor?: boolean
  }): Promise<WorkflowObligation>
  settleWorkflowObligation(input: {
    readonly obligationId: string
    readonly expectedRevision: number
    readonly outcome: 'COMPLETED' | 'CANCELLED' | 'FAILED'
    readonly reason: string
  }): Promise<WorkflowObligation>

  reserveTaskDispatch(input: {
    readonly tenantId: string
    readonly missionId: MissionId
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly dispatchKey: string
    readonly payloadHash: string
    readonly cause: TaskExecutionAttempt['cause']
  }): Promise<TaskDispatchReservation>
  bindActivationAgent(
    activationId: string,
    agent: AgentIdentity,
  ): Promise<AgentActivation>
  heartbeatActivation(input: {
    readonly activationId: string
    /** A bounded lease; callers cannot create an unbounded RUNNING state. */
    readonly leaseMs?: number
  }): Promise<AgentActivation>
  reconcileExpiredActivations(input?: {
    readonly observedAt?: IsoDateTime
  }): Promise<readonly AgentActivation[]>
  markDispatch(input: {
    readonly dispatchId: string
    readonly state: DispatchState
    readonly childSessionId?: SessionId
    readonly transportReceiptId?: string
    readonly failureCode?: string
  }): Promise<DispatchRecord>
  settleActivation(input: {
    readonly activationId: string
    readonly outcome: 'SETTLED' | 'FAILED' | 'CANCELLED' | 'LOST'
    readonly reason: string
    readonly settlementReceiptId: string
  }): Promise<AgentActivation>
  getAttempt(attemptId: string): Promise<TaskExecutionAttempt | null>
  getActivation(activationId: string): Promise<AgentActivation | null>
  getDispatch(dispatchId: string): Promise<DispatchRecord | null>
  activeDispatchForTask(
    taskId: TaskId,
    taskVersion: TaskVersion,
  ): Promise<TaskDispatchReservation | null>
}
