import { createHash, randomUUID } from 'node:crypto'
import { MilitaryError, type IsoDateTime, type Revision, brand } from '@dsh-military/contracts'

export type Clock = () => Date

export const systemClock: Clock = () => new Date()

export function now(clock: Clock = systemClock): IsoDateTime {
  return brand<string, 'IsoDateTime'>(clock().toISOString())
}

export function uuid(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) result[key] = sortJson(source[key])
  return result
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  return value
}

export function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

export function assertRevision(actual: number, expected: Revision | number | undefined): void {
  if (expected !== undefined && actual !== Number(expected)) {
    throw new MilitaryError('REVISION_CONFLICT', `expected revision ${Number(expected)}, current revision is ${actual}`, {
      expectedRevision: Number(expected),
      actualRevision: actual,
    })
  }
}

export function assertDateOrder(from: string, to: string): void {
  const fromTime = Date.parse(from)
  const toTime = Date.parse(to)
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime) {
    throw new MilitaryError('INVALID_ARGUMENT', 'invalid or reversed date range', { from, to })
  }
}

export function isExpired(iso: string | undefined, clock: Clock = systemClock): boolean {
  return iso !== undefined && Date.parse(iso) <= clock().getTime()
}

export function asRevision(value: number): Revision {
  return brand<number, 'Revision'>(value)
}
