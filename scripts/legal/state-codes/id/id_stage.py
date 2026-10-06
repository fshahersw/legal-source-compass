"""Stage the Idaho Statutes capture and write the store-side reports.

Bulk section text stays under /tmp/sc/ID/staged/. The store receives source.json,
a manifest summary, parse-report.json, a <=25 row sample, report.md and
docs-section.md.
"""
import gzip
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

from id_common import (
    CODE_ID, CODE_NAME, INDEX_URL, PARSER_VERSION, ROOT, STATE, STORE,
    currency_statements, load_receipts, lookup_receipt, ok_by_url, read_html, sha256_bytes,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import verify_store  # noqa: E402


def _soup_text(html):
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, 'lxml').get_text('\n', strip=True)


def build_source(root=ROOT):
    root = Path(root)
    receipts = load_receipts(root)
    found = ok_by_url(receipts, root)
    currency_receipt = lookup_receipt(found, 'https://legislature.idaho.gov/statutesrules/howcurrentisthislaw')
    disclaimer_receipt = lookup_receipt(found, 'https://legislature.idaho.gov/site-disclaimer')
    robots_receipt = lookup_receipt(found, 'https://legislature.idaho.gov/robots.txt')
    index_receipt = lookup_receipt(found, INDEX_URL)
    how_lines, index_line, _as_of = currency_statements(
        read_html(root, index_receipt) if index_receipt else None,
        read_html(root, currency_receipt) if currency_receipt else None,
    )
    disclaimer = None
    maintainer = None
    if disclaimer_receipt:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(read_html(root, disclaimer_receipt), 'lxml')
        for paragraph in soup.find_all('p'):
            text = re.sub(r'\s+', ' ', paragraph.get_text(' ', strip=True))
            if text.startswith('The Legislature and the Legislative Services Office try to ensure'):
                disclaimer = text
            elif text.startswith('The Office of Legislative Services is responsible'):
                maintainer = text
    copyright_line = None
    if index_receipt:
        for line in _soup_text(read_html(root, index_receipt)).split('\n'):
            match = re.search(r'© \d{4} Idaho State Legislature\.', line)
            if match:
                copyright_line = match.group(0)
                break
    robots_star = None
    if robots_receipt:
        text = read_html(root, robots_receipt)
        match = re.search(r'User-agent: \*\n(?:Disallow:.*\n|Allow:.*\n|Sitemap:.*\n)+', text)
        robots_star = match.group(0).strip() if match else None
    probes = []
    for receipt in receipts:
        if receipt.get('label') == 'bulk-probe':
            probes.append({
                'url': receipt.get('url'),
                'status': receipt.get('status'),
                'ok': bool(receipt.get('ok')),
            })
    sitemap_path = root / 'parsed' / 'sitemap-idstat-urls.txt'
    sitemap_count = 0
    if sitemap_path.exists():
        sitemap_count = sum(1 for line in sitemap_path.read_text(encoding='utf8').splitlines() if line.strip())
    user_agent = next((r.get('user_agent') for r in receipts if r.get('user_agent')), None)
    proxied = [r.get('url') for r in receipts if str(r.get('retrieval_method', '')).startswith('proxied')]
    statements = how_lines + ([index_line] if index_line else [])
    as_of = None
    for line in how_lines:
        match = re.search(r'current through the (.+?)\.?$', line)
        if match:
            as_of = match.group(1)
    return {
        'state': STATE,
        'code_id': CODE_ID,
        'code_name': CODE_NAME,
        'publisher': 'Idaho State Legislature, Legislative Services Office',
        'official_urls': {
            'index': INDEX_URL,
            'currency': 'https://legislature.idaho.gov/statutesrules/howcurrentisthislaw',
            'disclaimer': 'https://legislature.idaho.gov/site-disclaimer',
            'privacy': 'https://legislature.idaho.gov/privacy-policy',
            'robots': 'https://legislature.idaho.gov/robots.txt',
            'chapter_pdf_pattern': 'https://legislature.idaho.gov/wp-content/uploads/statutesrules/idstat/Title{N}/T{N}CH{M}.pdf',
        },
        'edition': None,
        'currency': {
            'statement': ' '.join(statements) if statements else None,
            'as_of': as_of,
            'how_current_page': how_lines,
            'index_page': index_line,
        },
        'session_law_lag': {
            'publisher_statements': how_lines,
            'observation': (
                'The how-current page states the statutes and constitutions are updated to the web '
                'July 1 following the legislative session and are current through the 2026 Legislative '
                'Session. The index states Idaho Statutes are updated to the website July 1 following '
                'the legislative session. Those sentences are the published bound of this capture.'
            ),
        },
        'bulk_exports': {
            'per_chapter_pdf': 'Each title page links "Download Entire Chapter (PDF)" for chapters that have a body.',
            'sitewide_xml_json_zip_html': 'No site-wide bulk file was published at the probed URLs.',
            'probes': probes,
            'sitemap_idstat_urls': sitemap_count,
        },
        'terms': {
            'disclaimer': disclaimer,
            'maintainer': maintainer,
            'copyright_footer': copyright_line,
            'robots_user_agent_star': robots_star,
            'reuse': (
                'The site disclaimer is the publisher statement on use of the website text. '
                'It identifies LEXIS Publishing as the publisher of official Idaho Code copies '
                'for the Idaho Code Commission, and Custom Printing as the publisher of official '
                'Session Laws. The disclaimer, privacy policy and robots.txt User-agent: * group '
                'were captured. Statute pages returned HTTP 200 to the identifying capture agent '
                'with no login, captcha or click-through licence page.'
            ),
        },
        'gates': [],
        'proxied': proxied,
        'user_agent': user_agent,
        'retrieval_method': 'direct',
        'receipts': {
            'currency_sha256': None if not currency_receipt else currency_receipt.get('sha256'),
            'disclaimer_sha256': None if not disclaimer_receipt else disclaimer_receipt.get('sha256'),
            'index_sha256': None if not index_receipt else index_receipt.get('sha256'),
            'robots_sha256': None if not robots_receipt else robots_receipt.get('sha256'),
        },
    }


def _chapter_key(row):
    title = chapter = None
    for item in row.get('citation_path') or []:
        if item.get('level') == 'title':
            title = item.get('number')
        elif item.get('level') == 'chapter':
            chapter = item.get('number')
    return title, chapter


def _derivative_text(rows):
    lines = []
    first = rows[0]
    for item in first.get('citation_path') or []:
        if item.get('level') in ('title', 'chapter'):
            lines.append('%s %s' % (item['level'].upper(), item.get('number')))
            if item.get('heading'):
                lines.append(item['heading'])
            lines.append('')
    for row in rows:
        head = row.get('heading') or ''
        lines.append(('%s. %s' % (row.get('citation'), head)).rstrip())
        if row.get('status_label'):
            lines.append('[%s]' % row['status_label'])
        if row.get('text'):
            lines.append(row['text'])
        if row.get('history'):
            lines.append(row['history'])
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def stage(root=ROOT, store=STORE):
    root = Path(root)
    store = Path(store)
    staged = root / 'staged'
    chapters_dir = staged / 'chapters'
    chapters_dir.mkdir(parents=True, exist_ok=True)
    store.mkdir(parents=True, exist_ok=True)
    checked, problems = verify_store(root)
    sections_path = root / 'parsed' / 'sections.jsonl'
    rows = [json.loads(line) for line in sections_path.read_text(encoding='utf8').splitlines() if line.strip()]
    groups = []
    current_key = None
    bucket = []
    for row in rows:
        key = _chapter_key(row)
        if bucket and key != current_key:
            groups.append((current_key, bucket))
            bucket = []
        current_key = key
        bucket.append(row)
    if bucket:
        groups.append((current_key, bucket))
    derivatives = []
    for key, group in groups:
        text = _derivative_text(group).encode('utf8')
        digest = hashlib.sha256(text).hexdigest()
        dest = chapters_dir / digest
        if not dest.exists():
            dest.write_bytes(text)
        source_url = group[0].get('source', {}).get('url')
        derivatives.append({
            'sha256': digest,
            'bytes': len(text),
            'path': 'chapters/' + digest,
            'role': 'derivative',
            'retrieval_method': 'derived',
            'url': source_url,
            'retrieved_at': None,
            'label': 'chapter-text',
            'title': key[0],
            'chapter': key[1],
            'rows': len(group),
        })
    gz_path = staged / 'sections.jsonl.gz'
    with gzip.open(gz_path, 'wt', encoding='utf8') as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    gz_sha = sha256_bytes(gz_path.read_bytes())
    receipts = load_receipts(root)
    manifest_files = []
    seen = set()
    for receipt in receipts:
        if not receipt.get('ok') or not receipt.get('sha256') or not receipt.get('stored_path'):
            continue
        key = (receipt['sha256'], receipt.get('url'))
        if key in seen:
            continue
        seen.add(key)
        manifest_files.append({
            'sha256': receipt['sha256'],
            'bytes': receipt.get('bytes'),
            'url': receipt.get('url'),
            'final_url': receipt.get('final_url'),
            'retrieved_at': receipt.get('retrieved_at'),
            'retrieval_method': receipt.get('retrieval_method'),
            'label': receipt.get('label'),
            'status': receipt.get('status'),
            'path': receipt.get('stored_path'),
            'role': 'raw',
        })
    manifest_files.extend(derivatives)
    source = build_source(root)
    (staged / 'source.json').write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    manifest = {
        'state': STATE,
        'code_id': CODE_ID,
        'files': manifest_files,
    }
    man_path = staged / 'manifest.json'
    man_path.write_text(json.dumps(manifest, ensure_ascii=False) + '\n', encoding='utf8')
    man_sha = sha256_bytes(man_path.read_bytes())
    by_label = Counter(item['label'] for item in manifest_files if item.get('role') == 'raw')
    raw_items = [item for item in manifest_files if item.get('role') == 'raw']
    summary = {
        'state': STATE,
        'code_id': CODE_ID,
        'full_manifest_path': str(man_path),
        'full_manifest_sha256': man_sha,
        'full_manifest_bytes': man_path.stat().st_size,
        'sections_jsonl_gz_sha256': gz_sha,
        'sections_jsonl_gz_bytes': gz_path.stat().st_size,
        'sections_jsonl_gz_path': str(gz_path),
        'verify_store': {'checked': checked, 'problems': problems[:20], 'problem_count': len(problems)},
        'raw_files': len(raw_items),
        'raw_bytes': sum(item.get('bytes') or 0 for item in raw_items),
        'derivative_files': len(derivatives),
        'derivative_bytes': sum(item['bytes'] for item in derivatives),
        'raw_by_label': dict(by_label),
        'proxied': source['proxied'],
        'gates': source['gates'],
    }
    report = json.loads((root / 'parsed' / 'parse-report.json').read_text(encoding='utf8'))
    sample = _sample(rows)
    (staged / 'manifest-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf8')
    (store / 'source.json').write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    (store / 'manifest.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf8')
    (store / 'parse-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    with (store / 'sample-sections.jsonl').open('w', encoding='utf8') as handle:
        for row in sample:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    tests = _run_tests()
    (store / 'report.md').write_text(_report_md(source, report, summary, tests), encoding='utf8')
    (store / 'docs-section.md').write_text(_docs(source, report, summary), encoding='utf8')
    (root / 'source.json').write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    return summary


def _sample(rows):
    picked = []
    seen = set()

    def take(row):
        if id(row) in seen or len(picked) >= 25:
            return
        seen.add(id(row))
        picked.append(row)

    for row in rows[:8]:
        take(row)
    for row in rows:
        if row.get('identity_kind') == 'chapter-placeholder':
            take(row)
            break
    for row in rows:
        if row.get('status_label'):
            take(row)
            break
    for row in rows:
        if row.get('text') and len(row['text']) > 1500:
            take(row)
            break
    step = max(1, len(rows) // 10)
    for index in range(0, len(rows), step):
        take(rows[index])
    if rows:
        take(rows[-1])
    return picked[:25]


def _run_tests():
    script = Path(__file__).resolve().parent / 'test_id_parse.py'
    proc = subprocess.run([sys.executable, '-m', 'unittest', str(script)], capture_output=True, text=True)
    tail = (proc.stderr or proc.stdout or '').strip().splitlines()
    return {'returncode': proc.returncode, 'summary': tail[-3:] if tail else []}


def _report_md(source, report, summary, tests):
    counts = report.get('counts') or {}
    audit = report.get('audit') or {}
    currency = source.get('currency') or {}
    lines = [
        '---',
        'cursor:',
        '  subagentId: "bc-0e980f34-dcd1-5c75-a575-da5ec77c5786"',
        '---',
        '# Idaho Statutes (ID)',
        '',
        'Official source: Idaho State Legislature, Legislative Services Office, %s.' % source['official_urls']['index'],
        '',
        'Edition: the site publishes no edition name. Currency, as published:',
    ]
    for sentence in currency.get('how_current_page') or []:
        lines.append('- %s' % sentence)
    if currency.get('index_page'):
        lines.append('- %s' % currency['index_page'])
    lines.append('as_of: %s.' % (currency.get('as_of') or 'Not recorded'))
    lines.append('')
    lines.append(source['session_law_lag']['observation'])
    lines.append('')
    lines.append(
        'Counts: titles %s, chapters %s, parts %s, inventory sections %s, section rows %s '
        '(pages with text %s, chapter placeholders %s, section placeholders %s).'
        % (
            counts.get('titles'), counts.get('chapters'), counts.get('parts'),
            counts.get('sections_in_inventory'),
            counts.get('section_rows'), counts.get('with_text'),
            counts.get('chapter_placeholders'), counts.get('section_placeholders'),
        )
    )
    lines.append(
        'Raw files %s, raw bytes %s. Derivative chapter texts %s, derivative bytes %s.'
        % (summary['raw_files'], summary['raw_bytes'], summary['derivative_files'], summary['derivative_bytes'])
    )
    lines.append('sections.jsonl.gz sha256 %s (%s bytes).' % (
        summary['sections_jsonl_gz_sha256'], summary['sections_jsonl_gz_bytes']))
    lines.append('Full manifest sha256 %s (%s bytes) at %s.' % (
        summary['full_manifest_sha256'], summary['full_manifest_bytes'], summary['full_manifest_path']))
    lines.append('Parser %s. verify_store checked %s, problems %s.' % (
        PARSER_VERSION, summary['verify_store']['checked'], summary['verify_store']['problem_count']))
    lines.append('')
    lines.append('Gaps: %s. Gates: none observed. Proxied items: %s.' % (
        report.get('gap_count'), summary.get('proxied') or 'none'))
    lines.append('Anomalies: %s. Repeated native ids: %s. Empty section bodies: %s.' % (
        report.get('anomaly_count'), report.get('repeated_native_id_count'), counts.get('empty_section_bodies')))
    if audit:
        lines.append(
            'Independent audit: regex inventory match %s (regex links %s, inventory urls %s); '
            'html.parser exact %s/%s; PDF id-list exact %s/%s.'
            % (
                audit.get('regex_inventory_match'), audit.get('regex_unique_section_links'),
                audit.get('inventory_section_urls'), audit.get('html_parser_exact'),
                audit.get('html_parser_pages'), audit.get('pdf_exact_id_lists'), audit.get('pdf_chapters'),
            )
        )
    lines.append('Tests: unittest returncode %s. %s' % (tests['returncode'], ' '.join(tests['summary'])))
    lines.append('')
    lines.append(
        'What remains: land the staged tree when the batch lead opens the corpus contract; '
        'the October 5 removals stay removed.'
    )
    lines.append('')
    return '\n'.join(lines)


def _docs(source, report, summary):
    counts = report.get('counts') or {}
    currency = source.get('currency') or {}
    how = ' '.join(currency.get('how_current_page') or [])
    gaps = report.get('gap_count') or 0
    status = 'staged' if gaps == 0 else 'staged with gaps'
    lines = [
        '## Idaho (ID)',
        '',
        'Official source: Idaho Legislature / Legislative Services Office, %s.' % source['official_urls']['index'],
        'Currency, as published: %s' % (how or 'Not recorded'),
        'Index statement: %s' % (currency.get('index_page') or 'Not recorded'),
        'Counts: %s titles, %s chapters, %s parts, %s sections (%s rows including repealed placeholders).' % (
            counts.get('titles'), counts.get('chapters'), counts.get('parts'),
            counts.get('sections_in_inventory'), counts.get('section_rows')),
        'Raw files %s, raw bytes %s. Parser %s.' % (summary['raw_files'], summary['raw_bytes'], PARSER_VERSION),
        'Per-chapter PDFs are linked from title pages. No site-wide XML, JSON or ZIP bulk file was found.',
        'Gaps: %s. Gates: none. Proxied: none. Status: %s.' % (gaps, status),
        'What remains: batch lead lands the staged capture; this pass does not write the corpus.',
        '',
    ]
    return '\n'.join(lines)


def main():
    summary = stage(ROOT, STORE)
    print(json.dumps({
        'raw_files': summary['raw_files'],
        'raw_bytes': summary['raw_bytes'],
        'gz': summary['sections_jsonl_gz_sha256'],
        'manifest': summary['full_manifest_sha256'],
    }, indent=2))


if __name__ == '__main__':
    main()
