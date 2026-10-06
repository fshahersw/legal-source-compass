#!/usr/bin/env python3
"""Live review for Indiana Code landed from the official HTML ZIP archive."""
import argparse
import io
import json
import os
import random
import re
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'b4'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ecfr-text'))
import sc_common as sc  # noqa: E402

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('in_acquire', os.path.join(HERE, 'acquire.py'))
_in_acquire = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_in_acquire)
_spec2 = importlib.util.spec_from_file_location('in_parse', os.path.join(HERE, 'parse.py'))
_in_parse = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(_in_parse)
ARCHIVE_URL = _in_parse.ARCHIVE_URL
BROWSER_UA = _in_acquire.BROWSER_UA
from bs4 import BeautifulSoup  # noqa: E402


def member_plain_text(data):
    soup = BeautifulSoup(data, 'lxml')
    return soup.get_text('\n', strip=True)


def squash(t):
    t = t.replace('\u2019', "'").replace('\u2018', "'").replace('\u201c', '"').replace('\u201d', '"')
    return re.sub(r'\s+', '', t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--landing', required=True)
    ap.add_argument('--n', type=int, default=20)
    ap.add_argument('--seed', type=int, default=20261006)
    ap.add_argument('--toc-ok', default='')
    ap.add_argument('--report', required=True)
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    units = {u['unit_key']: u for u in map(json.loads, open(os.path.join(a.landing, 'units.jsonl'), encoding='utf-8'))}
    secs = [json.loads(x) for x in open(os.path.join(a.landing, 'sections.jsonl'), encoding='utf-8')]
    manifest = json.load(open(os.path.join(a.landing, 'manifest.json')))
    rnd = random.Random(a.seed)
    sample = rnd.sample(secs, min(a.n, len(secs)))
    tmp = tempfile.mkdtemp(prefix='in-review-')
    arc = sc.Archive(tmp, min_interval=1.0, user_agent=BROWSER_UA)
    rec = arc.fetch(ARCHIVE_URL, accept='*/*', min_bytes=1_000_000)
    if rec['state'] != 'complete':
        raise SystemExit('archive fetch failed')
    zbytes = arc.read(rec)
    zf = zipfile.ZipFile(io.BytesIO(zbytes))
    member_cache = {}

    def member_text(member):
        if member not in member_cache:
            member_cache[member] = member_plain_text(zf.read(member))
        return member_cache[member]

    results = []
    for s in sample:
        u = units[s['unit_key']]
        member = u['publisher_member']
        row = {'citation_path': s['citation_path'], 'citation': s['citation'], 'url': ARCHIVE_URL,
               'member': member, 'live_status': rec['http_status'], 'route': rec['route'],
               'user_agent': rec.get('user_agent'), 'ua_retry': rec.get('ua_retry', False)}
        try:
            live = squash(member_text(member))
            number = s['hierarchy'][-1].get('number') or ''
            row['citation_ok'] = bool(number) and squash(number) in live
            row['heading_ok'] = (not s.get('heading')) or squash(s['heading']) in live
            row['text_ok'] = squash(s['text']) in live
            row['ok'] = row['citation_ok'] and row['heading_ok'] and row['text_ok']
        except KeyError:
            row.update(ok=False, why='member missing from live zip')
        results.append(row)

    toc_ok = bool(a.toc_ok.strip())
    passed = all(r['ok'] for r in results)
    decision = 'reviewed' if passed and toc_ok else 'held'
    lines = [
        f"## Review IN ({manifest['parser']['name']}/{manifest['parser']['version']})",
        '',
        f"- Sections landed: {len(secs)}; units: {len(units)}; reviewed on {sc.utc_now()}.",
        f"- Live source: `{ARCHIVE_URL}` (browser UA); member HTML extracted from the official ZIP.",
        f"- Section count vs publisher TOC: {'OK - ' + a.toc_ok if toc_ok else 'NOT ESTABLISHED'}.",
        f"- Live diff: {sum(1 for r in results if r['ok'])}/{len(results)} random sections match live archive members (seed {a.seed}).",
        f"- Decision: **{decision}**",
        '',
        '| citation_path | member | citation | heading | text |',
        '|---|---|---|---|---|',
    ]
    for r in results:
        lines.append(
            f"| {r['citation_path']} | {r.get('member', '')} | {r.get('citation_ok')} | {r.get('heading_ok')} | {r.get('text_ok')} |"
        )
    with open(a.report, 'a', encoding='utf-8') as handle:
        handle.write('\n'.join(lines) + '\n\n')
    note = (
        f"IN review {sc.utc_now()}: {sum(1 for r in results if r['ok'])}/{len(results)} live ZIP-member diffs; "
        f"TOC {'ok' if toc_ok else 'not established'}"
    )
    out = {'state': 'IN', 'decision': decision, 'live_ok': sum(1 for r in results if r['ok']), 'sampled': len(results), 'toc_ok': toc_ok}
    if a.apply:
        import pgrest
        out['rpc'] = pgrest.rpc(
            'corpus_publisher_code_review_v2',
            {'p_jurisdiction': 'IN', 'p_review_status': decision, 'p_public_projection_allowed': decision == 'reviewed', 'p_notes': note},
        )
    print(json.dumps(out, indent=1, default=str))


if __name__ == '__main__':
    main()
