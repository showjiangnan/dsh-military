# 契约一致性质量门禁

发布必须依次通过：生成物 freshness、Schema validity、完整示例、事件 Payload 覆盖、TypeScript parity、Preset generation、RC.2 fixture、SQL migration shape、状态不变量和 Golden Trace。

`278/278` 一类数字只表示该版本已注册检查项的结果；报告必须列出检查类别，不能把语法通过表述为运行时正确。

## 严重等级

- **Blocker**：事件/类型漂移、旧 generation 无法恢复、权限绕过、未验收 main 写入。
- **Critical**：跨 tenant 读取、撤权失效、Artifact hash 不一致、重复接受。
- **Major**：统计不可复现、错误缺失分类、Decision 回送错误。
- **Minor**：文档链接、显示文案、非权威投影。
