import {
  MilitaryError,
  type ModelCapabilityProfile,
} from '@dsh-military/contracts'

export interface ModelInputRequirement {
  readonly modalities: readonly ('text' | 'image')[]
  readonly totalImageBytes?: number
}

/** Enforce model-declared modalities and image byte policy before model I/O. */
export function assertModelInputCapability(
  profile: ModelCapabilityProfile,
  requirement: ModelInputRequirement,
): void {
  for (const modality of requirement.modalities) {
    if (!profile.inputModalities.includes(modality)) {
      throw new MilitaryError(
        'AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED',
        `model ${profile.provider}/${profile.model} does not support ${modality} input`,
      )
    }
  }
  const bytes = requirement.totalImageBytes ?? 0
  if (bytes < 0 || !Number.isSafeInteger(bytes)) {
    throw new MilitaryError('INVALID_ARGUMENT', 'totalImageBytes must be a non-negative safe integer')
  }
  if (bytes > 0) {
    if (!profile.inputModalities.includes('image')) {
      throw new MilitaryError('AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED', 'image input requires an image-capable model')
    }
    const limit = profile.maximumRequestImageBytes
    if (limit !== undefined && bytes > limit) {
      throw new MilitaryError(
        'AGENT_TEMPLATE_CAPABILITY_UNSUPPORTED',
        `image payload ${bytes} exceeds the model profile limit ${limit}`,
      )
    }
  }
}

/**
 * Estimate dynamic context reserves for RC.2. Reasoning from every reasoned
 * Assistant turn may be passed back, while images consume an independent
 * request-body/model-input budget. Callers should replace estimates with
 * observed usage after every request.
 */
export function rc2ContextReserves(input: {
  readonly previousReasoningTokens: number
  readonly expectedReasoningGrowthTokens?: number
  readonly imageTokenEstimate?: number
}): { readonly reasoningPassbackReserve: number; readonly imageReserve: number } {
  const values = [
    input.previousReasoningTokens,
    input.expectedReasoningGrowthTokens ?? 0,
    input.imageTokenEstimate ?? 0,
  ]
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new MilitaryError('INVALID_ARGUMENT', 'context reserve estimates must be non-negative safe integers')
  }
  return Object.freeze({
    reasoningPassbackReserve: input.previousReasoningTokens + (input.expectedReasoningGrowthTokens ?? 0),
    imageReserve: input.imageTokenEstimate ?? 0,
  })
}
