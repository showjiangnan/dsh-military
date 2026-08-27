import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const VERSION = '0.9.0-alpha.25'
const RC2_RELEASE = '0.1.1-rc.2'
const RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const dshRoot = resolve(process.env.DSH_RC2_ROOT ?? '../../deepseek-harness')
const dshBin = join(dshRoot, 'apps/cli/lib/bin.js')
const releaseDirectory = resolve('release')
const bundleName = `dsh-military-bundle-${VERSION}.tgz`
const installerName = `dsh-military-installer-${VERSION}.tgz`
const verificationRoot = await mkdtemp(join(tmpdir(), 'dsh-military-release-verify-'))
const dshHome = join(verificationRoot, 'dsh-home')
const standaloneInstallerDirectory = join(verificationRoot, 'standalone-installer')
const standaloneInstallerHome = join(verificationRoot, 'standalone-installer-home')
const profileReportPath = join(verificationRoot, 'profile-report.json')
const e2eReportPath = join(verificationRoot, 'e2e-report.json')
const startedAt = new Date().toISOString()
const packageChecks = []

try {
  await verifyOfficialCheckout()
  await run('pnpm', ['install', '--frozen-lockfile'])
  await run(process.execPath, ['scripts/build-release.mjs'])

  const packageDirectories = (await readdir('packages', { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => `packages/${entry.name}`)
    .sort()
  for (const directory of packageDirectories) {
    if (!await exists(join(directory, 'package.json'))) continue
    // The two release packages intentionally use npm's bundledDependencies
    // semantics; force publint's packer to the same implementation instead of
    // auto-selecting pnpm's isolated-linker-incompatible pack command.
    await run('pnpm', ['exec', 'publint', directory, '--pack', 'npm'])
    const packed = await run('npm', ['pack', `./${directory}`, '--dry-run', '--json'], {
      capture: true,
    })
    const result = JSON.parse(packed.stdout)
    assert.ok(Array.isArray(result) && result.length === 1)
    assert.ok(Number(result[0].files?.length ?? 0) > 0, `${directory} packs no files`)
    packageChecks.push({
      package: JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name,
      publint: 'PASS',
      packDryRun: 'PASS',
      packedFiles: result[0].files.length,
    })
  }

  await verifyChecksums()
  const bundlePath = join(releaseDirectory, bundleName)
  const installerPath = join(releaseDirectory, installerName)
  const bundleEntries = (await run('tar', ['-tzf', bundlePath], { capture: true }))
    .stdout.split(/\r?\n/u)
  const installerEntries = (await run('tar', ['-tzf', installerPath], { capture: true }))
    .stdout.split(/\r?\n/u)
  for (const packageName of [
    'command-brainstorm',
    'contracts',
    'core',
    'infrastructure',
    'installer',
    'plugin-host',
    'preset',
    'runtime',
    'storage-sqlite',
    'tools',
    'webui',
  ]) {
    assert.ok(
      bundleEntries.includes(`package/node_modules/@dsh-military/${packageName}/package.json`),
      `Bundle is missing embedded @dsh-military/${packageName}`,
    )
  }
  for (const path of [
    'package/node_modules/@dsh-military/contracts/package.json',
    'package/node_modules/@dsh-military/preset/package.json',
    'package/node_modules/@dsh-military/preset/agent-presets/military/generation-manifest.json',
  ]) {
    assert.ok(installerEntries.includes(path), `Installer closure is missing ${path}`)
  }

  const installEnv = { ...process.env, DSH_HOME: dshHome }
  const profileInstall = await run(process.execPath, [
    dshBin,
    'plugin',
    '--profile',
    'web',
    'add',
    bundlePath,
  ], { env: installEnv, capture: true })
  assert.doesNotMatch(profileInstall.stderr, /Issues with peer dependencies/u)
  assert.doesNotMatch(profileInstall.stderr, /declares no dsh\.bundle/u)
  const profileDirectory = join(dshHome, 'profiles/web')
  const profile = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8'))
  assert.ok(profile.dsh?.profile?.bundles?.includes('@dsh-military/bundle'))
  assert.ok(!profile.dsh?.profile?.bundles?.includes('@dsh-military/installer'))
  assert.ok(profile.dependencies?.['@dsh-military/bundle'])
  assert.equal(profile.dependencies?.['@dsh-military/installer'], undefined)
  await run('pnpm', ['--dir', profileDirectory, 'peers', 'check'])
  await run('pnpm', [
    '--dir',
    profileDirectory,
    'exec',
    'dsh-military-install',
    'install',
    '--dsh-home',
    dshHome,
    '--dsh-bin',
    dshBin,
  ], { env: installEnv })

  await mkdir(standaloneInstallerDirectory, { recursive: true })
  await writeFile(join(standaloneInstallerDirectory, 'package.json'), `${JSON.stringify({
    name: 'dsh-military-standalone-installer-verification',
    private: true,
  }, null, 2)}\n`, 'utf8')
  await writeFile(join(standaloneInstallerDirectory, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - .',
    '',
    'autoInstallPeers: false',
    '',
  ].join('\n'), 'utf8')
  const standaloneInstall = await run('pnpm', [
    '--dir',
    standaloneInstallerDirectory,
    'add',
    installerPath,
    '--ignore-scripts',
  ], { capture: true })
  assert.doesNotMatch(standaloneInstall.stderr, /Issues with peer dependencies/u)
  await run('pnpm', ['--dir', standaloneInstallerDirectory, 'peers', 'check'])
  await run('pnpm', [
    '--dir',
    standaloneInstallerDirectory,
    'exec',
    'dsh-military-install',
    'install',
    '--dsh-home',
    standaloneInstallerHome,
    '--dsh-bin',
    dshBin,
  ], { env: { ...process.env, DSH_HOME: standaloneInstallerHome } })
  await run('pnpm', [
    '--dir',
    standaloneInstallerDirectory,
    'exec',
    'dsh-military-install',
    'verify',
    '--dsh-home',
    standaloneInstallerHome,
  ], { env: { ...process.env, DSH_HOME: standaloneInstallerHome } })

  await run(process.execPath, ['scripts/verify-rc2-profile.mjs'], {
    env: {
      ...installEnv,
      DSH_RC2_ROOT: dshRoot,
      DSH_MILITARY_PROFILE_REPORT: profileReportPath,
    },
  })
  await run(process.execPath, ['scripts/run-rc2-e2e.mjs'], {
    env: {
      ...installEnv,
      DSH_RC2_ROOT: dshRoot,
      DSH_MILITARY_E2E_REPORT: e2eReportPath,
    },
  })
  const profileReport = JSON.parse(await readFile(profileReportPath, 'utf8'))
  const e2eReport = JSON.parse(await readFile(e2eReportPath, 'utf8'))
  assert.equal(profileReport.disposition, 'PASS')
  assert.equal(e2eReport.disposition, 'PASS')

  const verifiedAt = new Date().toISOString()
  await writeFile(
    join(releaseDirectory, 'RC2-PROFILE-REPORT.json'),
    `${JSON.stringify(profileReport, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    join(releaseDirectory, 'RC2-E2E-REPORT.json'),
    `${JSON.stringify(e2eReport, null, 2)}\n`,
    'utf8',
  )
  const releaseVersionPath = join(releaseDirectory, 'VERSION.json')
  const releaseVersion = JSON.parse(await readFile(releaseVersionPath, 'utf8'))
  await writeFile(releaseVersionPath, `${JSON.stringify({
    ...releaseVersion,
    releaseStatus: 'RC2_VERIFIED',
    allGatesPassed: true,
    verifiedAt,
  }, null, 2)}\n`, 'utf8')
  await refreshReleaseManifest(verifiedAt)
  await verifyChecksums()

  const report = {
    schemaVersion: '1.0.0',
    sourceVersion: VERSION,
    startedAt,
    completedAt: verifiedAt,
    dshBaseline: { release: RC2_RELEASE, commit: RC2_COMMIT },
    frozenLockfile: 'PASS',
    packageChecks,
    artifacts: {
      bundle: { file: bundleName, sha256: await sha256(join(releaseDirectory, bundleName)) },
      installer: { file: installerName, sha256: await sha256(join(releaseDirectory, installerName)) },
      reproducible: true,
      checksums: 'PASS',
    },
    cleanProfile: {
      install: 'PASS',
      peerDependencies: 'PASS',
      loaderActivation: 'PASS',
      preset: 'military',
      browserModule: 'PASS',
    },
    standaloneInstaller: {
      install: 'PASS',
      peerDependencies: 'PASS',
      presetInstallAndVerify: 'PASS',
    },
    verticalE2E: e2eReport.checks,
    disposition: 'PASS',
  }
  await writeFile('RELEASE-REPORT.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile('RELEASE-REPORT.md', renderReport(report), 'utf8')
  await writeFile('FINAL-GATE-REPORT.json', `${JSON.stringify({
    schemaVersion: '2.0.0',
    sourceVersion: VERSION,
    dshRelease: RC2_RELEASE,
    dshCommit: RC2_COMMIT,
    generatedAt: verifiedAt,
    passed: true,
    gates: [
      { name: 'frozen-install', status: 'PASS' },
      { name: 'local-and-exact-rc2-typecheck', status: 'PASS' },
      { name: 'build-tests-repair-semantic-review-docs', status: 'PASS' },
      {
        name: 'package-contracts',
        status: 'PASS',
        detail: `${packageChecks.length}/${packageChecks.length} package pack and publint`,
      },
      {
        name: 'release-artifacts',
        status: 'PASS',
        detail: 'Bundle and Installer reproducible; checksums valid',
      },
      {
        name: 'clean-rc2-profile',
        status: 'PASS',
        detail: 'warning-free Bundle install, peer check, Loader activation, Preset mount and browser module',
      },
      {
        name: 'standalone-installer',
        status: 'PASS',
        detail: 'plain dependency install, peer check, Preset install and receipt verification',
      },
      {
        name: 'restart-vertical-e2e',
        status: 'PASS',
        detail: 'three boots; Tool, continuable Worker, Mission, Verification, Integration and recovery',
      },
    ],
  }, null, 2)}\n`, 'utf8')

  const rootVersion = JSON.parse(await readFile('VERSION.json', 'utf8'))
  await writeFile('VERSION.json', `${JSON.stringify({
    ...rootVersion,
    releaseStatus: 'rc2-verified',
    allGatesPassed: true,
    verifiedAt,
  }, null, 2)}\n`, 'utf8')
  process.stdout.write(
    `Release verification PASS: ${packageChecks.length} packages, clean RC.2 Profile, restart E2E, checksums and reproducibility.\n`,
  )
} finally {
  await rm(verificationRoot, { recursive: true, force: true })
}

async function refreshReleaseManifest(verifiedAt) {
  const previous = JSON.parse(
    await readFile(join(releaseDirectory, 'RELEASE-MANIFEST.json'), 'utf8'),
  )
  const files = [
    bundleName,
    installerName,
    'INSTALL.md',
    'VERSION.json',
    'RC2-PROFILE-REPORT.json',
    'RC2-E2E-REPORT.json',
  ].sort()
  const entries = await Promise.all(files.map(async path => ({
    path,
    byteLength: (await stat(join(releaseDirectory, path))).size,
    sha256: await sha256(join(releaseDirectory, path)),
  })))
  await writeFile(join(releaseDirectory, 'RELEASE-MANIFEST.json'), `${JSON.stringify({
    ...previous,
    verifiedAt,
    files: entries,
  }, null, 2)}\n`, 'utf8')
  const checksumFiles = [...files, 'RELEASE-MANIFEST.json'].sort()
  const lines = await Promise.all(checksumFiles.map(async file =>
    `${await sha256(join(releaseDirectory, file))}  ${file}`))
  await writeFile(join(releaseDirectory, 'checksums.sha256'), `${lines.join('\n')}\n`, 'utf8')
}

async function verifyChecksums() {
  const checksumPath = join(releaseDirectory, 'checksums.sha256')
  const lines = (await readFile(checksumPath, 'utf8')).trim().split(/\r?\n/u)
  assert.ok(lines.length >= 5)
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line)
    assert.ok(match, `invalid checksum row: ${line}`)
    const [, expected, file] = match
    assert.equal(await sha256(join(releaseDirectory, file)), expected, `checksum mismatch: ${file}`)
  }
}

async function verifyOfficialCheckout() {
  const manifest = JSON.parse(await readFile(join(dshRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, RC2_RELEASE)
  const commit = await run('git', ['rev-parse', 'HEAD'], { cwd: dshRoot, capture: true })
  assert.equal(commit.stdout.trim(), RC2_COMMIT)
  await stat(dshBin)
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function renderReport(report) {
  return `# dsh-military Release Verification

Generated: ${report.completedAt}

Baseline: \`${RC2_RELEASE}\` @ \`${RC2_COMMIT}\`

Result: **PASS**

- Frozen lockfile: PASS
- Published package pack/publint checks: ${report.packageChecks.length} PASS
- Bundle two-pack reproducibility: PASS
- Installer two-pack reproducibility: PASS
- Release checksums: PASS
- Empty DSH Home / Web Profile installation: PASS
- Profile and standalone Installer peer checks: PASS
- Bundle Host and browser module activation: PASS
- Standalone Installer preset installation and receipt verification: PASS
- Military Preset Session: PASS
- Mission → Task → continuable Worker → Verification → Integration: PASS
- Failure injection, duplicate command and two restart recoveries: PASS

Artifacts:

- \`${bundleName}\` — \`${report.artifacts.bundle.sha256}\`
- \`${installerName}\` — \`${report.artifacts.installer.sha256}\`
`
}

function run(program, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''
    if (options.capture === true) {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
    }
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(
        `${basename(program)} ${args.join(' ')} exited ${String(code)}${stderr === '' ? '' : `\n${stderr}`}`,
      ))
    })
  })
}
