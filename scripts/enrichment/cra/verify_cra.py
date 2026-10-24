"""Independent check of cra_facts against the original PDFs by a second text engine (pdfplumber), page by page.

For a table fact: the value as printed must appear on the same line of the page as its row key (the row's year or the
last word of its label); facts whose label is spread over several lines ("Average / 1997-2024") need the value on the
page. For a text fact: the value must appear on the page. Each report's file is checked against the manifest sha256
first. Prints failure counts; the list of failures goes to private/build/cra/verification/verify.json.

    python3 -I -B scripts/enrichment/cra/verify_cra.py
"""
from __future__ import annotations

import collections
import gzip
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cra_fetch  # noqa: E402
import cra_inventory  # noqa: E402

import pdfplumber  # noqa: E402

OUT = "/home/user/legal-source-compass/private/build/cra"
TMP = "/home/user/legal-source-compass/private/scratch/enrich/cra/tmp"


def norm(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()  # \s also covers the no-break space
    return re.sub(r"\$ (?=\d)", "$", s)  # one engine prints "$ 140" where the other prints "$140"


def row_key(label: str) -> str | None:
    m = re.match(r"^((?:19|20)\d{2})(?: (H[12]))?$", label.strip())
    if m:
        return label.strip()
    words = [w for w in re.split(r"\s+", label.strip()) if w]
    if not words or "verage" in label or re.search(r"\d{4}[–-]", label):
        return None
    return words[-1]


def main() -> None:
    build = json.load(gzip.open(os.path.join(OUT, "cra_facts.json.gz"), "rt", encoding="utf-8"))
    reps = {r["id"]: r for r in cra_inventory.reports()}
    man = {r["sha256"]: r for r in cra_fetch.load_manifest().values() if r.get("sha256")}
    by = collections.defaultdict(list)
    for row in build["rows"]:
        p = row["item"]["profile"]
        by[p["report_id"]].append(p)
    stats = collections.Counter()
    failures = []
    os.makedirs(TMP, exist_ok=True)
    for rid, facts in sorted(by.items()):
        rep = reps[rid]
        data = cra_fetch.read(man[rep["sha256"]])  # raises on a sha256 mismatch
        with tempfile.NamedTemporaryFile(dir=TMP, suffix=".pdf", delete=False) as h:
            h.write(data)
            path = h.name
        try:
            with pdfplumber.open(path) as pdf:
                cache: dict[int, list[str]] = {}
                for f in facts:
                    pg = f["pdf_page"]
                    if pg not in cache:
                        txt = pdf.pages[pg - 1].extract_text() or ""
                        cache[pg] = [norm(x) for x in txt.splitlines()]
                    lines = cache[pg]
                    v = f["value_text"]
                    if f["method"] == "text":
                        digits = re.sub(r"[^\d.]", "", v.split(" ")[0])
                        rx = re.compile(rf"(?<![\d.]){re.escape(digits)}(?![\d])")
                        ok = bool(digits) and any(rx.search(ln.replace(",", "")) for ln in lines)
                        stats["text_ok" if ok else "text_fail"] += 1
                        if not ok:
                            failures.append({"report": rid, "page": pg, "series": f["series"], "value": v, "why": "value not on page"})
                        continue
                    key = row_key(f["row_label"])
                    hits = [ln for ln in lines if v in ln.split(" ") or f" {v} " in f" {ln} "]
                    if key:
                        same = [ln for ln in hits if (ln.startswith(key) or f" {key} " in f" {ln} " or ln.endswith(key))]
                        if same:
                            stats["table_same_line"] += 1
                        elif hits:
                            stats["table_on_page_label_elsewhere"] += 1
                        else:
                            stats["table_fail"] += 1
                            failures.append({"report": rid, "page": pg, "series": f["series"], "row": f["row_label"], "value": v,
                                             "why": "value not on page"})
                    else:
                        stats["table_on_page" if hits else "table_fail"] += 1
                        if not hits:
                            failures.append({"report": rid, "page": pg, "series": f["series"], "row": f["row_label"], "value": v,
                                             "why": "value not on page"})
        finally:
            os.unlink(path)
    os.makedirs(os.path.join(OUT, "verification"), exist_ok=True)
    json.dump({"stats": stats, "failures": failures}, open(os.path.join(OUT, "verification", "verify.json"), "w"), indent=1)
    print(json.dumps(stats))
    print("failures:", len(failures))
    for x in failures[:25]:
        print("  ", x)


if __name__ == "__main__":
    main()
