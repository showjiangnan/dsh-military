# ADR-0037：RC.2 精确基线与薄适配层

**状态：Accepted**

`0.9.0-alpha.6` 固定 `dsh@0.1.1-rc.2` commit `b150a551...`。RC.2 差异被限制在 Subagent、Command、Web Client 和 DeepSeek 能力适配层，Mission Kernel 与领域契约不依赖 DSH 内部实现。


发布门禁保存官方负载关键文件的 Git blob 指纹。离线包可使用锁定接口投影开发，但只有设置 `DSH_RC2_ROOT` 并通过精确 checkout 指纹验证的 CI 才能形成生产兼容证据。RC.2 未提供第三方 required Session Event 注册面，因此薄适配层禁止写入 `military/*` DSH Session Event。
