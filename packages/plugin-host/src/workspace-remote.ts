import { execFile } from 'node:child_process'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  MILITARY_WORKSPACE_SCHEMA_VERSION,
  MilitaryError,
  type AgentExecutionBinding,
  type MilitarySessionBinding,
  type MilitaryWorkspaceCatalogEntry,
  type MilitaryWorkspaceIntegrationView,
  type MilitaryWorkspaceLeaseView,
  type MilitaryWorkspacePathEntry,
  type MilitaryWorkspaceSnapshot,
  type MilitaryWorkspaceStatus,
} from '@dsh-military/contracts'
import { sha256 } from '@dsh-military/core'
import type { MilitaryHostRuntime } from './context.js'
import { canonicalizeToolTarget } from './tool-authorization.js'

const execFileAsync = promisify(execFile)
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MAX_PATH_ENTRIES = 500

interface SessionBindingRow {
  readonly session_id: string
  readonly binding_json: string
  readonly created_at: string
}

interface LeaseRow {
  readonly workspace_lease_id: string
  readonly task_id: string
  readonly task_version: number
  readonly agent_id: string
  readonly mode: 'READ' | 'WRITE'
  readonly path_scope_json: string
  readonly state: string
  readonly expires_at: string
}

interface IntegrationRow {
  readonly integration_order_id: string
  readonly candidate_patch_id: string
  readonly task_id: string
  readonly task_version: number
  readonly state: string
  readonly updated_at: string
  readonly integration_receipt_id?: string
  readonly disposition?: string
  readonly payload_json?: string
}

/**
 * Read-only Specs/workspace projection. Browser callers select only an opaque
 * workspaceId previously derived from an authoritative Military Session;
 * arbitrary browser-submitted paths are never accepted.
 */
export class MilitaryWorkspaceRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryWorkspace')
  }

  @Remote
  async snapshot(signal: AbortSignal): Promise<MilitaryWorkspaceSnapshot> {
    return {
      schemaVersion: MILITARY_WORKSPACE_SCHEMA_VERSION,
      workspaces: await this.catalog(signal),
      generatedAt: new Date().toISOString(),
    }
  }

  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<MilitaryWorkspaceStatus> {
    signal.throwIfAborted()
    const value = record(action, 'Military workspace action')
    if (value.type !== 'INSPECT_WORKSPACE') {
      throw new TypeError(`unknown Military workspace action ${String(value.type)}`)
    }
    const workspaceId = text(value.workspaceId, 'workspaceId', 128)
    if (!WORKSPACE_ID.test(workspaceId)) throw new TypeError('workspaceId is invalid')
    const workspace = (await this.catalog(signal)).find(value =>
      value.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new MilitaryError(
        'NOT_FOUND',
        '该工作区不再属于当前租户的 Military Session 目录；请刷新后重选',
      )
    }
    if (!workspace.available) {
      throw new MilitaryError('NOT_FOUND', '该工作区当前不可访问')
    }
    return await this.inspect(workspace, signal)
  }

  private async catalog(signal: AbortSignal): Promise<readonly MilitaryWorkspaceCatalogEntry[]> {
    const rows = this.host.database.db.prepare(`
      SELECT session_id, binding_json, created_at
      FROM military_session_bindings
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `).all(this.host.tenantId) as unknown as SessionBindingRow[]
    const grouped = new Map<string, {
      root: string
      sessions: Set<string>
      updatedAt: string
      available: boolean
      repository: boolean
    }>()
    for (const row of rows) {
      signal.throwIfAborted()
      let binding: MilitarySessionBinding
      try {
        binding = JSON.parse(row.binding_json) as MilitarySessionBinding
      } catch {
        continue
      }
      if (typeof binding.workspaceKey !== 'string' || !binding.workspaceKey.startsWith(sep)) {
        continue
      }
      let root = resolve(binding.workspaceKey)
      let available = false
      try {
        root = await realpath(root)
        available = (await lstat(root)).isDirectory()
      } catch {
        available = false
      }
      const key = sha256(root)
      const current = grouped.get(key)
      if (current === undefined) {
        grouped.set(key, {
          root,
          sessions: new Set([row.session_id]),
          updatedAt: row.created_at,
          available,
          repository: available && await isGitRepository(root, signal),
        })
      } else {
        current.sessions.add(row.session_id)
        current.updatedAt = current.updatedAt > row.created_at
          ? current.updatedAt
          : row.created_at
        current.available ||= available
      }
    }
    return [...grouped.entries()].map(([rootPathHash, value]) => ({
      workspaceId: `workspace-${rootPathHash.slice(0, 32)}`,
      label: basename(value.root) || value.root,
      canonicalRoot: value.root,
      rootPathHash,
      sessionIds: [...value.sessions].sort(),
      available: value.available,
      repository: value.repository,
      updatedAt: value.updatedAt,
    })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  private async inspect(
    workspace: MilitaryWorkspaceCatalogEntry,
    signal: AbortSignal,
  ): Promise<MilitaryWorkspaceStatus> {
    const root = await realpath(workspace.canonicalRoot)
    if (sha256(root) !== workspace.rootPathHash) {
      throw new MilitaryError('MILITARY_BINDING_MISMATCH', '工作区 canonical root 已漂移')
    }
    const leases = await this.leases(workspace, signal)
    const git = await inspectGit(root, signal)
    const paths = git.available
      ? [...new Set([...git.trackedPaths, ...git.statusByPath.keys()])].sort()
      : await listLocalPaths(root, signal)
    const boundedPaths = paths.slice(0, MAX_PATH_ENTRIES)
    const pathEntries: MilitaryWorkspacePathEntry[] = []
    for (const path of boundedPaths) {
      signal.throwIfAborted()
      const canonical = await canonicalizeToolTarget({
        root,
        raw: path,
        requireAbsolute: false,
        followSymlinks: false,
      })
      if (canonical.denial !== undefined || canonical.resource === undefined) continue
      const normalized = canonical.resource
      const metadata = await lstat(join(root, normalized)).catch(() => undefined)
      pathEntries.push({
        path: normalized,
        kind: metadata?.isDirectory() === true ? 'DIRECTORY' : 'FILE',
        gitState: git.statusByPath.get(normalized) ?? 'CLEAN',
        ...scopeForPath(normalized, leases),
      })
    }
    const integrations = this.integrations(leases)
    return {
      schemaVersion: MILITARY_WORKSPACE_SCHEMA_VERSION,
      workspace,
      git: {
        available: git.available,
        ...(git.root === undefined ? {} : { root: git.root }),
        ...(git.head === undefined ? {} : { head: git.head }),
        ...(git.branch === undefined ? {} : { branch: git.branch }),
        ...(git.tree === undefined ? {} : { tree: git.tree }),
        dirty: [...git.statusByPath.values()].filter(value =>
          value !== 'CLEAN' && value !== 'UNTRACKED').length,
        untracked: [...git.statusByPath.values()].filter(value =>
          value === 'UNTRACKED').length,
        summary: git.available
          ? `${git.statusByPath.size} 个变更路径；只执行了 read-only Git 查询`
          : '当前工作区不是 Git repository；Military 不会由设置页自动初始化。',
      },
      pathEntries,
      truncatedPathCount: Math.max(0, paths.length - pathEntries.length),
      leases,
      integrations,
      rolePathExamples: leases.map(lease => ({
        roleId: lease.roleId,
        taskId: lease.taskId,
        readExample: lease.readPaths[0] ?? '.',
        ...(lease.writePaths[0] === undefined ? {} : { writeExample: lease.writePaths[0] }),
        ...(lease.forbiddenPaths[0] === undefined
          ? {}
          : { forbiddenExample: lease.forbiddenPaths[0] }),
      })),
      generatedAt: new Date().toISOString(),
    }
  }

  private async leases(
    workspace: MilitaryWorkspaceCatalogEntry,
    signal: AbortSignal,
  ): Promise<readonly MilitaryWorkspaceLeaseView[]> {
    signal.throwIfAborted()
    const rows = this.host.database.db.prepare(`
      SELECT
        l.workspace_lease_id, l.task_id, l.task_version, l.agent_id,
        l.mode, l.path_scope_json, l.state, l.expires_at
      FROM workspace_leases l
      INNER JOIN workspace_snapshots s
        ON s.tenant_id = l.tenant_id
        AND s.workspace_snapshot_id = l.workspace_snapshot_id
      WHERE l.tenant_id = ? AND s.root_path_hash = ?
      ORDER BY l.acquired_at DESC
      LIMIT 80
    `).all(this.host.tenantId, workspace.rootPathHash) as unknown as LeaseRow[]
    const bindings = this.host.database.db.prepare(`
      SELECT binding_json FROM agent_execution_bindings
      WHERE tenant_id = ?
    `).all(this.host.tenantId) as unknown as Array<{ readonly binding_json: string }>
    const executions = bindings.flatMap(row => {
      try {
        return [JSON.parse(row.binding_json) as AgentExecutionBinding]
      } catch {
        return []
      }
    })
    const result: MilitaryWorkspaceLeaseView[] = []
    for (const row of rows) {
      signal.throwIfAborted()
      const scope = pathScope(row.path_scope_json)
      const binding = executions.find(value =>
        value.workspace?.leaseId === row.workspace_lease_id)
      let worktreeLabel: string | undefined
      if (row.state === 'ACTIVE') {
        try {
          const executionRoot = this.host.application.workspaces.executionPath(
            row.workspace_lease_id,
          )
          if (resolve(executionRoot) !== resolve(workspace.canonicalRoot)) {
            worktreeLabel = basename(resolve(executionRoot))
          }
        } catch {
          worktreeLabel = undefined
        }
      }
      result.push({
        leaseId: row.workspace_lease_id,
        taskId: row.task_id,
        taskVersion: row.task_version,
        roleId: binding?.templateId ?? row.agent_id,
        mode: row.mode,
        state: row.state,
        readPaths: scope.readPaths,
        writePaths: scope.writePaths,
        forbiddenPaths: scope.forbiddenPaths,
        ...(worktreeLabel === undefined ? {} : { worktreeLabel }),
        expiresAt: row.expires_at,
      })
    }
    return result
  }

  private integrations(
    leases: readonly MilitaryWorkspaceLeaseView[],
  ): readonly MilitaryWorkspaceIntegrationView[] {
    const taskIds = new Set(leases.map(value => value.taskId))
    if (taskIds.size === 0) return []
    const rows = this.host.database.db.prepare(`
      SELECT
        o.integration_order_id, o.candidate_patch_id, o.task_id,
        o.task_version, o.state, o.updated_at,
        r.integration_receipt_id, r.disposition, r.payload_json
      FROM integration_orders o
      LEFT JOIN integration_receipts r
        ON r.tenant_id = o.tenant_id
        AND r.integration_order_id = o.integration_order_id
      WHERE o.tenant_id = ?
      ORDER BY o.updated_at DESC
      LIMIT 100
    `).all(this.host.tenantId) as unknown as IntegrationRow[]
    return rows.filter(row => taskIds.has(row.task_id)).map(row => {
      const payload = parseRecord(row.payload_json)
      return {
        integrationOrderId: row.integration_order_id,
        candidatePatchId: row.candidate_patch_id,
        taskId: row.task_id,
        taskVersion: row.task_version,
        state: row.state,
        ...(row.disposition === undefined ? {} : { disposition: row.disposition }),
        ...(typeof payload.beforeHead !== 'string' ? {} : { beforeHead: payload.beforeHead }),
        ...(typeof payload.afterHead !== 'string' ? {} : { afterHead: payload.afterHead }),
        ...(typeof payload.commit !== 'string' ? {} : { commit: payload.commit }),
        ...(row.integration_receipt_id === undefined
          ? {}
          : { receiptId: row.integration_receipt_id }),
        updatedAt: row.updated_at,
      }
    })
  }
}

interface GitInspection {
  readonly available: boolean
  readonly root?: string
  readonly head?: string
  readonly branch?: string
  readonly tree?: string
  readonly trackedPaths: readonly string[]
  readonly statusByPath: ReadonlyMap<string, MilitaryWorkspacePathEntry['gitState']>
}

async function inspectGit(root: string, signal: AbortSignal): Promise<GitInspection> {
  if (!await isGitRepository(root, signal)) {
    return { available: false, trackedPaths: [], statusByPath: new Map() }
  }
  const repositoryRoot = await git(root, ['rev-parse', '--show-toplevel'], signal)
  const [head, branch, tree, tracked, status] = await Promise.all([
    git(root, ['rev-parse', 'HEAD'], signal),
    git(root, ['branch', '--show-current'], signal),
    git(root, ['rev-parse', 'HEAD^{tree}'], signal),
    git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], signal),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], signal),
  ])
  const prefix = normalize(relative(repositoryRoot, root))
  const withinWorkspace = (value: string): string | undefined => {
    const normalized = normalize(value)
    if (prefix === '.') return normalized
    if (normalized === prefix) return '.'
    return normalized.startsWith(`${prefix}/`)
      ? normalized.slice(prefix.length + 1)
      : undefined
  }
  const trackedPaths = tracked.split('\0').flatMap(value => {
    if (value === '') return []
    const path = withinWorkspace(value)
    return path === undefined || path === '.' ? [] : [path]
  })
  return {
    available: true,
    root: repositoryRoot,
    head,
    branch: branch === '' ? '(detached)' : branch,
    tree,
    trackedPaths,
    statusByPath: parseGitStatus(status, withinWorkspace),
  }
}

function parseGitStatus(
  source: string,
  withinWorkspace: (path: string) => string | undefined,
): ReadonlyMap<string, MilitaryWorkspacePathEntry['gitState']> {
  const result = new Map<string, MilitaryWorkspacePathEntry['gitState']>()
  const fields = source.split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field.length < 4) continue
    const code = field.slice(0, 2)
    const firstPath = field.slice(3)
    const rename = code.includes('R') || code.includes('C')
    // In porcelain v1 -z output the path in the status entry is the
    // destination. A following NUL field is the source path and must only be
    // consumed, never substituted for the destination shown to the user.
    if (rename) index += 1
    const rawPath = firstPath
    const path = withinWorkspace(rawPath)
    if (path === undefined || path === '.') continue
    result.set(path, gitState(code))
  }
  return result
}

function gitState(code: string): MilitaryWorkspacePathEntry['gitState'] {
  if (code === '??') return 'UNTRACKED'
  if (code.includes('R') || code.includes('C')) return 'RENAMED'
  if (code.includes('D')) return 'DELETED'
  if (code.includes('A')) return 'ADDED'
  if (code.includes('M')) return 'MODIFIED'
  if (code === '!!') return 'IGNORED'
  return 'UNKNOWN'
}

async function isGitRepository(root: string, signal: AbortSignal): Promise<boolean> {
  try {
    return await git(root, ['rev-parse', '--is-inside-work-tree'], signal) === 'true'
  } catch {
    return false
  }
}

async function git(
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1_024 * 1_024,
    signal,
  })
  return result.stdout.trim()
}

async function listLocalPaths(root: string, signal: AbortSignal): Promise<readonly string[]> {
  const paths: string[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5 || paths.length > MAX_PATH_ENTRIES * 2) return
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      signal.throwIfAborted()
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const absolute = join(directory, entry.name)
      const path = normalize(relative(root, absolute))
      paths.push(path)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(absolute, depth + 1)
    }
  }
  await walk(root, 0)
  return paths
}

function scopeForPath(
  path: string,
  leases: readonly MilitaryWorkspaceLeaseView[],
): Pick<MilitaryWorkspacePathEntry, 'scope' | 'scopeReason'> {
  if (leases.some(value => value.forbiddenPaths.some(scope => pathWithin(path, scope)))) {
    return { scope: 'FORBIDDEN', scopeReason: '至少一个权威 Task scope 明确禁止该路径。' }
  }
  if (leases.some(value => value.writePaths.some(scope => pathWithin(path, scope)))) {
    return { scope: 'READ_WRITE', scopeReason: '活动/历史 Task writePaths 授权示例；执行时仍需 exact lease。' }
  }
  if (leases.some(value => value.readPaths.some(scope => pathWithin(path, scope)))) {
    return { scope: 'READ_ONLY', scopeReason: '活动/历史 Task readPaths 授权示例；执行时仍需 exact lease。' }
  }
  if (pathWithin(path, 'specs') || pathWithin(path, 'docs')) {
    return { scope: 'SPECS_DEFAULT', scopeReason: 'Specs Control 固定允许目录；写入仍要求 Engineer order。' }
  }
  return { scope: 'UNSCOPED', scopeReason: '没有权威 Task scope 授权；这里只读展示 Git 状态。' }
}

function pathWithin(path: string, scope: string): boolean {
  const normalizedPath = normalize(path)
  const normalizedScope = normalize(scope)
  return normalizedScope === '.'
    || normalizedPath === normalizedScope
    || normalizedPath.startsWith(`${normalizedScope}/`)
}

function pathScope(source: string): {
  readonly readPaths: readonly string[]
  readonly writePaths: readonly string[]
  readonly forbiddenPaths: readonly string[]
} {
  const value = parseRecord(source)
  return {
    readPaths: stringArray(value.readPaths),
    writePaths: stringArray(value.writePaths),
    forbiddenPaths: stringArray(value.forbiddenPaths),
  }
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(normalize)
    : []
}

function normalize(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
  return normalized === '' ? '.' : normalized
}

function parseRecord(source: string | undefined): Record<string, unknown> {
  if (source === undefined) return {}
  try {
    return record(JSON.parse(source) as unknown, 'stored JSON')
  } catch {
    return {}
  }
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, at: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new TypeError(`${at} must be non-empty text up to ${maximum} characters`)
  }
  return value.trim()
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryWorkspace: MilitaryWorkspaceRemoteService
  }
}
