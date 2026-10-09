#!/usr/bin/env python3
"""Stage exact NJ publisher occurrences for review. Offline; never writes a database.

Original ZIP/TXT/RTF bytes and source spans are rechecked before output. A staged
packet is not a publication approval: unresolved title/citation mismatches remain
in quarantine and deliberately fail the existing lander's completeness preflight.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import zipfile

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('nj_official_parser', HERE / 'nj-parse-bulk.py')
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)
BASE_URL = 'https://pub.njleg.gov/statutes/'
VERSION = 'nj-publisher-staging/1'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def json_file(path: Path, value) -> None:
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def json_lines(path: Path, rows) -> None:
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')


def inside(root: Path, name: str) -> Path:
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Source path escapes its capture root')
    return path


def marker(text: str) -> str:
    return next((line.strip() for line in text.splitlines() if line.strip()), '')


def stage(base: Path, parsed: Path, output: Path) -> dict:
    base, parsed, output = base.resolve(), parsed.resolve(), output.resolve()
    if output.exists():
        raise FileExistsError('Staging output already exists; retain prior source versions')
    report = read_json(parsed / 'parse-report.json')
    if report.get('publication_allowed') is not False or report.get('calculation_activation_allowed') is not False:
        raise ValueError('Input must explicitly remain an unactivated publisher capture')
    objects = {}
    source_sets = {}
    receipts = {}
    for name in ('STATUTES', 'LCTOC', 'NJCONST'):
        receipt = read_json(base / (name + '-TEXT.zip.receipt.json'))
        archive_name = name + '-TEXT.zip'
        if receipt.get('raw_file') != archive_name or receipt.get('source_url') != BASE_URL + archive_name:
            raise ValueError('Unexpected official archive identity')
        # Bound member expansion and reject duplicate/extra member names before reading.
        with zipfile.ZipFile(base / archive_name) as archive:
            info = archive.infolist()
            if len(info) != 2 or {m.filename for m in info} != {name+'.TXT', name+'.RTF'}:
                raise ValueError('Unexpected archive members')
            if any(m.file_size < 1 or m.file_size > 200 * 1024 * 1024 for m in info):
                raise ValueError('Archive member exceeds source bounds')
        receipt, members = PARSER.load_archive(base, name)
        receipts[name] = receipt
        source = dict(source_url=receipt['source_url'], retrieved_at=receipt['finished_at'],
                      http_status=200, retrieval_method='publisher_bulk_download', proxy=None)
        objects[receipt['sha256']] = dict(sha256=receipt['sha256'], bytes=receipt['bytes'],
            kind='publisher_original', path=str(base / archive_name), sources=[source])
        for member, raw in members.items():
            held = inside(parsed, 'members/' + member)
            if held.read_bytes() != raw:
                raise ValueError('Parsed original member differs from archived source: ' + member)
            member_sha = sha(raw)
            objects[member_sha] = dict(sha256=member_sha, bytes=len(raw), kind='publisher_original',
                path=str(held), sources=[{**source, 'retrieval_method': 'publisher_zip_member'}])
        source_sets[name] = members

    text = source_sets['STATUTES']['STATUTES.TXT'].decode('cp1252').replace('\r\n', '\n')
    normalized = inside(parsed, 'members/STATUTES.TXT.utf8').read_bytes()
    if normalized != text.encode('utf-8'):
        raise ValueError('Normalized statutes differ from the original source')
    rtf = source_sets['STATUTES']['STATUTES.RTF'].decode('cp1252')
    headings, anomalies = PARSER.bind_headings(text, rtf)
    original_titles = [h for h in headings if h['kind'] == 'title']
    source_sections = []
    title = None
    for index, heading in enumerate(headings):
        if heading['kind'] == 'title':
            title = heading
        elif heading['kind'] == 'section':
            source_sections.append((heading, headings[index+1]['start'] if index+1 < len(headings) else len(text), title))

    rows_file = parsed / 'sections.jsonl'
    if sha(rows_file.read_bytes()) != report.get('sections_sha256'):
        raise ValueError('Section index hash differs from parse report')
    with rows_file.open(encoding='utf-8') as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    if len(rows) != len(source_sections) or len(rows) != report.get('section_occurrences'):
        raise ValueError('Source styled-section count disagrees with parsed index')
    titles = read_json(parsed / 'titles.json')
    if len(titles) != len(original_titles) or len(titles) != report.get('titles'):
        raise ValueError('Source title count disagrees with parsed index')

    statutes_marker = text[:original_titles[0]['start']].strip()
    toc_marker = marker(source_sets['LCTOC']['LCTOC.TXT'].decode('cp1252'))
    receipt = receipts['STATUTES']
    source = dict(source_url=receipt['source_url'], retrieved_at=receipt['finished_at'],
                  retrieval_method='publisher_zip_member', proxy=None, http_status=200)
    currency = dict(basis='publisher_statement', statement=statutes_marker,
                    through_date=None, edition=statutes_marker)
    raw_member_sha = sha(source_sets['STATUTES']['STATUTES.TXT'])
    verified_titles = {}
    units = []
    for i, (held, original) in enumerate(zip(titles, original_titles, strict=True)):
        end = original_titles[i+1]['start'] if i+1 < len(original_titles) else len(text)
        for field in ('native_title', 'start', 'heading', 'heading_span'):
            if held.get(field) != original.get(field):
                raise ValueError('Title source identity mismatch: ' + field)
        if held.get('end') != end:
            raise ValueError('Title source span mismatch')
        key = original['native_title']
        if key in verified_titles:
            raise ValueError('Duplicate publisher title key')
        body = text[original['start']:end]
        path = inside(parsed, held['text_file'])
        if path.read_bytes() != body.encode('utf-8') or sha(body.encode('utf-8')) != held['text_sha256']:
            raise ValueError('Title derivative does not equal its exact source span')
        verified_titles[key] = held
        unit_key = 'title-' + key
        objects[held['text_sha256']] = dict(sha256=held['text_sha256'],bytes=len(body.encode('utf-8')),
            kind='unit_text_derivative',path=str(path),code_points=len(body),sources=[source])
        units.append(dict(unit_key=unit_key,unit_kind='publisher_title',heading=held['heading'],
            original_sha256=raw_member_sha,parent_archive_sha256=receipt['sha256'],
            publisher_member='STATUTES.TXT',raw_member_sha256=raw_member_sha,
            text_sha256=held['text_sha256'],text_code_points=len(body),sections_expected=0,
            currency=currency,**{k:v for k,v in source.items() if k!='http_status'}))

    candidates, quarantine = [], []
    counts = Counter()
    per_title = Counter()
    for row, (original, end, title) in zip(rows, source_sections, strict=True):
        if title is None:
            raise ValueError('Source section outside a title')
        for field in ('start', 'citation', 'heading', 'heading_span', 'rtf_span', 'rtf_ordinal'):
            if row.get(field) != original.get(field):
                raise ValueError('Section source heading/span mismatch: ' + field)
        title_row = verified_titles[title['native_title']]
        span = [original['start']-title_row['start'], end-title_row['start']]
        body = text[original['start']:end]
        counts[row['citation']] += 1
        if (row.get('end') != end or row.get('title_span') != span or
            row.get('native_title') != title['native_title'] or row.get('text_characters') != len(body) or
            row.get('text_sha256') != sha(body.encode('utf-8')) or
            row.get('title_text_sha256') != title_row['text_sha256'] or
            row.get('occurrence') != counts[row['citation']]):
            raise ValueError('Section text/source span/occurrence does not reconcile')
        occurrence = counts[row['citation']]
        if row['citation'].split(':',1)[0] != title['native_title']:
            quarantine.append({**row,'text':body,'reason':'citation_title_differs_from_physical_publisher_title',
                               'publication_allowed':False,'calculation_activation_allowed':False})
            continue
        path = row['citation'] + ('~'+str(occurrence) if occurrence>1 else '')
        candidates.append(dict(citation_path=path,citation=row['printed_citation'],
            heading=row['heading'][len(row['printed_citation']):].strip() or None,text=body,
            hierarchy=[dict(level='title',number=title['native_title'],heading=title['heading']),
                       dict(level='section',number=row['citation'],heading=row['heading'])],
            history=None,status_note=('Repeated publisher occurrence; operative version unresolved' if occurrence>1 else None),
            unit_key='title-'+title['native_title'],span=dict(unit='unicode_code_points',start=span[0],end=span[1]),
            currency=currency))
        per_title['title-'+title['native_title']] += 1
    for unit in units:
        unit['sections_expected'] = per_title[unit['unit_key']]

    unmapped = read_json(parsed/'source-anomalies.json')
    if unmapped.get('headnotes') != anomalies:
        raise ValueError('Stored source anomaly ledger differs from replay')
    holds = [dict(code='operative_law_review_pending',detail='Source capture is not legal-effect certification'),
             dict(code='chapter_article_hierarchy_not_yet_reconciled',detail='Only publisher title and section hierarchy is represented')]
    if statutes_marker != toc_marker:
        holds.append(dict(code='publisher_version_markers_differ',statutes=statutes_marker,toc=toc_marker))
    if anomalies:
        holds.append(dict(code='publisher_headnote_anomalies',count=len(anomalies)))
    if quarantine:
        holds.append(dict(code='cross_title_sections_quarantined',count=len(quarantine)))
    duplicates={key:n for key,n in counts.items() if n>1}
    if duplicates:
        holds.append(dict(code='repeated_citation_versions_unresolved',count=len(duplicates)))
    manifest=dict(schema_version='publisher-code-manifest/2',jurisdiction='NJ',
        publisher='New Jersey Legislature, Office of Legislative Services',publisher_url=BASE_URL,
        source_system='nj-pub-statutes-bulk',code_title='New Jersey General and Permanent Statutes',
        parser=dict(name='nj-publisher-staging',version='1'),
        retrieval=dict(methods=['publisher_bulk_download','publisher_zip_member'],
            source_url_patterns=[r'^https://pub\.njleg\.gov/statutes/(STATUTES|LCTOC|NJCONST)-TEXT\.zip$'],
            terms_gate=False,official_source=True,rate_limit_ms=1000),
        structure=dict(levels=['title','section'],unit='publisher title TXT span paired with RTF headings'),
        section_id=dict(scheme='official_citation_path',regex=r'^[0-9A-Za-z.():-]+(?:~[1-9][0-9]*)?$',
            example='2A:14-2',citation_format='Printed citation; ~N means source occurrence, not a legal version'),
        currency=dict(basis='publisher_statement',location='Captured STATUTES.TXT preamble; distinct LCTOC marker'),
        review=dict(reviewed_by='automated source-span replay only; legal/publication review pending',
                    reviewed_at=receipt['finished_at'][:10]))
    summary=dict(schema_version=VERSION,source_system=manifest['source_system'],
        archive_sha256=receipt['sha256'],source_sections=len(rows),titles=len(units),
        candidate_sections=len(candidates),quarantined_sections=len(quarantine),
        repeated_citation_groups=len(duplicates),publisher_headnote_anomalies=len(anomalies),
        unmapped_source_blocks=len(unmapped['unmapped_blocks']),
        statutes_version_marker=statutes_marker,toc_version_marker=toc_marker,
        publication_allowed=False,calculation_activation_allowed=False,
        completeness_preflight_expected='blocked' if quarantine else 'structural_only')
    output.mkdir(parents=True)
    json_file(output/'manifest.json',manifest)
    json_lines(output/'objects.jsonl',sorted(objects.values(),key=lambda r:r['sha256']))
    json_lines(output/'units.jsonl',units)
    json_lines(output/'sections.jsonl',candidates)
    json_lines(output/'quarantine.jsonl',quarantine)
    json_file(output/'source-anomalies.json',unmapped)
    json_file(output/'release-holds.json',dict(publication_allowed=False,calculation_activation_allowed=False,holds=holds))
    json_file(output/'toc-proof.json',dict(marker='Original paired RTF styled-section headings replayed against original TXT; not a full operative-code audit',
        pages=[dict(url=receipt['source_url'],markers=len(source_sections),sections=len(candidates))],unfetched_child_pages=[]))
    json_file(output/'staging-report.json',summary)
    return summary


if __name__ == '__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--base',type=Path,required=True)
    cli.add_argument('--parsed',type=Path,required=True)
    cli.add_argument('--output',type=Path,required=True)
    args=cli.parse_args()
    print(json.dumps(stage(args.base,args.parsed,args.output),ensure_ascii=False,indent=2))
