# ADR-0013：以固定 `military` system preset 作为会话能力边界

- 状态：Accepted
- 日期：2026-08-18

## 背景

Military 工具、提示词、监听器和子代理编排若通过运行时布尔开关启停，会使同一会话历史跨越两套工具组合，且同工作区普通会话可能被全局监听器误处理。

## 决策

随 Bundle 提供固定 system preset `military`。用户只在新建空白会话时选择；会话开始后锁定。模型面对的 Military 能力仅安装在 preset standing scope。Host 管理服务可常驻，但所有会话相关入口必须验证实际 preset 和 `MilitarySessionBinding`。子代理通过 `composeFrom()` 继承父会话的精确 preset generation。

## 后果

- 普通会话不受 Military prompt、工具、完成联锁和压缩策略影响；
- 无法把已有普通会话原地升级成 Military；
- 用户需要新建会话并选择 preset；
- 管理平面仍可用于配置和跨会话评估；
- 同工作区外部变化通过 drift 检测处理，Military 不控制普通会话。

## 被拒方案

- 每轮读取 `militaryEnabled` 设置；
- 按模型名推断 Military；
- 全局注册全部 Military 工具后在 execute 时拒绝；
- 子代理按字符串重新挂载 preset。
