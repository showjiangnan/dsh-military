# ADR-0016：用户弹窗由根 General 所有，参谋长只产生问题集

- 状态：Accepted
- 日期：2026-08-18

## 背景

Brainstorm 和参谋长需要频繁让用户作选择，但 DSH 的 delegated subagent 不能直接调用 `ask_user_question`。允许多个子代理直接弹窗也会造成并发、归属和恢复混乱。

## 决策

协议命令为 `/brainstorm`，Web 显示“头脑风暴”。Advisor 和 Chief of Staff 输出 `DecisionQuestionSet`，由 General 去重并调用 `ask_user_question`。Chief 只在 Tactical Sufficiency Gate 判定私有战术不足时触发，其建议标记为 `GENERATED_REFERENCE`，不能自动发布为 Skill。

## 后果

- 所有用户问题有单一所有者和可恢复队列；
- 子代理需要一条向 General 的结构化转交通道；
- 当前 DSH 不支持原生命令 id `/头脑风暴`，需使用本地化显示；
- Chief 建议经过实际执行和提炼审阅后才可能成为战术。
