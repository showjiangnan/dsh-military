import type { Context } from '@deepseek-ai/cordis'
import type {
  AgentIdentity,
  MilitaryTelemetry,
} from '@dsh-military/contracts'
import type { MilitaryOrchestrator } from '@dsh-military/core'
import type {
  SqliteDecisionBroker,
  SqliteMilitaryRadio,
  SqliteOutboxDispatcher,
} from '@dsh-military/storage-sqlite'

export interface CoordinationMaintenanceResult {
  readonly outbox: {
    readonly delivered: number
    readonly failed: number
    readonly deadLettered: number
    readonly remaining: number
  }
  readonly guidanceDeadLetters: number
  readonly expiredDecisions: number
  readonly expiredActivations: number
}

/**
 * Owns the recoverable coordination loop independently from application
 * composition. Every pass is idempotent, never overlaps another pass in the
 * same Host, and delegates cross-provider effects to the transactional outbox.
 */
export class MilitaryCoordinationMaintenance {
  readonly #tenantId: string
  readonly #outbox: Pick<SqliteOutboxDispatcher, 'dispatchAvailable'>
  readonly #radio: Pick<SqliteMilitaryRadio, 'reconcileDeadLetters'>
  readonly #decisions: Pick<SqliteDecisionBroker, 'reconcileExpired'>
  readonly #runtime: Pick<
    MilitaryOrchestrator,
    'deadLetterGuidanceWait' | 'expireDecisionWait'
  >
  readonly #lifecycle: Pick<
    import('@dsh-military/contracts').MilitaryExecutionLifecycle,
    'reconcileExpiredActivations'
  >
  readonly #telemetry: MilitaryTelemetry
  readonly #coordinator: AgentIdentity
  #flight: Promise<CoordinationMaintenanceResult> | null = null
  #timer: ReturnType<typeof setInterval> | null = null

  constructor(input: {
    readonly tenantId: string
    readonly outbox: Pick<SqliteOutboxDispatcher, 'dispatchAvailable'>
    readonly radio: Pick<SqliteMilitaryRadio, 'reconcileDeadLetters'>
    readonly decisions: Pick<SqliteDecisionBroker, 'reconcileExpired'>
    readonly runtime: Pick<
      MilitaryOrchestrator,
      'deadLetterGuidanceWait' | 'expireDecisionWait'
    >
    readonly lifecycle: Pick<
      import('@dsh-military/contracts').MilitaryExecutionLifecycle,
      'reconcileExpiredActivations'
    >
    readonly telemetry: MilitaryTelemetry
    readonly coordinator: AgentIdentity
  }) {
    this.#tenantId = input.tenantId
    this.#outbox = input.outbox
    this.#radio = input.radio
    this.#decisions = input.decisions
    this.#runtime = input.runtime
    this.#lifecycle = input.lifecycle
    this.#telemetry = input.telemetry
    this.#coordinator = input.coordinator
  }

  /**
   * Coalesce concurrent callers onto the exact same maintenance pass. This
   * keeps timer ticks, startup recovery and an operator-triggered pass from
   * leasing the same coordination records concurrently.
   */
  runOnce(): Promise<CoordinationMaintenanceResult> {
    const current = this.#flight
    if (current !== null) return current
    const flight = this.#run()
      .finally(() => {
        if (this.#flight === flight) this.#flight = null
      })
    this.#flight = flight
    return flight
  }

  /**
   * Start one Cordis-owned timer after a successful startup reconciliation.
   * The returned disposer is also registered with the Context.
   */
  start(
    ctx: Pick<Context, 'effect' | 'logger'>,
    intervalMs = 1_000,
  ): () => void {
    if (this.#timer !== null) {
      throw new Error('coordination maintenance is already started')
    }
    const timer = setInterval(() => {
      void this.runOnce().catch(error => {
        ctx.logger.warn('dsh-military coordination maintenance failed', error)
      })
    }, Math.max(250, intervalMs))
    timer.unref()
    this.#timer = timer
    const dispose = (): void => {
      if (this.#timer !== timer) return
      clearInterval(timer)
      this.#timer = null
    }
    ctx.effect(() => dispose)
    return dispose
  }

  async #run(): Promise<CoordinationMaintenanceResult> {
    return this.#telemetry.withSpan({
      name: 'military.coordination.maintenance',
      tenantId: this.#tenantId,
      operationId: `maintenance:${Math.floor(Date.now() / 1_000)}`,
    }, async () => {
      const outbox = await this.#outbox.dispatchAvailable()
      this.#telemetry.recordMetric({
        name: 'military.outbox.delivery',
        kind: 'COUNTER',
        value: outbox.delivered,
        unit: 'messages',
        attributes: { outcome: 'delivered' },
      })
      this.#telemetry.recordMetric({
        name: 'military.outbox.delivery',
        kind: 'COUNTER',
        value: outbox.failed + outbox.deadLettered,
        unit: 'messages',
        attributes: { outcome: 'failed_or_dead_lettered' },
      })

      const maintenanceAt = Date.now()
      let guidanceDeadLetters = 0
      for (const dead of await this.#radio.reconcileDeadLetters()) {
        await this.#runtime.deadLetterGuidanceWait({
          requestId: String(dead.requestId),
          reason: dead.expiresAt !== undefined
            && Date.parse(dead.expiresAt) <= maintenanceAt
            ? 'REQUEST_EXPIRED'
            : 'LEASE_ATTEMPTS_EXHAUSTED',
          actor: this.#coordinator,
        })
        guidanceDeadLetters += 1
      }

      let expiredDecisions = 0
      for (const expired of await this.#decisions.reconcileExpired()) {
        await this.#runtime.expireDecisionWait({
          decisionSetId: expired.decisionSetId,
          reason: 'TTL',
          actor: this.#coordinator,
        })
        expiredDecisions += 1
      }
      const expiredActivations = (
        await this.#lifecycle.reconcileExpiredActivations()
      ).length
      this.#telemetry.recordMetric({
        name: 'military.coordination.reconciliation',
        kind: 'COUNTER',
        value: guidanceDeadLetters,
        unit: 'records',
        attributes: { kind: 'guidance_dead_letter' },
      })
      this.#telemetry.recordMetric({
        name: 'military.coordination.reconciliation',
        kind: 'COUNTER',
        value: expiredDecisions,
        unit: 'records',
        attributes: { kind: 'decision_expiry' },
      })
      this.#telemetry.recordMetric({
        name: 'military.coordination.reconciliation',
        kind: 'COUNTER',
        value: expiredActivations,
        unit: 'records',
        attributes: { kind: 'activation_heartbeat_expiry' },
      })
      return {
        outbox,
        guidanceDeadLetters,
        expiredDecisions,
        expiredActivations,
      }
    })
  }
}
