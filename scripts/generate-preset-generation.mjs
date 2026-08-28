import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const presetDirectory = 'packages/preset/agent-presets/military'
const archiveRoot = 'packages/preset/generations'
const manifestPath = join(presetDirectory, 'generation-manifest.json')
const fileNames = ['preset.yml', 'agent.cordis.yml']

const files = await Promise.all(fileNames.map(async path => {
  const bytes = await readFile(join(presetDirectory, path))
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}))
const assetHash = createHash('sha256').update(stableJson(files)).digest('hex')
const generation = `military@sha256:${assetHash}`
let createdAt = process.env.SOURCE_DATE_EPOCH === undefined
  ? new Date().toISOString()
  : new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
try {
  const current = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (current.generation === generation && typeof current.createdAt === 'string') {
    createdAt = current.createdAt
  }
} catch {
  // The first generation intentionally has no prior timestamp to preserve.
}

const manifest = {
  schemaVersion: '1.0.0',
  presetId: 'military',
  generation,
  assetHash,
  bundleVersion: '0.9.0-alpha.27',
  dshBaseline: {
    release: '0.1.1-rc.2',
    commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  },
  publicSelectionId: 'military',
  hiddenArchiveId: `military-generation-${assetHash.slice(0, 16)}`,
  status: 'CURRENT',
  files,
  createdAt,
  compatibility: {
    mode: 'EXACT_RC2',
    breaking: true,
    resumeSupported: true,
  },
}
const encoded = `${JSON.stringify(manifest, null, 2)}\n`
await writeFile(manifestPath, encoded)

const archiveDirectory = join(archiveRoot, assetHash)
await mkdir(archiveDirectory, { recursive: true })
for (const path of fileNames) {
  await cp(join(presetDirectory, path), join(archiveDirectory, path), { force: true })
}
await writeFile(join(archiveDirectory, 'generation-manifest.json'), encoded)
console.log(`Preset generation synchronized: ${generation}`)

function stableJson(value) {
  return JSON.stringify(sortJson(value))
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = sortJson(value[key])
  return result
}
