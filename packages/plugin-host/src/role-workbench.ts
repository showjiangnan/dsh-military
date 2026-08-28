import {
  GENERAL_ROLE_ID,
  MILITARY_CONTROL_SCHEMA_VERSION,
  MilitaryError,
  compileEffectivePrompt,
  diffPrompt,
  flashReadiness,
  resolveDepartmentRolePrompt,
  resolveGeneralRolePrompt,
  validateRolePrompt,
  type AgentTemplateProfile,
  type FlashReadinessReport,
  type MilitaryModelValidationStatus,
  type PortableRoleConfiguration,
  type RoleConfigurationRevision,
  type RoleDraft,
  type SimplifiedChineseReviewReceipt,
  type RoleWorkbenchDocument,
  type ToolSchemaSummary,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import {
  defaultTemplateAtRevision,
  defaultGeneralPolicy,
  defaultFlashModelRevision,
  defaultTemplates,
  defaultToolProfileRevision,
} from './defaults.js'
import { redactDiagnosticText } from './session-diagnostics.js'

export const ROLE_WORKBENCH_NAMESPACE = 'military-role-workbench'
export const ROLE_WORKBENCH_APPLICATION_NAMESPACE =
  'military-role-workbench-application'
export const ROLE_WORKBENCH_HISTORY_LIMIT = 480

export interface LegacyGeneralRoleSettings {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: 'high' | 'max'
  readonly maxOutputTokens: number
  readonly generalPromptOverride: string
}

export function initialRoleWorkbenchDocument(
  general: LegacyGeneralRoleSettings,
  templates: readonly AgentTemplateProfile[],
): RoleWorkbenchDocument {
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision: 1,
    roles: [
      generalRoleConfiguration(general),
      ...templates.map(template => templateRoleConfiguration(template)),
    ],
    history: [],
    // Stable base bytes keep release/Profile generation reproducible. The first
    // user mutation records its real timestamp and increments the revision.
    updatedAt: '2026-08-26T00:00:00.000Z',
  }
}

export function generalRoleConfiguration(
  value: LegacyGeneralRoleSettings,
): PortableRoleConfiguration {
  return {
    roleId: GENERAL_ROLE_ID,
    displayName: 'General 总指挥',
    department: 'command',
    role: 'general',
    status: 'ACTIVE',
    provider: normalizedIdentifier(value.provider, 'General provider'),
    model: normalizedIdentifier(value.model, 'General model'),
    reasoningEffort: value.reasoningEffort,
    maxOutputTokens: boundedInteger(value.maxOutputTokens, 1_024, 256_000, 'General maxOutputTokens'),
    contextBudgetTokens: defaultGeneralPolicy.contextPolicy.contextBudgetTokens,
    concurrencyLimit: 1,
    promptOverride: normalizedPromptOverride(value.generalPromptOverride, 'General 角色提示词'),
    templateRevision: 0,
    toolProfileId: 'general-tools',
    toolProfileRevision: Number(defaultToolProfileRevision),
    permissionProfileId: 'general-host-authority',
    permissionProfileRevision: 0,
    modelCapabilityProfileId: modelProfileId(value.provider, value.model),
    modelCapabilityProfileRevision:
      value.provider === 'deepseek-official'
        && value.model === 'deepseek-v4-flash'
        ? Number(defaultFlashModelRevision)
        : 1,
    allowCanaryModel: value.model === 'deepseek-v4-flash',
  }
}

export function templateRoleConfiguration(
  profile: AgentTemplateProfile,
): PortableRoleConfiguration {
  return {
    roleId: String(profile.templateId),
    displayName: profile.displayName,
    department: profile.department,
    role: profile.role,
    status: profile.status,
    provider: profile.modelPolicy.provider,
    model: profile.modelPolicy.model,
    reasoningEffort: reasoning(profile.modelPolicy.reasoningEffort),
    maxOutputTokens: profile.modelPolicy.maxOutputTokens,
    contextBudgetTokens: profile.contextPolicy.contextBudgetTokens,
    concurrencyLimit: profile.concurrencyLimit,
    promptOverride: profile.rolePromptOverride?.trim() ?? '',
    templateRevision: Number(profile.revision),
    toolProfileId: profile.capabilities.toolProfileId,
    toolProfileRevision: Number(profile.capabilities.toolProfileRevision),
    permissionProfileId: profile.capabilities.permissionProfileId,
    permissionProfileRevision: Number(profile.capabilities.permissionProfileRevision),
    modelCapabilityProfileId: profile.modelPolicy.modelCapabilityProfileId,
    ...(profile.modelPolicy.modelCapabilityProfileRevision === undefined
      ? {}
      : {
          modelCapabilityProfileRevision: Number(
            profile.modelPolicy.modelCapabilityProfileRevision,
          ),
        }),
    allowCanaryModel: profile.modelPolicy.allowCanaryModel === true,
  }
}

export interface RoleWorkbenchRebaseResult {
  readonly document: RoleWorkbenchDocument
  readonly changedRoleIds: readonly string[]
  readonly customizedRoleIds: readonly string[]
}

/**
 * Reconcile a persisted Desired document with immutable runtime template
 * history without resetting user-owned fields.
 *
 * A stale configuration must first match the exact runtime revision it claims
 * to represent. Package-owned fields then come from the current template,
 * while deltas relative to the original bundled/user-history baseline are
 * replayed as one new immutable revision only when the current runtime has not
 * already preserved them.
 */
export async function rebaseRoleWorkbenchForRuntime(
  host: MilitaryHostRuntime,
  document: RoleWorkbenchDocument,
  createdAt = new Date().toISOString(),
): Promise<RoleWorkbenchRebaseResult> {
  const changes: Array<{
    readonly previous: PortableRoleConfiguration
    readonly next: PortableRoleConfiguration
    readonly customized: boolean
  }> = []
  for (const configuration of document.roles) {
    if (configuration.roleId === GENERAL_ROLE_ID) continue
    const templateId = configuration.roleId as AgentTemplateProfile['templateId']
    const current = await host.application.templates.get(templateId)
    if (configuration.templateRevision >= Number(current.revision)) continue
    let exact: AgentTemplateProfile
    try {
      exact = await host.application.templates.get(
        templateId,
        configuration.templateRevision as AgentTemplateProfile['revision'],
      )
    } catch (error) {
      throw new TypeError(
        `cannot rebase workbench template ${configuration.roleId}`
        + `@${configuration.templateRevision}: immutable runtime baseline is missing`,
        { cause: error },
      )
    }
    if (!configurationMatchesTemplate(configuration, exact)) {
      throw new TypeError(
        `cannot rebase workbench template ${configuration.roleId}`
        + `@${configuration.templateRevision}: Desired settings do not match`
        + ' the immutable runtime baseline',
      )
    }
    const intent = roleMigrationIntent(document, configuration, current)
    const replayed = replayRoleUserFields(intent, current)
    const customized = roleIntentIsCustomized(intent)
    const next = configurationMatchesTemplate(replayed, current)
      ? templateRoleConfiguration(current)
      : {
          ...replayed,
          templateRevision: Number(current.revision) + 1,
        }
    changes.push({ previous: configuration, next, customized })
  }
  if (changes.length === 0) {
    return {
      document,
      changedRoleIds: [],
      customizedRoleIds: [],
    }
  }

  const workbenchRevision = document.revision + 1
  const changedByRole = new Map(
    changes.map(change => [change.previous.roleId, change] as const),
  )
  const migrationHistory = changes.map(change =>
    roleMigrationHistory(
      document,
      change.previous,
      change.next,
      change.customized,
      workbenchRevision,
      createdAt,
    ))
  const rebased: RoleWorkbenchDocument = {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision: workbenchRevision,
    roles: document.roles.map(configuration =>
      changedByRole.get(configuration.roleId)?.next ?? configuration),
    history: [...document.history, ...migrationHistory]
      .slice(-ROLE_WORKBENCH_HISTORY_LIMIT),
    updatedAt: createdAt,
  }
  return {
    document: rebased,
    changedRoleIds: changes.map(change => change.previous.roleId),
    customizedRoleIds: changes
      .filter(change => change.customized)
      .map(change => change.previous.roleId),
  }
}

/** Return one current runtime head per non-General Workbench role, in UI order. */
export async function runtimeTemplateHeadsForWorkbench(
  host: MilitaryHostRuntime,
  document: RoleWorkbenchDocument,
): Promise<readonly AgentTemplateProfile[]> {
  return await Promise.all(
    document.roles
      .filter(configuration => configuration.roleId !== GENERAL_ROLE_ID)
      .map(async configuration =>
        await host.application.templates.get(
          configuration.roleId as AgentTemplateProfile['templateId'],
        )),
  )
}

export function parseRoleWorkbenchDocument(source: unknown): RoleWorkbenchDocument {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('Military role workbench stateJson must be a non-empty string')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new TypeError('Military role workbench stateJson must be valid JSON')
  }
  if (!isRecord(parsed)) throw new TypeError('Military role workbench document must be an object')
  if (parsed.schemaVersion !== MILITARY_CONTROL_SCHEMA_VERSION) {
    throw new TypeError(`unsupported Military role workbench schema ${String(parsed.schemaVersion)}`)
  }
  const revision = boundedInteger(parsed.revision, 1, Number.MAX_SAFE_INTEGER, 'workbench revision')
  const roles = requireArray(parsed.roles, 'workbench roles').map((value, index) =>
    parseRoleConfiguration(value, `workbench roles[${index}]`))
  const roleIds = roles.map(value => value.roleId)
  assertUnique(roleIds, 'workbench roleId')
  if (!roleIds.includes(GENERAL_ROLE_ID)) throw new TypeError('workbench roles must include General')
  const expectedRoleIds = new Set(defaultTemplates().map(value => String(value.templateId)))
  for (const roleId of expectedRoleIds) {
    if (!roleIds.includes(roleId)) throw new TypeError(`workbench roles must include ${roleId}`)
  }
  if (roles.length !== expectedRoleIds.size + 1) {
    throw new TypeError('workbench cannot add unknown roles through portable settings')
  }
  const history = requireArray(parsed.history, 'workbench history')
  if (history.length > ROLE_WORKBENCH_HISTORY_LIMIT) {
    throw new TypeError(`workbench history cannot exceed ${ROLE_WORKBENCH_HISTORY_LIMIT} entries`)
  }
  const revisions = history.map((value, index) =>
    parseHistoryRevision(value, `workbench history[${index}]`, roleIds))
  const updatedAt = isoDate(parsed.updatedAt, 'workbench updatedAt')
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision,
    roles,
    history: revisions,
    updatedAt,
  }
}

export function serializeRoleWorkbenchDocument(document: RoleWorkbenchDocument): string {
  // Round-trip through the strict parser so Host settings validation and RPC
  // mutations cannot diverge.
  const source = JSON.stringify(document)
  void parseRoleWorkbenchDocument(source)
  return JSON.stringify(document, null, 2)
}

export function effectiveRolePrompt(configuration: PortableRoleConfiguration): string {
  if (configuration.roleId === GENERAL_ROLE_ID) {
    return resolveGeneralRolePrompt(configuration.promptOverride)
  }
  const bundled = bundledRolePrompt(configuration.roleId)
  return configuration.promptOverride.trim() === ''
    ? bundled
    : validateRolePrompt(configuration.promptOverride, `${configuration.displayName} 角色提示词`)
}

export function bundledRolePrompt(roleId: string): string {
  if (roleId === GENERAL_ROLE_ID) return resolveGeneralRolePrompt('')
  const template = defaultTemplates().find(value => String(value.templateId) === roleId)
  if (template === undefined) throw new TypeError(`unknown bundled Military role ${roleId}`)
  return resolveDepartmentRolePrompt(template)
}

export function bundledRoleConfiguration(roleId: string): PortableRoleConfiguration {
  if (roleId === GENERAL_ROLE_ID) {
    return generalRoleConfiguration({
      provider: defaultGeneralPolicy.defaultModel.provider,
      model: defaultGeneralPolicy.defaultModel.model,
      reasoningEffort: defaultGeneralPolicy.defaultModel.reasoningEffort,
      maxOutputTokens: defaultGeneralPolicy.defaultModel.maxOutputTokens,
      generalPromptOverride: '',
    })
  }
  const template = defaultTemplates().find(value => String(value.templateId) === roleId)
  if (template === undefined) throw new TypeError(`unknown bundled Military role ${roleId}`)
  return templateRoleConfiguration(template)
}

export function draftForRole(configuration: PortableRoleConfiguration): RoleDraft {
  return {
    roleId: configuration.roleId,
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    maxOutputTokens: configuration.maxOutputTokens,
    contextBudgetTokens: configuration.contextBudgetTokens,
    concurrencyLimit: configuration.concurrencyLimit,
    prompt: effectiveRolePrompt(configuration),
  }
}

export function applyRoleDraft(input: {
  readonly document: RoleWorkbenchDocument
  readonly draft: RoleDraft
  readonly source: Exclude<RoleConfigurationRevision['source'], 'BUNDLED'>
  readonly actor?: RoleConfigurationRevision['actor']
  readonly toolSchemas: readonly ToolSchemaSummary[]
  readonly modelStatus: MilitaryModelValidationStatus
  /** Production callers pass the exact live-catalog profile; optional only for legacy API replay. */
  readonly modelCapabilityProfileId?: string
  readonly modelCapabilityProfileRevision?: number
  readonly createdAt?: string
  readonly rollbackOfRevision?: number
  readonly simplifiedChineseReview?: SimplifiedChineseReviewReceipt
}): RoleWorkbenchDocument {
  const createdAt = input.createdAt ?? new Date().toISOString()
  const current = input.document.roles.find(value => value.roleId === input.draft.roleId)
  if (current === undefined) throw new TypeError(`unknown Military role ${input.draft.roleId}`)
  const prompt = validateRolePrompt(input.draft.prompt, `${current.displayName} 角色提示词`)
  const bundled = bundledRolePrompt(current.roleId)
  const promptOverride = prompt === bundled ? '' : prompt
  const nextConfiguration: PortableRoleConfiguration = {
    ...current,
    provider: normalizedIdentifier(input.draft.provider, `${current.displayName} provider`),
    model: normalizedIdentifier(input.draft.model, `${current.displayName} model`),
    reasoningEffort: reasoning(input.draft.reasoningEffort),
    maxOutputTokens: boundedInteger(
      input.draft.maxOutputTokens,
      1_024,
      256_000,
      `${current.displayName} maxOutputTokens`,
    ),
    contextBudgetTokens: boundedInteger(
      input.draft.contextBudgetTokens,
      4_096,
      1_000_000,
      `${current.displayName} contextBudgetTokens`,
    ),
    concurrencyLimit: current.roleId === GENERAL_ROLE_ID
      ? 1
      : boundedInteger(
          input.draft.concurrencyLimit,
          1,
          64,
          `${current.displayName} concurrencyLimit`,
        ),
    promptOverride,
    templateRevision: current.roleId === GENERAL_ROLE_ID
      ? 0
      : current.templateRevision + 1,
    modelCapabilityProfileId: normalizedIdentifier(
      input.modelCapabilityProfileId
        ?? modelProfileId(input.draft.provider, input.draft.model),
      `${current.displayName} model capability profile`,
    ),
    ...(input.modelCapabilityProfileRevision === undefined
      ? {}
      : {
          modelCapabilityProfileRevision: boundedInteger(
            input.modelCapabilityProfileRevision,
            1,
            Number.MAX_SAFE_INTEGER,
            `${current.displayName} model capability revision`,
          ),
        }),
    allowCanaryModel: input.modelStatus === 'CANARY',
  }
  const readiness = readinessForConfiguration(
    nextConfiguration,
    input.toolSchemas,
    input.modelStatus,
    createdAt,
  )
  if (readiness.disposition === 'BLOCKED') {
    const errors = readiness.issues
      .filter(value => value.severity === 'ERROR')
      .map(value => `${value.code}: ${value.message}`)
    throw new TypeError(`Flash 就绪检查未通过：${errors.join('；')}`)
  }
  const workbenchRevision = input.document.revision + 1
  const roleHistory = input.document.history.filter(value => value.roleId === current.roleId)
  const revision = (roleHistory.reduce((maximum, value) => Math.max(maximum, value.revision), 0) + 1)
  const history: RoleConfigurationRevision = {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision,
    workbenchRevision,
    roleId: current.roleId,
    source: input.source,
    createdAt,
    configuration: nextConfiguration,
    previousConfiguration: current,
    promptDiff: diffPrompt(effectiveRolePrompt(current), prompt),
    readiness: {
      disposition: readiness.disposition,
      score: readiness.score,
      errorCount: readiness.errorCount,
      warningCount: readiness.warningCount,
    },
    readinessReport: readiness,
    actor: input.actor ?? 'plugin-migration',
    ...(input.simplifiedChineseReview === undefined
      ? {}
      : { simplifiedChineseReview: input.simplifiedChineseReview }),
    ...(input.rollbackOfRevision === undefined
      ? {}
      : { rollbackOfRevision: input.rollbackOfRevision }),
  }
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision: workbenchRevision,
    roles: input.document.roles.map(value =>
      value.roleId === current.roleId ? nextConfiguration : value),
    history: [...input.document.history, history].slice(-ROLE_WORKBENCH_HISTORY_LIMIT),
    updatedAt: createdAt,
  }
}

export function readinessForConfiguration(
  configuration: PortableRoleConfiguration,
  toolSchemas: readonly ToolSchemaSummary[],
  modelStatus: MilitaryModelValidationStatus,
  checkedAt?: string,
): FlashReadinessReport {
  return flashReadiness({
    roleId: configuration.roleId,
    prompt: effectiveRolePrompt(configuration),
    modelStatus,
    toolSchemas,
    maxOutputTokens: configuration.maxOutputTokens,
    contextBudgetTokens: configuration.contextBudgetTokens,
  }, checkedAt)
}

export function previewForConfiguration(
  configuration: PortableRoleConfiguration,
  toolNames: readonly string[],
) {
  return compileEffectivePrompt({
    roleId: configuration.roleId,
    rolePrompt: effectiveRolePrompt(configuration),
    displayName: configuration.displayName,
    templateRevision: configuration.templateRevision,
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    maxOutputTokens: configuration.maxOutputTokens,
    contextBudgetTokens: configuration.contextBudgetTokens,
    toolNames,
    permissionProfileId: configuration.permissionProfileId,
  })
}

const roleWorkbenchSynchronizationTails = new WeakMap<
  MilitaryHostRuntime,
  Promise<void>
>()
const roleWorkbenchReadinessTails = new WeakMap<
  MilitaryHostRuntime,
  Promise<void>
>()

export interface RoleWorkbenchApplicationState {
  readonly desiredRevision: number
  readonly appliedRevision: number
  readonly state: 'PENDING' | 'APPLYING' | 'APPLIED' | 'FAILED'
  readonly attempts: number
  readonly updatedAt: string
  readonly appliedAt?: string
  readonly error?: string
}

export function roleWorkbenchApplicationState(
  host: MilitaryHostRuntime,
  desiredRevision: number,
): RoleWorkbenchApplicationState {
  const records = new SqliteStateRecords(host.database, host.tenantId)
  return records.readSync<RoleWorkbenchApplicationState>(
    ROLE_WORKBENCH_APPLICATION_NAMESPACE,
    'singleton',
  ) ?? {
    desiredRevision,
    appliedRevision: 0,
    state: 'PENDING',
    attempts: 0,
    updatedAt: '2026-08-26T00:00:00.000Z',
  }
}

/**
 * The Desired document may be durable while runtime reconciliation is still
 * applying or has failed. Operational model/tool/child boundaries must stop
 * there so a partially projected revision can never execute.
 */
export async function requireRoleWorkbenchApplied(
  host: MilitaryHostRuntime,
): Promise<void> {
  // Settings registration performs catalog discovery before the Desired
  // document can be applied. The readiness tail is installed synchronously,
  // so the first model/tool/spawn request cannot race that startup work.
  await roleWorkbenchReadinessTails.get(host)?.catch(() => undefined)
  await roleWorkbenchSynchronizationTails.get(host)?.catch(() => undefined)
  const state = new SqliteStateRecords(
    host.database,
    host.tenantId,
  ).readSync<RoleWorkbenchApplicationState>(
    ROLE_WORKBENCH_APPLICATION_NAMESPACE,
    'singleton',
  )
  // No row is the pre-migration/default state. Startup synchronization creates
  // the row before applying any user Desired revision.
  if (state === null) return
  if (
    state.state !== 'APPLIED'
    || state.desiredRevision !== state.appliedRevision
  ) {
    throw new MilitaryError(
      'RESOURCE_LOCKED',
      `Military role settings ${state.state}; Desired ${state.desiredRevision}, Applied ${state.appliedRevision}`,
      {
        desiredRevision: state.desiredRevision,
        appliedRevision: state.appliedRevision,
        reconciliationState: state.state,
      },
    )
  }
}

/**
 * Serialize the complete Settings -> catalog -> runtime reconciliation path.
 * The wrapper records the promise before its first asynchronous operation and
 * therefore also acts as the startup readiness barrier used by execution
 * boundaries.
 */
export function synchronizeRoleWorkbenchReadiness(
  host: MilitaryHostRuntime,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = roleWorkbenchReadinessTails.get(host)
    ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(operation)
  roleWorkbenchReadinessTails.set(host, current)
  return current.finally(() => {
    if (roleWorkbenchReadinessTails.get(host) === current) {
      roleWorkbenchReadinessTails.delete(host)
    }
  })
}

/**
 * Apply one persisted workbench to the exact runtime services that execute it.
 * Settings watchers and the save RPC can observe the same commit concurrently;
 * serialize them per Host so one immutable template revision is never applied
 * twice and a successful save cannot be reported as a revision conflict.
 */
export function synchronizeRoleWorkbench(
  host: MilitaryHostRuntime,
  document: RoleWorkbenchDocument,
  options?: {
    readonly afterRuntimeApplied?: () => Promise<void>
  },
): Promise<void> {
  const previous = roleWorkbenchSynchronizationTails.get(host)
    ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const records = new SqliteStateRecords(host.database, host.tenantId)
      const prior = roleWorkbenchApplicationState(host, document.revision)
      if (
        prior.state === 'APPLIED'
        && prior.appliedRevision === document.revision
      ) {
        try {
          await options?.afterRuntimeApplied?.()
        } catch (error) {
          const failedAt = new Date().toISOString()
          host.database.transaction(() => {
            records.putSync<RoleWorkbenchApplicationState>(
              ROLE_WORKBENCH_APPLICATION_NAMESPACE,
              'singleton',
              {
                desiredRevision: document.revision,
                appliedRevision: prior.appliedRevision,
                state: 'FAILED',
                attempts: prior.attempts + 1,
                updatedAt: failedAt,
                error: boundedApplicationError(error),
              },
            )
          })
          throw error
        }
        return
      }
      const startedAt = new Date().toISOString()
      host.database.transaction(() => {
        records.putSync<RoleWorkbenchApplicationState>(
          ROLE_WORKBENCH_APPLICATION_NAMESPACE,
          'singleton',
          {
            desiredRevision: document.revision,
            appliedRevision: prior.appliedRevision,
            state: 'APPLYING',
            attempts: prior.attempts + 1,
            updatedAt: startedAt,
          },
        )
      })
      try {
        await applyRoleWorkbench(host, document)
        await options?.afterRuntimeApplied?.()
        const appliedAt = new Date().toISOString()
        host.database.transaction(() => {
          records.putSync<RoleWorkbenchApplicationState>(
            ROLE_WORKBENCH_APPLICATION_NAMESPACE,
            'singleton',
            {
              desiredRevision: document.revision,
              appliedRevision: document.revision,
              state: 'APPLIED',
              attempts: prior.attempts + 1,
              updatedAt: appliedAt,
              appliedAt,
            },
          )
        })
      } catch (error) {
        const failedAt = new Date().toISOString()
        host.database.transaction(() => {
          records.putSync<RoleWorkbenchApplicationState>(
            ROLE_WORKBENCH_APPLICATION_NAMESPACE,
            'singleton',
            {
              desiredRevision: document.revision,
              appliedRevision: prior.appliedRevision,
              state: 'FAILED',
              attempts: prior.attempts + 1,
              updatedAt: failedAt,
              error: boundedApplicationError(error),
            },
          )
        })
        throw error
      }
    })
  roleWorkbenchSynchronizationTails.set(host, current)
  return current.finally(() => {
    if (roleWorkbenchSynchronizationTails.get(host) === current) {
      roleWorkbenchSynchronizationTails.delete(host)
    }
  })
}

async function applyRoleWorkbench(
  host: MilitaryHostRuntime,
  document: RoleWorkbenchDocument,
): Promise<void> {
  const general = document.roles.find(value => value.roleId === GENERAL_ROLE_ID)
  if (general === undefined) throw new TypeError('Military workbench has no General role')
  const exactGeneralCapability = await host.application.policies.modelCapability(
    general.provider,
    general.model,
    general.modelCapabilityProfileRevision,
  )
  if (exactGeneralCapability.profileId !== general.modelCapabilityProfileId) {
    throw new TypeError(
      `General.modelCapabilityProfileId expected ${exactGeneralCapability.profileId}, received ${general.modelCapabilityProfileId}`,
    )
  }
  if (general.modelCapabilityProfileRevision !== undefined
    && Number(exactGeneralCapability.revision)
      !== general.modelCapabilityProfileRevision) {
    throw new TypeError(
      `General.modelCapabilityProfileRevision expected ${Number(exactGeneralCapability.revision)}, received ${general.modelCapabilityProfileRevision}`,
    )
  }
  const pending: Array<{
    readonly profile: AgentTemplateProfile
    readonly expectedRevision: AgentTemplateProfile['revision']
  }> = []
  for (const configuration of document.roles) {
    if (configuration.roleId === GENERAL_ROLE_ID) continue
    const current = await host.application.templates.get(
      configuration.roleId as AgentTemplateProfile['templateId'],
    )
    if (configuration.templateRevision < Number(current.revision)) {
      // A stale settings document cannot roll the live immutable registry back.
      throw new TypeError(
        `workbench template ${configuration.roleId}@${configuration.templateRevision} is behind runtime @${Number(current.revision)}`,
      )
    }
    if (configuration.templateRevision === Number(current.revision)) {
      if (!configurationMatchesTemplate(configuration, current)) {
        throw new TypeError(
          `${configuration.roleId}@${configuration.templateRevision} does not match the applied immutable template`,
        )
      }
      continue
    }
    if (configuration.templateRevision !== Number(current.revision) + 1) {
      throw new TypeError(
        `workbench template ${configuration.roleId} must advance exactly one revision`,
      )
    }
    const promptOverride = configuration.promptOverride === ''
      ? {}
      : { rolePromptOverride: configuration.promptOverride }
    const next: AgentTemplateProfile = {
      ...current,
      revision: configuration.templateRevision as AgentTemplateProfile['revision'],
      status: configuration.status,
      ...promptOverride,
      modelPolicy: {
        ...current.modelPolicy,
        provider: configuration.provider,
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort,
        maxOutputTokens: configuration.maxOutputTokens,
        modelCapabilityProfileId: configuration.modelCapabilityProfileId,
        ...(configuration.modelCapabilityProfileRevision === undefined
          ? {}
          : {
              modelCapabilityProfileRevision:
                configuration.modelCapabilityProfileRevision as AgentTemplateProfile['revision'],
            }),
        allowCanaryModel: configuration.allowCanaryModel,
      },
      contextPolicy: {
        ...current.contextPolicy,
        contextBudgetTokens: configuration.contextBudgetTokens,
        retainedTailTokens: Math.min(
          current.contextPolicy.retainedTailTokens,
          Math.max(0, configuration.contextBudgetTokens - 1),
        ),
      },
      concurrencyLimit: configuration.concurrencyLimit,
      supersedesRevision: current.revision,
      updatedAt: document.updatedAt as NonNullable<AgentTemplateProfile['updatedAt']>,
    }
    const capability = await host.application.policies.modelCapability(
      configuration.provider,
      configuration.model,
      configuration.modelCapabilityProfileRevision,
    )
    if (capability.profileId !== configuration.modelCapabilityProfileId) {
      throw new TypeError(
        `${configuration.roleId}.modelCapabilityProfileId expected ${capability.profileId}, received ${configuration.modelCapabilityProfileId}`,
      )
    }
    if (configuration.modelCapabilityProfileRevision !== undefined
      && Number(capability.revision)
        !== configuration.modelCapabilityProfileRevision) {
      throw new TypeError(
        `${configuration.roleId}.modelCapabilityProfileRevision expected ${Number(capability.revision)}, received ${configuration.modelCapabilityProfileRevision}`,
      )
    }
    pending.push({ profile: next, expectedRevision: current.revision })
  }
  await host.application.templates.reviseBatch(pending)
  await host.application.generalRouting.updatePresetDefault({
    provider: general.provider,
    model: general.model,
    reasoningEffort: general.reasoningEffort,
    maxOutputTokens: general.maxOutputTokens,
    contextBudgetTokens: general.contextBudgetTokens,
  })
  host.updateGeneralRolePrompt(effectiveRolePrompt(general))
}

interface RoleMigrationIntent {
  status: PortableRoleConfiguration['status'] | undefined
  route: {
    readonly provider: string
    readonly model: string
    readonly modelCapabilityProfileId: string
    readonly modelCapabilityProfileRevision: number | undefined
    readonly allowCanaryModel: boolean
  } | undefined
  reasoningEffort: PortableRoleConfiguration['reasoningEffort'] | undefined
  maxOutputTokens: number | undefined
  contextBudgetTokens: number | undefined
  concurrencyLimit: number | undefined
  promptOverride: string | undefined
}

function roleMigrationIntent(
  document: RoleWorkbenchDocument,
  configuration: PortableRoleConfiguration,
  current: AgentTemplateProfile,
): RoleMigrationIntent {
  const intent = emptyRoleMigrationIntent()
  const userHistory = document.history.filter(revision =>
    revision.roleId === configuration.roleId
    && revision.source !== 'BUNDLED'
    && revision.source !== 'PLUGIN_MIGRATION')
  for (const revision of userHistory) {
    if (revision.previousConfiguration === undefined) continue
    recordRoleUserDelta(
      intent,
      revision.previousConfiguration,
      revision.configuration,
    )
  }
  if (roleIntentIsCustomized(intent)) return intent

  const packaged = defaultTemplates().find(template =>
    String(template.templateId) === configuration.roleId)
  const bundled = packaged === undefined
    ? undefined
    : defaultTemplateAtRevision(packaged, configuration.templateRevision)
  const baseline = bundled === undefined
    ? templateRoleConfiguration(current)
    : templateRoleConfiguration(bundled)
  recordRoleUserDelta(intent, baseline, configuration)
  return intent
}

function replayRoleUserFields(
  intent: RoleMigrationIntent,
  current: AgentTemplateProfile,
): PortableRoleConfiguration {
  const target = templateRoleConfiguration(current)
  const capabilityRevision = intent.route === undefined
    ? target.modelCapabilityProfileRevision
    : intent.route.modelCapabilityProfileRevision
  const {
    modelCapabilityProfileRevision: _targetCapabilityRevision,
    ...targetWithoutCapabilityRevision
  } = target
  return {
    ...targetWithoutCapabilityRevision,
    status: intent.status ?? target.status,
    provider: intent.route?.provider ?? target.provider,
    model: intent.route?.model ?? target.model,
    reasoningEffort: intent.reasoningEffort ?? target.reasoningEffort,
    maxOutputTokens: intent.maxOutputTokens ?? target.maxOutputTokens,
    contextBudgetTokens:
      intent.contextBudgetTokens ?? target.contextBudgetTokens,
    concurrencyLimit: intent.concurrencyLimit ?? target.concurrencyLimit,
    promptOverride: intent.promptOverride ?? target.promptOverride,
    modelCapabilityProfileId:
      intent.route?.modelCapabilityProfileId
        ?? target.modelCapabilityProfileId,
    ...(capabilityRevision === undefined
      ? {}
      : { modelCapabilityProfileRevision: capabilityRevision }),
    allowCanaryModel:
      intent.route?.allowCanaryModel ?? target.allowCanaryModel,
  }
}

function emptyRoleMigrationIntent(): RoleMigrationIntent {
  return {
    status: undefined,
    route: undefined,
    reasoningEffort: undefined,
    maxOutputTokens: undefined,
    contextBudgetTokens: undefined,
    concurrencyLimit: undefined,
    promptOverride: undefined,
  }
}

function recordRoleUserDelta(
  intent: RoleMigrationIntent,
  before: PortableRoleConfiguration,
  after: PortableRoleConfiguration,
): void {
  if (after.status !== before.status) intent.status = after.status
  if (after.provider !== before.provider || after.model !== before.model) {
    intent.route = {
      provider: after.provider,
      model: after.model,
      modelCapabilityProfileId: after.modelCapabilityProfileId,
      modelCapabilityProfileRevision:
        after.modelCapabilityProfileRevision,
      allowCanaryModel: after.allowCanaryModel,
    }
  }
  if (after.reasoningEffort !== before.reasoningEffort) {
    intent.reasoningEffort = after.reasoningEffort
  }
  if (after.maxOutputTokens !== before.maxOutputTokens) {
    intent.maxOutputTokens = after.maxOutputTokens
  }
  if (after.contextBudgetTokens !== before.contextBudgetTokens) {
    intent.contextBudgetTokens = after.contextBudgetTokens
  }
  if (after.concurrencyLimit !== before.concurrencyLimit) {
    intent.concurrencyLimit = after.concurrencyLimit
  }
  if (after.promptOverride !== before.promptOverride) {
    intent.promptOverride = after.promptOverride
  }
}

function roleIntentIsCustomized(intent: RoleMigrationIntent): boolean {
  return intent.status !== undefined
    || intent.route !== undefined
    || intent.reasoningEffort !== undefined
    || intent.maxOutputTokens !== undefined
    || intent.contextBudgetTokens !== undefined
    || intent.concurrencyLimit !== undefined
    || intent.promptOverride !== undefined
}

function roleMigrationHistory(
  document: RoleWorkbenchDocument,
  previous: PortableRoleConfiguration,
  next: PortableRoleConfiguration,
  customized: boolean,
  workbenchRevision: number,
  createdAt: string,
): RoleConfigurationRevision {
  const roleHistory = document.history
    .filter(revision => revision.roleId === previous.roleId)
  const priorReadiness = roleHistory.at(-1)?.readiness
  const readiness = customized
    ? priorReadiness ?? {
        disposition: 'REVIEW' as const,
        score: 0,
        errorCount: 0,
        warningCount: 1,
      }
    : {
        disposition: 'READY' as const,
        score: 100,
        errorCount: 0,
        warningCount: 0,
      }
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision: roleHistory.reduce(
      (maximum, revision) => Math.max(maximum, revision.revision),
      0,
    ) + 1,
    workbenchRevision,
    roleId: previous.roleId,
    source: 'PLUGIN_MIGRATION',
    createdAt,
    configuration: next,
    previousConfiguration: previous,
    promptDiff: diffPrompt(
      effectiveRolePrompt(previous),
      effectiveRolePrompt(next),
    ),
    readiness,
    actor: 'plugin-migration',
  }
}

function configurationMatchesTemplate(
  configuration: PortableRoleConfiguration,
  template: AgentTemplateProfile,
): boolean {
  return configuration.status === template.status
    && configuration.provider === template.modelPolicy.provider
    && configuration.model === template.modelPolicy.model
    && configuration.reasoningEffort
      === reasoning(template.modelPolicy.reasoningEffort)
    && configuration.maxOutputTokens === template.modelPolicy.maxOutputTokens
    && configuration.contextBudgetTokens
      === template.contextPolicy.contextBudgetTokens
    && configuration.concurrencyLimit === template.concurrencyLimit
    && configuration.promptOverride
      === (template.rolePromptOverride?.trim() ?? '')
    && configuration.toolProfileId === template.capabilities.toolProfileId
    && configuration.toolProfileRevision
      === Number(template.capabilities.toolProfileRevision)
    && configuration.permissionProfileId
      === template.capabilities.permissionProfileId
    && configuration.permissionProfileRevision
      === Number(template.capabilities.permissionProfileRevision)
    && configuration.modelCapabilityProfileId
      === template.modelPolicy.modelCapabilityProfileId
    && (
      configuration.modelCapabilityProfileRevision === undefined
      || configuration.modelCapabilityProfileRevision
        === Number(template.modelPolicy.modelCapabilityProfileRevision)
    )
    && configuration.allowCanaryModel
      === (template.modelPolicy.allowCanaryModel === true)
}

function boundedApplicationError(error: unknown): string {
  return redactDiagnosticText(
    error instanceof Error ? error.message : String(error),
  )
    .replace(/\s+/gu, ' ')
    .slice(0, 2_000)
}

export function roleDraftFromUnknown(value: unknown): RoleDraft {
  if (!isRecord(value)) throw new TypeError('role draft must be an object')
  if (typeof value.prompt !== 'string') {
    throw new TypeError('role draft prompt must be a string')
  }
  return {
    roleId: normalizedIdentifier(value.roleId, 'role draft roleId'),
    provider: normalizedIdentifier(value.provider, 'role draft provider'),
    model: normalizedIdentifier(value.model, 'role draft model'),
    reasoningEffort: reasoning(value.reasoningEffort),
    maxOutputTokens: boundedInteger(value.maxOutputTokens, 1_024, 256_000, 'role draft maxOutputTokens'),
    contextBudgetTokens: boundedInteger(value.contextBudgetTokens, 4_096, 1_000_000, 'role draft contextBudgetTokens'),
    concurrencyLimit: boundedInteger(value.concurrencyLimit, 1, 64, 'role draft concurrencyLimit'),
    // Role prompts are intentionally multiline. The role-specific validator
    // permits CR/LF/TAB while still rejecting the other control characters;
    // the generic identifier/scalar reader rejects every C0 byte and must not
    // be applied before it.
    prompt: validateRolePrompt(value.prompt, 'role draft prompt'),
  }
}

function parseRoleConfiguration(
  value: unknown,
  at: string,
): PortableRoleConfiguration {
  if (!isRecord(value)) throw new TypeError(`${at} must be an object`)
  const roleId = normalizedIdentifier(value.roleId, `${at}.roleId`)
  const status = value.status
  if (!['DRAFT', 'CANARY', 'ACTIVE', 'PAUSED', 'RETIRED'].includes(String(status))) {
    throw new TypeError(`${at}.status is invalid`)
  }
  const promptOverride = normalizedPromptOverride(value.promptOverride, `${at}.promptOverride`)
  return {
    roleId,
    displayName: stringValue(value.displayName, `${at}.displayName`, 160),
    department: normalizedIdentifier(value.department, `${at}.department`),
    role: normalizedIdentifier(value.role, `${at}.role`),
    status: status as PortableRoleConfiguration['status'],
    provider: normalizedIdentifier(value.provider, `${at}.provider`),
    model: normalizedIdentifier(value.model, `${at}.model`),
    reasoningEffort: reasoning(value.reasoningEffort),
    maxOutputTokens: boundedInteger(value.maxOutputTokens, 1_024, 256_000, `${at}.maxOutputTokens`),
    contextBudgetTokens: boundedInteger(value.contextBudgetTokens, 4_096, 1_000_000, `${at}.contextBudgetTokens`),
    concurrencyLimit: boundedInteger(value.concurrencyLimit, 1, 64, `${at}.concurrencyLimit`),
    promptOverride,
    templateRevision: boundedInteger(value.templateRevision, 0, Number.MAX_SAFE_INTEGER, `${at}.templateRevision`),
    toolProfileId: normalizedIdentifier(value.toolProfileId, `${at}.toolProfileId`),
    toolProfileRevision: boundedInteger(value.toolProfileRevision, 0, Number.MAX_SAFE_INTEGER, `${at}.toolProfileRevision`),
    permissionProfileId: normalizedIdentifier(value.permissionProfileId, `${at}.permissionProfileId`),
    permissionProfileRevision: boundedInteger(value.permissionProfileRevision, 0, Number.MAX_SAFE_INTEGER, `${at}.permissionProfileRevision`),
    modelCapabilityProfileId: normalizedIdentifier(
      value.modelCapabilityProfileId,
      `${at}.modelCapabilityProfileId`,
    ),
    ...(value.modelCapabilityProfileRevision === undefined
      ? {}
      : {
          modelCapabilityProfileRevision: boundedInteger(
            value.modelCapabilityProfileRevision,
            1,
            Number.MAX_SAFE_INTEGER,
            `${at}.modelCapabilityProfileRevision`,
          ),
        }),
    allowCanaryModel: value.allowCanaryModel === true,
  }
}

function parseHistoryRevision(
  value: unknown,
  at: string,
  roleIds: readonly string[],
): RoleConfigurationRevision {
  if (!isRecord(value)) throw new TypeError(`${at} must be an object`)
  if (value.schemaVersion !== MILITARY_CONTROL_SCHEMA_VERSION) {
    throw new TypeError(`${at}.schemaVersion is unsupported`)
  }
  const roleId = normalizedIdentifier(value.roleId, `${at}.roleId`)
  if (!roleIds.includes(roleId)) throw new TypeError(`${at}.roleId is unknown`)
  const source = String(value.source)
  if (
    ![
      'BUNDLED',
      'USER_SAVE',
      'ROLLBACK',
      'IMPORT',
      'PLUGIN_MIGRATION',
    ].includes(source)
  ) {
    throw new TypeError(`${at}.source is invalid`)
  }
  const actor = String(value.actor)
  if (
    actor.length < 1
    || actor.length > 180
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(actor)
  ) throw new TypeError(`${at}.actor is invalid`)
  if (!isRecord(value.readiness)) throw new TypeError(`${at}.readiness must be an object`)
  if (!isRecord(value.promptDiff) || !Array.isArray(value.promptDiff.lines)) {
    throw new TypeError(`${at}.promptDiff must be a diff summary`)
  }
  const disposition = String(value.readiness.disposition)
  if (!['READY', 'REVIEW', 'BLOCKED'].includes(disposition)) {
    throw new TypeError(`${at}.readiness.disposition is invalid`)
  }
  const readinessReport = value.readinessReport === undefined
    ? undefined
    : parseReadinessReport(value.readinessReport, `${at}.readinessReport`)
  const simplifiedChineseReview = value.simplifiedChineseReview === undefined
    ? undefined
    : parseSimplifiedChineseReview(
        value.simplifiedChineseReview,
        `${at}.simplifiedChineseReview`,
      )
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    revision: boundedInteger(value.revision, 1, Number.MAX_SAFE_INTEGER, `${at}.revision`),
    workbenchRevision: boundedInteger(
      value.workbenchRevision,
      1,
      Number.MAX_SAFE_INTEGER,
      `${at}.workbenchRevision`,
    ),
    roleId,
    source: source as RoleConfigurationRevision['source'],
    createdAt: isoDate(value.createdAt, `${at}.createdAt`),
    configuration: parseRoleConfiguration(value.configuration, `${at}.configuration`),
    ...(value.previousConfiguration === undefined
      ? {}
      : {
          previousConfiguration: parseRoleConfiguration(
            value.previousConfiguration,
            `${at}.previousConfiguration`,
          ),
        }),
    promptDiff: value.promptDiff as unknown as RoleConfigurationRevision['promptDiff'],
    readiness: {
      disposition: disposition as RoleConfigurationRevision['readiness']['disposition'],
      score: boundedInteger(value.readiness.score, 0, 100, `${at}.readiness.score`),
      errorCount: boundedInteger(
        value.readiness.errorCount,
        0,
        Number.MAX_SAFE_INTEGER,
        `${at}.readiness.errorCount`,
      ),
      warningCount: boundedInteger(
        value.readiness.warningCount,
        0,
        Number.MAX_SAFE_INTEGER,
        `${at}.readiness.warningCount`,
      ),
    },
    ...(readinessReport === undefined ? {} : { readinessReport }),
    ...(simplifiedChineseReview === undefined ? {} : { simplifiedChineseReview }),
    actor: actor as RoleConfigurationRevision['actor'],
    ...(value.rollbackOfRevision === undefined
      ? {}
      : {
          rollbackOfRevision: boundedInteger(
            value.rollbackOfRevision,
            1,
            Number.MAX_SAFE_INTEGER,
            `${at}.rollbackOfRevision`,
          ),
        }),
  }
}

function parseSimplifiedChineseReview(
  value: unknown,
  at: string,
): SimplifiedChineseReviewReceipt {
  if (!isRecord(value)) throw new TypeError(`${at} must be an object`)
  const mode = String(value.mode)
  if (![
    'NO_FINDINGS',
    'APPLIED_SELECTION',
    'ACKNOWLEDGED_WITH_FINDINGS',
    'NOT_USER_REVIEWED',
  ].includes(mode)) {
    throw new TypeError(`${at}.mode is invalid`)
  }
  if (typeof value.reviewedByUser !== 'boolean') {
    throw new TypeError(`${at}.reviewedByUser must be a boolean`)
  }
  const sourceHash = lowercaseSha256(value.sourceHash, `${at}.sourceHash`)
  const resultHash = lowercaseSha256(value.resultHash, `${at}.resultHash`)
  const confirmedStarts = requireArray(
    value.confirmedStarts,
    `${at}.confirmedStarts`,
  ).map((entry, index) =>
    boundedInteger(entry, 0, Number.MAX_SAFE_INTEGER, `${at}.confirmedStarts[${index}]`))
  assertUnique(confirmedStarts.map(String), `${at}.confirmedStarts`)
  return {
    mode: mode as SimplifiedChineseReviewReceipt['mode'],
    reviewedByUser: value.reviewedByUser,
    sourceHash,
    resultHash,
    confirmedStarts,
    appliedCount: boundedInteger(
      value.appliedCount,
      0,
      Number.MAX_SAFE_INTEGER,
      `${at}.appliedCount`,
    ),
    remainingCount: boundedInteger(
      value.remainingCount,
      0,
      Number.MAX_SAFE_INTEGER,
      `${at}.remainingCount`,
    ),
    confirmedAt: isoDate(value.confirmedAt, `${at}.confirmedAt`),
  }
}

function lowercaseSha256(value: unknown, at: string): string {
  const result = stringValue(value, at, 64)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new TypeError(`${at} must be SHA-256`)
  return result
}

function parseReadinessReport(value: unknown, at: string): FlashReadinessReport {
  if (!isRecord(value) || !Array.isArray(value.issues)) {
    throw new TypeError(`${at} must be a Flash readiness report`)
  }
  const disposition = String(value.disposition)
  if (!['READY', 'REVIEW', 'BLOCKED'].includes(disposition)) {
    throw new TypeError(`${at}.disposition is invalid`)
  }
  return {
    schemaVersion: MILITARY_CONTROL_SCHEMA_VERSION,
    disposition: disposition as FlashReadinessReport['disposition'],
    score: boundedInteger(value.score, 0, 100, `${at}.score`),
    errorCount: boundedInteger(value.errorCount, 0, Number.MAX_SAFE_INTEGER, `${at}.errorCount`),
    warningCount: boundedInteger(
      value.warningCount,
      0,
      Number.MAX_SAFE_INTEGER,
      `${at}.warningCount`,
    ),
    issues: value.issues as unknown as FlashReadinessReport['issues'],
    checkedAt: isoDate(value.checkedAt, `${at}.checkedAt`),
  }
}

function modelProfileId(provider: unknown, model: unknown): string {
  const route = `${String(provider)}/${String(model)}`
  if (route === 'deepseek-official/deepseek-v4-flash') return 'deepseek-v4-flash-rc2'
  if (route === 'deepseek-official/deepseek-v4-pro') return 'deepseek-v4-pro-rc2'
  return `unverified-${route.replace(/[^A-Za-z0-9_.-]+/gu, '-')}`
}

function normalizedPromptOverride(value: unknown, at: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new TypeError(`${at} must be a string`)
  return validateRolePrompt(value, at)
}

function normalizedIdentifier(value: unknown, at: string): string {
  const text = stringValue(value, at, 180)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(text)) {
    throw new TypeError(`${at} contains unsupported characters`)
  }
  return text
}

function stringValue(value: unknown, at: string, maximum = 12_000): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new TypeError(`${at} must be a non-empty string up to ${maximum} characters`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${at} contains control characters`)
  return value.trim()
}

function reasoning(value: unknown): 'high' | 'max' {
  if (value !== 'high' && value !== 'max') {
    throw new TypeError('Military reasoning effort must be high or max')
  }
  return value
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  at: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${at} must be an integer from ${minimum} through ${maximum}`)
  }
  return Number(value)
}

function isoDate(value: unknown, at: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${at} must be an ISO date-time`)
  }
  return new Date(value).toISOString()
}

function requireArray(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${at} must be an array`)
  return value
}

function assertUnique(values: readonly string[], at: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`${at} contains duplicate ${value}`)
    seen.add(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
