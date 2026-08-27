/**
 * Small, stable error contract shared by model-facing tools and Host admission
 * hooks.  Flash-class models recover much more reliably from one deterministic
 * instruction than from a free-form exception string.
 */
export interface ToolCorrectionShape {
  readonly tool: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
  readonly optional: readonly string[]
}

export interface ToolErrorEnvelopeInput {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly nextTool: string
  readonly correctedShape: ToolCorrectionShape
  readonly recovery: string
  readonly details?: unknown
}

export interface ToolErrorEnvelope {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly retryable: boolean
    readonly nextTool: string
    readonly correctedShape: ToolCorrectionShape
    readonly recovery: string
    readonly details?: unknown
  }
}

/**
 * Produce the only Military tool-failure wire shape.  The serializer also
 * bounds and redacts diagnostic details: model correction never needs a host
 * absolute path or a credential.
 */
export function serializeToolErrorEnvelope(
  input: ToolErrorEnvelopeInput,
): string {
  return JSON.stringify(toolErrorEnvelope(input))
}

export function toolErrorEnvelope(
  input: ToolErrorEnvelopeInput,
): ToolErrorEnvelope {
  return {
    error: {
      code: input.code,
      message: redactToolErrorText(input.message),
      retryable: input.retryable,
      nextTool: boundedIdentifier(input.nextTool),
      correctedShape: {
        tool: boundedIdentifier(input.correctedShape.tool),
        arguments: redactToolErrorValue(
          input.correctedShape.arguments,
        ) as Readonly<Record<string, unknown>>,
        required: input.correctedShape.required
          .slice(0, MAX_SCHEMA_FIELDS)
          .map(boundedIdentifier),
        optional: input.correctedShape.optional
          .slice(0, MAX_SCHEMA_FIELDS)
          .map(boundedIdentifier),
      },
      recovery: redactToolErrorText(input.recovery),
      ...(input.details === undefined
        ? {}
        : { details: redactToolErrorValue(input.details) }),
    },
  }
}

/** A deterministic no-argument correction for Host-only wait/stop actions. */
export function toolCorrectionShape(
  tool: string,
  args: Readonly<Record<string, unknown>> = {},
  required: readonly string[] = [],
  optional: readonly string[] = [],
): ToolCorrectionShape {
  return {
    tool,
    arguments: args,
    required: [...required],
    optional: [...optional],
  }
}

export function redactToolErrorValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '＜redacted＞'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS)
      .map(item => redactToolErrorValue(item))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([childKey, child]) => [
          childKey,
          redactToolErrorValue(child, childKey),
        ]),
    )
  }
  if (typeof value === 'string') return redactToolErrorText(value)
  return value
}

export function redactToolErrorText(value: string): string {
  return value
    .slice(0, MAX_TEXT_LENGTH)
    .replace(BEARER, 'Bearer ＜redacted＞')
    .replace(ABSOLUTE_PATH, '$1＜host-path-redacted＞')
    .replace(PLAIN_SECRET, '$1=＜redacted＞')
    .replace(
      /("(?:authorization|cookie|credential|password|secret|token|api[-_]?key)"\s*:\s*")[^"]*/giu,
      '$1＜redacted＞',
    )
}

const MAX_TEXT_LENGTH = 2_000
const MAX_ARRAY_ITEMS = 24
const MAX_OBJECT_KEYS = 32
const MAX_SCHEMA_FIELDS = 32
const SECRET_KEY = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/iu
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu
const PLAIN_SECRET = /\b(authorization|cookie|credential|password|secret|token|api[-_]?key)\s*=\s*[^\s,;"']+/giu
const ABSOLUTE_PATH = /(^|[\s"'(])(?:\/(?:[^/\s"',)]+\/)+[^\s"',)]*|[A-Za-z]:\\[^\s"',)]+)/gu

function boundedIdentifier(value: string): string {
  return redactToolErrorText(value).slice(0, 160)
}
