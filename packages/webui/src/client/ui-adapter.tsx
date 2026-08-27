import {
  createElement,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import {
  Pill,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Thin layout adapters; visual authority remains the RC.2 primitives/tokens. */
export function FormField(props: {
  readonly label: string
  readonly hint?: string
  readonly error?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      {props.children}
      {props.hint === undefined ? null : <small style={hintStyle}>{props.hint}</small>}
      {props.error === undefined ? null : (
        <small role="alert" style={fieldErrorStyle}>{props.error}</small>
      )}
    </label>
  )
}

export function Input(
  props: InputHTMLAttributes<HTMLInputElement>,
): ReactNode {
  return <input {...props} className={joinClass('dshm-native-input', props.className)} />
}

export function Select(
  props: SelectHTMLAttributes<HTMLSelectElement>,
): ReactNode {
  return <select {...props} className={joinClass('dshm-native-select', props.className)} />
}

export function TextArea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
): ReactNode {
  return <textarea {...props} className={joinClass('dshm-native-textarea', props.className)} />
}

export function Notice(props: {
  readonly title?: string
  readonly state?: StateDotState
  readonly tone?: 'neutral' | 'warning' | 'error'
  readonly children: ReactNode
}): ReactNode {
  return (
    <div
      role={props.tone === 'error' ? 'alert' : 'status'}
      style={{
        ...noticeStyle,
        ...(props.tone === 'error' ? errorNoticeStyle : {}),
      }}
    >
      {props.title === undefined ? null : (
        <div style={toolbarStyle}>
          {props.state === undefined ? null : <StateDot state={props.state} />}
          <strong>{props.title}</strong>
        </div>
      )}
      {props.children}
    </div>
  )
}

export function Section(props: {
  readonly title: string
  readonly description?: string
  readonly status?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <section style={sectionStyle}>
      <header style={toolbarStyle}>
        <div>
          <h3 style={headingStyle}>{props.title}</h3>
          {props.description === undefined ? null : (
            <p style={hintStyle}>{props.description}</p>
          )}
        </div>
        {props.status === undefined ? null : <Pill>{props.status}</Pill>}
      </header>
      {props.children}
    </section>
  )
}

export function Toolbar(props: {
  readonly label: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <div role="toolbar" aria-label={props.label} style={toolbarStyle}>
      {props.children}
    </div>
  )
}

export function AsyncBoundary(props: {
  readonly loading: boolean
  readonly error?: Error
  readonly stale?: boolean
  readonly loadingLabel?: string
  readonly children: ReactNode
}): ReactNode {
  if (props.loading) {
    return (
      <div role="status" aria-busy="true" style={noticeStyle}>
        <StateDot state="ongoing" />
        {props.loadingLabel ?? '正在读取 Host 权威状态…'}
      </div>
    )
  }
  return (
    <div style={contentsStyle}>
      {props.error === undefined ? null : (
        <Notice title="读取失败" tone="error" state="error">
          <span>{props.error.message}</span>
          {props.stale === true ? <span>已保留最后一次成功快照。</span> : null}
        </Notice>
      )}
      {props.children}
    </div>
  )
}

const contentsStyle: CSSProperties = { display: 'contents' }

function joinClass(left: string, right?: string): string {
  return right === undefined || right.trim() === '' ? left : `${left} ${right}`
}

const fieldStyle: CSSProperties = { display: 'grid', gap: 5, minWidth: 0 }
const hintStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  overflowWrap: 'anywhere',
}
const fieldErrorStyle: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary)',
}
const noticeStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
}
const errorNoticeStyle: CSSProperties = {
  borderColor: 'var(--dsw-alias-state-error-primary)',
  background: 'var(--dsw-alias-state-error-bg)',
}
const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
}
const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
}
const headingStyle: CSSProperties = { margin: 0, fontSize: 15 }
