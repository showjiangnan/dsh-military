import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('Military WebUI reuses the RC.2 primitive graph and leaves theme ownership to DSH', async () => {
  const [manifestText, bundleManifestText, settings, knowledge, stylesheet] = await Promise.all([
    readFile('packages/webui/package.json', 'utf8'),
    readFile('packages/bundle/package.json', 'utf8'),
    readFile('packages/webui/src/client/settings-center.tsx', 'utf8'),
    readFile('packages/webui/src/client/knowledge-center.tsx', 'utf8'),
    readFile('packages/webui/src/client/native-ui.css', 'utf8'),
  ])
  const manifest = JSON.parse(manifestText) as {
    dsh?: { client?: { inject?: readonly string[] } }
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const bundleManifest = JSON.parse(bundleManifestText) as {
    dsh?: { client?: { inject?: readonly string[] } }
  }
  const primitives = '@deepseek-ai/dsh-client-ui-primitives'

  assert.ok(manifest.dsh?.client?.inject?.includes(primitives))
  assert.ok(bundleManifest.dsh?.client?.inject?.includes(primitives))
  assert.equal(manifest.peerDependencies?.[primitives], '0.1.1-rc.2')
  assert.equal(manifest.devDependencies?.[primitives], '0.1.1-rc.2')
  for (const primitive of [
    'IconCloseOutline16',
    'IconSettingsOutline14',
    'IconSettingsOutline16',
    'Modal',
    'Pill',
    'StateDot',
  ]) assert.match(settings, new RegExp(`\\b${primitive}\\b`, 'u'))
  assert.match(settings, /className="dshm-settings-dialog"/u)
  for (const primitive of ['IconSkillOutline16', 'Modal', 'Pill', 'StateDot']) {
    assert.match(knowledge, new RegExp(`\\b${primitive}\\b`, 'u'))
  }
  assert.match(knowledge, /className="dshm-knowledge-dialog"/u)

  const visualSources = `${settings}\n${knowledge}\n${stylesheet}`
  for (const obsolete of [
    '--bc-',
    '--dsw-alias-text-',
    '--dsw-alias-state-danger-',
    '--dsw-alias-state-warning-',
    'rgba(',
  ]) {
    assert.equal(visualSources.includes(obsolete), false, `obsolete or plugin-owned theme literal: ${obsolete}`)
  }
  assert.match(stylesheet, /var\(--dsw-alias-bg-layer-1\)/u)
  assert.match(stylesheet, /var\(--dsw-alias-label-primary\)/u)
  assert.match(stylesheet, /height:\s*32px/u)
  assert.match(stylesheet, /width:\s*min\(1080px,\s*calc\(100vw - 48px\)\)/u)
  assert.equal(/button:not\(\[data-dshm-nav\]\):not\(\[data-dshm-close\]\)\s*\{/u.test(stylesheet), false)
  assert.match(stylesheet, /:where\(button:not\(\[data-dshm-nav\]\):not\(\[data-dshm-close\]\)\)/u)
})

test('Military WebUI preserves DSH focus, responsive and reduced-motion contracts', async () => {
  const [stylesheet, settings, knowledge, roles, dialog] = await Promise.all([
    readFile('packages/webui/src/client/native-ui.css', 'utf8'),
    readFile('packages/webui/src/client/settings-center.tsx', 'utf8'),
    readFile('packages/webui/src/client/knowledge-center.tsx', 'utf8'),
    readFile('packages/webui/src/client/role-workbench.tsx', 'utf8'),
    readFile('packages/webui/src/client/dialog-accessibility.ts', 'utf8'),
  ])
  assert.match(stylesheet, /:focus-visible/u)
  assert.match(stylesheet, /@media \(max-width: 760px\)/u)
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)/u)
  assert.match(stylesheet, /@media \(prefers-contrast: more\)/u)
  assert.match(stylesheet, /@media \(forced-colors: active\)/u)
  assert.match(stylesheet, /\[data-dshm-sidebar\]/u)
  assert.match(stylesheet, /\[data-dshm-nav\][\s\S]*white-space:\s*nowrap/u)
  assert.match(stylesheet, /\[data-military-knowledge-trigger='true'\]/u)
  assert.match(stylesheet, /\[data-military-settings-trigger='true'\]/u)
  assert.match(stylesheet, /\[data-military-footer-actions='true'\][\s\S]*flex-direction:\s*column/u)
  assert.match(stylesheet, /width:\s*calc\(100% \+ 4px\)/u)
  assert.match(stylesheet, /cursor:\s*pointer;\s*\n\s*overflow:\s*hidden/u)
  assert.match(stylesheet, /\[data-military-footer-actions='true'\]\[data-wide='false'\][\s\S]*align-items:\s*center/u)
  assert.match(stylesheet, /\[data-role-prompt-editor\] textarea/u)
  for (const source of [settings, knowledge]) {
    assert.match(source, /role="tablist"/u)
    assert.match(source, /role="tab"/u)
    assert.match(source, /role="tabpanel"/u)
    assert.match(source, /aria-selected=/u)
    assert.match(source, /nativeEvent\.isComposing/u)
  }
  assert.match(roles, /role="listbox"/u)
  assert.match(roles, /role="option"/u)
  assert.match(roles, /aria-activedescendant/u)
  assert.match(dialog, /document\.addEventListener\('keydown', trap, true\)/u)
  assert.match(dialog, /event\.key !== 'Tab'/u)
  assert.match(dialog, /dialog\.setAttribute\('tabindex', '-1'\)/u)
  assert.match(dialog, /dialog\.removeAttribute\('tabindex'\)/u)
})
