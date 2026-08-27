import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { brand, type IntegrationOrder, type WorkspaceLease } from '@dsh-military/contracts'
import {
  GitWorktreeManager,
  InMemoryWorkspaceStateStore,
  LocalArtifactStore,
  LocalMainGit,
  LocalMainIntegration,
  SpecsEngineering,
  requireProcess,
  type IntegrationStateStore,
} from '@dsh-military/infrastructure'
import {
  SqliteIntegrationStateStore,
  SqliteMilitaryDatabase,
} from '@dsh-military/storage-sqlite'
import { temporaryDirectory } from '@dsh-military/testkit'
import { identity, stamp } from './helpers.js'

test('Engineer initializes specs and commits only to local main', async () => {
  const temp = await temporaryDirectory('military-specs-')
  try {
    const specs = new SpecsEngineering(temp.path)
    const receipt = await specs.initialize(new AbortController().signal)
    assert.notEqual(receipt.commit, 'UNBORN')
    assert.match(await specs.read('specs/00-mission/mission-intent.md'), /Mission Intent/u)
    const git = new LocalMainGit(temp.path)
    assert.equal((await git.statusPaths()).length, 0)
  } finally { await temp.dispose() }
})

test('an exact Specs terminal retry recovers its committed order without a second Git mutation', async () => {
  const temp = await temporaryDirectory('military-specs-terminal-retry-')
  try {
    const specs = new SpecsEngineering(temp.path)
    await specs.initialize(new AbortController().signal)
    const document = 'specs/retry-proof.md'
    const order = {
      schemaVersion: '1.0.0',
      orderId: 'specs-terminal-retry',
      missionId: 'mission-terminal-retry',
      trigger: { kind: 'manual', ref: 'terminal-retry' },
      requiredUpdates: [{ document, purpose: 'Prove crash-safe terminal retry.' }],
      allowedPaths: [document],
      validation: ['git diff --check'],
      commitPolicy: {
        branch: 'main',
        localOnly: true,
        messageTemplate: 'docs(specs): retry proof',
        requireCleanNonSpecsPaths: true,
      },
      issuedAt: stamp(),
    } as const
    const content = { [document]: '# Retry proof\n\nOne exact terminal transaction.\n' }
    const first = await specs.apply(order, content, new AbortController().signal)
    const replay = await new SpecsEngineering(temp.path).apply(
      { ...order, issuedAt: new Date(Date.now() + 60_000).toISOString() },
      content,
      new AbortController().signal,
    )
    assert.equal(replay.commit, first.commit)
    assert.equal(replay.treeHash, first.treeHash)
    assert.deepEqual(replay.changedPaths, first.changedPaths)
    const count = await requireProcess('git', [
      'log',
      '--fixed-strings',
      '--grep=DSH-Military-Specs-Order: specs-terminal-retry',
      '--format=%H',
    ], { cwd: temp.path })
    assert.equal(count.stdout.trim().split('\n').filter(Boolean).length, 1)
  } finally {
    await temp.dispose()
  }
})

test('Git scope observes exact files inside a new untracked directory', async () => {
  const temp = await temporaryDirectory('military-untracked-scope-')
  try {
    const git = new LocalMainGit(temp.path)
    await git.ensureRepository()
    await writeFile(`${temp.path}/README.md`, '# base\n')
    await git.commitLocalMain({ message: 'chore: base', allowedPaths: ['README.md'] })
    await mkdir(`${temp.path}/specs`, { recursive: true })
    await writeFile(`${temp.path}/specs/exact.md`, '# Exact\n')
    assert.deepEqual(await git.statusPaths(), ['specs/exact.md'])
    const receipt = await git.commitLocalMain({
      message: 'docs(specs): exact file scope',
      allowedPaths: ['specs/exact.md'],
    })
    assert.deepEqual(receipt.changedPaths, ['specs/exact.md'])
  } finally {
    await temp.dispose()
  }
})

test('an absolute Session workspace overrides the process fallback repository', async () => {
  const temp = await temporaryDirectory('military-session-workspace-')
  try {
    const pluginSource = `${temp.path}/plugin-source`
    const sessionWorkspace = `${temp.path}/session-workspace`
    await mkdir(pluginSource, { recursive: true })
    await writeFile(`${pluginSource}/sentinel.txt`, 'plugin source must stay untouched\n')
    const sessionGit = new LocalMainGit(sessionWorkspace)
    await sessionGit.ensureRepository()
    await writeFile(`${sessionWorkspace}/README.md`, '# session workspace\n')
    await sessionGit.commitLocalMain({
      message: 'chore: session fixture',
      allowedPaths: ['README.md'],
    })
    const workspaces = new GitWorktreeManager({
      repositoryRoot: pluginSource,
      stateRoot: `${temp.path}/state`,
      artifacts: new LocalArtifactStore(`${temp.path}/artifacts`),
    })
    const snapshot = await workspaces.snapshot({
      tenantId: 'tenant-1',
      workspaceKey: sessionWorkspace,
      signal: new AbortController().signal,
    })
    assert.equal(workspaces.repositoryPath(snapshot.workspaceSnapshotId), sessionWorkspace)
    assert.deepEqual(workspaces.snapshotById(snapshot.workspaceSnapshotId), snapshot)
    await assert.rejects(stat(`${pluginSource}/.git`), error =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
    assert.equal(
      await readFile(`${pluginSource}/sentinel.txt`, 'utf8'),
      'plugin source must stay untouched\n',
    )
  } finally {
    await temp.dispose()
  }
})

test('write task uses isolated worktree, CandidatePatch and controlled local-main integration', async () => {
  const temp = await temporaryDirectory('military-worktree-')
  try {
    const repository = `${temp.path}/repo`
    const integrationRoot = `${temp.path}/integration-root`
    const outsideSentinel = `${temp.path}/must-survive`
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const git = new LocalMainGit(repository)
    await git.ensureRepository()
    await mkdir(`${repository}/src`, { recursive: true })
    await writeFile(`${repository}/src/base.txt`, 'base\n', 'utf8')
    await git.commitLocalMain({ message: 'chore: initial', allowedPaths: ['src'] })

    const workspaces = new GitWorktreeManager({ repositoryRoot: repository, stateRoot: `${temp.path}/state`, artifacts })
    const snapshot = await workspaces.snapshot({ tenantId: 'tenant-1', workspaceKey: 'workspace-1', signal: new AbortController().signal })
    const lease: WorkspaceLease = {
      schemaVersion: '1.0.0', workspaceLeaseId: 'lease-1', tenantId: 'tenant-1', missionId: 'mission-1',
      taskId: 'task-1', taskVersion: 1, agent: identity('worker'), workspaceSnapshotId: snapshot.workspaceSnapshotId,
      mode: 'WRITE', pathScope: { readPaths: ['.'], writePaths: ['src'], forbiddenPaths: ['.git'] },
      state: 'ACTIVE', leaseVersion: 1, acquiredAt: stamp(),
      expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
    }
    await workspaces.lease(lease)
    const worktree = workspaces.worktreePath(lease.workspaceLeaseId)
    await writeFile(`${worktree}/src/feature.txt`, 'verified feature\n', 'utf8')
    const patch = await workspaces.createCandidatePatch({ workspaceLeaseId: lease.workspaceLeaseId, candidateId: 'candidate-1', missionId: 'mission-1', taskId: 'task-1', taskVersion: 1, signal: new AbortController().signal })
    assert.deepEqual(patch.changedPaths, ['src/feature.txt'])
    await mkdir(outsideSentinel)
    await writeFile(`${outsideSentinel}/sentinel.txt`, 'never delete\n', 'utf8')

    const integration = new LocalMainIntegration({
      repositoryRoot: repository,
      integrationRoot,
      workspaces,
      artifacts,
      regressionChecks: [['git', 'diff', '--check']],
    })
    const order: IntegrationOrder = {
      schemaVersion: '1.0.0', integrationOrderId: '../../must-survive', missionId: 'mission-1', taskId: 'task-1', taskVersion: 1,
      candidatePatchId: patch.candidatePatchId, expectedHead: snapshot.git.head, expectedTreeHash: snapshot.git.treeHash,
      targetBranch: 'main', conflictPolicy: 'STOP_AND_REPORT', verifierProfileRefs: ['verifier-default@1'], authorizedBy: 'harness', createdAt: stamp(),
    }
    await integration.queue(order)
    await integration.queue({
      ...order,
      createdAt: new Date(Date.now() + 60_000).toISOString() as IntegrationOrder['createdAt'],
    })
    const receipt = await integration.execute(order.integrationOrderId, new AbortController().signal)
    assert.equal(receipt.disposition, 'APPLIED')
    assert.equal(await readFile(`${repository}/src/feature.txt`, 'utf8'), 'verified feature\n')
    assert.equal(
      await readFile(`${outsideSentinel}/sentinel.txt`, 'utf8'),
      'never delete\n',
    )
    await workspaces.release(lease.workspaceLeaseId)
  } finally { await temp.dispose() }
})

test('workspace reconciliation quarantines a persisted path outside the managed worktree root', async () => {
  const temp = await temporaryDirectory('military-worktree-quarantine-')
  try {
    const repository = `${temp.path}/repo`
    const stateRoot = `${temp.path}/state`
    const outside = `${temp.path}/must-survive`
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const git = new LocalMainGit(repository)
    await git.ensureRepository()
    await writeFile(`${repository}/base.txt`, 'base\n', 'utf8')
    await git.commitLocalMain({
      message: 'chore: quarantine fixture',
      allowedPaths: ['base.txt'],
    })
    await mkdir(outside)
    await writeFile(`${outside}/sentinel.txt`, 'do not delete\n', 'utf8')
    const state = new InMemoryWorkspaceStateStore()
    const initial = new GitWorktreeManager({
      repositoryRoot: repository,
      stateRoot,
      artifacts,
      state,
    })
    const snapshot = await initial.snapshot({
      tenantId: 'tenant-quarantine',
      workspaceKey: repository,
      signal: new AbortController().signal,
    })
    const lease: WorkspaceLease = {
      schemaVersion: '1.0.0',
      workspaceLeaseId: 'lease-quarantine',
      tenantId: 'tenant-quarantine',
      missionId: 'mission-quarantine',
      taskId: 'task-quarantine',
      taskVersion: 1,
      agent: identity('worker'),
      workspaceSnapshotId: snapshot.workspaceSnapshotId,
      mode: 'WRITE',
      pathScope: {
        readPaths: ['.'],
        writePaths: ['.'],
        forbiddenPaths: ['.git'],
      },
      state: 'ACTIVE',
      leaseVersion: 1,
      acquiredAt: stamp(),
      expiresAt: brand<string, 'IsoDateTime'>(
        new Date(Date.now() + 60_000).toISOString(),
      ),
    }
    state.putLease({
      lease,
      phase: 'PREPARING',
      worktreePath: outside,
      updatedAt: stamp(),
    })

    const recovered = new GitWorktreeManager({
      repositoryRoot: repository,
      stateRoot,
      artifacts,
      state,
    })
    await recovered.reconcile(new AbortController().signal)
    assert.equal(
      await readFile(`${outside}/sentinel.txt`, 'utf8'),
      'do not delete\n',
    )
    const quarantined = state.listLeases().find(value =>
      value.lease.workspaceLeaseId === lease.workspaceLeaseId)
    assert.equal(quarantined?.phase, 'RECOVERY_REQUIRED')
    assert.equal(
      quarantined?.recoveryReason,
      'WORKTREE_PATH_OUTSIDE_MANAGED_ROOT',
    )
    assert.throws(
      () => recovered.executionPath(lease.workspaceLeaseId),
      /workspace lease is not active/u,
    )
  } finally {
    await temp.dispose()
  }
})

test('Specs transaction validates before writes and rolls back failed validation', async () => {
  const temp = await temporaryDirectory('military-specs-rollback-')
  try {
    const specs = new SpecsEngineering(temp.path)
    await specs.initialize(new AbortController().signal)
    const git = new LocalMainGit(temp.path)
    const beforeHead = await git.head()
    const document = 'specs/00-mission/mission-intent.md'
    const original = await readFile(`${temp.path}/${document}`, 'utf8')
    const order = {
      schemaVersion: '1.0.0',
      orderId: 'specs-rollback',
      missionId: 'mission-specs-rollback',
      trigger: { kind: 'manual', ref: 'manual-specs-rollback' },
      requiredUpdates: [{ document, purpose: 'Exercise transactional rollback.' }],
      allowedPaths: ['specs'],
      validation: ['git diff --check'],
      commitPolicy: {
        branch: 'main',
        localOnly: true,
        messageTemplate: 'docs(specs): rollback fixture',
        requireCleanNonSpecsPaths: true,
      },
      issuedAt: stamp(),
    } as const

    await assert.rejects(
      specs.apply(order, { [document]: '# Mission Intent \n' }, new AbortController().signal),
      /specs validation failed/u,
    )
    assert.equal(await readFile(`${temp.path}/${document}`, 'utf8'), original)
    assert.equal(await git.head(), beforeHead)
    assert.deepEqual(await git.statusPaths(), [])

    await assert.rejects(
      specs.apply(
        { ...order, orderId: 'specs-command-denied', validation: ['pnpm test'] },
        { [document]: '# This must never be written\n' },
        new AbortController().signal,
      ),
      /not deployment-authorized/u,
    )
    assert.equal(await readFile(`${temp.path}/${document}`, 'utf8'), original)
    assert.equal(await git.head(), beforeHead)
    assert.deepEqual(await git.statusPaths(), [])
  } finally {
    await temp.dispose()
  }
})

test('integration reconciliation recovers a commit written before receipt persistence', async () => {
  const temp = await temporaryDirectory('military-integration-recovery-')
  let database: SqliteMilitaryDatabase | undefined
  try {
    const repository = `${temp.path}/repo`
    const artifacts = new LocalArtifactStore(`${temp.path}/artifacts`)
    const git = new LocalMainGit(repository)
    await git.ensureRepository()
    await mkdir(`${repository}/src`, { recursive: true })
    await writeFile(`${repository}/src/base.txt`, 'base\n', 'utf8')
    await git.commitLocalMain({ message: 'chore: recovery base', allowedPaths: ['src'] })
    const workspaces = new GitWorktreeManager({
      repositoryRoot: repository,
      stateRoot: `${temp.path}/state`,
      artifacts,
    })
    const signal = new AbortController().signal
    const snapshot = await workspaces.snapshot({
      tenantId: 'tenant-1',
      workspaceKey: 'workspace-recovery',
      signal,
    })
    const lease: WorkspaceLease = {
      schemaVersion: '1.0.0',
      workspaceLeaseId: 'lease-recovery',
      tenantId: 'tenant-1',
      missionId: 'mission-recovery',
      taskId: 'task-recovery',
      taskVersion: 1,
      agent: identity('worker'),
      workspaceSnapshotId: snapshot.workspaceSnapshotId,
      mode: 'WRITE',
      pathScope: { readPaths: ['.'], writePaths: ['src'], forbiddenPaths: ['.git'] },
      state: 'ACTIVE',
      leaseVersion: 1,
      acquiredAt: stamp(),
      expiresAt: brand<string, 'IsoDateTime'>(new Date(Date.now() + 60_000).toISOString()),
    }
    await workspaces.lease(lease)
    await writeFile(`${workspaces.worktreePath(lease.workspaceLeaseId)}/src/recovered.txt`, 'recovered\n', 'utf8')
    const patch = await workspaces.createCandidatePatch({
      workspaceLeaseId: lease.workspaceLeaseId,
      candidateId: 'candidate-recovery',
      missionId: lease.missionId,
      taskId: lease.taskId,
      taskVersion: lease.taskVersion,
      signal,
    })
    const order: IntegrationOrder = {
      schemaVersion: '1.0.0',
      integrationOrderId: 'integration-recovery',
      missionId: lease.missionId,
      taskId: lease.taskId,
      taskVersion: lease.taskVersion,
      candidatePatchId: patch.candidatePatchId,
      expectedHead: snapshot.git.head,
      expectedTreeHash: snapshot.git.treeHash,
      targetBranch: 'main',
      conflictPolicy: 'STOP_AND_REPORT',
      verifierProfileRefs: [],
      authorizedBy: 'harness',
      createdAt: stamp(),
    }
    const databasePath = `${temp.path}/military.sqlite`
    database = new SqliteMilitaryDatabase({ path: databasePath })
    const durable = new SqliteIntegrationStateStore(database, 'tenant-1')
    let injectFailure = true
    const faulty: IntegrationStateStore = {
      queue: orderValue => durable.queue(orderValue),
      read: id => durable.read(id),
      acquire: (id, startedAt) => durable.acquire(id, startedAt),
      checkpoint: (id, input) => durable.checkpoint(id, input),
      async complete(id, receipt) {
        if (injectFailure) {
          injectFailure = false
          throw new Error('fault after Git commit before receipt persistence')
        }
        await durable.complete(id, receipt)
      },
      requeue: id => durable.requeue(id),
      running: () => durable.running(),
    }
    const interrupted = new LocalMainIntegration({
      repositoryRoot: repository,
      workspaces,
      artifacts,
      state: faulty,
    })
    await interrupted.queue(order)
    await assert.rejects(
      interrupted.execute(order.integrationOrderId, signal),
      /fault after Git commit before receipt persistence/u,
    )
    assert.match(
      (await requireProcess('git', ['show', '-s', '--format=%B', 'HEAD'], { cwd: repository })).stdout,
      /DSH-Military-Integration-Order: integration-recovery/u,
    )
    database.close()
    database = new SqliteMilitaryDatabase({ path: databasePath })
    const recovered = new LocalMainIntegration({
      repositoryRoot: repository,
      workspaces,
      artifacts,
      state: new SqliteIntegrationStateStore(database, 'tenant-1'),
    })
    await recovered.reconcilePending(signal)
    const receipt = await recovered.get(order.integrationOrderId)
    assert.equal(receipt?.disposition, 'APPLIED')
    assert.equal(receipt?.commit, (await git.head(signal)))
    assert.equal(await readFile(`${repository}/src/recovered.txt`, 'utf8'), 'recovered\n')
    assert.equal(
      Number((await requireProcess('git', ['rev-list', '--count', `${order.expectedHead}..HEAD`], {
        cwd: repository,
      })).stdout.trim()),
      1,
    )
    await workspaces.release(lease.workspaceLeaseId)
  } finally {
    database?.close()
    await temp.dispose()
  }
})
