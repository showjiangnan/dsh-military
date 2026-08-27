# 62. 自适应执行 Router、Capability Profile 与并行度

## 1. 角色不是能力

部门名称不产生权限或模型能力。一个 Activation 的实际执行条件由以下交集决定：

```text
Agent Template
∩ Task Capability Profile
∩ Model Capability Profile
∩ Tool/Permission/API Grants
∩ Data Residency
∩ Resource Budget
```

## 2. Execution Strategy

Router 输出：

```ts
interface ExecutionStrategy {
  modelRoute: { provider: string; model: string }
  reasoningEffort: 'low' | 'high' | 'max'
  paradigm: 'direct' | 'react' | 'plan-execute' | 'reflection' | 'multi-agent'
  maximumSteps: number
  verificationTier: 'V0' | 'V1' | 'V2' | 'V3' | 'V4'
  parallelism: number
}
```

角色只定义最低约束，任务风险和证据要求决定实际策略。General 的模型仍以 Military preset 默认开始并跟随用户会话选择；Department Agent 使用冻结 Template Route。

## 3. Parallelism Score

```text
独立子问题 + 独立证据源 + 可分离工具
- 共享上下文 - 写冲突 - 时序依赖 - Join 成本 - Integration 风险
```

低分默认一个 Worker；只有高可并行性任务才允许 3–5 个 Worker。探索分支必须只读或使用隔离 Workspace。

## 4. Plan IR

Staff 生成 Plan Proposal，确定性 Plan Compiler 生成 Direction/Wave/Task DAG，并检查：

- 环与孤儿 Task；
- read/write scope 冲突；
-接口未定义；
-验收覆盖；
-权限、模型、工具、Verifier 和预算可达性；
- Join 与 rollback。

模型不能直接绕过编译器创建可执行 Task。
