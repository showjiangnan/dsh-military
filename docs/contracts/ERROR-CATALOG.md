# 错误目录（生成）

> 真源：`contracts/error-catalog.json`。

| Code | 分类 | 默认可重试 | 恢复 |
|---|---|---:|---|
| `INVALID_ARGUMENT` | `common` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `UNAUTHORIZED` | `authorization` | 否 | Resolve a valid Authority Context or obtain explicit user authorization. |
| `FORBIDDEN_SCOPE` | `authorization` | 否 | Reduce the requested resource scope or use a profile that grants it. |
| `REVISION_CONFLICT` | `common` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `STALE_TASK_VERSION` | `common` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `IDEMPOTENCY_CONFLICT` | `common` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `NOT_FOUND` | `common` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `CAPACITY_EXHAUSTED` | `common` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `DEPENDENCY_NOT_READY` | `common` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `RESOURCE_LOCKED` | `common` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `POLICY_DENIED` | `authorization` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `PERSISTENCE_FAILED` | `persistence` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `MILITARY_PRESET_REQUIRED` | `preset` | 否 | Create a new blank session with the fixed military preset. |
| `MILITARY_BINDING_MISMATCH` | `preset` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `MILITARY_PRESET_GENERATION_MISMATCH` | `preset` | 否 | Rebind the exact archived generation or quarantine and migrate. |
| `AGENT_TEMPLATE_INACTIVE` | `agent` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED` | `agent` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `CONTEXT_POLICY_INVALID` | `context` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `COMPACTION_ATTEMPT_FAILED` | `context` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `MISSING_EVIDENCE` | `verification` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `UNVERIFIED_TOOL_CLAIM` | `verification` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `ARTIFACT_MISMATCH` | `verification` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `REGRESSION_FAILED` | `verification` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `ACCEPTANCE_INCOMPLETE` | `verification` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `CANDIDATE_STALE` | `verification` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `SELF_VERIFICATION_ONLY` | `verification` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `HUMAN_REVIEW_REQUIRED` | `verification` | 否 | Pause authoritative state change and request an authorized human decision. |
| `REQUEST_NOT_ADMISSIBLE` | `radio` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `DUPLICATE_BLOCKER` | `radio` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `CHEAP_RETRY_AVAILABLE` | `radio` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `MISSING_REPRODUCTION` | `radio` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `GUIDANCE_STALE` | `radio` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `GUIDANCE_EXPIRED` | `radio` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `ADVISOR_UNAVAILABLE` | `radio` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `DEAD_LETTERED` | `radio` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `TACTICAL_TAG_INACTIVE` | `tactics` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `TACTICAL_TAG_DELETED` | `tactics` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `TACTICAL_SOURCE_NOT_AUTHORIZED` | `tactics` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `TACTICAL_SOURCE_REDACTION_REQUIRED` | `tactics` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `TACTICAL_CANDIDATE_STALE` | `tactics` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `TACTICAL_REVIEW_REQUIRED` | `tactics` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `TACTICAL_EXTRACTION_FAILED` | `tactics` | 是 | Inspect the durable job and chunk receipt, correct the source or model route, then resume the same request. |
| `BRAINSTORM_ALREADY_ACTIVE` | `interaction` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `BRAINSTORM_NOT_ACTIVE` | `interaction` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `DECISION_SET_DUPLICATE` | `interaction` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `DECISION_SET_STALE` | `interaction` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `CHIEF_FALLBACK_NOT_ADMISSIBLE` | `interaction` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `EVALUATION_DATASET_INCOMPLETE` | `evaluation` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `EVALUATION_INSUFFICIENT_DATA` | `evaluation` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `EVALUATION_REPORT_MISMATCH` | `evaluation` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `GIT_NETWORK_FORBIDDEN` | `git` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `GIT_REMOTE_WRITE_FORBIDDEN` | `git` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `GIT_NON_MAIN_FORBIDDEN` | `git` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `GIT_HISTORY_REWRITE_FORBIDDEN` | `git` | 否 | Stop the attempted state change, preserve evidence, and require an explicit corrective command or policy change. |
| `GIT_WORKTREE_DIRTY` | `git` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `GIT_COMMIT_FAILED` | `git` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `PROMOTION_ORDER_REQUIRED` | `git` | 否 | Obtain an unexpired user-authorized Promotion Order for remote Git work. |
| `AGENT_EXECUTION_BINDING_MISSING` | `agent` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `AGENT_EXECUTION_BINDING_MISMATCH` | `agent` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `PRESET_RESUME_RECEIPT_FAILED` | `preset` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `BUDGET_RESERVATION_REQUIRED` | `budget` | 否 | Reserve capacity before starting the expensive operation. |
| `BUDGET_RESERVATION_EXPIRED` | `budget` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `BUDGET_SETTLEMENT_CONFLICT` | `budget` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `EVALUATION_APPEAL_UNAUTHORIZED` | `evaluation` | 否 | Resolve report access and evaluation:appeal authorization before submitting. |
| `EVALUATION_APPEAL_STALE_REPORT` | `evaluation` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
| `EVALUATION_APPEAL_EVIDENCE_REQUIRED` | `evaluation` | 是 | Follow the owning domain state machine, preserve the original receipt, and retry only after the blocking fact changes. |
