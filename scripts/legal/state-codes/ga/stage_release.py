#!/usr/bin/env python3
"""Stage the pinned Georgia Commons edition as qualified third-party source occurrences.

Offline only. Every original release/PDF hash is rechecked. No operative version is
selected; empty upstream status records remain empty instead of invented law text.
"""
import argparse
from collections import Counter,defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

RELEASE_SHA='5cc3304062371359a814c144b68105e0fa56a74992561e418b44bef6980ee3a5'
RELEASE='ocga-2025-supplement-v3'
URL='https://github.com/shanejorr/georgiacommons-ocga-data/releases/download/'+RELEASE+'/ocga-code.jsonl.gz'
EDITION='2025 supplement (Georgia Commons release '+RELEASE+')'
CLASS='third_party_edition_archive'
QUALIFICATION='Third-party edition: '+EDITION+'. Current legal effect is not verified. Printed versions and upstream extraction warnings are retained without selecting operative law. Unresolved PDF comparisons require review.'
COMPARISON_NOTES={
    'whole_body_normalized_substring': 'The complete release body matched text extracted from its cited PDF pages after Unicode NFKC, whitespace and soft-hyphen normalization. This does not establish legal effect or currency.',
    'whole_body_line_hyphen_join': 'The complete release body matched text extracted from its cited PDF pages only after also joining words split by line-end hyphens. This does not establish legal effect or currency.',
    'unresolved_pdf_text_order_or_content': 'PDF comparison unresolved: the complete release body did not match the extracted cited pages. Text order or content requires review; the release text is preserved without correction.',
    'publisher_status_without_body': 'No body was available for PDF comparison. The upstream status is unverified; its linked PDF may contain an older printing.',
}

def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def save(path,data):
    with path.open('x',encoding='utf-8',newline='\n') as stream:json.dump(data,stream,ensure_ascii=False,indent=2);stream.write('\n')
def write_row(stream,row):stream.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
def metadata():return dict(provenance_class=CLASS,archive_edition=EDITION,source_qualification=QUALIFICATION)

def comparisons(directory,release_sha):
    report=read(directory/'report.json');path=directory/'row-comparisons.jsonl'
    if (report.get('schema_version')!='ga-independent-pdf-text-comparison/1'
        or report.get('bulk_sha256')!=release_sha or report.get('row_ledger_sha256')!=file_sha(path)
        or report.get('current_law_verified') is not False):
        raise ValueError('Completed PDF comparison report does not bind the exact release and row ledger')
    result={};counts=Counter()
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            r=json.loads(line);ordinal=r.get('ordinal');status=r.get('comparison')
            if type(ordinal) is not int or ordinal<1 or ordinal in result or status not in COMPARISON_NOTES:
                raise ValueError('Duplicate, invalid or unknown PDF comparison row')
            result[ordinal]=r;counts[status]+=1
    if report.get('records')!=len(result) or dict(counts)!=report.get('comparisons'):
        raise ValueError('PDF comparison ledger is incomplete')
    return report,result
def records(path):
    with gzip.open(path,'rb') as stream:
        for ordinal,line in enumerate(stream,1):
            if not line.strip():raise ValueError('Blank release line is not an identified source record')
            row=json.loads(line.decode('utf-8'))
            if row.get('citation_scheme')!='ocga' or not isinstance(row.get('text'),str):
                raise ValueError('Unexpected source record scheme or body')
            if type(row.get('title')) is not int or not 1<=row['title']<=53:
                raise ValueError('Unexpected source title')
            if not re.fullmatch(r'[0-9]+[A-Za-z]?(?:-[0-9A-Za-z.]+)+',str(row.get('citation',''))):
                raise ValueError('Unrecognized literal citation; never normalize silently')
            yield ordinal,line,row

def stage(data_dir,pdf_dir,output,expected_release_sha=RELEASE_SHA,comparison_dir=None):
    if output.exists():raise FileExistsError('Use a new versioned packet; prior captures are never overwritten')
    release=data_dir/'ocga-code.jsonl.gz';receipt=read(data_dir/'ocga-code.jsonl.gz.receipt.json')
    if (file_sha(release)!=expected_release_sha or receipt['sha256']!=expected_release_sha
        or receipt['http_status']!=200 or receipt['source_url']!=URL or receipt['bytes']!=release.stat().st_size
        or receipt.get('retrieval_method')!='direct_third_party_release_download' or receipt.get('proxy') is not None):
        raise ValueError('Pinned third-party release receipt/hash mismatch')
    if comparison_dir is None:raise ValueError('A completed per-record PDF comparison report is required')
    comparison_report,comparison_rows=comparisons(comparison_dir,expected_release_sha)
    source=dict(source_url=URL,retrieved_at=receipt['retrieved_at'],http_status=200,retrieval_method='publisher_bulk_download',proxy=None)
    objects={expected_release_sha:dict(sha256=expected_release_sha,bytes=release.stat().st_size,kind='publisher_original',path=str(release.resolve()),sources=[source])}
    title_parts=defaultdict(list);offsets={};lengths=Counter();title_headings={};counts=Counter();statuses=Counter();pdfs={};currencies=defaultdict(set)
    version_groups=defaultdict(list);warnings=Counter();total=0
    for ordinal,line,r in records(release):
        total+=1;title=str(r['title']);text=r['text'];citation=r['citation'];s=r['text_source']
        compared=comparison_rows.get(ordinal)
        expected=dict(citation=citation,source_sha256=s['sha256'],page_start=s['page_start'],page_end=s['page_end'],
                      text_sha256=sha(text.encode()),source_status=r['status'],effective_qualifier=r.get('effective_qualifier'))
        if (compared is None or any(compared.get(k)!=v for k,v in expected.items())
            or not re.fullmatch('[a-f0-9]{64}',str(compared.get('extracted_pages_sha256','')))
            or (compared['comparison']=='publisher_status_without_body')!=(text=='')):
            raise ValueError('PDF comparison does not bind this exact source record/body/status/pages')
        heading=r['headings'].get('title')
        if title in title_headings and title_headings[title]!=heading:raise ValueError('Conflicting release title headings')
        title_headings[title]=heading;start=lengths[title];offsets[ordinal]=(start,start+len(text))
        title_parts[title].append(text);title_parts[title].append('\n');lengths[title]+=len(text)+1
        counts[citation]+=1;statuses[r['status']]+=1;currencies[title].add(r['current_through'])
        version_groups[citation].append(dict(record_ordinal=ordinal,status=r['status'],effective_qualifier=r.get('effective_qualifier'),printing=r.get('printing')))
        for warning in r.get('warnings',[]):warnings[str(warning)]+=1
        key=(s['sha256'],s['source_url'])
        if key not in pdfs:
            pdf_receipt=read(pdf_dir/'receipts'/(sha(s['source_url'].encode())+'.json'))
            path=pdf_dir/'raw'/(s['sha256']+'.pdf')
            if (pdf_receipt['source_url']!=s['source_url'] or pdf_receipt['sha256']!=s['sha256']
                or pdf_receipt['expected_sha256']!=s['sha256'] or pdf_receipt['http_status']!=200
                or not pdf_receipt['checksum_match'] or path.stat().st_size!=pdf_receipt['bytes']
                or file_sha(path)!=s['sha256']):raise ValueError('Retained PDF differs from the release source reference')
            host=urlsplit(s['source_url']).hostname
            if host not in ('www.legis.ga.gov','archive.org'):raise ValueError('Unreviewed source PDF host')
            classification='official_publisher' if host=='www.legis.ga.gov' else 'third_party_historical_archive'
            pdfs[key]=dict(sha256=s['sha256'],source_url=s['source_url'],provenance_class=classification,
                          raw_file=str(path.resolve()),retrieved_at=pdf_receipt['retrieved_at'])
            pdf_source=dict(source_url=s['source_url'],retrieved_at=pdf_receipt['retrieved_at'],http_status=200,retrieval_method='publisher_bulk_download',proxy=None)
            if s['sha256'] in objects:objects[s['sha256']]['sources'].append(pdf_source)
            else:objects[s['sha256']]=dict(sha256=s['sha256'],bytes=pdf_receipt['bytes'],kind='publisher_original',path=str(path.resolve()),sources=[pdf_source])
        if (type(s['page_start']) is not int or type(s['page_end']) is not int
            or not 1<=s['page_start']<=s['page_end']<=100000):raise ValueError('Invalid PDF page range')
    if total!=len(comparison_rows):raise ValueError('PDF comparison has unmatched source occurrences')
    output.mkdir(parents=True);(output/'titles').mkdir()
    (output/'pdf-comparison-report.json').write_bytes((comparison_dir/'report.json').read_bytes())
    (output/'pdf-comparison-rows.jsonl').write_bytes((comparison_dir/'row-comparisons.jsonl').read_bytes())
    units={}
    for title in sorted(title_parts,key=int):
        body=''.join(title_parts[title])
        if not body.strip():raise ValueError('A wholly empty title needs an explicit source-status unit representation')
        raw=body.encode();digest=sha(raw);path=output/'titles'/(title+'.txt');path.write_bytes(raw)
        objects[digest]=dict(sha256=digest,bytes=len(raw),kind='unit_text_derivative',path=str(path.resolve()),code_points=len(body),sources=[source])
        statement='Upstream edition claim: '+'; '.join(sorted(currencies[title]))+'. '+QUALIFICATION
        units[title]=dict(unit_key='title-'+title,unit_kind='third_party_release_title',heading=title_headings[title],
            original_sha256=expected_release_sha,publisher_member=None,raw_member_sha256=None,text_sha256=digest,
            text_code_points=len(body),sections_expected=0,currency=dict(basis='archive_date',statement=statement,through_date=None,edition=EDITION),
            status_note=QUALIFICATION,**metadata(),**{k:v for k,v in source.items() if k!='http_status'})
    empty=0;warned=0;archived=0
    with (output/'sections.jsonl').open('x',encoding='utf-8',newline='\n') as stream:
        for ordinal,line,r in records(release):
            title=str(r['title']);u=units[title];u['sections_expected']+=1;s=r['text_source'];pdf=pdfs[(s['sha256'],s['source_url'])]
            text=r['text'];start,end=offsets[ordinal];span=dict(unit='unicode_code_points',start=start,end=end)
            notes=[QUALIFICATION,'Upstream edition status: '+r['status']+'.']
            compared=comparison_rows[ordinal]
            notes.append(COMPARISON_NOTES[compared['comparison']])
            if not text:
                empty+=1;notes.append('No body text is present in this release record. The upstream status is not independently verified by its linked PDF; that pointer may identify an older bound printing.')
            if counts[r['citation']]>1:notes.append(f"This citation has {counts[r['citation']]} release occurrences; no operative version has been selected.")
            if r.get('effective_qualifier'):notes.append('Printed effective-date qualifier: '+r['effective_qualifier'])
            if r.get('printing') is not None:notes.append('Release printing label: '+str(r['printing'])+'.')
            if r.get('range_end'):notes.append('Release range endpoint: '+r['range_end']+'.')
            if r.get('warnings'):
                warned+=1
                notes.append('Upstream extraction warnings: '+'; '.join(str(w).replace('dehyphenation_unverified:','unverified word break: ') for w in r['warnings']))
            if pdf['provenance_class']=='third_party_historical_archive':
                archived+=1;notes.append('The linked source PDF is an Internet Archive copy, not a current official-host retrieval.')
            hierarchy=[dict(level='title',number=title,heading=title_headings[title])]
            for level in ('chapter','article','part','subpart'):
                value=r.get(level)
                if value is not None:hierarchy.append(dict(level=level,number=str(value),heading=r['headings'].get(level)))
            hierarchy.append(dict(level='section',number=r['citation'],heading=r['catchline'] or None))
            row=dict(identity_kind='third_party_source_occurrence',citation_path=f'src-{expected_release_sha}-record-{ordinal}',
                citation=r['citation'],heading=r['catchline'] or None,text=text,hierarchy=hierarchy,history=r['history'] or None,
                status_note=' '.join(notes),unit_key=u['unit_key'],span=span,currency=u['currency'],**metadata(),
                source_occurrence=dict(kind='jsonl_record',release_sha256=expected_release_sha,record_ordinal=ordinal,
                    record_sha256=sha(line),unit_span=span,text_field_empty=(text==''),source_status=r['status']),
                source_pdf=dict(sha256=s['sha256'],source_url=s['source_url'],page_start=s['page_start'],page_end=s['page_end'],provenance_class=pdf['provenance_class'],
                    comparison=compared['comparison'],comparison_ledger_sha256=comparison_report['row_ledger_sha256'],
                    extracted_pages_sha256=compared['extracted_pages_sha256'],normalization=comparison_report['normalization']))
            write_row(stream,row)
    manifest=dict(schema_version='publisher-code-manifest/2',jurisdiction='GA',publisher='Georgia Commons (third-party edition archive)',
        publisher_url='https://georgiacommons.org/code',source_system='ga-georgiacommons-2025',code_title='Georgia Code — 2025 third-party source edition',
        parser=dict(name='ga-georgiacommons-occurrences',version='2'),provenance_class=CLASS,
        current_law_verified=False,calculation_activation_allowed=False,
        pdf_comparison=dict(row_ledger_sha256=comparison_report['row_ledger_sha256'],report_sha256=file_sha(comparison_dir/'report.json'),
            comparisons=comparison_report['comparisons'],qualification=comparison_report['qualification']),
        archive=dict(edition=EDITION,edition_date=None,qualification=QUALIFICATION,provider='Georgia Commons',origin_url=URL),
        retrieval=dict(methods=['publisher_bulk_download'],source_url_patterns=[
            r'^https://github\.com/shanejorr/georgiacommons-ocga-data/releases/download/ocga-2025-supplement-v3/ocga-code\.jsonl\.gz$',
            r'^https://www\.legis\.ga\.gov/api/document/docs/default-source/joint-features-document-library/',
            r'^https://archive\.org/download/gov\.ga\.ocga\.2024/'],terms_gate=False,official_source=False,rate_limit_ms=1000),
        structure=dict(levels=['title','chapter','article','part','subpart','section'],unit='Exact release text fields concatenated by title; not a fetched statutory page'),
        section_id=dict(scheme='third_party_source_occurrence',regex=r'^src-[a-f0-9]{64}-record-[1-9][0-9]{0,8}$',
            example=f'src-{expected_release_sha}-record-1',citation_format='Literal upstream citation; release SHA and record ordinal identify the source occurrence'),
        currency=dict(basis='archive_date',location='Pinned release current_through fields, reported as upstream edition claims'),
        review=dict(reviewed_by='Exact release/original hashes and source-record spans; per-record PDF comparisons retained with unresolved cases visible; publication review pending',reviewed_at=receipt['retrieved_at'][:10]))
    save(output/'manifest.json',manifest)
    for name,rows in [('units.jsonl',units.values()),('objects.jsonl',sorted(objects.values(),key=lambda o:o['sha256']))]:
        with (output/name).open('x',encoding='utf-8',newline='\n') as stream:
            for row in rows:write_row(stream,row)
    save(output/'toc-proof.json',dict(marker='Every pinned third-party JSONL record line accounted for; not an official code TOC completeness claim',
        pages=[dict(url=URL,markers=total,sections=total)],unfetched_child_pages=[]))
    save(output/'source-versions.json',dict(duplicate_groups={k:v for k,v in version_groups.items() if len(v)>1},
        warnings=dict(warnings),source_pdfs=list(pdfs.values())))
    save(output/'release-holds.json',dict(publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False,
        qualifications=[QUALIFICATION,'JSONL text and source statuses are third-party extraction claims.',
         'Empty-body statuses may point at an older bound printing; no status verification is asserted.',
         '97 PDFs are sources of the Code records; the broader release also contains separately excluded constitutions.',
         'No independent official TOC completeness or present legal-effect certification.']))
    report=dict(schema_version='ga-third-party-occurrence-staging/1',release_sha256=expected_release_sha,records=total,
        distinct_citations=len(counts),titles=len(units),source_pdfs=len(pdfs),objects=len(objects),object_bytes=sum(o['bytes'] for o in objects.values()),
        duplicate_citation_groups=sum(n>1 for n in counts.values()),status_only_records=empty,records_with_extraction_warnings=warned,
        archive_pdf_records=archived,status_counts=dict(statuses),sections_sha256=file_sha(output/'sections.jsonl'),
        pdf_comparisons=comparison_report['comparisons'],pdf_comparison_ledger_sha256=comparison_report['row_ledger_sha256'],
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)
    save(output/'staging-report.json',report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('data-dir','pdf-dir','comparison-dir','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();print(json.dumps(stage(a.data_dir,a.pdf_dir,a.output,comparison_dir=a.comparison_dir),ensure_ascii=True,indent=2))
