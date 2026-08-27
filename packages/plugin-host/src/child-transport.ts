import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId as DshSessionId } from '@deepseek-ai/dsh-session'
import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type AgentIdentity,
  type AgentTemplateProfile,
  type ToolProfile,
  taskControlToolNames,
} from '@dsh-military/contracts'
import type { DepartmentAgentSpawnRequest, DepartmentAgentTransport } from '@dsh-military/runtime'
import { createMissionCommand } from '@dsh-military/core'
import type { MilitaryHostRuntime } from './context.js'
import { departmentPersona } from './agent-lifecycle.js'
import { assertDispatchFlashReady } from './role-readiness.js'

/** RC.2 transport using the standard durable continuable-subagent manager. */
export class Rc2DepartmentAgentTransport implements DepartmentAgentTransport {
  readonly #ctx: Context
  readonly #host: MilitaryHostRuntime

  constructor(ctx: Context, host: MilitaryHostRuntime) { this.#ctx = ctx; this.#host = host }

  async spawn(input: {
    readonly request: DepartmentAgentSpawnRequest
    readonly template: AgentTemplateProfile
    readonly binding: AgentExecutionBinding
  }): Promise<{ readonly childSessionId: AgentIdentity['sessionId']; readonly identity: AgentIdentity }> {
    const agents = this.#ctx.agents
    const subagents = this.#ctx.subagents
    if (agents === undefined || subagents === undefined) {
      throw new MilitaryError('ADVISOR_UNAVAILABLE', 'RC.2 Agent or continuable-subagent service unavailable')
    }
    const parent = agents.get(String(input.request.parentSessionId) as DshSessionId)
    if (parent === undefined) throw new MilitaryError('NOT_FOUND', 'parent Agent is not live')
    await this.#host.ensureSessionBinding(parent)
    const childId = String(input.binding.agent.sessionId) as DshSessionId
    if (input.request.idempotencyKey !== undefined) {
      const recovered = await this.#recoverAcceptedChild(
        parent,
        childId,
        input.binding,
        input.request.signal,
      )
      if (recovered) {
        return {
          childSessionId: input.binding.agent.sessionId,
          identity: input.binding.agent,
        }
      }
    }
    this.#host.identities.bind(input.binding.agent)
    let taskLeased = false
    let childEstablished = false
    try {
      const profile = await this.#host.application.policies.toolProfile(
        input.binding.toolProfile.id,
        Number(input.binding.toolProfile.revision),
      )
      const visibleTools = modelVisibleDepartmentTools(
        input.request,
        input.template,
        profile,
      )
      await assertDispatchFlashReady({
        ctx: this.#ctx,
        host: this.#host,
        template: input.template,
        binding: input.binding,
        visibleTools,
      })
      if (input.binding.workspace !== undefined) {
        const missionId = brand<string, 'MissionId'>(input.binding.missionId)
        const taskId = brand<string, 'TaskId'>(input.binding.workspace.taskId)
        const taskVersion = brand<number, 'TaskVersion'>(input.binding.workspace.taskVersion)
        const snapshot = await this.#host.application.ledger.readMission(missionId)
        const command = createMissionCommand({
          tenantId: input.binding.tenantId, missionId, expectedRevision: snapshot.revision,
          actor: input.binding.agent, actorAuthorityRef: `execution-binding:${input.binding.bindingId}`,
          type: 'task.lease', payload: { taskId: String(taskId), taskVersion: Number(taskVersion), workspaceLeaseId: input.binding.workspace.leaseId },
          idempotencyKey: `task-lease:${String(taskId)}:${Number(taskVersion)}:${String(input.binding.agent.agentId)}:${input.binding.agent.generation}`,
          taskId, taskVersion, activationId: String(input.binding.agent.sessionId),
        })
        await this.#host.application.missionKernel.execute(command, () => this.#host.application.runtime.leaseTask(
          taskId, input.binding.agent, input.binding.workspace!.leaseId,
        ))
        taskLeased = true
      }
      const workspaceInstruction = departmentWorkspaceInstruction(
        input.request,
        input.template,
      )
      const prompt: ContentBlock[] = [{
        type: 'text',
        text: `[Military 任务令：${input.request.label}]\n\n${input.request.prompt}${workspaceInstruction}\n\n完成交付规则：Military 终态工具成功后会自动持久化结果、通知父级并结束本轮；成功后立即停止，绝不能再调用 report。只有当前任务没有任何适用的 Military 终态工具时，才能且只能调用一次 report。RC.2 会自动唤醒或引导父级，不得要求父级轮询 Session、Agent 或 binding ID。`,
      }]
      const started = await subagents.startContinuable({
        provider: this.#host.config.subagentProvider,
        childId,
        label: input.request.label,
        request: {
          parent,
          prompt,
          agentOptions: {
            provider: input.binding.provider,
            model: input.binding.model,
            maxTokens: input.template.modelPolicy.maxOutputTokens,
          },
          persona: departmentPersona(input.template, input.binding),
          // RC.2 installs `report` inside the unpublished child scope after it
          // applies this restriction to the global catalog. Keep report in the
          // immutable Military profile for execution admission, but omit it
          // from this pre-install intersection; the continuation manager adds
          // the child-scoped definition and guidance before publication.
          toolFilter: {
            allow: visibleTools.filter(name => name !== 'report'),
          },
        },
        signal: input.request.signal,
      })
      childEstablished = true
      if (String(started.childId) !== String(childId)) {
        throw new MilitaryError('AGENT_EXECUTION_BINDING_MISMATCH', 'RC.2 continuable manager changed the reserved child id')
      }
      const child = agents.get(started.childId)
      if (child === undefined) throw new MilitaryError('NOT_FOUND', 'RC.2 child was admitted but is not present in the live Agent registry')
      await this.#host.ensureSessionBinding(child)
      // Execution and workspace identities live in the Military database and
      // Mission Ledger. RC.2 has no public registration seam for out-of-repo
      // required Session event types, so no custom military/* event is appended
      // to the DSH Session log.
      this.#host.trackDepartmentChild(parent, String(childId))
      return { childSessionId: input.binding.agent.sessionId, identity: input.binding.agent }
    } catch (error) {
      if (childEstablished) {
        await subagents.drainContinuableChildren(parent, [childId]).catch(() => undefined)
      }
      if (taskLeased && input.binding.workspace !== undefined) {
        await releaseTaskLeaseThroughKernel(this.#host, input.binding, 'CHILD_START_FAILED').catch(() => undefined)
      }
      this.#host.identities.unbind(String(childId))
      throw error
    }
  }

  async #recoverAcceptedChild(
    parent: Agent,
    childId: DshSessionId,
    binding: AgentExecutionBinding,
    signal: AbortSignal,
  ): Promise<boolean> {
    const live = this.#ctx.agents?.get(childId)
    if (live !== undefined) {
      assertDirectParent(live, parent)
      this.#host.identities.bind(binding.agent)
      await this.#host.ensureSessionBinding(live)
      this.#host.trackDepartmentChild(parent, String(childId))
      return true
    }
    const snapshots = await this.#ctx.sessionPersistence?.listSnapshots(signal)
    const persisted = snapshots?.find(snapshot => String(snapshot.header.id) === String(childId))
    if (persisted === undefined) return false
    if (String(persisted.header.parentSession ?? '') !== String(parent.id)) {
      throw new MilitaryError(
        'AGENT_EXECUTION_BINDING_MISMATCH',
        'persisted idempotent child belongs to another direct parent',
      )
    }
    // A persisted snapshot proves that RC.2 accepted the original initial
    // prompt. The child may already be settled and absent from the live
    // registry; release any capacity left by a host crash before acknowledging
    // the durable dispatch to the automation outbox.
    await this.#host.forgetDepartmentChild(String(childId))
    return true
  }
}

const ENGINEER_SPECS_TOOLS = Object.freeze([
  'read', 'glob', 'grep',
  'military_get_context', 'military_get_order',
  'military_specs_read', 'military_specs_stage_chunk',
  'military_specs_apply_order',
  'military_submit_blocker', 'report',
] as const)

const WORKER_IMPLEMENTATION_TOOLS = Object.freeze([
  'read', 'glob', 'grep', 'write', 'edit',
  'military_get_context', 'military_get_order',
  'military_get_tactical_directive', 'military_record_observation',
  'military_submit_candidate', 'military_submit_blocker',
  'military_radio_request', 'military_submit_decision_questions',
  'report',
] as const)

/**
 * Keep the immutable ToolProfile as the execution-authority ceiling while
 * presenting small models with only the vocabulary needed by this Task stage.
 */
export function modelVisibleDepartmentTools(
  request: DepartmentAgentSpawnRequest,
  template: AgentTemplateProfile,
  profile: ToolProfile,
): readonly string[] {
  const admitted = new Set(profile.allowTools.filter(
    name => !profile.denyTools.includes(name),
  ))
  const taskTools = request.taskOrder === undefined
    ? undefined
    : new Set([...request.taskOrder.allowedTools, ...taskControlToolNames])
  const preferred = template.role === 'engineer'
    ? ENGINEER_SPECS_TOOLS.filter(name =>
        name !== 'military_specs_stage_chunk'
        || request.taskOrder?.complexity.contextFootprint === 'large')
    : template.role === 'worker'
      ? WORKER_IMPLEMENTATION_TOOLS
      : profile.allowTools
  return preferred.filter(name => admitted.has(name)
    && (taskTools === undefined || taskTools.has(name)))
}

/** Model-facing path and mutation protocol for one department assignment. */
export function departmentWorkspaceInstruction(
  request: DepartmentAgentSpawnRequest,
  template: AgentTemplateProfile,
): string {
  if (request.executionCwd === undefined) {
    return '\n\n项目工作区：只能使用继承的 Session 当前目录。搜索整个项目时，glob/grep 不要传 path；其他路径一律使用项目相对路径。不得检查父目录或 DeepSeek Harness 的实现代码检出目录。'
  }
  if (template.role === 'engineer') {
    const largeSpecsProtocol = request.taskOrder?.complexity.contextFootprint === 'large'
      ? ' 如果单个工具参数无法容纳完整内容，针对每份文档按从零开始且连续的序号调用 military_specs_stage_chunk，再按顺序把返回的 artifact ID 作为 contentArtifactIds 传入；content 与 contentArtifactIds 绝不能同时提供。'
      : ''
    return `\n\n权威项目根目录：${request.executionCwd}\nread/glob/grep 使用项目相对路径；搜索项目根目录时，glob/grep 不要传 path。Specs 工具的文档参数必须是任务授权的相对路径，例如 specs/file.md 或 docs/file.md，绝不能使用绝对路径。${largeSpecsProtocol}无论创建还是修改文件，都要在需要时先读取现有内容，并把每份文件的完整最终内容一次性传给 military_specs_apply_order。该终态事务会写入、验证、本地提交、记录回执、通知父级并结束本轮；收到成功回执后立即停止，不要调用 report。不得检查父目录或 DeepSeek Harness 的实现代码检出目录。`
  }
  return `\n\n分配的隔离执行工作树：${request.executionCwd}\n每个 read/write/edit 的 file_path 以及每个 glob/grep 的 path 都必须使用严格位于该工作树内的绝对路径。不得使用父项目的 local-main 路径、任何父目录或 DeepSeek Harness 的实现代码检出目录。只能在任务写入范围内创建和修改文件，在该工作树中完成验证后只提交一个 Candidate。`
}

function assertDirectParent(child: Agent, parent: Agent): void {
  if (String(child.session.header.parentSession ?? '') !== String(parent.id)) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISMATCH',
      'idempotent child belongs to another direct parent',
    )
  }
}

async function releaseTaskLeaseThroughKernel(host: MilitaryHostRuntime, binding: AgentExecutionBinding, reason: string): Promise<void> {
  if (binding.workspace === undefined) return
  const missionId = brand<string, 'MissionId'>(binding.missionId)
  const taskId = brand<string, 'TaskId'>(binding.workspace.taskId)
  const taskVersion = brand<number, 'TaskVersion'>(binding.workspace.taskVersion)
  const snapshot = await host.application.ledger.readMission(missionId)
  const command = createMissionCommand({
    tenantId: binding.tenantId, missionId, expectedRevision: snapshot.revision, actor: binding.agent,
    actorAuthorityRef: `execution-binding:${binding.bindingId}`, type: 'task.lease.release',
    payload: { taskId: String(taskId), taskVersion: Number(taskVersion), reason },
    idempotencyKey: `task-lease-release:${String(taskId)}:${Number(taskVersion)}:${String(binding.agent.agentId)}:${binding.agent.generation}:${reason}`,
    taskId, taskVersion, activationId: String(binding.agent.sessionId),
  })
  await host.application.missionKernel.execute(command, () => host.application.runtime.releaseTaskLease(taskId, binding.agent, reason))
}

export function parentOf(ctx: Context, agent: Agent): Agent | undefined {
  const parent = agent.session.header.parentSession
  return parent === undefined ? undefined : ctx.agents?.get(parent)
}
