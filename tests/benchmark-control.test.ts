import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  MILITARY_BENCHMARK_DATASET_VERSION,
  MILITARY_BENCHMARK_SCENARIOS,
  type MilitaryProviderSessionSample,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import {
  MILITARY_BENCHMARK_DATASET_HASH,
  MilitaryBenchmarkRemoteService,
  hasRoleGovernanceFence,
  providerFlashAcceptance,
  providerSampleStability,
  type MilitaryHostRuntime,
} from '@dsh-military/plugin-host'
import { SqliteMilitaryDatabase } from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'

test('fixed benchmark dataset is hashed, complete and exposed by a read/execute RPC only', async () => {
  assert.equal(MILITARY_BENCHMARK_SCENARIOS.length, 9)
  assert.equal(new Set(MILITARY_BENCHMARK_SCENARIOS.map(value => value.id)).size, 9)
  assert.deepEqual(
    new Set(MILITARY_BENCHMARK_SCENARIOS.map(value => value.id)),
    new Set([
      'READ_ONLY_ANALYSIS',
      'CREATE_FILE',
      'EDIT_MULTI_FILE',
      'SPECS_TRANSACTION',
      'SCHEMA_CORRECTION',
      'PARENT_WAKEUP',
      'PATH_REJECTION',
      'TERMINAL_LATCH',
      'RESTART_RECOVERY',
    ]),
  )
  assert.equal(
    MILITARY_BENCHMARK_DATASET_HASH,
    sha256(stableJson({
      version: MILITARY_BENCHMARK_DATASET_VERSION,
      scenarios: MILITARY_BENCHMARK_SCENARIOS,
    })),
  )
  assert.ok(MILITARY_BENCHMARK_SCENARIOS.every(value =>
    value.requiredTools.length > 0 && value.successCriteria.length >= 3))

  const temporary = await temporaryDirectory('military-benchmark-control-')
  const context = new Context()
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const service = new MilitaryBenchmarkRemoteService(context, {
      tenantId: 'tenant-benchmark',
      database,
    } as unknown as MilitaryHostRuntime)
    assert.equal(service.typertRemote.serviceKey, 'militaryBenchmark')
    assert.deepEqual(remoteMethods(service), [
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'execute', invocation: { kind: 'direct' } },
    ])
  } finally {
    database.close()
    await context.fiber.dispose()
    await temporary.dispose()
  }
})

test('Provider observations dedupe sessions and require a precise exact-route sample', () => {
  const first = providerSample('sample-1', 'PASSED')
  const initial = providerSampleStability([first])
  assert.equal(initial[0]?.exactRoute, 'deepseek-official/deepseek-v4-flash')
  assert.equal(initial[0]?.configurationKey, 'worker-flash-configuration')
  assert.equal(initial[0]?.scenarioId, 'CREATE_FILE')
  assert.equal(initial[0]?.sampleCount, 1)
  assert.equal(initial[0]?.uniqueSessionCount, 1)
  assert.equal(initial[0]?.conclusion, 'INSUFFICIENT_SAMPLE')
  assert.equal(providerSampleStability([first, first])[0]?.sampleCount, 1)
  assert.equal(
    providerSampleStability([
      first,
      {
        ...first,
        sampleId: 'parser-revision-2',
        sampleKey: 'legacy-parser-generated-another-key',
        eventFingerprint: 'same-session-reparsed',
      },
    ])[0]?.sampleCount,
    1,
    'parser revisions cannot inflate Session/scenario N',
  )
  const stable = providerSampleStability(Array.from(
    { length: 20 },
    (_, index) => providerSample(
      `sample-${index + 1}`,
      index < 16 ? 'PASSED' : 'FAILED',
    ),
  ))
  assert.equal(stable[0]?.sampleCount, 20)
  assert.equal(stable[0]?.passRate, 0.8)
  assert.equal(stable[0]?.conclusion, 'OBSERVED_STABLE')
})

test('external Flash acceptance requires 50 independent Sessions, Wilson lower bounds and zero safety violations', () => {
  const passing = Array.from({ length: 50 }, (_, index) => ({
    ...providerSample(
      `acceptance-${index + 1}`,
      index < 46 ? 'PASSED' : 'FAILED',
    ),
    firstCallHit: index < 48,
    schemaFirstPass: index < 48,
    completed: index < 46,
  }))
  const accepted = providerFlashAcceptance(passing)[0]!
  assert.equal(accepted.uniqueSessionCount, 50)
  assert.equal(accepted.firstToolHit.numerator, 48)
  assert.equal(accepted.firstToolHit.pointEstimate, 0.96)
  assert.ok(accepted.firstToolHit.confidenceInterval.low >= 0.85)
  assert.equal(accepted.e2eCompletion.numerator, 46)
  assert.equal(accepted.e2eCompletion.pointEstimate, 0.92)
  assert.ok(accepted.e2eCompletion.confidenceInterval.low >= 0.80)
  assert.equal(accepted.conclusion, 'PASSED')

  const unsafe = providerFlashAcceptance([
    { ...passing[0]!, unauthorizedWriteCount: 1 },
    ...passing.slice(1),
  ])[0]!
  assert.equal(unsafe.unauthorizedWriteCount, 1)
  assert.equal(unsafe.conclusion, 'FAILED')
  assert.equal(
    providerFlashAcceptance(passing.slice(0, 49))[0]?.conclusion,
    'INSUFFICIENT_SAMPLE',
  )
  const {
    assessmentRevision: _assessmentRevision,
    unexpectedDeterministicFailureCount: _deterministic,
    unauthorizedWriteCount: _unauthorized,
    falseCompletionCount: _falseCompletion,
    duplicateTerminalCount: _duplicateTerminal,
    ...legacy
  } = passing[0]!
  assert.equal(
    providerFlashAcceptance([legacy])[0]?.excludedLegacySampleCount,
    1,
  )
})

test('fixed benchmark accepts the immutable General Host authority sentinel and requires versioned department permissions', () => {
  assert.equal(hasRoleGovernanceFence({
    roleId: 'general',
    toolProfileRevision: 6,
    permissionProfileId: 'general-host-authority',
    permissionProfileRevision: 0,
  }), true)
  assert.equal(hasRoleGovernanceFence({
    roleId: 'general',
    toolProfileRevision: 6,
    permissionProfileId: 'worker-worktree-write',
    permissionProfileRevision: 1,
  }), false)
  assert.equal(hasRoleGovernanceFence({
    roleId: 'worker-default',
    toolProfileRevision: 6,
    permissionProfileId: 'worker-worktree-write',
    permissionProfileRevision: 1,
  }), true)
  assert.equal(hasRoleGovernanceFence({
    roleId: 'worker-default',
    toolProfileRevision: 6,
    permissionProfileId: 'worker-worktree-write',
    permissionProfileRevision: 0,
  }), false)
})

function providerSample(
  sampleId: string,
  status: MilitaryProviderSessionSample['status'],
): MilitaryProviderSessionSample {
  return {
    schemaVersion: '1.0.0',
    assessmentRevision: 2,
    sampleId,
    sampleKey: `sample-key-${sampleId}`,
    scenarioId: 'CREATE_FILE',
    datasetHash: MILITARY_BENCHMARK_DATASET_HASH,
    sessionId: `session-${sampleId}`,
    roleId: 'worker-default',
    roleRevision: 1,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    aliasStatus: 'EXACT_ROUTE_OBSERVED',
    reasoningEffort: 'high',
    toolProfileRef: 'worker-tools@6',
    configurationKey: 'worker-flash-configuration',
    eventFingerprint: `event-fingerprint-${sampleId}`,
    firstCallHit: status === 'PASSED',
    schemaFirstPass: status === 'PASSED',
    corrected: false,
    completed: status === 'PASSED',
    parentWakeup: false,
    terminalSuccess: status === 'PASSED',
    writeReceiptCount: status === 'PASSED' ? 1 : 0,
    unexpectedDeterministicFailureCount: 0,
    unauthorizedWriteCount: 0,
    falseCompletionCount: 0,
    duplicateTerminalCount: 0,
    inputTokens: 100,
    outputTokens: 40,
    costStatus: 'PROVIDER_PRICING_UNAVAILABLE',
    latencyMs: 250,
    status,
    checks: [{
      id: 'fixture',
      status,
      evidence: 'fixture',
    }],
    evidence: ['fixture'],
    assessedAt: '2026-08-26T00:00:00.000Z',
  }
}
