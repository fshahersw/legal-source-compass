"""Parse preserved Texas publisher ZIPs without merging repeated citations.

Every section points to a character span of a hash-bound full chapter derivative.
Publisher notes and all chapter text remain available; no dates or legal rules
are inferred. Separate publisher files (including .v2) are separate occurrences.
"""
import collections
import hashlib
import json
import pathlib
import re
import sys
import zipfile
from urllib.parse import urlsplit
from lxml import html

PARSER = 'texas-publisher-html/4'


def publisher_note(text):
    return bool(re.match(r'^(Text of |For (?:another|text of)|This (?:section|article|chapter) (?:was|is)|The following)', text, re.I))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf8')


def parse_chapter(raw, code, member):
    # Strict decoding makes damaged text a parse failure, not silent OCR repair.
    doc = html.fromstring(raw.decode('utf-8-sig'))
    containers = doc.xpath('//body/pre')
    if len(containers) != 1:
        raise ValueError('Expected one publisher chapter pre element')
    if (containers[0].text or '').strip() or any((node.tail or '').strip() for node in containers[0]):
        raise ValueError('Unmapped text outside publisher block elements')
    blocks, chunks, offset = [], [], 0
    for ordinal, node in enumerate(containers[0]):
        if node.tag in ('script', 'style'):
            continue
        text = re.sub(r'\s+', ' ', ''.join(node.itertext())).strip()
        if not text:
            continue
        links = [{'text': re.sub(r'\s+', ' ', ''.join(a.itertext())).strip(), 'href': a.get('href')}
                 for a in node.xpath('.//a[@href]')]
        heads = []
        for link in links:
            u = urlsplit(link['href'])
            if (u.scheme == 'https' and u.netloc == 'statutes.capitol.texas.gov'
                    and u.path.lower().startswith('/docs/' + code.lower() + '/htm/')
                    and u.fragment and re.match(r'^(Sec\.|Art\.|SECTION)\s', link['text'], re.I)
                    and text.startswith(link['text'])):
                heads.append(link)
        # Older publisher files have a separate, empty named-anchor paragraph
        # before a plain heading, sometimes separated by an amendment notice.
        # Cross only empty elements and explicit publisher notices; ordinary
        # text is an identity boundary. Never manufacture an HTTP chapter URL.
        named_heading = re.match(r'^((?:Sec\.|Art\.|SECTION)\s+([^\s]+)\.)\s', text, re.I)
        previous = node.getprevious()
        previous_ordinal = ordinal - 1
        for _ in range(8):
            if previous is None or heads or not named_heading:
                break
            preceding_text = re.sub(r'\s+', ' ', ''.join(previous.itertext())).strip()
            names = previous.xpath('.//a/@name') + previous.xpath('.//a/@id')
            anchor = named_heading[2]
            if not preceding_text and names.count(anchor) == 1:
                heads.append({'text': named_heading[1], 'href': None,
                              'native_anchor': anchor, 'identity_evidence': 'preceding_named_anchor',
                              'anchor_element_ordinal': previous_ordinal})
                break
            if names or (preceding_text and not publisher_note(preceding_text)):
                break
            previous = previous.getprevious()
            previous_ordinal -= 1
        if len(heads) > 1:
            raise ValueError('Ambiguous section heading')
        kind = 'section_heading' if heads else 'paragraph'
        if node.get('class') == 'center' and re.match(r'^(TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|ARTICLE)\s', text):
            kind = 'hierarchy'
        if publisher_note(text):
            kind = 'publisher_note'
        block = {'source_element_ordinal': ordinal, 'start': offset, 'end': offset + len(text),
                 'kind': kind, 'links': links}
        if heads:
            block['heading'] = heads[0]
        blocks.append(block)
        chunks.append(text)
        offset += len(text) + 2
    full_text = '\n\n'.join(chunks)
    if not full_text:
        raise ValueError('Empty chapter text')
    sections, occurrence = [], collections.Counter()
    hierarchy = {}
    levels = ['TITLE', 'SUBTITLE', 'CHAPTER', 'SUBCHAPTER', 'ARTICLE']
    for ix, block in enumerate(blocks):
        if block['kind'] == 'hierarchy':
            label = full_text[block['start']:block['end']]
            level = label.split()[0]
            for child in levels[levels.index(level) + 1:]:
                hierarchy.pop(child, None)
            hierarchy[level] = label
        if block['kind'] != 'section_heading':
            continue
        head = block['heading']
        anchor = head.get('native_anchor') or urlsplit(head['href']).fragment
        occurrence[anchor] += 1
        stop = next((j for j in range(ix + 1, len(blocks))
                     if blocks[j]['kind'] in ('section_heading', 'hierarchy', 'publisher_note')), len(blocks))
        end = blocks[stop - 1]['end']
        text = full_text[block['start']:end]
        sections.append({'native_section_anchor': anchor, 'source_url': head['href'],
                         'identity_evidence': head.get('identity_evidence', 'publisher_heading_link'),
                         'anchor_element_ordinal': head.get('anchor_element_ordinal'),
                         'anchor_whitespace_anomaly': anchor != anchor.strip(),
                         'citation_heading': head['text'], 'publisher_member': member,
                         'occurrence': occurrence[anchor], 'text_start': block['start'], 'text_end': end,
                         'text_sha256': sha(text.encode('utf8')), 'hierarchy': dict(hierarchy),
                         'following_context_start': blocks[stop]['start'] if stop < len(blocks) else None})
    return full_text, blocks, sections


def main(root, output_name='parsed-v4'):
    root = pathlib.Path(root)
    inventory = json.loads((root / 'download-index.json').read_bytes())['StatuteCode']
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', output_name):
        raise ValueError('Output must be a new child directory name')
    target = root / output_name
    target.mkdir(exist_ok=False)
    chapters, sections, failures = [], [], []
    native_counts = collections.Counter()
    uncompressed_bytes = 0
    for code in inventory:
        receipt = json.loads((root / 'receipts' / (code['code'] + '.json')).read_bytes())
        archive = (root / receipt['raw_file']).read_bytes()
        if len(archive) != receipt['bytes'] or sha(archive) != receipt['sha256']:
            raise ValueError('Archive checksum mismatch')
        with zipfile.ZipFile(root / receipt['raw_file']) as z:
            if len(z.infolist()) != len(set(z.namelist())):
                raise ValueError('Duplicate ZIP member name')
            for member in z.infolist():
                if member.is_dir():
                    continue
                if not re.fullmatch(r'[a-zA-Z0-9._ -]+\.htm', member.filename, re.I):
                    raise ValueError('Unexpected ZIP member path/type')
                if member.file_size > 30_000_000:
                    raise ValueError('ZIP member size limit')
                uncompressed_bytes += member.file_size
                if uncompressed_bytes > 800_000_000:
                    raise ValueError('Total decompression bound exceeded')
                raw = z.read(member)  # zipfile validates CRC before successful return.
                member_hash = sha(raw)
                try:
                    text, blocks, rows = parse_chapter(raw, code['code'], member.filename)
                    text_bytes = text.encode('utf8')
                    text_hash = sha(text_bytes)
                    text_file = target / (text_hash + '.txt')
                    if text_file.exists() and text_file.read_bytes() != text_bytes:
                        raise ValueError('Derivative hash collision')
                    if not text_file.exists():
                        with text_file.open('xb') as text_out:
                            text_out.write(text_bytes)
                    chapter_id = code['code'] + ':' + member.filename
                    chapter = {'id': chapter_id, 'code': code['code'], 'code_name': code['CodeName'],
                               'publisher_member': member.filename, 'raw_member_sha256': member_hash,
                               'raw_member_bytes': len(raw), 'archive_sha256': receipt['sha256'],
                               'archive_source_url': receipt['source_url'], 'retrieved_at': receipt['retrieved_at'],
                               'parser': PARSER, 'text_file': text_file.relative_to(root).as_posix(),
                               'publisher_filename_legacy_hint': bool(re.search(r'(?:[-_.]old| - Copy)', member.filename, re.I)),
                               'text_sha256': text_hash, 'text_bytes': len(text_bytes), 'blocks': blocks,
                               'section_occurrences': len(rows), 'publication_allowed': False,
                               'calculation_activation_allowed': False}
                    chapters.append(chapter)
                    for row in rows:
                        native_key = code['code'] + ':' + row['native_section_anchor']
                        native_counts[native_key] += 1
                        row.update({'id': chapter_id + ':' + row['native_section_anchor'] + ':' + str(row['occurrence']),
                                    'native_citation_key': native_key, 'chapter_id': chapter_id,
                                    'chapter_text_sha256': text_hash, 'archive_sha256': receipt['sha256'],
                                    'raw_member_sha256': member_hash, 'parser': PARSER,
                                    'publication_allowed': False, 'calculation_activation_allowed': False})
                        sections.append(row)
                except (ValueError, UnicodeError) as error:
                    failures.append({'code': code['code'], 'member': member.filename,
                                     'raw_member_sha256': member_hash, 'reason': str(error)})
        print(json.dumps({'code': code['code'], 'parsed_members': len(chapters), 'section_occurrences': len(sections), 'failures': len(failures)}), flush=True)
    for name, rows in [('chapters.jsonl', chapters), ('sections.jsonl', sections)]:
        with (target / name).open('wb') as out:
            for row in rows:
                out.write(encode(row))
    summary = {'parser': PARSER, 'archive_count': len(inventory), 'uncompressed_bytes': uncompressed_bytes,
               'parsed_members': len(chapters), 'section_occurrences': len(sections),
               'unique_citation_keys': len(native_counts),
               'repeated_citation_keys': sum(n > 1 for n in native_counts.values()),
               'no_section_heading_members': [c['id'] for c in chapters if not c['section_occurrences']],
               'parse_failures': failures, 'registered': False, 'published': False,
               'currency': 'Publisher states statutes through 89th 2nd Called Session (2025); constitutional amendments through November 2025. Not independently certified current.',
               'legal_review_required': True}
    (target / 'summary.json').write_bytes(encode(summary))
    print(json.dumps(summary))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'private/audit-2026-10-05/full-state-codes/tx',
         sys.argv[2] if len(sys.argv) > 2 else 'parsed-v4')
