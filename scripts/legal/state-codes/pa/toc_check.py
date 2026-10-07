"""Compare the publisher's own section markers with parsed sections for every retained Pennsylvania title document.

The publisher marks each section with a hidden <div class="Comment"><TT>c<SEC>s</div>. This counts those markers per title in a
retained capture and compares them with the sections the parser produced, and compares two captures by sha256.

    PA_ROOT=/tmp/sc/PA2 python3 toc_check.py [/tmp/sc/PA]    (optional second root: the earlier capture to compare against)
Reads retained bytes only. Registers nothing, lands nothing, reviews nothing.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common.provenance_fetch import Fetcher  # noqa: E402
import acquire  # noqa: E402
import build  # noqa: E402

SECTION_MARKER = re.compile(r'^\d{2}c[0-9A-Za-z.]+?s$')


def titles(fetcher):
    index = [r for r in fetcher.receipts() if r.get('proxy_options') and r.get('ok')][-1]
    return ['%02d' % int(t) for t in acquire.title_numbers(fetcher.read(index).decode())]


def main():
    fetcher = Fetcher('PA', acquire.ROOT)
    nums = titles(fetcher)
    units, missing = build.build_all(fetcher, nums)
    parsed = {u['ttl']: len(u['sections']) for u in units}
    good = acquire.latest_good(fetcher)
    rows, mismatches = [], []
    for ttl in nums:
        doc = fetcher.read(good[acquire.DOC % str(int(ttl))]).decode('utf8', 'replace')
        markers = sum(1 for c in re.findall(r'<div class="Comment">([^<]*)</div>', doc) if SECTION_MARKER.match(c))
        rows.append({'title': ttl, 'markers': markers, 'sections': parsed.get(ttl)})
        if markers != parsed.get(ttl):
            mismatches.append(rows[-1])
    out = {'titles': len(nums), 'missing': missing, 'markers': sum(r['markers'] for r in rows), 'sections': sum(parsed.values()),
           'title_mismatches': mismatches}
    if len(sys.argv) > 1:
        other = acquire.latest_good(Fetcher('PA', sys.argv[1]))
        same = sum(1 for ttl in nums if other.get(acquire.DOC % str(int(ttl))) and
                   other[acquire.DOC % str(int(ttl))]['sha256'] == good[acquire.DOC % str(int(ttl))]['sha256'])
        out['identical_to_other_capture'] = same
    print(json.dumps(out))


if __name__ == '__main__':
    main()
