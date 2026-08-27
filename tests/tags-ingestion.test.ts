import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brand, isoNow, type TacticalIngestionRequest, type TacticalTag } from '@dsh-military/contracts'
import { InMemoryTacticalTagRegistry, sha256, stableJson } from '@dsh-military/core'
import { LocalArtifactStore } from '@dsh-military/infrastructure'
import { HeuristicTacticalExtractor, TacticalIngestionRuntime } from '@dsh-military/runtime'
import { temporaryDirectory } from '@dsh-military/testkit'

test('tag governance and direct experience ingestion preserve review before draft approval', async () => {
  const temp = await temporaryDirectory()
  try {
    const tags = new InMemoryTacticalTagRegistry()
    const tag: TacticalTag = {
      schemaVersion: '1.0.0', tagId: brand<string, 'TacticalTagId'>('react'), revision: brand<number, 'Revision'>(1),
      displayName: 'React', status: 'ACTIVE', aliases: ['ReactJS'], matchTerms: ['react', 'hooks'], parentTagIds: [],
      createdAt: isoNow(), updatedAt: isoNow(),
    }
    await tags.create(tag)
    assert.deepEqual(tags.match('React hooks architecture'), [tag.tagId])
    const paused = await tags.pause(tag.tagId, tag.revision)
    assert.equal(paused.status, 'PAUSED')
    assert.equal(tags.match('react').length, 0)
    const active = await tags.resume(tag.tagId, paused.revision)

    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const ingestion = new TacticalIngestionRuntime({
      artifacts, tags, extractor: new HeuristicTacticalExtractor(artifacts),
      sessions: { read: async () => new TextEncoder().encode('unused') },
    })
    const request: TacticalIngestionRequest = {
      schemaVersion: '1.0.0', requestId: brand<string, 'TacticalIngestionRequestId'>('ingestion-test'), requestedBy: 'user-test',
      source: { sourceType: 'direct-text', title: 'React experience', content: '在复杂 React 项目中，应当先固定状态边界并为副作用建立可重复测试。这项经验需要在隔离任务中验证。' },
      tagSelection: { primaryTagId: active.tagId, additionalTagIds: [], allowProposeNewTags: false },
      desiredOutcome: 'NEW_TACTIC',
      extractionPolicy: { classification: 'internal', visibility: 'user-private', redactSecrets: true, requireUserReview: true },
      consent: { confirmed: true, purpose: 'Create a private tactic', confirmedAt: isoNow() },
      createdAt: isoNow(), idempotencyKey: 'ingestion-test',
    }
    await ingestion.request(request)
    const candidate = await ingestion.candidate(request.requestId)
    assert.ok(candidate)
    assert.equal(candidate.status, 'PENDING_REVIEW')
    const hash = sha256(stableJson(candidate))
    await ingestion.reviewCandidate({
      candidateId: candidate.candidateId,
      expectedCandidateHash: hash,
      expectedDiffHash: String(candidate.diffArtifact?.sha256 ?? candidate.proposedContent.sha256),
      action: 'APPROVE_AS_DRAFT',
      actor: { kind: 'USER', id: 'user-test' },
    })
    assert.equal((await ingestion.candidateById(candidate.candidateId)).status, 'APPROVED_AS_DRAFT')
  } finally { await temp.dispose() }
})
