import {
  brand,
  type AgentTemplateProfile,
  type GeneralExecutionPolicy,
  type ModelCapabilityProfile,
  type PermissionProfile,
  type ResourceBudgetPolicy,
  type ToolProfile,
  generalMilitaryToolNames, workerMilitaryToolNames, engineerMilitaryToolNames,
  staffMilitaryToolNames, inspectorMilitaryToolNames, researchMilitaryToolNames,
  type VerifierProfile,
} from '@dsh-military/contracts'

const initialRevision = brand<number, 'Revision'>(1)
// Policy and template revisions are immutable, so upgrades must install a new
// revision instead of rewriting records already stored in SQLite. Tool revision
// 6 retains RC.2's child-scoped `report` and adds Task-gated large Specs
// staging; template revision 6 makes the lightweight, tool-capable Flash route
// the governed default.
const flashModelRevision = brand<number, 'Revision'>(3)
export const defaultToolProfileRevision = brand<number, 'Revision'>(6)
const toolProfileRevision = defaultToolProfileRevision
const templateRevision = brand<number, 'Revision'>(6)
// Built-in policy revisions are immutable package assets. A stable timestamp
// keeps repeat startup seeding and packed release bytes reproducible.
const defaultProfileTimestamp = brand<string, 'IsoDateTime'>('2026-08-24T00:00:00.000Z')

const rc2ReadOnlyTools = [
  'read', 'read_image', 'glob', 'grep', 'web_search', 'skill', 'report',
] as const
const rc2WorkerTools = [...rc2ReadOnlyTools, 'write', 'edit'] as const
export const rc2GeneralToolNames = Object.freeze([
  'ask_user_question',
  ...generalMilitaryToolNames,
] as const)

export const defaultGeneralPolicy = Object.freeze({
  schemaVersion: '1.0.0',
  presetId: 'military',
  defaultModel: {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    maxOutputTokens: 16_384,
  },
  modelSelection: {
    userSessionSwitchEnabled: true,
    explicitSessionSelectionWins: true,
    rejectUnsupportedReasoning: true,
    recordSelectionEvent: true,
    allowGlobalDefaultFallback: false,
  },
  minimumReasoning: 'high',
  maximumSteps: 24,
  contextPolicy: {
    contextBudgetTokens: 128_000,
    compactionTriggerPercent: 78,
    retainedTailTokens: 24_000,
    minimumRearmDeltaPercent: 8,
    maxCompactionAttemptsPerTurn: 1,
    onCompactionFailure: 'PAUSE_AND_ESCALATE',
  },
  fallback: {
    enabled: false,
    compatibleProfileIds: [],
    requireUserApprovalForRestrictedData: true,
  },
  dshBaseline: {
    release: '0.1.1-rc.2',
    commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  },
} satisfies GeneralExecutionPolicy)

export function defaultModelProfiles(): readonly ModelCapabilityProfile[] {
  const stamp = defaultProfileTimestamp
  const make = (
    profileId: string,
    model: string,
    maxOutputTokens: number,
    revision: ModelCapabilityProfile['revision'],
    options: Pick<ModelCapabilityProfile, 'status' | 'benchmarks'>,
  ): ModelCapabilityProfile => ({
    schemaVersion: '1.0.0', profileId, revision, status: options.status,
    provider: 'deepseek-official', model,
    supportedReasoning: ['off', 'low', 'high', 'max'],
    contextWindowTokens: 1_000_000, maxOutputTokens,
    toolCalling: true, vision: false, inputModalities: ['text'], reasoningPassback: 'all-reasoning-turns', maximumRequestImageBytes: 20_971_520,
    dataResidencyPolicyRefs: ['dsh-provider-default@1'],
    benchmarks: [...options.benchmarks], validatedAt: stamp,
  })
  return [
    make('deepseek-v4-pro-rc2', 'deepseek-v4-pro', 256_000, initialRevision, {
      status: 'VALIDATED',
      benchmarks: [],
    }),
    make('deepseek-v4-flash-rc2', 'deepseek-v4-flash', 256_000, flashModelRevision, {
      // The user-supplied pre-fix session remains a failure baseline. CANARY
      // keeps that fact visible while templates opt in explicitly; the route
      // is never selected through an implicit fallback.
      status: 'CANARY',
      benchmarks: [{
        taskType: 'pre-fix-brainstorm-tool-contract',
        reasoning: 'max',
        sampleCount: 1,
        finalAcceptanceRate: 0,
        falseCompletionRate: 0,
      }],
    }),
  ]
}

export function defaultToolProfiles(): readonly ToolProfile[] {
  const stamp = defaultProfileTimestamp
  const profile = (
    id: string,
    allowTools: readonly string[],
    maxParallelCalls: number,
    timeoutOverrides: Readonly<Record<string, number>> = {},
  ): ToolProfile => ({
    schemaVersion: '1.0.0', toolProfileId: id, revision: toolProfileRevision, status: 'ACTIVE',
    allowTools: [...allowTools], denyTools: [], maxParallelCalls,
    timeoutOverrides: { ...timeoutOverrides }, createdAt: stamp,
  })
  return [
    profile('general-tools', rc2GeneralToolNames, 4, {
      military_spawn_department_agent: 180_000,
      military_evaluation_start: 600_000,
    }),
    profile('staff-tools', [...rc2ReadOnlyTools, ...staffMilitaryToolNames], 4, {
      web_search: 120_000,
      military_staff_issue_guidance: 120_000,
    }),
    profile('worker-tools', [...rc2WorkerTools, ...workerMilitaryToolNames], 4, {
      web_search: 120_000,
      write: 120_000,
      edit: 120_000,
      military_submit_candidate: 180_000,
    }),
    profile('engineer-tools', [...rc2ReadOnlyTools, ...engineerMilitaryToolNames], 2, {
      military_specs_stage_chunk: 120_000,
      military_specs_apply_order: 600_000,
    }),
    profile('inspector-tools', [...rc2ReadOnlyTools, ...inspectorMilitaryToolNames], 2, {
      military_submit_inspection: 180_000,
    }),
    profile('research-tools', [...rc2ReadOnlyTools, ...researchMilitaryToolNames], 4, {
      web_search: 120_000,
      military_submit_research_artifact: 180_000,
    }),
    profile('evaluation-tools', [...rc2ReadOnlyTools, ...researchMilitaryToolNames], 4, {
      web_search: 120_000,
      military_submit_research_artifact: 180_000,
    }),
  ]
}

export function defaultPermissionProfiles(): readonly PermissionProfile[] {
  const stamp = defaultProfileTimestamp
  const profile = (
    id: string,
    writePaths: readonly string[],
    classificationCeiling: PermissionProfile['classificationCeiling'],
    allowLocalMainCommit = false,
  ): PermissionProfile => ({
    schemaVersion: '1.0.0', permissionProfileId: id, revision: initialRevision, status: 'ACTIVE',
    defaultDecision: 'DENY',
    filesystem: {
      readPaths: ['.'], writePaths,
      denyPaths: ['.git', '.dsh-military/control', '.dsh-military/secrets'],
      followSymlinks: false,
    },
    git: {
      allowLocalRead: true,
      allowLocalMainCommit,
      allowBranchCreate: false,
      allowRemoteWrite: false,
      allowDestructiveReset: false,
    },
    network: { allowGrantIds: [], denyUnlisted: true },
    classificationCeiling,
    createdAt: stamp,
  })
  return [
    profile('staff-readonly', [], 'confidential'),
    profile('worker-worktree-write', ['.'], 'confidential'),
    profile('engineer-specs-main', ['specs', 'docs'], 'confidential', true),
    profile('inspector-readonly', [], 'confidential'),
    profile('research-readonly', [], 'restricted'),
    profile('evaluation-readonly', [], 'restricted'),
  ]
}

export function defaultVerifierProfiles(): readonly VerifierProfile[] {
  const stamp = defaultProfileTimestamp
  return [{
    schemaVersion: '1.0.0', verifierProfileId: 'verifier-default', revision: initialRevision, status: 'ACTIVE',
    taskTypes: ['*'],
    checks: [
      { checkId: 'evidence-contract', kind: 'POLICY', required: true, timeoutSeconds: 60 },
      { checkId: 'path-scope', kind: 'POLICY', required: true, timeoutSeconds: 30 },
      { checkId: 'artifact-integrity', kind: 'ARTIFACT', required: true, timeoutSeconds: 60 },
    ],
    acceptanceRule: 'ALL_REQUIRED', createdAt: stamp,
  }]
}

export function defaultBudgetPolicies(): readonly ResourceBudgetPolicy[] {
  const stamp = defaultProfileTimestamp
  return [{
    schemaVersion: '1.0.0', policyId: 'budget-default', revision: initialRevision,
    status: 'ACTIVE', scope: 'TASK',
    limits: {
      modelRequests: 64,
      reasoningTokens: 1_000_000,
      wallClockSeconds: 7_200,
      toolCalls: 512,
      apiCalls: 128,
      concurrentAgents: 16,
      radioRounds: 8,
      reworkAttempts: 8,
      storageBytes: 2_000_000_000,
    },
    warningPercent: 80,
    hardStopPercent: 100,
    disposition: 'PAUSE_AND_REPORT',
    createdAt: stamp,
  }]
}

export function defaultTemplates(): readonly AgentTemplateProfile[] {
  const stamp = defaultProfileTimestamp
  const context = {
    contextBudgetTokens: 96_000,
    compactionTriggerPercent: 78,
    retainedTailTokens: 20_000,
    minimumRearmDeltaPercent: 8,
    maxCompactionAttemptsPerTurn: 1,
    onCompactionFailure: 'PAUSE_AND_ESCALATE' as const,
  }
  const make = (input: {
    id: string
    displayName: string
    department: AgentTemplateProfile['department']
    role: AgentTemplateProfile['role']
    tool: string
    permission: string
    taskTypes: readonly string[]
    reasoning?: AgentTemplateProfile['modelPolicy']['reasoningEffort']
    concurrency?: number
  }): AgentTemplateProfile => ({
    schemaVersion: '1.0.0',
    templateId: brand<string, 'AgentTemplateId'>(input.id), revision: templateRevision,
    displayName: input.displayName, department: input.department, role: input.role,
    status: 'ACTIVE',
    modelPolicy: {
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
      reasoningEffort: input.reasoning ?? 'high', maxOutputTokens: 16_384,
      fallbackTemplateIds: [], dataResidency: 'external-allowed',
      modelCapabilityProfileId: 'deepseek-v4-flash-rc2',
      dataResidencyPolicyRef: 'dsh-provider-default@1',
      allowFallback: false,
      allowCanaryModel: true,
    },
    contextPolicy: context,
    capabilities: {
      toolProfileId: input.tool, toolProfileRevision,
      permissionProfileId: input.permission, permissionProfileRevision: initialRevision,
      tacticalSkillPatterns: ['*'], apiGrantIds: [],
      verifierProfileIds: ['verifier-default'],
    },
    domainTagIds: [], taskTypes: input.taskTypes,
    concurrencyLimit: input.concurrency ?? 4,
    createdAt: stamp, updatedAt: stamp,
  })
  return [
    make({ id: 'advisor-generalist', displayName: '通用技术参谋', department: 'staff', role: 'advisor', tool: 'staff-tools', permission: 'staff-readonly', taskTypes: ['advice', 'planning'] }),
    make({ id: 'advisor-react', displayName: 'React 前端参谋', department: 'staff', role: 'advisor', tool: 'staff-tools', permission: 'staff-readonly', taskTypes: ['web-frontend', 'react'] }),
    make({ id: 'chief-of-staff', displayName: '参谋长', department: 'staff', role: 'chief-of-staff', tool: 'staff-tools', permission: 'staff-readonly', taskTypes: ['fallback-advice'], reasoning: 'max', concurrency: 2 }),
    make({ id: 'worker-default', displayName: '快速反应部队', department: 'worker-forces', role: 'worker', tool: 'worker-tools', permission: 'worker-worktree-write', taskTypes: ['*'], concurrency: 16 }),
    make({ id: 'engineer-default', displayName: '工兵部', department: 'engineer-corps', role: 'engineer', tool: 'engineer-tools', permission: 'engineer-specs-main', taskTypes: ['specs', 'integration'], concurrency: 2 }),
    make({ id: 'inspector-default', displayName: '督战队', department: 'oversight', role: 'inspector', tool: 'inspector-tools', permission: 'inspector-readonly', taskTypes: ['inspection'], concurrency: 8 }),
    make({ id: 'trajectory-memory', displayName: '战术轨迹记忆总结', department: 'logistics-research', role: 'trajectory', tool: 'research-tools', permission: 'research-readonly', taskTypes: ['memory'] }),
    make({ id: 'effectiveness-assessor', displayName: '战术效能评估', department: 'logistics-research', role: 'effectiveness', tool: 'research-tools', permission: 'research-readonly', taskTypes: ['effectiveness'] }),
    make({ id: 'tactical-museum', displayName: '战术博物馆', department: 'logistics-research', role: 'museum', tool: 'research-tools', permission: 'research-readonly', taskTypes: ['tactical-research'], reasoning: 'max' }),
    make({ id: 'evaluation-examiner', displayName: '绩效评估委员', department: 'evaluation-committee', role: 'evaluation-examiner', tool: 'evaluation-tools', permission: 'evaluation-readonly', taskTypes: ['evaluation'] }),
    make({ id: 'evaluation-chair', displayName: '军事评估委员会主席', department: 'evaluation-committee', role: 'evaluation-chair', tool: 'evaluation-tools', permission: 'evaluation-readonly', taskTypes: ['evaluation-report'], reasoning: 'max', concurrency: 2 }),
  ]
}
