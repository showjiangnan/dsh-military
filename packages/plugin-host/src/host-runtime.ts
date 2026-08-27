import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { SessionId as DshSessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import {
  MilitaryError,
  DEFAULT_GENERAL_ROLE_PROMPT,
  brand,
  isoNow,
  validateRolePrompt,
  type AgentExecutionBinding,
  type AgentIdentity,
  type MilitarySessionBinding,
  type MissionId,
  type SessionId,
  type WorkspaceLease,
} from '@dsh-military/contracts'
import {
  DepartmentAgentSpawner,
  SpecialDepartmentAutomation,
  type SpawnedDepartmentAgent,
} from '@dsh-military/runtime'
import {
  SqliteSpecialDepartmentAutomationStore,
  SqliteStateRecords,
} from '@dsh-military/storage-sqlite'
import { createMissionCommand, sha256, stableJson } from '@dsh-military/core'
import { LocalMainGit } from '@dsh-military/infrastructure'
import type { Config } from './config.js'
import type { ApplicationFactoryResult } from './application-factory.js'
import { AgentIdentityDirectory } from './identity.js'
import type {
  MilitaryDepartmentAgentDrainInput,
  MilitaryDepartmentAgentReportInput,
  MilitaryDepartmentAgentSpawnInput,
  MilitaryFeatureSettings,
  MilitaryHostRuntime,
  MilitaryOversightSettings,
  MilitaryTerminalMutationInput,
  MilitaryTerminalMutationReceipt,
} from './context.js'
import { Rc2DepartmentAgentTransport } from './child-transport.js'
import { rc2ReportDelivery } from './rc2-adapter.js'
import { ensureDshCatalogModelCapability } from './model-catalog-bridge.js'

const RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

export class DefaultMilitaryHostRuntime implements MilitaryHostRuntime {
  readonly tenantId: string
  readonly config: Config
  readonly application: ApplicationFactoryResult['application']
  readonly database: ApplicationFactoryResult['database']
  readonly identities = new AgentIdentityDirectory()
  readonly tactics: ApplicationFactoryResult['tactics']
  readonly specs: ApplicationFactoryResult['specs']
  readonly departmentAgents: MilitaryHostRuntime['departmentAgents']
  readonly specialDepartments: MilitaryHostRuntime['specialDepartments']
  readonly #spawner: DepartmentAgentSpawner
  readonly #ctx: Context
  readonly #radioControl: ApplicationFactoryResult['radioControl']
  readonly #policyRegistry: ApplicationFactoryResult['policyRegistry']
  readonly #privateSkillExtractor: ApplicationFactoryResult['privateSkillExtractor']
  readonly #childrenByParent = new Map<string, Set<string>>()
  readonly #parentByChild = new Map<string, string>()
  readonly #sessionBindingFlights = new Map<string, Promise<void>>()
  readonly #terminalReports: SqliteStateRecords
  readonly #terminalReportFlights = new Map<string, {
    readonly contentHash: string
    readonly promise: Promise<string>
  }>()
  readonly #terminalMutationFlights = new Map<string, {
    readonly fingerprint: string
    readonly promise: Promise<unknown>
  }>()
  readonly #roleToolSchemas = new Map<string, ToolSchema>()
  #oversightSettings: MilitaryOversightSettings = Object.freeze({
    completionInterlockEnabled: true,
    freezeOnSecondMissingSubmission: true,
    requireObservedToolEvidence: true,
    maximumNoProgressTurns: 3,
  })
  #generalRolePrompt: string
  #featureSettings: MilitaryFeatureSettings
  #closed = false

  constructor(ctx: Context, config: Config, factory: ApplicationFactoryResult) {
    this.#ctx = ctx
    this.tenantId = config.tenantId
    this.config = config
    this.application = factory.application
    this.database = factory.database
    this.#radioControl = factory.radioControl
    this.#policyRegistry = factory.policyRegistry
    this.#privateSkillExtractor = factory.privateSkillExtractor
    this.#terminalReports = new SqliteStateRecords(this.database, this.tenantId)
    this.#generalRolePrompt = DEFAULT_GENERAL_ROLE_PROMPT
    this.tactics = factory.tactics
    this.specs = factory.specs
    this.#featureSettings = freezeFeatureSettings({
      radio: {
        maxAttempts: config.maxRadioAttempts,
        leaseSeconds: config.radioLeaseSeconds,
      },
      staff: {
        chiefOfStaffFallbackEnabled: true,
      },
      tactics: {
        candidateRecallMinimum: 3,
        candidateRecallMaximum: 5,
        allowCanaryDelivery: true,
      },
      memory: {
        trajectoryAfterWave: true,
        effectivenessAfterGeneralCompaction: true,
      },
      specs: {
        commitMessagePrefix: 'docs(specs):',
      },
    })
    this.#spawner = new DepartmentAgentSpawner({
      templates: this.application.templates,
      policies: this.application.policies,
      bindings: this.application.executionBindings,
      grants: this.application.capabilityGrants,
      budgets: this.application.resourceBudgets,
      router: this.application.executionRouter,
      runtime: this.application.runtime,
      transport: new Rc2DepartmentAgentTransport(ctx, this),
      workspace: {
        prepare: async ({ request, template, identity }) => {
          if (template.role !== 'worker' && template.role !== 'engineer') return undefined
          if (request.taskId === undefined) {
            throw new MilitaryError(
              'INVALID_ARGUMENT',
              `${template.role === 'worker' ? 'Worker' : 'Engineer'} spawn requires taskId`,
            )
          }
          const order = await this.application.runtime.getTask(request.taskId)
          if (String(order.missionId) !== String(request.missionId)) {
            throw new MilitaryError('FORBIDDEN_SCOPE', 'Task belongs to another Mission')
          }
          if (order.assignedRole !== template.role) {
            throw new MilitaryError(
              'INVALID_ARGUMENT',
              `Task is assigned to ${order.assignedRole}, not ${template.role}`,
            )
          }
          const rootBinding = await this.application.sessionGate.requireMilitarySession(request.rootSessionId)
          const snapshot = await this.application.workspaces.snapshot({
            tenantId: request.tenantId,
            workspaceKey: rootBinding.workspaceKey,
            signal: request.signal,
          })
          if (template.role === 'worker') {
            const materialChanges = await new LocalMainGit(rootBinding.workspaceKey)
              .materialStatusPaths(request.signal)
            if (materialChanges.length > 0) {
              throw new MilitaryError(
                'RESOURCE_LOCKED',
                'Worker isolation requires local main to contain no material changes; commit or stash those paths first',
                { paths: materialChanges },
              )
            }
          }
          const lease: WorkspaceLease = {
            schemaVersion: '1.0.0',
            workspaceLeaseId: `workspace-lease-${crypto.randomUUID()}`,
            tenantId: request.tenantId,
            missionId: String(request.missionId),
            taskId: String(order.taskId),
            taskVersion: Number(order.taskVersion),
            agent: identity,
            workspaceSnapshotId: snapshot.workspaceSnapshotId,
            mode: template.role === 'worker' ? 'WRITE' : 'READ',
            pathScope: {
              readPaths: [...order.scope.readPaths],
              writePaths: [...order.scope.writePaths],
              forbiddenPaths: [...order.scope.forbiddenPaths],
            },
            state: 'ACTIVE',
            leaseVersion: 1,
            acquiredAt: isoNow(),
            expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()),
          }
          await this.application.workspaces.lease(lease)
          return { lease, executionCwd: this.application.workspaces.executionPath(lease.workspaceLeaseId) }
        },
        release: async workspaceLeaseId => { await this.application.workspaces.release(workspaceLeaseId) },
      },
    })
    this.departmentAgents = Object.freeze({
      spawn: (input: MilitaryDepartmentAgentSpawnInput) => this.#spawnDepartmentAgent(input),
      report: (input: MilitaryDepartmentAgentReportInput) => this.#reportDepartmentAgent(
        input.child,
        input.content,
        input.priority ?? 'ordinary',
        input.signal,
        input.idempotencyKey,
      ),
      drain: (input: MilitaryDepartmentAgentDrainInput) => this.#drainDepartmentAgents(input.parent, input.childSessionIds),
    })
    this.specialDepartments = new SpecialDepartmentAutomation({
      ledger: this.application.ledger,
      store: new SqliteSpecialDepartmentAutomationStore(this.database, this.tenantId),
      enabled: (kind) => {
        if (kind === 'TRAJECTORY_AFTER_WAVE') {
          return this.#featureSettings.memory.trajectoryAfterWave
        }
        if (kind === 'EFFECTIVENESS_AFTER_GENERAL_COMPACTION') {
          return this.#featureSettings.memory.effectivenessAfterGeneralCompaction
        }
        return true
      },
      dispatcher: {
        dispatch: async (job, parent, signal) => {
          const spawned = await this.departmentAgents.spawn({
            parent,
            templateId: job.templateId,
            prompt: job.prompt,
            label: job.label,
            idempotencyKey: `${job.jobId}:attempt:${job.attempts}`,
            signal,
          })
          return {
            childSessionId: String(spawned.childSessionId),
            bindingId: spawned.bindingId,
          }
        },
      },
    })
  }

  async ensureDshModelCapability(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ) {
    return await ensureDshCatalogModelCapability({
      ctx: this.#ctx,
      policies: this.#policyRegistry,
      provider,
      model,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  updatePrivateSkillExtractionSettings(settings: {
    readonly provider: string
    readonly model: string
    readonly maxOutputTokens: number
  }): void {
    this.#privateSkillExtractor.configure({
      provider: settings.provider,
      model: settings.model,
      maxTokens: settings.maxOutputTokens,
    })
  }

  registerRoleToolSchemas(schemas: readonly ToolSchema[]): void {
    for (const schema of schemas) {
      this.#roleToolSchemas.set(schema.name, structuredClone(schema))
    }
  }

  roleToolSchemas(): readonly ToolSchema[] {
    return [...this.#roleToolSchemas.values()].map(schema => structuredClone(schema))
  }

  isMilitaryAgent(agent: Agent): boolean {
    return (this.#ctx.agentPresets?.composedPreset(agent.ctx) ?? resolveSessionPreset(agent.session)) === 'military'
  }

  oversightSettings(): MilitaryOversightSettings {
    return this.#oversightSettings
  }

  generalRolePrompt(): string {
    return this.#generalRolePrompt
  }

  updateGeneralRolePrompt(prompt: string): void {
    this.#generalRolePrompt = validateRolePrompt(prompt, 'General 角色提示词')
  }

  featureSettings(): MilitaryFeatureSettings {
    return this.#featureSettings
  }

  updateFeatureSettings(settings: Partial<{
    readonly radio: MilitaryFeatureSettings['radio']
    readonly staff: MilitaryFeatureSettings['staff']
    readonly tactics: MilitaryFeatureSettings['tactics']
    readonly memory: MilitaryFeatureSettings['memory']
    readonly specs: MilitaryFeatureSettings['specs']
  }>): void {
    const next = freezeFeatureSettings({
      ...this.#featureSettings,
      ...settings,
    })
    if (next.tactics.candidateRecallMinimum > next.tactics.candidateRecallMaximum) {
      throw new TypeError('candidateRecallMinimum must not exceed candidateRecallMaximum')
    }
    if (settings.radio !== undefined) {
      this.#radioControl.updateLimits({
        maxAttempts: next.radio.maxAttempts,
        leaseMs: next.radio.leaseSeconds * 1_000,
      })
    }
    this.#featureSettings = next
  }

  updateOversightSettings(settings: MilitaryOversightSettings): void {
    this.#oversightSettings = Object.freeze({ ...settings })
  }

  async runTerminalMutation<T>(
    input: MilitaryTerminalMutationInput<T>,
  ): Promise<MilitaryTerminalMutationReceipt<T>> {
    const recordKey = [
      String(input.identity.sessionId),
      String(input.identity.agentId),
      String(input.identity.generation),
      input.actionKey,
    ].join(':')
    const stored = this.#terminalMutations<T>(recordKey, input.fingerprint)
    if (stored !== null) return { value: stored, replayed: true }

    const active = this.#terminalMutationFlights.get(recordKey)
    if (active !== undefined) {
      if (active.fingerprint !== input.fingerprint) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          `terminal action ${recordKey} is already running with a different draft`,
        )
      }
      const value = await active.promise as T
      return { value, replayed: true }
    }
    const flight = input.operation().then((value) => {
      const canonical = canonicalTerminalValue(value)
      try {
        this.#terminalReports.putSync(
          'terminal-domain-mutation',
          recordKey,
          { fingerprint: input.fingerprint, value: canonical },
          { createOnly: true },
        )
        return value
      } catch (error) {
        const raced = this.#terminalMutations<T>(recordKey, input.fingerprint)
        if (raced !== null) return raced
        throw error
      }
    })
    const activeRecord = { fingerprint: input.fingerprint, promise: flight }
    this.#terminalMutationFlights.set(recordKey, activeRecord)
    try {
      return { value: await flight, replayed: false }
    } finally {
      if (this.#terminalMutationFlights.get(recordKey) === activeRecord) {
        this.#terminalMutationFlights.delete(recordKey)
      }
    }
  }

  identity(agent: Agent): AgentIdentity {
    return this.identities.require(agent)
  }

  async identityFor(agent: Agent): Promise<AgentIdentity> {
    const known = this.identities.get(String(agent.id))
    if (known !== undefined) return known
    if (agent.session.header.parentSession === undefined) return this.identities.require(agent)
    const binding = await this.application.executionBindings.forSession(String(agent.id))
    if (binding === null) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING', 'resumed Military child has no durable execution binding')
    if (String(binding.agent.sessionId) !== String(agent.id)) {
      throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH', 'execution binding session does not match resumed child')
    }
    this.identities.bind(binding.agent)
    return binding.agent
  }

  async ensureSessionBinding(agent: Agent): Promise<void> {
    const key = String(agent.id)
    const existing = this.#sessionBindingFlights.get(key)
    if (existing !== undefined) return await existing
    const flight = this.#bindSession(agent)
    this.#sessionBindingFlights.set(key, flight)
    try {
      await flight
    } finally {
      if (this.#sessionBindingFlights.get(key) === flight) {
        this.#sessionBindingFlights.delete(key)
      }
    }
  }

  async #bindSession(agent: Agent): Promise<void> {
    if (!this.isMilitaryAgent(agent)) throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    const identity = await this.identityFor(agent)
    try {
      const existing = await this.application.sessionGate.requireMilitarySession(identity.sessionId)
      await this.#ensureAuthorityContext(identity, existing)
      return
    } catch (error) {
      if (!(error instanceof MilitaryError)
        || (error.failure.code !== 'MILITARY_PRESET_REQUIRED' && error.failure.code !== 'NOT_FOUND')) throw error
    }

    const current = await this.application.presetGenerations.current()
    const parentId = agent.session.header.parentSession
    const parentBinding = parentId === undefined
      ? undefined
      : await this.application.sessionGate.requireMilitarySession(brand<string, 'SessionId'>(String(parentId)))
    if (parentBinding === undefined && hasMaterialSessionHistory(agent)) {
      const reason = 'resumed Military root has interaction history but no durable MilitarySessionBinding; exact preset generation cannot be proven'
      agent.cancel({ kind: 'hook', reason: 'dsh-military missing root session binding' }, { keepInbox: true })
      throw new MilitaryError('MILITARY_PRESET_GENERATION_MISMATCH', reason)
    }
    const requested = parentBinding?.presetGeneration ?? current.generation
    const receipt = await this.application.presetGenerations.resume({
      sessionId: identity.sessionId,
      requestedGeneration: requested,
      signal: AbortSignal.timeout(30_000),
    })

    // RC.2 resumes a root by preset ID, not by a generation-addressable mount.
    // An archived generation can be proven present, but cannot safely replace a
    // non-blank resumed root composition through the public third-party seam.
    if (receipt.disposition === 'QUARANTINED'
      || receipt.disposition === 'MIGRATION_REQUIRED'
      || (receipt.disposition === 'ARCHIVE_REBOUND' && parentBinding === undefined)) {
      const reason = receipt.disposition === 'ARCHIVE_REBOUND'
        ? 'RC.2 cannot recompose a non-blank resumed root to an archived preset generation'
        : receipt.reason
      this.#ctx.logger.warn(`dsh-military quarantined session ${String(agent.id)}: ${reason}`)
      agent.cancel({ kind: 'hook', reason: 'dsh-military preset generation quarantine' }, { keepInbox: true })
      throw new MilitaryError('MILITARY_PRESET_GENERATION_MISMATCH', reason)
    }

    const generation = receipt.resolvedGeneration ?? requested
    if (parentBinding !== undefined && generation !== parentBinding.presetGeneration) {
      throw new MilitaryError('MILITARY_BINDING_MISMATCH', 'child generation differs from parent generation')
    }
    const capabilityFingerprint = parentBinding?.capabilityFingerprint
      ?? brand<string, 'Sha256'>(fingerprint(generation, String(current.assetHash)))
    const binding: MilitarySessionBinding = {
      schemaVersion: '1.0.0',
      sessionId: identity.sessionId,
      presetId: 'military',
      presetGeneration: generation,
      rootAgentId: parentBinding?.rootAgentId ?? identity.agentId,
      activatedAt: isoNow(),
      workspaceKey: authoritativeSessionWorkspaceKey(
        parentBinding,
        agent.session.header.cwd,
      ),
      selectionSource: parentId === undefined ? 'new-session-selection' : 'resume',
      capabilityFingerprint,
      ...(parentId === undefined ? {} : { parentSessionId: brand<string, 'SessionId'>(String(parentId)) }),
      tenantId: this.tenantId,
      generationManifestRef: `preset-generation:${String(current.assetHash)}`,
      dshBaselineCommit: RC2_COMMIT,
      resumeDisposition: parentId === undefined ? 'NEW' : receipt.disposition,
    }
    await this.application.sessionGate.bind(binding)
    if (parentId !== undefined) {
      await this.application.sessionGate.verifyChild(brand<string, 'SessionId'>(String(parentId)), identity.sessionId)
    }
    await this.#ensureAuthorityContext(identity, binding)
    this.#ctx.logger.debug(`dsh-military bound session ${String(agent.id)} to ${generation}`)
  }

  async #ensureAuthorityContext(
    identity: AgentIdentity,
    sessionBinding: MilitarySessionBinding,
  ): Promise<void> {
    let ceiling: import('@dsh-military/contracts').DataClassification = 'restricted'
    if (identity.role !== 'general') {
      const execution = await this.application.executionBindings.forAgent(
        String(identity.agentId),
        identity.generation,
      )
      if (execution === null) throw new MilitaryError('AGENT_EXECUTION_BINDING_MISSING')
      ceiling = (await this.application.policies.permissionProfile(
        execution.permissionProfile.id,
        Number(execution.permissionProfile.revision),
      )).classificationCeiling
    }
    await this.application.authorization.registerContext({
      schemaVersion: '1.0.0',
      authorityContextId: `authority:${String(identity.agentId)}@${identity.generation}:${String(identity.sessionId)}`,
      principalId: String(identity.agentId),
      tenantId: this.tenantId,
      roles: [identity.role],
      scopes: ['agent.spawn*', 'model.execute*', 'tool.execute*', 'mission.command*'],
      sessionOwnership: [String(identity.sessionId)],
      workspaceMemberships: [sessionBinding.workspaceKey],
      dataClassificationCeiling: ceiling,
      authorizationReceiptRefs: [],
      issuedAt: isoNow(),
      expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
    })
  }

  async #spawnDepartmentAgent(input: MilitaryDepartmentAgentSpawnInput): Promise<SpawnedDepartmentAgent> {
    await this.ensureSessionBinding(input.parent)
    const parentIdentity = await this.identityFor(input.parent)
    const parentBinding = await this.application.sessionGate.requireMilitarySession(parentIdentity.sessionId)
    const rootSessionId = await this.#rootSessionId(parentBinding)
    const missionId = await this.#missionId(input.parent, parentIdentity)
    const taskOrder = input.taskId === undefined ? undefined : await this.application.runtime.getTask(input.taskId)
    const idempotencyKey = input.idempotencyKey ?? await this.#departmentDispatchKey({
      rootSessionId,
      missionId,
      templateId: String(input.templateId),
      prompt: input.prompt,
      ...(taskOrder === undefined
        ? {}
        : {
            taskId: String(taskOrder.taskId),
            taskVersion: Number(taskOrder.taskVersion),
          }),
    })
    const authorityContext = await this.application.authorization.resolve(
      String(parentIdentity.agentId),
      this.tenantId,
    )
    const authority = await this.application.authorization.authorize({
      context: authorityContext,
      action: 'agent.spawn',
      resource: `${String(input.templateId)}:${String(missionId)}${input.taskId === undefined ? '' : `:${String(input.taskId)}`}`,
      classification: 'internal',
    })
    if (!authority.allowed) {
      throw new MilitaryError(
        'UNAUTHORIZED',
        `department spawn authority denied: ${authority.reason ?? 'no matching authority'}`,
      )
    }
    return await this.#spawner.spawn({
      tenantId: this.tenantId,
      rootSessionId,
      parentSessionId: parentIdentity.sessionId,
      missionId,
      templateId: input.templateId,
      presetGeneration: parentBinding.presetGeneration,
      prompt: input.prompt,
      label: input.label,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(taskOrder === undefined ? {} : { taskOrder }),
      idempotencyKey,
      signal: input.signal,
    })
  }

  async #departmentDispatchKey(input: {
    readonly rootSessionId: SessionId
    readonly missionId: MissionId
    readonly templateId: string
    readonly prompt: string
    readonly taskId?: string
    readonly taskVersion?: number
  }): Promise<string> {
    if (input.taskId !== undefined) {
      return `task-dispatch:${sha256(stableJson({
        rootSessionId: String(input.rootSessionId),
        missionId: String(input.missionId),
        taskId: input.taskId,
        taskVersion: input.taskVersion,
        templateId: input.templateId,
      })).slice(0, 40)}`
    }
    const mission = await this.application.ledger.readMission(input.missionId)
    return `advisor-dispatch:${sha256(stableJson({
      rootSessionId: String(input.rootSessionId),
      missionId: String(input.missionId),
      missionRevision: Number(mission.revision),
      templateId: input.templateId,
      question: normalizeDispatchText(input.prompt),
    })).slice(0, 40)}`
  }

  async #rootSessionId(binding: MilitarySessionBinding): Promise<SessionId> {
    let current = binding
    while (current.parentSessionId !== undefined) {
      current = await this.application.sessionGate.requireMilitarySession(current.parentSessionId)
    }
    return current.sessionId
  }

  async #missionId(agent: Agent, identity: AgentIdentity): Promise<MissionId> {
    if (identity.role !== 'general') {
      const execution = await this.application.executionBindings.forAgent(String(identity.agentId), identity.generation)
      if (execution !== null) return brand<string, 'MissionId'>(execution.missionId)
    }
    const binding = await this.application.sessionGate.requireMilitarySession(identity.sessionId)
    const rootSessionId = await this.#rootSessionId(binding)
    const missionId = await this.application.runtime.missionForSession(rootSessionId)
    if (missionId !== null) return missionId
    throw new MilitaryError('NOT_FOUND', 'no active Military mission is bound to the parent session')
  }

  trackDepartmentChild(parent: Agent, childSessionId: string): void {
    if (this.#closed) throw new Error('dsh-military host is closed')
    const parentId = String(parent.id)
    const existingParent = this.#parentByChild.get(childSessionId)
    if (existingParent !== undefined && existingParent !== parentId) {
      throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH', `Military child ${childSessionId} is already owned by another parent`)
    }
    this.#parentByChild.set(childSessionId, parentId)
    let children = this.#childrenByParent.get(parentId)
    if (children === undefined) {
      children = new Set<string>()
      this.#childrenByParent.set(parentId, children)
    }
    children.add(childSessionId)
  }

  async abortMilitaryAgent(agent: Agent, reason: string): Promise<void> {
    if (!this.isMilitaryAgent(agent)) return
    const identity = await this.identityFor(agent)
    this.application.oversight.terminate(identity, reason)
    const agentId = String(agent.id)
    if (identity.role === 'general') {
      const children = [...(this.#childrenByParent.get(agentId) ?? [])]
      await Promise.all(children.map(async childId => {
        await this.forgetDepartmentChild(childId, `PARENT_CANCELLED:${reason}`)
      }))
      if (children.length > 0 && this.#ctx.subagents !== undefined) {
        void this.#ctx.subagents.drainContinuableChildren(
          agent,
          children.map(id => id as DshSessionId),
        ).catch(error => {
          this.#ctx.logger.error(
            `dsh-military failed to drain children after aborting ${agentId}`,
            error,
          )
        })
      }
      return
    }

    await this.forgetDepartmentChild(agentId, reason)
    const parentId = agent.session.header.parentSession
    const parent = parentId === undefined ? undefined : this.#ctx.agents?.get(parentId)
    if (parent !== undefined && this.#ctx.subagents !== undefined) {
      // Do not await teardown of the Agent whose hook/event is currently
      // running; cleanup above is durable, and the asynchronous drain begins
      // after this listener releases the RC.2 driver.
      void this.#ctx.subagents.drainContinuableChildren(
        parent,
        [agentId as DshSessionId],
      ).catch(error => {
        this.#ctx.logger.error(
          `dsh-military failed to drain aborted child ${agentId}`,
          error,
        )
      })
    }
  }

  async forgetDepartmentChild(childSessionId: string, reason = 'AGENT_RELEASED'): Promise<void> {
    const parentId = this.#parentByChild.get(childSessionId)
    if (parentId !== undefined) {
      this.#parentByChild.delete(childSessionId)
      const children = this.#childrenByParent.get(parentId)
      children?.delete(childSessionId)
      if (children?.size === 0) this.#childrenByParent.delete(parentId)
    }
    const binding = await this.application.executionBindings.forSession(childSessionId)
    this.identities.unbind(childSessionId)
    if (binding !== null) {
      await this.application.capabilityGrants.revoke(binding.capabilityGrantId, 'AGENT_RELEASED').catch(() => undefined)
      await this.application.resourceBudgets.revoke(
        binding.concurrencyReservationId,
        'AGENT_RELEASED',
      ).catch(() => undefined)
    }
    if (binding?.workspace !== undefined) {
      if (isCancellationReason(reason)) {
        await this.#cancelTask(binding, reason).catch(error => {
          this.#ctx.logger.warn(
            `dsh-military Task cancellation convergence failed for ${childSessionId}`,
            error,
          )
        })
      } else {
        await this.#releaseTaskLease(binding, reason).catch(() => undefined)
      }
      await this.application.workspaces.release(binding.workspace.leaseId).catch(() => undefined)
    }
  }

  async #cancelTask(binding: AgentExecutionBinding, reason: string): Promise<void> {
    if (binding.workspace === undefined) return
    const missionId = brand<string, 'MissionId'>(binding.missionId)
    const taskId = brand<string, 'TaskId'>(binding.workspace.taskId)
    const taskVersion = brand<number, 'TaskVersion'>(binding.workspace.taskVersion)
    const snapshot = await this.application.ledger.readMission(missionId)
    const command = createMissionCommand({
      tenantId: binding.tenantId, missionId, expectedRevision: snapshot.revision,
      actor: binding.agent, actorAuthorityRef: `execution-binding:${binding.bindingId}`,
      type: 'task.cancel',
      payload: { taskId: String(taskId), taskVersion: Number(taskVersion), reason },
      idempotencyKey: `task-cancel:${String(taskId)}:${Number(taskVersion)}:${String(binding.agent.agentId)}:${binding.agent.generation}:${reason}`,
      taskId, taskVersion, activationId: String(binding.agent.sessionId),
    })
    await this.application.missionKernel.execute(
      command,
      () => this.application.runtime.cancelTask(taskId, binding.agent, reason),
    )
  }

  async #releaseTaskLease(binding: AgentExecutionBinding, reason: string): Promise<void> {
    if (binding.workspace === undefined) return
    const missionId = brand<string, 'MissionId'>(binding.missionId)
    const taskId = brand<string, 'TaskId'>(binding.workspace.taskId)
    const taskVersion = brand<number, 'TaskVersion'>(binding.workspace.taskVersion)
    const snapshot = await this.application.ledger.readMission(missionId)
    const command = createMissionCommand({
      tenantId: binding.tenantId, missionId, expectedRevision: snapshot.revision, actor: binding.agent,
      actorAuthorityRef: `execution-binding:${binding.bindingId}`, type: 'task.lease.release',
      payload: { taskId: String(taskId), taskVersion: Number(taskVersion), reason },
      idempotencyKey: `task-lease-release:${String(taskId)}:${Number(taskVersion)}:${String(binding.agent.agentId)}:${binding.agent.generation}:${reason}`,
      taskId, taskVersion, activationId: String(binding.agent.sessionId),
    })
    await this.application.missionKernel.execute(command, () => this.application.runtime.releaseTaskLease(taskId, binding.agent, reason))
  }

  async #reportDepartmentAgent(
    child: Agent,
    content: ContentBlock[],
    priority: 'ordinary' | 'critical',
    signal: AbortSignal,
    idempotencyKey?: string,
  ): Promise<string> {
    if (idempotencyKey === undefined) {
      return await this.#deliverDepartmentReport(child, content, priority, signal)
    }
    const recordKey = `${String(child.id)}:${idempotencyKey}`
    const contentHash = sha256(stableJson(content))
    const stored = this.#terminalReports.readSync<{
      readonly messageId: string
      readonly contentHash: string
    }>('terminal-parent-report', recordKey)
    if (stored !== null) {
      if (stored.contentHash !== contentHash) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          `terminal report key ${idempotencyKey} was already used with different content`,
        )
      }
      return stored.messageId
    }
    const recoveredMessageId = this.#findDeliveredTerminalReport(child, content)
    if (recoveredMessageId !== null) {
      this.#terminalReports.putSync(
        'terminal-parent-report',
        recordKey,
        { messageId: recoveredMessageId, contentHash },
        { createOnly: true },
      )
      return recoveredMessageId
    }
    const active = this.#terminalReportFlights.get(recordKey)
    if (active !== undefined) {
      if (active.contentHash !== contentHash) {
        throw new MilitaryError(
          'IDEMPOTENCY_CONFLICT',
          `terminal report key ${idempotencyKey} is already delivering different content`,
        )
      }
      return await active.promise
    }
    const flight = this.#deliverDepartmentReport(child, content, priority, signal)
      .then(messageId => {
        this.#terminalReports.putSync(
          'terminal-parent-report',
          recordKey,
          { messageId, contentHash },
          { createOnly: true },
        )
        return messageId
      })
    const activeRecord = { contentHash, promise: flight }
    this.#terminalReportFlights.set(recordKey, activeRecord)
    try {
      return await flight
    } finally {
      if (this.#terminalReportFlights.get(recordKey) === activeRecord) {
        this.#terminalReportFlights.delete(recordKey)
      }
    }
  }

  #terminalMutations<T>(recordKey: string, fingerprintValue: string): T | null {
    const stored = this.#terminalReports.readSync<{
      readonly fingerprint: string
      readonly value: T
    }>('terminal-domain-mutation', recordKey)
    if (stored === null) return null
    if (stored.fingerprint !== fingerprintValue) {
      throw new MilitaryError(
        'IDEMPOTENCY_CONFLICT',
        `terminal action ${recordKey} was already used with a different draft`,
      )
    }
    return stored.value
  }

  #findDeliveredTerminalReport(child: Agent, content: ContentBlock[]): string | null {
    const parentId = child.session.header.parentSession
    const parent = parentId === undefined ? undefined : this.#ctx.agents?.get(parentId)
    if (parent === undefined) return null
    for (let index = parent.session.events.length - 1; index >= 0; index -= 1) {
      const event = parent.session.events[index]
      if (event?.type !== 'user/message') continue
      const data = event.data as {
        readonly id?: unknown
        readonly content?: unknown
        readonly source?: {
          readonly kind?: unknown
          readonly senderSessionId?: unknown
        }
      }
      if (data.source?.kind !== 'subagent-report'
        || String(data.source.senderSessionId ?? '') !== String(child.id)
        || typeof data.id !== 'string'
        || !Array.isArray(data.content)) continue
      const delivered = data.content.slice(1)
      if (stableJson(delivered) === stableJson(content)) return data.id
    }
    return null
  }

  async #deliverDepartmentReport(
    child: Agent,
    content: ContentBlock[],
    priority: 'ordinary' | 'critical',
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.isMilitaryAgent(child)) throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    const subagents = this.#ctx.subagents
    if (subagents === undefined) throw new MilitaryError('ADVISOR_UNAVAILABLE', 'RC.2 subagent service unavailable')
    await this.ensureSessionBinding(child)
    const messageId = await subagents.reportFrom(child, content, {
      delivery: rc2ReportDelivery(priority),
      signal,
    })
    return String(messageId)
  }

  async #drainDepartmentAgents(parent: Agent, childSessionIds: readonly string[]): Promise<void> {
    if (!this.isMilitaryAgent(parent)) throw new MilitaryError('MILITARY_PRESET_REQUIRED')
    const subagents = this.#ctx.subagents
    if (subagents === undefined) throw new MilitaryError('ADVISOR_UNAVAILABLE', 'RC.2 subagent service unavailable')
    const unique = [...new Set(childSessionIds)]
    for (const childId of unique) {
      const expectedParent = this.#parentByChild.get(childId)
      if (expectedParent !== undefined && expectedParent !== String(parent.id)) {
        throw new MilitaryError('UNAUTHORIZED', `Military child ${childId} is not a direct child of ${String(parent.id)}`)
      }
    }
    try {
      await subagents.drainContinuableChildren(parent, unique.map(id => id as DshSessionId))
    } finally {
      await Promise.all(unique.map(async id => { await this.forgetDepartmentChild(id) }))
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const groups = [...this.#childrenByParent.entries()].map(([parentId, children]) => [parentId, [...children]] as const)
    for (const [parentId, children] of groups) {
      const parent = this.#ctx.agents?.get(parentId as DshSessionId)
      try {
        if (parent !== undefined && this.#ctx.subagents !== undefined) {
          await this.#ctx.subagents.drainContinuableChildren(parent, children.map(id => id as DshSessionId))
        }
      } catch (error) {
        this.#ctx.logger.warn(`dsh-military selective child drain failed for ${parentId}`, error)
      } finally {
        await Promise.all(children.map(async id => { await this.forgetDepartmentChild(id) }))
      }
    }
    this.database.close()
  }
}

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


function fingerprint(generation: string, assetHash: string): string {
  return createHash('sha256').update(JSON.stringify({ generation, assetHash, rc2: RC2_COMMIT })).digest('hex')
}

function hasMaterialSessionHistory(agent: Agent): boolean {
  const material = new Set([
    'request/header', 'user/message', 'assistant/message', 'tool/result',
    'turn/start', 'step/start', 'command/run', 'compaction/start',
  ])
  return agent.session.events.some(event => material.has(event.type))
}

function isCancellationReason(reason: string): boolean {
  return reason.includes('USER_CANCELLED')
    || reason.includes('PARENT_CANCELLED')
    || reason.includes('STEP_BUDGET_EXHAUSTED')
    || reason.includes('WALL_CLOCK_')
    || reason.includes('NO_PROGRESS_LIMIT')
    || reason.includes('AGENT_ABORTED')
}

function freezeFeatureSettings(value: MilitaryFeatureSettings): MilitaryFeatureSettings {
  requireIntegerInRange(value.radio.maxAttempts, 1, 32, 'radio.maxAttempts')
  requireIntegerInRange(value.radio.leaseSeconds, 10, 3_600, 'radio.leaseSeconds')
  requireIntegerInRange(value.tactics.candidateRecallMinimum, 1, 10, 'tactics.candidateRecallMinimum')
  requireIntegerInRange(value.tactics.candidateRecallMaximum, 1, 20, 'tactics.candidateRecallMaximum')
  const commitMessagePrefix = value.specs.commitMessagePrefix.trim()
  if (commitMessagePrefix.length < 1
    || commitMessagePrefix.length > 80
    || /[\r\n\u0000]/u.test(commitMessagePrefix)) {
    throw new TypeError('specs.commitMessagePrefix must be one non-empty line up to 80 characters')
  }
  return Object.freeze({
    radio: Object.freeze({ ...value.radio }),
    staff: Object.freeze({ ...value.staff }),
    tactics: Object.freeze({ ...value.tactics }),
    memory: Object.freeze({ ...value.memory }),
    specs: Object.freeze({ commitMessagePrefix }),
  })
}

function canonicalTerminalValue<T>(value: T): T {
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

function requireIntegerInRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
}

function normalizeDispatchText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}
