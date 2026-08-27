/** Package-owned invariant companion for `@dsh-military/webui`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/webui'
export const name = 'dsh-military-webui-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the browser module lives in a separate client
 * runtime; snapshot stability, external Settings adoption, bundle loading,
 * and HMR disposal are verified by client behavior and Profile E2E tests.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
