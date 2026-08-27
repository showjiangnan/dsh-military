import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MilitaryError,
  brand,
  missionEvent,
  type AgentExecutionBinding,
} from '@dsh-military/contracts'
import {
  LedgerMissionCommandHandler,
  InMemoryMilitaryBrainstorm,
  MilitaryOrchestrator,
  OversightController,
  SingleWriterMissionKernel,
  createMissionCommand,
} from '@dsh-military/core'
import {
  SqliteAgentExecutionBindings,
  SqliteMilitaryDatabase,
  SqliteMilitaryLedger,
  SqliteMilitaryRuntimeStateStore,
  SqliteMilitarySessionGate,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { acceptedCandidate, identity, militaryBinding, missionId, sessionId, stamp, task } from './helpers.js'

test('SQLite migrations, CAS ledger and idempotency survive reopen', async () => {
  const temp = await temporaryDirectory('military-sqlite-')
  const path = `${temp.path}/military.sqlite`
  try {
    let database = new SqliteMilitaryDatabase({ path })
    const ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    const mission = missionId('sqlite-mission')
    const actor = identity('general')
    const event = missionEvent({
      type: 'mission/started', missionId: mission, actor,
      payload: { title: 'SQLite mission', rootSessionId: 'root', authorityContextRef: 'authority:1' },
      metadata: { idempotencyKey: 'mission-start' },
    })
    const first = await ledger.append(event, brand<number, 'Revision'>(0))
    const second = await ledger.append(event, brand<number, 'Revision'>(0))
    assert.equal(first.seq, second.seq)
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    const reopened = new SqliteMilitaryLedger(database, 'tenant-1')
    assert.equal((await reopened.readEvents(mission)).length, 1)
    database.close()
  } finally { await temp.dispose() }
})

test('SQLite transaction API rejects asynchronous callbacks and rolls back their synchronous prefix', async () => {
  const database = new SqliteMilitaryDatabase({ path: ':memory:' })
  try {
    database.db.exec('CREATE TABLE synchronous_transaction_probe(value TEXT NOT NULL)')
    assert.throws(
      () => database.transaction(async () => {
        database.db.prepare(
          'INSERT INTO synchronous_transaction_probe(value) VALUES (?)',
        ).run('must-roll-back')
        await Promise.resolve()
      }),
      /transaction callbacks must be synchronous/u,
    )
    const row = database.db.prepare(`
      SELECT COUNT(*) AS count FROM synchronous_transaction_probe
    `).get() as { readonly count: number }
    assert.equal(row.count, 0)

    assert.throws(
      () => database.transaction(() => {
        database.transaction(async () => {
          database.db.prepare(
            'INSERT INTO synchronous_transaction_probe(value) VALUES (?)',
          ).run('nested-must-roll-back')
          await Promise.resolve()
        })
        return 'outer-result'
      }),
      /transaction callbacks must be synchronous/u,
      'a nested callback cannot hide a thenable from the outer transaction',
    )
    assert.equal(
      (database.db.prepare(`
        SELECT COUNT(*) AS count FROM synchronous_transaction_probe
      `).get() as { readonly count: number }).count,
      0,
    )

    let lateContinuation: Promise<void> | undefined
    assert.throws(
      () => database.transaction(() => {
        lateContinuation = (async () => {
          await Promise.resolve()
          database.transaction(() => {
            database.db.prepare(
              'INSERT INTO synchronous_transaction_probe(value) VALUES (?)',
            ).run('late-write-must-not-escape')
          })
        })()
        return lateContinuation
      }),
      /transaction callbacks must be synchronous/u,
    )
    assert.ok(lateContinuation)
    await assert.rejects(
      lateContinuation,
      /transaction context expired/u,
    )
    assert.equal(
      (database.db.prepare(`
        SELECT COUNT(*) AS count FROM synchronous_transaction_probe
      `).get() as { readonly count: number }).count,
      0,
    )

    let directLateContinuation: Promise<void> | undefined
    assert.throws(
      () => database.transaction(() => {
        const statement = database.db.prepare(
          'INSERT INTO synchronous_transaction_probe(value) VALUES (?)',
        )
        directLateContinuation = (async () => {
          await Promise.resolve()
          statement.run('direct-late-write-must-not-escape')
        })()
        return directLateContinuation
      }),
      /transaction callbacks must be synchronous/u,
    )
    assert.ok(directLateContinuation)
    await assert.rejects(
      directLateContinuation,
      /write attempted from an expired asynchronous transaction context/u,
    )
    assert.equal(
      (database.db.prepare(`
        SELECT COUNT(*) AS count FROM synchronous_transaction_probe
      `).get() as { readonly count: number }).count,
      0,
    )

    assert.throws(
      () => database.db.exec('BEGIN IMMEDIATE'),
      /direct SQLite transaction control is forbidden/u,
    )
    assert.throws(
      () => database.maintenance(() => {
        database.db.prepare(
          'INSERT INTO synchronous_transaction_probe(value) VALUES (?)',
        ).run('maintenance-must-not-bypass-writer')
      }),
      /maintenance only permits VACUUM INTO writes/u,
    )
    assert.throws(
      () => database.maintenance(() => {
        database.db.exec(`
          INSERT INTO synchronous_transaction_probe(value)
          VALUES ('maintenance-exec-must-not-bypass-writer')
        `)
      }),
      /maintenance only permits startup PRAGMA or VACUUM INTO/u,
    )
    assert.equal(
      (database.db.prepare(`
        SELECT COUNT(*) AS count FROM synchronous_transaction_probe
      `).get() as { readonly count: number }).count,
      0,
    )
  } finally {
    database.close()
  }
})

test('Mission Command Saga fences concurrent in-flight effects across independent kernels', async () => {
  const database = new SqliteMilitaryDatabase({ path: ':memory:' })
  try {
    const mission = missionId('saga-concurrent-mission')
    const actor = identity('general')
    const firstLedger = new SqliteMilitaryLedger(database, 'tenant-1')
    const secondLedger = new SqliteMilitaryLedger(database, 'tenant-1')
    const firstKernel = new SingleWriterMissionKernel(
      new LedgerMissionCommandHandler(firstLedger),
    )
    const secondKernel = new SingleWriterMissionKernel(
      new LedgerMissionCommandHandler(secondLedger),
    )
    const firstCommand = createMissionCommand({
      tenantId: 'tenant-1',
      missionId: mission,
      expectedRevision: brand<number, 'Revision'>(0),
      actor,
      actorAuthorityRef: 'authority:saga-concurrency',
      type: 'mission.first',
      payload: { sequence: 1 },
      idempotencyKey: 'saga-concurrency:first',
    })
    const duplicateCommand = createMissionCommand({
      tenantId: 'tenant-1',
      missionId: mission,
      expectedRevision: brand<number, 'Revision'>(0),
      actor,
      actorAuthorityRef: 'authority:saga-concurrency',
      type: 'mission.first',
      payload: { sequence: 1 },
      idempotencyKey: 'saga-concurrency:first',
    })
    const secondCommand = createMissionCommand({
      tenantId: 'tenant-1',
      missionId: mission,
      expectedRevision: brand<number, 'Revision'>(1),
      actor,
      actorAuthorityRef: 'authority:saga-concurrency',
      type: 'mission.second',
      payload: { sequence: 2 },
      idempotencyKey: 'saga-concurrency:second',
    })
    let releaseEffect!: () => void
    const effectBlocked = new Promise<void>(resolve => {
      releaseEffect = resolve
    })
    let enteredEffect!: () => void
    const effectEntered = new Promise<void>(resolve => {
      enteredEffect = resolve
    })
    let firstEffects = 0
    const first = firstKernel.execute(firstCommand, async () => {
      firstEffects += 1
      enteredEffect()
      await effectBlocked
      return 'first-result'
    })
    await effectEntered

    let duplicateEffects = 0
    await assert.rejects(
      secondKernel.execute(duplicateCommand, async () => {
        duplicateEffects += 1
        return 'duplicate-result'
      }),
      militaryFailure('RESOURCE_LOCKED'),
      'the same unexpired operation lease must not execute twice',
    )
    await assert.rejects(
      secondKernel.execute(secondCommand, async () => 'second-result'),
      militaryFailure('RESOURCE_LOCKED'),
      'a different command cannot interleave its events into an active Mission command',
    )
    assert.equal(firstEffects, 1)
    assert.equal(duplicateEffects, 0)

    releaseEffect()
    const committed = await first
    assert.equal(committed.value, 'first-result')
    assert.equal(committed.receipt.eventIds.length, 1)
    assert.equal((await firstLedger.readEvents(mission)).length, 1)
  } finally {
    database.close()
  }
})

test('Mission command Saga checkpoints intent, recovers an applied effect and finalizes once across restart', async () => {
  const temp = await temporaryDirectory('military-command-uow-')
  const path = `${temp.path}/military.sqlite`
  try {
    const mission = missionId('atomic-mission')
    const actor = identity('general')
    let database = new SqliteMilitaryDatabase({ path })
    let ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    let kernel = new SingleWriterMissionKernel(new LedgerMissionCommandHandler(ledger))
    const failed = createMissionCommand({
      tenantId: 'tenant-1',
      missionId: mission,
      expectedRevision: brand<number, 'Revision'>(0),
      actor,
      actorAuthorityRef: 'authority:test',
      type: 'mission.start',
      payload: { title: 'recoverable mission' },
      idempotencyKey: 'mission-recovery',
    })
    await assert.rejects(kernel.execute(failed, async () => {
      await ledger.append(missionEvent({
        type: 'mission/started',
        missionId: mission,
        actor,
        payload: { title: 'recoverable mission', rootSessionId: 'atomic-root', authorityContextRef: 'authority:test' },
        metadata: { idempotencyKey: 'domain-recovery' },
      }))
      throw new Error('fault injection after domain append')
    }))
    assert.equal((await ledger.readEvents(mission)).length, 2)
    assert.equal((database.db.prepare('SELECT count(*) AS count FROM mission_command_receipts').get() as { count: number }).count, 0)
    assert.equal((database.db.prepare('SELECT count(*) AS count FROM transactional_outbox').get() as { count: number }).count, 0)
    const operationCheckpoint = database.db.prepare(`
        SELECT state, lease_owner, result_json
        FROM mission_command_operations
        WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
      `).get(
      'tenant-1',
      String(mission),
      'mission-recovery',
    ) as {
      readonly state: string
      readonly lease_owner: string | null
      readonly result_json: string | null
    }
    assert.equal(operationCheckpoint.state, 'RETRYABLE')
    assert.equal(operationCheckpoint.lease_owner, null)
    assert.equal(operationCheckpoint.result_json, null)
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    kernel = new SingleWriterMissionKernel(
      new LedgerMissionCommandHandler(ledger),
    )
    const committed = await kernel.execute(failed, async () => {
      await ledger.append(missionEvent({
        type: 'mission/started',
        missionId: mission,
        actor,
        payload: { title: 'recoverable mission', rootSessionId: 'atomic-root', authorityContextRef: 'authority:test' },
        metadata: { idempotencyKey: 'domain-recovery' },
      }))
      return 'committed'
    })
    assert.equal(committed.value, 'committed')
    assert.equal(committed.receipt.previousRevision, 0)
    assert.equal(committed.receipt.revision, 2)
    assert.equal(committed.receipt.eventIds.length, 2)
    assert.equal(committed.receipt.activityIds.length, 1)
    let repeated = false
    const duplicate = await kernel.execute(failed, async () => {
      repeated = true
      return 'repeated'
    })
    assert.equal(duplicate.receipt.duplicate, true)
    assert.equal(duplicate.value, 'committed')
    assert.equal(repeated, false)
    assert.equal((await ledger.readEvents(mission)).length, 2)
    assert.equal((database.db.prepare('SELECT count(*) AS count FROM mission_command_receipts').get() as { count: number }).count, 1)
    assert.equal((database.db.prepare('SELECT count(*) AS count FROM transactional_outbox').get() as { count: number }).count, 1)
    assert.equal(
      (database.db.prepare(`
        SELECT state FROM mission_command_operations
        WHERE tenant_id = ? AND mission_id = ? AND idempotency_key = ?
      `).get(
        'tenant-1',
        String(mission),
        'mission-recovery',
      ) as { readonly state: string }).state,
      'COMMITTED',
    )
    database.close()
  } finally {
    await temp.dispose()
  }
})

test('Mission and Task runtime projections resume from SQLite after process restart', async () => {
  const temp = await temporaryDirectory('military-runtime-resume-')
  const path = `${temp.path}/military.sqlite`
  try {
    const mission = missionId('runtime-resume-mission')
    const rootSessionId = sessionId('runtime-resume-root')
    const general = identity('general')
    const worker = identity('worker')
    const order = task(mission, 'runtime-resume-task')
    const candidate = acceptedCandidate(order, worker)
    const verification = {
      prepare(): void {},
      async verify() {
        return {
          receiptId: 'verification-runtime-resume',
          candidateId: String(candidate.candidateId),
          disposition: 'ACCEPTED' as const,
          clauseResults: [],
          deterministicFailures: [],
          claimEvidenceGraph: {
            schemaVersion: '1.0.0' as const,
            graphId: 'graph-runtime-resume',
            candidateId: String(candidate.candidateId),
            claims: [],
            links: [],
            createdAt: stamp(),
          },
        }
      },
    }

    let database = new SqliteMilitaryDatabase({ path })
    let ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    let state = new SqliteMilitaryRuntimeStateStore(database, 'tenant-1')
    let runtime = new MilitaryOrchestrator({
      ledger,
      state,
      verification,
      oversight: new OversightController(),
      brainstorm: new InMemoryMilitaryBrainstorm(),
    })
    let kernel = new SingleWriterMissionKernel(new LedgerMissionCommandHandler(ledger))
    const start = createMissionCommand({
      tenantId: 'tenant-1',
      missionId: mission,
      expectedRevision: brand<number, 'Revision'>(0),
      actor: general,
      actorAuthorityRef: 'authority:runtime-resume',
      type: 'mission.start',
      payload: { rootSessionId: String(rootSessionId) },
      idempotencyKey: 'runtime-resume:start',
    })
    await kernel.execute(start, () => runtime.registerMission({
      missionId: mission,
      rootSessionId,
      general,
      title: 'Runtime resume',
      authorityContextRef: 'authority:runtime-resume',
    }))
    const afterStart = await ledger.readMission(mission)
    const createTask = createMissionCommand({
      tenantId: 'tenant-1',
      missionId: mission,
      expectedRevision: afterStart.revision,
      actor: general,
      actorAuthorityRef: 'authority:runtime-resume',
      type: 'task.create',
      payload: { taskId: String(order.taskId) },
      idempotencyKey: 'runtime-resume:task',
      taskId: order.taskId,
      taskVersion: order.taskVersion,
    })
    await kernel.execute(createTask, () => runtime.registerTask(order, general))
    await runtime.leaseTask(order.taskId, worker, 'workspace-lease-runtime-resume')
    const proposed = await runtime.proposeCandidate(candidate)
    assert.equal(proposed.verification.disposition, 'ACCEPTED')
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    ledger = new SqliteMilitaryLedger(database, 'tenant-1')
    state = new SqliteMilitaryRuntimeStateStore(database, 'tenant-1')
    runtime = new MilitaryOrchestrator({
      ledger,
      state,
      verification,
      oversight: new OversightController(),
      brainstorm: new InMemoryMilitaryBrainstorm(),
    })
    assert.deepEqual(await runtime.getTask(order.taskId), order)
    assert.equal(await runtime.missionForSession(rootSessionId), mission)
    const restored = await state.getTask(order.taskId)
    assert.equal(restored?.state, 'ACCEPTED')
    assert.equal(restored?.candidate?.candidateId, candidate.candidateId)
    assert.equal(restored?.verification?.receiptId, 'verification-runtime-resume')
    database.close()
  } finally {
    await temp.dispose()
  }
})

test('SQLite session and immutable execution bindings enforce exact identity', async () => {
  const temp = await temporaryDirectory('military-binding-')
  try {
    const database = new SqliteMilitaryDatabase({ path: `${temp.path}/military.sqlite` })
    const binding = militaryBinding('root')
    database.db.prepare(`INSERT INTO preset_generations(generation, public_preset_id, hidden_archive_id, asset_hash, bundle_version, dsh_commit, status, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(binding.presetGeneration, 'military', 'archive-test', 'asset-test', '0.4.0', binding.dshBaselineCommit, 'CURRENT', '{}', String(binding.activatedAt))
    const sessions = new SqliteMilitarySessionGate(database, 'tenant-1')
    await sessions.bind(binding)
    assert.equal((await sessions.requireMilitarySession(binding.sessionId)).presetGeneration, binding.presetGeneration)
    const childBinding = militaryBinding('child', 'root')
    const grandchildBinding = militaryBinding('grandchild', 'child')
    await sessions.bind(childBinding)
    await sessions.bind(grandchildBinding)
    await sessions.verifyChild(binding.sessionId, childBinding.sessionId)
    await sessions.verifyChild(childBinding.sessionId, grandchildBinding.sessionId)
    const storedRoot = database.db.prepare(
      'SELECT root_session_id FROM military_session_bindings WHERE tenant_id = ? AND session_id = ?',
    ).get('tenant-1', 'grandchild') as { root_session_id: string }
    assert.equal(storedRoot.root_session_id, 'root')

    const worker = identity('worker')
    const execution: AgentExecutionBinding = {
      schemaVersion: '1.0.0', bindingId: 'binding-1', tenantId: 'tenant-1', rootSessionId: 'root', missionId: 'mission-1',
      agent: worker, departmentId: 'worker-forces', templateId: String(worker.templateId), templateRevision: worker.templateRevision!,
      presetGeneration: binding.presetGeneration, capabilityGrantId: 'grant-1',
      concurrencyReservationId: 'agent-budget-1',
      executionStrategy: {
        schemaVersion: '1.0.0', strategyId: 'strategy-1', provider: 'deepseek-official', model: 'deepseek-v4-pro',
        reasoningEffort: 'high', paradigm: 'react', maximumSteps: 8, verificationTier: 'V2', parallelism: 1,
        rationale: ['sqlite-test'],
      },
      provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high',
      modelCapabilityProfileId: 'model-1', toolProfile: { id: 'worker-tools', revision: brand<number, 'Revision'>(1) },
      permissionProfile: { id: 'worker-permission', revision: brand<number, 'Revision'>(1) }, apiGrants: [],
      dataResidencyPolicy: { id: 'residency', revision: brand<number, 'Revision'>(1) }, redactionPolicy: { id: 'redaction', revision: brand<number, 'Revision'>(1) },
      verifierProfiles: [{ id: 'verifier', revision: brand<number, 'Revision'>(1) }],
      contextPolicy: { contextBudgetTokens: 10000, compactionTriggerPercent: 90, retainedTailTokens: 1000, minimumRearmDeltaPercent: 10, maxCompactionAttemptsPerTurn: 1, onCompactionFailure: 'PAUSE_AND_ESCALATE' },
      resourceBudgetPolicy: { id: 'budget', revision: brand<number, 'Revision'>(1) }, createdAt: stamp(),
    }
    const bindings = new SqliteAgentExecutionBindings(database, 'tenant-1')
    await bindings.create(execution)
    assert.equal((await bindings.forAgent(String(worker.agentId), 1))?.bindingId, 'binding-1')
    assert.equal((await bindings.verifyEffectiveRequest({ bindingId: 'binding-1', provider: execution.provider, model: execution.model, reasoningEffort: 'high', toolProfileId: 'worker-tools', permissionProfileId: 'worker-permission' })).valid, true)
    database.close()
  } finally { await temp.dispose() }
})

function militaryFailure(code: string): (error: unknown) => boolean {
  return error =>
    error instanceof MilitaryError
    && error.failure.code === code
}
