#!/usr/bin/env python3
"""Regenerate deterministic schema and example indexes."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def schema_index() -> str:
    rows=[]
    for path in sorted((ROOT/'schemas').glob('*.schema.json')):
        data=json.loads(path.read_text(encoding='utf-8'))
        rows.append((path.name,data.get('title','Untitled'),data.get('$id',path.name)))
    lines=['# JSON Schema 索引','','全部契约使用 JSON Schema Draft 2020-12。共享类型位于 [`common-defs.schema.json`](common-defs.schema.json)。','', '| Schema | 标题 | `$id` |','|---|---|---|']
    lines += [f'| [`{name}`]({name}) | {title} | `{schema_id}` |' for name,title,schema_id in rows]
    lines += ['',f'共 {len(rows)} 个 Schema。执行：','', '```bash','python scripts/generate_contract_artifacts.py --check','python scripts/compute_preset_generation.py --check','python scripts/update_indexes.py --check','python scripts/validate_artifacts.py','```','', '注意：Schema 通过只证明结构契约；真实 DSH RC.2 行为还必须运行 Compatibility Fixture、Golden Trace、故障注入和安装后 Profile E2E。','']
    return '\n'.join(lines)

def example_description(relative: str) -> str:
    if relative.startswith('traces/'): return '可重放 Conformance Trace 场景'
    if relative.endswith('ledger.example.jsonl'): return 'Event Catalog 生成的完整 Golden Ledger'
    if relative.startswith('contracts/'): return '0.3.0 治理、恢复、权限、集成或结算契约的合法实例'
    if relative.startswith('preset/'): return '固定 preset、profile、generation 或 Session Binding 参考'
    if relative in {'settings.example.yml','cordis.patch.example.yml','bundle/package.example.json'}: return 'Bundle、Profile 或 Settings 组合参考'
    return '对应领域契约的合法参考实例'

def examples_index() -> str:
    files=[]
    base=ROOT/'examples'
    for path in sorted(base.rglob('*')):
        if not path.is_file() or path.name=='README.md': continue
        relative=path.relative_to(base).as_posix()
        files.append(relative)
    lines=['# 示例与 Golden Fixture 索引','','示例覆盖 Mission、计划、Task、Radio、战术、preset、来源提炼、权限、Workspace、Bundle 生命周期、Decision Broker、预算、绩效数据集和并发一致性场景。','', '| 示例 | 用途 |','|---|---|']
    lines += [f'| [`{relative}`]({relative}) | {example_description(relative)} |' for relative in files]
    lines += ['',f'共 {len(files)} 个示例、Golden Ledger、组合和 Trace 文件。映射真源位于 [`../contracts/example-map.json`](../contracts/example-map.json) 与 [`../scripts/validate_artifacts.py`](../scripts/validate_artifacts.py)。','', 'Event JSONL 和 generated TypeScript 不应手工修改；运行 `python scripts/generate_contract_artifacts.py` 更新。','']
    return '\n'.join(lines)

def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); args=parser.parse_args()
    targets={ROOT/'schemas'/'INDEX.md':schema_index(),ROOT/'examples'/'README.md':examples_index()}
    stale=[]
    for path,text in targets.items():
        if args.check:
            if not path.exists() or path.read_text(encoding='utf-8')!=text: stale.append(str(path.relative_to(ROOT)))
        else:
            path.write_text(text,encoding='utf-8'); print(f'Wrote {path.relative_to(ROOT)}')
    if stale:
        print('Stale indexes: '+', '.join(stale)); return 1
    return 0
if __name__=='__main__': raise SystemExit(main())
