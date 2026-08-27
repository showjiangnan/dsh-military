import {
  brand,
  type ContextManifest,
  type MilitaryContextCompiler,
  type Sha256,
} from '@dsh-military/contracts'
import { cloneFrozen, now, sha256, uuid, type Clock } from './util.js'

export interface ContextMaterializer {
  materialize(ref: string): Promise<{ readonly contentRef: string; readonly sha256: Sha256; readonly tokenEstimate: number; readonly sourceEventIds?: readonly string[] }>
}

export class DeterministicContextCompiler implements MilitaryContextCompiler {
  readonly #materializer: ContextMaterializer
  readonly #clock: Clock

  constructor(materializer: ContextMaterializer, clock: Clock = () => new Date()) {
    this.#materializer = materializer
    this.#clock = clock
  }

  async compile(input: Parameters<MilitaryContextCompiler['compile']>[0]): Promise<ContextManifest> {
    const reserve = Math.max(0, input.reasoningPassbackReserve) + Math.max(0, input.imageReserve)
    if (reserve >= input.tokenBudget) throw new RangeError('context reserves consume the complete token budget')
    const remaining = input.tokenBudget - reserve
    const allocations = {
      constitution: Math.floor(remaining * 0.2),
      state: Math.floor(remaining * 0.2),
      evidence: Math.floor(remaining * 0.45),
      working: 0,
      reasoningPassbackReserve: Math.max(0, input.reasoningPassbackReserve),
      imageReserve: Math.max(0, input.imageReserve),
    }
    allocations.working = remaining - allocations.constitution - allocations.state - allocations.evidence
    const groups: ReadonlyArray<readonly ['CONSTITUTION' | 'STATE' | 'EVIDENCE' | 'WORKING', readonly string[]]> = [
      ['CONSTITUTION', input.constitutionRefs], ['STATE', input.stateRefs], ['EVIDENCE', input.evidenceRefs], ['WORKING', input.workingRefs],
    ]
    const sections: ContextManifest['sections'][number][] = []
    const omitted: string[] = []
    const limits = { CONSTITUTION: allocations.constitution, STATE: allocations.state, EVIDENCE: allocations.evidence, WORKING: allocations.working }
    for (const [kind, refs] of groups) {
      let used = 0
      for (const ref of refs) {
        const value = await this.#materializer.materialize(ref)
        if (used + value.tokenEstimate > limits[kind]) { omitted.push(ref); continue }
        used += value.tokenEstimate
        sections.push({ kind, ...value })
      }
    }
    const digestInput = JSON.stringify({ input: { missionId: input.missionId, missionRevision: input.missionRevision, taskId: input.task.taskId, taskVersion: input.task.taskVersion }, sections, omitted, allocations })
    return cloneFrozen({
      schemaVersion: '1.0.0', manifestId: uuid('context-manifest'), missionId: input.missionId,
      missionRevision: input.missionRevision, taskId: input.task.taskId, taskVersion: input.task.taskVersion,
      sections, omittedEvidenceRefs: omitted, tokenAllocation: allocations,
      contentSha256: brand<string, 'Sha256'>(sha256(digestInput)), createdAt: now(this.#clock),
    })
  }
}
