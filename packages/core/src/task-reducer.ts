import {
  MilitaryError,
  brand,
  canTransitionTask,
  type AgentIdentity,
  type MissionEvent,
  type TaskId,
  type TaskState,
  type TaskVersion,
} from '@dsh-military/contracts'

export interface ReducedTask {
  readonly taskVersion: TaskVersion
  readonly state: TaskState
  readonly assignedAgent?: AgentIdentity
}

/** The sole validator for imperative Runtime Task state changes. */
export function reduceTaskTransition(from: TaskState, to: TaskState): TaskState {
  if (from === to) return from
  if (!canTransitionTask(from, to)) {
    throw new MilitaryError('POLICY_DENIED', `illegal task transition ${from} -> ${to}`)
  }
  return to
}

/**
 * Fold one authoritative Mission event into a Task projection. Both ledger
 * providers call this exact reducer, so in-memory and SQLite snapshots cannot
 * silently assign different meanings to the same event.
 */
export function reduceTaskEvent(tasks: Map<TaskId, ReducedTask>, event: MissionEvent): void {
  switch (event.type) {
    case 'task/created':
      tasks.set(taskId(event.payload.taskId), {
        taskVersion: taskVersion(event.payload.taskVersion),
        state: 'CREATED',
      })
      return
    case 'task/ready':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'READY')
      return
    case 'task/leased': {
      const current = requireTask(tasks, event.payload.taskId, event.payload.taskVersion)
      // Pre-scheduler RC.2 ledgers encoded READY implicitly in task/created.
      // Replaying those immutable histories must remain valid after task/ready
      // became explicit, so insert the legacy projection edge only while
      // folding an old CREATED -> task/leased sequence.
      const ready = current.state === 'CREATED'
        ? reduceTaskTransition(current.state, 'READY')
        : current.state
      const leased = reduceTaskTransition(ready, 'LEASED')
      tasks.set(taskId(event.payload.taskId), {
        taskVersion: taskVersion(event.payload.taskVersion),
        state: reduceTaskTransition(leased, 'EXECUTING'),
        assignedAgent: event.payload.agent,
      })
      return
    }
    case 'task/candidate-submitted':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'CANDIDATE_SUBMITTED')
      return
    case 'task/blocker-submitted':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'BLOCKED')
      return
    case 'verification/completed': {
      const current = requireTask(tasks, event.payload.taskId, event.payload.taskVersion)
      let state = current.state === 'VERIFYING'
        ? current.state
        : reduceTaskTransition(current.state, 'VERIFYING')
      if (event.payload.disposition === 'ACCEPTED') {
        state = reduceTaskTransition(state, 'WAITING_INTEGRATION')
      } else if (event.payload.disposition === 'REWORK') state = reduceTaskTransition(state, 'REWORK')
      else if (event.payload.disposition === 'BLOCKED'
        || event.payload.disposition === 'STRATEGIC'
        || event.payload.disposition === 'HUMAN_REVIEW_REQUIRED') {
        state = reduceTaskTransition(state, 'BLOCKED')
      } else if (event.payload.disposition === 'FROZEN') {
        state = reduceTaskTransition(state, 'FROZEN')
      }
      tasks.set(taskId(event.payload.taskId), { ...current, state })
      return
    }
    case 'task/accepted':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'ACCEPTED')
      return
    case 'task/integrated': {
      const current = requireTask(tasks, event.payload.taskId)
      const integrating = current.state === 'WAITING_INTEGRATION'
        ? reduceTaskTransition(current.state, 'INTEGRATING')
        : current.state
      tasks.set(taskId(event.payload.taskId), {
        ...current,
        state: integrating === 'INTEGRATING'
          ? reduceTaskTransition(integrating, 'ACCEPTED')
          : integrating,
      })
      return
    }
    case 'task/integration-failed': {
      const current = requireTask(
        tasks,
        event.payload.taskId,
        event.payload.taskVersion,
      )
      const integrating = current.state === 'WAITING_INTEGRATION'
        ? reduceTaskTransition(current.state, 'INTEGRATING')
        : current.state
      tasks.set(taskId(event.payload.taskId), {
        ...current,
        state: integrating === 'INTEGRATING'
          ? reduceTaskTransition(integrating, 'INTEGRATION_FAILED')
          : integrating,
      })
      return
    }
    case 'task/cancelled':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'CANCELLED')
      return
    case 'task/activation-settled': {
      const current = requireTask(
        tasks,
        event.payload.taskId,
        event.payload.taskVersion,
      )
      const state = current.state === event.payload.taskState
        ? current.state
        : reduceTaskTransition(current.state, event.payload.taskState)
      tasks.set(taskId(event.payload.taskId), {
        taskVersion: current.taskVersion,
        state,
      })
      return
    }
    case 'task/resumed':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'READY')
      return
    case 'radio/guidance-delivered': {
      const current = requireTask(
        tasks,
        event.payload.taskId,
        event.payload.taskVersion,
      )
      const pending = current.state === 'BLOCKED'
        ? reduceTaskTransition(current.state, 'GUIDANCE_PENDING')
        : current.state
      tasks.set(taskId(event.payload.taskId), {
        ...current,
        state: pending === 'GUIDANCE_PENDING'
          ? reduceTaskTransition(pending, 'READY')
          : reduceTaskTransition(pending, 'READY'),
      })
      return
    }
    case 'task/decision-waiting':
      setState(
        tasks,
        event.payload.taskId,
        event.payload.taskVersion,
        'WAITING_DECISION',
      )
      return
    case 'task/decision-resolved':
      setState(
        tasks,
        event.payload.taskId,
        event.payload.taskVersion,
        'READY',
      )
      return
    case 'specs/commit-recorded': {
      const current = requireTask(tasks, event.payload.taskId)
      let state = current.state
      if (state === 'EXECUTING') state = reduceTaskTransition(state, 'CANDIDATE_SUBMITTED')
      if (state === 'CANDIDATE_SUBMITTED') state = reduceTaskTransition(state, 'VERIFYING')
      if (state === 'VERIFYING') state = reduceTaskTransition(state, 'WAITING_INTEGRATION')
      if (state === 'WAITING_INTEGRATION') state = reduceTaskTransition(state, 'INTEGRATING')
      if (state === 'INTEGRATING') state = reduceTaskTransition(state, 'ACCEPTED')
      tasks.set(taskId(event.payload.taskId), { ...current, state })
      return
    }
    case 'task/rework-requested': {
      const current = requireTask(tasks, event.payload.taskId)
      let state = current.state
      if (state !== 'REWORK' && state !== 'BLOCKED' && state !== 'FROZEN' && state !== 'EXECUTING') {
        state = reduceTaskTransition(state, 'REWORK')
      }
      state = reduceTaskTransition(state, 'READY')
      tasks.set(taskId(event.payload.taskId), {
        taskVersion: taskVersion(event.payload.newVersion),
        state,
      })
      return
    }
    case 'oversight/frozen':
      if (event.payload.taskId !== undefined) {
        setState(tasks, event.payload.taskId, undefined, 'FROZEN')
      }
      return
    case 'oversight/released':
      for (const [id, current] of tasks) {
        if (String(current.assignedAgent?.agentId) !== event.payload.targetAgentId) continue
        tasks.set(id, { ...current, state: reduceTaskTransition(current.state, 'READY') })
      }
      return
    default:
      return
  }
}

function setState(
  tasks: Map<TaskId, ReducedTask>,
  id: string,
  version: number | undefined,
  state: TaskState,
): void {
  const current = requireTask(tasks, id, version)
  tasks.set(taskId(id), {
    ...current,
    ...(version === undefined ? {} : { taskVersion: taskVersion(version) }),
    state: reduceTaskTransition(current.state, state),
  })
}

function requireTask(
  tasks: Map<TaskId, ReducedTask>,
  id: string,
  version?: number,
): ReducedTask {
  const current = tasks.get(taskId(id))
  if (current === undefined) {
    throw new MilitaryError('PERSISTENCE_FAILED', `Task event references unknown task ${id}`)
  }
  if (version !== undefined && Number(current.taskVersion) !== version) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      `Task event version ${version} does not match ${id}@${Number(current.taskVersion)}`,
    )
  }
  return current
}

function taskId(value: string): TaskId {
  return brand<string, 'TaskId'>(value)
}

function taskVersion(value: number): TaskVersion {
  return brand<number, 'TaskVersion'>(value)
}
