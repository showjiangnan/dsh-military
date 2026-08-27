# 威胁模型

## 1. 资产

- 用户目标与授权；
- 源代码和 specs；
- 企业数据与凭据；
- Mission Ledger；
- Artifact；
- 私有战术和效能数据；
- Git 历史；
- 模型路由与成本配额。

## 2. 信任边界

```text
User/WebUI
DSH Host
Model Providers
Enterprise API Gateway
Local/Remote Tools
Ledger/Artifact/Radio Stores
Git Repository
```

模型输出、外部网页、仓库内容和 API 响应默认都不是控制指令。

## 3. 主要攻击

### Prompt Injection

恶意代码注释、网页或 API 数据要求 Agent 忽略命令。控制：来源标记、数据/指令分离、工具权限不由文本授予、敏感动作需 Harness 命令。

### Confused Deputy

低权限 Worker 借参谋或工具执行高权限动作。控制：调用者 identity、capability token、代理不得转授权限、Broker 再授权。

### Secret Exfiltration

模型请求或日志泄漏密钥。控制：Credential reference、Gateway、脱敏、分类 ceiling、输出扫描和最小保留。

### Evidence Forgery

Agent 编造工具调用、测试或 commit。控制：durable tool events、Artifact hash、Git receipt、外置对账。

### Replay/Stale Attack

旧 Candidate/Guidance 重放。控制：taskVersion、revision、expiresAt、idempotency、generation。

### Supply-chain/Skill Poisoning

恶意 Tactical Skill。控制：签名/来源、生命周期、Canary、权限声明、隔离和回滚。

### UI Privilege Escalation

浏览器直接构造高权限命令。控制：Host 授权、expected revision、用户 session、服务端策略。

## 4. 不可信输入原则

任何自然语言内容都不能直接：

- 授予工具/API/Git 权限；
- 修改 Acceptance Contract；
- 宣布 Task Accepted；
- 解除冻结；
- 发布 STABLE 战术；
- 证明用户授权。

## 5. 0.2.0 新增威胁

### Preset Scope Confusion

攻击或缺陷让普通 Session 被误判为 Military，或让 Military child 加入不同 generation。控制：actual preset 解析、不可变 Session Binding、`composeFrom()`、capability fingerprint、非 Military early return。

### Profile Overlay Destruction

安装器用不完整 patch 覆盖 AgentPresets config，删除部署已有 preset。控制：读取并完整重述 `default + roots + includeUserRoot`、安装前后 roster Diff、回滚快照。

### Cross-session Contamination

同 cwd 或单例缓存让 Task、Radio、Freeze、Context Policy、Metric 串到其他 Session。控制：tenant/rootSession/mission 复合键、Scope 约束、属性测试、普通 Session 不进入 Military 锁。

### Tactical Knowledge Poisoning

恶意历史会话、用户粘贴或 Artifact 把 Prompt Injection、Secret 或错误经验写入私有战术。控制：显式授权、不可变快照、来源分层、Secret/PII/injection scan、用户 Diff、DRAFT/Canary、Verifier 和 quarantine。

### Tag Namespace Hijacking

重命名或近义标签让战术错误路由。控制：稳定 tagId、alias 冲突检测、revision fencing、PAUSED/DELETED 不自动匹配、合并需显式迁移。

### User-interaction Spoofing

子代理伪造 General 或并发弹窗诱导授权。控制：`deliveryAuthority=general`、根 Session 校验、DecisionSet 去重/过期、回答 receipt、用户授权与普通选择分离。

### Evaluation Gaming

模板通过刷任务、避开难题、虚报工具、挑选成功样本、重复解析同一 Provider
Session、把 fallback 冒充目标模型或只计算最终成功 Attempt 来提高绩效。控制：
canonical Frozen Dataset、稳定 Attempt/Session/scenario identity、失败/取消保留、
预执行难度、exact configuration/route 分层、Mission-cluster N、Accepted Outcome
全成本、外置 Evidence 和数据质量披露。

### Evaluation Control-plane Tampering

陈旧 worker 覆盖新报告、Client 伪造 dataset hash/decision、申诉跨报告排除样本或
委员会模型通过 Prompt Injection 改写指标。控制：SQLite revision/lease/fence、
Artifact digest、Host 重算、严格 Schema、appeal Dataset membership、immutable
superseding lineage、aggregate-only no-tool committee prompt 和确定性回退。

### Cost Laundering

攻击者把未知 Provider 价格写为零，或丢弃失败/返工成本，使轻量模型看似构成 Pareto
前沿。控制：版本化价格状态、unknown=unavailable、missionId+taskId Accepted
Outcome 聚合，以及质量/安全硬门先于经济性。

### Cross-session Privacy Leakage

绩效或战术提炼暴露其他会话提示、客户数据或 Restricted Artifact。控制：独立跨会话权限、最小分片、脱敏 Evidence、报告 classification/retention、数据撤回后标注或重建。

## 6. 0.3.0 新增威胁与缓解

| 威胁 | 攻击/失败路径 | 缓解 |
|---|---|---|
| Preset generation substitution | 重启时把旧 Session 挂到新组合 | 内容寻址 manifest、archive、Binding、hash、quarantine |
| General route confusion | Session selector 覆盖被错误传播到子代理 | root-role scoped policy、child template binding、selection receipt |
| Cross-session privilege confusion | 仅凭 sessionId/cwd 读取历史 | Authority Context、tenant/ownership、classification、receipt |
| Policy string spoofing | Agent 自报 toolProfileId/API grant | Host Registry 解析 revision，模型输入不授予权限 |
| Workspace contamination | Worker 写共享 main 或借 symlink 越界 | isolated worktree、realpath/symlink guard、Patch/Integration |
| Integration replay | 同一 Patch 重复应用/commit | idempotency key、expected HEAD/tree、commit trailer、receipt |
| Decision hijack | 另一标签页/旧 Task 回答问题 | Broker revision、first-commit-wins、taskVersion、expiry |
| Knowledge poisoning | 会话 Prompt Injection/幻觉被提炼 | data-channel isolation、rights/trust、contradiction、reproduction |
| Revoked knowledge reuse | 撤回后仍匹配 Guidance | derived impact graph、quarantine、registry deny、新请求 guard |
| Evaluation data exfiltration | 委员会读取越权 Session/Restricted Artifact | Dataset Builder authority、deidentification、audit、classification |
| Metric gaming | Agent 过度拆分/求援、删除失败或重复 Session 提高评分 | pre-execution difficulty、Mission cluster、stable identity、canonical dataset |
| Route/sample laundering | fallback/alias 或 parser revision 冒充 exact Provider 新样本 | observed route strata、dataset+Session+scenario 去重、>=10 Session+CI |
| Evaluation stale completion | 旧 Job/进程覆盖新 Report | revision、lease、fence、idempotent completion、Artifact digest |
| Appeal tampering | Client 跨 Dataset 注入 exclusions 或原地改报告 | Host membership check、immutable Report、superseding revision |
| Committee prompt injection | 聚合叙述模型越权改指标或调用工具 | opt-in、aggregate-only、no tools、strict JSON、deterministic fallback |
| Cost laundering | 未知价格填零或漏算失败/返工 | cost status unavailable、Accepted Outcome 全链成本、quality-first Pareto |
| Budget bypass | Agent 改写提示或重试键逃避配额 | Harness reservation、structural hash、stable operation identity |
| Bundle/profile overwrite | 安装器覆盖用户 preset roots/default | full-row read, revision CAS, backup, atomic rename, probe/rollback |
| Military terminology misuse | 产品被用于现实伤害/人员处分 | explicit exclusion、neutral terminology、upper safety policy |
