"""Title names from the District of Columbia Council's own code table of contents (a captured page, read-only).

    python3 -I -B scripts/legal/state-codes/outline/dc_toc_names.py <code.html> <out names.json>

The page https://code.dccouncil.gov/us/dc/council/code lists each title as a link to /us/dc/council/code/titles/<N>
whose text is the printed title line ("Title 1. Government Organization."). The output maps "title:<N>" to that line,
character for character after whitespace runs are collapsed. Links whose text does not begin with "Title <N>" for
the same N are refused rather than guessed.
"""
import html
import json
import re
import sys

LINK = re.compile(r'<a[^>]+href="/us/dc/council/code/titles/([0-9A-Za-z]+)"[^>]*>(.*?)</a>', re.S)


def title_names(page):
    names = {}
    for number, inner in LINK.findall(page):
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", inner))).strip()
        if not re.match(rf"^Title {re.escape(number)}\.\s", text):
            raise ValueError(f"title link text does not name title {number}: {text!r}")
        if names.get(f"title:{number}", text) != text:
            raise ValueError(f"title {number} listed twice with different text")
        names[f"title:{number}"] = text
    return names


def main(argv):
    page = open(argv[0], encoding="utf-8").read()
    names = title_names(page)
    with open(argv[1], "w", encoding="utf-8") as fh:
        json.dump(names, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"titles": len(names)}))


if __name__ == "__main__":
    main(sys.argv[1:])
