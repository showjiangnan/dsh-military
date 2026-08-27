import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type AgentIdentity,
  type AgentTemplateId,
  type AgentTemplateProfile,
  type MilitaryAgentExecutionBindings,
  type MilitaryAgentTemplates,
  type MilitaryPolicyRegistry,
  type MilitaryCapabilityGrants,
  type MilitaryExecutionRouter,
  type MilitaryResourceBudgets,
  type ResourceBudgetPolicy,
  type ResourceBudgetReservation,
  type ResourceCounters,
  type TaskOrder, type TaskCapabilityProfile, type ExecutionStrategy,
  type CapabilityGrant,
  type MilitaryRuntime,
  type MissionId,
  type SessionId,
  type TaskId,
  type ToolProfile,
  type WorkspaceLease,
  taskControlToolNames,
} from '@dsh-military/contracts'
import {
  cloneFrozen,
  now,
  sha256,
  stableJson,
  uuid,
  zeroCounters,
  type Clock,
} from '@dsh-military/core'

export interface DepartmentAgentSpawnRequest {
  readonly tenantId: string
  readonly rootSessionId: SessionId
  readonly parentSessionId: SessionId
  readonly missionId: MissionId
  readonly templateId: AgentTemplateId
  readonly presetGeneration: string
  readonly prompt: string
  readonly label: string
  /** Required for Task-bound Worker and Engineer templates. */
  readonly taskId?: TaskId
  /** Frozen Task Order used by the adaptive execution router. */
  readonly taskOrder?: TaskOrder
  /** Stable internal key used to recover an accepted continuable dispatch. */
  readonly idempotencyKey?: string
  /** Filled by the workspace coordinator before RC.2 child publication. */
  readonly executionCwd?: string
  readonly workspaceLeaseId?: string
  readonly signal: AbortSignal
}

export interface DepartmentWorkspaceAssignment {
  readonly executionCwd: string
  readonly lease: WorkspaceLease
}

export interface DepartmentWorkspaceCoordinator {
  prepare(input: {
    readonly request: DepartmentAgentSpawnRequest
    readonly template: AgentTemplateProfile
    readonly identity: AgentIdentity
  }): Promise<DepartmentWorkspaceAssignment | undefined>
  release(workspaceLeaseId: string): Promise<void>
}

export interface SpawnedDepartmentAgent {
  readonly identity: AgentIdentity
  readonly childSessionId: SessionId
  readonly bindingId: string
}

/** Transport implemented by the exact RC.2 host adapter. */
export interface DepartmentAgentTransport {
  spawn(input: {
    readonly request: DepartmentAgentSpawnRequest
    readonly template: AgentTemplateProfile
    readonly binding: AgentExecutionBinding
  }): Promise<{ readonly childSessionId: SessionId; readonly identity: AgentIdentity }>
}

/**
 * Resolves one immutable template revision, constructs the effective binding,
 * then delegates only the actual child creation to the DSH transport.
 */
export class DepartmentAgentSpawner {
  readonly #templates: MilitaryAgentTemplates
  readonly #policies: MilitaryPolicyRegistry
  readonly #bindings: MilitaryAgentExecutionBindings
  readonly #grants: MilitaryCapabilityGrants
  readonly #budgets: MilitaryResourceBudgets
  readonly #router: MilitaryExecutionRouter
  readonly #transport: DepartmentAgentTransport
  readonly #runtime: MilitaryRuntime
  readonly #workspace: DepartmentWorkspaceCoordinator | undefined
  readonly #clock: Clock

  constructor(input: {
    readonly templates: MilitaryAgentTemplates
    readonly policies: MilitaryPolicyRegistry
    readonly bindings: MilitaryAgentExecutionBindings
    readonly grants: MilitaryCapabilityGrants
    readonly budgets: MilitaryResourceBudgets
    readonly router: MilitaryExecutionRouter
    readonly transport: DepartmentAgentTransport
    readonly runtime: MilitaryRuntime
    readonly workspace?: DepartmentWorkspaceCoordinator
    readonly clock?: Clock
  }) {
    this.#templates = input.templates
    this.#policies = input.policies
    this.#bindings = input.bindings
    this.#grants = input.grants
    this.#budgets = input.budgets
    this.#router = input.router
    this.#transport = input.transport
    this.#runtime = input.runtime
    this.#workspace = input.workspace
    this.#clock = input.clock ?? (() => new Date())
  }

  async spawn(request: DepartmentAgentSpawnRequest): Promise<SpawnedDepartmentAgent> {
    if (request.signal.aborted) throw request.signal.reason
    const template = await this.#templates.resolveForInstantiation(request.templateId)
    const capability = await this.#policies.modelCapability(template.modelPolicy.provider, template.modelPolicy.model)
    if (capability.contextWindowTokens < template.contextPolicy.contextBudgetTokens) {
      throw new MilitaryError('AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED', 'template context budget exceeds model context')
    }
    const spawnDigest = request.idempotencyKey === undefined
      ? undefined
      : departmentSpawnDigest(request)
    const strategy: ExecutionStrategy = request.taskOrder === undefined
      ? {
          schemaVersion: '1.0.0',
          strategyId: stableSpawnId('execution-strategy', spawnDigest),
          provider: capability.provider, model: capability.model,
          reasoningEffort: template.modelPolicy.reasoningEffort,
          paradigm: template.role === 'advisor' || template.role === 'chief-of-staff' ? 'reflection' : 'react',
          maximumSteps: 8, verificationTier: 'V2', parallelism: 1,
          rationale: ['department-template-default', `role=${template.role}`],
        }
      : await this.#router.route({
          task: request.taskOrder,
          capability: taskCapability(request.taskOrder, template),
          candidateModels: [capability],
          allowCanary: template.modelPolicy.allowCanaryModel === true,
        })
    const toolProfile = await this.#policies.toolProfile(template.capabilities.toolProfileId, Number(template.capabilities.toolProfileRevision))
    const permissionProfile = await this.#policies.permissionProfile(template.capabilities.permissionProfileId, Number(template.capabilities.permissionProfileRevision))
    const budget = await defaultBudgetPolicyRef(this.#policies)
    const budgetPolicy = await this.#policies.resourceBudgetPolicy(
      budget.id,
      Number(budget.revision),
    )
    const identity: AgentIdentity = {
      agentId: brand<string, 'AgentId'>(stableSpawnId('agent', spawnDigest)),
      sessionId: brand<string, 'SessionId'>(stableSpawnId('session', spawnDigest)),
      role: template.role,
      displayName: template.displayName,
      templateId: template.templateId,
      templateRevision: template.revision,
      generation: 1,
    }
    if ((template.role === 'worker' || template.role === 'engineer')
      && request.taskId === undefined) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        `a ${template.role === 'worker' ? 'Worker' : 'Engineer'} must be spawned for one explicit Task and workspace lease`,
      )
    }
    if (spawnDigest !== undefined) {
      const existing = await this.#bindings.forAgent(
        String(identity.agentId),
        identity.generation,
      )
      if (existing !== null) {
        assertRecoveredBinding(existing, request, template, identity)
        const spawned = await this.#transport.spawn({
          request,
          template,
          binding: existing,
        })
        assertSpawnedIdentity(spawned.identity, identity)
        return cloneFrozen({
          identity: spawned.identity,
          childSessionId: spawned.childSessionId,
          bindingId: existing.bindingId,
        })
      }
    }
    const workspace = await this.#workspace?.prepare({ request, template, identity })
    if ((template.role === 'worker' || template.role === 'engineer')
      && workspace === undefined) {
      throw new MilitaryError(
        'RESOURCE_LOCKED',
        `Task-bound ${template.role === 'worker' ? 'Worker' : 'Engineer'} has no workspace coordinator`,
      )
    }
    const effectiveRequest: DepartmentAgentSpawnRequest = {
      ...request,
      ...(workspace === undefined ? {} : {
        executionCwd: workspace.executionCwd,
        workspaceLeaseId: workspace.lease.workspaceLeaseId,
      }),
    }
    const concurrency = await reserveAgentConcurrencyBudget({
      budgets: this.#budgets,
      policy: budgetPolicy,
      identity,
      tenantId: request.tenantId,
      missionId: request.missionId,
      ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
      ...(request.taskOrder?.budget.wallClockSeconds === undefined ? {} : {
        maximumWallClockSeconds: request.taskOrder.budget.wallClockSeconds,
      }),
      clock: this.#clock,
    })
    const grantId = stableSpawnId('capability-grant', spawnDigest)
    const issuedAt = now(this.#clock)
    const grantTools = taskGrantedTools(toolProfile, request.taskOrder)
    const capabilityGrant: CapabilityGrant = {
      schemaVersion: '1.0.0', grantId, principalId: String(identity.agentId),
      activationId: String(identity.sessionId), missionId: request.missionId,
      taskId: request.taskId ?? brand<string, 'TaskId'>(`mission-control:${String(request.missionId)}:${String(identity.agentId)}`),
      taskVersion: workspace === undefined ? brand<number, 'TaskVersion'>(1) : brand<number, 'TaskVersion'>(workspace.lease.taskVersion),
      allowedTools: grantTools,
      resourcePatterns: [...new Set(workspace === undefined
        ? [...permissionProfile.filesystem.readPaths, ...permissionProfile.filesystem.writePaths]
        : [...workspace.lease.pathScope.readPaths, ...workspace.lease.pathScope.writePaths])],
      dataClassificationCeiling: permissionProfile.classificationCeiling,
      maximumUses: Math.max(
        1,
        Math.min(
          budgetPolicy.limits.toolCalls,
          request.taskOrder?.budget.toolCalls ?? budgetPolicy.limits.toolCalls,
        ),
      ),
      uses: 0, issuedAt,
      expiresAt: concurrency.expiresAt,
      nonce: stableSpawnId('grant-nonce', spawnDigest), state: 'ACTIVE',
    }
    const binding: AgentExecutionBinding = {
      schemaVersion: '1.0.0',
      bindingId: stableSpawnId('agent-binding', spawnDigest),
      tenantId: request.tenantId,
      rootSessionId: String(request.rootSessionId),
      missionId: String(request.missionId),
      agent: identity,
      departmentId: template.department,
      templateId: String(template.templateId),
      templateRevision: template.revision,
      presetGeneration: request.presetGeneration,
      capabilityGrantId: grantId,
      concurrencyReservationId: concurrency.reservationId,
      executionStrategy: strategy,
      provider: strategy.provider,
      model: strategy.model,
      reasoningEffort: strategy.reasoningEffort,
      modelCapabilityProfileId: template.modelPolicy.modelCapabilityProfileId,
      toolProfile: { id: toolProfile.toolProfileId, revision: toolProfile.revision },
      permissionProfile: { id: permissionProfile.permissionProfileId, revision: permissionProfile.revision },
      apiGrants: template.capabilities.apiGrantIds.map(id => ({ id, revision: brand<number, 'Revision'>(1) })),
      dataResidencyPolicy: { id: template.modelPolicy.dataResidencyPolicyRef, revision: brand<number, 'Revision'>(1) },
      redactionPolicy: { id: 'redaction-default', revision: brand<number, 'Revision'>(1) },
      verifierProfiles: (template.capabilities.verifierProfileIds ?? []).map(id => ({ id, revision: brand<number, 'Revision'>(1) })),
      ...(workspace === undefined ? {} : {
        workspace: {
          leaseId: workspace.lease.workspaceLeaseId,
          snapshotId: workspace.lease.workspaceSnapshotId,
          taskId: workspace.lease.taskId,
          taskVersion: workspace.lease.taskVersion,
          executionRootHash: brand<string, 'Sha256'>(sha256(workspace.executionCwd)),
        },
      }),
      contextPolicy: { ...template.contextPolicy },
      resourceBudgetPolicy: budget,
      createdAt: now(this.#clock),
    }
    let grantIssued = false
    let bindingCreated = false
    try {
      await this.#grants.issue(capabilityGrant)
      grantIssued = true
      // Persist the immutable execution binding before the transport submits
      // the first child prompt. The RC.2 continuation manager may begin a
      // model turn immediately after inbox admission, so routing and live
      // capacity must already be durable at that boundary.
      await this.#bindings.create(binding)
      bindingCreated = true
      const spawned = await this.#transport.spawn({ request: effectiveRequest, template, binding })
      assertSpawnedIdentity(spawned.identity, identity)
      return cloneFrozen({ identity: spawned.identity, childSessionId: spawned.childSessionId, bindingId: binding.bindingId })
    } catch (error) {
      if (bindingCreated) {
        await this.#bindings.discard(binding.bindingId).catch(() => undefined)
      }
      if (grantIssued) {
        await this.#grants.discard(grantId).catch(() => undefined)
      }
      await this.#budgets.discard(concurrency.reservationId).catch(() => undefined)
      // The RC.2 transport owns Task lease rollback because it can serialize
      // the lease command immediately before prompt admission. The spawner
      // still owns prepared-worktree and capacity cleanup for every failure.
      if (workspace !== undefined) await this.#workspace?.release(workspace.lease.workspaceLeaseId).catch(() => undefined)
      throw error
    }
  }
}

export function taskGrantedTools(
  profile: ToolProfile,
  order: TaskOrder | undefined,
): readonly string[] {
  const denied = new Set(profile.denyTools)
  if (order === undefined) {
    return profile.allowTools.filter(name => !denied.has(name))
  }
  const task = new Set([...order.allowedTools, ...taskControlToolNames])
  if (order.budget.guidanceRequests === 0) {
    task.delete('military_radio_request')
  }
  return profile.allowTools.filter(name => !denied.has(name) && task.has(name))
}

function departmentSpawnDigest(request: DepartmentAgentSpawnRequest): string {
  return sha256(stableJson({
    tenantId: request.tenantId,
    rootSessionId: String(request.rootSessionId),
    parentSessionId: String(request.parentSessionId),
    missionId: String(request.missionId),
    templateId: String(request.templateId),
    taskId: request.taskId === undefined ? null : String(request.taskId),
    idempotencyKey: request.idempotencyKey,
  })).slice(0, 32)
}

function stableSpawnId(prefix: string, digest: string | undefined): string {
  return digest === undefined ? uuid(prefix) : `${prefix}-${digest}`
}

function assertRecoveredBinding(
  binding: AgentExecutionBinding,
  request: DepartmentAgentSpawnRequest,
  template: AgentTemplateProfile,
  identity: AgentIdentity,
): void {
  if (binding.tenantId !== request.tenantId
    || binding.rootSessionId !== String(request.rootSessionId)
    || binding.missionId !== String(request.missionId)
    || binding.templateId !== String(template.templateId)
    || Number(binding.templateRevision) !== Number(template.revision)
    || binding.presetGeneration !== request.presetGeneration
    || String(binding.agent.agentId) !== String(identity.agentId)
    || String(binding.agent.sessionId) !== String(identity.sessionId)
    || binding.agent.generation !== identity.generation
    || (request.taskId !== undefined
      && binding.workspace?.taskId !== String(request.taskId))) {
    throw new MilitaryError(
      'IDEMPOTENCY_CONFLICT',
      `department spawn key ${request.idempotencyKey ?? ''} resolved to a different immutable binding`,
    )
  }
}

function assertSpawnedIdentity(
  actual: AgentIdentity,
  expected: AgentIdentity,
): void {
  if (String(actual.agentId) !== String(expected.agentId)
    || String(actual.sessionId) !== String(expected.sessionId)
    || actual.generation !== expected.generation) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISMATCH',
      'transport changed the pre-bound agent identity',
    )
  }
}

export function agentConcurrencyReservationId(identity: AgentIdentity): string {
  return `agent-budget-${sha256(stableJson({
    agentId: String(identity.agentId),
    sessionId: String(identity.sessionId),
    generation: identity.generation,
  })).slice(0, 32)}`
}

/** Hold one durable concurrency slot for the complete department-child life. */
export async function reserveAgentConcurrencyBudget(input: {
  readonly budgets: MilitaryResourceBudgets
  readonly policy: ResourceBudgetPolicy
  readonly identity: AgentIdentity
  readonly tenantId: string
  readonly missionId: MissionId
  readonly taskId?: TaskId
  readonly maximumWallClockSeconds?: number
  readonly clock?: Clock
}): Promise<ResourceBudgetReservation> {
  const clock = input.clock ?? (() => new Date())
  const reservationId = agentConcurrencyReservationId(input.identity)
  const reservedAt = now(clock)
  const requested: ResourceCounters = {
    ...zeroCounters(),
    concurrentAgents: 1,
  }
  const accepted = await input.budgets.reserve({
    schemaVersion: '1.0.0',
    reservationId,
    tenantId: input.tenantId,
    scopeType: input.taskId === undefined ? 'MISSION' : 'TASK',
    scopeId: String(input.taskId ?? input.missionId),
    policyId: input.policy.policyId,
    policyRevision: input.policy.revision,
    ownerAgent: input.identity,
    requested,
    granted: zeroCounters(),
    state: 'RESERVED',
    idempotencyKey: `${reservationId}:reserve`,
    reservedAt,
    expiresAt: brand<string, 'IsoDateTime'>(
      new Date(
        Date.parse(reservedAt)
          + Math.max(
            60,
            Math.min(
              input.policy.limits.wallClockSeconds,
              input.maximumWallClockSeconds ?? input.policy.limits.wallClockSeconds,
            ),
          ) * 1000,
      ).toISOString(),
    ),
  })
  if (accepted.state !== 'RESERVED') {
    throw new MilitaryError(
      'BUDGET_RESERVATION_REQUIRED',
      `agent concurrency reservation ${reservationId} is ${accepted.state}`,
    )
  }
  return accepted
}

function taskCapability(order: TaskOrder, template: AgentTemplateProfile): TaskCapabilityProfile {
  const c = order.complexity
  const total = c.semanticDecisions + c.unknownDependencies + c.writeDomains + c.toolFamilies + c.acceptanceAmbiguity + c.integrationFanOut
  const riskClass = total >= 22 ? 'critical' : total >= 15 ? 'high' : total >= 8 ? 'medium' : 'low'
  const minimumReasoning: TaskCapabilityProfile['minimumReasoning'] = riskClass === 'critical' ? 'max' : riskClass === 'high' ? 'high' : template.modelPolicy.reasoningEffort === 'max' ? 'max' : 'high'
  const minimumContextTokens = c.contextFootprint === 'large' ? template.contextPolicy.contextBudgetTokens : c.contextFootprint === 'medium' ? Math.floor(template.contextPolicy.contextBudgetTokens * 0.6) : Math.floor(template.contextPolicy.contextBudgetTokens * 0.3)
  return {
    schemaVersion: '1.0.0', profileId: `task-capability:${String(order.taskId)}:${Number(order.taskVersion)}`,
    semanticCapabilities: [order.taskType, ...order.tactics.map(tactic => String(tactic.skillId))],
    toolCapabilities: [...order.allowedTools], minimumReasoning, minimumContextTokens: Math.max(1, minimumContextTokens),
    inputModalities: ['text'], riskClass, requiredVerificationTier: riskClass === 'critical' ? 'V4' : riskClass === 'high' ? 'V3' : 'V2',
    parallelismInputs: {
      independentSubproblems: Math.max(0, c.integrationFanOut + c.toolFamilies), independentEvidenceSources: order.requiredEvidence.length,
      sharedContext: c.contextFootprint === 'large' ? 3 : c.contextFootprint === 'medium' ? 2 : 1, writeConflict: c.writeDomains,
      temporalDependency: order.dependencies.filter(value => value.type === 'requires' || value.type === 'consumes').length,
      joinCost: c.integrationFanOut, integrationRisk: c.acceptanceAmbiguity + c.writeDomains,
    },
  }
}

async function defaultBudgetPolicyRef(policies: MilitaryPolicyRegistry): Promise<{ readonly id: string; readonly revision: ReturnType<typeof brand<number, 'Revision'>> }> {
  // The registry contract currently resolves by id.  Deployments use the
  // canonical default id unless a later template revision carries an explicit
  // budget policy reference.
  const policy = await policies.resourceBudgetPolicy('budget-default')
  return { id: policy.policyId, revision: policy.revision }
}
