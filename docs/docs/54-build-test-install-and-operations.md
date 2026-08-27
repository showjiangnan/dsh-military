# 54. 构建、测试、安装与运行

## 1. 环境

```text
Node.js ^22.19.0 或 >=24
pnpm workspace
Git 2.x
Python 3（文档生成和校验）
DSH 0.1.1-rc.2（实际安装/运行时）
```

RC.2 peer 版本：

```text
@deepseek-ai/cordis ^4.0.1
@deepseek-ai/schemastery ^3.18.1
@deepseek-ai/dsh-* 0.1.1-rc.2
```

## 2. 门禁命令

```bash
pnpm generate
pnpm typecheck
pnpm build
pnpm test
pnpm review
pnpm validate
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

`pnpm all:local` 执行本地门禁；`pnpm release:verify` 再执行精确上游编译、
pack/publint、空 Profile 安装、Loader 激活、重启 E2E 和发行校验。任一步失败
都不得把 release 标记为通过。

## 3. 测试层次

| 层次 | 当前实现 |
|---|---|
| 领域单元 | Ledger、CAS、状态机、Decision Broker、Radio、Budget、Template、Tag |
| 持久化 | SQLite migration、Command Saga、Outbox、Workspace/Execution state、重启与 CAS |
| 文件/Git | specs 初始化、local `main`、worktree、Patch、Integration |
| 组合静态 | preset 隔离、Host model-silent、Web lazy bundle |
| 合同 | TypeScript、Schema、Event/Error Catalog、generation hash |
| 控制中心 | Desired/Applied 角色 revision、Runtime hierarchy、诊断/恢复、Workspace、固定基准 |
| 知识 | sanitized pipeline、lineage、shared recall resolver/renderer、撤回 |
| Web 可访问性 | tabs/listbox/dialog、focus trap/return、IME、zoom/contrast/overflow |
| 生产控制 | provider topology、queue order、capacity/backpressure、telemetry、signed backup/restore |
| 真实 RC.2 E2E | 从 tarball 安装；官方 Loader 三次启动；纵向流程与恢复 PASS |

每次测试生成 `TEST-REPORT.md` 和 `TEST-REPORT.json`，保留测试文件、通过/失败数量、Node 版本、RC.2 commit 和运行边界。

## 4. preset 安装

固定 preset 默认安装到：

```text
$DSH_HOME/.agent-presets/military/
```

命令：

```bash
pnpm --dir "$DSH_HOME/profiles/web" exec \
  dsh-military-install install --dsh-home "$DSH_HOME"
pnpm --dir "$DSH_HOME/profiles/web" exec \
  dsh-military-install verify --dsh-home "$DSH_HOME"
```

安装器：

- 不改变部署默认 preset；
- 不覆盖不同内容，除非显式 `--force`；
- 使用临时目录和原子 rename；
- 安装 `preset.yml`、`agent.cordis.yml` 和 generation manifest；
- 验证所有文件 SHA-256；
- 不写远端 Git。

若使用 system preset root，必须把完整现有 `agent-presets` row 读出后重写，保留 `default`、全部 roots 和 `includeUserRoot`。DSH patch 替换完整 config，不能假设深合并。

## 5. Bundle 组合

Host profile 通过发行 tarball 叠加：

```bash
dsh plugin --profile web add \
  ./dsh-military-bundle-0.9.0-alpha.25.tgz
```

Bundle 自包含全部私有运行时 package、Installer 与
`dsh-military-install` 命令。标准安装只添加 Bundle；独立 Installer tarball
仅供 preset-only 生命周期使用，应通过普通 `pnpm add` 安装，不能作为 Bundle
layer 添加。两类 RC.2 platform peer 都由 Profile fallback 提供单例，manifest
保留精确 peer 版本并将它们标记为 package-manager-optional，安装后必须通过
`pnpm peers check`。
模型工具、persona、General model default、`/brainstorm` 和 agent-plane hooks
只在 `military/agent.cordis.yml` 中注册。Host plane 本身保持 model-silent。

## 6. 首次启动

建议顺序：

1. 备份 `$DSH_HOME`；
2. 安装源码构建包或发布包；
3. 安装/验证 `military` preset；
4. 叠加 Bundle；
5. 执行 `dsh --profile web --dump-config`；
6. 启动 Web；
7. 新建空白会话并显式选择 `military`；
8. 验证 General 默认模型；
9. 切换 General 模型，确认子 Agent 模板不改变；
10. 打开 Military 设置中心，检查 12 角色、七个选项卡和工作区/恢复/评测；
11. 打开知识与技能，检查七视图、透明度和模拟召回；
12. 执行 `/brainstorm` 和最小 Candidate 验收场景。
13. 打开 Military Session 运行中心，核对 Request→Integration parent link 与
    source revision/staleness。

## 7. 数据目录

默认 Host 数据位于：

```text
$DSH_HOME/military/
├── military.sqlite
├── artifacts/
├── preset-generations/
└── workspace-state/worktrees/
```

企业部署应使用受限属主权限、备份、磁盘配额和数据保留策略。SQLite 使用 WAL、外键和 busy timeout；Artifact 写入采用内容哈希和原子落盘。

## 8. 停止与恢复

Host 关闭时：

- 取消并 dispose 自身拥有的 department Agent handle；
- 在 `finally` 中释放对应 Workspace lease/worktree；
- 清理内存身份目录；
- 关闭 SQLite；
- 保留 Mission/Admin Ledger、Artifact、generation archive 和报告。

恢复旧根 Session 时，RC.2 公共 preset seam 只能按 preset ID 重挂载。若历史 generation 不等于当前且无法通过公共 seam 精确重绑，系统进入 `QUARANTINED`，不得静默继续。

## 9. 发布产物

```bash
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

`release/` 输出自包含 Bundle/Installer tarball、`checksums.sha256`、安装/升级/
回滚说明、版本、Profile 与 E2E 报告。构建使用固定
`SOURCE_DATE_EPOCH`，并比较两次独立 `npm pack` 的 SHA-256。

安装后浏览器矩阵至少验证：展开/收起侧栏点击域、三个 Modal、七个一级
选项卡、角色 listbox 键盘路径、焦点捕获/返回、简体中文 IME、200% zoom、
长 model ID/path、forced-colors/high-contrast CSS、Workspace opaque ID、
deterministic benchmark 和无 Task 模拟召回。浏览器检查不能替代 Host/SQLite/
Git 自动测试，自动测试也不能替代真实 Provider 统计样本。

真实 Flash evidence 由绩效页导出后单独执行：

```bash
npm run acceptance:flash -- \
  --evidence /absolute/path/provider-acceptance.json \
  --route provider/exact-flash-model
```

每个场景必须有 50 个独立 exact-route Session 并通过 Wilson/零安全失败门。
此命令不发起 Provider 请求，也不属于无凭据的源码门；没有证据时准确失败。
