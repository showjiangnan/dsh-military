export const MILITARY_PRINCIPAL_SCHEMA_VERSION = '1.0.0' as const

export type MilitaryWebScope =
  | 'military.settings.manage'
  | 'military.runtime.read'
  | 'military.knowledge.manage'
  | 'military.evaluation.manage'
  | 'military.benchmark.manage'
  | 'military.workspace.manage'
  | 'military.recovery.manage'

/**
 * Authority attached by the trusted Host to Web RPCs.
 *
 * DSH 0.1.1-rc.2 does not expose an authenticated request principal to plugin
 * remotes.  The only truthful boundary in this baseline is therefore the
 * local DSH process/user plus the configured tenant.  The explicit mode flag
 * prevents this context from being mistaken for multi-tenant authentication.
 */
export interface MilitaryWebPrincipal {
  readonly schemaVersion: typeof MILITARY_PRINCIPAL_SCHEMA_VERSION
  readonly principalId: string
  readonly tenantId: string
  readonly authoritySource: 'DSH_RC2_LOCAL_PROCESS'
  readonly tenancyMode: 'LOCAL_SINGLE_USER'
  readonly requestPrincipalAvailable: false
  readonly scopes: readonly MilitaryWebScope[]
}
