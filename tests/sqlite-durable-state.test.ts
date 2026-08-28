import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brand,
  type CapabilityGrant,
  type CompactionAttempt,
  type MilitaryAuthorityContext,
  type ModelCapabilityProfile,
  type PerformanceEvaluationAppeal,
  type TacticalTag,
  type UserAuthorizationReceipt,
} from '@dsh-military/contracts'
import {
  GeneralRoutingService,
  InMemoryTacticalRegistry,
  OversightController,
  semver,
  tacticalId,
} from '@dsh-military/core'
import {
  defaultFlashModelRevision,
  defaultGeneralPolicy,
  defaultModelProfiles,
  defaultProModelRevision,
  defaultTemplateRevision,
  defaultTemplateUpgradePath,
  defaultTemplates,
} from '@dsh-military/plugin-host/defaults'
import {
  SqliteAgentTemplateRegistry,
  SqliteCapabilityGrantStore,
  SqliteCompactionAttempts,
  SqliteDecisionBroker,
  SqliteEvaluationAppeals,
  SqliteGeneralModelSelectionStore,
  SqliteMilitaryAuthorization,
  SqliteMilitaryBrainstorm,
  SqliteMilitaryDatabase,
  SqliteMilitaryPolicyRegistry,
  SqliteMilitaryRadio,
  SqliteMilitaryResourceBudgets,
  SqliteOversightRecordStore,
  SqliteTacticalProcedureStore,
  SqliteTacticalTagRegistry,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import {
  budgetPolicy,
  decisionSet,
  identity,
  minimalTemplate,
  missionId,
  reservation,
  stamp,
  tacticalGuidance,
  tacticalRequest,
  usageReceipt,
} from './helpers.js'

test('all production governance and coordination providers survive SQLite restart', async () => {
  const temp = await temporaryDirectory('military-durable-state-')
  const path = `${temp.path}/military.sqlite`
  const tenantId = 'tenant-1'
  const worker = identity('worker')
  const advisor = identity('advisor')
  const root = brand<string, 'SessionId'>('durable-root')
  const mission = missionId('durable-mission')
  const future = brand<string, 'IsoDateTime'>(new Date(Date.now() + 5 * 60_000).toISOString())
  const capability: CapabilityGrant = {
    schemaVersion: '1.0.0',
    grantId: 'durable-grant',
    principalId: String(worker.agentId),
    activationId: 'activation-1',
    missionId: mission,
    taskId: brand<string, 'TaskId'>('task-1'),
    taskVersion: brand<number, 'TaskVersion'>(1),
    allowedTools: ['write'],
    resourcePatterns: ['src'],
    dataClassificationCeiling: 'confidential',
    maximumUses: 2,
    uses: 0,
    issuedAt: stamp(),
    expiresAt: future,
    nonce: 'nonce-1',
    state: 'ACTIVE',
  }
  const authority: MilitaryAuthorityContext = {
    schemaVersion: '1.0.0',
    authorityContextId: 'authority-1',
    principalId: 'principal-1',
    tenantId,
    roles: ['operator'],
    scopes: [],
    sessionOwnership: ['durable-root'],
    workspaceMemberships: ['/workspace'],
    dataClassificationCeiling: 'confidential',
    authorizationReceiptRefs: ['authorization-1'],
    issuedAt: stamp(),
    expiresAt: future,
  }
  const authorizationReceipt: UserAuthorizationReceipt = {
    schemaVersion: '1.0.0',
    authorizationId: 'authorization-1',
    principalId: authority.principalId,
    tenantId,
    action: 'workspace.write',
    resource: 'src/*',
    constraints: [],
    issuedAt: stamp(),
    expiresAt: future,
    revocable: true,
    sourceSessionId: 'durable-root',
    sourceMessageId: 'message-1',
    contentHash: brand<string, 'Sha256'>('a'.repeat(64)),
  }
  const tag: TacticalTag = {
    schemaVersion: '1.0.0',
    tagId: brand<string, 'TacticalTagId'>('durable-tag'),
    revision: brand<number, 'Revision'>(1),
    displayName: 'Durable',
    status: 'ACTIVE',
    aliases: [],
    matchTerms: ['durable'],
    parentTagIds: [],
    createdAt: stamp(),
    updatedAt: stamp(),
  }
  const appeal: PerformanceEvaluationAppeal = {
    schemaVersion: '1.0.0',
    appealId: 'appeal-1',
    reportId: 'report-1',
    reportRevision: brand<number, 'Revision'>(1),
    tenantId,
    submittedBy: authority.principalId,
    grounds: 'MISSING_CONTEXT',
    statement: 'The frozen report omitted tool-grounded context.',
    challengedFindings: [{
      path: 'findings[0]',
      reason: 'missing evidence',
      evidenceRefs: ['artifact:evidence-1'],
    }],
    requestedRemedy: 'ANNOTATE_REPORT',
    authorizationReceiptRef: authorizationReceipt.authorizationId,
    state: 'SUBMITTED',
    submittedAt: stamp(),
  }
  const compaction: CompactionAttempt = {
    schemaVersion: '1.0.0',
    attemptId: 'compaction-1',
    agent: worker,
    rootSessionId: String(root),
    pressureGeneration: 1,
    contextBudgetTokens: 10_000,
    thresholdTokens: 9_000,
    meterTokens: 9_100,
    trigger: 'PRESSURE',
    safeBoundary: {
      toolPairsBalanced: true,
      candidateTransactionIdle: true,
      gitTransactionIdle: true,
      freezeStateStable: true,
    },
    outcome: 'PENDING',
    createdAt: stamp(),
  }
  const request = tacticalRequest()
  const guidance = tacticalGuidance(request)
  const questions = decisionSet(String(root))
  const policy = budgetPolicy()
  const requestedBudget = reservation()
  const template = minimalTemplate()
  let orderId = brand<string, 'BrainstormOrderId'>('uninitialized')

  try {
    let database = new SqliteMilitaryDatabase({ path })
    const policies = new SqliteMilitaryPolicyRegistry(database, tenantId)
    const flash = defaultModelProfiles().find(profile =>
      profile.model === 'deepseek-v4-flash')!
    policies.registerModel({
      ...flash,
      revision: brand<number, 'Revision'>(1),
      status: 'DRAFT',
    })
    for (const profile of defaultModelProfiles()) policies.registerModel(profile)
    const routing = new GeneralRoutingService(defaultGeneralPolicy, policies, {
      selections: new SqliteGeneralModelSelectionStore(database, tenantId),
    })
    assert.equal((await routing.applyPresetDefault(root)).model, 'deepseek-v4-flash')
    await new SqliteAgentTemplateRegistry(database, tenantId).create(template)
    await new SqliteCapabilityGrantStore(database, tenantId).issue(capability)
    const budgets = new SqliteMilitaryResourceBudgets(database, tenantId)
    budgets.registerPolicy(policy)
    await budgets.reserve(requestedBudget)
    const authorization = new SqliteMilitaryAuthorization(database, tenantId)
    authorization.seedContext(authority)
    await authorization.grant(authorizationReceipt)
    await new SqliteTacticalTagRegistry(database, tenantId).create(tag)
    const tactics = new InMemoryTacticalRegistry(new SqliteTacticalProcedureStore(database, tenantId))
    tactics.publish({
      schemaVersion: '1.0.0',
      skillId: tacticalId('durable-tactic'),
      version: semver('0.1.0'),
      title: 'Durable tactic',
      lifecycle: 'DRAFT',
      scenarioTags: ['durable'],
      preconditions: [],
      exclusions: [],
      steps: [{ id: 'step-1', action: 'Persist this tactic.' }],
      stopConditions: [],
      verifierRequirements: [],
      provenanceRefs: ['artifact:tactic-source'],
      contentHash: 'tactic-hash',
    })
    new OversightController({
      records: new SqliteOversightRecordStore(database, tenantId),
    }).freeze({ agent: worker, reasonCodes: ['DURABLE_TEST'] })
    orderId = (await new SqliteMilitaryBrainstorm(database, tenantId).start(root, mission)).orderId
    const radio = new SqliteMilitaryRadio(database, tenantId)
    await radio.request(request)
    assert.equal((await radio.lease(advisor, new AbortController().signal))?.requestId, request.requestId)
    await radio.issue(guidance)
    const decisions = new SqliteDecisionBroker(database, tenantId)
    await decisions.submit(questions)
    assert.equal((await decisions.presentNext(root))?.state, 'PRESENTED')
    await new SqliteEvaluationAppeals(database, tenantId).submit(appeal)
    await new SqliteCompactionAttempts(database, tenantId).require(compaction)
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    // Application composition replays well-known bootstrap rows after every
    // restart; repeated registration must update a detached snapshot rather
    // than attempting to mutate the frozen repository read.
    new SqliteMilitaryResourceBudgets(database, tenantId).registerPolicy(policy)
    new SqliteMilitaryAuthorization(database, tenantId).seedContext(authority)
    assert.equal(
      (await new SqliteMilitaryPolicyRegistry(database, tenantId)
        .modelCapability('deepseek-official', 'deepseek-v4-pro')).profileId,
      'deepseek-v4-pro-rc2',
    )
    const reopenedPolicies = new SqliteMilitaryPolicyRegistry(database, tenantId)
    assert.equal(
      Number((await reopenedPolicies.modelCapability(
        'deepseek-official',
        'deepseek-v4-flash',
      )).revision),
      Number(defaultFlashModelRevision),
    )
    assert.equal(
      Number((await reopenedPolicies.modelCapability(
        'deepseek-official',
        'deepseek-v4-flash',
        1,
      )).revision),
      1,
    )
    const reopenedRouting = new GeneralRoutingService(
      defaultGeneralPolicy,
      reopenedPolicies,
      { selections: new SqliteGeneralModelSelectionStore(database, tenantId) },
    )
    assert.equal(reopenedRouting.current(root)?.model, 'deepseek-v4-flash')
    assert.equal((await reopenedRouting.validateUserSelection({
      sessionId: root,
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      selectedBy: 'durable-test',
    })).previousModel, 'deepseek-v4-flash')
    assert.equal(
      (await new SqliteAgentTemplateRegistry(database, tenantId).get(template.templateId)).displayName,
      template.displayName,
    )
    const grants = new SqliteCapabilityGrantStore(database, tenantId)
    assert.equal((await grants.consume(capability.grantId, {
      tool: 'write',
      resource: 'src/index.ts',
      at: stamp(),
    })).uses, 1)
    const reopenedBudgets = new SqliteMilitaryResourceBudgets(database, tenantId)
    assert.equal((await reopenedBudgets.getReservation(requestedBudget.reservationId)).state, 'RESERVED')
    await reopenedBudgets.settle(usageReceipt(requestedBudget))
    const reopenedAuthorization = new SqliteMilitaryAuthorization(database, tenantId)
    const resolvedAuthority = await reopenedAuthorization.resolve(authority.principalId, tenantId)
    assert.deepEqual(await reopenedAuthorization.authorize({
      context: resolvedAuthority,
      action: 'workspace.write',
      resource: 'src/index.ts',
      classification: 'confidential',
    }), { allowed: true, receiptRef: authorizationReceipt.authorizationId })
    const reopenedTags = new SqliteTacticalTagRegistry(database, tenantId)
    const renamed = await reopenedTags.rename(tag.tagId, 'Durable State', tag.revision)
    assert.equal(renamed.displayName, 'Durable State')
    assert.equal(
      new InMemoryTacticalRegistry(new SqliteTacticalProcedureStore(database, tenantId))
        .get(tacticalId('durable-tactic'), semver('0.1.0')).title,
      'Durable tactic',
    )
    const oversight = new OversightController({
      records: new SqliteOversightRecordStore(database, tenantId),
    })
    assert.throws(
      () => oversight.requireAdmission(worker),
      (error: unknown) => typeof error === 'object'
        && error !== null
        && 'failure' in error
        && (error as { failure?: { code?: string } }).failure?.code === 'POLICY_DENIED',
    )
    oversight.release(worker, 'correction-order:1')
    const reopenedBrainstorm = new SqliteMilitaryBrainstorm(database, tenantId)
    assert.equal((await reopenedBrainstorm.active(root))?.orderId, orderId)
    await assert.rejects(
      reopenedBrainstorm.start(root, mission),
      (error: unknown) => typeof error === 'object'
        && error !== null
        && 'failure' in error
        && (error as { failure?: { code?: string } }).failure?.code === 'BRAINSTORM_ALREADY_ACTIVE',
    )
    await reopenedBrainstorm.complete(orderId, 'specs-order:1')
    assert.equal(await reopenedBrainstorm.active(root), null)
    const reopenedRadio = new SqliteMilitaryRadio(database, tenantId)
    assert.equal((await reopenedRadio.guidance(String(guidance.guidanceId))).guidanceId, guidance.guidanceId)
    await reopenedRadio.acknowledge(String(guidance.guidanceId), worker)
    const reopenedDecisions = new SqliteDecisionBroker(database, tenantId)
    assert.equal((await reopenedDecisions.record(String(questions.decisionSetId))).state, 'PRESENTED')
    await reopenedDecisions.recordAnswers({
      rootSessionId: root,
      decisionSetId: String(questions.decisionSetId),
      answerReceiptRef: 'answer-receipt:1',
    })
    const reopenedAppeals = new SqliteEvaluationAppeals(database, tenantId)
    assert.equal((await reopenedAppeals.get(appeal.appealId)).state, 'SUBMITTED')
    await reopenedAppeals.resolve({
      appealId: appeal.appealId,
      expectedState: 'SUBMITTED',
      disposition: 'UPHELD',
      resolutionSummary: 'Missing context confirmed.',
      supersedingReportId: 'report-2',
    })
    const reopenedCompactions = new SqliteCompactionAttempts(database, tenantId)
    assert.equal((await reopenedCompactions.get(compaction.attemptId)).outcome, 'PENDING')
    await reopenedCompactions.complete({
      ...compaction,
      outcome: 'SUCCEEDED',
      dshCompactionId: 'dsh-compaction-1',
      completedAt: stamp(),
    })
    database.close()

    database = new SqliteMilitaryDatabase({ path })
    assert.equal((await new SqliteCapabilityGrantStore(database, tenantId).get(capability.grantId)).uses, 1)
    assert.equal(
      new GeneralRoutingService(
        defaultGeneralPolicy,
        new SqliteMilitaryPolicyRegistry(database, tenantId),
        { selections: new SqliteGeneralModelSelectionStore(database, tenantId) },
      ).current(root)?.model,
      'deepseek-v4-pro',
    )
    assert.equal(
      new OversightController({
        records: new SqliteOversightRecordStore(database, tenantId),
      }).record(worker)?.state,
      'RELEASED',
    )
    assert.equal(
      (await new SqliteMilitaryResourceBudgets(database, tenantId)
        .getReservation(requestedBudget.reservationId)).state,
      'SETTLED',
    )
    assert.equal((await new SqliteMilitaryResourceBudgets(database, tenantId)
      .usageForScope(requestedBudget.scopeType, requestedBudget.scopeId)).length, 1)
    assert.equal((await new SqliteTacticalTagRegistry(database, tenantId).get(tag.tagId)).displayName, 'Durable State')
    assert.equal((await new SqliteMilitaryBrainstorm(database, tenantId).state(orderId)), 'COMPLETED')
    assert.equal(
      (await new SqliteDecisionBroker(database, tenantId).record(String(questions.decisionSetId))).state,
      'ANSWERED',
    )
    assert.equal((await new SqliteEvaluationAppeals(database, tenantId).get(appeal.appealId)).state, 'UPHELD')
    assert.equal((await new SqliteCompactionAttempts(database, tenantId).get(compaction.attemptId)).outcome, 'SUCCEEDED')
    database.close()
  } finally {
    await temp.dispose()
  }
})

test('built-in model and template revisions upgrade without rewriting prior SQLite history', async () => {
  const temporary = await temporaryDirectory('military-policy-upgrade-')
  const database = new SqliteMilitaryDatabase({
    path: `${temporary.path}/military.sqlite`,
  })
  try {
    const tenantId = 'tenant-policy-upgrade'
    const policies = new SqliteMilitaryPolicyRegistry(database, tenantId)
    const currentModels = defaultModelProfiles()
    const currentPro = currentModels.find(profile =>
      profile.model === 'deepseek-v4-pro')
    const currentFlash = currentModels.find(profile =>
      profile.model === 'deepseek-v4-flash')
    assert.ok(currentPro)
    assert.ok(currentFlash)

    const legacyPro = legacyModelProfile(currentPro, 1)
    const legacyFlash = legacyModelProfile(currentFlash, 3)
    policies.registerModel(legacyPro)
    policies.registerModel(legacyFlash)
    for (const profile of currentModels) policies.registerModel(profile)
    for (const profile of currentModels) policies.registerModel(profile)

    assert.equal(
      Number((await policies.modelCapability(
        currentPro.provider,
        currentPro.model,
      )).revision),
      Number(defaultProModelRevision),
    )
    assert.equal(
      Number((await policies.modelCapability(
        currentFlash.provider,
        currentFlash.model,
      )).revision),
      Number(defaultFlashModelRevision),
    )
    assert.deepEqual(
      await policies.modelCapability(
        legacyPro.provider,
        legacyPro.model,
        legacyPro.revision,
      ),
      legacyPro,
    )
    assert.deepEqual(
      await policies.modelCapability(
        legacyFlash.provider,
        legacyFlash.model,
        legacyFlash.revision,
      ),
      legacyFlash,
    )

    const templates = new SqliteAgentTemplateRegistry(database, tenantId)
    const currentTemplate = defaultTemplates().find(template =>
      String(template.templateId) === 'worker-default')
    assert.ok(currentTemplate)
    const {
      modelCapabilityProfileRevision: _currentModelRevision,
      ...legacyModelPolicy
    } = currentTemplate.modelPolicy
    assert.equal(
      Number(_currentModelRevision),
      Number(defaultFlashModelRevision),
    )
    const legacyTemplate = {
      ...currentTemplate,
      revision: brand<number, 'Revision'>(6),
      modelPolicy: legacyModelPolicy,
      capabilities: {
        ...currentTemplate.capabilities,
        toolProfileRevision: brand<number, 'Revision'>(6),
      },
    }
    await templates.create(legacyTemplate)
    let expectedRevision = legacyTemplate.revision
    const upgradePath = defaultTemplateUpgradePath(
      currentTemplate,
      legacyTemplate.revision,
    )
    assert.deepEqual(
      upgradePath.map(profile => Number(profile.revision)),
      [7, Number(defaultTemplateRevision)],
    )
    assert.equal(
      Number(upgradePath[0]?.modelPolicy.modelCapabilityProfileRevision),
      Number(legacyFlash.revision),
    )
    const customizedLegacy = {
      ...legacyTemplate,
      rolePromptOverride: '用户自定义：读取证据后再提出建议，禁止扩大工具权限。',
      modelPolicy: {
        ...legacyTemplate.modelPolicy,
        provider: 'third-party-provider',
        model: 'economy-model',
        reasoningEffort: 'max' as const,
        maxOutputTokens: 24_576,
        modelCapabilityProfileId: 'third-party-economy-v1',
        modelCapabilityProfileRevision: brand<number, 'Revision'>(1),
        allowCanaryModel: false,
      },
      contextPolicy: {
        ...legacyTemplate.contextPolicy,
        contextBudgetTokens: 72_000,
      },
      concurrencyLimit: 3,
    }
    const customizedPath = defaultTemplateUpgradePath(
      currentTemplate,
      customizedLegacy.revision,
      customizedLegacy,
    )
    assert.deepEqual(
      customizedPath.map(profile => Number(profile.revision)),
      [7, Number(defaultTemplateRevision)],
    )
    const customizedCurrent = customizedPath.at(-1)
    assert.equal(customizedCurrent?.modelPolicy.provider, 'third-party-provider')
    assert.equal(customizedCurrent?.modelPolicy.model, 'economy-model')
    assert.equal(customizedCurrent?.modelPolicy.reasoningEffort, 'max')
    assert.equal(customizedCurrent?.modelPolicy.maxOutputTokens, 24_576)
    assert.equal(
      customizedCurrent?.modelPolicy.modelCapabilityProfileId,
      'third-party-economy-v1',
    )
    assert.equal(customizedCurrent?.contextPolicy.contextBudgetTokens, 72_000)
    assert.equal(customizedCurrent?.concurrencyLimit, 3)
    assert.equal(
      Number(customizedCurrent?.capabilities.toolProfileRevision),
      Number(currentTemplate.capabilities.toolProfileRevision),
      'package-owned tool authority must upgrade even when user fields are replayed',
    )
    for (const profile of upgradePath) {
      await templates.revise(profile, expectedRevision)
      expectedRevision = profile.revision
    }
    assert.equal(
      Number((await templates.get(currentTemplate.templateId)).revision),
      Number(currentTemplate.revision),
    )
    assert.equal(
      Number((await templates.get(
        currentTemplate.templateId,
        legacyTemplate.revision,
      )).capabilities.toolProfileRevision),
      6,
    )
    assert.deepEqual(defaultTemplateUpgradePath(
      currentTemplate,
      currentTemplate.revision,
    ), [])
  } finally {
    database.close()
    await temporary.dispose()
  }
})

function legacyModelProfile(
  profile: ModelCapabilityProfile,
  revision: number,
): ModelCapabilityProfile {
  return {
    schemaVersion: profile.schemaVersion,
    profileId: profile.profileId,
    revision: brand<number, 'Revision'>(revision),
    status: profile.status,
    provider: profile.provider,
    model: profile.model,
    supportedReasoning: profile.supportedReasoning,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens: profile.maxOutputTokens,
    toolCalling: profile.toolCalling,
    inputModalities: profile.inputModalities,
    reasoningPassback: profile.reasoningPassback,
    ...(profile.maximumRequestImageBytes === undefined
      ? {}
      : { maximumRequestImageBytes: profile.maximumRequestImageBytes }),
    ...(profile.vision === undefined ? {} : { vision: profile.vision }),
    dataResidencyPolicyRefs: profile.dataResidencyPolicyRefs,
    benchmarks: profile.benchmarks,
    ...(profile.validatedAt === undefined
      ? {}
      : { validatedAt: profile.validatedAt }),
  }
}
