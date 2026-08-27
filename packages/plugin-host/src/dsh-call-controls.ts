import type { Context } from '@deepseek-ai/cordis'
import {
  ReasoningEffortId,
  type ReasoningEffortId as ReasoningEffort,
} from '@deepseek-ai/dsh-llm'

export interface DshReasoningResolution {
  /** Adapter-valid effort. Absence deliberately delegates to its default. */
  readonly effort?: ReasoningEffort
  readonly requested: string
  readonly supported: readonly string[]
  readonly adapted: boolean
}

/**
 * Translate Military's compact workload intent to the exact DSH adapter
 * vocabulary. DSH effort identifiers are provider-owned and some connected
 * models expose no reasoning control at all; omitting the field is the only
 * valid request for those routes.
 */
export async function resolveDshReasoningEffort(input: {
  readonly ctx: Context
  readonly provider: string
  readonly model: string
  readonly requested: string
  readonly signal?: AbortSignal
}): Promise<DshReasoningResolution> {
  let resolved: Awaited<ReturnType<Context['llm']['resolveModelInfo']>>
  try {
    resolved = await input.ctx.llm.resolveModelInfo(
      input.provider,
      input.model,
      input.signal,
    )
  } catch {
    // A third-party adapter may resolve only at prepareCall. Preserve the
    // requested opaque value instead of inventing an availability failure.
    return {
      effort: ReasoningEffortId(input.requested),
      requested: input.requested,
      supported: [],
      adapted: false,
    }
  }
  const reasoning = resolved.reasoning
  if (reasoning === undefined || reasoning.efforts.length === 0) {
    return {
      requested: input.requested,
      supported: [],
      adapted: true,
    }
  }
  const supported = reasoning.efforts.map(value => String(value.id))
  if (supported.includes(input.requested)) {
    return {
      effort: ReasoningEffortId(input.requested),
      requested: input.requested,
      supported,
      adapted: false,
    }
  }
  const fallback = reasoning.defaultEffort
    ?? preferredEffort(supported)
  return {
    ...(fallback === undefined
      ? {}
      : { effort: ReasoningEffortId(String(fallback)) }),
    requested: input.requested,
    supported,
    adapted: true,
  }
}

function preferredEffort(
  supported: readonly string[],
): string | undefined {
  for (const candidate of ['high', 'max', 'medium', 'low', 'off']) {
    if (supported.includes(candidate)) return candidate
  }
  // Adapter order is explicitly its preferred display order and therefore
  // the least surprising fallback for custom provider vocabularies.
  return supported[0]
}
