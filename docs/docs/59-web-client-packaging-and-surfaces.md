# 59. RC.2 Web Client 打包与页面能力

## 1. 动态包 Manifest

Military WebUI 是动态 Client 包。`package.json` 必须声明：

- `dsh.client.inject`：需要同时装载的插件包；
- `dsh.client.external`：仅非 baseline、需要共享运行时身份的 value import；
- Cordis 和 DSH peers 在 `peerDependencies` 与 `devDependencies` 使用匹配版本；
-已发布 `files` 覆盖所有 JS、d.ts、map 和 CSS 资产。

React、Cordis 和 Client Runtime 不重复写入 `external`。直接 value-import 的
官方 primitive 必须进入 `dsh.client.inject`，由 RC.2 Loader 提供同一模块与
React/theme identity；Military 当前显式注入
`@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`。
type-only import 不形成模块请求。

## 2. Browser Artifact

动态 Browser 产物仍以 module-loader factory 交付：

```js
window.__ModuleLoader__.load({ id: '@dsh-military/webui', factory: require => { ... } })
```

构建门禁检查请求的 external/inject 有供应者、无同步环、无未声明 workspace
value import。Military 的布局 CSS 以 text loader 内联进同一个 `client.cjs`，
运行时只安装一个带稳定 `data-plugin-css` 标识的 style，不另发主题资产。
原生 primitive 的 CSS-module class 始终拥有视觉优先级；raw HTML control
fallback 必须包在零 specificity 的 `:where(...)` 中，不能用 scoped
`:not([data-*])` selector 覆盖原生 radius、padding 或 active fill。
Military 不使用 `staticLinked()`，除非未来被正式纳入 DSH Web Shell。

## 3. Settings Shared Mirror

RC.2 `ui-settings` 拥有唯一 `settings.describe` mirror，并监听 document update 与 connection reset。Military 每个 namespace 只调用 `ctx.settingsScope.bind()` 派生 Scope，不自行调用 describe 或建立重复 invalidation listener。

## 4. 运行态投影边界

RC.2 没有外部 required Session Event 注册面。0.9.0-alpha.24 因而不注册
Military Conversation Node，也不把 Mission/Task/Radio/Freeze/Candidate 写入
DSH Session Log。Settings 基础字段读取 RC.2 shared mirror；角色治理、诊断/
恢复、Workspace、固定评测和私有知识通过插件自有窄 Typert
`snapshot/execute` Remote 读取 Host projection。

后续运行态页面必须新增 Military 自有 Host Remote/Projection：

- 以 `tenantId + missionId` 查询 Mission read model；
- 使用稳定业务 ID 和 revision 增量更新；
- 浏览器不直连 SQLite；
- DSH Session 只承载模型可见 `user/message` 和上游已知事件；
- 可选 Conversation renderer 只消费插件自有投影，不把 Session Log 变成第二个 Mission 真源。

## 5. 已实现页面

- 一个 `sidebar.footer.action` occupant 纵向承载“Military 设置中心”和
  “知识与技能”两个独立入口；二者与 DSH Settings 共用 42px 展开行、36px
  收起圆形点击域及相同 margin/padding/radius/hover 合同，不会在 RC.2 的
  横向 list seat 中挤出侧栏；`shell.overlay` 分别挂载两个原生 Headless
  Modal；
- 左侧固定七个 Military 一级选项卡，不再注册 `settings.section`；
- General 和 11 个部门模板的 DSH 模型目录下拉框；
- 模型、推理、输出、上下文、并发、压缩与模板生命周期表单；
- General 和 11 个部门的简体中文自带提示词、可视化编辑、逐角色恢复和全量
  恢复；Host 不可编辑边界在实际 Prompt Assembly 中强制追加；
- 可搜索角色目录、单角色编辑、未保存草稿保护、六层有效提示词、字段 Diff、
  immutable revision/回滚和安全导入导出；
- 确定性 Flash readiness、实际 ToolProfile 离线模拟、显式只读在线 Canary、
  经济/标准/深度预算及模型目录能力/价格证据；
- 自然语言简体中文辅助检查、逐项/批量确认、单批撤销和 Host hash-bound
  审阅回执；
- Execution/Staff/Tag/Tactic/Oversight/Specs/Memory/Evaluation/Presentation
  七分区可视化界面；
- Session 诊断时间线与先预览/精确确认/幂等 receipt 的安全恢复操作；
- 仅按 Host `workspaceId` 选择的 Specs 工作区，包含 canonical/Git/path/lease/
  integration 状态；
- 固定九场景评测、dataset hash、deterministic/Provider 分栏、exact route
  样本与 N<5 稳定性限制；
- Knowledge Center 七视图，包含 sanitized pipeline/lineage 和与真实 recall
  共用 resolver/renderer 的无 Task 模拟召回；
- Host 保存确认、字段级恢复默认、模板 revision 串行写入；
- RC.2 shared settings mirror；
- 正确的 dialog/tab/listbox ARIA、方向键/Home/End、IME 保护、焦点捕获/返回、
  zoom/长文本/forced-colors/contrast/reduced-motion 合同；
- lazy module-loader artifact 和 manifest/peer-dev 门禁。

Mission Dashboard、Radio Inbox、Freeze 控制台、专用 Candidate/Integration
详情、绩效申诉和自定义 Advisor 向导属于后续 Web 里程碑，不在当前实现报告中
标记为完成。

## 6. 安全

Browser 不获得 SQLite handle、credential、Raw Vault reference、任意文件 API
或 base64 图片。Workspace absolute root 只作为 Host 投影显示，不能作为选择
输入回传；Secret、模型参数和诊断路径先在 Host 脱敏，图片只显示 Attachment
reference 和经过授权的缩略图。
