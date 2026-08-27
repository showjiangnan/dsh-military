# 授权与跨会话检查清单

- [ ] principalId、tenantId 和 Authority Context 来自可信 Host。
- [ ] Session ownership / Workspace membership 已验证。
- [ ] 数据分类不超过调用者 ceiling。
- [ ] 高影响动作引用未过期 Authorization Receipt。
- [ ] Agent 不能创建人类授权。
- [ ] 跨用户提炼和评估有管理员 Scope。
- [ ] API credential 从不进入模型或日志。
- [ ] 撤权在下一次工具准入前生效。
- [ ] Artifact hash 相同不产生跨 tenant 读取权。
