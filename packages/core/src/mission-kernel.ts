import {
  MilitaryError,
  brand,
  missionEvent,
  type AgentIdentity,
  type MilitaryLedger,
  type MilitaryMissionKernel,
  type MissionCommand,
  type MissionCommandReceipt,
  type MissionId,
  type Revision,
} from '@dsh-military/contracts'
import { cloneFrozen, now, sha256, stableJson, uuid } from './util.js'

export interface MissionCommandHandler {
  execute<T>(
    command: MissionCommand,
    operation: () => Promise<T>,
  ): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }>
}

/** Builds the admission event and delegates the whole unit of work to the durable Ledger. */
export class LedgerMissionCommandHandler implements MissionCommandHandler {
  readonly #ledger: MilitaryLedger
  constructor(ledger: MilitaryLedger) { this.#ledger = ledger }

  async execute<T>(
    command: MissionCommand,
    operation: () => Promise<T>,
  ): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }> {
    const admissionEvent = missionEvent({
      type: 'mission/command-accepted',
      missionId: command.missionId,
      actor: command.actor,
      payload: {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandType: command.type,
        payloadSha256: String(command.payloadSha256),
        actorAuthorityRef: command.actorAuthorityRef,
        ...(command.taskId === undefined ? {} : { taskId: String(command.taskId) }),
        ...(command.taskVersion === undefined ? {} : { taskVersion: Number(command.taskVersion) }),
      },
      metadata: { idempotencyKey: `command-admission:${command.idempotencyKey}`, correlationId: command.commandId },
    })
    return await this.#ledger.transactCommand(command, admissionEvent, operation)
  }
}

/** Serializes writes per tenant/Mission; the Ledger owns atomicity and durable idempotency. */
export class SingleWriterMissionKernel implements MilitaryMissionKernel {
  readonly #handler: MissionCommandHandler
  readonly #tails = new Map<string, Promise<unknown>>()

  constructor(handler: MissionCommandHandler) { this.#handler = handler }

  submit(command: MissionCommand): Promise<MissionCommandReceipt> {
    return this.execute(command, async () => undefined).then(result => result.receipt)
  }

  execute<T>(command: MissionCommand, operation: () => Promise<T>): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }> {
    const partition = `${command.tenantId}:${String(command.missionId)}`
    const previous = this.#tails.get(partition) ?? Promise.resolve()
    const current = previous.then(() => this.#execute(command, operation))
    this.#tails.set(partition, current.then(() => undefined, () => undefined))
    return current
  }

  async #execute<T>(command: MissionCommand, operation: () => Promise<T>): Promise<{ readonly receipt: MissionCommandReceipt; readonly value: T }> {
    if (command.deadlineAt !== undefined && Date.parse(command.deadlineAt) <= Date.now()) {
      throw new MilitaryError('POLICY_DENIED', 'mission command deadline has expired')
    }
    const actualHash = brand<string, 'Sha256'>(sha256(stableJson(command.payload)))
    if (String(actualHash) !== String(command.payloadSha256)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'mission command payload hash mismatch')
    }
    return await this.#handler.execute(command, operation)
  }
}

/** Build a canonical command from one authenticated actor and payload. */
export function createMissionCommand(input: {
  readonly tenantId: string
  readonly missionId: MissionId
  readonly expectedRevision: Revision
  readonly actor: AgentIdentity
  readonly actorAuthorityRef: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly idempotencyKey: string
  readonly taskId?: MissionCommand['taskId']
  readonly taskVersion?: MissionCommand['taskVersion']
  readonly activationId?: string
}): MissionCommand {
  return cloneFrozen({
    schemaVersion: '1.0.0', commandId: uuid('mission-command'), idempotencyKey: input.idempotencyKey,
    tenantId: input.tenantId, missionId: input.missionId, expectedRevision: input.expectedRevision,
    actorAuthorityRef: input.actorAuthorityRef, actor: input.actor,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.taskVersion === undefined ? {} : { taskVersion: input.taskVersion }),
    ...(input.activationId === undefined ? {} : { activationId: input.activationId }),
    type: input.type, payload: cloneFrozen(input.payload),
    payloadSha256: brand<string, 'Sha256'>(sha256(stableJson(input.payload))), createdAt: now(),
  })
}
