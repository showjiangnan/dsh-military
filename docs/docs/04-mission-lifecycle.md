# Mission 生命周期

## 1. 顶层状态

```text
DISCOVERING
→ INTENT_DRAFTED
→ STAFF_COUNCIL
→ DIRECTION_RATIFIED
→ SPECS_BASELINE（按需）
→ WAVE_READY
→ WAVE_ACTIVE
→ WAVE_BARRIER
→ MISSION_REVIEW
→ COMPLETED
```

任何活动状态都可进入 `CANCELLED`；不可恢复的基础设施或授权问题可进入 `SUSPENDED`。

## 2. 项目侦察

General 启动 Mission 后，Harness/侦察任务识别：

| 阶段 | 判据 | 下一动作 |
|---|---|---|
| `IDEATION` | 目录为空或只有零散材料，尚无可执行工程 | General 结构化意图；Staff 会商；Engineer 建 specs |
| `SPECS_ONLY` | 有文档但无主要实现 | 校验 specs；补齐 Direction/Wave；Engineer 维护 |
| `ACTIVE` | 有实现、构建/测试、Git 或明确工程结构 | 侦察现有约束；增量计划 |
| `LEGACY` | 有实现但缺 specs、测试或边界不清 | 先做基线侦察和风险 specs，再执行变更 |

“空项目”不能只按文件数判断，应结合 Git、manifest、源码、构建脚本和用户声明。

## 3. Mission Intent 草案

General 产出结构化对象，包含用户方向、结果、约束、事实、假设、未知项、完成判据和用户专属授权。实质性歧义由 General 向用户回显；内部实现细节由 Staff 处理。

## 4. Staff Council

- 确定性过滤合格参谋；
- 各参谋独立意见；
- 主责参谋综合；
- 形成一个或多个 Direction；
- Planning Validator 检查范围、依赖、验收和资源；
- General 批准。

## 5. Specs 基线

IDEATION、SPECS_ONLY 或重要 LEGACY Mission 在首个执行 Wave 前必须：

- 建立 `specs/` 目录；
- 固化 Mission Intent；
- 建立需求、架构、计划、验收和追踪模板；
- 如无 Git，初始化本地 `main`；
- 工兵提交基线 commit；
- Ledger 记录 commit receipt。

## 6. Wave 循环

### 进入

- 计划版本已批准；
- Environment Snapshot 冻结；
- Task DAG 和 Acceptance Contract 有效；
- Workspace/Verifier/Advisor 容量可用；
- specs 已反映计划。

### 执行

- 调度 Ready Task；
- 创建 Agent Scope；
- 执行工具；
- Candidate/Blocker；
- 验收、返工、求援或冻结。

### Barrier

- 必需 Task 全部接受；
- 集成验证通过；
- 无 critical Oversight；
- Radio 请求关闭或升级；
- 工兵更新 specs 并 commit；
- Tactical Report 与指标完成。

### 重新规划

只详细规划当前和下一 Wave。更远 Wave 保持 Direction-level outline，根据实际证据调整。

## 7. Change Order

以下变化增加相关版本：目标、范围、验收、Environment、权限、依赖、Git 授权或用户约束。活动 Agent 会收到取消/冻结/新 Task Version；旧 Candidate 只能作为证据，不可接受。

## 8. Compaction

General Session 压缩属于上下文维护，不改变 Mission Ledger。成功 compaction end 后：

- 以 compaction identity 幂等调度效能评估；
- 评估读取确定性报告和有效事件窗口；
- 失败不回滚 compaction；
- 评估完成后可触发 Museum 研究。

## 9. Mission 完成

完成前检查：

- 所有必需 Direction 完成；
- 用户目标和禁止动作对账；
- specs、测试、Artifact 和本地 Git 状态完整；
- 无 open critical incident；
- 最终 Tactical Memory 经过来源验证；
- General 向用户汇报结果、限制、风险和未执行外部动作。

## 显式头脑风暴入口

Military 根会话可通过 Web 显示的“头脑风暴”（协议 `/brainstorm`）进入一个可恢复的 Brainstorm Order：

```text
RECONNAISSANCE → QUESTIONING → STAFF_SYNTHESIS
→ USER_RATIFICATION → SPECS_HANDOFF → COMPLETED
```

空项目在完成用户决策和 Engineer 的 specs 本地 main commit 之前，不能进入实现 Wave。详细协议见[头脑风暴与用户决策](35-brainstorm-command-and-decision-dialogues.md)。

## 0.3.0：Mission 准入与恢复前置

新 Mission 在侦察前必须完成：

```text
actual preset=military
→ exact RC.2 Compatibility READY
→ preset generation bound
→ General route resolved
→ Authority Context established
→ Mission Budget reserved
→ Workspace baseline snapshot
```

恢复 Mission 还需验证 generation、database migration、Policy/Profile revision 和 Artifact 可用性。任一关键事实缺失时进入 `QUARANTINED/PAUSED`，不启动模型。

Mission 完成除 Task/Wave/specs 外，还要求 Integration Receipt、预算结算、待决 Decision 清空、Radio lease 关闭、战术来源/报告引用固化和 Outbox 无关键积压。
