import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  brand,
  isoNow,
  type AgentExecutionBinding,
  type AgentIdentity,
  type DataClassification,
  type IsoDateTime,
  type PermissionProfile,
  type ResourceBudgetReservation,
  type ResourceCounters,
  type ResourceUsageReceipt,
  type MilitaryResourceBudgets,
} from '@dsh-military/contracts'
import {
  normalizeWorkspacePath,
  pathWithinAny,
  sha256,
  stableJson,
  zeroCounters,
} from '@dsh-military/core'
import type { MilitaryHostRuntime } from './context.js'
import { hostToolFailure, roleRecoveryTool } from './tool-error.js'

/**
 * Complete department-tool admission boundary. It canonicalizes and scopes a
 * filesystem target, lets downstream guards decide, and only then commits one
 * atomic Capability Grant use.
 */
export async function authorizeDepartmentToolExecution(
  host: MilitaryHostRuntime,
  binding: AgentExecutionBinding,
  exec: ToolExecution,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  const profile = await host.application.policies.toolProfile(
    binding.toolProfile.id,
    Number(binding.toolProfile.revision),
  )
  if (profile.denyTools.includes(exec.name) || !profile.allowTools.includes(exec.name)) {
    return {
      kind: 'deny',
      reason: hostToolFailure(exec.agent, {
        code: 'POLICY_DENIED',
        message: `tool ${exec.name} is outside ${profile.toolProfileId}@${Number(profile.revision)}`,
        retryable: false,
        nextTool: roleRecoveryTool(binding.agent.role),
        recovery: 'Use nextTool to report the immutable ToolProfile mismatch; do not substitute a generic or unlisted tool.',
      }),
    }
  }
  const permission = await host.application.policies.permissionProfile(
    binding.permissionProfile.id,
    Number(binding.permissionProfile.revision),
  )
  const pathAuthorization = await authorizeToolPath(host, binding, permission, exec)
  if (pathAuthorization.denial !== undefined) {
    return {
      kind: 'deny',
      reason: hostToolFailure(exec.agent, {
        code: 'FORBIDDEN_SCOPE',
        message: pathAuthorization.denial,
        retryable: false,
        nextTool: exec.name,
        recovery: 'Call nextTool only with correctedShape and a Task-relative path inside the immutable scope; never copy a Host absolute path.',
      }),
    }
  }
  try {
    const context = await host.application.authorization.resolve(
      String(binding.agent.agentId),
      binding.tenantId,
    )
    const authority = await host.application.authorization.authorize({
      context,
      action: 'tool.execute',
      resource: `${exec.name}:${pathAuthorization.resource ?? '*'}`,
      classification: toolExecutionClassification(
        exec,
        binding.dataClassification ?? 'internal',
      ),
    })
    if (!authority.allowed) {
      return {
        kind: 'deny',
        reason: hostToolFailure(exec.agent, {
          code: 'UNAUTHORIZED',
          message: `authority denied: ${authority.reason ?? 'no matching authority'}`,
          retryable: false,
          nextTool: roleRecoveryTool(binding.agent.role),
          recovery: 'Use nextTool to report the authority denial; do not retry the denied operation.',
        }),
      }
    }
  } catch (error) {
    return {
      kind: 'deny',
      reason: hostToolFailure(exec.agent, {
        code: 'UNAUTHORIZED',
        message: `authority resolution failed: ${errorMessage(error)}`,
        retryable: false,
        nextTool: roleRecoveryTool(binding.agent.role),
        recovery: 'Use nextTool to report the authority failure; do not retry the denied operation.',
      }),
    }
  }

  const downstream = await next()
  if (downstream.kind !== 'allow') return downstream
  let reservation: ResourceBudgetReservation
  try {
    reservation = await reserveToolExecutionBudget(host, binding.agent, binding, exec)
  } catch (error) {
    return {
      kind: 'deny',
      reason: hostToolFailure(exec.agent, {
        code: 'BUDGET_RESERVATION_REQUIRED',
        message: `resource budget admission failed: ${errorMessage(error)}`,
        retryable: false,
        nextTool: roleRecoveryTool(binding.agent.role),
        recovery: 'Use nextTool once to report the budget block; do not repeat the blocked side effect.',
      }),
    }
  }
  try {
    await host.application.capabilityGrants.consume(binding.capabilityGrantId, {
      tool: exec.name,
      ...(pathAuthorization.resource === undefined ? {} : { resource: pathAuthorization.resource }),
      at: isoNow(),
      idempotencyKey: reservation.reservationId,
    })
  } catch (error) {
    await host.application.resourceBudgets.revoke(
      reservation.reservationId,
      'CAPABILITY_GRANT_DENIED',
    ).catch(() => undefined)
    return {
      kind: 'deny',
      reason: hostToolFailure(exec.agent, {
        code: 'POLICY_DENIED',
        message: `capability grant admission failed: ${errorMessage(error)}`,
        retryable: false,
        nextTool: roleRecoveryTool(binding.agent.role),
        recovery: 'Use nextTool once to report the grant block; do not repeat the blocked side effect.',
      }),
    }
  }
  return downstream
}

/** Use observed call context; a permission ceiling is never an actual label. */
export function toolExecutionClassification(
  exec: Pick<ToolExecution, 'arguments'>,
  fallback: DataClassification,
): DataClassification {
  if (typeof exec.arguments !== 'object'
    || exec.arguments === null
    || Array.isArray(exec.arguments)) return fallback
  const value = (exec.arguments as Record<string, unknown>).classification
  return value === 'public'
    || value === 'internal'
    || value === 'confidential'
    || value === 'restricted'
    ? value
    : fallback
}

/** Deterministic call-level key shared by budget and Capability Grant admission. */
export function toolBudgetReservationId(
  identity: AgentIdentity,
  exec: { readonly callId: unknown },
): string {
  const digest = sha256(stableJson({
    agentId: String(identity.agentId),
    generation: identity.generation,
    sessionId: String(identity.sessionId),
    callId: String(exec.callId),
  })).slice(0, 32)
  return `tool-budget-${digest}`
}

/** Reserve capacity after every policy guard allows, but before Military admits execution. */
export async function reserveToolExecutionBudget(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  binding: AgentExecutionBinding | null,
  exec: ToolExecution,
): Promise<ResourceBudgetReservation> {
  const policy = binding === null
    ? await host.application.policies.resourceBudgetPolicy('budget-default')
    : await host.application.policies.resourceBudgetPolicy(
        binding.resourceBudgetPolicy.id,
        Number(binding.resourceBudgetPolicy.revision),
      )
  let scopeType: ResourceBudgetReservation['scopeType']
  let scopeId: string
  if (binding?.workspace !== undefined) {
    scopeType = 'TASK'
    scopeId = binding.workspace.taskId
  } else if (binding !== null) {
    scopeType = 'MISSION'
    scopeId = binding.missionId
  } else {
    const missionId = await host.application.runtime.missionForSession(identity.sessionId)
    scopeType = missionId === null ? 'TENANT' : 'MISSION'
    scopeId = missionId === null ? host.tenantId : String(missionId)
  }
  const reservationId = toolBudgetReservationId(identity, exec)
  const reservedAt = isoNow()
  const requested: ResourceCounters = {
    ...zeroCounters(),
    wallClockSeconds: Math.max(
      1,
      Math.min(
        300,
        Math.floor(
          policy.limits.wallClockSeconds / Math.max(1, policy.limits.toolCalls),
        ),
      ),
    ),
    toolCalls: 1,
    apiCalls: isNetworkTool(exec.name) ? 1 : 0,
    storageBytes: Math.max(
      1,
      Math.min(
        1_048_576,
        Math.floor(
          policy.limits.storageBytes / Math.max(1, policy.limits.toolCalls),
        ),
      ),
    ),
  }
  const accepted = await host.application.resourceBudgets.reserve({
    schemaVersion: '1.0.0',
    reservationId,
    tenantId: host.tenantId,
    scopeType,
    scopeId,
    policyId: policy.policyId,
    policyRevision: policy.revision,
    ownerAgent: identity,
    requested,
    granted: zeroCounters(),
    state: 'RESERVED',
    idempotencyKey: `${reservationId}:reserve`,
    reservedAt,
    expiresAt: brand<string, 'IsoDateTime'>(
      new Date(Date.parse(reservedAt) + 30 * 60 * 1000).toISOString(),
    ),
  })
  if (accepted.state !== 'RESERVED') {
    throw new Error(`tool budget reservation ${reservationId} is ${accepted.state}`)
  }
  return accepted
}

/** Settle the exact pre-execution reservation from host-observed outcome data. */
export async function settleToolExecutionBudget(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  exec: ToolExecution,
  result: unknown,
  completedAt: IsoDateTime,
): Promise<void> {
  const reservation = await host.application.resourceBudgets.getReservation(
    toolBudgetReservationId(identity, exec),
  )
  if (reservation.state === 'SETTLED') return
  const receipt = await toolExecutionUsageReceipt(
    host,
    identity,
    exec,
    result,
    completedAt,
  )
  await host.application.resourceBudgets.settle(receipt)
}

export async function toolExecutionUsageReceipt(
  host: MilitaryHostRuntime,
  identity: AgentIdentity,
  exec: ToolExecution,
  result: unknown,
  completedAt: IsoDateTime,
): Promise<ResourceUsageReceipt> {
  return await toolExecutionUsageReceiptFromIntent(
    host.application.resourceBudgets,
    {
    identity,
    toolName: exec.name,
    callId: String(exec.callId),
    result,
    completedAt,
    },
  )
}

export interface ToolExecutionUsageIntent {
  readonly identity: AgentIdentity
  readonly toolName: string
  readonly callId: string
  readonly result: unknown
  readonly completedAt: IsoDateTime
}

export async function toolExecutionUsageReceiptFromIntent(
  resourceBudgets: MilitaryResourceBudgets,
  intent: ToolExecutionUsageIntent,
): Promise<ResourceUsageReceipt> {
  const reservationId = toolBudgetReservationId(intent.identity, {
    callId: intent.callId,
  })
  const reservation = await resourceBudgets.getReservation(reservationId)
  if (reservation.state === 'SETTLED') {
    throw new Error(`tool budget reservation ${reservationId} is already SETTLED`)
  }
  if (reservation.state !== 'RESERVED') {
    throw new Error(`tool budget reservation ${reservationId} is ${reservation.state}`)
  }
  const actual: ResourceCounters = {
    ...zeroCounters(),
    wallClockSeconds: Math.max(
      0,
      Math.ceil((Date.parse(intent.completedAt) - Date.parse(reservation.reservedAt)) / 1000),
    ),
    toolCalls: 1,
    apiCalls: isNetworkTool(intent.toolName) ? 1 : 0,
    storageBytes: new TextEncoder().encode(stableJson(intent.result)).byteLength,
  }
  const overages = subtractCounters(actual, reservation.granted)
  return {
    schemaVersion: '1.0.0',
    receiptId: `${reservationId}:usage`,
    reservationId,
    scopeType: reservation.scopeType,
    scopeId: reservation.scopeId,
    actual,
    overages,
    disposition: Object.values(overages).some(value => value > 0) ? 'OVER_BUDGET' : 'SETTLED',
    sourceEventIds: [`tool:${intent.callId}`],
    idempotencyKey: `${reservationId}:settle`,
    startedAt: reservation.reservedAt,
    completedAt: intent.completedAt,
  }
}

async function authorizeToolPath(
  host: MilitaryHostRuntime,
  binding: AgentExecutionBinding,
  permission: PermissionProfile,
  exec: ToolExecution,
): Promise<{ readonly denial?: string; readonly resource?: string }> {
  const args = typeof exec.arguments === 'object' && exec.arguments !== null
    ? exec.arguments as Record<string, unknown>
    : {}
  if (args['sandbox_permissions'] !== undefined || args['justification'] !== undefined) {
    return { denial: 'department Agents cannot request sandbox escalation outside their immutable permission profile' }
  }
  const taskFacade = exec.name.startsWith('military_workspace_')
  const write = exec.name === 'write'
    || exec.name === 'edit'
    || exec.name === 'military_workspace_write'
    || exec.name === 'military_workspace_edit'
  const read = exec.name === 'read'
    || exec.name === 'read_image'
    || exec.name === 'glob'
    || exec.name === 'grep'
    || exec.name === 'military_workspace_read'
    || exec.name === 'military_workspace_list'
    || exec.name === 'military_workspace_search'
  if (!write && !read) return {}
  const raw = typeof args['file_path'] === 'string'
    ? args['file_path']
    : typeof args['path'] === 'string' ? args['path'] : '.'
  let readPaths = permission.filesystem.readPaths
  let writePaths = permission.filesystem.writePaths
  let forbidden = permission.filesystem.denyPaths
  let executionRoot: string
  let requireAbsolute = false
  if (binding.workspace !== undefined) {
    executionRoot = resolve(host.application.workspaces.executionPath(binding.workspace.leaseId))
    if (!taskFacade) {
      const pathPolicy = taskBoundToolPathPolicy({
        executionRoot,
        sessionCwd: exec.agent?.session.header.cwd,
        raw,
      })
      if (pathPolicy.denial !== undefined) return { denial: pathPolicy.denial }
      requireAbsolute = pathPolicy.requireAbsolute
    }
    const order = await host.application.runtime.getTask(brand<string, 'TaskId'>(binding.workspace.taskId))
    if (Number(order.taskVersion) !== binding.workspace.taskVersion) {
      return { denial: 'workspace Task version is stale' }
    }
    readPaths = order.scope.readPaths
    writePaths = order.scope.writePaths
    forbidden = [...forbidden, ...order.scope.forbiddenPaths]
  } else {
    const rootBinding = await host.application.sessionGate.requireMilitarySession(
      brand<string, 'SessionId'>(binding.rootSessionId),
    )
    executionRoot = resolve(rootBinding.workspaceKey)
  }
  const canonical = await canonicalizeToolTarget({
    root: executionRoot,
    raw,
    requireAbsolute,
    followSymlinks: permission.filesystem.followSymlinks,
  })
  if (canonical.denial !== undefined) return { denial: canonical.denial }
  const path = canonical.resource!
  if (forbidden.some(prefix => pathWithinAny(path, [prefix]))) {
    return { denial: `path ${raw} is explicitly forbidden` }
  }
  const allowed = write ? writePaths : readPaths
  if (!pathWithinAny(path, allowed)) {
    return { denial: `path ${raw} is outside the immutable ${write ? 'write' : 'read'} scope` }
  }
  return { resource: path }
}

/**
 * RC.2 fs-search treats an omitted `path` as the Session cwd. That is safe for
 * local-main Engineer leases where the inherited cwd is the execution root,
 * but it would target the wrong tree for an isolated Worker worktree. Keep the
 * optional upstream schema usable in the former case and fail closed with the
 * exact corrective root in the latter.
 */
export function taskBoundToolPathPolicy(input: {
  readonly executionRoot: string
  readonly sessionCwd: string | undefined
  readonly raw: string
}): { readonly requireAbsolute: boolean; readonly denial?: string } {
  if (isAbsolute(input.raw)) return { requireAbsolute: true }
  const sessionCwd = input.sessionCwd === undefined ? undefined : resolve(input.sessionCwd)
  const executionRoot = resolve(input.executionRoot)
  if (sessionCwd === executionRoot) return { requireAbsolute: false }
  return {
    requireAbsolute: true,
    denial: `Relative or omitted path "${input.raw}" would execute outside the assigned worktree; retry once with an absolute path rooted at ${executionRoot}`,
  }
}

export async function canonicalizeToolTarget(input: {
  readonly root: string
  readonly raw: string
  readonly requireAbsolute: boolean
  readonly followSymlinks: boolean
}): Promise<{ readonly denial?: string; readonly resource?: string }> {
  if (input.raw.includes('\u0000')) return { denial: 'filesystem path contains a NUL byte' }
  if (input.requireAbsolute && !isAbsolute(input.raw)) {
    return { denial: 'filesystem path must be absolute' }
  }
  const lexicalRoot = resolve(input.root)
  const lexicalTarget = isAbsolute(input.raw)
    ? resolve(input.raw)
    : resolve(lexicalRoot, input.raw)
  if (outsideRoot(lexicalRoot, lexicalTarget)) {
    return { denial: `path ${input.raw} is outside the assigned filesystem root` }
  }
  if (!input.followSymlinks && await hasSymlinkBelowRoot(lexicalRoot, lexicalTarget)) {
    return { denial: `path ${input.raw} traverses a symbolic link forbidden by the permission profile` }
  }
  try {
    const canonicalRoot = await realpath(lexicalRoot)
    const canonicalTarget = await realpathWithMissingSuffix(lexicalTarget)
    if (outsideRoot(canonicalRoot, canonicalTarget)) {
      return { denial: `path ${input.raw} resolves outside the assigned filesystem root` }
    }
    return {
      resource: normalizeWorkspacePath(relative(canonicalRoot, canonicalTarget).replace(/\\/gu, '/')),
    }
  } catch (error) {
    return { denial: `cannot canonicalize path ${input.raw}: ${errorMessage(error)}` }
  }
}

async function hasSymlinkBelowRoot(root: string, target: string): Promise<boolean> {
  const relativeTarget = relative(root, target)
  if (relativeTarget === '') return false
  let cursor = root
  for (const segment of relativeTarget.split(/[\\/]/u)) {
    cursor = resolve(cursor, segment)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) return true
    } catch (error) {
      if (isMissingPathError(error)) return false
      throw error
    }
  }
  return false
}

async function realpathWithMissingSuffix(target: string): Promise<string> {
  let cursor = target
  const suffix: string[] = []
  for (;;) {
    try {
      const existing = await realpath(cursor)
      return resolve(existing, ...suffix)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      suffix.unshift(basename(cursor))
      cursor = parent
    }
  }
}

function outsideRoot(root: string, target: string): boolean {
  const value = relative(root, target)
  return value === '..'
    || value.startsWith('../')
    || value.startsWith('..\\')
    || isAbsolute(value)
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && ((error as { code?: string }).code === 'ENOENT' || (error as { code?: string }).code === 'ENOTDIR')
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function isNetworkTool(name: string): boolean {
  return /(?:^|[_:/.-])(api|browser|fetch|http|mcp|search|web)(?:$|[_:/.-])/iu.test(name)
}

function subtractCounters(actual: ResourceCounters, granted: ResourceCounters): ResourceCounters {
  return Object.fromEntries(
    (Object.keys(actual) as (keyof ResourceCounters)[])
      .map(key => [key, Math.max(0, actual[key] - granted[key])]),
  ) as unknown as ResourceCounters
}
