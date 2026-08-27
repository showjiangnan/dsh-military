import {
  agentActivationTransitions,
  MilitaryError,
  brand,
  type AgentActivation,
  type AgentIdentity,
  type DispatchRecord,
  type DispatchState,
  dispatchTransitions,
  type MilitaryExecutionLifecycle,
  type SessionId,
  type TaskDispatchReservation,
  type TaskExecutionAttempt,
  type TaskId,
  type TaskVersion,
  taskExecutionAttemptTransitions,
  type WorkflowObligation,
  workflowObligationTransitions,
} from '@dsh-military/contracts'
import { cloneFrozen, sha256, stableJson } from './util.js'

export interface TaskExecutionLifecycleAggregate {
  readonly schemaVersion: '1.0.0'
  readonly taskId: TaskId
  readonly taskVersion: TaskVersion
  readonly attempts: readonly TaskExecutionAttempt[]
  readonly activations: readonly AgentActivation[]
  readonly dispatches: readonly DispatchRecord[]
}

/**
 * Atomic state seam used by the lifecycle coordinator. Production maps it to
 * one SQLite CAS row per obligation / immutable Task version.
 */
export interface ExecutionLifecycleStateStore {
  readWorkflow(obligationId: string): Promise<WorkflowObligation | null>
  listWorkflows(): Promise<readonly WorkflowObligation[]>
  updateWorkflow<R>(
    obligationId: string,
    initial: () => WorkflowObligation,
    mutate: (
      current: WorkflowObligation,
    ) => Promise<{ readonly next: WorkflowObligation; readonly result: R }>
      | { readonly next: WorkflowObligation; readonly result: R },
  ): Promise<R>
  readTask(
    taskId: TaskId,
    taskVersion: TaskVersion,
  ): Promise<TaskExecutionLifecycleAggregate | null>
  listTasks(): Promise<readonly TaskExecutionLifecycleAggregate[]>
  updateTask<R>(
    taskId: TaskId,
    taskVersion: TaskVersion,
    initial: () => TaskExecutionLifecycleAggregate,
    mutate: (
      current: TaskExecutionLifecycleAggregate,
    ) => Promise<{ readonly next: TaskExecutionLifecycleAggregate; readonly result: R }>
      | { readonly next: TaskExecutionLifecycleAggregate; readonly result: R },
  ): Promise<R>
}

export class InMemoryExecutionLifecycleStateStore
implements ExecutionLifecycleStateStore {
  readonly #workflows = new Map<string, WorkflowObligation>()
  readonly #tasks = new Map<string, TaskExecutionLifecycleAggregate>()
  #mutationTail: Promise<void> = Promise.resolve()

  async readWorkflow(obligationId: string): Promise<WorkflowObligation | null> {
    return cloneFrozen(this.#workflows.get(obligationId) ?? null)
  }

  async listWorkflows(): Promise<readonly WorkflowObligation[]> {
    return cloneFrozen([...this.#workflows.values()])
  }

  async updateWorkflow<R>(
    obligationId: string,
    initial: () => WorkflowObligation,
    mutate: (
      current: WorkflowObligation,
    ) => Promise<{ readonly next: WorkflowObligation; readonly result: R }>
      | { readonly next: WorkflowObligation; readonly result: R },
  ): Promise<R> {
    return await this.#serialize(async () => {
      const current = this.#workflows.get(obligationId) ?? initial()
      const changed = await mutate(cloneFrozen(current))
      this.#workflows.set(obligationId, cloneFrozen(changed.next))
      return cloneFrozen(changed.result)
    })
  }

  async readTask(
    taskId: TaskId,
    taskVersion: TaskVersion,
  ): Promise<TaskExecutionLifecycleAggregate | null> {
    return cloneFrozen(this.#tasks.get(taskAggregateKey(taskId, taskVersion)) ?? null)
  }

  async listTasks(): Promise<readonly TaskExecutionLifecycleAggregate[]> {
    return cloneFrozen([...this.#tasks.values()])
  }

  async updateTask<R>(
    taskId: TaskId,
    taskVersion: TaskVersion,
    initial: () => TaskExecutionLifecycleAggregate,
    mutate: (
      current: TaskExecutionLifecycleAggregate,
    ) => Promise<{ readonly next: TaskExecutionLifecycleAggregate; readonly result: R }>
      | { readonly next: TaskExecutionLifecycleAggregate; readonly result: R },
  ): Promise<R> {
    return await this.#serialize(async () => {
      const key = taskAggregateKey(taskId, taskVersion)
      const current = this.#tasks.get(key) ?? initial()
      const changed = await mutate(cloneFrozen(current))
      this.#tasks.set(key, cloneFrozen(changed.next))
      return cloneFrozen(changed.result)
    })
  }

  async #serialize<R>(operation: () => Promise<R>): Promise<R> {
    const prior = this.#mutationTail
    let release!: () => void
    this.#mutationTail = new Promise<void>(resolve => {
      release = resolve
    })
    await prior
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

/**
 * Durable execution coordinator. It makes request obligation, Task Attempt,
 * Agent Activation and transport Dispatch separate, observable aggregates.
 */
export class ExecutionLifecycleCoordinator
implements MilitaryExecutionLifecycle {
  readonly #state: ExecutionLifecycleStateStore
  readonly #clock: () => Date
  readonly #heartbeatLeaseMs: number

  constructor(input?: {
    readonly state?: ExecutionLifecycleStateStore
    readonly clock?: () => Date
    readonly heartbeatLeaseMs?: number
  }) {
    this.#state = new RevisionRetryExecutionLifecycleStateStore(
      input?.state ?? new InMemoryExecutionLifecycleStateStore(),
    )
    this.#clock = input?.clock ?? (() => new Date())
    this.#heartbeatLeaseMs = boundedHeartbeatLease(
      input?.heartbeatLeaseMs ?? 300_000,
    )
  }

  async openWorkflowObligation(input: {
    readonly tenantId: string
    readonly rootSessionId: SessionId
    readonly requestKey: string
    readonly requestHash: string
    readonly requestSummary: string
    readonly reason: WorkflowObligation['reason']
  }): Promise<WorkflowObligation> {
    const obligationId = `workflow-${sha256(stableJson({
      tenantId: input.tenantId,
      rootSessionId: String(input.rootSessionId),
      requestKey: input.requestKey,
    })).slice(0, 40)}`
    const timestamp = this.#timestamp()
    return await this.#state.updateWorkflow(
      obligationId,
      () => ({
        schemaVersion: '1.0.0',
        obligationId,
        tenantId: input.tenantId,
        rootSessionId: input.rootSessionId,
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        requestSummary: input.requestSummary,
        reason: input.reason,
        state: 'OPEN',
        stage: 'START_MISSION',
        revision: 1,
        taskIds: [],
        wakeCursor: 0,
        lastTransitionReason: 'workflow obligation opened',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      current => {
        if (current.requestHash !== input.requestHash
          || current.tenantId !== input.tenantId
          || String(current.rootSessionId) !== String(input.rootSessionId)) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            `workflow request key ${input.requestKey} resolved to different content`,
          )
        }
        return { next: current, result: current }
      },
    )
  }

  async activeWorkflowObligation(
    rootSessionId: SessionId,
  ): Promise<WorkflowObligation | null> {
    const active = (await this.#state.listWorkflows())
      .filter(value =>
        String(value.rootSessionId) === String(rootSessionId)
        && !TERMINAL_WORKFLOW_STATES.has(value.state))
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
        || right.revision - left.revision)
    return cloneFrozen(active[0] ?? null)
  }

  async getWorkflowObligation(
    obligationId: string,
  ): Promise<WorkflowObligation | null> {
    return await this.#state.readWorkflow(obligationId)
  }

  async advanceWorkflowObligation(input: {
    readonly obligationId: string
    readonly expectedRevision: number
    readonly state?: WorkflowObligation['state']
    readonly stage?: WorkflowObligation['stage']
    readonly missionId?: WorkflowObligation['missionId']
    readonly taskIds?: readonly TaskId[]
    readonly transitionReason: string
    readonly incrementWakeCursor?: boolean
  }): Promise<WorkflowObligation> {
    return await this.#state.updateWorkflow(
      input.obligationId,
      missingWorkflow(input.obligationId),
      current => {
        if (current.revision !== input.expectedRevision) {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            `workflow ${input.obligationId} expected revision ${input.expectedRevision}, observed ${current.revision}`,
          )
        }
        if (TERMINAL_WORKFLOW_STATES.has(current.state)) {
          throw new MilitaryError(
            'POLICY_DENIED',
            `workflow ${input.obligationId} is already ${current.state}`,
          )
        }
        const nextState = input.state ?? current.state
        assertWorkflowTransition(current.state, nextState)
        const next: WorkflowObligation = {
          ...current,
          state: nextState,
          stage: input.stage ?? current.stage,
          revision: current.revision + 1,
          ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
          taskIds: input.taskIds === undefined
            ? current.taskIds
            : uniqueTaskIds(input.taskIds),
          wakeCursor: current.wakeCursor + (input.incrementWakeCursor === true ? 1 : 0),
          lastTransitionReason: input.transitionReason,
          updatedAt: this.#timestamp(),
        }
        return { next, result: next }
      },
    )
  }

  async settleWorkflowObligation(input: {
    readonly obligationId: string
    readonly expectedRevision: number
    readonly outcome: 'COMPLETED' | 'CANCELLED' | 'FAILED'
    readonly reason: string
  }): Promise<WorkflowObligation> {
    return await this.#state.updateWorkflow(
      input.obligationId,
      missingWorkflow(input.obligationId),
      current => {
        if (TERMINAL_WORKFLOW_STATES.has(current.state)) {
          if (current.state !== input.outcome) {
            throw new MilitaryError(
              'POLICY_DENIED',
              `workflow ${input.obligationId} is ${current.state}, not ${input.outcome}`,
            )
          }
          return { next: current, result: current }
        }
        if (current.revision !== input.expectedRevision) {
          throw new MilitaryError(
            'REVISION_CONFLICT',
            `workflow ${input.obligationId} expected revision ${input.expectedRevision}, observed ${current.revision}`,
          )
        }
        const timestamp = this.#timestamp()
        const next: WorkflowObligation = {
          ...current,
          state: input.outcome,
          stage: 'SUMMARIZE',
          revision: current.revision + 1,
          lastTransitionReason: input.reason,
          updatedAt: timestamp,
          completedAt: timestamp,
        }
        return { next, result: next }
      },
    )
  }

  async reserveTaskDispatch(input: {
    readonly tenantId: string
    readonly missionId: TaskExecutionAttempt['missionId']
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly dispatchKey: string
    readonly payloadHash: string
    readonly cause: TaskExecutionAttempt['cause']
  }): Promise<TaskDispatchReservation> {
    return await this.#state.updateTask(
      input.taskId,
      input.taskVersion,
      () => emptyTaskAggregate(input.taskId, input.taskVersion),
      current => {
        const lineage = current.attempts[0]
        if (lineage !== undefined
          && (lineage.tenantId !== input.tenantId
            || String(lineage.missionId) !== String(input.missionId))) {
          throw new MilitaryError(
            'IDEMPOTENCY_CONFLICT',
            `Task ${String(input.taskId)} version ${Number(input.taskVersion)} belongs to another tenant or Mission`,
          )
        }
        const exact = current.dispatches.find(
          value => value.dispatchKey === input.dispatchKey,
        )
        if (exact !== undefined) {
          if (exact.payloadHash !== input.payloadHash) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              `dispatch key ${input.dispatchKey} was used with different content`,
            )
          }
          return {
            next: current,
            result: reservationFor(current, exact, true),
          }
        }
        const active = newestActiveDispatch(current)
        if (active !== undefined) {
          throw new MilitaryError(
            'RESOURCE_LOCKED',
            `Task ${String(input.taskId)} already has active dispatch ${active.dispatchId}`,
          )
        }
        const timestamp = this.#timestamp()
        const attemptNo = Math.max(
          0,
          ...current.attempts.map(value => value.attemptNo),
        ) + 1
        const base = sha256(stableJson({
          tenantId: input.tenantId,
          missionId: String(input.missionId),
          taskId: String(input.taskId),
          taskVersion: Number(input.taskVersion),
          attemptNo,
        })).slice(0, 40)
        const attemptId = `task-attempt-${base}`
        const activationId = `agent-activation-${base}`
        const dispatchId = `dispatch-${base}-1`
        const attempt: TaskExecutionAttempt = {
          schemaVersion: '1.0.0',
          attemptId,
          tenantId: input.tenantId,
          missionId: input.missionId,
          taskId: input.taskId,
          taskVersion: input.taskVersion,
          attemptNo,
          state: 'RESERVED',
          cause: attemptNo === 1
            ? input.cause
            : input.cause === 'INITIAL'
              ? 'REDISPATCH'
              : input.cause,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const activation: AgentActivation = {
          schemaVersion: '1.0.0',
          activationId,
          attemptId,
          state: 'RESERVED',
          currentDispatchSequence: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const dispatch: DispatchRecord = {
          schemaVersion: '1.0.0',
          dispatchId,
          dispatchKey: input.dispatchKey,
          attemptId,
          activationId,
          sequence: 1,
          payloadHash: input.payloadHash,
          state: 'PENDING',
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const next: TaskExecutionLifecycleAggregate = {
          ...current,
          attempts: [...current.attempts, attempt],
          activations: [...current.activations, activation],
          dispatches: [...current.dispatches, dispatch],
        }
        return {
          next,
          result: { attempt, activation, dispatch, recovered: false },
        }
      },
    )
  }

  async bindActivationAgent(
    activationId: string,
    agent: AgentIdentity,
  ): Promise<AgentActivation> {
    const located = await this.#locateActivation(activationId)
    return await this.#state.updateTask(
      located.taskId,
      located.taskVersion,
      () => located.aggregate,
      current => {
        const activation = requireActivation(current, activationId)
        if (activation.agent !== undefined) {
          if (stableJson(activation.agent) !== stableJson(agent)) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              `activation ${activationId} is already bound to another Agent`,
            )
          }
          return { next: current, result: activation }
        }
        if (TERMINAL_ACTIVATION_STATES.has(activation.state)) {
          throw new MilitaryError(
            'POLICY_DENIED',
            `activation ${activationId} is already ${activation.state}`,
          )
        }
        const nextActivation: AgentActivation = {
          ...activation,
          agent,
          state: activation.state === 'RESERVED' ? 'STARTING' : activation.state,
          updatedAt: this.#timestamp(),
        }
        const next = replaceActivation(current, nextActivation)
        return { next, result: nextActivation }
      },
    )
  }

  async heartbeatActivation(input: {
    readonly activationId: string
    readonly leaseMs?: number
  }): Promise<AgentActivation> {
    const located = await this.#locateActivation(input.activationId)
    return await this.#state.updateTask(
      located.taskId,
      located.taskVersion,
      () => located.aggregate,
      current => {
        const activation = requireActivation(current, input.activationId)
        if (TERMINAL_ACTIVATION_STATES.has(activation.state)) {
          throw new MilitaryError(
            'POLICY_DENIED',
            `activation ${input.activationId} is already ${activation.state}`,
          )
        }
        if (activation.state === 'RESERVED') {
          throw new MilitaryError(
            'POLICY_DENIED',
            `activation ${input.activationId} has not started`,
          )
        }
        const now = this.#clock()
        const timestamp = this.#timestamp(now)
        const nextActivation: AgentActivation = {
          ...activation,
          state: activation.state === 'STARTING'
            ? 'RUNNING'
            : activation.state,
          startedAt: activation.startedAt ?? timestamp,
          heartbeatSequence: (activation.heartbeatSequence ?? 0) + 1,
          lastHeartbeatAt: timestamp,
          heartbeatExpiresAt: this.#timestamp(
            new Date(now.getTime() + boundedHeartbeatLease(
              input.leaseMs ?? this.#heartbeatLeaseMs,
            )),
          ),
          updatedAt: timestamp,
        }
        let next = replaceActivation(current, nextActivation)
        const attempt = requireAttempt(next, activation.attemptId)
        if (attempt.state === 'DISPATCHING') {
          next = replaceAttempt(next, {
            ...attempt,
            state: 'RUNNING',
            updatedAt: timestamp,
          })
        }
        return { next, result: nextActivation }
      },
    )
  }

  async reconcileExpiredActivations(input?: {
    readonly observedAt?: ReturnType<typeof brand<string, 'IsoDateTime'>>
  }): Promise<readonly AgentActivation[]> {
    const observedAt = input?.observedAt ?? this.#timestamp()
    const cutoff = Date.parse(String(observedAt))
    if (!Number.isFinite(cutoff)) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        'activation reconciliation observedAt must be an ISO timestamp',
      )
    }
    const expired: AgentActivation[] = []
    for (const aggregate of await this.#state.listTasks()) {
      for (const activation of aggregate.activations) {
        if (TERMINAL_ACTIVATION_STATES.has(activation.state)
          || activation.state === 'RESERVED') continue
        const leaseEnd = activation.heartbeatExpiresAt
          ?? this.#timestamp(new Date(
            Date.parse(String(activation.updatedAt)) + this.#heartbeatLeaseMs,
          ))
        if (Date.parse(String(leaseEnd)) > cutoff) continue
        try {
          expired.push(await this.settleActivation({
            activationId: activation.activationId,
            outcome: 'LOST',
            reason: 'ACTIVATION_HEARTBEAT_EXPIRED',
            settlementReceiptId: `activation-heartbeat-expired-${sha256(
              stableJson({
                activationId: activation.activationId,
                heartbeatSequence: activation.heartbeatSequence ?? 0,
                leaseEnd: String(leaseEnd),
              }),
            ).slice(0, 40)}`,
          }))
        } catch (error) {
          const latest = await this.getActivation(activation.activationId)
          if (latest !== null && TERMINAL_ACTIVATION_STATES.has(latest.state)) {
            continue
          }
          throw error
        }
      }
    }
    return cloneFrozen(expired)
  }

  async markDispatch(input: {
    readonly dispatchId: string
    readonly state: DispatchState
    readonly childSessionId?: SessionId
    readonly transportReceiptId?: string
    readonly failureCode?: string
  }): Promise<DispatchRecord> {
    const located = await this.#locateDispatch(input.dispatchId)
    return await this.#state.updateTask(
      located.taskId,
      located.taskVersion,
      () => located.aggregate,
      current => {
        const dispatch = requireDispatch(current, input.dispatchId)
        if (dispatch.state === input.state) {
          if (!sameOptionalDispatchFields(dispatch, input)) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              `dispatch ${input.dispatchId} already recorded ${input.state} with different transport fields`,
            )
          }
          return { next: current, result: dispatch }
        }
        assertDispatchTransition(dispatch.state, input.state)
        const timestamp = this.#timestamp()
        const nextDispatch: DispatchRecord = {
          ...dispatch,
          state: input.state,
          ...(input.childSessionId === undefined
            ? {}
            : { childSessionId: input.childSessionId }),
          ...(input.transportReceiptId === undefined
            ? {}
            : { transportReceiptId: input.transportReceiptId }),
          ...(input.failureCode === undefined
            ? {}
            : { failureCode: input.failureCode }),
          updatedAt: timestamp,
        }
        let next = replaceDispatch(current, nextDispatch)
        const activation = requireActivation(next, dispatch.activationId)
        const attempt = requireAttempt(next, dispatch.attemptId)
        if (input.state === 'ACCEPTED') {
          assertActivationTransition(activation.state, 'STARTING')
          assertAttemptTransition(attempt.state, 'DISPATCHING')
          next = replaceActivation(next, {
            ...activation,
            state: 'STARTING',
            updatedAt: timestamp,
          })
          next = replaceAttempt(next, {
            ...attempt,
            state: 'DISPATCHING',
            updatedAt: timestamp,
          })
        } else if (input.state === 'STARTED') {
          assertActivationStartTransition(activation.state)
          assertAttemptStartTransition(attempt.state)
          const heartbeatExpiresAt = this.#timestamp(new Date(
            this.#clock().getTime() + this.#heartbeatLeaseMs,
          ))
          next = replaceActivation(next, {
            ...activation,
            state: 'RUNNING',
            startedAt: activation.startedAt ?? timestamp,
            heartbeatSequence: (activation.heartbeatSequence ?? 0) + 1,
            lastHeartbeatAt: timestamp,
            heartbeatExpiresAt,
            updatedAt: timestamp,
          })
          next = replaceAttempt(next, {
            ...attempt,
            state: 'RUNNING',
            updatedAt: timestamp,
          })
        } else if (input.state === 'RECOVERY_REQUIRED') {
          assertActivationTransition(activation.state, 'LOST')
          assertAttemptTransition(attempt.state, 'LOST')
          next = replaceActivation(next, {
            ...activation,
            state: 'LOST',
            settledAt: timestamp,
            settlementReason: input.failureCode ?? input.state,
            updatedAt: timestamp,
          })
          next = replaceAttempt(next, {
            ...attempt,
            state: 'LOST',
            settledAt: timestamp,
            settlementReason: input.failureCode ?? input.state,
            updatedAt: timestamp,
          })
        } else if (input.state === 'FAILED' || input.state === 'CANCELLED') {
          const outcome = input.state === 'FAILED' ? 'FAILED' : 'CANCELLED'
          assertActivationTransition(activation.state, outcome)
          assertAttemptTransition(attempt.state, outcome)
          next = replaceActivation(next, {
            ...activation,
            state: outcome,
            settledAt: timestamp,
            settlementReason: input.failureCode ?? input.state,
            updatedAt: timestamp,
          })
          next = replaceAttempt(next, {
            ...attempt,
            state: outcome,
            settledAt: timestamp,
            settlementReason: input.failureCode ?? input.state,
            updatedAt: timestamp,
          })
        } else if (input.state === 'SETTLED'
          && (activation.state !== 'SETTLED' || attempt.state !== 'SETTLED')) {
          throw new MilitaryError(
            'POLICY_DENIED',
            `dispatch ${input.dispatchId} must be settled through its Activation`,
          )
        }
        return { next, result: nextDispatch }
      },
    )
  }

  async settleActivation(input: {
    readonly activationId: string
    readonly outcome: 'SETTLED' | 'FAILED' | 'CANCELLED' | 'LOST'
    readonly reason: string
    readonly settlementReceiptId: string
  }): Promise<AgentActivation> {
    const located = await this.#locateActivation(input.activationId)
    return await this.#state.updateTask(
      located.taskId,
      located.taskVersion,
      () => located.aggregate,
      current => {
        const activation = requireActivation(current, input.activationId)
        if (TERMINAL_ACTIVATION_STATES.has(activation.state)) {
          if (activation.state !== input.outcome
            || activation.settlementReceiptId !== input.settlementReceiptId) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              `activation ${input.activationId} has another settlement`,
            )
          }
          return { next: current, result: activation }
        }
        const timestamp = this.#timestamp()
        assertActivationTransition(activation.state, input.outcome)
        const nextActivation: AgentActivation = {
          ...activation,
          state: input.outcome,
          settlementReason: input.reason,
          settlementReceiptId: input.settlementReceiptId,
          settledAt: timestamp,
          updatedAt: timestamp,
        }
        let next = replaceActivation(current, nextActivation)
        const attempt = requireAttempt(next, activation.attemptId)
        const attemptState = input.outcome === 'SETTLED'
          ? 'SETTLED'
          : input.outcome
        assertAttemptTransition(attempt.state, attemptState)
        next = replaceAttempt(next, {
          ...attempt,
          state: attemptState,
          settlementReason: input.reason,
          settledAt: timestamp,
          updatedAt: timestamp,
        })
        const dispatch = next.dispatches
          .filter(value => value.activationId === input.activationId)
          .sort((left, right) => right.sequence - left.sequence)[0]
        if (dispatch !== undefined) {
          next = replaceDispatch(next, {
            ...dispatch,
            state: input.outcome === 'SETTLED'
              ? 'SETTLED'
              : input.outcome === 'LOST'
                ? 'RECOVERY_REQUIRED'
                : input.outcome,
            settlementReceiptId: input.settlementReceiptId,
            updatedAt: timestamp,
          })
        }
        return { next, result: nextActivation }
      },
    )
  }

  async getAttempt(
    attemptId: string,
  ): Promise<TaskExecutionAttempt | null> {
    for (const aggregate of await this.#state.listTasks()) {
      const value = aggregate.attempts.find(item => item.attemptId === attemptId)
      if (value !== undefined) return cloneFrozen(value)
    }
    return null
  }

  async getActivation(
    activationId: string,
  ): Promise<AgentActivation | null> {
    for (const aggregate of await this.#state.listTasks()) {
      const value = aggregate.activations.find(
        item => item.activationId === activationId,
      )
      if (value !== undefined) return cloneFrozen(value)
    }
    return null
  }

  async getDispatch(dispatchId: string): Promise<DispatchRecord | null> {
    for (const aggregate of await this.#state.listTasks()) {
      const value = aggregate.dispatches.find(
        item => item.dispatchId === dispatchId,
      )
      if (value !== undefined) return cloneFrozen(value)
    }
    return null
  }

  async activeDispatchForTask(
    taskId: TaskId,
    taskVersion: TaskVersion,
  ): Promise<TaskDispatchReservation | null> {
    const aggregate = await this.#state.readTask(taskId, taskVersion)
    if (aggregate === null) return null
    const dispatch = newestActiveDispatch(aggregate)
    return dispatch === undefined
      ? null
      : cloneFrozen(reservationFor(aggregate, dispatch, true))
  }

  async #locateActivation(activationId: string): Promise<{
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly aggregate: TaskExecutionLifecycleAggregate
  }> {
    for (const aggregate of await this.#state.listTasks()) {
      if (aggregate.activations.some(value =>
        value.activationId === activationId)) {
        return {
          taskId: aggregate.taskId,
          taskVersion: aggregate.taskVersion,
          aggregate,
        }
      }
    }
    throw new MilitaryError('NOT_FOUND', `unknown activation ${activationId}`)
  }

  async #locateDispatch(dispatchId: string): Promise<{
    readonly taskId: TaskId
    readonly taskVersion: TaskVersion
    readonly aggregate: TaskExecutionLifecycleAggregate
  }> {
    for (const aggregate of await this.#state.listTasks()) {
      if (aggregate.dispatches.some(value => value.dispatchId === dispatchId)) {
        return {
          taskId: aggregate.taskId,
          taskVersion: aggregate.taskVersion,
          aggregate,
        }
      }
    }
    throw new MilitaryError('NOT_FOUND', `unknown dispatch ${dispatchId}`)
  }

  #timestamp(
    value = this.#clock(),
  ): ReturnType<typeof brand<string, 'IsoDateTime'>> {
    return brand<string, 'IsoDateTime'>(value.toISOString())
  }
}

/**
 * SQLite computes domain mutations outside its short write transaction and
 * therefore may surface a storage CAS race. Re-evaluating the same pure
 * transition on the latest aggregate makes exact retries idempotent, while
 * expected-revision/domain conflicts remain conflicts after the bounded
 * retry. This also gives in-memory and durable providers one caller contract.
 */
class RevisionRetryExecutionLifecycleStateStore
implements ExecutionLifecycleStateStore {
  readonly #delegate: ExecutionLifecycleStateStore

  constructor(delegate: ExecutionLifecycleStateStore) {
    this.#delegate = delegate
  }

  async readWorkflow(
    obligationId: string,
  ): Promise<WorkflowObligation | null> {
    return await this.#delegate.readWorkflow(obligationId)
  }

  async listWorkflows(): Promise<readonly WorkflowObligation[]> {
    return await this.#delegate.listWorkflows()
  }

  async updateWorkflow<R>(
    obligationId: string,
    initial: () => WorkflowObligation,
    mutate: (
      current: WorkflowObligation,
    ) => Promise<{ readonly next: WorkflowObligation; readonly result: R }>
      | { readonly next: WorkflowObligation; readonly result: R },
  ): Promise<R> {
    return await retryRevisionConflict(async () =>
      await this.#delegate.updateWorkflow<R>(
        obligationId,
        initial,
        mutate,
      ))
  }

  async readTask(
    taskId: TaskId,
    taskVersion: TaskVersion,
  ): Promise<TaskExecutionLifecycleAggregate | null> {
    return await this.#delegate.readTask(taskId, taskVersion)
  }

  async listTasks(): Promise<readonly TaskExecutionLifecycleAggregate[]> {
    return await this.#delegate.listTasks()
  }

  async updateTask<R>(
    taskId: TaskId,
    taskVersion: TaskVersion,
    initial: () => TaskExecutionLifecycleAggregate,
    mutate: (
      current: TaskExecutionLifecycleAggregate,
    ) => Promise<{
      readonly next: TaskExecutionLifecycleAggregate
      readonly result: R
    }> | {
      readonly next: TaskExecutionLifecycleAggregate
      readonly result: R
    },
  ): Promise<R> {
    return await retryRevisionConflict(async () =>
      await this.#delegate.updateTask<R>(
        taskId,
        taskVersion,
        initial,
        mutate,
      ))
  }
}

async function retryRevisionConflict<R>(
  operation: () => Promise<R>,
): Promise<R> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof MilitaryError)
        || error.failure.code !== 'REVISION_CONFLICT'
        || attempt >= MAX_REVISION_ATTEMPTS) throw error
    }
  }
}

function boundedHeartbeatLease(value: number): number {
  if (!Number.isFinite(value)) return 300_000
  return Math.max(30_000, Math.min(3_600_000, Math.floor(value)))
}

function emptyTaskAggregate(
  taskId: TaskId,
  taskVersion: TaskVersion,
): TaskExecutionLifecycleAggregate {
  return {
    schemaVersion: '1.0.0',
    taskId,
    taskVersion,
    attempts: [],
    activations: [],
    dispatches: [],
  }
}

function reservationFor(
  aggregate: TaskExecutionLifecycleAggregate,
  dispatch: DispatchRecord,
  recovered: boolean,
): TaskDispatchReservation {
  return {
    attempt: requireAttempt(aggregate, dispatch.attemptId),
    activation: requireActivation(aggregate, dispatch.activationId),
    dispatch,
    recovered,
  }
}

function newestActiveDispatch(
  aggregate: TaskExecutionLifecycleAggregate,
): DispatchRecord | undefined {
  return aggregate.dispatches
    .filter(value => !TERMINAL_DISPATCH_STATES.has(value.state))
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
      || right.sequence - left.sequence)[0]
}

function replaceAttempt(
  aggregate: TaskExecutionLifecycleAggregate,
  value: TaskExecutionAttempt,
): TaskExecutionLifecycleAggregate {
  return {
    ...aggregate,
    attempts: aggregate.attempts.map(item =>
      item.attemptId === value.attemptId ? value : item),
  }
}

function replaceActivation(
  aggregate: TaskExecutionLifecycleAggregate,
  value: AgentActivation,
): TaskExecutionLifecycleAggregate {
  return {
    ...aggregate,
    activations: aggregate.activations.map(item =>
      item.activationId === value.activationId ? value : item),
  }
}

function replaceDispatch(
  aggregate: TaskExecutionLifecycleAggregate,
  value: DispatchRecord,
): TaskExecutionLifecycleAggregate {
  return {
    ...aggregate,
    dispatches: aggregate.dispatches.map(item =>
      item.dispatchId === value.dispatchId ? value : item),
  }
}

function requireAttempt(
  aggregate: TaskExecutionLifecycleAggregate,
  attemptId: string,
): TaskExecutionAttempt {
  const value = aggregate.attempts.find(item => item.attemptId === attemptId)
  if (value === undefined) {
    throw new MilitaryError('PERSISTENCE_FAILED', `missing attempt ${attemptId}`)
  }
  return value
}

function requireActivation(
  aggregate: TaskExecutionLifecycleAggregate,
  activationId: string,
): AgentActivation {
  const value = aggregate.activations.find(item =>
    item.activationId === activationId)
  if (value === undefined) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      `missing activation ${activationId}`,
    )
  }
  return value
}

function requireDispatch(
  aggregate: TaskExecutionLifecycleAggregate,
  dispatchId: string,
): DispatchRecord {
  const value = aggregate.dispatches.find(item => item.dispatchId === dispatchId)
  if (value === undefined) {
    throw new MilitaryError('PERSISTENCE_FAILED', `missing dispatch ${dispatchId}`)
  }
  return value
}

function taskAggregateKey(taskId: TaskId, taskVersion: TaskVersion): string {
  return `${String(taskId)}@${Number(taskVersion)}`
}

function missingWorkflow(
  obligationId: string,
): () => WorkflowObligation {
  return () => {
    throw new MilitaryError('NOT_FOUND', `unknown workflow ${obligationId}`)
  }
}

function uniqueTaskIds(taskIds: readonly TaskId[]): readonly TaskId[] {
  return [...new Map(taskIds.map(value => [String(value), value])).values()]
}

function assertWorkflowTransition(
  from: WorkflowObligation['state'],
  to: WorkflowObligation['state'],
): void {
  if (from === to) return
  const allowed = workflowObligationTransitions[from]
  if (!allowed.includes(to)) {
    throw new MilitaryError(
      'POLICY_DENIED',
      `workflow cannot transition ${from} -> ${to}`,
    )
  }
}

function assertDispatchTransition(from: DispatchState, to: DispatchState): void {
  if (from === to) return
  if (TERMINAL_DISPATCH_STATES.has(from)
    || !dispatchTransitions[from].includes(to)) {
    throw new MilitaryError(
      'POLICY_DENIED',
      `dispatch cannot transition ${from} -> ${to}`,
    )
  }
}

function assertActivationTransition(
  from: AgentActivation['state'],
  to: AgentActivation['state'],
): void {
  if (from === to) return
  if (!agentActivationTransitions[from].includes(to)) {
    throw new MilitaryError(
      'POLICY_DENIED',
      `Activation cannot transition ${from} -> ${to}`,
    )
  }
}

function assertAttemptTransition(
  from: TaskExecutionAttempt['state'],
  to: TaskExecutionAttempt['state'],
): void {
  if (from === to) return
  if (!taskExecutionAttemptTransitions[from].includes(to)) {
    throw new MilitaryError(
      'POLICY_DENIED',
      `Attempt cannot transition ${from} -> ${to}`,
    )
  }
}

function assertActivationStartTransition(
  from: AgentActivation['state'],
): void {
  if (from === 'RESERVED') {
    // Dispatch may move PENDING -> STARTED atomically; represent the valid
    // RESERVED -> STARTING -> RUNNING path inside the same aggregate update.
    return
  }
  assertActivationTransition(from, 'RUNNING')
}

function assertAttemptStartTransition(
  from: TaskExecutionAttempt['state'],
): void {
  if (from === 'RESERVED') {
    // Mirrors the atomic PENDING -> STARTED transport acknowledgement.
    return
  }
  assertAttemptTransition(from, 'RUNNING')
}

function sameOptionalDispatchFields(
  current: DispatchRecord,
  input: {
    readonly childSessionId?: SessionId
    readonly transportReceiptId?: string
    readonly failureCode?: string
  },
): boolean {
  return optionalSessionId(current.childSessionId) === optionalSessionId(
    input.childSessionId,
  )
    && current.transportReceiptId === input.transportReceiptId
    && current.failureCode === input.failureCode
}

function optionalSessionId(value: SessionId | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

const TERMINAL_WORKFLOW_STATES = new Set<WorkflowObligation['state']>([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
])

const TERMINAL_ACTIVATION_STATES = new Set<AgentActivation['state']>([
  'SETTLED',
  'FAILED',
  'CANCELLED',
  'LOST',
])

const TERMINAL_DISPATCH_STATES = new Set<DispatchState>([
  'SETTLED',
  'RECOVERY_REQUIRED',
  'FAILED',
  'CANCELLED',
])

const MAX_REVISION_ATTEMPTS = 3
