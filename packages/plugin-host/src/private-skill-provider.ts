import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import {
  brand,
  type MilitaryIngestion,
  type PrivateSkillBundleSnapshot,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'

const PROVIDER_NAME = 'military-private-skills'
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
// The global DSH Skill catalog is a production delivery surface. Canary and
// testing recall remains an explicit Military Staff operation governed by the
// live allowCanaryDelivery setting; it must never leak into every Agent's
// automatic model-facing catalog.
const ELIGIBLE = new Set(['STABLE'])

/** Publish governed exact versions through the official RC.2 dynamic Skill registry. */
export function installPrivateSkillProvider(ctx: Context, ingestion: MilitaryIngestion): void {
  ctx.skills.registerProvider((control) => {
    const unsubscribe = ingestion.subscribe(control.invalidate)
    control.signal.addEventListener('abort', unsubscribe, { once: true })
    return provider(ingestion)
  })
}

function provider(ingestion: MilitaryIngestion): SkillProvider {
  return {
    name: PROVIDER_NAME,
    async list(options): Promise<readonly SkillCandidate[]> {
      options.signal?.throwIfAborted()
      const snapshot = await ingestion.operationSnapshot()
      options.signal?.throwIfAborted()
      const byName = new Map<string, typeof snapshot.bundles[number]>()
      for (const bundle of snapshot.bundles) {
        if (!ELIGIBLE.has(bundle.lifecycle)) continue
        const eligibility = await ingestion.deliveryEligibility(
          String(bundle.skill.skillId),
          bundle.skill.version,
        )
        if (!eligibility.eligible) continue
        if (!(await verifyBundleSnapshot(bundle))) continue
        const current = byName.get(bundle.name)
        if (current === undefined || compareVersion(String(current.skill.version), String(bundle.skill.version)) < 0) {
          byName.set(bundle.name, bundle)
        }
      }
      return [...byName.values()].map(bundle => ({
        name: bundle.name,
        description: bundle.description,
        whenToUse: `Use only for governed Military tasks matching this exact private procedure; lifecycle=${bundle.lifecycle}.`,
        invocation: INVOCATION,
        source: 'custom',
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: bundle.rootPath },
        rank: BUNDLED_SKILL_RANK - 50,
        locator: {
          skillId: String(bundle.skill.skillId),
          version: String(bundle.skill.version),
          contentHash: String(bundle.contentHash),
        },
        metadata: {
          lifecycle: bundle.lifecycle,
          version: String(bundle.skill.version),
          sourceSnapshotIds: bundle.sourceSnapshotIds,
        },
      }))
    },
    async get(candidate, options): Promise<SkillDefinition | undefined> {
      options.signal?.throwIfAborted()
      const locator = decodeLocator(candidate.locator)
      if (locator === null) return undefined
      const bundle = await ingestion.bundle(locator.skillId, brand<string, 'SemVer'>(locator.version))
      options.signal?.throwIfAborted()
      if (!ELIGIBLE.has(bundle.lifecycle) || String(bundle.contentHash) !== locator.contentHash) return undefined
      if (!(await ingestion.deliveryEligibility(locator.skillId, bundle.skill.version)).eligible) return undefined
      if (!(await verifyBundleSnapshot(bundle))) return undefined
      const source = await readFile(`${bundle.rootPath}/SKILL.md`, 'utf8')
      const body = stripFrontmatter(source)
      return {
        name: bundle.name,
        description: bundle.description,
        whenToUse: candidate.whenToUse ?? 'Use only for a governed Military task that matches this private procedure.',
        invocation: INVOCATION,
        source: 'custom',
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: bundle.rootPath },
        content: body,
        path: `${bundle.rootPath}/SKILL.md`,
        metadata: {
          lifecycle: bundle.lifecycle,
          version: String(bundle.skill.version),
          contentHash: String(bundle.contentHash),
        },
      }
    },
  }
}

async function verifyBundleSnapshot(bundle: PrivateSkillBundleSnapshot): Promise<boolean> {
  const root = resolve(bundle.rootPath)
  const metadataHash = sha256(stableJson({
    skill: {
      skillId: String(bundle.skill.skillId),
      version: String(bundle.skill.version),
    },
    name: bundle.name,
    description: bundle.description,
    sourceSnapshotIds: [...bundle.sourceSnapshotIds],
    createdAt: String(bundle.createdAt),
    files: bundle.files.map(file => ({
      path: file.path,
      sha256: String(file.artifact.sha256),
      byteLength: file.artifact.byteLength,
      executable: file.executable,
    })),
  }))
  if (metadataHash !== String(bundle.contentHash)) return false
  try {
    for (const file of bundle.files) {
      if (
        file.path.includes('\\')
        || file.path.startsWith('/')
        || file.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
      ) return false
      const target = resolve(root, ...file.path.split('/'))
      if (!target.startsWith(`${root}${sep}`)) return false
      const bytes = await readFile(target)
      if (
        bytes.byteLength !== file.artifact.byteLength
        || sha256(bytes) !== String(file.artifact.sha256)
      ) return false
      if (file.executable && ((await stat(target)).mode & 0o100) === 0) return false
    }
    return true
  } catch {
    return false
  }
}

function decodeLocator(value: unknown): {
  readonly skillId: string
  readonly version: string
  readonly contentHash: string
} | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return typeof record.skillId === 'string'
    && typeof record.version === 'string'
    && typeof record.contentHash === 'string'
    ? { skillId: record.skillId, version: record.version, contentHash: record.contentHash }
    : null
}

function stripFrontmatter(value: string): string {
  if (!value.startsWith('---\n')) return value
  const end = value.indexOf('\n---\n', 4)
  return end < 0 ? value : value.slice(end + 5)
}

function compareVersion(left: string, right: string): number {
  const parse = (value: string): readonly number[] => {
    const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value)
    return match === null ? [0, 0, 0] : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return left.localeCompare(right)
}
