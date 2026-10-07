#!/usr/bin/env python3
"""Fresh direct live diff for NJ staged sections against the official publisher compilation.

Re-downloads STATUTES-TEXT.zip from pub.njleg.gov (direct HTTPS), re-parses with nj-parse-bulk.py,
and compares a random sample to the staged parse on citation, heading, and full section text.
Also fetches each sample's official LIS statute HTML page when resolvable in the local index cache.
No proxy. Does not apply corpus review flags.
"""
import argparse
import html as html_mod
import importlib.util
import json
import pathlib
import random
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
STATUTES_ZIP = "https://pub.njleg.gov/statutes/STATUTES-TEXT.zip"
LIS_BASE = "https://lis.njleg.state.nj.us/nxt/gateway.dll/statutes/1"
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I | re.S)
CITE_IN_TITLE = re.compile(
    r"^((?:[0-9][0-9A-Za-z.]*|App\.A):[0-9][0-9A-Za-z.:\-]*(?:\([0-9A-Za-z]+\))?)"
)


def squash(text: str) -> str:
    text = html_mod.unescape(text or "")
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
        text = text.replace(dash, "-")
    return re.sub(r"\s+", "", text)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def lis_html_to_text(page: str) -> str:
    page = re.sub(r"<script[\s\S]*?</script>", " ", page, flags=re.I)
    page = re.sub(r"<style[\s\S]*?</style>", " ", page, flags=re.I)
    if "Normal-Level" in page:
        chunk = page.split("Normal-Level", 1)[1].split("</div>", 1)[0]
        page = chunk
    page = re.sub(r"<br\s*/?>", "\n", page, flags=re.I)
    page = re.sub(r"<[^>]+>", " ", page)
    return re.sub(r"\s+", " ", page).strip()


def section_bodies(parsed: pathlib.Path) -> dict[tuple[str, int], dict]:
    text = (parsed / "members" / "STATUTES.TXT.utf8").read_text(encoding="utf-8")
    out = {}
    with (parsed / "sections.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            body = text[row["start"] : row["end"]]
            out[(row["citation"], row["occurrence"])] = {
                "citation": row["citation"],
                "occurrence": row["occurrence"],
                "heading": row.get("heading") or "",
                "text": body,
            }
    return out


def live_publisher_parse(work: pathlib.Path) -> pathlib.Path:
    acquire = pathlib.Path(__file__).resolve().parents[2] / "nj" / "acquire.py"
    parser = pathlib.Path(__file__).resolve().parents[2] / "nj-parse-bulk.py"
    capture = work / "capture-live"
    parsed = work / "parsed-live"
    subprocess.run([sys.executable, str(acquire), "--work", str(capture)], check=True)
    if parsed.exists():
        raise SystemExit(f"refusing to overwrite {parsed}")
    subprocess.run([sys.executable, str(parser), "--base", str(capture), "--output", str(parsed)], check=True)
    return parsed


def load_lis_index(cache: pathlib.Path) -> dict:
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    return {}


def pick_lis_row(citation: str, occurrence: int, heading: str, index: dict) -> dict | None:
    rows = index.get(citation) or []
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    head = squash(heading)
    for row in rows:
        if squash(row.get("title", "")) == head:
            return row
    if occurrence <= len(rows):
        return rows[occurrence - 1]
    return rows[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--staged", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/parsed-20261007"))
    ap.add_argument("--work", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/live-review-20261007"))
    ap.add_argument("--lis-index", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/lis-citation-index.json"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261007)
    ap.add_argument("--report", type=pathlib.Path, default=pathlib.Path("/tmp/sc4/nj/review-live-diff-20261007.json"))
    args = ap.parse_args()

    staged = section_bodies(args.staged)
    live_parsed = live_publisher_parse(args.work)
    live = section_bodies(live_parsed)
    if set(staged) != set(live):
        raise SystemExit("staged/live section keys differ after fresh publisher parse")

    rnd = random.Random(args.seed)
    sample = rnd.sample(sorted(staged.keys()), min(args.n, len(staged)))
    lis_index = load_lis_index(args.lis_index)
    results = []
    for key in sample:
        s = staged[key]
        l = live[key]
        row = {
            "citation": s["citation"],
            "occurrence": s["occurrence"],
            "publisher_zip_url": STATUTES_ZIP,
            "route": "direct",
        }
        row["citation_ok"] = s["citation"] == l["citation"]
        row["heading_ok"] = squash(s["heading"]) == squash(l["heading"])
        row["text_ok"] = squash(s["text"]) == squash(l["text"])
        row["publisher_live_ok"] = row["citation_ok"] and row["heading_ok"] and row["text_ok"]

        lis_row = pick_lis_row(s["citation"], s["occurrence"], s["heading"], lis_index)
        row["lis_url"] = lis_row["url"] if lis_row else None
        if lis_row:
            try:
                page = fetch(lis_row["url"]).decode("utf-8", errors="replace")
                live_text = squash(lis_html_to_text(page))
                row["lis_citation_ok"] = squash(s["citation"]) in live_text
                row["lis_heading_ok"] = squash(s["heading"]) in live_text or squash(lis_row.get("title", "")) in squash(s["heading"])
                row["lis_text_ok"] = squash(s["text"]) in live_text
                row["lis_page_ok"] = row["lis_citation_ok"] and row["lis_heading_ok"] and row["lis_text_ok"]
            except urllib.error.URLError as exc:
                row["lis_page_ok"] = False
                row["lis_error"] = str(exc)
        else:
            row["lis_page_ok"] = None

        row["ok"] = row["publisher_live_ok"]
        results.append(row)

    passed = sum(1 for r in results if r["ok"])
    out = {
        "seed": args.seed,
        "sampled": len(results),
        "live_ok": passed,
        "comparison": "fresh official STATUTES-TEXT.zip from pub.njleg.gov vs staged parse",
        "proxied_units": 0,
        "results": results,
    }
    args.report.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"live_ok": passed, "sampled": len(results), "report": str(args.report)}, indent=2))
    if passed != len(results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
