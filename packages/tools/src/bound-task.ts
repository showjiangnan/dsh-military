import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type TaskOrder,
  type MilitaryArtifacts,
} from '@dsh-military/contracts'
import { identityFor, requireRole } from './common.js'

/** Resolve the immutable execution binding and exact current Task version. */
export async function requireBoundTask(
  ctx: Context,
  agent: Agent,
): Promise<{
  readonly identity: ReturnType<typeof identityFor>
  readonly binding: AgentExecutionBinding
  readonly order: TaskOrder
}> {
  const identity = identityFor(ctx, agent)
  requireRole(identity, ['worker', 'engineer'])
  const binding = await ctx.militaryHost.application.executionBindings.forAgent(
    String(identity.agentId),
    identity.generation,
  )
  if (binding?.workspace === undefined) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISSING',
      'This department Agent has no Task-bound workspace',
    )
  }
  const order = await ctx.militaryHost.application.runtime.getTask(
    brand<string, 'TaskId'>(binding.workspace.taskId),
  )
  if (Number(order.taskVersion) !== binding.workspace.taskVersion) {
    throw new MilitaryError('STALE_TASK_VERSION', 'Task binding points to a stale version')
  }
  return { identity, binding, order }
}

export function boundArtifactContext(
  ctx: Context,
  input: {
    readonly identity: ReturnType<typeof identityFor>
    readonly binding: AgentExecutionBinding
    readonly order: TaskOrder
  },
): Pick<
  Parameters<MilitaryArtifacts['put']>[0],
  | 'tenantId'
  | 'missionId'
  | 'taskId'
  | 'ownerPrincipalId'
  | 'audiencePrincipalIds'
  | 'audienceScopes'
  | 'grantId'
  | 'residencyPolicyRef'
> {
  return {
    tenantId: ctx.militaryHost.tenantId,
    missionId: String(input.order.missionId),
    taskId: String(input.order.taskId),
    ownerPrincipalId: String(input.identity.agentId),
    audiencePrincipalIds: [
      String(input.identity.agentId),
      'military-host',
    ],
    audienceScopes: ['artifact:read', 'military:task-evidence'],
    grantId: input.binding.capabilityGrantId,
    residencyPolicyRef: `${input.binding.dataResidencyPolicy.id}@${Number(
      input.binding.dataResidencyPolicy.revision,
    )}`,
  }
}
