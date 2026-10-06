"""South Carolina Code of Laws capture (scstatehouse.gov), official HTML + Word per chapter.

Stage 1: statmast index + every title page (inventory source).
Stage 2: every chapter HTML (primary) and DOCX (independent audit form) linked from title pages.
Usage: sc_acquire.py ROOT [--stage index|chapters|all]
"""
import json
import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import Fetcher, verify_store  # noqa: E402

BASE = 'https://www.scstatehouse.gov'
INDEX = BASE + '/code/statmast.php'


def title_links(html):
    nums = []
    for m in re.finditer(r'href="/code/title(\d+)\.php"', html):
        n = int(m.group(1))
        if n not in nums:
            nums.append(n)
    return nums


def chapter_links(html):
    """Return [(html_path, word_path)] in page order."""
    pages = re.findall(r'href="(/code/t\d+\w*c\w+\.php)"', html)
    files = re.findall(r'href="(/getfile\.php\?[^"]*)"', html)
    if len(pages) != len(files):
        raise ValueError('title page html/word link count mismatch')
    return list(zip(pages, files))


def main(root, stage='all'):
    f = Fetcher('SC', root, min_interval=1.0)
    idx = f.get(INDEX, label='index')
    assert idx['ok'], idx
    titles = title_links(f.read(idx).decode('utf8', 'replace'))
    print('titles', len(titles), flush=True)
    chapters = []
    for t in titles:
        url = '%s/code/title%d.php' % (BASE, t)
        r = f.get(url, label='title:%d' % t)
        if not r['ok']:
            print('FAIL title', t, r.get('status'), r.get('error'), flush=True)
            continue
        html = f.read(r).decode('utf8', 'replace')
        for h, w in chapter_links(html):
            chapters.append((t, h, w))
    print('chapters', len(chapters), flush=True)
    if stage == 'index':
        return
    for i, (t, h, w) in enumerate(chapters):
        r = f.get(BASE + h, label='chapter-html:%s' % h)
        if not r['ok']:
            print('FAIL html', h, r.get('status'), r.get('error'), flush=True)
        d = f.get(BASE + w, label='chapter-docx:%s' % h)
        if not d['ok']:
            print('FAIL docx', h, d.get('status'), d.get('error'), flush=True)
        if i % 25 == 0:
            print(i, len(chapters), flush=True)
    print(verify_store(root), flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'all')
