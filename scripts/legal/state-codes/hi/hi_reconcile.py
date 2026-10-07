#!/usr/bin/env python3
"""Publisher reconciliation for HRS parse gaps (TOC vs directory listing vs bodies)."""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path('/tmp/sc/HI')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_hrs import file_key, file_match_key, parse_index, parse_section_html, toc_match_key  # noqa: E402


def jl(path):
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def main():
    report = json.loads((ROOT / 'parsed' / 'parse-report.json').read_text(encoding='utf-8'))
    counts = report['counts']
    recs = {r['url']: r for r in jl(ROOT / 'receipts.jsonl') if r.get('ok')}
    index_parent = {e['name']: e['parent_url'] for e in jl(ROOT / 'parsed/directory-index.jsonl') if e.get('kind') == 'file'}
    by_parent = {}
    for e in jl(ROOT / 'parsed/directory-index.jsonl'):
        if e.get('kind') != 'file' or not e['name'].lower().endswith('.htm'):
            continue
        fk = file_key(e['name'])
        if not fk:
            continue
        by_parent.setdefault(e['parent_url'], {})[file_match_key(fk)] = e

    toc_no = [r for r in jl(ROOT / 'parsed/inventory.jsonl') if r.get('level') == 'section' and not r.get('url')]
    orphans = [r for r in jl(ROOT / 'parsed/inventory.jsonl') if r.get('list_source') == 'directory-listing']
    empty = [r for r in jl(ROOT / 'parsed/sections.jsonl') if not (r.get('text') or '').strip() and not r.get('status_label')]

    toc_cats = Counter()
    toc_rows = []
    for r in toc_no:
        cite = r.get('citation')
        idx = r.get('index_file', '')
        inst = 'HRS'
        if idx.startswith('CONST'):
            inst = 'CONST'
        elif idx.startswith('USCON_AM'):
            inst = 'USCON_AM'
        elif idx.startswith('USCON'):
            inst = 'USCON'
        key = toc_match_key(inst, r.get('article'), cite)
        parent = index_parent.get(idx)
        h = (r.get('heading') or '').lower().strip('.')
        row = {'citation': cite, 'index_file': idx, 'heading': r.get('heading'), 'match_key': list(key)}
        if h in ('repealed', 'reserved', 'renumbered', 'expired', 'omitted'):
            row['publisher_basis'] = 'chapter index line is a status placeholder; no separate section .htm in the chapter folder listing'
            toc_cats['index_status_placeholder'] += 1
        elif parent and key in by_parent.get(parent, {}):
            row['publisher_basis'] = 'section .htm is listed under the chapter folder but matched to another index line first (shared filename key or duplicate index row)'
            row['listed_file'] = by_parent[parent][key]['name']
            toc_cats['index_row_superseded_by_earlier_match'] += 1
        else:
            row['publisher_basis'] = 'chapter index lists the section; no matching .htm basename in the captured IIS folder listing for this match key'
            toc_cats['index_without_listed_body_file'] += 1
        toc_rows.append(row)

    orphan_rows = []
    for r in orphans:
        name = r['native_id'] + '.htm' if not str(r.get('native_id', '')).endswith('.htm') else r['native_id']
        orphan_rows.append({
            'native_id': r.get('native_id'),
            'url': r.get('url'),
            'publisher_basis': 'IIS directory lists this .htm under hrscurrent; the chapter index (%s) has no row for this basename' % (
                r.get('index_file') or 'none — body-only orphan'),
        })

    empty_rows = []
    for r in empty:
        rec = recs.get(r['source']['url'])
        basis = 'parser found no operative text and no status label'
        if rec:
            parsed = parse_section_html((ROOT / rec['stored_path']).read_bytes(), r['native_id'] + '.htm')
            if parsed.get('status_label'):
                basis = 'publisher status line: %s' % parsed['status_label']
            elif (parsed.get('text') or '').strip():
                basis = 'publisher body present after re-parse (%d chars)' % len(parsed['text'])
        empty_rows.append({'native_id': r['native_id'], 'url': r['source']['url'], 'publisher_basis': basis})

    out = {
        'parse_counts': counts,
        'reconciled_at': __import__('time').strftime('%Y-%m-%dT%H:%M:%SZ', __import__('time').gmtime()),
        'toc_without_body': {'total': len(toc_rows), 'categories': dict(toc_cats), 'rows': toc_rows},
        'body_without_toc': {'total': len(orphan_rows), 'publisher_explanation': (
            'These are section .htm files the legislature IIS tree publishes alongside chapter indexes; '
            'the official chapter index HTML for that folder does not list them as separate TOC rows. '
            'They are retained as directory-listing orphans with text taken only from the section file.'),
                         'rows': orphan_rows},
        'empty_bodies': {'total': len(empty_rows), 'rows': empty_rows},
        'landed_scope': {
            'publisher_toc_sections': counts['toc_sections'],
            'toc_matched_to_body_files': counts['toc_matched_to_files'],
            'section_rows_emitted': counts['section_rows'],
            'note': 'Landing uses parsed sections with non-empty text or status_label; gaps.jsonl records exclusions.',
        },
    }
    path = ROOT / 'parsed' / 'reconciliation-report.json'
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({k: out[k] if k != 'toc_without_body' else {'total': out['toc_without_body']['total'], 'categories': out['toc_without_body']['categories']}
                      for k in ('parse_counts', 'toc_without_body', 'body_without_toc', 'empty_bodies')}, indent=2))


if __name__ == '__main__':
    main()
