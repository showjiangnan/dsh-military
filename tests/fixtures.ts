import {
  brand,
  isoNow,
  type AgentIdentity,
  type CandidateSubmission,
  type EvidenceRef,
  type MissionId,
  type TacticalGuidance,
  type TacticalRequest,
  type TaskOrder,
} from '@dsh-military/contracts'

export const missionId = brand<string, 'MissionId'>('mission-test')
export const general: AgentIdentity = {
  agentId: brand<string, 'AgentId'>('general-test'),
  sessionId: brand<string, 'SessionId'>('session-general-test'),
  role: 'general',
  displayName: 'General Test',
  generation: 1,
}
export const worker: AgentIdentity = {
  agentId: brand<string, 'AgentId'>('worker-test'),
  sessionId: brand<string, 'SessionId'>('session-worker-test'),
  role: 'worker',
  displayName: 'Worker Test',
  generation: 1,
  templateId: brand<string, 'AgentTemplateId'>('worker-template'),
  templateRevision: brand<number, 'Revision'>(1),
}
export const advisor: AgentIdentity = {
  agentId: brand<string, 'AgentId'>('advisor-test'),
  sessionId: brand<string, 'SessionId'>('session-advisor-test'),
  role: 'advisor',
  displayName: 'Advisor Test',
  generation: 1,
}

export function makeTask(overrides: Partial<TaskOrder> = {}): TaskOrder {
  return {
    schemaVersion: '1.0.0',
    missionId,
    directionId: brand<string, 'DirectionId'>('direction-test'),
    waveId: brand<string, 'WaveId'>('wave-test'),
    taskId: brand<string, 'TaskId'>('task-test'),
    taskVersion: brand<number, 'TaskVersion'>(1),
    objective: 'Create and verify a source artifact.',
    whyItMatters: 'Exercises the complete candidate acceptance path.',
    taskType: 'test',
    assignedRole: 'worker',
    complexity: {
      semanticDecisions: 1,
      unknownDependencies: 0,
      writeDomains: 1,
      toolFamilies: 1,
      acceptanceAmbiguity: 0,
      integrationFanOut: 0,
      contextFootprint: 'small',
    },
    scope: { readPaths: ['.'], writePaths: ['src'], forbiddenPaths: ['.git'] },
    allowedTools: ['read_file', 'write_file'],
    requiredEvidence: ['objective', 'tests', 'scope'],
    acceptance: { contractId: brand<string, 'AcceptanceContractId'>('acceptance-test'), version: 1 },
    dependencies: [],
    tactics: [],
    environmentSnapshotRef: 'environment:test@1',
    stopConditions: ['all clauses accepted'],
    escalationConditions: ['reproducible blocker'],
    budget: { modelSteps: 8, toolCalls: 32, guidanceRequests: 2, wallClockSeconds: 300 },
    ...overrides,
  }
}

export function makeEvidence(ref: string, claim = 'verified evidence'): EvidenceRef {
  return { kind: 'artifact', ref, claim }
}

export function makeCandidate(order: TaskOrder, evidence: EvidenceRef, overrides: Partial<CandidateSubmission> = {}): CandidateSubmission {
  return {
    schemaVersion: '1.0.0',
    candidateId: brand<string, 'CandidateId'>('candidate-test'),
    identity: worker,
    location: {
      missionId: order.missionId,
      directionId: order.directionId,
      waveId: order.waveId,
      taskId: order.taskId,
      taskVersion: order.taskVersion,
      attemptId: brand<string, 'AttemptId'>('attempt-test'),
    },
    summary: 'Candidate verified by objective evidence.',
    outputs: [],
    evidence: [evidence],
    declaredToolCallIds: ['tool-call-test'],
    acceptanceMapping: { objective: [evidence], tests: [evidence], scope: [evidence] },
    skillUsage: [],
    environmentSnapshotRef: order.environmentSnapshotRef,
    changedPaths: ['src/result.ts'],
    knownLimitations: [],
    submittedAt: isoNow(),
    idempotencyKey: 'candidate-test-idempotency',
    ...overrides,
  }
}

export function makeTacticalRequest(): TacticalRequest {
  return {
    schemaVersion: '1.0.0',
    requestId: brand<string, 'TacticalRequestId'>('radio-request-test'),
    identity: worker,
    location: {
      missionId,
      directionId: brand<string, 'DirectionId'>('direction-test'),
      waveId: brand<string, 'WaveId'>('wave-test'),
      taskId: brand<string, 'TaskId'>('task-test'),
      taskVersion: brand<number, 'TaskVersion'>(1),
      attemptId: brand<string, 'AttemptId'>('attempt-test'),
    },
    environmentSnapshotRef: 'environment:test@1',
    currentSkills: [],
    blocker: { type: 'technical', statement: 'A deterministic blocker is reproducible.', reproducible: true, minimalReproduction: 'run fixture' },
    attempts: [{ action: 'run fixture', observation: 'fails consistently', toolCallIds: ['tool-call-test'] }],
    evidence: [makeEvidence('event:failure')],
    requestedDecision: 'Choose the next tactical action.',
    budget: { guidanceRequests: 2 },
    idempotencyKey: 'radio-request-idempotency',
    createdAt: isoNow(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() as import('@dsh-military/contracts').IsoDateTime,
  }
}

export function makeGuidance(request = makeTacticalRequest()): TacticalGuidance {
  return {
    schemaVersion: '1.0.0',
    guidanceId: brand<string, 'TacticalGuidanceId'>('guidance-test'),
    requestId: request.requestId,
    expectedTaskVersion: request.location.taskVersion,
    advisorIdentity: advisor,
    candidateSkills: [],
    selectedSkills: [],
    diagnosis: 'The fixture needs a bounded retry.',
    directive: [{ stepId: 'step-1', action: 'Repeat the deterministic check once.', expectedOutput: 'new evidence' }],
    expectedObservations: ['new evidence'],
    requiredEvidence: ['tool output'],
    stopConditions: ['same failure persists'],
    fallback: 'Escalate to General.',
    issuedAt: isoNow(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() as import('@dsh-military/contracts').IsoDateTime,
  }
}
