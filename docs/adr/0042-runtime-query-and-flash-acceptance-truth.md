# ADR-0042：Runtime Query 真值与真实 Flash 验收分离

**状态：Accepted**

## 背景

轮询组件各自实现 timeout/dedupe 会产生旧响应覆盖新保存、多标签页不一致和
卸载后继续请求。确定性 Schema 测试也不能证明真实 Flash Provider 的工具表现。

## 决策

- 所有 Military Web feature slice 通过共享 query boundary，统一
  timeout、Abort、请求去重、visibility/offline backoff、revision fence 和
  mutation invalidation。
- `BroadcastChannel` 与不含业务数据的 localStorage 信号只传播失效通知，不传播
  Artifact、凭据或设置正文。
- Runtime Center 只读 Host/SQLite 权威 projection，并显示 source revision、
  generatedAt、staleAfter、health 和完整执行层级。
- 固定九场景 deterministic gate 只证明 Host/Schema/路径合同，不调用模型。
- 真实 Provider acceptance 只消费 immutable Session events 与 Host-observed
  receipts；exact route、configuration 和独立 Session 是样本身份。
- 每个 exact configuration × scenario 要求 `N≥50`；首次工具命中点估计
  `≥95%` 且 95% Wilson 下界 `≥85%`；E2E 完成点估计 `≥90%` 且下界
  `≥80%`；意外确定性错误、越权写入、假完成和重复终态必须全为 0。

## 结果

UI 可导出 Host 评估证据；`npm run acceptance:flash -- --input <file>` 独立
重算并执行发行门。样本不足永远显示 `INSUFFICIENT_SAMPLE`，不会因目录存在、
deterministic test 通过或模型名称包含 `flash` 而升级为真实验收通过。
