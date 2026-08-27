/** Package-owned invariant companion for `@dsh-military/tools`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-military/tools'
export const name = 'dsh-military-tools-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: every tool call crosses canonical schema,
 * authorization, capability, budget, and host-observation boundaries before
 * returning; registration/disposal is covered by exact RC.2 composition.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
