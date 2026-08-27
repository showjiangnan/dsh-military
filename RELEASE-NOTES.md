# dsh-military release notes

## 0.9.0-alpha.25 — DSH RC.2

This release completes the execution-liveness and production-truth audit that
followed the `alpha.24` installed repair.

Every executable user request now has its own durable Workflow Obligation.
Task instruction versions are separate from execution Attempts; every initial
run, Rework, Guidance continuation and Decision continuation receives a new
Attempt, Activation and Dispatch. A Session snapshot is historical evidence,
not a liveness proof: only durable start/heartbeat receipts can report
`RUNNING`, and settlement closes only the exact Activation.

Radio, Decision and parent wakeup now carry exact Task/Attempt fences.
Candidate acceptance proceeds through Verification and controlled
Integration before the Host reducer can issue Completion. Conflict, stale
head and regression failure cannot retain a successful terminal state.
Worker and Engineer file calls use Task-rooted relative-path tools, durable
operation IDs and status queries, which removes deterministic absolute-path
failures and prevents blind retries after timeouts.

SQLite no longer holds a transaction over model, Provider, Git, filesystem or
verification I/O. Command execution uses short durable Saga checkpoints:
`PENDING_EFFECT`, `RETRYABLE`, `EFFECT_APPLIED` and `COMMITTED`. The
transaction API rejects asynchronous callbacks, and every standalone public
SQLite write is automatically enclosed in its own short `BEGIN IMMEDIATE`
transaction. Only startup PRAGMAs and `VACUUM` use the explicit maintenance
boundary. Tool evidence and budget
settlement use all-settled handling plus the ordered transactional outbox, so
post-hook failure does not silently abandon recovery.

The Web delivery adds an authoritative Runtime Center, a shared
timeout/abort/dedupe/revision query layer, cross-tab invalidation and thin
RC.2 UI adapters. Role settings expose Desired versus Applied revisions.
The Operations Center can now cancel an exact Mission through a high-risk
preview/CAS/expiry/confirmation flow. Cancellation goes through Mission
Kernel authority, then releases every persisted/live child Grant, budget,
capacity reservation and Workspace lease; it is intentionally distinct from
stopping one invocation.
Principal-aware Remote authorization, Artifact ACL/classification/retention,
dispatch-policy receipts, provider topology, capacity, telemetry and signed
backup/restore evidence are now explicit production contracts. Local SQLite
mode remains supported and is never labeled as distributed PostgreSQL,
object storage, external queue or KMS.

All Military-owned tool failures now use one bounded and redacted recovery
envelope: stable code/message/retryability, exactly one `nextTool`, and the
exact corrected argument shape derived from the installed RC.2 schema. Secret
material and host absolute paths are never reflected to a lightweight model.
The source packer now archives the Git-visible source set instead of walking
the working directory, so release verification cannot contaminate a
source-only handoff with `lib/`, tarballs, local reports, runtime data, or
credentials.

The Flash workbench now computes a strict external acceptance result from
immutable exact-route Sessions and Host-observed receipts. Every exact
configuration × scenario requires at least 50 independent Sessions,
first-tool point estimate ≥95% with a 95% Wilson lower bound ≥85%, E2E
completion ≥90% with lower bound ≥80%, and zero unexpected deterministic
failures, unauthorized writes, false completions or duplicate terminals.
The UI can export this evidence and `npm run acceptance:flash` independently
recomputes the gate. No paid calls are launched by the repository, and this
release does not claim real Flash acceptance without those external samples.

The source includes migrations `0009`/`0010`, 216 deterministic tests, four
new ADRs and documentation Part 69. It remains pinned exclusively to DSH
`0.1.1-rc.2` commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

The final review also serialized in-memory lifecycle mutations, fenced
Task/Mission lineage, made Dispatch replay side-effect free, prevented
pre-start false settlement, and converged child resources even when a
Staff/Advisor binding has no Workspace. Artifact reads now authenticate and
rehash cleartext; GC reconstructs the authority index, deletes metadata-free
crash orphans, and fails closed if retained metadata has lost its Blob.
Evaluation, ingestion, Control Plane, Session, Host Runtime, and SQLite
coordination responsibilities are split into reviewable modules without
changing their public package barrels.

## 0.9.0-alpha.24 — DSH RC.2

This immutable release supersedes the `alpha.23` candidate after real installed
browser testing exposed one additional settings-save failure. A role draft
always includes the role prompt, even when the user only changes a model or a
numeric parameter. The RPC parser previously passed that prompt through a
generic single-line scalar reader, which rejected the CR/LF characters in the
bundled multiline Chinese prompts. Preview therefore failed before the
settings CAS could run.

Role prompts now go directly through the dedicated prompt validator. CR, LF
and TAB are accepted as normal prompt whitespace; NUL and the remaining
non-whitespace control characters are still rejected. Regression coverage
uses the actual multiline Engineer prompt shape and proves that an invalid NUL
still fails closed.

`alpha.24` otherwise retains the complete `alpha.23` repair: General project
requests must advance through Mission, Task, department selection, department
execution and verified receipts; every exact model route present in the live
DSH adapter catalog is selectable regardless of Military performance-sample
status; provider-owned reasoning vocabularies are adapted at request time; and
role saves use one settings CAS, serialized runtime projection and
authoritative revision readback.

## 0.9.0-alpha.23 — DSH RC.2

This release fixes three installed behaviors observed in the user-supplied
`71fe7171` Military Session.

First, General project requests now carry a Host-owned workflow obligation.
For each step the Host computes exactly one legal next stage—Mission, Task,
department-status read, department spawn, or tactical recovery—and the
turn-stopping interlock continues a Flash turn that attempts to finish before
that stage is complete. A successful Military tool resets the no-progress
counter. General may still answer ordinary questions directly, but it cannot
use generated code, patches, complete files or “save this yourself” prose as
the accepted substitute for a governed department result.

Second, current DSH adapter membership is now the model-availability
authority. Every connected official or third-party provider/model route is
selectable throughout Military. The Host creates a durable execution
capability projection the first time it sees a route. Validation, Canary,
deprecated and performance-sample labels remain visible evidence, but they no
longer block a live model. At request time Military translates its logical
`high/max` workload intent to the adapter's exact effort, uses its default or
preferred custom effort when necessary, and omits the field for models with no
reasoning control. No automatic provider fallback or performance promotion is
introduced.

Third, role configuration save now converges on one authoritative revision.
Settings CAS remains the durable transaction. Runtime projection is serialized
between the Settings watcher and save RPC, the RPC waits for projection, and
the browser performs a direct post-save read that cannot be suppressed by the
five-second polling request or overwritten by an older snapshot. Model
selection also clamps output/context budgets to the catalog route. The two UI
actions are explicitly named “检查并进入保存确认” and “保存配置”. Private-Skill
extraction now uses the same live DSH model directory. Installed-browser
testing additionally found that the generic scalar reader rejected CR/LF in
the unchanged bundled role prompt before the prompt-specific validator ran.
Role drafts now accept multiline prompt whitespace while still rejecting NUL
and other non-whitespace control characters.

The forensic fixture preserves the archive hash, 2,482 valid JSONL lines,
four max-token turns, one Mission call, zero Task/spawn calls and 37,362
characters of direct implementation output. Deterministic tests cover the
post-fix stage machine, no-reasoning/custom-reasoning adapters, third-party
selection, runtime synchronization races and React persistence. The release
remains pinned exclusively to DSH `0.1.1-rc.2` commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## 0.9.0-alpha.22 — DSH RC.2

This release replaces the former summary-style performance card with a
reproducible, restart-safe decision system designed to determine whether
DeepSeek V4 Flash can serve as the economical primary model without weakening
quality, tool discipline or Military governance.

The Host now freezes one canonical evaluation dataset and uses its exact
artifact/hash throughout Attempt attribution, configuration shards,
deterministic metrics and the immutable report. Attempt identity includes Task
version, Agent generation and lease sequence; bounded event windows prevent
old tools, terminals, acceptance or parent wakeups from leaking into a new
attempt. Flash, Pro, fallback, alias, Prompt, Thinking, ToolProfile,
PermissionProfile, Bundle and DSH revisions are never mixed.

Statistical and economic decisions are now explicit:

- binary rates carry Wilson/Mission-cluster intervals;
- Token, latency, cost and Flash/Pro differences use reproducible
  Mission-cluster bootstrap intervals;
- pre-execution difficulty and missingness are separated from outcome-time
  rework, blockers and user intervention;
- Flash/Pro non-inferiority is gated by exact route, task/difficulty balance,
  evidence, permission, regression, terminal, parent-wakeup and recovery
  invariants;
- all failures, rework and retries are charged to the final Accepted Outcome;
  unknown Provider pricing remains unavailable and never participates as zero;
- evaluation can only recommend a Canary or promotion review;
  `promotionAllowed` remains false.

Evaluation Jobs, datasets, completed configuration shards, reports and appeals
are persisted in SQLite/Artifact storage with revision, lease and fence
semantics. Timeout or process restart preserves completed shards and retries
only missing work. Appeals never edit a report in place; an upheld challenge
freezes a new dataset and creates an idempotent superseding report revision.
Deterministic narrative is the default. The optional committee model receives
only bounded aggregate data, has no tools, passes strict JSON validation and
falls back without changing metrics or decisions.

The `Military-绩效评估` page now exposes seven governed views: decision
overview, role/Flash-Pro comparison, nine-scenario heatmap, tool-failure
funnel, quality-first Pareto, dataset/Evidence, and report history/appeals.
The Settings execution scope and the report Remote remain separate Host
projections, but their lifecycle is now joined by a revision token containing
the run nonce, state, report id, dataset hash and error state. A background Job
that reaches `COMPLETED` therefore refreshes the decision center and selects
the newest CURRENT report without requiring the user to close and reopen the
dialog. This behavior was found and verified in the installed RC.2 browser,
then retained as a React regression.
Provider benchmark samples are deduplicated by dataset + Session + scenario
and require at least 10 exact-route Sessions plus a sufficiently narrow Wilson
interval before a stability claim. The sixth RC.2 Typert Remote follows the
proxy-receiver constraint and does not use ECMAScript private branding.

The release includes 156 deterministic regressions and refreshed Request,
Attempt, Frozen Dataset, Individual and Overall Report schemas/examples,
statistics protocol, ADR, threat model, runbook, traceability and single-file
design specification.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Real post-fix DeepSeek Provider behavior remains an explicit paid external
Canary gate; local deterministic PASS is never presented as Provider proof.

## 0.9.0-alpha.15 — DSH RC.2

This release corrects the sidebar footer geometry found during installed
browser acceptance of `alpha.14`. DSH RC.2 renders all
`sidebar.footer.action` occupants in one horizontal flex seat. Registering the
Military Settings and Knowledge & Skills buttons as two independent occupants
therefore placed them side by side in the collapsed 56px rail; one hit target
partly left the viewport and the footer rhythm no longer matched DSH Settings.

Both destinations now live in one vertical footer occupant. Each button uses
the exact RC.2 `SettingsRoot` trigger contract:

- full-width `42px` rows with the same margins, padding, radius, typography,
  hover surface and overflow behavior in the expanded sidebar;
- centered `36px` circular hit targets with the same margins and padding in
  the collapsed rail;
- DSH primitive icons at the same `16px`/`18px` sizes;
- `aria-haspopup="dialog"` and live `aria-expanded` state.

This preserves two independent dialogs while preventing horizontal overflow.
Installed-browser acceptance compares computed rectangles and styles against
the real DSH Settings button in both sidebar states. No Mission, model,
prompt, tool, persistence or governance contract changed from `alpha.14`.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 0.9.0-alpha.14 — DSH RC.2

This release moves Military configuration out of the generic DSH Settings
section and gives it the same first-class sidebar treatment as Knowledge &
Skills. The new `Military 设置中心` footer action opens an official RC.2
headless `Modal` with seven fixed primary navigation items:

- `Military-部门模型`
- `Military-执行与成本`
- `Military-Specs 工作区`
- `Military-安全与恢复`
- `Military-战术与标签`
- `Military-绩效评估`
- `Military-显示与进阶`

The department-model view now shows the complete bundled Simplified Chinese
role prompt for General and all eleven department templates. Users can edit
and explicitly save each prompt, restore one bundled prompt, or restore all
twelve prompts in one action. General guidance is stored as a live Settings
override; department guidance is persisted in the next immutable template
revision. Profiles created by older releases need no migration because a
missing override resolves to the bundled prompt for that template id.

This is an executable prompt path, not display-only metadata:

- General's `deployment:persona` is replaced at prompt assembly;
- each continuable child receives the exact effective prompt from its frozen
  template revision;
- role prompts, task delivery rules, workspace instructions and exact-tool
  guidance are written in Simplified Chinese for Flash;
- the Host appends non-editable tool, workspace, binding/grant, evidence and
  terminal-action boundaries after user-editable prose;
- prompt edits therefore cannot grant a tool, expand a path, change a model
  binding, weaken independent verification or bypass a terminal receipt.

Validation bounds editable text to 32–12000 characters, requires Simplified
Chinese prose, permits Latin text only for necessary technical identifiers,
and rejects unknown `{{...}}` variables. Regression coverage includes legacy
fallback, Prompt Assembly replacement, immutable Host boundaries, all twelve
visible editors, save/reset revision behavior, the seven-tab information
architecture and installed RC.2 first-request prompts.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

A live post-fix DeepSeek V4 Flash provider sample remains an external Canary
acceptance boundary rather than a simulated release claim.

## 0.9.0-alpha.13 — DSH RC.2

This release is the immutable successor to `0.9.0-alpha.12`. Computed-style
acceptance caught one deeper cascade issue after the first Pill-height fix:
the scoped fallback rule for raw HTML buttons carried specificity from two
`:not([data-*])` selectors. It could therefore override an official
CSS-module primitive's radius, padding and active fill even when the rendered
height was correct.

`0.9.0-alpha.13` makes the fallback selector zero-specificity with `:where(...)`
and assigns a normal `height` rather than `min-height`. Official RC.2
primitives now always win the cascade with their own class contract, while
unclassified raw actions still receive the DSH compact-button fallback.

Real-browser computed style now observes:

- Settings category `Pill`: 24px high, 12px radius and native active fill;
- text/select fields: 32px high and 8px radius;
- cards: 12px radius with DSH border/surface aliases;
- Knowledge Center: native 24px modal surface and 28px close/action controls.

No Mission, tool, model, private Skill, persistence or governance behavior
changed.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

A live post-fix DeepSeek V4 Flash provider sample remains an external Canary
acceptance boundary rather than a simulated release claim.

## 0.9.0-alpha.12 — DSH RC.2

This release is the immutable successor to `0.9.0-alpha.11`. Real-browser
acceptance of the native-component migration found two final layout conflicts:
the Military root's generic compact-button rule raised an official 24px
`Pill` to 28px, and the responsive Knowledge Center allowed navigation labels
to wrap into uneven multi-line cells.

`0.9.0-alpha.12` closes those visual-contract defects without changing any
Mission, model, tool, Skill, SQLite or governance behavior:

- internal Settings category pills retain the official RC.2 24px height;
- the category strip stays on one scrollable line instead of leaving one
  orphaned wrapped item in the 800px Settings dialog;
- Knowledge Center's narrow-screen navigation uses non-wrapping, horizontally
  scrollable 40px cells;
- computed-style browser acceptance verifies the 24px Pill, 32px field, 12px
  card, 24px modal surface and 28px close/action contracts.

All DSH-native component/theme work from `alpha.11` and every Flash/private
Skill/runtime repair from preceding releases remain included.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

A live post-fix DeepSeek V4 Flash provider sample remains an external Canary
acceptance boundary rather than a simulated release claim.

## 0.9.0-alpha.11 — DSH RC.2

This release is the immutable successor to `0.9.0-alpha.10`. It preserves the
complete Flash-first workflow and governed private Skill supply chain while
making DSH Web's own RC.2 design system the single visual language for every
Military surface.

The Settings Center and Knowledge Center now:

- reuse the official `Button`, `Pill`, `StateDot`, `Modal` and close-icon
  primitives instead of maintaining parallel component chrome;
- declare `@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2` in the real
  Bundle client graph, preserving the host React and theme singletons;
- use DSH's 32px fields, compact/full capsule actions, 12px cards, 24px modal,
  188px navigation rail and standard focus geometry;
- resolve every UI color through `--dsw-*` aliases, including status, hover,
  borders, elevated surfaces and the modal mask;
- inherit light and dark themes directly from DSH without plugin-owned theme
  literals or obsolete `--bc-*`/danger/warning aliases;
- match the built-in Settings footer trigger and navigation-cell rhythm;
- retain responsive rail collapse, keyboard focus, Escape/mask close and
  reduced-motion behavior.

The client build inlines the small Military layout sheet into the existing
single `client.cjs`; no independent theme or runtime CSS asset is installed.
Release-blocking tests verify the primitive dependency graph, token-only theme
ownership, responsive/focus contracts and executable module-loader factory.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

A live post-fix DeepSeek V4 Flash provider sample remains an external Canary
acceptance boundary rather than a simulated release claim.

## 0.9.0-alpha.10 — DSH RC.2

This release is the immutable successor to `0.9.0-alpha.9`. It retains all
private Skill, Flash-first workflow and real-browser Loader repairs from the
preceding releases and closes the local-file Profile upgrade failure found
during installed-release acceptance.

RC.2 records the installed Bundle as an exact `file:` dependency. During
`dsh plugin add`, pnpm resolves that existing path before replacing it with the
new artifact. The former release builder deleted the complete `release/`
directory first, so building the successor could make an otherwise valid
Profile impossible to upgrade.

`0.9.0-alpha.10` makes release retention part of the verified contract:

- fixed-name release metadata is regenerated for the current version;
- immutable Bundle and Installer tarballs from prior versions remain at their
  original paths until no Profile refers to them;
- release documentation explains the safe upgrade and archive order;
- a release-blocking regression prevents recursive deletion from returning;
- the installed `alpha.9` Profile is upgraded through the normal RC.2 command,
  without manually editing its dependency path.

The release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

A live post-fix DeepSeek V4 Flash provider sample remains an external Canary
acceptance boundary rather than a simulated release claim.

## 0.9.0-alpha.9 — DSH RC.2

This release is the immutable successor to `0.9.0-alpha.8`. It contains the
complete governed private Skill supply chain described below and repairs the
real-browser RC.2 Loader failure discovered during local installation
acceptance.

The previous build concatenated three independently compiled Web modules into
one function scope. Settings Center and Knowledge Center both declared lexical
style names such as `headerStyle`, so Chrome rejected the client before
`window.__ModuleLoader__.load(...)` could register
`@dsh-military/bundle`. Static composition and server-only Profile probes could
not observe that JavaScript parse failure.

`0.9.0-alpha.9` makes the browser artifact one real esbuild module:

- module-local identifiers are bundled and renamed without collisions;
- only the RC.2-provided `react` runtime remains external;
- the emitted artifact keeps the exact `@dsh-military/bundle` Loader identity;
- a regression compiles and executes the final `client.cjs`, observes
  registration and invokes the factory before release;
- real Chrome acceptance verifies plugin boot, the independent Military
  Settings section and the six-view Knowledge Center after installation.

The release is pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Its deterministic gate contains 122/122 automated tests and 743/743
documentation checks. The release artifacts are:

- `dsh-military-bundle-0.9.0-alpha.9.tgz`
- `dsh-military-installer-0.9.0-alpha.9.tgz`

As before, a live post-fix DeepSeek V4 Flash provider sample remains an
external Canary acceptance boundary rather than a simulated release claim.

## 0.9.0-alpha.8 — DSH RC.2

This release remains pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

### Governed private Skill supply chain

`0.9.0-alpha.8` turns private Skill extraction from a design surface into one
durable Host-owned product flow:

```text
Knowledge Center
→ Raw Vault
→ sanitize / injection scan
→ stable chunks
→ no-tools Flash extraction
→ Host evidence aggregation
→ editable user review
→ immutable DRAFT bundle
→ SIMULATION → CANARY → TESTING → STABLE
→ exact-version Task recall and usage result
→ source revocation, quarantine and impact report
```

- Source, Snapshot, Job, Chunk, Candidate, Review, Bundle, Promotion, Usage,
  Knowledge Source and Revocation share one SQLite repository and idempotency
  model. Crash recovery resumes from the last durable chunk without repeating
  already committed model work.
- Raw source bytes, sanitized artifacts and compiled Skill bundles use
  physically separate stores. Raw bytes cross the trusted Typert RPC boundary
  once and are excluded from Settings, Session events, logs, projections and
  model-facing receipts.
- Secret/PII redaction and prompt-injection classification run before any model
  call. Restricted or unauthorized material fails closed; unknown rights can
  produce only a user-private DRAFT.
- The Flash extractor has no tool surface and accepts one bounded JSON object.
  It can safely recover one JSON code fence and omitted optional risk or
  validation lists, but rejects prose, extra keys and reported tool calls.
- Approval binds the acting user, candidate hash, diff hash, scope and
  immutable receipt in the same transaction as DRAFT publication. Promotion
  rechecks current lifecycle and every live source right inside the transaction.
- SQLite races are deterministic: revocation queued before approval prevents
  publication, and sequential queued promotions record their true current
  `from` lifecycle rather than a stale pre-transaction observation.

### Skill format, progressive disclosure and integrity

Every approved version is compiled as a complete immutable directory:

```text
SKILL.md
references/procedure.md
examples/minimal.md
scripts/verify.mjs
bundle.snapshot.json
```

- `SKILL.md` has exactly one `name` and one `description`, a bounded trigger
  description, no more than eight compact workflow steps and explicit safety
  conditions. Evidence, rights, dependencies, lineage, risks and full
  procedure detail live one level down.
- Local Markdown references are closed across every Markdown file. Absolute
  paths, path escapes, missing nested references, duplicate frontmatter fields,
  oversized files, non-executable verifier scripts and managed symlinks are
  rejected.
- Bundle integrity covers immutable Skill identity, name, description, source
  lineage, creation time and every file path/hash/size/executable bit. The DSH
  provider recomputes the same payload and hides any repository or on-disk
  tampering.
- Task recall freezes exact `skillId@version` references. A compact card gives
  Flash up to eight steps; when more detail exists, it asks for exactly one
  existing shallow call, `military_get_order({skillId})`. The Host derives the
  frozen version, rechecks live delivery eligibility and returns the complete
  evidence-bound procedure.
- No extra progressive-disclosure tool is added, so lightweight roles retain
  their small phase-specific tool vocabulary.

The directory organization follows the discovery and progressive-disclosure
principles in Claude's official
[Skill creation guide](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)
and
[Agent Skills best practices](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices).
DSH still uses its own RC.2 dynamic Skill Provider; this release does not
depend on the Claude Skills API.

### Supplement lineage, rights and effectiveness

- `SUPPLEMENT` requires an existing non-quarantined private Skill owned by the
  same user. Invalid target/outcome combinations fail before extraction.
- A supplement merges, rather than replaces, the base workflow, tags,
  preconditions, stop conditions, verifiers and provenance. The new immutable
  version inherits every source snapshot before adding the new source.
- Approval, promotion, list/get, Task recall and each model pre-step evaluate
  the complete inherited lineage. Revoking any ancestor source quarantines all
  affected derived versions and creates an auditable impact record.
- Candidate completion records the exact Skill version, Task/Mission, Host
  match reasons, actual provider/model, observed tool evidence, verifier
  receipts, result, session-observed tokens and an explicit unavailable-cost
  status when RC.2 has no authoritative provider price catalog.

### Knowledge Center

Military now exposes six visual views backed by trusted RPC:

1. source material;
2. extraction jobs;
3. review candidates;
4. private Skill library;
5. versions and promotions;
6. revocation and impact.

The source form provides visual source type, classification, license,
retention, visibility, Session/Artifact selection, dependency and tag controls.
Candidate review shows sanitized evidence, risks, validation and diff without
requiring users to edit JSON.

### Verification and artifacts

The deterministic release gate covers 122 automated tests plus strict local and
exact-checkout typecheck, generation, build, repair regressions, semantic audit,
static review, documentation validation, 13/13 package pack/publint, two-pack
reproducibility, clean DSH Home installation, real RC.2 Loader activation and
three-boot Profile E2E.

The Web client is now bundled as one lexical module with esbuild instead of
concatenating independently compiled files. A browser-discovered duplicate
`headerStyle` declaration previously prevented `__ModuleLoader__.load` from
running even though static Profile composition passed. The release test now
parses and executes the exact emitted `client.cjs`, observes the registered
bundle ID and invokes its factory, so this class of real-browser Loader failure
is deterministic and release-blocking.

The `release/` directory contains:

- `dsh-military-bundle-0.9.0-alpha.8.tgz`
- `dsh-military-installer-0.9.0-alpha.8.tgz`
- `checksums.sha256`
- `INSTALL.md`
- `VERSION.json`
- `RELEASE-MANIFEST.json`
- `RC2-PROFILE-REPORT.json`
- `RC2-E2E-REPORT.json`

Live DeepSeek provider credentials, network behavior and a statistically useful
post-fix Flash sample remain an external Canary acceptance boundary. The
deterministic Host/tool contract is release-gated; this document does not
mislabel an in-process adapter as a live provider run.

## 0.9.0-alpha.7 — DSH RC.2

This release is pinned exclusively to:

- `dsh@0.1.1-rc.2`
- `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## Result

The source and release artifacts pass the complete RC.2 release gate:

- frozen pnpm dependency installation;
- local strict and exact official-checkout TypeScript compilation;
- contract generation, build, 108 automated tests, repair regressions, semantic
  audit, source review and documentation validation;
- 13/13 package pack/publint checks;
- reproducible Bundle and Installer tarballs;
- checksum and embedded dependency-closure verification;
- clean DSH Home / Web Profile installation;
- real Loader, `military` Preset and browser-module activation;
- three Profile boots covering Settings persistence, Tool execution, a
  continuable Worker and Engineer, first-request prompt/schema capture, real
  Worker write/edit, Mission → Task → Candidate → Verification → Integration,
  fabricated evidence rejection, durable duplicate command handling, harmless
  desktop metadata preservation and final recovery.

This revision makes lightweight models the supported primary path without
removing any Military capability:

- General and all 11 department templates default to
  `deepseek-v4-flash/high`; Pro remains a per-role dropdown option;
- model-facing Task, Candidate, Blocker, Decision, Guidance and Specs
  contracts are shallow, while the Host compiles all identities, revisions,
  authority, evidence, timestamps and idempotency;
- role, immutable Task authorization and current phase jointly determine the
  visible tool surface;
- every terminal domain mutation is durably receipted before parent delivery,
  can be retried after a crash without duplicate artifacts or Git commits, and
  latches the remainder of the same assistant response;
- a completed child reliably wakes the parent General through a stable RC.2
  continuable report; explicit user cancellation remains terminal;
- large Specs retain full functionality through Host staging and one atomic
  apply instead of larger model schemas;
- ToolProfile concurrency and timeout policies now execute at admission.
- Task budgets are executable rather than documentary: model steps, tool calls,
  Tactical Requests, child wall-clock life and per-request output tokens all
  use the strictest Task/template/policy limit. The Flash-safe output default
  is 16K; an explicit Pro route can retain larger limits without changing the
  workflow contract.

DSH Settings now exposes an independent `Military` navigation entry beside
`Agent 预设`. General and every department use model dropdowns joined against
the live DSH catalog; all common execution, context, safety, workspace,
tactical, evaluation and presentation settings are visual. Raw versioned
registries and fixed security authority remain Host-owned.

This revision closes every deterministic failure captured in the
`4844eb48` Session:

- the attachment contains six safe, valid JSONL logs with 73 tool calls and 10
  actual errors; every request used `deepseek-v4-pro/high`, so the sample is a
  Pro failure baseline rather than a claimed live Flash validation;
- RC.2 now installs Military prompt/schema parity inside unpublished
  continuable-child construction, before the first model request can race the
  asynchronous durable-binding lookup;
- every Engineer/Worker request is phase-masked to 1–4 Host-owned tools (and
  may be narrowed further by its Task grant), with no ghost
  write/edit/bash/jobs instructions;
- Task `allowedTools` constrains both the request vocabulary and the issued
  Capability Grant;
- `military_specs_apply_order` is the sole Engineer mutation: one atomic call
  creates or replaces complete documents, validates, commits, records and
  reports;
- Specs directory reads are recursive, missing specs/docs directories are
  valid empty states, and no global eleven-file skeleton is imposed on a
  one-document Task;
- untracked desktop metadata is preserved but does not block Specs, Worker
  worktree admission or Integration; material changes still fail closed;
- the installed-profile E2E captures the actual first Worker and Engineer
  requests and executes RC.2 write/edit against the assigned isolated
  worktree.

This revision also repairs the model-facing contract exposed by a real
`deepseek-v4-flash` failure Session:

- all structured inputs now expose their canonical nested schemas;
- Task creation accepts a shallow semantic draft while the Host derives every
  identity, version fence, safety default, environment snapshot and evidence
  clause;
- `/brainstorm` exposes its existing Mission through `military_get_context`,
  and retrying Mission start is idempotent;
- Mission snapshots convert `Map` projections before the RC.2 JSON boundary;
- the root General sees 15 role-valid Military tools instead of the 34-tool
  union, while each department sees only its immutable ToolProfile;
- canonical validation reports all detectable problems in one correction
  round.

This revision additionally closes every deterministic host-boundary failure
captured in the stopped `cb4c670f` Flash Session:

- Session workspace, Workspace Snapshot, Specs and Git resolve the same
  authoritative project root instead of the plugin source directory;
- Snapshot references have a dedicated structured reader;
- denied calls retain their actionable reason and are never settled without an
  admitted reservation;
- the only Specs validation command is exposed as an exact enum, while Specs
  writes commit atomically or roll back completely;
- General cannot escape its immutable ToolProfile through global shell tools;
- effective step/no-progress limits are enforced in the model loop;
- user or policy abort converges Agent, Task, budget, lease and concurrency
  state;
- Military domain failures are emitted as compact machine-readable JSON.

This revision closes the prompt/schema parity failure captured in the
`573e3540` Flash Session:

- RC.2 system-prompt sections for hidden `bash`, `glob`, filesystem, job and
  Web tools are removed from each assembled request;
- a deterministic boundary lists only the exact tool names present in that
  request's Tool Schema;
- General routes bounded repository discovery through the visible,
  read-only `advisor-generalist` profile;
- a denied hidden-tool attempt returns one non-retryable `POLICY_DENIED`
  recovery contract instead of a generic permission error;
- `military_status` selects only the latest runnable revision for each
  template and stays below the Flash regression size limit.

This revision additionally closes the parent/child and file-write failures
captured in the `c21a6c55` Session:

- every department profile authorizes RC.2's child-scoped `report` tool, while
  the pre-install host tool filter deliberately leaves that late-bound tool
  untouched;
- normal and critical child reports use RC.2 `next-step` delivery, so an idle
  parent is automatically resumed and receives the terminal result without
  polling Session, Agent or binding identifiers as if they were artifacts;
- explicit user cancellation remains terminal: its settlement-only wake is
  consumed before another parent model request, while real user input and
  useful child reports are preserved;
- child spawn results now state the only valid continuation contract:
  end the current turn, wait for the automatic report, then inspect the Task
  and evidence;
- Engineer Specs writes accept a shallow semantic draft; the Host derives all
  immutable Mission/Task references, version fences, path allow-lists,
  validation and commit policy;
- local-main children may use omitted or relative paths only when their
  inherited cwd is exactly the execution root; isolated worktrees still
  require their canonical absolute root;
- Git status expands untracked directories into exact files, allowing a new
  `specs/` file to satisfy the file allow-list;
- model-step strategy limits now mirror the Task budget, with one
  finalization-only step reserved for candidate/blocker/report submission;
- successful Specs commits are durably recorded and reported to the parent,
  preventing a committed file from being mistaken for a failed write and
  redundantly recreated;
- duplicate Task keys with different drafts fail once with a non-retryable,
  machine-readable idempotency conflict instead of creating a second revision.

## Artifacts

The `release/` directory contains:

- `dsh-military-bundle-0.9.0-alpha.7.tgz`
- `dsh-military-installer-0.9.0-alpha.7.tgz`
- `checksums.sha256`
- `INSTALL.md`
- `VERSION.json`
- `RELEASE-MANIFEST.json`
- `RC2-PROFILE-REPORT.json`
- `RC2-E2E-REPORT.json`

The Bundle embeds every private runtime package. The Installer embeds Contracts
and Preset, so neither tarball resolves unpublished `@dsh-military/*`
dependencies from npm.

## Deployment boundary

The deterministic E2E uses an in-process LLM adapter and does not require
secrets or external network access. Live Provider credentials, remote service
behavior, real-browser concurrency/accessibility, cross-platform behavior and
production SLO/disaster-recovery exercises remain deployment checks. The
pre-fix Flash sample is retained as a failing benchmark; the Flash capability
profile is intentionally `CANARY`, with automatic fallback disabled, until the
user records enough post-fix live Sessions. Built-in lightweight templates
explicitly opt into that Canary for the external validation run; Pro remains
available as an explicit route.
