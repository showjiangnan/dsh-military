import assert from 'node:assert/strict'
import {
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  MilitaryError,
  brand,
  type AgentExecutionBinding,
  type AgentIdentity,
} from '@dsh-military/contracts'
import { sha256, stableJson } from '@dsh-military/core'
import { workspaceTools } from '@dsh-military/tools'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity, task } from './helpers.js'

test('Task-rooted workspace tools read, search, mutate and replay exact receipts', async () => {
  const temporary = await temporaryDirectory('military-workspace-tools-')
  const root = join(temporary.path, 'worktree')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'main.ts'), 'const value = 1\n', 'utf8')
  const fixture = workspaceFixture(root)
  try {
    const read = tool(fixture.context, 'military_workspace_read')
    const before = await read.execute(
      { path: 'src/main.ts' },
      execution(fixture.agent, 'read-1'),
    ) as unknown as {
      readonly path: string
      readonly lines: readonly { readonly text: string }[]
    }
    assert.equal(before.path, 'src/main.ts')
    assert.equal(before.lines[0]?.text, 'const value = 1')

    const search = tool(fixture.context, 'military_workspace_search')
    const matches = await search.execute(
      { query: 'value', path: 'src' },
      execution(fixture.agent, 'search-1'),
    ) as unknown as { readonly matches: readonly { readonly path: string }[] }
    assert.deepEqual(matches.matches.map(value => value.path), ['src/main.ts'])

    const write = tool(fixture.context, 'military_workspace_write')
    const created = await write.execute({
      path: 'src/generated.ts',
      content: 'export const generated = true\n',
    }, execution(fixture.agent, 'write-1')) as unknown as {
      readonly operationId: string
      readonly replayed: boolean
      readonly receiptState: string
    }
    assert.equal(created.receiptState, 'COMPLETED')
    assert.equal(created.replayed, false)
    assert.equal(
      await readFile(join(root, 'src', 'generated.ts'), 'utf8'),
      'export const generated = true\n',
    )
    const replay = await write.execute({
      path: 'src/generated.ts',
      content: 'export const generated = true\n',
    }, execution(fixture.agent, 'write-1')) as unknown as {
      readonly operationId: string
      readonly replayed: boolean
    }
    assert.equal(replay.operationId, created.operationId)
    assert.equal(replay.replayed, true)
    await assert.rejects(
      write.execute({
        path: 'src/generated.ts',
        content: 'changed under the same call id',
      }, execution(fixture.agent, 'write-1')),
      militaryFailure('IDEMPOTENCY_CONFLICT'),
    )

    const edit = tool(fixture.context, 'military_workspace_edit')
    const edited = await edit.execute({
      path: 'src/main.ts',
      oldText: 'value = 1',
      newText: 'value = 2',
    }, execution(fixture.agent, 'edit-1')) as unknown as {
      readonly replacements: number
      readonly replayed: boolean
    }
    assert.equal(edited.replacements, 1)
    assert.equal(edited.replayed, false)
    assert.equal(
      await readFile(join(root, 'src', 'main.ts'), 'utf8'),
      'const value = 2\n',
    )

    const status = tool(
      fixture.context,
      'military_workspace_operation_status',
    )
    const receipt = await status.execute({
      operationId: created.operationId,
    }, execution(fixture.agent, 'status-1')) as unknown as {
      readonly state: string
      readonly result: { readonly path: string }
    }
    assert.equal(receipt.state, 'COMPLETED')
    assert.equal(receipt.result.path, 'src/generated.ts')
  } finally {
    await temporary.dispose()
  }
})

test('Task-rooted workspace tools reject escapes, forbidden paths and symlink traversal', async () => {
  const temporary = await temporaryDirectory('military-workspace-scope-')
  const root = join(temporary.path, 'worktree')
  const outside = join(temporary.path, 'outside')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'secret\n', 'utf8')
  await symlink(outside, join(root, 'src', 'linked'))
  const fixture = workspaceFixture(root)
  try {
    const write = tool(fixture.context, 'military_workspace_write')
    for (const path of [
      '../escape.ts',
      '/absolute.ts',
      '.git/config',
      'docs/outside.ts',
      'src/linked/overwrite.txt',
    ]) {
      await assert.rejects(
        write.execute(
          { path, content: 'forbidden\n' },
          execution(fixture.agent, `write-${sha256(path).slice(0, 8)}`),
        ),
        error => error instanceof MilitaryError
          || (
            error instanceof Error
            && JSON.parse(error.message).error.code === 'FORBIDDEN_SCOPE'
          ),
      )
    }
    assert.equal(
      await readFile(join(outside, 'secret.txt'), 'utf8'),
      'secret\n',
    )
  } finally {
    await temporary.dispose()
  }
})

function workspaceFixture(root: string): {
  readonly context: Context
  readonly agent: Agent
} {
  const agent = { id: 'worker-workspace-tools' } as unknown as Agent
  const worker = identity('worker') as AgentIdentity
  const order = task(undefined, 'task-workspace-tools', ['src'])
  const binding = {
    tenantId: 'tenant-1',
    agent: worker,
    workspace: {
      leaseId: 'lease-workspace-tools',
      snapshotId: 'snapshot-workspace-tools',
      taskId: String(order.taskId),
      taskVersion: Number(order.taskVersion),
      executionRootHash: brand<string, 'Sha256'>('a'.repeat(64)),
    },
  } as unknown as AgentExecutionBinding
  const receipts = new Map<string, {
    readonly fingerprint: string
    readonly value: unknown
  }>()
  const host = {
    tenantId: 'tenant-1',
    identities: {
      require(candidate: Agent) {
        assert.equal(candidate, agent)
        return worker
      },
    },
    application: {
      executionBindings: {
        async forAgent() { return binding },
      },
      runtime: {
        async getTask() { return order },
      },
      workspaces: {
        executionPath() { return root },
      },
    },
    async runTerminalMutation<T>(input: {
      readonly actionKey: string
      readonly fingerprint: string
      readonly operation: () => Promise<T>
    }) {
      const prior = receipts.get(input.actionKey)
      if (prior !== undefined) {
        if (prior.fingerprint !== input.fingerprint) {
          throw new MilitaryError('IDEMPOTENCY_CONFLICT')
        }
        return { value: prior.value as T, replayed: true }
      }
      const value = await input.operation()
      receipts.set(input.actionKey, {
        fingerprint: input.fingerprint,
        value: JSON.parse(stableJson(value)) as unknown,
      })
      return { value, replayed: false }
    },
    readMutationReceipt<T>(_identity: AgentIdentity, actionKey: string) {
      return (receipts.get(actionKey) ?? null) as {
        readonly fingerprint: string
        readonly value: T
      } | null
    },
  }
  return {
    context: { militaryHost: host } as unknown as Context,
    agent,
  }
}

function tool(context: Context, name: string) {
  const definition = workspaceTools(context).find(value => value.name === name)
  assert.ok(definition, `missing ${name}`)
  return definition
}

function execution(agent: Agent, callId: string): ToolRunContext {
  return {
    agent,
    callId,
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
}

function militaryFailure(code: string): (error: unknown) => boolean {
  return error => {
    if (error instanceof MilitaryError) return error.failure.code === code
    if (!(error instanceof Error)) return false
    try {
      return (JSON.parse(error.message) as {
        readonly error?: { readonly code?: string }
      }).error?.code === code
    } catch {
      return false
    }
  }
}
