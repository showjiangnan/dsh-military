import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

test('installed RC.2 Web Profile completes and recovers the Military vertical path', async () => {
  const release = await mkdtemp(join(tmpdir(), 'dsh-military-e2e-release-'))
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-military-e2e-home-'))
  const dshRoot = resolve(process.env.DSH_RC2_ROOT ?? '../../deepseek-harness')
  const dshBin = join(dshRoot, 'apps/cli/lib/bin.js')
  const reportPath = join(dshHome, 'RC2-E2E-REPORT.json')
  try {
    const packed = await exec('npm', [
      'pack',
      './packages/bundle',
      '--pack-destination',
      release,
      '--silent',
    ])
    const tarball = join(release, packed.stdout.trim().split(/\r?\n/u).at(-1)!)
    await exec(process.execPath, [
      dshBin,
      'plugin',
      '--profile',
      'web',
      'add',
      tarball,
    ], {
      env: { ...process.env, DSH_HOME: dshHome },
      maxBuffer: 16 * 1024 * 1024,
    })
    await exec('pnpm', [
      '--dir',
      join(dshHome, 'profiles/web'),
      'exec',
      'dsh-military-install',
      'install',
      '--dsh-home',
      dshHome,
      '--dsh-bin',
      dshBin,
    ], {
      env: { ...process.env, DSH_HOME: dshHome },
      maxBuffer: 16 * 1024 * 1024,
    })
    await exec(process.execPath, ['scripts/run-rc2-e2e.mjs'], {
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_RC2_ROOT: dshRoot,
        DSH_MILITARY_E2E_REPORT: reportPath,
      },
      maxBuffer: 32 * 1024 * 1024,
    })
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      readonly disposition?: string
      readonly eventCount?: number
      readonly checks?: Record<string, boolean | number>
    }
    assert.equal(report.disposition, 'PASS')
    assert.ok((report.eventCount ?? 0) >= 8)
    assert.equal(report.checks?.['durableDuplicateCommand'], true)
    assert.equal(report.checks?.['shallowCandidateContract'], true)
    assert.equal(report.checks?.['integrationApplied'], true)
    assert.equal(report.checks?.['finalRecovery'], true)
  } finally {
    await rm(release, { recursive: true, force: true })
    await rm(dshHome, { recursive: true, force: true })
  }
})
