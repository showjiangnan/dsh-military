import { test } from 'node:test'
import assert from 'node:assert/strict'
import { administrativeEvent, missionEvent, brand, MilitaryError } from '@dsh-military/contracts'
import { InMemoryAdministrativeLedger, InMemoryMilitaryLedger } from '@dsh-military/core'
import { general, missionId } from './fixtures.js'

test('in-memory ledgers use 1-based sequences, CAS and content-safe idempotency', async () => {
  const ledger = new InMemoryMilitaryLedger()
  const event = missionEvent({
    type: 'mission/started', missionId, actor: general,
    payload: { title: 'Fixture', rootSessionId: String(general.sessionId), authorityContextRef: 'authority:test' },
    metadata: { idempotencyKey: 'mission-start' },
  })
  const first = await ledger.append(event, brand<number, 'Revision'>(0))
  assert.equal(first.seq, 1)
  assert.equal(Number(first.revision), 1)
  const duplicate = await ledger.append(event, brand<number, 'Revision'>(0))
  assert.deepEqual(duplicate, first)
  await assert.rejects(
    () => ledger.append(missionEvent({
      type: 'mission/started', missionId, actor: general,
      payload: { title: 'Changed', rootSessionId: String(general.sessionId), authorityContextRef: 'authority:test' },
      metadata: { idempotencyKey: 'mission-start' },
    })),
    error => error instanceof MilitaryError && error.failure.code === 'IDEMPOTENCY_CONFLICT',
  )
  await assert.rejects(() => ledger.append(missionEvent({
    type: 'mission/intent-ratified', missionId, actor: general,
    payload: { missionIntentRef: 'intent:test', approvedBy: 'user', decisionReceiptRef: 'decision:test' },
  }), brand<number, 'Revision'>(0)), error => error instanceof MilitaryError && error.failure.code === 'REVISION_CONFLICT')
  assert.equal((await ledger.readEvents(missionId)).length, 1)

  const admin = new InMemoryAdministrativeLedger()
  const receipt = await admin.append(administrativeEvent({
    type: 'tag/changed', actorId: 'user-test', tenantId: 'tenant-test',
    payload: { tagId: 'react', revision: 1, operation: 'created' },
  }))
  assert.equal(receipt.seq, 1)
})
