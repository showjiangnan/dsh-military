# dsh-military

[简体中文（默认）](README.md) | English

> Status: `0.9.0-alpha.25`. The project has passed exact DSH RC.2 type
> checking, installation into a clean Web Profile, activation by the real
> Loader, three-start recovery E2E, pack/publint checks for every package,
> reproducible packaging, and checksum gates.

`dsh-military` is a verification-driven multi-agent organization Bundle for
DeepSeek Harness. Its only supported runtime baseline is:

```text
dsh@0.1.1-rc.2
deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
Node.js ^22.19.0 or >=24
```

When creating an empty session, the user selects the fixed system preset
`military`. Within that scope, the Bundle provides the General, Staff,
Workers, Engineer Corps, Inspector Corps, Radio, tactical memory, performance
evaluation, budget and permission admission, automatic compaction,
externally-observed evidence acceptance, and controlled Git integration.
Other presets receive none of the Military tools, listeners, or prompts.

## Workspace packages

- `@dsh-military/contracts`: wire/storage contracts, schemas, and event and
  error catalogs;
- `@dsh-military/core`: Mission/Task state machines, Ledger, CAS, plans,
  acceptance, and governance;
- `@dsh-military/infrastructure`: Artifacts, restricted processes, Git
  worktrees, Candidates, Integration, specs, and the knowledge supply chain;
- `@dsh-military/storage-sqlite`: SQLite migrations, short-transaction
  Command Sagas, persistent Ledgers, ordered outbox, Workspace/Execution
  projections, and recovery state;
- `@dsh-military/runtime`: application service graph, department Agents, and
  research and recovery coordination;
- `@dsh-military/plugin-host`: RC.2 adapters for Agents, Sessions, Tools,
  Compaction, Settings, and Subagents;
- `@dsh-military/tools`: role-authorized tools for General, Staff, Worker,
  Engineer, Inspector, and Research roles;
- `@dsh-military/command-brainstorm`: the explicit `/brainstorm` command;
- `@dsh-military/webui`: vertical Military Settings and Knowledge entries
  using the same 42px/36px hit areas as DSH settings, native modals, seven
  fixed primary tabs, General and 11 department role workbenches,
  model/budget/prompt revisions, Flash readiness and simulation,
  diagnostics and recovery, Specs workspaces, an authoritative
  Request-to-Integration Runtime Center, fixed evaluations, accessibility, a
  complete seven-view Knowledge Center, and a seven-view performance decision
  center;
- `@dsh-military/preset`: the fixed `military` preset and its
  content-addressed generation;
- `@dsh-military/installer`: transactional preset installation, upgrade,
  verification, and uninstall;
- `@dsh-military/bundle`: the self-contained Host/Client Bundle installable
  into a DSH Profile;
- `docs/`: architecture, contracts, operations, compatibility matrices, and
  executable documentation validation.

## Development and complete gates

Dependencies are pinned by the pnpm lockfile. `DSH_RC2_ROOT` must point to an
exact official checkout on which `pnpm run build:lib` has already completed.

```bash
pnpm install --frozen-lockfile

pnpm generate
pnpm typecheck
pnpm verify:rc2
pnpm build
pnpm test
pnpm repair:regressions
pnpm semantic:audit
pnpm review
pnpm validate

DSH_RC2_ROOT=/absolute/path/to/deepseek-harness pnpm all:rc2
DSH_RC2_ROOT=/absolute/path/to/deepseek-harness pnpm release:verify
```

`pnpm test` includes an RC.2 Web Profile E2E installed from tarballs into a
temporary DSH Home. It starts the real Loader three times, mounts `military`,
changes and restores Settings, registers the Web Client, captures the actual
first request of continuable Worker and Engineer Agents, executes real Worker
`write` and `edit` operations, and runs Mission → Task → Candidate →
Verification → Integration. It also verifies rejection of forged evidence,
preservation of desktop metadata, idempotency of duplicate commands,
terminal parent receipts, and cross-process recovery. Tests use a
deterministic in-process LLM adapter. Real external Provider credentials,
network behavior, and deployment conditions remain production checks and are
not simulated as if they were real.

Real Flash acceptance is deliberately separate from deterministic tests. The
performance page derives exportable evidence from immutable Session events
and Host-observed receipts. Every exact configuration × scenario requires 50
independent Sessions, the first-tool and E2E Wilson thresholds, and zero
violations in four safety classes. Recompute the gate offline with:

```bash
npm run acceptance:flash -- \
  --evidence /absolute/path/provider-acceptance.json \
  --route deepseek-official/deepseek-v4-flash
```

This command never launches paid calls. Insufficient evidence remains
`INSUFFICIENT_SAMPLE`; catalog presence or local deterministic PASS is never
reported as real Provider acceptance.

User-editable role prompt bodies are written in Simplified Chinese and stored
in Settings/template revisions. Prompt Assembly appends Host-owned tool
allowlists, workspace boundaries, capability grants, evidence requirements,
and terminal-state rules after the editable body. Editing a prompt cannot
grant new tools, expand file permissions, or bypass acceptance.

The lightweight-model tool contract follows a strict boundary: the model
expresses intent, while the Host generates authoritative fields.

- Every Military structured argument exposes complete arrays, enums, objects,
  and required schemas to the model.
- `military_task_create` accepts only a shallow Task draft. Mission,
  Direction, Wave, and Task IDs, versions, complexity, evidence clauses, and
  environment snapshots are generated deterministically by the Host.
- General and department Agents see only the 1–4 tools required by the
  Host-owned phase. The immutable ToolProfile remains the authority ceiling,
  and a Task grant may narrow that intersection further.
- Models reuse only IDs returned by the current Host stage; they never guess a
  Mission, Task, Attempt, Activation, Dispatch, Workspace, version, or fence.
- Task `allowedTools` constrains both the model schema and the Capability
  Grant.
- A failed validation returns all visible problems in one response, and the
  Mission Snapshot is converted to stable JSON at the tool boundary.
- Candidate, Blocker, Guidance, Decision, Specs, Inspection, and Research
  terminal states persist the domain result before reliably delivering the
  parent receipt. A crash retry reuses the same result.
- After terminal success, a monotonic latch rejects later calls in the same
  model message. The parent General is resumed automatically by the RC.2
  continuable report and does not need model-driven polling.
- Oversized Specs use Host-side segmented staging and one atomic apply,
  preserving complete writes, verification, local Git commits, Ledger
  records, and recovery.
- Task step, tool-call, Tactical Request, subagent wall-clock, and per-output
  budgets are enforced at the real execution boundary. Omitted values use
  Flash-safe defaults. Selecting Pro may explicitly raise budgets within
  template and model capability limits without removing any Mission stage.

The private Skill supply chain uses the same lightweight-first boundary:

- A user explicitly imports text, a Session range, or a text Artifact from
  the Knowledge Center. Raw material is written through a trusted RC.2 RPC
  into an isolated Raw Vault and never enters Settings or Session logs.
- Before any model call, the Host performs Secret/PII redaction and a Prompt
  Injection PASS/WARN/FAIL check, then sends stable 6,000-character chunks to
  a zero-tool Flash extractor.
- The model returns one shallow JSON Claim contract. IDs, hashes, evidence
  ranges, aggregation, versions, lifecycle, permissions, and approval are all
  Host-generated.
- The user edits, approves, returns, or rejects through Candidate/Diff hashes.
  Only explicit approval can atomically create a DRAFT; the General has no
  approval entry point.
- A complete Skill snapshot uses a concise `SKILL.md` plus one level of
  `references/`, `examples/`, and `scripts/`. Frontmatter, reference closure,
  permission bits, and SHA-256 are verified both when writing and delivering.
- DRAFT and SIMULATION never enter a Task. The global DSH Skill provider
  publishes only STABLE versions. Controlled Canary/Testing recall uses an
  exact Host-owned version and injects a small applicability card for Flash.
- Owner, license, scope, audience, derivative, retention, dependency, and
  expiry rules are rechecked at approval, promotion, recall, and every context
  delivery. Withdrawal immediately quarantines derivative versions and
  produces an impact report.
- Worker terminal handling records the exact version, match reason,
  provider/model, tool evidence, Verifier, rework or rollback, observed
  tokens, cost availability, and outcome.
- The Knowledge Center projects sanitized snapshots and chunks,
  redaction/injection receipts, approval/version/promotion/Usage/inheritance/
  withdrawal lineage. “Simulated recall” creates no Task and calls no model;
  it shares the resolver, rights gate, ranking, and delivery renderer used by
  real Task recall.

Performance evaluation follows the same principle: lightweight models remain
usable, while Host authority is not reduced.

- A complete Request builds exactly one canonical Frozen Dataset. Manifest,
  Attempts, metrics, and Reports share the same Artifact/hash.
- Attempts are deduplicated by Task version, Agent generation, lease
  sequence, and bounded event window. Tools, acceptance, terminal state, and
  parent wakeups from an old lease are never inherited.
- Role, Template/Prompt revision, actual provider/model/route, Thinking,
  ToolProfile, PermissionProfile, Bundle, and DSH commit form the exact
  configuration. Flash, Pro, fallbacks, and aliases are never pooled.
- Pre-execution difficulty, missingness reasons, failure phase,
  Wilson/Mission-cluster bootstrap, and dynamic sufficiency are explicit.
  Rework within one Mission does not masquerade as an independent sample.
- A same-role, same-difficulty Flash/Pro non-inferiority comparison first
  passes hard gates for permissions, Evidence, regressions, terminal state,
  parent wakeup, and recovery drift. Evaluation can never promote a model
  automatically.
- Token, latency, and available cost metrics accumulate every failure,
  rework, and retry leading to the final Accepted Outcome. When Provider
  pricing is unknown, cost is marked unavailable instead of participating in
  Pareto analysis as zero.
- Jobs, Datasets, shards, Reports, and Appeals are persisted. Timeout or
  restart fills only missing shards, and an Appeal creates an immutable
  superseding Report.
- The committee model is disabled by default. When explicitly enabled, it
  receives only read-only redacted aggregates, has no tools, uses strict
  JSON, and falls back to a deterministic narrative on failure.
- `Military - Performance Evaluation` provides seven views: decision
  overview, Flash/Pro, nine scenarios, tool funnel, Pareto, data/Evidence, and
  history/appeals.

The complete contracts are documented in
[`docs/docs/37-military-evaluation-committee.md`](docs/docs/37-military-evaluation-committee.md),
[`docs/docs/48-evaluation-statistics-and-fairness.md`](docs/docs/48-evaluation-statistics-and-fairness.md),
and
[`docs/docs/57-performance-evaluation-runtime.md`](docs/docs/57-performance-evaluation-runtime.md).

The file layout follows the progressive-disclosure approach from the
[Claude Agent Skills creation guide](https://platform.claude.com/docs/zh-CN/build-with-claude/skills-guide#creating-a-skill)
and its
[authoring best practices](https://platform.claude.com/docs/zh-CN/agents-and-tools/agent-skills/best-practices).
The runtime remains a DSH RC.2 dynamic Skill provider and does not depend on
the Claude Skills API. The complete contract is in
[`docs/docs/33-tactical-ingestion-and-tag-governance.md`](docs/docs/33-tactical-ingestion-and-tag-governance.md).

The failing `deepseek-v4-flash` Sessions supplied by the user have been
preserved as redacted regression baselines. Code-level and installed-Profile
regressions pass. Post-fix verification against the real Provider is run in a
new session, so the Flash capability profile remains `CANARY` for performance
evidence and does not participate in automatic fallback. The built-in General
and department templates explicitly allow that Canary as the current
lightweight-primary route; Pro remains selectable per department. See
[`docs/quality/MODEL-BENCHMARK.md`](docs/quality/MODEL-BENCHMARK.md).

The DSH main sidebar exposes a `Military Settings Center` entry next to
“Knowledge and Skills” and opens a native modal. The left side contains seven
fixed Military primary tabs. General and all 11 department templates use
dropdowns checked against the live DSH model catalog, and display the
plugin-provided Simplified Chinese prompts as editable, restorable text with
executable lint assistance. The role catalog, six-layer effective Prompt,
deterministic readiness, offline simulation, explicit read-only Canary,
immutable history, cost, Session diagnostics, governed recovery, Host
workspace directory, fixed nine-scenario benchmark, and browser accessibility
are all integrated. Safety and Recovery also exposes explicit Mission
cancellation guarded by preview, state-hash CAS, expiry, and an exact
confirmation phrase; the Host releases all child grants, budgets, capacity,
and Workspace resources, and this is not the same as stopping one invocation.
Military-owned failures sent to lightweight models use one bounded, redacted
correction envelope with a single `nextTool` and an RC.2-schema-derived
`correctedShape`. Internal JSON registries, ToolProfiles,
PermissionProfiles, authority, terminal protocols, and parent receipts are
not exposed as user-editable text. The complete 15-part contract is in
[`docs/docs/67-military-control-center-flash-workbench-and-accessibility.md`](docs/docs/67-military-control-center-flash-workbench-and-accessibility.md).

The following local gate reports are reproducible from the commands above and
are intentionally excluded from Git under the source-repository policy:

- `RC2-CONTRACT-REPORT.md`
- `RC2-COMPATIBILITY-REPORT.md`
- `TEST-REPORT.md`
- `CODE-REVIEW-REPORT.md`
- `RELEASE-REPORT.md`

`pnpm docs:validate` writes `docs/VALIDATION-REPORT.md` locally. Because that
report contains its execution time, it is excluded from source commits as
well.

## Installation

The GitHub source repository does not contain `release/`, compiled `lib/`
directories, installed dependencies, or local gate reports. For offline
source delivery, `pnpm pack:source` archives only
`git ls-files --cached --others --exclude-standard`, so a preceding build or
release gate cannot add compiled output, databases, credentials, or local
reports. Build a verified
release directory from source first:

```bash
pnpm install --frozen-lockfile
DSH_RC2_ROOT=/absolute/path/to/deepseek-harness pnpm release:verify
```

The generated release directory contains two self-contained packages and
their complete verification material:

```text
release/
  dsh-military-bundle-0.9.0-alpha.25.tgz
  dsh-military-installer-0.9.0-alpha.25.tgz
  checksums.sha256
  INSTALL.md
  VERSION.json
  RELEASE-MANIFEST.json
  RC2-PROFILE-REPORT.json
  RC2-E2E-REPORT.json
```

Install into an RC.2 Web Profile:

```bash
cd release
shasum -a 256 -c checksums.sha256

dsh plugin --profile web add \
  ./dsh-military-bundle-0.9.0-alpha.25.tgz

pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \
  dsh-military-install install \
  --dsh-home "${DSH_HOME:-$HOME/.dsh}"
```

The Bundle embeds every private runtime package, the Installer, and its
command. A standard installation therefore adds only the Bundle, produces no
“plain dependency” warning, and never resolves unpublished
`@dsh-military/*` packages from npm. The standalone Installer tarball is only
for preset-only lifecycle operations and must not be added as a Bundle layer.
Upgrade, forced generation migration, backup, rollback, and uninstall are
documented in
[`docs/docs/46-install-upgrade-rollback-uninstall.md`](docs/docs/46-install-upgrade-rollback-uninstall.md).
After building, the generated local `release/INSTALL.md` is also available.

## Safety boundary

Military terminology is solely a metaphor for software organization and
workflow. This project is not intended for real-world military operations,
weapons, target selection, violence, personnel surveillance, coercion, or
automated employment decisions. Model output is not completion evidence.
Only Host-observed state, persistent receipts, verifiers, and controlled
integration results may advance authoritative state.
