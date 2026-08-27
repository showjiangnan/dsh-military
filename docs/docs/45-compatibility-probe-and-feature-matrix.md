# RC.2 能力探测与兼容矩阵

## 1. 固定基线

```text
dsh@0.1.1-rc.2
commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

版本字符串只是必要条件。启动时必须同时核对 release、commit、公开 seam 和部署组合。

## 2. Probe 项

`CompatibilityReport` 至少检查：

- Agent Preset：resolve、mount、composeFrom、composedPreset；
- Agent：pre-step、request、turn-stopping、model selection；
- Subagent：startContinuable、reserved childId、report delivery、selective drain；
- Command：attachments invocation 和 image admission；
- Session persistence 与 projection；
- Settings Host service 与 RC.2 shared client mirror；
- 可选 Conversation Node seam、client module table 和 package manifest；
- Compaction lifecycle；
- Tool guard/result；
- DeepSeek reasoning efforts、input modalities 和 usage；
- SQLite migration、generation manifest、Activity reconciliation。

## 3. Disposition

| 状态 | 允许行为 |
|---|---|
| `READY` | 核心 Military 运行能力；可选 Web 运行视图缺失以 warning 报告 |
| `DEGRADED_READ_ONLY` | 读取、导出、评估历史；禁止新 Mission 和写 Activity |
| `MIGRATION_REQUIRED` | 只显示迁移与诊断 |
| `UNSUPPORTED` | 不暴露可选 Military preset |

关键 seam 缺失时 fail closed，不能以更弱行为静默继续。

## 4. 已确认差异

| Surface | RC.2 状态 | Military 处理 |
|---|---|---|
| Preset/composeFrom | 公开 mount/composeFrom seam 可用 | Preset scope 组合并验证 actual preset |
| Agent/Model Selection | 相同 | General 规则不变 |
| Tool Pipeline | 相同 | Grant/Freeze/Verification 不变 |
| Subagent report | `wakeup` → `next-step` | RC.2 adapter 映射 |
| Subagent start | 支持预留 `childId` | Provisioning 先持久化 |
| Subagent drain | 支持指定直属 child | Wave/Committee 精确清理 |
| Command | images + attachments | `/brainstorm` 可接收图片 |
| Web Settings | 共享 describe mirror | 删除重复 reader/invalidation |
| Client build | manifest/external 规则加强 | peer/dev 和 `dsh.client` 校验 |
| DeepSeek | vision、图片预算、全 reasoning passback | Model/Context/Budget 扩展 |
| Agent Team | experimental | 仅非权威投影 |
| External Session events | 无 required-event 注册面 | 不写 `military/*`；使用 Military Ledger/Remote |

## 5. CI Fixture

- preset picker、nonblank lock、same-cwd isolation；
- General preset default、用户模型切换与拒绝；
- reserved childId、duplicate-id reconciliation；
- quiet/next-step report、selective drain；
- `/brainstorm` 文本/图片与取消窗口；
- Settings shared mirror 与 revision conflict；
- Settings shared mirror；未来插件自有 Mission Projection replay；
- DeepSeek text/vision admission 与 reasoning usage；
- Candidate → Verify → Integrate → specs commit；
- RC.2 多次启动恢复、旧 generation quarantine 和显式迁移。
