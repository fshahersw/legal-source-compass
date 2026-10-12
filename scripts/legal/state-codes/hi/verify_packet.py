"""Independent, offline HRS packet-to-source checks before private intake.

Does not call the statute parser. Rebuilds the publisher directory inventory,
checks exact filenames/source receipts, and compares the complete printed
character sequence and annotation sequence with the retained HTML. A successful
report is evidence for review, never publication or present-law certification.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
from urllib.parse import urljoin

from lxml import html
from stage_hrs import discovery,exact_capture,digest,json_file
from source_boundaries import statutory_xnotes_exception


def rows(path):return [json.loads(line)for line in Path(path).read_text('utf8').splitlines()if line.strip()]
def sequence(value):return re.sub(r'\s','',value)
def note(element):return any(c.casefold().startswith('xnotes')for c in (element.get('class')or'').split())


def source_sequences(body,filename):
    source_sha256=digest(body)
    document=html.fromstring(body.decode('utf-8-sig'))
    containers=[element for element in document.xpath('//div[@class]')if any(
        re.fullmatch(r'WordSection[0-9]+',c)for c in element.get('class').split())]
    containers=[el for el in containers if not any(a in containers for a in el.iterancestors())]
    statutory=[];annotations=[];images=[]
    for container in containers:
        statutory_note=statutory_xnotes_exception(container,filename,source_sha256)
        annotations.extend(el.text_content()for el in container.iter()if note(el)and el is not statutory_note
            and not any(note(a)for a in el.iterancestors()if a is not container))
        images.extend(el.get('src')for el in container.xpath('.//img[@src]'))
        copied=deepcopy(container)
        copied_note=statutory_xnotes_exception(copied,filename,source_sha256)
        for element in list(copied.iter()):
            if element is copied:continue
            if (note(element)and element is not copied_note)or (isinstance(element.tag,str)and element.tag.lower()in {'style','script'}):
                if element.getparent()is not None:element.drop_tree()
        statutory.append(copied.text_content())
    if not containers:raise ValueError('Source WordSection container missing')
    return sequence(''.join(statutory)),sequence(''.join(annotations)),images


def verify(capture,packet):
    capture=Path(capture);packet=Path(packet);inventory,directory_captures,missing=discovery(capture)
    if missing:raise ValueError('Publisher discovery bytes are missing')
    manifest=json.loads((packet/'manifest.json').read_text('utf8'))
    if (manifest.get('jurisdiction')!='HI'or manifest.get('source_system')!='hi-hrs'
            or manifest.get('parser')!={'name':'hi-hrs-html','version':'3'}
            or manifest.get('section_id',{}).get('scheme')!='official_citation_path'
            or manifest.get('structure',{}).get('levels')!=['chapter','section']):
        raise ValueError('HRS source manifest identity differs')
    sections=rows(packet/'sections.jsonl');units=rows(packet/'units.jsonl');objects=rows(packet/'objects.jsonl')
    annotation_rows=rows(packet/'annotations.jsonl');notes={row['source_url']:row for row in annotation_rows}
    if len(notes)!=len(annotation_rows):raise ValueError('Duplicate annotation source URL')
    object_map={row['sha256']:row for row in objects}
    if len(object_map)!=len(objects):raise ValueError('Duplicate object identity')
    for sha,row in object_map.items():
        body=Path(row['path']).read_bytes()
        if digest(body)!=sha or len(body)!=row['bytes']:raise ValueError('Packet object hash/length mismatch')
        if row['kind']=='unit_text_derivative'and len(body.decode('utf8'))!=row['code_points']:
            raise ValueError('Derivative code-point count differs')
    section_map={row['unit_key']:row for row in sections};unit_map={row['unit_key']:row for row in units}
    if len(section_map)!=len(sections)or len(unit_map)!=len(units):raise ValueError('Duplicate section or unit identity')
    urls=[url for url in inventory['pages']if not url.lower().endswith('-.htm')]
    expected={url.rsplit('/',1)[1][:-4]:url for url in urls}
    if len(expected)!=len(urls)or set(expected)!=set(section_map)or set(expected)!=set(unit_map):
        raise ValueError('Whole publisher section-page inventory differs')
    proof=json.loads((packet/'toc-proof.json').read_text('utf8'));proof_map={row['url']:row for row in proof['pages']}
    if (len(proof_map)!=len(proof['pages'])or set(proof_map)!=set(urls)or proof['unfetched_child_pages']
            or proof['directory_inventory_sha256']!=digest((capture/'directory-inventory.json').read_bytes())):
        raise ValueError('Publisher coverage proof differs')
    checked_notes=0;checked_images=0
    all_captures=dict(directory_captures)
    for url in inventory['pages']:
        captured=exact_capture(capture,url)
        if captured is None:raise ValueError('Publisher page original is missing')
        all_captures[url]=captured
    for url,(receipt,_)in all_captures.items():
        original=object_map.get(receipt['sha256'])
        if original is None or original['kind']!='publisher_original'or not any(
            src['source_url']==url and src['retrieved_at']==receipt['retrieved_at']for src in original['sources']):
            raise ValueError('Retained publisher source omitted from packet objects')
    for key,url in expected.items():
        unit=unit_map[key];section=section_map[key];receipt,body=all_captures[url]
        if (unit['source_url']!=url or unit['original_sha256']!=receipt['sha256']or unit['retrieved_at']!=receipt['retrieved_at']
                or unit['retrieval_method']!='publisher_page'or unit['proxy']is not None or unit['sections_expected']!=1
                or section['citation_path']!=key):raise ValueError('Exact native/source identity differs')
        original=object_map[receipt['sha256']];derivative=object_map[unit['text_sha256']]
        text=Path(derivative['path']).read_text('utf8');statutory,annotations,images=source_sequences(body,url.rsplit('/',1)[1])
        if (derivative['kind']!='unit_text_derivative'or unit['text_code_points']!=len(text)
                or sequence(text)!=statutory):raise ValueError('Source statutory character sequence differs')
        span=section['span']
        if (span['unit']!='unicode_code_points'or type(span['start'])is not int or type(span['end'])is not int
                or not 0<=span['start']<span['end']<=len(text)or text[span['start']:span['end']]!=section['text']):
            raise ValueError('Section Unicode span differs from retained source unit')
        if (not section['citation']or sequence(section['citation'])not in sequence(section['text'])
                or (section['heading']is not None and sequence(section['heading'])not in sequence(section['text']))
                or section['heading']!=unit['heading']):
            raise ValueError('Printed citation or heading differs from retained source text')
        hierarchy=section['hierarchy'];chapter=url.rsplit('/',2)[-2]
        chapter_number=re.sub(r'^HRS0*','',chapter)
        index_url=url.rsplit('/',1)[0]+'/'+chapter.replace('HRS','HRS_',1)+'-.htm'
        _,index_raw=all_captures[index_url];index_sequence=source_sequences(index_raw,index_url.rsplit('/',1)[-1])[0]
        if (len(hierarchy)!=2 or hierarchy[0]['level']!='chapter'or hierarchy[0]['number']!=chapter_number
                or not hierarchy[0]['heading']or any(sequence(line)not in index_sequence for line in hierarchy[0]['heading'].splitlines())
                or hierarchy[1]!=dict(level='section',number=section['citation'],heading=section['heading'])):
            raise ValueError('Recorded hierarchy differs from native chapter or printed index')
        if section['citation'].startswith('ARTICLE '):
            if (section['text']!=section['citation']+'\n[RESERVED]'or section['heading']!='[RESERVED]'
                    or 'no section citation is printed'not in(section['status_note']or'')
                    or proof_map[url].get('reserved_article_page')is not True):
                raise ValueError('Reserved article marker requires literal source text and disclosure')
        if section['currency']!={'basis':'none','edition':'Hawaii Revised Statutes, publisher hrscurrent HTML','through_date':None,'statement':''}:
            raise ValueError('Unestablished compilation currency was promoted')
        if section['currency']!=unit['currency']:raise ValueError('Source unit currency differs')
        recorded=notes.get(url)
        if annotations:
            if (recorded is None or recorded['source_sha256']!=receipt['sha256']
                    or sequence(''.join(row['text']for row in recorded['annotations']))!=annotations):
                raise ValueError('Editorial annotations were omitted or changed')
            checked_notes+=1
        elif recorded is not None:raise ValueError('Editorial annotations invented for source page')
        for src in images:
            asset_url=urljoin(url,src)
            if not any(row['kind']=='publisher_original'and any(s['source_url']==asset_url for s in row['sources'])for row in objects):
                raise ValueError('Linked publisher image bytes omitted')
            if 'linked image content'not in(section['status_note']or''):raise ValueError('Visual text gap lacks disclosure')
            checked_images+=1
        if proof_map[url]['markers']!=1 or proof_map[url]['sections']!=1:raise ValueError('Native page marker count differs')
    return dict(schema='hi-independent-source-verification/1',passed=True,sections=len(sections),units=len(units),objects=len(objects),
        publisher_pages=len(inventory['pages']),annotation_pages_checked=checked_notes,image_references_checked=checked_images,
        directory_inventory_sha256=digest((capture/'directory-inventory.json').read_bytes()),
        manifest_file_sha256=digest((packet/'manifest.json').read_bytes()),
        manifest_sha256=digest(json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')),
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__);cli.add_argument('--capture',type=Path,required=True)
    cli.add_argument('--packet',type=Path,required=True);cli.add_argument('--out',type=Path,required=True);args=cli.parse_args()
    report=verify(args.capture,args.packet);json_file(args.out,report);print(json.dumps(report))
