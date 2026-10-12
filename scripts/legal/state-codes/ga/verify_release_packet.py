#!/usr/bin/env python3
"""Full offline comparison of staged GA records to the pinned third-party release.

This checks release fidelity and raw PDF integrity; it does not claim that a
third-party extraction matches every PDF passage or establishes operative law.
"""
import argparse
from collections import Counter
import gzip
import hashlib
from itertools import zip_longest
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

def sha(raw):return hashlib.sha256(raw).hexdigest()
def canon(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def rows(path):
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            if line.strip():yield json.loads(line)
def require(ok,message):
    if not ok:raise ValueError(message)
def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def verify(data_dir,packet):
    manifest=read(packet/'manifest.json');report=read(packet/'staging-report.json');receipt=read(data_dir/'ocga-code.jsonl.gz.receipt.json')
    comparison_report=read(packet/'pdf-comparison-report.json')
    comparison_rows={}
    for item in rows(packet/'pdf-comparison-rows.jsonl'):
        require(item['ordinal'] not in comparison_rows,'Duplicate PDF comparison ordinal')
        comparison_rows[item['ordinal']]=item
    comparison_sha=file_sha(packet/'pdf-comparison-rows.jsonl')
    require(comparison_sha==comparison_report['row_ledger_sha256']==manifest['pdf_comparison']['row_ledger_sha256']
        and file_sha(packet/'pdf-comparison-report.json')==manifest['pdf_comparison']['report_sha256'],'PDF comparison evidence bytes changed')
    release=data_dir/'ocga-code.jsonl.gz';release_sha=file_sha(release)
    require(release_sha==receipt['sha256']==report['release_sha256'],'Release bytes differ')
    require(comparison_report['bulk_sha256']==release_sha and comparison_report['records']==len(comparison_rows),'PDF comparison release/count changed')
    require(manifest['retrieval']['official_source'] is False and manifest['provenance_class']=='third_party_edition_archive','Incorrect official-source claim')
    require(manifest['current_law_verified'] is False and manifest['calculation_activation_allowed'] is False,'Legal authority enabled')
    require(manifest['section_id']['scheme']=='third_party_source_occurrence','Incorrect canonical identity claim')
    qualification=manifest['archive']['qualification'];edition=manifest['archive']['edition']
    objects={o['sha256']:o for o in rows(packet/'objects.jsonl')};units={u['unit_key']:u for u in rows(packet/'units.jsonl')}
    texts={}
    for o in objects.values():
        path=Path(o['path']);require(path.stat().st_size==o['bytes'] and file_sha(path)==o['sha256'],'Object bytes/hash mismatch')
        if o['kind']=='unit_text_derivative':texts[o['sha256']]=path.read_text(encoding='utf-8')
    raw_records=[]
    with gzip.open(release,'rb') as stream:
        for line in stream:raw_records.append((sha(line),json.loads(line.decode('utf-8'))))
    duplicates=Counter(r['citation'] for _,r in raw_records);seen=set();unit_counts=Counter();cursor=Counter();status_only=0;version_qualifiers=0
    for ordinal,pair in enumerate(zip_longest(raw_records,rows(packet/'sections.jsonl')),1):
        original,row=pair;require(original is not None and row is not None,'Release occurrence count differs')
        record_sha,r=original;s=r['text_source'];title=str(r['title']);unit=units['title-'+title]
        require(row['citation_path']==f'src-{release_sha}-record-{ordinal}','Source ordinal identity changed')
        require(row['citation_path'] not in seen,'Occurrence overwritten');seen.add(row['citation_path'])
        require(row['text']==r['text'] and row['citation']==r['citation'] and row['heading']==(r['catchline'] or None)
                and row['history']==(r['history'] or None),'Source text/citation/heading/history changed')
        require(row['provenance_class']==manifest['provenance_class'] and row['archive_edition']==edition
                and row['source_qualification']==qualification and qualification in row['status_note'],'Qualification missing')
        require(row['unit_key']=='title-'+title and row['identity_kind']=='third_party_source_occurrence','Wrong source identity/unit')
        expected_span=dict(unit='unicode_code_points',start=cursor[title],end=cursor[title]+len(r['text']))
        require(row['span']==expected_span,'Source unit span differs')
        body=texts[unit['text_sha256']];require(body[expected_span['start']:expected_span['end']]==r['text'],'Unit derivative changes source body')
        require(body[expected_span['end']:expected_span['end']+1]=='\n','Unit separator differs')
        cursor[title]=expected_span['end']+1;unit_counts[row['unit_key']]+=1
        occurrence=dict(kind='jsonl_record',release_sha256=release_sha,record_ordinal=ordinal,record_sha256=record_sha,
            unit_span=expected_span,text_field_empty=(r['text']==''),source_status=r['status'])
        require(row['source_occurrence']==occurrence,'Raw source-record identity changed')
        classification='official_publisher' if urlsplit(s['source_url']).hostname=='www.legis.ga.gov' else 'third_party_historical_archive'
        compared=comparison_rows.get(ordinal)
        require(compared is not None and all(compared.get(k)==v for k,v in dict(citation=r['citation'],source_sha256=s['sha256'],
            page_start=s['page_start'],page_end=s['page_end'],text_sha256=sha(r['text'].encode()),source_status=r['status'],effective_qualifier=r.get('effective_qualifier')).items()),'PDF comparison changed source binding')
        require(row['source_pdf']==dict(sha256=s['sha256'],source_url=s['source_url'],page_start=s['page_start'],page_end=s['page_end'],provenance_class=classification,
            comparison=compared['comparison'],comparison_ledger_sha256=comparison_sha,extracted_pages_sha256=compared['extracted_pages_sha256'],
            normalization=comparison_report['normalization']),'PDF source binding changed')
        if compared['comparison']=='unresolved_pdf_text_order_or_content':
            require('PDF comparison unresolved' in row['status_note'] and 'did not match' in row['status_note'],'Unresolved PDF comparison hidden')
        elif compared['comparison']=='whole_body_line_hyphen_join':
            require('only after also joining words split by line-end hyphens' in row['status_note'],'Hyphen normalization concealed')
        elif compared['comparison']=='publisher_status_without_body':
            require(not r['text'] and 'No body was available for PDF comparison' in row['status_note'],'Status falsely verified')
        else:
            require(compared['comparison']=='whole_body_normalized_substring' and r['text']
                and 'after Unicode NFKC, whitespace and soft-hyphen normalization' in row['status_note'],'PDF comparison normalization concealed')
        require(s['sha256'] in objects and any(x['source_url']==s['source_url'] for x in objects[s['sha256']]['sources']),'PDF original missing')
        hierarchy=[dict(level='title',number=title,heading=r['headings']['title'])]
        for level in ('chapter','article','part','subpart'):
            if r.get(level) is not None:hierarchy.append(dict(level=level,number=str(r[level]),heading=r['headings'].get(level)))
        hierarchy.append(dict(level='section',number=r['citation'],heading=r['catchline'] or None))
        require(row['hierarchy']==hierarchy,'Printed release hierarchy changed')
        if duplicates[r['citation']]>1:require('no operative version has been selected' in row['status_note'],'Duplicate preference hidden')
        if r.get('effective_qualifier'):
            version_qualifiers+=1;require(r['effective_qualifier'] in row['status_note'],'Effective qualifier omitted')
        for warning in r.get('warnings',[]):
            require(str(warning).replace('dehyphenation_unverified:','unverified word break: ') in row['status_note'],'Upstream extraction warning omitted')
        if r.get('printing') is not None:require('Release printing label: '+str(r['printing'])+'.' in row['status_note'],'Printing label omitted')
        if r.get('range_end'):require('Release range endpoint: '+r['range_end']+'.' in row['status_note'],'Range endpoint omitted')
        if not r['text']:
            status_only+=1;require('No body text is present' in row['status_note'] and 'not independently verified' in row['status_note'],'Empty status misrepresented')
        require(row['currency']['through_date'] is None and row['currency']['edition']==edition,'Unsupported current-law date')
    for key,unit in units.items():
        title=key.removeprefix('title-')
        require(cursor[title]==len(texts[unit['text_sha256']])==unit['text_code_points'],'Unaccounted unit source text')
        require(unit['sections_expected']==unit_counts[key] and unit['original_sha256']==release_sha,'Unit count/original mismatch')
    require(len(seen)==len(comparison_rows),'Unaccounted PDF comparison rows')
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'common'))
    import land_publisher_code_v2 as lander
    manifest_sha=sha(canon(manifest).encode());unit_rows,section_rows=lander.build_rows(str(packet),manifest_sha,manifest)
    ledger=''.join(r['entity_type']+'\t'+r['native_id']+'\t'+r['provenance']['record_sha256']+'\n'
                   for r in sorted(unit_rows+section_rows,key=lambda r:(r['entity_type'],r['native_id'])))
    return dict(schema_version='ga-third-party-packet-verification/1',passed=True,manifest_sha256=manifest_sha,
        source_records=len(seen),units=len(units),objects=len(objects),status_only_records=status_only,
        duplicate_citation_groups=sum(n>1 for n in duplicates.values()),records_with_effective_qualifiers=version_qualifiers,
        expected_cloud_payload_ledger_sha256=sha(ledger.encode()),
        pdf_comparisons=comparison_report['comparisons'],pdf_comparison_ledger_sha256=comparison_sha,
        qualification='All retained release fields, exact source record bytes, unit spans and raw PDF hashes verified. Per-record PDF comparison results and unresolved cases retained visibly; legal effect is not verified.',
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('data-dir','packet','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();result=verify(a.data_dir,a.packet)
    with a.output.open('x',encoding='utf-8',newline='\n') as stream:json.dump(result,stream,indent=2);stream.write('\n')
    print(json.dumps(result,indent=2))
