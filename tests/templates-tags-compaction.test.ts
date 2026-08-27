import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brand, MilitaryError } from '@dsh-military/contracts'
import { GeneralRoutingService, InMemoryAgentTemplateRegistry, InMemoryCompactionAttempts, InMemoryMilitaryPolicyRegistry, InMemoryTacticalTagRegistry } from '@dsh-military/core'
import { defaultGeneralPolicy, defaultModelProfiles } from '@dsh-military/plugin-host/defaults'
import { identity, minimalTemplate, stamp } from './helpers.js'

test('template revisions increment exactly once and inactive templates cannot instantiate', async () => {
  const registry = new InMemoryAgentTemplateRegistry()
  const first = minimalTemplate()
  await registry.create(first)
  await registry.revise({ ...first, revision: brand<number, 'Revision'>(2), displayName: 'Worker v2', updatedAt: stamp() }, first.revision)
  assert.equal(Number((await registry.get(first.templateId)).revision), 2)
  await registry.setStatus(first.templateId, 'PAUSED')
  await assert.rejects(async () => registry.resolveForInstantiation(first.templateId), (error: unknown) =>
    error instanceof MilitaryError && error.failure.code === 'AGENT_TEMPLATE_INACTIVE')
})

test('tactical tags preserve stable ids across rename, pause and tombstone', async () => {
  const tags = new InMemoryTacticalTagRegistry()
  const id = brand<string, 'TacticalTagId'>('react')
  const revision = brand<number, 'Revision'>(1)
  await tags.create({ schemaVersion: '1.0.0', tagId: id, revision, displayName: 'React', status: 'ACTIVE', aliases: ['reactjs'], matchTerms: ['hooks'], parentTagIds: [], createdAt: stamp(), updatedAt: stamp() })
  const renamed = await tags.rename(id, 'React UI', revision)
  assert.equal(renamed.displayName, 'React UI')
  assert.deepEqual(tags.match('hooks rendering').map(String), ['react'])
  const paused = await tags.pause(id, renamed.revision)
  assert.deepEqual(tags.match('hooks rendering'), [])
  const deleted = await tags.delete(id, paused.revision)
  assert.equal(deleted.status, 'DELETED')
  await assert.rejects(async () => tags.resume(id, deleted.revision), (error: unknown) =>
    error instanceof MilitaryError && error.failure.code === 'TACTICAL_TAG_DELETED')
})

test('compaction attempts require threshold and safe boundary', async () => {
  const attempts = new InMemoryCompactionAttempts()
  const pending = {
    schemaVersion: '1.0.0' as const, attemptId: 'compact-1', agent: identity('worker'), rootSessionId: 'root',
    pressureGeneration: 1, contextBudgetTokens: 1000, thresholdTokens: 900, meterTokens: 900,
    trigger: 'PRESSURE' as const,
    safeBoundary: { toolPairsBalanced: true, candidateTransactionIdle: true, gitTransactionIdle: true, freezeStateStable: true },
    outcome: 'PENDING' as const, createdAt: stamp(),
  }
  await attempts.require(pending)
  await attempts.complete({ ...pending, outcome: 'SUCCEEDED', dshCompactionId: 'dsh-1', completedAt: stamp() })
  assert.equal((await attempts.get('compact-1')).outcome, 'SUCCEEDED')
  await assert.rejects(async () => attempts.require({ ...pending, attemptId: 'bad', meterTokens: 899 }), (error: unknown) =>
    error instanceof MilitaryError && error.failure.code === 'CONTEXT_POLICY_INVALID')
})


test('General starts from the preset default and preserves explicit compatible Session model switches', async () => {
  const policies = new InMemoryMilitaryPolicyRegistry()
  for (const profile of defaultModelProfiles()) policies.registerModel(profile)
  const routing = new GeneralRoutingService(defaultGeneralPolicy, policies)
  const session = brand<string, 'SessionId'>('general-model-session')
  const initial = await routing.applyPresetDefault(session)
  assert.equal(initial.model, 'deepseek-v4-flash')
  assert.equal(initial.reasoningEffort, 'high')
  const duplicate = await routing.validateUserSelection({
    sessionId: session, provider: initial.provider, model: initial.model, selectedBy: 'webui',
  })
  assert.equal(duplicate.receiptId, initial.receiptId)
  await routing.updatePresetDefault({
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'max',
    maxOutputTokens: 16_384,
  })
  assert.equal((await routing.applyPresetDefault(session)).receiptId, initial.receiptId)
  const nextSessionDefault = await routing.applyPresetDefault(
    brand<string, 'SessionId'>('general-model-session-after-settings'),
  )
  assert.equal(nextSessionDefault.model, 'deepseek-v4-pro')
  assert.equal(nextSessionDefault.reasoningEffort, 'max')
  const switched = await routing.validateUserSelection({
    sessionId: session, provider: 'deepseek-official', model: 'deepseek-v4-pro',
    reasoningEffort: 'max', selectedBy: 'webui',
  })
  assert.equal(switched.model, 'deepseek-v4-pro')
  assert.equal(switched.reasoningEffort, 'max')
  assert.equal(switched.previousModel, 'deepseek-v4-flash')
  assert.equal(switched.previousReasoningEffort, 'high')

  policies.registerModel({
    schemaVersion: '1.0.0',
    profileId: 'third-party-plain',
    revision: brand<number, 'Revision'>(1),
    status: 'DEPRECATED',
    provider: 'third-party-provider',
    model: 'plain-economy-model',
    supportedReasoning: ['off'],
    contextWindowTokens: 4_096,
    maxOutputTokens: 1_024,
    toolCalling: false,
    inputModalities: ['text'],
    reasoningPassback: 'all-reasoning-turns',
    dataResidencyPolicyRefs: [],
    benchmarks: [],
    validatedAt: stamp(),
  })
  const anyDshRoute = await routing.validateUserSelection({
    sessionId: brand<string, 'SessionId'>('general-any-dsh-model'),
    provider: 'third-party-provider',
    model: 'plain-economy-model',
    reasoningEffort: 'high',
    selectedBy: 'dsh-session-model-selector',
  })
  assert.equal(anyDshRoute.provider, 'third-party-provider')
  assert.equal(anyDshRoute.model, 'plain-economy-model')
})
