# Preset 升级与恢复检查清单

- [ ] 当前 `preset.yml` 和 `agent.cordis.yml` 已计算 generation hash。
- [ ] Manifest 文件列表、字节数和 SHA-256 一致。
- [ ] 旧 current generation 已复制为只读 archive。
- [ ] 新会话仍显示公共 id `military`。
- [ ] 重启恢复 current-generation Session 得到 `MATCHED`；archived-only 根 Session 得到 `QUARANTINED/MIGRATION_REQUIRED`。
- [ ] archive 存在但 RC.2 无法精确重组根 Session 时，也在第一个模型请求前 `QUARANTINED`。
- [ ] Breaking change 有新 major preset 或 Migration Order。
- [ ] Generation GC 已检查 Session、Mission、报告和 legal hold 引用。
