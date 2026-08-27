import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  brand, isoNow,
  type AgentIdentity, type CandidateSubmission, type MissionId, type TaskOrder,
} from '@dsh-military/contracts'
import { InMemoryAdministrativeLedger, InMemoryMilitaryLedger, type Clock } from '@dsh-military/core'
import { LocalArtifactStore } from '@dsh-military/infrastructure'

export class DeterministicClock {
  #time: number
  constructor(start = Date.parse('2026-08-19T00:00:00.000Z')) { this.#time = start }
  readonly now: Clock = () => new Date(this.#time)
  tick(milliseconds = 1000): void { this.#time += milliseconds }
}

export async function temporaryDirectory(prefix = 'dsh-military-'): Promise<{ path: string; dispose(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  return { path, dispose: async () => { await rm(path, { recursive: true, force: true }) } }
}

export async function memoryFixture(): Promise<{
  readonly clock: DeterministicClock
  readonly ledger: InMemoryMilitaryLedger
  readonly administrativeLedger: InMemoryAdministrativeLedger
  readonly artifacts: LocalArtifactStore
  readonly root: string
  dispose(): Promise<void>
}> {
  const directory = await temporaryDirectory()
  const clock = new DeterministicClock()
  return {
    clock,
    ledger: new InMemoryMilitaryLedger(clock.now),
    administrativeLedger: new InMemoryAdministrativeLedger(clock.now),
    artifacts: new LocalArtifactStore(join(directory.path, 'artifacts')),
    root: directory.path,
    dispose: directory.dispose,
  }
}

export function generalIdentity(session = 'session-general'): AgentIdentity {
  return { agentId: brand<string, 'AgentId'>('general'), sessionId: brand<string, 'SessionId'>(session), role: 'general', displayName: 'General', generation: 1 }
}
export function workerIdentity(session = 'session-worker'): AgentIdentity {
  return { agentId: brand<string, 'AgentId'>('worker'), sessionId: brand<string, 'SessionId'>(session), role: 'worker', displayName: 'Worker', generation: 1 }
}
export function taskOrder(missionId: MissionId, overrides: Partial<TaskOrder> = {}): TaskOrder {
  return {
    schemaVersion: '1.0.0',
    missionId,
    directionId: brand<string, 'DirectionId'>('direction-1'),
    waveId: brand<string, 'WaveId'>('wave-1'),
    taskId: brand<string, 'TaskId'>('task-1'),
    taskVersion: brand<number, 'TaskVersion'>(1),
    objective: 'Produce a deterministic artifact',
    whyItMatters: 'The fixture exercises the verified execution loop.',
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
    requiredEvidence: ['artifact'],
    acceptance: { contractId: brand<string, 'AcceptanceContractId'>('acceptance-test'), version: 1 },
    dependencies: [], tactics: [], environmentSnapshotRef: 'environment:test@1',
    stopConditions: ['acceptance contract satisfied'], escalationConditions: ['deterministic blocker'],
    budget: { modelSteps: 8, toolCalls: 32, guidanceRequests: 2, wallClockSeconds: 300 },
    ...overrides,
  }
}
export function candidate(order: TaskOrder, worker = workerIdentity()): CandidateSubmission {
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
    summary: 'Candidate result', outputs: [], evidence: [], declaredToolCallIds: [],
    acceptanceMapping: {}, skillUsage: [], environmentSnapshotRef: order.environmentSnapshotRef,
    changedPaths: [], knownLimitations: [], submittedAt: isoNow(), idempotencyKey: 'candidate-1',
  }
}
