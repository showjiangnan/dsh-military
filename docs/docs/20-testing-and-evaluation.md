# 测试、评估与发布门禁

## 1. 测试金字塔

### Schema/Contract

所有 Command/Event/Artifact metadata/Settings/Tool payload：正例、缺字段、未知字段、版本拒绝、边界值。

### Unit

状态机、CAS、幂等、DAG、锁、资格过滤、Skill 生命周期、权限、Task 粒度规则。

### Property-based

随机 DAG 无环；并发 Candidate 不会双重接受；事件重放确定性；权限永不因组合放宽；资源锁无非法交叉。

### Integration

DSH Agent create/setup、Scope、reasoning、request/header、pre-step、turn-stopping、cancel、Tool Pipeline、Session Event、Compaction、Settings、Conversation Node。

### End-to-end

IDEATION、ACTIVE、LEGACY、Rework、Radio、Freeze、Specs commit、Compaction/Memory、Promotion Order。

### Chaos

Ledger/Radio/Artifact/Verifier/Git/Agent/Provider 在关键窗口崩溃。

## 2. 发布阻断不变量

- 无证据 Candidate 被接受；
- stale Candidate/Guidance 被使用；
- Worker 写 specs；
- Engineer push/非 main/历史重写；
- Frozen Agent 写工具成功；
- reasoning off；
- Memory 引用未接受事实；
- Museum 直接发布 STABLE；
- Secret 出现在 Session/Ledger/导出；
- Event replay 产生不同投影。

任何一项发生即阻断发布。

## 3. 架构对照实验

至少比较：

```text
A: 单 General Agent
B: 普通 Swarm，无外置验收
C: dsh-military，无私有战术
D: dsh-military + 私有战术
E: 不同任务粒度与 reasoning 策略
```

控制相同用户目标、仓库快照、工具权限、最终 Verifier 和模型配额。

## 4. 主要评测指标

- 最终验收通过率；
- first-pass；
- false accept/false completion；
- 人工介入；
- 端到端时间；
- 总 Token/调用/工具成本；
- 回归率；
- specs 追踪覆盖；
- 未授权动作；
- guidance lift；
- memory fact coverage。

不以 Agent 数量、消息数或自报完成率作为成功。

## 5. 模型基准

每个 Task Type 测：

- Task Order 遵循；
- Tool use；
- 未读事实纪律；
- Candidate Evidence Mapping；
- Blocker 质量；
- Tactical Directive 修正；
- 长上下文约束保持；
- cancellation/freeze；
- low/high/max 差异。

模型名不能直接映射能力；使用本地验收数据。

## 6. 私有战术评测

- Simulation fixtures；
- historical replay；
- Canary；
- comparable control；
- negative effects；
- stop/rollback；
- 不同模型/环境兼容；
- 隔离后的影响追踪。

## 7. Verifier 校准

构造已知正确、已知错误和歧义 fixture，测 false accept/false reject。Judge Agent 应有盲测和模型/Prompt 版本记录。

## 8. UI 测试

- Durable Node 历史/实时一致；
- 断线重连；
- 乱序和分页；
- expected revision 冲突；
- Secret 不回显；
- 权限 Diff；
- Freeze/Promotion 高风险确认。

## 9. 文档工程质量

CI 验证：

- JSON Schema；
- YAML examples；
- TypeScript reference；
- Markdown links；
- Mermaid；
- specs template；
- ADR 编号；
- manifest/checksum；
- DSH baseline references。

## 10. MVP 验收

首个垂直切片必须证明：

- 可重放；
- 可冻结；
- 可拒绝；
- 可恢复；
- 可证明；
- 可形成本地 main specs commit；
- 不把模型自报当成事实。

## 0.2.0 必测套件

新增测试族：

- preset roster、broken preset、blank-session selection 和 lock；
- Military/Standard sibling session 的 Prompt/Tool/Event 零串扰；
- child `composeFrom()` exact generation；
- 同 cwd 外部 drift 不触发普通会话控制；
- Tag rename/pause/delete 和历史引用；
- Ingestion source hash、secret scan、Diff review 和 DRAFT-only；
- Template revision、reasoning fail closed、context threshold/hysteresis；
- `/brainstorm`、root-owned ask-user、取消和恢复；
- Chief sufficiency gate、过期 Advice 和用户问题转交；
- Evaluation date filter、revision split、difficulty adjustment、small sample、report totals。

## 0.3.0：一致性与真实 RC.2 Fixture

静态文档门禁新增：

```text
Event Catalog generation freshness
Mission/Admin discriminated payload coverage
JSON Schema ↔ TypeScript parity
Preset generation hash/archive freshness
RC.2 constant and General policy parity
State invariant scan
SQL migration shape
Conformance Trace event validation
```

真实实现必须在固定 RC.2 checkout 运行 E2E：

- preset picker、blank selection 和 nonblank lock；
- Standard/Military Session 工具可见性隔离；
- General preset 默认模型与用户模型切换；
- child template route 不跟随；
- current generation 重启恢复；archived-only 根 Session 重启后 quarantine/migration；
- root-only ask-user relay；
- Freeze 与进行中工具竞态；
- 独立 worktree、Patch、Integration 和 local main；
- SQL/outbox 崩溃恢复；
- 设置、多标签页、断线和可访问性。

关键状态使用属性测试和 [`reference/tla/MilitaryCore.tla`](../reference/tla/MilitaryCore.tla) 建模。测试报告必须区分“文档静态通过”和“真实 DSH Runtime 通过”。详见[一致性与模型检查](49-conformance-and-model-checking.md)。
