import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  MILITARY_OPERATIONS_SCHEMA_VERSION,
  TERMINAL_TOOL_NAMES,
  type AgentExecutionBinding,
  type MilitaryDiagnosticEvent,
  type MilitaryDiagnosticReport,
  type MilitaryDiagnosticSession,
  type ObservedToolCallReceipt,
} from '@dsh-military/contracts'

const SECRET_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[-_]?key|private[-_]?key)/iu
const ABSOLUTE_PATH = /(?:file:\/\/)?(?:\/(?:Users|home|private|var|tmp)\/[^\s"',}\]]+|[A-Za-z]:\\[^\s"',}\]]+)/gu
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu
const MAX_DIAGNOSTIC_TEXT = 2_000

interface BuildDiagnosticInput {
  readonly session: MilitaryDiagnosticSession
  readonly events: readonly SessionEvent[]
  readonly binding?: AgentExecutionBinding
  readonly receipts: readonly ObservedToolCallReceipt[]
}

/** Project one immutable Session log into a bounded, Host-redacted timeline. */
export function buildDiagnosticReport(input: BuildDiagnosticInput): MilitaryDiagnosticReport {
  const receipts = new Map(input.receipts.map(value => [value.callId, value]))
  const calls = new Map<string, { readonly name: string; readonly failed: boolean }>()
  const timeline: MilitaryDiagnosticEvent[] = []
  const visibleTools = new Set<string>()
  let latencyMs = 0
  let activeStepAt: number | undefined
  let terminalCalls = 0
  let parentWakeups = 0
  let successfulToolCalls = 0
  let failedToolCalls = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const event of input.events) {
    const base = {
      id: `${input.session.sessionId}:${event.seq}`,
      sessionId: input.session.sessionId,
      seq: event.seq,
      occurredAt: new Date(event.time).toISOString(),
      roleId: input.session.roleId,
      ...(input.binding?.workspace?.taskId === undefined
        ? {}
        : { taskId: input.binding.workspace.taskId }),
    }
    switch (event.type) {
      case 'turn/start':
        timeline.push({
          ...base,
          turn: event.data.turn,
          category: 'LIFECYCLE',
          severity: 'INFO',
          title: `Turn ${event.data.turn} 开始`,
          detail: 'RC.2 Agent 已领取一批输入。',
        })
        break
      case 'turn/end': {
        const kind = event.data.reason.kind
        const severity = kind === 'completed'
          ? 'SUCCESS'
          : kind === 'max-tokens' || kind === 'blocked'
            ? 'WARNING'
            : 'ERROR'
        timeline.push({
          ...base,
          turn: event.data.turn,
          category: 'LIFECYCLE',
          severity,
          title: `Turn ${event.data.turn} ${turnLabel(kind)}`,
          detail: bounded(redactDiagnosticText(JSON.stringify(event.data.reason))),
        })
        break
      }
      case 'step/start':
        activeStepAt = event.time
        break
      case 'assistant/message': {
        const usage = event.data.usage
        inputTokens += (usage?.inputTokens ?? 0)
          + (usage?.cacheReadTokens ?? 0)
          + (usage?.cacheWriteTokens ?? 0)
        outputTokens += usage?.outputTokens ?? 0
        if (activeStepAt !== undefined) {
          latencyMs += Math.max(0, event.time - activeStepAt)
          activeStepAt = undefined
        }
        timeline.push({
          ...base,
          turn: event.data.turn,
          step: event.data.step,
          category: 'MODEL',
          severity: event.data.interrupted === true ? 'WARNING' : 'INFO',
          title: event.data.interrupted === true ? '模型响应被中断' : '模型响应完成',
          detail: usage === undefined
            ? 'Provider 未报告 token 使用量。'
            : `输入 ${usage.inputTokens}、输出 ${usage.outputTokens}、推理 ${usage.reasoningTokens ?? 0} tokens。`,
        })
        break
      }
      case 'request/header': {
        const tools = event.data.header.tools?.map(value => value.name) ?? []
        for (const name of tools) visibleTools.add(name)
        const config = event.data.header.config
        timeline.push({
          ...base,
          category: 'MODEL',
          severity: 'INFO',
          title: `模型请求头（${event.data.reason}）`,
          detail: `${String(config.provider ?? input.session.provider)}/${String(config.model ?? input.session.model)}；可见工具 ${tools.length} 个。`,
        })
        break
      }
      case 'request/context':
        timeline.push({
          ...base,
          category: 'MODEL',
          severity: 'INFO',
          title: 'Host 解析 exact model route',
          detail: `${event.data.provider}/${event.data.model}；上下文窗口 ${event.data.contextWindow ?? 'Provider 未披露'}。`,
        })
        break
      case 'tool/call': {
        const receipt = receipts.get(String(event.data.callId))
        const terminal = TERMINAL_TOOL_NAMES.has(event.data.name)
        if (terminal) terminalCalls += 1
        calls.set(String(event.data.callId), { name: event.data.name, failed: false })
        timeline.push({
          ...base,
          turn: event.data.turn,
          step: event.data.step,
          category: 'TOOL',
          severity: 'INFO',
          title: `模型选择 ${event.data.name}`,
          detail: receipt === undefined
            ? '等待 Host 执行与权威 receipt。'
            : 'Host 已记录该调用的不可变 receipt。',
          toolName: event.data.name,
          callId: String(event.data.callId),
          rawSelection: {
            name: event.data.name,
            arguments: redactToolArguments(event.data.arguments),
          },
          ...(receipt === undefined
            ? {}
            : {
                hostCompletion: hostCompletion(input.binding, receipt),
                ...(receipt.taskId === undefined ? {} : { taskId: receipt.taskId }),
              }),
        })
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        const callId = String(block.toolCallId)
        const call = calls.get(callId)
        const receipt = receipts.get(callId)
        const failed = block.isError === true || event.data.error !== undefined || receipt?.isError === true
        if (failed) failedToolCalls += 1
        else successfulToolCalls += 1
        if (call !== undefined) calls.set(callId, { ...call, failed })
        const rendered = block.content
          .filter(value => value.type === 'text')
          .map(value => value.text)
          .join('\n')
        const category = classifyResult(event.data.error?.code, rendered)
        const toolName = call?.name ?? receipt?.toolName
        timeline.push({
          ...base,
          turn: event.data.turn,
          step: event.data.step,
          category,
          severity: failed ? 'ERROR' : 'SUCCESS',
          title: failed
            ? `${call?.name ?? receipt?.toolName ?? '工具'} 被拒绝或失败`
            : `${call?.name ?? receipt?.toolName ?? '工具'} 执行成功`,
          detail: bounded(redactDiagnosticText(rendered === ''
            ? (event.data.error?.code ?? 'Host 返回空文本结果。')
            : rendered)),
          ...(toolName === undefined ? {} : { toolName }),
          callId,
          schema: {
            accepted: !failed,
            ...(event.data.error?.code === undefined
              ? {}
              : { errorCode: event.data.error.code }),
          },
          ...(receipt === undefined
            ? {}
            : {
                hostCompletion: hostCompletion(input.binding, receipt),
                receiptRef: `observed-tool-call:${callId}`,
                ...(receipt.taskId === undefined ? {} : { taskId: receipt.taskId }),
              }),
        })
        break
      }
      case 'user/message': {
        if (event.data.source.kind !== 'subagent-report') break
        parentWakeups += 1
        timeline.push({
          ...base,
          category: 'PARENT_DELIVERY',
          severity: 'SUCCESS',
          title: '父级收到子 Agent 报告并被唤醒',
          detail: `RC.2 next-step delivery ${event.data.id} 已进入父级 Session。`,
          receiptRef: `session-message:${event.data.id}`,
        })
        break
      }
      default:
        break
    }
  }

  const failedByName = new Set(
    [...calls.values()].filter(value => value.failed).map(value => value.name),
  )
  const successfulByName = new Set(
    [...calls.values()].filter(value => !value.failed).map(value => value.name),
  )
  const correctedCalls = [...failedByName].filter(name => successfulByName.has(name)).length
  return {
    schemaVersion: MILITARY_OPERATIONS_SCHEMA_VERSION,
    session: {
      ...input.session,
      eventCount: input.events.length,
      errorCount: failedToolCalls,
      inputTokens,
      outputTokens,
    },
    visibleTools: [...visibleTools].sort(),
    events: timeline.sort((left, right) => left.seq - right.seq),
    summary: {
      toolCalls: successfulToolCalls + failedToolCalls,
      successfulToolCalls,
      failedToolCalls,
      correctedCalls,
      terminalCalls,
      parentWakeups,
      inputTokens,
      outputTokens,
      estimatedCostStatus: 'PROVIDER_PRICING_UNAVAILABLE',
      latencyMs,
    },
    generatedAt: new Date().toISOString(),
  }
}

/** Redact credentials and absolute paths while retaining argument structure. */
export function redactToolArguments(source: string): string {
  try {
    const value = JSON.parse(source) as unknown
    return bounded(JSON.stringify(redactDiagnosticValue(value)))
  } catch {
    return bounded(redactDiagnosticText(source))
  }
}

export function redactDiagnosticValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '＜已脱敏＞'
  if (Array.isArray(value)) return value.map(item => redactDiagnosticValue(item))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, redactDiagnosticValue(child, childKey)]))
  }
  if (typeof value === 'string') return redactDiagnosticText(value)
  return value
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(BEARER, 'Bearer ＜已脱敏＞')
    .replace(ABSOLUTE_PATH, '＜绝对路径已脱敏＞')
    .replace(
      /("(?:authorization|cookie|credential|password|secret|token|api[-_]?key)"\s*:\s*")[^"]*/giu,
      '$1＜已脱敏＞',
    )
}

function hostCompletion(
  binding: AgentExecutionBinding | undefined,
  receipt: ObservedToolCallReceipt,
): NonNullable<MilitaryDiagnosticEvent['hostCompletion']> {
  return {
    ...(receipt.bindingId === undefined ? {} : { bindingId: receipt.bindingId }),
    ...(receipt.missionId === undefined ? {} : { missionId: receipt.missionId }),
    ...(receipt.taskId === undefined ? {} : { taskId: receipt.taskId }),
    ...(receipt.taskVersion === undefined ? {} : { taskVersion: receipt.taskVersion }),
    ...(binding === undefined ? {} : { capabilityGrantId: binding.capabilityGrantId }),
    argumentsHash: String(receipt.argumentsHash),
    outcomeHash: String(receipt.outcomeHash),
  }
}

function classifyResult(
  code: string | undefined,
  rendered: string,
): MilitaryDiagnosticEvent['category'] {
  if (code === 'INVALID_ARGUMENT' || /schema|参数|argument/iu.test(rendered)) return 'TOOL'
  if (/path|路径|workspace|worktree/iu.test(rendered)) return 'WORKSPACE'
  if (/grant|authority|permission|权限|授权/iu.test(rendered)) return 'AUTHORITY'
  return 'RECEIPT'
}

function turnLabel(kind: string): string {
  return {
    completed: '完成',
    aborted: '已中止',
    blocked: '被阻断',
    error: '失败',
    'max-tokens': '达到输出上限',
    interrupted: '崩溃恢复关闭',
  }[kind] ?? kind
}

function bounded(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_TEXT
    ? value
    : `${value.slice(0, MAX_DIAGNOSTIC_TEXT)}…＜Host 已截断＞`
}
