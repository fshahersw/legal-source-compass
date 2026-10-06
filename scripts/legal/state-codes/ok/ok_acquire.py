"""Capture the Oklahoma Statutes (Oklahoma Legislature / LSB) complete-title RTF files.

Inventory is built independently of the bodies from two official listings:
  * https://www.oklegislature.gov/osStatuesTitle.html (title index, with sizes and links)
  * https://www.oklegislature.gov/OK_Statutes/CompleteTitles/ (IIS directory listing)
Usage: python3 ok_acquire.py <root> [--formats rtf,pdf-sample] [--limit N]
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))
from provenance_fetch import Fetcher, verify_store  # noqa: E402

BASE = 'https://www.oklegislature.gov/'
INDEX_URL = BASE + 'osStatuesTitle.html'
LISTING_URL = BASE + 'OK_Statutes/CompleteTitles/'
SUPPORT = [BASE + 'robots.txt', BASE + 'osStatuesTitle.aspx', INDEX_URL, LISTING_URL,
           BASE + 'ok_constitution.html', BASE + 'ok_constitution.aspx']


def title_key(name):
    m = re.match(r'(?i)os(\d+)([a-z]?)\.(rtf|pdf|doc)$', name)
    return (m.group(1).lstrip('0') + m.group(2).upper(), m.group(3).lower()) if m else None


def listing_files(html):
    return [h.split('/')[-1] for h in re.findall(r'HREF="([^"]+)"', html, re.I)]


def index_titles(html):
    """Title index rows: (title id, heading, size_kb, pdf href)."""
    rows = []
    for m in re.finditer(r'href="([^"]*/os(\d+[A-Za-z]?)\.pdf)"', html, re.I):
        rows.append((m.group(2).upper(), m.group(1)))
    return rows


def main():
    root = pathlib.Path(sys.argv[1])
    formats = ['rtf']
    if '--formats' in sys.argv:
        formats = sys.argv[sys.argv.index('--formats') + 1].split(',')
    fx = Fetcher('OK', root, min_interval=1.2)
    for url in SUPPORT:
        fx.get(url, label='support')
    listing = fx.read(fx.captured(LISTING_URL)).decode('utf8', 'replace')
    files = listing_files(listing)
    keyed = {}
    for f in files:
        k = title_key(f)
        if k:
            keyed.setdefault(k[0], {})[k[1]] = f
    for title, fm in sorted(keyed.items()):
        for fmt in formats:
            if fmt in fm:
                r = fx.get(BASE + 'OK_Statutes/CompleteTitles/' + fm[fmt], label='title:%s:%s' % (title, fmt))
                print(title, fmt, r.get('status'), r.get('bytes'), r.get('error'), flush=True)
    print(verify_store(root))


if __name__ == '__main__':
    main()
