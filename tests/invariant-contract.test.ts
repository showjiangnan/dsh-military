import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as bundle from '../packages/bundle/src/invariant.js'
import * as commandBrainstorm from '../packages/command-brainstorm/src/invariant.js'
import * as contracts from '../packages/contracts/src/invariant.js'
import * as core from '../packages/core/src/invariant.js'
import * as infrastructure from '../packages/infrastructure/src/invariant.js'
import * as installer from '../packages/installer/src/invariant.js'
import * as pluginHost from '../packages/plugin-host/src/invariant.js'
import * as preset from '../packages/preset/src/invariant.js'
import * as runtime from '../packages/runtime/src/invariant.js'
import * as storageSqlite from '../packages/storage-sqlite/src/invariant.js'
import * as testkit from '../packages/testkit/src/invariant.js'
import * as tools from '../packages/tools/src/invariant.js'
import * as webui from '../packages/webui/src/invariant.js'

interface InvariantModule {
  readonly name: string
  readonly inject: readonly string[]
  apply(ctx: Parameters<typeof bundle.apply>[0]): Promise<() => void>
}

const packages: readonly {
  readonly directory: string
  readonly manifestName: string
  readonly module: InvariantModule
}[] = [
  { directory: 'bundle', manifestName: '@dsh-military/bundle', module: bundle },
  { directory: 'command-brainstorm', manifestName: '@dsh-military/command-brainstorm', module: commandBrainstorm },
  { directory: 'contracts', manifestName: '@dsh-military/contracts', module: contracts },
  { directory: 'core', manifestName: '@dsh-military/core', module: core },
  { directory: 'infrastructure', manifestName: '@dsh-military/infrastructure', module: infrastructure },
  { directory: 'installer', manifestName: '@dsh-military/installer', module: installer },
  { directory: 'plugin-host', manifestName: '@dsh-military/plugin-host', module: pluginHost },
  { directory: 'preset', manifestName: '@dsh-military/preset', module: preset },
  { directory: 'runtime', manifestName: '@dsh-military/runtime', module: runtime },
  { directory: 'storage-sqlite', manifestName: '@dsh-military/storage-sqlite', module: storageSqlite },
  { directory: 'testkit', manifestName: '@dsh-military/testkit', module: testkit },
  { directory: 'tools', manifestName: '@dsh-military/tools', module: tools },
  { directory: 'webui', manifestName: '@dsh-military/webui', module: webui },
]

test('every published package exports and registers its package-owned invariant companion', async () => {
  const registrations: string[] = []
  const installers: Array<(ctx: unknown, fail: (message: string) => never) => void | Promise<void>> = []
  const ctx = {
    invariants: {
      register(packageName: string, install: (ctx: unknown, fail: (message: string) => never) => void | Promise<void>) {
        registrations.push(packageName)
        installers.push(install)
        return () => {}
      },
    },
  }

  for (const entry of packages) {
    const manifest = JSON.parse(
      await readFile(`packages/${entry.directory}/package.json`, 'utf8'),
    ) as {
      readonly name: string
      readonly exports?: Readonly<Record<string, unknown>>
      readonly peerDependencies?: Readonly<Record<string, string>>
    }
    assert.equal(manifest.name, entry.manifestName)
    assert.ok(manifest.exports?.['./invariant'], `${entry.manifestName} does not export ./invariant`)
    assert.equal(
      manifest.peerDependencies?.['@deepseek-ai/dsh-invariants'],
      '0.1.1-rc.2',
    )
    assert.deepEqual(entry.module.inject, ['invariants'])
    assert.match(entry.module.name, /invariant$/u)
    await entry.module.apply(ctx as unknown as Parameters<typeof bundle.apply>[0])
    const source = await readFile(`packages/${entry.directory}/src/invariant.ts`, 'utf8')
    assert.match(source, /No runtime invariant:/u)
  }

  assert.deepEqual(registrations, packages.map(entry => entry.manifestName))
  for (const install of installers) {
    await install({}, (message): never => { throw new Error(message) })
  }
})
