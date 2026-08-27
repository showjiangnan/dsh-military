import { createElement } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ClientContext,
  SettingsScope,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  MilitarySettingsOverlay,
  MilitarySettingsTrigger,
  type MilitarySettingsScopes,
} from './settings-center.js'
import {
  KnowledgeCenterOverlay,
  KnowledgeCenterTrigger,
} from './knowledge-center.js'
import { installMilitaryUiStyles } from './native-ui.js'

const SETTINGS_NAMESPACES = [
  'military-model-routing',
  'military-agent-templates',
  'military-core',
  'military-staff',
  'military-tags',
  'military-tactics',
  'military-private-skills',
  'military-oversight',
  'military-specs',
  'military-memory',
  'military-evaluation',
  'military-presentation',
] as const

/**
 * RC.2 external plugins cannot append third-party Session event types to the
 * upstream known-event catalog. Military state is therefore rendered from its
 * durable settings/ledger surfaces instead of conversation-log event mirrors.
 */
export const inject = ['slots', 'settingsScope', 'connection']

export function apply(ctx: ClientContext): void {
  installMilitaryUiStyles()
  const connection = ctx.get('connection') as ConnectionHandle
  const additiveSlots = ctx.slots as unknown as AdditiveSlotFace
  const scopes = Object.fromEntries(SETTINGS_NAMESPACES.map(namespace => [
    namespace,
    ctx.settingsScope.bind<Record<string, unknown>>({ namespace }),
  ])) as unknown as MilitarySettingsScopes

  ctx.effect(() => additiveSlots.inject('sidebar.footer.action', () => additiveSlots.register({
    name: 'sidebar.footer.action',
    id: 'military-settings',
    order: 35,
    label: () => 'Military 设置与知识中心',
  }, props => {
    const wide = props.wide === true
    return (
      <div
        data-military-footer-actions="true"
        data-wide={String(wide)}
      >
        <MilitarySettingsTrigger wide={wide} />
        <KnowledgeCenterTrigger wide={wide} />
      </div>
    )
  })), 'dsh-military: native settings-sized sidebar actions')

  ctx.effect(() => additiveSlots.inject('shell.overlay', () => additiveSlots.register({
    name: 'shell.overlay',
    id: 'military-settings',
    order: 110,
    label: () => 'Military 设置中心',
  }, () => (
    <MilitarySettingsOverlay
      scopes={scopes}
      connection={connection}
    />
  ))), 'dsh-military: settings centre overlay')

  ctx.effect(() => additiveSlots.inject('shell.overlay', () => additiveSlots.register({
    name: 'shell.overlay',
    id: 'military-knowledge',
    order: 120,
    label: () => 'Military 知识与技能',
  }, () => (
    <KnowledgeCenterOverlay
      scope={scopes['military-private-skills']}
      connection={connection}
    />
  ))), 'dsh-military: knowledge centre overlay')
}

export type { MilitarySettingsScopes }
export type MilitarySettingsScope = SettingsScope<Record<string, unknown>>

interface AdditiveSlotFace {
  inject(key: string, callback: () => () => void): () => void
  register(
    options: {
      readonly name: string
      readonly id: string
      readonly order?: number
      readonly label?: string | (() => string)
    },
    component: (props: Readonly<Record<string, unknown>>) => ReturnType<typeof createElement> | null,
  ): () => void
}
