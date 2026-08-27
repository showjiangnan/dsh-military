import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  cp,
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
const SOURCE_DATE_EPOCH = process.env.SOURCE_DATE_EPOCH ?? '1787529600'
const generatedAt = new Date(Number(SOURCE_DATE_EPOCH) * 1000).toISOString()
const releaseDirectory = resolve('release')
const firstPack = await mkdtemp(join(tmpdir(), 'dsh-military-release-first-'))
const secondPack = await mkdtemp(join(tmpdir(), 'dsh-military-release-second-'))

try {
  await run(process.execPath, ['scripts/build.mjs'], {
    env: { ...process.env, SOURCE_DATE_EPOCH },
  })
  await mkdir(releaseDirectory, { recursive: true })
  // RC.2 profiles keep an exact file: reference to the currently installed
  // tarball. pnpm resolves that reference before dsh can replace it during an
  // upgrade, so removing an older release here makes the next upgrade
  // impossible. Fixed-name metadata is overwritten below; immutable historical
  // tarballs stay available until no Profile refers to them.
  const existingTarballs = await listReleaseTarballs()

  const packages = [
    { directory: 'packages/bundle', expected: `dsh-military-bundle-${VERSION}.tgz` },
    { directory: 'packages/installer', expected: `dsh-military-installer-${VERSION}.tgz` },
  ]
  const tarballs = []
  const reproducibility = []
  for (const candidate of packages) {
    const first = await pack(candidate.directory, firstPack)
    const second = await pack(candidate.directory, secondPack)
    assert.equal(basename(first), candidate.expected)
    assert.equal(basename(second), candidate.expected)
    const firstHash = await sha256(first)
    const secondHash = await sha256(second)
    assert.equal(
      secondHash,
      firstHash,
      `${candidate.expected} is not reproducible across two clean npm pack destinations`,
    )
    const target = join(releaseDirectory, candidate.expected)
    await cp(first, target, { force: true })
    tarballs.push(candidate.expected)
    reproducibility.push({
      file: candidate.expected,
      firstSha256: firstHash,
      secondSha256: secondHash,
      identical: true,
    })
  }

  await writeFile(join(releaseDirectory, 'INSTALL.md'), installDocument(tarballs), 'utf8')
  const preset = JSON.parse(
    await readFile('packages/preset/agent-presets/military/generation-manifest.json', 'utf8'),
  )
  await writeFile(join(releaseDirectory, 'VERSION.json'), `${JSON.stringify({
    schemaVersion: '1.0.0',
    sourceVersion: VERSION,
    releaseStatus: 'RC2_RELEASE_CANDIDATE',
    allGatesPassed: false,
    dshBaseline: { release: RC2_RELEASE, commit: RC2_COMMIT },
    preset: { id: 'military', generation: preset.generation, assetHash: preset.assetHash },
    artifacts: tarballs,
    sourceDateEpoch: Number(SOURCE_DATE_EPOCH),
    generatedAt,
    reproducible: true,
  }, null, 2)}\n`, 'utf8')

  const payloadFiles = [...tarballs, 'INSTALL.md', 'VERSION.json']
  const entries = await metadata(payloadFiles)
  await writeFile(join(releaseDirectory, 'RELEASE-MANIFEST.json'), `${JSON.stringify({
    schemaVersion: '1.0.0',
    sourceVersion: VERSION,
    generatedAt,
    dshBaseline: { release: RC2_RELEASE, commit: RC2_COMMIT },
    files: entries,
    reproducibility,
  }, null, 2)}\n`, 'utf8')
  const checksumFiles = [...payloadFiles, 'RELEASE-MANIFEST.json']
  const checksums = await Promise.all(checksumFiles.sort().map(async file =>
    `${await sha256(join(releaseDirectory, file))}  ${file}`))
  await writeFile(join(releaseDirectory, 'checksums.sha256'), `${checksums.join('\n')}\n`, 'utf8')

  const currentTarballs = new Set(tarballs)
  const retainedTarballs = existingTarballs.filter(file => !currentTarballs.has(file))
  for (const file of retainedTarballs) {
    await stat(join(releaseDirectory, file))
  }
  process.stdout.write(
    `Release build complete: ${tarballs.join(', ')}; two-pack reproducibility verified; ` +
      `${retainedTarballs.length} prior tarball(s) retained for safe Profile upgrades.\n`,
  )
} finally {
  await rm(firstPack, { recursive: true, force: true })
  await rm(secondPack, { recursive: true, force: true })
}

async function pack(directory, destination) {
  const result = await run('npm', [
    'pack',
    `./${directory}`,
    '--pack-destination',
    destination,
    '--json',
  ], { capture: true })
  const parsed = JSON.parse(result.stdout)
  if (!Array.isArray(parsed) || typeof parsed[0]?.filename !== 'string') {
    throw new Error(`npm pack did not report an artifact for ${directory}`)
  }
  return join(destination, parsed[0].filename)
}

async function metadata(files) {
  return await Promise.all(files.sort().map(async file => {
    const path = join(releaseDirectory, file)
    return {
      path: file,
      byteLength: (await stat(path)).size,
      sha256: await sha256(path),
    }
  }))
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function listReleaseTarballs() {
  try {
    return (await readdir(releaseDirectory))
      .filter(file => file.endsWith('.tgz'))
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function installDocument([bundle, installer]) {
  return `# dsh-military ${VERSION} — DSH RC.2 installation

This release is pinned to DeepSeek Harness \`${RC2_RELEASE}\` at
\`${RC2_COMMIT}\`. Do not install it into another Harness release.

## Verify

\`\`\`bash
shasum -a 256 -c checksums.sha256
dsh --version
\`\`\`

The second command must print \`${RC2_RELEASE}\`.

## Fresh installation

\`\`\`bash
dsh plugin --profile web add \\
  ./${bundle}

pnpm --dir "\${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \\
  dsh-military-install install \\
  --dsh-home "\${DSH_HOME:-$HOME/.dsh}"

dsh --profile web
\`\`\`

The Bundle is self-contained: all private \`@dsh-military/*\` runtime packages,
the Installer, and the stable \`dsh-military-install\` command are embedded in
\`${bundle}\`. Do not add \`${installer}\` with \`dsh plugin\`: it is a plain
dependency, not a Bundle layer.

The separately packed Installer is for preset-only lifecycle workflows. If
that is the only component needed, install it as an ordinary Profile
dependency, then invoke the same command:

\`\`\`bash
installer_artifact="$(pwd)/${installer}"
pnpm --dir "\${DSH_HOME:-$HOME/.dsh}/profiles/web" add "$installer_artifact"
pnpm --dir "\${DSH_HOME:-$HOME/.dsh}/profiles/web" exec \\
  dsh-military-install install \\
  --dsh-home "\${DSH_HOME:-$HOME/.dsh}"
\`\`\`

Neither artifact resolves unpublished internal packages from npm. RC.2
platform peers are declared but package-manager-optional because the DSH
Profile fallback supplies the installation's singleton runtime identities.

Select the \`military\` preset when creating a Session. The Web Profile must
show the Military settings surfaces and all Loader rows must be ACTIVE.

## Upgrade

1. Verify the new release checksums and exact DSH baseline.
2. Back up \`\${DSH_HOME:-$HOME/.dsh}/military\` and the target repository.
3. Keep the currently installed Bundle tarball at its original path. RC.2's
   package manager resolves the existing \`file:\` dependency before replacing
   it, so deleting that file first makes the upgrade fail.
4. Run the same \`dsh plugin ... add\` command with the new Bundle tarball.
5. Run \`dsh-military-install install --force\` only after reviewing the Preset
   generation change and its breaking/resume policy.
6. Start the Profile and verify existing Sessions before removing the backup.
7. Archive an older tarball only after confirming that no Profile
   \`package.json\` still refers to its path.

## Rollback

Re-add the previously verified Bundle tarball, then restore the matching
Military data-root backup. If the standalone Installer was installed
separately, restore its matching tarball too. Preset generations and database
state must be rolled back as one unit. The installer refuses to delete or
overwrite modified Preset content without explicit \`--force\`.
`
}

function run(program, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd: process.cwd(),
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
      else reject(new Error(`${program} ${args.join(' ')} exited ${String(code)}\n${stderr}`))
    })
  })
}
