import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionEvent,
  SessionId as DshSessionId,
} from '@deepseek-ai/dsh-session'
import { MilitaryError } from '@dsh-military/contracts'
import type { SessionSourceReader } from '@dsh-military/runtime'

interface PersistenceLike {
  inspect(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly meta: Record<string, unknown>
    readonly events: readonly SessionEvent[]
  }>
}

interface SessionSnapshot {
  readonly meta: Record<string, unknown>
  readonly events: readonly SessionEvent[]
}

/** Reads live sessions first, then the RC.2 session-persistence seam. */
export class DshSessionSourceReader implements SessionSourceReader {
  readonly #ctx: Context

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  async read(input: {
    readonly sessionId: string
    readonly startSeq?: number
    readonly endSeq?: number
    readonly includeToolResults: boolean
  }): Promise<Uint8Array> {
    const live = this.#ctx.agents?.get(input.sessionId as DshSessionId)
    const snapshot = live === undefined
      ? await this.#inspectCold(input.sessionId)
      : {
          meta: live.session.header as unknown as Record<string, unknown>,
          events: live.session.events,
        }
    const selected = snapshot.events.filter(event =>
      (input.startSeq === undefined || event.seq >= input.startSeq)
      && (input.endSeq === undefined || event.seq <= input.endSeq)
      && (input.includeToolResults || event.type !== 'tool/result'))
    return new TextEncoder().encode(JSON.stringify({
      header: snapshot.meta,
      events: selected,
    }, null, 2))
  }

  async #inspectCold(sessionId: string): Promise<SessionSnapshot> {
    const persistence = asPersistence(this.#ctx.sessionPersistence)
    if (persistence === undefined) {
      throw new MilitaryError(
        'NOT_FOUND',
        'session is not live and RC.2 session persistence is unavailable',
      )
    }
    return await persistence.inspect(sessionId)
  }
}

function asPersistence(value: unknown): PersistenceLike | undefined {
  if (
    typeof value === 'object'
    && value !== null
    && 'inspect' in value
    && typeof value.inspect === 'function'
  ) return value as PersistenceLike
  return undefined
}
