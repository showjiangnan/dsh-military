#!/usr/bin/env node
import { installMilitaryPreset, uninstallMilitaryPreset, verifyMilitaryPreset } from './index.js'

const [command = 'install', ...args] = process.argv.slice(2)
const homeIndex = args.indexOf('--dsh-home')
const binIndex = args.indexOf('--dsh-bin')
const rootIndex = args.indexOf('--preset-root')
const dshHome = homeIndex >= 0 ? args[homeIndex + 1] : process.env.DSH_HOME
if (dshHome === undefined || dshHome.trim() === '') {
  console.error('usage: dsh-military-install <install|verify|uninstall> --dsh-home <path> [--dsh-bin <path>] [--preset-root <system-root>] [--force]')
  process.exitCode = 2
} else {
  const presetRoot = rootIndex >= 0 ? args[rootIndex + 1] : undefined
  const dshBin = binIndex >= 0 ? args[binIndex + 1] : undefined
  const options = {
    dshHome,
    ...(dshBin === undefined ? {} : { dshBin }),
    ...(presetRoot === undefined ? {} : { presetRoot }),
    force: args.includes('--force'),
  }
  try {
    if (command === 'install') console.log(JSON.stringify(await installMilitaryPreset(options), null, 2))
    else if (command === 'verify') {
      const target = presetRoot ?? `${dshHome}/.agent-presets/military`
      const receipt = await verifyMilitaryPreset(target)
      if (receipt === null) throw new Error('verification failed')
      console.log(JSON.stringify(receipt, null, 2))
    } else if (command === 'uninstall') await uninstallMilitaryPreset(options)
    else throw new Error(`unknown command ${command}`)
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  }
}
