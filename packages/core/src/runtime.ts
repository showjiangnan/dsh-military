import {
  MilitaryError,
  missionEvent,
  type AgentIdentity,
  type BrainstormOrder,
  type CandidateSubmission,
  type MilitaryBrainstorm,
  type MilitaryLedger,
  type MilitaryRuntime,
  type MissionId,
  type Revision,
  type SessionId,
  type TaskId,
  type TaskOrder,
  type TaskState,
  type VerificationReceipt, type IntegrationReceipt,
  type MissionEventPayloadMap,
  type MissionEvent,
  type MissionEventType,
  type MilitaryVerification,
  type MilitaryDecisionBrokerV2,
  type MilitaryRadio,
  brand,
} from '@dsh-military/contracts'
import { OversightController } from './oversight.js'
import { cloneFrozen, sha256, stableJson } from './util.js'
import { reduceTaskTransition } from './task-reducer.js'
import { MilitaryPlanningEngine } from './planning.js'

export interface RuntimeTaskRecord {
  order: TaskOrder
  state: TaskState
  worker?: AgentIdentity
  candidate?: CandidateSubmission
  verification?: VerificationReceipt
  pendingGuidance?: import('@dsh-military/contracts').TacticalGuidance
  pendingRadioRequestId?: string
  pendingDecisionSetId?: string
  pendingDecisionAnswer?: {
    readonly decisionSetId: string
    readonly answerReceiptRef: string
    readonly resolvedAt: import('@dsh-military/contracts').IsoDateTime
  }
  integration?: IntegrationReceipt
  specsCommit?: {
    readonly commit: string
    readonly treeHash: string
    readonly changedPaths: readonly string[]
  }
  createdAt?: string
}

export interface RuntimeMissionRecord {
  readonly missionId: MissionId
  readonly rootSessionId: SessionId
  readonly general: AgentIdentity
}

/** Durable projection seam used by the runtime instead of process-local Maps. */
export interface MilitaryRuntimeStateStore {
  getMission(rootSessionId: SessionId): Promise<RuntimeMissionRecord | null>
  putMission(mission: RuntimeMissionRecord): Promise<void>
  getTask(taskId: TaskId): Promise<RuntimeTaskRecord | null>
  createTask(task: RuntimeTaskRecord): Promise<void>
  putTask(task: RuntimeTaskRecord): Promise<void>
  listTasks(): Promise<readonly RuntimeTaskRecord[]>
}

/** Test/default provider; production composes the SQLite implementation. */
export class InMemoryMilitaryRuntimeStateStore implements MilitaryRuntimeStateStore {
  readonly #missions = new Map<string, RuntimeMissionRecord>()
  readonly #tasks = new Map<string, RuntimeTaskRecord>()

  async getMission(rootSessionId: SessionId): Promise<RuntimeMissionRecord | null> {
    const value = this.#missions.get(String(rootSessionId))
    return value === undefined ? null : cloneFrozen(value)
  }

  async putMission(mission: RuntimeMissionRecord): Promise<void> {
    const key = String(mission.rootSessionId)
    const current = this.#missions.get(key)
    if (current !== undefined && stableJson(current) !== stableJson(mission)) {
      throw new MilitaryError('REVISION_CONFLICT', `root session ${key} is already bound to another Mission`)
    }
    this.#missions.set(key, cloneFrozen(mission))
  }

  async getTask(taskId: TaskId): Promise<RuntimeTaskRecord | null> {
    const value = this.#tasks.get(String(taskId))
    return value === undefined ? null : cloneFrozen(value)
  }

  async createTask(task: RuntimeTaskRecord): Promise<void> {
    const key = String(task.order.taskId)
    if (this.#tasks.has(key)) throw new MilitaryError('REVISION_CONFLICT', `task ${key} already exists`)
    this.#tasks.set(key, cloneFrozen(task))
  }

  async putTask(task: RuntimeTaskRecord): Promise<void> {
    const key = String(task.order.taskId)
    if (!this.#tasks.has(key)) throw new MilitaryError('NOT_FOUND', `unknown task ${key}`)
    this.#tasks.set(key, cloneFrozen(task))
  }

  async listTasks(): Promise<readonly RuntimeTaskRecord[]> {
    return cloneFrozen([...this.#tasks.values()])
  }
}

export class MilitaryOrchestrator implements MilitaryRuntime {
  readonly #ledger: MilitaryLedger
  readonly #verification: MilitaryVerification
  readonly #oversight: OversightController
  readonly #brainstorm: MilitaryBrainstorm
  readonly #state: MilitaryRuntimeStateStore
  readonly #radio: Pick<MilitaryRadio, 'expire'> | undefined
  readonly #decisions: Pick<MilitaryDecisionBrokerV2, 'expire'> | undefined
  readonly #taskCache = new Map<string, RuntimeTaskRecord>()
  readonly #planning = new MilitaryPlanningEngine()

  constructor(input: {
    readonly ledger: MilitaryLedger
    readonly verification: MilitaryVerification
    readonly oversight: OversightController
    readonly brainstorm: MilitaryBrainstorm
    readonly state?: MilitaryRuntimeStateStore
    readonly radio?: Pick<MilitaryRadio, 'expire'>
    readonly decisions?: Pick<MilitaryDecisionBrokerV2, 'expire'>
  }) {
    this.#ledger = input.ledger
    this.#verification = input.verification
    this.#oversight = input.oversight
    this.#brainstorm = input.brainstorm
    this.#state = input.state ?? new InMemoryMilitaryRuntimeStateStore()
    this.#radio = input.radio
    this.#decisions = input.decisions
  }

  async registerMission(input: RuntimeMissionRecord & { readonly title: string; readonly authorityContextRef: string }): Promise<void> {
    await this.#append(input.missionId, input.general, 'mission/started', {
      title: input.title,
      rootSessionId: String(input.rootSessionId),
      authorityContextRef: input.authorityContextRef,
    }, `mission-start:${String(input.missionId)}`)
    await this.#state.putMission({
      missionId: input.missionId,
      rootSessionId: input.rootSessionId,
      general: input.general,
    })
  }

  async missionForSession(rootSessionId: SessionId): Promise<MissionId | null> {
    const cached = await this.#state.getMission(rootSessionId)
    if (cached !== null) return cached.missionId
    const recovered = await this.#ledger.findMissionByRootSession(rootSessionId)
    if (recovered === null) return null
    await this.#state.putMission({
      missionId: recovered.missionId,
      rootSessionId,
      general: recovered.general,
    })
    return recovered.missionId
  }

  async recordEvent<T extends MissionEventType>(input: {
    readonly missionId: MissionId
    readonly actor: AgentIdentity
    readonly type: T
    readonly payload: MissionEventPayloadMap[T]
    readonly idempotencyKey: string
  }): Promise<void> {
    await this.#append(input.missionId, input.actor, input.type, input.payload, input.idempotencyKey)
  }

  async submitBlocker(input: {
    readonly taskId: TaskId
    readonly taskVersion: import('@dsh-military/contracts').TaskVersion
    readonly actor: AgentIdentity
    readonly blockerId: string
    readonly evidenceRefs: readonly string[]
    readonly requestId?: string
  }): Promise<void> {
    const task = await this.#requireTask(input.taskId)
    if (Number(task.order.taskVersion) !== Number(input.taskVersion)) throw new MilitaryError('CANDIDATE_STALE')
    if (task.worker === undefined || !sameAgent(task.worker, input.actor)) throw new MilitaryError('UNAUTHORIZED')
    this.#oversight.requireAdmission(input.actor)
    this.#transition(task, 'BLOCKED')
    if (input.requestId !== undefined) {
      task.pendingRadioRequestId = input.requestId
    }
    await this.#append(task.order.missionId, input.actor, 'task/blocker-submitted', {
      taskId: String(input.taskId), taskVersion: Number(input.taskVersion), blockerId: input.blockerId,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      evidenceRefs: [...input.evidenceRefs],
    }, `task-blocker:${input.blockerId}`)
    await this.#storeTask(task)
  }

  async applyGuidance(input: {
    readonly taskId: TaskId
    readonly taskVersion: import('@dsh-military/contracts').TaskVersion
    readonly guidance: import('@dsh-military/contracts').TacticalGuidance
    readonly actor: AgentIdentity
  }): Promise<void> {
    const task = await this.#requireTask(input.taskId)
    if (Number(task.order.taskVersion) !== Number(input.taskVersion)
      || Number(input.guidance.expectedTaskVersion) !== Number(input.taskVersion)) {
      throw new MilitaryError('GUIDANCE_STALE')
    }
    if (task.state === 'READY'
      && String(task.pendingGuidance?.guidanceId ?? '') === String(input.guidance.guidanceId)) {
      return
    }
    if (task.state !== 'BLOCKED') {
      throw new MilitaryError(
        'POLICY_DENIED',
        `Task guidance requires BLOCKED, observed ${task.state}`,
      )
    }
    this.#transition(task, 'GUIDANCE_PENDING')
    await this.#append(task.order.missionId, input.actor, 'radio/guidance-issued', {
      guidanceId: String(input.guidance.guidanceId),
      requestId: String(input.guidance.requestId),
      advisorId: String(input.actor.agentId),
      skillRefs: [...input.guidance.selectedSkills],
    }, `radio-guidance-issued:${String(input.guidance.guidanceId)}`)
    task.pendingGuidance = cloneFrozen(input.guidance)
    delete task.pendingRadioRequestId
    this.#transition(task, 'READY')
    await this.#append(task.order.missionId, input.actor, 'radio/guidance-delivered', {
      guidanceId: String(input.guidance.guidanceId),
      taskId: String(input.taskId),
      taskVersion: Number(input.taskVersion),
      deliveryReceiptRef: `runtime-guidance:${String(input.guidance.guidanceId)}`,
    }, `radio-guidance-delivered:${String(input.guidance.guidanceId)}`)
    await this.#storeTask(task)
  }

  async pendingGuidance(
    taskId: TaskId,
  ): Promise<import('@dsh-military/contracts').TacticalGuidance | null> {
    const task = await this.#requireTask(taskId)
    return cloneFrozen(task.pendingGuidance ?? null)
  }

  async acknowledgeGuidance(
    taskId: TaskId,
    guidanceId: string,
    worker: AgentIdentity,
  ): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.worker === undefined || !sameAgent(task.worker, worker)) {
      throw new MilitaryError('UNAUTHORIZED')
    }
    if (String(task.pendingGuidance?.guidanceId ?? '') !== guidanceId) {
      throw new MilitaryError('GUIDANCE_STALE')
    }
    delete task.pendingGuidance
    await this.#storeTask(task)
  }

  async deadLetterGuidanceWait(input: {
    readonly requestId: string
    readonly reason: 'REQUEST_EXPIRED' | 'LEASE_ATTEMPTS_EXHAUSTED'
    readonly actor: AgentIdentity
  }): Promise<TaskId | null> {
    const storedTask = (await this.#state.listTasks()).find(value =>
      value.pendingRadioRequestId === input.requestId)
    if (storedTask === undefined) return null
    const task: RuntimeTaskRecord = { ...storedTask }
    if (task.state !== 'BLOCKED') return null
    delete task.pendingRadioRequestId
    await this.#append(task.order.missionId, input.actor, 'radio/dead-lettered', {
      requestId: input.requestId,
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      reason: input.reason,
    }, `radio-dead-lettered:${input.requestId}:${input.reason}`)
    await this.#storeTask(task)
    return task.order.taskId
  }

  async waitForDecision(input: {
    readonly taskId: TaskId
    readonly taskVersion: import('@dsh-military/contracts').TaskVersion
    readonly decisionSetId: string
    readonly actor: AgentIdentity
  }): Promise<void> {
    const task = await this.#requireTask(input.taskId)
    if (Number(task.order.taskVersion) !== Number(input.taskVersion)) {
      throw new MilitaryError('STALE_TASK_VERSION')
    }
    if (task.worker === undefined || !sameAgent(task.worker, input.actor)) {
      throw new MilitaryError('UNAUTHORIZED')
    }
    if (task.state === 'WAITING_DECISION'
      && task.pendingDecisionSetId === input.decisionSetId) {
      return
    }
    this.#transition(task, 'WAITING_DECISION')
    task.pendingDecisionSetId = input.decisionSetId
    await this.#append(task.order.missionId, input.actor, 'task/decision-waiting', {
      taskId: String(input.taskId),
      taskVersion: Number(input.taskVersion),
      decisionSetId: input.decisionSetId,
    }, `task-decision-waiting:${input.decisionSetId}`)
    await this.#storeTask(task)
  }

  async resolveDecision(input: {
    readonly decisionSetId: string
    readonly answerReceiptRef: string
    readonly actor: AgentIdentity
  }): Promise<TaskId | null> {
    const storedTask = (await this.#state.listTasks()).find(value =>
      value.pendingDecisionSetId === input.decisionSetId)
    if (storedTask === undefined) return null
    const task: RuntimeTaskRecord = { ...storedTask }
    if (task.state !== 'WAITING_DECISION') {
      throw new MilitaryError(
        'POLICY_DENIED',
        `decision ${input.decisionSetId} is attached to Task state ${task.state}`,
      )
    }
    this.#transition(task, 'READY')
    delete task.pendingDecisionSetId
    task.pendingDecisionAnswer = {
      decisionSetId: input.decisionSetId,
      answerReceiptRef: input.answerReceiptRef,
      resolvedAt: new Date().toISOString() as import(
        '@dsh-military/contracts'
      ).IsoDateTime,
    }
    await this.#append(task.order.missionId, input.actor, 'task/decision-resolved', {
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      decisionSetId: input.decisionSetId,
      answerReceiptRef: input.answerReceiptRef,
    }, `task-decision-resolved:${input.decisionSetId}:${input.answerReceiptRef}`)
    await this.#storeTask(task)
    return task.order.taskId
  }

  async pendingDecisionAnswer(taskId: TaskId): Promise<{
    readonly decisionSetId: string
    readonly answerReceiptRef: string
    readonly resolvedAt: import('@dsh-military/contracts').IsoDateTime
  } | null> {
    const task = await this.#requireTask(taskId)
    return cloneFrozen(task.pendingDecisionAnswer ?? null)
  }

  async acknowledgeDecisionAnswer(
    taskId: TaskId,
    decisionSetId: string,
    worker: AgentIdentity,
  ): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.worker === undefined || !sameAgent(task.worker, worker)) {
      throw new MilitaryError('UNAUTHORIZED')
    }
    const pending = task.pendingDecisionAnswer
    if (
      pending === undefined
      || pending.decisionSetId !== decisionSetId
    ) {
      throw new MilitaryError('DECISION_SET_STALE')
    }
    delete task.pendingDecisionAnswer
    await this.#append(task.order.missionId, worker, 'decision/answer-acknowledged', {
      decisionSetId,
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      answerReceiptRef: pending.answerReceiptRef,
      acknowledgedBy: String(worker.agentId),
    }, `decision-answer-acknowledged:${decisionSetId}:${String(
      worker.agentId,
    )}@${worker.generation}`)
    await this.#storeTask(task)
  }

  async expireDecisionWait(input: {
    readonly decisionSetId: string
    readonly reason: 'TTL' | 'TASK_VERSION_CHANGED' | 'MISSION_CANCELLED'
      | 'SUPERSEDED' | 'ORIGIN_AGENT_GONE'
    readonly actor: AgentIdentity
  }): Promise<TaskId | null> {
    const storedTask = (await this.#state.listTasks()).find(value =>
      value.pendingDecisionSetId === input.decisionSetId)
    if (storedTask === undefined) return null
    const task: RuntimeTaskRecord = { ...storedTask }
    if (task.state !== 'WAITING_DECISION') return null
    this.#transition(task, 'BLOCKED')
    delete task.pendingDecisionSetId
    await this.#append(task.order.missionId, input.actor, 'decision/expired', {
      decisionSetId: input.decisionSetId,
      reason: input.reason,
    }, `decision-expired:${input.decisionSetId}:${input.reason}`)
    await this.#storeTask(task)
    return task.order.taskId
  }

  async registerTask(order: TaskOrder, actor: AgentIdentity): Promise<void> {
    await this.#requireMissionOpen(order.missionId)
    const key = String(order.taskId)
    if (await this.#state.getTask(order.taskId) !== null) throw new MilitaryError('REVISION_CONFLICT', `task ${key} already exists`)
    const existing = (await this.#state.listTasks())
      .filter(value => String(value.order.missionId) === String(order.missionId))
    this.#planning.requireValid([...existing.map(value => value.order), order])
    const events = await this.#ledger.readEvents(order.missionId)
    if (!events.some(event =>
      event.type === 'direction/ratified'
      && event.payload.directionId === String(order.directionId))) {
      await this.#append(order.missionId, actor, 'direction/ratified', {
        directionId: String(order.directionId),
        directionPlanRef: `direction-plan-${String(order.directionId)}`,
        staffCouncilRef: `staff-council-${String(order.directionId)}`,
      }, `direction-ratified:${String(order.directionId)}`)
    }
    const snapshotBefore = await this.#ledger.readMission(order.missionId)
    if (existing.length === 0 && snapshotBefore.activeWaveIds.length === 0) {
      await this.#append(order.missionId, actor, 'wave/opened', {
        directionId: String(order.directionId),
        waveId: String(order.waveId),
        wavePlanRef: `wave-plan-${String(order.waveId)}`,
      }, `wave-opened:${String(order.waveId)}`)
    }
    await this.#append(order.missionId, actor, 'task/created', {
      taskId: key,
      taskVersion: Number(order.taskVersion),
      taskOrderRef: `task-order:${key}@${Number(order.taskVersion)}`,
    }, `task-created:${key}:${Number(order.taskVersion)}`)
    const task: RuntimeTaskRecord = {
      order: cloneFrozen(order),
      state: 'CREATED',
      createdAt: new Date().toISOString(),
    }
    await this.#state.createTask(task)
    this.#taskCache.set(key, cloneFrozen(task))
    await this.#scheduleMission(order.missionId)
  }

  async completeMission(
    missionId: MissionId,
    actor: AgentIdentity,
  ): Promise<void> {
    const missionState = await this.#missionTerminalState(missionId)
    if (missionState === 'COMPLETED') return
    if (missionState === 'CANCELLED') {
      throw new MilitaryError(
        'POLICY_DENIED',
        'a cancelled Mission cannot be completed',
      )
    }
    await this.#advanceWaveBarriers(missionId)
    const tasks = (await this.#state.listTasks()).filter(value =>
      String(value.order.missionId) === String(missionId))
    if (tasks.length === 0 || tasks.some(value => value.state !== 'ACCEPTED')) {
      throw new MilitaryError(
        'POLICY_DENIED',
        'Mission completion requires every Task to be ACCEPTED',
      )
    }
    const completionKey = sha256(stableJson(tasks.map(value => ({
      taskId: String(value.order.taskId),
      taskVersion: Number(value.order.taskVersion),
      integration: value.integration?.integrationReceiptId ?? null,
      specs: value.specsCommit?.commit ?? null,
    })).sort((left, right) => left.taskId.localeCompare(right.taskId))))
    await this.#append(missionId, actor, 'mission/completed', {
      completionReportRef: `mission-completion-${completionKey.slice(0, 32)}`,
      acceptedTaskCount: tasks.length,
      integratedTaskCount: tasks.filter(value =>
        value.integration?.disposition === 'APPLIED'
        || value.specsCommit !== undefined).length,
    }, `mission-completed:${completionKey}`)
  }

  async cancelMission(input: {
    readonly missionId: MissionId
    readonly actor: AgentIdentity
    readonly reason: string
    readonly cancellationReceiptRef: string
  }): Promise<void> {
    const missionState = await this.#missionTerminalState(input.missionId)
    if (missionState === 'COMPLETED') {
      throw new MilitaryError(
        'POLICY_DENIED',
        'a completed Mission cannot be cancelled',
      )
    }
    const reason = input.reason.trim().replace(/\s+/gu, ' ').slice(0, 4_000)
    if (reason === '' || input.cancellationReceiptRef.trim() === '') {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        'Mission cancellation requires a reason and authorization receipt',
      )
    }
    const events = await this.#ledger.readEvents(input.missionId)
    const existing = events.find(value => value.type === 'mission/cancelled')
    if (existing !== undefined) {
      if (
        existing.payload.reason !== reason
        || existing.payload.authorizedBy !== String(input.actor.agentId)
        || existing.payload.cancellationReceiptRef
          !== input.cancellationReceiptRef
      ) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          'Mission already has another cancellation authority',
        )
      }
      return
    }
    const tasks = (await this.#state.listTasks())
      .filter(value =>
        String(value.order.missionId) === String(input.missionId))
      .map(value => ({ ...value } satisfies RuntimeTaskRecord))
    for (const task of tasks) {
      if (TERMINAL_TASK_STATES.has(task.state)) continue
      this.#transition(task, 'CANCELLED')
      const cancelledAgentId = String(
        task.worker?.agentId ?? input.actor.agentId,
      )
      if (task.pendingRadioRequestId !== undefined) {
        await this.#radio?.expire(
          task.pendingRadioRequestId as import(
            '@dsh-military/contracts'
          ).TacticalRequestId,
          'MISSION_CANCELLED',
        )
      }
      if (task.pendingDecisionSetId !== undefined) {
        await this.#decisions?.expire(
          task.pendingDecisionSetId,
          'MISSION_CANCELLED',
        )
      }
      delete task.worker
      delete task.pendingGuidance
      delete task.pendingRadioRequestId
      delete task.pendingDecisionSetId
      delete task.pendingDecisionAnswer
      await this.#append(
        input.missionId,
        input.actor,
        'task/cancelled',
        {
          taskId: String(task.order.taskId),
          taskVersion: Number(task.order.taskVersion),
          reasonCode: 'PARENT_CANCELLED',
          cancelledAgentId,
        },
        `mission-task-cancelled:${String(input.missionId)}:${String(
          task.order.taskId,
        )}:${Number(task.order.taskVersion)}:${input.cancellationReceiptRef}`,
      )
      await this.#storeTask(task)
    }
    await this.#append(
      input.missionId,
      input.actor,
      'mission/cancelled',
      {
        reason,
        authorizedBy: String(input.actor.agentId),
        cancellationReceiptRef: input.cancellationReceiptRef,
      },
      `mission-cancelled:${String(
        input.missionId,
      )}:${input.cancellationReceiptRef}`,
    )
  }

  async getTask(taskId: TaskId): Promise<TaskOrder> {
    const task = await this.#requireTask(taskId)
    return cloneFrozen(task.order)
  }

  async leaseTask(taskId: TaskId, worker: AgentIdentity, workspaceLeaseId: string): Promise<void> {
    const task = await this.#requireTask(taskId)
    this.#oversight.requireAdmission(worker)
    const leaseKey = [
      'task-lease',
      String(taskId),
      Number(task.order.taskVersion),
      String(worker.agentId),
      worker.generation,
      workspaceLeaseId,
    ].join(':')
    const priorLease = (await this.#ledger.readEvents(task.order.missionId))
      .find((event): event is Extract<
        MissionEvent,
        { readonly type: 'task/leased' }
      > =>
        event.type === 'task/leased'
        && event.idempotencyKey === leaseKey)
    if (priorLease !== undefined) {
      if (
        priorLease.payload.taskId !== String(taskId)
        || priorLease.payload.taskVersion !== Number(task.order.taskVersion)
        || priorLease.payload.workspaceLeaseId !== workspaceLeaseId
        || !sameAgent(priorLease.payload.agent, worker)
      ) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          `Task lease ${leaseKey} resolved to different authority`,
        )
      }
      if (
        task.state === 'EXECUTING'
        && task.worker !== undefined
        && sameAgent(task.worker, worker)
      ) return
    }
    if (task.state === 'PAUSED'
      || task.state === 'RECOVERY_REQUIRED'
      || task.state === 'INTEGRATION_FAILED'
      || task.state === 'REWORK') {
      const fromState = task.state
      this.#transition(task, 'READY')
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/resumed', {
        taskId: String(taskId),
        taskVersion: Number(task.order.taskVersion),
        fromState,
        reason: 'new durable Task Attempt reserved',
      }, `task-resumed:${String(taskId)}:${Number(task.order.taskVersion)}:${fromState}`)
    }
    this.#transition(task, 'LEASED')
    task.worker = cloneFrozen(worker)
    await this.#append(task.order.missionId, worker, 'task/leased', {
      taskId: String(taskId),
      taskVersion: Number(task.order.taskVersion),
      agent: worker,
      workspaceLeaseId,
      leaseExpiresAt: priorLease?.payload.leaseExpiresAt
        ?? brand<string, 'IsoDateTime'>(
          new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        ),
    }, leaseKey)
    this.#transition(task, 'EXECUTING')
    await this.#storeTask(task)
  }

  async releaseTaskLease(taskId: TaskId, worker: AgentIdentity, reason: string): Promise<TaskState> {
    const task = await this.#requireTask(taskId)
    if (task.worker === undefined || !sameAgent(task.worker, worker)) throw new MilitaryError('UNAUTHORIZED', 'task lease is owned by another agent')
    const priorState = task.state
    let outcome: MissionEventPayloadMap['task/activation-settled']['outcome'] = 'COMPLETED'
    if (isPolicyPauseReason(reason)
      && !TERMINAL_TASK_STATES.has(task.state)) {
      if (ACTIVELY_EXECUTING_TASK_STATES.has(task.state)) {
        this.#transition(task, 'PAUSED')
      }
      outcome = 'PAUSED'
    } else if (ACTIVATION_LOSS_STATES.has(task.state)) {
      this.#transition(task, 'RECOVERY_REQUIRED')
      outcome = 'RECOVERY_REQUIRED'
    } else if (task.state === 'CANCELLED') {
      outcome = 'CANCELLED'
    } else if (task.state === 'FAILED') {
      outcome = 'FAILED'
    }
    delete task.worker
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/activation-settled', {
      taskId: String(taskId),
      taskVersion: Number(task.order.taskVersion),
      activationId: String(worker.sessionId),
      outcome,
      taskState: task.state,
      reason: boundedReason(reason, priorState),
    }, `task-activation-settled:${String(taskId)}:${Number(task.order.taskVersion)}:${String(worker.agentId)}:${worker.generation}:${reason}`)
    await this.#storeTask(task)
    return task.state
  }

  async cancelTask(taskId: TaskId, worker: AgentIdentity, reason: string): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.state === 'CANCELLED') return
    if (task.worker === undefined || !sameAgent(task.worker, worker)) {
      throw new MilitaryError('UNAUTHORIZED', 'task cancellation must be issued by its exact leased Agent')
    }
    if (task.state === 'ACCEPTED' || task.state === 'FAILED') {
      throw new MilitaryError(
        'POLICY_DENIED',
        `terminal task in state ${task.state} cannot be cancelled`,
      )
    }
    this.#transition(task, 'CANCELLED')
    delete task.worker
    await this.#append(task.order.missionId, worker, 'task/cancelled', {
      taskId: String(taskId),
      taskVersion: Number(task.order.taskVersion),
      reasonCode: cancellationReasonCode(reason),
      cancelledAgentId: String(worker.agentId),
    }, `task-cancelled:${String(taskId)}:${Number(task.order.taskVersion)}:${String(worker.agentId)}:${worker.generation}:${reason}`)
    await this.#storeTask(task)
  }

  async submitCandidate(candidate: CandidateSubmission): Promise<void> {
    const task = await this.#requireTask(candidate.location.taskId)
    if (Number(task.order.taskVersion) !== Number(candidate.location.taskVersion)) throw new MilitaryError('CANDIDATE_STALE')
    if (task.worker === undefined
      || String(task.worker.agentId) !== String(candidate.identity.agentId)
      || task.worker.generation !== candidate.identity.generation) throw new MilitaryError('UNAUTHORIZED')
    this.#oversight.requireAdmission(candidate.identity)
    this.#transition(task, 'CANDIDATE_SUBMITTED')
    task.candidate = cloneFrozen(candidate)
    await this.#append(task.order.missionId, candidate.identity, 'task/candidate-submitted', {
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      candidateId: String(candidate.candidateId),
      candidateRef: `candidate:${String(candidate.candidateId)}`,
    }, candidate.idempotencyKey)
    await this.#storeTask(task)
  }

  async recordCandidateVerification(
    candidate: CandidateSubmission,
    verification: VerificationReceipt,
  ): Promise<{ readonly acceptedForVerification: boolean; readonly verification: VerificationReceipt }> {
    const task = await this.#requireTask(candidate.location.taskId)
    if (Number(task.order.taskVersion) !== Number(candidate.location.taskVersion)) {
      throw new MilitaryError('CANDIDATE_STALE')
    }
    if (String(task.candidate?.candidateId ?? '') !== String(candidate.candidateId)) {
      throw new MilitaryError('CANDIDATE_STALE', 'verification targets another Candidate')
    }
    if (task.state === 'CANDIDATE_SUBMITTED') {
      this.#transition(task, 'VERIFYING')
    } else if (task.state !== 'VERIFYING') {
      if (task.verification?.receiptId === verification.receiptId) {
        return {
          acceptedForVerification: true,
          verification: cloneFrozen(verification),
        }
      }
      throw new MilitaryError(
        'POLICY_DENIED',
        `verification receipt requires CANDIDATE_SUBMITTED/VERIFYING, observed ${task.state}`,
      )
    }
    task.verification = cloneFrozen(verification)
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'verification/completed', {
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      candidateId: String(candidate.candidateId),
      verificationReceiptRef: `verification:${verification.receiptId}`,
      disposition: verification.disposition,
    }, `verification:${verification.receiptId}`)
    await this.#applyVerificationDisposition(task, candidate, verification)
    await this.#storeTask(task)
    await this.#scheduleMission(task.order.missionId)
    return {
      acceptedForVerification: true,
      verification: cloneFrozen(verification),
    }
  }

  async recordCandidateVerificationFailure(
    candidate: CandidateSubmission,
    failureCode: string,
  ): Promise<void> {
    const task = await this.#requireTask(candidate.location.taskId)
    if (String(task.candidate?.candidateId ?? '') !== String(candidate.candidateId)) {
      throw new MilitaryError('CANDIDATE_STALE')
    }
    if (task.state === 'CANDIDATE_SUBMITTED') this.#transition(task, 'VERIFYING')
    if (task.state === 'VERIFYING') this.#transition(task, 'REWORK')
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'verification/completed', {
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      candidateId: String(candidate.candidateId),
      verificationReceiptRef: `verification:failed:${failureCode}`,
      disposition: 'REWORK',
    }, `verification-failed:${String(candidate.candidateId)}:${failureCode}`)
    await this.#storeTask(task)
  }

  async candidateProgress(taskId: TaskId): Promise<{
    readonly state: TaskState
    readonly candidateId?: string
    readonly verification?: VerificationReceipt
    readonly integration?: IntegrationReceipt
  }> {
    const task = await this.#requireTask(taskId)
    return cloneFrozen({
      state: task.state,
      ...(task.candidate === undefined
        ? {}
        : { candidateId: String(task.candidate.candidateId) }),
      ...(task.verification === undefined
        ? {}
        : { verification: task.verification }),
      ...(task.integration === undefined
        ? {}
        : { integration: task.integration }),
    })
  }

  async proposeCandidate(candidate: CandidateSubmission): Promise<{ readonly acceptedForVerification: boolean; readonly verification: VerificationReceipt }> {
    await this.submitCandidate(candidate)
    const task = await this.#requireTask(candidate.location.taskId)
    this.#transition(task, 'VERIFYING')
    await this.#storeTask(task)
    const controller = new AbortController()
    let verification: VerificationReceipt
    try {
      await this.#verification.prepare(candidate, task.order, candidate.identity.role === 'inspector')
      verification = await this.#verification.verify(candidate, controller.signal)
    } catch (error) {
      await this.recordCandidateVerificationFailure(
        candidate,
        error instanceof MilitaryError
          ? error.failure.code
          : 'VERIFICATION_FAILED',
      )
      throw error
    }
    return await this.recordCandidateVerification(candidate, verification)
  }

  async #applyVerificationDisposition(
    task: RuntimeTaskRecord,
    candidate: CandidateSubmission,
    verification: VerificationReceipt,
  ): Promise<void> {
    if (verification.disposition === 'ACCEPTED') {
      this.#transition(task, 'WAITING_INTEGRATION')
      if (candidate.changedPaths.length === 0) {
        this.#transition(task, 'ACCEPTED')
        await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/accepted', {
          taskId: String(task.order.taskId),
          taskVersion: Number(task.order.taskVersion),
          candidateId: String(candidate.candidateId),
          verificationReceiptRef: `verification:${verification.receiptId}`,
          integrationRequired: false,
        }, `task-accepted:${String(candidate.candidateId)}`)
      }
    } else if (verification.disposition === 'FROZEN') {
      this.#oversight.freeze({ agent: candidate.identity, taskId: String(task.order.taskId), reasonCodes: verification.deterministicFailures })
      this.#transition(task, 'FROZEN')
    } else if (verification.disposition === 'BLOCKED'
      || verification.disposition === 'STRATEGIC'
      || verification.disposition === 'HUMAN_REVIEW_REQUIRED') {
      this.#transition(task, 'BLOCKED')
    }
    else this.#transition(task, 'REWORK')
  }

  async recordIntegration(taskId: TaskId, receipt: IntegrationReceipt): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.integration?.integrationReceiptId === receipt.integrationReceiptId) {
      return
    }
    if (task.state !== 'WAITING_INTEGRATION') {
      throw new MilitaryError(
        'POLICY_DENIED',
        `integration requires WAITING_INTEGRATION, observed ${task.state}`,
      )
    }
    this.#transition(task, 'INTEGRATING')
    task.integration = cloneFrozen(receipt)
    if (receipt.disposition === 'APPLIED') {
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/integrated', {
        taskId: String(taskId), integrationReceiptId: receipt.integrationReceiptId,
        commit: receipt.commit ?? '', treeHash: receipt.treeHash ?? '',
      }, `task-integrated:${receipt.integrationReceiptId}`)
      this.#transition(task, 'ACCEPTED')
      const candidateId = String(task.candidate?.candidateId ?? `integrated:${receipt.integrationReceiptId}`)
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/accepted', {
        taskId: String(taskId),
        taskVersion: Number(task.order.taskVersion),
        candidateId,
        verificationReceiptRef: task.verification === undefined
          ? 'verification:missing'
          : `verification:${task.verification.receiptId}`,
        integrationRequired: true,
      }, `task-accepted-after-integration:${receipt.integrationReceiptId}`)
      await this.#storeTask(task)
      await this.#scheduleMission(task.order.missionId)
      return
    }
    this.#transition(task, 'INTEGRATION_FAILED')
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/integration-failed', {
      taskId: String(taskId),
      taskVersion: Number(task.order.taskVersion),
      integrationReceiptId: receipt.integrationReceiptId,
      disposition: receipt.disposition,
    }, `task-integration-failed:${receipt.integrationReceiptId}`)
    if (receipt.disposition === 'CONFLICT') {
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'integration/conflict-detected', {
        integrationOrderId: receipt.integrationOrderId, conflictReportRef: receipt.conflictReportRef ?? 'missing-conflict-report', affectedPaths: [],
      }, `integration-conflict:${receipt.integrationReceiptId}`)
    }
    await this.#storeTask(task)
  }

  async recordSpecsCommit(taskId: TaskId, receipt: { readonly commit: string; readonly treeHash: string; readonly changedPaths: readonly string[] }): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.specsCommit?.commit === receipt.commit && task.state === 'ACCEPTED') {
      return
    }
    if (task.state === 'ACCEPTED'
      && task.integration?.disposition === 'APPLIED') {
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'specs/commit-recorded', {
        taskId: String(taskId),
        commit: receipt.commit,
        treeHash: receipt.treeHash,
        changedPaths: [...receipt.changedPaths],
      }, `specs-commit:${String(taskId)}:${receipt.commit}`)
      task.specsCommit = cloneFrozen(receipt)
      await this.#storeTask(task)
      return
    }
    if (task.state !== 'EXECUTING') {
      throw new MilitaryError(
        'POLICY_DENIED',
        `Specs commit requires EXECUTING, observed ${task.state}`,
      )
    }
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'specs/commit-recorded', {
      taskId: String(taskId), commit: receipt.commit, treeHash: receipt.treeHash, changedPaths: [...receipt.changedPaths],
    }, `specs-commit:${String(taskId)}:${receipt.commit}`)
    this.#transition(task, 'CANDIDATE_SUBMITTED')
    this.#transition(task, 'VERIFYING')
    this.#transition(task, 'WAITING_INTEGRATION')
    this.#transition(task, 'INTEGRATING')
    this.#transition(task, 'ACCEPTED')
    task.specsCommit = cloneFrozen(receipt)
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/accepted', {
      taskId: String(taskId),
      taskVersion: Number(task.order.taskVersion),
      candidateId: `specs:${receipt.commit}`,
      verificationReceiptRef: `specs-validation:${receipt.treeHash}`,
      integrationRequired: true,
    }, `task-accepted-specs:${String(taskId)}:${receipt.commit}`)
    await this.#storeTask(task)
    await this.#scheduleMission(task.order.missionId)
  }

  async freezeAgent(agent: AgentIdentity, reasonCodes: readonly string[]): Promise<void> {
    const storedTask = (await this.#state.listTasks()).find(item =>
      item.worker !== undefined && sameAgent(item.worker, agent))
    const task = storedTask === undefined
      ? undefined
      : { ...storedTask } satisfies RuntimeTaskRecord
    const record = this.#oversight.freeze({
      agent,
      ...(task === undefined ? {} : { taskId: String(task.order.taskId) }),
      reasonCodes,
    })
    if (task !== undefined) this.#transition(task, 'FROZEN')
    const mission = task?.order.missionId
    if (mission !== undefined && task !== undefined) {
      await this.#append(mission, harnessIdentity(task.order), 'oversight/frozen', {
        targetAgentId: String(agent.agentId),
        taskId: String(task.order.taskId),
        inspectionReportRef: `inspection:${record.freezeId}`,
        reasonCodes: [...reasonCodes],
      }, `freeze:${record.freezeId}`)
      await this.#storeTask(task)
    }
  }

  async releaseAgent(agent: AgentIdentity, correctionOrderRef: string): Promise<void> {
    const storedTask = (await this.#state.listTasks()).find(item =>
      item.worker !== undefined && sameAgent(item.worker, agent))
    const task = storedTask === undefined
      ? undefined
      : { ...storedTask } satisfies RuntimeTaskRecord
    this.#oversight.release(agent, correctionOrderRef)
    if (task !== undefined) {
      this.#transition(task, 'READY')
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'oversight/released', {
        targetAgentId: String(agent.agentId),
        correctionOrderRef,
        releasedBy: 'harness',
      }, `release:${String(agent.agentId)}:${agent.generation}:${correctionOrderRef}`)
      await this.#storeTask(task)
    }
  }

  async startBrainstorm(rootSessionId: SessionId): Promise<BrainstormOrder> {
    let mission = await this.#state.getMission(rootSessionId)
    if (mission === null) {
      const recovered = await this.#ledger.findMissionByRootSession(rootSessionId)
      if (recovered === null) throw new MilitaryError('NOT_FOUND', 'root military mission is not registered')
      mission = cloneFrozen({ missionId: recovered.missionId, rootSessionId, general: recovered.general })
      await this.#state.putMission(mission)
    }
    const order = await this.#brainstorm.start(rootSessionId, mission.missionId)
    await this.#append(mission.missionId, mission.general, 'brainstorm/started', {
      orderId: String(order.orderId),
      rootSessionId: String(rootSessionId),
      projectStage: order.projectStage,
    }, `brainstorm-start:${String(order.orderId)}`)
    return order
  }

  taskState(taskId: TaskId): TaskState {
    const task = this.#taskCache.get(String(taskId))
    if (task === undefined) throw new MilitaryError('NOT_FOUND', `unknown task ${String(taskId)}`)
    return task.state
  }

  async #requireTask(taskId: TaskId): Promise<RuntimeTaskRecord> {
    const task = await this.#state.getTask(taskId)
    if (task === null) throw new MilitaryError('NOT_FOUND', `unknown task ${String(taskId)}`)
    this.#taskCache.set(String(taskId), cloneFrozen(task))
    return { ...task }
  }

  async #storeTask(task: RuntimeTaskRecord): Promise<void> {
    await this.#state.putTask(task)
    this.#taskCache.set(String(task.order.taskId), cloneFrozen(task))
  }

  async #missionTerminalState(
    missionId: MissionId,
  ): Promise<'OPEN' | 'COMPLETED' | 'CANCELLED'> {
    const events = await this.#ledger.readEvents(missionId)
    if (events.some(value => value.type === 'mission/completed')) {
      return 'COMPLETED'
    }
    if (events.some(value => value.type === 'mission/cancelled')) {
      return 'CANCELLED'
    }
    return 'OPEN'
  }

  async #requireMissionOpen(missionId: MissionId): Promise<void> {
    const state = await this.#missionTerminalState(missionId)
    if (state !== 'OPEN') {
      throw new MilitaryError(
        'POLICY_DENIED',
        `Mission ${String(missionId)} is already ${state}`,
      )
    }
  }

  async #scheduleMission(missionId: MissionId): Promise<void> {
    await this.#advanceWaveBarriers(missionId)
    let snapshot = await this.#ledger.readMission(missionId)
    const tasks = (await this.#state.listTasks())
      .filter(value => String(value.order.missionId) === String(missionId))
      .map(value => ({ ...value } satisfies RuntimeTaskRecord))
    if (snapshot.activeWaveIds.length === 0) {
      const next = tasks
        .filter(value => !TERMINAL_TASK_STATES.has(value.state))
        .sort((left, right) =>
          (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
          || String(left.order.taskId).localeCompare(String(right.order.taskId)))[0]
      if (next !== undefined) {
        await this.#append(missionId, harnessIdentity(next.order), 'wave/opened', {
          directionId: String(next.order.directionId),
          waveId: String(next.order.waveId),
          wavePlanRef: `wave-plan-${String(next.order.waveId)}`,
        }, `wave-opened:${String(next.order.waveId)}`)
        snapshot = await this.#ledger.readMission(missionId)
      }
    }
    const activeWaves = new Set(snapshot.activeWaveIds.map(String))
    const byTaskId = new Map(
      tasks.map(value => [String(value.order.taskId), value] as const),
    )
    for (const task of tasks) {
      if (task.state !== 'CREATED'
        || !activeWaves.has(String(task.order.waveId))) continue
      const dependencies = task.order.dependencies
        .filter(value => SCHEDULING_DEPENDENCIES.has(value.type))
      if (!dependencies.every(dependency =>
        dependencySatisfied(dependency, byTaskId))) continue
      this.#transition(task, 'READY')
      await this.#append(missionId, harnessIdentity(task.order), 'task/ready', {
        taskId: String(task.order.taskId),
        taskVersion: Number(task.order.taskVersion),
        waveId: String(task.order.waveId),
        satisfiedDependencyIds: dependencies.map(value =>
          String(value.targetTaskId)),
      }, `task-ready:${String(task.order.taskId)}:${Number(task.order.taskVersion)}`)
      await this.#storeTask(task)
    }
  }

  async #advanceWaveBarriers(missionId: MissionId): Promise<void> {
    const snapshot = await this.#ledger.readMission(missionId)
    if (snapshot.activeWaveIds.length === 0) return
    const tasks = (await this.#state.listTasks())
      .filter(value => String(value.order.missionId) === String(missionId))
    for (const waveId of snapshot.activeWaveIds) {
      const waveTasks = tasks.filter(value =>
        String(value.order.waveId) === String(waveId))
      if (waveTasks.length === 0
        || waveTasks.some(value => value.state !== 'ACCEPTED')) continue
      await this.#append(missionId, harnessIdentity(waveTasks[0]!.order), 'wave/barrier-satisfied', {
        waveId: String(waveId),
        acceptedTaskIds: waveTasks.map(value => String(value.order.taskId)),
        integrationReceiptRefs: waveTasks
          .map(value => value.integration?.integrationReceiptId)
          .filter((value): value is string => value !== undefined),
        specsCommitRef: waveTasks
          .map(value => value.specsCommit?.commit)
          .find((value): value is string => value !== undefined)
          ?? `specs-not-required-${String(waveId)}`,
      }, `wave-barrier-satisfied:${String(waveId)}`)
    }
  }

  #transition(task: RuntimeTaskRecord, to: TaskState): void {
    task.state = reduceTaskTransition(task.state, to)
  }

  async #append<T extends MissionEventType>(
    missionId: MissionId,
    actor: AgentIdentity,
    type: T,
    payload: MissionEventPayloadMap[T],
    idempotencyKey: string,
  ): Promise<void> {
    const events = await this.#ledger.readEvents(missionId)
    const terminal = events.find(event =>
      event.type === 'mission/completed'
      || event.type === 'mission/cancelled')
    if (terminal !== undefined) {
      const replay = events.find(event =>
        event.idempotencyKey === idempotencyKey)
      if (
        replay !== undefined
        && replay.type === type
        && stableJson(replay.payload) === stableJson(payload)
        && sameAgent(replay.actor, actor)
      ) {
        return
      }
      throw new MilitaryError(
        'POLICY_DENIED',
        `Mission ${String(missionId)} is terminal after ${terminal.type}`,
      )
    }
    const snapshot = await this.#ledger.readMission(missionId)
    const event = missionEvent({ type, missionId, actor, payload, metadata: { idempotencyKey } })
    await this.#ledger.append(event, snapshot.revision as Revision)
  }
}

function cancellationReasonCode(
  reason: string,
): MissionEventPayloadMap['task/cancelled']['reasonCode'] {
  if (reason.includes('USER_CANCELLED')) return 'USER_CANCELLED'
  if (reason.includes('PARENT_CANCELLED')) return 'PARENT_CANCELLED'
  if (reason.includes('STEP_BUDGET_EXHAUSTED')) return 'STEP_BUDGET_EXHAUSTED'
  if (reason.includes('NO_PROGRESS_LIMIT')) return 'NO_PROGRESS_LIMIT'
  return 'AGENT_ABORTED'
}

function isPolicyPauseReason(reason: string): boolean {
  return reason.includes('STEP_BUDGET_EXHAUSTED')
    || reason.includes('WALL_CLOCK_')
    || reason.includes('NO_PROGRESS_LIMIT')
    || reason.includes('AGENT_ABORTED')
    || reason.includes('INVOCATION_CANCELLED')
}

function boundedReason(reason: string, priorState: TaskState): string {
  const normalized = reason.trim().replace(/\s+/gu, ' ')
  return `${normalized === '' ? 'AGENT_RELEASED' : normalized}; prior=${priorState}`
    .slice(0, 240)
}

const ACTIVATION_LOSS_STATES = new Set<TaskState>([
  'LEASED',
  'EXECUTING',
  'CANDIDATE_SUBMITTED',
  'VERIFYING',
  'WAITING_INTEGRATION',
  'INTEGRATING',
])

const ACTIVELY_EXECUTING_TASK_STATES = new Set<TaskState>([
  'LEASED',
  'EXECUTING',
  'CANDIDATE_SUBMITTED',
  'VERIFYING',
  'WAITING_INTEGRATION',
  'INTEGRATING',
])

const TERMINAL_TASK_STATES = new Set<TaskState>([
  'ACCEPTED',
  'CANCELLED',
  'FAILED',
])

function dependencySatisfied(
  dependency: TaskOrder['dependencies'][number],
  tasks: ReadonlyMap<string, RuntimeTaskRecord>,
): boolean {
  const target = tasks.get(String(dependency.targetTaskId))
  if (target === undefined) return false
  if (dependency.type === 'validates') {
    return VALIDATABLE_TASK_STATES.has(target.state)
  }
  return target.state === 'ACCEPTED'
}

const VALIDATABLE_TASK_STATES = new Set<TaskState>([
  'CANDIDATE_SUBMITTED',
  'VERIFYING',
  'WAITING_INTEGRATION',
  'INTEGRATING',
  'ACCEPTED',
])

const SCHEDULING_DEPENDENCIES =
  new Set<TaskOrder['dependencies'][number]['type']>([
    'requires',
    'consumes',
    'locks',
    'validates',
    'joinsAt',
  ])

function sameAgent(left: AgentIdentity, right: AgentIdentity): boolean {
  return String(left.agentId) === String(right.agentId) && left.generation === right.generation
}

function harnessIdentity(order: TaskOrder): AgentIdentity {
  return {
    agentId: brand<string, 'AgentId'>('harness'),
    sessionId: brand<string, 'SessionId'>(`harness:${String(order.missionId)}`),
    role: 'harness',
    displayName: 'Harness',
    generation: 1,
  }
}
