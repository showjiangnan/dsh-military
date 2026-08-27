import { chmod, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { MilitaryError } from '@dsh-military/contracts'
import { LocalMainGit, type GitCommitReceipt } from './git.js'
import { requireProcess, runProcess } from './process.js'

export interface SpecsMaintenanceOrder {
  readonly schemaVersion: '1.0.0'
  readonly orderId: string
  readonly missionId: string
  readonly trigger: { readonly kind: 'mission-bootstrap' | 'wave-completed' | 'change-order' | 'incident' | 'manual'; readonly ref: string }
  readonly requiredUpdates: readonly { readonly document: string; readonly purpose: string; readonly sourceEventIds?: readonly string[] }[]
  readonly allowedPaths: readonly string[]
  readonly validation: readonly string[]
  readonly commitPolicy: {
    readonly branch: 'main'
    readonly localOnly: true
    readonly messageTemplate: string
    readonly requireCleanNonSpecsPaths?: boolean
  }
  readonly issuedAt: string
}

export interface SpecsMaintenanceReceipt extends GitCommitReceipt {
  readonly orderId: string
  readonly validatedCommands: readonly string[]
}

export class SpecsEngineering {
  readonly #root: string
  readonly #git: LocalMainGit
  readonly #allowedValidationCommands: ReadonlySet<string>
  #transactionTail: Promise<void> = Promise.resolve()

  constructor(repositoryRoot: string, allowedValidationCommands: readonly (readonly string[])[] = [['git', 'diff', '--check']]) {
    this.#root = resolve(repositoryRoot)
    this.#git = new LocalMainGit(this.#root)
    this.#allowedValidationCommands = new Set(allowedValidationCommands.map(commandKey))
  }

  async initialize(signal?: AbortSignal): Promise<GitCommitReceipt> {
    await this.#git.ensureRepository(signal)
    const templates: Readonly<Record<string, string>> = {
      'specs/README.md': '# Specs Engineering\n\nThis directory is maintained by the dsh-military Engineer Corps.\n',
      'specs/00-mission/mission-intent.md': '# Mission Intent\n\nStatus: draft\n',
      'specs/01-requirements/functional.md': '# Functional Requirements\n',
      'specs/01-requirements/non-functional.md': '# Non-functional Requirements\n',
      'specs/02-architecture/system-context.md': '# System Context\n',
      'specs/03-decisions/README.md': '# Architecture Decision Records\n',
      'specs/04-planning/directions-and-waves.md': '# Directions and Waves\n',
      'specs/05-verification/acceptance-matrix.md': '# Acceptance Matrix\n',
      'specs/06-operations/runbook.md': '# Operations Runbook\n',
      'specs/07-traceability/traceability.md': '# Traceability\n',
      'specs/08-history/change-log.md': '# Change Log\n',
    }
    const missing: Record<string, string> = {}
    for (const [relative, content] of Object.entries(templates)) {
      try {
        const value = await stat(join(this.#root, relative))
        if (!value.isFile()) {
          throw new MilitaryError(
            'FORBIDDEN_SCOPE',
            `specs initialization target ${relative} is not a regular file`,
          )
        }
      } catch (error) {
        if (error instanceof MilitaryError) throw error
        if (!isMissingFile(error)) throw error
        missing[relative] = content
      }
    }
    if (Object.keys(missing).length === 0) {
      await this.#git.requireMaterialClean(signal)
      return {
        commit: await this.#git.head(signal),
        treeHash: await this.#git.treeHash(signal),
        changedPaths: [],
      }
    }
    const receipt = await this.apply({
      schemaVersion: '1.0.0',
      orderId: 'specs-initialize',
      missionId: 'specs-bootstrap',
      trigger: { kind: 'mission-bootstrap', ref: 'specs-initialize' },
      requiredUpdates: Object.keys(missing).map(document => ({
        document,
        purpose: 'Create the canonical sustainable Specs Engineering structure.',
      })),
      allowedPaths: ['specs'],
      validation: ['git diff --check'],
      commitPolicy: {
        branch: 'main',
        localOnly: true,
        messageTemplate: 'docs(specs): initialize sustainable specs engineering',
        requireCleanNonSpecsPaths: true,
      },
      issuedAt: new Date().toISOString(),
    }, missing, signal)
    return {
      commit: receipt.commit,
      treeHash: receipt.treeHash,
      changedPaths: receipt.changedPaths,
    }
  }

  async apply(order: SpecsMaintenanceOrder, contentByDocument: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<SpecsMaintenanceReceipt> {
    const previous = this.#transactionTail
    let release!: () => void
    this.#transactionTail = new Promise<void>(resolveTail => { release = resolveTail })
    await previous
    try {
      return await this.#applyAtomic(order, contentByDocument, signal)
    } finally {
      release()
    }
  }

  async #applyAtomic(
    order: SpecsMaintenanceOrder,
    contentByDocument: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<SpecsMaintenanceReceipt> {
    signal?.throwIfAborted()
    const plan = this.#validatePlan(order, contentByDocument)
    await this.#git.ensureRepository(signal)
    const recovered = await this.#recoverCommittedOrder(order, plan, signal)
    if (recovered !== null) return recovered
    await this.#git.requireMaterialClean(signal)
    const beforeHead = await this.#git.head(signal)
    const originals: OriginalFile[] = []
    for (const update of plan.updates) {
      await assertNoSymlinkPath(this.#root, update.relative)
      originals.push(await captureOriginal(this.#root, update.relative))
    }
    let mutated = false
    try {
      for (const update of plan.updates) {
        signal?.throwIfAborted()
        const path = join(this.#root, update.relative)
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, update.content, 'utf8')
        mutated = true
      }
      const validated: string[] = []
      for (const validation of plan.validations) {
        signal?.throwIfAborted()
        const result = await runProcess(validation.argv[0]!, validation.argv.slice(1), {
          cwd: this.#root,
          ...(signal === undefined ? {} : { signal }),
        })
        if (result.exitCode !== 0) {
          throw new MilitaryError(
            'REGRESSION_FAILED',
            `specs validation failed: ${validation.source}`,
            { stderr: result.stderr },
          )
        }
        validated.push(validation.source)
      }
      const commit = await this.#git.commitLocalMain({
        message: plan.message,
        allowedPaths: plan.allowedPaths,
        ...(signal === undefined ? {} : { signal }),
      })
      return { orderId: order.orderId, ...commit, validatedCommands: validated }
    } catch (error) {
      if (mutated || await this.#git.head().then(head => head !== beforeHead).catch(() => false)) {
        try {
          await restoreTransaction({
            root: this.#root,
            git: this.#git,
            beforeHead,
            originals,
          })
        } catch (rollbackError) {
          throw new MilitaryError(
            'PERSISTENCE_FAILED',
            'Specs transaction failed and rollback could not restore its exact pre-call state',
            {
              originalError: errorMessage(error),
              rollbackError: errorMessage(rollbackError),
            },
            { cause: error },
          )
        }
      }
      throw error
    }
  }

  async #recoverCommittedOrder(
    order: SpecsMaintenanceOrder,
    plan: {
      readonly updates: readonly { readonly relative: string; readonly content: string }[]
      readonly validations: readonly { readonly source: string; readonly argv: readonly [string, ...string[]] }[]
    },
    signal?: AbortSignal,
  ): Promise<SpecsMaintenanceReceipt | null> {
    const marker = `DSH-Military-Specs-Order: ${order.orderId}`
    const search = await runProcess('git', [
      'log',
      'main',
      '--fixed-strings',
      `--grep=${marker}`,
      '--format=%H',
      '-n', '1',
    ], {
      cwd: this.#root,
      ...(signal === undefined ? {} : { signal }),
    })
    const commit = search.exitCode === 0 ? search.stdout.trim().split('\n')[0] : undefined
    if (commit === undefined || commit === '') return null
    const ancestor = await runProcess('git', [
      'merge-base', '--is-ancestor', commit, 'HEAD',
    ], {
      cwd: this.#root,
      ...(signal === undefined ? {} : { signal }),
    })
    if (ancestor.exitCode !== 0) {
      throw new MilitaryError(
        'IDEMPOTENCY_CONFLICT',
        `Specs order ${order.orderId} exists outside the current main history`,
      )
    }
    for (const update of plan.updates) {
      const observed = await runProcess('git', [
        'show', `${commit}:${update.relative}`,
      ], {
        cwd: this.#root,
        ...(signal === undefined ? {} : { signal }),
      })
      if (observed.exitCode !== 0 || observed.stdout !== update.content) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          `Specs order ${order.orderId} was already committed with different content for ${update.relative}`,
        )
      }
    }
    const tree = await requireProcess('git', [
      'show', '-s', '--format=%T', commit,
    ], {
      cwd: this.#root,
      ...(signal === undefined ? {} : { signal }),
    })
    const changed = await requireProcess('git', [
      'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit,
    ], {
      cwd: this.#root,
      ...(signal === undefined ? {} : { signal }),
    })
    return {
      orderId: order.orderId,
      commit,
      treeHash: tree.stdout.trim(),
      changedPaths: changed.stdout.split('\u0000').filter(Boolean).sort(),
      validatedCommands: plan.validations.map(value => value.source),
    }
  }

  #validatePlan(
    order: SpecsMaintenanceOrder,
    contentByDocument: Readonly<Record<string, string>>,
  ): {
    readonly updates: readonly { readonly relative: string; readonly content: string }[]
    readonly validations: readonly { readonly source: string; readonly argv: readonly [string, ...string[]] }[]
    readonly allowedPaths: readonly string[]
    readonly message: string
  } {
    if (order.schemaVersion !== '1.0.0'
      || !/^[A-Za-z0-9._:-]{1,200}$/u.test(order.orderId)
      || order.missionId.trim() === ''
      || !Number.isFinite(Date.parse(order.issuedAt))) {
      throw new MilitaryError('INVALID_ARGUMENT', 'Specs Maintenance Order identity or issuedAt is invalid')
    }
    if (order.commitPolicy.branch !== 'main' || !order.commitPolicy.localOnly) throw new MilitaryError('GIT_NON_MAIN_FORBIDDEN')
    if (order.requiredUpdates.length === 0 || order.allowedPaths.length === 0 || order.validation.length === 0) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        'Specs Maintenance Order requires updates, allowed paths, and validation',
      )
    }
    const allowedPaths = [...new Set(order.allowedPaths.map(safeRelative))]
    const updates: { relative: string; content: string }[] = []
    const requestedDocuments = new Set<string>()
    for (const update of order.requiredUpdates) {
      const relative = safeRelative(update.document)
      if (requestedDocuments.has(update.document)) {
        throw new MilitaryError('INVALID_ARGUMENT', `duplicate specs update ${update.document}`)
      }
      requestedDocuments.add(update.document)
      if (!allowedPaths.some(prefix => pathAllowed(relative, prefix))) throw new MilitaryError('FORBIDDEN_SCOPE', `specs update ${relative} not allowed`)
      const content = contentByDocument[update.document]
      if (content === undefined) throw new MilitaryError('INVALID_ARGUMENT', `missing content for ${update.document}`)
      updates.push({ relative, content })
    }
    const extras = Object.keys(contentByDocument).filter(path => !requestedDocuments.has(path))
    if (extras.length > 0) {
      throw new MilitaryError(
        'FORBIDDEN_SCOPE',
        'contentByDocument contains documents absent from requiredUpdates',
        { extraDocuments: extras.sort() },
      )
    }
    const validations: { source: string; argv: [string, ...string[]] }[] = []
    for (const command of order.validation) {
      const argv = splitCommand(command)
      const program = argv[0]
      if (program === undefined) {
        throw new MilitaryError('INVALID_ARGUMENT', 'Specs validation command cannot be empty')
      }
      if (!this.#allowedValidationCommands.has(commandKey(argv))) {
        throw new MilitaryError('POLICY_DENIED', `specs validation command is not deployment-authorized: ${command}`)
      }
      validations.push({ source: command, argv: [program, ...argv.slice(1)] })
    }
    const subject = order.commitPolicy.messageTemplate
      .replaceAll('{missionId}', order.missionId)
      .replaceAll('{orderId}', order.orderId)
      .replaceAll('{trigger}', order.trigger.kind)
      .trim()
    if (subject === '') throw new MilitaryError('INVALID_ARGUMENT', 'Specs commit message cannot be empty')
    const message = `${subject}\n\nDSH-Military-Specs-Order: ${order.orderId}`
    return { updates, validations, allowedPaths, message }
  }

  async read(relativePath: string): Promise<string> {
    return await readFile(join(this.#root, safeRelative(relativePath)), 'utf8')
  }
}

function safeRelative(value: string): string {
  const normalized = normalize(value).replaceAll('\\', '/')
  if (normalized === '' || normalized === '.'
    || normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    throw new MilitaryError('FORBIDDEN_SCOPE')
  }
  return normalized
}

function pathAllowed(path: string, prefix: string): boolean {
  const safePrefix = safeRelative(prefix)
  return path === safePrefix || path.startsWith(safePrefix.endsWith('/') ? safePrefix : `${safePrefix}/`)
}

function splitCommand(command: string): string[] {
  // Orders can be model-produced.  Parsing alone is not authority: every
  // normalized argv must match a deployment-owned allow-list exactly.
  if (/[;&|><`$'"\\]/u.test(command)) throw new MilitaryError('POLICY_DENIED', 'quotes, escapes and shell metacharacters are forbidden in validation commands')
  return command.trim().split(/\s+/u).filter(Boolean)
}

function commandKey(argv: readonly string[]): string {
  if (argv.length === 0 || argv.some(value => value.length === 0 || value.includes('\u0000'))) {
    throw new MilitaryError('INVALID_ARGUMENT', 'validation command argv is invalid')
  }
  return JSON.stringify(argv)
}

interface OriginalFile {
  readonly relative: string
  readonly content?: Uint8Array
  readonly mode?: number
}

async function captureOriginal(root: string, relative: string): Promise<OriginalFile> {
  try {
    const metadata = await lstat(join(root, relative))
    if (!metadata.isFile()) {
      throw new MilitaryError(
        'FORBIDDEN_SCOPE',
        `Specs transaction target ${relative} is not a regular file`,
      )
    }
    return {
      relative,
      content: await readFile(join(root, relative)),
      mode: metadata.mode,
    }
  } catch (error) {
    if (error instanceof MilitaryError) throw error
    if (!isMissingFile(error)) throw error
    return { relative }
  }
}

async function assertNoSymlinkPath(root: string, relative: string): Promise<void> {
  let current = root
  for (const segment of relative.split('/')) {
    current = join(current, segment)
    try {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) {
        throw new MilitaryError(
          'FORBIDDEN_SCOPE',
          `Specs transaction path ${relative} traverses a symbolic link`,
        )
      }
    } catch (error) {
      if (error instanceof MilitaryError) throw error
      if (!isMissingFile(error)) throw error
      return
    }
  }
}

async function restoreTransaction(input: {
  readonly root: string
  readonly git: LocalMainGit
  readonly beforeHead: string
  readonly originals: readonly OriginalFile[]
}): Promise<void> {
  const rollbackSignal = AbortSignal.timeout(30_000)
  const currentHead = await input.git.head(rollbackSignal)
  if (currentHead !== input.beforeHead) {
    if (input.beforeHead === 'UNBORN') {
      await requireProcess(
        'git',
        ['update-ref', '-d', 'HEAD'],
        { cwd: input.root, signal: rollbackSignal },
        'GIT_COMMIT_FAILED',
      )
    } else {
      // Move only HEAD/index metadata; file restoration below is path-scoped.
      await requireProcess(
        'git',
        ['reset', '--soft', input.beforeHead],
        { cwd: input.root, signal: rollbackSignal },
        'GIT_COMMIT_FAILED',
      )
    }
  }
  for (const original of input.originals) {
    const path = join(input.root, original.relative)
    if (original.content === undefined) {
      await rm(path, { force: true })
      continue
    }
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, original.content)
    if (original.mode !== undefined) await chmod(path, original.mode)
  }
  const paths = input.originals.map(original => original.relative)
  if (paths.length > 0) {
    if (input.beforeHead === 'UNBORN') {
      const unstaged = await runProcess(
        'git',
        ['rm', '--cached', '--ignore-unmatch', '--', ...paths],
        { cwd: input.root, signal: rollbackSignal },
      )
      if (unstaged.exitCode !== 0) {
        throw new MilitaryError('GIT_COMMIT_FAILED', unstaged.stderr)
      }
    } else {
      await requireProcess(
        'git',
        ['reset', '--quiet', input.beforeHead, '--', ...paths],
        { cwd: input.root, signal: rollbackSignal },
        'GIT_COMMIT_FAILED',
      )
    }
  }
  const restoredHead = await input.git.head(rollbackSignal)
  const status = await input.git.materialStatusPaths(rollbackSignal)
  if (restoredHead !== input.beforeHead || status.length > 0) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'Specs rollback verification detected residual repository changes',
      { beforeHead: input.beforeHead, restoredHead, status },
    )
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
