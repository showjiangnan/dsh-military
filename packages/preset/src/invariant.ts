/** Package-owned invariant companion for `@dsh-military/preset`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/preset'
export const name = 'dsh-military-preset-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: preset assets and their generation manifest are
 * content-addressed static inputs; hash parity, archive parity, trust, and
 * composition are verified during generation and clean-Profile activation.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
