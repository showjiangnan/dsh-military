# Reference TypeScript Contracts

这些类型用于冻结包边界、服务形状和 branded identity，不是可直接发布的 DSH 插件。生产实现应优先从 JSON Schema/Event Catalog 生成跨进程类型，并把手写 TypeScript 限制在行为接口、品牌类型和进程内能力。

## 文件

- `domain.ts`：核心 ID、Session Binding、Agent Template、Artifact/Evidence；
- `generated-event-catalog.ts`：由 Event Catalog 生成的 Payload Map；
- `events.ts`：生成事件的稳定出口；
- `governance.ts`：generation、Authority、Policy、Workspace、Decision、Dataset、Agent Binding、Resume Receipt、Budget Settlement、Appeal 和 Lifecycle；
- `services.ts`：Service Definition 参考；
- `tools.ts`：模型/领域工具边界；
- `config.ts`：Settings 与 General preset model policy；
- `state-machines.ts`：权威状态机；
- `generated-error-catalog.ts`：由 Error Catalog 生成的稳定错误码和恢复元数据；
- `errors.ts`：生成错误目录的稳定出口。

## 约束

生产实现必须：

- 对所有跨进程输入运行 JSON Schema 或同源 Runtime Validator；
- 使用 `contracts/parity-map.json` 保持共享接口字段和 requiredness 一致；
- 使用 actual preset=`military` 和精确 generation 作为 Session Plane 准入；
- 固化 `templateId@revision`、provider/model/reasoning、Policy revision、Workspace Snapshot；
- 让 General Session override 只作用于根 General；
- 让子代理只提交 `DecisionQuestionSet`，由根 General 调用 `ask_user_question`；
- 把跨会话提炼/评估作为 Host 管理 Job，并解析 Authority Context；
- 将 Worker 修改表示为 Candidate Patch，不能直接写 local `main`；
- 所有外部副作用保存 intent、idempotency 和 receipt；
- 对旧 Event 通过 upcaster/replay 测试升级，不原地改写历史。

## 校验

```bash
tsc -p reference/types/tsconfig.json
python scripts/generate_contract_artifacts.py --check
python scripts/generate_error_artifacts.py --check
python scripts/compute_preset_generation.py --check
python scripts/update_indexes.py --check
python scripts/validate_artifacts.py
```
