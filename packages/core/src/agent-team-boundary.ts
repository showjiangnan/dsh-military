import { MilitaryError } from '@dsh-military/contracts'

/**
 * RC.2 ships an experimental Agent Team subsystem. dsh-military may project
 * read-only presentation data into that surface, but Mission, Task, Radio,
 * workspace, verification and acceptance authority always remain in the
 * Military Kernel and ledgers.
 */
export const RC2_AGENT_TEAM_BOUNDARY = Object.freeze({
  authoritative: false as const,
  allowedUses: Object.freeze([
    'roster-projection',
    'peer-presentation',
    'comparison-experiment',
  ] as const),
  forbiddenUses: Object.freeze([
    'mission-state',
    'task-state',
    'radio-authority',
    'workspace-lock',
    'verification-authority',
    'candidate-acceptance',
  ] as const),
})

export type AgentTeamUse =
  | typeof RC2_AGENT_TEAM_BOUNDARY.allowedUses[number]
  | typeof RC2_AGENT_TEAM_BOUNDARY.forbiddenUses[number]

/** Fail closed when an integration attempts to make Agent Team authoritative. */
export function assertAgentTeamProjectionOnly(use: AgentTeamUse): void {
  if ((RC2_AGENT_TEAM_BOUNDARY.forbiddenUses as readonly string[]).includes(use)) {
    throw new MilitaryError(
      'POLICY_DENIED',
      `RC.2 experimental Agent Team is non-authoritative for ${use}; use the Military Kernel`,
    )
  }
}
