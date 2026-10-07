#!/usr/bin/env python3
"""Fetch Revisor section HTML for inventory URLs not in the landed 5,821 packet.

Resumable via KsFetcher receipts. Does not parse, land, or publish.
"""
import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path('/tmp/sc/KS')
JOBS_PATH = ROOT / 'parsed' / 'gap-section-jobs.jsonl'
STATUS_PATH = ROOT / 'parsed' / 'gap-capture-status.json'

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ks_common  # noqa: E402
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


def fetch_job(fetcher, job, index, done, lock, use_firecrawl):
    url = job['url']
    with lock:
        if url in done:
            return 'skip', url
    label = 'revisor-section-gap:' + (job.get('native_id') or str(index))
    receipt = fetcher.get(url, label=label)
    if not receipt.get('ok') and use_firecrawl:
        receipt = fetcher.proxied(url, service='firecrawl', label=label + ':firecrawl')
    with lock:
        if receipt.get('ok'):
            done.add(url)
            return 'ok', url
        return 'fail', url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--host-interval', type=float, default=0.2,
                    help='seconds between request starts per host (default 0.2 with workers=5)')
    ap.add_argument('--firecrawl-fallback', action='store_true', default=True)
    args = ap.parse_args()
    ks_common.HOST_INTERVALS['www.ksrevisor.gov'] = args.host_interval
    ks_common.HOST_INTERVALS['ksrevisor.gov'] = args.host_interval

    jobs = build_jobs()
    fetcher = KsFetcher(min_interval=args.host_interval)
    job_urls = {j['url'] for j in jobs}
    done = {u for u in receipt_urls(fetcher) if u in job_urls}
    use_fc = args.firecrawl_fallback and bool(os.environ.get('FIRECRAWL_API_KEY'))
    write_status(
        phase='gap-section-capture',
        gap_jobs=len(jobs),
        retained_before_start=len(done),
        landed_public_sections=5821,
        inventory_section_rows=47608,
        workers=args.workers,
        host_interval=args.host_interval,
        firecrawl_fallback=use_fc,
    )
    print('gap jobs', len(jobs), 'already retained', len(done), 'workers', args.workers, flush=True)
    lock = threading.Lock()
    failures = fetched = 0
    pending = [(i, j) for i, j in enumerate(jobs) if j['url'] not in done]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_job, fetcher, job, i, done, lock, use_fc): (i, job) for i, job in pending}
        for n, fut in enumerate(as_completed(futures), 1):
            kind, url = fut.result()
            if kind == 'ok':
                fetched += 1
            elif kind == 'fail':
                failures += 1
            if n % 200 == 0:
                write_status(status='running', completed_jobs=n, failures=failures,
                             new_retained=fetched, retained_total=len(done))
                print('progress', n, 'of', len(pending), 'new', fetched, 'total', len(done), flush=True)
    write_status(status='completed', failures=failures, new_retained=fetched, retained_total=len(done))
    print('done new', fetched, 'total gap retained', len(done), 'failures', failures, flush=True)


if __name__ == '__main__':
    main()
