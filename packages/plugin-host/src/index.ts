import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { militaryPresetDirectory } from '@dsh-military/preset'
import { Config as ConfigSchema, type Config as PluginConfig } from './config.js'
import { createMilitaryApplication } from './application-factory.js'
import { provideMilitaryServices } from './context.js'
import { DefaultMilitaryHostRuntime } from './host-runtime.js'
import { installMilitarySettings } from './settings.js'
import { installMilitaryPromptSurface } from './prompt-surface.js'
import { installPrivateSkillProvider } from './private-skill-provider.js'
import { PrivateSkillRemoteService } from './private-skill-remote.js'
import { MilitaryControlPlaneRemoteService } from './control-plane-remote.js'
import { MilitaryOperationsRemoteService } from './operations-remote.js'
import { MilitaryWorkspaceRemoteService } from './workspace-remote.js'
import { MilitaryBenchmarkRemoteService } from './benchmark-remote.js'
import { MilitaryEvaluationRemoteService } from './evaluation-remote.js'
import './session-events.js'

export const name = 'dsh-military-host'
export const inject = ['agents', 'tools', 'settings', 'agentPresets', 'subagents', 'sessionPersistence', 'commands', 'llm', 'skills'] as const
export const Config = ConfigSchema
export type { PluginConfig }
export * from './context.js'
export * from './identity.js'
export * from './application-factory.js'
export * from './host-runtime.js'
export * from './specs-control.js'
export * from './defaults.js'
export * from './rc2-adapter.js'
export * from './tool-authorization.js'
export * from './model-budget.js'
export * from './model-catalog-bridge.js'
export * from './dsh-call-controls.js'
export * from './general-workflow-guard.js'
export * from './general-output-guard.js'
export * from './prompt-surface.js'
export * from './child-transport.js'
export * from './context-audit.js'
export * from './private-skill-extractor.js'
export * from './private-skill-provider.js'
export * from './private-skill-remote.js'
export * from './role-workbench.js'
export * from './control-plane-remote.js'
export * from './role-readiness.js'
export * from './session-diagnostics.js'
export * from './operations-remote.js'
export * from './workspace-remote.js'
export * from './benchmark-remote.js'
export * from './evaluation-remote.js'
export * from './performance-narrative.js'
export * from './session-adapters.js'
export * from './role-usage.js'

export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const effective: PluginConfig = {
    ...config,
    dataRoot: resolve(config.dataRoot), repositoryRoot: resolve(config.repositoryRoot),
    presetAssetsRoot: config.presetAssetsRoot.trim() === '' ? militaryPresetDirectory() : resolve(config.presetAssetsRoot),
    ...(config.databasePath === undefined ? {} : { databasePath: resolve(config.databasePath) }),
  }
  const factory = await createMilitaryApplication(ctx, {
    tenantId: effective.tenantId, dataRoot: effective.dataRoot, repositoryRoot: effective.repositoryRoot,
    presetAssetsRoot: effective.presetAssetsRoot,
    ...(effective.databasePath === undefined ? {} : { databasePath: effective.databasePath }),
    maxRadioAttempts: effective.maxRadioAttempts, radioLeaseSeconds: effective.radioLeaseSeconds,
    regressionChecks: effective.regressionChecks,
  })
  const host = new DefaultMilitaryHostRuntime(ctx, effective, factory)
  // RC.2 can start a continuable child's first model request before the
  // asynchronous agent/session-start listeners finish resolving its durable
  // Military binding. Install prompt/schema parity inside the unpublished
  // child construction transaction so even that first request is coherent.
  ctx.subagents.registerContinuableSetup((childCtx) => {
    const agent = childCtx.agent as Agent | undefined
    if (agent === undefined || resolveSessionPreset(agent.session) !== 'military') {
      return () => undefined
    }
    const identity = host.identities.get(String(agent.id))
    const profileRef = identity === undefined
      ? 'department-tools@pending'
      : `${identity.role}-tools@pending`
    return installMilitaryPromptSurface(agent, profileRef)
  })
  const disposeServices = provideMilitaryServices(ctx, host)
  const privateSkillRemote = new PrivateSkillRemoteService(ctx, host)
  void new MilitaryControlPlaneRemoteService(ctx, host)
  void new MilitaryOperationsRemoteService(ctx, host)
  void new MilitaryWorkspaceRemoteService(ctx, host)
  void new MilitaryBenchmarkRemoteService(ctx, host)
  void new MilitaryEvaluationRemoteService(ctx, host)
  installPrivateSkillProvider(ctx, host.application.ingestion)
  installMilitarySettings(ctx, host, privateSkillRemote)
  const report = await host.application.compatibility.probe(new AbortController().signal)
  if (effective.strictCompatibility && report.disposition !== 'READY') {
    disposeServices(); await host.close()
    throw new Error(`dsh-military requires DSH 0.1.1-rc.2 capabilities: ${report.blockers.join('; ')}`)
  }
  ctx.logger.info(`dsh-military ${report.disposition}; RC.2=${report.dsh.commit}; generation=${factory.presetManifest.generation}`)
  ctx.effect(() => () => {
    disposeServices()
    void host.close().catch(error => ctx.logger.error('dsh-military host shutdown failed', error))
  }, 'dsh-military-host')
}
