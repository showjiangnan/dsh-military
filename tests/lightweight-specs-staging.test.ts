import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { MilitaryError, type TaskOrder } from '@dsh-military/contracts'
import { LocalArtifactStore } from '@dsh-military/infrastructure'
import {
  compileEngineerSpecsDraft,
  materializeEngineerSpecsDraft,
  stageEngineerSpecsChunk,
} from '@dsh-military/tools'
import { temporaryDirectory } from '@dsh-military/testkit'
import { missionId, task } from './helpers.js'

test('large Specs documents stage in bounded chunks and materialize atomically for one Task version', async () => {
  const temp = await temporaryDirectory('military-specs-staging-')
  try {
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const ctx = {
      militaryHost: { application: { artifacts } },
    } as unknown as Context
    const order = {
      ...task(missionId('staged-specs-mission'), 'staged-specs-task', ['specs']),
      assignedRole: 'engineer',
      taskType: 'specs',
      complexity: {
        ...task().complexity,
        contextFootprint: 'large',
      },
      allowedTools: [
        'military_specs_read',
        'military_specs_stage_chunk',
        'military_specs_apply_order',
      ],
    } as TaskOrder
    const first = await stageEngineerSpecsChunk(ctx, order, {
      document: 'specs/large.md',
      chunkIndex: 0,
      content: '# Large specification\n\n',
    })
    const second = await stageEngineerSpecsChunk(ctx, order, {
      document: 'specs/large.md',
      chunkIndex: 1,
      content: 'Complete content from the second model step.\n',
    })
    const materialized = await materializeEngineerSpecsDraft(ctx, {
      updates: [{
        document: 'specs/large.md',
        purpose: 'Prove staged large-document support.',
        contentArtifactIds: [first.artifactId, second.artifactId],
      }],
    }, order)
    assert.equal(
      materialized.updates[0]?.content,
      '# Large specification\n\nComplete content from the second model step.\n',
    )
    const compiled = compileEngineerSpecsDraft({
      draft: materialized,
      task: order,
      issuedAt: '2026-08-25T00:00:00.000Z',
    })
    assert.equal(
      compiled.contentByDocument['specs/large.md'],
      materialized.updates[0]?.content,
    )
    const changedContent = compileEngineerSpecsDraft({
      draft: {
        updates: [{
          ...materialized.updates[0]!,
          content: `${materialized.updates[0]!.content}\nA different final byte.\n`,
        }],
      },
      task: order,
      issuedAt: '2026-08-25T00:00:00.000Z',
    })
    assert.notEqual(
      changedContent.order.orderId,
      compiled.order.orderId,
      'the idempotency identity must include exact document bytes',
    )

    const smallOrder = {
      ...order,
      complexity: { ...order.complexity, contextFootprint: 'small' },
    } as TaskOrder
    await assert.rejects(
      stageEngineerSpecsChunk(ctx, smallOrder, {
        document: 'specs/large.md',
        chunkIndex: 0,
        content: 'not authorized',
      }),
      (error: unknown) => error instanceof MilitaryError
        && error.failure.code === 'POLICY_DENIED',
    )

    await assert.rejects(
      materializeEngineerSpecsDraft(ctx, {
        updates: [{
          document: 'specs/large.md',
          purpose: 'Wrong chunk order.',
          contentArtifactIds: [second.artifactId, first.artifactId],
        }],
      }, order),
      (error: unknown) => error instanceof MilitaryError
        && error.failure.code === 'INVALID_ARGUMENT'
        && /contiguous from 0/u.test(error.message),
    )
    const foreign = {
      ...order,
      taskId: 'foreign-task',
    } as unknown as TaskOrder
    await assert.rejects(
      materializeEngineerSpecsDraft(ctx, {
        updates: [{
          document: 'specs/large.md',
          purpose: 'Cross-Task replay.',
          contentArtifactIds: [first.artifactId],
        }],
      }, foreign),
      (error: unknown) => error instanceof MilitaryError
        && error.failure.code === 'AGENT_EXECUTION_BINDING_MISMATCH',
    )
  } finally {
    await temp.dispose()
  }
})
