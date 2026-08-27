import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {
  AgentIdentity,
  TaskState,
  WorkflowObligation,
} from '@dsh-military/contracts'
import { sha256 } from '@dsh-military/core'
import type {
  AgentPlaneState,
  GeneralWorkflowStage,
} from './agent-plane-state.js'
import type { MilitaryHostRuntime } from './context.js'

export type GeneralWorkflowReason =
  | 'USER_EXECUTION'
  | 'CONTINUATION'
  | 'CHILD_WAKE'

interface SessionEventLike {
  readonly type: string
  readonly data: unknown
}

interface AgentLike {
  readonly id: unknown
  readonly session?: {
    readonly events?: readonly SessionEventLike[]
  }
}

/**
 * Remember that one exact General turn owes a governed Military workflow.
 * Direct user execution requests, terse continuations, and child wakeups are
 * distinguished so a completed task is not accidentally recreated.
 */
export function rememberGeneralWorkflowTurn(
  state: AgentPlaneState,
  agent: AgentLike,
  turn: number,
  messages: readonly UserMessage[],
): GeneralWorkflowReason | undefined {
  const key = workflowTurnKey(agent, turn)
  const existing = state.generalWorkflowTurns.get(key)
  if (existing !== undefined) return existing.reason
  prunePriorTurnState(state, String(agent.id), turn)

  const userTexts = messages
    .filter(message => sourceKind(message) === 'user')
    .map(messageText)
    .filter(value => value !== '')
  const latest = userTexts.at(-1)
  if (latest !== undefined) {
    if (isContinuation(latest)) {
      const previous = previousSubstantiveUserText(agent.session?.events ?? [])
      if (previous !== undefined && requiresMilitaryExecution(previous)) {
        state.generalWorkflowTurns.set(key, workflowTurn(
          'CONTINUATION',
          agent,
          turn,
          previous,
        ))
        return 'CONTINUATION'
      }
      return undefined
    }
    if (requiresMilitaryExecution(latest)) {
      state.generalWorkflowTurns.set(key, workflowTurn(
        'USER_EXECUTION',
        agent,
        turn,
        latest,
      ))
      return 'USER_EXECUTION'
    }
    return undefined
  }

  if (messages.some(isChildWakeMessage)) {
    state.generalWorkflowTurns.set(key, workflowTurn(
      'CHILD_WAKE',
      agent,
      turn,
      'department child settlement wake',
    ))
    return 'CHILD_WAKE'
  }
  return undefined
}

/** Return the next single Military coordination stage, or null when prose may close the turn. */
export async function nextGeneralWorkflowStage(input: {
  readonly host: MilitaryHostRuntime
  readonly state: AgentPlaneState
  readonly agent: AgentLike
  readonly identity: AgentIdentity
  readonly turn: number
}): Promise<GeneralWorkflowStage | null> {
  const key = workflowTurnKey(input.agent, input.turn)
  const turnRecord = input.state.generalWorkflowTurns.get(key)
  if (turnRecord === undefined) return null
  let obligation = turnRecord.reason === 'USER_EXECUTION'
    ? await input.host.application.executionLifecycle.openWorkflowObligation({
        tenantId: input.host.tenantId,
        rootSessionId: input.identity.sessionId,
        requestKey: turnRecord.requestKey,
        requestHash: turnRecord.requestHash,
        requestSummary: turnRecord.requestSummary,
        reason: turnRecord.reason,
      })
    : await input.host.application.executionLifecycle.activeWorkflowObligation(
        input.identity.sessionId,
      )
  if (obligation === null) return null
  if (TERMINAL_WORKFLOW_STATES.has(obligation.state)) return null
  const missionId = await input.host.application.runtime.missionForSession(
    input.identity.sessionId,
  )
  if (missionId === null) {
    obligation = await synchronizeObligation(
      input.host,
      obligation,
      'START_MISSION',
      'PLANNING',
      [],
      undefined,
      turnRecord.reason === 'CHILD_WAKE',
    )
    return 'START_MISSION'
  }
  const snapshot = await input.host.application.ledger.readMission(missionId)
  const tasks = [...snapshot.tasks.values()]
  const taskIds = [...snapshot.tasks.keys()]
  if (tasks.length === 0) {
    obligation = await synchronizeObligation(
      input.host,
      obligation,
      'CREATE_TASK',
      'PLANNING',
      [],
      missionId,
      turnRecord.reason === 'CHILD_WAKE',
    )
    return 'CREATE_TASK'
  }
  const open = tasks.filter(task => !TERMINAL_TASK_STATES.has(task.state))
  if (open.length === 0) {
    if (tasks.every(task => task.state === 'ACCEPTED')) {
      await input.host.application.runtime.completeMission(
        missionId,
        input.identity,
      )
    }
    await input.host.application.executionLifecycle.settleWorkflowObligation({
      obligationId: obligation.obligationId,
      expectedRevision: obligation.revision,
      outcome: 'COMPLETED',
      reason: 'all Tasks reached a terminal accepted/cancelled/failed state',
    })
    return null
  }
  if (open.some(task => task.state === 'WAITING_DECISION')) {
    const successful = successfulGeneralTools(
      input.state,
      input.agent,
      input.turn,
    )
    const stage: GeneralWorkflowStage = successful.has('ask_user_question')
      ? 'RECORD_DECISION'
      : successful.has('military_decision_present')
        ? 'ASK_USER_DECISION'
        : 'PRESENT_DECISION'
    obligation = await synchronizeObligation(
      input.host,
      obligation,
      stage,
      'RECOVERING',
      taskIds,
      missionId,
      turnRecord.reason === 'CHILD_WAKE',
    )
    return stage
  }
  if (open.some(task => RECOVERY_TASK_STATES.has(task.state))) {
    const stage = successfulGeneralTools(input.state, input.agent, input.turn)
      .has('military_radio_poll')
      ? 'ISSUE_TACTICAL_GUIDANCE'
      : 'POLL_TACTICAL_REQUEST'
    obligation = await synchronizeObligation(
      input.host,
      obligation,
      stage,
      'RECOVERING',
      taskIds,
      missionId,
      turnRecord.reason === 'CHILD_WAKE',
    )
    return stage
  }
  if (open.some(task => DISPATCHABLE_TASK_STATES.has(task.state))) {
    const stage = successfulGeneralTools(input.state, input.agent, input.turn)
      .has('military_status')
      ? 'SPAWN_DEPARTMENT'
      : 'READ_DEPARTMENT_STATUS'
    obligation = await synchronizeObligation(
      input.host,
      obligation,
      stage,
      stage === 'SPAWN_DEPARTMENT' ? 'DISPATCHING' : 'PLANNING',
      taskIds,
      missionId,
      turnRecord.reason === 'CHILD_WAKE',
    )
    return stage
  }
  // LEASED/EXECUTING/CANDIDATE_SUBMITTED/VERIFYING means a governed child or
  // Host verifier already owns progress. Closing the parent turn is correct;
  // the durable child terminal receipt will wake it.
  await synchronizeObligation(
    input.host,
    obligation,
    'WAIT_FOR_SETTLEMENT',
    'WAITING_CHILD',
    taskIds,
    missionId,
    turnRecord.reason === 'CHILD_WAKE',
  )
  return null
}

/** Flash-oriented, one-stage instruction shared by pre-step and stop interlock. */
export function generalWorkflowInstruction(
  stage: GeneralWorkflowStage,
  attempt?: { readonly current: number; readonly maximum: number },
): string {
  const heading = attempt === undefined
    ? '[HOST-OWNED MILITARY WORKFLOW GATE]'
    : `[HOST-OWNED MILITARY WORKFLOW INTERLOCK ${attempt.current}/${attempt.maximum}]`
  const next = {
    START_MISSION: '只调用 military_mission_start，用用户目标写一个简短标题；成功后等待下一步工具面。',
    CREATE_TASK: '只调用 military_task_create：创建一个最小、可独立验证的 Task，明确相对路径范围和验收标准；不要在正文中代写交付文件。',
    READ_DEPARTMENT_STATUS: '只调用 military_status，读取当前可派遣的部门模板；不要猜模板 ID。',
    SPAWN_DEPARTMENT: '只调用 military_spawn_department_agent，把现有 Task 的 exact taskId 交给职责匹配的 Worker/Engineer；成功后立即结束本轮并等待自动回执。',
    POLL_TACTICAL_REQUEST: '只调用 military_radio_poll，读取当前阻塞 Task 的受治理战术请求。',
    ISSUE_TACTICAL_GUIDANCE: '只调用 military_radio_issue，依据刚读取的 requestId 给出有序步骤和可观察结果；成功后立即结束本轮。',
    PRESENT_DECISION: '只调用 military_decision_present，读取一组待用户决定的问题和 exact decisionSetId。',
    ASK_USER_DECISION: '只调用 ask_user_question，把刚读取的问题原样、简洁地呈现给用户；不要代替用户选择。',
    RECORD_DECISION: '只调用 military_decision_answer，使用 exact decisionSetId 和用户刚给出的答案；Host 会恢复等待中的 Task。',
  }[stage]
  return [
    heading,
    '当前请求需要执行项目工作，必须走 Mission → Task → 部门执行 → Candidate/Evidence → 验证/集成 → General 汇总。',
    '在任务被部门实际执行并由 Host 验证前，禁止在助手正文输出实现代码、补丁、完整文件或“请自行保存”的替代交付。',
    `当前唯一下一步：${next}`,
  ].join('\n')
}

/** Deterministic intent classifier intentionally limited to project work. */
export function requiresMilitaryExecution(text: string): boolean {
  const normalized = text.trim()
  if (normalized === '') return false
  const directMutation = /(?:创建|新建|生成|开发|实现|编写|写入|修改|修复|编辑|更新|重构|改造|删除|安装|部署|构建|制作|开发出来|完全修复|完整开发)/u
  const projectInspection = /(?:检查|审计|排查|分析).{0,24}(?:项目|仓库|代码|源码|会话|session|配置|流程|工具调用)/iu
  const englishMutation = /\b(?:create|build|implement|write|modify|edit|fix|refactor|update|delete|install|deploy)\b/iu
  return directMutation.test(normalized)
    || projectInspection.test(normalized)
    || englishMutation.test(normalized)
}

export function isContinuation(text: string): boolean {
  return /^(?:继续|继续执行|继续完成|接着做|接着|往下做|go on|continue|proceed|go ahead)[。.!！\s]*$/iu
    .test(text.trim())
}

function successfulGeneralTools(
  state: AgentPlaneState,
  agent: AgentLike,
  turn: number,
): ReadonlySet<string> {
  return state.generalSuccessfulToolsByTurn.get(workflowTurnKey(agent, turn))
    ?? EMPTY_TOOLS
}

function workflowTurnKey(agent: AgentLike, turn: number): string {
  return `${String(agent.id)}:${turn}`
}

function workflowTurn(
  reason: GeneralWorkflowReason,
  agent: AgentLike,
  turn: number,
  requestText: string,
): {
  readonly reason: GeneralWorkflowReason
  readonly requestKey: string
  readonly requestHash: string
  readonly requestSummary: string
} {
  const normalized = requestText.trim().replace(/\s+/gu, ' ')
  const requestHash = sha256(normalized)
  const ordinal = latestUserEventOrdinal(agent.session?.events ?? [])
  return {
    reason,
    requestKey: `${String(agent.id)}:${ordinal ?? `turn-${turn}`}:${requestHash.slice(0, 20)}`,
    requestHash,
    requestSummary: normalized.slice(0, 240),
  }
}

function latestUserEventOrdinal(
  events: readonly SessionEventLike[],
): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    if (sourceKind(eventMessage(event.data)) === 'user') return index
  }
  return undefined
}

async function synchronizeObligation(
  host: MilitaryHostRuntime,
  obligation: WorkflowObligation,
  stage: WorkflowObligation['stage'],
  state: WorkflowObligation['state'],
  taskIds: readonly import('@dsh-military/contracts').TaskId[],
  missionId: import('@dsh-military/contracts').MissionId | undefined,
  incrementWakeCursor: boolean,
): Promise<WorkflowObligation> {
  const unchanged = obligation.stage === stage
    && obligation.state === state
    && String(obligation.missionId ?? '') === String(missionId ?? '')
    && obligation.taskIds.map(String).join('\0') === taskIds.map(String).join('\0')
    && !incrementWakeCursor
  if (unchanged) return obligation
  return await host.application.executionLifecycle.advanceWorkflowObligation({
    obligationId: obligation.obligationId,
    expectedRevision: obligation.revision,
    state,
    stage,
    ...(missionId === undefined ? {} : { missionId }),
    taskIds,
    transitionReason: `host observed workflow stage ${stage}`,
    incrementWakeCursor,
  })
}

function previousSubstantiveUserText(
  events: readonly SessionEventLike[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const message = eventMessage(event.data)
    if (sourceKind(message) !== 'user') continue
    const text = messageText(message)
    if (text === '' || isContinuation(text)) continue
    return text
  }
  return undefined
}

function isChildWakeMessage(message: UserMessage): boolean {
  const source = message.source as unknown
  if (!isRecord(source)) return false
  const kind = typeof source.kind === 'string' ? source.kind : ''
  if (kind.startsWith('subagent')) return true
  const form = typeof source.form === 'string' ? source.form : ''
  return kind === 'plugin' && /(?:report|settlement|receipt|wake)/iu.test(form)
}

function sourceKind(message: Pick<UserMessage, 'source'>): string {
  const source = message.source as unknown
  return isRecord(source) && typeof source.kind === 'string'
    ? source.kind
    : ''
}

function messageText(message: Pick<UserMessage, 'content'>): string {
  return message.content
    .filter((block): block is Extract<typeof block, { readonly type: 'text' }> =>
      block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function eventMessage(
  value: unknown,
): Pick<UserMessage, 'source' | 'content'> {
  if (!isRecord(value)) {
    return {
      content: [],
      source: {
        kind: 'plugin',
        plugin: '@dsh-military/plugin-host',
        form: 'instructions',
      },
    }
  }
  const nested = isRecord(value.message) ? value.message : value
  return nested as unknown as Pick<UserMessage, 'source' | 'content'>
}

function prunePriorTurnState(
  state: AgentPlaneState,
  agentId: string,
  currentTurn: number,
): void {
  const keep = `${agentId}:${currentTurn}`
  for (const key of state.generalWorkflowTurns.keys()) {
    if (key.startsWith(`${agentId}:`) && key !== keep) {
      state.generalWorkflowTurns.delete(key)
    }
  }
  for (const key of state.generalSuccessfulToolsByTurn.keys()) {
    if (key.startsWith(`${agentId}:`) && key !== keep) {
      state.generalSuccessfulToolsByTurn.delete(key)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TERMINAL_TASK_STATES = new Set<TaskState>([
  'ACCEPTED',
  'CANCELLED',
  'FAILED',
])

const TERMINAL_WORKFLOW_STATES = new Set<WorkflowObligation['state']>([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
])

const DISPATCHABLE_TASK_STATES = new Set<TaskState>([
  'CREATED',
  'READY',
  'REWORK',
  'PAUSED',
  'RECOVERY_REQUIRED',
  'INTEGRATION_FAILED',
])

const RECOVERY_TASK_STATES = new Set<TaskState>([
  'BLOCKED',
  'GUIDANCE_PENDING',
  'WAITING_DECISION',
  'FROZEN',
])

const EMPTY_TOOLS = new Set<string>()
