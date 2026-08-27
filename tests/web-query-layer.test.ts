import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  callMilitaryRpc,
  subscribeMilitaryQueryInvalidation,
} from '../packages/webui/src/client/query-client.js'

test('Military RPC query boundary deduplicates stable reads but never deduplicates mutations', async () => {
  const invalidations: string[] = []
  const unsubscribe = subscribeMilitaryQueryInvalidation(scope => {
    invalidations.push(scope)
  })
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const connection = stubConnection(async () => {
    calls += 1
    await gate
    return { ok: true, value: { revision: 7 } }
  })
  const left = callMilitaryRpc<{ revision: number }>(
    connection,
    'militaryRuntime',
    'snapshot',
    { filter: 'active', order: 'asc' },
  )
  const right = callMilitaryRpc<{ revision: number }>(
    connection,
    'militaryRuntime',
    'snapshot',
    { order: 'asc', filter: 'active' },
  )
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await Promise.all([left, right]), [
    { revision: 7 },
    { revision: 7 },
  ])

  const secondConnection = stubConnection(async () => {
    calls += 1
    return { ok: true, value: { revision: 8 } }
  })
  assert.deepEqual(
    await callMilitaryRpc<{ revision: number }>(
      secondConnection,
      'militaryRuntime',
      'snapshot',
      { order: 'asc', filter: 'active' },
    ),
    { revision: 8 },
    'dedupe keys must not reuse a response from another DSH connection',
  )

  await Promise.all([
    callMilitaryRpc(
      connection,
      'militaryRuntime',
      'execute',
      { action: { type: 'PAUSE' } },
      { dedupe: false },
    ),
    callMilitaryRpc(
      connection,
      'militaryRuntime',
      'execute',
      { action: { type: 'PAUSE' } },
      { dedupe: false },
    ),
  ])
  assert.equal(calls, 4)
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.deepEqual(invalidations, ['militaryRuntime', 'militaryRuntime'])
  unsubscribe()
})

test('caller abort does not cancel a shared read and RPC timeout aborts the provider request', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let providerAborted = false
  let providerCalls = 0
  const connection = stubConnection(async (_channel, endpoint, _payload, signal) => {
    providerCalls += 1
    if (endpoint.endsWith('/timeout')) {
      return await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          providerAborted = true
          reject(signal.reason)
        }, { once: true })
      })
    }
    await gate
    return { ok: true, value: 'durable-value' }
  })
  const caller = new AbortController()
  const aborted = callMilitaryRpc<string>(
    connection,
    'militaryRuntime',
    'snapshot',
    {},
    { signal: caller.signal, key: 'shared-abort-fixture' },
  )
  const survivor = callMilitaryRpc<string>(
    connection,
    'militaryRuntime',
    'snapshot',
    {},
    { key: 'shared-abort-fixture' },
  )
  caller.abort(new Error('caller navigated away'))
  await assert.rejects(aborted, /caller navigated away/u)
  release()
  assert.equal(await survivor, 'durable-value')
  assert.equal(providerCalls, 1)

  const alreadyAborted = new AbortController()
  alreadyAborted.abort(new Error('caller was already gone'))
  await assert.rejects(
    callMilitaryRpc(
      connection,
      'militaryRuntime',
      'execute',
      { action: { type: 'MUTATE' } },
      { signal: alreadyAborted.signal, dedupe: false },
    ),
    /caller was already gone/u,
  )
  assert.equal(
    providerCalls,
    1,
    'an already-aborted mutation must never reach the RPC provider',
  )

  await assert.rejects(
    callMilitaryRpc(
      connection,
      'militaryRuntime',
      'timeout',
      {},
      { timeoutMs: 5, dedupe: false },
    ),
    /超过 5ms/u,
  )
  assert.equal(providerAborted, true)
  assert.equal(providerCalls, 2)
})

test('every Military feature slice uses the shared query boundary and no raw interval polling', async () => {
  const slices = [
    'benchmark-center.tsx',
    'evaluation-center.tsx',
    'knowledge-center.tsx',
    'operations-center.tsx',
    'role-workbench.tsx',
    'runtime-center.tsx',
    'workspace-center.tsx',
  ]
  for (const file of slices) {
    const source = await readFile(
      `packages/webui/src/client/${file}`,
      'utf8',
    )
    assert.match(
      source,
      /callMilitaryRpc/u,
      `${file} must use the shared RPC boundary`,
    )
    assert.doesNotMatch(
      source,
      /\.rpc\.call\(/u,
      `${file} must not bypass callMilitaryRpc`,
    )
    assert.doesNotMatch(
      source,
      /setInterval\(/u,
      `${file} must not own a raw polling interval`,
    )
    assert.match(
      source,
      /useMilitary(?:Query|RefreshLoop)/u,
      `${file} must use the visibility/offline/backoff scheduler`,
    )
  }
  const query = await readFile(
    'packages/webui/src/client/query-client.ts',
    'utf8',
  )
  assert.match(query, /document\.visibilityState/u)
  assert.match(query, /navigator\.onLine/u)
  assert.match(query, /2 \*\* Math\.min\(6, failures\.current\)/u)
  assert.match(query, /active\.current\?\.abort\(\)/u)
  assert.match(query, /BroadcastChannel/u)
  assert.match(query, /subscribeMilitaryQueryInvalidation/u)
  assert.match(query, /revision > revisionRef\.current/u)
  assert.match(query, /revisionRef\.current = -1/u)
  assert.match(query, /connectionIdentity\(connection\)/u)
})

type RpcCall = ConnectionHandle['rpc']['call']

function stubConnection(
  call: (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>,
): Pick<ConnectionHandle, 'rpc'> {
  return {
    rpc: {
      call: call as RpcCall,
    },
  } as Pick<ConnectionHandle, 'rpc'>
}
