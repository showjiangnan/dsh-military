import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentActivationStates,
  agentActivationTransitions,
  aggregateStateMachineCatalog,
  dispatchStates,
  dispatchTransitions,
  executionLifecycleUiActions,
  taskExecutionAttemptStates,
  taskExecutionAttemptTransitions,
  workflowObligationStates,
  workflowObligationTransitions,
} from '@dsh-military/contracts'

test('every aggregate state machine has one total transition and UI-action contract', () => {
  const aggregates = new Set<string>()
  for (const machine of aggregateStateMachineCatalog) {
    assert.equal(aggregates.has(machine.aggregate), false)
    aggregates.add(machine.aggregate)
    assert.deepEqual(
      Object.keys(machine.transitions).sort(),
      [...machine.states].sort(),
      `${machine.aggregate} transition map must be total`,
    )
    assert.deepEqual(
      Object.keys(machine.uiActions).sort(),
      [...machine.states].sort(),
      `${machine.aggregate} UI action map must be total`,
    )
    for (const [from, targets] of Object.entries(machine.transitions)) {
      assert.equal(machine.states.includes(from), true)
      assert.equal(new Set(targets).size, targets.length)
      for (const to of targets) {
        assert.equal(
          machine.states.includes(to),
          true,
          `${machine.aggregate} ${from} -> ${to} uses an unknown state`,
        )
      }
    }
    assert.deepEqual(
      machine.terminalStates,
      machine.states.filter(state =>
        machine.transitions[state]!.length === 0),
    )
    const reachable = closure(
      machine.initialStates,
      machine.transitions,
    )
    assert.deepEqual(
      [...reachable].sort(),
      [...machine.states].sort(),
      `${machine.aggregate} contains an unreachable state`,
    )
    for (const actions of Object.values(machine.uiActions)) {
      assert.equal(new Set(actions).size, actions.length)
      for (const action of actions) {
        assert.match(action, /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u)
      }
    }
  }
})

test('Workflow, Attempt, Activation and Dispatch share complete lifecycle contracts', () => {
  assertTotal(workflowObligationStates, workflowObligationTransitions)
  assertTotal(taskExecutionAttemptStates, taskExecutionAttemptTransitions)
  assertTotal(agentActivationStates, agentActivationTransitions)
  assertTotal(dispatchStates, dispatchTransitions)
  assert.deepEqual(
    Object.keys(executionLifecycleUiActions.workflow).sort(),
    [...workflowObligationStates].sort(),
  )
  assert.deepEqual(
    Object.keys(executionLifecycleUiActions.attempt).sort(),
    [...taskExecutionAttemptStates].sort(),
  )
  assert.deepEqual(
    Object.keys(executionLifecycleUiActions.activation).sort(),
    [...agentActivationStates].sort(),
  )
  assert.deepEqual(
    Object.keys(executionLifecycleUiActions.dispatch).sort(),
    [...dispatchStates].sort(),
  )
})

function assertTotal<S extends string>(
  states: readonly S[],
  transitions: Readonly<Record<S, readonly S[]>>,
): void {
  assert.deepEqual(Object.keys(transitions).sort(), [...states].sort())
  for (const targets of Object.values(transitions) as readonly S[][]) {
    for (const target of targets) assert.equal(states.includes(target), true)
  }
}

function closure(
  initial: readonly string[],
  transitions: Readonly<Record<string, readonly string[]>>,
): ReadonlySet<string> {
  const reached = new Set(initial)
  const pending = [...initial]
  while (pending.length > 0) {
    const current = pending.shift()!
    for (const next of transitions[current] ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      pending.push(next)
    }
  }
  return reached
}
