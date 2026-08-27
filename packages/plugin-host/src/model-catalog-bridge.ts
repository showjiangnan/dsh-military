import type { Context } from '@deepseek-ai/cordis'
import {
  brand,
  type ModelCapabilityProfile,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import type { SqliteMilitaryPolicyRegistry } from '@dsh-military/storage-sqlite'

type ResolvedModelInfo = Awaited<ReturnType<Context['llm']['resolveModelInfo']>>

/**
 * Convert one model that is present in the live DSH catalog into the
 * capability shape required by the Military runtime. Catalog presence is the
 * availability authority; performance evaluation remains separate evidence.
 */
export function inferDshCatalogModelCapability(input: {
  readonly provider: string
  readonly model: string
  readonly resolved?: ResolvedModelInfo
  readonly registeredAt?: string
}): ModelCapabilityProfile {
  const contextWindowTokens = Math.max(
    4_096,
    positiveInteger(input.resolved?.context?.contextWindow, 1_000_000),
  )
  const maxOutputTokens = Math.max(
    1_024,
    positiveInteger(
      input.resolved?.defaultMaxTokens,
      Math.min(256_000, contextWindowTokens),
    ),
  )
  const declaredModalities = input.resolved?.inputModalities ?? []
  const inputModalities: Array<'text' | 'image'> = ['text']
  if (declaredModalities.includes('image')) inputModalities.push('image')
  const route = `${input.provider}/${input.model}`
  return {
    schemaVersion: '1.0.0',
    profileId: `dsh-catalog-${safeIdentifier(route)}-${sha256(route).slice(0, 12)}`,
    revision: brand<number, 'Revision'>(1),
    status: 'VALIDATED',
    provider: input.provider,
    model: input.model,
    // DSH owns route-specific effort translation. Military keeps its compact
    // low/high/max vocabulary so every live adapter route remains selectable.
    supportedReasoning: ['off', 'low', 'high', 'max'],
    contextWindowTokens,
    maxOutputTokens,
    toolCalling: true,
    inputModalities,
    reasoningPassback: 'all-reasoning-turns',
    dataResidencyPolicyRefs: ['dsh-provider-default@1'],
    benchmarks: [],
    validatedAt: brand<string, 'IsoDateTime'>(
      input.registeredAt ?? new Date().toISOString(),
    ),
  }
}

/**
 * Ensure a live DSH route has a durable Military runtime capability record.
 * Existing built-in profiles keep their immutable history; previously unseen
 * third-party routes receive a catalog-derived profile exactly once.
 */
export async function ensureDshCatalogModelCapability(input: {
  readonly ctx: Context
  readonly policies: SqliteMilitaryPolicyRegistry
  readonly provider: string
  readonly model: string
  readonly signal?: AbortSignal
  readonly resolved?: ResolvedModelInfo
}): Promise<ModelCapabilityProfile> {
  try {
    return await input.policies.modelCapability(input.provider, input.model)
  } catch {
    // Absence is resolved below from the live DSH adapter. Do not treat the
    // lack of a Military benchmark/profile as model unavailability.
  }
  input.signal?.throwIfAborted()
  const resolved = input.resolved ?? await resolveModelInfo(
    input.ctx,
    input.provider,
    input.model,
    input.signal,
  )
  const profile = inferDshCatalogModelCapability({
    provider: input.provider,
    model: input.model,
    ...(resolved === undefined ? {} : { resolved }),
  })
  try {
    input.policies.registerModel(profile)
  } catch {
    // Concurrent catalog snapshots may race to register the same immutable
    // revision. Re-read the durable registry and accept only the exact route.
  }
  const registered = await input.policies.modelCapability(
    input.provider,
    input.model,
  )
  if (
    registered.provider !== input.provider
    || registered.model !== input.model
  ) {
    throw new TypeError(
      `Military model capability route drifted for ${input.provider}/${input.model}`,
    )
  }
  return registered
}

/** Stable comparison used by tests and future profile revision migration. */
export function modelCapabilityExecutionFingerprint(
  profile: ModelCapabilityProfile,
): string {
  return sha256(stableJson({
    provider: profile.provider,
    model: profile.model,
    supportedReasoning: profile.supportedReasoning,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens: profile.maxOutputTokens,
    toolCalling: profile.toolCalling,
    inputModalities: profile.inputModalities,
  }))
}

async function resolveModelInfo(
  ctx: Context,
  provider: string,
  model: string,
  signal?: AbortSignal,
): Promise<ResolvedModelInfo | undefined> {
  try {
    return await ctx.llm.resolveModelInfo(provider, model, signal)
  } catch {
    return undefined
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback
}

function safeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/gu, '-').slice(0, 96)
}
