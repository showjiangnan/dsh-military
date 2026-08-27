# Candidate 验收检查表

- [ ] Identity、Task ID、Task Version、Attempt 全部匹配。
- [ ] Candidate 幂等键未冲突。
- [ ] 声明工具调用在 durable log 中存在。
- [ ] Artifact hash、版本和分类有效。
- [ ] changedPaths 未越过写集合。
- [ ] 没有禁止副作用。
- [ ] 每个 Acceptance Clause 有证据映射。
- [ ] Verifier 独立运行并产生 receipt。
- [ ] 回归检查通过。
- [ ] Inspector 的语义异常已处理。
- [ ] 环境没有在执行后变更到使结果 stale。
- [ ] 接受通过 CAS 写入 Ledger。
