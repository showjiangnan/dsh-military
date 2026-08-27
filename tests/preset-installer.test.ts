import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { agentPresetsConfigWithSystemRoot, installMilitaryPreset, uninstallMilitaryPreset, verifyMilitaryPreset } from '@dsh-military/installer'
import { temporaryDirectory } from '@dsh-military/testkit'

test('preset installer is transactional, verifiable and uninstall-safe', async () => {
  const temp = await temporaryDirectory('military-installer-')
  try {
    const receipt = await installMilitaryPreset({ dshHome: temp.path })
    assert.equal(receipt.presetId, 'military')
    assert.equal(receipt.dshBaseline.release, '0.1.1-rc.2')
    assert.ok(await verifyMilitaryPreset(receipt.targetDirectory))
    assert.match(await readFile(`${receipt.targetDirectory}/preset.yml`, 'utf8'), /Military/u)
    await uninstallMilitaryPreset({ dshHome: temp.path })
    assert.equal(await verifyMilitaryPreset(receipt.targetDirectory), null)
  } finally { await temp.dispose() }
})

test('system-root helper preserves deployment defaults and existing roots', () => {
  const current = { default: 'standard', roots: [{ path: '/system/presets', trust: 'system' as const }], includeUserRoot: true }
  const next = agentPresetsConfigWithSystemRoot(current, '/opt/dsh-military/presets')
  assert.equal(next.default, 'standard')
  assert.equal(next.includeUserRoot, true)
  assert.equal(next.roots.length, 2)
})
