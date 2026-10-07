"""20-section live diff for Pennsylvania against fresh Firecrawl copies of the official palegis.us title documents.

The shared reviewer fetches live pages directly, which palegis.us does not answer from this environment (no TLS reply). This runs the same
check (section number, heading and full text present, whitespace- and quote-insensitive) against a Firecrawl copy fetched now into
PA_ROOT, and reports the sample. It never calls a review function.

    PA_ROOT=/tmp/sc/PA3 python3 live_diff.py --landing /tmp/rv/PA/landing --report <file.md> [--n 20] [--seed 20261006]
"""
import argparse
import json
import os
import pathlib
import random
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0] / 'common'))
sys.path.insert(0, str(HERE.parents[0]))
sys.path.insert(0, str(HERE))
from provenance_fetch import Fetcher  # noqa: E402
import acquire  # noqa: E402  (imported before the reviewer, which puts another acquire.py first on the path)
import review_publisher_code_v2 as R  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--landing', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--n', type=int, default=20)
    ap.add_argument('--seed', type=int, default=20261006)
    a = ap.parse_args()
    units = {u['unit_key']: u for u in map(json.loads, open(os.path.join(a.landing, 'units.jsonl'), encoding='utf-8'))}
    secs = [json.loads(x) for x in open(os.path.join(a.landing, 'sections.jsonl'), encoding='utf-8')]
    sample = random.Random(a.seed).sample(secs, min(a.n, len(secs)))
    fetcher = Fetcher('PA', acquire.ROOT)
    fresh = acquire.latest_good(fetcher)
    rows = []
    for s in sample:
        u = units[s['unit_key']]
        url = u['source_url']
        rec = fresh.get(url)
        if rec is None:
            rec = fetcher.proxied(url, label='live-diff')
        row = {'citation_path': s['citation_path'], 'url': url, 'retrieved_at': rec.get('retrieved_at'), 'route': rec.get('retrieval_method')}
        if not rec.get('ok'):
            row.update(ok=False, why='fetch failed')
        else:
            live = R.squash(R.live_text(fetcher.read(rec), url))
            number = s['hierarchy'][-1].get('number') or ''
            row['citation_ok'] = bool(number) and R.squash(number) in live
            row['heading_ok'] = (not s.get('heading')) or R.squash(s['heading']) in live
            row['text_ok'] = R.squash(s['text']) in live
            row['live_sha256'] = rec['sha256']
            row['ok'] = row['citation_ok'] and row['heading_ok'] and row['text_ok']
        rows.append(row)
    ok = sum(1 for r in rows if r['ok'])
    lines = ['## Pennsylvania live diff (fresh Firecrawl copies, no review call)', '',
             '- Sampled %d of %d landed sections (seed %d); %d of %d match the fresh copy of the official title document.' % (len(rows), len(secs), a.seed, ok, len(rows)),
             '- Route: %s. Checks: section number present, heading present, full text present (whitespace-insensitive, quote-normalised).' % sorted({r['route'] for r in rows}),
             '', '| citation_path | fetched | citation | heading | text |', '|---|---|---|---|---|']
    for r in rows:
        lines.append('| %s | %s | %s | %s | %s |' % (r['citation_path'], r['retrieved_at'], r.get('citation_ok'), r.get('heading_ok'), r.get('text_ok')))
    with open(a.report, 'a', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n\n')
    print(json.dumps({'sampled': len(rows), 'live_ok': ok, 'failures': [r['citation_path'] for r in rows if not r['ok']]}))


if __name__ == '__main__':
    main()
