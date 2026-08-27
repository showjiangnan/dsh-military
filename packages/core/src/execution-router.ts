import {
  MilitaryError,
  type ExecutionStrategy,
  type MilitaryExecutionRouter,
  type ModelCapabilityProfile,
  type TaskCapabilityProfile,
  type TaskOrder,
} from '@dsh-military/contracts'
import { cloneFrozen, uuid } from './util.js'

const reasoningRank = { low: 0, high: 1, max: 2 } as const

export class AdaptiveExecutionRouter implements MilitaryExecutionRouter {
  async route(input: {
    readonly task: TaskOrder
    readonly capability: TaskCapabilityProfile
    readonly candidateModels: readonly ModelCapabilityProfile[]
    readonly allowCanary?: boolean
  }): Promise<ExecutionStrategy> {
    const eligible = input.candidateModels.filter(model =>
      (
        model.toolCalling
        || model.protocolCompatibility === 'DSH_TOOL_REQUEST_AVAILABLE'
        || model.protocolCompatibility === 'NATIVE_TOOL_CALLING_VERIFIED'
        || model.protocolCompatibility === 'BRIDGED_TOOL_CALLING_VERIFIED'
      )
      && model.policyEligibility !== 'INELIGIBLE'
      && (
        model.capabilityEvidence?.contextWindow === 'CONSERVATIVE_FALLBACK'
        || model.contextWindowTokens >= input.capability.minimumContextTokens
      )
      && input.capability.inputModalities.every(modality =>
        model.capabilityEvidence?.inputModalities === 'UNDECLARED'
        || model.inputModalities.includes(modality)))
    if (eligible.length === 0) throw new MilitaryError('AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED', 'no model satisfies the task capability profile')
    eligible.sort((a, b) => b.contextWindowTokens - a.contextWindowTokens || b.maxOutputTokens - a.maxOutputTokens)
    const model = eligible[0]!
    const score = parallelismScore(input.capability)
    const parallelism = score >= 12 ? 5 : score >= 8 ? 3 : score >= 4 ? 2 : 1
    const paradigm = input.capability.riskClass === 'critical' ? 'reflection'
      : parallelism > 1 ? 'multi-agent'
        : input.task.complexity.semanticDecisions >= 3 ? 'plan-execute' : 'react'
    const effort = chooseEffort(model, input.capability.minimumReasoning, input.capability.riskClass)
    // The Task budget is already the immutable model-step authority. Mirroring
    // it into the strategy avoids an unrelated hard-coded 8-step ceiling
    // cancelling a valid write/validate/commit workflow before its terminal
    // submission. The host still applies the strictest strategy/Task fence.
    const maximumSteps = Math.max(1, input.task.budget.modelSteps ?? 16)
    return cloneFrozen({
      schemaVersion: '1.0.0', strategyId: uuid('execution-strategy'), provider: model.provider, model: model.model,
      reasoningEffort: effort, paradigm, maximumSteps,
      verificationTier: input.capability.requiredVerificationTier, parallelism,
      rationale: [`parallelism-score=${score}`, `risk=${input.capability.riskClass}`, `context=${model.contextWindowTokens}`],
    })
  }
}

function parallelismScore(profile: TaskCapabilityProfile): number {
  const p = profile.parallelismInputs
  return p.independentSubproblems + p.independentEvidenceSources - p.sharedContext - p.writeConflict - p.temporalDependency - p.joinCost - p.integrationRisk
}

function chooseEffort(model: ModelCapabilityProfile, minimum: 'low' | 'high' | 'max', risk: TaskCapabilityProfile['riskClass']): 'low' | 'high' | 'max' {
  const desired = risk === 'critical' ? 'max' : risk === 'high' && minimum === 'low' ? 'high' : minimum
  const supported = model.supportedReasoning.filter((value): value is 'low' | 'high' | 'max' => value !== 'off')
  const winner = supported.filter(value => reasoningRank[value] >= reasoningRank[desired]).sort((a, b) => reasoningRank[a] - reasoningRank[b])[0]
  // ExecutionStrategy records Military's logical workload intensity. The
  // plugin-host translates it to the exact adapter vocabulary (or omits the
  // field for a non-reasoning model) at request time.
  return winner ?? desired
}
