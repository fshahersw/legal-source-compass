"""Bounded official-source samples for HRS parser review; no database actions."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import ssl
import time
from urllib.request import Request,build_opener,HTTPSHandler

from capture_assets import NoRedirect
from parse_hrs import parse_section_html,parse_chapter_index
from stage_hrs import ROOT,digest,discovery,exact_capture,json_file


def selected_urls(inventory,count=20):
    if not 20<=count<=100:raise ValueError('Review sample must contain 20 to 100 pages')
    pages=[url for url in inventory['pages']if not url.lower().endswith('-.htm')]
    chosen=[]
    for volume in sorted(inventory['volumes']):
        candidates=[url for url in pages if url.startswith(volume)]
        if candidates:chosen.append(min(candidates,key=lambda u:digest(u.encode())))
    for url in sorted(pages,key=lambda u:digest(u.encode())):
        if len(chosen)>=count:break
        if url not in chosen:chosen.append(url)
    if len(chosen)!=count:raise ValueError('Insufficient distinct official pages for requested sample')
    return sorted(chosen)


def capture_sample(capture,output,count=20):
    capture=Path(capture);output=Path(output)
    inventory,_,missing=discovery(capture)
    if missing:raise ValueError('Complete directory discovery is required')
    selected=selected_urls(inventory,count);indexes=[]
    for url in selected:
        chapter=url.rsplit('/',1)[0]+'/'
        matches=[page for page in inventory['pages']if page.startswith(chapter)and page.lower().endswith('-.htm')]
        if len(matches)!=1:raise ValueError('Unique source chapter index required')
        indexes.extend(matches)
    if output.exists():raise FileExistsError('Fresh sample output directory required')
    (output/'raw').mkdir(parents=True);(output/'receipts').mkdir()
    opener=build_opener(HTTPSHandler(context=ssl.create_default_context()),NoRedirect());results=[]
    for url in sorted(set(selected+indexes)):
        with opener.open(Request(url,headers={'User-Agent':'LegalSourceAtlas-SourceReview/1.0','Accept':'text/html'}),timeout=60)as response:
            body=response.read(10_000_001);ctype=response.headers.get('Content-Type','')
            if response.status!=200 or response.url!=url or not body or len(body)>10_000_000 or 'text/html'not in ctype.lower():
                raise ValueError('Unexpected exact publisher sample response')
        sha=digest(body);receipt=dict(schema_version='publisher-http-capture/1',source_url=url,final_url=url,http_status=200,
            bytes=len(body),sha256=sha,raw_file='raw/'+sha,retrieved_at=datetime.now(timezone.utc).isoformat(),
            content_type=ctype,retrieval_method='publisher_page',proxy=None)
        raw=output/'raw'/sha
        if not raw.exists():raw.write_bytes(body)
        json_file(output/'receipts'/(digest(url.encode())+'.json'),receipt);exact_capture(output,url)
        try:
            parsed=parse_chapter_index(body,url.rsplit('/',1)[1])if url in indexes else parse_section_html(body,url.rsplit('/',1)[1])
            issues=parsed.get('unclassified',[])
            if not parsed['source_character_sequence_preserved']:issues=issues+['Source character sequence differs']
            if url in indexes and (not parsed['chapter']or not parsed['heading']):issues=issues+['Chapter heading unresolved']
            results.append(dict(source_url=url,source_sha256=sha,citation=parsed.get('citation'),heading=parsed['heading'],issues=issues))
        except Exception as error:results.append(dict(source_url=url,source_sha256=sha,issues=[str(error)]))
        time.sleep(.25)
    report=dict(schema='hi-fresh-source-sample/1',selection='At least one hash-ordered source page per volume, then SHA-256 URL order to requested count; associated exact chapter indexes',
        selected_section_urls=selected,section_count=len(selected),captured_pages=len(results),results=results,
        directory_inventory_sha256=digest((capture/'directory-inventory.json').read_bytes()),
        holds=sum(bool(row['issues'])for row in results),publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)
    json_file(output/'review.json',report);return report


def compare_sample(capture,packet,sample):
    capture=Path(capture);packet=Path(packet);sample=Path(sample)
    inventory,_,missing=discovery(capture)
    if missing:raise ValueError('Complete directory discovery is required')
    review=json.loads((sample/'review.json').read_text('utf8'))
    if (review['holds']or review['selected_section_urls']!=selected_urls(inventory,review['section_count'])
            or review['directory_inventory_sha256']!=digest((capture/'directory-inventory.json').read_bytes())):
        raise ValueError('Fresh sample selection/source inventory differs')
    rows=[json.loads(line)for line in (packet/'sections.jsonl').read_text('utf8').splitlines()if line.strip()]
    sections={row['citation_path']:row for row in rows};results=[]
    for url in review['selected_section_urls']:
        captured=exact_capture(sample,url);retained=exact_capture(capture,url)
        if captured is None or retained is None:raise ValueError('Two-way sample source bytes are missing')
        receipt,body=captured;parsed=parse_section_html(body,url.rsplit('/',1)[1]);row=sections[url.rsplit('/',1)[1][:-4]]
        keys=['citation','heading','text','span','history']
        issues=[key+' differs from freshly retrieved source'for key in keys if parsed[key]!=row[key]]
        if parsed['unclassified']or not parsed['source_character_sequence_preserved']:issues+=['Fresh source interpretation held']
        if body!=retained[1]:issues+=['Fresh and retained original bytes differ; source-version review required']
        results.append(dict(source_url=url,fresh_sha256=receipt['sha256'],retained_sha256=retained[0]['sha256'],
            raw_bytes_match=body==retained[1],issues=issues))
    return dict(schema='hi-candidate-fresh-source-comparison/1',sections=len(results),
        passed=not any(row['issues']for row in results),results=results,
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--capture',type=Path,required=True)
    cli.add_argument('--out',type=Path,required=True);cli.add_argument('--count',type=int,default=20)
    cli.add_argument('--packet',type=Path);cli.add_argument('--sample',type=Path);args=cli.parse_args()
    if bool(args.packet)!=bool(args.sample):cli.error('--packet and --sample must be supplied together')
    if args.packet:
        report=compare_sample(args.capture,args.packet,args.sample);json_file(args.out,report)
    else:report=capture_sample(args.capture,args.out,args.count)
    print(json.dumps({k:v for k,v in report.items()if k not in ['results','selected_section_urls']}))
