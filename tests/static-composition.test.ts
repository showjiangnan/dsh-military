import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script, createContext } from 'node:vm'

test('fixed preset owns all Military model surfaces and bundle host stays model-silent', async () => {
  const preset = await readFile('packages/preset/agent-presets/military/agent.cordis.yml', 'utf8')
  const bundle = await readFile('packages/bundle/cordis.patch.yml', 'utf8')
  assert.match(preset, /@dsh-military\/bundle\/tools/u)
  assert.match(preset, /@dsh-military\/bundle\/command-brainstorm/u)
  assert.match(preset, /@dsh-military\/bundle\/agent-plane/u)
  assert.match(bundle, /@dsh-military\/bundle/u)
  assert.equal(bundle.includes('@dsh-military/tools'), false)
  assert.equal(bundle.includes('@dsh-military/command-brainstorm'), false)
})


test('Web client emits the RC.2 lazy module-loader factory and package export target', async () => {
  const packageJson = JSON.parse(await readFile('packages/bundle/package.json', 'utf8')) as {
    exports: { './client': { default: string; types: string } }
  }
  const client = await readFile('packages/bundle/lib/client.cjs', 'utf8')
  assert.equal(packageJson.exports['./client'].default, './lib/client.cjs')
  assert.equal(packageJson.exports['./client'].types, './lib/client.d.ts')
  assert.match(client, /^window\.__ModuleLoader__\.load\(/u)
  assert.match(client, /id: '@dsh-military\/bundle'/u)
  assert.match(client, /require\(["']react["']\)/u)
  assert.equal(/\bimport\s/u.test(client), false)
  assert.equal(/\bexport\s/u.test(client), false)
})

test('Web client is one executable RC.2 module without concatenated lexical collisions', async () => {
  const client = await readFile('packages/bundle/lib/client.cjs', 'utf8')
  let registered: {
    readonly id?: string
    readonly factory?: (require: (id: string) => unknown) => unknown
  } | undefined
  const context = createContext({
    window: {
      __ModuleLoader__: {
        load(value: typeof registered): void {
          registered = value
        },
      },
    },
  })
  new Script(client, { filename: '@dsh-military/bundle/client.js' }).runInContext(context)
  assert.equal(registered?.id, '@dsh-military/bundle')
  assert.equal(typeof registered?.factory, 'function')
  const react = {
    createElement: () => null,
    useCallback: (value: unknown) => value,
    useEffect: () => undefined,
    useMemo: (value: () => unknown) => value(),
    useState: (value: unknown) => [value, () => undefined],
    useSyncExternalStore: () => undefined,
  }
  const exports = registered?.factory?.(id => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`unexpected client dependency ${id}`)
  }) as { readonly apply?: unknown; readonly inject?: unknown } | undefined
  assert.equal(typeof exports?.apply, 'function')
  assert.ok(Array.isArray(exports?.inject))
})

test('release builder retains prior local tarballs through RC.2 Profile upgrades', async () => {
  const source = await readFile('scripts/build-release.mjs', 'utf8')
  assert.match(source, /const existingTarballs = await listReleaseTarballs\(\)/u)
  assert.match(source, /prior tarball\(s\) retained for safe Profile upgrades/u)
  assert.equal(
    /rm\(releaseDirectory,\s*\{\s*recursive:\s*true/u.test(source),
    false,
  )
  assert.match(source, /deleting that file first makes the upgrade fail/u)
})

test('a clean source build resolves the Bundle installer CLI without stale lib output', async () => {
  const tsconfig = JSON.parse(await readFile('tsconfig.base.json', 'utf8')) as {
    compilerOptions?: { paths?: Record<string, readonly string[]> }
  }
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.['@dsh-military/installer/cli'],
    ['packages/installer/src/cli.ts'],
  )
  const bundleCli = await readFile('packages/bundle/src/cli.ts', 'utf8')
  assert.match(bundleCli, /import '@dsh-military\/installer\/cli'/u)
})

test('RC.2 Typert Remote services remain compatible with the Cordis service proxy receiver', async () => {
  const remoteSources = await Promise.all([
    'packages/plugin-host/src/control-plane-remote.ts',
    'packages/plugin-host/src/operations-remote.ts',
    'packages/plugin-host/src/workspace-remote.ts',
    'packages/plugin-host/src/benchmark-remote.ts',
    'packages/plugin-host/src/private-skill-remote.ts',
    'packages/plugin-host/src/evaluation-remote.ts',
  ].map(async path => await readFile(path, 'utf8')))
  for (const source of remoteSources) {
    assert.match(source, /extends TypertRemoteService/u)
    assert.equal(
      /#[A-Za-z_$][A-Za-z0-9_$]*/u.test(source),
      false,
      'ECMAScript private members reject the Proxy receiver used by RC.2 Typert',
    )
  }
})

test('Remote snapshots copy frozen SQLite state-record arrays before sorting them', async () => {
  const benchmark = await readFile(
    'packages/plugin-host/src/benchmark-remote.ts',
    'utf8',
  )
  const operations = await readFile(
    'packages/plugin-host/src/operations-remote.ts',
    'utf8',
  )
  const privateSkills = await readFile(
    'packages/plugin-host/src/private-skill-remote.ts',
    'utf8',
  )
  assert.match(
    benchmark,
    /const providerSamples = \[\.\.\.this\.state\.listSync/u,
  )
  assert.match(
    benchmark,
    /runs: \[\.\.\.this\.state\.listSync/u,
  )
  assert.match(
    operations,
    /const recoveryReceipts = \[\.\.\.this\.state\.listSync/u,
  )
  assert.match(
    operations,
    /recentReceipts: recoveryReceipts\.slice/u,
  )
  assert.match(
    privateSkills,
    /recallSimulations: \[\.\.\.this\.state\.listSync/u,
  )
})

test('RC.2 adapters use reserved continuable identities, next-step reports and image-aware commands', async () => {
  const child = await readFile('packages/plugin-host/src/child-transport.ts', 'utf8')
  const adapter = await readFile('packages/plugin-host/src/rc2-adapter.ts', 'utf8')
  const host = await readFile('packages/plugin-host/src/host-runtime.ts', 'utf8')
  const command = await readFile('packages/command-brainstorm/src/index.ts', 'utf8')
  assert.match(child, /startContinuable/u)
  assert.match(child, /childId,/u)
  assert.match(host, /drainContinuableChildren/u)
  assert.match(adapter, /'next-step'/u)
  assert.equal(/'wakeup'/u.test(`${child}\n${host}\n${adapter}`), false)
  assert.match(command, /attachments/u)
  assert.match(command, /images:/u)
})

test('RC.2 Web settings and Context Manifest audit use the published contracts', async () => {
  const source = await readFile('packages/webui/src/client/index.tsx', 'utf8')
  const packageJson = JSON.parse(await readFile('packages/webui/package.json', 'utf8')) as {
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    dsh?: { client?: { inject?: unknown; external?: unknown } }
  }
  const contextAudit = await readFile('packages/plugin-host/src/context-audit.ts', 'utf8')
  const catalog = JSON.parse(await readFile('packages/contracts/catalogs/event-catalog.json', 'utf8')) as {
    administrativeEvents: Array<{ type: string }>
  }
  assert.match(source, /SettingsScope/u)
  assert.equal(/ClientSettingsScope/u.test(source), false)
  assert.ok(Array.isArray(packageJson.dsh?.client?.inject))
  assert.ok(Array.isArray(packageJson.dsh?.client?.external))
  for (const [name, range] of Object.entries(packageJson.peerDependencies ?? {})) {
    assert.equal(packageJson.devDependencies?.[name], range)
  }
  assert.match(contextAudit, /persistContextManifest/u)
  assert.match(contextAudit, /context\/manifest-created/u)
  assert.ok(catalog.administrativeEvents.some(event => event.type === 'context/manifest-created'))
})
