import type { Context } from '@deepseek-ai/cordis'
import type { MilitaryRole } from '@dsh-military/contracts'
import type {} from '@dsh-military/plugin-host'
import { registerTools } from './common.js'
import { generalTools } from './general.js'
import { workerTools } from './worker.js'
import { staffTools } from './staff.js'
import { engineerTools } from './engineer.js'
import { inspectorTools } from './inspector.js'
import { researchTools } from './research.js'
import { militaryArtifactTool } from './artifact.js'

export {
  generalTools,
  latestRunnableTemplateSummaries,
  summarizeMilitaryStatus,
} from './general.js'
export { requireTaskGuidanceBudget, workerTools } from './worker.js'
export { staffTools } from './staff.js'
export {
  compileEngineerSpecsDraft,
  engineerTools,
  materializeEngineerSpecsDraft,
  stageEngineerSpecsChunk,
  type MaterializedSpecsApplyDraft,
} from './engineer.js'
export { inspectorTools, resolveInspectionTarget } from './inspector.js'
export { researchTools } from './research.js'
export { militaryArtifactTool, installMilitaryArtifactTool } from './artifact.js'
export * from './common.js'
export * from './runtime-validation.js'
export * from './execution-budget.js'
export * from './task-draft.js'
export * from './private-skill-usage.js'

export const name = 'dsh-military-tools'
export const inject = ['tools', 'militaryHost', 'militaryDepartmentAgents']

/**
 * The fixed preset registers the union once for schema stability.  Runtime role
 * guards and immutable ToolProfiles provide authority; non-Military presets do
 * not mount this package and therefore see none of these schemas.
 */
export function apply(ctx: Context): void {
  const byName = new Map<string, ReturnType<typeof generalTools>[number]>()
  const groups = [generalTools(ctx), workerTools(ctx), staffTools(ctx), engineerTools(ctx), inspectorTools(ctx), researchTools(ctx), [militaryArtifactTool(ctx)]]
  for (const group of groups) for (const tool of group) if (!byName.has(tool.name)) byName.set(tool.name, tool)
  registerTools(ctx, [...byName.values()])
  // The Host plugin lives outside this preset scope, so its root ToolRuntime
  // view cannot see read/write/search or Military definitions. Capture the
  // exact RC.2 model-facing schemas here, after the complete preset union has
  // mounted and before any Agent turn can be admitted.
  ctx.militaryHost.registerRoleToolSchemas(ctx.tools.schemas(ctx.agent))
}

export function installRoleTools(ctx: Context, role: MilitaryRole): () => void {
  if (role === 'general') return registerTools(ctx, generalTools(ctx))
  if (role === 'worker') return registerTools(ctx, workerTools(ctx))
  if (role === 'engineer') return registerTools(ctx, engineerTools(ctx))
  if (role === 'advisor' || role === 'chief-of-staff') return registerTools(ctx, staffTools(ctx))
  if (role === 'inspector') return registerTools(ctx, inspectorTools(ctx))
  return registerTools(ctx, researchTools(ctx))
}
