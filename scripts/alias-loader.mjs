import { pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { readFile } from 'node:fs/promises'

const aliases = new Map([
  ['@dsh-military/contracts', '.build/packages/contracts/src/index.js'],
  ['@dsh-military/contracts/role-prompts', '.build/packages/contracts/src/role-prompts.js'],
  ['@dsh-military/contracts/control-plane', '.build/packages/contracts/src/control-plane.js'],
  ['@dsh-military/contracts/operations-control', '.build/packages/contracts/src/operations-control.js'],
  ['@dsh-military/contracts/workspace-control', '.build/packages/contracts/src/workspace-control.js'],
  ['@dsh-military/contracts/benchmark-control', '.build/packages/contracts/src/benchmark-control.js'],
  ['@dsh-military/contracts/knowledge-control', '.build/packages/contracts/src/knowledge-control.js'],
  ['@dsh-military/core', '.build/packages/core/src/index.js'],
  ['@dsh-military/infrastructure', '.build/packages/infrastructure/src/index.js'],
  ['@dsh-military/storage-sqlite', '.build/packages/storage-sqlite/src/index.js'],
  ['@dsh-military/runtime', '.build/packages/runtime/src/index.js'],
  ['@dsh-military/testkit', '.build/packages/testkit/src/index.js'],
  ['@dsh-military/preset', '.build/packages/preset/src/index.js'],
  ['@dsh-military/installer', '.build/packages/installer/src/index.js'],
  ['@dsh-military/plugin-host', '.build/packages/plugin-host/src/index.js'],
  ['@dsh-military/plugin-host/defaults', '.build/packages/plugin-host/src/defaults.js'],
  ['@dsh-military/plugin-host/rc2-adapter', '.build/packages/plugin-host/src/rc2-adapter.js'],
  ['@dsh-military/plugin-host/tool-authorization', '.build/packages/plugin-host/src/tool-authorization.js'],
  ['@dsh-military/plugin-host/model-budget', '.build/packages/plugin-host/src/model-budget.js'],
  ['@dsh-military/tools', '.build/packages/tools/src/index.js'],
  ['@dsh-military/tools/runtime-validation', '.build/packages/tools/src/runtime-validation.js'],
])
export async function resolve(specifier, context, nextResolve) {
  const exact = aliases.get(specifier)
  if (exact !== undefined) return { url: pathToFileURL(resolvePath(exact)).href, shortCircuit: true }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    const stylesheet = await readFile(new URL(url), 'utf8')
    return {
      format: 'module',
      source: `export default ${JSON.stringify(stylesheet)};`,
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
