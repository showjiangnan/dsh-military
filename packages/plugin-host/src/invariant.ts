/** Package-owned invariant companion for `@dsh-military/plugin-host`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/plugin-host'
export const name = 'dsh-military-plugin-host-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: Host admission is checked synchronously at each
 * session, model, tool, child, and completion boundary; cross-service
 * topology and lifecycle are verified by the exact RC.2 Profile E2E gate.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
