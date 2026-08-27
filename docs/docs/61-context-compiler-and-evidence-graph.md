# 61. Context Compiler、Claim–Evidence Graph 与分层验收

## 1. Context Compiler

每次模型请求前，系统编译四类上下文：

```text
Constitution：用户硬约束、Mission Intent、权限、Acceptance
State：当前 Direction/Wave/Task、revision、lease、budget、blocker
Evidence：当前 Task 需要的 Artifact、Diff、测试、Receipt、Guidance
Working：可压缩的尝试、假设和自由讨论
```

输出 `ContextManifest`，至少记录 Mission revision、Task version、内容 hash、输入 Event、Evidence 引用、被省略引用、摘要覆盖范围和各类 Token 配额。 每份 Manifest 必须在请求前持久化为内容寻址 Artifact，并以 `context/manifest-created` Administrative Event 记录 `manifestId`、ArtifactRef、Mission、Task、Agent 和时间。内存注入只是消费视图，Artifact 与 Admin Ledger 才是审计和重放依据。

## 2. RC.2 推理历史预算

DeepSeek RC.2 会把每个带 reasoning 的 Assistant Turn 的 `reasoning_content` 回传到后续请求。因此 Context Compiler 必须使用真实 request usage 动态校准，不能按 RC.7 的工具回合限定规则估算。压缩阈值使用有效输入、reasoning passback、图片占位和 cache-read 指标。

## 3. 图片证据

RC.2 支持配置为 `inputModalities: [text, image]` 的 DeepSeek 模型。Mission Ledger 只保存 Attachment/Artifact 引用和分类，不保存 base64。Router 必须在投递前验证模型图像能力、图片预算、数据驻留和 redaction policy。

## 4. Claim–Evidence Graph

Acceptance Contract 由 Claim 组成。Candidate 只有在每个必需 Claim 都存在当前有效 Evidence 时才可接受。

```text
Claim
├── Evidence requirement
├── Evidence links
├── validity scope
├── produced-at revision
└── revocation/expiry
```

Evidence 可以是 Artifact、Event、Tool Call、Git Commit、API Receipt 或 Human Authorization。

## 5. Verification Tier

- V0：Schema、版本、ID、Artifact hash；
- V1：类型、Lint、依赖和静态安全；
- V2：单元、组件和工具模拟；
- V3：真实 Workspace、Git、数据库、浏览器和 API；
- V4：需求满足度、架构与可维护性语义评审。

V4 不得成为唯一接受依据。任何 `ACCEPTED` 至少要有一项独立 V0–V3 Evidence。

## 6. Verifier 质量

系统持续记录 false accept、false reject、flakiness、coverage、runtime 和版本。Verifier Profile 变更必须产生新 revision，历史 Receipt 不追溯重解释。
