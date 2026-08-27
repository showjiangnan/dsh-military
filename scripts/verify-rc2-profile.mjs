import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const dshRoot = resolve(process.env.DSH_RC2_ROOT ?? '../../deepseek-harness')
const dshHome = process.env.DSH_HOME
if (dshHome === undefined || dshHome.trim() === '') {
  throw new Error('verify-rc2-profile requires an isolated DSH_HOME')
}

const cliLib = join(dshRoot, 'apps/cli/lib')
const profileBootEntry = (await Promise.all(
  (await readdir(cliLib))
    .filter(name => /^profile-boot-[\w-]+\.js$/u.test(name))
    .map(async name => ({ name, source: await readFile(join(cliLib, name), 'utf8') })),
)).find(candidate => candidate.source.includes('export { runProfile };'))?.name
if (profileBootEntry === undefined) {
  throw new Error(`cannot locate the built RC.2 profile-boot entry in ${cliLib}`)
}
const cliModule = pathToFileURL(join(cliLib, profileBootEntry)).href
const bootModule = pathToFileURL(join(dshRoot, 'packages/boot/app-boot/lib/index.js')).href
const [{ runProfile }, { loadLayeredEnv }] = await Promise.all([
  import(cliModule),
  import(bootModule),
])

process.env.DSH_TELEMETRY_DISABLED = '1'
const { ctx } = await runProfile({
  environment: loadLayeredEnv('dsh-military-profile-probe'),
  profile: 'web',
  patchFiles: [],
  args: ['--no-open', '--port', '0'],
})

let handle
try {
  const presets = await ctx.agentPresets.list()
  const military = presets.find(candidate => candidate.id === 'military')
  assert.ok(military, 'the installed Military preset must be discoverable')
  assert.equal(military.trust, 'user')

  handle = await ctx.agents.create({
    sessionId: `dsh-military-profile-probe-${crypto.randomUUID()}`,
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'military').then(() => undefined),
  })

  assert.equal(ctx.agentPresets.composedPreset(handle.agent.ctx), 'military')
  const host = ctx.get('militaryHost')
  assert.ok(host, 'the Bundle Host entry must publish militaryHost')
  assert.equal(host.isMilitaryAgent(handle.agent), true)

  const toolNames = new Set(ctx.tools.schemas(handle.agent).map(schema => schema.name))
  for (const name of [
    'military_get_context',
    'military_read_artifact',
    'military_mission_start',
    'military_task_create',
    'military_spawn_department_agent',
    'military_status',
  ]) {
    assert.ok(toolNames.has(name), `the mounted General tool profile is missing ${name}`)
  }
  for (const name of [
    'military_submit_candidate',
    'military_staff_issue_guidance',
    'military_inspect_agent',
    'military_specs_apply_order',
  ]) {
    assert.equal(
      toolNames.has(name),
      false,
      `the mounted General must not see role-invalid tool ${name}`,
    )
  }
  const militaryToolCount = [...toolNames].filter(name => name.startsWith('military_')).length
  assert.equal(militaryToolCount, 15)
  assert.ok(
    ctx.commands.list(handle.agent).some(command => command.name === 'brainstorm'),
    'the mounted preset is missing /brainstorm',
  )

  const clientModules = ctx.get('clientModules')
  assert.ok(clientModules, 'the Web Profile must publish clientModules')
  assert.ok(
    clientModules.graph().entries.some(entry => entry.id === '@dsh-military/bundle'),
    'the Bundle browser half is absent from the Web boot graph',
  )

  const hostEntry = [...ctx.loader.entries()].find(entry => entry.options.name === '@dsh-military/bundle')
  assert.ok(hostEntry?.fiber, 'the Bundle Host Loader row has no fiber')
  assert.equal(hostEntry.fiber.state, 2, 'the Bundle Host Loader row is not ACTIVE')

  const report = {
    schemaVersion: '1.0.0',
    dshBaseline: {
      release: '0.1.1-rc.2',
      commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
    },
    profile: 'web',
    preset: {
      id: military.id,
      trust: military.trust,
      composed: ctx.agentPresets.composedPreset(handle.agent.ctx),
    },
    bundleHostActive: true,
    browserModuleActive: true,
    militaryToolCount,
    roleScopedToolVisibility: true,
    brainstormActive: true,
    disposition: 'PASS',
  }
  const reportPath = process.env.DSH_MILITARY_PROFILE_REPORT
  if (reportPath !== undefined && reportPath.trim() !== '') {
    await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await handle?.dispose()
  await ctx.fiber.dispose()
}
