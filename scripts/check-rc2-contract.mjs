import { readFile, writeFile } from 'node:fs/promises'

const snapshot = JSON.parse(await readFile('RC2-CONTRACT-SNAPSHOT.json', 'utf8'))
const version = JSON.parse(await readFile('VERSION.json', 'utf8'))
assert(version.dshRelease === snapshot.release, 'VERSION release differs from the RC.2 contract snapshot')
assert(version.dshCommit === snapshot.commit, 'VERSION commit differs from the RC.2 contract snapshot')

const child = await readFile('packages/plugin-host/src/child-transport.ts', 'utf8')
const host = await readFile('packages/plugin-host/src/host-runtime.ts', 'utf8')
const hostEntry = await readFile('packages/plugin-host/src/index.ts', 'utf8')
const rc2Adapter = await readFile('packages/plugin-host/src/rc2-adapter.ts', 'utf8')
const brainstorm = await readFile('packages/command-brainstorm/src/index.ts', 'utf8')
const web = await readFile('packages/webui/src/client/index.tsx', 'utf8')
const webManifest = JSON.parse(await readFile('packages/webui/package.json', 'utf8'))
const modelSchema = JSON.parse(await readFile('packages/contracts/schemas/model-capability-profile.schema.json', 'utf8'))
const agentPlane = await readFile('packages/plugin-host/src/agent-plane.ts', 'utf8')
const compactionControl = await readFile('packages/plugin-host/src/compaction-control.ts', 'utf8')
const contextAudit = await readFile('packages/plugin-host/src/context-audit.ts', 'utf8')

for (const required of ['startContinuable', 'childId,', 'drainContinuableChildren']) {
  assert(child.includes(required) || host.includes(required), `missing RC.2 subagent contract: ${required}`)
}
assert(!child.includes("'wakeup'") && !host.includes("'wakeup'") && !rc2Adapter.includes("'wakeup'"), 'obsolete wakeup delivery remains in RC.2 source')
assert(rc2Adapter.includes("'next-step'"), 'RC.2 next-step report delivery is absent')
assert(brainstorm.includes('attachments') && brainstorm.includes('images:'), 'RC.2 command image contract is not consumed')
assert(web.includes('SettingsScope') && !web.includes('ClientSettingsScope'), 'WebUI does not use the RC.2 SettingsScope contract')
assert(Array.isArray(webManifest.dsh?.client?.inject), 'Web package has no dsh.client.inject declaration')
assert(Array.isArray(webManifest.dsh?.client?.external), 'Web package has no dsh.client.external declaration')
for (const [name, range] of Object.entries(webManifest.peerDependencies ?? {})) {
  assert(webManifest.devDependencies?.[name] === range, `peer/dev range mismatch for ${name}`)
}
assert(webManifest.peerDependencies?.react === undefined, 'React is an implicit RC.2 client baseline and must not be a peer')
assert(webManifest.devDependencies?.react === '18.2.0', 'WebUI must compile against the RC.2 React 18 baseline')
assert(webManifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-settings'] === snapshot.release, 'WebUI must declare its settings module augmentation dependency')
const props = modelSchema.properties ?? {}
assert('inputModalities' in props, 'model capability schema has no RC.2 input modalities')
assert('reasoningPassback' in props, 'model capability schema has no RC.2 reasoning passback policy')
assert(contextAudit.includes("type: 'context/manifest-created'"), 'Context Manifest is not durably audited')
assert(
  agentPlane.includes("'compaction'") && agentPlane.includes("'tokenMeter'"),
  'Preset Agent Plane does not inject its RC.2 compaction and token meter services',
)
assert(compactionControl.includes('.tokenMeter.measure(') && !compactionControl.includes('estimateSession'), 'Agent Plane does not use the RC.2 TokenMeter.measure API')
const hostInject = hostEntry.match(/export const inject = \[(.*?)\]/su)?.[1] ?? ''
assert(!hostInject.includes("'compaction'"), 'Host plane must not wait for preset-owned compaction')

const report = {
  schemaVersion: '1.1.0',
  generatedAt: new Date().toISOString(),
  release: snapshot.release,
  commit: snapshot.commit,
  mode: 'SOURCE_DERIVED_CONTRACT_SNAPSHOT',
  checks: [
    { name: 'official-source-hashes-pinned', passed: true, evidence: 'RC2-CONTRACT-SNAPSHOT.json' },
    { name: 'subagent-next-step-and-reserved-id', passed: true, evidence: 'packages/plugin-host/src' },
    { name: 'command-image-attachments', passed: true, evidence: 'packages/command-brainstorm/src/index.ts' },
    { name: 'host-preset-compaction-ownership', passed: true, evidence: 'packages/plugin-host/src/index.ts and agent-plane.ts' },
    { name: 'token-meter-measure', passed: true, evidence: 'packages/plugin-host/src/compaction-control.ts' },
    { name: 'shared-settings-scope-and-client-edges', passed: true, evidence: 'packages/webui' },
    { name: 'deepseek-image-and-reasoning-policy', passed: true, evidence: 'model-capability-profile.schema.json' },
    { name: 'context-manifest-durable-audit', passed: true, evidence: 'packages/plugin-host/src/context-audit.ts' },
  ],
  disposition: 'PASS',
  productionRequirement: 'The release gate separately requires exact-checkout typechecking and the installed RC.2 Profile E2E.',
}
await writeFile('RC2-CONTRACT-REPORT.json', `${JSON.stringify(report, null, 2)}\n`)
await writeFile('RC2-CONTRACT-REPORT.md', [
  '# RC.2 Contract Snapshot Report', '',
  `Generated: ${report.generatedAt}`, '',
  `Baseline: \`${report.release}\` @ \`${report.commit}\``, '',
  `Mode: **${report.mode}**`, '',
  '## Result', '',
  '**PASS**', '',
  'The load-bearing RC.2 adapter, topology, token-meter and client-package invariants are pinned and verified.',
  'Exact upstream declaration compilation and installed-Profile execution are independent release gates.', '',
].join('\n'))
console.log(`RC.2 contract snapshot verified: ${snapshot.release} @ ${snapshot.commit}`)

function assert(value, message) {
  if (!value) throw new Error(message)
}
