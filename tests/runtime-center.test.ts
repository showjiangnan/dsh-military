import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  brand,
  type CandidatePatch,
  type IntegrationOrder,
} from '@dsh-military/contracts'
import {
  ExecutionLifecycleCoordinator,
  InMemoryMilitaryBrainstorm,
  MilitaryOrchestrator,
  OversightController,
} from '@dsh-military/core'
import {
  localSingleUserWebPrincipal,
  MilitaryRuntimeRemoteService,
  type MilitaryHostRuntime,
} from '@dsh-military/plugin-host'
import {
  SqliteExecutionLifecycleStateStore,
  SqliteIntegrationStateStore,
  SqliteMilitaryDatabase,
  SqliteMilitaryLedger,
  SqliteMilitaryRuntimeStateStore,
  SqliteStateRecords,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import {
  acceptedCandidate,
  identity,
  missionId,
  sessionId,
  stamp,
  task,
} from './helpers.js'

test('Runtime Center projects the canonical request-to-integration hierarchy with revision metadata', async () => {
  const temporary = await temporaryDirectory('military-runtime-center-')
  const context = new Context()
  const tenantId = 'tenant-runtime-center'
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const ledger = new SqliteMilitaryLedger(database, tenantId)
    const runtimeState = new SqliteMilitaryRuntimeStateStore(
      database,
      tenantId,
    )
    const lifecycle = new ExecutionLifecycleCoordinator({
      state: new SqliteExecutionLifecycleStateStore(database, tenantId),
      clock: () => new Date(),
    })
    const mission = missionId('mission-runtime-center')
    const rootSession = sessionId('session-runtime-center')
    const general = identity('general')
    const worker = identity('worker')
    const order = task(mission, 'task-runtime-center')
    const candidate = acceptedCandidate(order, worker)
    const runtime = new MilitaryOrchestrator({
      ledger,
      state: runtimeState,
      verification: {
        prepare(): void {},
        async verify() {
          return {
            receiptId: 'verification-runtime-center',
            candidateId: String(candidate.candidateId),
            disposition: 'ACCEPTED' as const,
            clauseResults: [],
            deterministicFailures: [],
            claimEvidenceGraph: {
              schemaVersion: '1.0.0' as const,
              graphId: 'graph-runtime-center',
              candidateId: String(candidate.candidateId),
              claims: [],
              links: [],
              createdAt: stamp(),
            },
          }
        },
      },
      oversight: new OversightController(),
      brainstorm: new InMemoryMilitaryBrainstorm(),
    })
    await runtime.registerMission({
      missionId: mission,
      rootSessionId: rootSession,
      general,
      title: 'Runtime Center fixture',
      authorityContextRef: 'authority:runtime-center',
    })
    await runtime.registerTask(order, general)
    await runtime.leaseTask(order.taskId, worker, 'workspace-runtime-center')
    await runtime.proposeCandidate(candidate)

    const workflow = await lifecycle.openWorkflowObligation({
      tenantId,
      rootSessionId: rootSession,
      requestKey: 'request-runtime-center',
      requestHash: 'a'.repeat(64),
      requestSummary: '实现并验证 Runtime Center',
      reason: 'USER_EXECUTION',
    })
    await lifecycle.advanceWorkflowObligation({
      obligationId: workflow.obligationId,
      expectedRevision: workflow.revision,
      state: 'WAITING_CHILD',
      stage: 'WAIT_FOR_SETTLEMENT',
      missionId: mission,
      taskIds: [order.taskId],
      transitionReason: 'department dispatch is live',
    })
    const dispatch = await lifecycle.reserveTaskDispatch({
      tenantId,
      missionId: mission,
      taskId: order.taskId,
      taskVersion: order.taskVersion,
      dispatchKey: 'dispatch-runtime-center',
      payloadHash: 'b'.repeat(64),
      cause: 'INITIAL',
    })
    await lifecycle.bindActivationAgent(dispatch.activation.activationId, worker)
    await lifecycle.markDispatch({
      dispatchId: dispatch.dispatch.dispatchId,
      state: 'ACCEPTED',
      transportReceiptId: 'transport-runtime-center',
    })
    await lifecycle.markDispatch({
      dispatchId: dispatch.dispatch.dispatchId,
      state: 'STARTED',
      childSessionId: worker.sessionId,
    })

    const records = new SqliteStateRecords(database, tenantId)
    const patch: CandidatePatch = {
      schemaVersion: '1.0.0',
      candidatePatchId: brand<string, 'CandidatePatchId'>(
        'candidate-patch-runtime-center',
      ),
      candidateId: String(candidate.candidateId),
      missionId: String(mission),
      taskId: String(order.taskId),
      taskVersion: Number(order.taskVersion),
      baseWorkspaceSnapshotId: 'snapshot-runtime-center',
      patchArtifact: {
        artifactId: brand<string, 'ArtifactId'>(
          'artifact-runtime-center-patch',
        ),
        sha256: brand<string, 'Sha256'>('c'.repeat(64)),
        mediaType: 'application/octet-stream',
        byteLength: 16,
        classification: 'internal',
        tenantId,
        missionId: String(mission),
        taskId: String(order.taskId),
      },
      changedPaths: ['src/runtime.ts'],
      applyMode: 'GIT_BINARY_PATCH',
      preconditions: ['expected head matches'],
      patchHash: brand<string, 'Sha256'>('d'.repeat(64)),
      createdAt: stamp(),
    }
    records.putSync(
      'workspace-candidate-patch',
      String(patch.candidatePatchId),
      patch,
      { createOnly: true },
    )
    const integrationOrder: IntegrationOrder = {
      schemaVersion: '1.0.0',
      integrationOrderId: brand<string, 'IntegrationOrderId'>(
        'integration-runtime-center',
      ),
      missionId: String(mission),
      taskId: String(order.taskId),
      taskVersion: Number(order.taskVersion),
      candidatePatchId: String(patch.candidatePatchId),
      targetBranch: 'main',
      expectedHead: 'e'.repeat(40),
      expectedTreeHash: 'f'.repeat(40),
      conflictPolicy: 'STOP_AND_REPORT',
      verifierProfileRefs: ['verifier-runtime-center@1'],
      authorizedBy: String(general.agentId),
      createdAt: stamp(),
    }
    await new SqliteIntegrationStateStore(database, tenantId)
      .queue(integrationOrder)

    const host = {
      tenantId,
      database,
      webPrincipal: localSingleUserWebPrincipal(tenantId),
    } as unknown as MilitaryHostRuntime
    const service = new MilitaryRuntimeRemoteService(context, host)
    const snapshot = await service.snapshot(AbortSignal.timeout(5_000))

    assert.equal(snapshot.authority.tenantId, tenantId)
    assert.equal(snapshot.projection.health, 'FRESH')
    assert.ok(snapshot.projection.sourceRevision > 0)
    assert.ok(Date.parse(snapshot.projection.staleAfter)
      > Date.parse(snapshot.projection.generatedAt))
    const byId = new Map(snapshot.nodes.map(node => [node.id, node]))
    assert.equal(
      byId.get(String(mission))?.parentId,
      workflow.obligationId,
    )
    assert.equal(
      byId.get(String(order.directionId))?.parentId,
      String(mission),
    )
    assert.equal(
      byId.get(String(order.waveId))?.parentId,
      String(order.directionId),
    )
    assert.equal(
      byId.get(String(order.taskId))?.parentId,
      String(order.waveId),
    )
    assert.equal(
      byId.get(dispatch.attempt.attemptId)?.parentId,
      String(order.taskId),
    )
    assert.equal(
      byId.get(dispatch.activation.activationId)?.parentId,
      dispatch.attempt.attemptId,
    )
    assert.equal(
      byId.get(dispatch.dispatch.dispatchId)?.parentId,
      dispatch.activation.activationId,
    )
    assert.equal(
      byId.get(String(candidate.candidateId))?.parentId,
      String(order.taskId),
    )
    assert.equal(
      byId.get(String(patch.candidatePatchId))?.parentId,
      String(candidate.candidateId),
    )
    assert.equal(
      byId.get('verification-runtime-center')?.parentId,
      String(candidate.candidateId),
    )
    assert.equal(
      byId.get(String(integrationOrder.integrationOrderId))?.parentId,
      String(patch.candidatePatchId),
    )
  } finally {
    database.close()
    await context.fiber.dispose()
    await temporary.dispose()
  }
})
