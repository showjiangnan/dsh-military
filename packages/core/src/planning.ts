import { MilitaryError, type TaskId, type TaskOrder, brand } from '@dsh-military/contracts'
import { cloneFrozen } from './util.js'
import { workspaceScopesOverlap } from './path-policy.js'

export interface PlanningIssue {
  readonly code: 'DUPLICATE_TASK' | 'UNKNOWN_DEPENDENCY' | 'CYCLE' | 'WRITE_CONFLICT' | 'TASK_TOO_AMBIGUOUS'
  readonly taskIds: readonly string[]
  readonly message: string
}

export interface ValidatedPlan {
  readonly tasks: readonly TaskOrder[]
  readonly topologicalOrder: readonly TaskId[]
  readonly issues: readonly PlanningIssue[]
}

export class MilitaryPlanningEngine {
  validate(tasks: readonly TaskOrder[]): ValidatedPlan {
    const byId = new Map<string, TaskOrder>()
    const issues: PlanningIssue[] = []
    for (const task of tasks) {
      const id = String(task.taskId)
      if (byId.has(id)) issues.push({ code: 'DUPLICATE_TASK', taskIds: [id], message: `duplicate task ${id}` })
      else byId.set(id, task)
      const decisionBudget = task.complexity.semanticDecisions
        + task.complexity.unknownDependencies
        + task.complexity.acceptanceAmbiguity
      if (decisionBudget > 7) {
        issues.push({
          code: 'TASK_TOO_AMBIGUOUS',
          taskIds: [id],
          message: `task decision budget ${decisionBudget} exceeds the default safe threshold 7`,
        })
      }
    }

    const incoming = new Map<string, Set<string>>()
    const outgoing = new Map<string, Set<string>>()
    for (const id of byId.keys()) {
      incoming.set(id, new Set())
      outgoing.set(id, new Set())
    }
    for (const task of byId.values()) {
      for (const dependency of task.dependencies) {
        if (!['requires', 'consumes', 'locks', 'validates', 'joinsAt'].includes(dependency.type)) continue
        const target = String(dependency.targetTaskId)
        if (!byId.has(target)) {
          issues.push({ code: 'UNKNOWN_DEPENDENCY', taskIds: [String(task.taskId), target], message: `unknown dependency ${target}` })
          continue
        }
        incoming.get(String(task.taskId))?.add(target)
        outgoing.get(target)?.add(String(task.taskId))
      }
    }

    const queue = [...incoming.entries()].filter(([, deps]) => deps.size === 0).map(([id]) => id).sort()
    const topological: string[] = []
    while (queue.length > 0) {
      const id = queue.shift()
      if (id === undefined) break
      topological.push(id)
      for (const next of [...(outgoing.get(id) ?? [])].sort()) {
        const deps = incoming.get(next)
        deps?.delete(id)
        if (deps?.size === 0) queue.push(next)
      }
      queue.sort()
    }
    if (topological.length !== byId.size) {
      const cycle = [...incoming.entries()].filter(([, deps]) => deps.size > 0).map(([id]) => id)
      issues.push({ code: 'CYCLE', taskIds: cycle, message: `dependency cycle among ${cycle.join(', ')}` })
    }

    const taskList = [...byId.values()]
    for (let leftIndex = 0; leftIndex < taskList.length; leftIndex += 1) {
      const left = taskList[leftIndex]
      if (left === undefined) continue
      for (let rightIndex = leftIndex + 1; rightIndex < taskList.length; rightIndex += 1) {
        const right = taskList[rightIndex]
        if (right === undefined) continue
        const conflicts = overlappingScopes(left.scope.writePaths, right.scope.writePaths)
        if (conflicts.length === 0) continue
        if (dependsOn(left, right) || dependsOn(right, left)) continue
        issues.push({
          code: 'WRITE_CONFLICT',
          taskIds: [String(left.taskId), String(right.taskId)],
          message: `parallel tasks have overlapping write scope: ${conflicts.join(', ')}`,
        })
      }
    }

    return cloneFrozen({
      tasks: taskList,
      topologicalOrder: topological.map(id => brand<string, 'TaskId'>(id)),
      issues,
    })
  }

  requireValid(tasks: readonly TaskOrder[]): ValidatedPlan {
    const result = this.validate(tasks)
    if (result.issues.length > 0) {
      throw new MilitaryError('INVALID_ARGUMENT', 'invalid direction/wave task plan', { issues: result.issues })
    }
    return result
  }

  readyTasks(tasks: readonly TaskOrder[], accepted: ReadonlySet<string>, leased: ReadonlySet<string>): readonly TaskOrder[] {
    return cloneFrozen(tasks.filter((task) => {
      const id = String(task.taskId)
      if (accepted.has(id) || leased.has(id)) return false
      return task.dependencies
        .filter(dep => ['requires', 'consumes', 'joinsAt'].includes(dep.type))
        .every(dep => accepted.has(String(dep.targetTaskId)))
    }))
  }
}

function dependsOn(task: TaskOrder, other: TaskOrder): boolean {
  return task.dependencies.some(dep => String(dep.targetTaskId) === String(other.taskId))
}

function overlappingScopes(left: readonly string[], right: readonly string[]): string[] {
  const conflicts: string[] = []
  for (const a of left) for (const b of right) if (workspaceScopesOverlap(a, b)) conflicts.push(`${a} <> ${b}`)
  return conflicts
}
