import {
  MilitaryError,
  type GeneralExecutionPolicy,
  type MilitaryGeneralRouting,
  type MilitaryPolicyRegistry,
  type ModelSelectionReceipt,
  type SessionId,
} from '@dsh-military/contracts'
import { cloneFrozen, now, uuid, type Clock } from './util.js'

export interface GeneralModelSelectionStore {
  get(sessionId: SessionId): ModelSelectionReceipt | undefined
  put(sessionId: SessionId, receipt: ModelSelectionReceipt): void
}

export class InMemoryGeneralModelSelectionStore implements GeneralModelSelectionStore {
  readonly #selections = new Map<string, ModelSelectionReceipt>()

  get(sessionId: SessionId): ModelSelectionReceipt | undefined {
    const value = this.#selections.get(String(sessionId))
    return value === undefined ? undefined : cloneFrozen(value)
  }

  put(sessionId: SessionId, receipt: ModelSelectionReceipt): void {
    this.#selections.set(String(sessionId), cloneFrozen(receipt))
  }
}

export class GeneralRoutingService implements MilitaryGeneralRouting {
  #policy: GeneralExecutionPolicy
  readonly #policies: MilitaryPolicyRegistry
  readonly #selections: GeneralModelSelectionStore
  readonly #clock: Clock

  constructor(
    policy: GeneralExecutionPolicy,
    policies: MilitaryPolicyRegistry,
    clockOrOptions?: Clock | {
      readonly clock?: Clock
      readonly selections?: GeneralModelSelectionStore
    },
  ) {
    this.#policy = cloneFrozen(policy)
    this.#policies = policies
    const options = typeof clockOrOptions === 'function'
      ? { clock: clockOrOptions }
      : clockOrOptions
    this.#clock = options?.clock ?? (() => new Date())
    this.#selections = options?.selections ?? new InMemoryGeneralModelSelectionStore()
  }

  async policy(): Promise<GeneralExecutionPolicy> { return cloneFrozen(this.#policy) }

  async updatePresetDefault(
    input: GeneralExecutionPolicy['defaultModel'] & {
      readonly contextBudgetTokens?: number
    },
  ): Promise<void> {
    const capability = await this.#policies.modelCapability(input.provider, input.model)
    if (input.maxOutputTokens < 1 || input.maxOutputTokens > capability.maxOutputTokens) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        `maxOutputTokens must be between 1 and ${capability.maxOutputTokens}`,
      )
    }
    const contextBudgetTokens = input.contextBudgetTokens
      ?? this.#policy.contextPolicy.contextBudgetTokens
    if (!Number.isSafeInteger(contextBudgetTokens) || contextBudgetTokens < 4_096) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        'General context budget must be an integer of at least 4096 tokens',
      )
    }
    if (capability.contextWindowTokens < contextBudgetTokens) {
      throw new MilitaryError(
        'AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED',
        'model context window is below General policy budget',
      )
    }
    const defaultModel: GeneralExecutionPolicy['defaultModel'] = {
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      maxOutputTokens: input.maxOutputTokens,
    }
    this.#policy = cloneFrozen({
      ...this.#policy,
      defaultModel,
      contextPolicy: {
        ...this.#policy.contextPolicy,
        contextBudgetTokens,
        retainedTailTokens: Math.min(
          this.#policy.contextPolicy.retainedTailTokens,
          Math.max(0, contextBudgetTokens - 1),
        ),
      },
    })
  }

  async applyPresetDefault(sessionId: SessionId): Promise<ModelSelectionReceipt> {
    const existing = this.#selections.get(sessionId)
    if (existing !== undefined) return cloneFrozen(existing)
    return this.#validateAndStore({
      sessionId,
      provider: this.#policy.defaultModel.provider,
      model: this.#policy.defaultModel.model,
      reasoningEffort: this.#policy.defaultModel.reasoningEffort,
      selectedBy: 'military-preset',
      source: 'PRESET_DEFAULT',
    })
  }

  async validateUserSelection(input: {
    readonly sessionId: SessionId
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: 'high' | 'max'
    readonly selectedBy: string
  }): Promise<ModelSelectionReceipt> {
    if (!this.#policy.modelSelection.userSessionSwitchEnabled) throw new MilitaryError('POLICY_DENIED')
    return this.#validateAndStore({ ...input, source: 'SESSION_MODEL_SELECTOR' })
  }

  current(sessionId: SessionId): ModelSelectionReceipt | undefined {
    const value = this.#selections.get(sessionId)
    return value === undefined ? undefined : cloneFrozen(value)
  }

  async #validateAndStore(input: {
    readonly sessionId: SessionId
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: 'high' | 'max'
    readonly selectedBy: string
    readonly source: ModelSelectionReceipt['source']
  }): Promise<ModelSelectionReceipt> {
    const previous = this.#selections.get(input.sessionId)
    const requestedReasoning = input.reasoningEffort
      ?? this.#policy.defaultModel.reasoningEffort
    if (previous !== undefined
      && previous.provider === input.provider
      && previous.model === input.model
      && previous.reasoningEffort === requestedReasoning) {
      return cloneFrozen(previous)
    }
    const capability = await this.#policies.modelCapability(input.provider, input.model)
    const minimum = this.#policy.minimumReasoning
    if (reasoningRank(requestedReasoning) < reasoningRank(minimum)) {
      throw new MilitaryError(
        'AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED',
        `requested reasoning ${requestedReasoning} is below Military minimum ${minimum}`,
      )
    }
    const receipt: ModelSelectionReceipt = {
      schemaVersion: '1.0.0',
      receiptId: uuid('model-selection'),
      sessionId: String(input.sessionId),
      provider: input.provider,
      model: input.model,
      reasoningEffort: requestedReasoning,
      source: input.source,
      ...(previous === undefined ? {} : { previousProvider: previous.provider, previousModel: previous.model }),
      ...(previous === undefined
        ? {}
        : { previousReasoningEffort: previous.reasoningEffort }),
      capabilityProfileId: capability.profileId,
      selectedBy: input.selectedBy,
      selectedAt: now(this.#clock),
    }
    this.#selections.put(input.sessionId, receipt)
    return cloneFrozen(receipt)
  }
}

function reasoningRank(value: 'high' | 'max'): number {
  return value === 'max' ? 1 : 0
}
