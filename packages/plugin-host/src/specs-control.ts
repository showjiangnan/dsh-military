import { lstat, readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { MilitaryError } from '@dsh-military/contracts'
import { SpecsEngineering, type SpecsMaintenanceOrder, type SpecsMaintenanceReceipt } from '@dsh-military/infrastructure'
import type { IntegrationReceipt } from '@dsh-military/contracts'

export interface SpecsReadResult {
  readonly root: string
  readonly files: Readonly<Record<string, string>>
  readonly missingPaths: readonly string[]
}

/**
 * Restricted engineering façade.  It never exposes arbitrary Git commands and
 * every write is confined to specs/ or docs/ before a local-main commit.
 */
export class MilitarySpecsControl {
  readonly #allowedValidationCommands: readonly (readonly string[])[]
  readonly #engineeringByRoot = new Map<string, SpecsEngineering>()

  constructor(allowedValidationCommands: readonly (readonly string[])[] = [['git', 'diff', '--check']]) {
    this.#allowedValidationCommands = allowedValidationCommands.map(command => [...command])
  }

  async initialize(input: { readonly workspaceRoot: string; readonly signal?: AbortSignal }): Promise<unknown> {
    return await this.#engineering(input.workspaceRoot).initialize(input.signal)
  }

  async read(input: {
    readonly workspaceRoot: string
    readonly paths: readonly string[]
    readonly signal: AbortSignal
  }): Promise<SpecsReadResult> {
    input.signal.throwIfAborted()
    const root = workspaceRoot(input.workspaceRoot)
    const paths = input.paths.length === 0 ? ['specs', 'docs'] : input.paths
    const files: Record<string, string> = {}
    const missingPaths: string[] = []
    for (const value of paths) {
      const safe = safeSpecsPath(value)
      const absolute = join(root, safe)
      let metadata
      try {
        metadata = await lstat(absolute)
      } catch (error) {
        if (!isMissingPath(error)) throw error
        missingPaths.push(safe)
        continue
      }
      if (metadata.isSymbolicLink()) {
        throw new MilitaryError(
          'FORBIDDEN_SCOPE',
          `specs read path ${safe} is a symbolic link`,
        )
      }
      if (metadata.isDirectory()) {
        for (const path of await listMarkdown(absolute, root, input.signal)) {
          files[path] = await readFile(join(root, path), 'utf8')
        }
        continue
      }
      if (!metadata.isFile()) {
        throw new MilitaryError('FORBIDDEN_SCOPE', `specs read path ${safe} is not a regular file`)
      }
      files[safe] = await readFile(absolute, 'utf8')
    }
    return {
      root,
      files,
      missingPaths: [...new Set(missingPaths)].sort(),
    }
  }

  async apply(
    workspace: string,
    order: SpecsMaintenanceOrder,
    contentByDocument: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return await this.#engineering(workspace).apply(order, contentByDocument, signal)
  }

  async recordIntegration(input: {
    readonly workspaceRoot: string
    readonly missionId: string
    readonly taskId: string
    readonly taskVersion: number
    readonly verificationReceiptId: string
    readonly integration: IntegrationReceipt
    readonly signal: AbortSignal
  }): Promise<SpecsMaintenanceReceipt> {
    const root = workspaceRoot(input.workspaceRoot)
    const engineering = this.#engineering(root)
    const historyPath = 'specs/08-history/change-log.md'
    const tracePath = 'specs/07-traceability/traceability.md'
    const history = await readFile(join(root, historyPath), 'utf8').catch(() => '# Change Log\n')
    const trace = await readFile(join(root, tracePath), 'utf8').catch(() => '# Traceability\n')
    const line = `- Task ${input.taskId}@${input.taskVersion}: integration ${input.integration.disposition}; verification ${input.verificationReceiptId}; commit ${input.integration.commit ?? '(none)'}.`
    const order: SpecsMaintenanceOrder = {
      schemaVersion: '1.0.0', orderId: `specs-integration-${input.integration.integrationReceiptId}`,
      missionId: input.missionId, trigger: { kind: 'change-order', ref: input.integration.integrationReceiptId },
      requiredUpdates: [
        { document: historyPath, purpose: 'Record accepted integration outcome.' },
        { document: tracePath, purpose: 'Maintain Task-to-verification-to-commit traceability.' },
      ],
      allowedPaths: ['specs'], validation: ['git diff --check'],
      commitPolicy: { branch: 'main', localOnly: true, messageTemplate: 'docs(specs): record integrated task {orderId}', requireCleanNonSpecsPaths: true },
      issuedAt: new Date().toISOString(),
    }
    return await engineering.apply(order, {
      [historyPath]: `${history.trimEnd()}
${line}
`,
      [tracePath]: `${trace.trimEnd()}
${line}
`,
    }, input.signal)
  }

  async validate(
    workspace: string,
    signal: AbortSignal,
  ): Promise<{ readonly valid: boolean; readonly files: number; readonly errors: readonly string[] }> {
    const root = workspaceRoot(workspace)
    const required = [
      ...await listMarkdown(join(root, 'specs'), root, signal),
      ...await listMarkdown(join(root, 'docs'), root, signal),
    ]
    const errors: string[] = []
    for (const path of [...new Set(required)].sort()) {
      signal.throwIfAborted()
      try {
        const content = await readFile(join(root, path), 'utf8')
        if (!/^#\s+/mu.test(content)) errors.push(`${path}: missing top-level heading`)
      } catch { errors.push(`${path}: missing`) }
    }
    return { valid: errors.length === 0, files: required.length, errors }
  }

  #engineering(workspace: string): SpecsEngineering {
    const root = workspaceRoot(workspace)
    let engineering = this.#engineeringByRoot.get(root)
    if (engineering === undefined) {
      engineering = new SpecsEngineering(root, this.#allowedValidationCommands)
      this.#engineeringByRoot.set(root, engineering)
    }
    return engineering
  }
}

async function listMarkdown(
  directory: string,
  workspace: string,
  signal: AbortSignal,
): Promise<string[]> {
  const values: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal.throwIfAborted()
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        values.push(relative(workspace, absolute).replaceAll('\\', '/'))
      }
    }
  }
  try {
    const metadata = await lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return []
    await walk(directory)
  } catch (error) {
    if (!isMissingPath(error)) throw error
    return []
  }
  return values.sort()
}

function safeSpecsPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '')
  if (!(normalized === 'specs' || normalized.startsWith('specs/') || normalized === 'docs' || normalized.startsWith('docs/'))
    || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new MilitaryError('FORBIDDEN_SCOPE', `path ${value} is outside specs/docs`)
  }
  return normalized
}

function workspaceRoot(value: string): string {
  if (value.trim() === '' || !isAbsolute(value)) {
    throw new MilitaryError(
      'MILITARY_BINDING_MISMATCH',
      'Military Session binding does not contain an absolute authoritative workspace root',
    )
  }
  return resolve(value)
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}
