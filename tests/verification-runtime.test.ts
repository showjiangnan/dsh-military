import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brand } from '@dsh-military/contracts'
import {
  InMemoryMilitaryBrainstorm,
  InMemoryMilitaryLedger,
  InMemoryObservedEvidenceStore,
  MilitaryOrchestrator,
  OversightController,
  VerificationEngine,
} from '@dsh-military/core'
import { LocalArtifactStore } from '@dsh-military/infrastructure'
import { temporaryDirectory } from '@dsh-military/testkit'
import { acceptedCandidate, identity, missionId, sessionId, task } from './helpers.js'

test('Candidate acceptance is owned by the external verification engine and ledger', async () => {
  const temp = await temporaryDirectory('military-runtime-')
  try {
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const ledger = new InMemoryMilitaryLedger()
    const observedEvidence = new InMemoryObservedEvidenceStore()
    const verification = new VerificationEngine(artifacts, observedEvidence)
    const contract = {
      contractId: 'acceptance-test', version: 1, requireIndependentVerification: true,
      clauses: [
        { clauseId: 'objective', description: 'objective', required: true, kind: 'EVIDENCE' as const },
        { clauseId: 'tests', description: 'tests', required: true, kind: 'TOOL_CALL' as const },
        { clauseId: 'scope', description: 'scope', required: true, kind: 'PATH_SCOPE' as const },
      ],
    }
    verification.registerContract(contract)
    const runtime = new MilitaryOrchestrator({ ledger, verification, oversight: new OversightController(), brainstorm: new InMemoryMilitaryBrainstorm() })
    const mission = missionId()
    const general = identity('general')
    const worker = identity('worker')
    await runtime.registerMission({ missionId: mission, rootSessionId: sessionId('general-session'), general, title: 'Fixture mission', authorityContextRef: 'authority:1' })
    const order = task(mission)
    await runtime.registerTask(order, general)
    await runtime.leaseTask(order.taskId, worker, 'workspace-lease-test')
    const candidate = acceptedCandidate(order, worker)
    await observedEvidence.recordToolCall({
      schemaVersion: '1.0.0',
      callId: candidate.declaredToolCallIds[0]!,
      rootCallId: candidate.declaredToolCallIds[0]!,
      agent: worker,
      bindingId: 'binding-test',
      missionId: String(order.missionId),
      taskId: String(order.taskId),
      taskVersion: Number(order.taskVersion),
      toolName: 'write',
      argumentsHash: brand<string, 'Sha256'>('a'.repeat(64)),
      outcomeHash: brand<string, 'Sha256'>('b'.repeat(64)),
      isError: false,
      observedAt: candidate.submittedAt,
    })
    verification.bindCandidate(String(candidate.candidateId), { contract, allowedWritePaths: order.scope.writePaths, submittedByVerifierRole: false })
    const result = await runtime.proposeCandidate(candidate)
    assert.equal(result.acceptedForVerification, true)
    assert.equal(runtime.taskState(order.taskId), 'ACCEPTED')
    const events = await ledger.readEvents(mission)
    assert.ok(events.some(event => event.type === 'verification/completed'))
    assert.ok(events.some(event => event.type === 'task/accepted'))
  } finally {
    await temp.dispose()
  }
})

test('Candidate missing tool evidence is sent to rework', async () => {
  const temp = await temporaryDirectory('military-rework-')
  try {
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const verification = new VerificationEngine(artifacts)
    const contract = { contractId: 'acceptance-test', version: 1, requireIndependentVerification: true,
      clauses: [{ clauseId: 'objective', description: 'objective', required: true, kind: 'EVIDENCE' as const }] }
    verification.registerContract(contract)
    const order = task()
    const base = acceptedCandidate(order)
    const candidate = { ...base, declaredToolCallIds: [] }
    verification.bindCandidate(String(candidate.candidateId), { contract, allowedWritePaths: ['src'], submittedByVerifierRole: false })
    const receipt = await verification.verify(candidate, new AbortController().signal)
    assert.equal(receipt.disposition, 'REWORK')
    assert.ok(receipt.deterministicFailures.includes('UNVERIFIED_TOOL_CLAIM:NO_TOOL_CALLS'))
  } finally {
    await temp.dispose()
  }
})

test('a nonempty declared tool-call list is rejected without a host-observed receipt', async () => {
  const temp = await temporaryDirectory('military-fabricated-evidence-')
  try {
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const verification = new VerificationEngine(artifacts, new InMemoryObservedEvidenceStore())
    const contract = {
      contractId: 'acceptance-test',
      version: 1,
      requireIndependentVerification: true,
      clauses: [{
        clauseId: 'tests',
        description: 'tests',
        required: true,
        kind: 'TOOL_CALL' as const,
      }],
    }
    verification.registerContract(contract)
    const order = task()
    const base = acceptedCandidate(order)
    const candidate = {
      ...base,
      acceptanceMapping: { tests: base.evidence },
      declaredToolCallIds: ['fabricated-call'],
    }
    verification.bindCandidate(String(candidate.candidateId), {
      contract,
      allowedWritePaths: ['src'],
      submittedByVerifierRole: false,
    })
    const receipt = await verification.verify(candidate, new AbortController().signal)
    assert.equal(receipt.disposition, 'REWORK')
    assert.ok(receipt.deterministicFailures.includes('UNVERIFIED_TOOL_CLAIM:MISSING:fabricated-call'))
    assert.ok(receipt.deterministicFailures.includes('UNVERIFIED_TOOL_EVIDENCE:tests'))
  } finally {
    await temp.dispose()
  }
})
