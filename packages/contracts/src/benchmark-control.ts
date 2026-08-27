export const MILITARY_BENCHMARK_SCHEMA_VERSION = '1.0.0' as const
export const MILITARY_BENCHMARK_DATASET_VERSION = 'military-flash-core-v1' as const

export type MilitaryBenchmarkScenarioId =
  | 'READ_ONLY_ANALYSIS'
  | 'CREATE_FILE'
  | 'EDIT_MULTI_FILE'
  | 'SPECS_TRANSACTION'
  | 'SCHEMA_CORRECTION'
  | 'PARENT_WAKEUP'
  | 'PATH_REJECTION'
  | 'TERMINAL_LATCH'
  | 'RESTART_RECOVERY'

export interface MilitaryBenchmarkScenario {
  readonly id: MilitaryBenchmarkScenarioId
  readonly label: string
  readonly description: string
  readonly roleId: string
  readonly requiredTools: readonly string[]
  readonly successCriteria: readonly string[]
}

export const MILITARY_BENCHMARK_SCENARIOS: readonly MilitaryBenchmarkScenario[] =
  Object.freeze([
    {
      id: 'READ_ONLY_ANALYSIS',
      label: '只读分析',
      description: 'General 读取 Host 上下文并通过受治理部门完成只读分析。',
      roleId: 'general',
      requiredTools: ['military_get_context', 'military_spawn_department_agent'],
      successCriteria: ['首次工具命中', '无写工具越权', '结果由 receipt 支撑'],
    },
    {
      id: 'CREATE_FILE',
      label: '创建文件',
      description: 'Worker 在隔离 worktree 使用 RC.2 write 并提交 Candidate。',
      roleId: 'worker-default',
      requiredTools: ['write', 'military_submit_candidate'],
      successCriteria: ['write 参数通过 Schema', '路径在 Task write scope', '终态成功后停止'],
    },
    {
      id: 'EDIT_MULTI_FILE',
      label: '编辑多个文件',
      description: 'Worker 读取、编辑多个授权文件并保留验证证据。',
      roleId: 'worker-default',
      requiredTools: ['read', 'edit', 'military_submit_candidate'],
      successCriteria: ['多文件写入正确', '验证通过', '无超范围路径'],
    },
    {
      id: 'SPECS_TRANSACTION',
      label: 'Specs 原子事务',
      description: 'Engineer 读取/分块/应用 Specs，并执行本地提交与回滚保护。',
      roleId: 'engineer-default',
      requiredTools: ['military_specs_read', 'military_specs_stage_chunk', 'military_specs_apply_order'],
      successCriteria: ['Host 先验证后写入', '本地 commit receipt', '失败零部分状态'],
    },
    {
      id: 'SCHEMA_CORRECTION',
      label: 'Schema 一次纠正',
      description: '缺参调用收到完整纠正包，下一次通过同一实际 Schema。',
      roleId: 'worker-default',
      requiredTools: ['military_submit_candidate'],
      successCriteria: ['首次失败可解释', '一次纠正成功', '没有重复无进展签名'],
    },
    {
      id: 'PARENT_WAKEUP',
      label: '父级唤醒',
      description: '子 Agent 终态 receipt 持久化后以 next-step 唤醒父 General。',
      roleId: 'worker-default',
      requiredTools: ['report', 'military_submit_candidate'],
      successCriteria: ['直接父级收到报告', '重复交付幂等', '显式取消不被唤醒'],
    },
    {
      id: 'PATH_REJECTION',
      label: '路径拒绝与纠正',
      description: '越界或错误相对路径被拒绝且不消耗 Grant，随后一次纠正。',
      roleId: 'worker-default',
      requiredTools: ['read', 'write'],
      successCriteria: ['canonicalization 先于 Grant', '原始拒绝原因保留', '安全路径可重试'],
    },
    {
      id: 'TERMINAL_LATCH',
      label: '重复终态闩锁',
      description: '终态成功后同一 assistant response 的额外工具调用被拒绝。',
      roleId: 'worker-default',
      requiredTools: ['military_submit_candidate'],
      successCriteria: ['唯一终态成功', '后续调用不执行', '父级 receipt 不重复'],
    },
    {
      id: 'RESTART_RECOVERY',
      label: '重启恢复',
      description: '进程重启后从 SQLite/Session 权威记录恢复并继续 exact Task。',
      roleId: 'general',
      requiredTools: ['military_status', 'military_get_context'],
      successCriteria: ['resume header 可追溯', '幂等 receipt 复用', '状态不由 UI 补写'],
    },
  ] satisfies readonly MilitaryBenchmarkScenario[])

export interface MilitaryBenchmarkCaseResult {
  readonly scenarioId: MilitaryBenchmarkScenarioId
  readonly status: 'PASSED' | 'FAILED'
  readonly roleId: string
  readonly checks: readonly {
    readonly id: string
    readonly status: 'PASSED' | 'FAILED'
    readonly evidence: string
  }[]
  readonly durationMs: number
}

export interface MilitaryBenchmarkRun {
  readonly schemaVersion: typeof MILITARY_BENCHMARK_SCHEMA_VERSION
  readonly runId: string
  readonly mode: 'DETERMINISTIC'
  readonly datasetVersion: typeof MILITARY_BENCHMARK_DATASET_VERSION
  readonly datasetHash: string
  readonly bundleVersion: string
  readonly presetGeneration: string
  readonly dshRelease: '0.1.1-rc.2'
  readonly dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
  readonly cases: readonly MilitaryBenchmarkCaseResult[]
  readonly roleConfigurations: readonly {
    readonly roleId: string
    readonly roleRevision: number
    readonly provider: string
    readonly model: string
    readonly reasoningEffort: string
    readonly toolProfileRef: string
    readonly maxOutputTokens: number
    readonly contextBudgetTokens: number
  }[]
  readonly status: 'PASSED' | 'FAILED'
  readonly createdAt: string
}

export interface MilitaryProviderSessionSample {
  readonly schemaVersion: typeof MILITARY_BENCHMARK_SCHEMA_VERSION
  readonly sampleId: string
  /** Canonical dedupe key; one Session/scenario/dataset may count only once. */
  readonly sampleKey: string
  readonly scenarioId: MilitaryBenchmarkScenarioId
  readonly datasetHash: string
  readonly sessionId: string
  readonly roleId: string
  readonly roleRevision: number
  readonly provider: string
  readonly model: string
  readonly aliasStatus: 'EXACT_ROUTE_OBSERVED' | 'ALIAS_UNPROVEN'
  readonly reasoningEffort: string
  readonly toolProfileRef: string
  readonly configurationKey: string
  readonly eventFingerprint: string
  readonly firstCallHit: boolean
  readonly schemaFirstPass: boolean
  readonly corrected: boolean
  readonly completed: boolean
  readonly parentWakeup: boolean
  readonly terminalSuccess: boolean
  readonly writeReceiptCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costStatus: 'PROVIDER_PRICING_UNAVAILABLE'
  readonly latencyMs: number
  readonly status: 'PASSED' | 'FAILED'
  readonly checks: readonly {
    readonly id: string
    readonly status: 'PASSED' | 'FAILED'
    readonly evidence: string
  }[]
  readonly evidence: readonly string[]
  readonly assessedAt: string
}

export interface MilitaryBenchmarkSnapshot {
  readonly schemaVersion: typeof MILITARY_BENCHMARK_SCHEMA_VERSION
  readonly dataset: {
    readonly version: typeof MILITARY_BENCHMARK_DATASET_VERSION
    readonly hash: string
    readonly scenarios: readonly MilitaryBenchmarkScenario[]
  }
  readonly runs: readonly MilitaryBenchmarkRun[]
  readonly providerSamples: readonly MilitaryProviderSessionSample[]
  readonly providerStability: readonly {
    readonly exactRoute: string
    readonly configurationKey: string
    readonly scenarioId: MilitaryBenchmarkScenarioId
    readonly sampleCount: number
    readonly uniqueSessionCount: number
    readonly passRate: number
    readonly confidenceInterval: {
      readonly low: number
      readonly high: number
      readonly confidenceLevel: 0.95
    }
    readonly conclusion: 'INSUFFICIENT_SAMPLE' | 'OBSERVED_UNSTABLE' | 'OBSERVED_STABLE'
  }[]
  readonly eligibleSessions: readonly {
    readonly sessionId: string
    readonly roleId: string
    readonly provider: string
    readonly model: string
    readonly eventCount: number
    readonly updatedAt: string
  }[]
  readonly generatedAt: string
}
