"""Build bounded actual-packet samples for isolated PostgreSQL contract validation."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'common'))
import land_publisher_code_v2 as L

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('packet',type=Path);a=p.parse_args()
    packet=a.packet;manifest=json.loads((packet/'manifest.json').read_text(encoding='utf-8'))
    digest=L.sha(manifest);units,sections=L.build_rows(str(packet),digest,manifest)
    selected={};categories=defaultdict(int)
    for row in sections:
        data=row['data'];pdf=data['source_pdf'];occ=data['source_occurrence']
        for category in ('title:'+data['unit_id'],'comparison:'+pdf['comparison'],
            'status:'+occ['source_status'],'pdf-class:'+pdf['provenance_class']):
            if not categories[category]:selected[row['native_id']]=row;categories[category]+=1
        if 'no operative version has been selected' in data['status_note'] and not categories['duplicate-citation']:
            selected[row['native_id']]=row;categories['duplicate-citation']=1
    for name,key in [('largest-text',lambda r:len(r['data']['text'])),('largest-status',lambda r:len(r['data']['status_note'])),
                     ('deepest-hierarchy',lambda r:len(r['data']['hierarchy']))]:
        row=max(sections,key=key);selected[row['native_id']]=row;categories[name]=1
    objects=[]
    for obj in L.jsonl(str(packet/'objects.jsonl')):
        digest_obj=obj['sha256'];readback=dict(bytes=obj['bytes'],bucket='corpus-originals',
            object_key=f'state-codes/sha256/{digest_obj[:2]}/{digest_obj}',readback_sha256=digest_obj,readback_bytes=obj['bytes'],
            verification_method='authenticated-whole-object-get-sha256',http_status=200,verified_at='2026-10-12T00:00:00Z')
        if obj['kind']=='unit_text_derivative':
            readback.update(readback_text_encoding='utf-8',readback_text_code_points=obj['code_points'])
        objects.append(dict(sha256=digest_obj,bytes=obj['bytes'],kind=obj['kind'],sources=obj['sources'],readback=readback))
    result=dict(manifest_sha256=digest,run_id='9d339e59-b711-4dfd-8d71-3dcbf311a499',
        units=units,sections=list(selected.values()),objects=objects,selection=list(categories))
    with (packet/'sql-contract-fixtures.json').open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(result,stream,ensure_ascii=False);stream.write('\n')
    print(json.dumps(dict(units=len(units),selected_sections=len(selected),selection=list(categories))))

if __name__=='__main__':main()
