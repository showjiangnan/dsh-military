# ADR-0032：绩效报告不可变，异议通过申诉和新 revision 处理

- 状态：Accepted
- 日期：2026-08-19

## 背景

绩效报告会影响模板选择和用户信任。直接修改旧报告会破坏可复现性；只有自由文本投诉又无法定位数据、归因或 rubric 问题。

## 决策

已发布报告 revision 永久不可变。用户通过 `PerformanceEvaluationAppeal` 指向具体 finding path、Evidence、grounds 和 remedy。成立时重新冻结 Dataset Manifest 并发布 superseding report revision；解决事件保留原始与新报告之间的关系。

申诉评审必须经过 Authority Context，且不能仅由原报告唯一 Examiner 自行裁决。

## 后果

- 任何历史决策都能解释当时使用的报告；
- 数据集和 rubric 修正具有完整审计链；
- 存储量随 revision 增长；
- WebUI 必须展示报告链、申诉状态和 superseding 关系。
