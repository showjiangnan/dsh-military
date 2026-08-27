import {
  MilitaryError,
  brand,
  type DirectionId,
  type MissionId,
  type TaskOrder,
  type WaveId,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  normalizeWorkspacePath,
  pathWithinAny,
  sha256,
} from '@dsh-military/core'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Flash-friendly semantic input; Host-owned identity and fencing never come from model guesses. */
export const taskCreateParameters = {
  objective: {
    type: 'string',
    required: true,
    description: 'One independently verifiable outcome, written as a concrete imperative.',
  },
  whyItMatters: {
    type: 'string',
    description: 'Optional concise rationale. The Host supplies a safe default.',
  },
  taskType: {
    type: 'string',
    enum: ['implementation', 'integration', 'verification', 'specs', 'documentation'],
    description: 'Optional routing category. Defaults to specs for Engineer and implementation for Worker.',
  },
  assignedRole: {
    type: 'string',
    enum: ['worker', 'engineer'],
    required: true,
    description: 'Use "engineer" only for specs/docs local-main maintenance; use "worker" for isolated implementation work.',
  },
  writePaths: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description: 'Only the project-relative files or directories that may change. Host derives read scope and all forbidden paths.',
  },
  acceptanceCriteria: {
    type: 'array',
    items: { type: 'string' },
    required: true,
    description: 'Observable pass conditions. The Host embeds them in the immutable objective and binds the standard objective/tests/scope evidence contract.',
  },
} as const satisfies ParameterSchemaSpec

export interface TaskDraft {
  readonly taskKey: string
  readonly direction: string
  readonly wave: string
  readonly objective: string
  readonly whyItMatters: string
  readonly taskType: string
  readonly assignedRole: 'worker' | 'engineer'
  readonly scope: {
    readonly readPaths: readonly string[]
    readonly writePaths: readonly string[]
    readonly forbiddenPaths: readonly string[]
  }
  readonly requiredEvidence: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly dependencies: readonly string[]
  readonly stopConditions: readonly string[]
  readonly escalationConditions: readonly string[]
  readonly contextFootprint: 'small' | 'medium' | 'large'
  readonly budget: {
    readonly modelSteps?: number
    readonly toolCalls?: number
    readonly guidanceRequests?: number
    readonly wallClockSeconds?: number
    readonly maxOutputTokens?: number
  }
}

export interface TaskDraftCompilation {
  readonly draft: TaskDraft
  readonly draftHash: string
  readonly directionId: DirectionId
  readonly waveId: WaveId
  readonly taskId: TaskOrder['taskId']
  readonly order: TaskOrder
}

export function compileTaskDraft(input: {
  readonly value: unknown
  readonly missionId: MissionId
  readonly environmentSnapshotRef: string
}): TaskDraftCompilation {
  const draft = parseTaskDraft(input.value)
  const directionId = brand<string, 'DirectionId'>(
    `direction-${sha256(`${String(input.missionId)}\0${draft.direction}`).slice(0, 24)}`,
  )
  const waveId = brand<string, 'WaveId'>(
    `wave-${sha256(`${String(directionId)}\0${draft.wave}`).slice(0, 24)}`,
  )
  const taskId = brand<string, 'TaskId'>(
    `task-${sha256(`${String(input.missionId)}\0${draft.taskKey}`).slice(0, 32)}`,
  )
  const allowedTools = defaultAllowedTools(draft.assignedRole, draft.contextFootprint)
  const order: TaskOrder = {
    schemaVersion: '1.0.0',
    missionId: input.missionId,
    directionId,
    waveId,
    taskId,
    taskVersion: brand<number, 'TaskVersion'>(1),
    objective: [
      draft.objective,
      '',
      'Acceptance criteria:',
      ...draft.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    ].join('\n'),
    whyItMatters: draft.whyItMatters,
    taskType: draft.taskType,
    assignedRole: draft.assignedRole,
    complexity: {
      semanticDecisions: boundedScore(Math.ceil(draft.acceptanceCriteria.length / 2)),
      unknownDependencies: boundedScore(draft.dependencies.length),
      writeDomains: boundedScore(draft.scope.writePaths.length),
      toolFamilies: boundedScore(new Set(allowedTools.map(toolFamily)).size),
      acceptanceAmbiguity: draft.acceptanceCriteria.length === 0 ? 5 : 0,
      integrationFanOut: boundedScore(draft.dependencies.length),
      contextFootprint: draft.contextFootprint,
    },
    scope: draft.scope,
    allowedTools,
    requiredEvidence: draft.requiredEvidence,
    acceptance: {
      contractId: brand<string, 'AcceptanceContractId'>('default-acceptance'),
      version: 1,
    },
    dependencies: draft.dependencies.map(targetTaskKey => ({
      type: 'requires' as const,
      // Flash models naturally refer to the stable taskKey they just emitted.
      // Preserve an already canonical Task ID for advanced callers; otherwise
      // compile the key through the same Mission-scoped identity function.
      targetTaskId: brand<string, 'TaskId'>(
        targetTaskKey.startsWith('task-')
          ? targetTaskKey
          : `task-${sha256(`${String(input.missionId)}\0${targetTaskKey}`).slice(0, 32)}`,
      ),
    })),
    tactics: [],
    environmentSnapshotRef: input.environmentSnapshotRef,
    stopConditions: draft.stopConditions,
    escalationConditions: draft.escalationConditions,
    budget: {
      modelSteps: draft.budget.modelSteps ?? 16,
      toolCalls: draft.budget.toolCalls ?? 64,
      guidanceRequests: draft.budget.guidanceRequests ?? 4,
      wallClockSeconds: draft.budget.wallClockSeconds ?? 7_200,
      maxOutputTokens: draft.budget.maxOutputTokens ?? 16_384,
    },
  }
  const draftHash = sha256(JSON.stringify(draft))
  return cloneFrozen({ draft, draftHash, directionId, waveId, taskId, order })
}

export function parseTaskDraft(value: unknown): TaskDraft {
  const input = record(value, 'task draft')
  const scope = input['scope'] === undefined
    ? undefined
    : record(input['scope'], 'scope')
  const role = requiredString(input['assignedRole'], 'assignedRole')
  if (role !== 'worker' && role !== 'engineer') {
    throw new MilitaryError('INVALID_ARGUMENT', 'assignedRole must be "worker" or "engineer"')
  }
  const taskType = input['taskType'] === undefined
    ? role === 'engineer' ? 'specs' : 'implementation'
    : requiredString(input['taskType'], 'taskType').toLowerCase()
  const validTaskTypes = new Set([
    'implementation',
    'integration',
    'verification',
    'specs',
    'documentation',
  ])
  if (!validTaskTypes.has(taskType)) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'taskType must be implementation, integration, verification, specs or documentation',
    )
  }
  if (role === 'engineer' && taskType !== 'specs' && taskType !== 'documentation') {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'Engineer tasks are restricted to specs or documentation; use Worker for implementation, integration or verification',
    )
  }
  if (role === 'worker' && (taskType === 'specs' || taskType === 'documentation')) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      'Specs/documentation tasks require assignedRole "engineer"',
    )
  }
  const budgetInput = input['budget'] === undefined ? {} : record(input['budget'], 'budget')
  const readPaths = normalizePaths(
    scope === undefined
      ? ['.']
      : requiredStringArray(scope['readPaths'], 'scope.readPaths'),
    'scope.readPaths',
  )
  const writePaths = normalizePaths(
    scope === undefined
      ? requiredStringArray(input['writePaths'], 'writePaths')
      : requiredStringArray(scope['writePaths'], 'scope.writePaths'),
    'scope.writePaths',
  )
  if (readPaths.length === 0) {
    throw new MilitaryError('INVALID_ARGUMENT', 'scope.readPaths must contain at least one workspace-relative path')
  }
  if (writePaths.length === 0) {
    throw new MilitaryError('INVALID_ARGUMENT', 'scope.writePaths must contain at least one workspace-relative path')
  }
  if (writePaths.some(path => path === '.')) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      'scope.writePaths may not grant the whole workspace; name the exact directories or files',
    )
  }
  if (role === 'engineer'
    && writePaths.some(path => !pathWithinAny(path, ['specs', 'docs']))) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      'Engineer write paths must be below specs/ or docs/',
    )
  }
  const acceptanceCriteria = nonEmptyStringArray(
    input['acceptanceCriteria'],
    'acceptanceCriteria',
  )
  const contextInput = input['contextFootprint']
  const derivedContext = writePaths.length <= 1 && acceptanceCriteria.length <= 2
    ? 'small'
    : writePaths.length >= 4 || acceptanceCriteria.length >= 6
      ? 'large'
      : 'medium'
  const context = contextInput === undefined
    ? derivedContext
    : requiredString(contextInput, 'contextFootprint')
  if (context !== 'small' && context !== 'medium' && context !== 'large') {
    throw new MilitaryError('INVALID_ARGUMENT', 'contextFootprint must be small, medium or large')
  }
  const forbiddenPaths = normalizePaths(uniqueStrings([
    ...(scope === undefined
      ? []
      : optionalStringArray(scope['forbiddenPaths'], 'scope.forbiddenPaths')),
    '.git',
    '.dsh-military/control',
    '.dsh-military/secrets',
  ]), 'scope.forbiddenPaths')
  const forbiddenWrite = writePaths.find(path => pathWithinAny(path, forbiddenPaths))
  if (forbiddenWrite !== undefined) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      `scope.writePaths contains forbidden path ${forbiddenWrite}`,
    )
  }
  const budget = {
    ...optionalIntegerInRange(
      budgetInput['modelSteps'], 'modelSteps', 'budget.modelSteps', 1, 64,
    ),
    ...optionalIntegerInRange(
      budgetInput['toolCalls'], 'toolCalls', 'budget.toolCalls', 1, 512,
    ),
    ...optionalIntegerInRange(
      budgetInput['guidanceRequests'], 'guidanceRequests',
      'budget.guidanceRequests', 0, 32,
    ),
    ...optionalIntegerInRange(
      budgetInput['wallClockSeconds'], 'wallClockSeconds',
      'budget.wallClockSeconds', 60, 86_400,
    ),
    ...optionalIntegerInRange(
      budgetInput['maxOutputTokens'], 'maxOutputTokens',
      'budget.maxOutputTokens', 1_024, 256_000,
    ),
  }
  const objective = requiredString(input['objective'], 'objective')
  const taskKey = input['taskKey'] === undefined
    ? `auto-${sha256(JSON.stringify({
        objective,
        assignedRole: role,
        taskType,
        writePaths,
        acceptanceCriteria,
      })).slice(0, 24)}`
    : requiredString(input['taskKey'], 'taskKey')
  return cloneFrozen({
    taskKey,
    direction: input['direction'] === undefined
      ? 'mission-execution'
      : requiredString(input['direction'], 'direction'),
    wave: input['wave'] === undefined
      ? 'wave-1'
      : requiredString(input['wave'], 'wave'),
    objective,
    whyItMatters: input['whyItMatters'] === undefined
      ? 'This independently verifiable outcome advances the active Mission.'
      : requiredString(input['whyItMatters'], 'whyItMatters'),
    taskType,
    assignedRole: role,
    scope: {
      readPaths,
      writePaths,
      forbiddenPaths,
    },
    requiredEvidence: ['objective', 'tests', 'scope'],
    acceptanceCriteria,
    dependencies: optionalStringArray(input['dependencies'], 'dependencies'),
    stopConditions: input['stopConditions'] === undefined
      ? ['Stop when a required check cannot be run or scope would be exceeded.']
      : requiredStringArray(input['stopConditions'], 'stopConditions'),
    escalationConditions: input['escalationConditions'] === undefined
      ? ['Escalate reproducible blockers with tool-grounded evidence.']
      : requiredStringArray(input['escalationConditions'], 'escalationConditions'),
    contextFootprint: context,
    budget,
  })
}

function defaultAllowedTools(
  role: TaskDraft['assignedRole'],
  contextFootprint: TaskDraft['contextFootprint'],
): readonly string[] {
  return role === 'engineer'
    ? [
        'read', 'glob', 'grep',
        'military_get_context', 'military_get_order',
        'military_specs_read',
        ...(contextFootprint === 'large' ? ['military_specs_stage_chunk'] : []),
        'military_specs_apply_order',
        'military_submit_blocker',
      ]
    : [
        'military_workspace_read', 'military_workspace_list',
        'military_workspace_search', 'military_workspace_write',
        'military_workspace_edit',
        'military_get_context', 'military_get_order',
        'military_get_tactical_directive',
        'military_record_observation', 'military_submit_candidate',
        'military_submit_blocker', 'military_radio_request',
        'military_submit_decision_questions',
      ]
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must be a non-empty string`)
  }
  return value.trim()
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must be an array of non-empty strings`)
  }
  return uniqueStrings(value.map(item => item.trim()))
}

function optionalStringArray(value: unknown, label: string): string[] {
  return value === undefined ? [] : requiredStringArray(value, label)
}

function nonEmptyStringArray(value: unknown, label: string): string[] {
  const values = requiredStringArray(value, label)
  if (values.length === 0) throw new MilitaryError('INVALID_ARGUMENT', `${label} must contain at least one item`)
  return values
}

function optionalIntegerInRange(
  value: unknown,
  key: keyof TaskDraft['budget'],
  label: string,
  minimum: number,
  maximum: number,
): Partial<TaskDraft['budget']> {
  if (value === undefined) return {}
  if (!Number.isSafeInteger(value)
    || Number(value) < minimum
    || Number(value) > maximum) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      `${label} must be an integer in [${minimum}, ${maximum}]`,
    )
  }
  return { [key]: Number(value) }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function normalizePaths(values: readonly string[], label: string): string[] {
  return uniqueStrings(values.map(value => {
    try {
      const normalized = normalizeWorkspacePath(value)
      return normalized === '' ? '.' : normalized
    } catch (error) {
      if (error instanceof MilitaryError) throw error
      throw new MilitaryError('FORBIDDEN_SCOPE', `${label} contains invalid path ${value}`, undefined, { cause: error })
    }
  }))
}

function boundedScore(value: number): 0 | 1 | 2 | 3 | 4 | 5 {
  return Math.max(0, Math.min(5, value)) as 0 | 1 | 2 | 3 | 4 | 5
}

function toolFamily(tool: string): string {
  const separator = tool.indexOf('_')
  return separator < 0 ? tool : tool.slice(0, separator)
}
