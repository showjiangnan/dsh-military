import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  AgentExecutionBinding,
  CandidateSubmission,
  PrivateSkillUsageRecord,
  TaskOrder,
  VerificationReceipt,
} from '@dsh-military/contracts'
import { matchTacticalTags } from '@dsh-military/core'
import type { MilitaryHostRuntime } from '@dsh-military/plugin-host'

export interface RecordTaskSkillUsageInput {
  readonly host: MilitaryHostRuntime
  readonly binding: AgentExecutionBinding
  readonly task: TaskOrder
  readonly candidate: CandidateSubmission
  readonly verification: VerificationReceipt
  readonly integrationDisposition?: string
  readonly sessionEvents: readonly SessionEvent[]
}

/**
 * Close the Task-use edge for every exact private Skill frozen into a Candidate.
 * All fields are Host-observed; the lightweight model never supplies accounting,
 * provider identity, match reasons, verifier IDs, or outcome.
 */
export async function recordTaskSkillUsage(
  input: RecordTaskSkillUsageInput,
): Promise<readonly PrivateSkillUsageRecord[]> {
  if (input.candidate.skillUsage.length === 0) return []
  const tags = await input.host.application.tags.list({ status: 'ACTIVE' })
  const matchedTagIds = new Set(matchTacticalTags(taskRecallText(input.task), tags, 5).map(String))
  const tokenUsage = observedSessionTokens(input.sessionEvents)
  const toolEvidenceRefs = [
    ...new Set(input.candidate.evidence
      .filter(value => value.kind === 'tool-call')
      .map(value => value.ref)),
  ]
  const outcome = skillOutcome(
    input.verification.disposition,
    input.integrationDisposition,
  )
  const records: PrivateSkillUsageRecord[] = []
  for (const skill of input.candidate.skillUsage) {
    const procedure = input.host.tactics.get(skill.skillId, skill.version)
    const matchingScenarioTags = procedure.scenarioTags.filter(value => matchedTagIds.has(value))
    const matchReasons = matchingScenarioTags.length === 0
      ? [
        `Exact version was frozen into Task ${String(input.task.taskId)}@${Number(input.task.taskVersion)} by Host recall.`,
      ]
      : matchingScenarioTags.map(value => (
        `Host semantic recall matched Task ${String(input.task.taskId)}@${Number(input.task.taskVersion)} to scenario tag ${value}.`
      ))
    records.push(await input.host.application.ingestion.recordUsage({
      skill,
      missionId: input.task.missionId,
      taskId: input.task.taskId,
      matchReasons,
      provider: input.binding.provider,
      model: input.binding.model,
      toolEvidenceRefs,
      verifierReceiptRefs: [input.verification.receiptId],
      outcome,
      ...(tokenUsage === null
        ? {
          tokenBasis: 'UNAVAILABLE' as const,
        }
        : {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          tokenBasis: 'SESSION_OBSERVED' as const,
        }),
      // RC.2's DeepSeek route exposes token observations but no authoritative
      // price catalog. Recording "unavailable" is safer than fabricating cost.
      costStatus: 'PROVIDER_PRICING_UNAVAILABLE',
    }))
  }
  return records
}

function taskRecallText(task: TaskOrder): string {
  return [
    task.objective,
    task.whyItMatters,
    task.taskType,
    String(task.directionId),
    String(task.waveId),
    ...task.scope.readPaths,
    ...task.scope.writePaths,
    ...task.requiredEvidence,
    ...task.stopConditions,
    ...task.escalationConditions,
  ].join('\n')
}

function observedSessionTokens(events: readonly SessionEvent[]): {
  readonly inputTokens: number
  readonly outputTokens: number
} | null {
  let observed = false
  let inputTokens = 0
  let outputTokens = 0
  for (const event of events) {
    if (event.type !== 'assistant/message' || event.data.usage === undefined) continue
    observed = true
    inputTokens += Math.max(0, event.data.usage.inputTokens)
      + Math.max(0, event.data.usage.cacheReadTokens ?? 0)
      + Math.max(0, event.data.usage.cacheWriteTokens ?? 0)
    outputTokens += Math.max(0, event.data.usage.outputTokens)
  }
  return observed ? { inputTokens, outputTokens } : null
}

function skillOutcome(
  verification: VerificationReceipt['disposition'],
  integrationDisposition: string | undefined,
): PrivateSkillUsageRecord['outcome'] {
  if (verification === 'REWORK') return 'REWORK'
  if (verification === 'ACCEPTED') {
    return integrationDisposition === undefined || integrationDisposition === 'APPLIED'
      ? 'SUCCEEDED'
      : 'ROLLED_BACK'
  }
  if (verification === 'BLOCKED' || verification === 'FROZEN') return 'FAILED'
  return 'UNKNOWN'
}
