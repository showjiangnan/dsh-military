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
  type MissionEventType,
  type MilitaryVerification,
  brand,
} from '@dsh-military/contracts'
import { OversightController } from './oversight.js'
import { cloneFrozen, stableJson } from './util.js'
import { reduceTaskTransition } from './task-reducer.js'

export interface RuntimeTaskRecord {
  order: TaskOrder
  state: TaskState
  worker?: AgentIdentity
  candidate?: CandidateSubmission
  verification?: VerificationReceipt
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
  readonly #taskCache = new Map<string, RuntimeTaskRecord>()

  constructor(input: {
    readonly ledger: MilitaryLedger
    readonly verification: MilitaryVerification
    readonly oversight: OversightController
    readonly brainstorm: MilitaryBrainstorm
    readonly state?: MilitaryRuntimeStateStore
  }) {
    this.#ledger = input.ledger
    this.#verification = input.verification
    this.#oversight = input.oversight
    this.#brainstorm = input.brainstorm
    this.#state = input.state ?? new InMemoryMilitaryRuntimeStateStore()
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
    await this.#append(task.order.missionId, input.actor, 'task/blocker-submitted', {
      taskId: String(input.taskId), taskVersion: Number(input.taskVersion), blockerId: input.blockerId,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      evidenceRefs: [...input.evidenceRefs],
    }, `task-blocker:${input.blockerId}`)
    await this.#storeTask(task)
  }

  async registerTask(order: TaskOrder, actor: AgentIdentity): Promise<void> {
    const key = String(order.taskId)
    if (await this.#state.getTask(order.taskId) !== null) throw new MilitaryError('REVISION_CONFLICT', `task ${key} already exists`)
    await this.#append(order.missionId, actor, 'task/created', {
      taskId: key,
      taskVersion: Number(order.taskVersion),
      taskOrderRef: `task-order:${key}@${Number(order.taskVersion)}`,
    }, `task-created:${key}:${Number(order.taskVersion)}`)
    const task = { order: cloneFrozen(order), state: 'READY' as const }
    await this.#state.createTask(task)
    this.#taskCache.set(key, cloneFrozen(task))
  }

  async getTask(taskId: TaskId): Promise<TaskOrder> {
    const task = await this.#requireTask(taskId)
    return cloneFrozen(task.order)
  }

  async leaseTask(taskId: TaskId, worker: AgentIdentity, workspaceLeaseId: string): Promise<void> {
    const task = await this.#requireTask(taskId)
    this.#oversight.requireAdmission(worker)
    this.#transition(task, 'LEASED')
    task.worker = cloneFrozen(worker)
    await this.#append(task.order.missionId, worker, 'task/leased', {
      taskId: String(taskId),
      taskVersion: Number(task.order.taskVersion),
      agent: worker,
      workspaceLeaseId,
      leaseExpiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 30 * 60 * 1000).toISOString()),
    }, `task-lease:${String(taskId)}:${Number(task.order.taskVersion)}:${String(worker.agentId)}:${worker.generation}`)
    this.#transition(task, 'EXECUTING')
    await this.#storeTask(task)
  }

  async releaseTaskLease(taskId: TaskId, worker: AgentIdentity, reason: string): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.worker === undefined || !sameAgent(task.worker, worker)) throw new MilitaryError('UNAUTHORIZED', 'task lease is owned by another agent')
    if (task.state === 'ACCEPTED') throw new MilitaryError('POLICY_DENIED', 'accepted task lease cannot be released')
    delete task.worker
    this.#transition(task, 'READY')
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/rework-requested', {
      taskId: String(taskId),
      previousVersion: Number(task.order.taskVersion),
      newVersion: Number(task.order.taskVersion),
      reasonCodes: [`LEASE_RELEASED:${reason}`],
    }, `task-lease-release:${String(taskId)}:${Number(task.order.taskVersion)}:${String(worker.agentId)}:${worker.generation}:${reason}`)
    await this.#storeTask(task)
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

  async proposeCandidate(candidate: CandidateSubmission): Promise<{ readonly acceptedForVerification: boolean; readonly verification: VerificationReceipt }> {
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
    this.#transition(task, 'VERIFYING')
    const controller = new AbortController()
    let verification: VerificationReceipt
    try {
      await this.#verification.prepare(candidate, task.order, candidate.identity.role === 'inspector')
      verification = await this.#verification.verify(candidate, controller.signal)
    } catch (error) {
      this.#transition(task, 'REWORK')
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'verification/completed', {
        taskId: String(task.order.taskId), taskVersion: Number(task.order.taskVersion),
        candidateId: String(candidate.candidateId), verificationReceiptRef: 'verification:failed-before-receipt', disposition: 'REWORK',
      }, `verification-failed:${String(candidate.candidateId)}`)
      throw error
    }
    task.verification = cloneFrozen(verification)
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'verification/completed', {
      taskId: String(task.order.taskId),
      taskVersion: Number(task.order.taskVersion),
      candidateId: String(candidate.candidateId),
      verificationReceiptRef: `verification:${verification.receiptId}`,
      disposition: verification.disposition,
    }, `verification:${verification.receiptId}`)
    if (verification.disposition === 'ACCEPTED') {
      this.#transition(task, 'ACCEPTED')
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/accepted', {
        taskId: String(task.order.taskId),
        taskVersion: Number(task.order.taskVersion),
        candidateId: String(candidate.candidateId),
        verificationReceiptRef: `verification:${verification.receiptId}`,
        integrationRequired: candidate.changedPaths.length > 0,
      }, `task-accepted:${String(candidate.candidateId)}`)
    } else if (verification.disposition === 'FROZEN') {
      this.#oversight.freeze({ agent: candidate.identity, taskId: String(task.order.taskId), reasonCodes: verification.deterministicFailures })
      this.#transition(task, 'FROZEN')
    } else if (verification.disposition === 'BLOCKED'
      || verification.disposition === 'STRATEGIC'
      || verification.disposition === 'HUMAN_REVIEW_REQUIRED') {
      this.#transition(task, 'BLOCKED')
    }
    else this.#transition(task, 'REWORK')
    await this.#storeTask(task)
    return { acceptedForVerification: true, verification: cloneFrozen(verification) }
  }

  async recordIntegration(taskId: TaskId, receipt: IntegrationReceipt): Promise<void> {
    const task = await this.#requireTask(taskId)
    if (task.state !== 'ACCEPTED') throw new MilitaryError('POLICY_DENIED', 'only an accepted task can be integrated')
    if (receipt.disposition === 'APPLIED') {
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'task/integrated', {
        taskId: String(taskId), integrationReceiptId: receipt.integrationReceiptId,
        commit: receipt.commit ?? '', treeHash: receipt.treeHash ?? '',
      }, `task-integrated:${receipt.integrationReceiptId}`)
      return
    }
    if (receipt.disposition === 'CONFLICT') {
      await this.#append(task.order.missionId, harnessIdentity(task.order), 'integration/conflict-detected', {
        integrationOrderId: receipt.integrationOrderId, conflictReportRef: receipt.conflictReportRef ?? 'missing-conflict-report', affectedPaths: [],
      }, `integration-conflict:${receipt.integrationReceiptId}`)
    }
  }

  async recordSpecsCommit(taskId: TaskId, receipt: { readonly commit: string; readonly treeHash: string; readonly changedPaths: readonly string[] }): Promise<void> {
    const task = await this.#requireTask(taskId)
    await this.#append(task.order.missionId, harnessIdentity(task.order), 'specs/commit-recorded', {
      taskId: String(taskId), commit: receipt.commit, treeHash: receipt.treeHash, changedPaths: [...receipt.changedPaths],
    }, `specs-commit:${String(taskId)}:${receipt.commit}`)
  }

  async freezeAgent(agent: AgentIdentity, reasonCodes: readonly string[]): Promise<void> {
    const task = (await this.#state.listTasks()).find(item => item.worker !== undefined && sameAgent(item.worker, agent))
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
    const task = (await this.#state.listTasks()).find(item => item.worker !== undefined && sameAgent(item.worker, agent))
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
