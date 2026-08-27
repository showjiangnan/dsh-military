import {
  brand,
  isoNow,
  type AcceptanceContractId,
  type AgentIdentity,
  type AgentTemplateProfile,
  type CandidateSubmission,
  type DecisionQuestionSet,
  type MissionId,
  type MilitarySessionBinding,
  type ResourceBudgetPolicy,
  type ResourceBudgetReservation,
  type ResourceUsageReceipt,
  type TacticalGuidance,
  type TacticalRequest,
  type TaskOrder,
} from '@dsh-military/contracts'
import { zeroCounters } from '@dsh-military/core'

export const stamp = (): ReturnType<typeof isoNow> => isoNow()
export const missionId = (value = 'mission-1'): MissionId => brand<string, 'MissionId'>(value)
export const sessionId = (value: string) => brand<string, 'SessionId'>(value)
export const agentId = (value: string) => brand<string, 'AgentId'>(value)

export function identity(role: AgentIdentity['role'] = 'worker', suffix: string = role): AgentIdentity {
  return {
    agentId: agentId(`${suffix}-agent`),
    sessionId: sessionId(`${suffix}-session`),
    role,
    displayName: suffix,
    generation: 1,
    ...(role === 'general' || role === 'harness' ? {} : {
      templateId: brand<string, 'AgentTemplateId'>(`${role}-template`),
      templateRevision: brand<number, 'Revision'>(1),
    }),
  }
}

export function militaryBinding(id = 'general-session', parent?: string): MilitarySessionBinding {
  return {
    schemaVersion: '1.0.0',
    sessionId: sessionId(id),
    presetId: 'military',
    presetGeneration: 'military@sha256:test',
    rootAgentId: agentId('general-agent'),
    activatedAt: stamp(),
    workspaceKey: '/workspace/example',
    selectionSource: parent === undefined ? 'new-session-selection' : 'resume',
    capabilityFingerprint: brand<string, 'Sha256'>('a'.repeat(64)),
    ...(parent === undefined ? {} : { parentSessionId: sessionId(parent) }),
    tenantId: 'tenant-1',
    generationManifestRef: 'manifest:test',
    dshBaselineCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
    resumeDisposition: 'NEW',
  }
}

export function task(orderMissionId = missionId(), id = 'task-1', writes: readonly string[] = ['src']): TaskOrder {
  return {
    schemaVersion: '1.0.0',
    missionId: orderMissionId,
    directionId: brand<string, 'DirectionId'>('direction-1'),
    waveId: brand<string, 'WaveId'>('wave-1'),
    taskId: brand<string, 'TaskId'>(id),
    taskVersion: brand<number, 'TaskVersion'>(1),
    objective: `Complete ${id}`,
    whyItMatters: 'test fixture',
    taskType: 'test',
    assignedRole: 'worker',
    complexity: {
      semanticDecisions: 1,
      unknownDependencies: 0,
      writeDomains: Math.min(5, writes.length) as 0 | 1 | 2 | 3 | 4 | 5,
      toolFamilies: 1,
      acceptanceAmbiguity: 0,
      integrationFanOut: 0,
      contextFootprint: 'small',
    },
    scope: { readPaths: ['.'], writePaths: writes, forbiddenPaths: ['.git'] },
    allowedTools: ['read_file', 'write_file'],
    requiredEvidence: ['result'],
    acceptance: { contractId: brand<string, 'AcceptanceContractId'>('acceptance-test'), version: 1 },
    dependencies: [],
    tactics: [],
    environmentSnapshotRef: 'env:test',
    stopConditions: ['accepted'],
    escalationConditions: ['blocked'],
    budget: { modelSteps: 8, toolCalls: 32, guidanceRequests: 2, wallClockSeconds: 300 },
  }
}

export function acceptedCandidate(order: TaskOrder, worker = identity('worker')): CandidateSubmission {
  const evidence = [{ kind: 'tool-call' as const, ref: 'tool:tool-call-1', claim: 'verified tool output' }]
  return {
    schemaVersion: '1.0.0',
    candidateId: brand<string, 'CandidateId'>('candidate-1'),
    identity: worker,
    location: {
      missionId: order.missionId,
      directionId: order.directionId,
      waveId: order.waveId,
      taskId: order.taskId,
      taskVersion: order.taskVersion,
      attemptId: brand<string, 'AttemptId'>('attempt-1'),
    },
    summary: 'verified candidate',
    outputs: [],
    evidence,
    declaredToolCallIds: ['tool-call-1'],
    acceptanceMapping: { objective: evidence, tests: evidence, scope: evidence },
    skillUsage: [],
    environmentSnapshotRef: order.environmentSnapshotRef,
    changedPaths: [],
    knownLimitations: [],
    submittedAt: stamp(),
    idempotencyKey: 'candidate-idempotency-1',
  }
}

export function decisionSet(root = 'general-session'): DecisionQuestionSet {
  return {
    schemaVersion: '1.0.0',
    decisionSetId: brand<string, 'DecisionSetId'>('decision-1'),
    producer: identity('chief-of-staff'),
    targetRootSessionId: sessionId(root),
    contextVersion: 1,
    purpose: 'architecture migration choice',
    deliveryAuthority: 'general',
    questions: [{
      id: 'q1', question: 'Choose a strategy', header: 'Strategy', multiSelect: false,
      options: [{ label: 'A', description: 'Option A' }, { label: 'B', description: 'Option B' }],
      decisionOwner: 'user',
    }],
    dedupeKey: 'architecture-choice',
    createdAt: stamp(),
    expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
  }
}

export function tacticalRequest(): TacticalRequest {
  const worker = identity('worker')
  const order = task()
  return {
    schemaVersion: '1.0.0',
    requestId: brand<string, 'TacticalRequestId'>('radio-1'),
    identity: worker,
    location: {
      missionId: order.missionId, directionId: order.directionId, waveId: order.waveId,
      taskId: order.taskId, taskVersion: order.taskVersion, attemptId: brand<string, 'AttemptId'>('attempt-1'),
    },
    environmentSnapshotRef: 'env:test', currentSkills: [],
    blocker: { type: 'test-failure', statement: 'reproducible blocker', reproducible: true, minimalReproduction: 'run test' },
    attempts: [{ action: 'run test', observation: 'failed', toolCallIds: ['call-1'] }],
    evidence: [{ kind: 'tool-call', ref: 'tool:call-1', claim: 'test failed' }],
    requestedDecision: 'select repair tactic',
    budget: order.budget,
    idempotencyKey: 'radio-key-1',
    createdAt: stamp(),
    expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
  }
}

export function tacticalGuidance(request = tacticalRequest()): TacticalGuidance {
  return {
    schemaVersion: '1.0.0',
    guidanceId: brand<string, 'TacticalGuidanceId'>('guidance-1'),
    requestId: request.requestId,
    expectedTaskVersion: request.location.taskVersion,
    advisorIdentity: identity('advisor'),
    candidateSkills: [], selectedSkills: [], diagnosis: 'fixture diagnosis',
    directive: [{ stepId: 'step-1', action: 'apply deterministic fix' }],
    expectedObservations: ['test passes'], requiredEvidence: ['test output'],
    stopConditions: ['verification passes'], fallback: 'return blocker',
    issuedAt: stamp(),
    expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
  }
}

export function budgetPolicy(): ResourceBudgetPolicy {
  return {
    schemaVersion: '1.0.0', policyId: 'budget-test', revision: brand<number, 'Revision'>(1),
    status: 'ACTIVE', scope: 'TASK',
    limits: { modelRequests: 10, reasoningTokens: 1000, wallClockSeconds: 100, toolCalls: 20, apiCalls: 10, concurrentAgents: 2, radioRounds: 2, reworkAttempts: 2, storageBytes: 10000 },
    warningPercent: 80, hardStopPercent: 100, disposition: 'PAUSE_AND_REPORT', createdAt: stamp(),
  }
}

export function reservation(): ResourceBudgetReservation {
  const requested = { ...zeroCounters(), modelRequests: 2, toolCalls: 3 }
  return {
    schemaVersion: '1.0.0', reservationId: 'reservation-1', tenantId: 'tenant-1',
    scopeType: 'TASK', scopeId: 'task-1', policyId: 'budget-test', policyRevision: brand<number, 'Revision'>(1),
    ownerAgent: identity('worker'), requested, granted: zeroCounters(), state: 'RESERVED',
    idempotencyKey: 'reservation-key-1', reservedAt: stamp(),
    expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
  }
}

export function usageReceipt(res: ResourceBudgetReservation): ResourceUsageReceipt {
  return {
    schemaVersion: '1.0.0', receiptId: 'usage-1', reservationId: res.reservationId,
    scopeType: res.scopeType, scopeId: res.scopeId,
    actual: { ...zeroCounters(), modelRequests: 1, toolCalls: 2 }, overages: zeroCounters(),
    disposition: 'SETTLED', sourceEventIds: ['event-1'], idempotencyKey: 'usage-key-1',
    startedAt: stamp(), completedAt: stamp(),
  }
}

export function minimalTemplate(): AgentTemplateProfile {
  const createdAt = stamp()
  return {
    schemaVersion: '1.0.0', templateId: brand<string, 'AgentTemplateId'>('worker-template'), revision: brand<number, 'Revision'>(1),
    displayName: 'Worker', department: 'worker-forces', role: 'worker', status: 'ACTIVE',
    modelPolicy: {
      provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high', maxOutputTokens: 4096,
      fallbackTemplateIds: [], dataResidency: 'enterprise', modelCapabilityProfileId: 'model-test', dataResidencyPolicyRef: 'residency-test', allowFallback: false,
    },
    contextPolicy: { contextBudgetTokens: 10000, compactionTriggerPercent: 90, retainedTailTokens: 1000, minimumRearmDeltaPercent: 10, maxCompactionAttemptsPerTurn: 1, onCompactionFailure: 'PAUSE_AND_ESCALATE' },
    capabilities: { toolProfileId: 'worker-tools', toolProfileRevision: brand<number, 'Revision'>(1), permissionProfileId: 'worker-permission', permissionProfileRevision: brand<number, 'Revision'>(1), tacticalSkillPatterns: [], apiGrantIds: [], verifierProfileIds: ['verifier'] },
    domainTagIds: [], taskTypes: ['test'], concurrencyLimit: 2, createdAt, updatedAt: createdAt,
  }
}
