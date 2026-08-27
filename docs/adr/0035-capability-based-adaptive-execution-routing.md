# ADR-0035：Capability 驱动的自适应执行路由

**状态：Accepted**

角色只提供最低约束。Router 根据 Task Capability、Model、Reasoning、Tool、Permission、Data、Budget 和 Parallelism Score 生成 Execution Strategy，避免默认 Swarm 和固定最高 Thinking。
