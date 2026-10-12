"""Retain only image URLs actually printed in hash-verified HRS source HTML.

Uses the private audit's references as candidates, then rechecks the original
HTML before any network access. TLS verification and redirects stay restrictive.
No credentials, database access, or publication operations.
"""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import ssl
import time
from urllib.parse import urljoin,urlsplit
from urllib.request import Request,build_opener,HTTPSHandler,HTTPRedirectHandler

from parse_hrs import parse_section_html
from stage_hrs import ROOT,digest,exact_capture,json_file


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def verified_references(capture,reference_file):
    capture=Path(capture);inventory=json.loads((capture/'directory-inventory.json').read_text('utf8'))
    if inventory.get('root')!=ROOT:raise ValueError('Unexpected publisher root')
    pages=set(inventory['pages']);sources={};assets={}
    for line in Path(reference_file).read_text('utf8').splitlines():
        if not line.strip():continue
        row=json.loads(line);source=row['source_url'];url=row['asset_url']
        parts=urlsplit(url)
        if (parts.scheme!='https'or parts.netloc!='data.capitol.hawaii.gov'or not url.startswith(ROOT)
                or parts.query or parts.fragment or re.search(r'\s',url)
                or not re.search(r'\.(gif|jpe?g|png|webp)$',parts.path,re.I)):
            raise ValueError('Image reference is outside exact permitted publisher scope')
        if source not in pages:raise ValueError('Image source is not a discovered HRS page')
        if source not in sources:
            captured=exact_capture(capture,source)
            if captured is None:raise ValueError('Image source bytes are missing')
            receipt,body=captured
            sources[source]=(receipt,parse_section_html(body,source.rsplit('/',1)[1])['attachments'])
        receipt,attachments=sources[source]
        if receipt['sha256']!=row['source_sha256']or not any(
                a['src']==row.get('src')and urljoin(source,a['src'])==url
                and a['alt']==row.get('alt')and a['title']==row.get('title')for a in attachments if a['src']):
            raise ValueError('Image candidate differs from exact retained source HTML')
        evidence=dict(source_url=source,source_sha256=receipt['sha256'],src=row['src'],alt=row.get('alt'),title=row.get('title'))
        if evidence not in assets.setdefault(url,[]):assets[url].append(evidence)
    return assets


def capture_assets(capture,references,output):
    assets=verified_references(capture,references);output=Path(output)
    (output/'raw').mkdir(parents=True,exist_ok=True);(output/'receipts').mkdir(exist_ok=True)
    opener=build_opener(HTTPSHandler(context=ssl.create_default_context()),NoRedirect())
    results=[]
    for url,evidence in sorted(assets.items()):
        retained=exact_capture(output,url)
        if retained is not None:receipt,body=retained
        else:
            with opener.open(Request(url,headers={'User-Agent':'LegalSourceAtlas-SourceCapture/1.0','Accept':'image/*'}),timeout=60)as response:
                body=response.read(10_000_001);ctype=response.headers.get('Content-Type','')
                if response.status!=200 or response.url!=url or not body or len(body)>10_000_000 or not ctype.lower().startswith('image/'):
                    raise ValueError('Unexpected publisher image response')
                sha=digest(body);receipt=dict(schema_version='publisher-http-capture/1',source_url=url,final_url=url,
                    retrieved_at=datetime.now(timezone.utc).isoformat(),http_status=200,bytes=len(body),sha256=sha,
                    content_type=ctype,retrieval_method='publisher_page',proxy=None,raw_file='raw/'+sha)
            raw=output/'raw'/sha
            if not raw.exists():raw.write_bytes(body)
            json_file(output/'receipts'/(digest(url.encode())+'.json'),receipt)
            # Read the saved bytes through the same hash/identity gate before continuing.
            exact_capture(output,url);time.sleep(.25)
        results.append(dict(asset_url=url,sha256=receipt['sha256'],bytes=receipt['bytes'],references=evidence))
    report=dict(schema='hi-source-image-capture/1',assets=results,publication_allowed=False)
    path=output/'asset-inventory.json'
    if path.exists():
        prior=json.loads(path.read_text('utf8'))
        if prior!=report:raise ValueError('Use a fresh asset output directory for an expanded inventory')
    else:json_file(path,report)
    return report


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--capture',type=Path,required=True)
    cli.add_argument('--references',type=Path,required=True);cli.add_argument('--out',type=Path,required=True)
    args=cli.parse_args();report=capture_assets(args.capture,args.references,args.out)
    print(json.dumps(dict(captured_assets=len(report['assets']),bytes=sum(r['bytes']for r in report['assets']),publication_allowed=False)))
