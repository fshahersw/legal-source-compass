"""Review aid: render one stored constitution file the way extract_constitutions.py does and show the first lines and
the headings found.

  python3 -I -B scripts/enrichment/court_rules/peek_const.py <stored path> [encoding]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import constitution_parse as CP  # noqa: E402
import fetchlib  # noqa: E402
import textlib  # noqa: E402
from extract_constitutions import html_text  # noqa: E402


def main(argv):
    raw = fetchlib.load_raw(argv[0])
    if raw[:5] == b"%PDF-":
        text = textlib.pdf_text(os.path.join(fetchlib.ROOT, argv[0]), layout=False)
    else:
        text = html_text(raw, argv[1] if len(argv) > 1 else "utf-8")
    print("chars", len(text))
    if raw[:5] != b"%PDF-":
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(raw.decode("utf-8", "replace"), "lxml")
        for name, el in (("main", soup.find("main")), ("#content", soup.find(id="content")), ("article", soup.find("article")), ("body", soup.body)):
            print(" ", name, None if el is None else len(el.get_text(" ", strip=True)))
    print(text[:800])
    units = CP.split_constitution(text)
    print("units", len(units), "level", CP.structure_level(units))
    for u in units[:15]:
        print("  ", u.get("article"), u.get("section"), (u.get("section_title") or u.get("article_title") or "")[:60], len(u["text"]))


if __name__ == "__main__":
    main(sys.argv[1:])
