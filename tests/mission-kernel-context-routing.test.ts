import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brand,
  isoNow,
  type CapabilityGrant,
  type ClaimEvidenceGraph,
  type ModelCapabilityProfile,
  type MissionCommandReceipt,
  type Revision,
  type TaskCapabilityProfile,
} from '@dsh-military/contracts'
import {
  AdaptiveExecutionRouter,
  DeterministicContextCompiler,
  InMemoryCapabilityGrantStore,
  SingleWriterMissionKernel,
  createMissionCommand,
  verifyClaimEvidenceGraph,
  type MissionCommandHandler,
} from '@dsh-military/core'
import { identity, missionId, task } from './helpers.js'

class TestCommandHandler implements MissionCommandHandler {
  revision = brand<number, 'Revision'>(0)
  admissions: string[] = []
  receipts = new Map<string, MissionCommandReceipt>()

  async execute<T>(
    command: Parameters<MissionCommandHandler['execute']>[0],
    operation: () => Promise<T>,
  ) {
    const prior = this.receipts.get(command.idempotencyKey)
    if (prior !== undefined) return { receipt: { ...prior, duplicate: true }, value: 'first' as T }
    assert.equal(Number(command.expectedRevision), Number(this.revision))
    const previousRevision = this.revision
    this.admissions.push(command.commandId)
    this.revision = brand<number, 'Revision'>(Number(this.revision) + 1)
    const value = await operation()
    const receipt = {
      commandId: command.commandId,
      missionId: command.missionId,
      previousRevision,
      revision: this.revision,
      eventIds: [`event-${Number(this.revision)}`],
      activityIds: [],
      duplicate: false,
    } as const
    this.receipts.set(command.idempotencyKey, receipt)
    return { receipt, value }
  }
}

test('Mission Kernel serializes one mission and does not repeat idempotent side effects', async () => {
  const handler = new TestCommandHandler()
  const kernel = new SingleWriterMissionKernel(handler)
  const actor = identity('general')
  const order: string[] = []
  const command1 = createMissionCommand({
    tenantId: 'tenant-test', missionId: missionId(), expectedRevision: brand<number, 'Revision'>(0), actor,
    actorAuthorityRef: 'session-authority:general-session', type: 'task.create', payload: { taskId: 'task-1' },
    idempotencyKey: 'task-create:1',
  })
  const command2 = createMissionCommand({
    tenantId: 'tenant-test', missionId: missionId(), expectedRevision: brand<number, 'Revision'>(1), actor,
    actorAuthorityRef: 'session-authority:general-session', type: 'task.create', payload: { taskId: 'task-2' },
    idempotencyKey: 'task-create:2',
  })
  const first = kernel.execute(command1, async () => {
    order.push('first-start')
    await new Promise(resolve => setTimeout(resolve, 5))
    order.push('first-end')
    return 'first'
  })
  const second = kernel.execute(command2, async () => { order.push('second'); return 'second' })
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
  assert.equal(firstResult.value, 'first')
  assert.equal(secondResult.value, 'second')
  let repeated = false
  const duplicate = await kernel.execute(command1, async () => { repeated = true; return 'duplicate' })
  assert.equal(duplicate.receipt.duplicate, true)
  assert.equal(duplicate.value, 'first')
  assert.equal(repeated, false)
  assert.equal(handler.admissions.length, 2)
})

test('Context Compiler reserves reasoning/image budget and records omitted evidence', async () => {
  const material = new Map([
    ['constitution:mission', 100], ['state:task', 100], ['evidence:small', 150], ['evidence:large', 900], ['working:note', 100],
  ])
  const compiler = new DeterministicContextCompiler({
    async materialize(ref) {
      const tokenEstimate = material.get(ref)
      if (tokenEstimate === undefined) throw new Error(`unknown ref ${ref}`)
      return { contentRef: ref, sha256: brand<string, 'Sha256'>('a'.repeat(64)), tokenEstimate }
    },
  })
  const order = task()
  const manifest = await compiler.compile({
    missionId: order.missionId, missionRevision: brand<number, 'Revision'>(3), task: order,
    constitutionRefs: ['constitution:mission'], stateRefs: ['state:task'],
    evidenceRefs: ['evidence:small', 'evidence:large'], workingRefs: ['working:note'],
    tokenBudget: 1000, reasoningPassbackReserve: 100, imageReserve: 100,
  })
  assert.equal(manifest.tokenAllocation.reasoningPassbackReserve, 100)
  assert.equal(manifest.tokenAllocation.imageReserve, 100)
  assert.deepEqual(manifest.omittedEvidenceRefs, ['evidence:large'])
  assert.ok(manifest.sections.some(section => section.contentRef === 'evidence:small'))
})

test('Claim-Evidence Graph rejects semantic-only evidence for a required claim', () => {
  const graph: ClaimEvidenceGraph = {
    schemaVersion: '1.0.0', graphId: 'graph-1', candidateId: 'candidate-1',
    claims: [{ claimId: 'claim-1', statement: 'Tests pass.', type: 'behavior', required: true, minimumTier: 'V2' }],
    links: [{ claimId: 'claim-1', evidenceRef: 'judge-1', supports: true, tier: 'V4', producedAtRevision: brand<number, 'Revision'>(1) }],
    createdAt: isoNow(),
  }
  const result = verifyClaimEvidenceGraph(graph)
  assert.equal(result.covered, false)
  assert.ok(result.failures.includes('SEMANTIC_ONLY:claim-1'))
})

test('Adaptive Router admits image-capable models and bounds multi-agent parallelism', async () => {
  const router = new AdaptiveExecutionRouter()
  const order = task(missionId(), 'task-routing', [])
  const profile: TaskCapabilityProfile = {
    schemaVersion: '1.0.0', profileId: 'capability-routing',
    semanticCapabilities: ['visual-review'], toolCapabilities: ['read_image'], minimumReasoning: 'high',
    minimumContextTokens: 100_000, inputModalities: ['text', 'image'], riskClass: 'medium', requiredVerificationTier: 'V3',
    parallelismInputs: {
      independentSubproblems: 10, independentEvidenceSources: 8, sharedContext: 1,
      writeConflict: 0, temporalDependency: 0, joinCost: 1, integrationRisk: 1,
    },
  }
  const textOnly = model('text-only', ['text'])
  const vision = model('vision', ['text', 'image'])
  const strategy = await router.route({ task: order, capability: profile, candidateModels: [textOnly, vision] })
  assert.equal(strategy.model, 'vision')
  assert.equal(strategy.paradigm, 'multi-agent')
  assert.equal(strategy.parallelism, 5)
  assert.equal(strategy.maximumSteps, order.budget.modelSteps)

  const expanded = await router.route({
    task: {
      ...order,
      budget: { ...order.budget, modelSteps: 16 },
    },
    capability: profile,
    candidateModels: [vision],
  })
  assert.equal(expanded.maximumSteps, 16)
})

test('Capability Grant is tool, path, expiry and use-count limited', async () => {
  const store = new InMemoryCapabilityGrantStore()
  const issued = Date.now()
  const grant: CapabilityGrant = {
    schemaVersion: '1.0.0', grantId: 'grant-1', principalId: 'worker-agent', activationId: 'worker-session',
    missionId: missionId(), taskId: brand<string, 'TaskId'>('task-1'), taskVersion: brand<number, 'TaskVersion'>(1),
    allowedTools: ['read_file'], resourcePatterns: ['src'], dataClassificationCeiling: 'confidential',
    maximumUses: 2, uses: 0, issuedAt: brand<string, 'IsoDateTime'>(new Date(issued).toISOString()),
    expiresAt: brand<string, 'IsoDateTime'>(new Date(issued + 60_000).toISOString()), nonce: '0123456789abcdef', state: 'ACTIVE',
  }
  await store.issue(grant)
  const first = await store.consume('grant-1', { tool: 'read_file', resource: 'src/a.ts', at: new Date(issued + 1).toISOString() })
  assert.equal(first.uses, 1)
  const second = await store.consume('grant-1', { tool: 'read_file', resource: 'src/b.ts', at: new Date(issued + 2).toISOString() })
  assert.equal(second.state, 'EXHAUSTED')
  await assert.rejects(async () => await store.consume('grant-1', { tool: 'read_file', resource: 'src/c.ts', at: new Date(issued + 3).toISOString() }))
})

function model(id: string, inputModalities: readonly ('text' | 'image')[]): ModelCapabilityProfile {
  return {
    schemaVersion: '1.0.0', profileId: `model-${id}`, revision: brand<number, 'Revision'>(1), status: 'VALIDATED',
    provider: 'deepseek-official', model: id, supportedReasoning: ['off', 'low', 'high', 'max'],
    contextWindowTokens: 1_000_000, maxOutputTokens: 256_000, toolCalling: true,
    inputModalities, reasoningPassback: 'all-reasoning-turns', maximumRequestImageBytes: 20_971_520,
    vision: inputModalities.includes('image'), dataResidencyPolicyRefs: ['residency-test'], benchmarks: [], validatedAt: isoNow(),
  }
}
