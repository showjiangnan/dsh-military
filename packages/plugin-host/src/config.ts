import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

export interface Config {
  readonly tenantId: string
  readonly dataRoot: string
  readonly repositoryRoot: string
  readonly presetAssetsRoot: string
  readonly databasePath?: string
  readonly strictCompatibility: boolean
  /** RC.2 continuable-subagent provider (normally the in-process spawn provider). */
  readonly subagentProvider: string
  readonly maxRadioAttempts: number
  readonly radioLeaseSeconds: number
  readonly regressionChecks: readonly (readonly string[])[]
}

export const Config = z.object({
  tenantId: z.string().default('local'),
  dataRoot: z.string().default('.dsh-military'),
  repositoryRoot: z.string().default('.'),
  presetAssetsRoot: z.string().default(''),
  databasePath: z.string(),
  strictCompatibility: z.boolean().default(true),
  subagentProvider: z.string().default('spawn'),
  maxRadioAttempts: z.number().min(1).max(32).step(1).default(5),
  radioLeaseSeconds: z.number().min(10).max(3600).step(1).default(120),
  regressionChecks: z.array(z.array(z.string())).default([
    ['git', 'diff', '--check'],
  ]),
}) as unknown as Schema<Config>
