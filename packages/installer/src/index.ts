import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'
import { militaryPresetDirectory, readMilitaryGenerationManifest } from '@dsh-military/preset'

export interface InstallOptions {
  readonly dshHome: string
  /** DSH launcher used to verify the installed Harness release when package resolution is not prepared yet. */
  readonly dshBin?: string
  /** Explicit system root when the deployment wants `system` trust. Omit to use DSH's authorable user root. */
  readonly presetRoot?: string
  readonly force?: boolean
}
export interface InstallReceipt {
  readonly schemaVersion: '1.0.0'
  readonly receiptId: string
  readonly presetId: 'military'
  readonly targetDirectory: string
  readonly generation: string
  readonly trustExpectation: 'system' | 'user'
  readonly installedFiles: readonly { readonly path: string; readonly sha256: string; readonly byteLength: number }[]
  readonly installedAt: string
  readonly dshBaseline: { readonly release: '0.1.1-rc.2'; readonly commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' }
}

const require = createRequire(import.meta.url)

/** Transactionally install the immutable public preset. Existing differing content is never overwritten without force. */
export async function installMilitaryPreset(options: InstallOptions): Promise<InstallReceipt> {
  const observedRelease = detectDshRelease(options.dshBin)
  if (observedRelease !== '0.1.1-rc.2') {
    throw new Error(`dsh-military requires DSH 0.1.1-rc.2; observed ${observedRelease}`)
  }
  const dshHome = resolve(options.dshHome)
  const root = resolve(options.presetRoot ?? join(dshHome, '.agent-presets'))
  const target = join(root, 'military')
  const staging = join(root, `.military-install-${randomUUID()}`)
  const backup = join(root, `.military-backup-${randomUUID()}`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const existing = await exists(target)
  if (existing && !options.force) {
    const receipt = await verifyMilitaryPreset(target)
    if (receipt !== null) return receipt
    throw new Error(`refusing to replace existing non-matching preset at ${target}; rerun with force after review`)
  }
  try {
    await cp(militaryPresetDirectory(), staging, { recursive: true, force: false, errorOnExist: true })
    const verified = await receiptFor(staging, options.presetRoot === undefined ? 'user' : 'system')
    if (existing) await rename(target, backup)
    await rename(staging, target)
    const receipt = { ...verified, targetDirectory: target }
    await writeFile(join(target, '.dsh-military-install-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
    if (existing) await rm(backup, { recursive: true, force: true })
    return receipt
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (await exists(backup) && !await exists(target)) await rename(backup, target)
    throw error
  }
}

/** Verify hashes and RC.2 baseline without mutating the preset. */
export async function verifyMilitaryPreset(directory: string): Promise<InstallReceipt | null> {
  try {
    const stored = JSON.parse(await readFile(join(directory, '.dsh-military-install-receipt.json'), 'utf8')) as InstallReceipt
    const current = await receiptFor(directory, stored.trustExpectation)
    return current.generation === stored.generation && JSON.stringify(current.installedFiles) === JSON.stringify(stored.installedFiles)
      ? { ...current, targetDirectory: resolve(directory), receiptId: stored.receiptId, installedAt: stored.installedAt }
      : null
  } catch { return null }
}

/** Uninstall only content still matching the install receipt; user edits are never discarded. */
export async function uninstallMilitaryPreset(options: InstallOptions): Promise<void> {
  const target = join(resolve(options.presetRoot ?? join(resolve(options.dshHome), '.agent-presets')), 'military')
  const receipt = await verifyMilitaryPreset(target)
  if (receipt === null) throw new Error(`refusing to uninstall modified or unowned preset at ${target}`)
  await rm(target, { recursive: true, force: false })
}

/** Produce a complete AgentPresets row config while preserving every caller-supplied field. */
export function agentPresetsConfigWithSystemRoot<T extends {
  readonly default: string
  readonly roots?: readonly { readonly path: string; readonly trust: 'system' | 'user' }[]
  readonly includeUserRoot?: boolean
}>(current: T, systemRoot: string): T & { roots: readonly { readonly path: string; readonly trust: 'system' | 'user' }[] } {
  const normalized = resolve(systemRoot)
  const roots = [...(current.roots ?? [])]
  if (!roots.some(item => resolve(item.path) === normalized)) roots.push({ path: normalized, trust: 'system' })
  return { ...current, roots }
}

async function receiptFor(directory: string, trustExpectation: 'system' | 'user'): Promise<InstallReceipt> {
  const manifest = readMilitaryGenerationManifest()
  if (manifest.dshBaseline.commit !== 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e') throw new Error('preset is not pinned to RC.2')
  const installedFiles = await Promise.all(manifest.files.map(async file => {
    const bytes = await readFile(join(directory, file.path))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== String(file.sha256) || bytes.byteLength !== file.byteLength) throw new Error(`preset asset mismatch: ${file.path}`)
    return { path: file.path, sha256: hash, byteLength: bytes.byteLength }
  }))
  return {
    schemaVersion: '1.0.0', receiptId: `military-install-${randomUUID()}`, presetId: 'military',
    targetDirectory: resolve(directory), generation: manifest.generation, trustExpectation,
    installedFiles, installedAt: new Date().toISOString(), dshBaseline: manifest.dshBaseline,
  }
}
async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }

function detectDshRelease(dshBin?: string): string {
  try {
    const manifest = require('@deepseek-ai/dsh-agent/package.json') as unknown
    if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) return 'unknown'
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    const launcher = dshBin ?? 'dsh'
    const result = extname(launcher) === '.js'
      ? spawnSync(process.execPath, [resolve(launcher), '--version'], { encoding: 'utf8' })
      : spawnSync(launcher, ['--version'], { encoding: 'utf8' })
    if (result.status !== 0) return 'unknown'
    const observed = result.stdout.trim()
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(observed) ? observed : 'unknown'
  }
}
