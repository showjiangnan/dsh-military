import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The release artifact exposes the Host plugin from the Bundle package root.
// All implementation packages are embedded below this package at pack time, so
// a clean DSH Profile only needs to resolve `@dsh-military/bundle`.
export {
  Config,
  apply,
  inject,
  name,
} from '@dsh-military/plugin-host'
export type { PluginConfig } from '@dsh-military/plugin-host'

const root = dirname(fileURLToPath(import.meta.url))
export function militaryBundlePatchPath(): string { return join(root, '..', 'cordis.patch.yml') }
export const militaryBundleId = '@dsh-military/bundle'
export const dshBaseline = Object.freeze({
  release: '0.1.1-rc.2',
  commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
})
