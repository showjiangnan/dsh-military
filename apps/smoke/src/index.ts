import { join } from 'node:path'
import { ExactRc2Compatibility } from '@dsh-military/core'
import { memoryFixture } from '@dsh-military/testkit'

const fixture = await memoryFixture()
try {
  const compatibility = new ExactRc2Compatibility(async () => ({
    observedRelease: '0.1.1-rc.2',
    agentPresets: true, composeFrom: true, exactGenerationAccessible: false,
    userQuestions: true, delegatedChildQuestions: false,
    presetCompaction: true, compactionEventContract: 'rc2', continuableSubagents: true, subagentReport: true,
    callerReservedChildId: true, reportDeliveries: ['quiet', 'next-step'] as const,
    selectiveDirectChildDrain: true, commandAttachments: true, commandImageAdmission: true,
    reasoningPassbackAllReasonedTurns: true, imageInputByModelCapability: true,
    sessionPersistence: true, externalRequiredSessionEventRegistration: false, militaryAuthorityUsesOwnLedger: true,
    settingsCards: true, conversationNodes: false,
    sharedSettingsDescribeMirror: true, manifestDeclaredExternals: true,
  }))
  const report = await compatibility.probe(new AbortController().signal)
  console.log(JSON.stringify({ ok: report.disposition === 'READY', root: fixture.root, artifactRoot: join(fixture.root, 'artifacts'), report }, null, 2))
} finally { await fixture.dispose() }
