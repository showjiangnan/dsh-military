import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const output = resolve(process.argv[2] ?? '../dsh-military-code-v0.9.0-alpha.28.zip')
const root = resolve('.')
const python = String.raw`import os,subprocess,sys,zipfile
root=os.path.abspath(sys.argv[1]); out=os.path.abspath(sys.argv[2])
# The source archive is exactly the Git-visible source set: tracked files plus
# new, non-ignored files. This makes .gitignore the single exclusion policy and
# prevents a preceding build/test/release run from leaking lib/, release/,
# caches, runtime databases, local reports or credentials into the archive.
listed=subprocess.check_output([
  'git','-C',root,'ls-files','-z','--cached','--others','--exclude-standard',
])
relative_entries=sorted(
  value.decode('utf-8','surrogateescape')
  for value in listed.split(b'\0') if value
)
entries=[]
for relative in relative_entries:
  path=os.path.abspath(os.path.join(root,relative))
  if os.path.commonpath((root,path)) != root:
    raise SystemExit('git reported a path outside the source root')
  if path == out or not os.path.isfile(path):
    continue
  entries.append((relative,path))
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
  for relative,path in entries:
    info=zipfile.ZipInfo(os.path.join(os.path.basename(root),relative).replace(os.sep,'/'))
    info.date_time=(2026,8,19,0,0,0); info.compress_type=zipfile.ZIP_DEFLATED
    info.external_attr=(0o100644 & 0xFFFF)<<16
    with open(path,'rb') as source: archive.writestr(info,source.read(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
print(out)
`
await run('python3', ['-c', python, root, output])
const bytes = await readFile(output)
const digest = createHash('sha256').update(bytes).digest('hex')
const shaPath = `${output}.sha256`
await writeFile(shaPath, `${digest}  ${basename(output)}\n`, 'utf8')
await run('python3', ['-m', 'zipfile', '-t', output])
const report = {
  schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), output,
  byteLength: bytes.byteLength, sha256: digest, rootFolder: basename(root),
}
await writeFile('PACK-REPORT.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile('PACK-REPORT.md', [
  '# Source Package Report', '', `Generated: ${report.generatedAt}`, '',
  `- Archive: \`${output}\``, `- Size: ${report.byteLength} bytes`,
  `- SHA-256: \`${digest}\``, `- Root folder: \`${report.rootFolder}/\``,
  '- ZIP integrity: PASS', '',
].join('\n'), 'utf8')
console.log(`${output}\n${shaPath}\n${digest}`)

function run(program, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${program} exited ${code}`)))
  })
}
