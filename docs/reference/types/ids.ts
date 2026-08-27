import type { Brand, IsoDateTime, Revision, TaskVersion } from './domain.js'

export function brand<T, Name extends string>(value: T): Brand<T, Name> {
  return value as Brand<T, Name>
}

let idSequence = 0

export function newId<Name extends string>(prefix: string): Brand<string, Name> {
  idSequence += 1
  return brand<string, Name>(`${prefix}-${Date.now()}-${idSequence}`)
}

export function isoNow(clock: () => Date = () => new Date()): IsoDateTime {
  return brand<string, 'IsoDateTime'>(clock().toISOString())
}

export function revision(value: number): Revision {
  assertPositiveSafeInteger(value, 'revision')
  return brand<number, 'Revision'>(value)
}

export function taskVersion(value: number): TaskVersion {
  assertPositiveSafeInteger(value, 'taskVersion')
  return brand<number, 'TaskVersion'>(value)
}

export function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`)
  }
}

export function assertNonEmpty(value: string, field: string, maxLength = 4000): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  if (value.length > maxLength) {
    throw new TypeError(`${field} exceeds ${maxLength} characters`)
  }
}
