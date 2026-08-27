import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type AgentIdentity,
  type CandidateSubmission,
  type DecisionQuestionSet,
  type EvidenceRef,
  type SessionId,
  type TacticalGuidance,
  type TacticalRequest,
  type TaskLocation,
  type TaskOrder,
} from '@dsh-military/contracts'
import { now, sha256, stableJson } from '@dsh-military/core'
import {
  parseCandidateSubmission,
  parseDecisionQuestionSet,
  parseTacticalGuidance,
  parseTacticalRequest,
} from './runtime-validation.js'

/**
 * Deliberately shallow model contracts. Canonical identity, fencing,
 * timestamps, budgets, evidence mappings and idempotency remain Host-owned.
 */
export const candidateDraftParameters = {
  summary: {
    type: 'string',
    required: true,
    description: 'What is complete and how it satisfies the assigned Task.',
  },
  evidenceRefs: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: 'Durable artifact IDs, tool-call IDs or commit refs that prove the result.',
  },
  knownLimitations: {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional remaining limitations. Omit when none.',
  },
} as const satisfies ParameterSchemaSpec

export const tacticalRequestDraftParameters = {
  blocker: {
    type: 'string',
    required: true,
    description: 'One concrete reproducible blocker statement.',
  },
  minimalReproduction: {
    type: 'string',
    description: 'Optional shortest reproduction.',
  },
  attempts: {
    type: 'array',
    items: { type: 'string' },
    description: 'Short “action → observation” attempts already made.',
  },
  evidenceRefs: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: 'At least one durable artifact or tool-call reference proving the blocker.',
  },
  requestedDecision: {
    type: 'string',
    required: true,
    description: 'The exact tactical decision or guidance needed.',
  },
} as const satisfies ParameterSchemaSpec

export const decisionQuestionDraftParameters = {
  purpose: {
    type: 'string',
    required: true,
    description: 'Why these user-owned decisions are required now.',
  },
  questions: {
    type: 'array',
    required: true,
    description: 'One to five concise questions. Options are simple labels; the Host supplies stable IDs.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        question: { type: 'string', required: true },
        header: { type: 'string' },
        options: {
          type: 'array',
          required: true,
          items: { type: 'string' },
        },
        multiSelect: { type: 'boolean' },
      },
    },
  },
} as const satisfies ParameterSchemaSpec

export const tacticalGuidanceDraftParameters = {
  requestId: {
    type: 'string',
    required: true,
    description: 'Exact requestId returned by military_radio_poll.',
  },
  diagnosis: {
    type: 'string',
    required: true,
    description: 'Evidence-grounded diagnosis of the blocker.',
  },
  steps: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: 'Ordered executable actions; one action per item.',
  },
  expectedObservations: {
    type: 'array',
    required: true,
    items: { type: 'string' },
    description: 'Observable outcomes that show the guidance worked.',
  },
  selectedSkillIds: {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional skill IDs already present on the request.',
  },
  requiredEvidence: {
    type: 'array',
    items: { type: 'string' },
  },
  stopConditions: {
    type: 'array',
    items: { type: 'string' },
  },
  fallback: {
    type: 'string',
    description: 'Fallback if the directive does not produce the expected observation.',
  },
} as const satisfies ParameterSchemaSpec

export function compileCandidateDraft(input: {
  readonly value: unknown
  readonly identity: AgentIdentity
  readonly binding: AgentExecutionBinding
  readonly task: TaskOrder
}): CandidateSubmission {
  const value = record(input.value, 'candidate draft')
  const summary = requiredString(value['summary'], 'summary')
  const evidenceRefs = nonEmptyStrings(value['evidenceRefs'], 'evidenceRefs')
  const evidence = evidenceRefs.map((ref, index) => evidenceFromRef(
    ref,
    `Candidate evidence ${index + 1} for ${summary}`,
    input.task.requiredEvidence,
  ))
  const digest = sha256(stableJson({
    bindingId: input.binding.bindingId,
    taskId: String(input.task.taskId),
    taskVersion: Number(input.task.taskVersion),
    summary,
    evidenceRefs,
  }))
  const acceptanceMapping = Object.fromEntries(
    input.task.requiredEvidence.map(clause => [clause, evidence]),
  )
  return parseCandidateSubmission({
    schemaVersion: '1.0.0',
    candidateId: `candidate-${digest.slice(0, 32)}`,
    identity: input.identity,
    location: taskLocation(input.task, input.binding),
    summary,
    outputs: [],
    evidence,
    declaredToolCallIds: evidence
      .filter(item => item.kind === 'tool-call')
      .map(item => item.ref),
    acceptanceMapping,
    skillUsage: input.task.tactics,
    environmentSnapshotRef: input.task.environmentSnapshotRef,
    changedPaths: [],
    knownLimitations: optionalStrings(value['knownLimitations'], 'knownLimitations'),
    submittedAt: now(),
    idempotencyKey: `candidate-submit-${digest}`,
  })
}

export function compileTacticalRequestDraft(input: {
  readonly value: unknown
  readonly identity: AgentIdentity
  readonly binding: AgentExecutionBinding
  readonly task: TaskOrder
}): TacticalRequest {
  const value = record(input.value, 'tactical request draft')
  const blocker = requiredString(value['blocker'], 'blocker')
  const requestedDecision = requiredString(value['requestedDecision'], 'requestedDecision')
  const evidenceRefs = nonEmptyStrings(value['evidenceRefs'], 'evidenceRefs')
  const attempts = optionalStrings(value['attempts'], 'attempts')
  const digest = sha256(stableJson({
    bindingId: input.binding.bindingId,
    taskId: String(input.task.taskId),
    taskVersion: Number(input.task.taskVersion),
    blocker,
    requestedDecision,
    evidenceRefs,
  }))
  const createdAt = now()
  return parseTacticalRequest({
    schemaVersion: '1.0.0',
    requestId: `tactical-request-${digest.slice(0, 32)}`,
    identity: input.identity,
    location: taskLocation(input.task, input.binding),
    environmentSnapshotRef: input.task.environmentSnapshotRef,
    currentSkills: input.task.tactics,
    blocker: {
      type: 'execution-blocker',
      statement: blocker,
      reproducible: true,
      ...(value['minimalReproduction'] === undefined
        ? {}
        : { minimalReproduction: requiredString(value['minimalReproduction'], 'minimalReproduction') }),
    },
    attempts: attempts.map(attempt => ({
      action: attempt,
      observation: 'See the attempt description and linked evidence.',
      toolCallIds: evidenceRefs.filter(isToolCallRef),
    })),
    evidence: evidenceRefs.map((ref, index) =>
      evidenceFromRef(ref, `Blocker evidence ${index + 1}`, ['blocker'])),
    requestedDecision,
    budget: input.task.budget,
    idempotencyKey: `tactical-request-submit-${digest}`,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString(),
  })
}

export function compileDecisionQuestionDraft(input: {
  readonly value: unknown
  readonly identity: AgentIdentity
  readonly rootSessionId: SessionId
  readonly contextVersion: number
}): DecisionQuestionSet {
  const value = record(input.value, 'decision question draft')
  const purpose = requiredString(value['purpose'], 'purpose')
  if (!Array.isArray(value['questions']) || value['questions'].length < 1 || value['questions'].length > 5) {
    throw new MilitaryError('INVALID_ARGUMENT', 'questions must contain one to five items')
  }
  const questions = value['questions'].map((item, index) => {
    const question = record(item, `questions[${index}]`)
    const text = requiredString(question['question'], `questions[${index}].question`)
    const options = nonEmptyStrings(question['options'], `questions[${index}].options`)
    if (options.length > 8) {
      throw new MilitaryError('INVALID_ARGUMENT', `questions[${index}].options may contain at most eight items`)
    }
    return {
      id: `question-${sha256(`${index}\0${text}`).slice(0, 20)}`,
      ...(question['header'] === undefined
        ? {}
        : { header: requiredString(question['header'], `questions[${index}].header`) }),
      question: text,
      options: options.map(label => ({ label, description: label })),
      multiSelect: question['multiSelect'] === true,
      decisionOwner: 'user' as const,
    }
  })
  const digest = sha256(stableJson({
    producer: String(input.identity.agentId),
    rootSessionId: String(input.rootSessionId),
    contextVersion: input.contextVersion,
    purpose,
    questions,
  }))
  const createdAt = now()
  return parseDecisionQuestionSet({
    schemaVersion: '1.0.0',
    decisionSetId: `decision-set-${digest.slice(0, 32)}`,
    producer: input.identity,
    targetRootSessionId: input.rootSessionId,
    contextVersion: Math.max(1, input.contextVersion),
    purpose,
    deliveryAuthority: 'general',
    questions,
    dedupeKey: `decision-question-${digest}`,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
  })
}

export function compileTacticalGuidanceDraft(input: {
  readonly value: unknown
  readonly identity: AgentIdentity
  readonly request: TacticalRequest
}): TacticalGuidance {
  const value = record(input.value, 'tactical guidance draft')
  const requestId = requiredString(value['requestId'], 'requestId')
  if (requestId !== String(input.request.requestId)) {
    throw new MilitaryError('GUIDANCE_STALE', 'requestId does not match the leased Tactical Request')
  }
  const diagnosis = requiredString(value['diagnosis'], 'diagnosis')
  const steps = nonEmptyStrings(value['steps'], 'steps')
  const expectedObservations = nonEmptyStrings(
    value['expectedObservations'],
    'expectedObservations',
  )
  const selectedIds = optionalStrings(value['selectedSkillIds'], 'selectedSkillIds')
  const selectedSkills = selectedIds.length === 0
    ? input.request.currentSkills.slice(0, 3)
    : selectedIds.map(skillId => {
        const skill = input.request.currentSkills.find(item => String(item.skillId) === skillId)
        if (skill === undefined) {
          throw new MilitaryError(
            'INVALID_ARGUMENT',
            `selectedSkillIds contains ${skillId}, which is not attached to the request`,
          )
        }
        return skill
      })
  const digest = sha256(stableJson({
    requestId,
    advisor: String(input.identity.agentId),
    diagnosis,
    steps,
    expectedObservations,
    selectedIds,
  }))
  const issuedAt = now()
  return parseTacticalGuidance({
    schemaVersion: '1.0.0',
    guidanceId: `tactical-guidance-${digest.slice(0, 32)}`,
    requestId: input.request.requestId,
    expectedTaskVersion: input.request.location.taskVersion,
    advisorIdentity: input.identity,
    candidateSkills: input.request.currentSkills.slice(0, 5),
    selectedSkills,
    diagnosis,
    directive: steps.map((action, index) => ({
      stepId: `step-${index + 1}`,
      action,
    })),
    expectedObservations,
    requiredEvidence: optionalStrings(value['requiredEvidence'], 'requiredEvidence')
      .concat(input.request.evidence.length === 0 ? [] : ['Re-check the blocker evidence.']),
    stopConditions: optionalStrings(value['stopConditions'], 'stopConditions')
      .concat(['Stop and submit a new blocker if scope or authority would be exceeded.']),
    fallback: value['fallback'] === undefined
      ? 'Return a new evidence-backed Tactical Request with the latest observation.'
      : requiredString(value['fallback'], 'fallback'),
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 30 * 60 * 1000).toISOString(),
  })
}

function taskLocation(
  task: TaskOrder,
  binding: AgentExecutionBinding,
): TaskLocation {
  return {
    missionId: task.missionId,
    directionId: task.directionId,
    waveId: task.waveId,
    taskId: task.taskId,
    taskVersion: task.taskVersion,
    attemptId: brand<string, 'AttemptId'>(
      `attempt-${sha256(`${binding.bindingId}\0${Number(task.taskVersion)}`).slice(0, 24)}`,
    ),
  }
}

function evidenceFromRef(
  ref: string,
  claim: string,
  clauseIds: readonly string[],
): EvidenceRef {
  return {
    kind: isToolCallRef(ref)
      ? 'tool-call'
      : ref.startsWith('commit:') || /^[0-9a-f]{40}$/iu.test(ref)
        ? 'git-commit'
        : ref.startsWith('event:')
          ? 'event'
          : ref.startsWith('api:')
            ? 'api-receipt'
            : 'artifact',
    ref,
    claim,
    clauseIds: [...clauseIds],
  }
}

function isToolCallRef(value: string): boolean {
  return value.startsWith('call-') || value.startsWith('tool-call:')
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

function optionalStrings(value: unknown, label: string): string[] {
  if (value === undefined) return []
  return stringArray(value, label)
}

function nonEmptyStrings(value: unknown, label: string): string[] {
  const values = stringArray(value, label)
  if (values.length === 0) {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must contain at least one item`)
  }
  return values
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)
    || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new MilitaryError('INVALID_ARGUMENT', `${label} must be an array of non-empty strings`)
  }
  return [...new Set(value.map(item => String(item).trim()))]
}
