import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  MilitaryError,
  type AgentActivationState,
  type MilitarySessionBinding,
  type TaskState,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import type { MilitaryFeatureSettings } from './context.js'

export const RC2_COMMIT =
  'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

/**
 * Root project authority comes only from the DSH Session header. Department
 * Sessions inherit the already-durable root binding and may not substitute
 * their own cwd. A missing/relative root cwd must never fall back to the Web
 * process directory because that directory can be the plugin source tree.
 */
export function authoritativeSessionWorkspaceKey(
  parentBinding: Pick<MilitarySessionBinding, 'workspaceKey'> | undefined,
  rootCwd: string | undefined,
): string {
  const candidate = parentBinding?.workspaceKey ?? rootCwd
  if (typeof candidate !== 'string'
    || candidate.trim() === ''
    || !isAbsolute(candidate)) {
    throw new MilitaryError(
      'MILITARY_BINDING_MISMATCH',
      'Military root Session requires an absolute workspace cwd; create the Session with an explicit project workspace',
    )
  }
  return resolve(candidate)
}

export function presetFingerprint(
  generation: string,
  assetHash: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      generation,
      assetHash,
      rc2: RC2_COMMIT,
    }))
    .digest('hex')
}

export function hasMaterialSessionHistory(agent: Agent): boolean {
  const material = new Set([
    'request/header',
    'user/message',
    'assistant/message',
    'tool/result',
    'turn/start',
    'step/start',
    'command/run',
    'compaction/start',
  ])
  return agent.session.events.some(event => material.has(event.type))
}

export function activationOutcome(
  state: TaskState,
): 'SETTLED' | 'FAILED' | 'CANCELLED' | 'LOST' {
  if (state === 'FAILED') return 'FAILED'
  if (state === 'CANCELLED' || state === 'PAUSED') return 'CANCELLED'
  if (state === 'RECOVERY_REQUIRED') return 'LOST'
  return 'SETTLED'
}

export function activationOutcomeWithoutWorkspace(
  reason: string,
): 'SETTLED' | 'FAILED' | 'CANCELLED' | 'LOST' {
  if (isActivationCancellationReason(reason)) return 'CANCELLED'
  if (reason.includes('FAILED')) return 'FAILED'
  if (reason.includes('NOT_LIVE')
    || reason.includes('LOST')
    || reason.includes('RECOVERY')) return 'LOST'
  return 'SETTLED'
}

export function isInvocationCancellationReason(reason: string): boolean {
  return reason.includes('USER_CANCELLED')
    || reason.includes('PARENT_INVOCATION_CANCELLED')
}

export function isActivationCancellationReason(reason: string): boolean {
  return isInvocationCancellationReason(reason)
    || reason.includes('MISSION_CANCELLED')
}

export function boundedCleanupReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/gu, ' ')
  return (normalized === '' ? 'AGENT_RELEASED' : normalized).slice(0, 240)
}

export const TERMINAL_ACTIVATION_STATES =
  new Set<AgentActivationState>([
    'SETTLED',
    'FAILED',
    'CANCELLED',
    'LOST',
  ])

export function freezeFeatureSettings(
  value: MilitaryFeatureSettings,
): MilitaryFeatureSettings {
  requireIntegerInRange(
    value.radio.maxAttempts,
    1,
    32,
    'radio.maxAttempts',
  )
  requireIntegerInRange(
    value.radio.leaseSeconds,
    10,
    3_600,
    'radio.leaseSeconds',
  )
  requireIntegerInRange(
    value.tactics.candidateRecallMinimum,
    1,
    10,
    'tactics.candidateRecallMinimum',
  )
  requireIntegerInRange(
    value.tactics.candidateRecallMaximum,
    1,
    20,
    'tactics.candidateRecallMaximum',
  )
  const commitMessagePrefix = value.specs.commitMessagePrefix.trim()
  if (commitMessagePrefix.length < 1
    || commitMessagePrefix.length > 80
    || /[\r\n\u0000]/u.test(commitMessagePrefix)) {
    throw new TypeError(
      'specs.commitMessagePrefix must be one non-empty line up to 80 characters',
    )
  }
  return Object.freeze({
    radio: Object.freeze({ ...value.radio }),
    staff: Object.freeze({ ...value.staff }),
    tactics: Object.freeze({ ...value.tactics }),
    memory: Object.freeze({ ...value.memory }),
    specs: Object.freeze({ commitMessagePrefix }),
  })
}

export function canonicalTerminalValue<T>(value: T): T {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'terminal domain receipt is not JSON serializable',
      undefined,
      { cause: error },
    )
  }
  if (serialized === undefined) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'terminal domain receipt cannot be undefined',
    )
  }
  return JSON.parse(serialized) as T
}

export function normalizeDispatchText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function parseDecisionAnswerReceipt(
  bytes: Uint8Array,
  expectedDecisionSetId: string,
): {
  readonly decisionSetId: string
  readonly answers: Record<string, unknown>
  readonly answersHash: string
} {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'Decision answer receipt is not valid JSON',
      undefined,
      { cause: error },
    )
  }
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'Decision answer receipt is not an object',
    )
  }
  const receipt = value as Record<string, unknown>
  const answers = receipt.answers
  const answersHash = String(receipt.answersHash ?? '')
  if (
    receipt.decisionSetId !== expectedDecisionSetId
    || typeof answers !== 'object'
    || answers === null
    || Array.isArray(answers)
    || answersHash !== sha256(stableJson(answers))
  ) {
    throw new MilitaryError(
      'PERSISTENCE_FAILED',
      'Decision answer receipt failed its identity/hash fence',
    )
  }
  return {
    decisionSetId: expectedDecisionSetId,
    answers: answers as Record<string, unknown>,
    answersHash,
  }
}

function requireIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    )
  }
}
