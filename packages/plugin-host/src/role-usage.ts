import type { Context } from '@deepseek-ai/cordis'
import {
  GENERAL_ROLE_ID,
  type AgentExecutionBinding,
  type AgentIdentity,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import {
  ROLE_WORKBENCH_NAMESPACE,
  parseRoleWorkbenchDocument,
} from './role-workbench.js'

export const ROLE_REVISION_USE_NAMESPACE = 'military-role-revision-use'
export const ROLE_REVISION_SESSION_ANCHOR_NAMESPACE = 'military-role-revision-session-anchor'

export interface RoleRevisionUseRecord {
  readonly schemaVersion: '1.0.0'
  readonly useId: string
  readonly roleId: string
  readonly roleRevision: number
  readonly workbenchRevision: number
  readonly configurationHash: string
  readonly sessionId: string
  readonly rootSessionId: string
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly bindingId?: string
  readonly recordedAt: string
}

interface RoleRevisionSessionAnchor {
  readonly schemaVersion: '1.0.0'
  readonly sessionId: string
  readonly roleId: string
  readonly roleRevision: number
  readonly workbenchRevision: number
  readonly configurationHash: string
  readonly anchoredAt: string
}

/**
 * Link every paid request to the immutable role revision that produced it.
 * The record contains no prompt text, workspace path, credential, or response.
 */
export function recordRoleRevisionUse(input: {
  readonly ctx: Context
  readonly host: MilitaryHostRuntime
  readonly identity: AgentIdentity
  readonly binding: AgentExecutionBinding | null
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
}): RoleRevisionUseRecord {
  const descriptor = input.ctx.settings.describe({ redactSecrets: true })
    .find(value => String(value.ns) === ROLE_WORKBENCH_NAMESPACE)
  if (descriptor === undefined) throw new Error('Military role workbench settings are unavailable')
  const settings = asRecord(descriptor.value)
  const document = parseRoleWorkbenchDocument(settings.stateJson)
  const roleId = input.binding?.templateId ?? GENERAL_ROLE_ID
  const sessionId = String(input.identity.sessionId)
  const records = new SqliteStateRecords(input.host.database, input.host.tenantId)
  const existingAnchor = records.readSync<RoleRevisionSessionAnchor>(
    ROLE_REVISION_SESSION_ANCHOR_NAMESPACE,
    sessionId,
  )
  if (existingAnchor !== null && existingAnchor.roleId !== roleId) {
    throw new Error(
      `Military Session ${sessionId} role changed from ${existingAnchor.roleId} to ${roleId}`,
    )
  }
  const resolved = existingAnchor ?? resolveSessionAnchor(
    document,
    roleId,
    sessionId,
    input.binding?.createdAt,
  )
  if (existingAnchor === null) {
    try {
      records.putSync(
        ROLE_REVISION_SESSION_ANCHOR_NAMESPACE,
        sessionId,
        resolved,
        { createOnly: true },
      )
    } catch {
      const raced = records.readSync<RoleRevisionSessionAnchor>(
        ROLE_REVISION_SESSION_ANCHOR_NAMESPACE,
        sessionId,
      )
      if (raced === null || raced.roleId !== roleId) throw new Error(
        `Military Session ${sessionId} role revision anchor could not be persisted`,
      )
    }
  }
  const anchor = records.readSync<RoleRevisionSessionAnchor>(
    ROLE_REVISION_SESSION_ANCHOR_NAMESPACE,
    sessionId,
  ) ?? resolved
  const useId = `${sessionId}:${input.turn}:${input.step}`
  const record: RoleRevisionUseRecord = {
    schemaVersion: '1.0.0',
    useId,
    roleId,
    roleRevision: anchor.roleRevision,
    workbenchRevision: anchor.workbenchRevision,
    configurationHash: anchor.configurationHash,
    sessionId,
    rootSessionId: input.binding?.rootSessionId ?? sessionId,
    turn: input.turn,
    step: input.step,
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    ...(input.binding === null ? {} : { bindingId: input.binding.bindingId }),
    recordedAt: new Date().toISOString(),
  }
  records.putSync(
    ROLE_REVISION_USE_NAMESPACE,
    useId,
    record,
    { createOnly: true },
  )
  return record
}

function resolveSessionAnchor(
  document: ReturnType<typeof parseRoleWorkbenchDocument>,
  roleId: string,
  sessionId: string,
  boundAt?: string,
): RoleRevisionSessionAnchor {
  const current = document.roles.find(value => value.roleId === roleId)
  if (current === undefined) throw new Error(`Military role workbench has no ${roleId}`)
  const cutoff = boundAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(boundAt)
  if (Number.isNaN(cutoff)) throw new Error(`invalid Military binding createdAt ${boundAt}`)
  const history = document.history
    .filter(value => value.roleId === roleId)
    .sort((left, right) => left.revision - right.revision)
  const active = history
    .filter(value => Date.parse(value.createdAt) <= cutoff)
    .at(-1)
  const initial = history[0]?.previousConfiguration
  const configuration = active?.configuration ?? initial ?? current
  return {
    schemaVersion: '1.0.0',
    sessionId,
    roleId,
    roleRevision: active?.revision ?? 0,
    workbenchRevision: active?.workbenchRevision ?? 0,
    configurationHash: sha256(stableJson(configuration)),
    anchoredAt: new Date().toISOString(),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Military role workbench settings must be an object')
  }
  return value as Record<string, unknown>
}
