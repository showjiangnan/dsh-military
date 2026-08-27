import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  MilitaryError,
  type AgentTemplatePerformance,
  type CandidateSubmission,
  type DecisionQuestionSet,
  type EvaluationDatasetManifest,
  type FrozenEvaluationDataset,
  type MilitaryPerformanceReport,
  type PerformanceEvaluationRequest,
  type TacticalGuidance,
  type TacticalIngestionRequest,
  type TacticalRequest,
  type TaskOrder,
} from '@dsh-military/contracts'
import { cloneFrozen, stableJson } from '@dsh-military/core'
import type { SpecsMaintenanceOrder } from '@dsh-military/infrastructure'
import type {
  ParameterPropertySpec,
  ParameterSchemaSpec,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'

type JsonSchema = Readonly<Record<string, unknown>>

const require = createRequire(import.meta.url)
const schemas = Object.freeze({
  'agent-template-performance.schema.json': loadSchema('agent-template-performance'),
  'candidate-submission.schema.json': loadSchema('candidate-submission'),
  'common-defs.schema.json': loadSchema('common-defs'),
  'decision-question-set.schema.json': loadSchema('decision-question-set'),
  'evaluation-attempt-record.schema.json': loadSchema('evaluation-attempt-record'),
  'evaluation-dataset-manifest.schema.json': loadSchema('evaluation-dataset-manifest'),
  'frozen-evaluation-dataset.schema.json': loadSchema('frozen-evaluation-dataset'),
  'military-performance-report.schema.json': loadSchema('military-performance-report'),
  'performance-evaluation-request.schema.json': loadSchema('performance-evaluation-request'),
  'specs-apply-draft.schema.json': loadSchema('specs-apply-draft'),
  'specs-maintenance-order.schema.json': loadSchema('specs-maintenance-order'),
  'tactical-guidance.schema.json': loadSchema('tactical-guidance'),
  'tactical-ingestion-request.schema.json': loadSchema('tactical-ingestion-request'),
  'tactical-request.schema.json': loadSchema('tactical-request'),
  'task-order.schema.json': loadSchema('task-order'),
})

type SchemaName = keyof typeof schemas

export const candidateSubmissionParameter = canonicalModelParameter(
  'candidate-submission.schema.json',
  'Complete canonical Candidate Submission. Every identity, task location, evidence and idempotency field shown here is required by the Harness.',
)
export const decisionQuestionSetParameter = canonicalModelParameter(
  'decision-question-set.schema.json',
  'Complete Decision Question Set produced by a department Agent for the root General to present.',
)
export const performanceEvaluationRequestParameter = canonicalModelParameter(
  'performance-evaluation-request.schema.json',
  'Complete bounded evaluation request, including period, filters, sample floor and committee templates.',
)
export const specsMaintenanceOrderParameter = canonicalModelParameter(
  'specs-maintenance-order.schema.json',
  'Authorized Engineer-only Specs Maintenance Order with exact paths, validation and local-main commit policy.',
)
export const specsApplyDraftParameter = canonicalModelParameter(
  'specs-apply-draft.schema.json',
  'Shallow Engineer specs draft. Supply only complete document updates; the Host derives every identity, authority, validation and commit field.',
)
export const tacticalGuidanceParameter = canonicalModelParameter(
  'tactical-guidance.schema.json',
  'Version-fenced Tactical Guidance answering one leased Tactical Request.',
)
export const tacticalIngestionRequestParameter = canonicalModelParameter(
  'tactical-ingestion-request.schema.json',
  'Consent-bearing Tactical Ingestion Request with one explicit source variant and private extraction policy.',
)
export const tacticalRequestParameter = canonicalModelParameter(
  'tactical-request.schema.json',
  'Evidence-backed Tactical Request for a blocked task; identity and location must match the calling Agent binding.',
)

export function parseTaskOrder(value: unknown): TaskOrder {
  return parseCanonical<TaskOrder>('task-order.schema.json', value, 'order')
}

export function parseCandidateSubmission(value: unknown): CandidateSubmission {
  return parseCanonical<CandidateSubmission>('candidate-submission.schema.json', value, 'candidate')
}

export function parseTacticalRequest(value: unknown): TacticalRequest {
  return parseCanonical<TacticalRequest>('tactical-request.schema.json', value, 'request')
}

export function parseTacticalGuidance(value: unknown): TacticalGuidance {
  return parseCanonical<TacticalGuidance>('tactical-guidance.schema.json', value, 'guidance')
}

export function parseTacticalIngestionRequest(value: unknown): TacticalIngestionRequest {
  return parseCanonical<TacticalIngestionRequest>(
    'tactical-ingestion-request.schema.json',
    value,
    'request',
  )
}

export function parseDecisionQuestionSet(value: unknown): DecisionQuestionSet {
  return parseCanonical<DecisionQuestionSet>('decision-question-set.schema.json', value, 'questionSet')
}

export function parsePerformanceEvaluationRequest(value: unknown): PerformanceEvaluationRequest {
  return parseCanonical<PerformanceEvaluationRequest>(
    'performance-evaluation-request.schema.json',
    value,
    'request',
  )
}

export function parseEvaluationDatasetManifest(
  value: unknown,
): EvaluationDatasetManifest {
  return parseCanonical<EvaluationDatasetManifest>(
    'evaluation-dataset-manifest.schema.json',
    value,
    'manifest',
  )
}

export function parseFrozenEvaluationDataset(
  value: unknown,
): FrozenEvaluationDataset {
  return parseCanonical<FrozenEvaluationDataset>(
    'frozen-evaluation-dataset.schema.json',
    value,
    'dataset',
  )
}

export function parseAgentTemplatePerformance(
  value: unknown,
): AgentTemplatePerformance {
  return parseCanonical<AgentTemplatePerformance>(
    'agent-template-performance.schema.json',
    value,
    'performance',
  )
}

export function parseMilitaryPerformanceReport(
  value: unknown,
): MilitaryPerformanceReport {
  return parseCanonical<MilitaryPerformanceReport>(
    'military-performance-report.schema.json',
    value,
    'report',
  )
}

export function parseSpecsMaintenanceOrder(value: unknown): SpecsMaintenanceOrder {
  return parseCanonical<SpecsMaintenanceOrder>('specs-maintenance-order.schema.json', value, 'order')
}

export interface SpecsApplyDraft {
  readonly updates: readonly {
    readonly document: string
    readonly purpose: string
    readonly content?: string
    readonly contentArtifactIds?: readonly string[]
  }[]
}

export function parseSpecsApplyDraft(value: unknown): SpecsApplyDraft {
  return parseCanonical<SpecsApplyDraft>('specs-apply-draft.schema.json', value, 'draft')
}

export function parseDocumentContent(value: unknown): Readonly<Record<string, string>> {
  if (!isObject(value)) {
    throw new MilitaryError('INVALID_ARGUMENT', 'contentByDocument must be an object')
  }
  const result: Record<string, string> = {}
  for (const [path, content] of Object.entries(value)) {
    if (path.trim().length === 0 || typeof content !== 'string') {
      throw new MilitaryError(
        'INVALID_ARGUMENT',
        `contentByDocument.${path || '<empty>'} must be a string`,
      )
    }
    result[path] = content
  }
  return cloneFrozen(result)
}

function parseCanonical<T>(
  schemaName: SchemaName,
  value: unknown,
  label: string,
): T {
  const problems = validateSchema(schemas[schemaName], value, schemaName, `$${label}`, 0)
  if (problems.length > 0) {
    const visible = problems.slice(0, 5)
    const suffix = problems.length > visible.length
      ? `; … ${problems.length - visible.length} more violation(s)`
      : ''
    throw new MilitaryError(
      'INVALID_ARGUMENT',
      `${label} violates canonical ${schemaName}: ${visible.join('; ')}${suffix}`,
      {
        violations: visible,
        violationCount: problems.length,
        recovery: 'Correct only the listed fields, keep already valid values unchanged, and retry once.',
      },
    )
  }
  return cloneFrozen(value) as T
}

function validateSchema(
  schema: JsonSchema,
  value: unknown,
  documentName: SchemaName,
  path: string,
  depth: number,
): string[] {
  if (depth > 64) return [`${path} exceeds the maximum schema nesting depth`]

  const ref = schema['$ref']
  if (typeof ref === 'string') {
    const resolved = resolveReference(documentName, ref)
    if (resolved === null) return [`${path} references unknown schema ${ref}`]
    return validateSchema(resolved.schema, value, resolved.documentName, path, depth + 1)
  }

  const oneOf = schema['oneOf']
  if (Array.isArray(oneOf)) {
    const results = oneOf.map(branch =>
      isObject(branch)
        ? validateSchema(branch, value, documentName, path, depth + 1)
        : [`${path} contains an invalid oneOf branch`])
    const matches = results.filter(result => result.length === 0).length
    if (matches !== 1) {
      const detail = matches > 1
        ? 'multiple variants matched'
        : results
            .map((issues, index) => `variant ${index + 1}: ${issues.slice(0, 3).join(', ')}`)
            .join(' | ')
      return [`${path} must match exactly one variant (${detail})`]
    }
  }

  const problems: string[] = []
  if ('const' in schema && !sameJson(schema['const'], value)) {
    problems.push(`${path} must equal ${stableJson(schema['const'])}`)
  }
  const enumeration = schema['enum']
  if (Array.isArray(enumeration) && !enumeration.some(item => sameJson(item, value))) {
    problems.push(`${path} must be one of ${stableJson(enumeration)}`)
  }

  const type = schema['type']
  if (typeof type === 'string') {
    const typeProblem = validateType(type, value, path)
    if (typeProblem !== null) return [...problems, typeProblem]
  }

  if (typeof value === 'string') {
    const minimum = numericKeyword(schema, 'minLength')
    if (minimum !== undefined && [...value].length < minimum) {
      problems.push(`${path} must contain at least ${minimum} characters`)
    }
    const maximum = numericKeyword(schema, 'maxLength')
    if (maximum !== undefined && [...value].length > maximum) {
      problems.push(`${path} must contain at most ${maximum} characters`)
    }
    const pattern = schema['pattern']
    if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
      problems.push(`${path} does not match ${pattern}`)
    }
    if (schema['format'] === 'date-time'
      && (!RFC3339_DATE_TIME.test(value) || !Number.isFinite(Date.parse(value)))) {
      problems.push(`${path} must be an RFC 3339 date-time`)
    }
  }

  if (typeof value === 'number') {
    const minimum = numericKeyword(schema, 'minimum')
    if (minimum !== undefined && value < minimum) problems.push(`${path} must be >= ${minimum}`)
    const maximum = numericKeyword(schema, 'maximum')
    if (maximum !== undefined && value > maximum) problems.push(`${path} must be <= ${maximum}`)
  }

  if (Array.isArray(value)) {
    const minimum = numericKeyword(schema, 'minItems')
    if (minimum !== undefined && value.length < minimum) {
      problems.push(`${path} must contain at least ${minimum} items`)
    }
    const maximum = numericKeyword(schema, 'maxItems')
    if (maximum !== undefined && value.length > maximum) {
      problems.push(`${path} must contain at most ${maximum} items`)
    }
    if (schema['uniqueItems'] === true) {
      const keys = value.map(stableJson)
      if (new Set(keys).size !== keys.length) problems.push(`${path} must contain unique items`)
    }
    const itemSchema = schema['items']
    if (isObject(itemSchema)) {
      for (let index = 0; index < value.length; index += 1) {
        problems.push(...validateSchema(
          itemSchema,
          value[index],
          documentName,
          `${path}[${index}]`,
          depth + 1,
        ))
      }
    }
  }

  if (isObject(value)) {
    const minimum = numericKeyword(schema, 'minProperties')
    if (minimum !== undefined && Object.keys(value).length < minimum) {
      problems.push(`${path} must contain at least ${minimum} properties`)
    }
    const required = schema['required']
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !Object.hasOwn(value, key)) {
          problems.push(`${propertyPath(path, key)} is required`)
        }
      }
    }
    const properties = isObject(schema['properties']) ? schema['properties'] : {}
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key]
      if (isObject(childSchema)) {
        problems.push(...validateSchema(
          childSchema,
          child,
          documentName,
          propertyPath(path, key),
          depth + 1,
        ))
        continue
      }
      const additional = schema['additionalProperties']
      if (additional === false) {
        problems.push(`${propertyPath(path, key)} is not allowed`)
        continue
      }
      if (isObject(additional)) {
        problems.push(...validateSchema(
          additional,
          child,
          documentName,
          propertyPath(path, key),
          depth + 1,
        ))
      }
    }
  }

  return problems
}

/**
 * Project a canonical repository schema into the complete subset supported by
 * the RC.2 author DSL. Runtime-only bounds (length, pattern, numeric range)
 * remain enforced by parseCanonical; the model still sees every object,
 * property, required flag, array item, enum, const and oneOf branch.
 */
function canonicalModelParameter(
  schemaName: SchemaName,
  description: string,
): ParameterPropertySpec {
  const schema = modelValueSchema(schemas[schemaName], schemaName, 0)
  return { ...schema, description, required: true } as ParameterPropertySpec
}

function modelValueSchema(
  schema: JsonSchema,
  documentName: SchemaName,
  depth: number,
): ValueSchemaSpec {
  if (depth > 64) throw new Error(`canonical model schema ${documentName} exceeds nesting limit`)
  const ref = schema['$ref']
  if (typeof ref === 'string') {
    const resolved = resolveReference(documentName, ref)
    if (resolved === null) throw new Error(`canonical model schema ${documentName} has unknown ref ${ref}`)
    return modelValueSchema(resolved.schema, resolved.documentName, depth + 1)
  }

  const annotations = modelAnnotations(schema)
  const oneOf = schema['oneOf']
  if (Array.isArray(oneOf)) {
    const branches = oneOf.map((branch, index) => {
      if (!isObject(branch)) throw new Error(`${documentName} oneOf branch ${index} is invalid`)
      return modelValueSchema(branch, documentName, depth + 1)
    })
    if (branches.length < 2) throw new Error(`${documentName} oneOf must contain at least two branches`)
    return {
      ...annotations,
      oneOf: branches as [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]],
    }
  }

  const declaredType = schema['type']
  const inferredType = typeof declaredType === 'string'
    ? declaredType
    : inferScalarSchemaType(schema)
  if (inferredType === 'object') {
    const required = new Set(Array.isArray(schema['required'])
      ? schema['required'].filter((value): value is string => typeof value === 'string')
      : [])
    const properties: ParameterSchemaSpec = {}
    const sourceProperties = isObject(schema['properties']) ? schema['properties'] : {}
    for (const [key, child] of Object.entries(sourceProperties)) {
      if (!isObject(child)) throw new Error(`${documentName}.${key} schema is invalid`)
      const value = modelValueSchema(child, documentName, depth + 1)
      properties[key] = required.has(key)
        ? { ...value, required: true } as ParameterPropertySpec
        : value as ParameterPropertySpec
    }
    return {
      ...annotations,
      type: 'object',
      properties,
      additionalProperties: schema['additionalProperties'] !== false,
    }
  }
  if (inferredType === 'array') {
    const items = schema['items']
    return {
      ...annotations,
      type: 'array',
      ...(isObject(items)
        ? { items: modelValueSchema(items, documentName, depth + 1) }
        : {}),
    }
  }
  if (inferredType === 'string' || inferredType === 'number'
    || inferredType === 'integer' || inferredType === 'boolean' || inferredType === 'null') {
    const enumeration = Array.isArray(schema['enum'])
      ? schema['enum'].filter(value => scalarMatchesType(value, inferredType))
      : undefined
    const constant = schema['const']
    return {
      ...annotations,
      type: inferredType,
      ...(enumeration === undefined ? {} : { enum: enumeration }),
      ...(!scalarMatchesType(constant, inferredType) ? {} : { const: constant }),
    } as ValueSchemaSpec
  }
  throw new Error(`canonical model schema ${documentName} has unsupported type ${String(inferredType)}`)
}

function modelAnnotations(schema: JsonSchema): {
  readonly title?: string
  readonly description?: string
} {
  return {
    ...(typeof schema['title'] === 'string' ? { title: schema['title'] } : {}),
    ...(typeof schema['description'] === 'string' ? { description: schema['description'] } : {}),
  }
}

function inferScalarSchemaType(schema: JsonSchema): string | undefined {
  const values = Array.isArray(schema['enum'])
    ? schema['enum']
    : Object.hasOwn(schema, 'const')
      ? [schema['const']]
      : []
  if (values.length === 0) {
    if (isObject(schema['properties']) || Object.hasOwn(schema, 'additionalProperties')) return 'object'
    return undefined
  }
  if (values.every(value => typeof value === 'string')) return 'string'
  if (values.every(value => typeof value === 'boolean')) return 'boolean'
  if (values.every(value => value === null)) return 'null'
  if (values.every(value => typeof value === 'number' && Number.isSafeInteger(value))) return 'integer'
  if (values.every(value => typeof value === 'number' && Number.isFinite(value))) return 'number'
  return undefined
}

function scalarMatchesType(value: unknown, type: string): boolean {
  return type === 'string'
    ? typeof value === 'string'
    : type === 'boolean'
      ? typeof value === 'boolean'
      : type === 'null'
        ? value === null
        : type === 'integer'
          ? typeof value === 'number' && Number.isSafeInteger(value)
          : type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : false
}

function validateType(type: string, value: unknown, path: string): string | null {
  const valid = type === 'object'
    ? isObject(value)
    : type === 'array'
      ? Array.isArray(value)
      : type === 'integer'
        ? typeof value === 'number' && Number.isSafeInteger(value)
        : type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : type === 'string'
            ? typeof value === 'string'
            : type === 'boolean'
              ? typeof value === 'boolean'
              : type === 'null'
                ? value === null
                : false
  return valid ? null : `${path} must be ${type}`
}

function resolveReference(
  currentDocument: SchemaName,
  ref: string,
): { readonly documentName: SchemaName; readonly schema: JsonSchema } | null {
  const [documentPart = '', fragment = ''] = ref.split('#', 2)
  const documentName = (documentPart === '' ? currentDocument : documentPart) as SchemaName
  let value: unknown = schemas[documentName]
  if (value === undefined) return null
  if (fragment !== '') {
    if (!fragment.startsWith('/')) return null
    for (const encoded of fragment.slice(1).split('/')) {
      const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
      if (!isObject(value) || !Object.hasOwn(value, key)) return null
      value = value[key]
    }
  }
  return isObject(value) ? { documentName, schema: value } : null
}

function numericKeyword(schema: JsonSchema, key: string): number | undefined {
  const value = schema[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loadSchema(name: string): JsonSchema {
  return require(fileURLToPath(new URL(
    `../../contracts/schemas/${name}.schema.json`,
    import.meta.url,
  ))) as JsonSchema
}

const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
