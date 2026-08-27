# DSH RC.2 compatibility fixture

本目录固定 `dsh@0.1.1-rc.2` commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的兼容合同、公开源码指纹和
端到端用例。

- `compatibility-matrix.yml`：启动 Probe 必需能力；
- `fixture-cases.yml`：真实 RC.2 checkout 上必须运行的场景和断言；
- `source-fingerprints.json`：固定提交中承载关键合同的 Git blob SHA-1。

核心安装、Loader 激活、Preset mount、Tool、continuable Worker、Settings、
Web Client、Mission → Task → Verification → Integration，以及跨三次进程启动的
恢复路径由 `tests/rc2-profile-e2e.test.ts` 自动执行。Fixture 中标记为部署检查的
浏览器交互和外部 Provider 网络行为不由确定性测试伪装；发布证据位于
`RELEASE-REPORT.json` 与 release 目录中的 `RC2-*.json`。
