#!/usr/bin/env python3
"""Reverse check for Delaware: the text of each live div.Section must appear in that section's parsed text + history.

A chapter page carries many sections, so the shared review's --blocks (all paragraphs in a container) cannot be scoped
to one section here. This walks every retained unit page, takes each div.Section to its balanced </div>, drops HTML
comments, and requires its whitespace-insensitive, quote-normalised text to be contained in the parsed section.

    reverse_check.py --work /tmp/sc4/de [--out report.json]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import sc_common as sc  # noqa: E402

from de_site import UNIT_URL_RE  # noqa: E402
from parse import COMMENT_RE, parse_unit_page, section_blocks  # noqa: E402


def squash(t):
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    for d in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
        t = t.replace(d, "-")
    return re.sub(r"\s+", "", t.replace("§", ""))


def check(work):
    arc = sc.Archive(work)
    pages = secs = 0
    rows = []
    for url, rec in sorted(arc.index.items()):
        if rec.get("state") != "complete" or not UNIT_URL_RE.match(url):
            continue
        html = sc.decode_html(arc.read(rec))[0]
        idx = html.lower().find('<div id="codebody">')
        tails = [t for _a, _h, t in section_blocks(html[idx:] if idx >= 0 else html)]
        if not tails:
            continue
        unit, sections, _ = parse_unit_page(html, url, rec)
        pages += 1
        if len(tails) != len(sections):
            rows.append({"url": url, "issue": f"{len(tails)} div.Section blocks, {len(sections)} parsed sections"})
            continue
        for s, tail in zip(sections, tails):
            secs += 1
            stored = squash(unit["text"][s["start"]:s["end"]] + (s.get("history") or ""))
            live_text = sc.html_text(COMMENT_RE.sub("", tail))
            if squash(live_text) in stored:
                continue
            lost = [w for w in live_text.split() if squash(w) not in stored]
            rows.append({"url": url, "section": s["number"], "missing_words": len(lost), "sample": " ".join(lost[:25]),
                         "markup": sorted({t.lower() for t in re.findall(r"<(table|ul|ol|div|img|pre)\b", tail, re.I)})})
    lost = [r for r in rows if r.get("missing_words") or r.get("issue")]
    return {"pages": pages, "sections": secs, "flagged": len(rows), "sections_with_missing_words": len(lost), "rows": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/de")
    ap.add_argument("--out")
    a = ap.parse_args()
    out = check(a.work)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}))
    for r in out["rows"][:40]:
        print(json.dumps(r, ensure_ascii=False)[:300])
    sys.exit(1 if out["sections_with_missing_words"] else 0)


if __name__ == "__main__":
    main()
