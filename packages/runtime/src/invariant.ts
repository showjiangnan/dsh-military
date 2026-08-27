/** Package-owned invariant companion for `@dsh-military/runtime`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/runtime'
export const name = 'dsh-military-runtime-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: runtime coordination is exposed through durable
 * repository interfaces rather than a Cordis event seam; restart, lease,
 * idempotency, outbox, and reducer relations are verified by replay tests.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
