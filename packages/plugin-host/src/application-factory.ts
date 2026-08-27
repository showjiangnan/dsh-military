import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-llm'
import {
  InMemoryTacticalRegistry,
  MilitaryEvaluationEngine,
  MilitaryOrchestrator,
  OversightController,
  VerificationEngine,
  ExactRc2Compatibility,
  SingleWriterMissionKernel, LedgerMissionCommandHandler, DeterministicContextCompiler,
  AdaptiveExecutionRouter,
  GeneralRoutingService,
} from '@dsh-military/core'
import {
  brand,
  type PresetGenerationManifest,
  type TacticalTag,
} from '@dsh-military/contracts'
import {
  FilePresetGenerationArchive,
  GitWorktreeManager,
  LocalArtifactStore,
  LocalMainIntegration,
  LocalPrivateSkillBundleStore,
} from '@dsh-military/infrastructure'
import {
  SqliteAdministrativeLedger,
  SqliteAgentExecutionBindings,
  SqliteAgentTemplateRegistry,
  SqliteCapabilityGrantStore,
  SqliteCompactionAttempts,
  SqliteDecisionBroker,
  SqliteEvaluationAppeals,
  SqliteEvaluationDatasetArchive,
  SqliteEvaluationRecordStore,
  SqliteGeneralModelSelectionStore,
  SqliteIntegrationStateStore,
  SqliteMilitaryAuthorization,
  SqliteMilitaryBrainstorm,
  SqliteMilitaryDatabase,
  SqliteMilitaryLedger,
  SqliteMilitaryPolicyRegistry,
  SqliteMilitaryRadio,
  SqliteMilitaryResourceBudgets,
  SqliteMilitaryRuntimeStateStore,
  SqliteMilitarySessionGate,
  SqliteObservedEvidenceStore,
  SqliteOversightRecordStore,
  SqlitePrivateSkillRepository,
  SqliteTacticalProcedureStore,
  SqliteTacticalTagRegistry,
} from '@dsh-military/storage-sqlite'
import {
  ChiefOfStaffRuntime,
  ConservativeChiefAdviceProvider,
  CompositeEvaluationDataSource,
  CanonicalEvaluationSchemaValidation,
  EvaluationDatasetRuntime,
  HeuristicTacticalExtractor,
  KnowledgeSupplyChainRuntime,
  ObservationCatalog,
  TacticalIngestionRuntime,
  MilitaryContextMaterializer,
  assertCompleteApplication,
  type MilitaryApplication,
} from '@dsh-military/runtime'
import { DshEvaluationObservationSource, DshSessionSourceReader } from './session-adapters.js'
import { DshFlashTacticalExtractor } from './private-skill-extractor.js'
import { GovernedPerformanceNarrative } from './performance-narrative.js'
import { MilitarySpecsControl } from './specs-control.js'
import {
  defaultBudgetPolicies,
  defaultGeneralPolicy,
  defaultModelProfiles,
  defaultPermissionProfiles,
  defaultTemplates,
  defaultToolProfiles,
  defaultVerifierProfiles,
} from './defaults.js'

export interface ApplicationFactoryConfig {
  readonly tenantId: string
  readonly dataRoot: string
  readonly repositoryRoot: string
  readonly presetAssetsRoot: string
  readonly databasePath?: string
  readonly maxRadioAttempts?: number
  readonly radioLeaseSeconds?: number
  readonly regressionChecks?: readonly (readonly string[])[]
}

export interface ApplicationFactoryResult {
  readonly application: MilitaryApplication
  readonly database: SqliteMilitaryDatabase
  /** Concrete durable registry used by the live DSH model-catalog bridge. */
  readonly policyRegistry: SqliteMilitaryPolicyRegistry
  /** Mutable operational limits for the durable Radio; authority stays in MilitaryApplication. */
  readonly radioControl: SqliteMilitaryRadio
  readonly observationCatalog: ObservationCatalog
  readonly verificationEngine: VerificationEngine
  readonly presetManifest: PresetGenerationManifest
  readonly tactics: InMemoryTacticalRegistry
  readonly specs: MilitarySpecsControl
  readonly privateSkillExtractor: DshFlashTacticalExtractor
}

const require = createRequire(import.meta.url)

export async function createMilitaryApplication(ctx: Context, config: ApplicationFactoryConfig): Promise<ApplicationFactoryResult> {
  const dataRoot = resolve(config.dataRoot)
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  const database = new SqliteMilitaryDatabase({ path: config.databasePath ?? join(dataRoot, 'military.sqlite') })
  const ledger = new SqliteMilitaryLedger(database, config.tenantId)
  const runtimeState = new SqliteMilitaryRuntimeStateStore(database, config.tenantId)
  const administrativeLedger = new SqliteAdministrativeLedger(database, config.tenantId)
  const artifacts = new LocalArtifactStore(join(dataRoot, 'artifacts'))
  const missionKernel = new SingleWriterMissionKernel(new LedgerMissionCommandHandler(ledger))
  const contextCompiler = new DeterministicContextCompiler(new MilitaryContextMaterializer(artifacts))
  const executionRouter = new AdaptiveExecutionRouter()
  const capabilityGrants = new SqliteCapabilityGrantStore(database, config.tenantId)
  const packagedPresetManifest = JSON.parse(await readFile(join(config.presetAssetsRoot, 'generation-manifest.json'), 'utf8')) as PresetGenerationManifest
  const presetGenerations = new FilePresetGenerationArchive(join(dataRoot, 'preset-generations'))
  const presetManifest = await presetGenerations.archiveAssets(config.presetAssetsRoot, packagedPresetManifest)
  indexPresetGeneration(database, presetManifest)

  const sessionGate = new SqliteMilitarySessionGate(database, config.tenantId)
  const executionBindings = new SqliteAgentExecutionBindings(database, config.tenantId)
  const policies = new SqliteMilitaryPolicyRegistry(database, config.tenantId)
  for (const value of defaultToolProfiles()) policies.registerTool(value)
  for (const value of defaultPermissionProfiles()) policies.registerPermission(value)
  for (const value of defaultModelProfiles()) policies.registerModel(value)
  for (const value of defaultVerifierProfiles()) policies.registerVerifier(value)
  for (const value of defaultBudgetPolicies()) policies.registerBudget(value)

  const templates = new SqliteAgentTemplateRegistry(database, config.tenantId)
  const existingTemplates = new Map(
    (await templates.list({ includeInactive: true }))
      .map(value => [String(value.templateId), value] as const),
  )
  for (const template of defaultTemplates()) {
    const existing = existingTemplates.get(String(template.templateId))
    if (existing === undefined) {
      await templates.create(template)
      continue
    }
    if (Number(existing.revision) >= Number(template.revision)) continue
    if (Number(existing.revision) + 1 !== Number(template.revision)) {
      throw new Error(
        `cannot seed template ${String(template.templateId)} across revision gap `
        + `${Number(existing.revision)} -> ${Number(template.revision)}`,
      )
    }
    await templates.revise(
      { ...template, status: existing.status },
      existing.revision,
    )
  }
  const resourceBudgets = new SqliteMilitaryResourceBudgets(database, config.tenantId)
  for (const policy of defaultBudgetPolicies()) resourceBudgets.registerPolicy(policy)
  const authorization = new SqliteMilitaryAuthorization(database, config.tenantId)
  const generalRouting = new GeneralRoutingService(defaultGeneralPolicy, policies, {
    selections: new SqliteGeneralModelSelectionStore(database, config.tenantId),
  })
  const userQuestions = ctx.get('userQuestions')
  const compatibility = new ExactRc2Compatibility(async () => ({
    observedRelease: detectDshRelease(),
    agentPresets: ctx.agentPresets !== undefined,
    composeFrom: typeof ctx.agentPresets?.composeFrom === 'function',
    // RC.2 records only the public preset id on root Sessions; archived-only
    // generations therefore require quarantine and explicit migration.
    exactGenerationAccessible: false,
    userQuestions: userQuestions !== undefined,
    delegatedChildQuestions: false,
    presetCompaction: true,
    compactionEventContract: 'rc2-compaction-v1',
    continuableSubagents: ctx.subagents !== undefined,
    subagentReport: typeof ctx.subagents?.reportFrom === 'function',
    callerReservedChildId: typeof ctx.subagents?.startContinuable === 'function',
    reportDeliveries: ['quiet', 'next-step'] as const,
    selectiveDirectChildDrain: typeof ctx.subagents?.drainContinuableChildren === 'function',
    commandAttachments: ctx.commands !== undefined,
    commandImageAdmission: ctx.commands !== undefined,
    reasoningPassbackAllReasonedTurns: true,
    imageInputByModelCapability: true,
    sessionPersistence: ctx.sessionPersistence !== undefined,
    externalRequiredSessionEventRegistration: false,
    militaryAuthorityUsesOwnLedger: true,
    settingsCards: ctx.settings !== undefined,
    conversationNodes: false,
    sharedSettingsDescribeMirror: true,
    manifestDeclaredExternals: true,
}))

  const tags = new SqliteTacticalTagRegistry(database, config.tenantId)
  const tactics = new InMemoryTacticalRegistry(
    new SqliteTacticalProcedureStore(database, config.tenantId),
    callback => { database.afterCommit(callback) },
  )
  const existingTagIds = new Set((await tags.list()).map(value => String(value.tagId)))
  for (const tag of defaultTags()) {
    if (!existingTagIds.has(String(tag.tagId))) await tags.create(tag)
  }
  const observedEvidence = new SqliteObservedEvidenceStore(database, config.tenantId)
  const verificationEngine = new VerificationEngine(artifacts, observedEvidence)
  verificationEngine.registerContract({
    contractId: 'default-acceptance', version: 1, requireIndependentVerification: true,
    clauses: [
      { clauseId: 'objective', description: 'Objective is demonstrably satisfied', required: true, kind: 'EVIDENCE' },
      { clauseId: 'tests', description: 'Required checks pass', required: true, kind: 'TOOL_CALL' },
      { clauseId: 'scope', description: 'Writes remain inside task scope', required: true, kind: 'PATH_SCOPE' },
    ],
  })
  const oversight = new OversightController({
    records: new SqliteOversightRecordStore(database, config.tenantId),
  })
  const brainstorm = new SqliteMilitaryBrainstorm(database, config.tenantId)
  const radio = new SqliteMilitaryRadio(database, config.tenantId, {
    leaseMs: (config.radioLeaseSeconds ?? 120) * 1000,
    maxAttempts: config.maxRadioAttempts ?? 5,
  })
  const decisionBroker = new SqliteDecisionBroker(database, config.tenantId)
  const chiefIdentity = {
    agentId: brand<string, 'AgentId'>('chief-of-staff-fallback'),
    sessionId: brand<string, 'SessionId'>('chief-of-staff-fallback-session'),
    role: 'chief-of-staff' as const,
    displayName: '参谋长', generation: 1,
  }
  const chiefOfStaff = new ChiefOfStaffRuntime(new ConservativeChiefAdviceProvider(chiefIdentity))
  const sessions = new DshSessionSourceReader(ctx)
  const privateSkillRepository = new SqlitePrivateSkillRepository(database, config.tenantId)
  const knowledge = new KnowledgeSupplyChainRuntime(artifacts, {
    repository: privateSkillRepository,
    tactics,
  })
  const privateSkillExtractor = new DshFlashTacticalExtractor(ctx, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    maxTokens: 2_048,
  })
  const ingestion = new TacticalIngestionRuntime({
    artifacts,
    rawVault: new LocalArtifactStore(join(dataRoot, 'private-skill-raw')),
    bundles: new LocalPrivateSkillBundleStore(join(dataRoot, 'private-skills'), artifacts),
    tags,
    extractor: privateSkillExtractor,
    fallbackExtractor: new HeuristicTacticalExtractor(),
    sessions,
    repository: privateSkillRepository,
    tactics,
    knowledge,
  })
  const observationCatalog = new ObservationCatalog()
  const evaluationSource = new CompositeEvaluationDataSource([
    new DshEvaluationObservationSource(ctx, database, config.tenantId),
    observationCatalog,
  ])
  const evaluationDataset = new EvaluationDatasetRuntime(
    evaluationSource,
    artifacts,
    config.tenantId,
    undefined,
    new SqliteEvaluationDatasetArchive(database, config.tenantId),
  )
  const evaluation = new MilitaryEvaluationEngine(
    evaluationDataset,
    new GovernedPerformanceNarrative(ctx, templates),
    undefined,
    new SqliteEvaluationRecordStore(database, config.tenantId, artifacts),
    new CanonicalEvaluationSchemaValidation(),
  )
  const evaluationAppeals = new SqliteEvaluationAppeals(database, config.tenantId)
  const compactionAttempts = new SqliteCompactionAttempts(database, config.tenantId)
  const workspaces = new GitWorktreeManager({ repositoryRoot: config.repositoryRoot, stateRoot: join(dataRoot, 'workspace-state'), artifacts })
  const specs = new MilitarySpecsControl(config.regressionChecks)
  const integration = new LocalMainIntegration({
    repositoryRoot: config.repositoryRoot,
    workspaces,
    artifacts,
    state: new SqliteIntegrationStateStore(database, config.tenantId),
    ...(config.regressionChecks === undefined ? {} : { regressionChecks: config.regressionChecks }),
  })
  await integration.reconcilePending(new AbortController().signal)
  const runtime = new MilitaryOrchestrator({
    ledger,
    verification: verificationEngine,
    oversight,
    brainstorm,
    state: runtimeState,
  })

  const application: MilitaryApplication = assertCompleteApplication({
    ledger, missionKernel, contextCompiler, executionRouter, capabilityGrants, administrativeLedger, artifacts, sessionGate, compatibility, presetGenerations,
    authorization, policies, generalRouting, templates, executionBindings, resourceBudgets,
    verification: verificationEngine, observedEvidence, oversight, radio, decisionBroker, brainstorm, chiefOfStaff,
    tags, ingestion, knowledge, evaluationDataset, evaluation, evaluationAppeals,
    compactionAttempts, workspaces, integration, runtime,
  })
  return {
    application,
    database,
    policyRegistry: policies,
    radioControl: radio,
    observationCatalog,
    verificationEngine,
    presetManifest,
    tactics,
    specs,
    privateSkillExtractor,
  }
}

function detectDshRelease(): string {
  const manifest = require('@deepseek-ai/dsh-agent/package.json') as unknown
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) return 'unknown'
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}

function indexPresetGeneration(database: SqliteMilitaryDatabase, manifest: PresetGenerationManifest): void {
  database.db.prepare(`
    INSERT INTO preset_generations(
      generation, public_preset_id, hidden_archive_id, asset_hash, bundle_version,
      dsh_commit, status, manifest_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(generation) DO NOTHING
  `).run(
    manifest.generation, manifest.publicSelectionId, manifest.hiddenArchiveId, String(manifest.assetHash),
    manifest.bundleVersion, manifest.dshBaseline.commit, manifest.status, JSON.stringify(manifest), String(manifest.createdAt),
  )
}

function defaultTags(): readonly TacticalTag[] {
  const timestamp = brand<string, 'IsoDateTime'>('2026-08-24T00:00:00.000Z')
  const tag = (id: string, displayName: string, matchTerms: readonly string[]): TacticalTag => ({
    schemaVersion: '1.0.0', tagId: brand<string, 'TacticalTagId'>(id), revision: brand<number, 'Revision'>(1),
    displayName, status: 'ACTIVE', aliases: [], matchTerms, parentTagIds: [], createdAt: timestamp, updatedAt: timestamp,
  })
  return [
    tag('react', 'React', ['react', 'jsx', 'tsx', 'hooks']),
    tag('web-frontend', 'Web 前端', ['frontend', 'css', 'browser']),
    tag('web-backend', 'Web 后端', ['backend', 'api', 'server']),
    tag('security', '网络安全', ['security', 'auth', 'vulnerability']),
    tag('visual', '视觉效果', ['visual', 'animation', 'design']),
  ]
}
