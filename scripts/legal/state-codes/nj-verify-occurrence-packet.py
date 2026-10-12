#!/usr/bin/env python3
"""Offline full replay of an NJ source-occurrence packet and separate crosswalk evidence."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re

SPEC=importlib.util.spec_from_file_location('nj_verify_parser',Path(__file__).with_name('nj-parse-bulk.py'))
P=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(P)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def lines(path):
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            if line.strip():yield json.loads(line)
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def check(ok,message):
    if not ok:raise ValueError(message)
def canon(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def verify(base,packet,evidence):
    receipt,members=P.load_archive(base,'STATUTES')
    raw_sha=P.sha(members['STATUTES.TXT']);rtf_sha=P.sha(members['STATUTES.RTF'])
    source=members['STATUTES.TXT'].decode('cp1252').replace('\r\n','\n')
    headings,anomalies=P.bind_headings(source,members['STATUTES.RTF'].decode('cp1252'))
    expected={};title=None;titles={}
    for i,h in enumerate(headings):
        end=headings[i+1]['start'] if i+1<len(headings) else len(source)
        if h['kind']=='title':
            title=h;titles[h['native_title']]=h;continue
        check(title is not None,'Occurrence outside a publisher title')
        expected[h['start']]={'heading':h,'end':end,'title':title}
    units={u['unit_key']:u for u in lines(packet/'units.jsonl')}
    objects={o['sha256']:o for o in lines(packet/'objects.jsonl')}
    check(len(units)==len(titles),'Publisher title inventory differs')
    for obj in objects.values():
        path=Path(obj['path'])
        check(path.stat().st_size==obj['bytes'] and digest(path)==obj['sha256'],'Retained object bytes/hash differ')
    ordered_titles=list(titles.values())
    for i,h in enumerate(ordered_titles):
        end=ordered_titles[i+1]['start'] if i+1<len(ordered_titles) else len(source)
        u=units['title-'+h['native_title']];body=source[h['start']:end]
        check(u['original_sha256']==raw_sha and u['parent_archive_sha256']==receipt['sha256'],'Original/archive binding differs')
        check(u['raw_member_sha256']==raw_sha and u['publisher_member']=='STATUTES.TXT','Member binding differs')
        check(u['text_sha256']==P.sha(body.encode()) and u['text_code_points']==len(body),'Title text differs')
        check(Path(objects[u['text_sha256']]['path']).read_bytes()==body.encode(),'Title object is not exact source text')
    counts=Counter(e['heading'].get('citation') for e in expected.values() if e['heading']['kind']=='section')
    seen=set();ids=set();per_title=Counter();by_ordinal={};issues=Counter();ledger=[]
    for row in lines(packet/'sections.jsonl'):
        check(row['identity_kind']=='publisher_source_occurrence','Canonical identity incorrectly asserted')
        u=units[row['unit_key']];title=titles[row['hierarchy'][0]['number']]
        start=title['start']+row['span']['start'];end=title['start']+row['span']['end']
        check(start in expected and start not in seen,'Missing, extra or duplicated source occurrence')
        e=expected[start];h=e['heading'];body=source[start:e['end']]
        check(end==e['end'] and row['text']==body,'Occurrence text differs from exact source span')
        check(row['unit_key']=='title-'+e['title']['native_title'],'Physical title differs')
        expected_id=f"src-{raw_sha}-{row['unit_key']}-{row['span']['start']}-{row['span']['end']}"
        check(row['citation_path']==expected_id and expected_id not in ids,'Source span identity differs')
        o=row['source_occurrence']
        check(o==dict(member='STATUTES.TXT',member_sha256=raw_sha,archive_sha256=receipt['sha256'],
            rtf_member_sha256=rtf_sha,rtf_ordinal=h['rtf_ordinal'],rtf_span=h['rtf_span'],kind=h['kind'],
            printed_heading=h['heading'],unit_span=row['span']),'Source occurrence evidence differs')
        printed=h.get('printed_citation')
        if printed and '-' not in printed:
            continuation=re.match(r'[ \t]+[0-9]+(?=[ \t])',h['heading'][len(printed):])
            if continuation:printed+=continuation[0]
        check(row['citation']==(printed or h['heading']) and row['heading']==h['heading'],'Printed heading or citation rewritten')
        check(row['hierarchy']==[dict(level='title',number=e['title']['native_title'],heading=e['title']['heading']),
            dict(level='section',number=printed,heading=h['heading'])],'Source hierarchy rewritten')
        check('current legal effect has not been verified' in row['status_note'],'Unverified effect warning missing')
        if counts.get(h.get('citation'),0)>1:
            check('no operative version is selected' in row['status_note'],'A duplicate occurrence is silently preferred')
            issues['duplicate_occurrences']+=1
        if h.get('citation') and h['citation'].split(':',1)[0]!=e['title']['native_title']:
            check('conflicts with the physical publisher title' in row['status_note'],'Cross-title conflict warning missing')
            issues['cross_title_conflicts']+=1
        if h['kind']=='unmapped_headnote':
            check('not asserted to be an operative statutory section' in row['status_note'],'Notice/malformed block warning missing')
            issues['unmapped_headnotes']+=1
        check(row['currency']['statement']==source[:ordered_titles[0]['start']].strip(),'Source edition marker differs')
        check(row['currency']['through_date'] is None,'Unsupported current-law date')
        seen.add(start);ids.add(expected_id);per_title[row['unit_key']]+=1
        by_ordinal[h['rtf_ordinal']]={'native_id':'NJ:'+expected_id,'text_sha256':P.sha(body.encode()),'heading':h['heading']}
        ledger.append({'native_id':'NJ:'+expected_id,'text_sha256':P.sha(body.encode()),
            'hierarchy_sha256':P.sha(canon(row['hierarchy']).encode()),'source_occurrence_sha256':P.sha(canon(o).encode()),
            'display_sha256':P.sha(canon({k:row[k] for k in ('citation','heading','status_note','currency')}).encode())})
    check(seen==set(expected),'Some publisher source occurrences were omitted')
    check(all(u['sections_expected']==per_title[k] for k,u in units.items()),'Per-title counts differ')
    manifest=read(packet/'manifest.json');holds=read(packet/'release-holds.json');summary=read(packet/'staging-report.json')
    check(manifest['section_id']['scheme']=='publisher_source_occurrence','Manifest incorrectly asserts canonical identity')
    check(holds['publication_allowed'] is False and holds['calculation_activation_allowed'] is False,'Authority gates must stay false')
    check(summary['source_occurrences']==len(seen),'Summary count differs')
    review=read(evidence/'source-anomaly-review.json');crosswalks=[]
    for e in review['explicit_and_conflicting_source_evidence']:
        row=by_ordinal[e['source_rtf_ordinal']];sid=e['source_id']
        check(row['text_sha256']==e['captured_source_text_sha256'] and row['heading']==e['captured_source_heading'],'Crosswalk names another occurrence')
        r=read(evidence/(sid+'.receipt.json'));render=read(evidence/(sid+'.rendering-v2.json'))
        raw=evidence/(sid+'.raw');plain=evidence/(sid+'.plain.txt')
        check(r['http_status']==200 and r['source_url']==e['source_url'] and r['proxy'] is None,'Crosswalk is not captured direct primary evidence')
        check(digest(raw)==r['sha256']==e['raw_sha256']==render['source_raw_sha256'],'Crosswalk raw bytes differ')
        check(digest(plain)==render['text_sha256'],'Crosswalk rendering differs')
        check(e['quote'] in plain.read_text(encoding='utf-8'),'Crosswalk quote absent from retained rendering')
        crosswalks.append({**e,'source_occurrence_id':row['native_id'],'canonical_lookup_enabled':False,'source_text_replaced':False,
                          'evidence_text_sha256':render['text_sha256']})
    ledger_sha=P.sha(('\n'.join(canon(r) for r in sorted(ledger,key=lambda r:r['native_id']))+'\n').encode())
    return dict(schema_version='nj-source-occurrence-verification/1',passed=True,source_occurrences=len(seen),
        titles=len(units),objects=len(objects),objects_bytes=sum(o['bytes'] for o in objects.values()),
        archive_sha256=receipt['sha256'],member_sha256=raw_sha,manifest_sha256=P.sha(canon(manifest).encode()),
        full_identity_text_hierarchy_occurrence_ledger_sha256=ledger_sha,issues=dict(issues),
        duplicate_groups=sum(n>1 for n in counts.values()),source_anomalies=len(anomalies),
        statutes_marker=summary['statutes_version_marker'],toc_marker=summary['toc_version_marker'],
        crosswalk_evidence=crosswalks,explicit_crosswalk_count=sum(e['target'] is not None for e in crosswalks),
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False,
        qualification='Exact source occurrences only. No current-law certification; duplicates and malformed headings remain literal.')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ('base','packet','evidence','output'):p.add_argument('--'+arg,type=Path,required=True)
    a=p.parse_args();result=verify(a.base,a.packet,a.evidence)
    with a.output.open('x',encoding='utf-8',newline='\n') as stream:json.dump(result,stream,ensure_ascii=False,indent=2);stream.write('\n')
    print(json.dumps({k:v for k,v in result.items() if k!='crosswalk_evidence'},ensure_ascii=True,indent=2))
