import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const requirements = resolve('docs/scripts/requirements-validation.txt')
const requirementBytes = await readFile(requirements)
const requirementHash = createHash('sha256').update(requirementBytes).digest('hex')
const environmentRoot = resolve('.cache', 'docs-validation-python', requirementHash)
const python = process.platform === 'win32'
  ? join(environmentRoot, 'Scripts', 'python.exe')
  : join(environmentRoot, 'bin', 'python')
const readyMarker = join(environmentRoot, '.dsh-military-ready')

if (!await isReady()) {
  await mkdir(resolve('.cache', 'docs-validation-python'), { recursive: true })
  await run(process.env.PYTHON ?? 'python3', ['-m', 'venv', environmentRoot])
  await run(python, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--requirement',
    requirements,
  ])
  await run(python, [
    '-c',
    'import jsonschema, referencing, yaml; print("documentation validator dependencies ready")',
  ])
  await writeFile(readyMarker, `${requirementHash}\n`, 'utf8')
}

await run(python, ['docs/scripts/validate_artifacts.py', ...process.argv.slice(2)])

async function isReady() {
  try {
    return (await readFile(readyMarker, 'utf8')).trim() === requirementHash
      && (await stat(python)).isFile()
  } catch {
    return false
  }
}

function run(program, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${program} exited ${String(code)}`))
    })
  })
}
