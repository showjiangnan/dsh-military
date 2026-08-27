import { mkdir } from 'node:fs/promises'
import { MilitaryError } from '@dsh-military/contracts'
import { pathWithinAny } from '@dsh-military/core'
import { requireProcess, runProcess } from './process.js'

export interface GitCommitReceipt {
  readonly commit: string
  readonly treeHash: string
  readonly changedPaths: readonly string[]
}

interface GitStatusEntry {
  readonly status: string
  readonly path: string
}

export class LocalMainGit {
  readonly #repositoryRoot: string

  constructor(repositoryRoot: string) { this.#repositoryRoot = repositoryRoot }

  async ensureRepository(signal?: AbortSignal): Promise<void> {
    await mkdir(this.#repositoryRoot, { recursive: true })
    const probe = await runProcess('git', ['rev-parse', '--is-inside-work-tree'], gitOptions(this.#repositoryRoot, signal))
    if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true') {
      await requireProcess('git', ['init', '-b', 'main'], gitOptions(this.#repositoryRoot, signal), 'GIT_COMMIT_FAILED')
    }
    const branch = (await requireProcess('git', ['branch', '--show-current'], gitOptions(this.#repositoryRoot, signal))).stdout.trim()
    if (branch === '') await requireProcess('git', ['switch', '-c', 'main'], gitOptions(this.#repositoryRoot, signal), 'GIT_COMMIT_FAILED')
    else if (branch !== 'main') throw new MilitaryError('GIT_NON_MAIN_FORBIDDEN', `current branch is ${branch}`)
  }

  async head(signal?: AbortSignal): Promise<string> {
    const result = await runProcess('git', ['rev-parse', 'HEAD'], gitOptions(this.#repositoryRoot, signal))
    return result.exitCode === 0 ? result.stdout.trim() : 'UNBORN'
  }

  async treeHash(signal?: AbortSignal): Promise<string> {
    const result = await runProcess('git', ['rev-parse', 'HEAD^{tree}'], gitOptions(this.#repositoryRoot, signal))
    if (result.exitCode === 0) return result.stdout.trim()
    const empty = await requireProcess('git', ['mktree'], gitOptions(this.#repositoryRoot, signal, { input: '' }))
    return empty.stdout.trim()
  }

  async statusPaths(signal?: AbortSignal): Promise<readonly string[]> {
    return (await this.#statusEntries(signal)).map(entry => entry.path)
  }

  /**
   * Return changes that affect a reproducible source snapshot. Untracked
   * desktop metadata is preserved in place but cannot block a Specs
   * transaction or isolated Worker lease. A tracked/staged metadata file is
   * still material and therefore never silently ignored.
   */
  async materialStatusPaths(signal?: AbortSignal): Promise<readonly string[]> {
    return (await this.#statusEntries(signal))
      .filter(entry => !(entry.status === '??'
        && isIgnorableWorkspaceMetadata(entry.path)))
      .map(entry => entry.path)
  }

  async #statusEntries(signal?: AbortSignal): Promise<readonly GitStatusEntry[]> {
    // `--untracked-files=all` is an authorization requirement, not a display
    // preference. Without it Git collapses a new directory to `specs/`, so an
    // exact allow-list for `specs/file.md` is falsely rejected and the model is
    // forced to broaden authority to the whole directory.
    const result = await requireProcess(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      gitOptions(this.#repositoryRoot, signal),
    )
    return parsePorcelainV1Z(result.stdout)
  }

  async requireClean(signal?: AbortSignal): Promise<void> {
    const paths = await this.statusPaths(signal)
    if (paths.length > 0) throw new MilitaryError('GIT_WORKTREE_DIRTY', 'local main working tree is dirty', { paths })
  }

  async requireMaterialClean(signal?: AbortSignal): Promise<void> {
    const paths = await this.materialStatusPaths(signal)
    if (paths.length > 0) {
      throw new MilitaryError(
        'GIT_WORKTREE_DIRTY',
        'local main contains material working-tree changes',
        { paths },
      )
    }
  }

  async commitLocalMain(input: {
    readonly message: string
    readonly allowedPaths: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<GitCommitReceipt> {
    await this.ensureRepository(input.signal)
    const branch = (await requireProcess('git', ['branch', '--show-current'], gitOptions(this.#repositoryRoot, input.signal))).stdout.trim()
    if (branch !== 'main') throw new MilitaryError('GIT_NON_MAIN_FORBIDDEN')
    const changed = await this.materialStatusPaths(input.signal)
    const forbidden = changed.filter(path => !pathWithinAny(path, input.allowedPaths))
    if (forbidden.length > 0) throw new MilitaryError('FORBIDDEN_SCOPE', 'Git commit contains paths outside the allowed set', { forbidden })
    if (changed.length === 0) return { commit: await this.head(input.signal), treeHash: await this.treeHash(input.signal), changedPaths: [] }
    await requireProcess('git', ['add', '--', ...changed], gitOptions(this.#repositoryRoot, input.signal), 'GIT_COMMIT_FAILED')
    const commit = await runProcess('git', ['commit', '--only', '-m', input.message, '--', ...changed], {
      ...gitOptions(this.#repositoryRoot, input.signal),
      env: {
        GIT_AUTHOR_NAME: 'dsh-military engineer',
        GIT_AUTHOR_EMAIL: 'dsh-military@localhost',
        GIT_COMMITTER_NAME: 'dsh-military engineer',
        GIT_COMMITTER_EMAIL: 'dsh-military@localhost',
      },
    })
    if (commit.exitCode !== 0) throw new MilitaryError('GIT_COMMIT_FAILED', commit.stderr)
    return {
      commit: await this.head(input.signal),
      treeHash: await this.treeHash(input.signal),
      changedPaths: changed,
    }
  }

  root(): string { return this.#repositoryRoot }
}

/** Strict allow-list for untracked operating-system metadata only. */
export function isIgnorableWorkspaceMetadata(path: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? ''
  return name === '.DS_Store'
    || name === 'Thumbs.db'
    || name === 'desktop.ini'
}

function gitOptions(
  cwd: string,
  signal?: AbortSignal,
  extra?: { readonly input?: string },
): { readonly cwd: string; readonly signal?: AbortSignal; readonly input?: string } {
  return { cwd, ...(signal === undefined ? {} : { signal }), ...(extra?.input === undefined ? {} : { input: extra.input }) }
}


function parsePorcelainV1Z(output: string): readonly GitStatusEntry[] {
  const records = output.split('\0')
  const entries: GitStatusEntry[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length < 4) continue
    const status = record.slice(0, 2)
    const path = record.slice(3)
    if (path !== '') entries.push({ status, path })
    if (/[RC]/u.test(status)) {
      const original = records[index + 1]
      if (original !== undefined && original !== '') {
        entries.push({ status, path: original })
      }
      index += 1
    }
  }
  return [...new Map(entries.map(entry => [entry.path, entry])).values()]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}
