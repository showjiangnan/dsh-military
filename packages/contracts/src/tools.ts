import type {
  AgentIdentity,
  BrainstormOrder,
  CandidateSubmission,
  DecisionQuestionSet,
  EvaluationRequestId,
  MilitaryPerformanceReport,
  PerformanceEvaluationRequest,
  TacticalExtractionCandidate,
  TacticalExtractionCandidateId,
  TacticalIngestionRequest,
  TacticalIngestionRequestId,
  TacticalRequest,
  TaskId,
  TaskOrder,
} from './domain.js'

export interface GetOrderArgs {
  readonly taskId: TaskId
}
export interface GetOrderResult {
  readonly order: TaskOrder
}

export type SubmitCandidateArgs = CandidateSubmission
export interface SubmitCandidateResult {
  readonly candidateId: string
  readonly verificationState: 'QUEUED'
  readonly concludesTurn: true
}

export interface SubmitBlockerArgs {
  readonly identity: AgentIdentity
  readonly taskId: TaskId
  readonly taskVersion: number
  readonly statement: string
  readonly evidenceRefs: readonly string[]
  readonly requestedDecision: string
}
export interface SubmitBlockerResult {
  readonly blockerId: string
  readonly disposition: 'EVIDENCE_REQUIRED' | 'RADIO_QUEUED' | 'STRATEGIC'
  readonly concludesTurn: true
}

export type RadioRequestArgs = TacticalRequest
export interface RadioRequestResult {
  readonly requestId: string
  readonly state: 'QUEUED' | 'REJECTED'
}

/** Handler behind the agent-scoped `/brainstorm` command. */
export interface StartBrainstormArgs {
  readonly rawInput?: string
}
export interface StartBrainstormResult {
  readonly order: BrainstormOrder
  readonly nextAction: 'ASK_USER' | 'STAFF_REVIEW' | 'SPECS_HANDOFF'
}

/** A delegated child submits questions; only the root General renders them. */
export type SubmitDecisionQuestionSetArgs = DecisionQuestionSet
export interface SubmitDecisionQuestionSetResult {
  readonly accepted: boolean
  readonly disposition: 'QUEUED_FOR_GENERAL' | 'DUPLICATE' | 'STALE' | 'INVALID'
}

export type RequestTacticalIngestionArgs = TacticalIngestionRequest
export interface RequestTacticalIngestionResult {
  readonly requestId: TacticalIngestionRequestId
  readonly state: 'REQUESTED'
}

export interface ReviewTacticalCandidateArgs {
  readonly candidateId: TacticalExtractionCandidateId
  readonly candidateHash: string
  readonly action: 'APPROVE_AS_DRAFT' | 'RETURN' | 'REJECT'
  readonly instructions?: string
}
export interface ReviewTacticalCandidateResult {
  readonly candidate: TacticalExtractionCandidate
  readonly committedDraftVersion?: string
}

export type RequestPerformanceEvaluationArgs = PerformanceEvaluationRequest
export interface RequestPerformanceEvaluationResult {
  readonly evaluationRequestId: EvaluationRequestId
  readonly state: 'DISCOVERING_SESSIONS'
}

export interface GetPerformanceEvaluationArgs {
  readonly evaluationRequestId: EvaluationRequestId
}
export interface GetPerformanceEvaluationResult {
  readonly state:
    | 'DISCOVERING_SESSIONS'
    | 'BUILDING_DATASET'
    | 'EVALUATING_TEMPLATES'
    | 'SYNTHESIZING'
    | 'VALIDATING_REPORT'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED'
  readonly report?: MilitaryPerformanceReport
}
