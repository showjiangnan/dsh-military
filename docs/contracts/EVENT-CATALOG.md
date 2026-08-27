# 事件目录（生成）

> 真源：`contracts/event-catalog.json`；本文件由 `scripts/generate_contract_artifacts.py` 生成。

## Mission Ledger

| 事件 | 标题 | 说明 |
|---|---|---|
| `military/session-bound` | Military session bound | Root session joined the fixed military preset and recorded its generation. |
| `military/session-quarantined` | Military session quarantined | A resumed or changed session cannot safely execute under the active generation. |
| `preset/generation-resume-checked` | Preset generation resume checked | Resume adapter compared the persisted generation with the active or archived mount. |
| `preset/migration-completed` | Preset migration completed | An authorized migration created or rebound a session under a compatible preset generation. |
| `mission/started` | Mission started | A General opened one authoritative mission. |
| `mission/command-accepted` | Mission command accepted | The single-writer Mission Kernel admitted one command after revision, authority, budget and idempotency checks. |
| `mission/intent-ratified` | Mission intent ratified | The user-owned mission intent was ratified by General. |
| `direction/ratified` | Direction ratified | General ratified a staff direction plan. |
| `wave/opened` | Wave opened | A schedulable wave entered execution. |
| `wave/barrier-satisfied` | Wave barrier satisfied | All required task, integration, specs and oversight conditions passed. |
| `task/created` | Task created | A versioned task order was added to the mission DAG. |
| `task/leased` | Task leased | A role-bound agent received an exclusive task lease. |
| `task/candidate-submitted` | Task candidate submitted | A worker proposed a candidate for external verification. |
| `task/blocker-submitted` | Task blocker submitted | A worker submitted evidence of an unresolved blocker. |
| `verification/completed` | Verification completed | Harness completed deterministic and optional semantic verification. |
| `task/accepted` | Task accepted | Harness committed an accepted task result after verification. |
| `task/cancelled` | Task cancelled | Harness terminally cancelled a Task after an explicit user or policy abort. |
| `task/rework-requested` | Task rework requested | Harness issued a new task version after rejected verification. |
| `task/integration-queued` | Task integration queued | An accepted candidate patch entered the controlled main integration queue. |
| `task/integrated` | Task integrated | An accepted patch was applied to controlled local main and regressed. |
| `workspace/lease-acquired` | Workspace lease acquired | A task obtained a versioned isolated workspace lease. |
| `workspace/snapshot-created` | Workspace snapshot created | Harness froze the input baseline for a task attempt. |
| `workspace/lease-released` | Workspace lease released | A task workspace lease ended and its isolated worktree became eligible for cleanup. |
| `workspace/drift-detected` | Workspace drift detected | The integration target changed from the task base snapshot without granting control over the external actor. |
| `integration/conflict-detected` | Integration conflict detected | Controlled main integration found a deterministic merge conflict. |
| `integration/regression-failed` | Integration regression failed | An accepted patch could not be committed because global regression checks failed. |
| `radio/requested` | Radio request admitted | Evidence gate admitted a tactical guidance request. |
| `radio/guidance-issued` | Radio guidance issued | An advisor produced validated tactical guidance. |
| `radio/guidance-delivered` | Radio guidance delivered | Broker delivered non-stale guidance to the requesting task version. |
| `decision/question-set-created` | Decision question set created | A child or General created a durable user decision set. |
| `decision/question-presented` | Decision question presented | Root General presented one question set through DSH user questions. |
| `decision/answered` | Decision answered | Harness durably recorded the user response and provenance. |
| `decision/stale` | Decision question became stale | A pending user decision no longer matched the current mission or task revision. |
| `decision/expired` | Decision expired | An unanswered or stale decision set reached a terminal state. |
| `oversight/frozen` | Agent frozen | Oversight controller froze an anomalous agent before completion. |
| `oversight/released` | Agent released | Harness released a frozen agent under an approved correction order. |
| `specs/commit-recorded` | Specs commit recorded | Engineer committed validated specs changes on controlled local main. |
| `context/compaction-required` | Compaction required | Context pressure crossed a template or General policy threshold. |
| `context/compaction-attempted` | Compaction attempted | Harness invoked DSH RC.2 compaction at a safe boundary. |
| `context/compaction-completed` | Compaction completed | A compaction attempt ended with an explicit success, no-op or failure. |
| `model/selection-changed` | General model selection changed | User changed the root General session model through the DSH model selector. |
| `model/selection-rejected` | General model selection rejected | A requested General session model failed a capability, reasoning, residency or budget gate and the previous route remained active. |
| `model/fallback` | Model fallback applied | An explicitly allowed compatible fallback replaced an unavailable route. |
| `budget/reserved` | Resource budget reserved | Harness reserved bounded capacity before starting an expensive operation. |
| `budget/settled` | Resource budget settled | Actual usage was deduplicated against one reservation and unused capacity was released. |
| `budget/threshold-reached` | Resource budget threshold reached | A deployment, tenant, mission, wave or task budget reached policy threshold. |
| `budget/exhausted` | Resource budget exhausted | A hard limit stopped new admission and selected an explicit safe disposition. |
| `memory/trajectory-created` | Trajectory memory created | Harness accepted a source-covered tactical trajectory memory. |
| `memory/effectiveness-scheduled` | Effectiveness assessment scheduled | General compaction triggered an idempotent effectiveness job. |
| `memory/effectiveness-created` | Effectiveness assessment created | Harness accepted a verified tactical effectiveness assessment. |
| `tactic/version-published` | Tactic version published | Governance published a new version into a controlled lifecycle stage. |
| `agent-template/instantiated` | Agent template instantiated | Runtime froze a template revision and effective model route for a child. |
| `agent/execution-bound` | Agent execution binding created | Harness froze one non-General agent template, model, reasoning, policy and preset generation before publication. |
| `brainstorm/started` | Brainstorm started | General opened the explicit brainstorm command workflow. |
| `brainstorm/decision-recorded` | Brainstorm decision recorded | A user-owned brainstorm decision became a durable record. |
| `brainstorm/completed` | Brainstorm completed | Brainstorm produced mission intent and optional specs handoff. |
| `staff/chief-advice-issued` | Chief of Staff advice issued | Chief generated a model-derived reference opinion with explicit assumptions. |
| `mission/completed` | Mission completed | General reported mission completion after all authoritative gates passed. |
| `mission/cancelled` | Mission cancelled | An authorized principal cancelled the mission and recovery actions were recorded. |

## Administrative Ledger

| 事件 | 标题 | 说明 |
|---|---|---|
| `tag/changed` | Tactical tag changed | A stable tag id changed metadata or lifecycle. |
| `agent-template/changed` | Agent template changed | A department template revision changed lifecycle or content. |
| `tool-profile/changed` | Tool profile changed | A versioned tool visibility and execution profile changed. |
| `permission-profile/changed` | Permission profile changed | A deny-first permission profile changed. |
| `api-grant/changed` | Enterprise API grant changed | A scoped enterprise API grant changed or was revoked. |
| `model-capability/changed` | Model capability profile changed | A benchmarked provider/model capability declaration changed. |
| `context/manifest-created` | Context manifest created | Context Compiler persisted the exact manifest used to assemble one department-Agent model step. |
| `data-residency-policy/changed` | Data residency policy changed | A versioned data residency policy was created, revised, paused or retired. |
| `redaction-policy/changed` | Redaction policy changed | A versioned response redaction policy changed. |
| `verifier-profile/changed` | Verifier profile changed | A versioned verifier profile changed. |
| `resource-budget-policy/changed` | Resource budget policy changed | A versioned deployment, tenant or mission budget policy changed. |
| `authorization/granted` | Authorization granted | A principal granted a bounded high-impact authorization. |
| `authorization/revoked` | Authorization revoked | A previously granted authorization was revoked. |
| `tactical-ingestion/requested` | Tactical ingestion requested | A user authorized a historical or direct knowledge extraction job. |
| `tactical-ingestion/source-snapshotted` | Tactical source snapshotted | Harness froze and scanned the source material before extraction. |
| `tactical-ingestion/candidate-created` | Tactical extraction candidate created | Extractor produced a user-reviewable candidate with provenance. |
| `tactical-ingestion/reviewed` | Tactical ingestion reviewed | User or authorized reviewer approved, returned or rejected the candidate. |
| `tactical-source/revoked` | Tactical source revoked | Source rights, accuracy or retention status invalidated derived knowledge. |
| `tactical-source/impact-assessed` | Tactical source impact assessed | Harness traced revoked source influence across tactics and accepted tasks. |
| `tactical-source/revalidation-completed` | Tactical source revalidation completed | Affected accepted results and tactic versions were revalidated after source revocation or correction. |
| `performance-evaluation/requested` | Performance evaluation requested | User opened a cross-session evaluation run. |
| `performance-evaluation/dataset-frozen` | Performance dataset frozen | Dataset auditor froze the reproducible evaluation manifest. |
| `performance-evaluation/template-completed` | Template evaluation completed | One template revision received a validated individual performance result. |
| `performance-evaluation/completed` | Performance evaluation completed | Committee chair report passed source and statistical validation. |
| `performance-evaluation/cancelled` | Performance evaluation cancelled | A durable evaluation job was cancelled without publishing a final report. |
| `performance-evaluation/reopened` | Performance evaluation reopened | A dataset correction or appeal created a new report revision. |
| `performance-evaluation/appeal-resolved` | Performance evaluation appeal resolved | The committee or authorized reviewer resolved an appeal without rewriting the original report revision. |
| `performance-evaluation/appeal-submitted` | Performance evaluation appeal submitted | An authorized principal challenged one frozen performance report revision. |
| `preset-generation/installed` | Preset generation installed | Installer registered an immutable military generation asset. |
| `preset-generation/deprecated` | Preset generation deprecated | A generation stopped serving new sessions but remained available for resume. |
| `compatibility/probed` | Compatibility probe completed | Startup probe recorded the DSH RC.2 capability disposition. |
| `bundle/installed` | Bundle installed | Installer atomically installed bundle assets and roster overlay. |
| `bundle/upgraded` | Bundle upgraded | Installer upgraded assets while preserving generations and settings. |
| `bundle/rolled-back` | Bundle rolled back | Installer restored the last known-good composition and assets. |
| `bundle/disabled` | Bundle disabled | New Military session and mission admission was disabled while retained data and existing session dispositions remained explicit. |
| `bundle/uninstalled` | Bundle uninstalled | Installer removed active composition while retaining governed data per policy. |
