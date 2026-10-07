#!/usr/bin/env python3
"""Fetch HRS section files missing from receipts (resume from inventory)."""
import json
import sys
from pathlib import Path

from hifetch import HiFetcher, ROOT


def main():
    fetcher = HiFetcher('HI', ROOT, min_interval=0.25, timeout=90)
    have = {r['url'] for r in fetcher.receipts() if r.get('ok')}
    missing = []
    for line in open(Path(ROOT) / 'parsed' / 'inventory.jsonl', encoding='utf8'):
        row = json.loads(line)
        if row.get('level') == 'section' and row.get('url') and row['url'] not in have:
            missing.append(row['url'])
    print('missing', len(missing), flush=True)
    ok = fail = 0
    for i, url in enumerate(missing, 1):
        rec = fetcher.get(url, label='hrs-file')
        if rec and rec.get('ok'):
            ok += 1
        else:
            fail += 1
        if i % 25 == 0:
            print(i, ok, fail, flush=True)
    print('done ok', ok, 'fail', fail, flush=True)
    return 0 if fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
