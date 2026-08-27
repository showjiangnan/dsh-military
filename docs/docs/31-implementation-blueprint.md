# 实现蓝图

## 1. 第一个可运行切片

```text
Fixed military preset assets
Profile installer preserving existing preset roots
Actual-preset Session Gate
InMemory Mission/Admin Ledgers
LocalArtifactStore
MilitaryRuntime
One General
One Worker
StaticTaskOrder
CommandVerifier
CompletionInterlock
Session event mirror
One Standard sibling session fixture
```

第一条测试先证明 Standard sibling Session 看不到任何 Military 模型表面或控制副作用，再证明 Candidate 验收闭环。先不要实现多参谋、博物馆和完整 WebUI。

## 2. Runtime 主循环

```ts
async function runWave(waveId: WaveId): Promise<void> {
  while (true) {
    const wave = await ledger.readWave(waveId)

    if (wave.state === 'FAILED' || wave.state === 'CANCELLED') return
    if (waveBarrierSatisfied(wave)) {
      await closeWave(wave)
      return
    }

    const capacity = await capacityModel.available(wave)
    const tasks = scheduler.selectReady(wave, capacity)

    for (const task of tasks) {
      await dispatchTask(task)
    }

    await eventClock.waitForRelevantChange(waveId)
  }
}
```

`waitForRelevantChange` 由事件唤醒，不以模型轮询数据库。

## 3. Worker 创建

```ts
const handle = await ctx.agents.create({
  sessionId: makeWorkerSessionId(task),
  meta: {
    cwd: workspace.path,
    parentSession: general.id,
    delegationDepth: 1,
  },
  agentOptions: {
    provider: route.provider,
    model: route.model,
    maxTokens: route.maxTokens,
  },
  setup: async (agentCtx) => {
    installWorkerPersona(agentCtx, identity)
    installWorkerToolRestriction(agentCtx, task)
    installReasoningPolicy(agentCtx, { minimum: 'low', preferred: 'high' })
    installFreezeAdmission(agentCtx, task.id)
    installMilitarySessionProjection(agentCtx, task)
  },
})
```

Agent Handle 由 `MilitaryRuntime` 保存，模型无权销毁或创建兄弟 Agent。

## 4. Candidate Tool

```ts
const submitCandidate = defineTool({
  name: 'military_submit_candidate',
  // schema omitted
  async execute(args, exec) {
    const agent = requireMilitaryAgent(exec.agent)
    const receipt = await military.proposeCandidate(agent.identity, args)
    exec.concludeTurn()
    return receipt
  },
})
```

`concludeTurn()` 只结束模型 Turn，不代表接受。接受发生在外置 Verification。

## 5. 完成联锁

```text
candidate received
  → identity/task/version check
  → declared tool calls vs durable tool events
  → Artifact hash check
  → scope/write audit
  → acceptance clause coverage
  → deterministic verifiers
  → optional read-only inspector
  → aggregate decision
  → CAS accept/rework/freeze
```

Inspector 输出不能直接覆盖确定性失败。

## 6. 参谋会商

```text
eligibilityFilter(context, advisorProfiles)
  → independently ask eligible advisors
  → collect structured recommendations
  → coverageOptimizer selects lead + consults
  → lead synthesizes Direction/Wave/Directive
  → plan validator
  → General ratification
```

独立研判阶段不向后续参谋展示前一个参谋的答案，减少锚定。

## 7. 电台

```ts
requestGuidance(request):
  validate schema
  authorize identity
  attach harness evidence
  escalationGate
  dedupe
  enqueue
  emit radio/requested

advisor worker:
  lease request
  retrieve 3..5 tactics
  synthesize one directive
  validate expectedTaskVersion
  persist guidance
  broker deliver
  ack
```

## 8. 工兵 Git

```text
inspect repo
if no .git:
  git init -b main
ensure controlled local-main worktree
apply specs order within allowlist
validate specs
git status --porcelain
git add -- specs/ allowed metadata
git commit -m "docs(specs): ..."
record commit hash + tree hash
never push
```

所有命令由受限 Git Provider 生成，不让工兵自由拼接任意 Git shell。

## 9. Compaction Hook

```text
observe main session compaction/end(success)
  → dedupe by compactionId
  → build deterministic effectiveness dataset
  → run Effectiveness Agent
  → verify cited task/skill ids
  → append assessment
  → optionally schedule Museum research
```

## 10. UI

- Settings：Advisor Profiles、Tactical Registry、Oversight、Specs/Git、Model Policy；
- Conversation Nodes：Mission、Wave、Task、Candidate、Radio、Freeze、Specs Commit、Memory；
- Dedicated dashboard 后置；
- UI command 使用 expected revision；
- Client 不可直接调用 Provider 数据库。

## 11. 首批测试

```text
task version race
candidate without tools
candidate with forged tool list
verifier crash and replay
worker tries to write specs
engineer tries git push
stale guidance
duplicate compaction evaluation
advisor with revoked API grant
frozen agent receives followup
wave barrier with one missing specs commit
```

## 12. 完成定义

MVP 的“完成”不是 UI 可展示多个 Agent，而是：

- 可重放；
- 可冻结；
- 可拒绝；
- 可恢复；
- 可证明；
- 可在本地 main 留下 specs commit；
- 不把模型自报当成事实。

## 0.2.0 实现增量顺序

```text
A. Preset asset package + complete roster profile installer
B. Fixed military preset + actual-preset guard
C. Session binding + sibling-session isolation tests
D. Mission/Admin ledgers + one Worker verification loop
E. Agent Template registry + per-child context policy
F. /brainstorm + General-owned ask-user
G. Tactical Sufficiency Gate + Chief fallback
H. Tag registry + ingestion candidate review
I. Evaluation dataset + one Examiner + Chair
J. Full Web settings and reports
```

### 子代理创建补充

```ts
setup: async childCtx => {
  const preset = ctx.agentPresets.composeFrom(childCtx, general.ctx)
  if (preset !== 'military') throw new Error('MILITARY_PRESET_REQUIRED')
  installRoleTemplate(childCtx, templateSnapshot)
  installContextPolicy(childCtx, templateSnapshot.contextPolicy)
  installTaskBinding(childCtx, task)
}
```

### Listener 补充

```ts
ctx.on('session/event', async (session, event) => {
  if (await resolveSessionPreset(session) !== 'military') return
  await militaryProjection.fold(session, event)
})
```

### 评估补充

Evaluation Run 首先冻结 dataset hash，再按 template revision 分片。Chair 只能读取状态为 VALID/INSUFFICIENT_DATA 的已验证 individual report。

## 0.3.0：首个完整可运行切片

推荐首个切片不直接实现多参谋，而先闭合以下链路：

```text
RC.2 Host + Web Fixture
→ install military preset + generation archive
→ create Military Session
→ General uses preset default model
→ user switches General model
→ create Worker from frozen template
→ isolated worktree
→ Task Order + Acceptance Contract
→ Candidate Patch
→ deterministic Verify
→ Integration Order
→ apply to local main + global regression
→ Integration Receipt + specs receipt
→ process restart
→ exact generation resume
→ Standard sibling Session remains unaffected
```

### 关键伪代码

```ts
const binding = await presetGenerations.bindNewMilitarySession(session, currentManifest)
const generalRoute = await generalRouting.resolve({
  binding,
  explicitSessionSelection: sessionModelSelection,
  policy: presetGeneralPolicy,
  authority,
})

const agentBinding = await agentBindings.createFromTemplate({
  task, templateRevision, presetGeneration: binding.presetGeneration, authority,
})
const reservation = await budgets.reserveForTask(task, agentBinding)
const attempt = await workspaces.createAttempt(task, agentBinding)
const candidate = await workerRuntime.run(attempt)
const verification = await verification.verify(candidate)
if (verification.disposition !== 'ACCEPTED') return rework(candidate, verification)

const order = await integration.enqueue(candidate, verification)
const receipt = await integration.applyToLocalMain(order)
await specs.recordAcceptedChange(receipt)
await budgets.settleFromAcceptedAttempt(reservation, candidate, verification, receipt)
```

### 不能走的捷径

- Worker 直接编辑共享 cwd；
- Candidate accepted 后直接由模型运行 `git commit`；
- 只存 `presetId=military` 而不存 generation；
- General 模型切换向所有 child 广播；
- 开放 Event payload；
- 用 Session ID 代替 Authority Context；
- 跨 DB/Git/Artifact 假装原子提交；
- 先做 Dashboard，再补 durable projection。

### 推荐测试顺序

1. Contract generator/parity；
2. preset hash/archive；
3. RC.2 preset isolation；
4. General route override；
5. child AgentExecutionBinding；
6. budget reservation/settlement；
7. workspace/patch；
8. verifier/integration；
9. crash recovery；
10. generation restart/Resume Receipt；
11. WebUI projection。
