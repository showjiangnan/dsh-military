#!/usr/bin/env python3
"""Generate event envelopes, TypeScript event contracts, examples and catalog docs.

The canonical event source is ``contracts/event-catalog.json``. Generated files:
- schemas/mission-event.schema.json
- schemas/administrative-event.schema.json
- reference/types/generated-event-catalog.ts
- examples/events/mission-ledger.example.jsonl
- examples/events/administrative-ledger.example.jsonl
- contracts/EVENT-CATALOG.md
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / 'contracts' / 'event-catalog.json'

COMMON_TS_REFS = {
    'common-defs.schema.json#/$defs/id': 'string',
    'common-defs.schema.json#/$defs/timestamp': 'IsoDateTime',
    'common-defs.schema.json#/$defs/classification': 'DataClassification',
    'common-defs.schema.json#/$defs/reasoningEffort': 'ReasoningEffort',
    'common-defs.schema.json#/$defs/agentIdentity': 'AgentIdentity',
    'common-defs.schema.json#/$defs/artifactRef': 'ArtifactRef',
    'common-defs.schema.json#/$defs/evidenceRef': 'EvidenceRef',
    'common-defs.schema.json#/$defs/skillRef': 'TacticalSkillRef',
}

IMPORT_TYPES = sorted(set(COMMON_TS_REFS.values()) - {'string'})


def pascal(value: str) -> str:
    return ''.join(part[:1].upper() + part[1:] for part in re.split(r'[^A-Za-z0-9]+', value) if part)


def literal(value: Any) -> str:
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def ts_type(schema: dict[str, Any], indent: str = '') -> str:
    explicit = schema.get('x-typescript-type')
    if explicit:
        return explicit
    if '$ref' in schema:
        return COMMON_TS_REFS.get(schema['$ref'], 'unknown')
    if 'const' in schema:
        return literal(schema['const'])
    if 'enum' in schema:
        return ' | '.join(literal(item) for item in schema['enum'])
    if 'oneOf' in schema:
        return ' | '.join(ts_type(item, indent) for item in schema['oneOf'])
    stype = schema.get('type')
    if isinstance(stype, list):
        return ' | '.join(ts_type({**schema, 'type': item}, indent) for item in stype)
    if stype == 'string':
        return 'string'
    if stype in {'integer', 'number'}:
        return 'number'
    if stype == 'boolean':
        return 'boolean'
    if stype == 'null':
        return 'null'
    if stype == 'array':
        item = ts_type(schema.get('items', {}), indent)
        return f'readonly ({item})[]' if ' | ' in item else f'readonly {item}[]'
    if stype == 'object' or 'properties' in schema:
        props: dict[str, Any] = schema.get('properties', {})
        required = set(schema.get('required', []))
        if not props and schema.get('additionalProperties'):
            ap = schema['additionalProperties']
            return f'Readonly<Record<string, {ts_type(ap, indent)}>>' if isinstance(ap, dict) else 'Readonly<Record<string, unknown>>'
        child_indent = indent + '  '
        lines = ['{']
        for name, prop in props.items():
            optional = '' if name in required else '?'
            lines.append(f'{child_indent}readonly {json.dumps(name)}{optional}: {ts_type(prop, child_indent)}')
        lines.append(indent + '}')
        return '\n'.join(lines)
    return 'unknown'


def envelope_schema(kind: str, entries: list[dict[str, Any]]) -> dict[str, Any]:
    mission = kind == 'mission'
    required = ['schemaVersion', 'eventId', 'seq', 'aggregateRevision', 'type', 'timestamp', 'payload']
    if mission:
        required += ['missionId', 'actor']
    else:
        required += ['actorId', 'tenantId']
    properties: dict[str, Any] = {
        'schemaVersion': {'const': '2.0.0'},
        'eventId': {'$ref': 'common-defs.schema.json#/$defs/id'},
        'seq': {'type': 'integer', 'minimum': 1},
        'aggregateRevision': {'type': 'integer', 'minimum': 1},
        'type': {'type': 'string'},
        'timestamp': {'$ref': 'common-defs.schema.json#/$defs/timestamp'},
        'causationId': {'$ref': 'common-defs.schema.json#/$defs/id'},
        'correlationId': {'$ref': 'common-defs.schema.json#/$defs/id'},
        'idempotencyKey': {'$ref': 'common-defs.schema.json#/$defs/id'},
        'payload': {'type': 'object'},
    }
    if mission:
        properties.update({
            'missionId': {'$ref': 'common-defs.schema.json#/$defs/id'},
            'actor': {'$ref': 'common-defs.schema.json#/$defs/agentIdentity'},
        })
    else:
        properties.update({
            'actorId': {'$ref': 'common-defs.schema.json#/$defs/id'},
            'tenantId': {'$ref': 'common-defs.schema.json#/$defs/id'},
        })
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': f'{kind if mission else "administrative"}-event.schema.json',
        'title': 'Mission Ledger Event Envelope' if mission else 'Military Cross-session Administrative Event Envelope',
        'type': 'object',
        'additionalProperties': False,
        'required': required,
        'properties': properties,
        'oneOf': [
            {
                'title': entry['title'],
                'properties': {
                    'type': {'const': entry['type']},
                    'payload': entry['payloadSchema'],
                },
            }
            for entry in entries
        ],
    }


def render_typescript(catalog: dict[str, Any]) -> str:
    lines = [
        '/* AUTO-GENERATED by scripts/generate_contract_artifacts.py. DO NOT EDIT. */',
        "import type {",
    ]
    for name in IMPORT_TYPES:
        lines.append(f'  {name},')
    lines.extend(["} from './domain.js'", ''])

    for group in ('missionEvents', 'administrativeEvents'):
        for entry in catalog[group]:
            name = pascal(entry['type']) + 'Payload'
            payload = entry['payloadSchema']
            lines.append(f'export type {name} = {ts_type(payload)}')
            lines.append('')

    lines.append('export interface MissionEventPayloadMap {')
    for entry in catalog['missionEvents']:
        lines.append(f"  readonly {json.dumps(entry['type'])}: {pascal(entry['type'])}Payload")
    lines.append('}')
    lines.append('')
    lines.append('export interface AdministrativeEventPayloadMap {')
    for entry in catalog['administrativeEvents']:
        lines.append(f"  readonly {json.dumps(entry['type'])}: {pascal(entry['type'])}Payload")
    lines.append('}')
    lines.append('')
    lines.extend([
        'export interface MissionEventEnvelope<K extends keyof MissionEventPayloadMap> {',
        "  readonly schemaVersion: '2.0.0'",
        '  readonly eventId: string',
        '  readonly missionId: string',
        '  readonly seq: number',
        '  readonly aggregateRevision: number',
        '  readonly type: K',
        '  readonly timestamp: IsoDateTime',
        '  readonly actor: AgentIdentity',
        '  readonly causationId?: string',
        '  readonly correlationId?: string',
        '  readonly idempotencyKey?: string',
        '  readonly payload: MissionEventPayloadMap[K]',
        '}',
        '',
        'export interface AdministrativeEventEnvelope<K extends keyof AdministrativeEventPayloadMap> {',
        "  readonly schemaVersion: '2.0.0'",
        '  readonly eventId: string',
        '  readonly seq: number',
        '  readonly aggregateRevision: number',
        '  readonly type: K',
        '  readonly timestamp: IsoDateTime',
        '  readonly actorId: string',
        '  readonly tenantId: string',
        '  readonly causationId?: string',
        '  readonly correlationId?: string',
        '  readonly idempotencyKey?: string',
        '  readonly payload: AdministrativeEventPayloadMap[K]',
        '}',
        '',
        'export type MissionEvent = {',
        '  [K in keyof MissionEventPayloadMap]: MissionEventEnvelope<K>',
        '}[keyof MissionEventPayloadMap]',
        '',
        'export type MilitaryAdministrativeEvent = {',
        '  [K in keyof AdministrativeEventPayloadMap]: AdministrativeEventEnvelope<K>',
        '}[keyof AdministrativeEventPayloadMap]',
        '',
        'export const missionEventTypes = [',
    ])
    for entry in catalog['missionEvents']:
        lines.append(f"  {json.dumps(entry['type'])},")
    lines.extend([
        '] as const',
        'export type MissionEventType = typeof missionEventTypes[number]',
        '',
        'export const administrativeEventTypes = [',
    ])
    for entry in catalog['administrativeEvents']:
        lines.append(f"  {json.dumps(entry['type'])},")
    lines.extend([
        '] as const',
        'export type AdministrativeEventType = typeof administrativeEventTypes[number]',
        '',
    ])
    return '\n'.join(lines)


def render_examples(catalog: dict[str, Any], kind: str) -> str:
    entries = catalog['missionEvents' if kind == 'mission' else 'administrativeEvents']
    lines: list[str] = []
    for index, entry in enumerate(entries, start=1):
        base: dict[str, Any] = {
            'schemaVersion': '2.0.0',
            'eventId': f'{kind}-event-{index:03d}',
            'seq': index,
            'aggregateRevision': index,
            'type': entry['type'],
            'timestamp': '2026-08-19T00:00:00Z',
            'correlationId': f'{kind}-catalog-example',
            'idempotencyKey': f'{kind}-{index:03d}',
            'payload': entry['examplePayload'],
        }
        if kind == 'mission':
            base['missionId'] = 'mission-example'
            base['actor'] = {
                'agentId': 'agent-harness',
                'sessionId': 'session-general',
                'role': 'harness',
                'displayName': 'Harness',
                'generation': 1,
            }
        else:
            base['actorId'] = 'user-example'
            base['tenantId'] = 'tenant-example'
        lines.append(json.dumps(base, ensure_ascii=False, separators=(',', ':')))
    return '\n'.join(lines) + '\n'


def render_markdown(catalog: dict[str, Any]) -> str:
    lines = [
        '# 事件目录（生成）', '',
        '> 真源：`contracts/event-catalog.json`；本文件由 `scripts/generate_contract_artifacts.py` 生成。', '',
    ]
    for title, key in [('Mission Ledger', 'missionEvents'), ('Administrative Ledger', 'administrativeEvents')]:
        lines.extend([f'## {title}', '', '| 事件 | 标题 | 说明 |', '|---|---|---|'])
        for entry in catalog[key]:
            desc = entry.get('description', '').replace('|', '\\|')
            lines.append(f"| `{entry['type']}` | {entry['title']} | {desc} |")
        lines.append('')
    return '\n'.join(lines)


def generated() -> dict[Path, str]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
    return {
        ROOT / 'schemas' / 'mission-event.schema.json': json.dumps(envelope_schema('mission', catalog['missionEvents']), ensure_ascii=False, indent=2) + '\n',
        ROOT / 'schemas' / 'administrative-event.schema.json': json.dumps(envelope_schema('administrative', catalog['administrativeEvents']), ensure_ascii=False, indent=2) + '\n',
        ROOT / 'reference' / 'types' / 'generated-event-catalog.ts': render_typescript(catalog),
        ROOT / 'examples' / 'events' / 'mission-ledger.example.jsonl': render_examples(catalog, 'mission'),
        ROOT / 'examples' / 'events' / 'administrative-ledger.example.jsonl': render_examples(catalog, 'administrative'),
        ROOT / 'contracts' / 'EVENT-CATALOG.md': render_markdown(catalog),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    failures: list[str] = []
    for path, content in generated().items():
        if args.check:
            if not path.exists() or path.read_text(encoding='utf-8') != content:
                failures.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
            print(f'Wrote {path.relative_to(ROOT)}')
    if failures:
        print('Stale generated files:')
        for item in failures:
            print(f'- {item}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
