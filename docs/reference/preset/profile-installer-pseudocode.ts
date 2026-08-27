/**
 * RC.2 reference pseudocode. Concrete profile I/O remains adapter-owned.
 * This code demonstrates complete-row preservation, conflict detection,
 * revision fencing and rollback; it is not a runnable DSH API implementation.
 */
interface PresetRoot { readonly path: string; readonly trust: 'system' | 'user' }
interface AgentPresetsRowConfig {
  readonly default: string
  readonly roots: readonly PresetRoot[]
  readonly includeUserRoot: boolean
}
interface ProfileSnapshot {
  readonly revision: string
  readonly agentPresets: AgentPresetsRowConfig
}
interface GenerationManifest {
  readonly presetId: 'military'
  readonly generation: string
  readonly assetHash: string
}
interface InstallReceipt {
  readonly previousRevision: string
  readonly newRevision: string
  readonly generation: string
  readonly rollbackRef: string
}

export function withMilitaryPresetRoot(
  current: AgentPresetsRowConfig,
  resolvedMilitaryRoot: string,
): AgentPresetsRowConfig {
  const roots = current.roots.some(root => root.path === resolvedMilitaryRoot)
    ? current.roots
    : [...current.roots, { path: resolvedMilitaryRoot, trust: 'system' as const }]

  // DSH profile patches replace the row's complete config. Preserve all fields
  // and never make military the deployment default without a separate user write.
  return { ...current, roots }
}

export async function installMilitaryPreset(
  profile: ProfileSnapshot,
  resolvedMilitaryRoot: string,
  generation: GenerationManifest,
  io: {
    detectPresetId(root: PresetRoot, id: string): Promise<boolean>
    installGeneration(manifest: GenerationManifest): Promise<void>
    writeProfileCas(expectedRevision: string, config: AgentPresetsRowConfig): Promise<string>
    probeRc8(): Promise<'READY'>
    restoreProfile(snapshot: ProfileSnapshot): Promise<void>
    createRollbackSnapshot(snapshot: ProfileSnapshot): Promise<string>
  },
): Promise<InstallReceipt> {
  for (const root of profile.agentPresets.roots) {
    if (await io.detectPresetId(root, 'military')) {
      throw new Error(`PRESET_ID_CONFLICT: military already supplied by ${root.path}`)
    }
  }

  const rollbackRef = await io.createRollbackSnapshot(profile)
  try {
    await io.installGeneration(generation)
    const completeConfig = withMilitaryPresetRoot(profile.agentPresets, resolvedMilitaryRoot)
    const newRevision = await io.writeProfileCas(profile.revision, completeConfig)
    await io.probeRc8()
    return {
      previousRevision: profile.revision,
      newRevision,
      generation: generation.generation,
      rollbackRef,
    }
  } catch (error) {
    await io.restoreProfile(profile)
    throw error
  }
}
