import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const started = Date.now()
const generatedAt = new Date().toISOString()
const build = await run(process.execPath, ['scripts/build.mjs'])
const files = await collect('.build/tests')
if (files.length === 0) throw new Error('no compiled tests found')
const test = await run(process.execPath, ['--no-warnings', '--experimental-loader', './scripts/alias-loader.mjs', '--test', ...files], false)
const metrics = parseTap(test.stdout)
const report = {
  generatedAt,
  baseline: { release: '0.1.1-rc.2', commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e' },
  sourceVersion: '0.9.0-alpha.28',
  node: process.version,
  testFiles: files,
  buildExitCode: build.code,
  testExitCode: test.code,
  tests: metrics.tests,
  passed: metrics.pass,
  failed: metrics.fail,
  skipped: metrics.skipped,
  cancelled: metrics.cancelled,
  durationMs: Date.now() - started,
  disposition: build.code === 0 && test.code === 0 ? 'PASS' : 'FAIL',
  boundary: 'The suite includes domain, SQLite, Git/worktree, installer, preset, WebUI behavior, and a clean-tarball installed RC.2 Web Profile E2E across three boots. The E2E uses a deterministic in-process LLM adapter; live external-provider credentials and network behavior remain deployment checks.',
}
await writeFile('TEST-REPORT.json', `${JSON.stringify({ ...report, tap: test.stdout }, null, 2)}\n`, 'utf8')
await writeFile('TEST-REPORT.md', render(report), 'utf8')
if (test.stderr !== '') process.stderr.write(test.stderr)
if (report.disposition !== 'PASS') process.exitCode = 1

async function collect(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await collect(path))
    else if (entry.name.endsWith('.test.js')) result.push(path)
  }
  return result.sort()
}

function run(program, args, rejectOnFailure = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { const text = chunk.toString(); stdout += text; process.stdout.write(text) })
    child.stderr.on('data', chunk => { const text = chunk.toString(); stderr += text; process.stderr.write(text) })
    child.on('error', reject)
    child.on('exit', code => {
      const result = { code: code ?? 1, stdout, stderr }
      if (rejectOnFailure && result.code !== 0) reject(new Error(`${program} exited ${result.code}`))
      else resolve(result)
    })
  })
}

function parseTap(text) {
  const read = label => Number(new RegExp(`^# ${label} (\\d+)$`, 'mu').exec(text)?.[1] ?? 0)
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), skipped: read('skipped'), cancelled: read('cancelled') }
}

function render(report) {
  return [
    '# Source Test Report', '',
    `Generated: ${report.generatedAt}`, '',
    `Baseline: dsh ${report.baseline.release} @ ${report.baseline.commit}`, '',
    `Source version: ${report.sourceVersion}`, '',
    `Node: ${report.node}`, '',
    '## Result', '',
    `- Disposition: **${report.disposition}**`,
    `- Test files: ${report.testFiles.length}`,
    `- Tests: ${report.tests}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    `- Skipped: ${report.skipped}`,
    `- Cancelled: ${report.cancelled}`,
    `- End-to-end script duration: ${report.durationMs} ms`, '',
    '## Test files', '',
    ...report.testFiles.map(path => `- \`${path}\``), '',
    '## Boundary', '', report.boundary, '',
  ].join('\n')
}
