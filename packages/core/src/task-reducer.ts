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
        // Creation is atomically admitted as schedulable in Military Runtime.
        state: 'READY',
      })
      return
    case 'task/leased': {
      const current = requireTask(tasks, event.payload.taskId, event.payload.taskVersion)
      const leased = reduceTaskTransition(current.state, 'LEASED')
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
      if (event.payload.disposition === 'REWORK') state = reduceTaskTransition(state, 'REWORK')
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
    case 'task/cancelled':
      setState(tasks, event.payload.taskId, event.payload.taskVersion, 'CANCELLED')
      return
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
