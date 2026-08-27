import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

await rm('.build', { recursive: true, force: true })
await rm('BUILD-MANIFEST.json', { force: true })
await rm('CODE-REVIEW-REPORT.md', { force: true })
await rm('TEST-REPORT.json', { force: true })
for (const root of ['packages', 'apps']) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    await rm(join(root, entry.name, 'lib'), { recursive: true, force: true })
    await rm(join(root, entry.name, 'tsconfig.tsbuildinfo'), { force: true })
    await removeStrayEmits(join(root, entry.name, 'src'))
  }
}

async function removeStrayEmits(root) {
  try { await stat(root) } catch { return }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await removeStrayEmits(path)
    else if (/\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(entry.name)) await rm(path, { force: true })
  }
}
