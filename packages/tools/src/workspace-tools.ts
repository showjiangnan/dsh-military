import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MilitaryError } from '@dsh-military/contracts'
import {
  normalizeWorkspacePath,
  pathWithinAny,
  sha256,
} from '@dsh-military/core'
import {
  asString,
  defineJsonTool,
  requireCallingAgent,
  runDurableTerminalMutation,
  text,
} from './common.js'
import { requireBoundTask } from './bound-task.js'

const MAX_READ_LINES = 2_000
const MAX_READ_BYTES = 1_048_576
const MAX_SEARCH_FILES = 2_000
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_FILE_BYTES = 1_048_576

/**
 * Project-relative filesystem facade for Task-bound workers. The built-in RC.2
 * file tools resolve relative paths from the parent Session cwd, which is not
 * the isolated worktree. This facade resolves from the immutable Workspace
 * Lease instead and keeps absolute worktree identities out of small-model
 * prompts and arguments.
 */
export function workspaceTools(ctx: Context): readonly ToolDefinition[] {
  return [
    defineJsonTool({
      name: 'military_workspace_read',
      description: 'Read a UTF-8 file in this Task’s isolated workspace. Use a project-relative path such as src/index.ts.',
      parameters: {
        path: { type: 'string', required: true, description: 'Project-relative file path.' },
        offset: { type: 'number', description: 'Optional 1-based first line; default 1.' },
        limit: { type: 'number', description: `Optional line limit; maximum ${MAX_READ_LINES}.` },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const target = await resolveWorkspaceTarget(ctx, exec, asString(args.path, 'path'), 'READ')
        const info = await stat(target.absolute)
        if (!info.isFile()) throw new MilitaryError('INVALID_ARGUMENT', `${target.relative} is not a file`)
        if (info.size > MAX_READ_BYTES) {
          throw new MilitaryError(
            'INVALID_ARGUMENT',
            `${target.relative} exceeds the ${MAX_READ_BYTES}-byte direct-read limit; narrow the file or use search`,
          )
        }
        const offset = positiveInteger(args.offset, 'offset', 1)
        const limit = positiveInteger(args.limit, 'limit', MAX_READ_LINES)
        if (limit > MAX_READ_LINES) {
          throw new MilitaryError('INVALID_ARGUMENT', `limit must be at most ${MAX_READ_LINES}`)
        }
        const content = await readFile(target.absolute, 'utf8')
        const all = content.split(/\r?\n/u)
        const lines = all.slice(offset - 1, offset - 1 + limit)
          .map((line, index) => ({ number: offset + index, text: line }))
        return {
          path: target.relative,
          offset,
          lines,
          totalLines: all.length,
          truncated: offset - 1 + lines.length < all.length,
          sha256: sha256(content),
        }
      },
    }),
    defineJsonTool({
      name: 'military_workspace_list',
      description: 'List files and directories in this Task’s isolated workspace. Omit path for the project root.',
      parameters: {
        path: { type: 'string', description: 'Optional project-relative directory; omit for root.' },
        depth: { type: 'number', description: 'Optional recursion depth from 1 to 8; default 2.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const raw = typeof args.path === 'string' && args.path.trim() !== '' ? args.path : '.'
        const target = await resolveWorkspaceTarget(ctx, exec, raw, 'READ')
        const depth = positiveInteger(args.depth, 'depth', 2)
        if (depth > 8) throw new MilitaryError('INVALID_ARGUMENT', 'depth must be at most 8')
        const entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = []
        await walk(target.absolute, target.root, depth, entries)
        return {
          path: target.relative,
          entries: entries.slice(0, MAX_SEARCH_RESULTS),
          truncated: entries.length > MAX_SEARCH_RESULTS,
        }
      },
    }),
    defineJsonTool({
      name: 'military_workspace_search',
      description: 'Search UTF-8 workspace files for a literal string. Omit path to search the authorized project scope.',
      parameters: {
        query: { type: 'string', required: true, description: 'Literal text to find.' },
        path: { type: 'string', description: 'Optional project-relative file or directory.' },
        caseSensitive: { type: 'boolean', description: 'Default true.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const query = asString(args.query, 'query')
        const raw = typeof args.path === 'string' && args.path.trim() !== '' ? args.path : '.'
        const target = await resolveWorkspaceTarget(ctx, exec, raw, 'READ')
        const files: string[] = []
        const targetInfo = await stat(target.absolute)
        if (targetInfo.isFile()) files.push(target.absolute)
        else if (targetInfo.isDirectory()) await collectFiles(target.absolute, files)
        else throw new MilitaryError('INVALID_ARGUMENT', `${target.relative} is not searchable`)
        const needle = args.caseSensitive === false ? query.toLocaleLowerCase() : query
        const matches: Array<{ path: string; line: number; text: string }> = []
        let skippedLargeFiles = 0
        for (const file of files.slice(0, MAX_SEARCH_FILES)) {
          if (matches.length >= MAX_SEARCH_RESULTS) break
          const info = await stat(file)
          if (info.size > MAX_SEARCH_FILE_BYTES) {
            skippedLargeFiles += 1
            continue
          }
          let content: string
          try {
            content = await readFile(file, 'utf8')
          } catch {
            continue
          }
          const lines = content.split(/\r?\n/u)
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!
            const comparable = args.caseSensitive === false ? line.toLocaleLowerCase() : line
            if (!comparable.includes(needle)) continue
            matches.push({
              path: portableRelative(target.root, file),
              line: index + 1,
              text: line.slice(0, 2_000),
            })
            if (matches.length >= MAX_SEARCH_RESULTS) break
          }
        }
        return {
          query,
          path: target.relative,
          matches,
          searchedFiles: Math.min(files.length, MAX_SEARCH_FILES),
          skippedLargeFiles,
          truncated: files.length > MAX_SEARCH_FILES || matches.length >= MAX_SEARCH_RESULTS,
        }
      },
    }),
    defineJsonTool({
      name: 'military_workspace_write',
      description: 'Create or completely replace one UTF-8 file in this Task’s write scope. Use a project-relative path and full final content.',
      parameters: {
        path: { type: 'string', required: true, description: 'Project-relative file path.' },
        content: { type: 'string', required: true, description: 'Complete final UTF-8 content.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const target = await resolveWorkspaceTarget(ctx, exec, asString(args.path, 'path'), 'WRITE')
        const content = asStringAllowEmpty(args.content, 'content')
        const operationId = mutationOperationId('write', exec.callId)
        const mutation = await runDurableTerminalMutation(ctx, {
          identity: target.identity,
          actionKey: operationId,
          draft: {
            path: target.relative,
            contentHash: sha256(content),
          },
          operation: async () => {
            let before: string | null = null
            try {
              before = await readFile(target.absolute, 'utf8')
            } catch (error) {
              if (!isMissing(error)) throw error
            }
            await atomicWorkspaceWrite(target.absolute, content, operationId)
            return {
              path: target.relative,
              operation: before === null ? 'created' : 'replaced',
              beforeHash: before === null ? null : sha256(before),
              afterHash: sha256(content),
              bytes: Buffer.byteLength(content),
            }
          },
        })
        return {
          ...mutation.value,
          operationId,
          receiptState: 'COMPLETED',
          replayed: mutation.replayed,
        }
      },
    }),
    defineJsonTool({
      name: 'military_workspace_edit',
      description: 'Replace exact literal text in one existing UTF-8 file in this Task’s write scope. Read the file first and copy oldText exactly.',
      parameters: {
        path: { type: 'string', required: true, description: 'Project-relative file path.' },
        oldText: { type: 'string', required: true, description: 'Exact non-empty text to replace.' },
        newText: { type: 'string', required: true, description: 'Replacement text; may be empty.' },
        replaceAll: { type: 'boolean', description: 'Replace every match; default false requires exactly one match.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const target = await resolveWorkspaceTarget(ctx, exec, asString(args.path, 'path'), 'WRITE')
        const oldText = asString(args.oldText, 'oldText')
        const newText = asStringAllowEmpty(args.newText, 'newText')
        if (oldText === newText) {
          throw new MilitaryError('INVALID_ARGUMENT', 'oldText and newText must differ')
        }
        const operationId = mutationOperationId('edit', exec.callId)
        const mutation = await runDurableTerminalMutation(ctx, {
          identity: target.identity,
          actionKey: operationId,
          draft: {
            path: target.relative,
            oldTextHash: sha256(oldText),
            newTextHash: sha256(newText),
            replaceAll: args.replaceAll === true,
          },
          operation: async () => {
            const before = await readFile(target.absolute, 'utf8')
            const occurrences = countOccurrences(before, oldText)
            if (occurrences === 0) {
              throw new MilitaryError('INVALID_ARGUMENT', 'oldText was not found; reread the file and use the exact current text')
            }
            if (args.replaceAll !== true && occurrences !== 1) {
              throw new MilitaryError(
                'INVALID_ARGUMENT',
                `oldText occurs ${occurrences} times; make it unique or set replaceAll=true`,
              )
            }
            const after = args.replaceAll === true
              ? before.split(oldText).join(newText)
              : before.replace(oldText, newText)
            await atomicWorkspaceWrite(target.absolute, after, operationId)
            return {
              path: target.relative,
              replacements: args.replaceAll === true ? occurrences : 1,
              beforeHash: sha256(before),
              afterHash: sha256(after),
              bytes: Buffer.byteLength(after),
            }
          },
        })
        return {
          ...mutation.value,
          operationId,
          receiptState: 'COMPLETED',
          replayed: mutation.replayed,
        }
      },
    }),
    defineJsonTool({
      name: 'military_workspace_operation_status',
      description: 'Read the durable receipt of a prior workspace write/edit after a timeout. Pass only the operationId reported by that call.',
      parameters: {
        operationId: { type: 'string', required: true, description: 'Opaque workspace operation ID.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent)
        const { identity } = await requireBoundTask(ctx, agent)
        const operationId = asString(args.operationId, 'operationId')
        if (!/^workspace-(?:write|edit)-[a-f0-9]{40}$/u.test(operationId)) {
          throw new MilitaryError('INVALID_ARGUMENT', 'operationId must be a workspace write/edit operation ID')
        }
        const receipt = ctx.militaryHost.readMutationReceipt<
          Readonly<Record<string, unknown>>
        >(identity, operationId)
        return receipt === null
          ? {
              operationId,
              state: 'NOT_FOUND',
              retryable: false,
              nextTool: 'military_submit_blocker',
            }
          : {
              operationId,
              state: 'COMPLETED',
              fingerprint: receipt.fingerprint,
              result: receipt.value,
            }
      },
    }),
  ]
}

async function resolveWorkspaceTarget(
  ctx: Context,
  exec: { readonly agent?: import('@deepseek-ai/dsh-agent').Agent },
  raw: string,
  access: 'READ' | 'WRITE',
): Promise<{
  readonly root: string
  readonly relative: string
  readonly absolute: string
  readonly identity: Awaited<ReturnType<typeof requireBoundTask>>['identity']
}> {
  const agent = requireCallingAgent(exec.agent)
  const { binding, order, identity } = await requireBoundTask(ctx, agent)
  const normalized = normalizeWorkspacePath(raw)
  const forbidden = order.scope.forbiddenPaths
  if (pathWithinAny(normalized, forbidden)) {
    throw new MilitaryError('FORBIDDEN_SCOPE', `${normalized || '.'} is explicitly forbidden`)
  }
  const allowed = access === 'WRITE' ? order.scope.writePaths : order.scope.readPaths
  if (!pathWithinAny(normalized, allowed)) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      `${normalized || '.'} is outside the Task ${access.toLowerCase()} scope`,
    )
  }
  const root = resolve(ctx.militaryHost.application.workspaces.executionPath(binding.workspace!.leaseId))
  const absolute = resolve(root, normalized)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new MilitaryError('FORBIDDEN_SCOPE', 'workspace path escapes the Task root')
  }
  await rejectSymlinkTraversal(root, absolute)
  return { root, relative: normalized, absolute, identity }
}

async function atomicWorkspaceWrite(
  path: string,
  content: string,
  operationId: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.military-${operationId}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

function mutationOperationId(
  kind: 'write' | 'edit',
  callId: unknown,
): string {
  return `workspace-${kind}-${sha256(String(callId)).slice(0, 40)}`
}

async function rejectSymlinkTraversal(root: string, target: string): Promise<void> {
  const path = relative(root, target)
  if (path === '') return
  let cursor = root
  for (const segment of path.split(sep)) {
    cursor = resolve(cursor, segment)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new MilitaryError('FORBIDDEN_SCOPE', 'workspace tools do not follow symbolic links')
      }
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

async function walk(
  directory: string,
  root: string,
  depth: number,
  output: Array<{ path: string; type: 'file' | 'directory'; size?: number }>,
): Promise<void> {
  if (output.length > MAX_SEARCH_RESULTS) return
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const absolute = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      output.push({ path: portableRelative(root, absolute), type: 'directory' })
      if (depth > 1) await walk(absolute, root, depth - 1, output)
    } else if (entry.isFile()) {
      output.push({
        path: portableRelative(root, absolute),
        type: 'file',
        size: (await stat(absolute)).size,
      })
    }
    if (output.length > MAX_SEARCH_RESULTS) return
  }
}

async function collectFiles(directory: string, output: string[]): Promise<void> {
  if (output.length >= MAX_SEARCH_FILES) return
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(absolute, output)
    else if (entry.isFile()) output.push(absolute)
    if (output.length >= MAX_SEARCH_FILES) return
  }
}

function positiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must be a positive integer`)
  }
  return Number(value)
}

function asStringAllowEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must be a string`)
  }
  return value
}

function portableRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

function countOccurrences(content: string, search: string): number {
  let count = 0
  let cursor = 0
  while ((cursor = content.indexOf(search, cursor)) !== -1) {
    count += 1
    cursor += search.length
  }
  return count
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { readonly code?: unknown }).code === 'ENOENT'
}
