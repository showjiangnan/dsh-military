import {
  MilitaryError,
  type CompatibilityReport,
  type MilitaryCompatibility,
} from '@dsh-military/contracts'
import { cloneFrozen, now, uuid, type Clock } from './util.js'

export const DSH_RC2_RELEASE = '0.1.1-rc.2'
export const DSH_RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

/** Exact RC.2 capability facts observed at startup. */
export interface Rc2CapabilityProbe {
  readonly observedRelease: string
  readonly agentPresets: boolean
  readonly composeFrom: boolean
  readonly exactGenerationAccessible: boolean
  readonly userQuestions: boolean
  readonly delegatedChildQuestions: boolean
  /** The fixed Military Preset composes its own isolated compaction backend. */
  readonly presetCompaction: boolean
  readonly compactionEventContract: string
  readonly continuableSubagents: boolean
  readonly subagentReport: boolean
  readonly callerReservedChildId: boolean
  readonly reportDeliveries: readonly ('quiet' | 'next-step')[]
  readonly selectiveDirectChildDrain: boolean
  readonly commandAttachments: boolean
  readonly commandImageAdmission: boolean
  readonly reasoningPassbackAllReasonedTurns: boolean
  readonly imageInputByModelCapability: boolean
  readonly sessionPersistence: boolean
  readonly externalRequiredSessionEventRegistration: boolean
  readonly militaryAuthorityUsesOwnLedger: boolean
  readonly settingsCards: boolean
  readonly conversationNodes: boolean
  readonly sharedSettingsDescribeMirror: boolean
  readonly manifestDeclaredExternals: boolean
}

export class ExactRc2Compatibility implements MilitaryCompatibility {
  #last: CompatibilityReport | null = null
  readonly #probe: () => Promise<Rc2CapabilityProbe>
  readonly #clock: Clock

  constructor(probe: () => Promise<Rc2CapabilityProbe>, clock?: Clock) {
    this.#probe = probe
    this.#clock = clock ?? (() => new Date())
  }

  async probe(signal: AbortSignal): Promise<CompatibilityReport> {
    if (signal.aborted) throw signal.reason
    const value = await this.#probe()
    const blockers: string[] = []
    const warnings: string[] = []
    if (value.observedRelease !== DSH_RC2_RELEASE) {
      blockers.push(`DSH runtime release ${value.observedRelease} is not ${DSH_RC2_RELEASE}`)
    }
    if (!value.agentPresets) blockers.push('agent presets unavailable')
    if (!value.composeFrom) blockers.push('AgentPresets.composeFrom unavailable')
    if (!value.userQuestions) blockers.push('user questions unavailable')
    if (!value.presetCompaction) blockers.push('preset-scoped compaction unavailable')
    if (!value.continuableSubagents) blockers.push('continuable subagents unavailable')
    if (!value.subagentReport) blockers.push('subagent reporting unavailable')
    if (!value.callerReservedChildId) blockers.push('caller-reserved continuable child id unavailable')
    if (!value.reportDeliveries.includes('quiet') || !value.reportDeliveries.includes('next-step')) {
      blockers.push('RC.2 report delivery contract unavailable')
    }
    if (!value.selectiveDirectChildDrain) blockers.push('selective direct-child drain unavailable')
    if (!value.commandAttachments || !value.commandImageAdmission) blockers.push('attachment-aware command invocation unavailable')
    if (!value.reasoningPassbackAllReasonedTurns) blockers.push('DeepSeek RC.2 reasoning passback contract unavailable')
    if (!value.imageInputByModelCapability) blockers.push('DeepSeek RC.2 image capability routing unavailable')
    if (!value.sessionPersistence) blockers.push('session persistence unavailable')
    if (value.externalRequiredSessionEventRegistration) warnings.push('unexpected external required Session event registration is available; Military still uses its own ledger')
    if (!value.militaryAuthorityUsesOwnLedger) blockers.push('Military authority is not isolated in its own ledger')
    if (!value.settingsCards) warnings.push('settings cards unavailable')
    if (!value.conversationNodes) warnings.push('conversation nodes unavailable')
    if (!value.sharedSettingsDescribeMirror) warnings.push('shared settings describe mirror unavailable')
    if (!value.manifestDeclaredExternals) warnings.push('RC.2 client manifest external validation unavailable')
    if (!value.exactGenerationAccessible) {
      warnings.push('archived-only root preset generations require quarantine and explicit migration')
    }
    if (value.delegatedChildQuestions) warnings.push('unexpected RC.2 behavior: delegated child questions allowed')
    const disposition: CompatibilityReport['disposition'] = blockers.length > 0
      ? 'UNSUPPORTED'
      : 'READY'
    const report: CompatibilityReport = {
      schemaVersion: '1.0.0',
      reportId: uuid('compat'),
      dsh: { release: DSH_RC2_RELEASE, commit: DSH_RC2_COMMIT },
      capabilities: {
        agentPresets: { available: value.agentPresets, composeFrom: value.composeFrom, exactGenerationAccessible: value.exactGenerationAccessible },
        userQuestions: { available: value.userQuestions, delegatedChildAllowed: value.delegatedChildQuestions },
        compaction: { available: value.presetCompaction, eventContract: value.compactionEventContract },
        subagents: {
          continuable: value.continuableSubagents,
          report: value.subagentReport,
          callerReservedChildId: value.callerReservedChildId,
          reportDeliveries: [...value.reportDeliveries],
          selectiveDirectChildDrain: value.selectiveDirectChildDrain,
        },
        commands: { attachmentAwareInvocation: value.commandAttachments, imageAdmissionBeforeHandler: value.commandImageAdmission },
        deepseekAdapter: {
          reasoningPassbackAllReasonedTurns: value.reasoningPassbackAllReasonedTurns,
          imageInputByModelCapability: value.imageInputByModelCapability,
        },
        sessionPersistence: { available: value.sessionPersistence },
        sessionEvents: {
          externalRequiredTypeRegistration: value.externalRequiredSessionEventRegistration,
          militaryAuthorityUsesOwnLedger: value.militaryAuthorityUsesOwnLedger,
        },
        settingsCards: { available: value.settingsCards },
        conversationNodes: { available: value.conversationNodes },
        webClient: {
          sharedSettingsDescribeMirror: value.sharedSettingsDescribeMirror,
          manifestDeclaredExternals: value.manifestDeclaredExternals,
          conversationNodes: value.conversationNodes,
        },
      },
      disposition,
      blockers,
      warnings,
      generatedAt: now(this.#clock),
    }
    this.#last = cloneFrozen(report)
    return cloneFrozen(report)
  }

  async lastReport(): Promise<CompatibilityReport | null> { return this.#last === null ? null : cloneFrozen(this.#last) }

  async requireReady(): Promise<CompatibilityReport> {
    if (this.#last === null) throw new MilitaryError('POLICY_DENIED', 'compatibility probe has not run')
    if (this.#last.disposition !== 'READY') throw new MilitaryError('POLICY_DENIED', `compatibility disposition is ${this.#last.disposition}`, { blockers: this.#last.blockers })
    return cloneFrozen(this.#last)
  }
}
