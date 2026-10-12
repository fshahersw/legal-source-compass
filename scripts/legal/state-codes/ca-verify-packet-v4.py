#!/usr/bin/env python3
"""Independently compare every CA candidate row to a pinned source audit ledger.

The ledger is produced by the separately preserved lossless renderer against
the entire original ZIP, before this packet builder. No database or network.
"""
import argparse
from collections import defaultdict
import csv
import gzip
import hashlib
import io
from itertools import zip_longest
import json
from pathlib import Path
import zipfile


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode('utf-8')).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def leaf(values):
    return sha(''.join('-:' if value is None else str(len(value.encode('utf-8'))) + ':' + value for value in values))


def read_jsonl(path):
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            yield json.loads(line)


def verify_source_locator(archive, original_sha256, locator, source_row):
    """Cross-link declared source identity to the actual pinned archive bytes."""
    if locator['archive_sha256'] != original_sha256:
        raise ValueError('Locator archive fingerprint differs from original object')
    if source_row[14].strip().upper() != locator['member'].upper():
        raise ValueError('Locator member differs from publisher section table')
    if sha(archive.read(locator['member'])) != locator['member_sha256']:
        raise ValueError('Locator member fingerprint differs from original bytes')


def verify(packet, ledger, ledger_sha256, output):
    if output.exists():
        raise FileExistsError('Fresh verification output required')
    if file_sha(ledger) != ledger_sha256:
        raise ValueError('Independent source ledger fingerprint mismatch')
    manifest = json.loads((packet/'manifest.json').read_text(encoding='utf-8'))
    if manifest['parser'] != {'name':'california-pubinfo-xml','version':'4'}:
        raise ValueError('Wrong parser candidate')
    objects = list(read_jsonl(packet/'objects.jsonl'))
    for item in objects:
        path = Path(item['path'])
        if path.stat().st_size != item['bytes'] or file_sha(path) != item['sha256']:
            raise ValueError('Packet asset fingerprint mismatch: ' + str(path))
    originals = [item for item in objects if item['kind']=='publisher_original']
    if len(originals) != 1:
        raise ValueError('One original publisher archive required')
    with zipfile.ZipFile(originals[0]['path']) as archive:
        references = {row[11].strip(): row for row in csv.reader(io.StringIO(archive.read('LAW_TOC_SECTIONS_TBL.dat').decode('utf-8')),delimiter='\t',quotechar='`')}
        source_sections = {row[7].strip():row for row in csv.reader(io.StringIO(archive.read('LAW_SECTION_TBL.dat').decode('utf-8')),delimiter='\t',quotechar='`')}
    unit_text, units = {}, {}
    for unit in read_jsonl(packet/'units.jsonl'):
        key = unit['unit_key']
        if key in units:
            raise ValueError('Duplicate unit')
        units[key] = unit
        asset = next(item for item in objects if item['sha256']==unit['text_sha256'])
        unit_text[key] = Path(asset['path']).read_text(encoding='utf-8')
        if len(unit_text[key]) != unit['text_code_points']:
            raise ValueError('Unit Unicode span length mismatch')
    positions, counts, digests, seen = defaultdict(int), defaultdict(int), defaultdict(list), set()
    attachment_gaps = {item['native_id'] for item in json.loads((packet/'source-attachment-gaps.json').read_text())}
    with gzip.open(ledger,'rt',encoding='utf-8') as source_rows, zipfile.ZipFile(originals[0]['path']) as archive:
        for expected_line, actual in zip_longest(source_rows, read_jsonl(packet/'sections.jsonl')):
            if expected_line is None or actual is None:
                raise ValueError('Full source inventory differs')
            expected = json.loads(expected_line)
            native_id = 'CA:' + actual['citation_path']
            if native_id != expected['native_id'] or native_id in seen:
                raise ValueError('Source occurrence identity changed or duplicated')
            seen.add(native_id)
            loc = actual['source_locator']
            identity = [native_id,loc['archive_sha256'],loc['member'],loc['member_sha256'],loc['native_row_id'],loc['section_version_id'],actual['citation_path']]
            if identity != expected['identity'] or loc['display_url_retrieved'] is not False:
                raise ValueError('Source locator mismatch: ' + native_id)
            if sha(actual['text']) != expected['corrected_text_sha256']:
                raise ValueError('Lossless source text mismatch: ' + native_id)
            source_row = source_sections[loc['section_version_id']]
            verify_source_locator(archive, originals[0]['sha256'], loc, source_row)
            ref = references[loc['section_version_id']]
            code, node_path = source_row[1].strip(), ref[2]
            hierarchy = actual['hierarchy']
            ancestors = [{k:v for k,v in node.items() if k!='node_id'} for node in hierarchy[:-1]]
            if ancestors != expected['hierarchy'][:-1]:
                raise ValueError('Source ancestry or headings differ: ' + native_id)
            expected_ids = ['CA:'+code]+['CA:'+code+':'+'.'.join(node_path.split('.')[:i]) for i in range(1,len(node_path.split('.'))+1)]
            if [item.get('node_id') for item in hierarchy[:-1]] != expected_ids:
                raise ValueError('Publisher node identity drift: ' + native_id)
            heading = ref[5].strip() or None
            if actual['heading'] != heading or hierarchy[-1] != {'level':'section','number':native_id.removeprefix('CA:').split('~')[0],'heading':heading}:
                raise ValueError('Section heading/number differs from source: '+native_id)
            if actual['history'] != (source_row[13].strip() or None):
                raise ValueError('Publisher history changed')
            if native_id in attachment_gaps and 'not present in this text export' not in (actual['status_note'] or ''):
                raise ValueError('Attachment gap omitted from visible status')
            if actual['currency']['through_date'] is not None:
                raise ValueError('Unproved currentness date')
            key = actual['unit_key']; start=positions[key]+(2 if counts[key] else 0); end=start+len(actual['text'])
            if actual['span'] != {'unit':'unicode_code_points','start':start,'end':end} or unit_text[key][start:end] != actual['text']:
                raise ValueError('Complete derivative text/span mismatch: '+native_id)
            positions[key]=end;counts[key]+=1
            digests[code].append((native_id,leaf(identity),leaf([native_id,sha(actual['text'])]),leaf([native_id,*[leaf([n['level'],n['number'],n['heading'],n.get('node_id')]) for n in hierarchy]])))
    if any(positions[key]!=len(text) or counts[key]!=units[key]['sections_expected'] for key,text in unit_text.items()):
        raise ValueError('Unit count or trailing text mismatch')
    if seen != {row['native_id'] for row in (json.loads(line) for line in gzip.open(ledger,'rt',encoding='utf-8'))}:
        raise ValueError('Missing or extra source occurrence')
    expected_cloud=[]
    for code,rows in sorted(digests.items()):
        rows.sort(key=lambda row:row[0].encode('utf-8'))
        expected_cloud.append({'code':code,'sections':len(rows),'identity_sha256':sha(''.join(row[1] for row in rows)),'actual_text_sha256':sha(''.join(row[2] for row in rows)),'hierarchy_sha256':sha(''.join(row[3] for row in rows))})
    report={'schema_version':'california-packet-independent-verification/4','sections':len(seen),'units':len(units),'objects':len(objects),'source_ledger_sha256':ledger_sha256,'packet_sections_sha256':file_sha(packet/'sections.jsonl'),'manifest_sha256':sha(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))),'expected_cloud_codes':expected_cloud,'attachment_gap_sections':len(attachment_gaps),'all_source_text_identities_hierarchy_and_spans_match':True,'database_verified':False,'publication_allowed':False,'current_law_verified':False}
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key!='expected_cloud_codes'},indent=2))
    return report


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--packet',type=Path,required=True);ap.add_argument('--ledger',type=Path,required=True);ap.add_argument('--ledger-sha256',required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    verify(a.packet,a.ledger,a.ledger_sha256,a.out)
