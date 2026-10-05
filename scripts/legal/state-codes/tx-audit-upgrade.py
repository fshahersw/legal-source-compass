"""Check an additive Texas parser revision against frozen prior derivatives."""
import collections
import hashlib
import json
import pathlib
import re
import sys
import zipfile
from lxml import html


def main(root, before, after):
    root = pathlib.Path(root)
    if not re.fullmatch(r'parsed-v[0-9]+', before) or not re.fullmatch(r'parsed-v[0-9]+', after):
        raise ValueError('Explicit version directories required')
    def rows(file):
        return [json.loads(line) for line in file.read_text(encoding='utf8').splitlines()]
    def sha(raw):
        return hashlib.sha256(raw).hexdigest()
    prior_chapters = {r['id']: r for r in rows(root / before / 'chapters.jsonl')}
    chapters = {r['id']: r for r in rows(root / after / 'chapters.jsonl')}
    prior_sections = {r['id']: r for r in rows(root / before / 'sections.jsonl')}
    sections = rows(root / after / 'sections.jsonl')
    assert prior_chapters.keys() == chapters.keys(), 'Chapter set changed'
    assert len({r['id'] for r in sections}) == len(sections), 'Duplicate section identity'
    by_chapter = collections.defaultdict(list)
    added = []
    for row in sections:
        by_chapter[row['chapter_id']].append(row)
        if row['id'] in prior_sections:
            old = prior_sections.pop(row['id'])
            assert all(row.get(k) == v for k, v in old.items() if k != 'parser'), row['id']
        else:
            added.append(row)
    assert not prior_sections, 'Prior section disappeared'
    for identity, chapter in chapters.items():
        assert chapter['text_sha256'] == prior_chapters[identity]['text_sha256'], identity
        raw = (root / chapter['text_file']).read_bytes()
        assert len(raw) == chapter['text_bytes'] and sha(raw) == chapter['text_sha256'], identity
        text = raw.decode('utf8')
        for row in by_chapter[identity]:
            start, end = row['text_start'], row['text_end']
            assert 0 <= start < end <= len(text), row['id']
            assert sha(text[start:end].encode('utf8')) == row['text_sha256'], row['id']
    # Independent direct source check for every newly recognized named anchor.
    for identity in sorted({r['chapter_id'] for r in added}):
        chapter = chapters[identity]
        receipt = json.loads((root / 'receipts' / (chapter['code'] + '.json')).read_bytes())
        archive = root / receipt['raw_file']
        assert sha(archive.read_bytes()) == receipt['sha256'] == chapter['archive_sha256']
        with zipfile.ZipFile(archive) as z:
            raw = z.read(chapter['publisher_member'])
        assert sha(raw) == chapter['raw_member_sha256']
        nodes = list(html.fromstring(raw.decode('utf-8-sig')).xpath('//body/pre')[0])
        blocks = {b['start']: b for b in chapter['blocks']}
        for row in [r for r in added if r['chapter_id'] == identity]:
            anchor = nodes[row['anchor_element_ordinal']]
            assert row['native_section_anchor'] in anchor.xpath('.//a/@name') + anchor.xpath('.//a/@id')
            heading = nodes[blocks[row['text_start']]['source_element_ordinal']]
            printed = re.sub(r'\s+', ' ', ''.join(heading.itertext())).strip()
            match = re.match(r'^(?:Sec\.|Art\.|SECTION)\s+(\S+)\.\s', printed, re.I)
            assert match and match[1] == row['native_section_anchor'], row['id']
    report = {'parser': 'texas-publisher-html/' + after.split('v')[-1],
        'baseline': before, 'section_occurrences': len(sections), 'added_occurrences': len(added),
        'added_by_chapter': dict(collections.Counter(r['chapter_id'] for r in added)),
        'prior_sections_preserved': True, 'all_chapter_text_hashes_unchanged': True,
        'all_section_span_hashes_verified': True, 'new_named_anchors_checked_against_raw_members': len(added),
        'chapters_jsonl_sha256': sha((root / after / 'chapters.jsonl').read_bytes()),
        'sections_jsonl_sha256': sha((root / after / 'sections.jsonl').read_bytes()),
        'registered': False, 'published': False}
    file = root / ('parser-' + after.split('-')[-1] + '-comparison-audit.json')
    with file.open('x', encoding='utf8') as out:
        json.dump(report, out, indent=2)
        out.write('\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main(*sys.argv[1:])
