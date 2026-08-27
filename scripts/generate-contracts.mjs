import { cp, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'

await run('python3', ['docs/scripts/generate_contract_artifacts.py'])
await run('python3', ['docs/scripts/generate_error_artifacts.py'])
await mkdir('packages/contracts/src', { recursive: true })
await cp('docs/reference/types/generated-event-catalog.ts', 'packages/contracts/src/generated-event-catalog.ts')
await cp('docs/reference/types/generated-error-catalog.ts', 'packages/contracts/src/generated-error-catalog.ts')
await cp('docs/contracts/event-catalog.json', 'packages/contracts/catalogs/event-catalog.json')
await cp('docs/contracts/error-catalog.json', 'packages/contracts/catalogs/error-catalog.json')
await cp('docs/schemas', 'packages/contracts/schemas', { recursive: true, force: true })
console.log('Generated contracts synchronized from the canonical document engineering catalogs.')

function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)))
  })
}
