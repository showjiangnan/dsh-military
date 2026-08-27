import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { brand, isoNow, type IntegrationOrder, type WorkspaceLease } from '@dsh-military/contracts'
import { GitWorktreeManager, LocalArtifactStore, LocalMainGit, LocalMainIntegration, requireProcess } from '@dsh-military/infrastructure'
import { temporaryDirectory } from '@dsh-military/testkit'
import { missionId, worker } from './fixtures.js'

test('isolated worktree candidate patch integrates only after deterministic order', async () => {
  const temp = await temporaryDirectory()
  try {
    const repository = `${temp.path}/repo`
    await mkdir(`${repository}/src`, { recursive: true })
    const git = new LocalMainGit(repository)
    await git.ensureRepository()
    await writeFile(`${repository}/README.md`, '# fixture\n')
    await git.commitLocalMain({ message: 'chore: initial fixture', allowedPaths: ['README.md'] })
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const workspaces = new GitWorktreeManager({ repositoryRoot: repository, stateRoot: `${temp.path}/state`, artifacts })
    const signal = new AbortController().signal
    const snapshot = await workspaces.snapshot({ tenantId: 'tenant-test', workspaceKey: 'workspace-test', signal })
    const lease: WorkspaceLease = {
      schemaVersion: '1.0.0', workspaceLeaseId: 'lease-test', tenantId: 'tenant-test', missionId: String(missionId),
      taskId: 'task-test', taskVersion: 1, agent: worker, workspaceSnapshotId: snapshot.workspaceSnapshotId,
      mode: 'WRITE', pathScope: { readPaths: ['.'], writePaths: ['src'], forbiddenPaths: ['.git'] },
      state: 'ACTIVE', leaseVersion: 1, acquiredAt: isoNow(), expiresAt: new Date(Date.now() + 60_000).toISOString() as import('@dsh-military/contracts').IsoDateTime,
    }
    await workspaces.lease(lease)
    const worktree = workspaces.worktreePath(lease.workspaceLeaseId)
    await mkdir(`${worktree}/src`, { recursive: true })
    await writeFile(`${worktree}/src/new.ts`, 'export const value = 42\n')
    const patch = await workspaces.createCandidatePatch({
      workspaceLeaseId: lease.workspaceLeaseId, candidateId: 'candidate-test', missionId: String(missionId), taskId: 'task-test', taskVersion: 1, signal,
    })
    assert.deepEqual(patch.changedPaths, ['src/new.ts'])
    const integration = new LocalMainIntegration({ repositoryRoot: repository, workspaces, artifacts, regressionChecks: [['git', 'diff', '--check']] })
    const order: IntegrationOrder = {
      schemaVersion: '1.0.0', integrationOrderId: 'integration-test', missionId: String(missionId), taskId: 'task-test', taskVersion: 1,
      candidatePatchId: patch.candidatePatchId, targetBranch: 'main', expectedHead: snapshot.git.head, expectedTreeHash: snapshot.git.treeHash,
      conflictPolicy: 'STOP_AND_REPORT', verifierProfileRefs: ['verifier:test'], authorizedBy: 'general-test', createdAt: isoNow(),
    }
    await integration.queue(order)
    const receipt = await integration.execute(order.integrationOrderId, signal)
    assert.equal(receipt.disposition, 'APPLIED')
    const content = (await requireProcess('git', ['show', 'HEAD:src/new.ts'], { cwd: repository })).stdout
    assert.match(content, /value = 42/u)
    await workspaces.release(lease.workspaceLeaseId)
  } finally { await temp.dispose() }
})
