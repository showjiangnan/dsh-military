import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  localSingleUserWebPrincipal,
  MilitaryWorkspaceRemoteService,
  type MilitaryHostRuntime,
} from '@dsh-military/plugin-host'
import {
  SqliteMilitaryDatabase,
  SqliteMilitarySessionGate,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { militaryBinding } from './helpers.js'

const execute = promisify(execFile)

test('Specs workspace projection accepts only Host catalog ids and reports Git rename destinations', async () => {
  const temporary = await temporaryDirectory('military-workspace-control-')
  const project = join(temporary.path, 'project')
  const context = new Context()
  const database = new SqliteMilitaryDatabase({
    path: join(temporary.path, 'military.sqlite'),
  })
  try {
    await mkdir(project)
    await execute('git', ['init', '--initial-branch=main'], { cwd: project })
    await execute('git', ['config', 'user.name', 'Military Test'], { cwd: project })
    await execute('git', ['config', 'user.email', 'military@example.invalid'], { cwd: project })
    await writeFile(join(project, 'old-name.txt'), 'tracked\n', 'utf8')
    await execute('git', ['add', 'old-name.txt'], { cwd: project })
    await execute('git', ['commit', '-m', 'fixture'], { cwd: project })
    await rename(join(project, 'old-name.txt'), join(project, 'new-name.txt'))
    await execute('git', ['add', '-A'], { cwd: project })
    await writeFile(join(project, 'untracked.txt'), 'new\n', 'utf8')

    const gate = new SqliteMilitarySessionGate(database, 'tenant-workspace')
    const binding = {
      ...militaryBinding('workspace-session'),
      tenantId: 'tenant-workspace',
      workspaceKey: project,
    }
    database.db.prepare(`
      INSERT INTO preset_generations(
        generation, public_preset_id, hidden_archive_id, asset_hash,
        bundle_version, dsh_commit, status, manifest_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      binding.presetGeneration,
      'military',
      'archive-workspace',
      'asset-workspace',
      '0.9.0-alpha.25',
      binding.dshBaselineCommit,
      'CURRENT',
      '{}',
      String(binding.activatedAt),
    )
    await gate.bind(binding)
    const host = {
      tenantId: 'tenant-workspace',
      webPrincipal: localSingleUserWebPrincipal('tenant-workspace'),
      database,
      application: {
        workspaces: {
          executionPath() {
            throw new Error('no active lease in this fixture')
          },
        },
      },
    } as unknown as MilitaryHostRuntime
    const service = new MilitaryWorkspaceRemoteService(context, host)
    assert.equal(service.typertRemote.serviceKey, 'militaryWorkspace')
    assert.deepEqual(remoteMethods(service), [
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'execute', invocation: { kind: 'direct' } },
    ])

    const snapshot = await service.snapshot(AbortSignal.timeout(5_000))
    assert.equal(snapshot.workspaces.length, 1)
    const catalog = snapshot.workspaces[0]!
    assert.equal(catalog.canonicalRoot, await realpath(project))
    assert.equal(catalog.repository, true)
    assert.match(catalog.workspaceId, /^workspace-[a-f0-9]{32}$/u)

    const status = await service.execute({
      type: 'INSPECT_WORKSPACE',
      workspaceId: catalog.workspaceId,
      // This field is ignored by the narrow RPC; only the opaque id resolves
      // the canonical root.
      path: '/Users/attacker/escape',
    }, AbortSignal.timeout(5_000))
    assert.equal(status.git.available, true)
    assert.match(status.git.head ?? '', /^[a-f0-9]{40}$/u)
    assert.match(status.git.tree ?? '', /^[a-f0-9]{40}$/u)
    assert.equal(
      status.pathEntries.find(value => value.path === 'new-name.txt')?.gitState,
      'RENAMED',
    )
    assert.equal(
      status.pathEntries.find(value => value.path === 'untracked.txt')?.gitState,
      'UNTRACKED',
    )
    assert.equal(status.pathEntries.some(value => value.path === 'old-name.txt'), false)
    await assert.rejects(
      service.execute({
        type: 'INSPECT_WORKSPACE',
        workspaceId: 'workspace-deadbeefdeadbeefdeadbeefdeadbeef',
      }, AbortSignal.timeout(5_000)),
      /不再属于当前租户/u,
    )
  } finally {
    database.close()
    await context.fiber.dispose()
    await temporary.dispose()
  }
})
