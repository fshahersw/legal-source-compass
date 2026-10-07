"""Fetch per-section Statute JSON for citations that parse marks not archived.

Reads baseline gaps from REPORT.json (reason == "not archived") or recomputes via parse.load_section_payload.
Official host only; resumable through Archive receipts.

Usage:
  python3 acquire_missing_sections.py --work /tmp/sc4/sd
  python3 acquire_missing_sections.py --work /tmp/sc4/sd --from-report /tmp/sc4/sd/REPORT.json
"""
import argparse
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from parse import chapter_from_citation, load_section_payload  # noqa: E402

API = "https://sdlegislature.gov/api/Statutes"


def statute_url(citation: str) -> str:
    return f"{API}/Statute/{urllib.parse.quote(str(citation), safe='-.')}"


def grab(arc: Archive, url: str, accept="application/json,*/*", **kw):
    rec = arc.fetch(url, accept=accept, **kw)
    if rec["state"] != "complete" and rec.get("http_status") in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, accept=accept, **kw)
    return rec


def citations_not_archived(arc: Archive, inv: dict) -> list[str]:
    out = []
    for s in inv.get("sections") or []:
        cit = s["statute"]
        t_num, ch_stat = chapter_from_citation(cit)
        data, _, _ = load_section_payload(arc, cit, ch_stat)
        if not data:
            out.append(cit)
    return sorted(set(out))


def citations_from_report(path: str) -> list[str]:
    rep = json.load(open(path))
    return sorted(
        {
            m["citation"]
            for m in rep.get("missing_body") or []
            if m.get("reason") == "not archived" and m.get("citation")
        }
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/sd")
    ap.add_argument("--from-report", help="Use missing_body not archived from this REPORT.json")
    a = ap.parse_args()
    inv_path = os.path.join(a.work, "inventory.json")
    if not os.path.exists(inv_path):
        raise SystemExit(f"missing {inv_path}")
    arc = Archive(a.work, min_interval=1.0)
    if a.from_report:
        targets = citations_from_report(a.from_report)
    else:
        targets = citations_not_archived(arc, json.load(open(inv_path)))

    failed = []
    fetched = 0
    skipped = 0
    for i, cit in enumerate(targets, 1):
        url = statute_url(cit)
        old = arc.index.get(url)
        if old and old.get("state") == "complete":
            skipped += 1
            continue
        rec = grab(arc, url, accept="application/json")
        if rec["state"] != "complete":
            failed.append({"citation": cit, "url": url, "http_status": rec.get("http_status")})
        else:
            fetched += 1
        if i % 25 == 0 or i == len(targets):
            print(f"sections {i}/{len(targets)} fetched={fetched} skipped={skipped} failed={len(failed)}", flush=True)

    summary = {
        "targets": len(targets),
        "fetched": fetched,
        "skipped_already_archived": skipped,
        "failed": failed,
    }
    out_path = os.path.join(a.work, "section_fetch_missing.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
