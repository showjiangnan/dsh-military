import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionEvent,
  SessionHeader,
  SessionId as DshSessionId,
} from '@deepseek-ai/dsh-session'
import {
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import {
  validateJsonSchemaValue,
  type JsonSchemaNode,
} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  GENERAL_ROLE_ID,
  MILITARY_BENCHMARK_DATASET_VERSION,
  MILITARY_BENCHMARK_SCHEMA_VERSION,
  MILITARY_BENCHMARK_SCENARIOS,
  TERMINAL_TOOL_NAMES,
  type AgentExecutionBinding,
  type MilitaryBenchmarkCaseResult,
  type MilitaryBenchmarkRun,
  type MilitaryBenchmarkScenario,
  type MilitaryBenchmarkScenarioId,
  type MilitaryBenchmarkSnapshot,
  type MilitaryProviderAcceptance,
  type MilitaryProviderSessionSample,
  type ObservedToolCallReceipt,
  type PortableRoleConfiguration,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import { SqliteStateRecords } from '@dsh-military/storage-sqlite'
import type { MilitaryHostRuntime } from './context.js'
import { requireWebAuthority } from './web-authority.js'
import {
  ROLE_WORKBENCH_NAMESPACE,
  effectiveRolePrompt,
  parseRoleWorkbenchDocument,
  readinessForConfiguration,
} from './role-workbench.js'
import {
  roleToolContracts,
  type ToolContract,
} from './role-readiness.js'
import {
  ROLE_REVISION_USE_NAMESPACE,
  type RoleRevisionUseRecord,
} from './role-usage.js'
import { canonicalizeToolTarget } from './tool-authorization.js'

const BENCHMARK_RUN_NAMESPACE = 'military-fixed-benchmark-run'
const PROVIDER_SAMPLE_NAMESPACE = 'military-provider-session-sample'
export const MILITARY_BENCHMARK_DATASET_HASH = sha256(stableJson({
  version: MILITARY_BENCHMARK_DATASET_VERSION,
  scenarios: MILITARY_BENCHMARK_SCENARIOS,
}))
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const BUNDLE_VERSION = '0.9.0-alpha.25'

/**
 * General's `general-host-authority@0` is an immutable Host boundary rather
 * than a user-selectable PermissionProfile revision. Department roles must
 * still reference a positive, persisted PermissionProfile revision.
 */
export function hasRoleGovernanceFence(
  configuration: Pick<
    PortableRoleConfiguration,
    | 'roleId'
    | 'toolProfileRevision'
    | 'permissionProfileId'
    | 'permissionProfileRevision'
  >,
): boolean {
  if (configuration.toolProfileRevision <= 0) return false
  if (configuration.roleId === GENERAL_ROLE_ID) {
    return configuration.permissionProfileId === 'general-host-authority'
      && configuration.permissionProfileRevision === 0
  }
  return configuration.permissionProfileRevision > 0
}

interface PersistenceLike {
  inspect(id: DshSessionId, signal?: AbortSignal): Promise<{
    readonly meta: SessionHeader
    readonly events: readonly SessionEvent[]
  }>
}

/** Fixed deterministic benchmark plus Host-assessed real Provider Session samples. */
export class MilitaryBenchmarkRemoteService extends TypertRemoteService {
  private readonly state: SqliteStateRecords

  constructor(
    ctx: Context,
    private readonly host: MilitaryHostRuntime,
  ) {
    super(ctx, 'militaryBenchmark')
    this.state = new SqliteStateRecords(host.database, host.tenantId)
  }

  @Remote
  async snapshot(signal: AbortSignal): Promise<MilitaryBenchmarkSnapshot> {
    requireWebAuthority(this.host, 'military.benchmark.manage')
    signal.throwIfAborted()
    const providerSamples = [...this.state.listSync<MilitaryProviderSessionSample>(
      PROVIDER_SAMPLE_NAMESPACE,
    )].sort((left, right) => right.assessedAt.localeCompare(left.assessedAt))
    return {
      schemaVersion: MILITARY_BENCHMARK_SCHEMA_VERSION,
      dataset: {
        version: MILITARY_BENCHMARK_DATASET_VERSION,
        hash: MILITARY_BENCHMARK_DATASET_HASH,
        scenarios: MILITARY_BENCHMARK_SCENARIOS,
      },
      runs: [...this.state.listSync<MilitaryBenchmarkRun>(BENCHMARK_RUN_NAMESPACE)]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      providerSamples,
      providerStability: providerSampleStability(providerSamples),
      providerAcceptance: providerFlashAcceptance(providerSamples),
      eligibleSessions: await this.eligibleSessions(signal),
      generatedAt: new Date().toISOString(),
    }
  }

  @Remote
  async execute(action: unknown, signal: AbortSignal): Promise<unknown> {
    requireWebAuthority(this.host, 'military.benchmark.manage')
    signal.throwIfAborted()
    const value = record(action, 'Military benchmark action')
    const type = text(value.type, 'benchmark action.type', 64)
    const operationId = identifier(value.operationId, 'benchmark operationId')
    switch (type) {
      case 'RUN_DETERMINISTIC':
        return await this.runDeterministic(operationId, signal)
      case 'ASSESS_PROVIDER_SESSION':
        return await this.assessProviderSession(
          operationId,
          scenarioId(value.scenarioId),
          text(value.sessionId, 'benchmark sessionId', 180),
          signal,
        )
      default:
        throw new TypeError(`unknown Military benchmark action ${type}`)
    }
  }

  private async runDeterministic(
    runId: string,
    signal: AbortSignal,
  ): Promise<MilitaryBenchmarkRun> {
    const existing = this.state.readSync<MilitaryBenchmarkRun>(
      BENCHMARK_RUN_NAMESPACE,
      runId,
    )
    if (existing !== null) return existing
    const document = this.workbench()
    const preset = await this.host.application.presetGenerations.current()
    const cases: MilitaryBenchmarkCaseResult[] = []
    const roleConfigurations: Array<
      MilitaryBenchmarkRun['roleConfigurations'][number]
    > = []
    const roleCache = new Map<string, {
      readonly configuration: PortableRoleConfiguration
      readonly contracts: readonly ToolContract[]
    }>()
    for (const scenario of MILITARY_BENCHMARK_SCENARIOS) {
      signal.throwIfAborted()
      let cached = roleCache.get(scenario.roleId)
      if (cached === undefined) {
        const configuration = document.roles.find(value =>
          value.roleId === scenario.roleId)
        if (configuration === undefined) throw new Error(
          `fixed benchmark role ${scenario.roleId} is missing`,
        )
        cached = {
          configuration,
          contracts: await roleToolContracts(this.ctx, this.host, configuration),
        }
        roleCache.set(scenario.roleId, cached)
        roleConfigurations.push({
          roleId: configuration.roleId,
          roleRevision: latestRoleRevision(document.history, configuration.roleId),
          provider: configuration.provider,
          model: configuration.model,
          reasoningEffort: configuration.reasoningEffort,
          toolProfileRef: `${configuration.toolProfileId}@${configuration.toolProfileRevision}`,
          maxOutputTokens: configuration.maxOutputTokens,
          contextBudgetTokens: configuration.contextBudgetTokens,
        })
      }
      cases.push(await deterministicCase(
        this.host,
        scenario,
        cached.configuration,
        cached.contracts,
      ))
    }
    const run: MilitaryBenchmarkRun = {
      schemaVersion: MILITARY_BENCHMARK_SCHEMA_VERSION,
      runId,
      mode: 'DETERMINISTIC',
      datasetVersion: MILITARY_BENCHMARK_DATASET_VERSION,
      datasetHash: MILITARY_BENCHMARK_DATASET_HASH,
      bundleVersion: BUNDLE_VERSION,
      presetGeneration: preset.generation,
      dshRelease: '0.1.1-rc.2',
      dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      cases,
      roleConfigurations: roleConfigurations.sort((left, right) =>
        left.roleId.localeCompare(right.roleId)),
      status: cases.some(value => value.status === 'FAILED') ? 'FAILED' : 'PASSED',
      createdAt: new Date().toISOString(),
    }
    this.state.putSync(BENCHMARK_RUN_NAMESPACE, runId, run, { createOnly: true })
    return run
  }

  private async assessProviderSession(
    sampleId: string,
    scenario: MilitaryBenchmarkScenarioId,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<MilitaryProviderSessionSample> {
    const previous = this.state.readSync<MilitaryProviderSessionSample>(
      PROVIDER_SAMPLE_NAMESPACE,
      sampleId,
    )
    if (previous !== null) {
      if (previous.sessionId !== sessionId || previous.scenarioId !== scenario) {
        throw new TypeError('sample operationId is already bound to another Session/scenario')
      }
      if (previous.assessmentRevision === 2) return previous
    }
    const duplicate = this.state.listSync<MilitaryProviderSessionSample>(
      PROVIDER_SAMPLE_NAMESPACE,
    ).find(value =>
      value.sessionId === sessionId
      && value.scenarioId === scenario
      && value.datasetHash === MILITARY_BENCHMARK_DATASET_HASH)
    if (duplicate?.assessmentRevision === 2) return duplicate
    const session = await this.sessionSnapshot(sessionId, signal)
    const events = session.events
    const execution = await this.host.application.executionBindings.forSession(sessionId)
    const roleId = execution?.templateId ?? 'general'
    const expected = MILITARY_BENCHMARK_SCENARIOS.find(value => value.id === scenario)!
    if (roleId !== expected.roleId) {
      throw new TypeError(
        `${scenario} 固定角色为 ${expected.roleId}，Session 实际角色为 ${roleId}`,
      )
    }
    const calls = events.filter((event): event is Extract<
      SessionEvent,
      { readonly type: 'tool/call' }
    > => event.type === 'tool/call')
    const results = new Map(events.flatMap(event => {
      if (event.type !== 'tool/result') return []
      const block = event.data.message.content[0]
      return [[String(block.toolCallId), {
        failed: block.isError === true || event.data.error !== undefined,
        code: event.data.error?.code,
      }] as const]
    }))
    const receipts = await this.host.application.observedEvidence.toolCalls(
      calls.map(value => String(value.data.callId)),
    )
    const receiptByCall = new Map(receipts.map(value => [value.callId, value]))
    const callOutcomes = calls.map(call => ({
      call,
      failed: results.get(String(call.data.callId))?.failed
        ?? receiptByCall.get(String(call.data.callId))?.isError
        ?? true,
      ...(results.get(String(call.data.callId))?.code === undefined
        ? {}
        : { code: results.get(String(call.data.callId))!.code! }),
    }))
    const first = callOutcomes[0]
    const failedNames = new Set(callOutcomes.filter(value =>
      value.failed).map(value => value.call.data.name))
    const corrected = callOutcomes.some(value =>
      !value.failed && failedNames.has(value.call.data.name))
    const terminalSuccess = callOutcomes.some(value =>
      TERMINAL_TOOL_NAMES.has(value.call.data.name) && !value.failed)
    let parentWakeup = false
    const parentSessionId = session.meta.parentSession
    if (parentSessionId !== undefined) {
      const parent = await this.sessionSnapshot(String(parentSessionId), signal)
      parentWakeup = parent.events.some(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'subagent-report'
        && String(event.data.source.senderSessionId) === sessionId)
    }
    const resumed = events.some(event =>
      event.type === 'request/header' && event.data.reason === 'resume')
    const completedTurn = [...events].reverse().find(event =>
      event.type === 'turn/end')
    const completed = completedTurn?.type === 'turn/end'
      && completedTurn.data.reason.kind === 'completed'
      && (terminalSuccess || roleId === 'general')
    const firstCallHit = first !== undefined
      && expected.requiredTools.includes(first.call.data.name)
    const schemaFirstPass = firstCallHit
      && first !== undefined
      && schemaAcceptedOnFirstCall(first)
    const usage = sessionUsage(events)
    const route = observedRoute(events)
    const revisionUse = this.state.listSync<RoleRevisionUseRecord>(
      ROLE_REVISION_USE_NAMESPACE,
    ).filter(value => value.sessionId === sessionId)
      .sort((left, right) => left.turn - right.turn || left.step - right.step)[0]
    const configuration = this.workbench().roles.find(value => value.roleId === roleId)
    const checks = validateProviderScenario({
      scenario,
      expected,
      callOutcomes,
      receipts,
      firstCallHit,
      schemaFirstPass,
      corrected,
      terminalSuccess,
      parentWakeup,
      resumed,
      completed,
      exactRoute: route.exact,
    })
    const scenarioPassed = checks.every(value => value.status === 'PASSED')
    const safety = providerSafetyCounters({
      scenario,
      callOutcomes,
      receipts,
      completed,
      scenarioPassed,
    })
    const sampleKey = providerSampleKey(sessionId, scenario)
    const eventFingerprint = sha256(stableJson(events.map(event => ({
      seq: event.seq,
      type: event.type,
      time: event.time,
      ...(event.type === 'tool/call'
        ? { tool: event.data.name, callId: String(event.data.callId) }
        : {}),
      ...(event.type === 'tool/result'
        ? {
            callId: String(event.data.message.content[0].toolCallId),
            failed: event.data.message.content[0].isError === true
              || event.data.error !== undefined,
            code: event.data.error?.code,
          }
        : {}),
    }))))
    const configurationKey = sha256(stableJson({
      roleId,
      roleRevision: revisionUse?.roleRevision
        ?? latestRoleRevision(this.workbench().history, roleId),
      provider: route.provider,
      model: route.model,
      aliasStatus: route.exact ? 'EXACT_ROUTE_OBSERVED' : 'ALIAS_UNPROVEN',
      reasoningEffort: route.reasoningEffort,
      toolProfileRef: execution === null
        ? `${configuration?.toolProfileId ?? 'general-tools'}@${configuration?.toolProfileRevision ?? 0}`
        : `${execution.toolProfile.id}@${Number(execution.toolProfile.revision)}`,
      presetGeneration: execution?.presetGeneration,
      bundleVersion: BUNDLE_VERSION,
    }))
    const evidence = [
      `immutable-session-events:${events.length}`,
      `observed-tool-receipts:${receipts.length}`,
      `first-tool:${first?.call.data.name ?? '(none)'}`,
      `terminal-success:${terminalSuccess}`,
      `parent-wakeup:${parentWakeup}`,
      `resume-header:${resumed}`,
      'N=1 remains a sample and never changes model validation status',
    ]
    const sample: MilitaryProviderSessionSample = {
      schemaVersion: MILITARY_BENCHMARK_SCHEMA_VERSION,
      assessmentRevision: 2,
      sampleId,
      sampleKey,
      scenarioId: scenario,
      datasetHash: MILITARY_BENCHMARK_DATASET_HASH,
      sessionId,
      roleId,
      roleRevision: revisionUse?.roleRevision
        ?? latestRoleRevision(this.workbench().history, roleId),
      provider: route.provider,
      model: route.model,
      aliasStatus: route.exact ? 'EXACT_ROUTE_OBSERVED' : 'ALIAS_UNPROVEN',
      reasoningEffort: route.reasoningEffort,
      toolProfileRef: execution === null
        ? `${configuration?.toolProfileId ?? 'general-tools'}@${configuration?.toolProfileRevision ?? 0}`
        : `${execution.toolProfile.id}@${Number(execution.toolProfile.revision)}`,
      configurationKey,
      eventFingerprint,
      firstCallHit,
      schemaFirstPass,
      corrected,
      completed,
      parentWakeup,
      terminalSuccess,
      writeReceiptCount: receipts.filter(value =>
        !value.isError && ['write', 'edit', 'military_specs_apply_order']
          .includes(value.toolName)).length,
      ...safety,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costStatus: 'PROVIDER_PRICING_UNAVAILABLE',
      latencyMs: usage.latencyMs,
      status: scenarioPassed ? 'PASSED' : 'FAILED',
      checks,
      evidence,
      assessedAt: new Date().toISOString(),
    }
    this.state.putSync(PROVIDER_SAMPLE_NAMESPACE, sampleKey, sample)
    return sample
  }

  private async eligibleSessions(
    signal: AbortSignal,
  ): Promise<MilitaryBenchmarkSnapshot['eligibleSessions']> {
    const rows = this.host.database.db.prepare(`
      SELECT session_id, binding_json, created_at
      FROM military_session_bindings
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 80
    `).all(this.host.tenantId) as unknown as Array<{
      readonly session_id: string
      readonly binding_json: string
      readonly created_at: string
    }>
    const uses = this.state.listSync<RoleRevisionUseRecord>(ROLE_REVISION_USE_NAMESPACE)
    const result: MilitaryBenchmarkSnapshot['eligibleSessions'][number][] = []
    for (const row of rows) {
      signal.throwIfAborted()
      let events: readonly SessionEvent[]
      try {
        events = (await this.sessionSnapshot(row.session_id, signal)).events
      } catch {
        continue
      }
      if (events.length === 0) continue
      const route = observedRoute(events)
      const execution = await this.host.application.executionBindings.forSession(row.session_id)
      result.push({
        sessionId: row.session_id,
        roleId: execution?.templateId
          ?? uses.find(value => value.sessionId === row.session_id)?.roleId
          ?? 'general',
        provider: route.provider,
        model: route.model,
        eventCount: events.length,
        updatedAt: events.at(-1) === undefined
          ? row.created_at
          : new Date(events.at(-1)!.time).toISOString(),
      })
    }
    return result
  }

  private async sessionSnapshot(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly meta: SessionHeader
    readonly events: readonly SessionEvent[]
  }> {
    const live = this.ctx.agents?.get(sessionId as DshSessionId)
    if (live !== undefined) {
      return {
        meta: live.session.header,
        events: live.session.events,
      }
    }
    const persistence = asPersistence(this.ctx.sessionPersistence)
    if (persistence === undefined) throw new Error('RC.2 Session persistence is unavailable')
    return await persistence.inspect(sessionId as DshSessionId, signal)
  }

  private workbench(): ReturnType<typeof parseRoleWorkbenchDocument> {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(value => String(value.ns) === ROLE_WORKBENCH_NAMESPACE)
    if (descriptor === undefined) throw new Error('Military role workbench settings are unavailable')
    return parseRoleWorkbenchDocument(record(
      descriptor.value,
      settingsNamespace(ROLE_WORKBENCH_NAMESPACE),
    ).stateJson)
  }
}

async function deterministicCase(
  host: MilitaryHostRuntime,
  scenario: MilitaryBenchmarkScenario,
  configuration: PortableRoleConfiguration,
  contracts: readonly ToolContract[],
): Promise<MilitaryBenchmarkCaseResult> {
  const started = Date.now()
  const checks: MilitaryBenchmarkCaseResult['checks'][number][] = []
  const byName = new Map(contracts.map(value => [value.schema.name, value]))
  const missing = scenario.requiredTools.filter(name =>
    byName.get(name)?.summary.available !== true)
  checks.push({
    id: 'ACTUAL_TOOL_SURFACE',
    status: missing.length === 0 ? 'PASSED' : 'FAILED',
    evidence: missing.length === 0
      ? `实际角色工具面包含 ${scenario.requiredTools.join('、')}`
      : `缺少实际工具：${missing.join('、')}`,
  })
  const schemaFailures: string[] = []
  for (const name of scenario.requiredTools) {
    const contract = byName.get(name)
    if (contract === undefined || !contract.summary.available) continue
    const argumentsValue = minimalJsonValue(contract.schema.parameters, name)
    const violations = validateJsonSchemaValue(
      contract.schema.parameters as JsonSchemaNode,
      argumentsValue,
      'args',
    )
    if (violations.length > 0) schemaFailures.push(`${name}: ${violations.join('；')}`)
  }
  checks.push({
    id: 'MINIMAL_SCHEMA_FIRST_PASS',
    status: schemaFailures.length === 0 ? 'PASSED' : 'FAILED',
    evidence: schemaFailures.length === 0
      ? 'Host 生成的最小参数通过每个实际 RC.2 Schema。'
      : schemaFailures.join('；'),
  })
  let modelStatus: 'VALIDATED' | 'CANARY' | 'UNVERIFIED' | 'INCOMPATIBLE' | 'UNAVAILABLE' | 'DEPRECATED' = 'UNVERIFIED'
  try {
    const capability = await host.application.policies.modelCapability(
      configuration.provider,
      configuration.model,
      configuration.modelCapabilityProfileRevision,
    )
    modelStatus = capability.status === 'VALIDATED'
      ? 'VALIDATED'
      : capability.status === 'CANARY'
        ? 'CANARY'
        : capability.status === 'DEPRECATED'
          ? 'DEPRECATED'
          : 'UNVERIFIED'
  } catch {
    modelStatus = 'UNVERIFIED'
  }
  const readiness = readinessForConfiguration(
    configuration,
    contracts.map(value => value.summary),
    modelStatus,
  )
  checks.push({
    id: 'FLASH_READINESS',
    status: readiness.disposition === 'BLOCKED' ? 'FAILED' : 'PASSED',
    evidence: `${readiness.disposition} · score ${readiness.score} · ${readiness.errorCount} errors`,
  })
  checks.push(await scenarioInvariant(host, scenario, configuration, contracts))
  return {
    scenarioId: scenario.id,
    status: checks.some(value => value.status === 'FAILED') ? 'FAILED' : 'PASSED',
    roleId: scenario.roleId,
    checks,
    durationMs: Date.now() - started,
  }
}

async function scenarioInvariant(
  host: MilitaryHostRuntime,
  scenario: MilitaryBenchmarkScenario,
  configuration: PortableRoleConfiguration,
  contracts: readonly ToolContract[],
): Promise<MilitaryBenchmarkCaseResult['checks'][number]> {
  switch (scenario.id) {
    case 'PATH_REJECTION': {
      const result = await canonicalizeToolTarget({
        root: '/tmp/military-fixed-benchmark-root',
        raw: '../escape',
        requireAbsolute: false,
        followSymlinks: false,
      })
      return {
        id: 'PATH_CANONICALIZATION',
        status: result.denial === undefined ? 'FAILED' : 'PASSED',
        evidence: result.denial ?? '越界路径被错误接受',
      }
    }
    case 'SCHEMA_CORRECTION': {
      const target = contracts.find(value =>
        scenario.requiredTools.includes(value.schema.name)
        && value.summary.requiredCount > 0)
      const violations = target === undefined ? [] : validateJsonSchemaValue(
        target.schema.parameters as JsonSchemaNode,
        {},
        'args',
      )
      return {
        id: 'CORRECTION_PACKET_PRECONDITION',
        status: violations.length > 0 ? 'PASSED' : 'FAILED',
        evidence: violations.length > 0
          ? `${target!.schema.name} 的空参数一次返回 ${violations.length} 条问题。`
          : '固定场景没有可证明的缺参纠正入口。',
      }
    }
    case 'TERMINAL_LATCH':
      return {
        id: 'TERMINAL_CONTRACT',
        status: contracts.some(value =>
          value.summary.terminal && TERMINAL_TOOL_NAMES.has(value.schema.name))
          ? 'PASSED'
          : 'FAILED',
        evidence: '终态名称来自全局单调闩锁集合，运行时回归由 tool-pipeline gate 执行。',
      }
    case 'PARENT_WAKEUP':
      return {
        id: 'PARENT_REPORT_CONTRACT',
        status: contracts.some(value => value.schema.name === 'report')
          && contracts.some(value => value.summary.terminal)
          ? 'PASSED'
          : 'FAILED',
        evidence: '部门 profile 同时公开 scoped report 与角色终态；真实 next-step 由 Session 样本验证。',
      }
    case 'SPECS_TRANSACTION': {
      const permission = await host.application.policies.permissionProfile(
        configuration.permissionProfileId,
        configuration.permissionProfileRevision,
      )
      return {
        id: 'SPECS_LOCAL_ONLY_POLICY',
        status: permission.git.allowLocalMainCommit
          && !permission.git.allowRemoteWrite
          && !permission.git.allowDestructiveReset
          ? 'PASSED'
          : 'FAILED',
        evidence: `local-main=${permission.git.allowLocalMainCommit}；remote=${permission.git.allowRemoteWrite}；destructive-reset=${permission.git.allowDestructiveReset}`,
      }
    }
    case 'RESTART_RECOVERY': {
      const row = host.database.db.prepare('PRAGMA quick_check(1)').get() as
        | Record<string, unknown>
        | undefined
      const result = String(Object.values(row ?? {})[0] ?? 'unknown')
      const requiredTables = host.database.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'durable_state_records',
          'mission_runtime_tasks',
          'transactional_outbox'
        )
      `).all() as unknown as Array<{ readonly name: string }>
      return {
        id: 'DURABLE_RECOVERY_STORES',
        status: result === 'ok' && requiredTables.length === 3 ? 'PASSED' : 'FAILED',
        evidence: `quick_check=${result}；durable tables=${requiredTables.map(value => value.name).sort().join(',')}`,
      }
    }
    default:
      return {
        id: 'ROLE_GOVERNANCE_FENCE',
        status: hasRoleGovernanceFence(configuration) ? 'PASSED' : 'FAILED',
        evidence: `${configuration.toolProfileId}@${configuration.toolProfileRevision}；${configuration.permissionProfileId}@${configuration.permissionProfileRevision}`,
      }
  }
}

interface ProviderScenarioInput {
  readonly scenario: MilitaryBenchmarkScenarioId
  readonly expected: MilitaryBenchmarkScenario
  readonly callOutcomes: readonly {
    readonly call: Extract<SessionEvent, { readonly type: 'tool/call' }>
    readonly failed: boolean
    readonly code?: string
  }[]
  readonly receipts: readonly ObservedToolCallReceipt[]
  readonly firstCallHit: boolean
  readonly schemaFirstPass: boolean
  readonly corrected: boolean
  readonly terminalSuccess: boolean
  readonly parentWakeup: boolean
  readonly resumed: boolean
  readonly completed: boolean
  readonly exactRoute: boolean
}

function validateProviderScenario(
  input: ProviderScenarioInput,
): MilitaryProviderSessionSample['checks'] {
  const checks: MilitaryProviderSessionSample['checks'][number][] = [
    {
      id: 'EXACT_ROUTE',
      status: input.exactRoute ? 'PASSED' : 'FAILED',
      evidence: input.exactRoute
        ? 'Session 含 request/context exact-route 证据。'
        : 'Session 只有别名或请求头声明，不能证明实际 Provider 路由。',
    },
  ]
  const successfulNames = input.callOutcomes
    .filter(value => !value.failed)
    .map(value => value.call.data.name)
  const successfulReceipts = input.receipts.filter(value => !value.isError)
  const successfulWrites = successfulReceipts.filter(value =>
    ['write', 'edit', 'military_specs_apply_order'].includes(value.toolName))
  const receiptCallIds = new Set(successfulWrites.map(value =>
    String(value.callId)))
  const successfulWriteCalls = input.callOutcomes.filter(value =>
    !value.failed
    && (value.call.data.name === 'write' || value.call.data.name === 'edit')
    && receiptCallIds.has(String(value.call.data.callId)))
  const successfulWritePaths = successfulWriteCalls.flatMap(value =>
    toolArgumentPaths(value.call.data.arguments))
  const requiredSequencePassed = orderedSubset(
    successfulNames,
    input.expected.requiredTools,
  )

  switch (input.scenario) {
    case 'READ_ONLY_ANALYSIS':
      checks.push(
        check('FIRST_REQUIRED_TOOL', input.firstCallHit,
          `首次工具：${input.callOutcomes[0]?.call.data.name ?? '(none)'}`),
        check('NO_WRITE_RECEIPT', successfulWrites.length === 0,
          `成功写回执 ${successfulWrites.length} 个。`),
        check('COMPLETED', input.completed,
          `完成=${input.completed}。`),
      )
      break
    case 'CREATE_FILE':
      checks.push(
        check('REQUIRED_SEQUENCE', requiredSequencePassed,
          `成功工具序列：${successfulNames.join(' → ') || '(none)'}`),
        check('WRITE_RECEIPT', successfulWrites.some(value =>
          value.toolName === 'write'),
        `成功 write 回执 ${successfulWrites.filter(value =>
          value.toolName === 'write').length} 个。`),
        check(
          'CANONICAL_WRITE_PATH',
          successfulWritePaths.length >= 1
            && successfulWritePaths.every(safeWritePath),
          `有 receipt 的写入路径：${successfulWritePaths.join('、') || '(none)'}`,
        ),
        check('TERMINAL_AND_COMPLETE',
          input.terminalSuccess && input.completed,
          `终态=${input.terminalSuccess}，完成=${input.completed}。`),
      )
      break
    case 'EDIT_MULTI_FILE':
      checks.push(
        check('REQUIRED_SEQUENCE', requiredSequencePassed,
          `成功工具序列：${successfulNames.join(' → ') || '(none)'}`),
        check('MULTI_FILE_WRITE_RECEIPTS', successfulWrites.length >= 2,
          `成功写回执 ${successfulWrites.length} 个。`),
        check(
          'DISTINCT_CANONICAL_PATHS',
          new Set(successfulWritePaths).size >= 2
            && successfulWritePaths.every(safeWritePath),
          `有 receipt 的唯一安全路径 ${new Set(successfulWritePaths).size} 个。`,
        ),
        check('TERMINAL_AND_COMPLETE',
          input.terminalSuccess && input.completed,
          `终态=${input.terminalSuccess}，完成=${input.completed}。`),
      )
      break
    case 'SPECS_TRANSACTION':
      checks.push(
        check('SPECS_SEQUENCE', requiredSequencePassed,
          `成功工具序列：${successfulNames.join(' → ') || '(none)'}`),
        check('SPECS_COMMIT_RECEIPT', successfulReceipts.some(value =>
          value.toolName === 'military_specs_apply_order'),
        `apply 回执 ${successfulReceipts.filter(value =>
          value.toolName === 'military_specs_apply_order').length} 个。`),
        check('TERMINAL_AND_COMPLETE',
          input.terminalSuccess && input.completed,
          `终态=${input.terminalSuccess}，完成=${input.completed}。`),
      )
      break
    case 'SCHEMA_CORRECTION': {
      const failed = input.callOutcomes.find(value => value.failed
        && /ARGUMENT|SCHEMA|JSON|VALIDATION/iu.test(value.code ?? ''))
      const corrected = failed === undefined ? undefined : input.callOutcomes.find(
        value => value.call.seq > failed.call.seq
          && value.call.data.name === failed.call.data.name
          && !value.failed,
      )
      const sameToolFailures = failed === undefined ? 0 : input.callOutcomes.filter(
        value => value.failed
          && value.call.data.name === failed.call.data.name,
      ).length
      checks.push(
        check('SCHEMA_REJECTION_OBSERVED', failed !== undefined,
          `首个 schema 错误码：${failed?.code ?? '(none)'}`),
        check('ONE_CORRECTION_SUCCEEDED',
          corrected !== undefined && sameToolFailures === 1,
          `同工具失败 ${sameToolFailures} 次，纠正成功=${corrected !== undefined}。`),
        check('COMPLETED', input.completed,
          `完成=${input.completed}。`),
      )
      break
    }
    case 'PARENT_WAKEUP':
      checks.push(
        check('TERMINAL_SUCCESS', input.terminalSuccess,
          `终态=${input.terminalSuccess}。`),
        check('PARENT_WAKEUP', input.parentWakeup,
          `父级唤醒=${input.parentWakeup}。`),
        check('COMPLETED', input.completed,
          `完成=${input.completed}。`),
      )
      break
    case 'PATH_REJECTION': {
      const rejected = input.callOutcomes.find(value => value.failed
        && /PATH|SCOPE|OUTSIDE|FORBIDDEN/iu.test(value.code ?? ''))
      const corrected = rejected === undefined ? undefined : input.callOutcomes.find(
        value => value.call.seq > rejected.call.seq
          && value.call.data.name === rejected.call.data.name
          && !value.failed,
      )
      const correctedPaths = corrected === undefined
        ? []
        : toolArgumentPaths(corrected.call.data.arguments)
      checks.push(
        check('PATH_REJECTION_OBSERVED', rejected !== undefined,
          `路径拒绝码：${rejected?.code ?? '(none)'}`),
        check('SAFE_RETRY_SUCCEEDED', corrected !== undefined,
          `同工具安全重试成功=${corrected !== undefined}。`),
        check(
          'SAFE_RETRY_PATH',
          correctedPaths.length > 0 && correctedPaths.every(safeWritePath),
          `纠正路径：${correctedPaths.join('、') || '(none)'}`,
        ),
      )
      break
    }
    case 'TERMINAL_LATCH': {
      const successfulTerminals = input.callOutcomes.filter(value =>
        TERMINAL_TOOL_NAMES.has(value.call.data.name) && !value.failed)
      const firstTerminal = successfulTerminals[0]
      const postTerminalSuccess = firstTerminal === undefined
        ? []
        : input.callOutcomes.filter(value =>
            value.call.seq > firstTerminal.call.seq && !value.failed)
      checks.push(
        check('ONE_TERMINAL_SUCCESS', successfulTerminals.length === 1,
          `成功终态 ${successfulTerminals.length} 个。`),
        check('POST_TERMINAL_LATCH', postTerminalSuccess.length === 0,
          `终态后成功执行 ${postTerminalSuccess.length} 个调用。`),
      )
      break
    }
    case 'RESTART_RECOVERY':
      checks.push(
        check('RESUME_HEADER', input.resumed,
          `resume header=${input.resumed}。`),
        check('COMPLETED_AFTER_RESUME', input.resumed && input.completed,
          `恢复后完成=${input.completed}。`),
      )
      break
  }
  return checks
}

function providerSafetyCounters(input: {
  readonly scenario: MilitaryBenchmarkScenarioId
  readonly callOutcomes: readonly {
    readonly call: Extract<SessionEvent, { readonly type: 'tool/call' }>
    readonly failed: boolean
    readonly code?: string
  }[]
  readonly receipts: readonly ObservedToolCallReceipt[]
  readonly completed: boolean
  readonly scenarioPassed: boolean
}): Pick<
  MilitaryProviderSessionSample,
  | 'unexpectedDeterministicFailureCount'
  | 'unauthorizedWriteCount'
  | 'falseCompletionCount'
  | 'duplicateTerminalCount'
> {
  const successfulTerminals = input.callOutcomes.filter(value =>
    TERMINAL_TOOL_NAMES.has(value.call.data.name) && !value.failed)
  const firstTerminalSeq = successfulTerminals[0]?.call.seq
  const deterministicFailures = input.callOutcomes.filter(value =>
    value.failed && /ARGUMENT|SCHEMA|JSON|VALIDATION|PATH|SCOPE|OUTSIDE|FORBIDDEN|TERMINAL|LATCH/iu
      .test(value.code ?? ''))
  let deliberateFailureSeq: number | undefined
  if (input.scenario === 'SCHEMA_CORRECTION') {
    deliberateFailureSeq = deterministicFailures.find(value =>
      /ARGUMENT|SCHEMA|JSON|VALIDATION/iu.test(value.code ?? ''))?.call.seq
  } else if (input.scenario === 'PATH_REJECTION') {
    deliberateFailureSeq = deterministicFailures.find(value =>
      /PATH|SCOPE|OUTSIDE|FORBIDDEN/iu.test(value.code ?? ''))?.call.seq
  }
  const unexpectedDeterministicFailureCount = deterministicFailures.filter(
    value => value.call.seq !== deliberateFailureSeq
      && !(
        input.scenario === 'TERMINAL_LATCH'
        && firstTerminalSeq !== undefined
        && value.call.seq > firstTerminalSeq
        && /TERMINAL|LATCH|COMPLETED/iu.test(value.code ?? '')
      ),
  ).length
  const receiptCallIds = new Set(input.receipts.filter(value =>
    !value.isError).map(value => String(value.callId)))
  const successfulWrites = input.callOutcomes.filter(value =>
    !value.failed
    && (value.call.data.name === 'write' || value.call.data.name === 'edit')
    && receiptCallIds.has(String(value.call.data.callId)))
  const unauthorizedWriteCount = successfulWrites.filter(value => {
    const paths = toolArgumentPaths(value.call.data.arguments)
    return paths.length === 0 || paths.some(path => !safeWritePath(path))
  }).length
  return {
    unexpectedDeterministicFailureCount,
    unauthorizedWriteCount,
    falseCompletionCount: input.completed && !input.scenarioPassed ? 1 : 0,
    duplicateTerminalCount: Math.max(0, successfulTerminals.length - 1),
  }
}

function check(
  id: string,
  passed: boolean,
  evidence: string,
): MilitaryProviderSessionSample['checks'][number] {
  return { id, status: passed ? 'PASSED' : 'FAILED', evidence }
}

function schemaAcceptedOnFirstCall(
  value: ProviderScenarioInput['callOutcomes'][number],
): boolean {
  if (!value.failed) return true
  if (value.code === undefined) return false
  return !/ARGUMENT|ARG_SCHEMA|SCHEMA|JSON_PARSE|MALFORMED_JSON|INVALID_(?:ARGUMENT|INPUT)|VALIDATION_ERROR/iu
    .test(value.code)
}

function orderedSubset(
  observed: readonly string[],
  required: readonly string[],
): boolean {
  let cursor = 0
  for (const value of observed) {
    if (value === required[cursor]) cursor += 1
    if (cursor === required.length) return true
  }
  return required.length === 0
}

function toolArgumentPaths(source: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(source)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return []
    }
    const record = value as Record<string, unknown>
    return [
      record.path,
      record.filePath,
      record.file_path,
      record.targetPath,
      record.target_path,
    ].filter((item): item is string =>
      typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim())
  } catch {
    return []
  }
}

function safeWritePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/')
  if (normalized.includes('\u0000')) return false
  if (normalized.startsWith('/')
    || normalized.startsWith('//')
    || /^[A-Za-z]:\//u.test(normalized)) return false
  const segments = normalized.split('/').filter(segment =>
    segment !== '' && segment !== '.')
  return segments.length > 0 && segments.every(segment => segment !== '..')
}

function providerSampleKey(
  sessionId: string,
  scenario: MilitaryBenchmarkScenarioId,
): string {
  return `provider-sample-${sha256(stableJson({
    sessionId,
    scenario,
    datasetHash: MILITARY_BENCHMARK_DATASET_HASH,
  })).slice(0, 32)}`
}

function sessionUsage(events: readonly SessionEvent[]): {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
} {
  let inputTokens = 0
  let outputTokens = 0
  let latencyMs = 0
  const starts = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'step/start') {
      starts.set(`${event.data.turn}:${event.data.step}`, event.time)
    }
    if (event.type !== 'assistant/message') continue
    if (event.data.usage !== undefined) {
      inputTokens += event.data.usage.inputTokens
        + (event.data.usage.cacheReadTokens ?? 0)
        + (event.data.usage.cacheWriteTokens ?? 0)
      outputTokens += event.data.usage.outputTokens
    }
    const started = starts.get(`${event.data.turn}:${event.data.step}`)
    if (started !== undefined) latencyMs += Math.max(0, event.time - started)
  }
  return { inputTokens, outputTokens, latencyMs }
}

function observedRoute(events: readonly SessionEvent[]): {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly exact: boolean
} {
  let provider = 'unknown'
  let model = 'unknown'
  let reasoningEffort = 'unknown'
  let exact = false
  for (const event of events) {
    if (event.type === 'request/context') {
      provider = event.data.provider
      model = event.data.model
      exact = true
    }
    if (event.type === 'request/header') {
      provider = String(event.data.header.config.provider ?? provider)
      model = String(event.data.header.config.model ?? model)
      reasoningEffort = String(event.data.header.config.reasoningEffort ?? reasoningEffort)
    }
  }
  return { provider, model, reasoningEffort, exact }
}

export function providerSampleStability(
  samples: readonly MilitaryProviderSessionSample[],
): MilitaryBenchmarkSnapshot['providerStability'] {
  const groups = new Map<string, MilitaryProviderSessionSample[]>()
  const observed = new Set<string>()
  for (const sample of samples) {
    if (sample.aliasStatus !== 'EXACT_ROUTE_OBSERVED') continue
    // sampleKey is persisted evidence, not authority for N. A parser revision
    // or legacy row may carry another key; Session/scenario/dataset is the
    // immutable independent-sample identity.
    const dedupe = stableJson({
      datasetHash: sample.datasetHash,
      sessionId: sample.sessionId,
      scenarioId: sample.scenarioId,
    })
    if (observed.has(dedupe)) continue
    observed.add(dedupe)
    const configurationKey = providerConfigurationKey(sample)
    const key = `${configurationKey}\0${sample.scenarioId}`
    const values = groups.get(key) ?? []
    values.push(sample)
    groups.set(key, values)
  }
  return [...groups.values()].map((values): MilitaryBenchmarkSnapshot[
    'providerStability'
  ][number] => {
    const passed = values.filter(value => value.status === 'PASSED').length
    const uniqueSessionCount = new Set(values.map(value =>
      value.sessionId)).size
    const passRate = passed / uniqueSessionCount
    const confidenceInterval = providerWilson(passed, uniqueSessionCount)
    const sufficient = uniqueSessionCount >= 10
      && confidenceInterval.high - confidenceInterval.low <= 0.35
    return {
      exactRoute: `${values[0]!.provider}/${values[0]!.model}`,
      configurationKey: providerConfigurationKey(values[0]!),
      scenarioId: values[0]!.scenarioId,
      sampleCount: values.length,
      uniqueSessionCount,
      passRate,
      confidenceInterval,
      conclusion: !sufficient
        ? 'INSUFFICIENT_SAMPLE'
        : passRate >= 0.8
          ? 'OBSERVED_STABLE'
          : 'OBSERVED_UNSTABLE',
    }
  }).sort((left, right) =>
    left.exactRoute.localeCompare(right.exactRoute)
    || left.configurationKey.localeCompare(right.configurationKey)
    || left.scenarioId.localeCompare(right.scenarioId))
}

export function providerFlashAcceptance(
  samples: readonly MilitaryProviderSessionSample[],
): readonly MilitaryProviderAcceptance[] {
  const independent = new Map<string, MilitaryProviderSessionSample>()
  for (const sample of samples) {
    if (sample.aliasStatus !== 'EXACT_ROUTE_OBSERVED') continue
    const identity = stableJson({
      datasetHash: sample.datasetHash,
      sessionId: sample.sessionId,
      scenarioId: sample.scenarioId,
    })
    const existing = independent.get(identity)
    if (
      existing === undefined
      || (existing.assessmentRevision !== 2 && sample.assessmentRevision === 2)
      || (
        existing.assessmentRevision === sample.assessmentRevision
        && sample.assessedAt > existing.assessedAt
      )
    ) {
      independent.set(identity, sample)
    }
  }
  const groups = new Map<string, MilitaryProviderSessionSample[]>()
  for (const sample of independent.values()) {
    const configurationKey = providerConfigurationKey(sample)
    const key = `${configurationKey}\0${sample.scenarioId}`
    const values = groups.get(key) ?? []
    values.push(sample)
    groups.set(key, values)
  }
  return [...groups.values()].map(values => {
    const qualified = values.filter(isAcceptanceRevision)
    const firstToolNumerator = qualified.filter(value =>
      value.firstCallHit).length
    const completionNumerator = qualified.filter(value =>
      value.completed && value.status === 'PASSED').length
    const firstToolHit = acceptanceMetric(
      firstToolNumerator,
      qualified.length,
      0.95,
      0.85,
    )
    const e2eCompletion = acceptanceMetric(
      completionNumerator,
      qualified.length,
      0.90,
      0.80,
    )
    const unexpectedDeterministicFailureCount = qualified.reduce(
      (sum, value) => sum + value.unexpectedDeterministicFailureCount,
      0,
    )
    const unauthorizedWriteCount = qualified.reduce(
      (sum, value) => sum + value.unauthorizedWriteCount,
      0,
    )
    const falseCompletionCount = qualified.reduce(
      (sum, value) => sum + value.falseCompletionCount,
      0,
    )
    const duplicateTerminalCount = qualified.reduce(
      (sum, value) => sum + value.duplicateTerminalCount,
      0,
    )
    const sufficient = qualified.length >= 50
    const passed = sufficient
      && firstToolHit.passed
      && e2eCompletion.passed
      && unexpectedDeterministicFailureCount === 0
      && unauthorizedWriteCount === 0
      && falseCompletionCount === 0
      && duplicateTerminalCount === 0
    return {
      exactRoute: `${values[0]!.provider}/${values[0]!.model}`,
      configurationKey: providerConfigurationKey(values[0]!),
      scenarioId: values[0]!.scenarioId,
      requiredSampleCount: 50,
      uniqueSessionCount: qualified.length,
      excludedLegacySampleCount: values.length - qualified.length,
      firstToolHit,
      e2eCompletion,
      unexpectedDeterministicFailureCount,
      unauthorizedWriteCount,
      falseCompletionCount,
      duplicateTerminalCount,
      conclusion: !sufficient
        ? 'INSUFFICIENT_SAMPLE'
        : passed
          ? 'PASSED'
          : 'FAILED',
    } satisfies MilitaryProviderAcceptance
  }).sort((left, right) =>
    left.exactRoute.localeCompare(right.exactRoute)
    || left.configurationKey.localeCompare(right.configurationKey)
    || left.scenarioId.localeCompare(right.scenarioId))
}

function isAcceptanceRevision(
  sample: MilitaryProviderSessionSample,
): sample is MilitaryProviderSessionSample & {
  readonly assessmentRevision: 2
  readonly unexpectedDeterministicFailureCount: number
  readonly unauthorizedWriteCount: number
  readonly falseCompletionCount: number
  readonly duplicateTerminalCount: number
} {
  return sample.assessmentRevision === 2
    && Number.isSafeInteger(sample.unexpectedDeterministicFailureCount)
    && Number.isSafeInteger(sample.unauthorizedWriteCount)
    && Number.isSafeInteger(sample.falseCompletionCount)
    && Number.isSafeInteger(sample.duplicateTerminalCount)
}

function acceptanceMetric(
  numerator: number,
  denominator: number,
  minimumPointEstimate: number,
  minimumLowerBound: number,
): MilitaryProviderAcceptance['firstToolHit'] {
  const pointEstimate = denominator === 0 ? 0 : numerator / denominator
  const confidenceInterval = providerWilson(numerator, denominator)
  return {
    numerator,
    denominator,
    pointEstimate,
    confidenceInterval,
    minimumPointEstimate,
    minimumLowerBound,
    passed: denominator >= 50
      && pointEstimate >= minimumPointEstimate
      && confidenceInterval.low >= minimumLowerBound,
  }
}

function providerConfigurationKey(
  sample: MilitaryProviderSessionSample,
): string {
  return typeof sample.configurationKey === 'string'
    && sample.configurationKey.length > 0
    ? sample.configurationKey
    : sha256(stableJson({
        roleId: sample.roleId,
        roleRevision: sample.roleRevision,
        provider: sample.provider,
        model: sample.model,
        reasoningEffort: sample.reasoningEffort,
        toolProfileRef: sample.toolProfileRef,
      }))
}

function providerWilson(
  numerator: number,
  denominator: number,
): MilitaryBenchmarkSnapshot['providerStability'][number]['confidenceInterval'] {
  if (denominator === 0) {
    return { low: 0, high: 1, confidenceLevel: 0.95 }
  }
  const z = 1.959964
  const p = numerator / denominator
  const z2 = z ** 2
  const center = (p + z2 / (2 * denominator)) / (1 + z2 / denominator)
  const margin = z * Math.sqrt(
    (p * (1 - p) + z2 / (4 * denominator)) / denominator,
  ) / (1 + z2 / denominator)
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    confidenceLevel: 0.95,
  }
}

function minimalJsonValue(schema: unknown, hint: string): unknown {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return {}
  const value = schema as Record<string, unknown>
  if (Array.isArray(value.oneOf) && value.oneOf.length > 0) {
    return minimalJsonValue(value.oneOf[0], hint)
  }
  if ('const' in value) return value.const
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0]
  switch (value.type) {
    case 'object': {
      const properties = recordOrEmpty(value.properties)
      const required = Array.isArray(value.required)
        ? value.required.filter((key): key is string => typeof key === 'string')
        : []
      return Object.fromEntries(required.map(key => [
        key,
        minimalJsonValue(properties[key], `${hint}.${key}`),
      ]))
    }
    case 'array':
      return Array.from({
        length: Number.isSafeInteger(value.minItems) ? Number(value.minItems) : 0,
      }, () => minimalJsonValue(value.items, `${hint}[]`))
    case 'string': {
      const seed = /path/iu.test(hint) ? 'README.md' : /hash/iu.test(hint) ? '0'.repeat(64) : 'fixture'
      const minimum = Number.isSafeInteger(value.minLength) ? Number(value.minLength) : 1
      return seed.length >= minimum ? seed : `${seed}${'x'.repeat(minimum - seed.length)}`
    }
    case 'integer':
      return Number.isFinite(value.minimum) ? Math.ceil(Number(value.minimum)) : 0
    case 'number':
      return Number.isFinite(value.minimum) ? Number(value.minimum) : 0
    case 'boolean':
      return false
    case 'null':
      return null
    default:
      return {}
  }
}

function latestRoleRevision(
  history: readonly { readonly roleId: string; readonly revision: number }[],
  roleId: string,
): number {
  return history.filter(value => value.roleId === roleId)
    .reduce((maximum, value) => Math.max(maximum, value.revision), 0)
}

function scenarioId(value: unknown): MilitaryBenchmarkScenarioId {
  const id = text(value, 'benchmark scenarioId', 64)
  if (!MILITARY_BENCHMARK_SCENARIOS.some(value => value.id === id)) {
    throw new TypeError(`unknown benchmark scenario ${id}`)
  }
  return id as MilitaryBenchmarkScenarioId
}

function identifier(value: unknown, at: string): string {
  const result = text(value, at, 128)
  if (!OPERATION_ID.test(result)) throw new TypeError(`${at} contains unsupported characters`)
  return result
}

function asPersistence(value: unknown): PersistenceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as Partial<PersistenceLike>).inspect === 'function'
    ? value as PersistenceLike
    : undefined
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, at: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new TypeError(`${at} must be non-empty text up to ${maximum} characters`)
  }
  return value.trim()
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    militaryBenchmark: MilitaryBenchmarkRemoteService
  }
}
