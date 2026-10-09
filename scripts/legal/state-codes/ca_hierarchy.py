#!/usr/bin/env python3
"""Recover California hierarchy from the publisher's exact TOC/version graph.

Offline after acquisition. No database writes, source text edits, publication or
current-law claims. File names, paths and flat title/part columns do not determine
ancestry: LAW_TOC_SECTIONS_TBL binds the exact version to LAW_TOC_TBL.node_treepath.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

LEVEL_COLUMNS={'division':1,'title':2,'part':3,'chapter':4,'article':5}
TABLES=('CODES_TBL.dat','LAW_TOC_TBL.dat','LAW_SECTION_TBL.dat','LAW_TOC_SECTIONS_TBL.dat')

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def sha(data):
    return hashlib.sha256(data if isinstance(data,bytes) else data.encode('utf-8')).hexdigest()

def scope(row):
    return [row[1],*[None if value.strip() in ('NULL','') else value.strip() for value in row[8:13]]]

def node_display(row):
    heading=row[6].strip()
    if not heading or heading=='NULL':
        raise ValueError('Publisher TOC node has no heading: '+row[0]+'/'+row[13])
    match=re.match(r'^(DIVISION|TITLE|PART|CHAPTER|ARTICLE)\b',heading,re.I)
    if not match:return ['heading',None,heading]
    level=match.group(1).lower();number=row[LEVEL_COLUMNS[level]].strip()
    return [level,None if number in ('NULL','') else number,heading]

def native_occurrences(rows):
    counts=Counter()
    for row in rows:
        if len(row)!=18:raise ValueError('Unexpected LAW_SECTION_TBL column count')
        citation=row[1].strip()+':'+row[2].strip();counts[citation]+=1
        yield 'CA:'+citation+('~'+str(counts[citation]) if counts[citation]>1 else ''),row

def ancestors(path):
    pieces=path.split('.')
    return ['.'.join(pieces[:index]) for index in range(1,len(pieces)+1)]

def build_payload(code_rows,toc_rows,section_rows,reference_rows):
    codes={}
    for row in code_rows:
        if len(row)!=2 or not row[0].strip() or not row[1].strip():raise ValueError('Invalid publisher code table')
        if row[0] in codes:raise ValueError('Duplicate publisher code identity')
        codes[row[0]]=row[1]
    nodes={}
    for row in toc_rows:
        if len(row)!=19 or row[0] not in codes or not re.fullmatch(r'\d+(?:\.\d+)*',row[13]):raise ValueError('Invalid publisher TOC node')
        key=row[0]+'|'+row[13]
        if key in nodes:raise ValueError('Duplicate publisher TOC path: '+key)
        nodes[key]=node_display(row)
    references={}
    for row in reference_rows:
        if len(row)!=13 or not row[11].strip():raise ValueError('Invalid section TOC version reference')
        if row[11] in references:raise ValueError('Duplicate version reference in section TOC')
        references[row[11]]=row
    paths_by_scope=defaultdict(set);records=[];signature=[];matched_versions=set();spacing_differences=[]
    for native,row in native_occurrences(section_rows):
        version=row[7].strip();ref=references.get(version)
        # The publisher inserts an extrinsic space in one Water Code TOC ID.
        # Compare only ASCII identifier spacing; retain the differing literal values.
        identifier=lambda value:re.sub(r'[ \t\r\n]','',value)
        if ref is None or identifier(ref[0])!=identifier(row[0]) or ref[1].strip()!=row[1].strip() or ref[3].strip()!=row[2].strip():
            raise ValueError('Section identity differs from its exact TOC reference: '+native)
        if ref[0]!=row[0] or ref[1]!=row[1] or ref[3]!=row[2]:
            spacing_differences.append({'native_id':native,'version_id':version,'section_row_id':row[0],'toc_row_id':ref[0],'section_number':row[2],'toc_section_number':ref[3],'comparison':'ASCII identifier spacing only; source strings retained'})
        matched_versions.add(version)
        for parent in ancestors(ref[2]):
            if row[1]+'|'+parent not in nodes:raise ValueError('Missing publisher ancestor: '+row[1]+'/'+parent)
        if len(ancestors(ref[2]))+2>12:raise ValueError('Source hierarchy exceeds intake depth: '+native)
        key=canonical(scope(row));paths_by_scope[key].add(ref[2]);records.append((native,key,ref[2]))
        signature.append((native,[native,row[0],version,scope(row)]))
    if matched_versions!=set(references):raise ValueError('Section table and TOC version inventory differ')
    scopes={key:next(iter(paths)) for key,paths in paths_by_scope.items() if len(paths)==1}
    overrides={native:node_path for native,key,node_path in records if len(paths_by_scope[key])>1}
    # Exact digest of ALL current identities/version IDs/flat coordinates; SQL must match before enrichment.
    inventory='\n'.join(canonical(row) for _,row in sorted(signature,key=lambda pair:pair[0].encode('utf-8')))
    return {'schema_version':'california-publisher-hierarchy/1','codes':codes,'nodes':nodes,'scope_paths':scopes,'overrides':overrides,'section_count':len(records),'spacing_only_identity_count':len(spacing_differences),'spacing_only_identity_records':spacing_differences,'section_metadata_sha256':sha(inventory),'ambiguous_scope_count':sum(len(paths)>1 for paths in paths_by_scope.values()),'publication_allowed':False,'calculation_activation_allowed':False,'current_law_verified':False}

def hierarchy_for(payload,native_id,row):
    node_path=payload['overrides'].get(native_id) or payload['scope_paths'].get(canonical(scope(row)))
    if not node_path:raise ValueError('No exact version-backed ancestry for '+native_id)
    code=row[1]
    result=[{'level':'code','number':code,'heading':payload['codes'][code]}]
    for parent in ancestors(node_path):
        level,number,heading=payload['nodes'][code+'|'+parent]
        result.append({'level':level,'number':number,'heading':heading})
    result.append({'level':'section','number':native_id.removeprefix('CA:').split('~',1)[0],'heading':None})
    return result

def main():
    args=argparse.ArgumentParser()
    args.add_argument('--archive',type=Path,required=True)
    args.add_argument('--expected-sha256',required=True)
    args.add_argument('--out',type=Path,required=True)
    options=args.parse_args()
    if options.out.exists():raise SystemExit('Choose a fresh versioned output directory')
    if not re.fullmatch('[a-f0-9]{64}',options.expected_sha256):raise SystemExit('Exact expected archive checksum required')
    h=hashlib.sha256()
    with options.archive.open('rb') as handle:
        for block in iter(lambda:handle.read(1<<20),b''):h.update(block)
    if h.hexdigest()!=options.expected_sha256:raise SystemExit('Whole-archive checksum mismatch')
    tables={};receipts=[]
    with zipfile.ZipFile(options.archive) as archive:
        names=archive.namelist()
        for name in TABLES:
            if names.count(name)!=1:raise ValueError('Missing or duplicate publisher table '+name)
            info=archive.getinfo(name)
            if not 0<info.file_size<70*1024*1024:raise ValueError('Table exceeds extraction bounds')
            data=archive.read(name)
            tables[name]=list(csv.reader(io.StringIO(data.decode('utf-8','strict')),delimiter='\t',quotechar='`'))
            receipts.append({'member':name,'sha256':sha(data),'bytes':len(data),'zip_crc32':info.CRC})
    payload=build_payload(tables['CODES_TBL.dat'],tables['LAW_TOC_TBL.dat'],tables['LAW_SECTION_TBL.dat'],tables['LAW_TOC_SECTIONS_TBL.dat'])
    payload.update(source_archive_sha256=options.expected_sha256,source_url='https://downloads.leginfo.legislature.ca.gov/'+options.archive.name,source_members=receipts)
    counts=Counter();maximum_depth=0
    for native,row in native_occurrences(tables['LAW_SECTION_TBL.dat']):
        hierarchy=hierarchy_for(payload,native,row);maximum_depth=max(maximum_depth,len(hierarchy))
        counts.update(level['level'] for level in hierarchy[:-1])
        if any(not node['heading'] for node in hierarchy[:-1]):raise ValueError('Unresolved ancestor heading')
    encoded=canonical(payload).encode('utf-8');options.out.mkdir(parents=True)
    (options.out/'hierarchy-payload.json').write_bytes(encoded)
    report={'schema_version':payload['schema_version'],'source_archive_sha256':options.expected_sha256,'payload_sha256':sha(encoded),'payload_bytes':len(encoded),'section_metadata_sha256':payload['section_metadata_sha256'],'sections':payload['section_count'],'publisher_toc_nodes':len(payload['nodes']),'exact_scope_groups':len(payload['scope_paths']),'ambiguous_scope_groups':payload['ambiguous_scope_count'],'explicit_version_overrides':len(payload['overrides']),'codes':len(payload['codes']),'spacing_only_identity_count':payload['spacing_only_identity_count'],'spacing_only_identity_records':payload['spacing_only_identity_records'],'ancestor_occurrences':dict(counts),'maximum_depth':maximum_depth,'missing_ancestor_headings':0,'source_members':receipts,'publication_allowed':False,'calculation_activation_allowed':False,'current_law_verified':False,'law_cutoff':'Not inferred from the session filename, capture time or metadata update timestamps.'}
    (options.out/'hierarchy-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
