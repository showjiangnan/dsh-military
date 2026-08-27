import { MilitaryError, type ClaimEvidenceGraph, type VerificationTier } from '@dsh-military/contracts'

const rank: Readonly<Record<VerificationTier, number>> = { V0: 0, V1: 1, V2: 2, V3: 3, V4: 4 }

export interface ClaimCoverageResult {
  readonly covered: boolean
  readonly failures: readonly string[]
}

export function verifyClaimEvidenceGraph(graph: ClaimEvidenceGraph, now = new Date()): ClaimCoverageResult {
  const failures: string[] = []
  const claims = new Map(graph.claims.map(claim => [claim.claimId, claim]))
  for (const link of graph.links) {
    if (!claims.has(link.claimId)) throw new MilitaryError('INVALID_ARGUMENT', `evidence link references unknown claim ${link.claimId}`)
  }
  for (const claim of graph.claims) {
    if (!claim.required) continue
    const supporting = graph.links.filter(link => link.claimId === claim.claimId && link.supports && (link.expiresAt === undefined || new Date(link.expiresAt).getTime() > now.getTime()))
    if (supporting.length === 0) { failures.push(`MISSING_EVIDENCE:${claim.claimId}`); continue }
    if (!supporting.some(link => rank[link.tier] >= rank[claim.minimumTier])) failures.push(`INSUFFICIENT_TIER:${claim.claimId}`)
    if (supporting.every(link => link.tier === 'V4')) failures.push(`SEMANTIC_ONLY:${claim.claimId}`)
  }
  return { covered: failures.length === 0, failures }
}
