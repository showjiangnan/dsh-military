export const MILITARY_WORKSPACE_SCHEMA_VERSION = '1.0.0' as const

export interface MilitaryWorkspaceCatalogEntry {
  readonly workspaceId: string
  readonly label: string
  /** Canonical Host-validated local root; it is never accepted back as input. */
  readonly canonicalRoot: string
  readonly rootPathHash: string
  readonly sessionIds: readonly string[]
  readonly available: boolean
  readonly repository: boolean
  readonly updatedAt: string
}

export interface MilitaryWorkspacePathEntry {
  readonly path: string
  readonly kind: 'FILE' | 'DIRECTORY'
  readonly gitState: 'CLEAN' | 'MODIFIED' | 'ADDED' | 'DELETED' | 'RENAMED' | 'UNTRACKED' | 'IGNORED' | 'UNKNOWN'
  readonly scope: 'READ_WRITE' | 'READ_ONLY' | 'FORBIDDEN' | 'SPECS_DEFAULT' | 'UNSCOPED'
  readonly scopeReason: string
}

export interface MilitaryWorkspaceLeaseView {
  readonly leaseId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly roleId: string
  readonly mode: 'READ' | 'WRITE'
  readonly state: string
  readonly readPaths: readonly string[]
  readonly writePaths: readonly string[]
  readonly forbiddenPaths: readonly string[]
  readonly worktreeLabel?: string
  readonly expiresAt: string
}

export interface MilitaryWorkspaceIntegrationView {
  readonly integrationOrderId: string
  readonly candidatePatchId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly state: string
  readonly disposition?: string
  readonly beforeHead?: string
  readonly afterHead?: string
  readonly commit?: string
  readonly receiptId?: string
  readonly updatedAt: string
}

export interface MilitaryWorkspaceStatus {
  readonly schemaVersion: typeof MILITARY_WORKSPACE_SCHEMA_VERSION
  readonly workspace: MilitaryWorkspaceCatalogEntry
  readonly git: {
    readonly available: boolean
    readonly root?: string
    readonly head?: string
    readonly branch?: string
    readonly tree?: string
    readonly dirty: number
    readonly untracked: number
    readonly summary: string
  }
  readonly pathEntries: readonly MilitaryWorkspacePathEntry[]
  readonly truncatedPathCount: number
  readonly leases: readonly MilitaryWorkspaceLeaseView[]
  readonly integrations: readonly MilitaryWorkspaceIntegrationView[]
  readonly rolePathExamples: readonly {
    readonly roleId: string
    readonly taskId: string
    readonly readExample: string
    readonly writeExample?: string
    readonly forbiddenExample?: string
  }[]
  readonly generatedAt: string
}

export interface MilitaryWorkspaceSnapshot {
  readonly schemaVersion: typeof MILITARY_WORKSPACE_SCHEMA_VERSION
  readonly workspaces: readonly MilitaryWorkspaceCatalogEntry[]
  readonly generatedAt: string
}
