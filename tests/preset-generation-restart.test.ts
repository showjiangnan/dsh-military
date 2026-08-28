import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { MilitaryError, type PresetGenerationManifest } from '@dsh-military/contracts'
import { FilePresetGenerationArchive } from '@dsh-military/infrastructure'

test('preset archive survives a compatible bundle-only upgrade across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-military-preset-restart-'))
  const presetDirectory = resolve('packages/preset/agent-presets/military')
  try {
    const packaged = JSON.parse(
      await readFile(join(presetDirectory, 'generation-manifest.json'), 'utf8'),
    ) as PresetGenerationManifest
    const original = { ...packaged, bundleVersion: '0.9.0-alpha.1' }
    const upgraded = { ...packaged, bundleVersion: '0.9.0-alpha.28' }
    const archive = new FilePresetGenerationArchive(root)

    const firstBoot = await archive.archiveAssets(presetDirectory, original)
    const restarted = await archive.archiveAssets(presetDirectory, upgraded)

    assert.equal(firstBoot.bundleVersion, '0.9.0-alpha.1')
    assert.deepEqual(restarted, firstBoot)
    assert.equal((await archive.current()).bundleVersion, '0.9.0-alpha.1')

    await assert.rejects(
      () => archive.install({
        ...upgraded,
        compatibility: { ...upgraded.compatibility, resumeSupported: false },
      }),
      error => error instanceof MilitaryError && error.failure.code === 'IDEMPOTENCY_CONFLICT',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
