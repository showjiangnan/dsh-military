# Specs 工程

本目录由 `dsh-military` 工兵部维护，是 Mission 的长期工程文档，不是一次性模型输出。

## 权限

- 常规写入者：Engineer Corps Agent；
- Worker：只读；
- Staff：提出维护命令，不直接写；
- General：在战略变更中批准 Change Order；
- Harness：校验来源、路径、链接、追踪矩阵和 Git 纪律。

## 更新时点

- 空项目 Mission 启动；
- Direction 批准；
- 每个 Wave 退出；
- 验收合同或架构发生 Change Order；
- 重大 Incident；
- 用户明确要求。

## 完成规则

每次维护必须：

1. 引用 Mission Event 或 Artifact；
2. 更新受影响的追踪关系；
3. 运行文档校验；
4. 在本地 `main` 产生一个仅包含允许路径的 commit；
5. 将 commit hash 写回 Mission Ledger。
