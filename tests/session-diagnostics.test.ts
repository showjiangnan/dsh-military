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
  localSingleUserWebPrincipal,
  MilitaryOperationsRemoteService,
  redactDiagnosticText,
  redactToolArguments,
  type MilitaryHostRuntime,
} from '@dsh-military/plugin-host'
import { LocalEd25519AssetSigner } from '@dsh-military/infrastructure'
import {
  SqliteMilitaryDatabase,
  createSqliteProductionPlane,
} from '@dsh-military/storage-sqlite'
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
    const missionForCancellation = 'mission-explicit-cancellation'
    const cancellationCalls: unknown[] = []
    const forgottenChildren: string[] = []
    let abortAfterMissionCommit: (() => void) | undefined
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
    const missionActor = identity('general')
    database.transaction(() => {
      database.db.prepare(`
        INSERT INTO mission_streams(
          tenant_id, mission_id, aggregate_revision, last_seq, status,
          created_at, updated_at
        ) VALUES (?, ?, 1, 1, 'ACTIVE', ?, ?)
      `).run(
        'tenant-recovery',
        missionForCancellation,
        stamp(),
        stamp(),
      )
      database.db.prepare(`
        INSERT INTO mission_events(
          tenant_id, mission_id, seq, aggregate_revision, event_id,
          event_type, schema_version, actor_json, payload_json,
          occurred_at, event_hash
        ) VALUES (?, ?, 1, 1, ?, 'mission/started', '2.0.0', ?, ?, ?, ?)
      `).run(
        'tenant-recovery',
        missionForCancellation,
        'event-mission-started-cancellation',
        JSON.stringify(missionActor),
        JSON.stringify({
          title: '显式取消回归 Mission',
          rootSessionId: String(missionActor.sessionId),
          authorityContextRef: 'authority-fixture',
        }),
        stamp(),
        'a'.repeat(64),
      )
      const executionBinding = {
        schemaVersion: '1.0.0',
        bindingId: 'binding-cancel-child',
        tenantId: 'tenant-recovery',
        missionId: missionForCancellation,
        rootSessionId: String(missionActor.sessionId),
        agent: {
          ...identity('worker'),
          sessionId: 'session-cancel-child',
        },
        templateId: 'worker-default',
        templateRevision: 1,
        presetGeneration: currentGeneration,
        provider: 'provider-fixture',
        model: 'model-fixture',
        reasoningEffort: 'low',
        capabilityGrantId: 'grant-cancel-child',
        concurrencyReservationId: 'capacity-cancel-child',
        toolProfile: { id: 'worker-tools', revision: 1 },
        permissionProfile: { id: 'worker-permission', revision: 1 },
        resourceBudgetPolicy: { id: 'budget-default', revision: 1 },
        createdAt: stamp(),
      }
      database.db.prepare(`
        INSERT INTO agent_execution_bindings(
          tenant_id, binding_id, root_session_id, mission_id, agent_id,
          agent_generation, template_id, template_revision,
          preset_generation, provider, model, reasoning_effort,
          binding_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        'tenant-recovery',
        executionBinding.bindingId,
        executionBinding.rootSessionId,
        executionBinding.missionId,
        executionBinding.agent.agentId,
        executionBinding.templateId,
        executionBinding.presetGeneration,
        executionBinding.provider,
        executionBinding.model,
        executionBinding.reasoningEffort,
        JSON.stringify(executionBinding),
        executionBinding.createdAt,
      )
    })
    const host = {
      tenantId: 'tenant-recovery',
      webPrincipal: localSingleUserWebPrincipal('tenant-recovery'),
      database,
      config: {
        dataRoot: temporary.path,
        databasePath: `${temporary.path}/military.sqlite`,
      },
      isMilitaryAgent() {
        return false
      },
      async forgetDepartmentChild(childSessionId: string) {
        forgottenChildren.push(childSessionId)
      },
      application: {
        production: createSqliteProductionPlane({
          database,
          databasePath: `${temporary.path}/military.sqlite`,
          dataRoot: temporary.path,
          tenantId: 'tenant-recovery',
          signer: new LocalEd25519AssetSigner(
            `${temporary.path}/signing-keys`,
          ),
        }),
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
        ledger: {
          async readMission() {
            const row = database.db.prepare(`
              SELECT aggregate_revision FROM mission_streams
              WHERE tenant_id = ? AND mission_id = ?
            `).get(
              'tenant-recovery',
              missionForCancellation,
            ) as { readonly aggregate_revision: number }
            return {
              missionId: brand<string, 'MissionId'>(missionForCancellation),
              revision: brand<number, 'Revision'>(row.aggregate_revision),
              events: [],
            }
          },
        },
        missionKernel: {
          async execute(command: unknown, operation: () => Promise<unknown>) {
            return {
              receipt: { command },
              value: await operation(),
            }
          },
        },
        runtime: {
          async cancelMission(input: unknown) {
            cancellationCalls.push(input)
            database.transaction(() => {
              database.db.prepare(`
                INSERT INTO mission_events(
                  tenant_id, mission_id, seq, aggregate_revision, event_id,
                  event_type, schema_version, actor_json, payload_json,
                  occurred_at, event_hash
                ) VALUES (?, ?, 2, 2, ?, 'mission/cancelled', '2.0.0',
                  ?, ?, ?, ?)
              `).run(
                'tenant-recovery',
                missionForCancellation,
                'event-mission-cancelled-fixture',
                JSON.stringify((input as { actor: unknown }).actor),
                JSON.stringify({
                  reason: (input as { reason: string }).reason,
                  cancellationReceiptRef: (input as {
                    cancellationReceiptRef: string
                  }).cancellationReceiptRef,
                }),
                stamp(),
                'b'.repeat(64),
              )
              database.db.prepare(`
                UPDATE mission_streams
                SET aggregate_revision = 2, last_seq = 2, updated_at = ?
                WHERE tenant_id = ? AND mission_id = ?
              `).run(stamp(), 'tenant-recovery', missionForCancellation)
            })
            abortAfterMissionCommit?.()
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
    assert.match(presetHealth?.summary ?? '', /0\.9\.0-alpha\.28/u)
    assert.ok(presetHealth?.details.includes('运行 Bundle 0.9.0-alpha.28'))
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
    ) as {
      readonly confirmationPhrase: string
      readonly scope: string
      readonly previewHash: string
    }
    assert.equal(preview.scope, 'tenant:tenant-recovery')
    await assert.rejects(
      service.execute({
        type: 'EXECUTE_RECOVERY',
        operation: 'VERIFY_DATABASE',
        operationId: 'verify-fixture-1',
        previewHash: preview.previewHash,
        confirmation: 'wrong phrase',
      }, AbortSignal.timeout(5_000)),
      /确认短语不匹配/u,
    )
    const executed = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'VERIFY_DATABASE',
      operationId: 'verify-fixture-1',
      previewHash: preview.previewHash,
      confirmation: preview.confirmationPhrase,
    }, AbortSignal.timeout(5_000))
    const duplicate = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'VERIFY_DATABASE',
      operationId: 'verify-fixture-1',
      previewHash: preview.previewHash,
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

    const stalePreview = await service.execute({
      type: 'PREVIEW_RECOVERY',
      operation: 'VERIFY_DATABASE',
      operationId: 'verify-stale-fixture',
    }, AbortSignal.timeout(5_000)) as {
      readonly previewHash: string
      readonly confirmationPhrase: string
    }
    database.db.prepare(`
      INSERT INTO durable_state_records(
        tenant_id, namespace, record_key, storage_revision, value_json,
        updated_at
      ) VALUES (?, ?, ?, 1, '{}', ?)
    `).run(
      'tenant-recovery',
      'external-authoritative-drift',
      'fixture',
      new Date().toISOString(),
    )
    await assert.rejects(
      service.execute({
        type: 'EXECUTE_RECOVERY',
        operation: 'VERIFY_DATABASE',
        operationId: 'verify-stale-fixture',
        previewHash: stalePreview.previewHash,
        confirmation: stalePreview.confirmationPhrase,
      }, AbortSignal.timeout(5_000)),
      /权威状态已变化/u,
    )

    const backupPreview = await service.execute({
      type: 'PREVIEW_RECOVERY',
      operation: 'CREATE_BACKUP',
      operationId: 'backup-fixture-1',
    }, AbortSignal.timeout(5_000)) as {
      readonly confirmationPhrase: string
      readonly previewHash: string
    }
    const backup = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'CREATE_BACKUP',
      operationId: 'backup-fixture-1',
      previewHash: backupPreview.previewHash,
      confirmation: backupPreview.confirmationPhrase,
    }, AbortSignal.timeout(5_000)) as {
      readonly status: string
      readonly evidence: readonly string[]
    }
    assert.equal(backup.status, 'COMPLETED')
    assert.ok(backup.evidence.some(value => /^backup-sha256:[a-f0-9]{64}$/u.test(value)))
    assert.ok(backup.evidence.includes('sqlite-integrity:ok'))
    const backupFiles = await readdir(`${temporary.path}/backups`)
    assert.equal(
      backupFiles.filter(value => value.endsWith('.sqlite')).length,
      1,
    )
    assert.equal(
      backupFiles.filter(value =>
        value.endsWith('.manifest.json')).length,
      1,
    )

    const cancelPreview = await service.execute({
      type: 'PREVIEW_RECOVERY',
      operation: 'CANCEL_MISSION',
      operationId: 'cancel-mission-fixture-1',
      scope: missionForCancellation,
      reason: '用户确认该测试 Mission 不再继续执行',
    }, AbortSignal.timeout(5_000)) as {
      readonly confirmationPhrase: string
      readonly previewHash: string
      readonly risk: string
      readonly reason: string
      readonly changes: readonly string[]
    }
    assert.equal(cancelPreview.risk, 'HIGH')
    assert.equal(cancelPreview.reason, '用户确认该测试 Mission 不再继续执行')
    assert.ok(cancelPreview.changes.some(value =>
      value.includes('1 个已绑定 Activation')))
    const cancellationController = new AbortController()
    abortAfterMissionCommit = () => {
      cancellationController.abort(new Error('browser disconnected after commit'))
    }
    const cancellation = await service.execute({
      type: 'EXECUTE_RECOVERY',
      operation: 'CANCEL_MISSION',
      operationId: 'cancel-mission-fixture-1',
      scope: missionForCancellation,
      previewHash: cancelPreview.previewHash,
      confirmation: cancelPreview.confirmationPhrase,
    }, cancellationController.signal) as {
      readonly status: string
      readonly evidence: readonly string[]
    }
    assert.equal(cancellation.status, 'COMPLETED')
    assert.equal(cancellationCalls.length, 1)
    assert.deepEqual(forgottenChildren, ['session-cancel-child'])
    assert.ok(cancellation.evidence.some(value =>
      value.startsWith('mission-cancellation-receipt:')))
    const afterCancellation = await service.snapshot(
      AbortSignal.timeout(5_000),
    )
    assert.equal(
      afterCancellation.missions.find(value =>
        value.missionId === missionForCancellation)?.state,
      'CANCELLED',
    )

    restartedContext = new Context()
    const restarted = new MilitaryOperationsRemoteService(restartedContext, host)
    assert.deepEqual(
      await restarted.execute({
        type: 'EXECUTE_RECOVERY',
        operation: 'CREATE_BACKUP',
        operationId: 'backup-fixture-1',
        previewHash: backupPreview.previewHash,
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
