import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
const id='@dsh-military/bundle'
await mkdir('packages/webui/lib',{recursive:true})
await build({
  entryPoints:['packages/webui/src/client/index.tsx'],
  outfile:'packages/webui/lib/client.cjs',
  bundle:true,
  platform:'browser',
  format:'cjs',
  target:'es2023',
  jsx:'transform',
  jsxFactory:'createElement',
  external:['react'],
  banner:{js:`window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`},
  footer:{js:'return module.exports; } });'},
  logLevel:'silent',
})
