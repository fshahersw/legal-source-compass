"""Independent verification of private/build/state_statutes/nd_code.json.

Usage: python3 -I -B verify_state_code_nd.py <acq_dir> <build.json> <report.json> [--sample 50] [--seed 20261019]

Checks (each with a failure count):
  1. toc_sections: every section on the publisher's contents page is a row and every row is on it (a section
     listed twice, e.g. two effective-date versions, must give two rows).
  2. live_sample: N seeded-random rows; their chapter PDF is downloaded again from ndlegis.gov and read with
     pypdfium2 (the build used poppler pdftotext), the section is cut from its "<number>." heading to the next
     contents section's heading, and its words are compared with the row's heading and text word for word.
  3. shape: contract fields present, title filter values in the listing, source link names the section.
"""
import collections
import json
import random
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codebuild  # noqa: E402
import fetchlib  # noqa: E402
import parse_nd  # noqa: E402

SITE = "https://ndlegis.gov"
INDEX = f"{SITE}/general-information/north-dakota-century-code/index.html"
FOOTER = re.compile(r"Page No\. \d+")


def fact(row, label):
    return next((f[1] for f in row["detail"].get("facts", []) if f[0] == label), None)


def live_words(pdf_bytes, number, next_number):
    pdf = pdfium.PdfDocument(pdf_bytes)
    text = "\n".join(pdf[i].get_textpage().get_text_range() for i in range(len(pdf)))
    text = FOOTER.sub(" ", text.replace("‑", "-").replace(" ", " "))
    start = re.search(r"(?m)^\s*" + re.escape(number) + r"\.", text)
    if not start:
        return None
    end = re.search(r"(?m)^\s*" + re.escape(next_number) + r"\.", text[start.end():]) if next_number else None
    chunk = text[start.start(): start.end() + end.start()] if end else text[start.start():]
    return chunk.split()


def main(acq_dir, build_path, report_path, sample=50, seed=20261019):
    acq = Path(acq_dir)
    manifest = fetchlib.load_manifest(acq / "_manifest.jsonl")
    build = codebuild.read_build(build_path)
    rows = build["rows"]
    by_id = {r["id"]: r for r in rows}
    index = parse_nd.parse_index(fetchlib.read_raw(manifest[INDEX]).decode("utf-8"))
    contents = collections.Counter()
    order = {}
    for t in index:
        for ch in t["chapters"]:
            seq = [n for n, _ in ch["sections"]]
            for i, n in enumerate(seq):
                contents[n] += 1
                order.setdefault(n, (ch["pdf"], seq[i + 1] if i + 1 < len(seq) else None))
    built = collections.Counter(r["id"].split("@")[0] for r in rows)
    missing = sorted(n for n in contents if built[n] < contents[n])
    extra = sorted(n for n in built if built[n] > contents.get(n, 0))
    report = {"dataset": build["dataset"], "rows": len(rows), "checks": {}}
    report["checks"]["toc_sections"] = {"contents_entries": sum(contents.values()), "rows": len(rows),
                                        "failures": len(missing) + len(extra), "missing": missing[:80], "not_in_contents": extra[:50]}
    rng = random.Random(seed)
    picks = rng.sample(sorted(i for i in by_id if "@" not in i and contents.get(i) == 1), sample)
    results, failures = [], 0
    for rid in picks:
        row = by_id[rid]
        pdf_path, next_number = order[rid]
        status, body = fetchlib.get(SITE + pdf_path, interval=1.0)
        live = live_words(body, rid, next_number) if status == 200 else None
        if live is None:
            failures += 1
            results.append({"id": rid, "ok": False, "error": f"HTTP {status} or heading not found"})
            continue
        citation = fact(row, "Citation")
        heading = row["title"][len(citation):].strip()
        text = (row["detail"].get("sections") or [{}])[0].get("text", "")
        expected = [rid + "."] + heading.split() + text.split()
        ok = live == expected
        failures += 0 if ok else 1
        item = {"id": rid, "ok": ok, "words": len(expected)}
        if not ok:
            diff = next((i for i, (a, b) in enumerate(zip(live, expected)) if a != b), min(len(live), len(expected)))
            item.update({"first_difference_at_word": diff, "live": " ".join(live[max(0, diff - 8): diff + 12]),
                         "built": " ".join(expected[max(0, diff - 8): diff + 12]), "live_words": len(live)})
        results.append(item)
    report["checks"]["live_sample"] = {"sample": sample, "seed": seed, "method": "fresh chapter PDF download, pypdfium2 text",
                                       "failures": failures, "results": results}
    title_values = {o["value"] for f in build["listing_block"]["filters"] if f["name"] == "title" for o in f.get("options", [])}
    shape = []
    for r in rows:
        problems = []
        if not r["title"].startswith(fact(r, "Citation") or "\u0000"):
            problems.append("title does not start with citation")
        if r["filters"]["title"][0] not in title_values:
            problems.append("title filter value not in listing")
        if "#nameddest=" + r["id"].split("@")[0].replace(".", "p") not in r["source_url"]:
            problems.append("source link does not name the section")
        if problems:
            shape.append({"id": r["id"], "problems": problems})
    report["checks"]["shape"] = {"failures": len(shape), "examples": shape[:20]}
    report["total_failures"] = sum(c["failures"] for c in report["checks"].values())
    Path(report_path).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("results", "examples", "missing", "not_in_contents")} for k, v in report["checks"].items()}))
    print("total_failures", report["total_failures"])


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = dict(zip(sys.argv[1:], sys.argv[2:]))
    main(args[0], args[1], args[2], int(opts.get("--sample", 50)), int(opts.get("--seed", 20261019)))
