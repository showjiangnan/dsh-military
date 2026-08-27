import { brand, type AgentIdentity, type MilitaryRole } from '@dsh-military/contracts'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Process-local identity directory. Durable identity is always reconstructed from execution bindings. */
export class AgentIdentityDirectory {
  readonly #bySession = new Map<string, AgentIdentity>()

  bind(identity: AgentIdentity): void {
    const key = String(identity.sessionId)
    const current = this.#bySession.get(key)
    if (current !== undefined && (current.agentId !== identity.agentId || current.generation !== identity.generation)) {
      throw new Error(`session ${key} already has a different Military identity`)
    }
    this.#bySession.set(key, Object.freeze({ ...identity }))
  }

  unbind(sessionId: string): void { this.#bySession.delete(sessionId) }

  get(sessionId: string): AgentIdentity | undefined {
    const value = this.#bySession.get(sessionId)
    return value === undefined ? undefined : { ...value }
  }

  require(agent: Agent): AgentIdentity {
    const existing = this.get(String(agent.id))
    if (existing !== undefined) return existing
    const role: MilitaryRole = agent.session.header.parentSession === undefined ? 'general' : 'worker'
    const identity: AgentIdentity = {
      agentId: brand<string, 'AgentId'>(String(agent.id)),
      sessionId: brand<string, 'SessionId'>(String(agent.id)),
      role,
      displayName: role === 'general' ? 'General' : 'Military department agent',
      generation: 1,
    }
    this.bind(identity)
    return identity
  }
}
