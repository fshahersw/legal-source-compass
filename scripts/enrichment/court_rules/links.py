"""List the links on one page whose URL or text matches a regex (discovery helper; nothing saved).

  python3 -I -B scripts/enrichment/court_rules/links.py <url> [pattern]
"""
import os
import re
import sys
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib  # noqa: E402

ANCHOR = re.compile(r'<a\b[^>]*?href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.S | re.I)


def page_links(html: str, base: str) -> list[tuple[str, str]]:
    out, seen = [], set()
    for m in ANCHOR.finditer(html):
        href, text = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
        full = urljoin(base, href.strip().replace("&amp;", "&"))
        if full not in seen:
            seen.add(full)
            out.append((full, " ".join(text.split())))
    return out


def main(argv):
    """links.py <url> [pattern]  or  links.py --pat <pattern> <url> [<url> ...]"""
    brief = "--brief" in argv
    argv = [a for a in argv if a != "--brief"]
    if argv[0] == "--pat":
        pat, urls = argv[1], argv[2:]
    else:
        urls, pat = [argv[0]], (argv[1] if len(argv) > 1 else ".")
    for url in urls:
        try:
            status, body, headers = fetchlib.fetch(url, None, retries=1)
        except Exception as error:
            print("ERR", url, error)
            continue
        final = headers.get("X-Final-URL", url)
        print("STATUS", status, len(body), final)
        hits = [(full, text) for full, text in page_links(body.decode("utf-8", "replace"), final) if re.search(pat, full + " " + text, re.I)]
        shown = hits[:3] + hits[-2:] if brief and len(hits) > 5 else hits
        if brief:
            print(f"  {len(hits)} matching links")
        for full, text in shown:
            print("  ", full, "|", text[:80])


if __name__ == "__main__":
    main(sys.argv[1:])
