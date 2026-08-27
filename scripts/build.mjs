import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

await rm('.build', { recursive: true, force: true })
await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '-p', 'tsconfig.build.json', '--pretty', 'false'])

for (const group of ['packages', 'apps']) {
  for (const entry of await readdir(group, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const compiled = join('.build', group, entry.name, 'src')
    if (!await exists(compiled)) continue
    const target = join(group, entry.name, 'lib')
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await cp(compiled, target, { recursive: true, force: true })
  }
}

await copy('packages/storage-sqlite/src/migrations', 'packages/storage-sqlite/lib/migrations')
await copy('packages/storage-sqlite/src/migrations', '.build/packages/storage-sqlite/src/migrations')
await copy('packages/preset/agent-presets', '.build/packages/preset/agent-presets')
await copy('packages/preset/generations', '.build/packages/preset/generations')
await copy('packages/contracts/migrations', '.build/packages/contracts/migrations')
await copy('packages/contracts/schemas', '.build/packages/contracts/schemas')
await copy('packages/bundle/cordis.patch.yml', '.build/packages/bundle/cordis.patch.yml')
await copy('packages/webui/src/client/native-ui.css', '.build/packages/webui/src/client/native-ui.css')
await buildWebClientBundle()
await copy('packages/webui/lib/client.cjs', 'packages/bundle/lib/client.cjs')
await copy('packages/webui/lib/client/index.d.ts', 'packages/bundle/lib/client.d.ts')
await chmod('packages/installer/lib/cli.js', 0o755).catch(() => undefined)
await chmod('packages/bundle/lib/cli.js', 0o755).catch(() => undefined)

const files = await collectBuiltFiles()
const generatedAt = process.env.SOURCE_DATE_EPOCH === undefined
  ? new Date().toISOString()
  : new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
const manifest = {
  schemaVersion: '1.0.0',
  sourceVersion: JSON.parse(await readFile('VERSION.json', 'utf8')).sourceVersion,
  dshCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  generatedAt,
  files: await Promise.all(files.map(async path => {
    const bytes = await readFile(path)
    return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  })),
}
await writeFile('BUILD-MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`Build complete: ${files.length} emitted files copied to package lib/ directories.`)

async function buildWebClientBundle() {
  await build({
    entryPoints: ['packages/webui/src/client/index.tsx'],
    outfile: 'packages/webui/lib/client.cjs',
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2023',
    jsx: 'transform',
    jsxFactory: 'createElement',
    loader: { '.css': 'text' },
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
    banner: {
      js: `window.__ModuleLoader__.load({ id: '@dsh-military/bundle', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'silent',
  })
}

async function copy(source, target) {
  await mkdir(target.replace(/\/[^/]+$/u, ''), { recursive: true })
  await cp(source, target, { recursive: true, force: true })
}

async function exists(path) { try { await stat(path); return true } catch { return false } }

async function collectBuiltFiles() {
  const result = []
  for (const root of ['packages', 'apps']) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const lib = join(root, entry.name, 'lib')
      if (await exists(lib)) result.push(...await walk(lib))
    }
  }
  return result.sort()
}

async function walk(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path))
    else result.push(relative('.', path))
  }
  return result
}

function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)))
  })
}
