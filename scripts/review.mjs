import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const RC2 = '0.1.1-rc.2'
const RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const CORDIS = '^4.0.1'
const SCHEMASTERY = '^3.18.1'

const scanned = [
  ...(await collectSource('packages')),
  ...(await collectSource('apps')),
  ...(await collect('tests')).filter(isCode),
  ...(await collect('scripts')).filter(path => isCode(path) && path !== 'scripts/review.mjs'),
]
const findings = []
const checks = []

for (const path of scanned) {
  const text = await readFile(path, 'utf8')
  scan(path, text)
}

await reviewPackageVersions()
await reviewSourcePollution()
await architecture('fixed Military preset gate', 'packages/plugin-host/src/host-runtime.ts', ["=== 'military'", "presetId: 'military'"])
await architecture('RC.2 continuable manager owns child composition with a reserved durable identity', 'packages/plugin-host/src/child-transport.ts', ['subagents.startContinuable', 'childId,', 'ensureSessionBinding(child)'])
await architecture('child binding verifies the exact durable parent generation', 'packages/plugin-host/src/host-runtime.ts', ['verifyChild(', "child generation differs from parent generation"])
await architecture('completion interlock owns the turn stopping boundary', 'packages/plugin-host/src/completion-interlock.ts', ["'agent/turn-stopping'", 'hasTerminalSubmission'])
await architecture('oversight owns pre-step admission', 'packages/plugin-host/src/context-audit.ts', ["'agent/pre-step'", 'oversight.requireAdmission'])
await architecture('oversight owns tool admission', 'packages/plugin-host/src/tool-pipeline.ts', ["'tools/pre-execute'", 'oversight.requireAdmission'])
await architecture('General route respects session model selection and the preset default', 'packages/plugin-host/src/request-routing.ts', ['validateUserSelection', 'applyPresetDefault', 'dsh-session-model-selector'])
await architecture('department binding is durable before child prompt admission', 'packages/runtime/src/agents.ts', ['await this.#bindings.create(binding)', 'await this.#transport.spawn'])
await architecture('Worker receives the lease-owned Task-rooted workspace instruction', 'packages/plugin-host/src/child-transport.ts', ['request.executionCwd', '你在隔离执行工作树中工作', '所有文件操作只使用 military_workspace_read/list/search/write/edit', 'Host 会把相对路径绑定到本 Task 的隔离工作树'])
await architecture('Task-bound Worker/Engineer filesystem operations are fenced to their lease-owned workspace', 'packages/plugin-host/src/tool-authorization.ts', ['executionPath(binding.workspace.leaseId)', 'taskBoundToolPathPolicy', 'outside the assigned filesystem root'])
await architecture('Worker and Engineer workspaces are Task-scoped while Worker material-clean admission remains mandatory', 'packages/plugin-host/src/host-runtime.ts', ["template.role !== 'worker' && template.role !== 'engineer'", 'request.taskId === undefined', "template.role === 'worker'", 'materialStatusPaths', 'pathScope'])
await architecture('Engineer façade exposes one atomic apply transaction', 'packages/tools/src/engineer.ts', ["name: 'military_specs_apply_order'", 'recordSpecsCommit', 'reportTerminalOutcome', 'exec.concludeTurn()', 'STOP_SUCCESS_DO_NOT_REAPPLY'])
await architecture('continuable prompt parity is installed before first child publication', 'packages/plugin-host/src/index.ts', ['registerContinuableSetup', 'installMilitaryPromptSurface'])
await architecture('Task tool ceiling constrains Capability Grants', 'packages/runtime/src/agents.ts', ['taskGrantedTools', 'allowedTools: grantTools'])
await architecture('RC.2 baseline is exact', 'VERSION.json', [RC2, RC2_COMMIT])
await architecture('RC.2 Web bundle uses the lazy module loader factory', 'scripts/build.mjs', ['window.__ModuleLoader__.load', "'packages/webui/lib/client.cjs'"])
await architecture('nested child sessions inherit the durable root session id', 'packages/storage-sqlite/src/repositories.ts', ['SELECT root_session_id', 'return row.root_session_id'])
await architecture('invalid template and tag settings fail at the settings write boundary', 'packages/plugin-host/src/settings.ts', ['validate(value) { void parseTemplateProfiles', 'validate(value) { void parseTacticalTags'])
await architecture(
  'resource releases follow child disposal',
  'packages/plugin-host/src/host-runtime.ts',
  [
    'cleanupFailures',
    "cleanup('workspace'",
    'workspaces.release(workspace.leaseId)',
  ],
)
await architecture('Mission mutations use the single-writer command kernel', 'packages/tools/src/common.ts', ['createMissionCommand', 'missionKernel.execute'])
await architecture('candidate submission closes verification, integration and specs maintenance', 'packages/tools/src/worker.ts', ["result.verification.disposition === 'ACCEPTED'", 'application.integration.execute', 'specs.recordIntegration'])
await architecture('model calls receive a deterministic Context Manifest', 'packages/plugin-host/src/context-audit.ts', ['contextCompiler.compile', 'persistContextManifest', "type: 'context/manifest-created'", 'renderContextManifest'])
await architecture('department tool calls consume short-lived capability grants after path admission', 'packages/plugin-host/src/tool-authorization.ts', ['authorizeToolPath', 'capabilityGrants.consume', 'idempotencyKey: reservation.reservationId'])
await architecture('model execution uses durable reservation/settlement', 'packages/plugin-host/src/request-routing.ts', ['reserveModelRequestBudget', 'settleModelRequestBudget'])
await architecture('tool execution uses durable reservation/settlement', 'packages/plugin-host/src/tool-pipeline.ts', ['reserveToolExecutionBudget', 'toolExecutionUsageReceipt', 'Promise.allSettled', "topic: 'tool-execution.settle'"])
await architecture('department children hold durable concurrent-Agent capacity', 'packages/runtime/src/agents.ts', ['reserveAgentConcurrencyBudget', 'concurrencyReservationId'])
await architecture('Task tool and wall-clock limits narrow durable child authority', 'packages/runtime/src/agents.ts', ['request.taskOrder?.budget.toolCalls', 'maximumWallClockSeconds', 'maximumUses: Math.max('])
await architecture('Task output limits narrow actual department LLM requests', 'packages/plugin-host/src/request-routing.ts', ['taskMaxOutputTokens', 'Math.min(', 'maxTokens:'])
await architecture('department wall-clock authority is checked before every model step', 'packages/plugin-host/src/context-audit.ts', ['departmentWallClockExhaustion', 'WALL_CLOCK_BUDGET_EXHAUSTED', 'resourceBudgets.getReservation'])
await architecture('Task Tactical Request limits are version-fenced inside the Mission writer', 'packages/tools/src/worker.ts', ['requireTaskGuidanceBudget', "event.type !== 'radio/requested'", 'do not retry military_radio_request'])
await architecture('Military owns a sidebar Settings action and native overlay', 'packages/webui/src/client/index.tsx', ["'sidebar.footer.action'", "'shell.overlay'", "id: 'military-settings'", 'connection={connection}'])
await architecture('Military visual Settings use Host-authoritative control, operations, workspace and evaluation projections', 'packages/webui/src/client/settings-center.tsx', ['<RoleWorkbench', '<MilitaryOperationsCenter', '<MilitaryWorkspaceCenter', '<MilitaryEvaluationCenter'])
await architecture('Military performance evaluation preserves the fixed benchmark projection inside the governed decision center', 'packages/webui/src/client/evaluation-center.tsx', ['<MilitaryBenchmarkCenter'])
await architecture('Military model catalog joins every live DSH route without performance gating and audits it on the Host', 'packages/plugin-host/src/control-plane-remote.ts', ['ctx.llm.listProviders()', 'ctx.llm.listModels(provider.id)', 'this.host.ensureDshModelCapability(', 'available: true', 'selectable: true', 'this.auditModelCatalog(entries)'])
await architecture('all role prompts are visible, editable, linted and revisioned', 'packages/webui/src/client/role-workbench.tsx', ['data-role-prompt-editor', 'simplifiedChineseReview', '恢复自带提示词', 'revision.simplifiedChineseReview'])
await architecture(
  'Simplified Chinese confirmations are recomputed and hash-bound on the Host',
  [
    'packages/plugin-host/src/control-plane-remote.ts',
    'packages/plugin-host/src/control-plane-support.ts',
  ],
  [
    'createSimplifiedChineseReviewReceipt',
    'sourceHash',
    'resultHash',
    'confirmedStarts',
  ],
)
await architecture('Specs workspace selection accepts only Host catalog identities', 'packages/plugin-host/src/workspace-remote.ts', ["value.type !== 'INSPECT_WORKSPACE'", 'workspaceId', 'this.catalog(signal)', 'this.inspect(workspace'])
await architecture('fixed benchmark separates deterministic and Provider observations', 'packages/plugin-host/src/benchmark-remote.ts', ["'RUN_DETERMINISTIC'", "'ASSESS_PROVIDER_SESSION'", 'MILITARY_BENCHMARK_DATASET_HASH', 'providerSampleStability'])
await architecture('private Skill simulation shares real recall and delivery rendering', 'packages/plugin-host/src/private-skill-remote.ts', ["type === 'SIMULATE_RECALL'", 'resolveTacticalRecall', 'renderTacticApplicabilityCards', 'createsTask: false'])
await architecture('editable role prose is followed by the shared immutable Host compiler', 'packages/plugin-host/src/agent-lifecycle.ts', ['generalPersona', 'departmentPersona', 'compileEffectivePrompt'])
await architecture('model-produced contracts cross canonical runtime schemas', 'packages/tools/src/runtime-validation.ts', ['validateSchema', 'additionalProperties', 'parseCandidateSubmission'])
await architecture('special departments use a durable recoverable outbox', 'packages/runtime/src/special-department-automation.ts', ['claimExpiresAt', 'reconcile', 'jobId'])
await architecture('special department retries use deterministic dispatch identity', 'packages/plugin-host/src/host-runtime.ts', ['idempotencyKey: `${job.jobId}:attempt:${job.attempts}`'])
await architecture('Agent Plane is split by policy boundary', 'packages/plugin-host/src/agent-plane.ts', ['registerAgentLifecycle', 'registerContextAudit', 'registerRequestRouting', 'registerToolPipeline', 'registerCompletionInterlock'])
await architecture('verification builds a tiered Claim-Evidence Graph', 'packages/core/src/verification.ts', ['claimEvidenceGraph', 'verifyClaimEvidenceGraph'])
await architecture('department execution is adaptively routed by task capability', 'packages/runtime/src/agents.ts', ['this.#router.route', 'executionStrategy: strategy'])
await architecture('every RC.2 child report wakes or steers its parent', 'packages/plugin-host/src/rc2-adapter.ts', ["return 'next-step'", 'idle parent'])
await architecture('RC.2 brainstorm commands admit image evidence', 'packages/command-brainstorm/src/index.ts', ['images: allowImages', 'attachments'])
await architecture('RC.2 prompt prose is synchronized with the exact restricted tool schemas', 'packages/plugin-host/src/prompt-surface.ts', ["'system-prompt/assemble'", 'assembly.tools', 'visibleTools.has(toolName)', 'Military 工具边界'])
await architecture('Flash repository discovery is routed through the read-only Generalist advisor', 'packages/command-brainstorm/src/index.ts', ['advisor-generalist', 'without a taskId', 'only exact tool names visible'])
await architecture('Military status exposes only compact latest runnable template revisions', 'packages/tools/src/general.ts', ['latestRunnableTemplateSummaries', "template.status === 'ACTIVE' || template.status === 'CANARY'", 'summarizeMilitaryStatus'])
await architecture('RC.2 source fingerprints are pinned', 'reference/dsh-rc2/source-fingerprints.json', [RC2, RC2_COMMIT, '652a3ba6c8919a1a96e1e716403d5d8a27f37df5'])
await architecture('RC.2 Session log remains free of out-of-repository required events', 'packages/plugin-host/src/session-events.ts', ['facts in its own Ledger', 'no merges'])
await architecture('experimental Agent Team is projection-only', 'packages/core/src/agent-team-boundary.ts', ['authoritative: false', 'candidate-acceptance', 'assertAgentTeamProjectionOnly'])
await architecture('model input and RC.2 reasoning-passback reserves are explicitly enforced', 'packages/core/src/model-capabilities.ts', ['assertModelInputCapability', 'rc2ContextReserves', 'previousReasoningTokens'])
await architecture('RC.2 dynamic Web client declares manifest edges', 'packages/webui/package.json', ['dsh', 'client', 'external', 'peerDependencies', 'devDependencies'])
await architecture('Workflow obligations and Task execution lifecycles use the durable SQLite CAS provider', 'packages/storage-sqlite/src/execution-lifecycle-state.ts', ['SqliteExecutionLifecycleStateStore', 'execution-workflow-obligation', 'execution-task-lifecycle', 'updateWorkflow', 'updateTask'])
await architecture('Activation liveness requires durable heartbeat and settlement receipts', 'packages/core/src/execution-lifecycle.ts', ['heartbeatActivation', 'heartbeatExpiresAt', 'settleActivation', 'settlementReceiptId', "'RECOVERY_REQUIRED'"])
await architecture('transactional outbox owns claim, retry, dead-letter, delivery receipt and partition offset', 'packages/storage-sqlite/src/outbox-dispatcher.ts', ['#claim(', '#retry(', '#deadLetter(', 'outbox_delivery_receipts', 'outbox_consumer_offsets'])
await architecture('Mission terminal fences reject later Task registration and preserve explicit cancellation', 'packages/core/src/runtime.ts', ['#requireMissionOpen(order.missionId)', 'cancelMission(input:', "'mission/cancelled'", "'task/cancelled'"])
await architecture('Operations Center exposes previewed CAS-fenced explicit Mission cancellation', 'packages/plugin-host/src/operations-remote.ts', ["case 'CANCEL_MISSION'", 'expectedStateHash', 'previewHash', 'missionKernel.execute', 'runtime.cancelMission', 'forgetDepartmentChild'])
await architecture('Mission scheduler gates dispatch by active Wave and completed dependencies', 'packages/core/src/runtime.ts', ['activeWaveIds', 'dependencySatisfied(', "'wave/opened'", "'wave/barrier-satisfied'", "'mission/completed'"])
await architecture('Planning rejects unknown dependencies, cycles and same-Wave write conflicts', 'packages/core/src/planning.ts', ["'UNKNOWN_DEPENDENCY'", "'CYCLE'", "'WRITE_CONFLICT'", 'inside one Wave'])
await architecture('first child request receives a synchronous Host-owned phase surface', 'packages/plugin-host/src/index.ts', ['registerContinuableSetup', 'initialPhaseVisibleTools', 'installMilitaryPromptSurface'])
await architecture('every tool call is admitted against the current phase intersection', 'packages/plugin-host/src/tool-pipeline.ts', ['resolvePhaseVisibleTools', 'installedPhaseTools', "'PHASE_TOOL_NOT_VISIBLE'", 'REPEATED_INVALID_CALL'])
await architecture('Military tool failures share nextTool and correctedShape envelopes', 'packages/core/src/tool-errors.ts', ['serializeToolErrorEnvelope', 'nextTool', 'correctedShape', 'redactToolErrorValue'])
await architecture('Task Create keeps Host-owned planning and fencing fields out of the base model schema', 'packages/tools/src/task-draft.ts', ['compileTaskDraft', '`task-${sha256(', "'.dsh-military/control'", 'modelSteps: draft.budget.modelSteps ?? 16'])
await architecture('Desired/Applied role settings block execution until the whole revision converges', 'packages/plugin-host/src/role-workbench.ts', ['desiredRevision', 'appliedRevision', 'startup readiness barrier', 'requireRoleWorkbenchApplied'])
await architecture('catalog presence, protocol compatibility and performance evidence remain independent', 'packages/plugin-host/src/model-catalog-bridge.ts', ["catalogPresence: 'PRESENT'", 'protocolCompatibility', "performanceEvidence: 'UNASSESSED'", 'policyEligibility'])
await architecture('dispatch pins the exact model capability profile revision', 'packages/runtime/src/agents.ts', ['modelCapabilityProfileId', 'modelCapabilityProfileRevision', 'does not match exact route profile revision'])
await architecture('Runtime Center projects the authoritative hierarchy with freshness metadata', 'packages/plugin-host/src/runtime-remote.ts', ['WorkflowObligation', 'sourceRevision', 'generatedAt', 'staleAfter', 'health:'])
await architecture('Military Web features share cancellation, revision, visibility and cross-tab query behavior', 'packages/webui/src/client/query-client.ts', ['AbortController', 'revisionRef', 'visibilitychange', 'BroadcastChannel', 'withCallerAbort'])
await architecture('WebUI adapters compose RC.2 primitives and DSH theme tokens', 'packages/webui/src/client/ui-adapter.tsx', ['FormField', 'AsyncBoundary', 'StateDot', 'var(--dsw-'])
await architecture('Artifact references are authority-bearing and separate from content blobs', 'packages/infrastructure/src/artifacts.ts', ['Content blobs and authorization-bearing references are separate', 'referenceId', 'artifactId', 'classification', 'audiencePrincipalIds', 'legalHoldIds', 'rotateEncryptionKey', 'garbageCollect'])
await architecture('Web remotes use the explicit local DSH principal boundary', 'packages/plugin-host/src/web-authority.ts', ['LOCAL_SINGLE_USER', 'DSH_RC2_LOCAL_PROCESS', 'requestPrincipalAvailable: false', 'requireWebAuthority'])
await architecture('integration stages in a hashed exact worktree and reconciles before cleanup', 'packages/infrastructure/src/integration.ts', ['#stagingPath(', 'sha256(', '#requireExactStagingPath(', 'registeredWorktreeHead', 'reconcilePending'])
await architecture('workspace recovery fails closed on unknown or out-of-root worktrees', 'packages/infrastructure/src/workspaces.ts', ['#managedWorktreePath(', 'outside its exact managed lease path', 'requires recovery', 'exact repository registration'])
await architecture('all standalone SQLite writes are auto-wrapped and expired async writers are rejected', 'packages/storage-sqlite/src/database.ts', ['automatically wraps every standalone run/exec', 'return this.transaction(() => Reflect.apply', 'expired asynchronous transaction context', 'maintenance<T>'])
await architecture(
  'Evaluation preserves N/A and incomplete authoritative evidence',
  [
    'packages/core/src/evaluation.ts',
    'packages/core/src/evaluation-analytics.ts',
  ],
  [
    "status: 'NOT_APPLICABLE'",
    "status: 'INCOMPLETE_EVIDENCE'",
    'numerator:',
    'denominator:',
  ],
)
await architecture('production composition declares replaceable distributed seams and fail-closed readiness', 'packages/core/src/production-control.ts', ['distributed targets require every provider', 'LOCAL_SINGLE_HOST', "providerValue.status !== 'READY'", "providerValue.deployment !== 'EXTERNAL'"])
await architecture('SQLite production mode truthfully declares local limitations and backup evidence', 'packages/storage-sqlite/src/production-control.ts', ['replace with a MilitaryLedger PostgreSQL adapter', 'object-store adapter', 'KMS', 'consistent VACUUM INTO backup'])
await architecture('external Flash acceptance enforces N>=50 and Wilson lower bounds', 'scripts/verify-flash-acceptance.mjs', ['independentSessionsPerScenario: 50', 'firstToolPointEstimate: 0.95', 'firstToolWilsonLowerBound: 0.85', 'e2ePointEstimate: 0.90', 'e2eWilsonLowerBound: 0.80'])

const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
  || left.path.localeCompare(right.path) || left.line - right.line)
const blocking = findings.filter(item => item.severity === 'CRITICAL' || item.severity === 'HIGH')
const summary = {
  generatedAt: new Date().toISOString(),
  baseline: { release: RC2, commit: RC2_COMMIT },
  filesReviewed: scanned.length,
  architectureChecks: checks,
  findings,
  blockingFindings: blocking.length,
  disposition: blocking.length === 0 ? 'PASS' : 'FAIL',
  runtimeBoundary: 'Static review covers production source, package contracts and release scripts. Exact-checkout compilation, RC.2 Loader composition, clean-profile installation, browser behavior and replay-provider E2E are independent release gates.',
}
await writeFile('CODE-REVIEW-REPORT.json', `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
await writeFile('CODE-REVIEW-REPORT.md', renderMarkdown(summary), 'utf8')
console.log(`Code review: ${summary.disposition}; ${findings.length} finding(s), ${blocking.length} blocking.`)
if (blocking.length > 0) process.exitCode = 1

function scan(path, text) {
  match(path, text, /shell\s*:\s*true/gu, 'CRITICAL', 'SHELL_TRUE', 'Process execution with shell:true is forbidden.')
  match(path, text, /\beval\s*\(/gu, 'CRITICAL', 'EVAL', 'Dynamic eval is forbidden.')
  match(path, text, /\bnew\s+Function\s*\(/gu, 'CRITICAL', 'NEW_FUNCTION', 'Dynamic Function construction is forbidden.')
  if (/from\s+['"]node:child_process['"]/u.test(text)
    && /import\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}/su.test(text)) {
    add('CRITICAL', 'CHILD_PROCESS_EXEC', path, lineOf(text, text.search(/import\s*\{/u)), 'Use argv-based spawn/execFile wrappers, never child_process.exec/execSync.')
  }
  match(path, text, /\[\s*['"](?:push|pull|fetch|remote|rebase|clone)['"]/gu, 'CRITICAL', 'REMOTE_GIT_OPERATION', 'Remote or history-rewriting Git argv is forbidden in the plugin runtime.')
  match(path, text, /\[\s*['"]push['"][^\]]*['"]--force(?:-with-lease)?['"]/gu, 'CRITICAL', 'FORCE_PUSH', 'Force push is forbidden.')
  match(path, text, /\[\s*['"]reset['"]\s*,\s*['"]--hard['"]/gu, 'HIGH', 'DESTRUCTIVE_GIT', 'git reset --hard is forbidden; isolated staging and ff-only integration must make rollback unnecessary.')
  match(path, text, /\[\s*['"]clean['"]\s*,\s*['"]-fd/gu, 'HIGH', 'DESTRUCTIVE_GIT', 'git clean is forbidden.')
  match(path, text, /catch\s*\{\s*\}/gu, 'HIGH', 'EMPTY_CATCH', 'Empty catch blocks hide evidence.')
  match(path, text, /\b(?:TODO|FIXME|HACK)\b/gu, 'MEDIUM', 'UNRESOLVED_MARKER', 'Unresolved implementation marker.')
  match(path, text, /\bas\s+never\b/gu, path.startsWith('tests/') ? 'LOW' : 'MEDIUM', 'UNSAFE_NEVER_CAST', 'Avoid as-never casts; use a branded constructor or an explicit fixture helper.')
  match(path, text, /@ts-(?:ignore|expect-error)/gu, 'MEDIUM', 'TS_SUPPRESSION', 'TypeScript suppression requires explicit review.')
  if (path.includes('/src/') && /(?:session|agent\.session)\.append\(\s*['"]military\//u.test(text)) {
    add('CRITICAL', 'CUSTOM_REQUIRED_SESSION_EVENT', path, lineOf(text, text.search(/military\//u)), 'RC.2 external plugins must not persist required military/* events into the DSH Session log.')
  }
  if (path.includes('/src/') && /delivery\s*:\s*['"]wakeup['"]/u.test(text)) {
    add('HIGH', 'RC2_WAKEUP_DELIVERY', path, lineOf(text, text.search(/wakeup/u)), 'RC.2 renamed subagent report delivery wakeup to next-step.')
  }
  if (path.endsWith('child-transport.ts') && /\.agents\.create\(/u.test(text)) {
    add('HIGH', 'BYPASS_CONTINUABLE_MANAGER', path, lineOf(text, text.search(/\.agents\.create/u)), 'Department children must be created through RC.2 startContinuable().')
  }
}

async function reviewPackageVersions() {
  const manifests = [...await collect('packages'), ...await collect('apps')].filter(path => path.endsWith('package.json'))
  for (const path of manifests) {
    const value = JSON.parse(await readFile(path, 'utf8'))
    for (const bucket of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(value[bucket] ?? {})) {
        if (name === '@deepseek-ai/cordis' && version !== CORDIS) add('HIGH', 'CORDIS_VERSION', path, 1, `Expected ${CORDIS}, received ${version}.`)
        if (name === '@deepseek-ai/schemastery' && version !== SCHEMASTERY) add('HIGH', 'SCHEMASTERY_VERSION', path, 1, `Expected ${SCHEMASTERY}, received ${version}.`)
        if (name.startsWith('@deepseek-ai/dsh-') && version !== RC2) add('HIGH', 'DSH_VERSION', path, 1, `Expected exact ${RC2}, received ${version}.`)
      }
    }
    if (value.name === '@dsh-military/webui') {
      const peers = value.peerDependencies ?? {}
      const dev = value.devDependencies ?? {}
      for (const [name, version] of Object.entries(peers)) {
        if (dev[name] !== version) add('HIGH', 'CLIENT_PEER_DEV_MISMATCH', path, 1, `${name} must have a matching devDependency for RC.2 client builds.`)
      }
      if (value.dsh?.client === undefined) add('HIGH', 'CLIENT_MANIFEST_MISSING', path, 1, 'RC.2 dynamic client package must declare dsh.client.')
      if (!Array.isArray(value.dsh?.client?.inject)) add('HIGH', 'CLIENT_INJECT_MISSING', path, 1, 'RC.2 dynamic client package must declare dsh.client.inject.')
    }
    if (['@dsh-military/plugin-host', '@dsh-military/tools', '@dsh-military/command-brainstorm', '@dsh-military/webui'].includes(value.name)) {
      for (const name of Object.keys(value.dependencies ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh-') || name === '@deepseek-ai/cordis' || name === '@deepseek-ai/schemastery') {
          add('HIGH', 'DUPLICATE_DSH_RUNTIME', path, 1, `${name} must be a peer dependency so a preset does not load a duplicate RC.2 runtime identity.`)
        }
      }
    }
  }
}

async function reviewSourcePollution() {
  for (const path of await collect('packages')) {
    if (!path.includes('/src/')) continue
    if (/\.(?:js|cjs|mjs|d\.ts|map|tsbuildinfo)$/u.test(path)) {
      add('HIGH', 'SOURCE_POLLUTION', path, 1, 'Generated output must not live under src/.')
    }
  }
}

async function architecture(name, path, needles) {
  const paths = Array.isArray(path) ? path : [path]
  const parts = []
  for (const candidate of paths) {
    try {
      parts.push(await readFile(candidate, 'utf8'))
    } catch {}
  }
  const text = parts.join('\n')
  const missing = needles.filter(needle => !text.includes(needle))
  const passed = missing.length === 0
  const reportedPath = paths.join(', ')
  checks.push({ name, passed, path: reportedPath, missing })
  if (!passed) add('HIGH', 'ARCHITECTURE_GAP', reportedPath, 0, `${name} is missing: ${missing.join(', ')}`)
}

function match(path, text, pattern, severity, code, message) {
  for (const occurrence of occurrences(text, pattern)) add(severity, code, path, occurrence.line, message)
}

function occurrences(text, pattern) {
  pattern.lastIndex = 0
  return [...text.matchAll(pattern)].map(item => ({ line: lineOf(text, item.index ?? 0), text: item[0] }))
}

function lineOf(text, index) { return 1 + text.slice(0, Math.max(0, index)).split('\n').length - 1 }
function add(severity, code, path, line, message) { findings.push({ severity, code, path, line, message }) }
function isCode(path) { return /\.(?:ts|tsx|mjs)$/u.test(path) }

async function collectSource(root) {
  const all = await collect(root)
  return all.filter(path => path.includes('/src/') && isCode(path))
}

async function collect(root) {
  const output = []
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return output }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) output.push(...await collect(path))
    else output.push(path)
  }
  return output
}

function renderMarkdown(report) {
  return [
    '# Code Review Report', '',
    `Generated: ${report.generatedAt}`, '',
    `Baseline: dsh ${report.baseline.release} @ ${report.baseline.commit}`, '',
    '## Scope', '',
    `Reviewed ${report.filesReviewed} source, test and build-script files. Generated lib/ and .build/ artifacts were excluded from source scanning and validated separately by the build/tests.`, '',
    '## Architecture and policy checks', '',
    ...report.architectureChecks.map(item => `- ${item.passed ? '[x]' : '[ ]'} ${item.name}${item.passed ? '' : ` — missing: ${item.missing.join(', ')}`}`), '',
    '## Findings', '',
    ...(report.findings.length === 0
      ? ['No static findings.']
      : report.findings.map(item => `- **${item.severity} ${item.code}** — \`${item.path}:${item.line}\`: ${item.message}`)), '',
    '## Disposition', '',
    report.disposition === 'PASS'
      ? 'PASS — no critical or high-severity findings remain.'
      : `FAIL — ${report.blockingFindings} critical/high-severity finding(s) remain.`, '',
    '## Runtime review boundary', '',
    report.runtimeBoundary, '',
  ].join('\n')
}
