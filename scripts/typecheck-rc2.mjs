import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const EXPECTED_RELEASE = '0.1.1-rc.2'
const EXPECTED_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const generatedAt = new Date().toISOString()
const checks = []
const configuredRoot = process.env.DSH_RC2_ROOT?.trim()
const defaultRoot = resolve('../..', 'deepseek-harness')
const dshRoot = configuredRoot === undefined || configuredRoot === '' ? defaultRoot : configuredRoot
if (!await exists(dshRoot)) {
  throw new Error('DSH_RC2_ROOT must point to an exact, built DeepSeek Harness RC.2 checkout')
}
await typecheckExactCheckout(resolve(dshRoot))
const report = {
  schemaVersion: '1.1.0', generatedAt,
  release: EXPECTED_RELEASE, commit: EXPECTED_COMMIT,
  sourceCheckoutVerified: true,
  mode: 'EXACT_SOURCE_CHECKOUT',
  checks,
  disposition: 'PASS',
  productionRequirement: 'Exact declaration compilation is satisfied; the installed RC.2 Profile E2E is enforced by the test and release gates.',
}
await writeFile('RC2-COMPATIBILITY-REPORT.json', `${JSON.stringify(report, null, 2)}\n`)
await writeFile('RC2-COMPATIBILITY-REPORT.md', [
  '# RC.2 Compatibility Report', '',
  `Generated: ${generatedAt}`, '',
  `Baseline: \`${EXPECTED_RELEASE}\` @ \`${EXPECTED_COMMIT}\``, '',
  'Mode: **EXACT_SOURCE_CHECKOUT**', '',
  '## Result', '',
  '**PASS** — production TypeScript sources compiled against declarations from the exact built RC.2 checkout.', '',
].join('\n'))

async function typecheckExactCheckout(root) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.version !== EXPECTED_RELEASE) throw new Error(`DSH_RC2_ROOT has ${manifest.version}, expected ${EXPECTED_RELEASE}`)
  const { stdout } = await exec('git', ['-C', root, 'rev-parse', 'HEAD'])
  if (stdout.trim() !== EXPECTED_COMMIT) throw new Error(`DSH_RC2_ROOT commit ${stdout.trim()} is not ${EXPECTED_COMMIT}`)
  checks.push({ path: join(root, 'package.json'), evidence: EXPECTED_RELEASE, passed: true })
  checks.push({ path: root, evidence: EXPECTED_COMMIT, passed: true })
  const packageManifests = await findManifests(root)
  const paths = {}
  const missing = []
  const missingChecks = []
  for (const packageJson of packageManifests) {
    const value = JSON.parse(await readFile(packageJson, 'utf8'))
    if (typeof value.name !== 'string' || !value.name.startsWith('@deepseek-ai/')) continue
    const dir = dirname(packageJson)
    addExport(paths, value.name, value.types, dir, missing, missingChecks)
    const exportsField = value.exports
    if (exportsField !== undefined && typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField)) {
      for (const [key, target] of Object.entries(exportsField)) {
        if (key === './package.json' || key.includes('*')) continue
        const types = resolveTypesTarget(target)
        if (types === undefined) continue
        addExport(paths, key === '.' ? value.name : `${value.name}/${key.slice(2)}`, types, dir, missing, missingChecks)
      }
    }
  }
  await Promise.all(missingChecks)
  if (missing.length > 0) {
    throw new Error(`RC.2 built declarations are missing. Run \`pnpm run build:lib\` in DSH_RC2_ROOT. First missing: ${missing[0]}`)
  }

  const base = JSON.parse(await readFile('tsconfig.base.json', 'utf8'))
  for (const [key, targets] of Object.entries(base.compilerOptions.paths)) {
    if (key.startsWith('@deepseek-ai/')) continue
    paths[key] = targets.map(target => resolve(target))
  }
  const files = await productionFiles()
  const temp = await mkdtemp(join(tmpdir(), 'dsh-military-rc2-typecheck-'))
  const configPath = join(temp, 'tsconfig.json')
  await writeFile(configPath, JSON.stringify({
    compilerOptions: {
      ...base.compilerOptions, baseUrl: '.', paths, noEmit: true,
      declaration: false, declarationMap: false, sourceMap: false,
      // Upstream RC.2 itself ships mutually augmented host/client declarations
      // that are not intended to be checked in one synthetic program. Source
      // expressions are still checked against their exact exported contracts.
      skipLibCheck: true,
      typeRoots: [resolve('node_modules/@types')],
      tsBuildInfoFile: undefined,
    }, files,
  }, null, 2))
  try {
    const tsc = process.env.TSC_BIN ?? resolve('node_modules/.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
    await exec(tsc, ['-p', configPath, '--pretty', 'false'], { maxBuffer: 16 * 1024 * 1024 })
    checks.push({ path: 'production TypeScript sources', evidence: 'exact RC.2 declaration compilation', passed: true })
    console.log(`Exact RC.2 declaration typecheck passed against ${EXPECTED_COMMIT}`)
  } catch (error) {
    if (error && typeof error === 'object') {
      if ('stdout' in error && typeof error.stdout === 'string') process.stdout.write(error.stdout)
      if ('stderr' in error && typeof error.stderr === 'string') process.stderr.write(error.stderr)
    }
    throw error
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function resolveTypesTarget(value) {
  if (typeof value === 'string') return value.endsWith('.d.ts') ? value : undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (typeof value.types === 'string') return value.types
  for (const key of ['import', 'default', 'node', 'browser']) {
    const candidate = resolveTypesTarget(value[key])
    if (candidate !== undefined) return candidate
  }
  return undefined
}
async function exists(path) { try { await stat(path); return true } catch { return false } }
function addExport(map, name, target, dir, missingList, pending) {
  if (typeof target !== 'string') return
  const absolute = resolve(dir, target)
  map[name] = [absolute]
  pending.push((async () => { if (!await exists(absolute)) missingList.push(absolute) })())
}
async function findManifests(rootDir) {
  const roots = ['packages', 'vendor', 'apps'].map(item => join(rootDir, item))
  const result = []
  for (const start of roots) if (await exists(start)) result.push(...await walkManifests(start, 3))
  return result
}
async function walkManifests(dir, depth) {
  if (depth < 0) return []
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isFile() && entry.name === 'package.json') result.push(path)
    else if (entry.isDirectory() && entry.name !== 'node_modules') result.push(...await walkManifests(path, depth - 1))
  }
  return result
}
async function productionFiles() {
  const result = []
  if (await exists('types')) result.push(...await walkSources('types'))
  for (const group of ['packages', 'apps']) {
    if (!await exists(group)) continue
    for (const packageEntry of await readdir(group, { withFileTypes: true })) {
      if (!packageEntry.isDirectory()) continue
      const src = join(group, packageEntry.name, 'src')
      if (await exists(src)) result.push(...await walkSources(src))
    }
  }
  return result.map(path => resolve(path))
}
async function walkSources(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await walkSources(path))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) result.push(path)
  }
  return result
}
