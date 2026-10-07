#!/usr/bin/env python3
"""Compare staged NJ sections against official LIS statute HTML pages (direct HTTP)."""
import argparse
import html as html_mod
import json
import pathlib
import random
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lis_resolve import fetch_page, lis_html_to_text, resolve  # noqa: E402

ENACTMENT_LINE = re.compile(r"^L\.\d{4},\s*c\.\d+,\s*s\.[\dA-Za-z]+\.?\s*$")


def staged_body_text(full: str, heading: str) -> str:
    lines = full.strip().split("\n")
    if lines and heading and squash(lines[0]) == squash(heading):
        return "\n".join(lines[1:]).strip() or full
    return full


def split_enactment_tail(body: str) -> tuple[str, list[str]]:
    lines = [ln.strip() for ln in body.strip().split("\n") if ln.strip()]
    enact: list[str] = []
    while lines and ENACTMENT_LINE.match(lines[-1]):
        enact.insert(0, lines.pop())
    return "\n".join(lines).strip(), enact


def body_matches_staged(body: str, live_raw: str) -> bool:
    live = squash(live_raw)
    if squash(body) in live:
        return True
    operative, enact = split_enactment_tail(body)
    if not enact:
        return False
    return bool(operative) and squash(operative) in live


def page_title(page_html: str) -> str:
    title = re.search(r"<title>([^<]+)", page_html, re.I)
    return title.group(1) if title else ""


def citation_in_page(citation: str, page_html: str, live_text: str) -> bool:
    title = re.search(r"<title>([^<]+)", page_html, re.I)
    hay = (title.group(1) if title else "") + " " + live_text
    compact = re.sub(r"\s+", "", hay)
    return re.sub(r"\s+", "", citation.rstrip(".")) in compact


def squash(text: str) -> str:
    text = html_mod.unescape(text or "")
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
        text = text.replace(dash, "-")
    return re.sub(r"\s+", "", text)


def section_bodies(parsed: pathlib.Path) -> dict[tuple[str, int], dict]:
    text = (parsed / "members" / "STATUTES.TXT.utf8").read_text(encoding="utf-8")
    out = {}
    with (parsed / "sections.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            out[(row["citation"], row["occurrence"])] = {
                "citation": row["citation"],
                "occurrence": row["occurrence"],
                "heading": row.get("heading") or "",
                "text": text[row["start"] : row["end"]],
            }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsed", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/parsed-20261007"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261007)
    ap.add_argument("--report", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/review-lis-page-diff-20261007.json"))
    args = ap.parse_args()

    staged = section_bodies(args.parsed)
    rnd = random.Random(args.seed)
    sample = rnd.sample(sorted(staged.keys()), min(args.n, len(staged)))

    results = []
    for key in sample:
        s = staged[key]
        lis_row = resolve(s["citation"], s["occurrence"], s["heading"])
        row = {"citation": s["citation"], "occurrence": s["occurrence"], "route": "direct", "proxied": False}
        if not lis_row:
            row.update(ok=False, url=None, citation_ok=False, heading_ok=False, text_ok=False, why="xhitlist miss")
        else:
            row["url"] = lis_row["url"]
            page = fetch_page(lis_row["url"])
            live_raw = lis_html_to_text(page)
            live = squash(live_raw)
            body = staged_body_text(s["text"], s["heading"])
            title = page_title(page)
            hay = squash(title + " " + live_raw)
            row["citation_ok"] = citation_in_page(s["citation"], page, live_raw)
            row["heading_ok"] = squash(s["heading"]) in hay or squash(lis_row["title"]) in squash(s["heading"])
            row["text_ok"] = body_matches_staged(body, live_raw)
            row["ok"] = row["citation_ok"] and row["heading_ok"] and row["text_ok"]
        results.append(row)

    passed = sum(1 for r in results if r.get("ok"))
    out = {"seed": args.seed, "sampled": len(results), "live_ok": passed, "proxied_units": 0, "results": results}
    args.report.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"live_ok": passed, "sampled": len(results), "report": str(args.report)}, indent=2))
    if passed != len(results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
