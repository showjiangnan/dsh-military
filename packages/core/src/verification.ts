import {
  MilitaryError,
  type CandidateSubmission,
  type MilitaryArtifacts,
  type MilitaryObservedEvidence,
  type MilitaryVerification,
  type ObservedToolCallReceipt,
  type TaskOrder,
  type VerificationDisposition,
  type VerificationReceipt,
  type ClaimEvidenceGraph, type VerificationTier, brand,
} from '@dsh-military/contracts'
import { cloneFrozen, now, uuid } from './util.js'
import { verifyClaimEvidenceGraph } from './evidence-graph.js'
import { pathWithinAny } from './path-policy.js'
import { InMemoryObservedEvidenceStore } from './observed-evidence.js'

export interface AcceptanceClause {
  readonly clauseId: string
  readonly description: string
  readonly required: boolean
  readonly kind: 'EVIDENCE' | 'ARTIFACT' | 'TOOL_CALL' | 'PATH_SCOPE' | 'CUSTOM'
}

export interface AcceptanceContract {
  readonly contractId: string
  readonly version: number
  readonly clauses: readonly AcceptanceClause[]
  readonly requireIndependentVerification: boolean
}

export interface CandidateVerificationContext {
  readonly candidate: CandidateSubmission
  readonly contract: AcceptanceContract
  readonly allowedWritePaths: readonly string[]
  readonly submittedByVerifierRole: boolean
}

export interface VerifierCheckResult {
  readonly checkId: string
  readonly passed: boolean
  readonly message: string
  readonly evidenceRefs: readonly string[]
  readonly disposition?: VerificationDisposition
}

export interface CandidateVerifier {
  readonly id: string
  readonly taskTypes: readonly string[]
  verify(context: CandidateVerificationContext, signal: AbortSignal): Promise<VerifierCheckResult>
}

export class VerificationEngine implements MilitaryVerification {
  readonly #contracts = new Map<string, AcceptanceContract>()
  readonly #candidateContexts = new Map<string, Omit<CandidateVerificationContext, 'candidate'>>()
  readonly #verifiers: CandidateVerifier[] = []
  readonly #artifacts: MilitaryArtifacts
  readonly #observedEvidence: MilitaryObservedEvidence

  constructor(artifacts: MilitaryArtifacts, observedEvidence?: MilitaryObservedEvidence) {
    this.#artifacts = artifacts
    this.#observedEvidence = observedEvidence ?? new InMemoryObservedEvidenceStore()
  }

  registerContract(contract: AcceptanceContract): void {
    this.#contracts.set(`${contract.contractId}@${contract.version}`, cloneFrozen(contract))
  }

  bindCandidate(candidateId: string, context: Omit<CandidateVerificationContext, 'candidate'>): void {
    this.#candidateContexts.set(candidateId, cloneFrozen(context))
  }

  prepare(candidate: CandidateSubmission, task: TaskOrder, submittedByVerifierRole: boolean): void {
    const key = `${String(task.acceptance.contractId)}@${task.acceptance.version}`
    const contract = this.#contracts.get(key)
    if (contract === undefined) throw new MilitaryError('NOT_FOUND', `acceptance contract ${key} is not registered`)
    this.bindCandidate(String(candidate.candidateId), {
      contract,
      allowedWritePaths: task.scope.writePaths,
      submittedByVerifierRole,
    })
  }

  registerVerifier(verifier: CandidateVerifier): () => void {
    if (this.#verifiers.some(item => item.id === verifier.id)) throw new MilitaryError('REVISION_CONFLICT', `duplicate verifier ${verifier.id}`)
    this.#verifiers.push(verifier)
    return () => {
      const index = this.#verifiers.indexOf(verifier)
      if (index >= 0) this.#verifiers.splice(index, 1)
    }
  }

  async verify(candidate: CandidateSubmission, signal: AbortSignal): Promise<VerificationReceipt> {
    const bound = this.#candidateContexts.get(String(candidate.candidateId))
    if (bound === undefined) throw new MilitaryError('NOT_FOUND', 'candidate verification context missing')
    const contract = this.#contracts.get(`${bound.contract.contractId}@${bound.contract.version}`) ?? bound.contract
    const context: CandidateVerificationContext = { candidate, ...bound, contract }
    if (contract.requireIndependentVerification && context.submittedByVerifierRole) {
      throw new MilitaryError('SELF_VERIFICATION_ONLY')
    }

    const clauseResults: VerificationReceipt['clauseResults'][number][] = []
    const deterministicFailures: string[] = []
    const observedToolCalls = await this.#observedEvidence.toolCalls(candidate.declaredToolCallIds)
    const verifiedToolRefs = validateObservedToolCalls(candidate, observedToolCalls, deterministicFailures)

    for (const clause of contract.clauses) {
      const evidence = candidate.acceptanceMapping[clause.clauseId] ?? []
      let passed = true
      let message = 'covered'
      if (clause.required && evidence.length === 0) {
        passed = false
        message = 'required clause has no mapped evidence'
        deterministicFailures.push(`MISSING_EVIDENCE:${clause.clauseId}`)
      }
      if (clause.kind === 'TOOL_CALL'
        && !evidence.some(item => item.kind === 'tool-call' && verifiedToolRefs.has(item.ref))) {
        passed = false
        message = 'tool-call clause has no successful host-observed receipt'
        deterministicFailures.push(`UNVERIFIED_TOOL_EVIDENCE:${clause.clauseId}`)
      }
      clauseResults.push({
        clauseId: clause.clauseId,
        passed,
        evidenceRefs: evidence.map(item => item.ref),
        message,
      })
    }

    if (candidate.declaredToolCallIds.length === 0) {
      deterministicFailures.push('UNVERIFIED_TOOL_CLAIM:NO_TOOL_CALLS')
    }
    const changedOutsideScope = candidate.changedPaths.filter(path => !pathWithinAny(path, context.allowedWritePaths))
    if (changedOutsideScope.length > 0) deterministicFailures.push(`FORBIDDEN_SCOPE:${changedOutsideScope.join(',')}`)

    for (const artifact of candidate.outputs) {
      if (signal.aborted) throw signal.reason
      if (!await this.#artifacts.verify(artifact)) deterministicFailures.push(`ARTIFACT_MISMATCH:${String(artifact.artifactId)}`)
    }

    const claimEvidenceGraph = buildClaimEvidenceGraph(candidate, contract, verifiedToolRefs)
    const graphCoverage = verifyClaimEvidenceGraph(claimEvidenceGraph)
    deterministicFailures.push(...graphCoverage.failures)

    let disposition: VerificationDisposition = deterministicFailures.length === 0 ? 'ACCEPTED' : 'REWORK'
    for (const verifier of this.#verifiers) {
      if (signal.aborted) throw signal.reason
      const result = await verifier.verify(context, signal)
      clauseResults.push({
        clauseId: `verifier:${verifier.id}:${result.checkId}`,
        passed: result.passed,
        evidenceRefs: result.evidenceRefs,
        message: result.message,
      })
      if (!result.passed) deterministicFailures.push(`${verifier.id}:${result.checkId}`)
      if (result.disposition !== undefined) disposition = higherDisposition(disposition, result.disposition)
    }
    if (deterministicFailures.length > 0 && disposition === 'ACCEPTED') disposition = 'REWORK'

    return cloneFrozen({
      receiptId: uuid('verification'),
      candidateId: String(candidate.candidateId),
      disposition,
      clauseResults,
      deterministicFailures,
      claimEvidenceGraph,
    })
  }
}


function buildClaimEvidenceGraph(
  candidate: CandidateSubmission,
  contract: AcceptanceContract,
  verifiedToolRefs: ReadonlySet<string>,
): ClaimEvidenceGraph {
  const claims = contract.clauses.map(clause => ({
    claimId: clause.clauseId, statement: clause.description, required: clause.required,
    type: clause.kind === 'PATH_SCOPE' ? 'security' as const
      : clause.kind === 'TOOL_CALL' ? 'behavior' as const
        : clause.kind === 'ARTIFACT' ? 'implementation' as const
          : clause.kind === 'CUSTOM' ? 'compatibility' as const : 'documentation' as const,
    minimumTier: minimumTier(clause.kind),
  }))
  const links = contract.clauses.flatMap(clause => (candidate.acceptanceMapping[clause.clauseId] ?? []).map(evidence => ({
    claimId: clause.clauseId,
    evidenceRef: evidence.ref,
    supports: true,
    tier: evidenceTier(evidence.kind, evidence.ref, verifiedToolRefs),
    producedAtRevision: brand<number, 'Revision'>(Number(candidate.location.taskVersion)),
  })))
  return cloneFrozen({
    schemaVersion: '1.0.0', graphId: uuid('claim-evidence'), candidateId: String(candidate.candidateId),
    claims, links, createdAt: now(),
  })
}

function minimumTier(kind: AcceptanceClause['kind']): VerificationTier {
  if (kind === 'TOOL_CALL') return 'V2'
  if (kind === 'PATH_SCOPE') return 'V1'
  if (kind === 'CUSTOM') return 'V4'
  return 'V0'
}

function evidenceTier(
  kind: CandidateSubmission['evidence'][number]['kind'],
  ref: string,
  verifiedToolRefs: ReadonlySet<string>,
): VerificationTier {
  if (kind === 'tool-call') return verifiedToolRefs.has(ref) ? 'V2' : 'V0'
  if (kind === 'git-commit' || kind === 'api-receipt') return 'V3'
  return 'V0'
}

function validateObservedToolCalls(
  candidate: CandidateSubmission,
  receipts: readonly ObservedToolCallReceipt[],
  failures: string[],
): ReadonlySet<string> {
  const byId = new Map(receipts.map(receipt => [receipt.callId, receipt]))
  const verified = new Set<string>()
  for (const callId of new Set(candidate.declaredToolCallIds)) {
    const receipt = byId.get(callId)
    if (receipt === undefined) {
      failures.push(`UNVERIFIED_TOOL_CLAIM:MISSING:${callId}`)
      continue
    }
    if (receipt.isError) {
      failures.push(`UNVERIFIED_TOOL_CLAIM:FAILED:${callId}`)
      continue
    }
    if (String(receipt.agent.agentId) !== String(candidate.identity.agentId)
      || String(receipt.agent.sessionId) !== String(candidate.identity.sessionId)
      || receipt.agent.generation !== candidate.identity.generation) {
      failures.push(`UNVERIFIED_TOOL_CLAIM:IDENTITY_MISMATCH:${callId}`)
      continue
    }
    if (receipt.missionId !== String(candidate.location.missionId)
      || receipt.taskId !== String(candidate.location.taskId)
      || receipt.taskVersion !== Number(candidate.location.taskVersion)) {
      failures.push(`UNVERIFIED_TOOL_CLAIM:TASK_MISMATCH:${callId}`)
      continue
    }
    verified.add(callId)
    verified.add(`tool:${callId}`)
    verified.add(`tool-call:${callId}`)
  }
  return verified
}


const dispositionRank: Readonly<Record<VerificationDisposition, number>> = {
  ACCEPTED: 0,
  REWORK: 1,
  BLOCKED: 2,
  HUMAN_REVIEW_REQUIRED: 3,
  STRATEGIC: 4,
  FROZEN: 5,
}

function higherDisposition(left: VerificationDisposition, right: VerificationDisposition): VerificationDisposition {
  return dispositionRank[right] > dispositionRank[left] ? right : left
}
