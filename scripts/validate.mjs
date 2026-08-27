import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const RC2 = '0.1.1-rc.2'
const RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

await run(process.execPath, ['scripts/run-docs-validator.mjs'])
const version = JSON.parse(await readFile('VERSION.json', 'utf8'))
if (version.dshRelease !== RC2 || version.dshCommit !== RC2_COMMIT) throw new Error('VERSION.json is not pinned to the exact RC.2 baseline')

const review = JSON.parse(await readFile('CODE-REVIEW-REPORT.json', 'utf8'))
if (review.disposition !== 'PASS' || review.blockingFindings !== 0) throw new Error('code review is not passing')
const tests = JSON.parse(await readFile('TEST-REPORT.json', 'utf8'))
if (tests.disposition !== 'PASS' || tests.failed !== 0) throw new Error('source tests are not passing')

const rc2 = JSON.parse(await readFile('RC2-CONTRACT-REPORT.json', 'utf8'))
if (rc2.disposition !== 'PASS' || rc2.release !== RC2 || rc2.commit !== RC2_COMMIT) throw new Error('RC.2 contract report is not passing or is pinned to another baseline')
if (rc2.mode !== 'SOURCE_DERIVED_CONTRACT_SNAPSHOT') throw new Error('unknown RC.2 contract verification mode')

const build = JSON.parse(await readFile('BUILD-MANIFEST.json', 'utf8'))
if (build.sourceVersion !== version.sourceVersion || build.dshCommit !== RC2_COMMIT) throw new Error('build manifest baseline/version mismatch')
for (const entry of build.files) {
  const bytes = await readFile(entry.path)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== entry.sha256 || bytes.byteLength !== entry.byteLength) throw new Error(`stale build manifest: ${entry.path}`)
}

const manifest = JSON.parse(await readFile('packages/preset/agent-presets/military/generation-manifest.json', 'utf8'))
if (manifest.bundleVersion !== version.sourceVersion) throw new Error('preset manifest source version mismatch')
if (manifest.dshBaseline?.release !== RC2 || manifest.dshBaseline?.commit !== RC2_COMMIT) throw new Error('preset baseline is not exact RC.2')
if (manifest.generation !== `military@sha256:${manifest.assetHash}`) throw new Error('preset generation does not match assetHash')
for (const entry of manifest.files) {
  const bytes = await readFile(`packages/preset/agent-presets/military/${entry.path}`)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== entry.sha256 || bytes.byteLength !== entry.byteLength) throw new Error(`stale preset generation manifest: ${entry.path}`)
  const archived = await readFile(`packages/preset/generations/${manifest.assetHash}/${entry.path}`)
  if (!bytes.equals(archived)) throw new Error(`current preset archive differs: ${entry.path}`)
}
await stat('packages/webui/lib/client.cjs')
await stat('CODE-REVIEW-REPORT.md')
await stat('TEST-REPORT.md')
console.log(`Validation complete: docs, contracts, tests, review, build, preset generation and RC.2 contract snapshot (${rc2.mode}) all pass.`)

function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)))
  })
}
