import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve, sep } from 'node:path'
import {
  MilitaryError,
  brand,
  type MilitaryArtifacts,
  type MilitaryPrivateSkillBundles,
  type PrivateSkillBundleSnapshot,
} from '@dsh-military/contracts'
import { cloneFrozen, sha256, stableJson } from '@dsh-military/core'

/**
 * Materialize immutable Skill snapshots below a private data root.  Paths are
 * generated from validated identifiers and every file is also retained in the
 * Military artifact store for independent integrity verification.
 */
export class LocalPrivateSkillBundleStore implements MilitaryPrivateSkillBundles {
  readonly #root: string
  readonly #artifacts: MilitaryArtifacts
  readonly #tenantId: string
  readonly #writes = new Map<string, Promise<void>>()

  constructor(root: string, artifacts: MilitaryArtifacts, tenantId = 'local') {
    this.#root = resolve(root)
    this.#artifacts = artifacts
    this.#tenantId = tenantId
  }

  async write(input: Parameters<MilitaryPrivateSkillBundles['write']>[0]): Promise<PrivateSkillBundleSnapshot> {
    assertSkillName(input.name)
    if (input.description.trim().length === 0 || input.description.length > 1_024) {
      throw new MilitaryError('INVALID_ARGUMENT', 'private Skill description must contain 1-1024 characters')
    }
    assertSkillBundleInput(input)
    const versionSegment = safeSegment(String(input.skill.version))
    const target = this.#insideRoot(join(this.#root, input.name, versionSegment))
    const release = await this.#acquireWrite(target)
    try {
      return await this.#writeLocked(input, target)
    } finally {
      release()
    }
  }

  async #writeLocked(
    input: Parameters<MilitaryPrivateSkillBundles['write']>[0],
    target: string,
  ): Promise<PrivateSkillBundleSnapshot> {
    await this.#assertNoManagedSymlink(target)
    const filePaths = new Set<string>()
    const materialized: PrivateSkillBundleSnapshot['files'][number][] = []
    const temporary = `${target}.staging-${process.pid}-${Date.now()}`
    await mkdir(temporary, { recursive: true, mode: 0o700 })
    let committed = false
    try {
      for (const file of input.files) {
        assertBundlePath(file.path)
        if (filePaths.has(file.path)) throw new MilitaryError('INVALID_ARGUMENT', `duplicate Skill file ${file.path}`)
        filePaths.add(file.path)
        const bytes = new TextEncoder().encode(file.content)
        const artifact = await this.#artifacts.put({
          bytes,
          mediaType: file.path.endsWith('.json') ? 'application/json' : file.path.endsWith('.mjs') ? 'text/javascript' : 'text/markdown',
          classification: 'confidential',
          description: `${input.name}@${String(input.skill.version)} ${file.path}`,
          tenantId: this.#tenantId,
          ownerPrincipalId: 'military-private-skill-compiler',
          audiencePrincipalIds: ['military-host'],
          audienceScopes: ['artifact:read', 'military:private-skill-bundle'],
        })
        const path = this.#insideRoot(join(temporary, ...file.path.split('/')))
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await writeFile(path, bytes, { mode: file.executable === true ? 0o700 : 0o600 })
        if (file.executable === true) await chmod(path, 0o700)
        materialized.push({ path: file.path, artifact, executable: file.executable === true })
      }
      if (!filePaths.has('SKILL.md')) throw new MilitaryError('INVALID_ARGUMENT', 'private Skill bundle requires top-level SKILL.md')
      const contentHash = brand<string, 'Sha256'>(sha256(stableJson(bundleIntegrityPayload({
        skill: input.skill,
        name: input.name,
        description: input.description,
        sourceSnapshotIds: input.sourceSnapshotIds,
        createdAt: input.createdAt,
        files: materialized,
      }))))
      const snapshot: PrivateSkillBundleSnapshot = {
        schemaVersion: '1.0.0',
        skill: input.skill,
        name: input.name,
        description: input.description,
        lifecycle: input.lifecycle,
        rootPath: target,
        files: materialized,
        contentHash,
        sourceSnapshotIds: [...input.sourceSnapshotIds],
        createdAt: input.createdAt,
      }
      await writeFile(
        join(temporary, 'bundle.snapshot.json'),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        { mode: 0o600 },
      )
      let targetExists = true
      try {
        await stat(target)
      } catch (error) {
        if (!isNotFound(error)) throw error
        targetExists = false
      }
      if (targetExists) {
        const existing = JSON.parse(await readFile(join(target, 'bundle.snapshot.json'), 'utf8')) as PrivateSkillBundleSnapshot
        if (
          String(existing.contentHash) !== String(contentHash)
          || stableJson(bundleIntegrityPayload(existing)) !== stableJson(bundleIntegrityPayload({
            skill: input.skill,
            name: input.name,
            description: input.description,
            sourceSnapshotIds: input.sourceSnapshotIds,
            createdAt: input.createdAt,
            files: materialized,
          }))
        ) {
          throw new MilitaryError('IDEMPOTENCY_CONFLICT', `immutable Skill snapshot already exists at ${target}`)
        }
        return cloneFrozen(existing)
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await rename(temporary, target)
      committed = true
      return cloneFrozen(snapshot)
    } finally {
      if (!committed) await rm(temporary, { recursive: true, force: true })
    }
  }

  async #acquireWrite(target: string): Promise<() => void> {
    while (true) {
      const predecessor = this.#writes.get(target)
      if (predecessor !== undefined) {
        await predecessor
        continue
      }
      let resolveGate: (() => void) | undefined
      const gate = new Promise<void>((resolvePromise) => {
        resolveGate = resolvePromise
      })
      this.#writes.set(target, gate)
      return () => {
        if (this.#writes.get(target) === gate) this.#writes.delete(target)
        resolveGate!()
      }
    }
  }

  #insideRoot(candidate: string): string {
    const resolved = resolve(candidate)
    if (resolved !== this.#root && !resolved.startsWith(`${this.#root}${sep}`)) {
      throw new MilitaryError('FORBIDDEN_SCOPE', 'private Skill path escaped its data root')
    }
    return resolved
  }

  async #assertNoManagedSymlink(target: string): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    const relative = target.slice(this.#root.length).split(sep).filter(Boolean)
    let cursor = this.#root
    for (const segment of ['', ...relative]) {
      if (segment !== '') cursor = join(cursor, segment)
      try {
        if ((await lstat(cursor)).isSymbolicLink()) {
          throw new MilitaryError(
            'FORBIDDEN_SCOPE',
            `private Skill managed path contains a symbolic link: ${cursor}`,
          )
        }
      } catch (error) {
        if (error instanceof MilitaryError) throw error
        if (isNotFound(error)) return
        throw error
      }
    }
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}

function assertSkillName(value: string): void {
  if (
    value.length === 0
    || value.length > 64
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
    || value.includes('anthropic')
    || value.includes('claude')
  ) {
    throw new MilitaryError('INVALID_ARGUMENT', `invalid private Skill name "${value}"`)
  }
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^0-9A-Za-z._-]/gu, '-')
  if (segment.length === 0 || segment === '.' || segment === '..') {
    throw new MilitaryError('INVALID_ARGUMENT', 'invalid Skill version path segment')
  }
  return segment
}

function assertBundlePath(path: string): void {
  if (
    path.includes('\\')
    || path.startsWith('/')
    || path.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')
    || !(
      path === 'SKILL.md'
      || path.startsWith('references/')
      || path.startsWith('examples/')
      || path.startsWith('scripts/')
    )
  ) {
    throw new MilitaryError('INVALID_ARGUMENT', `invalid private Skill resource path "${path}"`)
  }
}

function assertSkillBundleInput(
  input: Parameters<MilitaryPrivateSkillBundles['write']>[0],
): void {
  const paths = new Set<string>()
  let totalBytes = 0
  for (const file of input.files) {
    assertBundlePath(file.path)
    if (paths.has(file.path)) {
      throw new MilitaryError('INVALID_ARGUMENT', `duplicate Skill file ${file.path}`)
    }
    paths.add(file.path)
    totalBytes += new TextEncoder().encode(file.content).byteLength
    if (file.path.startsWith('scripts/') && file.executable !== true) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        `private Skill script ${file.path} must be explicitly executable`,
      )
    }
  }
  if (totalBytes >= 30 * 1_024 * 1_024) {
    throw new MilitaryError('INVALID_ARGUMENT', 'private Skill bundle must be smaller than 30 MiB')
  }
  const skill = input.files.find(file => file.path === 'SKILL.md')
  if (skill === undefined) {
    throw new MilitaryError('INVALID_ARGUMENT', 'private Skill bundle requires top-level SKILL.md')
  }
  if (skill.content.split(/\r?\n/u).length > 500) {
    throw new MilitaryError('INVALID_ARGUMENT', 'private Skill SKILL.md exceeds the 500-line disclosure budget')
  }
  const closing = skill.content.indexOf('\n---\n', 4)
  if (!skill.content.startsWith('---\n') || closing < 0) {
    throw new MilitaryError('INVALID_ARGUMENT', 'private Skill SKILL.md requires top-level YAML frontmatter')
  }
  const frontmatter = skill.content.slice(4, closing).split('\n').filter(line => line.trim() !== '')
  if (
    frontmatter.length !== 2
    || frontmatter.some(line => !line.startsWith('name:') && !line.startsWith('description:'))
  ) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'private Skill SKILL.md frontmatter must contain exactly one name and one description',
    )
  }
  const name = scalar(frontmatter, 'name')
  const description = scalar(frontmatter, 'description')
  if (name !== input.name || description !== input.description) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'private Skill SKILL.md name/description must match the immutable bundle metadata',
    )
  }
  for (const file of input.files.filter(value => value.path.endsWith('.md'))) {
    for (const match of file.content.matchAll(/\]\(([^)\s]+)\)/gu)) {
      const target = (match[1]?.split('#', 1)[0] ?? '').split('?', 1)[0] ?? ''
      if (target === '' || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue
      const resolved = posix.normalize(posix.join(posix.dirname(file.path), target))
      if (
        resolved.startsWith('../')
        || resolved === '..'
        || resolved.startsWith('/')
        || !paths.has(resolved)
      ) {
        throw new MilitaryError(
          'INVALID_ARGUMENT',
          `private Skill ${file.path} references missing or escaping resource ${target}`,
        )
      }
    }
  }
}

function scalar(lines: readonly string[], key: string): string {
  const prefix = `${key}:`
  const matches = lines.filter(value => value.startsWith(prefix))
  if (matches.length !== 1) return ''
  const line = matches[0]!
  const raw = line.slice(prefix.length).trim()
  if (raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return typeof parsed === 'string' ? parsed : ''
    } catch {
      return ''
    }
  }
  return raw
}

function bundleIntegrityPayload(value: {
  readonly skill: PrivateSkillBundleSnapshot['skill']
  readonly name: string
  readonly description: string
  readonly sourceSnapshotIds: readonly string[]
  readonly createdAt: PrivateSkillBundleSnapshot['createdAt']
  readonly files: PrivateSkillBundleSnapshot['files']
}): unknown {
  return {
    skill: {
      skillId: String(value.skill.skillId),
      version: String(value.skill.version),
    },
    name: value.name,
    description: value.description,
    sourceSnapshotIds: [...value.sourceSnapshotIds],
    createdAt: String(value.createdAt),
    files: value.files.map(file => ({
      path: file.path,
      sha256: String(file.artifact.sha256),
      byteLength: file.artifact.byteLength,
      executable: file.executable,
    })),
  }
}
