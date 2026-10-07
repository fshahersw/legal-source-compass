"""Build inventory.jsonl, sections.jsonl and parse-report.json from a finished capture."""
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from parse_hrs import (
    CURRENCY, EDITION, PARSER, file_key, file_match_key, is_index_name,
    load_jsonl, paragraphs, parse_index, parse_section_html, section_record,
    toc_match_key,
)

ROOT = Path('/tmp/sc/HI')
VOL_RE = re.compile(r'/Vol(\d+)_')


def sha_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def receipts_by_url():
    found = {}
    path = ROOT / 'receipts.jsonl'
    for line in path.read_text(encoding='utf8').splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get('ok') and rec.get('retrieval_method') == 'direct' and rec.get('stored_path'):
            found[rec['url']] = rec
    return found


def read_html(rec):
    return (ROOT / rec['stored_path']).read_bytes()


def volume_number(url):
    match = VOL_RE.search(url)
    return str(int(match.group(1))) if match else None


def blank_carry():
    return {
        'volume': None, 'division': None, 'division_heading': None,
        'title': None, 'title_heading': None, 'subtitle': None, 'subtitle_heading': None,
        'chapter': None, 'chapter_heading': None, 'part': None, 'part_heading': None,
        'article': None, 'article_heading': None,
    }


def apply_context(carry, ctx):
    for key in ('division', 'division_heading', 'title', 'title_heading', 'subtitle', 'subtitle_heading',
                'chapter', 'chapter_heading'):
        if ctx.get(key):
            carry[key] = ctx[key]
    if ctx.get('chapter'):
        carry['part'] = None
        carry['part_heading'] = None
        carry['article'] = None
        carry['article_heading'] = None
    if ctx.get('part'):
        carry['part'] = ctx['part']
        carry['part_heading'] = ctx.get('part_heading')


def citation_path(carry, section_number, section_heading):
    path = []
    if carry.get('volume'):
        path.append({'level': 'volume', 'number': carry['volume'], 'heading': None})
    for level in ('division', 'title', 'subtitle', 'chapter', 'part', 'article'):
        number = carry.get(level)
        if number:
            path.append({'level': level, 'number': number, 'heading': carry.get(level + '_heading')})
    if section_number:
        path.append({'level': 'section', 'number': section_number, 'heading': section_heading})
    return path


def source_of(rec, name):
    return {
        'url': rec['url'],
        'receipt_sha256': rec['sha256'],
        'member': name,
        'span': 'WordSection1',
    }


def main():
    index_path = ROOT / 'parsed' / 'directory-index.jsonl'
    entries = load_jsonl(index_path)
    recs = receipts_by_url()
    grouped = defaultdict(list)
    order = []
    for entry in entries:
        if entry['kind'] != 'file':
            continue
        parent = entry['parent_url']
        if parent not in grouped:
            order.append(parent)
        grouped[parent].append(entry)

    inventory_path = ROOT / 'parsed' / 'inventory.jsonl'
    sections_path = ROOT / 'parsed' / 'sections.jsonl'
    anomalies = []
    empty = []
    repeated = Counter()
    occurrence = Counter()
    class_hist = Counter()
    toc_sections = 0
    matched = 0
    toc_without_body = []
    body_without_toc = []
    parsed_rows = 0
    hierarchy_seen = set()
    volumes = set()
    carry = blank_carry()
    current_volume = None

    with inventory_path.open('w', encoding='utf8') as inv, sections_path.open('w', encoding='utf8') as secf:
        def emit_inventory(row):
            inv.write(json.dumps(row, ensure_ascii=False) + '\n')

        def emit_hierarchy(level, number, heading, url, native_id):
            if not number:
                return
            key = (level, number, heading)
            if key in hierarchy_seen:
                return
            hierarchy_seen.add(key)
            emit_inventory({
                'level': level, 'native_id': native_id, 'number': number, 'heading': heading,
                'url': url, 'status_label': None,
            })

        def emit_section(parsed, path_rows, rec, name, repeat_key=None):
            nonlocal parsed_rows
            cite_key = repeat_key or (
                tuple((item['level'], item.get('number')) for item in path_rows),
                parsed['citation'] or name,
            )
            occurrence[cite_key] += 1
            if parsed.get('citation'):
                repeated[cite_key] += 1
            record = section_record(parsed, path_rows, source_of(rec, name), occurrence[cite_key])
            if not (record['text'] or '').strip() and not record['status_label']:
                empty.append(record['native_id'])
            secf.write(json.dumps(record, ensure_ascii=False) + '\n')
            parsed_rows += 1

        for parent in order:
            files = grouped[parent]
            vol = volume_number(parent)
            if vol != current_volume:
                carry = blank_carry()
                current_volume = vol
                carry['volume'] = vol
                if vol:
                    volumes.add(vol)
            indexes = [item for item in files if item['name'].lower().endswith('.htm') and is_index_name(item['name'])]
            bodies = [item for item in files if item['name'].lower().endswith('.htm') and not is_index_name(item['name'])]
            for item in files:
                if not item['name'].lower().endswith('.htm'):
                    anomalies.append({'kind': 'non-html', 'name': item['name'], 'url': item['url']})

            toc_rows = []
            index_parsed = []
            for item in indexes:
                rec = recs.get(item['url'])
                if not rec:
                    anomalies.append({'kind': 'index-not-captured', 'url': item['url']})
                    continue
                html = read_html(rec)
                for para in paragraphs(html):
                    for cls in para['class']:
                        class_hist[cls] += 1
                parsed_index = parse_index(html, item['name'])
                index_parsed.append((item, rec, parsed_index))
                ctx = parsed_index['context']
                apply_context(carry, ctx)
                for level in ('division', 'title', 'chapter'):
                    emit_hierarchy(level, ctx.get(level), ctx.get(level + '_heading'), item['url'],
                                   item['name'][:-4] + ':' + level)
                for row in parsed_index['hierarchy']:
                    if row['level'] == 'article':
                        emit_hierarchy('article', row['number'], row['heading'], item['url'],
                                       item['name'][:-4] + ':article:' + row['number'])
                instrument = parsed_index['instrument']
                if item['name'].startswith('USCON_AM'):
                    instrument = 'USCON_AM'
                for section in parsed_index['sections']:
                    toc_sections += 1
                    article_number = section.get('article_number')
                    if instrument in ('CONST', 'USCON', 'USCON_AM'):
                        key = toc_match_key(instrument, article_number, section['cite'])
                    else:
                        key = (instrument, None, str(section['cite']).replace(':', '-'))
                    status = None
                    heading = section['heading']
                    if heading.lower().rstrip('.') in ('repealed', 'reserved', 'renumbered', 'expired', 'omitted'):
                        status = heading.rstrip('.')
                    inv_row = {
                        'level': 'section',
                        'native_id': None,
                        'citation': section['cite'],
                        'heading': heading,
                        'url': None,
                        'volume': carry.get('volume'),
                        'division': carry.get('division'),
                        'division_heading': carry.get('division_heading'),
                        'title': carry.get('title'),
                        'title_heading': carry.get('title_heading'),
                        'chapter': section.get('chapter') or carry.get('chapter'),
                        'chapter_heading': section.get('chapter_heading') or carry.get('chapter_heading'),
                        'part': section.get('part'),
                        'part_heading': section.get('part_heading'),
                        'article': section.get('article'),
                        'article_heading': section.get('article_heading'),
                        'status_label': status,
                        'index_file': item['name'],
                        'match_key': list(key),
                    }
                    toc_rows.append((key, inv_row, section))
                if ctx.get('chapter_status'):
                    emit_inventory({
                        'level': 'chapter',
                        'native_id': item['name'][:-4],
                        'number': ctx.get('chapter'),
                        'heading': ctx.get('chapter_heading'),
                        'url': item['url'],
                        'status_label': ctx.get('chapter_status'),
                        'history': ctx.get('chapter_history'),
                    })
                if parsed_index['unclassified']:
                    anomalies.append({
                        'kind': 'unclassified-index-lines',
                        'file': item['name'],
                        'count': len(parsed_index['unclassified']),
                        'sample': parsed_index['unclassified'][:8],
                    })

            by_key = {}
            for item in bodies:
                fk = file_key(item['name'])
                keys = set()
                fmk = file_match_key(fk)
                if fmk:
                    keys.add(fmk)
                rec = recs.get(item['url'])
                if rec:
                    parsed = parse_section_html(read_html(rec), item['name'])
                    cite = (parsed.get('citation') or '').lstrip('§').strip()
                    inst = (fk or {}).get('instrument') or 'HRS'
                    if cite:
                        article = (fk or {}).get('article')
                        if inst in ('CONST', 'USCON', 'USCON_AM'):
                            keys.add((inst, article, cite))
                        else:
                            keys.add((inst, None, cite.replace(':', '-')))
                for key in keys:
                    by_key.setdefault(key, []).append(item)

            used_files = set()
            for key, inv_row, section in toc_rows:
                hit = None
                for candidate in by_key.get(key, []):
                    if candidate['url'] not in used_files:
                        hit = candidate
                        break
                if hit is None:
                    toc_without_body.append({'citation': inv_row['citation'], 'index': inv_row['index_file'], 'key': inv_row['match_key']})
                    emit_inventory(inv_row)
                    continue
                used_files.add(hit['url'])
                matched += 1
                inv_row['url'] = hit['url']
                inv_row['native_id'] = hit['name'][:-4]
                emit_inventory(inv_row)

            for item in bodies:
                if item['url'] in used_files:
                    continue
                body_without_toc.append({'name': item['name'], 'url': item['url']})
                emit_inventory({
                    'level': 'section',
                    'native_id': item['name'][:-4],
                    'citation': (file_key(item['name']) or {}).get('cite'),
                    'heading': None,
                    'url': item['url'],
                    'volume': carry.get('volume'),
                    'status_label': None,
                    'index_file': None,
                    'list_source': 'directory-listing',
                })

            # Bodies, in listing order. Path prefers the matched TOC row.
            toc_by_url = {}
            for key, inv_row, section in toc_rows:
                if inv_row.get('url'):
                    toc_by_url[inv_row['url']] = (inv_row, section)
            for item in bodies:
                rec = recs.get(item['url'])
                if not rec:
                    anomalies.append({'kind': 'body-not-captured', 'url': item['url']})
                    continue
                html = read_html(rec)
                for para in paragraphs(html):
                    for cls in para['class']:
                        class_hist[cls] += 1
                parsed = parse_section_html(html, item['name'])
                info = toc_by_url.get(item['url'])
                local = dict(carry)
                section_number = parsed['citation']
                if info:
                    inv_row, section = info
                    if section.get('part'):
                        local['part'] = section['part']
                        local['part_heading'] = section.get('part_heading')
                    if section.get('article'):
                        local['article'] = section['article']
                        local['article_heading'] = section.get('article_heading')
                    if section.get('chapter'):
                        local['chapter'] = section['chapter']
                        local['chapter_heading'] = section.get('chapter_heading')
                    if not section_number:
                        section_number = section['cite']
                path_rows = citation_path(local, section_number, parsed['heading'])
                if parsed['citation'] is None and info:
                    parsed['citation'] = info[1]['cite']
                emit_section(parsed, path_rows, rec, item['name'])

            for item, rec, parsed_index in index_parsed:
                ctx = parsed_index['context']
                if ctx.get('chapter_status') or (not bodies and parsed_index['sections'] == []):
                    parsed = parse_section_html(read_html(rec), item['name'])
                    if not parsed['citation']:
                        parsed['citation'] = ('Chapter ' + ctx['chapter']) if ctx.get('chapter') else None
                    local = dict(carry)
                    local['chapter'] = ctx.get('chapter') or local.get('chapter')
                    local['chapter_heading'] = ctx.get('chapter_heading') or local.get('chapter_heading')
                    emit_section(parsed, citation_path(local, parsed['citation'], parsed['heading']), rec, item['name'])
                for unit in parsed_index['embedded']:
                    text = '\n'.join(unit['lines'])
                    parsed = {
                        'name': item['name'],
                        'citation': unit['heading'],
                        'heading': unit['heading'],
                        'text': text,
                        'history': None,
                        'status_label': None,
                        'effective': None,
                        'annotations': parsed_index['annotations'] if unit['heading'] == 'PREAMBLE' else None,
                    }
                    emit_inventory({
                        'level': 'section',
                        'native_id': item['name'][:-4] + ':' + unit['heading'],
                        'citation': unit['heading'],
                        'heading': unit['heading'],
                        'url': item['url'],
                        'status_label': None,
                        'index_file': item['name'],
                    })
                    emit_section(parsed, citation_path(carry, unit['heading'], unit['heading']), rec, item['name'])

    repeated_list = sorted((str(cite), count) for cite, count in repeated.items() if count > 1)
    report = {
        'parser': PARSER,
        'edition': EDITION,
        'currency': CURRENCY,
        'counts': {
            'volumes': len(volumes),
            'hierarchy_rows': len(hierarchy_seen),
            'toc_sections': toc_sections,
            'toc_matched_to_files': matched,
            'toc_without_body': len(toc_without_body),
            'body_without_toc': len(body_without_toc),
            'section_rows': parsed_rows,
            'empty_bodies': len(empty),
            'repeated_citations': len(repeated_list),
        },
        'class_histogram': class_hist.most_common(),
        'anomalies': anomalies[:200],
        'anomaly_count': len(anomalies),
        'toc_without_body_sample': toc_without_body[:40],
        'body_without_toc_sample': body_without_toc[:40],
        'empty_body_sample': empty[:40],
        'repeated_citation_sample': repeated_list[:40],
        'input_sha256': {
            'directory-index.jsonl': sha_file(index_path),
            'receipts.jsonl': sha_file(ROOT / 'receipts.jsonl'),
        },
        'output_sha256': {
            'inventory.jsonl': sha_file(inventory_path),
            'sections.jsonl': sha_file(sections_path),
        },
    }
    report_path = ROOT / 'parsed' / 'parse-report.json'
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print(json.dumps(report['counts'], indent=2))
    print('anomalies', len(anomalies), 'classes', class_hist.most_common(12))


if __name__ == '__main__':
    main()
