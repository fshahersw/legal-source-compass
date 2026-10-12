"""Source-bound Hawaii HRS HTML parsing; no retrieval or database operations.

The publisher marks statute paragraphs and editorial annotations separately.
Raw HTML remains authoritative. This renderer preserves every non-whitespace
statutory character in source order, records annotations separately, and reports
images/unknown text as evidence requiring review rather than inventing content.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import re

from lxml import html
from source_boundaries import statutory_xnotes_exception

BLOCKS={'p','li','tr','h1','h2','h3','h4','h5','h6','dt','dd'}
HYPHEN=r'[-\u2010\u2011\u2012\u2013\u2014]'
NUMBER=rf'[0-9]+[A-Za-z]*(?::[0-9A-Za-z]+)?{HYPHEN}[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*'
CITATION=re.compile(rf'^\s*\[?\s*§{{1,2}}\s*(?P<number>{NUMBER}(?:\s*(?:,|to|through|and)\s*(?:§{{1,2}}\s*)?{NUMBER})*)\]?')


def normalize(text):
    return re.sub(r'\s+',' ',text).strip()


def is_annotation(element):
    return any(c.casefold().startswith('xnotes') for c in (element.get('class')or'').split())


def content_containers(document):
    candidates=[el for el in document.xpath('//div[@class]')
                if any(re.fullmatch(r'WordSection[0-9]+',c)for c in el.get('class').split())]
    return [el for el in candidates if not any(a in candidates for a in el.iterancestors())]


def leaf_blocks(container):
    for element in container.iter():
        if not isinstance(element.tag,str):continue
        tag=element.tag.lower()
        if tag not in BLOCKS:continue
        # Table rows carry cells in order; paragraphs nested within them are not
        # emitted again. An annotation ancestor always determines classification.
        if any(isinstance(a.tag,str)and a.tag.lower()in BLOCKS for a in element.iterancestors()if a is not container):
            continue
        yield element


def block_text(element):
    if element.tag.lower()=='tr':
        return '\t'.join(normalize(c.text_content())for c in element if isinstance(c.tag,str)and c.tag.lower()in {'td','th'})
    return normalize(element.text_content())


def bold_heading(element):
    """Leading bold source phrase, including unbold punctuation between spans."""
    tokens=[]
    def walk(el,bold=False):
        bold=bold or (isinstance(el.tag,str)and el.tag.lower()in {'b','strong'})
        if el.text:tokens.append((el.text,bold))
        for child in el:
            if isinstance(child.tag,str):walk(child,bold)
            if child.tail:tokens.append((child.tail,bold))
    walk(element);out=[];started=False
    for text,bold in tokens:
        if bold:started=True;out.append(text)
        elif not started and re.fullmatch(r'[\s\[\]§]*',text):out.append(text)
        elif started and re.fullmatch(r'[\s\-\u2010-\u2014:.,\[\]§]*',text):out.append(text)
        else:break
    return normalize(''.join(out))


def parse_section_html(page, filename):
    source_sha256=hashlib.sha256(page if isinstance(page,bytes)else page.encode('utf8')).hexdigest()
    if isinstance(page,bytes):page=page.decode('utf-8-sig',errors='strict')
    if not re.fullmatch(r'HRS_[0-9A-Za-z_%\-]+(?:_\[OLD\])?(?:\.docx)?\.htm',filename,re.I):raise ValueError('Exact publisher HRS filename required')
    document=html.fromstring(page.lstrip('\ufeff'));containers=content_containers(document)
    if not containers:raise ValueError('Publisher WordSection content container missing')
    blocks=[];annotations=[];images=[];unclassified=[];source_parts=[];style_exceptions=[]
    for container in containers:
        statutory_note=statutory_xnotes_exception(container,filename,source_sha256)
        if statutory_note is not None:style_exceptions.append('Source-bound XNotes exception: leading bold statutory citation matches the exact publisher filename; sole-paragraph or separately reviewed raw response hash required')
        for element in leaf_blocks(container):
            text=block_text(element)
            if not text:continue
            annotated=element is not statutory_note and (is_annotation(element)or any(is_annotation(a)for a in element.iterancestors()if a is not container))
            if annotated:annotations.append(dict(css=element.get('class'),text=text))
            else:blocks.append((element,text))
        for element in container.xpath('.//img'):
            images.append(dict(src=element.get('src'),alt=element.get('alt'),title=element.get('title')))
        statutory=deepcopy(container)
        copied_note=statutory_xnotes_exception(statutory,filename,source_sha256)
        for element in list(statutory.iter()):
            if element is statutory:continue
            if (is_annotation(element)and element is not copied_note)or (isinstance(element.tag,str)and element.tag.lower()in {'script','style'}):
                parent=element.getparent()
                if parent is not None:
                    # Keep a tail that belongs to the surrounding statute.
                    element.drop_tree()
        source_parts.append(statutory.text_content())
    unit_text='\n'.join(value for _,value in blocks)
    no_space=lambda value:re.sub(r'\s','',value)
    coverage_ok=no_space(''.join(source_parts))==no_space(unit_text)
    index=filename.lower().endswith('-.htm')
    citation=None;heading=None
    first=next(((el,t)for el,t in blocks if CITATION.match(t)),None)
    if first and not index:
        match=CITATION.match(first[1]);citation=match.group('number')
        lead=bold_heading(first[0]);lead_match=CITATION.match(lead)
        if lead_match:heading=lead[lead_match.end():].lstrip(' ].').strip()or None
    # A retained native page may be a reserved article marker, not a statute.
    # Require the exact source form and matching native article number; use the
    # literal article label instead of inventing a section citation from its URL.
    article_native=re.fullmatch(r'HRS_[0-9]+-0*([0-9]+[A-Z]*)-[0-9]+\.htm',filename)
    reserved_article=(not first and not index and article_native is not None and len(blocks)==2
        and blocks[0][1]=='ARTICLE '+article_native.group(1)and blocks[1][1]=='[RESERVED]')
    if reserved_article:citation=blocks[0][1];heading=blocks[1][1]
    # Preserve source status wording. Never select present legal force from it.
    status=None
    if heading and re.match(r'^(REPEALED|RESERVED|TRANSFERRED|RENUMBERED)\b',heading,re.I):status=heading
    if reserved_article:status='Publisher reserved article page; no section citation is printed. The complete source-page marker is retained.'
    if not index and first is None and not reserved_article:unclassified.append('No exact leading statutory citation found')
    if not coverage_ok:unclassified.append('Text outside recognized source block structure')
    first_position=next((i for i,(el,_)in enumerate(blocks)if first is not None and el is first[0]),0)
    leading_context='\n'.join(value for _,value in blocks[:first_position])if not index else ''
    text='\n'.join(value for _,value in blocks[first_position:])if not index else unit_text
    start=len(leading_context)+1 if leading_context else 0
    return dict(kind='chapter_index'if index else'section_page',citation_path=filename[:-4],citation=citation,
        heading=heading,text=text,unit_text=unit_text,leading_context=leading_context,
        span=dict(unit='unicode_code_points',start=start,end=start+len(text)),history=None,status_note=status,
        annotations=annotations,attachments=images,unclassified=unclassified,source_style_exceptions=style_exceptions,
        source_character_sequence_preserved=coverage_ok,block_count=len(blocks),
        text_sha256=hashlib.sha256(text.encode('utf8')).hexdigest(),text_code_points=len(text),
        printed_citation_markers=sum(bool(CITATION.match(t))for _,t in blocks),
        reserved_article_page=reserved_article,
        publication_allowed=False,current_law_verified=False,calculation_activation_allowed=False)


def parse_chapter_index(page,filename):
    parsed=parse_section_html(page,filename)
    if parsed['kind']!='chapter_index':raise ValueError('Publisher chapter index required')
    if isinstance(page,bytes):page=page.decode('utf-8-sig',errors='strict')
    document=html.fromstring(page.lstrip('\ufeff'))
    blocks=[el for container in content_containers(document)for el in leaf_blocks(container)
            if block_text(el)and not is_annotation(el)]
    chapter=None;heading=None;headers=[]
    chapter_label=re.compile(r'^\[?CHAPTER\s+([0-9]+[A-Za-z]*)\]?(?:\s+\[(?:OLD|NEW)\])?$',re.I)
    for i,element in enumerate(blocks):
        line=block_text(element);match=chapter_label.fullmatch(line)
        if not match:continue
        following=[]
        for candidate in blocks[i+1:]:
            value=block_text(candidate)
            if chapter_label.fullmatch(value):break
            # Actual publisher heading lines are centered and may wrap across
            # paragraphs. Retain every line, including source square brackets.
            centered=(candidate.get('align')or'').lower()=='center'or bool(re.search(r'text-align\s*:\s*center',candidate.get('style')or'',re.I))
            if following and not centered:break
            if not following and re.match(r'^(?:Section|Part\s+[IVX]|REPEALED\b)',value,re.I):break
            following.append(value)
            if not centered:break
        headers.append(dict(chapter=match.group(1),label=line,heading='\n'.join(following)or None))
    # A native index may print old and new chapter headings. Preserve both;
    # selecting the last heading would silently choose a legal version.
    numbers={row['chapter']for row in headers}
    if len(numbers)==1:
        chapter=next(iter(numbers))
        native=re.fullmatch(r'HRS_0*([0-9]+[A-Za-z]*)-\.htm',filename,re.I)
        if native is None or chapter.casefold()!=native.group(1).casefold():
            raise ValueError('Printed chapter identity differs from exact publisher index filename')
        heading=('\n'.join(row['label']+'\n'+row['heading']for row in headers)
                 if len(headers)>1 and all(row['heading']for row in headers)
                 else headers[0]['heading']if len(headers)==1 else None)
    return dict(chapter=chapter,heading=heading,text=parsed['text'],annotations=parsed['annotations'],
                chapter_headers=headers,source_character_sequence_preserved=parsed['source_character_sequence_preserved'])
