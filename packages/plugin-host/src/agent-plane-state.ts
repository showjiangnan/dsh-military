import type { ContextManifest } from '@dsh-military/contracts'

/** Process-local correlation caches; every authoritative fact lives in a durable provider. */
export interface AgentPlaneState {
  readonly generalRoutes: Map<string, string>
  readonly compactionByTurn: Set<string>
  readonly interlockNoProgress: Map<string, number>
  /**
   * Exact General turns that owe governed Military orchestration. The reason
   * distinguishes a new user execution request from continuation/child wake
   * so an already accepted Mission is not reopened accidentally.
   */
  readonly generalWorkflowTurns: Map<string, 'USER_EXECUTION' | 'CONTINUATION' | 'CHILD_WAKE'>
  /** Successful General coordination tools observed in one exact turn. */
  readonly generalSuccessfulToolsByTurn: Map<string, Set<string>>
  /** General Sessions whose open workflow may emit tools but not prose implementation. */
  readonly generalWorkflowSessions: Set<string>
  readonly contextManifestByStep: Map<string, ContextManifest>
  readonly terminalSubmissionTurns: Set<string>
  /**
   * Monotonic per-Agent latch for the exact open RC.2 model step. RC.2 records
   * `concludesTurn` on a successful result but still dispatches later tool
   * calls already emitted in the same assistant message; this latch rejects
   * those stale siblings before they can mutate state.
   */
  readonly concludedStepByAgent: Map<string, string>
  readonly modelFailureAttempts: Map<string, number>
  readonly invalidToolCallByAgent: Map<string, {
    readonly signature: string
    readonly errorHash: string
  }>
  /**
   * Process-local dispatch slots enforcing ToolProfile.maxParallelCalls.
   * Durable grants and budgets remain the crash-recovery authority; these
   * sets only gate simultaneously executing calls in one live Agent process.
   */
  readonly activeToolCallsByAgent: Map<string, Set<string>>
  /** Department Agents currently spending their one terminal-only grace step. */
  readonly finalizationOnlyAgents: Set<string>
  /** Child user-aborts whose settlement-only wake must not spend a parent request. */
  readonly userCancelledChildren: Set<string>
}

export function createAgentPlaneState(): AgentPlaneState {
  return {
    generalRoutes: new Map(),
    compactionByTurn: new Set(),
    interlockNoProgress: new Map(),
    generalWorkflowTurns: new Map(),
    generalSuccessfulToolsByTurn: new Map(),
    generalWorkflowSessions: new Set(),
    contextManifestByStep: new Map(),
    terminalSubmissionTurns: new Set(),
    concludedStepByAgent: new Map(),
    modelFailureAttempts: new Map(),
    invalidToolCallByAgent: new Map(),
    activeToolCallsByAgent: new Map(),
    finalizationOnlyAgents: new Set(),
    userCancelledChildren: new Set(),
  }
}

/** Retire only ephemeral entries owned by one exact Agent identity. */
export function clearAgentPlaneState(
  state: AgentPlaneState,
  agentId: string,
  sessionId?: string,
): void {
  const prefix = `${agentId}:`
  state.generalRoutes.delete(agentId)
  deletePrefixed(state.compactionByTurn, prefix)
  deleteMapPrefixed(state.interlockNoProgress, prefix)
  deleteMapPrefixed(state.generalWorkflowTurns, prefix)
  deleteMapPrefixed(state.generalSuccessfulToolsByTurn, prefix)
  deleteMapPrefixed(state.contextManifestByStep, prefix)
  deletePrefixed(state.terminalSubmissionTurns, prefix)
  state.concludedStepByAgent.delete(agentId)
  deleteMapPrefixed(state.modelFailureAttempts, prefix)
  state.invalidToolCallByAgent.delete(agentId)
  state.activeToolCallsByAgent.delete(agentId)
  state.finalizationOnlyAgents.delete(agentId)
  state.userCancelledChildren.delete(agentId)
  if (sessionId !== undefined) state.generalWorkflowSessions.delete(sessionId)
}

export function modelAttemptKey(agentId: string, turn: number, step: number): string {
  return `${agentId}:${turn}:${step}`
}

function deletePrefixed(values: Set<string>, prefix: string): void {
  for (const key of values) if (key.startsWith(prefix)) values.delete(key)
}

function deleteMapPrefixed<T>(values: Map<string, T>, prefix: string): void {
  for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
}
