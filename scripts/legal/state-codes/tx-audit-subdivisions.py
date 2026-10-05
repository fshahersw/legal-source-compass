"""Verify the narrow v4-to-v5 compound-statute mapping against retained bytes."""
import collections
import hashlib
import json
import pathlib
import re
import sys
import zipfile
from urllib.parse import urlsplit
from lxml import html


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main(root):
    root = pathlib.Path(root)
    before, after = root / 'parsed-v4', root / 'parsed-v5'
    reviewed = json.loads(pathlib.Path(__file__).with_name('tx-reviewed-subdivisions.json').read_bytes())
    evidence = {(r['code'] + ':' + r['member'], r['native_anchor']): r for r in reviewed}
    def rows(file):
        return [json.loads(line) for line in file.read_text(encoding='utf8').splitlines()]
    old_chapters = {r['id']: r for r in rows(before / 'chapters.jsonl')}
    old_sections = {r['id']: r for r in rows(before / 'sections.jsonl')}
    chapters = {r['id']: r for r in rows(after / 'chapters.jsonl')}
    sections = rows(after / 'sections.jsonl')
    require(old_chapters.keys() == chapters.keys(), 'Chapter set changed')
    require(len(sections) == len(old_sections) == len({r['id'] for r in sections}), 'Section identity set changed')
    by_chapter = collections.defaultdict(list)
    for section in sections:
        by_chapter[section['chapter_id']].append(section)
    remapped, extended, hierarchy_changes, added_characters = collections.Counter(), [], [], 0
    outer_articles = 0
    for identity, chapter in chapters.items():
        prior = old_chapters[identity]
        require(all(chapter.get(k) == v for k, v in prior.items() if k not in ('parser', 'text_file', 'blocks')), identity)
        raw_text = (root / chapter['text_file']).read_bytes()
        require(raw_text == (root / prior['text_file']).read_bytes(), 'Chapter text changed: ' + identity)
        require(sha(raw_text) == chapter['text_sha256'], 'Chapter text hash mismatch')
        text = raw_text.decode('utf8')
        blocks, old_blocks = chapter['blocks'], prior['blocks']
        outer_articles += sum(b['kind'] == 'hierarchy' and text[b['start']:b['end']].startswith('ARTICLE ') for b in blocks)
        require(len(blocks) == len(old_blocks), 'Block count changed')
        selected = [r for (cid, _), r in evidence.items() if cid == identity]
        source_nodes = None
        if selected:
            receipt = json.loads((root / 'receipts' / (chapter['code'] + '.json')).read_bytes())
            archive = (root / receipt['raw_file']).read_bytes()
            require(sha(archive) == receipt['sha256'] == chapter['archive_sha256'], 'Archive hash mismatch')
            with zipfile.ZipFile(root / receipt['raw_file']) as z:
                member = z.read(chapter['publisher_member'])
            require(sha(member) == chapter['raw_member_sha256'], 'Member hash mismatch')
            require(all(r['raw_member_sha256'] == sha(member) for r in selected), 'Reviewed member hash mismatch')
            source_nodes = list(html.fromstring(member.decode('utf-8-sig')).xpath('//body/pre')[0])
        parent = None
        embedded_labels = set()
        for old, new in zip(old_blocks, blocks):
            if old['kind'] == 'section_heading':
                h = old['heading']
                parent = h.get('native_anchor') or urlsplit(h['href']).fragment
            if old == new:
                if old['kind'] in ('hierarchy', 'publisher_note'):
                    parent = None
                continue
            key = (identity, parent)
            require(key in evidence, 'Unreviewed block changed')
            label = text[old['start']:old['end']]
            require(old['kind'] == 'hierarchy' and label.startswith('ARTICLE '), 'Wrong block reclassification')
            expected = dict(old, kind='subdivision_heading', parent_native_anchor=parent,
                            mapping_evidence='reviewed_exact_member_hash_and_parent_anchor')
            require(new == expected, 'Unexpected block changes')
            node = source_nodes[new['source_element_ordinal']]
            require(node.get('class') == 'center' and re.sub(r'\s+', ' ', ''.join(node.itertext())).strip() == label,
                    'Raw subdivision text differs')
            embedded_labels.add(label)
            remapped[key] += 1
        levels, hierarchy, expected_hierarchy = ['TITLE', 'SUBTITLE', 'CHAPTER', 'SUBCHAPTER', 'ARTICLE'], {}, {}
        section_block = {}
        for ix, block in enumerate(blocks):
            if block['kind'] == 'hierarchy':
                label = text[block['start']:block['end']]
                level = label.split()[0]
                for child in levels[levels.index(level) + 1:]:
                    hierarchy.pop(child, None)
                hierarchy[level] = label
            if block['kind'] == 'section_heading':
                section_block[block['start']] = ix
                expected_hierarchy[block['start']] = dict(hierarchy)
        for row in by_chapter[identity]:
            old = old_sections.pop(row['id'])
            mutable = {'parser', 'text_end', 'text_sha256', 'following_context_start', 'hierarchy'}
            require(all(row.get(k) == v for k, v in old.items() if k not in mutable), 'Identity/source fields changed: ' + row['id'])
            require(set(row) - set(old) <= {'subdivisions'}, 'Unexpected new section fields')
            require(row['hierarchy'] == expected_hierarchy[row['text_start']], 'Incorrect outer hierarchy')
            if row['hierarchy'] != old['hierarchy']:
                require(old['hierarchy'].get('ARTICLE') in embedded_labels, 'Unreviewed hierarchy removed')
                require({k: v for k, v in old['hierarchy'].items() if k != 'ARTICLE'} == row['hierarchy'], 'Other hierarchy changed')
                hierarchy_changes.append(row['id'])
            ix = section_block[row['text_start']]
            stop = next((j for j in range(ix + 1, len(blocks)) if blocks[j]['kind'] in
                         ('section_heading', 'hierarchy', 'publisher_note')), len(blocks))
            require(row['text_end'] == blocks[stop - 1]['end'], 'Incorrect section end')
            require(row['following_context_start'] == (blocks[stop]['start'] if stop < len(blocks) else None), 'Incorrect following context')
            require(sha(text[row['text_start']:row['text_end']].encode('utf8')) == row['text_sha256'], 'Section hash mismatch')
            children = [{'label': text[b['start']:b['end']], 'text_start': b['start'], 'text_end': b['end'],
                         'source_element_ordinal': b['source_element_ordinal']} for b in blocks[ix + 1:stop]
                        if b['kind'] == 'subdivision_heading']
            require(row.get('subdivisions', []) == children, 'Subdivision span mismatch')
            if row['text_end'] != old['text_end']:
                key = (identity, row['native_section_anchor'])
                require(key in evidence and len(children) == evidence[key]['article_headings'], 'Unreviewed section span changed')
                require(row['text_end'] > old['text_end'], 'Section text shrank')
                extra = row['text_end'] - old['text_end']
                added_characters += extra
                extended.append({'id': row['id'], 'prior_characters': old['text_end'] - old['text_start'],
                                 'characters': row['text_end'] - row['text_start'], 'added_characters': extra,
                                 'subdivision_headings': len(children)})
            else:
                require(row['text_sha256'] == old['text_sha256'], 'Unchanged span has different hash')
    require(not old_sections, 'Prior section disappeared')
    require(set(remapped) == set(evidence), 'Reviewed parent set mismatch')
    require(all(remapped[k] == v['article_headings'] for k, v in evidence.items()), 'Reviewed count mismatch')
    require(len(extended) == len(evidence), 'Not every reviewed parent was extended')
    report = {'outcome': 'passed', 'parser': 'texas-publisher-html/5',
              'chapters': len(chapters), 'section_occurrences': len(sections),
              'chapter_text_hashes_unchanged': len(chapters), 'extended_parent_sections': extended,
              'reclassified_article_headings': sum(remapped.values()), 'added_indexed_characters': added_characters,
              'corrected_outer_hierarchy_rows': hierarchy_changes,
              'true_outer_article_headings_preserved': outer_articles,
              'chapters_jsonl_sha256': sha((after / 'chapters.jsonl').read_bytes()),
              'sections_jsonl_sha256': sha((after / 'sections.jsonl').read_bytes()),
              'reviewed_mapping_sha256': sha(pathlib.Path(__file__).with_name('tx-reviewed-subdivisions.json').read_bytes()),
              'registered': False, 'published': False}
    with (root / 'parser-v5-comparison-audit.json').open('x', encoding='utf8') as out:
        json.dump(report, out, indent=2)
        out.write('\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('extended_parent_sections', 'corrected_outer_hierarchy_rows')}
                     | {'extended_parents': len(extended), 'corrected_hierarchy_rows': len(hierarchy_changes)}))


if __name__ == '__main__':
    main(sys.argv[1])
