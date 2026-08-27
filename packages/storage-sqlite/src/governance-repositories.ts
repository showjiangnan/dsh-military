import {
  MilitaryError,
  type AgentTemplateId,
  type AgentTemplateProfile,
  type CapabilityGrant,
  type DataClassification,
  type MilitaryAgentTemplates,
  type MilitaryAuthorityContext,
  type MilitaryAuthorization,
  type MilitaryCapabilityGrants,
  type MilitaryPolicyRegistry,
  type ModelCapabilityProfile,
  type PermissionProfile,
  type ResourceBudgetPolicy,
  type Revision,
  type ToolProfile,
  type UserAuthorizationReceipt,
  type VerifierProfile,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  isExpired,
  pathWithinAny,
  stableJson,
} from '@dsh-military/core'
import { SqliteStateRecords } from './state-records.js'
import type { SqliteMilitaryDatabase } from './database.js'

const CAPABILITY_NAMESPACE = 'capability-grant'

interface CapabilityConsumption {
  readonly fingerprint: string
  readonly receipt: CapabilityGrant
}

interface CapabilityGrantRecord {
  readonly grant: CapabilityGrant
  readonly consumptions: Readonly<Record<string, CapabilityConsumption>>
}

type StoredCapabilityGrant = CapabilityGrant | CapabilityGrantRecord

/** Durable, atomic Capability Grant provider. */
export class SqliteCapabilityGrantStore implements MilitaryCapabilityGrants {
  readonly #records: SqliteStateRecords
  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async issue(grant: CapabilityGrant): Promise<void> {
    await this.#records.update<StoredCapabilityGrant | null, null>(
      CAPABILITY_NAMESPACE,
      grant.grantId,
      () => null,
      current => {
        if (current !== null) throw new MilitaryError('REVISION_CONFLICT', 'capability grant already exists')
        if (grant.state !== 'ACTIVE' || grant.uses !== 0) {
          throw new MilitaryError('INVALID_ARGUMENT', 'new capability grant must be active and unused')
        }
        return {
          next: cloneFrozen({ grant, consumptions: {} }),
          result: null,
        }
      },
    )
  }

  async consume(
    grantId: string,
    input: {
      readonly tool: string
      readonly resource?: string
      readonly at: string
      readonly idempotencyKey?: string
    },
  ): Promise<CapabilityGrant> {
    return await this.#records.update<StoredCapabilityGrant | null, CapabilityGrant>(
      CAPABILITY_NAMESPACE,
      grantId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND', 'capability grant not found')
        const record = normalizeCapabilityGrant(current)
        const fingerprint = stableJson({ tool: input.tool, resource: input.resource })
        const duplicate = input.idempotencyKey === undefined
          ? undefined
          : record.consumptions[input.idempotencyKey]
        if (duplicate !== undefined) {
          if (duplicate.fingerprint !== fingerprint) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: record, result: cloneFrozen(duplicate.receipt) }
        }
        const grant = record.grant
        if (grant.state !== 'ACTIVE') throw new MilitaryError('POLICY_DENIED', `capability grant is ${grant.state}`)
        if (Date.parse(input.at) >= Date.parse(grant.expiresAt)) {
          throw new MilitaryError('POLICY_DENIED', 'capability grant expired')
        }
        if (!grant.allowedTools.includes(input.tool)) {
          throw new MilitaryError('POLICY_DENIED', `tool ${input.tool} is not granted`)
        }
        if (input.resource !== undefined && !pathWithinAny(input.resource, grant.resourcePatterns)) {
          throw new MilitaryError('POLICY_DENIED', 'resource is outside capability grant')
        }
        const uses = grant.uses + 1
        const next = cloneFrozen({
          ...grant,
          uses,
          state: uses >= grant.maximumUses ? 'EXHAUSTED' as const : 'ACTIVE' as const,
        })
        const nextRecord: CapabilityGrantRecord = {
          grant: next,
          consumptions: input.idempotencyKey === undefined
            ? record.consumptions
            : {
                ...record.consumptions,
                [input.idempotencyKey]: { fingerprint, receipt: next },
              },
        }
        return { next: cloneFrozen(nextRecord), result: next }
      },
    )
  }

  async revoke(grantId: string, _reason: string): Promise<void> {
    await this.#records.update<StoredCapabilityGrant | null, null>(
      CAPABILITY_NAMESPACE,
      grantId,
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND', 'capability grant not found')
        const record = normalizeCapabilityGrant(current)
        return {
          next: cloneFrozen({
            ...record,
            grant: { ...record.grant, state: 'REVOKED' as const },
          }),
          result: null,
        }
      },
    )
  }

  async discard(grantId: string): Promise<void> {
    const value = await this.#records.read<StoredCapabilityGrant>(
      CAPABILITY_NAMESPACE,
      grantId,
    )
    if (value === null) return
    const record = normalizeCapabilityGrant(value)
    if (record.grant.uses !== 0 || Object.keys(record.consumptions).length !== 0) {
      throw new MilitaryError('REVISION_CONFLICT', 'used capability grant cannot be discarded')
    }
    this.#records.deleteSync(CAPABILITY_NAMESPACE, grantId)
  }

  async get(grantId: string): Promise<CapabilityGrant> {
    const value = await this.#records.read<StoredCapabilityGrant>(CAPABILITY_NAMESPACE, grantId)
    if (value === null) throw new MilitaryError('NOT_FOUND', 'capability grant not found')
    return cloneFrozen(normalizeCapabilityGrant(value).grant)
  }
}

function normalizeCapabilityGrant(value: StoredCapabilityGrant): CapabilityGrantRecord {
  if ('grant' in value) {
    return cloneFrozen({
      grant: value.grant,
      consumptions: value.consumptions ?? {},
    })
  }
  return cloneFrozen({ grant: value, consumptions: {} })
}

type PolicyValue =
  | ToolProfile
  | PermissionProfile
  | ModelCapabilityProfile
  | VerifierProfile
  | ResourceBudgetPolicy

interface StoredPolicy<T extends PolicyValue = PolicyValue> {
  readonly id: string
  readonly revision: number
  readonly value: T
}

/** Durable immutable Policy registry. Registration remains synchronous for startup seeding. */
export class SqliteMilitaryPolicyRegistry implements MilitaryPolicyRegistry {
  readonly #records: SqliteStateRecords
  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  registerTool(profile: ToolProfile): void {
    this.#register('tool', profile.toolProfileId, Number(profile.revision), profile)
  }

  registerPermission(profile: PermissionProfile): void {
    this.#register('permission', profile.permissionProfileId, Number(profile.revision), profile)
  }

  registerModel(profile: ModelCapabilityProfile): void {
    this.#register('model', `${profile.provider}\u0000${profile.model}`, Number(profile.revision), profile)
  }

  registerVerifier(profile: VerifierProfile): void {
    this.#register('verifier', profile.verifierProfileId, Number(profile.revision), profile)
  }

  registerBudget(profile: ResourceBudgetPolicy): void {
    this.#register('budget', profile.policyId, Number(profile.revision), profile)
  }

  async toolProfile(id: string, revision?: number): Promise<ToolProfile> {
    return this.#get<ToolProfile>('tool', id, revision)
  }

  async permissionProfile(id: string, revision?: number): Promise<PermissionProfile> {
    return this.#get<PermissionProfile>('permission', id, revision)
  }

  async modelCapability(
    provider: string,
    model: string,
    revision?: number,
  ): Promise<ModelCapabilityProfile> {
    return this.#get<ModelCapabilityProfile>(
      'model',
      `${provider}\u0000${model}`,
      revision,
    )
  }

  async verifierProfile(id: string, revision?: number): Promise<VerifierProfile> {
    return this.#get<VerifierProfile>('verifier', id, revision)
  }

  async resourceBudgetPolicy(id: string, revision?: number): Promise<ResourceBudgetPolicy> {
    return this.#get<ResourceBudgetPolicy>('budget', id, revision)
  }

  #register<T extends PolicyValue>(kind: string, id: string, revision: number, value: T): void {
    this.#records.putSync<StoredPolicy<T>>(
      `policy:${kind}`,
      `${id}\u0000${revision}`,
      { id, revision, value: cloneFrozen(value) },
      { createOnly: true },
    )
  }

  #get<T extends PolicyValue>(kind: string, id: string, revision?: number): T {
    const values = this.#records.listSync<StoredPolicy<T>>(`policy:${kind}`)
      .filter(item => item.id === id)
      .sort((left, right) => left.revision - right.revision)
    if (values.length === 0) throw new MilitaryError('NOT_FOUND', `unknown policy ${id}`)
    const found = revision === undefined
      ? values.at(-1)
      : values.find(item => item.revision === Number(revision))
    if (found === undefined) throw new MilitaryError('NOT_FOUND', `unknown policy revision ${id}@${String(revision)}`)
    return cloneFrozen(found.value)
  }
}

interface TemplateState {
  readonly versions: AgentTemplateProfile[]
}

/** Durable versioned department template provider. */
export class SqliteAgentTemplateRegistry implements MilitaryAgentTemplates {
  readonly #database: SqliteMilitaryDatabase
  readonly #records: SqliteStateRecords
  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#database = database
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  async list(options?: {
    readonly department?: string
    readonly role?: string
    readonly includeInactive?: boolean
  }): Promise<readonly AgentTemplateProfile[]> {
    return cloneFrozen(this.#records.listSync<TemplateState>('agent-template')
      .flatMap(state => state.versions)
      .filter(profile => options?.department === undefined || profile.department === options.department)
      .filter(profile => options?.role === undefined || profile.role === options.role)
      .filter(profile => options?.includeInactive === true || profile.status === 'ACTIVE' || profile.status === 'CANARY')
      .sort((left, right) => String(left.templateId).localeCompare(String(right.templateId))
        || Number(left.revision) - Number(right.revision)))
  }

  async get(templateId: AgentTemplateId, revision?: Revision): Promise<AgentTemplateProfile> {
    const state = await this.#records.read<TemplateState>('agent-template', String(templateId))
    if (state === null || state.versions.length === 0) {
      throw new MilitaryError('NOT_FOUND', `unknown template ${String(templateId)}`)
    }
    const value = revision === undefined
      ? state.versions.at(-1)
      : state.versions.find(profile => Number(profile.revision) === Number(revision))
    if (value === undefined) {
      throw new MilitaryError('NOT_FOUND', `unknown template revision ${String(templateId)}@${Number(revision)}`)
    }
    return cloneFrozen(value)
  }

  async create(profile: AgentTemplateProfile): Promise<void> {
    validateTemplate(profile)
    await this.#records.update<TemplateState | null, null>(
      'agent-template',
      String(profile.templateId),
      () => null,
      current => {
        if (current !== null) throw new MilitaryError('REVISION_CONFLICT', `template ${String(profile.templateId)} already exists`)
        return { next: { versions: [cloneFrozen(profile)] }, result: null }
      },
    )
  }

  async revise(profile: AgentTemplateProfile, expectedRevision: Revision): Promise<void> {
    validateTemplate(profile)
    this.#reviseSync(profile, expectedRevision)
  }

  #reviseSync(
    profile: AgentTemplateProfile,
    expectedRevision: Revision,
  ): void {
    this.#records.updateSync<TemplateState | null, null>(
      'agent-template',
      String(profile.templateId),
      () => null,
      current => {
        if (current === null) throw new MilitaryError('NOT_FOUND')
        const latest = current.versions.at(-1)
        if (latest === undefined || Number(latest.revision) !== Number(expectedRevision)
          || Number(profile.revision) !== Number(expectedRevision) + 1) {
          throw new MilitaryError('REVISION_CONFLICT', 'new template revision must increment by exactly one')
        }
        return {
          next: { versions: [...current.versions, cloneFrozen(profile)] },
          result: null,
        }
      },
    )
  }

  async reviseBatch(
    revisions: readonly {
      readonly profile: AgentTemplateProfile
      readonly expectedRevision: Revision
    }[],
  ): Promise<void> {
    const seen = new Set<string>()
    for (const change of revisions) {
      validateTemplate(change.profile)
      const id = String(change.profile.templateId)
      if (seen.has(id)) throw new MilitaryError('INVALID_ARGUMENT', `duplicate template ${id}`)
      seen.add(id)
      const current = await this.get(change.profile.templateId)
      if (Number(current.revision) !== Number(change.expectedRevision)
        || Number(change.profile.revision) !== Number(change.expectedRevision) + 1) {
        throw new MilitaryError('REVISION_CONFLICT')
      }
    }
    this.#database.transaction(() => {
      for (const change of revisions) {
        this.#reviseSync(change.profile, change.expectedRevision)
      }
    })
  }

  async setStatus(templateId: AgentTemplateId, status: AgentTemplateProfile['status']): Promise<void> {
    await this.#records.update<TemplateState | null, null>(
      'agent-template',
      String(templateId),
      () => null,
      current => {
        if (current === null || current.versions.length === 0) throw new MilitaryError('NOT_FOUND')
        const versions = [...current.versions]
        versions[versions.length - 1] = cloneFrozen({ ...versions[versions.length - 1]!, status })
        return { next: { versions }, result: null }
      },
    )
  }

  async resolveForInstantiation(templateId: AgentTemplateId): Promise<AgentTemplateProfile> {
    const profile = await this.get(templateId)
    if (profile.status !== 'ACTIVE' && profile.status !== 'CANARY') {
      throw new MilitaryError('AGENT_TEMPLATE_INACTIVE', `template ${String(templateId)} is ${profile.status}`)
    }
    validateTemplate(profile)
    return profile
  }
}

interface AuthorizationState {
  contexts: Record<string, MilitaryAuthorityContext>
  receipts: Record<string, UserAuthorizationReceipt & { revoked?: string }>
}

const emptyAuthorization = (): AuthorizationState => ({ contexts: {}, receipts: {} })

/** Durable authority context and explicit authorization receipt provider. */
export class SqliteMilitaryAuthorization implements MilitaryAuthorization {
  readonly #records: SqliteStateRecords
  constructor(database: SqliteMilitaryDatabase, tenantId: string) {
    this.#records = new SqliteStateRecords(database, tenantId)
  }

  seedContext(context: MilitaryAuthorityContext): void {
    // A seed is replayed during application composition. The persisted
    // snapshot is frozen at the repository boundary, so startup must detach it
    // before updating the well-known authority context.
    const state = structuredClone(
      this.#records.readSync<AuthorizationState>('authorization', 'state') ?? emptyAuthorization(),
    )
    state.contexts[authorityKey(context.principalId, context.tenantId)] = cloneFrozen(context)
    this.#records.putSync('authorization', 'state', state)
  }

  async registerContext(context: MilitaryAuthorityContext): Promise<void> {
    await this.#records.update<AuthorizationState, null>(
      'authorization',
      'state',
      emptyAuthorization,
      state => {
        state.contexts[authorityKey(context.principalId, context.tenantId)] = cloneFrozen(context)
        return { next: state, result: null }
      },
    )
  }

  async resolve(principalId: string, tenantId: string): Promise<MilitaryAuthorityContext> {
    const state = await this.#state()
    const context = state.contexts[authorityKey(principalId, tenantId)]
    if (context === undefined || isExpired(context.expiresAt)) {
      throw new MilitaryError('UNAUTHORIZED', 'no active authority context', { principalId, tenantId })
    }
    return cloneFrozen(context)
  }

  async grant(receipt: UserAuthorizationReceipt): Promise<void> {
    if (isExpired(receipt.expiresAt)) throw new MilitaryError('UNAUTHORIZED', 'authorization receipt is already expired')
    await this.#records.update<AuthorizationState, null>(
      'authorization',
      'state',
      emptyAuthorization,
      state => {
        const existing = state.receipts[receipt.authorizationId]
        if (existing !== undefined) {
          if (existing.contentHash !== receipt.contentHash) throw new MilitaryError('IDEMPOTENCY_CONFLICT')
          return { next: state, result: null }
        }
        state.receipts[receipt.authorizationId] = cloneFrozen(receipt)
        return { next: state, result: null }
      },
    )
  }

  async revoke(authorizationId: string, reason: string): Promise<void> {
    await this.#records.update<AuthorizationState, null>(
      'authorization',
      'state',
      emptyAuthorization,
      state => {
        const receipt = state.receipts[authorizationId]
        if (receipt === undefined) throw new MilitaryError('NOT_FOUND', `unknown authorization ${authorizationId}`)
        if (!receipt.revocable) throw new MilitaryError('POLICY_DENIED', 'authorization is not revocable')
        state.receipts[authorizationId] = cloneFrozen({ ...receipt, revoked: reason })
        return { next: state, result: null }
      },
    )
  }

  async authorize(input: {
    readonly context: MilitaryAuthorityContext
    readonly action: string
    readonly resource: string
    readonly classification: DataClassification
  }): Promise<{ readonly allowed: boolean; readonly receiptRef?: string; readonly reason?: string }> {
    if (isExpired(input.context.expiresAt)) return { allowed: false, reason: 'authority context expired' }
    if (classificationRank[input.classification] > classificationRank[input.context.dataClassificationCeiling]) {
      return { allowed: false, reason: 'classification ceiling exceeded' }
    }
    const scopeAllowed = input.context.scopes.some(scope => matches(scope, `${input.action}:${input.resource}`)
      || matches(scope, input.action)
      || matches(scope, input.resource))
    if (scopeAllowed) return { allowed: true }
    const state = await this.#state()
    for (const ref of input.context.authorizationReceiptRefs) {
      const receipt = state.receipts[ref]
      if (receipt === undefined || receipt.revoked !== undefined || isExpired(receipt.expiresAt)) continue
      if (receipt.principalId !== input.context.principalId || receipt.tenantId !== input.context.tenantId) continue
      if (matches(receipt.action, input.action) && matches(receipt.resource, input.resource)) {
        return { allowed: true, receiptRef: receipt.authorizationId }
      }
    }
    return { allowed: false, reason: 'no matching scope or authorization receipt' }
  }

  async #state(): Promise<AuthorizationState> {
    return await this.#records.read<AuthorizationState>('authorization', 'state') ?? emptyAuthorization()
  }
}

const classificationRank: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
}

function authorityKey(principalId: string, tenantId: string): string {
  return `${tenantId}\u0000${principalId}`
}

function matches(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true
  return pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))
}

function validateTemplate(profile: AgentTemplateProfile): void {
  if (profile.modelPolicy.reasoningEffort === undefined) throw new MilitaryError('CONTEXT_POLICY_INVALID')
  const context = profile.contextPolicy
  if (!Number.isSafeInteger(context.contextBudgetTokens) || context.contextBudgetTokens < 4096) {
    throw new MilitaryError('CONTEXT_POLICY_INVALID')
  }
  if (!Number.isSafeInteger(context.compactionTriggerPercent)
    || context.compactionTriggerPercent < 50 || context.compactionTriggerPercent > 99) {
    throw new MilitaryError('CONTEXT_POLICY_INVALID')
  }
  if (context.retainedTailTokens < 0 || context.retainedTailTokens >= context.contextBudgetTokens) {
    throw new MilitaryError('CONTEXT_POLICY_INVALID')
  }
  if (profile.concurrencyLimit < 1 || !Number.isSafeInteger(profile.concurrencyLimit)) {
    throw new MilitaryError('INVALID_ARGUMENT')
  }
}
