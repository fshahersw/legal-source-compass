"""Parse publisher-style RTF retained in a historical third-party archive.

No acquisition, inferred current law, publication, or database operations. Native
Section and Code Segment styles define boundaries; literal raw spans are retained.
"""
from __future__ import annotations
from collections import Counter
import hashlib
import re

VERSION = 'historical-cic-rtf/2'
NATIVE_CITATION = r'\d+[A-Za-z]*-\d+[A-Za-z]*-\d+[A-Za-z]*(?:\.\d+)?'
HEADING_CITATION = re.compile(r'^\s*§*\s*(' + NATIVE_CITATION + r'(?:\s*(?:,|—|–)\s*' + NATIVE_CITATION + r')*)\s*\.')
TOKEN = re.compile(r"\\'([0-9a-fA-F]{2})|\\([A-Za-z]+)(-?\d+)? ?|\\([^A-Za-z])|([{}])")
SKIP = {'fonttbl','colortbl','stylesheet','info','pict','object','fldinst','listtable','listoverridetable'}
SPECIAL = {'par':'\n','line':'\n','tab':'\t','cell':'\t','row':'\n','emdash':'—','endash':'–','bullet':'•','lquote':'‘','rquote':'’','ldblquote':'“','rdblquote':'”'}
FORMAT = set('rtf ansi mac pc pca ansicpg deff deflang deflangfe viewkind uc pard plain s b i ul ulnone uldb ulwave strike v expnd expndtw outl shad f fs cf nosupersub supersub sub super ql qr qj qc sl slmult sb sa li ri fi tx keep keepn pagebb widowctrl nowidctlpar hyphpar intbl trowd trgaph trleft trrh trql trqr trqc clvertalt clvertalc clvertalb clcbpat clcfpat clbrdrt clbrdrl clbrdrb clbrdrr brdrs brdrdb brdrdot brdrdash brdrw brsp brdrcf brdrt brdrl brdrb brdrr cellx trhdr trkeep lang langfe langnp langfenp rtlch ltrch rtlpar ltrpar loch hich dbch af afs ab ai acf aul aulnone aexpnd aexpndtw anichars animtext deleted revised deletedrsid insrsid charrsid pararsid sectd cols footery headery paperw paperh margl margr margt margb pgnstart sect sectnum sbknone sbkpage header footer headerl headerr footerl footerr fcharset froman fswiss fmodern fnil ftech fprq pntext pn pntxta pntxtb pnseclvl pnql pnqr pndec pnlvlbody pnstart pnf pnfs pnb pni pnindent pnhang pnsp pnucltr pnlcltr pnucrm pnlcrm listtext ls ilvl leveltext levelnumbers field fldrslt softline softpage'.split())
FORMAT.update({'tqr','cs','dn','up'})

def render(fragment):
    """Decode visible RTF characters; unknown semantic controls require review."""
    text=fragment.decode('cp1252',errors='strict') if isinstance(fragment,bytes) else fragment
    stack=[]; skip=False; uc=1; fallback=0; pending_star=False; out=[]; unknown=set(); images=0
    cursor=0
    def emit(value):
        nonlocal fallback
        value=value.replace('\r','').replace('\n','')
        if fallback:
            n=min(fallback,len(value));value=value[n:];fallback-=n
        if not skip:out.append(value)
    for m in TOKEN.finditer(text):
        emit(text[cursor:m.start()]);cursor=m.end()
        if m[5]=='{':
            stack.append((skip,uc,pending_star));pending_star=False
        elif m[5]=='}':
            if stack:skip,uc,pending_star=stack.pop()
        elif m[1]:emit(bytes([int(m[1],16)]).decode('cp1252',errors='strict'))
        elif m[4]:
            c=m[4]
            if c=='*':pending_star=True
            elif c in '{}\\':emit(c)
            elif c=='~':emit('\u00a0')
            elif c=='_':emit('\u2011')
            elif c=='-':pass  # optional hyphen, not a source character
            elif c in '\r\n':pass
            else:unknown.add('symbol:'+c)
        else:
            word=m[2];number=int(m[3]) if m[3] else None
            if pending_star:skip=True;pending_star=False
            if word in SKIP:
                if word in {'pict','object'}:images+=1
                skip=True
            elif word=='uc':uc=number if number is not None else 1
            elif word=='u':
                if number is None:raise ValueError('RTF unicode control missing value')
                if not skip:out.append(chr(number if number>=0 else number+65536))
                fallback=uc
            elif word in SPECIAL:
                if not skip:out.append(SPECIAL[word])
            elif word=='bin':raise ValueError('Binary RTF requires separate source parser')
            elif word not in FORMAT and not skip:unknown.add(word)
    emit(text[cursor:])
    value=''.join(out)
    # RTF represents non-BMP Unicode as UTF-16 surrogate pairs.
    value=value.encode('utf-16-le',errors='surrogatepass').decode('utf-16-le',errors='strict')
    return value.strip(),sorted(unknown),images

def styles(raw):
    # Stylesheet is a top-level group. Count braces, respecting escaped braces.
    start=raw.find(b'{\\stylesheet')
    if start<0:raise ValueError('Native RTF stylesheet missing')
    depth=0;end=None
    for m in re.finditer(rb'\\[{}\\]|[{}]',raw[start:]):
        if m[0]==b'{':depth+=1
        elif m[0]==b'}':
            depth-=1
            if depth==0:end=start+m.end();break
    if end is None:raise ValueError('Unclosed stylesheet')
    found={}
    for m in re.finditer(rb'{\\s(\d+)\b([^{}]*)}',raw[start:end],re.S):
        label,unknown,_=render(m[2])
        label=label.strip().rstrip(';').strip()
        found[int(m[1])]=label
    if list(found.values()).count('Section')!=1 or list(found.values()).count('Code Segment')!=1:
        raise ValueError('Unique native Section and Code Segment styles required')
    return found,end

def parse(raw,state,edition):
    if state not in {'AR','MS','TN'}:raise ValueError('Reviewed historical state required')
    if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',edition):raise ValueError('Explicit historical source edition required')
    if not raw.startswith(b'{\\rtf'):raise ValueError('RTF source required')
    style_map,body_start=styles(raw)
    starts=[m.start() for m in re.finditer(rb'(?<!\\)\\pard\b',raw) if m.start()>=body_start]
    if not starts:raise ValueError('No native paragraphs')
    rows=[];unmapped=[];current=None;segment=None;segments=Counter();paragraphs=[]
    for ordinal,start in enumerate(starts,1):
        end=starts[ordinal] if ordinal<len(starts) else len(raw)
        fragment=raw[start:end]
        sm=re.match(rb'\\pard\s*\\s(\d+)\b',fragment)
        style=style_map.get(int(sm[1])) if sm else None
        value,unknown,images=render(fragment)
        item={'ordinal':ordinal,'raw_span':{'unit':'bytes','start':start,'end':end},'style':style,'text':value,'unknown_controls':unknown,'embedded_objects':images}
        paragraphs.append(item)
        if style=='Section':
            if current:rows.append(current)
            bookmark=re.findall(rb'{\\\*\\bkmkstart ([^}]+)}',fragment)
            citation=HEADING_CITATION.match(value)
            current={'ordinal':len(rows)+1,'heading':value,'citation':citation[1] if citation else None,'native_bookmarks':[b.decode('cp1252')for b in bookmark], 'heading_raw_span':item['raw_span'],'parts':{'text':[],'history':[],'annotations':[],'hidden_text':[]},'issues':[]}
            if not citation:current['issues'].append('Native section heading has no supported citation')
            if unknown:current['issues'].append('Unknown heading controls: '+','.join(unknown))
            segment=None
        elif style and (style.startswith('Level') or style=='Name of Infobase'):
            if current:rows.append(current);current=None;segment=None
            unmapped.append({**item,'classification':'source_outline'})
        elif style=='Code Segment':
            segment=value.casefold();segments[value]+=1
            if segment not in {'text','history','annotations'}:
                if current:current['issues'].append('Unknown source segment: '+value)
                segment=None;unmapped.append({**item,'classification':'unknown_segment'})
        elif current and segment=='text' and style=='hidden':
            # Publisher hidden form/table transcripts may contain font-dependent symbols.
            # Keep exact decoded characters privately, not as ordinary statutory body text.
            current['parts']['hidden_text'].append(item)
            if unknown:current['issues'].append('Unknown hidden transcript controls: '+','.join(unknown))
            if images:current['issues'].append('Embedded source object requires review')
        elif current and segment in current['parts']:
            current['parts'][segment].append(item)
            if unknown:current['issues'].append('Unknown '+segment+' controls: '+','.join(unknown))
            if images:current['issues'].append('Embedded source object requires review')
        elif value:
            unmapped.append({**item,'classification':'source_unmapped'})
    if current:rows.append(current)
    seen=Counter(row['citation'] for row in rows if row['citation'] is not None)
    for row in rows:
        row['text']='\n'.join(p['text']for p in row['parts']['text'] if p['text'])
        row['history']='\n'.join(p['text']for p in row['parts']['history'] if p['text'])
        row['annotations']='\n'.join(p['text']for p in row['parts']['annotations'] if p['text'])
        row['hidden_transcript_paragraphs']=len(row['parts']['hidden_text'])
        if row['hidden_transcript_paragraphs']:
            row['issues'].append('Hidden form/table transcript retained separately; referenced visual material is not represented')
        if not row['text']:row['issues'].append('No statutory text in the original Text segment')
        if row['citation'] is not None and seen[row['citation']]>1:row['issues'].append('Repeated native citation; occurrence identity required')
        row['issues']=sorted(set(row['issues']))
        row['current_law_verified']=False;row['calculation_activation_allowed']=False;row['publication_allowed']=False
    return {'parser':VERSION,'state':state,'source_edition':edition,'provenance_class':'third_party_historical_archive','official_direct':False,'current_law_verified':False,'raw_sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'styles':style_map,'segment_counts':dict(segments),'paragraph_count':len(paragraphs),'sections':rows,'unmapped':unmapped}
