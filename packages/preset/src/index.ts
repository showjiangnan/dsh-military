import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PresetGenerationManifest } from '@dsh-military/contracts'

const root = dirname(fileURLToPath(import.meta.url))
const assetRoot = join(root, '..', 'agent-presets')

export function militaryPresetRoot(): string { return assetRoot }
export function militaryPresetDirectory(): string { return join(assetRoot, 'military') }
export function militaryPresetCompositionPath(): string { return join(militaryPresetDirectory(), 'agent.cordis.yml') }
export function militaryPresetMetadataPath(): string { return join(militaryPresetDirectory(), 'preset.yml') }
export function militaryGenerationManifestPath(): string { return join(militaryPresetDirectory(), 'generation-manifest.json') }
export function readMilitaryGenerationManifest(): PresetGenerationManifest {
  return JSON.parse(readFileSync(militaryGenerationManifestPath(), 'utf8')) as PresetGenerationManifest
}
export function generationArchiveRoot(): string { return join(root, '..', 'generations') }
