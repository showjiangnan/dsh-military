# 63. Agentic Zero Trust 与短期 Capability Grant

## 1. 原则

每个 Agent、外部内容、历史 Memory 和工具意图都默认不可信。Prompt、角色名和模型自报不能产生权限。

## 2. Capability Grant

每个 Activation 在 Task 准入时获得短期 Grant：

```text
principal + activationId + mission/task/version
allowedTools + resourcePatterns + data ceiling
maximumUses + expiresAt + nonce + policy revisions
```

工具调用时重新验证 Grant、当前 Task revision、Freeze 状态、预算和资源路径。Grant 撤销立即阻断后续写操作。

## 3. 内容污染标签

文件、Web、企业 API、历史会话、用户粘贴和图片都携带：

- source/provenance；
- trust level；
- classification；
- prompt-injection risk；
- temporal validity；
- allowed audience。

Context Compiler 在输入层过滤，Tool Guard 在动作层再次校验。

## 4. 用户注意力预算

`ask_user_question` 由根 General 独占。Decision Broker 合并相关问题，并记录每 Mission 的最大问题轮次、问题数、高风险保留额度、超时和默认策略。每个问题必须展示为什么问、推荐项、风险、可撤销性和不回答后果。
