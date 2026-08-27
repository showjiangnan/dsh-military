# 实施就绪矩阵

## 当前结论

`0.9.0-alpha.24` 已完成 RC.2 源码与发行闭环：精确上游声明编译、13 个 package
合同、干净 Profile 安装、Loader/Preset/Web Client 激活、Mission 纵向流程、
持久化恢复、语义审查和可重复 tarball 均进入默认发布门禁。

## 能力状态

| 领域 | 状态 | 主要证据 |
|---|---|---|
| 固定 `military` Preset 与隔离 | Ready | `docs/32`、RC.2 Profile E2E |
| General 路由与不可变子代理绑定 | Ready | `docs/43`、AgentExecutionBinding |
| Flash 轻量主力与阶段化工具合同 | Ready（确定性门） | Flash contract、phase visibility、Task compiler tests |
| 子代理 report、父 General 自动恢复与取消抑制 | Ready | `c21-session-regression`、RC.2 Profile E2E |
| 终态领域 receipt、同轮闩锁与崩溃重试 | Ready | terminal parent receipt、Specs retry、tool pipeline tests |
| Mission/Task 原子命令与幂等 | Ready | SQLite UoW、fault/restart tests |
| 关键运行态持久化与重放 | Ready | durable repositories、recovery tests |
| Authority、Grant、Task Budget | Ready | step/tool/radio/wall-clock/output admission and settlement tests |
| Worker Workspace 与受控 Integration | Ready | worktree、evidence、Git reconciliation |
| Engineer 浅层 Specs 合同与精确 Git 路径 | Ready | Host compiler、atomic Specs、untracked-file tests |
| Decision Broker、Radio、Oversight | Ready | durable state、outbox、identity tests |
| RC.2 Compatibility Probe | Ready | `docs/45`、`reference/dsh-rc2/` |
| Bundle/Installer npm 闭包 | Ready | clean Profile install、tarball inspection |
| 角色工作台、模型目录、预算与提示词历史 | Ready | Host control plane、六层 Prompt、revision/rollback、catalog/cost tests |
| Flash readiness、离线模拟与显式 Canary | Ready（确定性门） | actual ToolProfile/Schema、safe read-only confirmation、simulation receipts |
| 简体中文提示词辅助检查 | Ready | 12 个默认 prompt、code/path/identifier skip、Host hash-bound receipt |
| Session 诊断与安全恢复 | Ready | immutable timeline、Host redaction、preview/confirmation/idempotent receipts |
| Specs 工作区可视化 | Ready | opaque workspace ID、canonical/Git/lease/integration、path rejection tests |
| 固定九场景评测工作台 | Ready（确定性门） | dataset hash、deterministic run、Provider assessment、N<5 protection |
| 私有 Skill 供应链、透明度与模拟召回 | Ready（确定性门） | SQLite restart/race、sanitized lineage、shared resolver/renderer |
| Web 可访问性与 i18n 合同 | Ready（源码门） | ARIA tabs/listbox/dialog、focus trap/return、IME、contrast/zoom CSS |
| 发行可重复性 | Ready | two-pack SHA-256 equality、manifest/checksums |
| 运行视图扩展 | Alpha boundary | 读取插件自有 Remote/Projection；不伪造 DSH 私有事件 |

## 默认发布门禁

```bash
pnpm install --frozen-lockfile
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

门禁依次覆盖生成物、strict typecheck、RC.2 合同快照、构建、148 项自动测试、
Mission fault/restart regression、semantic audit、静态 review、文档工程、精确
上游声明编译、13/13 pack/publint、Bundle/Installer 两次打包一致性、空 DSH
Home 安装、真实 Loader 激活和三次 Profile 启动 E2E。

确定性 E2E 使用受控进程内 LLM adapter，从而不依赖秘密或网络且能稳定验证真实
RC.2 Agent/Session/Subagent/Tool 流程。以下仍属于部署验收，而不是源码发布
阻断项：

- 外部 DeepSeek Provider 凭据、网络、配额与服务端 usage 准确性；
- 修复后 Flash General/Worker/Engineer 的真实 Provider 统计样本与
  `CANARY → VALIDATED` 晋升；
- Safari 等未纳入本机发布矩阵的浏览器兼容性；
- 非 macOS 平台的 shell、文件系统和 Git 行为；
- 生产容量、SLO、灾难恢复演练和组织级安全审计。

这些边界不得被描述成已验证，也不否定当前 release artifact 在固定 RC.2 基线
上的可安装、可启动、可恢复结论。
