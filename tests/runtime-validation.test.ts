import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCandidateSubmission,
  parseDecisionQuestionSet,
  parseDocumentContent,
  parseSpecsApplyDraft,
  parseTacticalRequest,
  parseTaskOrder,
  resolveInspectionTarget,
} from '@dsh-military/tools'
import type { AgentExecutionBinding } from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'
import {
  acceptedCandidate,
  decisionSet,
  identity,
  tacticalRequest,
  task,
} from './helpers.js'

test('model-produced contracts pass their canonical runtime schemas before use', () => {
  const order = task()
  const candidate = acceptedCandidate(order)
  const request = tacticalRequest()
  const questions = decisionSet()
  assert.deepEqual(parseTaskOrder(order), order)
  assert.deepEqual(parseCandidateSubmission(candidate), candidate)
  assert.deepEqual(parseTacticalRequest(request), request)
  assert.deepEqual(parseDecisionQuestionSet(questions), questions)
  assert.deepEqual(parseDocumentContent({ 'specs/README.md': '# Specs\n' }), {
    'specs/README.md': '# Specs\n',
  })
  assert.deepEqual(parseSpecsApplyDraft({
    updates: [{
      document: 'specs/README.md',
      purpose: 'Record the contract.',
      content: '# Specs\n',
    }],
  }), {
    updates: [{
      document: 'specs/README.md',
      purpose: 'Record the contract.',
      content: '# Specs\n',
    }],
  })
})

test('canonical runtime schemas reject nested type confusion and undeclared fields', () => {
  const invalidTask = structuredClone(task()) as unknown as Record<string, unknown>
  const complexity = invalidTask['complexity'] as Record<string, unknown>
  complexity['semanticDecisions'] = 6
  assert.throws(
    () => parseTaskOrder(invalidTask),
    /complexity\.semanticDecisions must be <= 5/u,
  )

  const invalidCandidate = structuredClone(acceptedCandidate(task())) as unknown as Record<string, unknown>
  const identity = invalidCandidate['identity'] as Record<string, unknown>
  identity['generation'] = 'first'
  assert.throws(
    () => parseCandidateSubmission(invalidCandidate),
    /identity\.generation must be integer/u,
  )

  const invalidQuestions = {
    ...decisionSet(),
    injectedAuthority: 'general',
  }
  assert.throws(
    () => parseDecisionQuestionSet(invalidQuestions),
    /injectedAuthority is not allowed/u,
  )
  assert.throws(
    () => parseDocumentContent({ 'specs/README.md': 42 }),
    /must be a string/u,
  )
  assert.throws(
    () => parseSpecsApplyDraft({
      updates: [{ document: '/tmp/outside.md', purpose: 'escape', content: '# no\n' }],
    }),
    /does not match/u,
  )
})

test('Inspector resolves an explicit immutable Agent/Session/generation tuple', async () => {
  const target = identity('worker', 'inspection-target')
  const binding = {
    bindingId: 'inspection-binding',
    agent: target,
  } as unknown as AgentExecutionBinding
  const host = {
    application: {
      executionBindings: {
        async forAgent(agentId: string, generation: number) {
          return agentId === String(target.agentId) && generation === target.generation
            ? binding
            : null
        },
      },
    },
  } as unknown as MilitaryHostRuntime

  assert.deepEqual(await resolveInspectionTarget(host, {
    agentId: target.agentId,
    sessionId: target.sessionId,
    generation: target.generation,
  }), { target, binding })
  await assert.rejects(
    resolveInspectionTarget(host, {
      agentId: target.agentId,
      sessionId: 'spoofed-session',
      generation: target.generation,
    }),
    /does not match the immutable Agent\/Session\/generation tuple/u,
  )
})
