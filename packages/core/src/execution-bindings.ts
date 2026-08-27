import {
  MilitaryError,
  type AgentExecutionBinding,
  type MilitaryAgentExecutionBindings,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from './util.js'

export class InMemoryAgentExecutionBindings implements MilitaryAgentExecutionBindings {
  readonly #bindings = new Map<string, AgentExecutionBinding>()
  readonly #byAgent = new Map<string, string[]>()
  readonly #bySession = new Map<string, string>()

  async create(binding: AgentExecutionBinding): Promise<void> {
    const existing = this.#bindings.get(binding.bindingId)
    if (existing !== undefined) {
      if (stableJson(existing) !== stableJson(binding)) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH')
      return
    }
    if (binding.agent.role === 'general' || binding.agent.role === 'harness') {
      throw new MilitaryError('INVALID_ARGUMENT', 'execution bindings are for non-General department agents')
    }
    const frozen = cloneFrozen(binding)
    this.#bindings.set(binding.bindingId, frozen)
    const sessionKey = String(binding.agent.sessionId)
    const existingForSession = this.#bySession.get(sessionKey)
    if (existingForSession !== undefined && existingForSession !== binding.bindingId) {
      throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH', `session ${sessionKey} already has another execution binding`)
    }
    this.#bySession.set(sessionKey, binding.bindingId)
    const key = String(binding.agent.agentId)
    const values = this.#byAgent.get(key) ?? []
    values.push(binding.bindingId)
    values.sort((left, right) => {
      const a = this.#bindings.get(left)
      const b = this.#bindings.get(right)
      return (a?.agent.generation ?? 0) - (b?.agent.generation ?? 0)
    })
    this.#byAgent.set(key, values)
  }

  async discard(bindingId: string): Promise<void> {
    const binding = this.#bindings.get(bindingId)
    if (binding === undefined) return
    this.#bindings.delete(bindingId)
    this.#bySession.delete(String(binding.agent.sessionId))
    const agentId = String(binding.agent.agentId)
    const remaining = (this.#byAgent.get(agentId) ?? [])
      .filter(value => value !== bindingId)
    if (remaining.length === 0) this.#byAgent.delete(agentId)
    else this.#byAgent.set(agentId, remaining)
  }

  async get(bindingId: string): Promise<AgentExecutionBinding> {
    const binding = this.#bindings.get(bindingId)
    if (binding === undefined) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
    return cloneFrozen(binding)
  }

  async forAgent(agentId: string, generation?: number): Promise<AgentExecutionBinding | null> {
    const ids = this.#byAgent.get(agentId) ?? []
    const values = ids.map(id => this.#bindings.get(id)).filter((value): value is AgentExecutionBinding => value !== undefined)
    const found = generation === undefined
      ? values.at(-1)
      : values.find(value => value.agent.generation === generation)
    return found === undefined ? null : cloneFrozen(found)
  }


  async forSession(sessionId: string): Promise<AgentExecutionBinding | null> {
    const bindingId = this.#bySession.get(sessionId)
    if (bindingId === undefined) return null
    return await this.get(bindingId)
  }

  async verifyEffectiveRequest(input: {
    readonly bindingId: string
    readonly provider: string
    readonly model: string
    readonly reasoningEffort: 'low' | 'high' | 'max'
    readonly toolProfileId: string
    readonly permissionProfileId: string
  }): Promise<{ readonly valid: boolean; readonly reason?: string }> {
    const binding = await this.get(input.bindingId)
    const mismatches: string[] = []
    if (binding.provider !== input.provider) mismatches.push('provider')
    if (binding.model !== input.model) mismatches.push('model')
    if (binding.reasoningEffort !== input.reasoningEffort) mismatches.push('reasoningEffort')
    if (binding.toolProfile.id !== input.toolProfileId) mismatches.push('toolProfileId')
    if (binding.permissionProfile.id !== input.permissionProfileId) mismatches.push('permissionProfileId')
    return mismatches.length === 0
      ? { valid: true }
      : { valid: false, reason: `binding mismatch: ${mismatches.join(', ')}` }
  }
}
