import {
  MilitaryError,
  type AgentExecutionBinding,
  type MilitaryAgentExecutionBindings,
  type MilitarySessionBinding,
  type MilitarySessionGate,
  type SessionId,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryDatabase } from './database.js'

/** Durable exact-RC.2 Military Session binding repository. */
export class SqliteMilitarySessionGate implements MilitarySessionGate {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  constructor(database: SqliteMilitaryDatabase, tenantId: string) { this.#database = database; this.#tenantId = tenantId }

  async requireMilitarySession(sessionId: SessionId): Promise<MilitarySessionBinding> {
    const row = this.#database.db.prepare(
      'SELECT binding_json FROM military_session_bindings WHERE tenant_id = ? AND session_id = ?',
    ).get(this.#tenantId, String(sessionId)) as { binding_json: string } | undefined
    if (row === undefined) throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    const binding = JSON.parse(row.binding_json) as MilitarySessionBinding
    if (binding.presetId !== 'military') throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    if (binding.resumeDisposition === 'QUARANTINED') throw new MilitaryError('MILITARY_PRESET_GENERATION_MISMATCH')
    return cloneFrozen(binding)
  }

  async bind(binding: MilitarySessionBinding): Promise<void> {
    if (binding.presetId !== 'military') throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    this.#database.transaction(() => {
      const existing = this.#database.db.prepare(
        'SELECT binding_json FROM military_session_bindings WHERE tenant_id = ? AND session_id = ?',
      ).get(this.#tenantId, String(binding.sessionId)) as { binding_json: string } | undefined
      if (existing !== undefined) {
        if (stableJson(JSON.parse(existing.binding_json)) !== stableJson(binding)) throw new MilitaryError('MILITARY_BINDING_MISMATCH')
        return
      }
      const rootSessionId = binding.parentSessionId === undefined
        ? String(binding.sessionId)
        : this.#rootSessionId(binding.parentSessionId)
      this.#database.db.prepare(`
        INSERT INTO military_session_bindings(
          tenant_id, session_id, root_session_id, generation, capability_fingerprint,
          binding_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.#tenantId, String(binding.sessionId), rootSessionId,
        binding.presetGeneration, String(binding.capabilityFingerprint), stableJson(binding), String(binding.activatedAt),
      )
    })
  }

  #rootSessionId(parentSessionId: SessionId): string {
    const row = this.#database.db.prepare(
      'SELECT root_session_id FROM military_session_bindings WHERE tenant_id = ? AND session_id = ?',
    ).get(this.#tenantId, String(parentSessionId)) as { root_session_id: string } | undefined
    if (row === undefined) throw new MilitaryError('MILITARY_BINDING_MISMATCH', 'parent Military session binding is missing')
    return row.root_session_id
  }

  async verifyChild(parentSessionId: SessionId, childSessionId: SessionId): Promise<void> {
    const parent = await this.requireMilitarySession(parentSessionId)
    const child = await this.requireMilitarySession(childSessionId)
    if (String(child.parentSessionId) !== String(parent.sessionId)
      || child.presetGeneration !== parent.presetGeneration
      || child.capabilityFingerprint !== parent.capabilityFingerprint) {
      throw new MilitaryError('MILITARY_BINDING_MISMATCH')
    }
  }
}

/** Durable immutable department-Agent execution binding repository. */
export class SqliteAgentExecutionBindings implements MilitaryAgentExecutionBindings {
  readonly #database: SqliteMilitaryDatabase
  readonly #tenantId: string
  constructor(database: SqliteMilitaryDatabase, tenantId: string) { this.#database = database; this.#tenantId = tenantId }

  async create(binding: AgentExecutionBinding): Promise<void> {
    try {
      this.#database.transaction(() => {
        const existing = this.#database.db.prepare(
          'SELECT binding_json FROM agent_execution_bindings WHERE tenant_id = ? AND binding_id = ?',
        ).get(this.#tenantId, binding.bindingId) as { binding_json: string } | undefined
        if (existing !== undefined) {
          if (stableJson(JSON.parse(existing.binding_json)) !== stableJson(binding)) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH')
          return
        }
        this.#database.db.prepare(`
          INSERT INTO agent_execution_bindings(
            tenant_id, binding_id, root_session_id, mission_id, agent_id,
            agent_generation, template_id, template_revision, preset_generation,
            provider, model, reasoning_effort, binding_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          this.#tenantId, binding.bindingId, binding.rootSessionId, binding.missionId,
          String(binding.agent.agentId), binding.agent.generation, binding.templateId,
          Number(binding.templateRevision), binding.presetGeneration, binding.provider,
          binding.model, binding.reasoningEffort, stableJson(binding), String(binding.createdAt),
        )
      })
    } catch (error) {
      throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH', 'binding uniqueness violation', undefined, { cause: error })
    }
  }

  async discard(bindingId: string): Promise<void> {
    this.#database.transaction(() => {
      this.#database.db.prepare(`
        DELETE FROM agent_execution_bindings
        WHERE tenant_id = ? AND binding_id = ?
      `).run(this.#tenantId, bindingId)
    })
  }

  async get(bindingId: string): Promise<AgentExecutionBinding> {
    const row = this.#database.db.prepare(
      'SELECT binding_json FROM agent_execution_bindings WHERE tenant_id = ? AND binding_id = ?',
    ).get(this.#tenantId, bindingId) as { binding_json: string } | undefined
    if (row === undefined) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
    return cloneFrozen(JSON.parse(row.binding_json) as AgentExecutionBinding)
  }

  async forAgent(agentId: string, generation?: number): Promise<AgentExecutionBinding | null> {
    const row = generation === undefined
      ? this.#database.db.prepare(`
          SELECT binding_json FROM agent_execution_bindings
          WHERE tenant_id = ? AND agent_id = ? ORDER BY agent_generation DESC LIMIT 1
        `).get(this.#tenantId, agentId)
      : this.#database.db.prepare(`
          SELECT binding_json FROM agent_execution_bindings
          WHERE tenant_id = ? AND agent_id = ? AND agent_generation = ?
        `).get(this.#tenantId, agentId, generation)
    if (row === undefined) return null
    return cloneFrozen(JSON.parse((row as { binding_json: string }).binding_json) as AgentExecutionBinding)
  }


  async forSession(sessionId: string): Promise<AgentExecutionBinding | null> {
    const rows = this.#database.db.prepare(`
      SELECT binding_json FROM agent_execution_bindings
      WHERE tenant_id = ? ORDER BY created_at DESC
    `).all(this.#tenantId) as Array<{ binding_json: string }>
    for (const row of rows) {
      const binding = JSON.parse(row.binding_json) as AgentExecutionBinding
      if (String(binding.agent.sessionId) === sessionId) return cloneFrozen(binding)
    }
    return null
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
    return mismatches.length === 0 ? { valid: true } : { valid: false, reason: `binding mismatch: ${mismatches.join(', ')}` }
  }
}
