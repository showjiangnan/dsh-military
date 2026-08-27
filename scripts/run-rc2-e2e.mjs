import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const RC2_RELEASE = '0.1.1-rc.2'
const RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const dshRoot = resolve(process.env.DSH_RC2_ROOT ?? '../../deepseek-harness')
const dshHome = process.env.DSH_HOME
const reportPath = process.env.DSH_MILITARY_E2E_REPORT
if (dshHome === undefined || dshHome.trim() === '') {
  throw new Error('run-rc2-e2e requires an isolated DSH_HOME containing the installed release artifact')
}

await verifyOfficialCheckout()
const { runProfile, loadLayeredEnv, LlmAdapter } = await loadRc2Boot()
const runId = crypto.randomUUID()
const rootSessionId = `military-e2e-root-${runId}`
let taskId
const repository = join(resolve(dshHome), 'e2e-workspace')
const previousCwd = process.cwd()
let active
let rootHandle
let childSessionId
let disposeE2eAdapter
const queuedControlledRequests = []
const controlledRequestWaiters = []

process.env.DSH_TELEMETRY_DISABLED = '1'
await initializeRepository(repository)
process.chdir(repository)

try {
  // Phase 1 exercises the real Loader, Profile, preset, Settings, Web Client
  // graph, Tool pipeline, and durable command idempotency.
  active = await bootProfile()
  const firstHost = requireMilitaryHost(active.ctx)
  assertWebClient(active.ctx)
  await active.ctx.settings.update('military-presentation', {
    showAdvancedAudit: true,
    compactEventCards: false,
  })
  assert.deepEqual(active.ctx.settings.get('military-presentation'), {
    terminology: 'military',
    showAdvancedAudit: true,
    compactEventCards: false,
  })
  rootHandle = await createMilitaryRoot(active.ctx, rootSessionId)
  await firstHost.ensureSessionBinding(rootHandle.agent)
  const rootMilitaryTools = visibleMilitaryTools(active.ctx, rootHandle.agent)
  assert.ok(rootMilitaryTools.includes('military_get_context'))
  assert.ok(rootMilitaryTools.includes('military_task_create'))
  assert.ok(rootMilitaryTools.includes('military_read_artifact'))
  assert.equal(rootMilitaryTools.includes('military_specs_read'), false)
  assert.equal(rootMilitaryTools.includes('military_submit_candidate'), false)
  const rootAssembly = await active.ctx.systemPrompt.assemble({
    agent: rootHandle.agent,
    scope: rootHandle.agent,
  })
  const rootVisibleTools = rootAssembly.tools.map(tool => tool.name).sort()
  assert.equal(rootVisibleTools.length, 6)
  assert.ok(rootVisibleTools.includes('ask_user_question'))
  assert.ok(rootVisibleTools.includes('military_mission_start'))
  assert.equal(rootVisibleTools.includes('military_task_create'), false)
  assert.equal(rootVisibleTools.includes('bash'), false)
  assert.equal(rootVisibleTools.includes('glob'), false)
  const rootSections = new Set(rootAssembly.sections.map(section => section.name))
  for (const hidden of [
    'tool:read',
    'tool:write',
    'tool:edit',
    'tool:glob',
    'tool:grep',
    'tool:bash',
    'tool:jobs',
    'tool:web_search',
  ]) {
    assert.equal(rootSections.has(hidden), false)
  }
  const rootPrompt = rootAssembly.sections.map(section => section.text).join('\n')
  assert.doesNotMatch(
    rootPrompt,
    /Use pwd|Use the (?:read|write|edit|glob|grep) tool|every bash result/u,
  )
  assert.match(rootPrompt, /Military 工具边界 general-tools@6/u)
  assert.match(rootPrompt, /advisor-generalist.*不得传入 taskId/u)

  const mission = await executeTool(active.ctx, rootHandle.agent, 'military_mission_start', {
    title: 'RC.2 installed-profile vertical E2E',
  }, `e2e-mission-start-${runId}`)
  const missionId = requireString(mission, 'missionId')
  const missionAssembly = await active.ctx.systemPrompt.assemble({
    agent: rootHandle.agent,
    scope: rootHandle.agent,
  })
  assert.ok(
    missionAssembly.tools.some(tool => tool.name === 'military_task_create'),
    'Task creation was not restored after the Mission bootstrap phase',
  )
  const brainstorm = await firstHost.application.runtime.startBrainstorm(rootSessionId)
  const context = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_get_context',
    {},
    `e2e-root-context-${runId}`,
  )
  assert.equal(context.mission?.missionId, missionId)
  assert.equal(context.brainstorm?.orderId, brainstorm.orderId)
  const duplicateMission = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_mission_start',
    {
      title: 'A retry must not create a second Mission',
    },
    `e2e-mission-start-duplicate-${runId}`,
  )
  assert.equal(duplicateMission.missionId, missionId)
  assert.equal(duplicateMission.disposition, 'EXISTING')
  const status = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_status',
    {},
    `e2e-status-repeat-${runId}`,
  )
  assert.ok(Array.isArray(status.templates))
  assert.equal(status.templates.length, 11)
  assert.equal(
    new Set(status.templates.map(template => template.templateId)).size,
    status.templates.length,
  )
  assert.ok(JSON.stringify(status).length < 8_000)

  const taskDraft = {
    taskKey: `vertical-${runId}`,
    direction: 'Installed Profile verification',
    wave: 'Wave 1 — isolated implementation',
    objective: 'Create and integrate one verified file from an isolated Worker worktree.',
    whyItMatters: 'Proves the installed RC.2 Profile executes the authoritative vertical path.',
    taskType: 'verification',
    assignedRole: 'worker',
    scope: {
      readPaths: ['.'],
      writePaths: ['src'],
      forbiddenPaths: ['.dsh-military'],
    },
    acceptanceCriteria: [
      'The isolated Worker file is verified and integrated into local main.',
    ],
    stopConditions: ['Stop after accepted integration or deterministic verification failure.'],
    escalationConditions: ['Escalate any path-scope or verification mismatch.'],
    contextFootprint: 'small',
    budget: {
      modelSteps: 8,
      toolCalls: 32,
      guidanceRequests: 2,
      wallClockSeconds: 300,
    },
  }
  const firstTask = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_task_create',
    taskDraft,
    `e2e-task-create-first-${runId}`,
  )
  taskId = requireString(firstTask, 'taskId')
  const duplicateTask = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_task_create',
    taskDraft,
    `e2e-task-create-duplicate-${runId}`,
  )
  assert.deepEqual(duplicateTask, firstTask, 'same-process duplicate command changed its durable result')
  await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_status',
    {},
    `e2e-status-${runId}`,
  )
  await rootHandle.dispose()
  rootHandle = undefined
  await active.ctx.fiber.dispose()
  active = undefined

  // Phase 2 boots a new Loader/Host process graph over the same Profile and
  // data root. The root Session and Task must recover before work continues.
  active = await bootProfile()
  const secondHost = requireMilitaryHost(active.ctx)
  rootHandle = await resumeMilitaryRoot(active.ctx, rootSessionId)
  await secondHost.ensureSessionBinding(rootHandle.agent)
  disposeE2eAdapter = await installControlledModel(active.ctx, secondHost, LlmAdapter)
  assert.equal(
    String(await secondHost.application.runtime.missionForSession(rootSessionId)),
    missionId,
    'Mission projection did not recover after Profile restart',
  )
  assert.equal(
    String((await secondHost.application.runtime.getTask(taskId)).taskId),
    taskId,
    'Task projection did not recover after Profile restart',
  )
  const restartDuplicate = await executeTool(active.ctx, rootHandle.agent, 'military_task_create', {
    ...taskDraft,
  }, `e2e-task-create-restart-duplicate-${runId}`)
  assert.deepEqual(restartDuplicate, firstTask, 'cross-restart duplicate command changed its durable result')

  const spawned = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_spawn_department_agent',
    {
      templateId: 'worker-default',
      prompt: 'Create src/e2e-result.txt, verify it, and submit the bounded Candidate.',
      label: 'RC.2 E2E worker',
      taskId,
    },
    `e2e-spawn-worker-${runId}`,
  )
  assert.equal(spawned.dispatchAccepted, true)
  assert.equal(spawned.childState, 'RUNNING')
  assert.equal(Object.hasOwn(spawned, 'childSessionId'), false)
  assert.equal(Object.hasOwn(spawned, 'bindingId'), false)
  const initialWorkerRequest = await withTimeout(
    nextControlledRequest(),
    10_000,
    'controlled Worker did not submit its first model request',
  )
  childSessionId = requireString(initialWorkerRequest, 'sessionId')
  const workerBinding = await secondHost.application.executionBindings.forSession(
    childSessionId,
  )
  assert.ok(workerBinding, 'Worker request has no durable execution binding')
  const workerGrant = await secondHost.application.capabilityGrants.get(
    workerBinding.capabilityGrantId,
  )
  assert.equal(
    workerGrant.maximumUses,
    32,
    'Task toolCalls budget did not narrow the durable Capability Grant',
  )
  const workerLifeBudget = await secondHost.application.resourceBudgets.getReservation(
    workerBinding.concurrencyReservationId,
  )
  assert.equal(
    Date.parse(workerLifeBudget.expiresAt) - Date.parse(workerLifeBudget.reservedAt),
    300_000,
    'Task wallClockSeconds did not narrow the durable child-life reservation',
  )
  assert.equal(
    initialWorkerRequest.maxTokens,
    16_384,
    'Task default must cap the Flash-primary Worker request at 16K output tokens',
  )
  const child = active.ctx.agents.get(childSessionId)
  assert.ok(child, 'continuable Worker was accepted but is absent from the live Agent registry')
  const initialWorkerToolNames = (initialWorkerRequest.tools ?? [])
    .map(tool => tool.name)
    .sort()
  assert.deepEqual(initialWorkerToolNames, [
    'edit',
    'glob',
    'grep',
    'military_get_context',
    'military_get_order',
    'military_get_tactical_directive',
    'military_radio_request',
    'military_record_observation',
    'military_submit_blocker',
    'military_submit_candidate',
    'military_submit_decision_questions',
    'read',
    'report',
    'write',
  ])
  assert.equal(initialWorkerToolNames.includes('bash'), false)
  assert.equal(initialWorkerToolNames.includes('job_output'), false)
  assert.doesNotMatch(
    initialWorkerRequest.system ?? '',
    /every bash result|job_output|DeepSeek Harness implementation checkout at/u,
  )
  assert.match(
    JSON.stringify(initialWorkerRequest.messages ?? []),
    /分配的隔离执行工作树/u,
  )
  assert.match(
    initialWorkerRequest.system ?? '',
    /Military 工具边界 worker-tools@(?:pending|6)/u,
  )
  const childMilitaryTools = visibleMilitaryTools(active.ctx, child)
  assert.ok(childMilitaryTools.includes('military_get_context'))
  assert.ok(childMilitaryTools.includes('military_get_order'))
  assert.ok(childMilitaryTools.includes('military_submit_candidate'))
  assert.equal(childMilitaryTools.includes('military_mission_start'), false)
  assert.equal(childMilitaryTools.includes('military_specs_read'), false)
  assert.equal(
    active.ctx.tools.schemas(child).some(schema => schema.name === 'report'),
    true,
    'RC.2 child-scoped report schema was removed by the Military ToolProfile',
  )
  const childContext = await executeTool(
    active.ctx,
    child,
    'military_get_context',
    {},
    `e2e-worker-context-${runId}`,
  )
  assert.equal(childContext.mission?.missionId, missionId)
  assert.equal(childContext.task?.taskId, taskId)
  assert.equal(Object.hasOwn(childContext, 'bindingId'), false)
  assert.equal(Object.hasOwn(childContext, 'grantId'), false)

  const binding = await secondHost.application.executionBindings.forSession(childSessionId)
  assert.ok(binding?.workspace, 'Worker has no durable isolated-workspace binding')
  const worktree = secondHost.application.workspaces.executionPath(binding.workspace.leaseId)
  await mkdir(join(worktree, 'src'), { recursive: true })
  await executeTool(
    active.ctx,
    child,
    'write',
    {
      file_path: join(worktree, 'src/e2e-result.txt'),
      content: `draft:${runId}\n`,
    },
    `e2e-worker-write-${runId}`,
  )
  const observedCallId = `call-e2e-worker-edit-${runId}`
  await executeTool(
    active.ctx,
    child,
    'edit',
    {
      file_path: join(worktree, 'src/e2e-result.txt'),
      old_string: `draft:${runId}`,
      new_string: `verified:${runId}`,
    },
    observedCallId,
  )

  const accepted = await executeTool(
    active.ctx,
    child,
    'military_submit_candidate',
    {
      summary: 'Created, edited and verified one Task-scoped file in the isolated Worker worktree.',
      evidenceRefs: [observedCallId],
      knownLimitations: [],
    },
    `e2e-submit-accepted-${runId}`,
  )
  assert.equal(accepted.verificationState, 'ACCEPTED')
  assert.equal(accepted.integrationReceipt?.disposition, 'APPLIED')
  assert.equal(
    await readFile(join(repository, 'src/e2e-result.txt'), 'utf8'),
    `verified:${runId}\n`,
  )
  assert.equal(
    await readFile(join(repository, '.DS_Store'), 'utf8'),
    'e2e desktop metadata\n',
  )
  await secondHost.departmentAgents.drain({
    parent: rootHandle.agent,
    childSessionIds: [childSessionId],
  })
  childSessionId = undefined

  const engineerTask = await executeTool(
    active.ctx,
    rootHandle.agent,
    'military_task_create',
    {
      taskKey: `engineer-contract-${runId}`,
      direction: 'Installed Profile verification',
      wave: 'Wave 2 — Specs prompt contract',
      objective: 'Create one exact Task-authorized Specs document.',
      whyItMatters: 'Proves the Engineer first request has one coherent mutation path.',
      taskType: 'specs',
      assignedRole: 'engineer',
      scope: {
        readPaths: ['.'],
        writePaths: ['specs'],
        forbiddenPaths: ['.dsh-military'],
      },
      acceptanceCriteria: [
        'The Engineer sees only the atomic Specs workflow.',
      ],
      contextFootprint: 'small',
    },
    `e2e-engineer-task-${runId}`,
  )
  const engineerTaskId = requireString(engineerTask, 'taskId')
  const engineerSpawned = await secondHost.departmentAgents.spawn({
    parent: rootHandle.agent,
    templateId: 'engineer-default',
    prompt: 'Read the current specs state and prepare the exact authorized document.',
    label: 'RC.2 E2E Engineer prompt contract',
    taskId: engineerTaskId,
    idempotencyKey: `e2e-spawn-engineer-${runId}`,
    signal: AbortSignal.timeout(60_000),
  })
  childSessionId = String(engineerSpawned.childSessionId)
  const engineer = active.ctx.agents.get(childSessionId)
  assert.ok(engineer, 'continuable Engineer was accepted but is absent from the live Agent registry')
  const initialEngineerRequest = await withTimeout(
    nextControlledRequest(),
    10_000,
    'controlled Engineer did not submit its first model request',
  )
  assert.equal(
    initialEngineerRequest.maxTokens,
    16_384,
    'Task default must cap the Flash-primary Engineer request at 16K output tokens',
  )
  assert.deepEqual(
    (initialEngineerRequest.tools ?? []).map(tool => tool.name).sort(),
    [
      'glob',
      'grep',
      'military_get_context',
      'military_get_order',
      'military_specs_apply_order',
      'military_specs_read',
      'military_submit_blocker',
      'read',
      'report',
    ],
  )
  assert.doesNotMatch(
    initialEngineerRequest.system ?? '',
    /Use the (?:write|edit) tool|every bash result|job_output/u,
  )
  assert.match(
    initialEngineerRequest.system ?? '',
    /Military 工具边界 engineer-tools@(?:pending|6)/u,
  )
  assert.match(
    JSON.stringify(initialEngineerRequest.messages ?? []),
    /完整最终内容一次性传给 military_specs_apply_order/u,
  )
  assert.match(
    JSON.stringify(initialEngineerRequest.messages ?? []),
    /任务授权的相对路径/u,
  )
  await secondHost.departmentAgents.drain({
    parent: rootHandle.agent,
    childSessionIds: [childSessionId],
  })
  childSessionId = undefined
  disposeE2eAdapter()
  disposeE2eAdapter = undefined
  await rootHandle.dispose()
  rootHandle = undefined
  await active.ctx.fiber.dispose()
  active = undefined

  // Phase 3 proves that accepted verification and integration facts survive a
  // second full Host restart and that Settings remained externally durable.
  active = await bootProfile()
  const recoveredHost = requireMilitaryHost(active.ctx)
  await recoveredHost.application.runtime.getTask(taskId)
  assert.equal(await recoveredHost.application.runtime.taskState(taskId), 'ACCEPTED')
  const events = await recoveredHost.application.ledger.readEvents(missionId)
  for (const type of [
    'mission/started',
    'task/created',
    'task/leased',
    'task/candidate-submitted',
    'verification/completed',
    'task/accepted',
    'task/integrated',
    'specs/commit-recorded',
  ]) {
    assert.ok(events.some(event => event.type === type), `recovered Mission ledger is missing ${type}`)
  }
  assert.equal(
    active.ctx.settings.get('military-presentation')?.showAdvancedAudit,
    true,
    'Settings update did not survive Profile restart',
  )
  assertWebClient(active.ctx)

  const report = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    dshBaseline: { release: RC2_RELEASE, commit: RC2_COMMIT },
    profile: 'web',
    preset: 'military',
    runId,
    checks: {
      loaderProfileBoots: 3,
      settingsWriteAndRestart: true,
      webClientRegistration: true,
      toolExecution: true,
      rootRoleToolVisibility: true,
      promptToolParity: true,
      compactStatus: true,
      workerRoleToolVisibility: true,
      firstChildRequestPromptToolParity: true,
      workerWriteAndEditTools: true,
      desktopMetadataIgnoredAndPreserved: true,
      authoritativeContext: true,
      brainstormMissionIdempotency: true,
      flashFriendlyTaskDraft: true,
      continuableWorker: true,
      shallowCandidateContract: true,
      continuableEngineer: true,
      engineerFirstRequestHasNineTools: true,
      durableDuplicateCommand: true,
      missionTaskRecovery: true,
      verificationAccepted: true,
      integrationApplied: true,
      finalRecovery: true,
    },
    missionId,
    taskId,
    eventCount: events.length,
    disposition: 'PASS',
  }
  if (reportPath !== undefined && reportPath.trim() !== '') {
    await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`DSH_MILITARY_E2E_RESULT=${JSON.stringify(report)}\n`)
} finally {
  if (childSessionId !== undefined && rootHandle !== undefined && active !== undefined) {
    await active.ctx.get('militaryHost')?.departmentAgents.drain({
      parent: rootHandle.agent,
      childSessionIds: [childSessionId],
    }).catch(() => undefined)
  }
  await rootHandle?.dispose().catch(() => undefined)
  disposeE2eAdapter?.()
  await active?.ctx.fiber.dispose().catch(() => undefined)
  process.chdir(previousCwd)
}

async function bootProfile() {
  return await runProfile({
    environment: loadLayeredEnv(`dsh-military-e2e-${runId}`),
    profile: 'web',
    patchFiles: [],
    args: ['--no-open', '--port', '0'],
  })
}

async function createMilitaryRoot(ctx, sessionId) {
  return await ctx.agents.create({
    sessionId,
    meta: { cwd: repository },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'military').then(() => undefined),
  })
}

async function resumeMilitaryRoot(ctx, sessionId) {
  return await ctx.agents.resume({
    resumeSessionId: sessionId,
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'military').then(() => undefined),
  })
}

async function executeTool(ctx, agent, name, args, callId) {
  const result = await ctx.tools.execute({
    callId,
    name,
    arguments: args,
    agent,
    signal: AbortSignal.timeout(60_000),
  })
  if (result.isError) {
    const rendered = result.content
      .map(block => block.type === 'text' ? block.text : `[${block.type}]`)
      .join('\n')
    throw new Error(`${name} failed (${JSON.stringify(result.error)}): ${rendered}`)
  }
  return result.value
}

function requireMilitaryHost(ctx) {
  const host = ctx.get('militaryHost')
  assert.ok(host, 'installed Bundle did not publish militaryHost')
  return host
}

function assertWebClient(ctx) {
  const modules = ctx.get('clientModules')
  assert.ok(modules, 'Web Profile did not publish clientModules')
  const entry = modules.graph().entries.find(candidate => candidate.id === '@dsh-military/bundle')
  assert.ok(entry, 'installed Bundle did not register its Web Client graph row')
  assert.match(entry.url, /^\/plugins\/@dsh-military\/bundle\/client\.js\?rev=/u)
}

async function installControlledModel(ctx, host, AdapterBase) {
  const provider = 'dsh-military-e2e'
  const model = 'controlled-hang'
  class ControlledAdapter extends AdapterBase {
    resolveModel(requestedProvider, requestedModel) {
      return Promise.resolve({
        provider: requestedProvider,
        id: requestedModel,
        name: 'dsh-military controlled E2E model',
        inputModalities: ['text'],
        context: { contextWindow: 1_000_000 },
        defaultMaxTokens: 65_536,
        reasoning: {
          efforts: ['off', 'low', 'high', 'max'].map(id => ({ id, name: id })),
          defaultEffort: 'high',
        },
      })
    }

    async * stream(options) {
      const waiter = controlledRequestWaiters.shift()
      if (waiter === undefined) queuedControlledRequests.push(options)
      else waiter(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'controlled RC.2 E2E worker is live' }
      await new Promise((_resolve, reject) => {
        const abort = () => reject(options.signal?.reason ?? new Error('controlled E2E stream aborted'))
        if (options.signal?.aborted === true) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }
  const dispose = ctx.get('llm').registerAdapter([provider], new ControlledAdapter())
  try {
    host.application.policies.registerModel({
      schemaVersion: '1.0.0',
      profileId: 'dsh-military-e2e-model-rc2',
      revision: 1,
      status: 'VALIDATED',
      provider,
      model,
      supportedReasoning: ['off', 'low', 'high', 'max'],
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      toolCalling: true,
      vision: false,
      inputModalities: ['text'],
      reasoningPassback: 'all-reasoning-turns',
      maximumRequestImageBytes: 20_971_520,
      dataResidencyPolicyRefs: ['dsh-provider-default@1'],
      benchmarks: [],
      validatedAt: new Date().toISOString(),
    })
    await selectControlledDepartmentTemplates(host)
    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}

async function selectControlledDepartmentTemplates(host) {
  for (const templateId of ['worker-default', 'engineer-default']) {
    const current = await host.application.templates.get(templateId)
    if (current.modelPolicy.provider === 'dsh-military-e2e') continue
    await host.application.templates.revise({
      ...current,
      revision: Number(current.revision) + 1,
      modelPolicy: {
        ...current.modelPolicy,
        provider: 'dsh-military-e2e',
        model: 'controlled-hang',
        modelCapabilityProfileId: 'dsh-military-e2e-model-rc2',
      },
      updatedAt: new Date().toISOString(),
    }, current.revision)
  }
}

function visibleMilitaryTools(ctx, agent) {
  return ctx.tools.schemas(agent)
    .map(schema => schema.name)
    .filter(name => name.startsWith('military_'))
    .sort()
}

function requireString(value, key) {
  assert.ok(typeof value === 'object' && value !== null && typeof value[key] === 'string')
  return value[key]
}

async function initializeRepository(path) {
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'src/base.txt'), 'RC.2 E2E base\n', 'utf8')
  await exec('git', ['init', '-b', 'main'], { cwd: path })
  await exec('git', ['config', 'user.name', 'dsh-military-e2e'], { cwd: path })
  await exec('git', ['config', 'user.email', 'dsh-military-e2e@invalid.example'], { cwd: path })
  await exec('git', ['add', 'src/base.txt'], { cwd: path })
  await exec('git', ['commit', '-m', 'chore: initialize RC.2 E2E workspace'], { cwd: path })
  // A real macOS project commonly contains this untracked file. It must stay
  // untouched while no longer blocking Worker isolation or integration.
  await writeFile(join(path, '.DS_Store'), 'e2e desktop metadata\n', 'utf8')
}

async function withTimeout(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function nextControlledRequest() {
  const queued = queuedControlledRequests.shift()
  if (queued !== undefined) return Promise.resolve(queued)
  return new Promise(resolveRequest => {
    controlledRequestWaiters.push(resolveRequest)
  })
}

async function verifyOfficialCheckout() {
  const manifest = JSON.parse(await readFile(join(dshRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, RC2_RELEASE)
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dshRoot })
  assert.equal(stdout.trim(), RC2_COMMIT)
}

async function loadRc2Boot() {
  const cliLib = join(dshRoot, 'apps/cli/lib')
  const profileBootEntry = (await Promise.all(
    (await readdir(cliLib))
      .filter(name => /^profile-boot-[\w-]+\.js$/u.test(name))
      .map(async name => ({ name, source: await readFile(join(cliLib, name), 'utf8') })),
  )).find(candidate => candidate.source.includes('export { runProfile };'))?.name
  if (profileBootEntry === undefined) {
    throw new Error(`cannot locate the built RC.2 profile-boot entry in ${cliLib}`)
  }
  const [{ runProfile }, { loadLayeredEnv }, { LlmAdapter }] = await Promise.all([
    import(pathToFileURL(join(cliLib, profileBootEntry)).href),
    import(pathToFileURL(join(dshRoot, 'packages/boot/app-boot/lib/index.js')).href),
    import(pathToFileURL(join(dshRoot, 'packages/llm/llm/lib/index.js')).href),
  ])
  return { runProfile, loadLayeredEnv, LlmAdapter }
}
