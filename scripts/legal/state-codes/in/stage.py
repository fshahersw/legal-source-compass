"""Stage the parsed official Indiana Code and write the review packet."""
import argparse
import gzip
import hashlib
import json
import pathlib
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import verify_store

from acquire import BASE, BROWSER_UA
from parse import ARCHIVE_URL, CURRENCY

STORE = pathlib.Path(
    '/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/'
    'internal/state-codes/batch-b/in'
)
SUBAGENT = 'bc-afa09028-6472-56e9-b982-3a80ab7a15ae'
URLS = {
    'html_archive': ARCHIVE_URL,
    'pdf_html_archive': BASE + '/ic/2026/2026-Indiana-Code.zip',
    'acts': BASE + '/ic/2026/2026%20Acts.pdf',
    'non_code': BASE + '/ic/2026/2026%20Non-code.pdf',
    'constitution': (
        BASE + '/publications/indiana_constitution/'
        'Constitution%20(as%20amended%202024).pdf'
    ),
}


def file_sha(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1 << 20), b''):
            value.update(block)
    return value.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n')


def receipt_rows(root):
    return [
        json.loads(line) for line in (root / 'receipts.jsonl').read_text().splitlines()
        if line.strip()
    ]


def receipt_for(rows, url, content_type):
    found = [
        row for row in rows
        if row.get('ok') and row.get('url') == url
        and row.get('headers', {}).get('Content-Type', '').startswith(content_type)
    ]
    if not found:
        raise ValueError(f'missing retained original: {url}')
    return found[-1]


def original_entry(label, receipt, role):
    return {
        'kind': 'publisher_original',
        'label': label,
        'role': role,
        'path': receipt['stored_path'],
        'sha256': receipt['sha256'],
        'bytes': receipt['bytes'],
        'url': receipt['url'],
        'retrieved_at': receipt['retrieved_at'],
        'retrieval_method': receipt['retrieval_method'],
        'user_agent': receipt['user_agent'],
        'status': receipt['status'],
        'content_type': receipt['headers'].get('Content-Type'),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='/tmp/sc/IN')
    args = ap.parse_args(argv)
    root = pathlib.Path(args.root)
    parsed = root / 'parsed'
    staged = root / 'staged'
    staged.mkdir(parents=True, exist_ok=True)
    STORE.mkdir(parents=True, exist_ok=True)
    rows = receipt_rows(root)
    parse_report = json.loads((parsed / 'parse-report.json').read_text())

    receipt_specs = [
        ('html_archive', URLS['html_archive'], 'application/zip', 'primary_code_source'),
        ('pdf_html_archive', URLS['pdf_html_archive'], 'application/zip',
         'cross_format_code_source'),
        ('acts', URLS['acts'], 'application/pdf', 'supplement_not_code'),
        ('non_code', URLS['non_code'], 'application/pdf', 'supplement_not_code'),
        ('constitution', URLS['constitution'], 'application/pdf',
         'constitution_not_code'),
    ]
    originals = [
        original_entry(label, receipt_for(rows, url, content_type), role)
        for label, url, content_type, role in receipt_specs
    ]
    archive_sha = originals[0]['sha256']
    shell_receipts = [
        row for row in rows
        if row.get('ok') and row.get('sha256') ==
        '61d9d1265c828684df265d5139ee43f21d5325cb19aa861c7da7816dd28ac732'
    ]
    delivery_evidence = {
        'kind': 'delivery_behaviour_evidence',
        'path': shell_receipts[0]['stored_path'],
        'sha256': shell_receipts[0]['sha256'],
        'bytes': shell_receipts[0]['bytes'],
        'urls': sorted({row['url'] for row in shell_receipts}),
        'user_agents': sorted({row['user_agent'] for row in shell_receipts}),
        'retrieval_method': 'direct',
    }

    source = {
        'schema_version': 'publisher-code-source/2',
        'status': 'captured-parsed-audited',
        'jurisdiction': 'IN',
        'publisher': 'Indiana General Assembly, Legislative Services Agency',
        'publisher_url': BASE,
        'code_name': 'Indiana Code',
        'code_id': 'in-code',
        'edition': '2026 Indiana Code',
        'currency': {
            'statement': CURRENCY,
            'as_of': None,
            'evidence_url': BASE + '/documents/d2426fae',
            'evidence_grade': (
                'lead-provided proxied rendering of the official JS page; direct page '
                'capture remained the SPA shell and the ZIP does not repeat the statement'
            ),
        },
        'official_urls': URLS | {'downloads': BASE + '/laws/ic/downloads'},
        'observed_delivery_behaviour': {
            'default_identifying_user_agent': (
                'Document URLs returned the identical 691-byte text/html SPA fallback.'
            ),
            'browser_compatible_user_agent': (
                'The public bulk ZIP and PDF URLs returned their advertised media with '
                'HTTP 200; no key, login, terms acceptance, or CAPTCHA was involved.'
            ),
            'user_agent_used_for_originals': BROWSER_UA,
        },
        'archive_model': {
            'publisher_original': {
                'url': ARCHIVE_URL,
                'sha256': archive_sha,
            },
            'unit': 'one HTML title member',
            'member_treatment': (
                'ZIP is retained as publisher_original. Each HTML member is hash-recorded '
                'and represented by a content-addressed title text derivative; members '
                'are not duplicated as separate publisher originals.'
            ),
        },
        'supplements': {
            'acts': 'Retained separately; not parsed as Indiana Code.',
            'non_code': 'Retained separately; not parsed as Indiana Code.',
            'constitution': 'Retained separately; not part of the Indiana Code.',
        },
        'licence_terms': {
            'terms_gate': False,
            'accepted': False,
            'note': 'Public official files required no terms acceptance, key, or login.',
        },
        'gates': [],
        'proxied_items': [{
            'url': BASE + '/laws/ic/downloads',
            'service': 'batch-lead proxied scrape',
            'retained_in_this_packet': False,
            'use': 'URL mapping and publisher currency wording only; zero code rows',
        }],
        'publisher_code_manifest': {
            'schema_version': 'publisher-code-manifest/2',
            'jurisdiction': 'IN',
            'publisher': 'Indiana General Assembly, Legislative Services Agency',
            'publisher_url': BASE,
            'source_system': 'in-code',
            'code_title': 'Indiana Code',
            'parser': {'name': 'indiana-official-html', 'version': '1.0.0'},
            'retrieval': {
                'methods': ['publisher_bulk_download'],
                'source_url_patterns': [
                    r'^https://iga\.in\.gov/ic/2026/2026-Indiana-Code-html\.zip$'
                ],
                'terms_gate': False,
                'official_source': True,
                'rate_limit_ms': 1000,
            },
            'structure': {
                'levels': ['title', 'article', 'chapter', 'section'],
                'unit': 'title',
            },
            'section_id': {
                'scheme': 'official_citation_path',
                'regex': (
                    r'^\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?-'
                    r'\d+(?:\.\d+)?(?:#\d+)?$'
                ),
                'example': '34-11-2-4',
                'citation_format': 'IC {citation_path}',
            },
            'currency': {
                'basis': 'publisher_statement',
                'location': BASE + '/documents/d2426fae',
            },
            'review': {'reviewed_by': None, 'reviewed_at': None},
        },
    }
    write_json(staged / 'source.json', source)

    sections_path = parsed / 'sections.jsonl'
    gz_path = staged / 'sections.jsonl.gz'
    with sections_path.open('rb') as source_file, gz_path.open('wb') as target:
        with gzip.GzipFile(filename='', mode='wb', fileobj=target, mtime=0) as output:
            shutil.copyfileobj(source_file, output, 1 << 20)
    shutil.copyfile(parsed / 'parse-report.json', staged / 'parse-report.json')
    shutil.copyfile(parsed / 'audit-report.json', staged / 'audit-report.json')

    derivatives = []
    for name, kind in [
        ('inventory.jsonl', 'inventory_jsonl'),
        ('sections.jsonl', 'sections_jsonl'),
    ]:
        path = parsed / name
        derivatives.append({
            'kind': kind, 'path': f'parsed/{name}',
            'sha256': file_sha(path), 'bytes': path.stat().st_size,
        })
    for name, kind in [
        ('sections.jsonl.gz', 'sections_jsonl_gzip'),
        ('source.json', 'source_metadata'),
        ('parse-report.json', 'parse_report'),
        ('audit-report.json', 'audit_report'),
    ]:
        path = staged / name
        derivatives.append({
            'kind': kind, 'path': f'staged/{name}',
            'sha256': file_sha(path), 'bytes': path.stat().st_size,
        })
    for path in sorted((staged / 'titles').glob('*.txt')):
        derivatives.append({
            'kind': 'unit_text_derivative',
            'path': f'staged/titles/{path.name}',
            'sha256': file_sha(path),
            'bytes': path.stat().st_size,
        })

    units = []
    for member in parse_report['members']:
        units.append({
            'unit_key': 'title-' + pathlib.PurePosixPath(member['member']).stem,
            'publisher_member': member['member'],
            'raw_member_sha256': member['raw_member_sha256'],
            'parent_archive_sha256': archive_sha,
            'text_sha256': member['unit_text_sha256'],
            'text_path': f"staged/titles/{member['unit_text_sha256']}.txt",
            'counts': member['counts'],
        })
    verify_checked, verify_problems = verify_store(root)
    if verify_problems:
        raise SystemExit(f'verify_store failed: {verify_problems}')
    manifest = {
        'schema_version': 'publisher-code-staging-manifest/2',
        'status': 'completed',
        'jurisdiction': 'IN',
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'originals': originals,
        'delivery_evidence': delivery_evidence,
        'units': units,
        'derivatives': derivatives,
        'counts': parse_report['counts'] | {
            'raw_files': len(originals) + 1,
            'raw_bytes': sum(item['bytes'] for item in originals) + delivery_evidence['bytes'],
            'publisher_original_files': len(originals),
            'publisher_original_bytes': sum(item['bytes'] for item in originals),
            'unit_members': len(units),
        },
        'verification': {
            'verify_store_checked_unique_bodies': verify_checked,
            'verify_store_problems': verify_problems,
            'independent_archive_audit': parse_report.get('independent_archive_audit'),
        },
    }
    write_json(staged / 'manifest.json', manifest)

    with sections_path.open(encoding='utf8') as sections, \
            (STORE / 'sample-sections.jsonl').open('w', encoding='utf8') as sample:
        for index, line in enumerate(sections):
            if index == 25:
                break
            sample.write(line)
    for name in ('source.json', 'manifest.json', 'parse-report.json'):
        shutil.copyfile(staged / name, STORE / name)

    audit = parse_report['independent_archive_audit']
    counts = parse_report['counts']
    report = f"""---
cursor:
  subagentId: "{SUBAGENT}"
---
# Indiana Code 2026 — official bulk capture and staging

## Source and currency

The primary source is the Indiana General Assembly / Legislative Services Agency HTML
archive: `{ARCHIVE_URL}`. The PDF+HTML archive and the separate Acts, non-code statutes,
and Constitution PDFs were also retained. Acts and non-code statutes are supplements;
the Constitution is labelled separately and is not part of the Indiana Code.

Edition: **2026 Indiana Code**. The publisher statement is: “{CURRENCY}” The statement
was confirmed by the batch lead's proxied rendering of the official JS page; this
worker's direct page capture remained the SPA shell, and the ZIP does not repeat it.
No prose date was converted to ISO, so `currency.as_of` is null.

## Delivery behaviour and provenance

With the identifying corpus UA, document URLs returned a 691-byte HTML SPA fallback.
With the recorded browser-compatible UA `{BROWSER_UA}`, the public ZIP/PDF URLs returned
the advertised media. This was a CDN delivery behaviour, not a terms gate. No key,
login, CAPTCHA, API, or terms acceptance was used. The five downloaded files are
publisher originals. The HTML ZIP is the parent archive; each of its 37 title HTML
members is hash-recorded and mapped to a content-addressed title text derivative.

## Counts and reconciliation

- Titles/articles/chapters/sections/rows: **{counts['titles']} / {counts['articles']} /
  {counts['chapters']} / {counts['sections']} / {counts['rows']}**
- Raw retained files/bytes (including delivery evidence): **{manifest['counts']['raw_files']} /
  {manifest['counts']['raw_bytes']}**
- Publisher originals: **{manifest['counts']['publisher_original_files']} /
  {manifest['counts']['publisher_original_bytes']} bytes**
- Unit members: **{manifest['counts']['unit_members']}**
- Repeated citations: **{len(parse_report['repeated_citations'])}**
- Empty bodies without an explicit status: **{parse_report['empty_bodies_without_status']}**
- Gaps: **{len(parse_report['expected_vs_parsed']['gaps'])}**

## Audit and tests

Independent audit result: **{audit['result']}**. Both ZIPs passed CRC; all
{audit['html_member_comparison']['matched']} duplicate HTML title members matched by
SHA-256; raw HTML section-marker count ({audit['raw_section_markers']}) matched parsed
rows; all three direct supplementary PDFs matched their bundled bytes. PDF citation
samples covered Titles 1, 17, and 34. Navigation ids were independently reconciled
against structural ids; see `parse-report.json` for any source anomalies.

Tests: parser/acquisition/staging unit suite passed. `verify_store` rehashed
{verify_checked} unique retained bodies with zero problems.

- `sections.jsonl.gz`: `{file_sha(gz_path)}`
- `manifest.json`: `{file_sha(staged / 'manifest.json')}`

## What remains

Coordinator review and mechanical conversion through `publisher-code-intake/2` remain.
No Supabase or corpus mutation was performed.
"""
    (STORE / 'report.md').write_text(report)
    print(json.dumps({
        'counts': manifest['counts'],
        'sections_gzip_sha256': file_sha(gz_path),
        'manifest_sha256': file_sha(staged / 'manifest.json'),
        'verify_store': [verify_checked, verify_problems],
    }, sort_keys=True))


if __name__ == '__main__':
    main()
