import type {} from '@dsh-military/runtime'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  MilitaryError,
  brand,
  type AgentTemplateProfile,
  type CompatibilityReport,
  type PresetGenerationManifest,
  type TaskOrder,
} from '@dsh-military/contracts'
import { now, resolveTacticalRecall, sha256, stableJson } from '@dsh-military/core'
import {
  defineJsonTool,
  text,
  registerTools,
  requireCallingAgent,
  identityFor,
  requireRole,
  asString,
  runMissionCommand,
  reportTerminalOutcome,
  runDurableTerminalMutation,
} from './common.js'
import {
  performanceEvaluationRequestParameter,
  parsePerformanceEvaluationRequest,
  parseTaskOrder,
} from './runtime-validation.js'
import {
  compileTacticalGuidanceDraft,
  tacticalGuidanceDraftParameters,
} from './lightweight-drafts.js'
import {
  compileTaskDraft,
  taskCreateParameters,
  type TaskDraftCompilation,
} from './task-draft.js'

export function generalTools(ctx: Context): readonly ToolDefinition[] {
  return [
    defineJsonTool({
      name: 'military_mission_start',
      description: 'General only. Ensure the root Session has one Mission. Idempotently returns the existing Mission when /brainstorm already created it; the Host derives Mission identity and authority.',
      parameters: { title: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); const general = identityFor(ctx, agent); requireRole(general, ['general'])
        const binding = await ctx.militaryHost.application.sessionGate.requireMilitarySession(general.sessionId)
        const existing = await ctx.militaryHost.application.runtime.missionForSession(binding.sessionId)
        if (existing !== null) {
          const snapshot = await ctx.militaryHost.application.ledger.readMission(existing)
          return {
            missionId: String(existing),
            state: 'ACTIVE',
            revision: Number(snapshot.revision),
            disposition: 'EXISTING',
          }
        }
        const missionId = brand<string, 'MissionId'>(
          `mission-${sha256(String(binding.sessionId)).slice(0, 32)}`,
        )
        const title = asString(args.title, 'title')
        const authorityContext = await ctx.militaryHost.application.authorization.resolve(
          String(general.agentId),
          ctx.militaryHost.tenantId,
        )
        const authorityContextRef = authorityContext.authorityContextId
        return await runMissionCommand(ctx, {
          identity: general, missionId, type: 'mission.start',
          payload: { title, rootSessionId: String(binding.sessionId), authorityContextRef },
          idempotencyKey: `mission-start:${String(binding.sessionId)}`,
          operation: async () => {
            await ctx.militaryHost.application.runtime.registerMission({
              missionId,
              rootSessionId: binding.sessionId,
              general,
              title,
              authorityContextRef,
            })
            const snapshot = await ctx.militaryHost.application.ledger.readMission(missionId)
            return {
              missionId: String(missionId),
              state: 'ACTIVE' as const,
              revision: Number(snapshot.revision),
              disposition: 'CREATED' as const,
            }
          },
        })
      },
    }),
    defineJsonTool({
      name: 'military_task_create',
      description: 'General only, after military_mission_start succeeds. Submit objective, role, exact write paths and acceptance criteria. The Host derives Task key, Direction/Wave, read/forbidden scope, budgets, stop/escalation policy, identities, fences and environment snapshot.',
      parameters: taskCreateParameters,
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); const general = identityFor(ctx, agent); requireRole(general, ['general'])
        const binding = await ctx.militaryHost.application.sessionGate.requireMilitarySession(general.sessionId)
        const missionId = await ctx.militaryHost.application.runtime.missionForSession(binding.sessionId)
        if (missionId === null) {
          throw new MilitaryError(
            'NOT_FOUND',
            'General Session has no Mission; call military_mission_start once, or run /brainstorm which creates it automatically',
          )
        }
        const identityOnly = compileTaskDraft({
          value: args,
          missionId,
          environmentSnapshotRef: 'environment-pending',
        })
        try {
          const existing = await ctx.militaryHost.application.runtime.getTask(identityOnly.taskId)
          const expected = compileTaskDraft({
            value: args,
            missionId,
            environmentSnapshotRef: existing.environmentSnapshotRef,
          })
          const expectedFrozenRecall = { ...expected.order, tactics: existing.tactics }
          if (stableJson(existing) !== stableJson(expectedFrozenRecall)) {
            throw new MilitaryError(
              'IDEMPOTENCY_CONFLICT',
              `taskKey ${identityOnly.draft.taskKey} already identifies immutable Task ${String(existing.taskId)}; do not create a replacement or retry this draft—call military_task_get with the existing taskId`,
              {
                taskKey: identityOnly.draft.taskKey,
                existingTaskId: String(existing.taskId),
                recoveryTool: 'military_task_get',
              },
            )
          }
          return taskCreatedValue(existing)
        } catch (error) {
          if (!(error instanceof MilitaryError) || error.failure.code !== 'NOT_FOUND') throw error
        }
        const environment = await ctx.militaryHost.application.workspaces.snapshot({
          tenantId: ctx.militaryHost.tenantId,
          workspaceKey: binding.workspaceKey,
          signal: exec.signal,
        })
        const compiled = await attachTaskTactics(ctx, compileTaskDraft({
          value: args,
          missionId,
          environmentSnapshotRef: environment.workspaceSnapshotId,
        }))
        const value = parseTaskOrder(compiled.order)
        return await runMissionCommand(ctx, {
          identity: general,
          missionId,
          taskId: value.taskId,
          taskVersion: value.taskVersion,
          type: 'task.create',
          payload: { taskId: String(value.taskId), draftHash: compiled.draftHash },
          idempotencyKey: `task-create:${String(value.taskId)}:${compiled.draftHash}`,
          operation: async () => {
            await ctx.militaryHost.application.runtime.registerTask(value, general)
            return taskCreatedValue(value)
          },
        })
      },
    }),
    defineJsonTool({
      name: 'military_task_get', description: 'General only. Read one immutable canonical Task Order using a taskId returned by military_task_create.',
      parameters: { taskId: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute({ taskId }, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['general'])
        return { order: await ctx.militaryHost.application.runtime.getTask(brand<string, 'TaskId'>(String(taskId))) }
      },
    }),
    defineJsonTool({
      name: 'military_spawn_department_agent', description: 'General only. Spawn one continuable department Agent from an ACTIVE or explicitly permitted CANARY template. The child terminal receipt/report automatically wakes or steers General: after a successful spawn, end the current turn and do not poll military_read_artifact, military_get_context, radio, Session IDs, Agent IDs, or binding IDs. For repository discovery, use advisor-generalist without taskId. Pass taskId for Worker or Engineer execution.',
      parameters: {
        templateId: {
          type: 'string',
          required: true,
          description: 'Exact ACTIVE/CANARY templateId returned by military_status, for example "engineer-default" or "worker-default".',
        },
        prompt: { type: 'string', required: true },
        label: { type: 'string', required: true },
        taskId: {
          type: 'string',
          description: 'Required for Worker or Engineer task execution. Copy the exact taskId returned by military_task_create.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['general'])
        if (ctx.militaryHost === undefined) throw new MilitaryError('ADVISOR_UNAVAILABLE', 'department agent transport is unavailable')
        await ctx.militaryHost.departmentAgents.spawn({
          parent: agent,
          templateId: brand<string, 'AgentTemplateId'>(String(args.templateId)),
          prompt: String(args.prompt),
          label: String(args.label),
          ...(args.taskId === undefined ? {} : { taskId: brand<string, 'TaskId'>(String(args.taskId)) }),
          signal: exec.signal,
        })
        exec.concludeTurn()
        return {
          dispatchAccepted: true,
          templateId: String(args.templateId),
          ...(args.taskId === undefined ? {} : { taskId: String(args.taskId) }),
          childState: 'RUNNING',
          reportDelivery: 'AUTO_RESUME_PARENT',
          nextAction: 'END_CURRENT_TURN_AND_WAIT_FOR_CHILD_REPORT',
          pollingAllowed: false,
          identityRefsAreArtifacts: false,
          concludesTurn: true,
        }
      },
    }),
    defineJsonTool({
      name: 'military_radio_poll', description: 'Lease the next eligible Tactical Request for the calling General or staff coordinator.',
      parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(_args, exec) {
        const agent = requireCallingAgent(exec.agent); const identity = identityFor(ctx, agent); requireRole(identity, ['general', 'advisor', 'chief-of-staff'])
        return { request: await ctx.militaryHost.application.radio.lease(identity, exec.signal) }
      },
    }),
    defineJsonTool({
      name: 'military_radio_issue', description: 'General/Staff only. Issue complete version-fenced Tactical Guidance for one request returned by military_radio_poll.',
      parameters: tacticalGuidanceDraftParameters,
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent)
        const identity = identityFor(ctx, agent)
        requireRole(identity, ['general', 'advisor', 'chief-of-staff'])
        const request = await ctx.militaryHost.application.radio.leased(
          brand<string, 'TacticalRequestId'>(String(args.requestId)),
          identity,
        )
        const value = compileTacticalGuidanceDraft({
          value: args,
          identity,
          request,
        })
        const terminal = await runDurableTerminalMutation(ctx, {
          identity,
          actionKey: `guidance:${String(value.guidanceId)}`,
          draft: {
            arguments: args,
            requestId: String(request.requestId),
            taskVersion: Number(request.location.taskVersion),
          },
          operation: async () => {
            await ctx.militaryHost.application.radio.issue(value)
            const delivered = await ctx.militaryHost.application.radio.guidance(
              String(value.guidanceId),
            )
            await ctx.militaryHost.application.runtime.applyGuidance({
              taskId: request.location.taskId,
              taskVersion: request.location.taskVersion,
              guidance: delivered,
              actor: identity,
            })
            return {
              guidanceId: String(value.guidanceId),
              state: 'DELIVERED_TO_TASK' as const,
              taskId: String(request.location.taskId),
              taskVersion: Number(request.location.taskVersion),
              nextAction: 'REDISPATCH_TASK_WITH_HOST_INJECTED_GUIDANCE' as const,
            }
          },
        })
        const parentReport = await reportTerminalOutcome(ctx, agent, {
          kind: 'TACTICAL_GUIDANCE',
          idempotencyKey: `guidance-terminal:${String(value.guidanceId)}`,
          summary: `Tactical guidance ${String(value.guidanceId)} is ready for request ${String(value.requestId)}.`,
          details: {
            expectedTaskVersion: Number(value.expectedTaskVersion),
            directiveSteps: value.directive.length,
          },
          signal: exec.signal,
        })
        exec.concludeTurn()
        return {
          ...terminal.value,
          parentReport,
          replayedMutation: terminal.replayed,
          concludesTurn: true,
        }
      },
    }),
    defineJsonTool({
      name: 'military_decision_present', description: 'Read the next Decision Broker record. Present its questionSetRef using the built-in ask_user_question tool.',
      parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(_args, exec) {
        const agent = requireCallingAgent(exec.agent); const identity = identityFor(ctx, agent); requireRole(identity, ['general'])
        const record = await ctx.militaryHost.application.decisionBroker.presentNext(identity.sessionId)
        if (record === null) return { record: null, questionSet: null }
        const pending = await ctx.militaryHost.application.decisionBroker.pending(identity.sessionId)
        return { record, questionSet: pending.find(value => String(value.decisionSetId) === record.decisionSetId) ?? null }
      },
    }),
    defineJsonTool({
      name: 'military_decision_answer', description: 'Persist the user answers returned by ask_user_question and complete the Decision Broker record.',
      parameters: {
        decisionSetId: { type: 'string', required: true },
        answers: {
          type: 'object',
          properties: {},
          additionalProperties: true,
          required: true,
          description: 'Object keyed by the exact question ids returned by military_decision_present; values are the user-selected labels or free-form answers.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); const identity = identityFor(ctx, agent); requireRole(identity, ['general'])
        const missionId = await ctx.militaryHost.application.runtime.missionForSession(identity.sessionId)
        if (missionId === null) throw new MilitaryError('NOT_FOUND', 'General session has no active Mission')
        const decisionSetId = String(args.decisionSetId)
        const answersHash = sha256(stableJson(args.answers))
        const receipt = await ctx.militaryHost.application.artifacts.put({
          bytes: new TextEncoder().encode(JSON.stringify({
            decisionSetId,
            answers: args.answers,
            answersHash,
          }, null, 2)),
          mediaType: 'application/json',
          classification: 'confidential',
          description: 'Decision Broker answer receipt',
          tenantId: ctx.militaryHost.tenantId,
          missionId: String(missionId),
          ownerPrincipalId: String(identity.agentId),
          audiencePrincipalIds: ['military-host', String(identity.agentId)],
          idempotencyKey: `decision-answer:${decisionSetId}:${answersHash}`,
          audienceScopes: ['artifact:read', 'military:decision-answer'],
        })
        return await runMissionCommand(ctx, {
          identity, missionId, type: 'decision.answer',
          payload: { decisionSetId, answersHash },
          idempotencyKey: `decision-answer:${decisionSetId}:${answersHash}`,
          operation: async () => {
            await ctx.militaryHost.application.decisionBroker.recordAnswers({
              rootSessionId: identity.sessionId, decisionSetId, answerReceiptRef: String(receipt.artifactId),
            })
            const resumedTaskId = await ctx.militaryHost.application.runtime.resolveDecision({
              decisionSetId,
              answerReceiptRef: String(receipt.artifactId),
              actor: identity,
            })
            await ctx.militaryHost.application.runtime.recordEvent({
              missionId, actor: identity, type: 'decision/answered',
              payload: { decisionSetId, answerReceiptRef: String(receipt.artifactId), answeredBy: String(identity.agentId) },
              idempotencyKey: `decision-answered:${decisionSetId}:${answersHash}`,
            })
            return {
              decisionSetId,
              state: 'ANSWERED' as const,
              answerReceipt: receipt,
              resumedTaskId: resumedTaskId === null
                ? null
                : String(resumedTaskId),
            }
          },
        })
      },
    }),
    defineJsonTool({
      name: 'military_tactical_ingest',
      description: 'General only. Start or resume private-Skill extraction from a sourceHandle created by the user in Knowledge & Skills. Supply only the goal and tag IDs; the Host derives IDs, rights, hashes, chunks, model route and review state. Approval is never available to the model.',
      parameters: {
        sourceHandle: { type: 'string', required: true },
        goal: { type: 'string', required: true },
        primaryTagId: { type: 'string', required: true },
        additionalTagIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional additional tag IDs. Omit when none.',
        },
        targetSkillId: { type: 'string', description: 'Optional existing exact Skill ID for a supplement.' },
        targetVersion: { type: 'string', description: 'Required with targetSkillId.' },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent)
        const identity = identityFor(ctx, agent)
        requireRole(identity, ['general'])
        const targetSkillId = typeof args.targetSkillId === 'string' && args.targetSkillId.trim() !== ''
          ? args.targetSkillId.trim()
          : undefined
        const targetVersion = typeof args.targetVersion === 'string' && args.targetVersion.trim() !== ''
          ? args.targetVersion.trim()
          : undefined
        if ((targetSkillId === undefined) !== (targetVersion === undefined)) {
          throw new MilitaryError('INVALID_ARGUMENT', 'targetSkillId and targetVersion must be supplied together')
        }
        const additional = Array.isArray(args.additionalTagIds)
          ? args.additionalTagIds.map(String).filter(value => value.trim() !== '').slice(0, 8)
          : []
        const sourceHandle = brand<string, 'PrivateSkillSourceHandle'>(
          asString(args.sourceHandle, 'sourceHandle'),
        )
        const source = await ctx.militaryHost.application.ingestion.source(sourceHandle)
        const job = await ctx.militaryHost.application.ingestion.startExtraction({
          // The source owner is a Host-observed user identity. General may
          // request extraction, but cannot substitute its Agent identity for
          // the user who imported and owns the material.
          requestedBy: source.rights.ownerId,
          value: {
            sourceHandle,
            extractionGoal: asString(args.goal, 'goal'),
            primaryTagId: brand<string, 'TacticalTagId'>(asString(args.primaryTagId, 'primaryTagId')),
            additionalTagIds: additional.map(value => brand<string, 'TacticalTagId'>(value)),
            ...(targetSkillId === undefined || targetVersion === undefined ? {} : {
              targetSkill: {
                skillId: brand<string, 'TacticalSkillId'>(targetSkillId),
                version: brand<string, 'SemVer'>(targetVersion),
              },
            }),
          },
        })
        const current = await ctx.militaryHost.application.ingestion.process(job.requestId, exec.signal)
        const candidate = current.candidateId === undefined
          ? null
          : await ctx.militaryHost.application.ingestion.candidateById(current.candidateId)
        return {
          requestId: String(current.requestId),
          state: current.state,
          progress: { completedChunks: current.completedChunkCount, totalChunks: current.chunkCount },
          candidate: candidate === null ? null : {
            candidateId: String(candidate.candidateId),
            title: candidate.proposedTitle,
            claimCount: candidate.highValueClaims.length,
            risks: candidate.risks,
          },
          nextAction: ingestionNextAction(current.state),
        }
      },
    }),
    defineJsonTool({
      name: 'military_tactical_review',
      description: 'General only. Request one candidate revision or recommend rejection. User approval is exclusively performed in the Knowledge & Skills visual centre and cannot be called by a model.',
      parameters: {
        candidateId: { type: 'string', required: true },
        action: {
          type: 'string',
          required: true,
          enum: ['RETURN', 'REJECT'],
        },
        instructions: {
          type: 'string',
          required: true,
          description: 'One concise revision request or rejection rationale.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(args, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['general'])
        const id = brand<string, 'TacticalExtractionCandidateId'>(String(args.candidateId))
        const action = String(args.action)
        const instructions = asString(args.instructions, 'instructions')
        if (action === 'RETURN') {
          await ctx.militaryHost.application.ingestion.returnCandidate(id, instructions)
        } else if (action === 'REJECT') {
          // A model may recommend rejection, but only a user action in the
          // Knowledge Center may make the irreversible review decision.
          await ctx.militaryHost.application.ingestion.returnCandidate(
            id,
            `General recommends rejection; user decision required. ${instructions}`,
          )
        }
        else throw new MilitaryError('INVALID_ARGUMENT', 'unknown tactical review action')
        return {
          candidateId: String(id),
          state: (await ctx.militaryHost.application.ingestion.candidateById(id)).status,
          action,
          nextAction: action === 'REJECT'
            ? 'WAIT_FOR_USER_REJECTION_DECISION'
            : 'WAIT_FOR_USER_OR_NEW_SOURCE',
        }
      },
    }),
    defineJsonTool({
      name: 'military_evaluation_start', description: 'Start a Military Evaluation Committee run over Military sessions in a requested period.',
      parameters: { request: performanceEvaluationRequestParameter },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute({ request }, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['general'])
        const value = parsePerformanceEvaluationRequest(request)
        const run = await ctx.militaryHost.application.evaluation.request(value)
        const report = await ctx.militaryHost.application.evaluation.execute(
          value.evaluationRequestId,
          exec.signal,
        )
        const frozen = await ctx.militaryHost.application.evaluationDataset.get(
          value.evaluationRequestId,
        )
        if (
          frozen === null
          || !await ctx.militaryHost.application.evaluationDataset.verify(
            frozen.manifest,
          )
        ) {
          throw new MilitaryError('EVALUATION_DATASET_INCOMPLETE', 'evaluation dataset manifest failed integrity verification')
        }
        return {
          run: await ctx.militaryHost.application.evaluation.get(
            value.evaluationRequestId,
          ),
          requestAccepted: run,
          dataset: frozen.manifest,
          report,
        }
      },
    }),
    defineJsonTool({
      name: 'military_evaluation_get', description: 'Read an evaluation run, individual template results and the final report when ready.',
      parameters: { evaluationRequestId: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute({ evaluationRequestId }, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['general'])
        const id = brand<string, 'EvaluationRequestId'>(String(evaluationRequestId))
        return { run: await ctx.militaryHost.application.evaluation.get(id), individual: await ctx.militaryHost.application.evaluation.listTemplateResults(id), report: await ctx.militaryHost.application.evaluation.report(id) }
      },
    }),
    defineJsonTool({
      name: 'military_status',
      description: 'General only. Read a bounded readiness summary and one latest ACTIVE/CANARY row per department templateId before spawning a department Agent.',
      parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => text(value) },
      async execute(_args, exec) {
        const agent = requireCallingAgent(exec.agent); requireRole(identityFor(ctx, agent), ['general'])
        const [compatibility, presetGeneration, templates] = await Promise.all([
          ctx.militaryHost.application.compatibility.lastReport(),
          ctx.militaryHost.application.presetGenerations.current(),
          ctx.militaryHost.application.templates.list({ includeInactive: true }),
        ])
        if (compatibility === null) {
          throw new MilitaryError(
            'DEPENDENCY_NOT_READY',
            'compatibility report is not available yet',
          )
        }
        return summarizeMilitaryStatus({ compatibility, presetGeneration, templates })
      },
    }),
  ]
}

/** Keep Flash-facing status bounded and remove immutable historical revisions. */
export function summarizeMilitaryStatus(input: {
  readonly compatibility: CompatibilityReport
  readonly presetGeneration: PresetGenerationManifest
  readonly templates: readonly AgentTemplateProfile[]
}): {
  readonly compatibility: {
    readonly dsh: CompatibilityReport['dsh']
    readonly disposition: CompatibilityReport['disposition']
    readonly blockers: readonly string[]
    readonly warnings: readonly string[]
  }
  readonly presetGeneration: {
    readonly presetId: PresetGenerationManifest['presetId']
    readonly generation: string
    readonly status: PresetGenerationManifest['status']
    readonly dshBaseline: PresetGenerationManifest['dshBaseline']
  }
  readonly templates: ReturnType<typeof latestRunnableTemplateSummaries>
} {
  return {
    compatibility: {
      dsh: input.compatibility.dsh,
      disposition: input.compatibility.disposition,
      blockers: input.compatibility.blockers,
      warnings: input.compatibility.warnings,
    },
    presetGeneration: {
      presetId: input.presetGeneration.presetId,
      generation: input.presetGeneration.generation,
      status: input.presetGeneration.status,
      dshBaseline: input.presetGeneration.dshBaseline,
    },
    templates: latestRunnableTemplateSummaries(input.templates),
  }
}

/** Select the newest runnable revision of every immutable template identity. */
export function latestRunnableTemplateSummaries(
  templates: readonly AgentTemplateProfile[],
): readonly {
  readonly templateId: string
  readonly revision: number
  readonly displayName: string
  readonly department: AgentTemplateProfile['department']
  readonly role: AgentTemplateProfile['role']
  readonly status: 'ACTIVE' | 'CANARY'
  readonly taskTypes: readonly string[]
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: AgentTemplateProfile['modelPolicy']['reasoningEffort']
  readonly maxOutputTokens: number
  readonly modelCapabilityProfileId: string
  readonly allowFallback: boolean
  readonly allowCanaryModel: boolean
  readonly toolProfile: string
  readonly permissionProfile: string
}[] {
  const latest = new Map<string, AgentTemplateProfile>()
  for (const template of templates) {
    const id = String(template.templateId)
    const current = latest.get(id)
    if (current === undefined || Number(template.revision) > Number(current.revision)) {
      latest.set(id, template)
    }
  }
  return [...latest.values()]
    .filter((template): template is AgentTemplateProfile & { readonly status: 'ACTIVE' | 'CANARY' } =>
      template.status === 'ACTIVE' || template.status === 'CANARY')
    .sort((left, right) => String(left.templateId).localeCompare(String(right.templateId)))
    .map(template => ({
      templateId: String(template.templateId),
      revision: Number(template.revision),
      displayName: template.displayName,
      department: template.department,
      role: template.role,
      status: template.status,
      taskTypes: [...template.taskTypes],
      provider: template.modelPolicy.provider,
      model: template.modelPolicy.model,
      reasoningEffort: template.modelPolicy.reasoningEffort,
      maxOutputTokens: template.modelPolicy.maxOutputTokens,
      modelCapabilityProfileId: template.modelPolicy.modelCapabilityProfileId,
      allowFallback: template.modelPolicy.allowFallback === true,
      allowCanaryModel: template.modelPolicy.allowCanaryModel === true,
      toolProfile: `${template.capabilities.toolProfileId}@${Number(template.capabilities.toolProfileRevision)}`,
      permissionProfile: `${template.capabilities.permissionProfileId}@${Number(template.capabilities.permissionProfileRevision)}`,
    }))
}

function taskCreatedValue(order: TaskOrder): {
  readonly missionId: string
  readonly directionId: string
  readonly waveId: string
  readonly taskId: string
  readonly taskVersion: number
  readonly assignedRole: TaskOrder['assignedRole']
  readonly tactics: readonly {
    readonly skillId: string
    readonly version: string
  }[]
  readonly state: 'READY'
} {
  return {
    missionId: String(order.missionId),
    directionId: String(order.directionId),
    waveId: String(order.waveId),
    taskId: String(order.taskId),
    taskVersion: Number(order.taskVersion),
    assignedRole: order.assignedRole,
    tactics: order.tactics.map(value => ({
      skillId: String(value.skillId),
      version: String(value.version),
    })),
    state: 'READY',
  }
}

export async function attachTaskTactics(
  ctx: Context,
  compilation: TaskDraftCompilation,
): Promise<TaskDraftCompilation> {
  const settings = ctx.militaryHost.featureSettings()
  const tags = await ctx.militaryHost.application.tags.list({ status: 'ACTIVE' })
  const recallText = [
    compilation.draft.objective,
    compilation.draft.whyItMatters,
    compilation.draft.taskType,
    compilation.draft.direction,
    compilation.draft.wave,
    ...compilation.draft.scope.readPaths,
    ...compilation.draft.scope.writePaths,
    ...compilation.draft.requiredEvidence,
    ...compilation.draft.acceptanceCriteria,
    ...compilation.draft.dependencies,
  ].join('\n')
  const recall = await resolveTacticalRecall({
    text: recallText,
    tags,
    registry: ctx.militaryHost.tactics,
    includeTesting: settings.tactics.allowCanaryDelivery,
    maximumTagMatches: Math.min(5, settings.tactics.candidateRecallMaximum),
    maximumCandidates: settings.tactics.candidateRecallMaximum,
    eligibility: async (skillId, version) =>
      await ctx.militaryHost.application.ingestion.deliveryEligibility(skillId, version),
  })
  const tactics = ctx.militaryHost.tactics.refs(
    recall.selected.map(value => value.procedure),
  )
  return {
    ...compilation,
    draftHash: sha256(stableJson({
      draftHash: compilation.draftHash,
      tactics: tactics.map(value => ({
        skillId: String(value.skillId),
        version: String(value.version),
      })),
    })),
    order: {
      ...compilation.order,
      tactics,
    },
  }
}

function ingestionNextAction(state: string): string {
  switch (state) {
    case 'PENDING_REVIEW':
      return 'WAIT_FOR_USER_REVIEW_IN_KNOWLEDGE_CENTER'
    case 'AWAITING_INJECTION_ACK':
      return 'WAIT_FOR_USER_INJECTION_ACKNOWLEDGEMENT'
    case 'APPROVED_AS_DRAFT':
      return 'WAIT_FOR_USER_LIFECYCLE_PROMOTION'
    case 'FAILED':
      return 'OPEN_JOB_DIAGNOSTIC'
    default:
      return 'RESUME_SAME_REQUEST'
  }
}

export function apply(ctx: Context): void { registerTools(ctx, generalTools(ctx)) }
export const name = 'dsh-military-tools-general'
export const inject = [
  'tools',
  'militaryHost',
]
