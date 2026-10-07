"""Arizona Revised Statutes capture, concurrent (owner instruction 2026-10-07: speed over pacing).

Same sources as az_capture.py (arstitle index -> arsDetail/?title=N -> /ars/<title>/<section>.htm) and the same receipts in /tmp/sc/AZ, so it
resumes from them. Direct fetches at up to AZ_WORKERS (default 5) at once, no inter-request delay. A page the site will not return directly
(after a shared back-off on 403/429/503 and a second direct try) is fetched through Firecrawl and recorded as proxied:firecrawl.
Every receipt keeps its status and sha256. The section list of every title comes from the publisher's own a.stat links, cross-checked
against the raw docName links on the page; a disagreement stops the run.
"""
import concurrent.futures as cf
import json
import os
import re
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from provenance_fetch import Fetcher  # noqa: E402
import az_parse  # noqa: E402
import html as htmllib  # noqa: E402

ROOT = '/tmp/sc/AZ'
WORKERS = int(os.environ.get('AZ_WORKERS', '5'))
F = Fetcher('AZ', ROOT, min_interval=0.0, timeout=60)
SECTION_URL = re.compile(r'/ars/[0-9]+[A-Za-z]?/[0-9A-Za-z.\-]+\.htm$')
_backoff = {'until': 0.0, 'step': 15.0}
_lock = threading.Lock()


def captured_urls():
    done = set()
    for line in open(ROOT + '/receipts.jsonl', encoding='utf8'):
        if line.strip():
            r = json.loads(line)
            if r.get('ok') and r.get('status') == 200 and r.get('retrieval_method') in ('direct', 'proxied:firecrawl'):
                done.add(r['url'])
    return done


def wait_backoff():
    while True:
        with _lock:
            left = _backoff['until'] - time.time()
        if left <= 0:
            return
        time.sleep(min(left, 5))


def fetch(url, label):
    """Direct, with a shared back-off when the site pushes back; Firecrawl only after two direct attempts fail."""
    for attempt in (1, 2):
        wait_backoff()
        r = F.get(url, label=label, force=True)
        if r.get('ok'):
            with _lock:
                _backoff['step'] = max(15.0, _backoff['step'] / 2)
            return r
        if r.get('status') in (403, 429, 503):
            with _lock:
                _backoff['until'] = time.time() + _backoff['step']
                _backoff['step'] = min(300.0, _backoff['step'] * 2)
    return F.proxied(url, label=label)


def main():
    done = captured_urls()
    idx = F.get('https://www.azleg.gov/arstitle/', label='ars-title-index', force=False)
    index_html = F.read(idx).decode('utf8')
    titles = []
    for t in re.findall(r'href="https://www\.azleg\.gov/arsDetail/?\?title=([0-9A-Za-z.\-]+)"', index_html):
        if t not in titles:
            titles.append(t)
    print('titles', len(titles), flush=True)
    detail = {}
    todo = [t for t in titles if 'https://www.azleg.gov/arsDetail/?title=%s' % t not in done]
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for t, r in zip(todo, ex.map(lambda t: fetch('https://www.azleg.gov/arsDetail/?title=%s' % t, 'title-detail:%s' % t), todo)):
            if not r.get('ok'):
                raise SystemExit('title %s listing failed: %s' % (t, r.get('error') or r.get('status')))
    latest = {}
    for line in open(ROOT + '/receipts.jsonl', encoding='utf8'):
        r = json.loads(line)
        if r.get('label', '').startswith('title-detail:') and r.get('ok'):
            latest[r['label'].split(':')[1]] = r
    listing = {}
    for t in titles:
        h = (F.root / latest[t]['stored_path']).read_text(encoding='utf8', errors='replace')
        urls = az_parse.listed_urls(h)
        raw = len(set(re.findall(r'docName=(https://www\.azleg\.gov/ars/[^"&]+\.htm)', htmllib.unescape(h))))
        if raw != len(urls):
            raise SystemExit('title %s: %d docName links but %d section links parsed' % (t, raw, len(urls)))
        listing[t] = urls
    json.dump(listing, open(ROOT + '/listing.json', 'w'))
    work = [(u, t) for t in titles for u in listing[t] if u not in done]
    total = sum(len(v) for v in listing.values())
    print('listed sections', total, 'already retained', total - len(work), 'to fetch', len(work), flush=True)
    failed, n = [], 0
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(fetch, u, 'section:title%s' % t): u for u, t in work}
        for fut in cf.as_completed(futs):
            n += 1
            r = fut.result()
            if not r.get('ok'):
                failed.append(futs[fut])
            if n % 500 == 0:
                print('fetched', n, 'of', len(work), 'failed', len(failed), flush=True)
    print('pass done; failed', len(failed), flush=True)
    for u in failed:
        t = re.search(r'/ars/([0-9]+[A-Za-z]?)/', u).group(1)
        r = fetch(u, 'section:title%s' % t)
        print('retry', u, r.get('ok'), r.get('status'), flush=True)
    print('done', flush=True)


if __name__ == '__main__':
    main()
