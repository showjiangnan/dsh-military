import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { providerFlashAcceptance } from '@dsh-military/plugin-host'

const options = parseArguments(process.argv.slice(2))
if (options.evidence === undefined) {
  fail([
    'Usage: npm run acceptance:flash -- --evidence <export.json>',
    '  [--route provider/model] [--selection scenario-selection.json]',
    '  [--report acceptance-report.json]',
    '',
    'The evidence file must be exported by Military → 绩效评估 → Flash 工作台.',
    'This command never launches paid Provider calls; it verifies immutable',
    'Session-derived samples already assessed by the Host.',
  ].join('\n'))
}

const evidencePath = resolve(options.evidence)
const source = JSON.parse(await readFile(evidencePath, 'utf8'))
assertRecord(source, 'evidence')
assertRecord(source.dataset, 'evidence.dataset')
assert.equal(
  source.dataset.version,
  'military-flash-core-v1',
  'unexpected Flash benchmark dataset version',
)
assert.ok(
  typeof source.dataset.hash === 'string' && source.dataset.hash.length === 64,
  'dataset hash must be a 64-character SHA-256',
)
assert.ok(Array.isArray(source.dataset.scenarios), 'dataset.scenarios must be an array')
assert.ok(Array.isArray(source.providerSamples), 'providerSamples must be an array')

const scenarioIds = source.dataset.scenarios.map((value, index) => {
  assertRecord(value, `dataset.scenarios[${index}]`)
  assert.ok(typeof value.id === 'string' && value.id.length > 0)
  return value.id
})
assert.equal(
  new Set(scenarioIds).size,
  scenarioIds.length,
  'dataset scenario ids must be unique',
)
for (const [index, sample] of source.providerSamples.entries()) {
  assertRecord(sample, `providerSamples[${index}]`)
  assert.equal(
    sample.datasetHash,
    source.dataset.hash,
    `providerSamples[${index}] belongs to another dataset`,
  )
}

const allResults = providerFlashAcceptance(source.providerSamples)
const flashResults = allResults.filter(value =>
  (options.route === undefined
    ? /flash/iu.test(value.exactRoute)
    : value.exactRoute === options.route))
if (flashResults.length === 0) {
  fail(options.route === undefined
    ? 'No exact-route Flash evidence groups were found.'
    : `No evidence groups were found for exact route ${options.route}.`)
}
const routes = new Set(flashResults.map(value => value.exactRoute))
if (options.route === undefined && routes.size !== 1) {
  fail(
    `Evidence contains multiple Flash routes (${[...routes].join(', ')}); `
    + 'pass --route to freeze one exact route.',
  )
}
const selection = options.selection === undefined
  ? undefined
  : parseSelection(JSON.parse(await readFile(resolve(options.selection), 'utf8')))
const selected = scenarioIds.map(scenarioId => {
  const candidates = flashResults.filter(value => value.scenarioId === scenarioId)
  const configured = selection?.[scenarioId]
  const matches = configured === undefined
    ? candidates
    : candidates.filter(value => value.configurationKey === configured)
  if (matches.length === 0) {
    fail(`No exact acceptance group is available for scenario ${scenarioId}.`)
  }
  if (matches.length > 1) {
    fail(
      `Scenario ${scenarioId} has ${matches.length} configuration groups; `
      + 'pass --selection with one frozen configurationKey per scenario.',
    )
  }
  return matches[0]
})
const generatedAt = new Date().toISOString()
const report = {
  schemaVersion: '1.0.0',
  evidencePath,
  datasetVersion: source.dataset.version,
  datasetHash: source.dataset.hash,
  exactRoute: selected[0].exactRoute,
  requirements: {
    independentSessionsPerScenario: 50,
    firstToolPointEstimate: 0.95,
    firstToolWilsonLowerBound: 0.85,
    e2ePointEstimate: 0.90,
    e2eWilsonLowerBound: 0.80,
    maximumUnexpectedDeterministicFailures: 0,
    maximumUnauthorizedWrites: 0,
    maximumFalseCompletions: 0,
    maximumDuplicateTerminals: 0,
  },
  scenarios: selected,
  status: selected.every(value => value.conclusion === 'PASSED')
    ? 'PASSED'
    : 'FAILED',
  generatedAt,
}
if (options.report !== undefined) {
  await writeFile(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (report.status !== 'PASSED') process.exitCode = 1

function parseArguments(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]
    if (!['--evidence', '--route', '--selection', '--report'].includes(key)) {
      fail(`Unknown argument ${key}`)
    }
    const value = values[index + 1]
    if (value === undefined || value.startsWith('--')) {
      fail(`${key} requires a value`)
    }
    result[key.slice(2)] = value
    index += 1
  }
  return result
}

function parseSelection(value) {
  assertRecord(value, 'selection')
  const result = {}
  for (const [scenarioId, configurationKey] of Object.entries(value)) {
    assert.ok(
      typeof configurationKey === 'string' && /^[a-f0-9]{64}$/u.test(configurationKey),
      `selection.${scenarioId} must be one SHA-256 configurationKey`,
    )
    result[scenarioId] = configurationKey
  }
  return result
}

function assertRecord(value, at) {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${at} must be an object`,
  )
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
