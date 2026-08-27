# 工兵部与 specs 文档工程

## 1. 使命

工兵部负责把用户意图、参谋计划、实际实现与验收事实维护为可持续的 `specs/` 工程，并提供严格、可追踪的本地 Git 历史。

## 2. 何时强制出动

- 项目为空或处于头脑风暴/IDEATION；
- 项目只有零散需求，没有结构化 specs；
- LEGACY 项目需要建立基线；
- Direction 批准；
- 每个 Wave 完成；
- Change Order；
- 重大 Incident 或架构决策；
- 用户要求维护文档。

## 3. 空项目流程

1. General 把用户需求转译为 Mission Intent；
2. Staff Council 共同形成 Direction、初始 Waves、关键需求和风险；
3. Harness 下发 Specs Bootstrap Order；
4. 只有 Engineer Agent 可创建文档工程；
5. Engineer 建立需求、架构、决策、计划、验收、运维和追踪模板；
6. 文档校验；
7. 如无 Git，受限 Provider 执行 `git init -b main`；
8. 在本地 main 提交基线；
9. commit/tree/diff receipt 写入 Ledger；
10. 才可打开实现 Wave。

## 4. specs 结构

推荐模板见 `templates/specs/`：

```text
specs/
  README.md
  specs-manifest.yaml
  00-mission/
  01-requirements/
  02-architecture/
  03-decisions/
  04-planning/
  05-verification/
  06-operations/
  07-traceability/
  08-history/
```

可按项目裁剪，但 Mission Intent、需求、架构、验收和追踪不可缺失。

## 5. 常规维护协议

每次维护由 `Specs Maintenance Order` 驱动：

- Trigger 和来源 Event；
- 需要更新的文档与目的；
- allowed paths；
- validation；
- commit message；
- branch=`main`、localOnly=true。

Engineer 输出 Candidate；Harness 验证后才调用 Git Provider commit。

## 6. 独占写权限

- Worker：`specs/**` 只读；
- Staff：提供维护命令和事实引用；
- General：批准战略变更，不作为常规文档写者；
- Engineer：唯一常规 Agent 写者；
- Harness：强制路径、来源和 Git。

避免多个模型直接修改同一文档真源。

## 7. Git 纪律

### 7.1 无 Git

```text
git init -b main
```

只创建本地仓库，不配置或推送远端。

### 7.2 已有 Git

- 不重命名用户现有分支；
- 不重写历史；
- 通过受控本地 main worktree/分支策略维护 specs；
- 如果“本地 main”的创建会改变项目语义，升级 General；
- 不假定 remote 存在或可写。

### 7.3 允许命令

Engineer 不获得任意 Git shell。Provider 仅暴露：

```text
inspect
initializeLocalMain
status
stageAllowlistedPaths
commitLocalMain
readCommitReceipt
```

### 7.4 禁止命令

```text
push / fetch / pull
rebase / reset --hard
force
branch deletion
remote modification
commit on non-controlled branch
```

## 8. 用户要求 GitHub/其他分支

只有 General 可执行，流程：

- 用户明确授权；
- 创建 Promotion Order；
- 固定 source commit、repository、remote、target branch、action、expiry；
- General 专属工具执行；
- Harness 审计 receipt；
- 不给 Engineer 临时扩大权限。

## 9. 每个 Wave 后即时维护

Wave Barrier 中，Engineer 必须在下一 Wave 打开前：

- 更新 accepted progress；
- 固化决策与风险变化；
- 更新 Requirement→Task→Candidate→Test→Evidence；
- 标记未完成/取消项；
- 更新运行手册；
- 校验引用；
- 提交本地 main commit。

“稍后统一补文档”不符合本架构。

## 10. 文档验收

- 所有事实引用存在的 Event/Artifact；
- 没有把 rejected candidate 写成事实；
- Requirement ID 唯一；
- Traceability 无关键 orphan；
- Markdown links/Mermaid/schema 有效；
- 非 allowed paths 未改变；
- commit 内容无 secret；
- commit receipt 与工作树一致。

## 11. 故障处理

- Git hook 失败：保留工作树并提交 Blocker；
- 非 specs 路径 dirty：不得偷偷暂存/清理；
- 磁盘满：暂停，不删除用户文件；
- commit 后 Ledger 写失败：按 commit hash 对账补记；
- 发现历史重写需求：升级 General/用户；
- Engineer 幻觉完成：Completion Interlock 拒绝。

## Brainstorm Specs Handoff

`/brainstorm` 收敛后，General 创建 `SpecsMaintenanceOrder`。Engineer 是唯一常规写入者，必须把用户 Decision Records、Staff 建议、假设和验收标准映射进 specs，并在本地 `main` 生成 commit receipt。

Engineer 的 Agent Template Context Policy 必须保留当前 Git transaction、staged path allowlist 和 specs traceability。压缩不能发生在未结算的 Git commit 操作中。

## 0.3.0：Integration 与工兵边界

工兵可承担受控 Integration 角色，但只能通过 `MilitaryGit` 领域接口：

```text
read local main
→ verify expected HEAD/tree
→ apply accepted Candidate Patch
→ run global regression
→ update specs
→ local main commit
→ emit Integration/Specs Receipt
```

工兵不能自由选择 Candidate、修改验收结果或跳过冲突。冲突生成独立 Resolution Task；失败 Patch 不残留在 main。Git commit 成功而 Ledger 失败时，恢复扫描通过稳定 trailer/idempotency 补写 receipt，不重复 commit。
