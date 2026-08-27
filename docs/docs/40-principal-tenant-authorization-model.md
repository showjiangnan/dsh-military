# Principal、Tenant 与授权模型

## 1. 目标

跨会话战术提炼、军事评估、企业 API、远端 Git 和 Restricted 数据读取都不能只依赖 `requestedBy: string`。系统使用 [`MilitaryAuthorityContext`](../schemas/authority-context.schema.json) 统一表达调用者身份和权限。

## 2. Principal 类型

```text
human-user
organization-admin
tactical-admin
model-admin
security-auditor
evaluation-reviewer
service-principal
agent-principal
```

Agent principal 永远不能自行获得人类专属授权。Agent 的权限来自模板、Task Order 和可撤销 Grant 的交集。

## 3. Authority Context

每次管理或高影响命令绑定：

- `principalId`；
- `tenantId`；
- roles 和 scopes；
- Session ownership；
- Workspace membership；
- classification ceiling；
- authorization receipts；
- issued/expiry time。

管理命令不接受模型自由填写的 Context；Host 从认证连接、Session ownership、Settings 权限和凭据服务构造。

## 4. 授权决策

有效权限为：

```text
principal role scopes
∩ tenant boundary
∩ resource ownership/membership
∩ data classification ceiling
∩ operation-specific receipt
∩ active policy revision
∩ time and use limits
```

任何 deny、revocation、expiry 或分类不满足均拒绝。

## 5. 高影响动作

以下动作必须引用 [`UserAuthorizationReceipt`](../schemas/user-authorization-receipt.schema.json)：

- GitHub push、PR、远端分支写入；
- 生产部署或外部付费 API；
- Restricted 数据出域；
- 跨用户 Session 提炼；
- 组织级战术发布；
- 删除战术源和派生知识；
- 迁移或删除旧 preset generation；
- 扩大评估委员会的数据范围。

Receipt 指定 action、resource、constraints、来源消息、内容哈希和 expiry，不允许用“用户之前好像同意过”代替。

## 6. 跨会话规则

### 战术提炼

用户只能默认提炼自己拥有的 Session。Workspace/组织级数据需要相应管理员 Scope，并受来源许可证约束。

### 军事评估

Dataset Auditor 只读取：

- actual preset=`military`；
- 属于请求 tenant；
- 在授权时间范围和 Workspace/Mission filter 内；
- 数据分类不超过报告策略；
- 未被 retention/revocation 排除。

Examiner Agent 只获得去标识化 Dataset shard，不获得任意 Session 查询能力。

## 7. Agent 权限

角色权限是三层交集：

```text
hard role invariant
∩ versioned PermissionProfile
∩ current Task/Guidance scope
```

Permission Profile 使用 deny-first，并定义文件、Git、网络和分类边界。Tool Profile 只控制可见和可调用工具，不替代 Sandbox、Guard 或 Authority Check。

## 8. 撤权

撤权事件立即提高安全边界：

- 下一次工具准入前生效；
- 正在执行的可取消 I/O 收到 Abort；
- 已产生 Artifact 保留审计但不再授权新读取；
- 已发 Guidance 保留来源，禁止新增受撤权资源调用；
- 受影响 Task 进入 revalidation 或 freeze。

## 9. 审计

每次决策记录：

```text
principal
resolved tenant
roles/scopes
policy revisions
authorization receipt
decision
reason
resource
classification
time
```

不得把 Secret、Token 或原始凭据写入审计日志。

## 10. 验收条件

- 普通用户不能评估或提炼他人会话；
- Advisor 不能读取未授予的企业 API；
- revoked Grant 在下一次调用前失效；
- Agent 不能伪造 human authorization；
- 报告和战术继承正确分类；
- tenantId 在管理事件和关键存储表中必填。
