import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(resolve(root, path), 'utf8')

const missionKernel = read('packages/core/src/mission-kernel.ts')
const sqliteLedger = read('packages/storage-sqlite/src/ledger.ts')
const sqliteDatabase = read('packages/storage-sqlite/src/database.ts')
assert.match(missionKernel, /ledger\.transactCommand\(/u)
assert.doesNotMatch(sqliteLedger, /transactionAsync\(/u)
assert.match(sqliteLedger, /mission_command_operations/u)
assert.match(sqliteLedger, /PENDING_EFFECT/u)
assert.match(sqliteLedger, /EFFECT_APPLIED/u)
assert.match(sqliteDatabase, /BEGIN IMMEDIATE/u)
assert.match(sqliteDatabase, /ROLLBACK/u)
assert.match(sqliteDatabase, /transaction callbacks must be synchronous/u)
assert.match(sqliteLedger, /mission_command_receipts/u)
assert.match(sqliteLedger, /result_json/u)

const authorization = read('packages/plugin-host/src/tool-authorization.ts')
const canonical = authorization.indexOf('await authorizeToolPath(')
const downstream = authorization.indexOf('const downstream = await next()', canonical)
const reservation = authorization.indexOf('reserveToolExecutionBudget(', downstream)
const grant = authorization.indexOf('capabilityGrants.consume(', reservation)
assert.ok(canonical >= 0, 'department tool path canonicalization is absent')
assert.ok(
  canonical < downstream && downstream < reservation && reservation < grant,
  'path, downstream, budget, and Capability Grant admission order regressed',
)

const verification = read('packages/core/src/verification.ts')
assert.match(verification, /observedEvidence|receiptStore|evidenceStore/iu)
assert.doesNotMatch(
  verification,
  /declaredToolCallIds\.length\s*>\s*0\s*\)/u,
  'declared tool-call IDs may not substitute for host-observed evidence',
)

const schemas = read('packages/tools/src/runtime-validation.ts')
assert.match(schemas, /validateSchema/u)
assert.match(schemas, /additionalProperties/u)
assert.match(schemas, /parseCandidateSubmission/u)

const inspector = read('packages/tools/src/inspector.ts')
assert.doesNotMatch(
  inspector,
  /sessionId:\s*args\.agentId/u,
  'Inspector may not infer a Session identity from an Agent id',
)

const web = read('packages/webui/src/client/index.tsx')
const settingsCenter = read('packages/webui/src/client/settings-center.tsx')
const roleWorkbench = read('packages/webui/src/client/role-workbench.tsx')
const operationsCenter = read('packages/webui/src/client/operations-center.tsx')
const workspaceCenter = read('packages/webui/src/client/workspace-center.tsx')
const benchmarkCenter = read('packages/webui/src/client/benchmark-center.tsx')
const knowledgeCenter = read('packages/webui/src/client/knowledge-center.tsx')
const controlPlaneRemote = read('packages/plugin-host/src/control-plane-remote.ts')
assert.doesNotMatch(web, /['"]settings\.section['"]/u)
assert.match(web, /['"]sidebar\.footer\.action['"]/u)
assert.match(web, /['"]shell\.overlay['"]/u)
assert.match(web, /id:\s*['"]military-settings['"]/u)
assert.match(web, /connection=\{connection\}/u)
assert.match(settingsCenter, /useSyncExternalStore/u)
assert.match(settingsCenter, /useCallback/u)
assert.match(settingsCenter, /useEffect\(\(\) => \{ setDraft\(value\) \}, \[value\]\)/u)
assert.match(roleWorkbench, /data-role-prompt-editor/u)
assert.match(roleWorkbench, /恢复自带提示词/u)
assert.match(settingsCenter, /Military-Specs 工作区/u)
assert.match(web, /dsh-military: settings centre overlay/u)
assert.match(roleWorkbench, /['"]militaryControlPlane['"][\s\S]*['"]snapshot['"]/u)
assert.match(roleWorkbench, /['"]militaryControlPlane['"][\s\S]*['"]execute['"]/u)
assert.match(roleWorkbench, /恢复自带提示词/u)
assert.match(controlPlaneRemote, /case 'RESTORE_ROLE_PROMPT'/u)
assert.match(operationsCenter, /['"]militaryOperations['"][\s\S]*['"]snapshot['"]/u)
assert.match(operationsCenter, /['"]militaryOperations['"][\s\S]*['"]execute['"]/u)
assert.match(workspaceCenter, /['"]militaryWorkspace['"][\s\S]*['"]snapshot['"]/u)
assert.match(workspaceCenter, /INSPECT_WORKSPACE/u)
assert.match(benchmarkCenter, /['"]militaryBenchmark['"][\s\S]*['"]snapshot['"]/u)
assert.match(benchmarkCenter, /RUN_DETERMINISTIC/u)
assert.match(knowledgeCenter, /SIMULATE_RECALL/u)

const plane = read('packages/plugin-host/src/agent-plane.ts')
for (const registration of [
  'registerAgentLifecycle',
  'registerContextAudit',
  'registerRequestRouting',
  'registerToolPipeline',
  'registerCompletionInterlock',
]) {
  assert.match(plane, new RegExp(registration, 'u'))
}
assert.doesNotMatch(plane, /ctx\.on\(/u)

const workspaces = read('packages/infrastructure/src/workspaces.ts')
const engineer = read('packages/tools/src/engineer.ts')
const specsControl = read('packages/plugin-host/src/specs-control.ts')
assert.match(workspaces, /isAbsolute\(workspaceKey\)[\s\S]*new LocalMainGit\(resolve\(workspaceKey\)\)/u)
assert.match(workspaces, /snapshotById\(id: string\)/u)
assert.match(workspaces, /repositoryPath\(workspaceSnapshotId: string\)/u)
assert.match(engineer, /sessionGate[\s\S]*repositoryPath\([\s\S]*AGENT_EXECUTION_BINDING_MISMATCH/u)
assert.match(specsControl, /!isAbsolute\(value\)/u)

const specs = read('packages/infrastructure/src/specs.ts')
assert.match(specs, /#applyAtomic\(/u)
assert.match(specs, /#validatePlan\(/u)
assert.match(specs, /restoreTransaction\(/u)
assert.match(specs, /Specs rollback verification detected residual repository changes/u)
const planValidation = specs.indexOf('const plan = this.#validatePlan(')
const firstSpecsWrite = specs.indexOf('await writeFile(', specs.indexOf('async #applyAtomic'))
assert.ok(
  planValidation >= 0 && firstSpecsWrite >= 0 && planValidation < firstSpecsWrite,
  'Specs must validate its complete transaction plan before the first write',
)

const artifact = read('packages/tools/src/artifact.ts')
assert.match(artifact, /ref\.startsWith\('workspace-snapshot-'\)/u)
assert.match(artifact, /workspaces\.snapshotById\(ref\)/u)

const pipeline = read('packages/plugin-host/src/tool-pipeline.ts')
assert.match(pipeline, /const admittedCalls = new Set<string>\(\)/u)
assert.match(pipeline, /if \(admitted\) \{[\s\S]*toolExecutionUsageReceipt/u)
assert.match(pipeline, /Promise\.allSettled/u)
assert.match(pipeline, /topic:\s*['"]tool-execution\.settle['"]/u)
assert.match(pipeline, /policies\.toolProfile\('general-tools'\)/u)

const defaults = read('packages/plugin-host/src/defaults.ts')
assert.match(defaults, /rc2GeneralToolNames[\s\S]*ask_user_question/u)
assert.doesNotMatch(
  defaults.slice(
    defaults.indexOf('export const rc2GeneralToolNames'),
    defaults.indexOf('export const defaultGeneralPolicy'),
  ),
  /['"]bash['"]/u,
)

const contextAudit = read('packages/plugin-host/src/context-audit.ts')
const requestRouting = read('packages/plugin-host/src/request-routing.ts')
const completionInterlock = read('packages/plugin-host/src/completion-interlock.ts')
const hostRuntime = read('packages/plugin-host/src/host-runtime.ts')
const operationsRemote = read('packages/plugin-host/src/operations-remote.ts')
const taskReducer = read('packages/core/src/task-reducer.ts')
assert.match(contextAudit, /effectiveMaximumSteps/u)
assert.match(contextAudit, /STEP_BUDGET_EXHAUSTED/u)
assert.match(contextAudit, /departmentWallClockExhaustion/u)
assert.match(contextAudit, /WALL_CLOCK_BUDGET_EXHAUSTED/u)
assert.match(completionInterlock, /maximumNoProgressTurns/u)
assert.match(requestRouting, /taskMaxOutputTokens/u)
assert.match(requestRouting, /USER_CANCELLED/u)
assert.match(hostRuntime, /abortMilitaryAgent/u)
assert.match(operationsRemote, /application\.runtime\.cancelMission/u)
assert.match(operationsRemote, /abortMilitaryAgent/u)
assert.match(operationsRemote, /forgetDepartmentChild/u)
assert.match(hostRuntime, /authoritativeSessionWorkspaceKey/u)
assert.doesNotMatch(
  hostRuntime,
  /agent\.session\.header\.cwd\s*\?\?\s*this\.config\.repositoryRoot/u,
  'a missing root Session workspace may not fall back to the Web process directory',
)
assert.match(taskReducer, /case 'task\/cancelled'/u)

const specsSchema = JSON.parse(read('packages/contracts/schemas/specs-maintenance-order.schema.json'))
assert.deepEqual(specsSchema.properties.validation.items.enum, ['git diff --check'])
assert.equal(specsSchema.properties.validation.maxItems, 1)
const specsDraftSchema = JSON.parse(read('packages/contracts/schemas/specs-apply-draft.schema.json'))
assert.deepEqual(specsDraftSchema.required, ['updates'])
assert.deepEqual(specsDraftSchema.properties.updates.items.required, ['document', 'purpose'])
assert.ok(specsDraftSchema.properties.updates.items.properties.content)
assert.ok(specsDraftSchema.properties.updates.items.properties.contentArtifactIds)

const taskDraft = read('packages/tools/src/task-draft.ts')
const worker = read('packages/tools/src/worker.ts')
const spawner = read('packages/runtime/src/agents.ts')
assert.match(taskDraft, /maxOutputTokens:\s*draft\.budget\.maxOutputTokens \?\? 16_384/u)
assert.match(spawner, /request\.taskOrder\?\.budget\.toolCalls/u)
assert.match(spawner, /maximumWallClockSeconds/u)
assert.match(worker, /requireTaskGuidanceBudget/u)
assert.match(worker, /event\.type !== 'radio\/requested'/u)
assert.ok(
  existsSync(resolve(root, 'tests/fixtures/cb4-session-regression.json')),
  'the stopped cb4 Session must remain a regression fixture',
)
assert.ok(
  existsSync(resolve(root, 'tests/fixtures/c21-session-regression.json')),
  'the c21 parent/child Session must remain a regression fixture',
)

for (const directory of readdirSync(resolve(root, 'packages'), { withFileTypes: true })) {
  if (!directory.isDirectory()) continue
  const manifestPath = `packages/${directory.name}/package.json`
  if (!existsSync(resolve(root, manifestPath))) continue
  const manifest = JSON.parse(read(manifestPath))
  assert.ok(
    manifest.exports?.['./invariant'],
    `${manifest.name} must export ./invariant`,
  )
  const invariant = read(`packages/${directory.name}/src/invariant.ts`)
  assert.match(invariant, new RegExp(`const PACKAGE_NAME = ['"]${escapeRegex(manifest.name)}['"]`, 'u'))
  assert.match(invariant, /No runtime invariant:/u)
}

assert.ok(
  existsSync(resolve(root, 'pnpm-lock.yaml')),
  'release must carry pnpm-lock.yaml',
)
console.log('repair regressions: PASS')

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
