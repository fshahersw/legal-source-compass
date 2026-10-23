"""Re-fetch a random sample of stored records from their publishers and compare (live network, polite).

  python3 -I -B scripts/enrichment/oversight/refetch_check.py [--seed N] [--write]

Samples (fixed seed, so a run can be repeated): 8 Oversight.gov reports, 4 DOJ OIG reports, 4 OSC public files, 2 CEP
resolutions and 2 DOJ index links. Each is fetched again from its own official page at the host's polite pace and the
stored values are compared with what the page prints now. A difference is reported, not corrected: pages change.
"""
import html
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402
import doj_oig as dj  # noqa: E402
import parse_doj_oig as pj  # noqa: E402
import parse_oversight as po  # noqa: E402
import rows as rw  # noqa: E402
from verify_oversight import load  # noqa: E402


def text_of(page):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))


def main():
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261023
    rng = random.Random(seed)
    fetcher = cm.Fetcher(rates={**cm.RATES, "www.justice.gov": 10.5})
    results = []

    def record(dataset, rid, ok, detail):
        results.append({"dataset": dataset, "id": rid, "match": ok, "detail": detail})
        print(("MATCH   " if ok else "DIFFER  ") + dataset + " " + rid + (" " + "; ".join(detail) if detail else ""))

    ov = load("oversight_reports")["rows"]
    for row in rng.sample(ov, 8):
        b = row["item"]["oversight"]
        status, body, _, _ = fetcher.get(b["url"])
        page = body.decode("utf-8", "replace")
        d = po.parse_report_page(page)
        diffs = []
        title = re.search(r"<title>(.*?)</title>", page, re.S)
        live_title = html.unescape(title.group(1)).rsplit("|", 1)[0].strip() if title else None
        if status != 200:
            diffs.append(f"HTTP {status}")
        if live_title != row["title"]:
            diffs.append(f"title {live_title!r} vs {row['title']!r}")
        for key, stored in (("date", b["date"]), ("report_number", b["report_number"]), ("recommendations", b["recommendations"])):
            if d[key] != stored:
                diffs.append(f"{key} {d[key]!r} vs {stored!r}")
        if b["type"] and f">{b['type']}<" not in page.replace("\n", ""):
            if b["type"] not in text_of(page):
                diffs.append(f"type {b['type']!r} not on page")
        record("oversight_reports", row["id"], not diffs, diffs)

    doj = load("doj_oig_reports")["rows"]
    for row in rng.sample(doj, 4):
        b = row["item"]["dojoig"]
        status, body, _, _ = fetcher.get(b["url"])
        d = pj.parse_report(body.decode("utf-8", "replace"))
        diffs = []
        if status != 200 or d is None:
            diffs.append(f"HTTP {status}")
        else:
            merged = dj.merge({"path": "x", "title": row["title"], "date": b["date"], "type": b["type"], "components": b["components"], "location": b["location"]}, d)
            for key, stored in (("number", b["number"]), ("recommendations", b["recommendations"]), ("components", b["components"]), ("entity", b["entity"])):
                if merged[key] != stored:
                    diffs.append(f"{key} {merged[key]!r} vs {stored!r}")
            for key in ("questioned_costs", "funds_better_use"):
                if (merged[key] or {}).get("text") != (b[key] or {}).get("text"):
                    diffs.append(f"{key} {(merged[key] or {}).get('text')!r} vs {(b[key] or {}).get('text')!r}")
            if (merged["pdf"] or None) != b["pdf_url"]:
                diffs.append(f"pdf {merged['pdf']!r} vs {b['pdf_url']!r}")
        record("doj_oig_reports", row["id"], not diffs, diffs)

    files = load("osc_public_files")["rows"]
    for row in rng.sample(files, 4):
        b = row["item"]["oscdi"]
        status, body, _, _ = fetcher.get(b["url"])
        page = body.decode("utf-8", "replace")
        t = text_of(page)
        diffs = []
        if status != 200:
            diffs.append(f"HTTP {status}")
        for n in b["numbers"]:
            if n not in t:
                diffs.append(f"file number {n} not on page")
        if b["agency"] and b["agency"] not in t:
            diffs.append(f"agency {b['agency']!r} not on page")
        for result in b["results"]:
            if result not in t:
                diffs.append(f"result {result!r} not on page")
        for f in b["files"]:
            if f["url"].replace("https://www.osc.gov", "") not in page:
                diffs.append(f"file link missing {f['url']}")
        record("osc_public_files", row["id"], not diffs, diffs)

    cep = load("doj_cep_resolutions")["rows"]
    status, body, _, _ = fetcher.get("https://www.justice.gov/criminal/criminal-fraud/vsd-resolutions-part-1")
    page = body.decode("utf-8", "replace")
    t = text_of(page)
    for row in rng.sample(cep, 2):
        b = row["item"]["cep"]
        diffs = []
        if status != 200:
            diffs.append(f"HTTP {status}")
        if b["label"] not in t or f"({b['date_text']})" not in t:
            diffs.append("label or date not on the live list")
        if b["url"].replace("https://www.justice.gov", "") not in page and b["url"] not in page:
            diffs.append("link not on the live list")
        record("doj_cep_resolutions", row["id"], not diffs, diffs)

    idx = [r for r in load("doj_document_index")["rows"] if r["item"]["dojdoc"]["kind"] == "budget"]
    status, body, _, _ = fetcher.get("https://www.justice.gov/doj/budget-and-performance")
    page = body.decode("utf-8", "replace")
    for row in rng.sample(idx, 2):
        b = row["item"]["dojdoc"]
        diffs = [] if b["url"].replace("https://www.justice.gov", "") in page or b["url"] in page else ["link not on the live page"]
        record("doj_document_index", row["id"], not diffs, diffs)

    summary = {"checked": len(results), "matched": sum(1 for r in results if r["match"]), "differ": [r for r in results if not r["match"]],
               "seed": seed, "checked_at": rw.built_at()}
    print(json.dumps({k: v for k, v in summary.items() if k != "differ"}), "differences:", len(summary["differ"]))
    if "--write" in sys.argv:
        with open(os.path.join(cm.BUILD, "refetch_report.json"), "w", encoding="utf-8") as handle:
            json.dump({**summary, "results": results}, handle, indent=1)


if __name__ == "__main__":
    main()
