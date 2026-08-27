# ADR-0028：难度校正和可复现绩效评估

- 状态：Accepted
- 初始日期：2026-08-19
- 修订日期：2026-08-27
- DSH 基线：`0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 背景

裸通过率受任务分配、难度、Verifier 覆盖、工具/权限配置、Provider fallback、
用户取消和重复重试影响。按 Attempt 直接计算普通置信区间还会把同一 Mission 中
高度相关的返工当成独立样本。仅依赖 Examiner 模型解释，无法保证 dataset、指标和
报告在重启、重跑与申诉后保持一致。

本项目还需要判断 Flash 是否可以承担主要工作。成本优势只有在同角色、同难度、
exact route、相同治理约束和最终 Accepted Outcome 的质量基础上才有意义。

## 决策

1. `PerformanceEvaluationRequest` 的完整筛选进入唯一 Dataset Builder。
2. 先冻结 canonical `FrozenEvaluationDataset` 和 Manifest；请求、Dataset、分片与
   报告共享同一 artifact/hash。
3. Attempt 使用 Task version、Agent generation 和 lease sequence 建立有限事件窗口。
4. 按 exact execution configuration 分层，不混合 fallback、alias、Prompt、Thinking、
   ToolProfile、PermissionProfile、Bundle 或 DSH revision。
5. 难度只使用预执行特征；rework、Blocker、Radio 和失败作为结果。
6. 二项率使用 Wilson envelope 的 Mission-cluster bootstrap；连续值和差异使用固定
   种子的 Mission-cluster bootstrap。
7. 数据充分性同时检查唯一 Attempt、独立 Mission、区间宽度、缺失率、Verifier 与
   exact-route 覆盖。
8. Flash/Pro 使用同角色同难度非劣比较，安全/质量事件是不可被成本抵消的硬门。
9. 经济指标按最终 Accepted Outcome 累计全部失败、返工和重试代价；未知价格不填零。
10. Job、Dataset、分片、Report 和 Appeal 持久化并使用 lease/fence；重启后只补缺失
    分片。
11. Report revision 不可变；申诉成立后重新冻结 Dataset 并产生 superseding report。
12. 默认叙述确定性生成；可选委员会模型只能解释脱敏聚合值，不能修改指标或决策。
13. `promotionAllowed` 固定为 false，评估不能自动改变生产模型。

## 后果

正面后果：

- 同一权威输入可复现相同 dataset hash 和确定性指标；
- 配置漂移、fallback 和重复样本不会污染 Flash 结论；
- 小样本和聚类相关性在 UI 中可见；
- DSH Web 重启、Job 失败和申诉不丢失谱系；
- 质量与安全先于经济性，适合把 Flash 作为可治理的主力候选。

代价：

- exact configuration 分层会减少每组样本量；
- Mission-cluster interval 通常比按 Attempt 的区间更宽；
- 历史数据大多只能支持观察性结论；
- 价格目录缺失时无法比较成本；
- RC.2 本地 Profile 只能提供本地单用户授权边界，不能声称企业多租户 RBAC。

## 被拒绝的替代方案

- 用一个混合总分排名所有角色和模型；
- 固定 `N=5 && passRate>=80%` 即宣告稳定；
- 用配置模型名代替 actual route observation；
- 把最终成功 Attempt 之外的失败与成本丢弃；
- 把未知 Provider 价格当作零；
- 让委员会模型计算或覆盖确定性指标；
- 在 Settings JSON 中保存唯一报告；
- 原地修改申诉报告；
- 由评估页面直接晋升模型；
- 只在 UI 层实现统计标签而不建立 Host、Schema、Artifact 与持久化边界。

## 关联文档

- [军事评估委员会与绩效决策中心](../docs/37-military-evaluation-committee.md)
- [绩效评估统计、公平性与申诉](../docs/48-evaluation-statistics-and-fairness.md)
- [绩效评估运行时实现](../docs/57-performance-evaluation-runtime.md)
- [绩效评估统计协议](../quality/EVALUATION-STATISTICS-PROTOCOL.md)
