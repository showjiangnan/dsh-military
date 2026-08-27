import {
  MilitaryError,
  type MilitarySessionBinding,
  type MilitarySessionGate,
  type SessionId,
} from '@dsh-military/contracts'
import { cloneFrozen } from './util.js'

export class InMemoryMilitarySessionGate implements MilitarySessionGate {
  readonly #bindings = new Map<string, MilitarySessionBinding>()

  async requireMilitarySession(sessionId: SessionId): Promise<MilitarySessionBinding> {
    const binding = this.#bindings.get(String(sessionId))
    if (binding === undefined || binding.presetId !== 'military') {
      throw new MilitaryError('MILITARY_PRESET_REQUIRED', `session ${String(sessionId)} is not bound to the military preset`)
    }
    if (binding.resumeDisposition === 'QUARANTINED') {
      throw new MilitaryError('MILITARY_PRESET_GENERATION_MISMATCH', 'session binding is quarantined', {
        sessionId: String(sessionId),
        presetGeneration: binding.presetGeneration,
      })
    }
    return cloneFrozen(binding)
  }

  async bind(binding: MilitarySessionBinding): Promise<void> {
    const id = String(binding.sessionId)
    const existing = this.#bindings.get(id)
    if (existing !== undefined) {
      if (existing.presetGeneration !== binding.presetGeneration || existing.capabilityFingerprint !== binding.capabilityFingerprint) {
        throw new MilitaryError('MILITARY_BINDING_MISMATCH', 'session already has a different military binding', { sessionId: id })
      }
      return
    }
    if (binding.presetId !== 'military') throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    this.#bindings.set(id, cloneFrozen(binding))
  }

  async verifyChild(parentSessionId: SessionId, childSessionId: SessionId): Promise<void> {
    const parent = await this.requireMilitarySession(parentSessionId)
    const child = await this.requireMilitarySession(childSessionId)
    if (child.parentSessionId !== parent.sessionId
      || child.presetGeneration !== parent.presetGeneration
      || child.capabilityFingerprint !== parent.capabilityFingerprint) {
      throw new MilitaryError('MILITARY_BINDING_MISMATCH', 'child did not inherit the exact parent military generation', {
        parentSessionId: String(parentSessionId), childSessionId: String(childSessionId),
      })
    }
  }

  list(): readonly MilitarySessionBinding[] {
    return cloneFrozen([...this.#bindings.values()])
  }
}
