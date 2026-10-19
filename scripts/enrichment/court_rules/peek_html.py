"""Review aid: show the start of each element with one of the given classes (or tag names) in a stored HTML file.

  python3 -I -B scripts/enrichment/court_rules/peek_html.py <file(.gz)> <class-or-tag> [...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402


def main(argv):
    soup = BeautifulSoup(fetchlib.load_raw(argv[0]).decode("utf-8", "replace"), "lxml")
    print("TITLE", soup.title.get_text(" ", strip=True) if soup.title else None)
    for key in argv[1:]:
        found = soup.find_all(class_=key) or soup.find_all(key)
        print(f"== {key}: {len(found)}")
        for el in found[:6]:
            attrs = {k: v for k, v in el.attrs.items() if k in ("id", "class", "name", "href")}
            print("  ", el.name, attrs, "|", " ".join(el.get_text(" ", strip=True).split())[:150])


if __name__ == "__main__":
    main(sys.argv[1:])
