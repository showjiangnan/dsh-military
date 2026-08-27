/** Read a content-addressed Military artifact under the caller's capability and data policy. */
import type {} from '@dsh-military/plugin-host'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { brand, MilitaryError } from '@dsh-military/contracts'
import { defineJsonTool, asInteger, asString, identityFor, requireCallingAgent, text } from './common.js'

const MAX_INLINE_BYTES = 128 * 1024

/** Build the role-neutral Military artifact reader exposed only inside the fixed Military preset. */
export function militaryArtifactTool(ctx: Context): ToolDefinition {
  return defineJsonTool({
    name: 'military_read_artifact',
    description: 'Read only an immutable Artifact ID returned in an artifact/artifactRef field, or a Workspace Snapshot ID returned in environmentSnapshotRef. Session IDs, Agent IDs, child IDs and binding IDs are never artifacts and must not be passed here. Child results arrive automatically through report/settlement delivery.',
    parameters: {
      ref: { type: 'string', required: true },
      offset: { type: 'integer' },
      limit: { type: 'integer' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const agent = requireCallingAgent(exec.agent)
      // Resolving the identity ensures non-Military callers cannot use a globally
      // composed artifact service even if a deployment accidentally exposes it.
      identityFor(ctx, agent)
      const ref = asString(args.ref, 'ref')
      const offset = args.offset === undefined ? 0 : asInteger(args.offset, 'offset')
      const requestedLimit = args.limit === undefined ? 32 * 1024 : asInteger(args.limit, 'limit')
      if (offset < 0) throw new RangeError('offset must be non-negative')
      if (requestedLimit < 1 || requestedLimit > MAX_INLINE_BYTES) {
        throw new RangeError(`limit must be between 1 and ${MAX_INLINE_BYTES}`)
      }
      if (ref.startsWith('workspace-snapshot-')) {
        const snapshot = ctx.militaryHost.application.workspaces.snapshotById(ref)
        if (snapshot.tenantId !== ctx.militaryHost.tenantId) {
          throw new MilitaryError('UNAUTHORIZED', 'Workspace Snapshot belongs to another tenant')
        }
        return {
          ref,
          kind: 'workspace-snapshot',
          snapshot,
        }
      }
      if (/^(?:session|agent|agent-binding|execution-binding)-/u.test(ref)) {
        throw new MilitaryError(
          'INVALID_ARGUMENT',
          `${ref} is a Session, Agent, or binding identity—not an Artifact ID; wait for automatic child report delivery and use this tool only with an artifact/artifactRef value`,
          {
            invalidRefKind: 'identity',
            recovery: 'END_CURRENT_TURN_AND_WAIT_FOR_CHILD_REPORT',
          },
        )
      }
      const bytes = await ctx.militaryHost.application.artifacts.get(brand<string, 'ArtifactId'>(ref))
      const start = Math.min(offset, bytes.byteLength)
      const end = Math.min(bytes.byteLength, start + requestedLimit)
      const selected = bytes.subarray(start, end)
      return {
        ref,
        kind: 'artifact',
        offset: start,
        nextOffset: end,
        totalBytes: bytes.byteLength,
        complete: end >= bytes.byteLength,
        text: new TextDecoder('utf-8', { fatal: false }).decode(selected),
      }
    },
  })
}

/** Register the artifact reader in one already-Military tool scope. */
export function installMilitaryArtifactTool(ctx: Context): () => void {
  const runtime = ctx.tools
  if (runtime === undefined) throw new Error('dsh-military artifact tool requires ctx.tools')
  return runtime.register(militaryArtifactTool(ctx))
}
