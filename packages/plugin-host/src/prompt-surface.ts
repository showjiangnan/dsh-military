import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  AssembledSection,
  PromptAssembly,
} from '@deepseek-ai/dsh-system-prompt'

/**
 * RC.2 tool packages register global prompt guidance independently from their
 * agent-scoped tool schemas. `tools.restrict()` narrows schemas but does not
 * remove those prose sections, so a small model can be told to call a tool
 * that is absent from its request header. Keep this map next to the Military
 * restriction boundary and filter every mounted RC.2 guidance family.
 */
const RC2_TOOL_GUIDANCE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'tool:read': ['read'],
  'tool:write': ['write'],
  'tool:edit': ['edit'],
  'tool:glob': ['glob'],
  'tool:grep': ['grep'],
  'tool:bash': ['bash'],
  'tool:pwsh': ['pwsh'],
  'tool:jobs': ['job_output', 'job_kill'],
  'tool:web_search': ['web_search'],
  'tool:web_fetch': ['web_fetch'],
})

interface PromptSurfaceState {
  profileRef: string
  resolveVisibleTools?: () => Promise<ReadonlySet<string> | undefined>
  resolveRolePrompt?: () => string | undefined | Promise<string | undefined>
  disposed: boolean
  disposeListener: () => void
}

const configuredProfiles = new WeakMap<Agent, PromptSurfaceState>()

/**
 * Install one prompt/tool parity transform in an Agent scope.
 *
 * Continuable children must receive this transform synchronously while RC.2 is
 * still constructing their unpublished scope. At that point the durable
 * binding lookup may not have completed, so the first call can use a
 * provisional profile label. A later lifecycle call refines only that label;
 * it never installs a second listener and never changes the request schemas.
 */
export function installMilitaryPromptSurface(
  agent: Agent,
  profileRef: string,
  resolveVisibleTools?: () => Promise<ReadonlySet<string> | undefined>,
  resolveRolePrompt?: () => string | undefined | Promise<string | undefined>,
): () => void {
  const existing = configuredProfiles.get(agent)
  if (existing !== undefined) {
    existing.profileRef = profileRef
    if (resolveVisibleTools !== undefined) {
      existing.resolveVisibleTools = resolveVisibleTools
    }
    if (resolveRolePrompt !== undefined) {
      existing.resolveRolePrompt = resolveRolePrompt
    }
    return () => undefined
  }
  const state: PromptSurfaceState = {
    profileRef,
    ...(resolveVisibleTools === undefined ? {} : { resolveVisibleTools }),
    ...(resolveRolePrompt === undefined ? {} : { resolveRolePrompt }),
    disposed: false,
    disposeListener: () => undefined,
  }
  const disposeListener = agent.ctx.on(
    'system-prompt/assemble',
    async (_assembly, _context, next) => {
      const assembly = await next()
      const visibleTools = await state.resolveVisibleTools?.()
      const rolePrompt = await state.resolveRolePrompt?.()
      return synchronizeMilitaryPromptAssembly(
        assembly,
        state.profileRef,
        visibleTools,
        rolePrompt,
      )
    },
  )
  state.disposeListener = () => { void disposeListener() }
  configuredProfiles.set(agent, state)
  return () => {
    if (state.disposed) return
    state.disposed = true
    if (configuredProfiles.get(agent) === state) configuredProfiles.delete(agent)
    state.disposeListener()
  }
}

/**
 * Make prompt prose describe exactly the schemas in one assembled request.
 * This is a model-usability boundary only; ToolProfile admission remains the
 * authority boundary if a provider still emits an unlisted tool name.
 */
export function synchronizeMilitaryPromptAssembly(
  assembly: PromptAssembly,
  profileRef: string,
  phaseVisibleTools?: ReadonlySet<string>,
  rolePrompt?: string,
): PromptAssembly {
  const tools = phaseVisibleTools === undefined
    ? assembly.tools
    : assembly.tools.filter(tool => phaseVisibleTools.has(tool.name))
  const visibleTools = new Set(tools.map(tool => tool.name))
  const sections = assembly.sections
    .filter(section => section.name !== 'military:tool-boundary')
    .filter(section => guidanceIsVisible(section.name, visibleTools))
    .map(section => rewriteDeploymentSection(section, rolePrompt))
  const exactNames = [...visibleTools].sort()
  const generalDiscovery = profileRef.startsWith('general-tools@')
    ? '项目探查属于部门任务：先调用 military_status，再使用处于 ACTIVE 状态的 advisor-generalist 模板调用 military_spawn_department_agent；只读探查不得传入 taskId。'
    : '严格遵守已分配的执行工作区说明和不可变角色能力配置。'
  return {
    ...assembly,
    tools,
    sections: [
      ...sections,
      {
        name: 'military:tool-boundary',
        text: `Military 工具边界 ${profileRef}：本轮唯一有效的工具调用名称为 ${exactNames.join('、')}。即使通用 Harness 提示或早期历史提到其他工具，也绝不能调用未列出的名称。${generalDiscovery}`,
      },
    ],
  }
}

function guidanceIsVisible(
  sectionName: string,
  visibleTools: ReadonlySet<string>,
): boolean {
  const toolNames = RC2_TOOL_GUIDANCE[sectionName]
  return toolNames === undefined || toolNames.some(toolName => visibleTools.has(toolName))
}

function rewriteDeploymentSection(
  section: AssembledSection,
  rolePrompt: string | undefined,
): AssembledSection {
  if (section.name === 'deployment:persona' && rolePrompt !== undefined) {
    return {
      name: section.name,
      text: rolePrompt,
    }
  }
  if (section.name === 'harness:source') {
    return {
      name: section.name,
      text: 'DeepSeek Harness 的实现代码检出目录属于宿主基础设施，不是任务工作区。只有 Military 会话上下文和部门执行绑定中记录的项目根目录才具有权威性。',
    }
  }
  if (section.name === 'app:web-surface') {
    return {
      name: section.name,
      text: '你正通过当前 DeepSeek Harness Web 界面与用户交互。浏览器不会隐式提供 DOM、路由、截图或项目工作区上下文。',
    }
  }
  return section
}
