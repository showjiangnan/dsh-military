import {
  MilitaryError,
  type MilitaryWebPrincipal,
  type MilitaryWebScope,
} from '@dsh-military/contracts'
import type { MilitaryHostRuntime } from './context.js'

/**
 * Enforce the only principal boundary available to an RC.2 plugin Remote.
 * Callers cannot submit or override this identity.
 */
export function requireWebAuthority(
  host: MilitaryHostRuntime,
  scope: MilitaryWebScope,
): void {
  const principal = host.webPrincipal
  if (
    principal.tenantId !== host.tenantId
    || principal.tenancyMode !== 'LOCAL_SINGLE_USER'
    || principal.authoritySource !== 'DSH_RC2_LOCAL_PROCESS'
    || !principal.scopes.includes(scope)
  ) {
    throw new MilitaryError(
      'UNAUTHORIZED',
      `local Web authority does not grant ${scope}`,
    )
  }
}

/** Canonical authority exposed by the RC.2 local-process Web boundary. */
export function localSingleUserWebPrincipal(
  tenantId: string,
): MilitaryWebPrincipal {
  return Object.freeze({
    schemaVersion: '1.0.0',
    principalId: `dsh-local-user:${tenantId}`,
    tenantId,
    authoritySource: 'DSH_RC2_LOCAL_PROCESS',
    tenancyMode: 'LOCAL_SINGLE_USER',
    requestPrincipalAvailable: false,
    scopes: [
      'military.settings.manage',
      'military.runtime.read',
      'military.knowledge.manage',
      'military.evaluation.manage',
      'military.benchmark.manage',
      'military.workspace.manage',
      'military.recovery.manage',
    ],
  } satisfies MilitaryWebPrincipal)
}
