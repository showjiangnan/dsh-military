# Military 控制中心、Flash 工作台与可访问性

## 1. 交付范围

`0.9.0-alpha.24` 保留并深化此前分散在 Settings、运行日志和设计文档中的 15 项产品能力，
收敛为两个 DSH RC.2 原生入口：

```text
Military 设置中心
知识与技能
```

两个入口共同占用一个 `sidebar.footer.action`，点击域、展开/收起几何、颜色、
焦点样式和 Modal 均继承 DSH Web。浏览器只提交浅层意图；模型目录、Prompt
编译、Workspace、SQLite、Git、权利、召回、评测和恢复的权威判断全部在 Host。

## 2. 十五项实现

### 2.1 角色目录与单角色编辑器

“Military-部门模型”包含 General 和 11 个内置部门角色。目录支持按名称搜索、
按部门和状态筛选，一次只挂载一个编辑器，避免把 12 套专业字段同时暴露给用户。
目录行显示 exact route、模型验证状态、草稿状态和 Flash 就绪摘要。

角色切换、一级选项卡切换和关闭弹窗都会检查未保存草稿。保存、放弃、恢复默认
是明确动作；中文输入法 composition 期间的 Enter、方向键或快捷键不会误触。

### 2.2 Host 编译的有效提示词预览

预览直接复用实际 Prompt Assembly 的六层编译器：

```text
可编辑角色指导
→ Host 身份与权限边界
→ 工具面与终态边界
→ Workspace 与路径边界
→ 证据与完成边界
→ 模型与运行预算
```

UI 展示每层是否可编辑、是否依赖运行时、token/简体中文字符估算及逐行 Diff。
前端不能提交“最终提示词”，也不能通过编辑角色正文删除 Host 层。

### 2.3 确定性 Flash 就绪检查

离线检查覆盖工具存在性、工具数量和 Schema 复杂度、Host 字段泄漏、路径猜测、
权限扩大、停止规则、终态歧义、receipt 规则、上下文和输出预算。问题包含稳定
code、级别、位置、简体中文解释和可执行修复建议。

检查不调用模型，不消耗额度；同一输入产生同一语义结论。`BLOCKED` 不能进入
生产启用，但系统不会因此静默切换 Pro 或扩大工具权限。

### 2.4 角色模拟与显式在线 Canary

“离线模拟”使用该角色真实 ToolProfile 和 Schema 验证工具发现、首次调用、
一次纠正、终态和父级 receipt，不调用 Provider。“在线 Canary”仅在用户点击并
输入 `RUN_SAFE_READ_ONLY_CANARY` 后执行，范围固定为只读安全探测。

结果记录 exact provider/model、原始工具选择、Host 归一化参数、Schema 结论、
tokens、可用时的费用和延迟。Canary 不自动晋升、不自动 fallback，也不写
Workspace。

### 2.5 事务化设置、冲突与可移植导入导出

模型、推理、预算和提示词形成一个带 revision 的角色草稿。Host 在一次事务中
校验 exact route、模型能力、提示词、简体中文审阅回执、预算和当前 revision；
任一字段失败不会留下部分保存。

外部更新和多标签页冲突提供字段级 Diff、采用外部版本、保留本地草稿和 rebase。
导出只包含可移植角色设置；凭据、绝对路径、Session、运行 receipt、SQLite
状态和 Provider 响应不在可表示类型中。导入必须先预览再提交。

### 2.6 Session 诊断时间线

“Military-安全与恢复”按真实 RC.2 Session event 和 Host observed receipt
投影模型请求、可见工具、原始选择、Schema、Host 补全、Grant、路径、执行、
终态和父级唤醒。角色、Task、工具、阶段和严重度过滤在 Host projection 上执行。

凭据、绝对路径和超长模型参数在 Host 端脱敏、截断；UI 不能推断完成、修改历史
或用模型文字替代 receipt。

### 2.7 受治理安全与恢复

健康快照覆盖 SQLite/WAL、备份、Preset generation、Bundle 版本、Mission、
Task、live child、worktree/lease、Grant、outbox 和终态 receipt。可执行动作：

```text
VERIFY_DATABASE
CREATE_BACKUP
RECONCILE
REQUEUE_STALE_OUTBOX
RELEASE_EXPIRED_RESOURCES
WAKE_PARENT
```

每个动作先生成影响范围、风险、`operationId` 和精确确认短语；执行时 Host 重新
计算预览并校验确认。结果以幂等 receipt 持久化，进程重启后重复请求返回原结果。
不存在原始 SQLite 编辑、手工标记完成或无证据删除。

### 2.8 不可变提示词历史与回滚

每次保存、导入、恢复默认和回滚都创建新 revision，保留来源、时间、语义 Diff、
完整 Flash readiness、简体中文审阅回执和当时的模型/预算。回滚不是覆盖旧记录。

Session 创建时固定角色 revision；后续 Settings 变化不重写 live Session。
历史页按 exact revision 汇总 Session、tokens、工具成功率、模拟和评测引用。

### 2.9 能力驱动的模型目录

下拉框由 DSH live `llm.models` 与 Military capability evidence 合并，状态统一为：

```text
VALIDATED
CANARY
UNVERIFIED
INCOMPATIBLE
UNAVAILABLE
DEPRECATED
```

目录显示 exact provider/model、reasoning、tool calling、上下文、输出上限、
输入模态、价格状态、alias 证据和状态 revision。当前 DSH live adapter 中的
所有路线都可选择；状态和绩效样本只提供 Evidence，不再充当可用性权限。只有
不在当前 DSH live 目录中的旧路线不可选择。轻量路线保持默认主力，Pro 只由
用户显式选择。

### 2.10 可理解的执行与成本

经济、标准、深度、自定义预算同时显示 output/context token、简体中文字符估算、
并发、历史 observed token、工具成功率和价格可用时的 USD 估算。Provider 未给
价格时显示“不可用”，不伪造费用。

预算预设只改变资源上限，不改变 ToolProfile、PermissionProfile、Verifier、
证据、终态、路径或安全规则。

### 2.11 Specs 工作区可视化

RC.2 没有供外部 Client 使用的原生目录选择 seam，因此浏览器不能提交绝对路径。
Host 从已绑定 Session 的权威 workspace 构建目录，Client 只回传不透明
`workspaceId`。

选中后展示 canonical root、root hash、Git HEAD/branch/tree、dirty/untracked、
allowed/read-only/forbidden/unscoped 路径、Task lease、worktree、Candidate、
integration、receipt 和真实角色路径示例。所有状态来自执行时使用的同一
canonicalization、Git 和 SQLite 链；未知 ID、symlink escape 和任意路径失败
关闭。

### 2.12 固定数据集评测工作台

固定数据集 `military-flash-core-v1` 由九个场景组成：

```text
只读分析
创建文件
编辑多个文件
Specs 原子事务
Schema 一次纠正
父级唤醒
路径拒绝与纠正
重复终态闩锁
重启恢复
```

dataset hash、Bundle/Preset、角色 revision、exact route、reasoning、
ToolProfile 和预算进入每次结果。确定性运行与真实 Provider Session 评估分栏，
指标包括首次命中、Schema 首次通过、纠正、完成、父唤醒、写 receipt、tokens
和延迟。Provider 样本以 dataset + Session + scenario 为计数权威，parser
revision 或重复解析不增加 N；相同 exact route/场景少于 10 个独立 Session，或
Wilson 区间宽度大于 0.35 时，只能显示 `INSUFFICIENT_SAMPLE`。

每个场景验证完整因果链，而不是仅验证首工具和 Session 结束：创建/编辑场景要求
Host receipt-bound path，多文件场景要求 distinct path，路径纠正要求最终安全相对
路径，父唤醒和重启恢复要求 bounded event sequence。`schemaFirstPass` 只表示首个
必需工具调用通过 JSON Schema，权限、路径和运行错误不得混入。

确定性治理门精确识别 General 的 Host 内建
`general-host-authority@0` sentinel；它不是可选 PermissionProfile。部门角色
仍必须使用正数 permission revision，伪造 General 权限名和部门 `@0` 都会失败
关闭。默认安装的九场景门因此既不误报 General，也不放宽部门治理。

### 2.13 简体中文提示词辅助检查

lint 只扫描自然语言，跳过 fenced code、inline code、路径、工具名、变量和
标识符。用户可以逐项应用、应用全部已选择建议、确认保留剩余项，并撤销上一批
转换；不会静默全文替换。

保存时 Client 只提交源文本、确认位置和“保留剩余”意图。Host 重新扫描、应用
精确位置、计算 source/result SHA-256 并生成不可变审阅回执；伪造位置、结果或
未确认的剩余问题被拒绝。插件自带 12 个提示词通过同一 lint。

### 2.14 知识透明度与模拟召回

Knowledge Center 展示 sanitized snapshot、redaction/injection receipt、
Chunk 边界和提取状态、Candidate/版本、审批者、晋升、Usage、继承来源和撤回
影响。原文和 Raw Vault reference 不进入浏览器 projection。

“模拟召回”接收任务文本和 state token budget，不创建 Task、不调用模型、不授予
工具。Host 使用真实 Task recall 的同一个标签匹配、生命周期、权利、租户、
排序、候选上限和投放 renderer，返回 exact Skill、rank、原因、排除原因及真正
会进入上下文的 applicability card。持久记录只保存输入 hash 和字符数，不保存
原始任务文本。

### 2.15 可访问性、i18n、浏览器与发行

两个 Modal、七个一级选项卡和角色目录分别采用正确的
`dialog/tablist/tab/tabpanel/listbox/option` 语义。支持方向键、Home/End、
Tab/Shift+Tab 焦点捕获、初始焦点、关闭后返回触发按钮、可见 focus、状态文字和
`aria-live`；Escape 与遮罩关闭仍由 DSH 原生 Modal 拥有。

CSS 覆盖 200% zoom、大字体、长 model ID、长路径、中文/英文标签、
`prefers-reduced-motion`、`prefers-contrast` 和 forced-colors。输入事件检查
`isComposing`，简体中文 IME 不会被快捷键截断。源代码、单文件规范、API、运维、
安全、评测、安装、升级、回滚、版本和发布报告由同一 release gate 校验。

## 3. Remote 边界

| Remote | 读取 | 写入 |
|---|---|---|
| `militaryControlPlane` | 角色、模型、预览、readiness、历史、指标 | 保存、恢复、回滚、模拟、显式 Canary、导入 |
| `militaryOperations` | 健康快照、诊断时间线、恢复 receipt | 预览并执行受治理恢复 |
| `militaryWorkspace` | Host workspace 目录 | 只按 `workspaceId` 读取状态 |
| `militaryBenchmark` | 固定数据集、运行、样本、稳定性 | 确定性运行、评估既有 Provider Session |
| `militaryPrivateSkills` | redacted operation/lineage/recall projection | 提炼治理、晋升、撤回、模拟召回 |
| `militaryEvaluationCenter` | durable Job、报告谱系、Dataset、Evidence、目录 | 取消/重试、申诉、重算 superseding Report |

所有 Remote 都使用窄 `snapshot/execute` 面；浏览器不能获得 SQLite handle、
credential、任意文件 API、Git 写权限或 Host 内部对象。

RC.2 Typert 在 Cordis service proxy receiver 上调用 Remote 方法。上述六个
Remote 因此禁止 ECMAScript `#private` 字段和方法：它们会在代理 receiver 上
触发 private-brand 错误。实现使用 TypeScript `private`（运行时普通成员），并由
静态回归门扫描全部 Remote 源文件；真实安装后的浏览器工作台还会逐页调用这些
边界，避免“直接单元测试通过、Profile UI 调用失败”的盲区。

## 4. 失败与恢复语义

- 冲突返回当前 revision 和字段 Diff，不做 last-write-wins；
- 路径错误保留 canonical rejection，拒绝不消耗 Grant；
- Provider/网络错误不改变模型 capability 状态，除非形成单独审计记录；
- 恢复动作先预览、再精确确认、后持久化 receipt；
- 恢复健康页分别显示运行 Bundle 与当前 content-addressed preset 指针；历史
  generation 的首归档版本不冒充当前 Bundle；
- SQLite projection 返回深冻结快照；基准运行、Provider 样本、恢复 receipt 和
  召回模拟在排序前复制数组，重复运行不会修改只读 projection；
- 模拟和确定性门不能冒充真实 Provider 通过；
- 断线后 UI 从 SQLite/Session facts 重建，不能靠组件本地状态补写成功。

## 5. 发布证据

源码门禁至少包括：

```bash
pnpm all:local
DSH_RC2_ROOT=/exact/built/deepseek-harness pnpm release:verify
```

自动回归覆盖 12 个默认简体中文提示词、Host prompt compiler、revision/回滚、
伪造简体中文回执拒绝、Workspace ID/path/Git rename、九场景 dataset hash、
Provider 去重与 N<10/宽区间稳定性禁止、绩效七视图、知识透明度、
真实/模拟召回同 renderer、RC.2 Web Profile 三次
启动和原生 Web Client 注册。

真实 DeepSeek Provider 仍是单独的部署验收：样本必须记录 exact route；模型
别名、网络和服务端行为可能变化，不能由本地确定性 PASS 推导。
