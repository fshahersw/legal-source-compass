"""Build inventory-backed sections.jsonl, the parse report, and the staged packet.

`index` is produced by ks_acquire.py. This script parses retained HTML only.
"""
import gzip
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from ks_common import PARSER_NAME, PARSER_VERSION, ROOT
from ks_parse import parse_leg_section_html, parse_section_html

PARSED = ROOT / 'parsed'
STAGED = ROOT / 'staged'


def _jsonl(path):
    rows = []
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def _sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def _sha_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _receipts_by_url():
    found = {}
    for line in (ROOT / 'receipts.jsonl').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        receipt = json.loads(line)
        if receipt.get('ok') and receipt.get('retrieval_method') == 'direct' and receipt.get('stored_path'):
            found[receipt['url']] = receipt
    return found


def parse_sections():
    inventory = _jsonl(PARSED / 'inventory.jsonl')
    receipts = _receipts_by_url()
    chapter_page = {}
    for item in inventory:
        if item.get('kind') == 'chapter' and item.get('source') != 'legislature':
            chapter_page[item.get('chapter_number')] = item.get('url')
    out_path = PARSED / 'sections.jsonl'
    gaps = []
    anomalies = []
    unclassified = 0
    status_counts = Counter()
    annotation_labels = Counter()
    seen_citation = Counter()
    written = 0
    with out_path.open('w', encoding='utf-8') as out:
        for row in inventory:
            if row.get('kind') != 'section':
                continue
            if row.get('toc_only'):
                text = row.get('toc_text') or ''
                section = {
                    'state': 'KS',
                    'code_id': 'ksa',
                    'code_name': 'Kansas Statutes Annotated',
                    'edition': '2026 Kansas Statutes',
                    'native_id': row.get('native_id'),
                    'citation': row.get('citation'),
                    'citation_path': [
                        {'level': 'chapter', 'number': row.get('chapter_number'), 'heading': row.get('chapter_heading')},
                        {'level': 'article', 'number': row.get('article_number'), 'heading': row.get('article_heading')},
                        {'level': 'section', 'number': row.get('citation'), 'heading': row.get('heading')},
                    ],
                    'heading': row.get('heading'),
                    'text': text,
                    'history': None,
                    'annotations': [],
                    'status_label': row.get('status_label'),
                    'effective': None,
                    'currency': {'statement': 'These statutes include amendments and new laws enacted during the 2025 legislative session.', 'as_of': None},
                    'source': {
                        'url': chapter_page.get(row.get('chapter_number')),
                        'receipt_sha256': row.get('chapter_receipt_sha256'),
                        'member': row.get('chapter_number'),
                        'span': row.get('native_id'),
                        'publisher': 'Kansas Office of Revisor of Statutes',
                        'toc_only': True,
                    },
                    'text_sha256': __import__('hashlib').sha256(text.encode('utf-8')).hexdigest(),
                    'occurrence': 1,
                    'parser': {'name': PARSER_NAME, 'version': PARSER_VERSION},
                }
                # The chapter page is the retained original. Point source.url at that page.
                cite = section.get('citation')
                seen_citation[cite] += 1
                section['occurrence'] = seen_citation[cite]
                status_counts[section.get('status_label') or 'in_force'] += 1
                out.write(json.dumps(section, ensure_ascii=False) + '\n')
                written += 1
                continue
            url = row.get('url')
            if not url:
                gaps.append({'native_id': row.get('native_id'), 'citation': row.get('citation'), 'reason': 'no url'})
                continue
            receipt = receipts.get(url)
            if not receipt:
                gaps.append({'native_id': row.get('native_id'), 'citation': row.get('citation'), 'url': url, 'reason': 'no receipt'})
                continue
            html = (ROOT / receipt['stored_path']).read_text(encoding='utf-8', errors='replace')
            meta = {
                'native_id': row.get('native_id'),
                'heading': row.get('heading'),
                'citation': row.get('citation'),
                'chapter_number': row.get('chapter_number'),
                'chapter_heading': row.get('chapter_heading'),
                'article_number': row.get('article_number'),
                'article_heading': row.get('article_heading'),
            }
            if row.get('source') == 'legislature' or 'kslegislature.gov' in url:
                parsed, notes = parse_leg_section_html(html, url, receipt['sha256'], meta)
            else:
                parsed, notes = parse_section_html(html, url, receipt['sha256'], meta)
            if notes:
                anomalies.append({'url': url, 'notes': notes})
            if not parsed:
                gaps.append({'native_id': row.get('native_id'), 'url': url, 'reason': 'parser returned no row', 'notes': notes})
                continue
            for section in parsed:
                cite = section.get('citation')
                seen_citation[cite] += 1
                section['occurrence'] = seen_citation[cite]
                if section['occurrence'] > 1:
                    section['identity_kind'] = 'member:anchor:occurrence'
                    section['native_id'] = '%s:%s' % (section.get('native_id'), section['occurrence'])
                if section.get('unclassified'):
                    unclassified += 1
                status_counts[section.get('status_label') or 'in_force'] += 1
                for ann in section.get('annotations') or []:
                    annotation_labels[ann.get('label') or '(unlabelled)'] += 1
                out.write(json.dumps(section, ensure_ascii=False) + '\n')
                written += 1
    levels = Counter(row.get('kind') for row in inventory)
    report = {
        'parser': {'name': PARSER_NAME, 'version': PARSER_VERSION},
        'inventory_counts': dict(levels),
        'expected_sections': levels['section'],
        'parsed_sections': written,
        'gaps': gaps,
        'gap_count': len(gaps),
        'anomalies': anomalies[:200],
        'anomaly_count': len(anomalies),
        'unclassified_pages': unclassified,
        'status_counts': dict(status_counts),
        'annotation_labels': annotation_labels.most_common(40),
        'repeated_citation_count': sum(1 for count in seen_citation.values() if count > 1),
        'inventory_sha256': _sha_file(PARSED / 'inventory.jsonl'),
        'sections_sha256': _sha_file(out_path),
        'sections_bytes': out_path.stat().st_size,
    }
    (PARSED / 'parse-report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding='utf-8')
    print('parsed', written, 'gaps', len(gaps), 'anomalies', len(anomalies), 'unclassified', unclassified, flush=True)
    return report


def _derivative_text(sections):
    parts = []
    for section in sections:
        parts.append(section.get('citation') or '')
        if section.get('heading'):
            parts.append(section['heading'])
        if section.get('status_label'):
            parts.append(section['status_label'])
        if section.get('text'):
            parts.append(section['text'])
        if section.get('history'):
            parts.append(section['history'])
        for ann in section.get('annotations') or []:
            if ann.get('label'):
                parts.append(ann['label'])
            if ann.get('text'):
                parts.append(ann['text'])
        parts.append('')
    return '\n'.join(parts)


def stage():
    sections = _jsonl(PARSED / 'sections.jsonl')
    by_chapter = {}
    for section in sections:
        by_chapter.setdefault(section['source'].get('member') or 'unknown', []).append(section)
    chapter_dir = STAGED / 'chapters'
    chapter_dir.mkdir(parents=True, exist_ok=True)
    derivatives = []
    for number, group in by_chapter.items():
        body = _derivative_text(group).encode('utf-8')
        digest = _sha_bytes(body)
        dest = chapter_dir / digest
        dest.write_bytes(body)
        derivatives.append({
            'role': 'chapter-derivative',
            'chapter_number': number,
            'sha256': digest,
            'bytes': len(body),
            'path': str(dest.relative_to(ROOT)),
            'sections': len(group),
            'retrieval_method': 'derived',
            'url': None,
            'retrieved_at': None,
        })
    gz_path = STAGED / 'sections.jsonl.gz'
    with (PARSED / 'sections.jsonl').open('rb') as src, gzip.open(gz_path, 'wb') as dst:
        while True:
            chunk = src.read(1 << 20)
            if not chunk:
                break
            dst.write(chunk)
    source = json.loads((ROOT / 'source.json').read_text(encoding='utf-8'))
    (STAGED / 'source.json').write_text(json.dumps(source, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    raw_entries = []
    seen = set()
    for line in (ROOT / 'receipts.jsonl').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        receipt = json.loads(line)
        if not receipt.get('ok') or not receipt.get('stored_path'):
            continue
        if receipt['sha256'] in seen:
            continue
        seen.add(receipt['sha256'])
        raw_entries.append({
            'role': 'raw',
            'sha256': receipt['sha256'],
            'bytes': receipt.get('bytes'),
            'url': receipt.get('url'),
            'retrieved_at': receipt.get('retrieved_at'),
            'retrieval_method': receipt.get('retrieval_method'),
            'label': receipt.get('label'),
            'path': receipt.get('stored_path'),
            'status': receipt.get('status'),
        })
    gz_sha = _sha_file(gz_path)
    manifest = {
        'state': 'KS',
        'code_id': 'ksa',
        'sections_jsonl_gz': {
            'sha256': gz_sha,
            'bytes': gz_path.stat().st_size,
            'uncompressed_sha256': _sha_file(PARSED / 'sections.jsonl'),
            'uncompressed_bytes': (PARSED / 'sections.jsonl').stat().st_size,
            'rows': len(sections),
        },
        'source_json_sha256': _sha_file(STAGED / 'source.json'),
        'raw_file_count': len(raw_entries),
        'raw_bytes': sum(entry['bytes'] or 0 for entry in raw_entries),
        'derivative_count': len(derivatives),
        'derivative_bytes': sum(entry['bytes'] for entry in derivatives),
        'files': raw_entries + derivatives,
    }
    (STAGED / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    summary = {k: v for k, v in manifest.items() if k != 'files'}
    summary['manifest_sha256'] = _sha_file(STAGED / 'manifest.json')
    (PARSED / 'manifest-summary.json').write_text(json.dumps(summary, indent=1), encoding='utf-8')
    print('staged', summary['sections_jsonl_gz'], 'raw', summary['raw_file_count'], summary['raw_bytes'], flush=True)
    return summary


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else 'parse'
    if phase == 'parse':
        parse_sections()
    elif phase == 'stage':
        stage()
    else:
        raise SystemExit('usage: ks_build.py parse|stage')


if __name__ == '__main__':
    main()
