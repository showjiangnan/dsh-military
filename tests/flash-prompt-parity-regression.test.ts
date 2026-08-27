import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { brand } from '@dsh-military/contracts'
import {
  defaultTemplates,
  rc2GeneralToolNames,
  synchronizeMilitaryPromptAssembly,
} from '@dsh-military/plugin-host'
import { latestRunnableTemplateSummaries } from '@dsh-military/tools'

const genericSections = [
  ['tool:read', 'Use the read tool.'],
  ['tool:write', 'Use the write tool.'],
  ['tool:edit', 'Use the edit tool.'],
  ['tool:glob', 'Use the glob tool.'],
  ['tool:grep', 'Use the grep tool.'],
  ['tool:bash', 'Check every bash result.'],
  ['tool:jobs', 'Use job_output.'],
  ['tool:web_search', 'Use web_search.'],
] as const

test('the 573e Flash export remains a prompt/tool parity regression contract', async () => {
  const fixture = JSON.parse(
    await readFile('tests/fixtures/573e-session-regression.json', 'utf8'),
  ) as {
    readonly observed: {
      readonly jsonlLines: number
      readonly requestHeaderTools: number
      readonly toolCallsOutsideRequestHeader: number
      readonly statusResultChars: number
      readonly statusTemplateRows: number
      readonly statusUniqueTemplateIds: number
    }
    readonly postFixContract: {
      readonly promptMentionsOnlyVisibleToolGuidance: boolean
      readonly generalRepositoryDiscoveryRoute: string
      readonly maximumStatusResultChars: number
      readonly maximumStatusTemplateRows: number
    }
  }

  assert.equal(fixture.observed.jsonlLines, 171)
  assert.equal(fixture.observed.requestHeaderTools, 16)
  assert.equal(fixture.observed.toolCallsOutsideRequestHeader, 3)
  assert.equal(fixture.observed.statusResultChars, 36_759)
  assert.equal(fixture.observed.statusTemplateRows, 33)
  assert.equal(fixture.observed.statusUniqueTemplateIds, 11)
  assert.equal(fixture.postFixContract.promptMentionsOnlyVisibleToolGuidance, true)
  assert.equal(
    fixture.postFixContract.generalRepositoryDiscoveryRoute,
    'ADVISOR_GENERALIST_WITHOUT_TASK',
  )
  assert.equal(fixture.postFixContract.maximumStatusResultChars, 8_000)
  assert.equal(fixture.postFixContract.maximumStatusTemplateRows, 11)
})

test('General prompt prose is derived from the exact restricted request tools', () => {
  const transformed = synchronizeMilitaryPromptAssembly(
    assembly([...rc2GeneralToolNames]),
    'general-tools@6',
  )
  const names = transformed.sections.map(section => section.name)
  for (const [section] of genericSections) assert.equal(names.includes(section), false)
  const prompt = transformed.sections.map(section => section.text).join('\n')
  assert.doesNotMatch(prompt, /Use pwd|Use the (?:read|write|edit|glob|grep) tool|every bash result/u)
  assert.match(prompt, /本轮唯一有效的工具调用名称/u)
  assert.match(prompt, /advisor-generalist.*不得传入 taskId/u)
  assert.deepEqual(
    transformed.tools.map(tool => tool.name).sort(),
    [...rc2GeneralToolNames].sort(),
  )
})

test('department prompt keeps only guidance for tools its immutable profile exposes', () => {
  const transformed = synchronizeMilitaryPromptAssembly(
    assembly(['read', 'glob', 'grep', 'military_staff_read_mission']),
    'staff-tools@6',
  )
  const names = transformed.sections.map(section => section.name)
  assert.equal(names.includes('tool:read'), true)
  assert.equal(names.includes('tool:glob'), true)
  assert.equal(names.includes('tool:grep'), true)
  for (const hidden of ['tool:write', 'tool:edit', 'tool:bash', 'tool:jobs', 'tool:web_search']) {
    assert.equal(names.includes(hidden), false)
  }
})

test('Military status selects one compact latest runnable template row per id', () => {
  const history = defaultTemplates().flatMap(template => [1, 2, 3, 4, 5].map(revision => ({
    ...template,
    revision: brand<number, 'Revision'>(revision),
  })))
  const summaries = latestRunnableTemplateSummaries(history)
  assert.equal(summaries.length, 11)
  assert.equal(new Set(summaries.map(template => template.templateId)).size, 11)
  assert.equal(summaries.every(template => template.revision === 5), true)
  const serialized = JSON.stringify(summaries)
  assert.ok(serialized.length < 8_000)
  assert.equal(serialized.includes('modelPolicy'), false)
  assert.equal(serialized.includes('contextPolicy'), false)
})

test('/brainstorm routes repository discovery through a read-only department', async () => {
  const source = await readFile('packages/command-brainstorm/src/index.ts', 'utf8')
  assert.match(source, /advisor-generalist.*without a taskId.*bounded read-only discovery/u)
  assert.match(source, /only exact tool names visible in this turn/u)
  assert.equal(
    source.includes('Inspect discoverable repository facts with read-only tools'),
    false,
  )
})

function assembly(toolNames: readonly string[]): PromptAssembly {
  return {
    sections: [
      {
        name: 'harness:source',
        text: 'Use pwd to determine the current working directory.',
      },
      {
        name: 'app:web-surface',
        text: 'Use a managed background job and job_output.',
      },
      ...genericSections.map(([name, text]) => ({ name, text })),
    ],
    contexts: [],
    tools: toolNames.map(name => ({
      name,
      description: '',
      parameters: {
        type: 'object',
        properties: {},
      },
    })),
    variables: {},
  }
}
