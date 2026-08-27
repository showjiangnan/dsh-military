import {
  brand,
  type BundleLifecycleReceipt,
  type MilitaryBundleLifecycle,
} from '@dsh-military/contracts'
import { cloneFrozen, now, uuid, type Clock } from '@dsh-military/core'

export interface BundleProfileOperator {
  revision(): Promise<string>
  install(signal: AbortSignal): Promise<{ readonly revision: string; readonly presetGenerations: readonly string[]; readonly validationReportRef: string }>
  upgrade(targetVersion: string, signal: AbortSignal): Promise<{ readonly revision: string; readonly presetGenerations: readonly string[]; readonly validationReportRef: string }>
  rollback(targetVersion: string, signal: AbortSignal): Promise<{ readonly revision: string; readonly presetGenerations: readonly string[]; readonly validationReportRef: string }>
  uninstall(disposition: 'RETAINED' | 'EXPORTED_AND_REMOVED' | 'REMOVED', signal: AbortSignal): Promise<{ readonly revision: string; readonly validationReportRef: string }>
}

export class BundleLifecycleRuntime implements MilitaryBundleLifecycle {
  readonly #operator: BundleProfileOperator
  readonly #clock: Clock
  readonly #version: string
  constructor(operator: BundleProfileOperator, version = '0.9.0-alpha.25', clock?: Clock) { this.#operator = operator; this.#version = version; this.#clock = clock ?? (() => new Date()) }

  async install(signal: AbortSignal): Promise<BundleLifecycleReceipt> { return this.#run('INSTALL', 'none', this.#version, 'NOT_APPLICABLE', signal, async () => this.#operator.install(signal)) }
  async upgrade(targetVersion: string, signal: AbortSignal): Promise<BundleLifecycleReceipt> { return this.#run('UPGRADE', this.#version, targetVersion, 'NOT_APPLICABLE', signal, async () => this.#operator.upgrade(targetVersion, signal)) }
  async rollback(targetVersion: string, signal: AbortSignal): Promise<BundleLifecycleReceipt> { return this.#run('ROLLBACK', this.#version, targetVersion, 'NOT_APPLICABLE', signal, async () => this.#operator.rollback(targetVersion, signal)) }
  async uninstall(dataDisposition: 'RETAINED' | 'EXPORTED_AND_REMOVED' | 'REMOVED', signal: AbortSignal): Promise<BundleLifecycleReceipt> {
    return this.#run('UNINSTALL', this.#version, 'none', dataDisposition, signal, async () => {
      const result = await this.#operator.uninstall(dataDisposition, signal)
      return { ...result, presetGenerations: [] }
    })
  }

  async #run(
    operation: BundleLifecycleReceipt['operation'], fromVersion: string, toVersion: string,
    dataDisposition: BundleLifecycleReceipt['dataDisposition'], signal: AbortSignal,
    action: () => Promise<{ readonly revision: string; readonly presetGenerations: readonly string[]; readonly validationReportRef: string }>,
  ): Promise<BundleLifecycleReceipt> {
    const startedAt = now(this.#clock)
    const before = await this.#operator.revision()
    try {
      const value = await action()
      return cloneFrozen({ schemaVersion: '1.0.0', operationId: uuid('bundle-operation'), operation, fromVersion, toVersion,
        profileRevisionBefore: before, profileRevisionAfter: value.revision, presetGenerationRefs: value.presetGenerations,
        dataDisposition, validationReportRef: value.validationReportRef, status: 'SUCCEEDED', startedAt, completedAt: now(this.#clock) })
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw error
    }
  }
}
