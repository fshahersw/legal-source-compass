"""Fetch one URL (nothing saved) and print each regex match with some context (discovery helper).

  python3 -I -B scripts/enrichment/court_rules/grep_url.py <url> <pattern> [context_chars]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib  # noqa: E402


def main(argv):
    url, pat = argv[0], argv[1]
    ctx = int(argv[2]) if len(argv) > 2 else 80
    status, body, headers = fetchlib.fetch(url, None, retries=1)
    text = body.decode("utf-8", "replace")
    print("STATUS", status, len(body), headers.get("Content-Type"))
    seen = set()
    for m in re.finditer(pat, text, re.I):
        snippet = text[max(0, m.start() - ctx): m.end() + ctx].replace("\n", " ")
        if snippet in seen:
            continue
        seen.add(snippet)
        print("..." + snippet + "...")
        if len(seen) > 60:
            break


if __name__ == "__main__":
    main(sys.argv[1:])
