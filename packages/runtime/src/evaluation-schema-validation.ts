import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  MilitaryError,
  type AgentTemplatePerformance,
  type EvaluationDatasetManifest,
  type FrozenEvaluationDataset,
  type MilitaryPerformanceReport,
  type PerformanceEvaluationRequest,
} from '@dsh-military/contracts'
import type { EvaluationSchemaValidation } from '@dsh-military/core'

type JsonSchema = Readonly<Record<string, unknown>>
type DocumentName = keyof typeof schemas

const require = createRequire(import.meta.url)
const schemas = Object.freeze({
  'agent-template-performance.schema.json': load('agent-template-performance'),
  'common-defs.schema.json': load('common-defs'),
  'evaluation-attempt-record.schema.json': load('evaluation-attempt-record'),
  'evaluation-dataset-manifest.schema.json': load('evaluation-dataset-manifest'),
  'frozen-evaluation-dataset.schema.json': load('frozen-evaluation-dataset'),
  'military-performance-report.schema.json': load('military-performance-report'),
  'performance-evaluation-request.schema.json': load('performance-evaluation-request'),
})

/**
 * Host-boundary validation against the same JSON Schemas shipped to users.
 * The evaluator calls this before persistence of each immutable stage.
 */
export class CanonicalEvaluationSchemaValidation
implements EvaluationSchemaValidation {
  request(value: PerformanceEvaluationRequest): void {
    assertDocument('performance-evaluation-request.schema.json', value)
  }

  dataset(value: {
    readonly manifest: EvaluationDatasetManifest
    readonly dataset: FrozenEvaluationDataset
  }): void {
    assertDocument('evaluation-dataset-manifest.schema.json', value.manifest)
    assertDocument('frozen-evaluation-dataset.schema.json', value.dataset)
  }

  performance(value: AgentTemplatePerformance): void {
    assertDocument('agent-template-performance.schema.json', value)
  }

  report(value: MilitaryPerformanceReport): void {
    assertDocument('military-performance-report.schema.json', value)
  }
}

function assertDocument(name: DocumentName, value: unknown): void {
  const problems = validate(schemas[name], value, name, '$', 0)
  if (problems.length === 0) return
  throw new MilitaryError(
    'EVALUATION_REPORT_MISMATCH',
    `${name} runtime validation failed: ${problems.slice(0, 8).join('; ')}`,
    {
      schema: name,
      violationCount: problems.length,
      violations: problems.slice(0, 20),
    },
  )
}

function validate(
  schema: JsonSchema,
  value: unknown,
  documentName: DocumentName,
  path: string,
  depth: number,
): string[] {
  if (depth > 80) return [`${path} exceeds schema depth`]
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const target = resolveReference(documentName, ref)
    return target === null
      ? [`${path} references unknown schema ${ref}`]
      : validate(target.schema, value, target.documentName, path, depth + 1)
  }
  const problems: string[] = []
  if ('const' in schema && !same(schema.const, value)) {
    problems.push(`${path} must equal ${JSON.stringify(schema.const)}`)
  }
  if (
    Array.isArray(schema.enum)
    && !schema.enum.some(item => same(item, value))
  ) problems.push(`${path} is outside the allowed enum`)

  const type = schema.type
  if (typeof type === 'string' && !matchesType(type, value)) {
    return [...problems, `${path} must be ${type}`]
  }
  if (typeof value === 'string') {
    const minimum = numberKeyword(schema, 'minLength')
    const maximum = numberKeyword(schema, 'maxLength')
    if (minimum !== undefined && [...value].length < minimum) {
      problems.push(`${path} is shorter than ${minimum}`)
    }
    if (maximum !== undefined && [...value].length > maximum) {
      problems.push(`${path} is longer than ${maximum}`)
    }
    if (typeof schema.pattern === 'string'
      && !new RegExp(schema.pattern, 'u').test(value)) {
      problems.push(`${path} does not match ${schema.pattern}`)
    }
    if (
      schema.format === 'date-time'
      && (!RFC3339.test(value) || !Number.isFinite(Date.parse(value)))
    ) problems.push(`${path} must be an RFC3339 timestamp`)
  }
  if (typeof value === 'number') {
    const minimum = numberKeyword(schema, 'minimum')
    const maximum = numberKeyword(schema, 'maximum')
    if (minimum !== undefined && value < minimum) {
      problems.push(`${path} must be >= ${minimum}`)
    }
    if (maximum !== undefined && value > maximum) {
      problems.push(`${path} must be <= ${maximum}`)
    }
  }
  if (Array.isArray(value)) {
    const minimum = numberKeyword(schema, 'minItems')
    const maximum = numberKeyword(schema, 'maxItems')
    if (minimum !== undefined && value.length < minimum) {
      problems.push(`${path} requires at least ${minimum} items`)
    }
    if (maximum !== undefined && value.length > maximum) {
      problems.push(`${path} allows at most ${maximum} items`)
    }
    if (
      schema.uniqueItems === true
      && new Set(value.map(item => JSON.stringify(item))).size !== value.length
    ) problems.push(`${path} requires unique items`)
    if (isRecord(schema.items)) {
      value.forEach((item, index) => {
        problems.push(...validate(
          schema.items as JsonSchema,
          item,
          documentName,
          `${path}[${index}]`,
          depth + 1,
        ))
      })
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties)
      ? schema.properties
      : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string =>
          typeof item === 'string')
      : []
    for (const key of required) {
      if (!Object.hasOwn(value, key)) problems.push(`${path}.${key} is required`)
    }
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = properties[key]
      if (isRecord(propertySchema)) {
        problems.push(...validate(
          propertySchema,
          item,
          documentName,
          propertyPath(path, key),
          depth + 1,
        ))
        continue
      }
      if (schema.additionalProperties === false) {
        problems.push(`${propertyPath(path, key)} is not allowed`)
      } else if (isRecord(schema.additionalProperties)) {
        problems.push(...validate(
          schema.additionalProperties,
          item,
          documentName,
          propertyPath(path, key),
          depth + 1,
        ))
      }
    }
  }
  return problems
}

function resolveReference(
  current: DocumentName,
  ref: string,
): { readonly documentName: DocumentName; readonly schema: JsonSchema } | null {
  const [documentPart = '', fragment = ''] = ref.split('#', 2)
  const documentName = (
    documentPart === '' ? current : documentPart
  ) as DocumentName
  let value: unknown = schemas[documentName]
  if (value === undefined) return null
  if (fragment !== '') {
    if (!fragment.startsWith('/')) return null
    for (const encoded of fragment.slice(1).split('/')) {
      const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
      if (!isRecord(value) || !Object.hasOwn(value, key)) return null
      value = value[key]
    }
  }
  return isRecord(value) ? { documentName, schema: value } : null
}

function matchesType(type: string, value: unknown): boolean {
  if (type === 'object') return isRecord(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number'
    && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return false
}

function numberKeyword(
  schema: JsonSchema,
  key: string,
): number | undefined {
  const value = schema[key]
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function load(name: string): JsonSchema {
  return require(fileURLToPath(new URL(
    `../../contracts/schemas/${name}.schema.json`,
    import.meta.url,
  ))) as JsonSchema
}

const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
