import type {} from '@dsh-military/plugin-host'
import { isAbsolute, normalize, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type ArtifactId,
  type TaskOrder,
} from '@dsh-military/contracts'
import { pathWithinAny, sha256, stableJson } from '@dsh-military/core'
import type { SpecsMaintenanceOrder } from '@dsh-military/infrastructure'
import {
  defineJsonTool,
  text,
  registerTools,
  requireCallingAgent,
  identityFor,
  requireRole,
  asStringArray,
  reportTerminalOutcome,
  runDurableTerminalMutation,
} from './common.js'
import {
  parseSpecsApplyDraft,
  specsApplyDraftParameter,
  type SpecsApplyDraft,
} from './runtime-validation.js'
import { workerTools } from './worker.js'

const MAX_STAGED_CHUNK_BYTES = 256 * 1_024
const MAX_STAGED_CHUNKS_PER_DOCUMENT = 256
const MAX_MATERIALIZED_SPECS_BYTES = 64 * 1_024 * 1_024

export function engineerTools(ctx: Context): readonly ToolDefinition[] {
  return [...workerTools(ctx),
    defineJsonTool({
      name: 'military_specs_read',
      description: 'Engineer only. Read existing Task-authorized specs/docs. Omit paths to enumerate existing Markdown. A missing specs/docs directory is an empty starting state; no fixed document skeleton is required.',
      parameters: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional exact file or directory paths below specs/ or docs/. A directory is enumerated recursively.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent)
        const workspace = await requireEngineerWorkspace(ctx, agent)
        return await ctx.militaryHost.specs.read({
          workspaceRoot: workspace.root,
          paths: args.paths === undefined ? [] : asStringArray(args.paths, 'paths'),
          signal: exec.signal,
        })
      },
    }),
    defineJsonTool({
      name: 'military_specs_stage_chunk',
      description: 'Engineer only, large Specs Tasks only. Persist one ordered UTF-8 chunk for a Task-authorized specs/docs file. Repeat with chunkIndex 0, 1, 2…; then pass the returned artifact IDs in the same order to military_specs_apply_order.contentArtifactIds. Staging never writes Git and never concludes the turn.',
      parameters: {
        document: {
          type: 'string',
          required: true,
          description: 'Exact Task-authorized relative file below specs/ or docs/.',
        },
        chunkIndex: {
          type: 'integer',
          required: true,
          description: 'Zero-based contiguous chunk index for this document.',
        },
        content: {
          type: 'string',
          required: true,
          description: 'The next non-empty UTF-8 document chunk, at most 256 KiB.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent)
        const workspace = await requireEngineerWorkspace(ctx, agent)
        return await stageEngineerSpecsChunk(ctx, workspace.task, {
          document: String(args.document),
          chunkIndex: Number(args.chunkIndex),
          content: String(args.content),
        })
      },
    }),
    defineJsonTool({
      name: 'military_specs_apply_order',
      description: 'Engineer only. The sole file-mutation action for a Specs Task. In one call it creates or replaces complete Task-authorized specs/docs files, validates them, commits local main, records the receipt, reports the parent, and concludes the turn. Each update supplies either inline content or ordered contentArtifactIds from military_specs_stage_chunk; never both.',
      parameters: {
        draft: specsApplyDraftParameter,
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute({ draft }, exec) {
        const agent = requireCallingAgent(exec.agent)
        const workspace = await requireEngineerWorkspace(ctx, agent)
        const materialized = await materializeEngineerSpecsDraft(
          ctx,
          parseSpecsApplyDraft(draft),
          workspace.task,
        )
        const compiled = compileEngineerSpecsDraft({
          draft: materialized,
          task: workspace.task,
          commitMessagePrefix: ctx.militaryHost.featureSettings().specs.commitMessagePrefix,
        })
        type SpecsReceipt = {
          readonly orderId: string
          readonly commit: string
          readonly treeHash: string
          readonly changedPaths: readonly string[]
          readonly validatedCommands: readonly string[]
        }
        const terminal = await runDurableTerminalMutation(ctx, {
          identity: identityFor(ctx, agent),
          actionKey: `specs:${compiled.order.orderId}`,
          draft: {
            arguments: draft,
            taskId: String(workspace.task.taskId),
            taskVersion: Number(workspace.task.taskVersion),
            orderId: compiled.order.orderId,
          },
          operation: async () => {
            const result = await ctx.militaryHost.specs.apply(
              workspace.root,
              compiled.order,
              compiled.contentByDocument,
              exec.signal,
            )
            try {
              await ctx.militaryHost.application.runtime.recordSpecsCommit(
                workspace.task.taskId,
                result as {
                  readonly commit: string
                  readonly treeHash: string
                  readonly changedPaths: readonly string[]
                },
              )
            } catch (error) {
              throw new MilitaryError(
                'PERSISTENCE_FAILED',
                'Specs Git commit succeeded but its Mission Ledger receipt was not recorded; retry the identical shallow draft to reconcile without creating a second commit',
                {
                  taskId: String(workspace.task.taskId),
                  commit: String((result as { readonly commit?: unknown }).commit ?? ''),
                  cause: error instanceof Error ? error.message : String(error),
                },
                { cause: error },
              )
            }
            return result as SpecsReceipt
          },
        })
        const receipt = terminal.value
        const parentReport = await reportTerminalOutcome(ctx, agent, {
          kind: 'SPECS_APPLIED',
          idempotencyKey: `specs-applied:${compiled.order.orderId}`,
          summary: `Specs Task ${String(workspace.task.taskId)}@${Number(workspace.task.taskVersion)} committed and recorded.`,
          details: {
            commit: receipt.commit,
            treeHash: receipt.treeHash,
            changedPaths: [...receipt.changedPaths],
            validatedCommands: [...receipt.validatedCommands],
          },
          signal: exec.signal,
        })
        exec.concludeTurn()
        return {
          ...receipt,
          taskId: String(workspace.task.taskId),
          taskVersion: Number(workspace.task.taskVersion),
          missionLedgerRecorded: true,
          parentReport,
          replayedMutation: terminal.replayed,
          concludesTurn: true,
          nextAction: 'STOP_SUCCESS_DO_NOT_REAPPLY',
        }
      },
    }),
  ]
}

async function requireEngineerWorkspace(
  ctx: Context,
  agent: Parameters<typeof identityFor>[1],
): Promise<{
  readonly root: string
  readonly execution: AgentExecutionBinding
  readonly task: TaskOrder
}> {
  const identity = identityFor(ctx, agent)
  requireRole(identity, ['engineer'])
  const sessionBinding = await ctx.militaryHost.application.sessionGate
    .requireMilitarySession(identity.sessionId)
  const execution = await ctx.militaryHost.application.executionBindings.forAgent(
    String(identity.agentId),
    identity.generation,
  )
  if (execution?.workspace === undefined) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISSING',
      'Engineer has no Task-bound workspace; spawn it with the exact Engineer taskId',
    )
  }
  const snapshotRoot = ctx.militaryHost.application.workspaces.repositoryPath(
    execution.workspace.snapshotId,
  )
  if (resolve(sessionBinding.workspaceKey) !== resolve(snapshotRoot)) {
    throw new MilitaryError(
      'AGENT_EXECUTION_BINDING_MISMATCH',
      'Engineer Session workspace differs from its immutable workspace snapshot',
    )
  }
  const task = await ctx.militaryHost.application.runtime.getTask(
    brand<string, 'TaskId'>(execution.workspace.taskId),
  )
  if (Number(task.taskVersion) !== execution.workspace.taskVersion) {
    throw new MilitaryError(
      'STALE_TASK_VERSION',
      'Engineer execution binding points to a stale Task version',
    )
  }
  return { root: snapshotRoot, execution, task }
}

/** Compile the model's shallow draft into one Host-authorized immutable order. */
export function compileEngineerSpecsDraft(input: {
  readonly draft: MaterializedSpecsApplyDraft
  readonly task: TaskOrder
  readonly issuedAt?: string
  readonly commitMessagePrefix?: string
}): {
  readonly order: SpecsMaintenanceOrder
  readonly contentByDocument: Readonly<Record<string, string>>
} {
  const seen = new Set<string>()
  const contentByDocument: Record<string, string> = {}
  const sourceRef = `task:${String(input.task.taskId)}:${Number(input.task.taskVersion)}`
  const requiredUpdates = input.draft.updates.map(update => {
    const document = authorizeSpecsDocument(update.document, input.task)
    if (seen.has(document)) {
      throw new MilitaryError('INVALID_ARGUMENT', `duplicate specs update ${document}`)
    }
    seen.add(document)
    contentByDocument[document] = update.content
    return {
      document,
      purpose: update.purpose,
      sourceEventIds: [sourceRef],
    }
  })
  const orderId = `specs-order-${sha256(stableJson({
    sourceRef,
    updates: requiredUpdates.map(update => ({
      document: update.document,
      purpose: update.purpose,
      contentSha256: sha256(contentByDocument[update.document]!),
    })),
  })).slice(0, 32)}`
  const commitMessagePrefix = input.commitMessagePrefix?.trim() || 'docs(specs):'
  return {
    order: {
      schemaVersion: '1.0.0',
      orderId,
      missionId: String(input.task.missionId),
      trigger: { kind: 'manual', ref: sourceRef },
      requiredUpdates,
      allowedPaths: requiredUpdates.map(update => update.document),
      validation: ['git diff --check'],
      commitPolicy: {
        branch: 'main',
        localOnly: true,
        messageTemplate: `${commitMessagePrefix} apply ${String(input.task.taskId)}`,
        requireCleanNonSpecsPaths: true,
      },
      issuedAt: input.issuedAt ?? new Date().toISOString(),
    },
    contentByDocument,
  }
}

export interface MaterializedSpecsApplyDraft {
  readonly updates: readonly {
    readonly document: string
    readonly purpose: string
    readonly content: string
  }[]
}

interface SpecsChunkEnvelope {
  readonly schemaVersion: '1.0.0'
  readonly missionId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly document: string
  readonly chunkIndex: number
  readonly content: string
  readonly contentSha256: string
}

/** Persist one immutable, Task-bound chunk without touching the Git worktree. */
export async function stageEngineerSpecsChunk(
  ctx: Context,
  task: TaskOrder,
  input: {
    readonly document: string
    readonly chunkIndex: number
    readonly content: string
  },
): Promise<{
  readonly artifactId: string
  readonly document: string
  readonly chunkIndex: number
  readonly byteLength: number
  readonly contentSha256: string
  readonly nextAction: 'STAGE_NEXT_CONTIGUOUS_CHUNK_OR_APPLY_ORDER'
}> {
  const document = authorizeSpecsDocument(input.document, task)
  if (task.complexity.contextFootprint !== 'large'
    || !task.allowedTools.includes('military_specs_stage_chunk')) {
    throw new MilitaryError(
      'POLICY_DENIED',
      'staged Specs chunks are authorized only for a large Task whose Host-compiled tool grant includes military_specs_stage_chunk',
    )
  }
  if (!Number.isSafeInteger(input.chunkIndex)
    || input.chunkIndex < 0
    || input.chunkIndex >= MAX_STAGED_CHUNKS_PER_DOCUMENT) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      `chunkIndex must be a zero-based integer below ${MAX_STAGED_CHUNKS_PER_DOCUMENT}`,
    )
  }
  if (input.content.length === 0) {
    throw new MilitaryError('INVALID_ARGUMENT', 'content must be a non-empty UTF-8 string')
  }
  const contentBytes = new TextEncoder().encode(input.content)
  if (contentBytes.byteLength > MAX_STAGED_CHUNK_BYTES) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      `staged Specs chunk exceeds ${MAX_STAGED_CHUNK_BYTES} UTF-8 bytes`,
    )
  }
  const envelope: SpecsChunkEnvelope = {
    schemaVersion: '1.0.0',
    missionId: String(task.missionId),
    taskId: String(task.taskId),
    taskVersion: Number(task.taskVersion),
    document,
    chunkIndex: input.chunkIndex,
    content: input.content,
    contentSha256: sha256(input.content),
  }
  const artifact = await ctx.militaryHost.application.artifacts.put({
    bytes: new TextEncoder().encode(JSON.stringify(envelope)),
    mediaType: 'application/vnd.dsh-military.specs-chunk+json',
    classification: 'confidential',
    description: `Staged Specs chunk ${document}#${input.chunkIndex}`,
  })
  return {
    artifactId: String(artifact.artifactId),
    document,
    chunkIndex: input.chunkIndex,
    byteLength: contentBytes.byteLength,
    contentSha256: envelope.contentSha256,
    nextAction: 'STAGE_NEXT_CONTIGUOUS_CHUNK_OR_APPLY_ORDER',
  }
}

/** Resolve staged chunks and bind every byte back to the exact immutable Task. */
export async function materializeEngineerSpecsDraft(
  ctx: Context,
  draft: SpecsApplyDraft,
  task: TaskOrder,
): Promise<MaterializedSpecsApplyDraft> {
  let totalBytes = 0
  const seenArtifacts = new Set<string>()
  const updates = []
  for (const update of draft.updates) {
    const document = authorizeSpecsDocument(update.document, task)
    const hasInline = typeof update.content === 'string'
    const artifactIds = update.contentArtifactIds
    const hasStaged = Array.isArray(artifactIds)
    if (hasInline === hasStaged) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        `Specs update ${document} must supply exactly one of content or contentArtifactIds`,
      )
    }
    let content: string
    if (hasInline) {
      if (update.content!.length === 0) {
        throw new MilitaryError('INVALID_ARGUMENT', `Specs update ${document} content is empty`)
      }
      content = update.content!
    } else {
      if (task.complexity.contextFootprint !== 'large'
        || !task.allowedTools.includes('military_specs_stage_chunk')) {
        throw new MilitaryError(
          'POLICY_DENIED',
          `Specs update ${document} cannot use staged chunks under this Task grant`,
        )
      }
      if (artifactIds!.length === 0
        || artifactIds!.length > MAX_STAGED_CHUNKS_PER_DOCUMENT) {
        throw new MilitaryError(
          'INVALID_ARGUMENT',
          `Specs update ${document} needs between 1 and ${MAX_STAGED_CHUNKS_PER_DOCUMENT} staged chunk artifacts`,
        )
      }
      const chunks: string[] = []
      for (const [expectedIndex, artifactId] of artifactIds!.entries()) {
        if (seenArtifacts.has(artifactId)) {
          throw new MilitaryError('INVALID_ARGUMENT', `staged chunk ${artifactId} is reused`)
        }
        seenArtifacts.add(artifactId)
        const envelope = await readSpecsChunk(
          ctx,
          brand<string, 'ArtifactId'>(artifactId) as ArtifactId,
        )
        if (envelope.missionId !== String(task.missionId)
          || envelope.taskId !== String(task.taskId)
          || envelope.taskVersion !== Number(task.taskVersion)
          || envelope.document !== document) {
          throw new MilitaryError(
            'AGENT_EXECUTION_BINDING_MISMATCH',
            `staged chunk ${artifactId} does not belong to ${document} for the current Task version`,
          )
        }
        if (envelope.chunkIndex !== expectedIndex) {
          throw new MilitaryError(
            'INVALID_ARGUMENT',
            `staged chunks for ${document} must be contiguous from 0; expected ${expectedIndex}, received ${envelope.chunkIndex}`,
          )
        }
        chunks.push(envelope.content)
      }
      content = chunks.join('')
    }
    totalBytes += new TextEncoder().encode(content).byteLength
    if (totalBytes > MAX_MATERIALIZED_SPECS_BYTES) {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        `Specs transaction exceeds ${MAX_MATERIALIZED_SPECS_BYTES} UTF-8 bytes`,
      )
    }
    updates.push({ document, purpose: update.purpose, content })
  }
  return { updates }
}

async function readSpecsChunk(
  ctx: Context,
  artifactId: ArtifactId,
): Promise<SpecsChunkEnvelope> {
  let value: unknown
  try {
    const bytes = await ctx.militaryHost.application.artifacts.get(artifactId)
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      `cannot read staged Specs chunk ${String(artifactId)}`,
      undefined,
      { cause: error },
    )
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MilitaryError('INVALID_ARGUMENT', `staged Specs chunk ${String(artifactId)} is malformed`)
  }
  const envelope = value as Partial<SpecsChunkEnvelope>
  if (envelope.schemaVersion !== '1.0.0'
    || typeof envelope.missionId !== 'string'
    || typeof envelope.taskId !== 'string'
    || !Number.isSafeInteger(envelope.taskVersion)
    || typeof envelope.document !== 'string'
    || !Number.isSafeInteger(envelope.chunkIndex)
    || typeof envelope.content !== 'string'
    || typeof envelope.contentSha256 !== 'string'
    || sha256(envelope.content) !== envelope.contentSha256) {
    throw new MilitaryError('INVALID_ARGUMENT', `staged Specs chunk ${String(artifactId)} failed integrity validation`)
  }
  return envelope as SpecsChunkEnvelope
}

function authorizeSpecsDocument(value: string, task: TaskOrder): string {
  const document = normalizeSpecsDocument(value)
  if (!pathWithinAny(document, task.scope.writePaths)) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      `Specs document ${document} is outside the immutable Task write scope`,
      { taskWritePaths: [...task.scope.writePaths] },
    )
  }
  if (pathWithinAny(document, task.scope.forbiddenPaths)) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      `Specs document ${document} is explicitly forbidden by the Task`,
    )
  }
  return document
}

function normalizeSpecsDocument(value: string): string {
  if (value.includes('\u0000') || isAbsolute(value)) {
    throw new MilitaryError('FORBIDDEN_SCOPE', `Specs document ${value} must be a relative specs/docs path`)
  }
  const document = normalize(value).replaceAll('\\', '/').replace(/^\.\//u, '')
  if (!(document.startsWith('specs/') || document.startsWith('docs/'))
    || document.endsWith('/')
    || document.split('/').includes('..')) {
    throw new MilitaryError(
      'FORBIDDEN_SCOPE',
      `Specs document ${value} must name one file below specs/ or docs/`,
    )
  }
  return document
}

export function apply(ctx: Context): void { registerTools(ctx, engineerTools(ctx)) }
export const name = 'dsh-military-tools-engineer'
export const inject = ['tools', 'militaryHost', 'militaryAgentIdentities']
