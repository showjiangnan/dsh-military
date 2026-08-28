# Changelog

## 0.9.0-alpha.28 — 2026-08-28

### Lossless Workbench upgrade and Desired/Applied recovery

- Added an installed-state Workbench migration that verifies each stale
  Desired role against its exact immutable runtime revision before changing
  any configuration.
- Added package-owned revision-6/7/8 merge bases and immutable user-delta
  replay. Unchanged roles advance to the runtime head; explicit status,
  provider/model, reasoning, output/context budgets, concurrency and prompt
  edits survive as one new revision when required.
- Kept General, already-current Engineer history and newer Worker revisions
  byte-for-byte unchanged in the real revision-3 failure topology.
- Prevented plugin-created migration history and Host-derived capability
  revisions from being misclassified as future user overrides.
- Migrated the legacy `military-agent-templates` composition base and rebuilt
  its compatibility mirror from runtime heads through Settings CAS, so reset
  and restart cannot reintroduce revision-6 defaults.
- Moved the final `APPLIED` transition after compatibility-mirror success.
  Failed mirror writes remain retryable, and a retry never appends a duplicate
  runtime template revision.
- Updated application bootstrap to replay legacy user template fields across
  contiguous bundled revisions while upgrading package-owned authority.
- Added exact installed-topology, custom three-way-merge, future-upgrade,
  CAS-failure and idempotency regressions. The suite now contains 220
  deterministic tests.

## 0.9.0-alpha.27 — 2026-08-28

### Execution liveness, crash recovery, Flash acceptance and production truth

- Fixed real installed upgrade startup without deleting SQLite state. Built-in
  Pro/Flash capability policies now advance to immutable revisions 2/4 and
  bundled templates advance to revision 8. Alpha.24 template revision 6 is
  upgraded through the exact revision-7 asset before revision 8, while newer
  user revisions are left untouched; historical revisions remain available to
  Sessions already pinned to them.
- Split every executable request into durable `WorkflowObligation`, Task
  Version, Attempt, Activation and Dispatch aggregates. Runtime state now
  requires start/heartbeat/settlement receipts and never infers `RUNNING`
  from a historical Session snapshot.
- Closed cancellation, late settlement, parent wakeup, Radio/Guidance,
  Decision Answer/acknowledgement and Rework continuation with exact
  Attempt/version fences.
- Completed the Candidate → Verification → Integration → Completion pipeline.
  Verification acceptance is no longer a false Task terminal; conflict,
  stale and regression failures create explicit recovery outcomes.
- Replaced async SQLite units of work with a short-transaction Command Saga.
  External work runs outside database locks and is recovered through
  `PENDING_EFFECT`, `RETRYABLE`, `EFFECT_APPLIED` and `COMMITTED` checkpoints.
- Enforced the single-writer boundary for direct SQLite calls: every public
  standalone `run`/`exec` write receives a short `BEGIN IMMEDIATE`
  transaction; only startup PRAGMAs and `VACUUM` use the explicit maintenance
  escape hatch.
- Added ordered transactional-outbox delivery, dead letters and offsets;
  durable Workspace reconciliation; Direction/Wave/DAG barriers; and
  Task-rooted read/search/write/edit tools with operation-status recovery.
- Added an honest DSH capability bridge, Desired/Applied role configuration,
  immutable dispatch-policy receipts, principal-aware Web authority, governed
  Artifact ACL/retention/legal hold/key rotation, and exact pricing status.
- Added Runtime Center, the shared abort/timeout/dedupe/revision query layer,
  cross-tab invalidation, RC.2 UI adapters and authoritative recovery health
  including Command Saga drift.
- Added governed Mission cancellation to Operations Center with target
  selection, reason, preview, state-hash CAS, expiry, exact high-risk phrase,
  Mission Kernel authorization and complete child-resource cleanup.
- Standardized every Military-owned tool rejection into a bounded, redacted
  envelope with one legal recovery tool and an exact RC.2-derived corrected
  argument shape.
- Made source archives Git-policy-derived and deterministic; build/release
  outputs, local reports, databases and credentials remain excluded even when
  packaging immediately after the full release gate.
- Added production-plane contracts for PostgreSQL/object store/durable
  queue/KMS adapters, local SQLite truth labels, topology readiness,
  correlated telemetry, capacity/backpressure and signed backup drills.
- Added the real-Provider Flash release gate: each exact configuration and
  scenario requires 50 independent Sessions, first-tool and E2E Wilson
  thresholds, and zero deterministic/safety violations. The gate only reads
  immutable Session/Host receipts and never launches or fabricates paid runs.
- Added migrations `0009` and `0010`, 217 deterministic tests, four ADRs and
  documentation Part 69. Real external Flash acceptance remains
  `INSUFFICIENT_SAMPLE` until a deployment supplies the required evidence.
- Final review serialized lifecycle mutations, made exact Dispatch replay
  side-effect free, rejected pre-start false settlement, settled no-Workspace
  child bindings, surfaced partial resource cleanup, authenticated Artifact
  reads, rebuilt the Artifact reference index during GC, and split the
  evaluation/ingestion/control/session/host/coordination hotspots by stable
  responsibility.

## 0.9.0-alpha.24 — 2026-08-27

### Installed multiline role-save repair

- Superseded the `alpha.23` candidate after installed-browser acceptance found
  that unchanged bundled role prompts were rejected by a generic single-line
  scalar parser before the role-specific validator ran.
- Role drafts now accept CR/LF/TAB as prompt whitespace while continuing to
  reject NUL and all other non-whitespace C0 control characters.
- Repeated the department model/parameter save, authoritative readback, page
  reload and process-restart gates against the immutable `alpha.24` artifact.
- Retained the `alpha.23` Host-owned General workflow gate, live DSH
  official/third-party model availability policy and adapter-owned reasoning
  translation without weakening any authority, evidence or verification gate.

## 0.9.0-alpha.23 — 2026-08-27

### General orchestration, all live DSH models, and durable role settings

- Added a Host-owned General workflow obligation for project execution:
  Mission start, Task creation, department-status read and department spawn
  are enforced one stage at a time. General prose cannot be treated as a
  substitute for department execution and verified receipts.
- Extended the completion interlock to General and reset its no-progress
  counter on every successful governed tool, so compact Flash steps advance
  without either bypassing the workflow or being falsely frozen.
- Made the DSH live adapter catalog the model-availability authority. Every
  connected official or third-party exact route is selectable in General,
  all departments and private-Skill extraction; capability/performance labels
  remain evidence and no longer act as permission gates.
- Added durable catalog-derived capability records and request-time
  translation from Military workload intensity to standard, custom or absent
  adapter-owned reasoning controls.
- Corrected role-setting persistence: one Settings CAS, serialized runtime
  projection across watcher/RPC concurrency, direct authoritative revision
  readback, stale-poll suppression and unambiguous preview/save controls.
- Corrected the installed RPC parser to pass multiline role prompts to the
  role-specific validator. CR/LF/TAB are valid prompt whitespace; NUL and
  other non-whitespace controls remain rejected, so model-only and numeric
  edits no longer fail because the unchanged bundled prompt contains lines.
- Added the exact `71fe7171` forensic fixture plus orchestration, third-party
  model, reasoning-adapter, interlock-reset, concurrent-save and React
  persistence regressions.

Real Provider output quality remains a separate external-session evaluation;
catalog availability and deterministic PASS do not claim performance
validation.

## 0.9.0-alpha.22 — 2026-08-27

### Installed evaluation completion projection

- Joined the asynchronous Settings evaluation lifecycle to the independent
  decision-center Remote projection with a bounded refresh token containing
  run nonce, state, report id, dataset hash and error state.
- A Host Job that reaches `COMPLETED` now refreshes the report catalog,
  selects the newest CURRENT immutable report and clears stale dataset detail
  without requiring the settings dialog to be closed and reopened.
- Added a React regression for the `IDLE → COMPLETED` projection transition.
  The installed browser exposed the issue after SQLite had already persisted a
  valid report while the UI still showed “尚无报告”.
- Rebuilt the exact RC.2 release and repeated the deterministic nine-scenario,
  report, seven-view, console, responsive and restart gates.

Real DeepSeek Provider behavior remains an explicit paid external Canary gate.

## 0.9.0-alpha.21 — 2026-08-27

### Reproducible performance evaluation and Flash decision governance

- Froze one canonical `PerformanceEvaluationRequest` dataset/artifact/hash for
  every Attempt, configuration shard, deterministic metric and report.
- Added Task version + Agent generation + lease sequence Attempt identity,
  bounded Session event windows, exact route/configuration strata and
  multi-source deduplication.
- Separated pre-execution difficulty, missingness and staged failure
  attribution from outcome-time rework, cancellation and infrastructure
  failures.
- Added Wilson/Mission-cluster rate intervals, deterministic clustered
  bootstrap for continuous metrics and differences, dynamic sufficiency and
  honest early/exploratory/eligible/regression states.
- Added same-role/same-difficulty exact-route Flash/Pro non-inferiority
  comparison. Permission, Evidence, regression, duplicate terminal,
  parent-wakeup and recovery-drift failures are non-economic hard gates;
  evaluation still cannot promote a model.
- Charged all failed/rework/retry usage to the final Accepted Outcome and added
  quality-first Token/latency/cost Pareto. Unknown pricing remains unavailable,
  never zero.
- Persisted Evaluation Jobs, Frozen Datasets, configuration shards, report
  lineage and appeals with lease/fence, structured timeout/failure and
  restart-only-missing-shard recovery.
- Added immutable report history and Evidence-bound appeals that create a new
  dataset and idempotent superseding report rather than editing old facts.
- Made narrative deterministic by default. The optional no-tool committee
  model sees bounded aggregate data, must return strict JSON and cannot alter
  metrics, decisions or promotion status.
- Added the seven-view performance decision center, visual timeout/baseline
  settings, failed-job retry, numeric uncertainty and quality-gated Pareto.
- Hardened the nine Provider scenarios to validate full tool/path/receipt/
  terminal/wakeup/recovery chains, deduplicated parser revisions and raised
  stability to at least 10 unique exact-route Sessions plus interval width.
- Added Request/Attempt/Frozen Dataset/Individual/Report Schema examples,
  durable restart and attribution regressions, seven-view UI coverage, and
  synchronized ADR/statistics/threat/runbook/traceability/single-spec docs.
- Registered the sixth Typert Remote without ECMAScript `#private` branding so
  it is compatible with the RC.2 Cordis service proxy receiver.

The deterministic suite now contains 156 tests. Real DeepSeek Provider
behavior remains an explicit paid external Canary gate.

## 0.9.0-alpha.20 — 2026-08-26

### Repeatable installed projections

- Copied immutable `SqliteStateRecords.listSync()` arrays before sorting
  benchmark runs, Provider samples, recovery receipts and recall simulations.
  A second installed benchmark run had exposed the native read-only-array
  assignment error even though all nine case results were `PASSED`.
- Expanded the suite to 148 deterministic regressions with a source guard for
  all four frozen-array ordering boundaries. The installed browser gate repeats
  the benchmark and recall workflows so the multi-record path is exercised.
- Bumped the artifact version so pnpm cannot reuse the pre-fix `alpha.19`
  tarball cache; exact RC.2 release, restart, browser and documentation gates
  are repeated against the new tarball.

Real DeepSeek Provider behavior remains an explicit external Canary gate.

## 0.9.0-alpha.19 — 2026-08-26

### Installed benchmark and recovery truth

- Corrected the fixed benchmark's governance fence. The immutable General
  `general-host-authority@0` sentinel is accepted exactly, while forged General
  authority and unversioned department permissions remain fail-closed; the
  installed nine-scenario run now passes all nine cases.
- Corrected recovery health to derive the current preset from the immutable
  archive pointer and exact DSH commit. It shows the running Bundle version
  separately from a generation's first-archive version instead of treating the
  impossible `ACTIVE` manifest status or every historical `CURRENT` label as
  runtime truth.
- Kept the suite at 147 deterministic regressions by extending the existing
  installed recovery test and adding the General/departments governance-fence
  case. Exact RC.2 release, restart, browser and documentation gates are
  repeated against the new tarball.

The version bump prevents pnpm from reusing the pre-fix `alpha.18` local
tarball cache. Real DeepSeek Provider behavior remains an explicit external
Canary gate.

## 0.9.0-alpha.18 — 2026-08-26

### Installed RC.2 Remote compatibility

- Replaced ECMAScript `#private` members in all five Typert Remote services
  with TypeScript-private members. RC.2 invokes Remote methods through the
  Cordis service proxy; native private brands rejected that receiver and made
  the installed role, recovery, workspace, benchmark and knowledge workbenches
  fail even though direct unit calls passed.
- Added a 146th deterministic regression that rejects native private members
  anywhere in the five RC.2 Remote services, plus real installed-browser
  exercise of every control-center boundary.
- Rebuilt and verified the self-contained Bundle/Installer on exact
  `dsh@0.1.1-rc.2` commit `b150a551...`; the version bump is intentional so
  pnpm cannot reuse the pre-fix `alpha.17` tarball cache.

The fifteen-part control center remains the `alpha.17` feature baseline.
Real DeepSeek Provider observations are still a separate deployment gate and
are never inferred from deterministic PASS.

## 0.9.0-alpha.17 — 2026-08-26

### Fifteen-part Military control center

- Replaced the 12 simultaneously expanded role forms with a searchable,
  filterable role directory and one guarded editor. Added atomic
  revision-fenced save, semantic diff, immutable history, rollback-as-new-
  revision, undo, portable import/export and external-update conflict handling.
- Added the actual six-layer Host prompt preview, deterministic Flash
  readiness codes, actual-ToolProfile offline simulation and an explicitly
  confirmed read-only live Canary. Canary results never auto-promote a model or
  widen authority.
- Added a capability-driven DSH live model catalog and economic/standard/deep
  budget presets with token, Simplified-Chinese-character, observed-usage and
  honest pricing-unavailable states.
- Added a user-confirmed Simplified-Chinese assistant that skips code, paths
  and identifiers. The Host recomputes selected replacements and persists
  source/result hashes in an immutable review receipt.

### Diagnostics, recovery, workspace and benchmark

- Added a Host-redacted Session timeline covering request route, visible tool
  surface, raw selection, Schema normalization, grants, paths, observed
  receipts, terminal state and direct-parent wakeup.
- Added SQLite/WAL, preset, Mission, Task, child, worktree, grant, outbox and
  receipt health with previewed, phrase-confirmed, idempotent database verify,
  backup, reconcile, stale-outbox requeue, expired-resource release and parent
  wake operations.
- Added a Specs workspace browser based exclusively on opaque Host catalog IDs.
  It reports canonical root/hash, Git HEAD/branch/tree/status, policy-scoped
  paths, leases, worktrees, Candidates, integrations and receipts without
  accepting arbitrary browser paths.
- Added the hashed nine-scenario `military-flash-core-v1` workbench. It keeps
  deterministic gates separate from exact-route Provider Session observations
  and refuses to label fewer than five samples stable.

### Knowledge transparency and accessibility

- Added sanitized snapshot/redaction/chunk/extraction previews and complete
  Candidate→review→version→promotion→Usage→revocation/inherited-source
  lineage to the Knowledge Center.
- Added no-Task/no-model recall simulation. Simulation and real Task delivery
  now share the same tag resolver, rights/lifecycle eligibility, ranking,
  candidate budget and applicability-card renderer; only the input hash and
  character count are persisted.
- Expanded Knowledge Center from six to seven views with “模拟召回”.
- Added native dialog/tab/tabpanel/listbox/option semantics, roving arrow and
  Home/End navigation, IME-safe shortcuts, initial focus, Tab focus trapping,
  trigger focus return, 200% zoom/long-label overflow hardening, forced-colors
  and prefers-contrast support.
- Kept both footer triggers geometrically identical to RC.2 `SettingsRoot`,
  including the final `overflow: hidden` property.

### Verification and documentation

- Expanded deterministic coverage to 145 tests, including clean-source build,
  forged Chinese review rejection, Workspace ID/path/Git rename behavior, fixed dataset
  identity and N<5 protection, sanitized knowledge transparency, durable
  recall simulation, and exact real/simulated delivery-block parity.
- Added the complete 15-part control-center chapter and synchronized WebUI,
  APIs, operations, benchmark, knowledge, installation, upgrade, rollback,
  test matrix and version documentation.

Real DeepSeek Provider observations remain a separate deployment gate. This
release does not treat deterministic PASS or N=1 as `VALIDATED`.

## 0.9.0-alpha.15 — 2026-08-26

### Native sidebar footer geometry

- Grouped Military Settings and Knowledge & Skills into one vertical
  `sidebar.footer.action` occupant, preventing the RC.2 footer's horizontal
  list seat from pushing a collapsed-rail hit target outside the viewport.
- Matched DSH `SettingsRoot` exactly in wide and collapsed modes: 42px
  full-row and 36px circular hit targets, margins, padding, radius, hover
  chrome, label overflow and primitive icon sizing.
- Added live dialog accessibility state to both triggers and extended WebUI
  behavior/theme regression coverage for the grouped footer.

No prompt, Mission, tool, persistence or governance behavior changed from
`alpha.14`.

## 0.9.0-alpha.14 — 2026-08-26

### Standalone Military settings dialog

- Replaced the generic `settings.section` registration with a first-class
  sidebar footer action beside Knowledge & Skills and an official RC.2
  headless Modal.
- Added the seven exact left-side primary tabs requested for models, execution
  and cost, Specs workspace, safety and recovery, tactics and tags,
  performance evaluation, and display and advanced settings.
- Kept the complete Settings mirror, model catalog, field controls and HMR
  lifecycle while inheriting DSH light/dark and responsive behavior.

### Executable Simplified Chinese role prompts

- Added bundled Simplified Chinese guidance for General and every one of the
  eleven department templates, written for stable Flash tool use.
- Added visible prompt editors, explicit save, per-role restore and one-click
  restore-all behavior.
- Persisted General guidance through live Settings and department guidance
  through immutable `AgentTemplateProfile` revisions, with automatic fallback
  for profiles created by older releases.
- Replaced the real General/child `deployment:persona` at prompt assembly and
  translated Military task, workspace and exact-tool guidance to Simplified
  Chinese.
- Appended immutable Host-owned tool, path, binding/grant, evidence and
  terminal boundaries after editable prose so customization cannot expand
  authority.
- Added prompt language/length/template-variable validation and regression
  tests covering defaults, execution, migration, UI save/reset and RC.2
  installed-profile requests.

## 0.9.0-alpha.13 — 2026-08-26

### Primitive cascade isolation

- Reduced the raw-button fallback selector to zero specificity so official
  RC.2 CSS-module primitives always own their radius, padding, active fill and
  interaction states.
- Replaced the generic minimum height with a normal compact height, preventing
  fallback rules from enlarging native 24px Pills.
- Extended regression coverage to reject future high-specificity raw-button
  selectors and verified final computed styles in the installed DSH Web.

No workflow or Host behavior changed from `alpha.12`.

## 0.9.0-alpha.12 — 2026-08-26

### Native component geometry follow-up

- Fixed the Military root adapter overriding RC.2 `Pill`'s official 24px
  height with the generic compact-button 28px minimum.
- Kept the seven Settings categories on one horizontally scrollable row,
  eliminating the orphaned final category at the built-in dialog width.
- Kept narrow-screen Knowledge navigation cells single-line and horizontally
  scrollable instead of shrinking labels into uneven vertical stacks.
- Added static and computed-style browser checks for the corrected primitive
  and responsive contracts.

No Mission, tool, model, private Skill, persistence or governance behavior
changed from `alpha.11`.

## 0.9.0-alpha.11 — 2026-08-26

### DSH-native WebUI component system

- Replaced parallel Military modal, status and action chrome with the official
  RC.2 `Modal`, `Button`, `Pill`, `StateDot` and close-icon primitives.
- Added the primitives package to the actual Bundle client injection graph and
  preserved the DSH-provided React/theme singleton at runtime.
- Unified Settings Center and Knowledge Center controls with DSH's field,
  capsule, card, navigation, elevated-surface and focus geometry.
- Removed obsolete `--bc-*`, `state-danger`, `state-warning`, hard-coded mask
  and shadow colors. All surface colors now inherit host `--dsw-*` aliases, so
  light and dark mode require no Military theme fork.
- Matched the built-in sidebar footer trigger and Settings navigation rhythm,
  and added responsive, keyboard-focus and reduced-motion contracts.
- Added release-blocking tests for the primitive dependency graph, token-only
  theme ownership and final single-module client artifact.

All Flash-first workflow, private Skill, Loader and safe local upgrade repairs
from `alpha.7` through `alpha.10` are included unchanged.

## 0.9.0-alpha.10 — 2026-08-25

### Safe local-file Profile upgrades

- Stopped recursively deleting the release directory before packing a new
  version. RC.2 Profiles retain exact `file:` references and pnpm must still be
  able to resolve the installed tarball while `dsh plugin add` replaces it.
- Current fixed-name metadata and checksums remain deterministic, while prior
  immutable Bundle and Installer tarballs stay at their original paths until
  no Profile refers to them.
- Documented the required retention/archive order and added a release-blocking
  regression against restoring destructive release cleanup.
- Verified the ordinary `alpha.9` → `alpha.10` RC.2 plugin upgrade path without
  manually rewriting Profile metadata.

All governed private Skill extraction, lifecycle, exact-version recall,
Flash-first workflow, Knowledge Center and real-browser module Loader repairs
from `alpha.8` and `alpha.9` are included.

## 0.9.0-alpha.9 — 2026-08-25

### Real-browser RC.2 client repair

- Replaced concatenation of independently compiled Settings and Knowledge
  modules with one esbuild browser bundle. This eliminates duplicate lexical
  identifiers that made Chrome reject `client.js` before Loader registration.
- Preserved the exact `@dsh-military/bundle` module ID and reduced the runtime
  external surface to RC.2's injected `react` singleton.
- Added a release-blocking emitted-artifact test that parses and executes
  `client.cjs`, observes `__ModuleLoader__.load`, invokes the module factory and
  verifies `inject`/`apply` exports.
- Bumped the version instead of overwriting `alpha.8`, preserving immutable
  release semantics after the installed-browser defect was found.

All private Skill supply-chain, lineage, governance, Flash progressive
disclosure and Knowledge Center capabilities from `alpha.8` are included.

## 0.9.0-alpha.8 — 2026-08-25

### Governed private Skill product flow

- Replaced split test/production ingestion behavior with one durable SQLite
  Source → Snapshot → Job → Chunk → Candidate → Review → Bundle → Promotion →
  Usage → Revocation pipeline and restart-safe idempotency.
- Added a six-view Military Knowledge Center over trusted Typert RPC. Raw bytes
  enter a separate vault and never pass through Settings, Session events,
  browser projections or model receipts.
- Added pre-model secret/PII redaction, injection isolation, stable chunks,
  no-tools Flash extraction, Host evidence aggregation and editable
  hash-bound user approval.
- Added visual source type, classification, license, retention, scope,
  Session/Artifact, dependency and multi-tag controls.

### Lifecycle, lineage and delivery

- Implemented DRAFT → SIMULATION → CANARY → TESTING → STABLE, controlled
  downgrade/restabilization, quarantine and exact-version delivery checks.
- `SUPPLEMENT` now requires a valid same-owner target, merges rather than
  replaces the existing procedure, and inherits the complete source lineage.
  Revoking any inherited source quarantines every affected derived version.
- Task recall derives matches from Task/workspace semantics and injects bounded
  applicability cards. Procedures longer than eight steps reuse
  `military_get_order({skillId})`; the Host derives the frozen exact version and
  rechecks live eligibility.
- Exact Skill usage/effect records are produced from Host-observed provider,
  tool, verifier, token and outcome evidence.

### Bundle integrity and concurrency

- Compiled complete Skill directories with concise `SKILL.md` plus
  `references/`, `examples/` and executable `scripts/`, following official
  progressive-disclosure guidance.
- Enforced unique frontmatter fields, 500-line/30-MiB budgets, slash-safe local
  paths, recursive Markdown reference closure, executable scripts and no
  managed symlinks.
- Integrity now binds immutable metadata, source lineage and every file
  path/hash/size/mode; provider list/get fail closed on metadata or disk
  tampering.
- Approval and promotion perform rights and lifecycle checks inside the SQLite
  transaction, closing revocation/approval and queued-promotion races.

### Verification

- Expanded deterministic coverage to 122 tests, including long input chunks,
  sanitization/injection, Flash schema recovery, concurrent idempotency,
  lifecycle transitions, supplement lineage, revocation, bundle tampering,
  progressive disclosure and Knowledge Center boundaries.
- Replaced lexical source concatenation in the RC.2 browser artifact with one
  esbuild module. The exact emitted bundle is now parsed, registered and its
  Loader factory invoked in tests, closing the duplicate-identifier failure
  found by real Chrome verification.

## 0.9.0-alpha.7 — 2026-08-25

### Lightweight models as the primary execution path

- General and all 11 built-in department templates now default to
  `deepseek-v4-flash/high` with bounded 16K output and executable context,
  step, no-progress, concurrency and timeout budgets; Pro remains an explicit
  per-role upgrade.
- Flash capability is recorded honestly as `CANARY`. Built-in templates
  explicitly opt in for external validation, while implicit fallback remains
  disabled.
- Task, Candidate, Tactical Request, Decision, Guidance and Specs inputs use
  shallow model drafts. The Host compiles identities, versions, scope,
  authority, evidence mapping, timestamps and idempotency.
- Tools are intersected by role, immutable Task authorization and current
  phase. Compact child briefs expose exact workspace and lease authority
  without internal Session or binding identifiers.

### Terminal durability and workflow convergence

- Candidate, Blocker, Radio, Decision, Guidance, Specs, Inspection and Research
  terminal mutations are fenced by durable Host receipts before parent
  delivery. Exact crash retries reuse canonical results; conflicting drafts
  fail closed.
- Parent delivery uses stable idempotency and can recover an already accepted
  RC.2 report from Session history after a Host crash.
- Successful terminal calls install a monotonic same-response latch. Later
  reads, writes or terminal calls in the same assistant response are rejected,
  while the continuable report wakes the parent General.
- Specs commits carry a deterministic order trailer and recover exact
  post-commit retries without creating a second Git commit. Candidate patches,
  integration orders and guidance IDs are likewise deterministic.
- Large Specs Tasks use Host staging followed by one atomic apply; ToolProfile
  parallelism and timeout overrides are enforced rather than decorative.

### Independent visual Military settings

- DSH Settings now has a `Military` section at the same navigation level as
  `Agent 预设`, with seven focused panels and no raw configuration workflow.
- General and every department template use dropdowns joined against the live
  DSH model catalog. Reasoning, output/context budgets, concurrency,
  compaction, lifecycle, Radio, Staff, Memory, Oversight, Specs, tags,
  evaluation and presentation have bounded visual controls.
- Template and tag writes are serialized and versioned; save rejection,
  reset, evaluation failure and page reload have deterministic feedback.
  Tool/permission profiles, terminal authority and fixed safety boundaries stay
  read-only so usability changes cannot reduce Military capability.

### Verification

- Added deterministic coverage for Flash contract budgets, phase visibility,
  one-round corrections, Worker/Engineer flows, terminal parent receipts,
  crash-safe Specs retry, semantic integration dedupe, live feature settings
  and rapid Web settings revisions.
- Replaced the stale aspirational settings schema/example with the exact 11
  RC.2 namespaces used by Host and Web Client.

## 0.9.0-alpha.6 — 2026-08-25

### First-request prompt/tool parity

- Military 通过 RC.2 公共 `registerContinuableSetup` 在 continuable 子 Agent
  发布前同步安装提示词变换，消除首请求中 Tool Schema 已收窄但 generic
  write/edit/bash/jobs 指导仍存在的生命周期竞态。
- 提示边界支持从 provisional role 标签更新为持久化 ToolProfile 修订而不重复
  注册 listener；冷恢复和后续请求保持同一变换。
- Engineer Specs 首请求固定为 9 个必要工具，Worker 实现请求最多 14 个；
  Task `allowedTools` 同时约束模型可见面与 Capability Grant。

### Engineer and Worker file workflow

- `military_specs_apply_order` 成为 Engineer 唯一的文件变更状态机：一次调用完成
  新建/完整替换、`git diff --check`、本地 main 精确提交、Mission Ledger
  receipt 与父级 report；独立 validate/commit 工具不再暴露。
- `military_specs_read` 支持文件或目录，目录递归枚举，缺失的 specs/docs 目录
  返回空起始状态；结构验证只检查 Task 实际文档，不再强制无关的 11 文件骨架。
- Worker 的 isolated worktree 协议明确要求 read/write/edit/glob/grep 使用精确
  绝对 execution root；Engineer Specs 参数使用 Task 相对文档路径。
- 真实 RC.2 Profile E2E 捕获并断言 Worker 与 Engineer 的第一个模型请求，
  并实际执行 Worker `write`、`edit`、Candidate、Verification 与 Integration。

### Git admission and forensic closure

- 仅未跟踪的 `.DS_Store`、`Thumbs.db`、`desktop.ini` 被视为无害桌面元数据；
  它们原地保留且不会阻塞 Specs、Worker snapshot 或 Integration。任何已跟踪
  元数据和其他工作区变更仍严格阻断。
- Git 提交只 stage/commit 精确授权的 material paths，既不提交也不删除用户
  的无害元数据。
- 新增 `4844eb48` 脱敏 fixture：6 个合法 JSONL、12,293 行、73 次工具调用、
  10 次错误。该样本全部由 `deepseek-v4-pro/high` 产生，因此继续保留真实
  Flash 外部 Provider 验收边界。

### Release

- 版本提升为 `0.9.0-alpha.6`，唯一支持基线仍为
  `dsh@0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。

## 0.9.0-alpha.5 — 2026-08-25

### Continuable child delivery

- 所有部门 ToolProfile 修订为 4，并显式允许 RC.2 在 continuable 子作用域安装的
  `report`；请求头、提示词和执行授权不再互相矛盾。
- 普通与关键报告均使用 RC.2 `next-step`：父 General 正在运行时在最近 step
  消费，已结束当前 turn 时自动启动后续 turn，不再依赖用户输入“继续”。
- spawn receipt 明确要求 General 结束当前 turn 等待自动报告，并声明 Session、
  Agent 与 binding identity 不是 Artifact，消除轮询和错误
  `military_read_artifact` 调用。
- 显式用户取消产生的纯 settlement wake 在模型请求前一次性消费；若同一批次
  包含真实用户输入或其他有效报告则正常继续。

### Engineer filesystem and Specs contract

- Task 文件授权允许本地 main Engineer 在 Session cwd 与 execution root 完全
  相同时省略/使用相对路径；隔离 Worker worktree 继续要求精确绝对路径。
- `military_specs_apply_order` 改为 Flash 友好的浅层 `updates[]` 合同。模型只
  提交 document、purpose 与完整 content；Mission、Task、trigger、source
  events、allowed paths、validation、commit policy 和时间戳均由 Host 编译。
- Git 状态使用 `--untracked-files=all`，新目录不再折叠成 `specs/` 并迫使模型
  扩大授权；每个新文件可以按精确路径校验和提交。
- Specs commit 成功后写入 Mission Ledger 并主动向父 General 投递自包含 receipt；
  即使后续 Agent 被策略停止，父会话也不会再误判“文件未写入”。

### Execution convergence and forensic coverage

- Task-bound Execution Strategy 的 step 上限与不可变 Task `modelSteps` 对齐，
  不再用固定 8 步截断 16 步任务；另保留一个只能调用 terminal/report 工具的
  finalization grace step。
- 同一 `taskKey` 指向不同不可变草稿时返回不可重试的
  `IDEMPOTENCY_CONFLICT`，并给出已有 taskId 与唯一读取恢复路径。
- General persona 不再在请求路由完成前声明可能过期的模型名；当前 request
  header 始终是 provider/model 权威来源。
- 新增 `c21a6c55` 脱敏 fixture 与父子时间线、报告授权、路径、Specs、Git、
  step budget、取消竞态回归；自动测试增加至 95 项。

### Release

- 版本提升为 `0.9.0-alpha.5`，唯一支持基线仍为
  `dsh@0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。

## 0.9.0-alpha.4 — 2026-08-24

### Flash prompt/tool parity

- RC.2 的 `system-prompt/assemble` 现在按每次请求实际公开的 Tool Schema
  同步模型提示；被 ToolProfile 隐藏的 `bash`、`glob`、`read`、`write`、
  `edit`、`grep`、`jobs` 与 Web 工具不再以正向用法残留在系统提示中。
- 每个 Agent 的提示尾部加入确定性的 Military 工具边界，只列出当前请求真实
  可调用的工具名；General 的仓库只读发现统一通过无 Task 的
  `advisor-generalist` 子 Agent 完成。
- General 对越权工具名的拒绝返回稳定 `POLICY_DENIED` JSON，并给出唯一可执行
  恢复路径，避免轻量模型在不可见工具上循环重试。

### Compact status and regression evidence

- `military_status` 只返回每个模板 ID 最新的 `ACTIVE`/`CANARY` 修订以及必要的
  兼容性、Preset 与策略字段，不再重复输出 33 个历史模板修订。
- 新增真实 `573e3540` Session 脱敏 fixture、提示/工具一致性测试、紧凑状态
  上限测试，以及真实 RC.2 Profile 组装断言。
- 自动测试增加至 87 项；静态 review 与 semantic release audit 新增
  Flash prompt/tool parity 阻断门禁。

### Release

- 版本提升为 `0.9.0-alpha.4`，Bundle、Installer、内部依赖闭包、Preset
  manifest、文档和发行脚本保持同一版本。
- 唯一支持基线仍为
  `dsh@0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。

## 0.9.0-alpha.3 — 2026-08-24

### Session workspace and Git isolation

- Workspace Snapshot、Specs 和本地 Git 现在统一从根 Military Session 的绝对
  `workspaceKey` 与不可变 Snapshot 解析，不再把 Web 进程 cwd 或插件源码根
  当作用户项目。
- 根 Session 缺少绝对 `cwd` 时直接拒绝绑定；不再以 Web 进程目录作为隐式
  工作区。Department Session 只能继承已持久化的根绑定。
- Worker 写租约与 Engineer 只读任务租约均绑定精确 Task、角色、版本和
  Snapshot；多 Session 使用独立仓库对象，Integration 通过 Candidate Patch
  反查其权威仓库。
- Specs 写入改为串行原子事务：先校验完整 order、路径、内容、命令和干净
  HEAD，再写入；校验、提交或中止失败会恢复文件、index 与 HEAD。

### Flash tool-call recovery

- `workspace-snapshot-*` 由专用 Snapshot resolver 返回结构化 JSON，不再误送
  Artifact store。
- Tool Pipeline 只结算实际通过 admission 的调用；权限/路径拒绝保留原始原因，
  不再被 `unknown reservation` 覆盖。
- General 与部门 Agent 均执行完整不可变 ToolProfile；General 默认不能调用
  `bash`、任意文件工具或 shell sleep 轮询。
- Specs validation 在模型 Schema 中公开唯一枚举 `git diff --check`，所有
  Military 领域错误返回稳定的机器可读 code、message、retryability 和 recovery。

### Execution convergence

- 真实模型循环强制执行 General policy、Execution Strategy 与 Task budget
  三者中最严格的 step 上限。
- `maximumNoProgressTurns` 进入 live oversight settings；连续无进展达到阈值
  后冻结并中止 Agent。
- 用户中止、超步数和无进展中止都会取消关联 Task、撤销资源并释放 Workspace
  与并发占位，内存和 SQLite reducer 共享 `task/cancelled` 终态。
- 新增第二份真实 Flash Session 脱敏回归 fixture，确定性覆盖该 Session 暴露的
  七类宿主边界故障。

### Release

- 版本提升为 `0.9.0-alpha.3`，Bundle、Installer、内部依赖闭包、Preset
  manifest、文档和发行脚本保持同一版本。
- 自动测试增加至 82 项，并继续以精确
  `dsh@0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
  为唯一支持基线。

## 0.9.0-alpha.2 — 2026-08-24

### Baseline

- 将唯一兼容基线固定为 `dsh@0.1.1-rc.2` commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 所有 DSH peer/dev dependency、Schema、Catalog、Preset generation、
  Installer、Compatibility Probe、文档和报告使用同一基线。
- exact typecheck 直接消费官方已构建 checkout 的声明；本地 stub 不作为发行
  证据。

### Runtime correctness

- Mission command admission、领域事件、projection、receipt 与 outbox 进入同一
  SQLite Unit of Work；重复命令跨进程保持幂等。
- Task、Candidate、Verification、Grant、Policy、Template、Budget、
  Authorization、Radio、Decision、Oversight、Compaction 与 automation 状态
  可持久化或从权威 Ledger 无损恢复。
- 路径 canonicalization 和 scope 检查先于 Grant 消耗；Tool、Model、Spawn、
  Radio 与 Rework 均接入 Authority/Budget admission 和宿主观察值结算。
- Git Integration 持久化 order/attempt/receipt，并在崩溃窗口通过 HEAD、
  trailer 和 tree hash 对账。
- Candidate 只能引用实际宿主观察的 evidence；伪造、跨 Task、过期或失败证据
  被拒绝。

### DSH integration and UI

- 修正 RC.2 Host/Preset Cordis 服务拓扑、inject 合同、TokenMeter API、
  continuable child、reasoning effort、Schemastery 和 Web Client manifest。
- WebUI 使用稳定 `useSyncExternalStore` snapshot，同步外部 Settings 更新，并
  在 fiber dispose/HMR 时清理注册。
- 真实 RC.2 Profile E2E 覆盖 Tool、continuable Worker、Settings、Web Client、
  Mission → Task → Verification → Integration、故障注入、重复命令和两次恢复。

### Flash 工具合同修复

- 将 16 个工具中的 17 个空结构参数替换为完整数组、枚举、对象、`oneOf` 与
  required Schema；一次返回全部 canonical validation 问题。
- `military_task_create` 改为浅层语义草稿，由 Host 确定性生成 Mission、
  Direction、Wave、Task identity、版本、复杂度、安全默认值、环境快照和证据
  条款。
- `/brainstorm` 的既有 Mission 可由 `military_get_context` 发现；重复 Mission
  start 返回 `EXISTING`，不再建立冲突 projection。
- Mission Snapshot 的 `ReadonlyMap` 在 RC.2 JSON 边界前转为稳定排序数组。
- General 首次 request 前只保留 15 个角色允许的 Military 工具；部门 Agent
  继续由 immutable ToolProfile 与 Capability Grant 双重约束。
- 将用户提供 Session 的 11 次调用/7 次失败脱敏固化为 benchmark fixture。
  修复后的真实 Provider 验收尚待新 Session，因此 Flash profile 暂为 `DRAFT`
  且不参与自动 fallback，显式 Session 选模保持可用。

### Packaging and release

- Bundle 嵌入全部私有运行时 package；Installer 嵌入 Contracts 与 Preset。
- 13 个 package 全部提供 `./invariant` 并通过 pack/publint。
- 提交可信 pnpm lockfile；`pnpm install --frozen-lockfile` 通过。
- 发行目录生成两个可安装 tarball、`checksums.sha256`、安装/升级/回滚说明、
  版本与 E2E 报告；两次独立打包 SHA-256 一致。
- 删除过期 generation、旧兼容报告和会误导当前实现的基线文档。
