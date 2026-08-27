import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  RC2_AGENT_TEAM_BOUNDARY,
  assertAgentTeamProjectionOnly,
  assertModelInputCapability,
  rc2ContextReserves,
} from '@dsh-military/core'
import { brand, isoNow, type ModelCapabilityProfile } from '@dsh-military/contracts'
import { rc2ReportDelivery } from '@dsh-military/plugin-host/rc2-adapter'

test('RC.2 report delivery wakes or steers the parent for every accepted report', () => {
  assert.equal(rc2ReportDelivery('ordinary'), 'next-step')
  assert.equal(rc2ReportDelivery('critical'), 'next-step')
})

test('RC.2 child transport reserves the durable child id and uses selective direct-child drain', async () => {
  const source = await readFile('packages/plugin-host/src/child-transport.ts', 'utf8')
  assert.match(source, /startContinuable\(\{[\s\S]*?childId,/u)
  assert.match(source, /drainContinuableChildren\(parent, \[childId\]\)/u)
  assert.equal(source.includes('ctx.agents.create('), false)
  assert.equal(source.includes("delivery: 'wakeup'"), false)
})

test('Military source never persists out-of-repository required events into the RC.2 Session log', async () => {
  const sources = [
    'packages/plugin-host/src/host-runtime.ts',
    'packages/plugin-host/src/agent-plane.ts',
    'packages/plugin-host/src/agent-lifecycle.ts',
    'packages/plugin-host/src/compaction-control.ts',
    'packages/plugin-host/src/context-audit.ts',
    'packages/plugin-host/src/request-routing.ts',
    'packages/plugin-host/src/tool-pipeline.ts',
    'packages/plugin-host/src/completion-interlock.ts',
    'packages/tools/src/general.ts',
    'packages/tools/src/worker.ts',
    'packages/tools/src/engineer.ts',
    'packages/tools/src/inspector.ts',
    'packages/tools/src/research.ts',
  ]
  for (const path of sources) {
    const text = await readFile(path, 'utf8')
    assert.equal(/(?:session|agent\.session)\.append\(\s*['"]military\//u.test(text), false, path)
  }
  const declarations = await readFile('packages/plugin-host/src/session-events.ts', 'utf8')
  assert.equal(declarations.includes('SessionEventMap'), false)
  const compatibility = await readFile('packages/core/src/compatibility.ts', 'utf8')
  assert.match(compatibility, /externalRequiredTypeRegistration:\s*value\.externalRequiredSessionEventRegistration/u)
  assert.match(compatibility, /militaryAuthorityUsesOwnLedger:\s*value\.militaryAuthorityUsesOwnLedger/u)
})

test('RC.2 model capability rejects images on text-only routes and enforces byte bounds', () => {
  const textOnly = model('text-only', ['text'])
  const vision = model('vision', ['text', 'image'], 1_024)
  assert.throws(() => assertModelInputCapability(textOnly, { modalities: ['text', 'image'], totalImageBytes: 1 }))
  assertModelInputCapability(vision, { modalities: ['text', 'image'], totalImageBytes: 1_024 })
  assert.throws(() => assertModelInputCapability(vision, { modalities: ['text', 'image'], totalImageBytes: 1_025 }))
})

test('RC.2 context reserve includes passback from every reasoned turn', () => {
  assert.deepEqual(rc2ContextReserves({
    previousReasoningTokens: 12_000,
    expectedReasoningGrowthTokens: 3_000,
    imageTokenEstimate: 2_000,
  }), { reasoningPassbackReserve: 15_000, imageReserve: 2_000 })
})

test('RC.2 experimental Agent Team is projection-only', () => {
  assert.equal(RC2_AGENT_TEAM_BOUNDARY.authoritative, false)
  assertAgentTeamProjectionOnly('roster-projection')
  assert.throws(() => assertAgentTeamProjectionOnly('mission-state'))
  assert.throws(() => assertAgentTeamProjectionOnly('candidate-acceptance'))
})

test('RC.2 Web manifest declares client graph explicitly and maintains peer/dev parity', async () => {
  const manifest = JSON.parse(await readFile('packages/webui/package.json', 'utf8')) as {
    dsh: { client: { inject: string[]; external: string[] } }
    peerDependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  assert.deepEqual(manifest.dsh.client.external, [])
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'), false)
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    assert.equal(manifest.devDependencies[name], range, `peer/dev mismatch for ${name}`)
  }
})

test('/brainstorm declares RC.2 image admission and consumes handler attachments', async () => {
  const source = await readFile('packages/command-brainstorm/src/index.ts', 'utf8')
  assert.match(source, /input:\s*\{\s*hint:[^}]+images:\s*allowImages/u)
  assert.match(source, /handler\(\{\s*agent,\s*rawInput,\s*attachments,\s*signal\s*\}\)/u)
  assert.match(source, /totalImageBytes:\s*attachmentBytes\(attachments\)/u)
  assert.match(source, /content:\s*\[\{\s*type:\s*'text',\s*text\s*\},\s*\.\.\.attachments\]/u)
  assert.match(source, /Call military_get_context first/u)
  assert.match(source, /Do not call military_mission_start/u)
  assert.match(source, /templateId "engineer-default"/u)
})

function model(
  id: string,
  inputModalities: readonly ('text' | 'image')[],
  maximumRequestImageBytes?: number,
): ModelCapabilityProfile {
  return {
    schemaVersion: '1.0.0', profileId: `profile-${id}`, revision: brand<number, 'Revision'>(1), status: 'VALIDATED',
    provider: 'deepseek-official', model: id, supportedReasoning: ['off', 'low', 'high', 'max'],
    contextWindowTokens: 1_000_000, maxOutputTokens: 256_000, toolCalling: true,
    inputModalities, reasoningPassback: 'all-reasoning-turns',
    ...(maximumRequestImageBytes === undefined ? {} : { maximumRequestImageBytes }),
    vision: inputModalities.includes('image'), dataResidencyPolicyRefs: ['residency-test'], benchmarks: [], validatedAt: isoNow(),
  }
}
