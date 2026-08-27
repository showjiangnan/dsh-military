# 56. RC.2 已知限制与迁移边界

## 1. 支持范围

`0.9.0-alpha.24` 只对 `dsh@0.1.1-rc.2` commit `b150a551...` 声明完整支持。旧版部署必须使用其匹配的发布包，不允许两个 DSH runtime identity 在一个进程混装。

## 2. Preset generation

RC.2 仍只在 Session Header 持久化 preset ID。旧根 generation 仅在当前进程 standing mount 或 Bundle 自有 archive resolver 可精确恢复时继续；否则 `QUARANTINED → PresetMigrationOrder`。不得静默挂 current generation。


## 2.1 外部 Session Event

RC.2 的持久化读取会拒绝未知且未标记 `ignorable` 的事件，而第三方插件没有公开 required-event 注册面，也不能通过 `Session.append()` 任意设置 envelope 的 `ignorable`。因此 dsh-military 0.9.0 不写 `military/*` 私有 DSH Session Event；权威事实进入 Military Ledger，Web 运行视图必须使用插件自有 Remote/Projection。

## 3. Experimental Agent Team

官方 Team 目前是单进程、共享 checkout、advisory write scopes、非跨进程 exactly-once mailbox，且 Task 状态位于 Lead Session。它不能替代 Military Mission Kernel、Workspace、Radio 和 Verification。

## 4. Web Client

RC.2 动态包构建规则依赖 package manifest 和 module table。发布门禁已执行
真实 Loader shell loading、Settings 写入/重启恢复和 Web Client graph 注册；
真实浏览器渲染、断线、多标签页和无障碍仍须部署 Web E2E。

## 5. DeepSeek Vision

只有部署显式声明 `inputModalities: [text, image]` 的模型可接收图片。默认模型目录是否开放 vision 由部署决定。图片 input-only；Assistant image output 不在本版本范围。

## 6. Reasoning Passback

RC.2 的 reasoning passback 可能显著提高后续输入 Token。静态 Context 估值不能作为预算真源；若 Provider usage 不完整，系统必须保守预留并提前压缩。

## 7. Git 与平台

Git worktree、LFS、submodule、网络文件系统和 Windows 仍需目标平台 Fixture。远端 Git 写入没有默认 Provider，仍需用户授权后的 General Promotion。
