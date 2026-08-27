# 66. Legacy → RC.2 升级运行手册

## 1. 升级前

- 停止新 Mission 准入；
-完成或暂停 Integration；
-备份 SQLite、Artifact、specs、local main 和 preset generation archive；
-导出 Compatibility Report 与未完成 Activity；
- 记录升级前 DSH release、commit、Bundle version 和 Preset generation。

## 2. 安装

- 安装 `dsh@0.1.1-rc.2` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；
- 安装 `dsh-military 0.9.0-alpha.25`；
- 运行 migration dry-run；
- 验证 Web client package manifest；
- 重新计算 Military preset generation；
- 运行 Compatibility Probe。

## 3. Fixture

必须覆盖：

1. Military/Standard 同 cwd 隔离；
2. General preset 默认和会话模型切换；
3. 预留 childId 的 continuable Worker；
4. `quiet` 与 `next-step` report；
5. selective child drain；
6. `/brainstorm` 文本和图片；
7. Settings shared mirror；
8. Candidate → Verify → Integrate → specs commit；
9. 旧 Session 冷恢复或显式 migration；
10. archive-only generation quarantine。

## 4. 回滚

RC.2 写入新的 Military Ledger Event、Activity State 或 Military Schema 后，
不允许直接用旧 Runtime 继续同一可变 Mission。`0.9.0-alpha.25` 不写未知
`military/*` DSH Session Event。回滚应恢复升级前整套数据备份，或把已认证事实
导入新 Mission；不得让两个版本同时写同一 Mission Ledger。
