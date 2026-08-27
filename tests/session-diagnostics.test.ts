import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  brand,
  type MilitaryDiagnosticSession,
  type ObservedToolCallReceipt,
} from '@dsh-military/contracts'
import {
  buildDiagnosticReport,
  MilitaryOperationsRemoteService,
  redactDiagnosticText,
  redactToolArguments,
  type MilitaryHostRuntime,
} from '@dsh-military/plugin-host'
import { SqliteMilitaryDatabase } from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity, stamp } from './helpers.js'

const SESSION: MilitaryDiagnosticSession = {
  sessionId: 'session-diagnostic',
  rootSessionId: 'session-diagnostic',
  roleId: 'worker-default',
  displayName: '快速反应部队',
  templateRevision: 6,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'high',
  live: false,
  eventCount: 0,
  errorCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  startedAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.500Z',
}

test('Session diagnostics use immutable RC.2 events and redact raw selections on the Host', () => {
  const started = Date.parse('2026-08-26T00:00:00.000Z')
  const events = [
    event(0, started, 'turn/start', { turn: 1 }),
    event(1, started + 10, 'step/start', { turn: 1, step: 0 }),
    event(2, started + 20, 'request/header', {
      reason: 'initial',
      header: {
        config: {
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          maxTokens: 8_192,
        },
        tools: [
          { name: 'write', description: 'write', inputSchema: { type: 'object' } },
          {
            name: 'military_submit_candidate',
            description: 'terminal',
            inputSchema: { type: 'object' },
          },
        ],
      },
    }),
    event(3, started + 30, 'request/context', {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      contextWindow: 131_072,
    }),
    event(4, started + 40, 'tool/call', {
      turn: 1,
      step: 0,
      callId: 'call-write-1',
      name: 'write',
      arguments: JSON.stringify({
        path: '/Users/example/private/secret.ts',
        token: 'sk-sensitive',
        content: 'Bearer another-secret',
      }),
    }),
    event(5, started + 50, 'tool/result', toolResult(
      'call-write-1',
      '路径 /Users/example/private/secret.ts 不在 workspace；password=hidden',
      true,
      { name: 'MilitaryError', code: 'INVALID_ARGUMENT' },
    )),
    event(6, started + 60, 'tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-write-2',
      name: 'write',
      arguments: JSON.stringify({ path: 'src/safe.ts', content: 'export {}' }),
    }),
    event(7, started + 70, 'tool/result', toolResult(
      'call-write-2',
      '写入成功，receipt=write:2',
      false,
    )),
    event(8, started + 80, 'tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-terminal',
      name: 'military_submit_candidate',
      arguments: '{"summary":"完成"}',
    }),
    event(9, started + 90, 'tool/result', toolResult(
      'call-terminal',
      '候选提交成功',
      false,
    )),
    event(10, started + 100, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: '完成' }],
        source: {
          kind: 'model',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
        },
      },
      usage: {
        inputTokens: 100,
        cacheReadTokens: 20,
        outputTokens: 30,
        reasoningTokens: 5,
      },
    }),
    event(11, started + 110, 'user/message', {
      id: 'report-1',
      role: 'user',
      content: [{ type: 'text', text: '子 Agent 已完成' }],
      source: {
        kind: 'subagent-report',
        form: 'relay',
        senderSessionId: 'child-session',
      },
    }),
    event(12, started + 120, 'turn/end', {
      turn: 1,
      reason: { kind: 'completed' },
    }),
  ] as unknown as SessionEvent[]
  const receipts: ObservedToolCallReceipt[] = [
    receipt('call-write-1', 'write', true),
    receipt('call-write-2', 'write', false),
    receipt('call-terminal', 'military_submit_candidate', false),
  ]

  const report = buildDiagnosticReport({
    session: SESSION,
    events,
    binding: {
      capabilityGrantId: 'grant-worker-1',
    } as never,
    receipts,
  })

  assert.deepEqual(report.visibleTools, ['military_submit_candidate', 'write'])
  assert.deepEqual(report.summary, {
    toolCalls: 3,
    successfulToolCalls: 2,
    failedToolCalls: 1,
    correctedCalls: 1,
    terminalCalls: 1,
    parentWakeups: 1,
    inputTokens: 120,
    outputTokens: 30,
    estimatedCostStatus: 'PROVIDER_PRICING_UNAVAILABLE',
    latencyMs: 90,
  })
  const raw = report.events.find(value => value.callId === 'call-write-1')?.rawSelection?.arguments
  assert.ok(raw)
  assert.doesNotMatch(raw, /chenjing|sk-sensitive|another-secret/u)
  assert.match(raw, /＜绝对路径已脱敏＞/u)
  assert.match(raw, /＜已脱敏＞/u)
  const failed = report.events.find(value =>
    value.callId === 'call-write-1' && value.severity === 'ERROR')
  assert.equal(failed?.category, 'TOOL')
  assert.equal(failed?.hostCompletion?.capabilityGrantId, 'grant-worker-1')
  assert.equal(failed?.hostCompletion?.taskId, 'task-diagnostic')
  assert.equal(report.events.at(-1)?.title, 'Turn 1 完成')
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/chenjing|sk-sensitive|another-secret/u)
})

test('diagnostic redaction is bounded and protects malformed JSON, credentials and paths', () => {
  const source = `Authorization: Bearer abc.def; /tmp/private.txt; ${'x'.repeat(2_500)}`
  const redacted = redactToolArguments(source)
  assert.match(redacted, /Bearer ＜已脱敏＞/u)
  assert.match(redacted, /＜绝对路径已脱敏＞/u)
  assert.match(redacted, /Host 已截断/u)
  assert.doesNotMatch(redactDiagnosticText(
    '{"api_key":"private","cookie":"session"}',
  ), /private|session/u)
})

test('recovery RPC exposes previewed idempotent database verification and no raw mutation method', async () => {
  const temporary = await temporaryDirectory('military-recovery-center-')
  const context = new Context()
  let restartedContext: Context | undefined
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const currentGeneration = `military@sha256:${'a'.repeat(64)}`
    database.db.prepare(`
      INSERT INTO preset_generations(
        generation, public_preset_id, hidden_archive_id, asset_hash,
        bundle_version, dsh_commit, status, manifest_json, created_at
      ) VALUES (?, 'military', 'military-generation-aaaaaaaaaaaaaaaa', ?,
        '0.9.0-alpha.14', ?, 'CURRENT', '{}', ?)
    `).run(
      currentGeneration,
      'a'.repeat(64),
      'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      '2026-08-26T00:00:00.000Z',
    )
    const host = {
      tenantId: 'tenant-recovery',
      database,
      config: {
        dataRoot: temporary.path,
        databasePath: `${temporary.path}/military.sqlite`,
      },
      isMilitaryAgent() {
        return false
      },
      application: {
        presetGenerations: {
          async current() {
            return {
              generation: currentGeneration,
              bundleVersion: '0.9.0-alpha.14',
              status: 'CURRENT',
              dshBaseline: {
                release: '0.1.1-rc.2',
                commit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
              },
            }
          },
        },
      },
    } as unknown as MilitaryHostRuntime
    const service = new MilitaryOperationsRemoteService(context, host)
    assert.equal(service.typertRemote.serviceKey, 'militaryOperations')
    assert.deepEqual(remoteMethods(service), [
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'execute', invocation: { kind: 'direct' } },
    ])

    const snapshot = await service.snapshot(AbortSignal.timeout(5_000))
    assert.equal(snapshot.recovery.items.find(value => value.id === 'SQLITE')?.status, 'HEALTHY')
    const presetHealth = snapshot.recovery.items.find(value => value.id === 'PRESET')
    assert.equal(presetHealth?.status, 'HEALTHY')
    assert.match(presetHealth?.summary ?? '', /0\.9\.0-alpha\.24/u)
    assert.ok(presetHealth?.details.includes('运行 Bundle 0.9.0-alpha.24'))
    assert.ok(presetHealth?.details.some(value => value.includes('初始归档 0.9.0-alpha.14')))
    assert.equal(snapshot.recovery.databasePathLabel, 'military.sqlite')
    assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(escapeRegex(temporary.path), 'u'))

    const action = {
      type: 'PREVIEW_RECOVERY',
      operation: 'VERIFY_DATABASE',
      operationId: 'verify-fixture-1',
    }
    const preview = await service.execute(
      action,
      AbortSignal.timeout(5_000),
    ) as { readonly confirmationPhrase: string; readonly scope: string }
    assert.equal(preview.scope, 'tenant:tenant-recovery')
    await assert.rejects(
      service.execute({
        type: 'EXECUTE_RECOVERY',
        operation: 'VERIFY_DATABASE',
        operationId: 'verify-fixture-1',
        confirmation: 'wrong phrase',
      }, AbortSignal.timeout(5_000)),
      /确认短语不匹配/u,
    )
    const executed = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'VERIFY_DATABASE',
      operationId: 'verify-fixture-1',
      confirmation: preview.confirmationPhrase,
    }, AbortSignal.timeout(5_000))
    const duplicate = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'VERIFY_DATABASE',
      operationId: 'verify-fixture-1',
      confirmation: preview.confirmationPhrase,
    }, AbortSignal.timeout(5_000))
    assert.deepEqual(duplicate, executed)
    assert.deepEqual((executed as { readonly evidence: readonly string[] }).evidence, [
      'PRAGMA integrity_check = ok',
    ])
    const stored = database.db.prepare(`
      SELECT COUNT(*) AS count FROM durable_state_records
      WHERE namespace = 'military-recovery-operation'
    `).get() as { readonly count: number }
    assert.equal(
      stored.count,
      1,
    )

    const backupPreview = await service.execute({
      type: 'PREVIEW_RECOVERY',
      operation: 'CREATE_BACKUP',
      operationId: 'backup-fixture-1',
    }, AbortSignal.timeout(5_000)) as { readonly confirmationPhrase: string }
    const backup = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'CREATE_BACKUP',
      operationId: 'backup-fixture-1',
      confirmation: backupPreview.confirmationPhrase,
    }, AbortSignal.timeout(5_000)) as {
      readonly status: string
      readonly evidence: readonly string[]
    }
    assert.equal(backup.status, 'COMPLETED')
    assert.ok(backup.evidence.some(value => /^backup-sha256:[a-f0-9]{64}$/u.test(value)))
    assert.ok(backup.evidence.includes('backup-integrity-check:ok'))
    assert.deepEqual(await readdir(`${temporary.path}/backups`), [
      'military-backup-fixture-1.sqlite',
    ])

    restartedContext = new Context()
    const restarted = new MilitaryOperationsRemoteService(restartedContext, host)
    assert.deepEqual(
      await restarted.execute({
        type: 'EXECUTE_RECOVERY',
        operation: 'CREATE_BACKUP',
        operationId: 'backup-fixture-1',
        confirmation: backupPreview.confirmationPhrase,
      }, AbortSignal.timeout(5_000)),
      backup,
      'a fresh Host service must replay the durable receipt without duplicating the backup',
    )
  } finally {
    database.close()
    await restartedContext?.fiber.dispose()
    await context.fiber.dispose()
    await temporary.dispose()
  }
})

function event(
  seq: number,
  time: number,
  type: string,
  data: unknown,
): unknown {
  return { seq, time, type, data }
}

function toolResult(
  callId: string,
  text: string,
  isError: boolean,
  error?: { readonly name: string; readonly code: string },
): unknown {
  return {
    turn: 1,
    step: 0,
    message: {
      id: `result-${callId}`,
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
      }],
      source: { kind: 'tool', callId },
    },
    ...(error === undefined ? {} : { error }),
  }
}

function receipt(
  callId: string,
  toolName: string,
  isError: boolean,
): ObservedToolCallReceipt {
  return {
    schemaVersion: '1.0.0',
    callId,
    rootCallId: callId,
    agent: identity('worker'),
    bindingId: 'binding-worker-1',
    missionId: 'mission-diagnostic',
    taskId: 'task-diagnostic',
    taskVersion: 2,
    toolName,
    argumentsHash: brand<string, 'Sha256'>('a'.repeat(64)),
    outcomeHash: brand<string, 'Sha256'>('b'.repeat(64)),
    isError,
    observedAt: stamp(),
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
