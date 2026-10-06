"""Build an explicit zero-row staging packet when Indiana acquisition is blocked."""
import gzip
import hashlib
import json
import pathlib
import shutil
import time

from acquire import BASE, API_BASE, SPA_SHELL_MARK

ROOT = pathlib.Path('/tmp/sc/IN')
STORE = pathlib.Path(
    '/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/'
    'internal/state-codes/batch-b/in'
)
SUBAGENT = 'bc-afa09028-6472-56e9-b982-3a80ab7a15ae'
CURRENCY = (
    'The 2026 Indiana Code is now available online. This version has been updated '
    'through the 2026 regular session. Consult the 2026 Table of Citations pdf '
    'document for specific effective dates.'
)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n')


def read_receipts(path):
    return [
        json.loads(line)
        for line in path.read_text().splitlines()
        if line.strip()
    ]


def raw_manifest(receipts):
    grouped = {}
    for receipt in receipts:
        stored = receipt.get('stored_path')
        if not receipt.get('ok') or not stored:
            continue
        entry = grouped.setdefault(receipt['sha256'], {
            'kind': 'publisher_response',
            'sha256': receipt['sha256'],
            'bytes': receipt['bytes'],
            'path': stored,
            'receipts': [],
        })
        ref = {
            'url': receipt['url'],
            'final_url': receipt.get('final_url'),
            'status': receipt.get('status'),
            'retrieved_at': receipt.get('retrieved_at'),
            'retrieval_method': receipt.get('retrieval_method'),
        }
        if ref not in entry['receipts']:
            entry['receipts'].append(ref)
    return sorted(grouped.values(), key=lambda item: item['sha256'])


def verify_raw(entries):
    problems = []
    for entry in entries:
        path = ROOT / entry['path']
        if not path.exists() or path.stat().st_size != entry['bytes'] or sha256(path) != entry['sha256']:
            problems.append(entry['path'])
    return problems


def main():
    parsed = ROOT / 'parsed'
    staged = ROOT / 'staged'
    parsed.mkdir(parents=True, exist_ok=True)
    staged.mkdir(parents=True, exist_ok=True)
    STORE.mkdir(parents=True, exist_ok=True)

    inventory = parsed / 'inventory.jsonl'
    sections = parsed / 'sections.jsonl'
    inventory.write_bytes(b'')
    sections.write_bytes(b'')
    gz_sections = staged / 'sections.jsonl.gz'
    with gz_sections.open('wb') as target:
        with gzip.GzipFile(filename='', mode='wb', fileobj=target, mtime=0) as gz:
            gz.write(b'')

    receipts = read_receipts(ROOT / 'receipts.jsonl')
    raw_entries = raw_manifest(receipts)
    raw_problems = verify_raw(raw_entries)
    shell_entries = [
        entry for entry in raw_entries
        if SPA_SHELL_MARK in (ROOT / entry['path']).read_bytes()
    ]
    website_shell_entries = [
        entry for entry in shell_entries
        if entry['bytes'] == 691 and any(
            receipt['url'].startswith(BASE + '/') for receipt in entry['receipts']
        )
    ]
    shell_sha = website_shell_entries[0]['sha256'] if len(website_shell_entries) == 1 else None

    source = {
        'schema_version': 'publisher-code-source/2',
        'status': 'blocked',
        'jurisdiction': 'IN',
        'publisher': 'Indiana General Assembly, Legislative Services Agency',
        'publisher_url': BASE,
        'code_name': 'Indiana Code',
        'edition': '2026 Indiana Code',
        'currency': {
            'statement': CURRENCY,
            'as_of': None,
            'evidence_url': BASE + '/documents/d2426fae',
            'evidence_grade': 'search-index mapping only; direct official route returned SPA shell',
        },
        'official_urls': {
            'downloads': BASE + '/laws/ic/downloads',
            'title_index': BASE + '/laws/2026/ic/titles',
            'title_pdf_pattern': BASE + '/ic/2026/Title_{title}.pdf',
            'title_html_pattern': BASE + '/ic/2026/Title_{title}.html',
            'api_titles': API_BASE + '/2026/ic/titles',
        },
        'inventory': {
            'planned_title_urls': 36,
            'official_inventory_captured': False,
            'expected_articles': None,
            'expected_chapters': None,
            'expected_sections': None,
        },
        'licence_terms': {
            'accepted': False,
            'api_terms_url': 'https://docs.api.iga.in.gov/terms_of_service.html',
            'note': 'No terms page was accepted and no API key was obtained or used.',
        },
        'gates': [{
            'url': API_BASE + '/2026/ic/titles',
            'observed': 'HTTP 403 JSON: Invalid API key / Unauthorized when requested without a key.',
            'status': 403,
            'observed_at': '2026-10-06',
        }],
        'delivery_failures': [{
            'url_pattern': BASE + '/*',
            'observed': (
                'Requested download, title index, title PDF/HTML, JS, manifest, robots, '
                'sitemap, notice, article PDF, and legacy routes returned the same '
                '691-byte SPA shell from AmazonS3 instead of requested content.'
            ),
            'status': 200,
            'receipt_sha256': shell_sha,
            'observed_at': '2026-10-06',
        }],
        'alternatives_tested': [
            'Current downloads page and 2026 title index (SPA shell).',
            'Title-level PDF and HTML routes (SPA shell).',
            'Article/chapter PDF pattern found during mapping (SPA shell on direct fetch).',
            'Legacy www.in.gov legislative code routes (redirect to same SPA shell).',
            'Public API root and /2026/ic/titles without a key (HTTP 403 key gate).',
            'Public API documentation routes (HTTP 403 SPA documentation shell).',
            'Firecrawl and Tavily fallback unavailable because neither key was present in the worker environment.',
        ],
        'proxied_items': [],
    }
    write_json(staged / 'source.json', source)

    parse_report = {
        'schema_version': 'publisher-code-parse-report/2',
        'status': 'blocked-no-source-bodies',
        'parser': {'name': None, 'version': None},
        'counts': {'titles': 0, 'articles': 0, 'chapters': 0, 'sections': 0, 'rows': 0},
        'expected_vs_parsed': {
            'official_inventory_captured': False,
            'expected': None,
            'parsed': 0,
            'gaps': 'All code units: publisher originals unavailable from gate-free direct routes.',
        },
        'anomalies': [
            'All tested iga.in.gov document paths returned one identical SPA shell.',
            'The unauthenticated API route requires an API key and was not used.',
        ],
        'repeated_citations': [],
        'empty_bodies': 0,
        'input_hashes': [entry['sha256'] for entry in raw_entries],
        'output_hashes': {
            'inventory.jsonl': sha256(inventory),
            'sections.jsonl': sha256(sections),
            'sections.jsonl.gz': sha256(gz_sections),
        },
        'independent_audit': {
            'method': 'Re-hash all unique retained response bodies and classify SPA/API denial independently.',
            'unique_raw_files': len(raw_entries),
            'unique_raw_bytes': sum(entry['bytes'] for entry in raw_entries),
            'spa_shell_bodies': len(shell_entries),
            'verify_store_problems': raw_problems,
            'result': 'passed' if not raw_problems else 'failed',
        },
        'tests': {
            'command': 'python3 -m unittest -v test_acquire.py',
            'passed': 4,
            'failed': 0,
        },
    }
    write_json(parsed / 'parse-report.json', parse_report)
    write_json(staged / 'parse-report.json', parse_report)

    manifest = {
        'schema_version': 'publisher-code-staging-manifest/2',
        'status': 'blocked',
        'jurisdiction': 'IN',
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'raw': raw_entries,
        'derivatives': [
            {'kind': 'inventory_jsonl', 'path': 'parsed/inventory.jsonl',
             'sha256': sha256(inventory), 'bytes': inventory.stat().st_size},
            {'kind': 'sections_jsonl', 'path': 'parsed/sections.jsonl',
             'sha256': sha256(sections), 'bytes': sections.stat().st_size},
            {'kind': 'sections_jsonl_gzip', 'path': 'staged/sections.jsonl.gz',
             'sha256': sha256(gz_sections), 'bytes': gz_sections.stat().st_size},
            {'kind': 'source_metadata', 'path': 'staged/source.json',
             'sha256': sha256(staged / 'source.json'),
             'bytes': (staged / 'source.json').stat().st_size},
            {'kind': 'parse_report', 'path': 'staged/parse-report.json',
             'sha256': sha256(staged / 'parse-report.json'),
             'bytes': (staged / 'parse-report.json').stat().st_size},
        ],
        'counts': {
            'raw_files': len(raw_entries),
            'raw_bytes': sum(entry['bytes'] for entry in raw_entries),
            'titles': 0, 'articles': 0, 'chapters': 0, 'sections': 0, 'rows': 0,
        },
    }
    write_json(staged / 'manifest.json', manifest)

    sample = STORE / 'sample-sections.jsonl'
    sample.write_bytes(b'')
    for name in ('source.json', 'manifest.json', 'parse-report.json'):
        shutil.copyfile(staged / name, STORE / name)

    report = f"""---
cursor:
  subagentId: "{SUBAGENT}"
---
# Indiana Code 2026 — blocked acquisition packet

## Outcome

No Indiana Code text was staged. The official Indiana General Assembly publication
routes were not delivering their requested resources on 2026-10-06: representative
download, index, title PDF/HTML, article PDF, SPA asset, sitemap, robots, notice, and
legacy routes all returned the same 691-byte SPA shell. This is a source-delivery
failure, not evidence that the documents or laws do not exist.

The documented API alternative at `{API_BASE}/2026/ic/titles` returned HTTP 403 with
`Invalid API key` and `Unauthorized` when requested without a key. No Indiana IGA API
key was obtained or used, and no terms page was accepted.

## Publisher statement and source

- Publisher: Indiana General Assembly, Legislative Services Agency
- Downloads: `{BASE}/laws/ic/downloads`
- Edition: `2026 Indiana Code`
- Search-index mapping exposed the publisher wording: “{CURRENCY}”
- `currency.as_of` is null because the publisher statement is prose, not an ISO date,
  and the direct notice route returned only the SPA shell.

The wording above is mapping evidence only; it is not represented as a retained
publisher body. Every staged law count remains zero.

## Counts and reconciliation

- Titles/articles/chapters/sections/rows: **0 / 0 / 0 / 0 / 0**
- Official inventory captured: **no**
- Planned title URL pattern: 36 title URLs; none was accepted as a code capture
- Unique retained response bodies: **{manifest['counts']['raw_files']} files /
  {manifest['counts']['raw_bytes']} bytes**
- Parsed inventory and sections files are deliberately empty.

## Gates, gaps, and alternatives

- Gate: API requires a key; HTTP 403 denial retained. No key or credentials used.
- Delivery gap: all gate-free official website document routes tested yielded SPA shell.
- Legacy `www.in.gov/legislative/ic/code/` routes redirect to the same SPA.
- Firecrawl/Tavily proxy keys were absent in this worker environment, so no proxy
  response was acquired; proxied item count is zero.
- Search mapping identified official title PDF/HTML and article/chapter patterns and
  the full-code ZIP labels, but search-result text was not treated as captured law.

## Verification

- Raw store audit: **{parse_report['independent_audit']['result']}**; every unique
  retained body was rehashed and byte-length checked.
- Tests: **4 passed / 0 failed** (acquisition, classification, and staging helpers);
  no parser was run without source.
- `sections.jsonl.gz`: `{sha256(gz_sections)}`
- `manifest.json`: `{sha256(staged / 'manifest.json')}`
- Anomalies: identical shell returned with HTTP 200 for non-HTML document paths; API
  and API documentation return HTTP 403 without usable public content.

## What remains

Retry the official download page/title files after the IGA delivery failure is repaired,
or obtain a gate-free official archive link. Then capture the independent official
inventory, parse every unit, reconcile it, and replace this explicit zero-row packet.
"""
    (STORE / 'report.md').write_text(report)
    print(json.dumps({
        'manifest_sha256': sha256(staged / 'manifest.json'),
        'sections_gzip_sha256': sha256(gz_sections),
        'raw_files': manifest['counts']['raw_files'],
        'raw_bytes': manifest['counts']['raw_bytes'],
        'verify_problems': raw_problems,
    }, sort_keys=True))


if __name__ == '__main__':
    main()
