import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(resolve(root, path), 'utf8')
const exists = path => existsSync(resolve(root, path))
const source = path => exists(path) ? read(path) : ''
const checks = []
const add = (id, ok, evidence) => checks.push({ id, ok, evidence })

const missionKernel = source('packages/core/src/mission-kernel.ts')
const sqliteLedger = source('packages/storage-sqlite/src/ledger.ts')
const sqliteDatabase = source('packages/storage-sqlite/src/database.ts')
const toolAuthorization = source('packages/plugin-host/src/tool-authorization.ts')
const applicationFactory = source('packages/plugin-host/src/application-factory.ts')
const integration = source('packages/infrastructure/src/integration.ts')
const verification = source('packages/core/src/verification.ts')
const contextMaterializer = source('packages/runtime/src/context-materializer.ts')
const runtime = source('packages/core/src/runtime.ts')
const memoryLedger = source('packages/core/src/memory-ledger.ts')
const inspector = source('packages/tools/src/inspector.ts')
const requestRouting = source('packages/plugin-host/src/request-routing.ts')
const toolPipeline = source('packages/plugin-host/src/tool-pipeline.ts')
const specialAutomation = source('packages/runtime/src/special-department-automation.ts')
const specialHost = source('packages/plugin-host/src/host-runtime.ts')
const web = source('packages/webui/src/client/index.tsx')
const agentPlane = source('packages/plugin-host/src/agent-plane.ts')
const workspaces = source('packages/infrastructure/src/workspaces.ts')
const specs = source('packages/infrastructure/src/specs.ts')
const specsControl = source('packages/plugin-host/src/specs-control.ts')
const engineer = source('packages/tools/src/engineer.ts')
const artifact = source('packages/tools/src/artifact.ts')
const defaults = source('packages/plugin-host/src/defaults.ts')
const contextAudit = source('packages/plugin-host/src/context-audit.ts')
const completionInterlock = source('packages/plugin-host/src/completion-interlock.ts')
const taskReducer = source('packages/core/src/task-reducer.ts')
const promptSurface = source('packages/plugin-host/src/prompt-surface.ts')
const brainstorm = source('packages/command-brainstorm/src/index.ts')
const generalTools = source('packages/tools/src/general.ts')
const rc2Adapter = source('packages/plugin-host/src/rc2-adapter.ts')
const childTransport = source('packages/plugin-host/src/child-transport.ts')
const localGit = source('packages/infrastructure/src/git.ts')
const executionRouter = source('packages/core/src/execution-router.ts')
const hostEntry = source('packages/plugin-host/src/index.ts')
const departmentSpawner = source('packages/runtime/src/agents.ts')
const toolNames = source('packages/contracts/src/tool-names.ts')
const rc2E2e = source('scripts/run-rc2-e2e.mjs')
const terminalTools = source('packages/tools/src/common.ts')
const workerTools = source('packages/tools/src/worker.ts')
const taskDraft = source('packages/tools/src/task-draft.ts')
const settingsHost = source('packages/plugin-host/src/settings.ts')
const settingsCenter = source('packages/webui/src/client/settings-center.tsx')
const roleWorkbench = source('packages/webui/src/client/role-workbench.tsx')
const controlPlane = [
  source('packages/plugin-host/src/control-plane-remote.ts'),
  source('packages/plugin-host/src/control-plane-support.ts'),
].join('\n')
const operationsRemote = source('packages/plugin-host/src/operations-remote.ts')
const workspaceRemote = source('packages/plugin-host/src/workspace-remote.ts')
const benchmarkRemote = source('packages/plugin-host/src/benchmark-remote.ts')
const benchmarkContract = source('packages/contracts/src/benchmark-control.ts')
const privateSkillRemote = source('packages/plugin-host/src/private-skill-remote.ts')
const tacticalTags = source('packages/core/src/tags.ts')
const dialogAccessibility = source('packages/webui/src/client/dialog-accessibility.ts')
const nativeUi = source('packages/webui/src/client/native-ui.css')
const lightweightSpecs = source('packages/tools/src/engineer.ts')
const pkg = JSON.parse(read('package.json'))

add(
  'C1-durable-command-saga',
  missionKernel.includes('ledger.transactCommand(')
    && !sqliteLedger.includes('transactionAsync(')
    && sqliteLedger.includes('mission_command_operations')
    && sqliteLedger.includes('PENDING_EFFECT')
    && sqliteLedger.includes('EFFECT_APPLIED')
    && sqliteDatabase.includes('BEGIN IMMEDIATE')
    && sqliteDatabase.includes('ROLLBACK')
    && sqliteDatabase.includes('transaction callbacks must be synchronous')
    && sqliteLedger.includes('mission_command_receipts')
    && sqliteLedger.includes('result_json'),
  'Mission admission, external effect, durable checkpoint, receipt, and outbox use a crash-recoverable Saga while SQLite transactions remain synchronous and short.',
)

const canonical = toolAuthorization.indexOf('await authorizeToolPath(')
const downstream = toolAuthorization.indexOf('const downstream = await next()', canonical)
const reservation = toolAuthorization.indexOf('reserveToolExecutionBudget(', downstream)
const grant = toolAuthorization.indexOf('capabilityGrants.consume(', reservation)
add(
  'C2-path-canonical-before-grant',
  canonical >= 0 && canonical < downstream && downstream < reservation && reservation < grant,
  'Canonical path/scope and downstream guards precede budget reservation and Capability Grant consumption.',
)

add(
  'H3-runtime-recovery',
  applicationFactory.includes('new SqliteMilitaryRuntimeStateStore')
    && runtime.includes('findMissionByRootSession')
    && runtime.includes('MilitaryRuntimeStateStore')
    && exists('packages/storage-sqlite/src/runtime-state.ts'),
  'Mission, Task, candidate, and verification projections use the SQLite runtime state seam and recover root Mission identity from the Ledger.',
)

const forbiddenCritical = [
  'InMemoryCapabilityGrantStore',
  'InMemoryMilitaryAuthorization',
  'InMemoryMilitaryResourceBudgets',
  'InMemoryMilitaryRadio',
  'InMemoryDecisionBroker',
]
add(
  'H4-no-critical-inmemory-production',
  forbiddenCritical.every(name => !applicationFactory.includes(`new ${name}`)),
  'Production composition does not instantiate critical in-memory governance providers.',
)

add(
  'H5-integration-reconciliation',
  integration.includes('reconcile')
    && integration.includes('receipt')
    && integration.includes('order')
    && /trailer|commit.*id/iu.test(integration),
  'Integration persists order/receipt state and reconciles Git after crash boundaries.',
)

add(
  'H6-authoritative-evidence',
  /Observed|observed|EvidenceStore|ReceiptStore/u.test(verification)
    && !/declaredToolCallIds\.length\s*>\s*0\s*\)/u.test(verification),
  'Verification resolves host-observed receipts instead of trusting declared call IDs.',
)

add(
  'H7-artifact-content',
  /TextDecoder|content/u.test(contextMaterializer)
    || exists('packages/tools/src/artifact.ts'),
  'Artifact bytes can be materialized into model-visible context.',
)

add(
  'H8-single-task-reducer',
  exists('packages/core/src/task-reducer.ts')
    && [runtime, memoryLedger, sqliteLedger].every(text =>
      /task-reducer|reduceTask/iu.test(text)),
  'Runtime and both Ledger implementations consume the shared Task reducer.',
)

const executionSources = [
  missionKernel,
  requestRouting,
  toolPipeline,
  ...readdirSync(resolve(root, 'packages/tools/src'))
    .filter(name => name.endsWith('.ts'))
    .map(name => source(`packages/tools/src/${name}`)),
].join('\n')
add(
  'H9-authority-wired',
  executionSources.includes('.authorize(')
    && executionSources.includes('oversight.requireAdmission'),
  'Execution entry points invoke durable Authority and oversight admission.',
)
add(
  'H9-budget-wired',
  executionSources.includes('.reserve(')
    && executionSources.includes('.settle(')
    && requestRouting.includes('reserveModelRequestBudget')
    && toolPipeline.includes('reserveToolExecutionBudget'),
  'Mission/model/tool workflows reserve and settle durable budgets.',
)

const runtimeValidation = source('packages/tools/src/runtime-validation.ts')
add(
  'H10-canonical-schema-runtime',
  runtimeValidation.includes('validateSchema')
    && runtimeValidation.includes('additionalProperties')
    && runtimeValidation.includes('parseCandidateSubmission'),
  'Model-produced contracts pass canonical JSON Schemas before handlers use them.',
)

add(
  'M11-exact-rc2-release-gate',
  String(pkg.scripts?.['release:verify'] ?? '').includes('all:rc2')
    && String(pkg.scripts?.['all:rc2'] ?? '').includes('typecheck:rc2'),
  'The release gate includes exact-checkout RC.2 declaration typechecking.',
)

add(
  'M12-rc2-web-reactivity',
  settingsCenter.includes('useSyncExternalStore')
    && settingsCenter.includes('useCallback')
    && settingsCenter.includes('useEffect(() => { setDraft(value) }, [value])')
    && web.includes("id: 'military-settings'")
    && web.includes("'sidebar.footer.action'")
    && web.includes("'shell.overlay'")
    && !web.includes("'settings.section'")
    && roleWorkbench.includes('data-role-prompt-editor')
    && exists('scripts/build-webui-rc2.mjs')
    && exists('tests/webui-reactivity.test.ts'),
  'WebUI uses stable RC.2 snapshots, adopts external values, owns explicit HMR cleanup, and exposes its modal role-prompt editor through behavior-tested sidebar/overlay surfaces.',
)

add(
  'M13-special-automation-composed',
  specialAutomation.includes('claimExpiresAt')
    && specialAutomation.includes('reconcile')
    && specialHost.includes('new SpecialDepartmentAutomation')
    && specialHost.includes('idempotencyKey: `${job.jobId}:attempt:${job.attempts}`'),
  'Special departments use a durable leased outbox and deterministic attempt-level child dispatch.',
)

add(
  'M14-inspector-identity',
  /sessionId:\s*args\.sessionId|sessionId:\s*inspectionInput\.sessionId/u.test(inspector)
    && !/sessionId:\s*args\.agentId/u.test(inspector),
  'Inspector requires an explicit immutable Session/Agent/generation tuple.',
)

add(
  'M15-lockfile',
  exists('pnpm-lock.yaml'),
  'The workspace carries a pnpm lockfile.',
)

const packageDirectories = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && exists(`packages/${entry.name}/package.json`))
  .map(entry => entry.name)
const invariantGaps = packageDirectories.filter(directory => {
  const manifest = JSON.parse(read(`packages/${directory}/package.json`))
  const invariant = source(`packages/${directory}/src/invariant.ts`)
  return manifest.exports?.['./invariant'] === undefined
    || !invariant.includes(`const PACKAGE_NAME = '${manifest.name}'`)
    || !invariant.includes('No runtime invariant:')
})
add(
  'M16-package-invariants',
  invariantGaps.length === 0,
  invariantGaps.length === 0
    ? 'Every published package exports and registers a package-owned invariant companion.'
    : `Invariant gaps: ${invariantGaps.join(', ')}`,
)

add(
  'M17-agent-plane-split',
  agentPlane.includes('registerAgentLifecycle')
    && agentPlane.includes('registerContextAudit')
    && agentPlane.includes('registerRequestRouting')
    && agentPlane.includes('registerToolPipeline')
    && agentPlane.includes('registerCompletionInterlock')
    && !agentPlane.includes('ctx.on(')
    && exists('tests/agent-plane-split.test.ts'),
  'The Agent Plane is a composition root over bounded policy modules with regression coverage.',
)

add(
  'M18-real-rc2-e2e',
  exists('scripts/run-rc2-e2e.mjs')
    && exists('tests/rc2-profile-e2e.test.ts'),
  'A real RC.2 Loader/Profile vertical E2E and restart test is present.',
)

add(
  'M19-reproducible-release',
  exists('scripts/build-release.mjs')
    && String(pkg.scripts?.['release:build'] ?? '').includes('build-release')
    && String(pkg.scripts?.['release:verify'] ?? '').includes('verify-release'),
  'Release scripts produce and verify installable tarballs, checksums, and clean-Profile activation.',
)

const runtimeBaselineFiles = collectFiles('packages')
  .filter(path => path.includes('/src/') || path.endsWith('package.json'))
  .concat(collectFiles('scripts').filter(path =>
    /\.(?:mjs|json)$/u.test(path) && path !== 'scripts/semantic-release-audit.mjs'))
const staleRuntimeFiles = runtimeBaselineFiles.filter(path =>
  /RC\.8|RC8|rc8|0\.1\.0-rc\.8|141eb6f/u.test(source(path)))
add(
  'M20-no-active-rc8-baseline',
  staleRuntimeFiles.length === 0,
  staleRuntimeFiles.length === 0
    ? 'Production source, manifests, and release scripts contain no active RC.8 baseline.'
    : `Active RC.8 references: ${staleRuntimeFiles.join(', ')}`,
)

add(
  'C21-session-workspace-authority',
  workspaces.includes('isAbsolute(workspaceKey)')
    && workspaces.includes('new LocalMainGit(resolve(workspaceKey))')
    && workspaces.includes('repositoryPath(workspaceSnapshotId: string)')
    && specsControl.includes('!isAbsolute(value)')
    && engineer.includes('AGENT_EXECUTION_BINDING_MISMATCH')
    && specialHost.includes('authoritativeSessionWorkspaceKey')
    && !specialHost.includes('agent.session.header.cwd ?? this.config.repositoryRoot'),
  'Workspace, Specs, Engineer and Git resolve one absolute root from the immutable Session/Snapshot binding.',
)

add(
  'C22-atomic-specs-transaction',
  specs.includes('#applyAtomic(')
    && specs.includes('const plan = this.#validatePlan(')
    && specs.includes('restoreTransaction(')
    && specs.includes('Specs rollback verification detected residual repository changes'),
  'Specs validates before writing and independently verifies rollback of files, index and HEAD.',
)

add(
  'H23-admitted-tool-settlement',
  toolPipeline.includes('const admittedCalls = new Set<string>()')
    && /if \(admitted\) \{[\s\S]*toolExecutionUsageReceipt/u.test(toolPipeline)
    && toolPipeline.includes('Promise.allSettled')
    && toolPipeline.includes("topic: 'tool-execution.settle'")
    && toolPipeline.includes("policies.toolProfile('general-tools')"),
  'Only admitted Tool calls settle a reservation, while General is also constrained by its immutable ToolProfile.',
)

const generalToolSurface = defaults.slice(
  defaults.indexOf('export const rc2GeneralToolNames'),
  defaults.indexOf('export const defaultGeneralPolicy'),
)
add(
  'H24-flash-tool-recovery-contract',
  artifact.includes("ref.startsWith('workspace-snapshot-')")
    && artifact.includes('workspaces.snapshotById(ref)')
    && generalToolSurface.includes("'ask_user_question'")
    && !generalToolSurface.includes("'bash'")
    && exists('tests/fixtures/cb4-session-regression.json')
    && exists('tests/cb4-session-regression.test.ts'),
  'Snapshot references, compact General surface and the stopped cb4 Flash failure classes are regression-locked.',
)

add(
  'H25-execution-abort-convergence',
  contextAudit.includes('effectiveMaximumSteps')
    && contextAudit.includes('STEP_BUDGET_EXHAUSTED')
    && completionInterlock.includes('maximumNoProgressTurns')
    && requestRouting.includes('USER_CANCELLED')
    && specialHost.includes('abortMilitaryAgent')
    && !specialHost.includes('application.runtime.cancelTask')
    && operationsRemote.includes('application.runtime.cancelMission')
    && operationsRemote.includes('forgetDepartmentChild')
    && taskReducer.includes("case 'task/cancelled'"),
  'Invocation abort settles only its Activation, while explicit Mission cancellation passes through the Kernel and releases every governed child resource.',
)

add(
  'H26-flash-prompt-tool-parity',
  promptSurface.includes("'system-prompt/assemble'")
    && promptSurface.includes('assembly.tools')
    && promptSurface.includes('visibleTools.has(toolName)')
    && promptSurface.includes('Military 工具边界')
    && brainstorm.includes('advisor-generalist')
    && brainstorm.includes('without a taskId')
    && generalTools.includes('latestRunnableTemplateSummaries')
    && generalTools.includes("template.status === 'ACTIVE' || template.status === 'CANARY'")
    && exists('tests/fixtures/573e-session-regression.json')
    && exists('tests/flash-prompt-parity-regression.test.ts'),
  'Rendered RC.2 prompt prose follows the exact request tool schemas, repository discovery has one visible advisor route, and status remains compact.',
)

add(
  'H27-c21-parent-child-and-specs-convergence',
  defaults.includes("'report'")
    && rc2Adapter.includes("return 'next-step'")
    && childTransport.includes("name !== 'report'")
    && generalTools.includes('END_CURRENT_TURN')
    && contextAudit.includes('consumeCancelledChildSettlementOnly')
    && contextAudit.includes('DEPARTMENT_FINALIZATION_GRACE_STEPS')
    && toolPipeline.includes('FINALIZATION_ONLY_TOOLS')
    && engineer.includes('compileEngineerSpecsDraft')
    && engineer.includes('recordSpecsCommit')
    && engineer.includes('reportTerminalOutcome')
    && engineer.includes('exec.concludeTurn()')
    && localGit.includes("'--untracked-files=all'")
    && executionRouter.includes('input.task.budget.modelSteps ?? 16')
    && generalTools.includes('identityRefsAreArtifacts: false')
    && exists('tests/fixtures/c21-session-regression.json')
    && exists('tests/c21-session-regression.test.ts'),
  'c21 report authorization/wakeup, cancellation suppression, shallow Specs authority, exact untracked paths, Task step budget and successful receipt delivery are regression-locked.',
)

add(
  'H28-4844-first-request-and-file-workflow',
  hostEntry.includes('registerContinuableSetup')
    && hostEntry.includes('installMilitaryPromptSurface')
    && promptSurface.includes('state.profileRef')
    && childTransport.includes('modelVisibleDepartmentTools')
    && childTransport.includes('departmentWorkspaceInstruction')
    && departmentSpawner.includes('taskGrantedTools')
    && toolNames.includes('taskControlToolNames')
    && !engineer.includes("name: 'military_specs_validate'")
    && !engineer.includes("name: 'military_git_local_commit'")
    && specsControl.includes('metadata.isDirectory()')
    && specsControl.includes('missingPaths')
    && localGit.includes("entry.status === '??'")
    && localGit.includes('isIgnorableWorkspaceMetadata')
    && localGit.includes("'--only'")
    && specialHost.includes('materialStatusPaths')
    && rc2E2e.includes('initialEngineerRequest')
    && rc2E2e.includes('military_workspace_write')
    && rc2E2e.includes('military_workspace_edit')
    && exists('tests/fixtures/4844-session-regression.json')
    && exists('tests/4844-session-regression.test.ts'),
  '4844 first-request parity, Task tool ceiling, one-action Engineer Specs flow, directory reads, metadata-safe Git and real RC.2 Worker write/edit are regression-locked.',
)

add(
  'H29-lightweight-terminal-and-task-contract',
  terminalTools.includes('runDurableTerminalMutation')
    && terminalTools.includes('receiptKey: input.idempotencyKey')
    && toolPipeline.includes('TURN_ALREADY_CONCLUDED')
    && workerTools.includes('exec.concludeTurn()')
    && taskDraft.includes('compileTaskDraft')
    && taskDraft.includes('defaultAllowedTools')
    && !taskDraft.includes('allowedTools: {')
    && specialHost.includes('#departmentDispatchKey')
    && specialHost.includes('idempotencyKey,'),
  'Terminal mutations, same-response latching, parent receipts, stable dispatch and Host-compiled Task authority are fixed lightweight-model boundaries.',
)

add(
  'H30-flash-primary-visual-settings',
  defaults.includes("model: 'deepseek-v4-flash'")
    && defaults.includes("status: 'CANARY'")
    && defaults.includes('allowCanaryModel: true')
    && web.includes("id: 'military-settings'")
    && web.includes("'sidebar.footer.action'")
    && web.includes("'shell.overlay'")
    && !web.includes("'settings.section'")
    && web.includes('connection={connection}')
    && settingsCenter.includes('<RoleWorkbench')
    && roleWorkbench.includes("'militaryControlPlane'")
    && roleWorkbench.includes("'snapshot'")
    && roleWorkbench.includes('data-role-prompt-editor')
    && roleWorkbench.includes('恢复自带提示词')
    && controlPlane.includes('ctx.llm.listModels(provider.id)')
    && controlPlane.includes('this.auditModelCatalog(entries)')
    && controlPlane.includes('applyRoleDraft')
    && controlPlane.includes('this.ctx.settings.update'),
  'Flash is the governed default, Pro remains explicit, and the sidebar role workbench uses a Host-audited live catalog plus executable Simplified Chinese prompts.',
)

add(
  'H31-executable-task-budgets-and-large-specs',
  taskDraft.includes('maxOutputTokens: draft.budget.maxOutputTokens ?? 16_384')
    && departmentSpawner.includes('request.taskOrder?.budget.toolCalls')
    && departmentSpawner.includes('maximumWallClockSeconds')
    && requestRouting.includes('taskMaxOutputTokens')
    && contextAudit.includes('departmentWallClockExhaustion')
    && workerTools.includes('requireTaskGuidanceBudget')
    && workerTools.includes("event.type !== 'radio/requested'")
    && lightweightSpecs.includes('military_specs_stage_chunk')
    && exists('tests/lightweight-specs-staging.test.ts')
    && rc2E2e.includes('Host-derived Task tool budget did not narrow')
    && rc2E2e.includes('Host-derived Task wall-clock budget did not narrow')
    && rc2E2e.includes('Task default must cap the Flash-primary'),
  'Task step/tool/Radio/wall-clock/output limits execute at Host boundaries, while staged Specs preserve large-document capability.',
)

add(
  'H32-role-governance-and-simplified-chinese-receipts',
  roleWorkbench.includes('PREVIEW_ROLE')
    && roleWorkbench.includes('SIMULATE_ROLE')
    && roleWorkbench.includes('RUN_LIVE_CANARY')
    && roleWorkbench.includes('simplifiedChineseReview')
    && controlPlane.includes('createSimplifiedChineseReviewReceipt')
    && controlPlane.includes('sourceHash')
    && controlPlane.includes('resultHash')
    && exists('tests/control-plane-workbench.test.ts')
    && exists('tests/role-prompts.test.ts'),
  'Prompt preview/readiness/simulation, atomic revisions, and user-confirmed Simplified-Chinese transformations are Host-recomputed and regression-locked.',
)

add(
  'H33-operations-and-workspace-control',
  operationsRemote.includes("'SESSION_TIMELINE'")
    && operationsRemote.includes("'PREVIEW_RECOVERY'")
    && operationsRemote.includes("'EXECUTE_RECOVERY'")
    && operationsRemote.includes('confirmationPhrase')
    && workspaceRemote.includes("'INSPECT_WORKSPACE'")
    && workspaceRemote.includes('this.catalog(signal)')
    && workspaceRemote.includes('this.inspect(workspace')
    && !workspaceRemote.includes('action.absolutePath')
    && exists('tests/session-diagnostics.test.ts')
    && exists('tests/workspace-control.test.ts'),
  'Diagnostics are Host-redacted, recovery is previewed/confirmed/idempotent, and Specs workspace inspection accepts only Host catalog identities.',
)

add(
  'H34-fixed-benchmark-and-provider-sample-discipline',
  benchmarkContract.includes("'READ_ONLY_ANALYSIS'")
    && benchmarkContract.includes("'RESTART_RECOVERY'")
    && benchmarkRemote.includes('MILITARY_BENCHMARK_DATASET_HASH')
    && benchmarkRemote.includes("'RUN_DETERMINISTIC'")
    && benchmarkRemote.includes("'ASSESS_PROVIDER_SESSION'")
    && benchmarkRemote.includes('uniqueSessionCount >= 10')
    && benchmarkRemote.includes('confidenceInterval.high - confidenceInterval.low <= 0.35')
    && exists('tests/benchmark-control.test.ts'),
  'The fixed nine-scenario dataset is content-addressed, Provider observations dedupe exact-route Sessions, and stability requires at least ten Sessions plus a bounded interval.',
)

add(
  'H35-shared-private-skill-recall-and-transparent-projection',
  tacticalTags.includes('resolveTacticalRecall')
    && privateSkillRemote.includes("type === 'SIMULATE_RECALL'")
    && privateSkillRemote.includes('resolveTacticalRecall')
    && privateSkillRemote.includes('renderTacticApplicabilityCards')
    && privateSkillRemote.includes('createsTask: false')
    && privateSkillRemote.includes('textHash')
    && privateSkillRemote.includes('inputCharacters: taskText.length')
    && privateSkillRemote.includes('putSync(RECALL_SIMULATION_NAMESPACE, simulationId, result')
    && exists('tests/private-skill-supply-chain.test.ts'),
  'Knowledge transparency is sanitized and recall simulation reuses the real resolver/renderer without creating a Task, invoking a model, or persisting raw task text.',
)

add(
  'H36-web-accessibility-and-ime-boundary',
  dialogAccessibility.includes("event.key !== 'Tab'")
    && dialogAccessibility.includes("dialog.setAttribute('tabindex', '-1')")
    && roleWorkbench.includes('nativeEvent.isComposing')
    && roleWorkbench.includes('role="listbox"')
    && settingsCenter.includes('role="tablist"')
    && nativeUi.includes('@media (forced-colors: active)')
    && nativeUi.includes('@media (prefers-contrast: more)')
    && exists('tests/webui-native-theme.test.ts'),
  'Native Modals gain focus trapping/return, tab/listbox semantics are keyboard and IME safe, and high-contrast/zoom overflow contracts are release-gated.',
)

const failed = checks.filter(check => !check.ok)
const report = {
  version: '0.9.0-alpha.28',
  generatedAt: new Date().toISOString(),
  baseline: {
    release: '0.1.1-rc.2',
    commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  },
  checks,
  passed: failed.length === 0,
  failed: failed.map(check => check.id),
}
writeFileSync(
  resolve(root, 'SEMANTIC-RELEASE-AUDIT.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)
if (failed.length > 0) {
  for (const failure of failed) {
    console.error(`${failure.id}: ${failure.evidence}`)
  }
  process.exit(1)
}

function collectFiles(directory) {
  const output = []
  let entries
  try {
    entries = readdirSync(resolve(root, directory), { withFileTypes: true })
  } catch {
    return output
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...collectFiles(path))
    else output.push(path)
  }
  return output
}
