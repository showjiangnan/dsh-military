import {
  brand,
  type AgentIdentity,
  type GeneralExecutionPolicy,
  type MilitaryAdministrativeLedger,
  type MilitaryArtifacts,
  type MilitaryLedger,
  type ModelCapabilityProfile,
  type PermissionProfile,
  type ResourceBudgetPolicy,
  type ToolProfile,
  type VerifierProfile,
} from '@dsh-military/contracts'
import {
  ExactRc2Compatibility,
  SingleWriterMissionKernel, LedgerMissionCommandHandler, DeterministicContextCompiler, AdaptiveExecutionRouter, InMemoryCapabilityGrantStore,
  GeneralRoutingService,
  InMemoryAgentExecutionBindings,
  InMemoryAgentTemplateRegistry,
  InMemoryCompactionAttempts,
  InMemoryDecisionBroker,
  InMemoryEvaluationAppeals,
  InMemoryMilitaryAuthorization,
  InMemoryMilitaryBrainstorm,
  InMemoryMilitaryPolicyRegistry,
  InMemoryMilitaryRadio,
  InMemoryMilitaryResourceBudgets,
  InMemoryMilitarySessionGate,
  InMemoryObservedEvidenceStore,
  InMemoryPresetGenerations,
  InMemoryTacticalTagRegistry,
  MilitaryEvaluationEngine,
  MilitaryOrchestrator,
  OversightController,
  VerificationEngine,
  type Rc2CapabilityProbe,
} from '@dsh-military/core'
import { ConservativeChiefAdviceProvider, ChiefOfStaffRuntime } from './chief-of-staff.js'
import { EvaluationDatasetRuntime } from './evaluation-dataset.js'
import {
  ObservationCatalog,
  DeterministicPerformanceNarrative,
} from './evaluation-source.js'
import { HeuristicTacticalExtractor, TacticalIngestionRuntime, type SessionSourceReader } from './ingestion.js'
import { KnowledgeSupplyChainRuntime } from './knowledge.js'
import { MilitaryContextMaterializer } from './context-materializer.js'
import { LocalIntegrationRuntime, CommandIntegrationChecks } from './integration.js'
import { LocalWorkspaceRuntime, type WorkspaceResolver } from './workspace.js'
import type { MilitaryApplication } from './application.js'

export interface DefaultMilitaryApplicationOptions {
  readonly tenantId: string
  readonly artifacts: MilitaryArtifacts
  readonly ledger: MilitaryLedger
  readonly administrativeLedger: MilitaryAdministrativeLedger
  readonly workspaceResolver: WorkspaceResolver
  readonly compatibilityProbe: () => Promise<Rc2CapabilityProbe>
  readonly sessionSourceReader?: SessionSourceReader
  readonly generalPolicy?: GeneralExecutionPolicy
  readonly integrationCommands?: Readonly<Record<string, readonly string[]>>
  readonly chiefIdentity?: AgentIdentity
}

export class DefaultMilitaryApplication implements MilitaryApplication {
  readonly tenantId: string
  readonly ledger
  readonly missionKernel
  readonly contextCompiler
  readonly executionRouter = new AdaptiveExecutionRouter()
  readonly capabilityGrants = new InMemoryCapabilityGrantStore()
  readonly administrativeLedger
  readonly artifacts
  readonly sessionGate = new InMemoryMilitarySessionGate()
  readonly compatibility
  readonly presetGenerations = new InMemoryPresetGenerations()
  readonly authorization = new InMemoryMilitaryAuthorization()
  readonly policies = new InMemoryMilitaryPolicyRegistry()
  readonly generalRouting
  readonly templates = new InMemoryAgentTemplateRegistry()
  readonly executionBindings = new InMemoryAgentExecutionBindings()
  readonly resourceBudgets = new InMemoryMilitaryResourceBudgets()
  readonly verification
  readonly observedEvidence = new InMemoryObservedEvidenceStore()
  readonly oversight = new OversightController()
  readonly radio = new InMemoryMilitaryRadio()
  readonly decisionBroker = new InMemoryDecisionBroker()
  readonly brainstorm = new InMemoryMilitaryBrainstorm()
  readonly chiefOfStaff
  readonly tags = new InMemoryTacticalTagRegistry()
  readonly ingestion
  readonly knowledge
  readonly observationCatalog = new ObservationCatalog()
  readonly evaluationDataset
  readonly evaluation
  readonly evaluationAppeals = new InMemoryEvaluationAppeals()
  readonly compactionAttempts = new InMemoryCompactionAttempts()
  readonly workspaces
  readonly integration
  readonly runtime

  constructor(options: DefaultMilitaryApplicationOptions) {
    this.tenantId = options.tenantId
    this.ledger = options.ledger
    this.administrativeLedger = options.administrativeLedger
    this.artifacts = options.artifacts
    this.missionKernel = new SingleWriterMissionKernel(new LedgerMissionCommandHandler(options.ledger))
    this.contextCompiler = new DeterministicContextCompiler(new MilitaryContextMaterializer(options.artifacts))
    this.compatibility = new ExactRc2Compatibility(options.compatibilityProbe)
    const policy = options.generalPolicy ?? defaultGeneralPolicy()
    this.generalRouting = new GeneralRoutingService(policy, this.policies)
    this.verification = new VerificationEngine(options.artifacts, this.observedEvidence)
    this.runtime = new MilitaryOrchestrator({ ledger: options.ledger, verification: this.verification, oversight: this.oversight, brainstorm: this.brainstorm })
    this.workspaces = new LocalWorkspaceRuntime({ resolver: options.workspaceResolver, artifacts: options.artifacts })
    this.integration = new LocalIntegrationRuntime({ resolver: options.workspaceResolver, workspaces: this.workspaces, artifacts: options.artifacts,
      checks: new CommandIntegrationChecks(options.integrationCommands ?? {}) })
    this.ingestion = new TacticalIngestionRuntime({ artifacts: options.artifacts, tags: this.tags, extractor: new HeuristicTacticalExtractor(options.artifacts),
      sessions: options.sessionSourceReader ?? { read: async () => new TextEncoder().encode('[]') } })
    this.knowledge = new KnowledgeSupplyChainRuntime(options.artifacts)
    this.evaluationDataset = new EvaluationDatasetRuntime(
      this.observationCatalog,
      options.artifacts,
      options.tenantId,
    )
    this.evaluation = new MilitaryEvaluationEngine(
      this.evaluationDataset,
      new DeterministicPerformanceNarrative(),
    )
    this.chiefOfStaff = new ChiefOfStaffRuntime(new ConservativeChiefAdviceProvider(options.chiefIdentity ?? defaultChiefIdentity()))
    this.#seed(policy)
  }

  #seed(policy: GeneralExecutionPolicy): void {
    const now = brand<string, 'IsoDateTime'>(new Date().toISOString())
    const revision = brand<number, 'Revision'>(1)
    const tool: ToolProfile = { schemaVersion: '1.0.0', toolProfileId: 'military-standard-tools', revision, status: 'ACTIVE',
      allowTools: ['military_get_order', 'military_record_observation', 'military_submit_candidate', 'military_submit_blocker', 'military_radio_request', 'military_submit_decision_questions'],
      denyTools: [], maxParallelCalls: 4, timeoutOverrides: {}, createdAt: now }
    const permission: PermissionProfile = { schemaVersion: '1.0.0', permissionProfileId: 'military-workspace-write', revision, status: 'ACTIVE', defaultDecision: 'DENY',
      filesystem: { readPaths: ['.'], writePaths: ['.'], denyPaths: ['.git', '.dsh-military/control'], followSymlinks: false },
      git: { allowLocalRead: true, allowLocalMainCommit: false, allowBranchCreate: false, allowRemoteWrite: false, allowDestructiveReset: false },
      network: { allowGrantIds: [], denyUnlisted: true }, classificationCeiling: 'confidential', createdAt: now }
    const builtinModels: ModelCapabilityProfile[] = [
      {
        schemaVersion: '1.0.0', profileId: 'deepseek-v4-flash-rc2', revision,
        status: 'CANARY', provider: 'deepseek-official', model: 'deepseek-v4-flash',
        supportedReasoning: ['off', 'low', 'high', 'max'],
        contextWindowTokens: 1_000_000, maxOutputTokens: 256_000,
        toolCalling: true, vision: false, inputModalities: ['text'],
        reasoningPassback: 'all-reasoning-turns',
        maximumRequestImageBytes: 20_971_520,
        dataResidencyPolicyRefs: ['dsh-provider-default@1'],
        benchmarks: [], validatedAt: now,
      },
      {
        schemaVersion: '1.0.0', profileId: 'deepseek-v4-pro-rc2', revision,
        status: 'VALIDATED', provider: 'deepseek-official', model: 'deepseek-v4-pro',
        supportedReasoning: ['off', 'low', 'high', 'max'],
        contextWindowTokens: 1_000_000, maxOutputTokens: 256_000,
        toolCalling: true, vision: false, inputModalities: ['text'],
        reasoningPassback: 'all-reasoning-turns',
        maximumRequestImageBytes: 20_971_520,
        dataResidencyPolicyRefs: ['dsh-provider-default@1'],
        benchmarks: [], validatedAt: now,
      },
    ]
    if (!builtinModels.some(model =>
      model.provider === policy.defaultModel.provider
      && model.model === policy.defaultModel.model)) {
      builtinModels.push({
        schemaVersion: '1.0.0',
        profileId: `configured-${policy.defaultModel.provider}-${policy.defaultModel.model}`,
        revision, status: 'VALIDATED',
        provider: policy.defaultModel.provider, model: policy.defaultModel.model,
        supportedReasoning: ['off', 'low', 'high', 'max'],
        contextWindowTokens: Math.max(
          1_000_000,
          policy.contextPolicy.contextBudgetTokens,
        ),
        maxOutputTokens: policy.defaultModel.maxOutputTokens,
        toolCalling: true, vision: false, inputModalities: ['text'],
        reasoningPassback: 'all-reasoning-turns',
        maximumRequestImageBytes: 20_971_520,
        dataResidencyPolicyRefs: ['dsh-provider-default@1'],
        benchmarks: [], validatedAt: now,
      })
    }
    const verifier: VerifierProfile = { schemaVersion: '1.0.0', verifierProfileId: 'military-default-verifier', revision, status: 'ACTIVE', taskTypes: ['*'],
      checks: [{ checkId: 'evidence-contract', kind: 'POLICY', required: true, timeoutSeconds: 60 }], acceptanceRule: 'ALL_REQUIRED', createdAt: now }
    const budget: ResourceBudgetPolicy = { schemaVersion: '1.0.0', policyId: 'budget-default', revision, status: 'ACTIVE', scope: 'TASK',
      limits: { modelRequests: 64, reasoningTokens: 1_000_000, wallClockSeconds: 7200, toolCalls: 512, apiCalls: 128, concurrentAgents: 16, radioRounds: 8, reworkAttempts: 8, storageBytes: 2_000_000_000 },
      warningPercent: 80, hardStopPercent: 100, disposition: 'PAUSE_AND_REPORT', createdAt: now }
    this.policies.registerTool(tool); this.policies.registerPermission(permission)
    for (const model of builtinModels) this.policies.registerModel(model)
    this.policies.registerVerifier(verifier); this.policies.registerBudget(budget)
    this.resourceBudgets.registerPolicy(budget)
  }
}

export function defaultGeneralPolicy(): GeneralExecutionPolicy {
  return { schemaVersion: '1.0.0', presetId: 'military',
    defaultModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', maxOutputTokens: 16_384 },
    modelSelection: { userSessionSwitchEnabled: true, explicitSessionSelectionWins: true, rejectUnsupportedReasoning: true, recordSelectionEvent: true, allowGlobalDefaultFallback: false },
    minimumReasoning: 'high',
    maximumSteps: 24,
    contextPolicy: { contextBudgetTokens: 128_000, compactionTriggerPercent: 78, retainedTailTokens: 24_000, minimumRearmDeltaPercent: 8, maxCompactionAttemptsPerTurn: 1, onCompactionFailure: 'PAUSE_AND_ESCALATE' },
    fallback: { enabled: false, compatibleProfileIds: [], requireUserApprovalForRestrictedData: true },
    dshBaseline: { release: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' } }
}

function defaultChiefIdentity(): AgentIdentity { return { agentId: brand<string, 'AgentId'>('chief-of-staff'), sessionId: brand<string, 'SessionId'>('chief-of-staff-system'), role: 'chief-of-staff', displayName: '参谋长', generation: 1 } }
