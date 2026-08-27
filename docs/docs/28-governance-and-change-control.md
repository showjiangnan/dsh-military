# 治理、命令修订与授权

## 1. 授权层级

1. **统帅授权**：用户原始需求、约束、外部动作许可；
2. **将军命令**：Mission Intent、Direction 批准、战略变更；
3. **参谋命令**：Wave/Task、战术指导、修正任务；
4. **Harness 判定**：冻结、验收、版本、权限和持久化；
5. **执行回报**：Worker/工兵提交 Candidate、Blocker 和 Evidence。

高层可以改变低层目标，但不能伪造已经发生的事实。

## 2. Mission Intent

必须明确：

- 用户要达到的结果；
- 价值与优先级；
- 硬约束；
- 可协商偏好；
- 禁止动作；
- 已知事实；
- 假设；
- 未知问题；
- 完成判据；
- 用户必须亲自批准的外部动作。

将军应向用户呈现影响目标的实质性解释，内部 Agent 数量和细节不必逐项打扰用户。

## 3. Change Order

任何以下变化形成版本化 Change Order：

- 用户目标、范围或约束；
- Direction outcome；
- Task objective；
- read/write/forbidden scope；
- Acceptance Contract；
- Environment baseline；
- 依赖；
- 数据分类或 API 权限；
- Git promotion 权限。

Change Order 必须包含：

```yaml
reason:
requestedBy:
affectedObjects:
oldVersion:
newVersion:
impact:
  runningAgents:
  acceptedResults:
  specs:
  budget:
  schedule:
disposition:
  cancel:
  stale:
  reverify:
  grandfather:
userAuthorizationRef:
```

## 4. 验收标准冻结

Wave 进入后：

- Worker 不能改；
- 参谋不能无痕改；
- Verifier 不能为了让结果通过而降低标准；
- 将军变更必须形成 Change Order；
- Task Version 增加；
- 活动 Candidate 变 stale；
- 已接受结果是否重验由影响分析决定。

## 5. 用户覆盖

用户可以：

- 终止 Mission；
- 更改目标；
- 授权或撤回外部动作；
- 手动接受已知风险；
- 要求重新验证；
- 替换参谋或模型；
- 查看审计记录。

用户手动接受风险仍须记录：

- 哪条验收未通过；
- 已知后果；
- 影响范围；
- 授权时间；
- 是否永久或仅本次。

不得把“用户说继续”解释为永久放宽所有未来任务。

## 6. 参谋治理

Advisor Profile 的新增、修改、禁用有 revision。高敏感权限变更应要求：

- 用户或管理员批准；
- 新增权限 diff；
- 凭据引用验证；
- 最小权限分析；
- 一次 canary task；
- 审计事件。

参谋的经验/描述不应自动扩大权限。

## 7. 战术治理

Tactical Museum 可以提出新版本，不能独立把其标记为 STABLE。晋级至少需要：

- schema/状态机验证；
- 安全审查；
- 仿真；
- Canary；
- 最低样本量；
- 效能与负面影响；
- 回滚可用；
- 指定批准角色。

## 8. 决策记录

以下决策必须进入 Decision Ledger：

- Direction 批准或取消；
- 关键技术选型；
- 手动验收覆盖；
- 高风险战术晋级；
- Promotion Order；
- 模型 fallback 导致能力变化；
- Verifier 替换；
- 数据保留例外；
- 重大冻结和释放。

每条决策引用来源事件和 Artifact。

## 0.2.0 治理扩展

- system preset `military` 的文件更新产生新 generation，不迁移旧会话；
- Tag rename/pause/delete 是 revisioned administrative change；
- Tactical Extraction 需要 user review，不能由 Museum 或 Chief 单独批准；
- Agent Template 变更创建 Canary/Active revision；安全撤权可即时收紧；
- Performance recommendation 只能提出 Canary Change Order；
- 绩效报告撤回和修订必须保留旧报告 hash、原因和替代报告引用。

## 0.3.0：权威上下文与变更类型

每个治理动作记录 Principal、Tenant、Authority Context、Authorization Receipt、expected revision、数据分类和 expiry。Agent persona、职位或“General”名称不授予权限。

新增受控变更：

- preset generation current/archive/retire；
- General Model Selection；
- Tool/Permission/API/Residency/Verifier/Model Profile revision；
- Workspace Integration；
- Tactical Source revoke；
- Evaluation dataset/report revision；
- Budget increase；
- Bundle install/upgrade/rollback/uninstall；
- terminology presentation change。

破坏性契约、Event Payload、database migration 或 preset capability 变化必须有 ADR、Migration Order、Golden Trace 和 RC.2 Fixture。已归档事实不可被新配置追溯改写。
