# 资源预算预留与结算检查清单

- [ ] 使用精确 Budget Policy revision。
- [ ] 按 Deployment→Tenant→Mission→Wave→Task 校验上级余额。
- [ ] reservation 使用 CAS 和 idempotency key。
- [ ] 未预留的昂贵操作在副作用前拒绝。
- [ ] expiry、revoke 和 crash recovery 不产生负余额。
- [ ] Usage Receipt 引用完整 source events。
- [ ] 相同 settlement 不重复计量。
- [ ] overage 产生 durable disposition。
- [ ] 安全停止和 Verifier 有独立保留容量。
- [ ] Standard Session 不进入 Military 预算账本。
