import { spawn } from 'node:child_process'
import { MilitaryError } from '@dsh-military/contracts'

export interface ProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly signal?: AbortSignal; readonly env?: Readonly<Record<string, string>>; readonly input?: string },
): Promise<ProcessResult> {
  if (options.signal?.aborted === true) throw options.signal.reason
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }))
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

export async function requireProcess(
  command: string,
  args: readonly string[],
  options: Parameters<typeof runProcess>[2],
  errorCode: 'GIT_COMMIT_FAILED' | 'PERSISTENCE_FAILED' = 'PERSISTENCE_FAILED',
): Promise<ProcessResult> {
  const result = await runProcess(command, args, options)
  if (result.exitCode !== 0) {
    throw new MilitaryError(errorCode, `${command} ${args.join(' ')} failed`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 8192),
    })
  }
  return result
}
