import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  MilitaryError,
  brand,
  validateRolePrompt,
  type AgentTemplateProfile,
  type TacticalTag,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'
import { defaultTemplates } from './defaults.js'
import type { PrivateSkillRemoteService } from './private-skill-remote.js'
import { redactDiagnosticText } from './session-diagnostics.js'
import {
  ROLE_WORKBENCH_NAMESPACE,
  initialRoleWorkbenchDocument,
  parseRoleWorkbenchDocument,
  serializeRoleWorkbenchDocument,
  synchronizeRoleWorkbench,
  synchronizeRoleWorkbenchReadiness,
} from './role-workbench.js'

const DEFAULT_TEMPLATE_JSON = JSON.stringify(defaultTemplates(), null, 2)

/**
 * Register every host-owned settings namespace.  The JSON registry fields are
 * intentionally explicit: the RC.2 settings wire redacts secrets but does not
 * provide a generic nested collection editor.  The Web client owns the richer
 * editor and writes the complete versioned collection through these fields.
 */
export function installMilitarySettings(
  ctx: Context,
  host: MilitaryHostRuntime,
  privateSkillRemote: PrivateSkillRemoteService,
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (settings === undefined) return

    const modelRouting = settings.register(settingsNamespace('military-model-routing'), z.object({
      provider: z.string().min(1).default('deepseek-official'),
      model: z.string().min(1).default('deepseek-v4-flash'),
      reasoningEffort: z.union(['high', 'max'] as const).default('high'),
      maxOutputTokens: z.number().min(1_024).max(256_000).step(1_024).default(16_384),
      generalPromptOverride: z.string().default(''),
    }), {
      base: {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
        maxOutputTokens: 16_384,
        generalPromptOverride: '',
      },
      applies: 'live',
      validate(value) {
        if (value.generalPromptOverride.trim() !== '') {
          void validateRolePrompt(value.generalPromptOverride, 'General 角色提示词')
        }
      },
    })
    const core = settings.register(settingsNamespace('military-core'), z.object({
      maxRadioAttempts: z.number().min(1).max(32).step(1).default(5),
      radioLeaseSeconds: z.number().min(10).max(3600).step(1).default(120),
    }), {
      base: { maxRadioAttempts: 5, radioLeaseSeconds: 120 },
      applies: 'live',
    })
    synchronizeFeatureSettings(host, {
      radio: {
        maxAttempts: core.get().maxRadioAttempts,
        leaseSeconds: core.get().radioLeaseSeconds,
      },
    }, ctx)
    core.watch((next) => {
      synchronizeFeatureSettings(host, {
        radio: {
          maxAttempts: next.maxRadioAttempts,
          leaseSeconds: next.radioLeaseSeconds,
        },
      }, ctx)
    })

    const templates = settings.register(settingsNamespace('military-agent-templates'), z.object({
      profilesJson: z.string().default(DEFAULT_TEMPLATE_JSON),
    }), {
      base: { profilesJson: DEFAULT_TEMPLATE_JSON },
      applies: 'live',
      validate(value) { void parseTemplateProfiles(value.profilesJson) },
    })
    const roleWorkbenchBase = serializeRoleWorkbenchDocument(
      initialRoleWorkbenchDocument(
        modelRouting.get(),
        parseTemplateProfiles(templates.get().profilesJson),
      ),
    )
    const roleWorkbench = settings.register(settingsNamespace(ROLE_WORKBENCH_NAMESPACE), z.object({
      stateJson: z.string().default(roleWorkbenchBase),
    }), {
      base: { stateJson: roleWorkbenchBase },
      applies: 'live',
      validate(value) { void parseRoleWorkbenchDocument(value.stateJson) },
    })
    void scheduleWorkbenchSettings(
      host,
      roleWorkbench.get().stateJson,
      ctx,
    )
    roleWorkbench.watch(async next => {
      await scheduleWorkbenchSettings(host, next.stateJson, ctx)
    })

    const staff = settings.register(settingsNamespace('military-staff'), z.object({
      chiefOfStaffFallbackEnabled: z.boolean().default(true),
    }), {
      base: {
        chiefOfStaffFallbackEnabled: true,
      },
      applies: 'live',
    })
    synchronizeFeatureSettings(host, { staff: staff.get() }, ctx)
    staff.watch((next) => { synchronizeFeatureSettings(host, { staff: next }, ctx) })

    const tags = settings.register(settingsNamespace('military-tags'), z.object({
      tagsJson: z.string().default('[]'),
    }), {
      base: { tagsJson: '[]' },
      applies: 'live',
      validate(value) { void parseTacticalTags(value.tagsJson) },
    })
    void synchronizeTags(host, tags.get().tagsJson, ctx)
    tags.watch(async next => { await synchronizeTags(host, next.tagsJson, ctx) })

    const tactics = settings.register(settingsNamespace('military-tactics'), z.object({
      candidateRecallMinimum: z.number().min(1).max(10).step(1).default(3),
      candidateRecallMaximum: z.number().min(1).max(20).step(1).default(5),
      allowCanaryDelivery: z.boolean().default(true),
    }), {
      base: {
        candidateRecallMinimum: 3,
        candidateRecallMaximum: 5,
        allowCanaryDelivery: true,
      },
      applies: 'live',
      validate(value) {
        if (value.candidateRecallMinimum > value.candidateRecallMaximum) {
          throw new TypeError('candidateRecallMinimum must not exceed candidateRecallMaximum')
        }
      },
    })
    synchronizeFeatureSettings(host, { tactics: tactics.get() }, ctx)
    tactics.watch((next) => { synchronizeFeatureSettings(host, { tactics: next }, ctx) })

    const privateSkills = settings.register(settingsNamespace('military-private-skills'), z.object({
      extractionProvider: z.string().min(1).default('deepseek-official'),
      extractionModel: z.string().min(1).default('deepseek-v4-flash'),
      maxOutputTokens: z.number().min(512).max(8_192).step(256).default(2_048),
      allowDeterministicFallback: z.boolean().default(false),
      defaultVisibility: z.union(['user-private', 'workspace-private', 'organization-private'] as const).default('user-private'),
      defaultRetentionDays: z.number().min(1).max(3_650).step(1).default(365),
    }), {
      base: {
        extractionProvider: 'deepseek-official',
        extractionModel: 'deepseek-v4-flash',
        maxOutputTokens: 2_048,
        allowDeterministicFallback: false,
        defaultVisibility: 'user-private',
        defaultRetentionDays: 365,
      },
      applies: 'live',
    })
    const initialPrivateSkills = privateSkills.get() as PrivateSkillSettingsValue
    host.updatePrivateSkillExtractionSettings({
      provider: initialPrivateSkills.extractionProvider,
      model: initialPrivateSkills.extractionModel,
      maxOutputTokens: initialPrivateSkills.maxOutputTokens,
    })
    configurePrivateSkillRemote(privateSkillRemote, initialPrivateSkills)
    removeLegacyPrivateSkillSettingsPayloads(settings, privateSkills, ctx)
    privateSkills.watch((next) => {
      const value = next as PrivateSkillSettingsValue
      try {
        host.updatePrivateSkillExtractionSettings({
          provider: value.extractionProvider,
          model: value.extractionModel,
          maxOutputTokens: value.maxOutputTokens,
        })
      } catch (error) {
        ctx.logger.error('military private Skill extraction settings rejected', error)
      }
      try {
        configurePrivateSkillRemote(privateSkillRemote, value)
      } catch (error) {
        ctx.logger.error('military private Skill operation settings rejected', error)
      }
    })

    const oversight = settings.register(settingsNamespace('military-oversight'), z.object({
      completionInterlockEnabled: z.boolean().default(true),
      freezeOnSecondMissingSubmission: z.boolean().default(true),
      requireObservedToolEvidence: z.boolean().default(true),
      maximumNoProgressTurns: z.number().min(1).max(32).step(1).default(3),
    }), {
      base: {
        completionInterlockEnabled: true,
        freezeOnSecondMissingSubmission: true,
        requireObservedToolEvidence: true,
        maximumNoProgressTurns: 3,
      },
      applies: 'live',
    })
    host.updateOversightSettings(oversight.get())
    oversight.watch(next => { host.updateOversightSettings(next) })

    const specs = settings.register(settingsNamespace('military-specs'), z.object({
      commitMessagePrefix: z.string().default('docs(specs):'),
    }), {
      base: {
        commitMessagePrefix: 'docs(specs):',
      },
      applies: 'live',
      validate(value) {
        if (value.commitMessagePrefix.trim().length === 0
          || value.commitMessagePrefix.length > 80
          || /[\r\n\u0000]/u.test(value.commitMessagePrefix)) {
          throw new TypeError('commitMessagePrefix must be one non-empty line up to 80 characters')
        }
      },
    })
    synchronizeFeatureSettings(host, { specs: specs.get() }, ctx)
    specs.watch((next) => { synchronizeFeatureSettings(host, { specs: next }, ctx) })

    const memory = settings.register(settingsNamespace('military-memory'), z.object({
      trajectoryAfterWave: z.boolean().default(true),
      effectivenessAfterGeneralCompaction: z.boolean().default(true),
    }), {
      base: {
        trajectoryAfterWave: true,
        effectivenessAfterGeneralCompaction: true,
      },
      applies: 'live',
    })
    synchronizeFeatureSettings(host, { memory: memory.get() }, ctx)
    memory.watch((next) => { synchronizeFeatureSettings(host, { memory: next }, ctx) })

    const evaluation = settings.register(settingsNamespace('military-evaluation'), z.object({
      minimumSampleSize: z.number().min(1).step(1).default(20),
      includeIncompleteByDefault: z.boolean().default(false),
      periodFrom: z.string().default(''),
      periodTo: z.string().default(''),
      templateIdsJson: z.string().default('[]'),
      departmentsJson: z.string().default('[]'),
      workspaceKeysJson: z.string().default('[]'),
      missionIdsJson: z.string().default('[]'),
      splitByRevision: z.boolean().default(true),
      comparisonBaseline: z.union([
        'same-role-same-difficulty',
        'previous-period',
        'previous-revision',
        'organization-baseline',
        'none',
      ] as const).default('same-role-same-difficulty'),
      confidenceLevel: z.union([0.9, 0.95, 0.99] as const).default(0.95),
      nonInferiorityMargin: z.number().min(0).max(0.5).step(0.01).default(0.05),
      timeoutSeconds: z.number().min(30).max(86_400).step(1).default(1_800),
      narrativeMode: z.union(['DETERMINISTIC', 'COMMITTEE_MODEL'] as const).default('DETERMINISTIC'),
      reportClassification: z.union(['public', 'internal', 'confidential', 'restricted'] as const).default('confidential'),
      examinerTemplateId: z.string().default('evaluation-examiner'),
      chairTemplateId: z.string().default('evaluation-chair'),
      runNonce: z.number().min(0).step(1).default(0),
      lastRunState: z.union(['IDLE', 'RUNNING', 'COMPLETED', 'FAILED'] as const).default('IDLE'),
      lastEvaluationRequestId: z.string().default(''),
      lastDatasetHash: z.string().default(''),
      lastReportId: z.string().default(''),
      // Migration-only compatibility field. Durable report bytes live in the
      // Artifact repository and SQLite lineage, never in Settings.
      lastReportJson: z.string().default(''),
      lastError: z.string().default(''),
    }), {
      base: {
        minimumSampleSize: 20,
        includeIncompleteByDefault: false,
        periodFrom: '', periodTo: '', templateIdsJson: '[]', departmentsJson: '[]',
        workspaceKeysJson: '[]', missionIdsJson: '[]', splitByRevision: true,
        comparisonBaseline: 'same-role-same-difficulty', reportClassification: 'confidential',
        confidenceLevel: 0.95, nonInferiorityMargin: 0.05,
        timeoutSeconds: 1_800,
        narrativeMode: 'DETERMINISTIC',
        examinerTemplateId: 'evaluation-examiner', chairTemplateId: 'evaluation-chair',
        runNonce: 0, lastRunState: 'IDLE', lastEvaluationRequestId: '',
        lastDatasetHash: '', lastReportId: '', lastReportJson: '', lastError: '',
      },
      applies: 'live',
    })
    const initialEvaluation = evaluation.get()
    let handledEvaluationNonce = initialEvaluation.runNonce
    let evaluationChain = Promise.resolve()
    if (initialEvaluation.lastRunState === 'RUNNING'
      && initialEvaluation.runNonce > 0) {
      evaluationChain = evaluationChain
        .then(async () => {
          await runEvaluationFromSettings(
            host,
            evaluation,
            initialEvaluation as EvaluationSettingsValue,
          )
        })
        .catch(error => ctx.logger.error('military evaluation settings recovery failed', error))
    }
    evaluation.watch((next) => {
      if (next.runNonce <= handledEvaluationNonce) return
      handledEvaluationNonce = next.runNonce
      evaluationChain = evaluationChain
        .then(async () => { await runEvaluationFromSettings(host, evaluation, next as EvaluationSettingsValue) })
        .catch(error => ctx.logger.error('military evaluation settings job failed', error))
      return evaluationChain
    })

    settings.register(settingsNamespace('military-presentation'), z.object({
      terminology: z.union(['military', 'neutral'] as const).default('military'),
      showAdvancedAudit: z.boolean().default(false),
      compactEventCards: z.boolean().default(true),
    }), {
      base: { terminology: 'military', showAdvancedAudit: false, compactEventCards: true },
      applies: 'live',
    })
  })
}

async function synchronizeWorkbenchSettings(
  host: MilitaryHostRuntime,
  source: string,
  ctx: Context,
): Promise<void> {
  try {
    const document = parseRoleWorkbenchDocument(source)
    for (const route of uniqueModelRoutes(document.roles)) {
      await host.ensureDshModelCapability(route.provider, route.model)
    }
    await synchronizeRoleWorkbench(host, document)
  } catch (error) {
    ctx.logger.error('military-role-workbench settings rejected', error)
  }
}

function scheduleWorkbenchSettings(
  host: MilitaryHostRuntime,
  source: string,
  ctx: Context,
): Promise<void> {
  return synchronizeRoleWorkbenchReadiness(
    host,
    async () => {
      await synchronizeWorkbenchSettings(host, source, ctx)
    },
  )
}

function uniqueModelRoutes(
  roles: readonly { readonly provider: string; readonly model: string }[],
): readonly { readonly provider: string; readonly model: string }[] {
  const routes = new Map<string, { readonly provider: string; readonly model: string }>()
  for (const role of roles) {
    routes.set(`${role.provider}\u0000${role.model}`, {
      provider: role.provider,
      model: role.model,
    })
  }
  return [...routes.values()]
}

function synchronizeFeatureSettings(
  host: MilitaryHostRuntime,
  value: Parameters<MilitaryHostRuntime['updateFeatureSettings']>[0],
  ctx: Context,
): void {
  try {
    host.updateFeatureSettings(value)
  } catch (error) {
    ctx.logger.error('Military live feature settings rejected', error)
  }
}

async function synchronizeTags(host: MilitaryHostRuntime, source: string, ctx: Context): Promise<void> {
  try {
    const desired = parseTacticalTags(source)
    assertUnique(desired.map(item => String(item.tagId)), 'tag id')
    for (const tag of desired) {
      try {
        const current = await host.application.tags.get(tag.tagId)
        if (Number(tag.revision) <= Number(current.revision)) continue
        if (tag.status === 'DELETED') await host.application.tags.delete(tag.tagId, current.revision)
        else if (tag.status === 'PAUSED') await host.application.tags.pause(tag.tagId, current.revision)
        else if (tag.displayName !== current.displayName) {
          await host.application.tags.rename(tag.tagId, tag.displayName, current.revision)
        } else if (current.status === 'PAUSED') {
          await host.application.tags.resume(tag.tagId, current.revision)
        }
      } catch (error) {
        if (isNotFound(error)) {
          await host.application.tags.create({
            ...tag,
            tagId: brand<string, 'TacticalTagId'>(String(tag.tagId)),
          })
        } else {
          throw error
        }
      }
    }
  } catch (error) {
    ctx.logger.error('military-tags settings rejected', error)
  }
}

interface PrivateSkillSettingsValue {
  readonly extractionProvider: string
  readonly extractionModel: string
  readonly maxOutputTokens: number
  readonly allowDeterministicFallback: boolean
  readonly defaultVisibility: 'user-private' | 'workspace-private' | 'organization-private'
  readonly defaultRetentionDays: number
}

function configurePrivateSkillRemote(
  remote: PrivateSkillRemoteService,
  settings: PrivateSkillSettingsValue,
): void {
  remote.configure({
    allowDeterministicFallback: settings.allowDeterministicFallback,
    defaultVisibility: settings.defaultVisibility,
    defaultRetentionDays: settings.defaultRetentionDays,
  })
}

/**
 * Alpha.7 temporarily used Settings as a browser-to-Host payload bus. Remove
 * every non-policy field from that persisted namespace during the alpha.8
 * startup migration, including old raw action text and derived snapshots.
 */
function removeLegacyPrivateSkillSettingsPayloads(
  settings: {
    describe(): readonly {
      readonly ns: string
      readonly user?: unknown
    }[]
  },
  scope: { replace(section: object): Promise<void> },
  ctx: Context,
): void {
  const descriptor = settings.describe().find(value => value.ns === 'military-private-skills')
  const user = descriptor?.user
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return
  const allowed = new Set([
    'extractionProvider',
    'extractionModel',
    'maxOutputTokens',
    'allowDeterministicFallback',
    'defaultVisibility',
    'defaultRetentionDays',
  ])
  const entries = Object.entries(user as Record<string, unknown>)
  if (entries.every(([key]) => allowed.has(key))) return
  const sanitized = Object.fromEntries(entries.filter(([key]) => allowed.has(key)))
  void scope.replace(sanitized).catch((error: unknown) => {
    ctx.logger.error('military private Skill legacy settings payload cleanup failed', error)
  })
}

interface EvaluationSettingsValue {
  readonly minimumSampleSize: number
  readonly includeIncompleteByDefault: boolean
  readonly periodFrom: string
  readonly periodTo: string
  readonly templateIdsJson: string
  readonly departmentsJson: string
  readonly workspaceKeysJson: string
  readonly missionIdsJson: string
  readonly splitByRevision: boolean
  readonly comparisonBaseline:
    | 'same-role-same-difficulty'
    | 'previous-period'
    | 'previous-revision'
    | 'organization-baseline'
    | 'none'
  readonly confidenceLevel: 0.9 | 0.95 | 0.99
  readonly nonInferiorityMargin: number
  readonly timeoutSeconds: number
  readonly narrativeMode: 'DETERMINISTIC' | 'COMMITTEE_MODEL'
  readonly reportClassification: 'public' | 'internal' | 'confidential' | 'restricted'
  readonly examinerTemplateId: string
  readonly chairTemplateId: string
  readonly runNonce: number
}

async function runEvaluationFromSettings(
  host: MilitaryHostRuntime,
  scope: { update(patch: object): Promise<void> },
  settings: EvaluationSettingsValue,
): Promise<void> {
  const now = new Date()
  let from: Date
  let to: Date
  try {
    from = parseEvaluationDate(
      settings.periodFrom,
      new Date(now.getTime() - 30 * 86_400_000),
    )
    to = parseEvaluationDate(settings.periodTo, now)
  } catch (error) {
    await scope.update({
      lastRunState: 'FAILED',
      lastError: safeSettingsError(error),
    })
    return
  }
  if (from.getTime() >= to.getTime()) {
    await scope.update({ lastRunState: 'FAILED', lastError: 'periodFrom must be before periodTo' })
    return
  }
  const evaluationRequestId = brand<string, 'EvaluationRequestId'>(
    `settings-evaluation-${settings.runNonce}`,
  )
  await scope.update({
    lastRunState: 'RUNNING', lastEvaluationRequestId: String(evaluationRequestId),
    lastDatasetHash: '', lastReportId: '', lastReportJson: '', lastError: '',
  })
  try {
    const request = {
      schemaVersion: '1.0.0' as const,
      evaluationRequestId,
      requestedBy: 'settings:military-evaluation',
      period: {
        from: brand<string, 'IsoDateTime'>(from.toISOString()),
        to: brand<string, 'IsoDateTime'>(to.toISOString()),
      },
      filters: {
        templateIds: parseStringArray(settings.templateIdsJson, 'templateIds').map(value => brand<string, 'AgentTemplateId'>(value)),
        departments: parseDepartments(settings.departmentsJson),
        workspaceKeys: parseStringArray(settings.workspaceKeysJson, 'workspaceKeys'),
        missionIds: parseStringArray(settings.missionIdsJson, 'missionIds').map(value => brand<string, 'MissionId'>(value)),
        includeIncompleteSessions: settings.includeIncompleteByDefault,
      },
      minimumSamples: settings.minimumSampleSize,
      splitByRevision: true as const,
      comparisonBaseline: settings.comparisonBaseline,
      confidenceLevel: settings.confidenceLevel,
      nonInferiorityMargin: settings.nonInferiorityMargin,
      timeoutSeconds: settings.timeoutSeconds,
      narrativeMode: settings.narrativeMode,
      reportClassification: settings.reportClassification,
      examinerTemplateId: brand<string, 'AgentTemplateId'>(settings.examinerTemplateId),
      chairTemplateId: brand<string, 'AgentTemplateId'>(settings.chairTemplateId),
      // Stable across process recovery of the same nonce and period.
      createdAt: brand<string, 'IsoDateTime'>(to.toISOString()),
      idempotencyKey: `settings-evaluation:${settings.runNonce}`,
    }
    await host.application.evaluation.request(request)
    const controller = new AbortController()
    const report = await host.application.evaluation.execute(evaluationRequestId, controller.signal)
    const frozen = await host.application.evaluationDataset.get(evaluationRequestId)
    if (
      frozen === null
      || !await host.application.evaluationDataset.verify(frozen.manifest)
    ) {
      throw new MilitaryError(
        'EVALUATION_DATASET_INCOMPLETE',
        'dataset manifest failed integrity verification',
      )
    }
    await scope.update({
      lastRunState: 'COMPLETED',
      lastDatasetHash: String(frozen.manifest.datasetHash),
      lastReportId: String(report.reportId),
      // Clear any legacy Settings-embedded report during the first v2 run.
      lastReportJson: '',
      lastError: '',
    })
  } catch (error) {
    await scope.update({
      lastRunState: 'FAILED',
      lastError: safeSettingsError(error),
    })
  }
}

function safeSettingsError(error: unknown): string {
  const source = error instanceof Error ? error.message : String(error)
  return redactDiagnosticText(source).slice(0, 1_000)
}

function parseEvaluationDate(source: string, fallback: Date): Date {
  if (source.trim() === '') return fallback
  const value = new Date(source)
  if (!Number.isFinite(value.getTime())) throw new TypeError(`invalid evaluation date: ${source}`)
  return value
}


function parseTemplateProfiles(source: string): readonly AgentTemplateProfile[] {
  const values = parseObjectArray(source, 'department templates')
  const departments = new Set(['staff', 'worker-forces', 'engineer-corps', 'oversight', 'logistics-research', 'evaluation-committee'])
  const roles = new Set(['advisor', 'chief-of-staff', 'worker', 'engineer', 'inspector', 'trajectory', 'effectiveness', 'museum', 'evaluation-examiner', 'evaluation-chair'])
  const statuses = new Set(['DRAFT', 'CANARY', 'ACTIVE', 'PAUSED', 'RETIRED'])
  const reasoning = new Set(['low', 'high', 'max'])
  for (const [index, value] of values.entries()) {
    const at = `department templates[${index}]`
    requireString(value, 'templateId', at)
    requirePositiveInteger(value, 'revision', at)
    requireString(value, 'displayName', at)
    requireEnum(value, 'department', departments, at)
    requireEnum(value, 'role', roles, at)
    requireEnum(value, 'status', statuses, at)
    if (value.rolePromptOverride !== undefined) {
      if (typeof value.rolePromptOverride !== 'string') {
        throw new TypeError(`${at}.rolePromptOverride must be a string`)
      }
      void validateRolePrompt(value.rolePromptOverride, `${at}.rolePromptOverride`)
    }
    const model = requireRecord(value, 'modelPolicy', at)
    requireString(model, 'provider', `${at}.modelPolicy`)
    requireString(model, 'model', `${at}.modelPolicy`)
    requireEnum(model, 'reasoningEffort', reasoning, `${at}.modelPolicy`)
    requirePositiveInteger(model, 'maxOutputTokens', `${at}.modelPolicy`)
    requireString(model, 'modelCapabilityProfileId', `${at}.modelPolicy`)
    if (model.modelCapabilityProfileRevision !== undefined) {
      requirePositiveInteger(
        model,
        'modelCapabilityProfileRevision',
        `${at}.modelPolicy`,
      )
    }
    requireString(model, 'dataResidencyPolicyRef', `${at}.modelPolicy`)
    const context = requireRecord(value, 'contextPolicy', at)
    const budget = requirePositiveInteger(context, 'contextBudgetTokens', `${at}.contextPolicy`)
    if (budget < 4_096) {
      throw new TypeError(`${at}.contextPolicy.contextBudgetTokens must be at least 4096`)
    }
    const trigger = requirePositiveInteger(context, 'compactionTriggerPercent', `${at}.contextPolicy`)
    if (trigger < 50 || trigger > 99) throw new TypeError(`${at}.contextPolicy.compactionTriggerPercent must be in [50, 99]`)
    const retained = requireNonNegativeInteger(context, 'retainedTailTokens', `${at}.contextPolicy`)
    if (retained >= budget) throw new TypeError(`${at}.contextPolicy.retainedTailTokens must be less than contextBudgetTokens`)
    const capabilities = requireRecord(value, 'capabilities', at)
    requireString(capabilities, 'toolProfileId', `${at}.capabilities`)
    requirePositiveInteger(capabilities, 'toolProfileRevision', `${at}.capabilities`)
    requireString(capabilities, 'permissionProfileId', `${at}.capabilities`)
    requirePositiveInteger(capabilities, 'permissionProfileRevision', `${at}.capabilities`)
    requireStringArray(value, 'taskTypes', at)
    requirePositiveInteger(value, 'concurrencyLimit', at)
  }
  const typed = values as unknown as readonly AgentTemplateProfile[]
  assertUnique(typed.map(item => `${String(item.templateId)}@${Number(item.revision)}`), 'template revision')
  return typed
}

function parseTacticalTags(source: string): readonly TacticalTag[] {
  const values = parseObjectArray(source, 'tactical tags')
  const statuses = new Set(['ACTIVE', 'PAUSED', 'DELETED'])
  for (const [index, value] of values.entries()) {
    const at = `tactical tags[${index}]`
    requireString(value, 'tagId', at)
    requirePositiveInteger(value, 'revision', at)
    requireString(value, 'displayName', at)
    requireEnum(value, 'status', statuses, at)
    requireStringArray(value, 'aliases', at)
    requireStringArray(value, 'matchTerms', at)
    requireStringArray(value, 'parentTagIds', at)
    requireString(value, 'createdAt', at)
    requireString(value, 'updatedAt', at)
  }
  const typed = values as unknown as readonly TacticalTag[]
  assertUnique(typed.map(item => String(item.tagId)), 'tag id')
  return typed
}

function parseObjectArray(source: string, label: string): readonly Record<string, unknown>[] {
  const value: unknown = JSON.parse(source)
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a JSON array`)
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TypeError(`${label}[${index}] must be an object`)
    }
    return item as Record<string, unknown>
  })
}

function requireRecord(value: Record<string, unknown>, key: string, at: string): Record<string, unknown> {
  const candidate = value[key]
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${at}.${key} must be an object`)
  }
  return candidate as Record<string, unknown>
}

function requireString(value: Record<string, unknown>, key: string, at: string): string {
  const candidate = value[key]
  if (typeof candidate !== 'string' || candidate.trim() === '') throw new TypeError(`${at}.${key} must be a non-empty string`)
  return candidate
}

function requirePositiveInteger(value: Record<string, unknown>, key: string, at: string): number {
  const candidate = value[key]
  if (!Number.isSafeInteger(candidate) || Number(candidate) < 1) throw new TypeError(`${at}.${key} must be a positive integer`)
  return Number(candidate)
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string, at: string): number {
  const candidate = value[key]
  if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) throw new TypeError(`${at}.${key} must be a non-negative integer`)
  return Number(candidate)
}

function requireStringArray(value: Record<string, unknown>, key: string, at: string): readonly string[] {
  const candidate = value[key]
  if (!Array.isArray(candidate) || !candidate.every(item => typeof item === 'string')) {
    throw new TypeError(`${at}.${key} must be a string array`)
  }
  return candidate
}

function requireEnum(value: Record<string, unknown>, key: string, allowed: ReadonlySet<string>, at: string): string {
  const candidate = requireString(value, key, at)
  if (!allowed.has(candidate)) throw new TypeError(`${at}.${key} has unsupported value ${JSON.stringify(candidate)}`)
  return candidate
}


function parseDepartments(source: string): Array<'staff' | 'worker-forces' | 'engineer-corps' | 'oversight' | 'logistics-research' | 'evaluation-committee'> {
  const allowed = new Set(['staff', 'worker-forces', 'engineer-corps', 'oversight', 'logistics-research', 'evaluation-committee'])
  return parseStringArray(source, 'departments').map((value) => {
    if (!allowed.has(value)) throw new TypeError(`unknown Military department: ${value}`)
    return value as 'staff' | 'worker-forces' | 'engineer-corps' | 'oversight' | 'logistics-research' | 'evaluation-committee'
  })
}

function parseStringArray(source: string, label: string): string[] {
  const value: unknown = JSON.parse(source)
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new TypeError(`${label} must be a JSON string array`)
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))]
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`duplicate ${label}: ${value}`)
    seen.add(value)
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof MilitaryError && error.failure.code === 'NOT_FOUND'
}
