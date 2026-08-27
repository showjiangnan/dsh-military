# WebUI 交互、冲突、恢复与可访问性规范

## 1. 目标

WebUI 不只是展示军事组织名词，而是所有高风险管理动作的可验证控制面。界面必须准确表达“当前会话的事实、暂存选择、运行时状态和待提交修改”，并在并发编辑、重启、冻结、版本冲突和数据不足时给出可恢复路径。

## 1.1 实施状态

`0.9.0-alpha.25` 已实现独立 Settings/Knowledge Modal、七个一级选项卡、角色
工作台、revision 冲突、字段 Diff、可移植导入导出、诊断与恢复、Specs
Workspace、固定基准、知识供应链透明度、模拟召回和键盘/IME/高对比度合同。
这些页面读取 Military 自有 Remote/Projection，不依赖未知外部 Session Event。

仍未实现的是 Mission Dashboard、Freeze/Radio/Integration Conversation Node、
绩效申诉和自定义 Advisor 向导；本章涉及这些对象的段落继续作为 Beta/Production
目标，而不是当前完成声明。

## 2. 新建会话与 preset

新建会话页在 Workspace 选择旁显示 preset chip：

```text
标准模式 | Code | Minimal | Military 模式
```

选择 `military` 只暂存到下一个空白会话。会话产生首个模型可见输入或工具事实后：

- preset chip 不再可编辑；
- 标题显示只读 `Military 模式` 标签；
- 尝试切换返回 `agent-preset-locked`；
- UI 不提供“稍后生效”的误导队列。

若 preset 损坏、RC.2 probe 失败或 generation archive 缺失，该选项禁用并显示结构化原因。

## 3. General 模型选择

Military 会话默认使用 preset 内的 General model。会话模型选择器显示：

- 当前 provider/model；
- 来源：`MILITARY_PRESET_DEFAULT` 或 `USER_SESSION_OVERRIDE`；
- reasoning 解析值；
- 上下文窗口和 max output；
- 数据驻留与企业 API 兼容性；
- 预计影响的后续 General 请求。

用户切换只影响 General 的后续请求，不改变：

- actual preset；
- 已有 Session 历史；
- 运行中子代理；
- 已冻结的 Department Template revision。

所有 DSH live exact route 默认可选；reasoning 名称由 adapter 翻译。目录缺失
或 adapter 最终拒绝时保持旧路由，展示具体原因，不回退到未知默认模型。

## 4. 设置编辑与 revision fencing

每张设置卡读取：

```text
resolved value
base value
user overrides
revision
```

保存必须携带 expected revision。冲突时提供：

- 我的修改；
- 当前服务器版本；
- 字段级 Diff；
- 重新加载；
- 复制为新 revision；
- 有权限时重新应用。

Secret 字段永不回显，只显示 credential reference 和最后验证状态。

## 5. 长任务 UI

Tactical ingestion、Evaluation、Museum research、install/upgrade 等长任务具有：

```text
QUEUED
RUNNING
WAITING_FOR_USER
PAUSED
CANCELLING
CANCELLED
FAILED
COMPLETED
```

进度来自 durable event/projector，而不是浏览器本地计时。刷新或换标签页后继续显示同一 Job；取消是请求状态，直到 Harness 确认才显示 Cancelled。

## 6. 用户问题

Decision Broker 保证一个根 General 的有序问题流。弹窗展示：

- 问题来源部门和 Task；
- 为什么必须由用户决定；
- 推荐项与依据；
- 每个选项的后果；
- 是否允许自定义；
- 有效期和默认处置。

多个标签页中只有第一个成功提交的 revision 生效；其他标签页收到“已由另一客户端回答”并刷新结果。

## 7. Freeze 与异常

Freeze 节点必须区分：

```text
确定性命中事实
Inspector 模型解释
Staff 修正建议
Harness 当前权威状态
```

操作包括查看 Evidence、批准释放、重新派发、终止 Task、导出事故包。不得让“继续”按钮绕过未满足的 release contract。

## 8. Preset generation 不兼容

恢复旧 Session 时出现：

- `MATCHED`：正常；
- `ARCHIVE_REBOUND`：仅在同进程旧 standing scope 或部署显式支持 archive resolver 时显示；
- archived-only 根 Session 在进程重启后：显示 `QUARANTINED/MIGRATION_REQUIRED`，不得把 archive 存在误报为可直接恢复；
- `QUARANTINED`：只读展示，提供安装旧资产、迁移、导出三种路径；
- `MIGRATION_REQUIRED`：展示兼容性差异和 Migration Order。

界面不能把旧 Session 默默挂到 current generation。

## 9. Workspace 与 Integration

已实现的 Specs 工作区面板只接受 Host 目录中的不透明 `workspaceId`，显示：

- canonical root/hash 和 Git HEAD/branch/tree；
- dirty、untracked 和按授权分类的路径树；
- read/write lease、worktree 和角色路径示例；
- Candidate、Integration order/receipt 及外部 drift。

RC.2 没有可由外部 Client 调用的原生目录选择 seam；UI 因而不能提交浏览器输入
的绝对路径。未来 Candidate 详情页再扩展冲突文件、验证证据和最终 local
`main` commit receipt。

普通 Session 的外部修改只显示为环境 drift，不被 Military 冻结。

## 10. 战术提炼

当前 Knowledge Center 在用户批准前展示：

- 来源权利与分类；
- 被提炼段落；
- Secret/PII/Injection 扫描；
- 新增或补充 Diff；
- 标签匹配依据；
- 矛盾和版本限制；
- 发布范围和 lifecycle。

Snapshot、Chunk、extraction、Candidate、review、version、promotion、Usage、
继承来源和撤回通过 Host lineage 串联；Raw Vault reference 和原文不进入
浏览器。撤回来源时显示派生影响和待重新验证对象。

“模拟召回”不创建 Task、不调用模型，使用真实 Task recall 的同一标签、权利、
租户、生命周期、排序、候选上限、token budget 和 renderer，显示 exact Skill、
rank、匹配/排除原因和最终投放片段。

## 11. 绩效报告

当前固定基准页首先展示 `military-flash-core-v1`、dataset hash、九个场景和
deterministic/Provider 两类结果。真实样本固定 exact route、role revision、
reasoning、ToolProfile 和预算；N<10 或区间过宽不形成观察趋势的稳定结论，
发布 acceptance 仍要求每个 exact configuration × scenario N≥50。支持：

- 运行全部确定性场景；
- 从既有真实 Session 生成 Provider 观察；
- 查看首次命中、Schema、纠正、完成、写 receipt、父唤醒、tokens 和延迟；
- 按 exact route/场景查看样本量、通过率和稳定性；
- 导出 Host-assessed evidence，并显示逐场景 N≥50、首次工具/E2E Wilson 门和
  四类零安全失败的发行 acceptance。

完整委员会报告的难度校正、可选叙事评委、导出、申诉和 superseding revision
由绩效七视图提供。样本不足时不显示“稳定”、外部 acceptance 或模型晋升结论。

## 12. 可访问性与规模

- 三个弹窗具有初始焦点、Tab/Shift+Tab 捕获和关闭后焦点返回；
- 七个一级选项卡使用 `tablist/tab/tabpanel`，支持方向键和 Home/End；
- 角色目录使用 `listbox/option` 与 roving focus；
- 简体中文 IME composition 期间不执行快捷键；
- 所有 chip、表格、图和弹窗支持键盘；
- 状态不只靠颜色表达；
- 屏幕阅读器能读取任务、冻结和预算变化；
- 高频 Event 使用增量投影和节流；
- 大型 Roster/DAG 使用虚拟列表；
- Mermaid/图形同时提供文本表；
- 中文军事称谓可切换为中性称谓；
- 时间显示本地时区并可查看 UTC 原值；
- 200% zoom、大字体、长 model ID、forced-colors、`prefers-contrast` 和
  reduced-motion 不产生水平页面溢出或隐藏动作。

## 13. 失败文案原则

错误必须包含：

```text
发生了什么
哪个权威对象未改变
可执行恢复动作
证据/错误码
是否需要用户授权
```

禁止只显示“失败，请重试”。重试前必须说明是否幂等、是否已有部分副作用。

## 14. E2E 场景

至少覆盖：

- Military preset 选择和锁定；
- General 模型成功/失败切换；
- 两个标签页角色 revision 冲突；
- 角色目录搜索/键盘、未保存草稿保护和简体中文 IME；
- 六层 Prompt 预览、readiness、离线模拟和显式 Canary；
- Host workspace 选择、长路径、Git dirty/untracked 和未知 ID 拒绝；
- 恢复预览、错误确认短语和幂等 receipt；
- 固定九场景、Provider 趋势 N<10 保护及发行 N<50/Wilson/安全失败拒绝；
- sanitized 知识透明度和真实/模拟 recall 同结果；
- 问题被另一标签页回答；
- 浏览器刷新后长任务恢复；
- Generation quarantine；
- Freeze/Release；
- Integration conflict；
- 战术 Diff 审批和撤回；
- 绩效数据不足和申诉；
- 中性术语切换；
- 200% zoom、高对比度、键盘和屏幕阅读器基本路径。

## 15. 验收条件

- UI 状态均可从 durable facts 重建；
- 用户不会把暂存选择误认为已生效；
- 并发写不会静默覆盖；
- 高风险操作显示权限、范围和副作用；
- 刷新/断线不丢失 Job；
- 可访问性路径与鼠标路径功能等价；
- 普通 Session 页面不出现 Military 运行控件。
