#!/usr/bin/env python3
"""Validate the dsh-military 0.3.0 docs-as-code engineering package.

The validator distinguishes syntax from cross-artifact conformance. It checks:
- Draft 2020-12 schemas and all mapped examples;
- event/error catalog generation, payload coverage and Golden ledgers;
- JSON Schema ↔ TypeScript top-level field parity;
- immutable preset generation assets and RC.2 compatibility fixtures;
- numbered documents 00..69, generated single-spec, links and Mermaid;
- TypeScript compilation, SQL reference shape, state invariants and traces;
- deterministic schema/example index freshness;
- optional manifest regeneration/checking.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import shutil
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
    from jsonschema import Draft202012Validator, FormatChecker
    from referencing import Registry, Resource
except ImportError as exc:
    raise SystemExit(
        'Missing validation dependency. Run: '
        'python -m pip install -r scripts/requirements-validation.txt'
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / 'schemas'
EXAMPLES = ROOT / 'examples'
DOCS = ROOT / 'docs'
REFERENCE_TYPES = ROOT / 'reference' / 'types'
CONTRACTS = ROOT / 'contracts'

BASE_EXAMPLE_MAP: dict[str, tuple[str, ...]] = {
    'mission-intent.schema.json': ('mission/mission-intent.example.yaml',),
    'direction-plan.schema.json': ('planning/direction-plan.example.yaml',),
    'wave-plan.schema.json': ('planning/wave-plan.example.yaml',),
    'task-order.schema.json': ('tasks/task-order.example.yaml',),
    'acceptance-contract.schema.json': ('tasks/acceptance-contract.example.yaml',),
    'staff-advisor-profile.schema.json': ('staff/backend-advisor.example.yaml','staff/frontend-advisor.example.yaml'),
    'tactical-request.schema.json': ('radio/tactical-request.example.yaml',),
    'tactical-guidance.schema.json': ('radio/tactical-guidance.example.yaml',),
    'tactical-skill.schema.json': ('tactics/tactical-skill.example.yaml',),
    'candidate-submission.schema.json': ('tasks/candidate-submission.example.yaml',),
    'inspection-report.schema.json': ('events/inspection-report.example.yaml',),
    'tactical-report.schema.json': ('memory/tactical-report.example.yaml',),
    'tactical-memory.schema.json': ('memory/tactical-memory.example.yaml',),
    'effectiveness-assessment.schema.json': ('memory/effectiveness-assessment.example.yaml',),
    'specs-maintenance-order.schema.json': ('specs/specs-maintenance-order.example.yaml',),
    'promotion-order.schema.json': ('git/promotion-order.example.yaml',),
    'military-settings.schema.json': ('settings.example.yml',),
    'military-session-binding.schema.json': ('preset/military-session-binding.example.yaml',),
    'tactical-tag.schema.json': ('tactical-ingestion/react-tag.example.yaml',),
    'tactical-ingestion-request.schema.json': (
        'tactical-ingestion/session-ingestion-request.example.yaml',
        'tactical-ingestion/direct-experience-request.example.yaml',
    ),
    'tactical-extraction-candidate.schema.json': ('tactical-ingestion/react-extraction-candidate.example.yaml',),
    'agent-template-profile.schema.json': ('templates/worker-template.example.yaml',),
    'brainstorm-order.schema.json': ('brainstorm/brainstorm-order.example.yaml',),
    'decision-question-set.schema.json': ('brainstorm/decision-question-set.example.yaml',),
    'chief-of-staff-advice.schema.json': ('staff/chief-of-staff-advice.example.yaml',),
    'performance-evaluation-request.schema.json': ('evaluation/performance-evaluation-request.example.yaml',),
    'evaluation-attempt-record.schema.json': ('evaluation/evaluation-attempt-record.example.yaml',),
    'frozen-evaluation-dataset.schema.json': ('evaluation/frozen-evaluation-dataset.example.yaml',),
    'agent-template-performance.schema.json': ('evaluation/worker-template-performance.example.yaml',),
    'military-performance-report.schema.json': ('evaluation/military-performance-report.example.yaml',),
    'conformance-trace.schema.json': tuple(
        path.relative_to(EXAMPLES).as_posix() for path in sorted((EXAMPLES / 'traces').glob('*.yaml'))
    ),
}

JSONL_MAP: dict[str, str] = {
    'mission-event.schema.json': 'events/mission-ledger.example.jsonl',
    'administrative-event.schema.json': 'events/administrative-ledger.example.jsonl',
}
SPECIAL_INSTANCE_MAP: dict[str, tuple[Path, ...]] = {
    'preset-generation-manifest.schema.json': (
        ROOT / 'reference' / 'preset' / 'agent-presets' / 'military' / 'generation-manifest.json',
    ),
}

MARKDOWN_EXTENSIONS = {'.md', '.markdown'}
MANIFEST_EXCLUDED = {'MANIFEST.md','MANIFEST.sha256','VALIDATION-REPORT.md'}
SUPPORTED_MERMAID_ROOTS = {
    'flowchart','graph','sequenceDiagram','stateDiagram','stateDiagram-v2',
    'classDiagram','erDiagram','journey','gantt','mindmap','timeline','architecture-beta',
}
RC2_RELEASE = '0.1.1-rc.2'
RC2_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

class NoTimestampSafeLoader(yaml.SafeLoader):
    """Safe YAML loader that keeps RFC3339 values as strings."""

NoTimestampSafeLoader.yaml_implicit_resolvers = copy.deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)
for first_char, resolvers in list(NoTimestampSafeLoader.yaml_implicit_resolvers.items()):
    NoTimestampSafeLoader.yaml_implicit_resolvers[first_char] = [
        (tag, regex) for tag, regex in resolvers if tag != 'tag:yaml.org,2002:timestamp'
    ]

def _construct_dsh_js(loader: NoTimestampSafeLoader, node: yaml.Node) -> str:
    return loader.construct_scalar(node)
NoTimestampSafeLoader.add_constructor('tag:yaml.org,2002:js', _construct_dsh_js)

@dataclass
class Result:
    category: str
    target: str
    ok: bool
    detail: str = ''

def load_yaml(path: Path) -> Any:
    with path.open('r', encoding='utf-8') as handle:
        return yaml.load(handle, Loader=NoTimestampSafeLoader)

def load_schemas() -> dict[str, dict[str, Any]]:
    return {path.name: json.loads(path.read_text(encoding='utf-8')) for path in sorted(SCHEMAS.glob('*.json'))}

def build_schema_registry(schemas: dict[str, dict[str, Any]]) -> Registry:
    registry = Registry()
    for name, schema in schemas.items():
        resource = Resource.from_contents(schema)
        registry = registry.with_resource(name, resource)
        registry = registry.with_resource((SCHEMAS / name).resolve().as_uri(), resource)
    return registry

def format_errors(errors: Iterable[Any], limit: int = 8) -> str:
    output=[]
    for error in list(errors)[:limit]:
        location='/'.join(str(part) for part in error.absolute_path) or '<root>'
        output.append(f'{location}: {error.message}')
    return '; '.join(output)

def merged_example_map() -> dict[str, tuple[str, ...]]:
    merged=dict(BASE_EXAMPLE_MAP)
    extra_path=CONTRACTS/'example-map.json'
    if extra_path.exists():
        extra=json.loads(extra_path.read_text(encoding='utf-8'))
        for schema_name, paths in extra.items():
            merged[schema_name]=tuple(paths)
    return merged

def validate_schemas(schemas: dict[str, dict[str, Any]]) -> list[Result]:
    results=[]
    for name,schema in schemas.items():
        try:
            Draft202012Validator.check_schema(schema)
            results.append(Result('schema',name,True,'Draft 2020-12'))
        except Exception as exc:
            results.append(Result('schema',name,False,str(exc)))
    return results

def validate_instance(validator: Draft202012Validator, instance: Any, target: str) -> Result:
    errors=sorted(validator.iter_errors(instance),key=lambda item:list(item.path))
    return Result('example',target,not errors,format_errors(errors) if errors else 'valid')

def validate_examples(schemas: dict[str, dict[str, Any]]) -> list[Result]:
    results=[]; checker=FormatChecker(); registry=build_schema_registry(schemas)
    for schema_name,relative_paths in merged_example_map().items():
        if schema_name not in schemas:
            results.append(Result('example-map',schema_name,False,'schema missing')); continue
        validator=Draft202012Validator(schemas[schema_name],registry=registry,format_checker=checker)
        for relative in relative_paths:
            path=EXAMPLES/relative
            try:
                results.append(validate_instance(validator,load_yaml(path),relative))
            except Exception as exc:
                results.append(Result('example',relative,False,str(exc)))
    for schema_name, paths in SPECIAL_INSTANCE_MAP.items():
        validator=Draft202012Validator(schemas[schema_name],registry=registry,format_checker=checker)
        for path in paths:
            try:
                results.append(validate_instance(validator,json.loads(path.read_text()),str(path.relative_to(ROOT))))
            except Exception as exc:
                results.append(Result('example',str(path.relative_to(ROOT)),False,str(exc)))
    for schema_name,relative in JSONL_MAP.items():
        validator=Draft202012Validator(schemas[schema_name],registry=registry,format_checker=checker)
        path=EXAMPLES/relative
        try:
            for line_number,line in enumerate(path.read_text().splitlines(),1):
                if not line.strip(): continue
                instance=json.loads(line)
                errors=sorted(validator.iter_errors(instance),key=lambda item:list(item.path))
                target=f'{relative}:{line_number}'
                results.append(Result('jsonl',target,not errors,format_errors(errors) if errors else schema_name))
        except Exception as exc:
            results.append(Result('jsonl',relative,False,str(exc)))
    return results


def validate_example_coverage(schemas: dict[str,dict[str,Any]]) -> list[Result]:
    covered=set(merged_example_map()) | set(JSONL_MAP) | set(SPECIAL_INSTANCE_MAP)
    expected=set(schemas) - {'common-defs.schema.json'}
    missing=sorted(expected-covered); unknown=sorted(covered-set(schemas))
    ok=not missing and not unknown
    detail=f'{len(expected)} contract schemas covered' if ok else f'missing={missing}; unknown={unknown}'
    return [Result('contract-coverage','schema-example-map',ok,detail)]

def validate_yaml_syntax() -> list[Result]:
    results=[]
    for path in sorted(list(ROOT.rglob('*.yaml'))+list(ROOT.rglob('*.yml'))):
        try: load_yaml(path); results.append(Result('yaml',str(path.relative_to(ROOT)),True,'syntax'))
        except Exception as exc: results.append(Result('yaml',str(path.relative_to(ROOT)),False,str(exc)))
    return results

def validate_json_syntax() -> list[Result]:
    results=[]
    for path in sorted(ROOT.rglob('*.json')):
        try: json.loads(path.read_text()); results.append(Result('json',str(path.relative_to(ROOT)),True,'syntax'))
        except Exception as exc: results.append(Result('json',str(path.relative_to(ROOT)),False,str(exc)))
    return results

def validate_single_spec() -> list[Result]:
    path=ROOT/'dsh-military-design-specification.md'
    if not path.exists(): return [Result('single-spec',path.name,False,'missing')]
    text=path.read_text(); missing=[f'part-{i:02d}' for i in range(70) if f'id="part-{i:02d}"' not in text]
    freshness=run_check('build_single_spec.py',['--check'])
    ok=not missing and freshness.ok
    detail='70 parts and current' if ok else (f'missing anchors: {missing}' if missing else freshness.detail)
    return [Result('single-spec',path.name,ok,detail)]

def validate_numbered_docs() -> list[Result]:
    docs=sorted(DOCS.glob('[0-9][0-9]-*.md')); actual=[int(p.name[:2]) for p in docs]; expected=list(range(70))
    return [Result('documents','docs/00..69',actual==expected,'continuous numbering' if actual==expected else f'expected {expected}, got {actual}')]

def markdown_without_fences(text: str) -> str:
    output=[]; in_fence=False; marker=''
    for line in text.splitlines():
        stripped=line.lstrip()
        if stripped.startswith('```') or stripped.startswith('~~~'):
            current=stripped[:3]
            if not in_fence: in_fence=True; marker=current
            elif current==marker: in_fence=False
            continue
        if not in_fence: output.append(line)
    return '\n'.join(output)

def validate_markdown_links() -> list[Result]:
    results=[]; pattern=re.compile(r'(?<!!)\[[^\]]*\]\(([^)]+)\)')
    for path in sorted(ROOT.rglob('*.md')):
        text=markdown_without_fences(path.read_text()); failures=[]
        for raw in pattern.findall(text):
            target=raw.strip().split()[0].strip('<>')
            if not target or target.startswith(('#','http://','https://','mailto:','sandbox:')): continue
            target_path=target.split('#',1)[0]
            if not target_path: continue
            resolved=(path.parent/target_path).resolve()
            try: resolved.relative_to(ROOT.resolve())
            except ValueError: failures.append(f'escapes root: {target}'); continue
            if not resolved.exists(): failures.append(target)
        rel=str(path.relative_to(ROOT))
        results.append(Result('links',rel,not failures,'relative links resolve' if not failures else ', '.join(failures)))
    return results

def validate_mermaid() -> list[Result]:
    results=[]
    for path in sorted((ROOT/'diagrams').glob('*.mmd')):
        lines=[line.strip() for line in path.read_text().splitlines() if line.strip() and not line.lstrip().startswith('%%')]
        root=lines[0].split()[0] if lines else ''; ok=bool(lines) and root in SUPPORTED_MERMAID_ROOTS
        results.append(Result('mermaid',str(path.relative_to(ROOT)),ok,root if ok else f'unsupported or empty root: {root!r}'))
    return results

def validate_typescript(skip: bool) -> list[Result]:
    if skip: return [Result('typescript','reference/types',True,'skipped by option')]
    tsc=shutil.which('tsc')
    if tsc is None: return [Result('typescript','reference/types',True,'tsc not installed; optional check skipped')]
    process=subprocess.run([tsc,'-p',str(REFERENCE_TYPES/'tsconfig.json')],cwd=ROOT,text=True,capture_output=True,check=False)
    detail=(process.stdout+process.stderr).strip() or 'tsc passed'
    return [Result('typescript','reference/types',process.returncode==0,detail)]

def run_check(script: str, args: list[str]) -> Result:
    process=subprocess.run([str(ROOT/'scripts'/script),*args],cwd=ROOT,text=True,capture_output=True,check=False)
    detail=(process.stdout+process.stderr).strip() or 'current'
    return Result('generated',script,process.returncode==0,detail)


def validate_indexes() -> list[Result]:
    return [run_check('update_indexes.py',['--check'])]

def validate_generated() -> list[Result]:
    return [
        run_check('generate_contract_artifacts.py',['--check']),
        run_check('generate_error_artifacts.py',['--check']),
    ]

def validate_preset_generation() -> list[Result]:
    results=[]
    current=ROOT/'reference'/'preset'/'agent-presets'/'military'
    manifest_path=current/'generation-manifest.json'
    try:
        manifest=json.loads(manifest_path.read_text())
        asset=manifest['assetHash']; generation=manifest['generation']
        results.append(Result('preset-generation','generation-format',generation==f'military@sha256:{asset}','generation matches assetHash'))
        archive=ROOT/'reference'/'preset'/'generations'/asset
        archive_manifest=archive/'generation-manifest.json'
        results.append(Result('preset-generation','archive-manifest',archive_manifest.exists() and json.loads(archive_manifest.read_text())==manifest,'archive manifest matches current'))
        file_failures=[]
        for row in manifest['files']:
            source=current/row['path']; archived=archive/row['path']
            source_hash=hashlib.sha256(source.read_bytes()).hexdigest() if source.exists() else None
            archive_hash=hashlib.sha256(archived.read_bytes()).hexdigest() if archived.exists() else None
            if source_hash!=row['sha256'] or archive_hash!=row['sha256'] or source.stat().st_size!=row['byteLength']:
                file_failures.append(row['path'])
        results.append(Result('preset-generation','asset-files',not file_failures,'all hashes match' if not file_failures else f'mismatch {file_failures}'))
        binding=load_yaml(EXAMPLES/'preset'/'military-session-binding.example.yaml')
        results.append(Result('preset-generation','binding-example',binding.get('presetGeneration')==generation,'example binds current generation'))
        same_examples=all((EXAMPLES/'preset'/'military'/name).read_bytes()==(current/name).read_bytes() for name in ('preset.yml','agent.cordis.yml'))
        results.append(Result('preset-generation','example-assets',same_examples,'example copy synchronized'))
        process=subprocess.run([str(ROOT/'scripts'/'compute_preset_generation.py'),'--check'],cwd=ROOT,text=True,capture_output=True,check=False)
        results.append(Result('preset-generation','generator-freshness',process.returncode==0,(process.stdout+process.stderr).strip() or 'current'))
    except Exception as exc:
        results.append(Result('preset-generation','manifest',False,str(exc)))
    return results

def json_pointer(value: Any, pointer: str) -> Any:
    if not pointer: return value
    current=value
    for token in pointer.lstrip('/').split('/'):
        token=token.replace('~1','/').replace('~0','~')
        current=current[token]
    return current

def find_interface(name: str) -> tuple[Path,str] | None:
    pattern=re.compile(rf'export interface\s+{re.escape(name)}\s*{{')
    for path in sorted(REFERENCE_TYPES.glob('*.ts')):
        text=path.read_text(); match=pattern.search(text)
        if not match: continue
        start=match.end(); depth=1; pos=start
        while pos<len(text) and depth:
            if text[pos]=='{': depth+=1
            elif text[pos]=='}': depth-=1
            pos+=1
        if depth==0: return path,text[start:pos-1]
    return None

def interface_fields(body: str) -> dict[str,bool]:
    fields={}; depth=0
    pattern=re.compile(r'^\s*readonly\s+(?:"([^"]+)"|\'([^\']+)\'|([A-Za-z_$][A-Za-z0-9_$-]*))(\?)?\s*:')
    for line in body.splitlines():
        if depth==0:
            match=pattern.match(line)
            if match:
                name=next(x for x in match.groups()[:3] if x is not None)
                fields[name]=match.group(4) is None
        depth+=line.count('{')-line.count('}')
    return fields

def validate_contract_parity(schemas: dict[str,dict[str,Any]]) -> list[Result]:
    results=[]; mapping=json.loads((CONTRACTS/'parity-map.json').read_text())
    for entry in mapping['contracts']:
        name=entry['typescriptInterface']; found=find_interface(name)
        if found is None:
            results.append(Result('contract-parity',name,False,'TypeScript interface missing')); continue
        path,body=found; ts_fields=interface_fields(body)
        node=json_pointer(schemas[entry['schema']],entry['pointer'])
        schema_fields=set(node.get('properties',{})); required=set(node.get('required',[]))
        ts_names=set(ts_fields)
        mismatches=[]
        if ts_names!=schema_fields:
            mismatches.append(f'fields schema-only={sorted(schema_fields-ts_names)} ts-only={sorted(ts_names-schema_fields)}')
        ts_required={field for field,is_required in ts_fields.items() if is_required}
        if ts_required!=required:
            mismatches.append(f'required schema={sorted(required)} ts={sorted(ts_required)}')
        results.append(Result('contract-parity',f'{name} ↔ {entry["schema"]}{entry["pointer"]}',not mismatches,'; '.join(mismatches) if mismatches else str(path.relative_to(ROOT))))
    return results

def event_types_from_schema(schema: dict[str,Any]) -> list[str]:
    return [item['properties']['type']['const'] for item in schema.get('oneOf',[])]


def validate_error_catalog() -> list[Result]:
    try:
        catalog=json.loads((CONTRACTS/'error-catalog.json').read_text())
        entries=catalog.get('errors',[]); codes=[entry.get('code') for entry in entries]
        categories={entry.get('category') for entry in entries}
        ok=(catalog.get('dshBaseline',{}).get('release')==RC2_RELEASE and catalog.get('dshBaseline',{}).get('commit')==RC2_COMMIT and len(entries)>=65 and len(codes)==len(set(codes)) and all(entry.get('summary') and entry.get('recovery') and isinstance(entry.get('defaultRetryable'),bool) for entry in entries))
        return [Result('error-catalog','contracts/error-catalog.json',ok,f'{len(entries)} codes across {len(categories)} categories' if ok else 'baseline, uniqueness or metadata invalid')]
    except Exception as exc:
        return [Result('error-catalog','contracts/error-catalog.json',False,str(exc))]

def validate_event_coverage(schemas: dict[str,dict[str,Any]]) -> list[Result]:
    catalog=json.loads((CONTRACTS/'event-catalog.json').read_text()); results=[]
    for key,schema_name,jsonl in [
        ('missionEvents','mission-event.schema.json','events/mission-ledger.example.jsonl'),
        ('administrativeEvents','administrative-event.schema.json','events/administrative-ledger.example.jsonl'),
    ]:
        catalog_types=[x['type'] for x in catalog[key]]; schema_types=event_types_from_schema(schemas[schema_name])
        jsonl_types=[json.loads(line)['type'] for line in (EXAMPLES/jsonl).read_text().splitlines() if line.strip()]
        ok=(catalog_types==schema_types==jsonl_types and len(set(catalog_types))==len(catalog_types))
        results.append(Result('event-coverage',key,ok,f'{len(catalog_types)} event types' if ok else 'catalog/schema/jsonl order or contents differ'))
    return results


def validate_baseline_consistency() -> list[Result]:
    results=[]
    text_targets=[ROOT/'README.md',ROOT/'VERSION.md',DOCS/'45-compatibility-probe-and-feature-matrix.md',ROOT/'reference'/'dsh-rc2'/'README.md']
    for path in text_targets:
        text=path.read_text(); ok=RC2_RELEASE in text and RC2_COMMIT in text
        results.append(Result('baseline-consistency',str(path.relative_to(ROOT)),ok,'exact RC.2 pin' if ok else 'release or commit missing'))
    json_targets=[CONTRACTS/'event-catalog.json',CONTRACTS/'error-catalog.json',ROOT/'reference'/'preset'/'agent-presets'/'military'/'generation-manifest.json']
    for path in json_targets:
        data=json.loads(path.read_text()); baseline=data.get('dshBaseline',{})
        ok=baseline.get('release')==RC2_RELEASE and baseline.get('commit')==RC2_COMMIT
        results.append(Result('baseline-consistency',str(path.relative_to(ROOT)),ok,'exact RC.2 fields' if ok else f'found {baseline}'))
    return results

def validate_rc2_compatibility() -> list[Result]:
    results=[]
    matrix=load_yaml(ROOT/'reference'/'dsh-rc2'/'compatibility-matrix.yml')
    results.append(Result('rc2-compatibility','compatibility-matrix',matrix.get('release')==RC2_RELEASE and matrix.get('commit')==RC2_COMMIT,'exact RC.2 baseline'))
    fingerprints=json.loads((ROOT/'reference'/'dsh-rc2'/'source-fingerprints.json').read_text())
    fingerprint_rows=fingerprints.get('files',[])
    fingerprint_ok=(
        fingerprints.get('release')==RC2_RELEASE
        and fingerprints.get('commit')==RC2_COMMIT
        and len(fingerprint_rows)>=10
        and len({row.get('path') for row in fingerprint_rows})==len(fingerprint_rows)
        and all(re.fullmatch(r'[a-f0-9]{40}',str(row.get('gitBlobSha1',''))) for row in fingerprint_rows)
    )
    results.append(Result('rc2-compatibility','source-fingerprints',fingerprint_ok,'exact public Git blob pins' if fingerprint_ok else 'invalid baseline, path set or blob SHA-1'))
    preset=load_yaml(ROOT/'reference'/'preset'/'agent-presets'/'military'/'agent.cordis.yml')
    def find_row(rows: Any,row_id: str) -> dict[str,Any] | None:
        if isinstance(rows,list):
            for row in rows:
                if isinstance(row,dict) and row.get('id')==row_id: return row
                if isinstance(row,dict):
                    nested=find_row(row.get('config'),row_id)
                    if nested:return nested
        return None
    row=find_row(preset,'military-general-model-default')
    config=row.get('config',{}) if row else {}
    fixture=load_yaml(ROOT/'reference'/'dsh-rc2'/'fixture-cases.yml')
    fixture_ids={case.get('id') for case in fixture.get('cases',[])}
    policy=load_yaml(EXAMPLES/'contracts'/'general-execution-policy.example.yaml')
    generation=json.loads((ROOT/'reference'/'preset'/'agent-presets'/'military'/'generation-manifest.json').read_text())
    checks={
        'preset-general-default-row': row is not None,
        'preset-default-model': config.get('provider')=='deepseek-official' and config.get('model')=='deepseek-v4-flash',
        'preset-user-model-override': policy.get('modelSelection',{}).get('userSessionSwitchEnabled') is True and 'rc2-general-model-switch' in fixture_ids,
        'preset-reasoning-gate': config.get('reasoningEffort')=='high' and policy.get('modelSelection',{}).get('rejectUnsupportedReasoning') is True and 'rc2-general-model-reject' in fixture_ids,
        'preset-commit-pin': generation.get('dshBaseline',{}).get('commit')==RC2_COMMIT,
    }
    for target,ok in checks.items(): results.append(Result('rc2-compatibility',target,ok,'present' if ok else 'missing or incompatible'))
    ok=policy['defaultModel']['provider']==config.get('provider') and policy['defaultModel']['model']==config.get('model')
    results.append(Result('rc2-compatibility','general-policy-matches-preset',ok,'provider/model aligned'))
    return results


def validate_rc2_fixture_plan() -> list[Result]:
    path=ROOT/'reference'/'dsh-rc2'/'fixture-cases.yml'
    try:
        data=load_yaml(path); cases=data.get('cases',[])
        ids=[case.get('id') for case in cases]
        ok=(data.get('baseline',{}).get('release')==RC2_RELEASE and data.get('baseline',{}).get('commit')==RC2_COMMIT and len(cases)>=18 and len(ids)==len(set(ids)) and all(case.get('assertions') for case in cases))
        return [Result('rc2-fixture-plan',str(path.relative_to(ROOT)),ok,f'{len(cases)} unique cases' if ok else 'baseline, uniqueness, count or assertions invalid')]
    except Exception as exc:
        return [Result('rc2-fixture-plan',str(path.relative_to(ROOT)),False,str(exc))]

def validate_state_invariants() -> list[Result]:
    text=(REFERENCE_TYPES/'state-machines.ts').read_text(); tla=(ROOT/'reference'/'tla'/'MilitaryCore.tla').read_text()
    checks={
        'accepted-terminal': "ACCEPTED: []" in text,
        'frozen-no-direct-executing': "FROZEN: ['EXECUTING'" not in text,
        'decision-states-complete': all(x in text for x in ['PARTIALLY_ANSWERED','DELIVERY_FAILED','SUPERSEDED','STALE']),
        'integration-terminal-states': all(x in text for x in ['APPLIED','CONFLICT','REGRESSION_FAILED','STALE']),
        'tla-frozen-no-write': 'FrozenNoWrite' in tla,
        'tla-accepted-terminal': 'AcceptedTerminal' in tla,
        'budget-reservation-terminal': all(x in text for x in ["SETTLED: []", "EXPIRED: []", "REVOKED: []", "REJECTED: []"]),
        'evaluation-appeal-terminal': all(x in text for x in ["UPHELD: []", "PARTIALLY_UPHELD: []", "DENIED: []", "WITHDRAWN: []"]),
    }
    return [Result('state-invariants',name,ok,'declared') for name,ok in checks.items()]

def validate_sql() -> list[Result]:
    sql_dir=ROOT/'reference'/'sql'; results=[]
    combined='\n'.join(path.read_text() for path in sorted(sql_dir.glob('*.sql')))
    required=['mission_events','administrative_events','transactional_outbox','migration_ledger','radio_requests','workspace_leases','integration_orders','decision_records','preset_generations','military_session_bindings','authority_contexts','authorization_receipts','policy_documents','model_selection_receipts','budget_reservations','budget_usage_receipts','tactical_source_snapshots','knowledge_revocation_orders','evaluation_jobs','evaluation_reports','compaction_attempts','bundle_lifecycle_receipts','preset_resume_receipts','agent_execution_bindings','performance_evaluation_appeals']
    for path in sorted(sql_dir.glob('*.sql')):
        text=path.read_text(); ok='DROP TABLE' not in text.upper() and ('CREATE TABLE' in text.upper() or 'CREATE INDEX' in text.upper())
        results.append(Result('sql',str(path.relative_to(ROOT)),ok,'reference migration shape'))
    missing=[table for table in required if not re.search(rf'CREATE TABLE\s+{re.escape(table)}\b',combined,re.I)]
    results.append(Result('sql','required-tables',not missing,'all present' if not missing else f'missing {missing}'))
    return results

def validate_traces() -> list[Result]:
    catalog=json.loads((CONTRACTS/'event-catalog.json').read_text()); allowed={e['type'] for key in ('missionEvents','administrativeEvents') for e in catalog[key]}; results=[]
    for path in sorted((EXAMPLES/'traces').glob('*.yaml')):
        data=load_yaml(path); steps=data.get('steps',[]); indices=[s.get('index') for s in steps]; types=[s.get('eventType') for s in steps]
        bad=[t for t in types if t not in allowed]; ok=indices==list(range(1,len(steps)+1)) and not bad
        results.append(Result('trace',str(path.relative_to(ROOT)),ok,f'{len(steps)} steps' if ok else f'bad events={bad} indices={indices}'))
    return results

def iter_manifest_files() -> Iterable[Path]:
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file(): continue
        relative=path.relative_to(ROOT).as_posix()
        if relative in MANIFEST_EXCLUDED or relative.endswith('.zip') or '__pycache__' in path.parts: continue
        yield path

def sha256(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b''): digest.update(chunk)
    return digest.hexdigest()

def render_manifest() -> tuple[str,str]:
    grouped=defaultdict(list); hashes=[]
    for path in iter_manifest_files():
        relative=path.relative_to(ROOT).as_posix(); directory=str(Path(relative).parent)
        grouped[directory].append((relative,path.stat().st_size)); hashes.append(f'{sha256(path)}  {relative}')
    lines=['# 文件清单','','本清单由 `scripts/validate_artifacts.py --write-manifest` 生成。','`MANIFEST.sha256` 不包含清单自身和验证报告，避免自引用哈希。','',f'- 文件数：{sum(len(v) for v in grouped.values())}',f'- 总字节数：{sum(size for v in grouped.values() for _,size in v)}','']
    for directory in sorted(grouped):
        lines += [f'## `{ "." if directory=="." else directory }/`','', '| 文件 | 字节 |','|---|---:|']
        lines += [f'| `{relative}` | {size} |' for relative,size in grouped[directory]]; lines.append('')
    return '\n'.join(lines).rstrip()+'\n','\n'.join(hashes)+'\n'

def validate_or_write_manifest(write: bool) -> list[Result]:
    expected_md,expected_sha=render_manifest(); md=ROOT/'MANIFEST.md'; sha=ROOT/'MANIFEST.sha256'
    if write:
        md.write_text(expected_md); sha.write_text(expected_sha); return [Result('manifest','MANIFEST.*',True,'regenerated')]
    if not md.exists() or not sha.exists(): return [Result('manifest','MANIFEST.*',False,'missing; run with --write-manifest')]
    ok=md.read_text()==expected_md and sha.read_text()==expected_sha
    return [Result('manifest','MANIFEST.*',ok,'current' if ok else 'stale')]

def write_report(results: list[Result]) -> None:
    grouped=defaultdict(list)
    for result in results: grouped[result.category].append(result)
    failures=[x for x in results if not x.ok]; now=datetime.now(timezone.utc).isoformat(timespec='seconds')
    lines=['# 文档工程校验报告','',f'- UTC 时间：`{now}`',f'- 总检查项：{len(results)}',f'- 通过：{len(results)-len(failures)}',f'- 失败：{len(failures)}','']
    for category in sorted(grouped):
        lines += [f'## {category}','','| 状态 | 目标 | 说明 |','|---|---|---|']
        for item in grouped[category]:
            detail=item.detail.replace('|','\\|').replace('\n',' '); target=item.target.replace('|','\\|')
            lines.append(f'| {"PASS" if item.ok else "FAIL"} | `{target}` | {detail} |')
        lines.append('')
    (ROOT/'VALIDATION-REPORT.md').write_text('\n'.join(lines),encoding='utf-8')

def print_summary(results: list[Result]) -> None:
    for category in sorted({x.category for x in results}):
        items=[x for x in results if x.category==category]; print(f'{category:20s} {sum(x.ok for x in items):3d}/{len(items):3d} PASS')
    failures=[x for x in results if not x.ok]
    if failures:
        print('\nFailures:'); [print(f'- [{x.category}] {x.target}: {x.detail}') for x in failures]
    print(f'\nOverall: {len(results)-len(failures)}/{len(results)} checks passed')

def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument('--skip-typescript',action='store_true'); parser.add_argument('--write-manifest',action='store_true'); args=parser.parse_args()
    schemas=load_schemas(); results=[]
    results += validate_schemas(schemas)
    results += validate_examples(schemas)
    results += validate_example_coverage(schemas)
    results += validate_yaml_syntax(); results += validate_json_syntax()
    results += validate_numbered_docs(); results += validate_single_spec(); results += validate_markdown_links(); results += validate_mermaid(); results += validate_typescript(args.skip_typescript)
    results += validate_generated(); results += validate_indexes(); results += validate_preset_generation(); results += validate_contract_parity(schemas); results += validate_error_catalog(); results += validate_baseline_consistency(); results += validate_event_coverage(schemas); results += validate_rc2_compatibility(); results += validate_rc2_fixture_plan(); results += validate_state_invariants(); results += validate_sql(); results += validate_traces()
    results += validate_or_write_manifest(args.write_manifest)
    write_report(results); print_summary(results)
    return 1 if any(not x.ok for x in results) else 0

if __name__=='__main__': raise SystemExit(main())
