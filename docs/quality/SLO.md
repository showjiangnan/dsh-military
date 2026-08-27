# 服务目标与硬不变量

## 1. 零容忍安全/正确性指标

| 指标 | 目标 |
|---|---:|
| 未验收事实进入 General Tactical Memory | 0 |
| stale Task Version 被接受 | 0 |
| 未授权远端 Git 写入 | 0 |
| 工兵在非受控本地 main 的常规 commit | 0 |
| Worker/Engineer 有效 reasoning 为 off | 0 |
| 原始 Secret 写入 Session/Ledger/日志 | 0 |
| 被冻结 Agent 的成功写工具调用 | 0 |

## 2. 建议运行 SLO

| 指标 | 初始目标 | 说明 |
|---|---:|---|
| Ledger append 可用性 | 99.9% | 本地开发可降低，但不可 silent success |
| Radio admissible request P95 等待 | < 120s | 由领域参谋容量决定 |
| Candidate 验收启动 P95 | < 30s | 不含长测试执行 |
| Wave Barrier 投影延迟 P95 | < 5s | 事件到 UI/调度 |
| Frozen policy 生效 | < 1 step boundary | 写工具 guard 应立即生效 |
| 事件重放一致率 | 100% | 相同 log → 相同 projection |
| Specs traceability coverage | ≥ 95% | 关键需求必须 100% |

## 3. 质量指标

- first-pass acceptance rate；
- final acceptance rate；
- false completion rate；
- mean rework attempts；
- tactical guidance lift；
- advisor queue saturation；
- verifier false accept/false reject；
- specs drift；
- task granularity efficiency；
- model/reasoning effectiveness by task type。

不得用“Agent 发送了多少消息”作为成功指标。

## 4. 0.2.0 零容忍指标

| 指标 | 目标 |
|---|---:|
| 非 Military Session 收到 Military 模型表面或控制副作用 | 0 |
| Military child preset generation 与父会话不一致 | 0 |
| 安装 Military root 导致既有 preset 消失 | 0 |
| 未审阅 Tactical Extraction Candidate 被发布为可调用战术 | 0 |
| DELETED tag 新增关联 | 0 |
| delegated child 直接获得用户弹窗 | 0 |
| 评估纳入 actual preset 非 `military` 的 Session | 0 |
| 委员会覆盖/修改确定性 Verifier 原始指标 | 0 |

## 5. 0.2.0 建议运行 SLO

| 指标 | 初始目标 | 说明 |
|---|---:|---|
| preset selection/binding 成功率 | ≥ 99.9% | 排除用户取消和明确 broken preset |
| sibling-session isolation 回归 | 100% | 每个发布版本必测 |
| context threshold→attempt P95 | < 1 safe step boundary | 不承诺压缩一定成功 |
| DecisionQuestionSet→General 展示 P95 | < 5s | 不含用户等待 |
| Ingestion source snapshot 完整率 | 100% | hash、分类、redaction receipt |
| Evaluation deterministic total 对账 | 100% | 报告总数可重算 |
| 评估 Job 可恢复率 | ≥ 99% | 单模板分片失败可重试 |
| Tag rename 历史引用完整率 | 100% | stable id 不重写 |

## 6. 0.3.0 建议 SLO

| 指标 | 目标 |
|---|---:|
| RC.2 Compatibility Probe 启动成功率（合规部署） | ≥ 99.9% |
| Preset generation 精确恢复率（资产存在） | 100% |
| 错误 generation 静默挂载 | 0 |
| General model switch 原子成功或保持旧路由 | 100% |
| 子代理错误继承 General override | 0 |
| Authorization deny bypass | 0 |
| 未验收 Patch 进入 local main | 0 |
| Accepted Patch 重复集成 | 0 |
| Integration queue p95（无冲突） | 部署定义，建议 < 60 s |
| Decision 回答 durable 提交 p95 | < 2 s（不含用户思考） |
| Outbox oldest critical age | < 30 s |
| Budget reservation p95 | < 50 ms |
| 重复 usage 结算 | 0 |
| Evaluation dataset hash 可复现率 | 100% |
| Source revoke 后新 Guidance | 0 |
| Standard Session 被 Military Freeze/Compaction 影响 | 0 |
| 已发布子 Agent 无 AgentExecutionBinding | 0 |
| Agent effective route/tool scope 与 Binding 不一致 | 0 |
| 未预留资源的昂贵 Military 操作 | 0 |
| 同一 Budget Usage Receipt 重复计量 | 0 |
| 绩效申诉直接改写旧报告 revision | 0 |
