"""Prepare an immutable, raw-only storage plan from retained HRS responses.

Offline: no credentials, network, RPCs or entity/manifest changes. Availability
of raw bytes is not source interpretation, a complete corpus, or publication.
The owner may pass these original objects to the existing non-upsert put_object
helper, then bind any receipts to the independently verified final packet.
"""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path

from stage_hrs import digest,discovery,exact_capture,json_file


def prepare(capture,output):
    capture=Path(capture);output=Path(output)
    if output.exists():raise FileExistsError('Fresh raw-object plan directory required')
    inventory,directories,missing=discovery(capture)
    if missing:raise ValueError('Complete retained directory discovery is required')
    objects={};page_count=0;pages=set(inventory['pages'])
    for url in sorted(set(directories)|pages):
        captured=exact_capture(capture,url)
        if captured is None:continue
        receipt,body=captured
        if url in pages:page_count+=1
        source={key:receipt[key]for key in ['source_url','retrieved_at','http_status','retrieval_method','proxy']}
        row=objects.setdefault(receipt['sha256'],dict(sha256=receipt['sha256'],bytes=len(body),kind='publisher_original',
            path=str((capture/'raw'/receipt['sha256']).resolve()),sources=[]))
        if source not in row['sources']:row['sources'].append(source)
    output.mkdir(parents=True)
    path=output/'objects.jsonl'
    with path.open('x',encoding='utf8',newline='\n')as stream:
        for sha in sorted(objects):stream.write(json.dumps(objects[sha],ensure_ascii=False,separators=(',',':'))+'\n')
    report=dict(schema='hi-raw-original-upload-plan/1',created_at=datetime.now(timezone.utc).isoformat(),
        objects=len(objects),bytes=sum(row['bytes']for row in objects.values()),captured_pages=page_count,
        publisher_pages=len(inventory['pages']),discovery_pages=len(directories),
        directory_inventory_sha256=digest((capture/'directory-inventory.json').read_bytes()),objects_file_sha256=digest(path.read_bytes()),
        source_interpretation_reviewed=False,private_intake_allowed=False,publication_allowed=False,
        current_law_verified=False,calculation_activation_allowed=False)
    json_file(output/'plan.json',report)
    return report


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--capture',type=Path,required=True)
    cli.add_argument('--out',type=Path,required=True);args=cli.parse_args()
    print(json.dumps(prepare(args.capture,args.out)))
