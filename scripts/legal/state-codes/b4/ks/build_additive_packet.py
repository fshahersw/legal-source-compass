"""Prepare one missing native publisher page, preserving the prior Kansas run.

This is a private additive candidate, not an ingestion or publication command.
The existing inventory must match the full fresh TOC except for exactly this URL.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

import build_packet as parser
import revalidate as review


def build(preflight, summary, toc_directory, fresh_directory, url, out):
    toc=review.validate_toc(toc_directory);audit=review.audit_summary(preflight,summary,toc)
    if audit['issues']!=['publisher_chapter_inventory_differs'] or len(audit['chapter_mismatches'])!=1:
        raise ValueError('Expected exactly one isolated publisher-page coverage discrepancy')
    mismatch=audit['chapter_mismatches'][0];chapter=mismatch['chapter']
    expected=[u for u in toc['section_urls']if '/'+chapter+'/'in u]
    if (url not in expected or review.framed_hash([u for u in expected if u!=url])!=mismatch['stored']['urls_sha256']
            or len(expected)-1!=mismatch['stored']['pages']):raise ValueError('Missing page is not proved by exact inventory hash')
    receipts=[json.loads(line)for line in(Path(fresh_directory)/'receipts.jsonl').read_text('utf8').splitlines()]
    hits=[r for r in receipts if r.get('source_url')==url]
    if len(hits)!=1:raise ValueError('Exactly one fresh source receipt is required')
    receipt=hits[0];sha=receipt.get('sha256','')
    if (not review.SHA.fullmatch(sha)or receipt.get('raw_file')!='raw/'+sha or receipt.get('http_status')!=200
            or receipt.get('final_url')!=url or receipt.get('toc_receipts_sha256')!=toc['receipts_sha256']):
        raise ValueError('Fresh source receipt identity differs')
    body=(Path(fresh_directory)/'raw'/sha).read_bytes()
    if review.digest(body)!=sha or len(body)!=receipt['bytes']:raise ValueError('Source byte hash or length differs')
    page=body.decode('utf8');lead,parsed=parser.parse_page_full(page)
    if lead or len(parsed)!=1 or parser.box_markers(page)!=1:raise ValueError('Additive builder requires one exact whole-page section')
    coverage=parser.coverage_gap(page,lead,parsed)
    if len(set(coverage.values()))!=1:raise ValueError('Not all printed statute characters were parsed')
    from lxml import html
    box=html.fromstring(page).xpath('//div[@id="print"]')
    import re
    text='\n'.join(parsed[0]['lines'])
    if len(box)!=1 or re.sub(r'\s','',box[0].text_content())!=re.sub(r'\s','',text):
        raise ValueError('Source print-box character sequence differs')
    entries={}
    for line in(Path(toc_directory)/'receipts.jsonl').read_text('utf8').splitlines():
        r=json.loads(line)
        if r['source_url']==review.ROOT:continue
        ch,chapter_entries=parser.parse_toc((Path(toc_directory)/r['raw_file']).read_text('utf8'))
        entries.update({u:(ch,e)for u,e in chapter_entries.items()})
    (chapter_number,chapter_heading),(article_number,article_heading,label,title)=entries[url]
    native=urlsplit(url).path.rsplit('/',1)[-1].removesuffix('.html')
    manifest=json.loads((Path(__file__).parent/'manifest.json').read_text('utf8'))
    if manifest['parser']['version']!='7' or not re.fullmatch(manifest['section_id']['regex'],native):
        raise ValueError('Versioned parser manifest does not accept native identity')
    if Path(out).exists():raise FileExistsError('Retain prior candidate; choose a new destination')
    out=Path(out);(out/'raw').mkdir(parents=True);(out/'text').mkdir()
    raw=out/'raw'/sha;raw.write_bytes(body);text_sha=review.digest(text.encode());derivative=out/'text'/(text_sha+'.txt')
    derivative.write_bytes(text.encode())
    currency=dict(basis='publisher_statement',statement=parser.STATEMENT,through_date=None,edition=parser.EDITION)
    source=dict(source_url=url,retrieved_at=receipt['retrieved_at'],http_status=200,retrieval_method='publisher_page',proxy=None)
    objects=[dict(sha256=sha,bytes=len(body),kind='publisher_original',path=str(raw.resolve()),sources=[source]),
             dict(sha256=text_sha,bytes=len(text.encode()),kind='unit_text_derivative',path=str(derivative.resolve()),
                  code_points=len(text),sources=[source])]
    unit=dict(unit_key=native,unit_kind='section_page',heading=title or None,original_sha256=sha,publisher_member=None,
        raw_member_sha256=None,text_sha256=text_sha,text_code_points=len(text),sections_expected=1,currency=currency,
        **{k:source[k]for k in ['source_url','retrieved_at','retrieval_method','proxy']})
    section=parsed[0];heading=section['caption']or title or None
    row=dict(unit_key=native,citation_path=native,citation=section['citation'],heading=heading,text=text,
        hierarchy=[dict(level='chapter',number=chapter_number,heading=chapter_heading),
                   dict(level='article',number=article_number,heading=article_heading),
                   dict(level='section',number=section['citation'],heading=heading)],
        history=section['history'],status_note=title if parser.STATUS.match(title or '')else None,
        span=dict(unit='unicode_code_points',start=0,end=len(text)),currency=currency)
    review.save_new(out/'manifest.json',manifest)
    for name,rows in [('objects',objects),('units',[unit]),('sections',[row])]:
        with (out/(name+'.jsonl')).open('x',encoding='utf8',newline='\n')as stream:
            for value in rows:stream.write(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
    review.save_new(out/'toc-proof.json',dict(marker='Exact nonempty stat_number in the official print box',
        pages=[dict(url=url,markers=1,sections=1,coverage=coverage)],unfetched_child_pages=[],
        scope='One additive native page; complete-state proof remains the separately pinned summary and TOC',
        full_toc_receipts_sha256=toc['receipts_sha256']))
    # Editorial notes are retained explicitly as source evidence, never appended to statute text.
    notes=[x.text_content().strip()for x in box[0].itersiblings()if (x.get('class')or'').startswith('ksa_8pt')]
    report=dict(schema='ks-additive-candidate/1',native_id='KS:'+native,prior_run=summary['run_id'],
        prior_manifest_sha256=summary['manifest_sha256'],source_sha256=sha,source_url=url,
        prior_sections=summary['totals']['sections'],expected_total_sections=summary['totals']['sections']+1,
        full_toc_receipts_sha256=toc['receipts_sha256'],editorial_notes=notes,editorial_notes_in_statute_text=False,
        prior_records_to_rewrite=0,units=1,sections=1,publication_allowed=False,calculation_activation_allowed=False)
    review.save_new(out/'report.json',report)
    return report


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    for name in ['preflight','summary','toc','fresh','out']:cli.add_argument('--'+name,type=Path,required=True)
    cli.add_argument('--url',required=True);args=cli.parse_args()
    print(json.dumps(build(review.read_export(args.preflight),review.read_export(args.summary),args.toc,args.fresh,args.url,args.out)))
