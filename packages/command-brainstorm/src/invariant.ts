/** Package-owned invariant companion for `@dsh-military/command-brainstorm`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/command-brainstorm'
export const name = 'dsh-military-command-brainstorm-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: command admission is a synchronous preset, identity,
 * attachment, and schema check; command registration and disposal are covered
 * by the RC.2 Loader composition test.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
