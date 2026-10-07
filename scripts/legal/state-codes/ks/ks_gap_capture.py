#!/usr/bin/env python3
"""Fetch Revisor section HTML for inventory URLs not in the landed 5,821 packet.

Resumable via KsFetcher receipts. Does not parse, land, or publish.
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path('/tmp/sc/KS')
JOBS_PATH = ROOT / 'parsed' / 'gap-section-jobs.jsonl'
STATUS_PATH = ROOT / 'parsed' / 'gap-capture-status.json'

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ks_common import KsFetcher  # noqa: E402


def landed_urls():
    units = {u['unit_key']: u for u in map(json.loads, open(ROOT / 'landing' / 'units.jsonl', encoding='utf-8'))}
    urls = set()
    for line in open(ROOT / 'landing' / 'sections.jsonl', encoding='utf-8'):
        if not line.strip():
            continue
        s = json.loads(line)
        urls.add(units[s['unit_key']]['source_url'])
    return urls


def build_jobs():
    have = landed_urls()
    jobs = []
    for line in open(ROOT / 'parsed' / 'inventory.jsonl', encoding='utf-8'):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get('kind') != 'section':
            continue
        url = row.get('url')
        if not url or url in have:
            continue
        jobs.append(row)
    JOBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with JOBS_PATH.open('w', encoding='utf-8') as handle:
        for job in jobs:
            handle.write(json.dumps(job, ensure_ascii=False) + '\n')
    return jobs


def receipt_urls(fetcher):
    urls = set()
    for rec in fetcher.receipts():
        if rec.get('ok') and rec.get('url'):
            urls.add(rec['url'])
    return urls


def write_status(**fields):
    data = {}
    if STATUS_PATH.exists():
        data = json.loads(STATUS_PATH.read_text(encoding='utf-8'))
    data.update(fields)
    data['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    STATUS_PATH.write_text(json.dumps(data, indent=2), encoding='utf-8')


def main():
    jobs = build_jobs()
    fetcher = KsFetcher()
    job_urls = {j['url'] for j in jobs}
    before = {u for u in receipt_urls(fetcher) if u in job_urls}
    write_status(
        phase='gap-section-capture',
        gap_jobs=len(jobs),
        retained_before_start=len(before),
        landed_public_sections=5821,
        inventory_section_rows=47608,
    )
    print('gap jobs', len(jobs), 'already retained', len(before), flush=True)
    streak = failures = fetched = 0
    for i, job in enumerate(jobs):
        url = job['url']
        if url in before:
            continue
        label = 'revisor-section-gap:' + (job.get('native_id') or str(i))
        receipt = fetcher.get(url, label=label)
        if receipt.get('ok'):
            streak = 0
            fetched += 1
            before.add(url)
        else:
            failures += 1
            if receipt.get('status') in (403, 429) or receipt.get('error'):
                streak += 1
            else:
                streak = 0
            if streak >= 8:
                write_status(status='stopped_block', failures=failures, new_retained=fetched,
                             retained_total=len(before))
                print('STOP persistent block', flush=True)
                sys.exit(2)
        if i and i % 200 == 0:
            write_status(status='running', progress_index=i, failures=failures,
                         new_retained=fetched, retained_total=len(before))
            print('progress', i, 'of', len(jobs), 'new', fetched, 'total', len(before), flush=True)
    write_status(status='completed', failures=failures, new_retained=fetched, retained_total=len(before))
    print('done new', fetched, 'total gap retained', len(before), 'failures', failures, flush=True)


if __name__ == '__main__':
    main()
