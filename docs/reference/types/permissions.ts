import type { DataClassification, MilitaryRole } from './domain.js'

export interface ToolGrant {
  readonly toolName: string
  readonly mode: 'read' | 'write' | 'admin'
}

export interface ApiGrant {
  readonly grantId: string
  readonly gateway: string
  readonly methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  readonly resourcePatterns: readonly string[]
  readonly classificationCeiling: DataClassification
  readonly credentialRef?: string
  readonly rateLimitPerMinute?: number
  readonly responseRedactionPolicy?: string
}

export interface RolePermissionProfile {
  readonly role: MilitaryRole
  readonly tools: readonly ToolGrant[]
  readonly allowedReadPaths: readonly string[]
  readonly allowedWritePaths: readonly string[]
  readonly forbiddenPaths: readonly string[]
  readonly tacticalSkillPatterns: readonly string[]
  readonly apiGrants: readonly ApiGrant[]
  readonly dataClassificationCeiling: DataClassification
  readonly mayCreateAgents: boolean
  readonly mayAskUserDirectly: boolean
  readonly mayAcceptResults: boolean
  readonly mayFreezeAgents: boolean
  readonly mayWriteSpecs: boolean
  readonly mayWriteRemoteGit: boolean
  readonly mayPublishTactics: boolean
  readonly mayReadCrossSessionEvaluationData: boolean
}

export const hardRoleInvariants: Readonly<Record<MilitaryRole, Partial<RolePermissionProfile>>> = {
  general: {
    mayAskUserDirectly: true,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayPublishTactics: false,
  },
  advisor: {
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  'chief-of-staff': {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  worker: {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  engineer: {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: true,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  inspector: {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  trajectory: {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  effectiveness: {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  museum: {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
  },
  'evaluation-examiner': {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
    mayReadCrossSessionEvaluationData: true,
  },
  'evaluation-chair': {
    mayCreateAgents: false,
    mayAskUserDirectly: false,
    mayAcceptResults: false,
    mayFreezeAgents: false,
    mayWriteSpecs: false,
    mayWriteRemoteGit: false,
    mayPublishTactics: false,
    mayReadCrossSessionEvaluationData: true,
  },
  harness: {
    mayAskUserDirectly: false,
    mayAcceptResults: true,
    mayFreezeAgents: true,
    mayPublishTactics: true,
  },
}
