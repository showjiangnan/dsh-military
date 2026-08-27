import type { Context } from '@deepseek-ai/cordis'
import {
  isAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AgentPlaneState } from './agent-plane-state.js'

/**
 * Hide General prose while a project-execution workflow obligation is open.
 * Tool-call chunks, usage and finish facts pass through unchanged, so a light
 * model can recover on the next Host-steered step without leaking a generated
 * file as a substitute for department execution.
 */
export function registerGeneralOutputGuard(
  ctx: Context,
  state: AgentPlaneState,
): void {
  ctx.on('llm/stream', (
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> => {
    return shouldSuppressGeneralOutput(options, state)
      ? suppressGeneralImplementationText(next())
      : next()
  })
}

/**
 * Auxiliary compaction, title and evaluator calls can carry the same Session
 * id, but they are not model-loop turns and must retain their text.
 */
export function shouldSuppressGeneralOutput(
  options: GenerateOptions,
  state: Pick<AgentPlaneState, 'generalWorkflowSessions'>,
): boolean {
  const sessionId = options.sessionId === undefined
    ? ''
    : String(options.sessionId)
  return isAgentLoopRequest(options)
    && state.generalWorkflowSessions.has(sessionId)
}

export async function* suppressGeneralImplementationText(
  source: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  const suppressedIndexes = new Set<number>()
  for await (const chunk of source) {
    if (
      chunk.type === 'block-start'
      && (chunk.blockType === 'text' || chunk.blockType === 'reasoning')
    ) {
      suppressedIndexes.add(chunk.index)
      continue
    }
    if (
      (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')
      && suppressedIndexes.has(chunk.index)
    ) continue
    if (
      chunk.type === 'block-end'
      && suppressedIndexes.delete(chunk.index)
    ) continue
    yield chunk
  }
}
