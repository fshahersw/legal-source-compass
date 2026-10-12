#!/usr/bin/env python3
"""Select exact retained CA parser-4 versions after source review; default is offline dry-run.

Administrative owner only. Does not acquire sources, invent retrieval dates, or publish a state.
The fixed-source RPC preserves full beforeimages and rejects concurrent/newer-source changes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0,str(Path(__file__).parent/'common'))
import land_publisher_code_v2 as L

MANIFEST='4dd46270ad4da9362d75ef7f8202eec296e2768a4e794c271c041943b2ea9a03'
SECTIONS='8c2391a9464445e7ff82384f6b639582b5a0886bc243aff1352432f9dba30a64'
UNITS='7260c0e3e5971cb4c264ba21b19f22a55b113901c25b13f02b8ebd2ca1285926'

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def identities(packet):
    manifest=json.loads((packet/'manifest.json').read_text(encoding='utf-8'))
    if L.sha(manifest)!=MANIFEST or digest(packet/'sections.jsonl')!=SECTIONS or digest(packet/'units.jsonl')!=UNITS:
        raise ValueError('Only the independently verified CA parser-4 packet is eligible')
    units,sections=L.build_rows(str(packet),MANIFEST,manifest)
    if len(units)!=30 or len(sections)!=162526:
        raise ValueError('Exact reviewed CA inventory required')
    rows=[dict(entity_type=r['entity_type'],native_id=r['native_id'],payload_sha256=r['provenance']['record_sha256'])
          for r in units+sections]
    if any(not re.fullmatch(r'CA:(?:unit:code-[A-Z]{2,4}|[A-Z]{2,4}:.{1,250})',r['native_id'])
           or any(ord(c)<32 or ord(c)==127 for c in r['native_id']) for r in rows):
        raise ValueError('A reviewed source identity does not satisfy the promotion RPC bounds')
    return rows

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('packet',type=Path);p.add_argument('--execute',action='store_true')
    p.add_argument('--rollback',action='store_true');p.add_argument('--checkpoint',type=Path)
    p.add_argument('--batch-size',type=int,default=100)
    a=p.parse_args()
    if not 1<=a.batch_size<=500:p.error('batch size must be 1..500')
    rows=identities(a.packet);action='restore' if a.rollback else 'promote'
    batches=[rows[i:i+a.batch_size] for i in range(0,len(rows),a.batch_size)]
    print(json.dumps(dict(action=action,manifest_sha256=MANIFEST,rows=len(rows),batches=len(batches),
                         publication_allowed=False,execute=a.execute)),flush=True)
    if not a.execute:return
    if not a.checkpoint:p.error('--checkpoint is required for resumable reviewed selection')
    checkpoint=dict(action=action,manifest_sha256=MANIFEST,batch_size=a.batch_size,completed={})
    if a.checkpoint.exists():
        checkpoint=json.loads(a.checkpoint.read_text())
        if any(checkpoint.get(k)!=v for k,v in dict(action=action,manifest_sha256=MANIFEST,batch_size=a.batch_size).items()):
            raise ValueError('Checkpoint belongs to another selection operation')
    cloud=L.Cloud()
    for i,batch in enumerate(batches):
        key=L.sha(batch)
        if key in checkpoint['completed']:continue
        result=cloud.rpc('corpus_ca_parser4_'+action+'_v1',{'p_rows':batch})
        changed=result.get('promoted',0)+result.get('restored',0)
        replayed=result.get('already_promoted',0)+result.get('already_restored',0)
        if changed+replayed!=len(batch) or result.get('public_projection_allowed') is not False:
            raise RuntimeError('Promotion result does not cover the exact bounded batch')
        checkpoint['completed'][key]=dict(index=i,rows=len(batch),result=result)
        temporary=a.checkpoint.with_suffix(a.checkpoint.suffix+'.tmp')
        temporary.write_text(json.dumps(checkpoint,indent=2)+'\n',encoding='utf-8')
        temporary.replace(a.checkpoint)
        print(json.dumps(dict(batch=i+1,total_batches=len(batches),**result)),flush=True)
    print(json.dumps(dict(completed=True,rows=len(rows),action=action,
        next_step='Full independent cloud comparison is required; publication remains disabled.')),flush=True)

if __name__=='__main__':main()
