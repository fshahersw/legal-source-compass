"""Bounded Kansas source review, without credentials, intake or publication changes.

Fresh captures are restricted to sampled native identities and explicitly named
diagnostic URLs present in the hash-verified official TOC. Checking uses lxml,
already required by the existing Kansas source parser.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import ssl
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler

import build_packet as parser
import revalidate as review


def sample_urls(sample, toc):
    rows=sample.get('samples')or[]
    if len(rows)<20 or len(rows)>100:raise ValueError('Source review requires 20 to 100 sampled rows')
    if len({r.get('native_id')for r in rows})!=len(rows):raise ValueError('Duplicate sampled identity')
    allowed=set(toc['section_urls']);urls=set()
    for row in rows:
        data=row.get('data')or{};prov=row.get('provenance')or{}
        if (row.get('source_system')!=review.SOURCE or row.get('native_id')!='KS:'+data.get('citation_path','')
                or prov.get('source_url')not in allowed or not review.SHA.fullmatch(prov.get('source_sha256',''))):
            raise ValueError('Sample source identity differs from official TOC')
        urls.add(prov['source_url'])
    return urls


def capture(sample, toc, destination, extras=()):
    urls=sample_urls(sample,toc)
    if len(extras)>20 or not set(extras)<=set(toc['section_urls']):raise ValueError('Diagnostic URL absent from official TOC')
    urls.update(extras);destination=Path(destination)
    if destination.exists():raise FileExistsError('Retain prior captures; choose a new destination')
    (destination/'raw').mkdir(parents=True)
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):return None
    session=build_opener(NoRedirect(),HTTPSHandler(context=ssl.create_default_context()))
    for url in sorted(urls):
        request=Request(url,headers={'User-Agent':'LegalSourceAtlas-Kansas-review/1 (+https://firastest1.com)'})
        try:response=session.open(request,timeout=40)
        except HTTPError as error:response=error
        body=response.read(5_000_001)
        if len(body)>5_000_000:raise ValueError('Section page exceeds bounded capture size')
        sha=review.digest(body);(destination/'raw'/sha).write_bytes(body)
        receipt=dict(source_url=url,final_url=response.url,http_status=response.status,sha256=sha,bytes=len(body),
            retrieved_at=datetime.now(timezone.utc).isoformat(),raw_file='raw/'+sha,retrieval_method='publisher_page',
            toc_receipts_sha256=toc['receipts_sha256'],
            headers={k:response.headers[k]for k in ['Content-Type','ETag','Last-Modified']if k in response.headers})
        with (destination/'receipts.jsonl').open('a',encoding='utf8',newline='\n')as stream:stream.write(json.dumps(receipt)+'\n')
        response.close()
        if receipt['http_status']!=200 or receipt['final_url']!=url or b'<html'not in body.lower():
            raise ValueError('Official section did not return HTTP 200 HTML at exact URL')
        time.sleep(1)
    return dict(captured_pages=len(urls),publication_allowed=False)


def exact_body_check(body, row, unit, toc_heading):
    from lxml import html
    page=body.decode('utf8',errors='strict');lead,sections=parser.parse_page_full(page)
    boxes=html.fromstring(page).xpath('//div[@id="print"]')
    stem=row['data']['citation_path'].split(':')[0]
    suffix=row['data']['citation_path'].split(':')[1:]
    occurrence=int(suffix[0])-1 if suffix else 0
    text_blocks=['\n'.join(lead)]if lead else []
    spans=[];position=len(text_blocks[0])+2 if text_blocks else 0
    for section in sections:
        text='\n'.join(section['lines']);spans.append((position,position+len(text)))
        text_blocks.append(text);position+=len(text)+2
    unit_text='\n\n'.join(text_blocks)
    no_space=lambda text:re.sub(r'\s','',text)
    checks=dict(single_print_box=len(boxes)==1,
        print_box_entire_character_sequence=len(boxes)==1 and no_space(boxes[0].text_content())==no_space(unit_text),
        marker_count=parser.box_markers(page)==len(sections)==unit['data']['sections_expected'],
        unit_text_hash=review.digest(unit_text.encode())==unit['data']['text_sha256'],
        source_page_identity=row['provenance']['source_url'].rsplit('/',1)[-1]==stem+'.html')
    if occurrence>=len(sections):return dict(passed=False,checks=checks,missing_occurrence=occurrence+1)
    parsed=sections[occurrence];stored=row['data'];text='\n'.join(parsed['lines']);start,end=spans[occurrence]
    checks.update(section_text_exact=text==stored['text'],section_text_hash=review.digest(text.encode())==stored['text_sha256'],
        citation_exact=parsed['citation']==stored['citation'],history_exact=parsed['history']==stored.get('history'),
        heading_exact=(parsed['caption']or toc_heading or None)==stored.get('heading'),
        span_exact=stored['span']==dict(unit='unicode_code_points',start=start,end=end),
        unit_span_text=unit_text[start:end]==stored['text'])
    return dict(passed=all(checks.values()),checks=checks,markers=len(sections),text_code_points=len(text))


def check(sample, toc_directory, fresh_directory, retained_directory, objects):
    toc=review.validate_toc(toc_directory);urls=sample_urls(sample,toc)
    fresh_directory=Path(fresh_directory);retained_directory=Path(retained_directory)
    receipts=[json.loads(line)for line in(fresh_directory/'receipts.jsonl').read_text('utf8').splitlines()]
    fresh={};metadata={r['sha256']:r for r in objects['objects']}
    for receipt in receipts:
        sha=receipt.get('sha256','');url=receipt.get('source_url')
        if (not review.SHA.fullmatch(sha)or receipt.get('raw_file')!='raw/'+sha or url in fresh
                or receipt.get('http_status')!=200 or receipt.get('final_url')!=url
                or receipt.get('toc_receipts_sha256')!=toc['receipts_sha256']):raise ValueError('Fresh receipt is not exact verified source evidence')
        body=(fresh_directory/'raw'/sha).read_bytes()
        if review.digest(body)!=sha or len(body)!=receipt['bytes']:raise ValueError('Fresh source bytes differ from receipt')
        fresh[url]=(receipt,body)
    if not urls<=set(fresh):raise ValueError('Fresh capture missing sampled URL')
    headings={}
    toc_receipts=[json.loads(line)for line in(Path(toc_directory)/'receipts.jsonl').read_text('utf8').splitlines()]
    for receipt in toc_receipts:
        if receipt['source_url']==review.ROOT:continue
        _,entries=parser.parse_toc((Path(toc_directory)/'raw'/receipt['sha256']).read_text('utf8'))
        headings.update({url:parts[-1]for url,parts in entries.items()})
    units={row['native_id']:row for row in sample['units']};results=[]
    for row in sample['samples']:
        sha=row['provenance']['source_sha256'];url=row['provenance']['source_url'];meta=metadata.get(sha)
        if not meta or meta['kind']!='publisher_original' or not any(s['source_url']==url and s['http_status']==200 for s in meta['sources']):
            raise ValueError('Retained original lacks source metadata')
        retained=(retained_directory/sha).read_bytes()
        if review.digest(retained)!=sha or len(retained)!=meta['bytes']:raise ValueError('Retained source byte/hash mismatch')
        unit=units[row['data']['unit_id']]
        old=exact_body_check(retained,row,unit,headings.get(url));new=exact_body_check(fresh[url][1],row,unit,headings.get(url))
        results.append(dict(native_id=row['native_id'],source_url=url,retained_sha256=sha,fresh_sha256=fresh[url][0]['sha256'],
            retained=old,fresh=new,passed=old['passed']and new['passed']))
    return dict(schema='ks-source-review/1',sampled=len(results),passed=sum(r['passed']for r in results),results=results,
        publication_allowed=False,calculation_activation_allowed=False,
        qualification='This is a bounded source-text review; complete TOC, unsampled source reconciliation, currency, and publication review remain separate requirements.')


def main():
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('command',choices=['capture','check'])
    cli.add_argument('--sample',type=Path,required=True);cli.add_argument('--toc',type=Path,required=True)
    cli.add_argument('--out',type=Path,required=True);cli.add_argument('--extra-url',action='append',default=[])
    cli.add_argument('--fresh',type=Path);cli.add_argument('--retained',type=Path);cli.add_argument('--objects',type=Path)
    args=cli.parse_args();sample=review.read_export(args.sample)
    if args.command=='capture':result=capture(sample,review.validate_toc(args.toc),args.out,args.extra_url)
    else:
        if not all([args.fresh,args.retained,args.objects]):cli.error('check requires --fresh, --retained and --objects')
        result=check(sample,args.toc,args.fresh,args.retained,review.read_export(args.objects));review.save_new(args.out,result)
    print(json.dumps({k:v for k,v in result.items()if k!='results'}))
    return 0 if 'passed'not in result or result['passed']==result['sampled']else 1


if __name__=='__main__':raise SystemExit(main())
