"""Hash-verify a complete official HRS capture and prepare a private v3 packet.

No network, credentials, database writes, or publication. An incomplete capture
produces an audit report only. Every listed page must have exact retained bytes;
section identities are publisher filenames, never inferred legal versions.
"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urljoin,urlsplit

from lxml import html
from parse_hrs import parse_section_html,parse_chapter_index

ROOT='https://data.capitol.hawaii.gov/hrscurrent/'
SHA=re.compile(r'^[0-9a-f]{64}$')


def digest(body):return hashlib.sha256(body).hexdigest()


def json_file(path,value):
    with Path(path).open('x',encoding='utf8',newline='\n')as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2);stream.write('\n')


def exact_capture(directory,url):
    if not url.startswith(ROOT)or urlsplit(url).netloc!='data.capitol.hawaii.gov':raise ValueError('Out-of-scope source URL')
    receipt_path=directory/'receipts'/(digest(url.encode())+'.json')
    if not receipt_path.exists():return None
    receipt=json.loads(receipt_path.read_text('utf8'));sha=receipt.get('sha256','')
    if (not SHA.fullmatch(sha)or receipt.get('raw_file')!='raw/'+sha or receipt.get('source_url')!=url
            or receipt.get('final_url')!=url or receipt.get('http_status')!=200 or receipt.get('proxy')is not None
            or receipt.get('retrieval_method')!='publisher_page'):raise ValueError('Capture source identity differs: '+url)
    if datetime.fromisoformat(receipt['retrieved_at'].replace('Z','+00:00')).tzinfo is None:raise ValueError('Timestamp requires time zone')
    body=(directory/'raw'/sha).read_bytes()
    if digest(body)!=sha or len(body)!=receipt['bytes']:raise ValueError('Retained byte hash/length mismatch: '+url)
    return receipt,body


def observed_links(body,url):
    document=html.fromstring(body.decode('utf-8-sig'))
    return sorted({urljoin(url,a.get('href'))for a in document.xpath('//a[@href]')
                   if urljoin(url,a.get('href')).startswith(ROOT)})


def discovery(directory):
    inventory=json.loads((directory/'directory-inventory.json').read_text('utf8'))
    if inventory.get('schema_version')!='hi-publisher-directory/1' or inventory.get('root')!=ROOT or inventory.get('errors'):
        raise ValueError('Official directory discovery is incomplete')
    captures={};missing=[]
    def required(url):
        value=exact_capture(directory,url)
        if value is None:missing.append(url);return None
        captures[url]=value
        return value[1]
    root=required(ROOT)
    if root is None:raise ValueError('Official root capture missing')
    volumes=[u for u in observed_links(root,ROOT)if re.fullmatch(r'Vol\d+_[^/]+/',u[len(ROOT):])]
    if set(volumes)!=set(inventory['volumes'])or len(volumes)!=14:raise ValueError('Publisher volume anchors differ')
    chapters=[]
    for url in volumes:
        body=required(url)
        if body is not None:chapters.extend(u for u in observed_links(body,url)if u.startswith(url)and re.search(r'/HRS\d+[A-Z]*/$',u))
    stored={row['source_url']:row for row in inventory['chapters']}
    if len(stored)!=len(inventory['chapters'])or set(chapters)!=set(stored):raise ValueError('Publisher chapter anchors differ')
    pages=set()
    for url in sorted(set(chapters)):
        body=required(url)
        if body is None:continue
        children=[u for u in observed_links(body,url)if u.startswith(url)and re.search(r'/HRS_[^/]+\.htm$',u,re.I)]
        if not children or set(children)!=set(stored[url]['pages'])or captures[url][0]['sha256']!=stored[url]['sha256']:
            raise ValueError('Publisher section anchors differ: '+url)
        pages.update(children)
    if pages!=set(inventory['pages'])or len(pages)!=len(inventory['pages']):raise ValueError('Full publisher page inventory differs')
    return inventory,captures,missing


def stage(directory,output,emit_packet=False,assets_directory=None):
    directory=Path(directory);output=Path(output)
    if output.exists():raise FileExistsError('Fresh audit/candidate output required')
    output.mkdir(parents=True)
    inventory,captures,missing=discovery(directory)
    section_rows=[];indices={};holds=[];annotations=[];attachments=[];contexts=[];asset_captures={};style_exceptions=[]
    for url in inventory['pages']:
        captured=exact_capture(directory,url)
        if captured is None:missing.append(url);continue
        receipt,body=captured;captures[url]=captured;name=url.rsplit('/',1)[-1]
        try:
            parsed=parse_section_html(body,name)
            if parsed['kind']=='chapter_index':
                index=parse_chapter_index(body,name)
                if not index['chapter']or not index['heading']or not index['source_character_sequence_preserved']:
                    holds.append(dict(url=url,issues=['Publisher chapter heading or content unresolved']))
                indices[url.rsplit('/',1)[0]+'/']=index
            else:
                if parsed['unclassified']or not parsed['text'].strip():holds.append(dict(url=url,issues=parsed['unclassified']or['Empty statute text']))
                section_rows.append((url,receipt,parsed))
                if parsed['leading_context']:contexts.append(dict(url=url,text=parsed['leading_context']))
            if parsed['annotations']:annotations.append(dict(source_url=url,source_sha256=receipt['sha256'],annotations=parsed['annotations']))
            if parsed['source_style_exceptions']:style_exceptions.append(dict(source_url=url,source_sha256=receipt['sha256'],exceptions=parsed['source_style_exceptions']))
            for attachment in parsed['attachments']:
                attachments.append(dict(source_url=url,source_sha256=receipt['sha256'],**attachment,
                    asset_url=urljoin(url,attachment['src'])if attachment['src']else None))
        except Exception as error:holds.append(dict(url=url,error=str(error)))
    for url,_,_ in section_rows:
        if url.rsplit('/',1)[0]+'/'not in indices:holds.append(dict(url=url,issues=['Missing retained chapter index']))
    ids=[p['citation_path']for _,_,p in section_rows]
    if len(set(ids))!=len(ids):holds.append(dict(issues=['Duplicate exact native filename across source directories']))
    for asset_url in sorted({row['asset_url']for row in attachments if row['asset_url']}):
        try:
            captured=exact_capture(Path(assets_directory),asset_url)if assets_directory else None
            if captured is None:holds.append(dict(url=asset_url,issues=['Linked publisher image bytes not retained']))
            elif not captured[0].get('content_type','').lower().startswith('image/'):
                holds.append(dict(url=asset_url,issues=['Linked image receipt has unexpected media type']))
            else:asset_captures[asset_url]=captured
        except Exception as error:holds.append(dict(url=asset_url,error=str(error)))
    report=dict(schema='hi-source-capture-audit/3',volumes=len(inventory['volumes']),chapters=len(inventory['chapters']),
        publisher_pages=len(inventory['pages']),captured_pages=len(inventory['pages'])-len(missing),
        chapter_indices=len(indices),section_pages=len(section_rows),missing_pages=missing,holds=holds,
        annotations_pages=len(annotations),attachment_references=len(attachments),retained_image_assets=len(asset_captures),
        leading_context_pages=len(contexts),multiple_printed_citation_pages=sum(p['printed_citation_markers']>1 for _,_,p in section_rows),
        heading_not_recorded_pages=sum(p['heading']is None for _,_,p in section_rows),
        source_style_exception_pages=len(style_exceptions),
        reserved_article_pages=sum(p['reserved_article_page']for _,_,p in section_rows),
        maximum_section_utf8_bytes=max((len(p['text'].encode())for _,_,p in section_rows),default=0),
        full_directory_inventory_sha256=digest((directory/'directory-inventory.json').read_bytes()),
        source_text_scope='Published statute paragraphs; publisher editorial annotations retained separately',
        ready_for_private_intake=not missing and not holds,publication_allowed=False,current_law_verified=False,
        calculation_activation_allowed=False)
    json_file(output/'audit.json',report)
    for name,rows in [('annotations',annotations),('attachments',attachments),('leading-context',contexts),('source-style-exceptions',style_exceptions)]:
        with (output/(name+'.jsonl')).open('x',encoding='utf8',newline='\n')as stream:
            for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
    if not emit_packet:return report
    if missing or holds:raise ValueError('Private packet refused: capture or source interpretation is incomplete; audit retained')
    # Images are retained separately and disclosed; they never become invented text.
    manifest=dict(schema_version='publisher-code-manifest/2',jurisdiction='HI',publisher='Hawaii State Legislature',
        publisher_url='https://www.capitol.hawaii.gov/',source_system='hi-hrs',code_title='Hawaii Revised Statutes',
        source_qualification='Publisher HRS source pages, including repealed and reserved markers and pages printing multiple versions. Editorial annotations and linked images remain in retained originals. Compilation-through date and current legal effect are not recorded.',
        parser=dict(name='hi-hrs-html',version='3'),
        retrieval=dict(methods=['publisher_page'],official_source=True,terms_gate=False,
            rate_limit_ms=min(receipt.get('rate_limit_ms',250)for receipt,_ in captures.values()),
            source_url_patterns=[r'^https://data\.capitol\.hawaii\.gov/hrscurrent/']),
        structure=dict(levels=['chapter','section'],unit='One exact publisher section HTML filename; leading context stays in its unit, editorial XNotes are retained separately'),
        section_id=dict(scheme='official_citation_path',regex=r'^HRS_[0-9A-Za-z_%\-]+(_\[OLD\])?(\.docx)?$',example='HRS_0001-0001',citation_format='Exact HRS publisher filename without .htm; literal citation or reserved article label is a separate source field'),
        currency=dict(basis='publisher_metadata',location='Publisher hrscurrent HTML; compilation-through date and present legal effect are not established'),
        review=dict(reviewed_by='Codex source parser review; publication requires complete source audit',reviewed_at='2026-10-12'))
    json_file(output/'manifest.json',manifest);(output/'text').mkdir()
    objects={};units=[];sections=[];proof=[]
    for url,(receipt,body)in captures.items():
        source=dict(source_url=url,retrieved_at=receipt['retrieved_at'],http_status=200,retrieval_method='publisher_page',proxy=None)
        obj=objects.setdefault(receipt['sha256'],dict(sha256=receipt['sha256'],bytes=len(body),kind='publisher_original',
            path=str((directory/'raw'/receipt['sha256']).resolve()),sources=[]))
        if source not in obj['sources']:obj['sources'].append(source)
    for url,(receipt,body)in asset_captures.items():
        source=dict(source_url=url,retrieved_at=receipt['retrieved_at'],http_status=200,retrieval_method='publisher_page',proxy=None)
        obj=objects.setdefault(receipt['sha256'],dict(sha256=receipt['sha256'],bytes=len(body),kind='publisher_original',
            path=str((Path(assets_directory)/'raw'/receipt['sha256']).resolve()),sources=[]))
        if source not in obj['sources']:obj['sources'].append(source)
    for url,receipt,parsed in section_rows:
        index=indices[url.rsplit('/',1)[0]+'/'];key=parsed['citation_path'];unit_text=parsed['unit_text'];sha=digest(unit_text.encode())
        path=output/'text'/(sha+'.txt')
        if not path.exists():path.write_bytes(unit_text.encode())
        source=dict(source_url=url,retrieved_at=receipt['retrieved_at'],http_status=200,retrieval_method='publisher_page',proxy=None)
        derivative=objects.setdefault(sha,dict(sha256=sha,bytes=len(unit_text.encode()),kind='unit_text_derivative',path=str(path.resolve()),
            code_points=len(unit_text),sources=[]))
        if source not in derivative['sources']:derivative['sources'].append(source)
        # A retrieval date and an "hrscurrent" directory are not an enacted-
        # through date. The contract's explicit unknown-currency form avoids
        # presenting our acquisition note as a publisher currency statement.
        currency=dict(basis='none',edition='Hawaii Revised Statutes, publisher hrscurrent HTML',through_date=None,statement='')
        units.append(dict(unit_key=key,unit_kind='section_page',heading=parsed['heading'],original_sha256=receipt['sha256'],
            publisher_member=None,raw_member_sha256=None,text_sha256=sha,text_code_points=len(unit_text),sections_expected=1,currency=currency,
            **{k:source[k]for k in ['source_url','retrieved_at','retrieval_method','proxy']}))
        notes=[parsed['status_note']]if parsed['status_note']else[]
        if parsed['attachments']:notes.append('Publisher HTML contains linked image content not represented in this text derivative; consult the retained original and official source.')
        if parsed['printed_citation_markers']>1:notes.append('This publisher page prints multiple statutory citation markers; the page is preserved as one native source record without selecting a legal version.')
        sections.append(dict(unit_key=key,citation_path=key,citation=parsed['citation'],heading=parsed['heading'],text=parsed['text'],
            hierarchy=[dict(level='chapter',number=index['chapter'],heading=index['heading']),
                       dict(level='section',number=parsed['citation'],heading=parsed['heading'])],
            history=parsed['history'],status_note=' '.join(notes)or None,span=parsed['span'],currency=currency))
        proof.append(dict(url=url,markers=1,sections=1,printed_citation_markers=parsed['printed_citation_markers'],
            reserved_article_page=parsed['reserved_article_page'],
            character_sequence_preserved=parsed['source_character_sequence_preserved']))
    for name,rows in [('objects',list(objects.values())),('units',units),('sections',sections)]:
        with (output/(name+'.jsonl')).open('x',encoding='utf8',newline='\n')as stream:
            for row in rows:stream.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
    json_file(output/'toc-proof.json',dict(marker='One exact directory-listed native source page with a printed statutory citation or an explicit reserved article marker; all printed versions are preserved',
        pages=proof,unfetched_child_pages=[],chapter_index_pages=len(indices),directory_inventory_sha256=report['full_directory_inventory_sha256']))
    return report


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--capture',type=Path,required=True)
    cli.add_argument('--out',type=Path,required=True);cli.add_argument('--emit-packet',action='store_true')
    cli.add_argument('--assets',type=Path);args=cli.parse_args()
    result=stage(args.capture,args.out,args.emit_packet,args.assets)
    print(json.dumps({k:v for k,v in result.items()if k not in ['missing_pages','holds']}))
