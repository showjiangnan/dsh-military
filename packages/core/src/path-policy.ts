import { MilitaryError } from '@dsh-military/contracts'

/**
 * Normalize one repository-relative path into a portable slash-separated form.
 * Absolute paths, drive-qualified paths, NUL bytes and parent traversal are
 * rejected before any lexical scope comparison is attempted.
 */
export function normalizeWorkspacePath(value: string): string {
  if (value.includes('\u0000')) throw new MilitaryError('FORBIDDEN_SCOPE', 'workspace path contains a NUL byte')
  const slashed = value.replace(/\\/gu, '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:\//u.test(slashed)) {
    throw new MilitaryError('FORBIDDEN_SCOPE', `absolute workspace path is forbidden: ${value}`)
  }
  const segments: string[] = []
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) throw new MilitaryError('FORBIDDEN_SCOPE', `workspace path escapes the root: ${value}`)
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/** Whether a relative path is equal to or nested below one allowed prefix. */
export function pathWithinAny(path: string, prefixes: readonly string[]): boolean {
  let normalized: string
  try { normalized = normalizeWorkspacePath(path) } catch { return false }
  return prefixes.some(prefix => {
    let normalizedPrefix: string
    try { normalizedPrefix = normalizeWorkspacePath(prefix) } catch { return false }
    if (normalizedPrefix === '') return true
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`)
  })
}

/** Whether two workspace scopes overlap by equality or ancestry. */
export function workspaceScopesOverlap(left: string, right: string): boolean {
  let a: string
  let b: string
  try {
    a = normalizeWorkspacePath(left)
    b = normalizeWorkspacePath(right)
  } catch {
    return false
  }
  if (a === '' || b === '') return true
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}
