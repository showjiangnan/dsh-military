/** Package-owned invariant companion for `@dsh-military/infrastructure`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/infrastructure'
export const name = 'dsh-military-infrastructure-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: filesystem and Git correctness is observable only
 * through host-executed process receipts, repository state, and crash
 * reconciliation, which the integration E2E tests verify.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
