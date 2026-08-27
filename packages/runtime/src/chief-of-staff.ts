import {
  MilitaryError,
  brand,
  type AgentIdentity,
  type ArtifactRef,
  type ChiefAdviceId,
  type ChiefOfStaffAdvice,
  type MilitaryChiefOfStaff,
} from '@dsh-military/contracts'
import { cloneFrozen, now, uuid, type Clock } from '@dsh-military/core'

export interface ChiefAdviceProvider {
  generate(input: {
    readonly contextPacket: ArtifactRef
    readonly sufficiency: 'PARTIAL' | 'INSUFFICIENT' | 'CONFLICTED' | 'UNKNOWN'
    readonly signal: AbortSignal
  }): Promise<Omit<ChiefOfStaffAdvice, 'schemaVersion' | 'adviceId' | 'status' | 'createdAt'>>
}

export class ChiefOfStaffRuntime implements MilitaryChiefOfStaff {
  readonly #provider: ChiefAdviceProvider
  readonly #clock: Clock
  readonly #advice = new Map<string, ChiefOfStaffAdvice>()

  constructor(provider: ChiefAdviceProvider, clock?: Clock) {
    this.#provider = provider
    this.#clock = clock ?? (() => new Date())
  }

  async advise(input: Parameters<MilitaryChiefOfStaff['advise']>[0]): Promise<ChiefOfStaffAdvice> {
    if (input.signal.aborted) throw input.signal.reason
    const generated = await this.#provider.generate(input)
    if (!generated.options.some(option => option.optionId === generated.recommendedOptionId)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'recommended option is not present')
    }
    const advice: ChiefOfStaffAdvice = {
      ...generated,
      schemaVersion: '1.0.0',
      adviceId: brand<string, 'ChiefAdviceId'>(uuid('chief-advice')),
      status: 'GENERATED_REFERENCE',
      createdAt: now(this.#clock),
    }
    this.#advice.set(String(advice.adviceId), cloneFrozen(advice))
    return cloneFrozen(advice)
  }

  async get(adviceId: ChiefAdviceId): Promise<ChiefOfStaffAdvice> {
    const value = this.#advice.get(String(adviceId))
    if (value === undefined) throw new MilitaryError('NOT_FOUND')
    return cloneFrozen(value)
  }
}

/** Safe fallback used when no model-backed chief provider has been installed. */
export class ConservativeChiefAdviceProvider implements ChiefAdviceProvider {
  readonly #identity: AgentIdentity
  constructor(identity: AgentIdentity) { this.#identity = identity }

  async generate(input: Parameters<ChiefAdviceProvider['generate']>[0]): Promise<Awaited<ReturnType<ChiefAdviceProvider['generate']>>> {
    if (input.signal.aborted) throw input.signal.reason
    return {
      generatedBy: this.#identity,
      contextPacketRef: String(input.contextPacket.artifactId),
      tacticalSufficiency: { disposition: input.sufficiency, coverageScore: 0, reasons: ['private tactics were insufficient'] },
      problem: 'Insufficient verified tactical guidance',
      facts: ['A verified context packet exists', 'No stable private tactic fully covers the decision'],
      assumptions: ['A reversible reconnaissance step is available'],
      options: [
        { optionId: 'inspect-first', title: '先侦察再决策', approach: '执行只读检查并收集最小证据包', benefits: ['降低误判'], risks: ['增加一次往返'] },
        { optionId: 'ask-user', title: '请求用户选择', approach: '由 General 通过 ask_user_question 提交关键选择', benefits: ['保留用户决策权'], risks: ['任务暂停等待'] },
      ],
      recommendedOptionId: 'inspect-first',
      recommendationRationale: '在缺乏可靠私有战术时，优先执行可逆且可验证的侦察。',
      nextStep: '执行只读检查；若仍存在用户所有的选择，由 General 发起决策问题。',
      verifierRequirements: ['所有结论必须引用工具或工件证据'],
      needsUserDecision: false,
      confidence: 0.45,
    }
  }
}
