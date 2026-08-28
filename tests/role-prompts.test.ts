import assert from 'node:assert/strict'
import test from 'node:test'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import {
  lintSimplifiedChinese,
} from '@dsh-military/contracts/control-plane'
import {
  BUILT_IN_DEPARTMENT_ROLE_PROMPTS,
  DEFAULT_GENERAL_ROLE_PROMPT,
  resolveDepartmentRolePrompt,
  resolveGeneralRolePrompt,
  validateRolePrompt,
} from '@dsh-military/contracts/role-prompts'
import { defaultTemplates, synchronizeMilitaryPromptAssembly } from '@dsh-military/plugin-host'
import {
  departmentPersona,
  generalPersona,
} from '../packages/plugin-host/src/agent-lifecycle.js'

test('every bundled role prompt is valid Simplified Chinese guidance', () => {
  const templates = defaultTemplates()
  assert.equal(templates.length, 11)
  assert.equal(Object.keys(BUILT_IN_DEPARTMENT_ROLE_PROMPTS).length, 11)
  assert.equal(validateRolePrompt(DEFAULT_GENERAL_ROLE_PROMPT), DEFAULT_GENERAL_ROLE_PROMPT)
  assert.equal(lintSimplifiedChinese(DEFAULT_GENERAL_ROLE_PROMPT).issues.length, 0)
  for (const template of templates) {
    const prompt = resolveDepartmentRolePrompt(template)
    assert.equal(prompt, BUILT_IN_DEPARTMENT_ROLE_PROMPTS[String(template.templateId)])
    assert.equal(validateRolePrompt(prompt, template.displayName), prompt)
    assert.equal(
      lintSimplifiedChinese(prompt).issues.length,
      0,
      `${template.templateId} contains a Simplified-Chinese lint finding`,
    )
    assert.ok((prompt.match(/\p{Script=Han}/gu)?.length ?? 0) > 40)
  }
})

test('legacy templates fall back to bundled prompts and an override is explicit', () => {
  const template = defaultTemplates().find(item => String(item.templateId) === 'worker-default')
  assert.ok(template)
  const bundled = resolveDepartmentRolePrompt(template)
  const custom = `${bundled}\n\n自定义要求：完成验证后再提交候选结果。`
  assert.equal(resolveDepartmentRolePrompt({ ...template, rolePromptOverride: custom }), custom)
  assert.equal(resolveGeneralRolePrompt(''), DEFAULT_GENERAL_ROLE_PROMPT)
  assert.throws(
    () => validateRolePrompt('Use only available tools, verify every result, and finish the assigned task safely.'),
    /必须使用简体中文/u,
  )
  assert.throws(
    () => validateRolePrompt(`${custom}\n{{unknown}}`),
    /只允许使用 \{\{cwd\}\} 变量/u,
  )
  const traditional = '你是專業的執行智能體，必須使用工具驗證結果，完成後提交一次報告並立即停止。'
  assert.equal(validateRolePrompt(traditional), traditional)
  assert.ok(lintSimplifiedChinese(traditional).issues.length > 0)
})

test('editable role prose cannot remove immutable Host persona boundaries', () => {
  const template = defaultTemplates().find(item => String(item.templateId) === 'engineer-default')
  assert.ok(template)
  const custom = `${resolveDepartmentRolePrompt(template)}\n\n自定义要求：写入前再次检查目标路径。`
  const persona = departmentPersona(
    { ...template, rolePromptOverride: custom },
    { bindingId: 'binding-1', capabilityGrantId: 'grant-1' },
  )
  assert.match(persona, /自定义要求/u)
  assert.match(persona, /以下运行身份与权限边界由 Host 固定/u)
  assert.match(persona, /模板：engineer-default@8/u)
  assert.match(persona, /能力授权：grant-1/u)

  const general = generalPersona(custom)
  assert.match(general, /以下运行边界由 Host 固定/u)
  assert.match(general, /工具回执、独立验证和 Military 权威账本/u)
})

test('prompt assembly replaces only the editable persona and keeps exact Chinese tool guidance', () => {
  const rolePrompt = `${DEFAULT_GENERAL_ROLE_PROMPT}\n\n自定义要求：先读取当前任务状态。`
  const assembly: PromptAssembly = {
    sections: [
      { name: 'deployment:persona', text: '旧的人设文本' },
      { name: 'harness:source', text: 'Use pwd.' },
    ],
    contexts: [],
    tools: [{
      name: 'military_status',
      description: '',
      parameters: { type: 'object', properties: {} },
    }],
    variables: {},
  }
  const transformed = synchronizeMilitaryPromptAssembly(
    assembly,
    'general-tools@6',
    undefined,
    generalPersona(rolePrompt),
  )
  assert.equal(
    transformed.sections.find(section => section.name === 'deployment:persona')?.text,
    generalPersona(rolePrompt),
  )
  const boundary = transformed.sections.find(section => section.name === 'military:tool-boundary')?.text ?? ''
  assert.match(boundary, /本轮唯一有效的工具调用名称为 military_status/u)
  assert.match(boundary, /项目探查属于部门任务/u)
  assert.doesNotMatch(boundary, /the only valid tool-call names/u)
})
