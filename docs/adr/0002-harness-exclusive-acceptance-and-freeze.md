# ADR-0002：验收与冻结权归 Harness 独占

- 状态：Accepted
- 日期：2026-08-18

## 背景

模型可能自报完成、遗漏工具、误读结果；另一个模型也可能误判。让 Agent 自己改变最终状态会破坏审计边界。

## 决策

只有 Harness Controller 可以：

- 将 Candidate 标为 ACCEPTED；
- 冻结、释放或替换 Agent；
- 使 Task Version 失效；
- 放行 Wave Barrier。

督战 Agent、参谋和将军只能提出结构化建议或命令请求。

## 后果

需要 Completion Interlock、Verifier Registry、Freeze Guard 和 CAS 状态机；模型错误不能直接改变真源。
