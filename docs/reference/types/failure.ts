import {
  militaryErrorMetadata,
  type MilitaryErrorCode,
  type MilitaryFailure,
} from './generated-error-catalog.js'

export class MilitaryError extends Error {
  readonly failure: MilitaryFailure

  constructor(code: MilitaryErrorCode, message?: string, details?: Readonly<Record<string, unknown>>, options?: ErrorOptions) {
    const metadata = militaryErrorMetadata[code]
    super(message ?? metadata.summary, options)
    this.name = 'MilitaryError'
    this.failure = Object.freeze({
      code,
      message: this.message,
      retryable: metadata.defaultRetryable,
      ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
    })
  }
}

export function fail(
  code: MilitaryErrorCode,
  message?: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new MilitaryError(code, message, details)
}

export function asMilitaryFailure(error: unknown): MilitaryFailure {
  if (error instanceof MilitaryError) return error.failure
  if (error instanceof Error) {
    return Object.freeze({
      code: 'PERSISTENCE_FAILED',
      message: error.message,
      retryable: true,
      details: { errorName: error.name },
    })
  }
  return Object.freeze({
    code: 'PERSISTENCE_FAILED',
    message: 'Unknown non-Error failure',
    retryable: true,
  })
}
