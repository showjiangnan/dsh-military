import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import {
  detectRoleBudgetPreset,
  ROLE_BUDGET_PRESETS,
} from '@dsh-military/contracts/control-plane'
import {
  applyRoleDraft,
  defaultTemplates,
  defaultToolProfiles,
  effectiveRolePrompt,
  initialRoleWorkbenchDocument,
  recordRoleRevisionUse,
  ROLE_REVISION_SESSION_ANCHOR_NAMESPACE,
  ROLE_REVISION_USE_NAMESPACE,
  serializeRoleWorkbenchDocument,
  type MilitaryHostRuntime,
} from '@dsh-military/plugin-host'
import {
  SqliteMilitaryDatabase,
  SqliteStateRecords,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity } from './helpers.js'

test('role revision usage remains pinned to the configuration active when a Session was bound', async () => {
  const temporary = await temporaryDirectory('military-role-revision-usage-')
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const templates = defaultTemplates()
    const initial = initialRoleWorkbenchDocument({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      maxOutputTokens: 16_384,
      generalPromptOverride: '',
    }, templates)
    const worker = initial.roles.find(value => value.roleId === 'worker-default')!
    const tools = defaultToolProfiles().find(value =>
      String(value.toolProfileId) === worker.toolProfileId)!.allowTools.map(name => ({
      name,
      available: true,
      propertyCount: 2,
      requiredCount: 1,
      maximumDepth: 2,
      schemaBytes: 300,
      terminal: name === 'military_submit_candidate' || name === 'military_submit_blocker',
    }))
    const revisionOne = applyRoleDraft({
      document: initial,
      draft: {
        roleId: worker.roleId,
        provider: worker.provider,
        model: worker.model,
        reasoningEffort: worker.reasoningEffort,
        maxOutputTokens: 8_192,
        contextBudgetTokens: 64_000,
        concurrencyLimit: 2,
        prompt: `${effectiveRolePrompt(worker)}\n\n第一版：先读取，再写入。`,
      },
      source: 'USER_SAVE',
      toolSchemas: tools,
      modelStatus: 'CANARY',
      createdAt: '2026-08-26T01:00:00.000Z',
    })
    const current = revisionOne.roles.find(value => value.roleId === worker.roleId)!
    const revisionTwo = applyRoleDraft({
      document: revisionOne,
      draft: {
        roleId: worker.roleId,
        provider: worker.provider,
        model: worker.model,
        reasoningEffort: 'max',
        maxOutputTokens: 16_384,
        contextBudgetTokens: 128_000,
        concurrencyLimit: 4,
        prompt: `${effectiveRolePrompt(current)}\n\n第二版：核对验证回执。`,
      },
      source: 'USER_SAVE',
      toolSchemas: tools,
      modelStatus: 'CANARY',
      createdAt: '2026-08-26T03:00:00.000Z',
    })
    let persisted = revisionTwo
    const context = {
      settings: {
        describe() {
          return [{
            ns: 'military-role-workbench',
            value: { stateJson: serializeRoleWorkbenchDocument(persisted) },
          }]
        },
      },
    } as unknown as Context
    const host = {
      tenantId: 'tenant-role-revision',
      database,
    } as unknown as MilitaryHostRuntime
    const earlyIdentity = identity('worker', 'role-revision-early')
    const earlyBinding = {
      templateId: 'worker-default',
      rootSessionId: String(earlyIdentity.sessionId),
      bindingId: 'binding-early',
      createdAt: '2026-08-26T02:00:00.000Z',
    } as never
    const first = recordRoleRevisionUse({
      ctx: context,
      host,
      identity: earlyIdentity,
      binding: earlyBinding,
      turn: 1,
      step: 0,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    assert.equal(first.roleRevision, 1)
    assert.equal(first.workbenchRevision, revisionOne.revision)

    persisted = applyRoleDraft({
      document: revisionTwo,
      draft: {
        ...revisionTwo.roles.find(value => value.roleId === worker.roleId)!,
        prompt: effectiveRolePrompt(
          revisionTwo.roles.find(value => value.roleId === worker.roleId)!,
        ),
      },
      source: 'USER_SAVE',
      toolSchemas: tools,
      modelStatus: 'CANARY',
      createdAt: '2026-08-26T05:00:00.000Z',
    })
    const second = recordRoleRevisionUse({
      ctx: context,
      host,
      identity: earlyIdentity,
      binding: earlyBinding,
      turn: 1,
      step: 1,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    assert.equal(second.roleRevision, 1, 'a live Session must not drift with settings')
    assert.equal(second.configurationHash, first.configurationHash)

    const lateIdentity = identity('worker', 'role-revision-late')
    const late = recordRoleRevisionUse({
      ctx: context,
      host,
      identity: lateIdentity,
      binding: {
        templateId: 'worker-default',
        bindingId: 'binding-late',
        rootSessionId: String(lateIdentity.sessionId),
        createdAt: '2026-08-26T04:00:00.000Z',
      } as never,
      turn: 1,
      step: 0,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    assert.equal(late.roleRevision, 2)
    const state = new SqliteStateRecords(database, 'tenant-role-revision')
    assert.equal(state.listSync(ROLE_REVISION_SESSION_ANCHOR_NAMESPACE).length, 2)
    assert.equal(state.listSync(ROLE_REVISION_USE_NAMESPACE).length, 3)
    assert.equal(revisionTwo.history[0]?.readinessReport?.checkedAt, '2026-08-26T01:00:00.000Z')
  } finally {
    database.close()
    await temporary.dispose()
  }
})

test('budget presets are explicit and custom values cannot silently widen governance', () => {
  assert.deepEqual(ROLE_BUDGET_PRESETS.map(value => value.id), [
    'ECONOMY',
    'STANDARD',
    'DEEP',
  ])
  assert.equal(detectRoleBudgetPreset({
    maxOutputTokens: 8_192,
    contextBudgetTokens: 64_000,
    concurrencyLimit: 2,
  }), 'ECONOMY')
  assert.equal(detectRoleBudgetPreset({
    maxOutputTokens: 12_000,
    contextBudgetTokens: 64_000,
    concurrencyLimit: 2,
  }), 'CUSTOM')
  assert.ok(ROLE_BUDGET_PRESETS.every(value =>
    Object.keys(value).sort().join(',') === [
      'concurrencyLimit',
      'contextBudgetTokens',
      'description',
      'id',
      'label',
      'maxOutputTokens',
    ].join(',')))
})
