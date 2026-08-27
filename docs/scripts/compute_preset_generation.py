#!/usr/bin/env python3
"""Build and verify the immutable reference generation for the military preset."""
from __future__ import annotations
import argparse, hashlib, json, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PRESET=ROOT/'reference'/'preset'/'agent-presets'/'military'
FILES=('preset.yml','agent.cordis.yml')
CREATED_AT='2026-08-25T04:19:32.988Z'

def facts():
    rows=[]
    for name in FILES:
        data=(PRESET/name).read_bytes()
        rows.append({'path':name,'sha256':hashlib.sha256(data).hexdigest(),'byteLength':len(data)})
    # Matches core stableJson(): arrays preserve order and object keys sort recursively.
    stable=json.dumps(rows,ensure_ascii=False,sort_keys=True,separators=(',',':'))
    return hashlib.sha256(stable.encode()).hexdigest(), rows

def content():
    asset, rows=facts()
    return {
      'schemaVersion':'1.0.0','presetId':'military',
      'generation':f'military@sha256:{asset}','assetHash':asset,
      'bundleVersion':'0.9.0-alpha.25',
      'dshBaseline':{'release':'0.1.1-rc.2','commit':'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'},
      'publicSelectionId':'military','hiddenArchiveId':f'military-generation-{asset[:16]}',
      'status':'CURRENT','files':rows,'createdAt':CREATED_AT,
      'compatibility':{'mode':'EXACT_RC2','breaking':True,'resumeSupported':True},
    }

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--check',action='store_true'); a=ap.parse_args()
    manifest=content(); text=json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'
    mp=PRESET/'generation-manifest.json'; archive=ROOT/'reference'/'preset'/'generations'/manifest['assetHash']
    if a.check:
        bad=[]
        if not mp.exists() or mp.read_text()!=text: bad.append(str(mp.relative_to(ROOT)))
        for name in FILES:
            if not (archive/name).exists() or (archive/name).read_bytes()!=(PRESET/name).read_bytes(): bad.append(str((archive/name).relative_to(ROOT)))
        archive_manifest=archive/'generation-manifest.json'
        if not archive_manifest.exists() or archive_manifest.read_text()!=text: bad.append(str(archive_manifest.relative_to(ROOT)))
        if bad:
            print('Stale preset generation assets:'); [print('-',x) for x in bad]; return 1
        return 0
    mp.write_text(text)
    archive.mkdir(parents=True,exist_ok=True)
    for name in FILES: shutil.copyfile(PRESET/name,archive/name)
    (archive/'generation-manifest.json').write_text(text)
    print(manifest['generation'])
    return 0
if __name__=='__main__': raise SystemExit(main())
