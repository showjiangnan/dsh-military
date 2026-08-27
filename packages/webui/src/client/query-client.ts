import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'

const inFlight = new Map<string, Promise<unknown>>()
const connectionIds = new WeakMap<object, number>()
let nextConnectionId = 1
const DEFAULT_TIMEOUT_MS = 12_000
const INVALIDATION_CHANNEL = 'dsh-military-query-v1'
const invalidationListeners = new Set<(scope: string) => void>()
let invalidationBridgeInitialized = false
let invalidationChannel: BroadcastChannel | undefined

export interface MilitaryQueryState<T> {
  readonly data: T | undefined
  readonly error: Error | undefined
  readonly loading: boolean
  readonly stale: boolean
  readonly offline: boolean
  readonly refresh: () => Promise<void>
}

export interface MilitaryRefreshLoopInput {
  readonly key: string
  /**
   * Return false when the projection could not be refreshed. The loop then
   * backs off while the feature keeps its last successful local state.
   */
  readonly refresh: (signal: AbortSignal) => Promise<boolean | void>
  readonly intervalMs?: number
  readonly enabled?: boolean
  readonly paused?: () => boolean
}

/**
 * One RPC boundary for every Military browser projection: request dedupe,
 * bounded timeout and caller abort. Mutations pass `dedupe: false`.
 */
export async function callMilitaryRpc<T>(
  connection: Pick<ConnectionHandle, 'rpc'>,
  service: string,
  method: string,
  args: Record<string, unknown>,
  options?: {
    readonly signal?: AbortSignal | undefined
    readonly timeoutMs?: number
    readonly dedupe?: boolean
    readonly key?: string
  },
): Promise<T> {
  if (options?.signal?.aborted === true) {
    throw abortReason(options.signal)
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('浏览器当前离线；Military 保留最后一次权威快照。')
  }
  const requestKey = options?.key
    ?? `${service}/${method}:${stableBrowserJson(args)}`
  const key = `${connectionIdentity(connection)}:${requestKey}`
  let request = options?.dedupe === false ? undefined : inFlight.get(key)
  if (request === undefined) {
    request = performRpc<T>(
      connection,
      service,
      method,
      args,
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    if (options?.dedupe !== false) {
      inFlight.set(key, request)
      void request.finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key)
      }).catch(() => undefined)
    }
  }
  if (options?.dedupe === false) {
    void request.then(
      () => {
        publishMilitaryQueryInvalidation(service)
      },
      () => undefined,
    )
  }
  return await withCallerAbort(request as Promise<T>, options?.signal)
}

/**
 * Notify this tab and other DSH tabs that a mutation committed. Only a
 * non-sensitive service scope and random nonce cross the browser boundary.
 */
export function publishMilitaryQueryInvalidation(scope = '*'): void {
  initializeInvalidationBridge()
  for (const listener of invalidationListeners) listener(scope)
  const message = {
    scope,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }
  invalidationChannel?.postMessage(message)
  try {
    globalThis.localStorage?.setItem(
      INVALIDATION_CHANNEL,
      JSON.stringify(message),
    )
  } catch {
    // Storage may be disabled. BroadcastChannel/local listeners still work.
  }
}

export function subscribeMilitaryQueryInvalidation(
  listener: (scope: string) => void,
): () => void {
  initializeInvalidationBridge()
  invalidationListeners.add(listener)
  return () => {
    invalidationListeners.delete(listener)
  }
}

/**
 * Visibility-aware polling that preserves the last successful value. Revision
 * regressions are discarded, and failures back off exponentially.
 */
export function useMilitaryQuery<T>(input: {
  readonly key: string
  readonly load: (signal: AbortSignal) => Promise<T>
  readonly revision: (value: T) => number
  readonly intervalMs?: number
  readonly enabled?: boolean
}): MilitaryQueryState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  )
  const revisionRef = useRef(-1)
  const failureRef = useRef(0)
  const activeRef = useRef<AbortController>()

  useEffect(() => {
    activeRef.current?.abort()
    revisionRef.current = -1
    failureRef.current = 0
    setData(undefined)
    setError(undefined)
    setLoading(true)
    setStale(false)
  }, [input.key])

  const refresh = useCallback(async (): Promise<void> => {
    if (input.enabled === false) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOffline(true)
      setStale(true)
      return
    }
    activeRef.current?.abort()
    const controller = new AbortController()
    activeRef.current = controller
    try {
      const next = await input.load(controller.signal)
      if (controller.signal.aborted) return
      const revision = input.revision(next)
      if (revision > revisionRef.current) {
        revisionRef.current = revision
        setData(next)
      }
      failureRef.current = 0
      setError(undefined)
      setStale(false)
      setOffline(false)
    } catch (cause) {
      if (controller.signal.aborted) return
      failureRef.current += 1
      setError(cause instanceof Error ? cause : new Error(String(cause)))
      setStale(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [input.enabled, input.key, input.load, input.revision])

  useEffect(() => {
    if (input.enabled === false) {
      setLoading(false)
      return undefined
    }
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    let disposed = false
    const schedule = (): void => {
      if (disposed) return
      const base = input.intervalMs ?? 5_000
      const backoff = Math.min(6, failureRef.current)
      timer = globalThis.setTimeout(() => {
        if (
          typeof document === 'undefined'
          || document.visibilityState === 'visible'
        ) {
          void refresh().finally(schedule)
        } else {
          schedule()
        }
      }, Math.min(60_000, base * 2 ** backoff))
    }
    const onVisibility = (): void => {
      if (
        typeof document === 'undefined'
        || document.visibilityState === 'visible'
      ) void refresh()
    }
    const onOnline = (): void => {
      setOffline(false)
      void refresh()
    }
    const onOffline = (): void => {
      setOffline(true)
      setStale(true)
    }
    void refresh().finally(schedule)
    const unsubscribeInvalidation = subscribeMilitaryQueryInvalidation(() => {
      if (
        typeof document === 'undefined'
        || document.visibilityState === 'visible'
      ) void refresh()
    })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    globalThis.addEventListener?.('online', onOnline)
    globalThis.addEventListener?.('offline', onOffline)
    return () => {
      disposed = true
      activeRef.current?.abort()
      if (timer !== undefined) globalThis.clearTimeout(timer)
      unsubscribeInvalidation()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      globalThis.removeEventListener?.('online', onOnline)
      globalThis.removeEventListener?.('offline', onOffline)
    }
  }, [input.enabled, input.intervalMs, input.key, refresh])

  return { data, error, loading, stale, offline, refresh }
}

/**
 * Shared scheduler for feature slices that own local selection/draft state.
 * It gives those slices the same cancellation, visibility, offline and
 * exponential-backoff semantics as useMilitaryQuery without letting polling
 * replace a dirty draft or a user-selected historical report.
 */
export function useMilitaryRefreshLoop(
  input: MilitaryRefreshLoopInput,
): () => Promise<void> {
  const failures = useRef(0)
  const active = useRef<AbortController>()

  const refreshNow = useCallback(async (): Promise<void> => {
    if (input.enabled === false || input.paused?.() === true) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      failures.current += 1
      return
    }
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    try {
      const succeeded = await input.refresh(controller.signal)
      if (controller.signal.aborted) return
      failures.current = succeeded === false ? failures.current + 1 : 0
    } catch {
      if (!controller.signal.aborted) failures.current += 1
    }
  }, [input.enabled, input.key, input.paused, input.refresh])

  useEffect(() => {
    if (input.enabled === false) return undefined
    let disposed = false
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    const visible = (): boolean =>
      typeof document === 'undefined'
      || document.visibilityState === 'visible'
    const schedule = (): void => {
      if (disposed) return
      const base = input.intervalMs ?? 10_000
      const delay = Math.min(60_000, base * 2 ** Math.min(6, failures.current))
      timer = globalThis.setTimeout(() => {
        if (!visible() || input.paused?.() === true) {
          schedule()
          return
        }
        void refreshNow().finally(schedule)
      }, delay)
    }
    const wake = (): void => {
      if (visible()) void refreshNow()
    }
    void refreshNow().finally(schedule)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', wake)
    }
    globalThis.addEventListener?.('online', wake)
    const unsubscribeInvalidation = subscribeMilitaryQueryInvalidation(() => {
      wake()
    })
    return () => {
      disposed = true
      active.current?.abort()
      if (timer !== undefined) globalThis.clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', wake)
      }
      globalThis.removeEventListener?.('online', wake)
      unsubscribeInvalidation()
    }
  }, [
    input.enabled,
    input.intervalMs,
    input.key,
    input.paused,
    refreshNow,
  ])

  return refreshNow
}

function initializeInvalidationBridge(): void {
  if (invalidationBridgeInitialized) return
  invalidationBridgeInitialized = true
  if (typeof BroadcastChannel !== 'undefined') {
    invalidationChannel = new BroadcastChannel(INVALIDATION_CHANNEL)
    ;(invalidationChannel as unknown as { unref?: () => void }).unref?.()
    invalidationChannel.addEventListener('message', event => {
      const value = event.data as { readonly scope?: unknown }
      if (typeof value?.scope !== 'string') return
      for (const listener of invalidationListeners) listener(value.scope)
    })
  }
  globalThis.addEventListener?.('storage', event => {
    if (
      !('key' in event)
      || event.key !== INVALIDATION_CHANNEL
      || typeof event.newValue !== 'string'
    ) return
    try {
      const value = JSON.parse(event.newValue) as { readonly scope?: unknown }
      if (typeof value.scope !== 'string') return
      for (const listener of invalidationListeners) listener(value.scope)
    } catch {
      // Invalid storage events are ignored without affecting projections.
    }
  })
}

async function performRpc<T>(
  connection: Pick<ConnectionHandle, 'rpc'>,
  service: string,
  method: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => {
    controller.abort(new Error(`Military RPC ${service}/${method} 超过 ${timeoutMs}ms`))
  }, timeoutMs)
  try {
    const response = await connection.rpc.call(
      '/api',
      `${service}/${method}`,
      { args },
      controller.signal,
    )
    if (!response.ok) throw new Error(response.error.message)
    return response.value as T
  } finally {
    globalThis.clearTimeout(timer)
  }
}

async function withCallerAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return await promise
  if (signal.aborted) throw abortReason(signal)
  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function stableBrowserJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableBrowserJson(item)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableBrowserJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function connectionIdentity(connection: object): number {
  const existing = connectionIds.get(connection)
  if (existing !== undefined) return existing
  const created = nextConnectionId
  nextConnectionId += 1
  connectionIds.set(connection, created)
  return created
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason
    ?? new DOMException('Military query caller aborted', 'AbortError')
}
