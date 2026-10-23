"""FSIS Quarterly Enforcement Reports (QER) -> fsis_enforcement_quarterly.

Each fiscal year's fourth-quarter report (and the newest report for the current fiscal year) holds every quarter of
that year, so one PDF per fiscal year is read. The PDFs are text PDFs; FSIS's site answers this environment with an
Akamai 403, so they are read through the Firecrawl scrape service (its PDF text rendering is stored unchanged,
gzip-compressed, with a manifest line). Every stored cell keeps the exact table row it came from ("quote"), and the
builder checks that the quote occurs in the stored text; tables whose rows cannot be read as label + numbers are
skipped and listed.

  python3 -I -B fsis_qer.py fetch
  python3 -I -B fsis_qer.py build
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys

from common import ACQ, compact, latest_manifest, write_build

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import corpus_writer as writer  # noqa: E402

INDEX_URL = "https://www.fsis.usda.gov/inspection/regulatory-enforcement/quarterly-enforcement-reports"
BASE = "https://www.fsis.usda.gov/sites/default/files/media_file/"
# fiscal year -> the report that covers every quarter of it (Q4 report; newest report for FY2026)
REPORTS = {
    2015: "2020-08/QER-Q4-FY2015-Tables.pdf", 2016: "2020-08/QER-Q4-FY2016-Tables-R.pdf",
    2017: "2020-08/QER-Q4-FY2017-Tables.pdf", 2018: "2020-08/QER-Q4-FY2018-Tables.pdf",
    2019: "2021-03/qer-q4-fy2019.pdf", 2020: "2021-02/qer-q4-fy2020-table.pdf",
    2021: "2021-11/qer-q4-fy2021-tables.pdf", 2022: "documents/qer-q4-fy2022-tables.pdf",
    2023: "documents/qer-q4-fy2023-tables.pdf", 2024: "documents/qer-q4-fy2024-tables.pdf",
    2025: "documents/qer-q4-fy2025-tables.pdf", 2026: "documents/qer-q3-fy2026-tables.pdf",
}
DATASET = "fsis_enforcement_quarterly"
NUM = re.compile(r"^-?[\d,]+(?:\.\d+)?%?$")


def local(fy: int) -> str:
    return os.path.join(ACQ, "fsis", "qer", os.path.basename(REPORTS[fy]).lower().replace(".pdf", ".md.gz"))


def fetch() -> None:
    from firecrawl_fetch import fetch as fc

    for fy, rel in sorted(REPORTS.items()):
        if not os.path.exists(local(fy)):
            print(json.dumps(fc(BASE + rel, os.path.relpath(local(fy), os.path.join(ACQ, "fsis")), "markdown"))[:200], flush=True)


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def number(s: str):
    s = s.strip().replace("–", "-")
    if not NUM.match(s):
        return None
    pct = s.endswith("%")
    v = float(s.rstrip("%").replace(",", ""))
    return {"value": v if pct or not v.is_integer() else int(v), "percent": pct}


def parse_tables(md: str) -> tuple[list[dict], list[str]]:
    """Markdown tables with the bold 'Table N...' title above them. Rows whose first cell is a label and whose other
    non-empty cells are all numbers are kept (with the exact source line as quote)."""
    lines = md.splitlines()
    tables, skipped = [], []
    title = None
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^\s*\*\*\s*(Table\s+\d+[a-z]?\.?.*?)\*\*\s*$", line) or re.match(r"^\s*#*\s*\**(Table\s+\d+[a-z]?\..*?)\**\s*$", line)
        if m:
            title = re.sub(r"\s+", " ", m.group(1)).strip(" *")
            # titles wrap onto a second bold line
            if i + 1 < len(lines) and lines[i + 1].strip().startswith("**") and "|" not in lines[i + 1] and not lines[i + 1].strip().startswith("**Table"):
                title += " " + lines[i + 1].strip().strip("*").strip()
        if line.strip().startswith("|") and title:
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            header = [c for c in cells(block[0])]
            rows = []
            for raw in block[1:]:
                cs = cells(raw)
                if set("".join(cs)) <= set("-: "):
                    continue
                label, values = cs[0], cs[1:]
                nums = [number(v) if v else None for v in values]
                if label and any(n is not None for n in nums) and all(n is not None or not v for n, v in zip(nums, values)):
                    rows.append({"label": label, "values": [None if n is None else n["value"] for n in nums], "quote": raw.strip()})
            tid = re.match(r"Table\s+(\d+[a-z]?)", title)
            if rows:
                tables.append({"table": tid.group(1) if tid else title, "title": title, "header": header, "rows": rows})
            else:
                skipped.append(title)
            title = None
            continue
        i += 1
    return tables, skipped


def build() -> str:
    rows, inputs, report = [], [], []
    for fy in sorted(REPORTS):
        path = local(fy)
        if not os.path.exists(path):
            report.append({"fy": fy, "status": "not fetched"})
            continue
        with gzip.open(path, "rt", encoding="utf-8") as f:
            md = f.read()
        entry = latest_manifest(os.path.relpath(path, os.path.dirname(os.path.dirname(ACQ))))
        tables, skipped = parse_tables(md)
        bad_quotes = sum(1 for t in tables for r in t["rows"] if r["quote"] not in md)
        url = BASE + REPORTS[fy]
        inputs.append({"url": url, "path": entry["path"] if entry else os.path.relpath(path, os.path.dirname(os.path.dirname(ACQ))),
                       "sha256": entry["sha256"] if entry else None})
        period = re.search(r"QUARTERLY ENFORCEMENT REPORT\s+(.*?)\n", md)
        report.append({"fy": fy, "tables": len(tables), "rows": sum(len(t["rows"]) for t in tables), "skipped_tables": skipped, "quotes_not_found": bad_quotes})
        t1 = next((t for t in tables if t["table"] == "1"), None)
        total = next((r for r in (t1 or {}).get("rows", []) if r["label"].upper() == "TOTAL"), None)
        facts = [
            ["Fiscal year", f"FY{fy} (October {fy - 1} - September {fy})"],
            ["Report period", period.group(1).strip() if period else "Not recorded"],
            ["Tables read", str(len(tables))],
            ["Tables not readable as label + numbers", "; ".join(skipped) if skipped else "None"],
            ["Verification procedures performed (Table 1 TOTAL)", f"{total['values'][0]:,}" if total and total["values"][0] is not None else "Not recorded"],
            ["Noncompliances documented (Table 1 TOTAL)", f"{total['values'][1]:,}" if total and len(total["values"]) > 1 and total["values"][1] is not None else "Not recorded"],
            ["Source", f"FSIS Quarterly Enforcement Report tables ({os.path.basename(REPORTS[fy])})"],
        ]
        rows.append(writer.record(
            DATASET, f"fsis-qer:FY{fy}", f"FSIS Quarterly Enforcement Report tables, FY{fy}", source_url=url,
            cells=compact({"fy": fy, "tables": len(tables), "verification_procedures": total["values"][0] if total else None,
                           "noncompliances": total["values"][1] if total and len(total["values"]) > 1 else None}),
            facts=facts, text=" ".join(t["title"] for t in tables), filters={"fy": [str(fy)]},
            subtitle=f"{len(tables)} tables · {period.group(1).strip() if period else ''}", links=[],
            extra={"tables": tables},
        ))
    summary = {
        "source": {"publisher": "USDA Food Safety and Inspection Service", "index": INDEX_URL,
                   "retrieval": "PDFs read through the Firecrawl scrape service's PDF text rendering (FSIS answers this environment with an Akamai 403; not bypassed).",
                   "terms": "U.S. government work."},
        "records": len(rows), "per_report": report,
        "notes": ["Each record holds every table of the fiscal year's fourth-quarter report (FY2026: the newest, third-quarter report).",
                  "Cells are numbers exactly as printed (thousands separators removed; percentages as numbers); each row keeps its source line as 'quote'.",
                  "Some tables carry their own period labels (FSIS's Table 4 in the FY2026 report labels its quarters 2024-2025); labels are kept as printed."],
    }
    listing_block = writer.listing([("fy", "FY"), ("tables", "Tables"), ("verification_procedures", "Verification procedures"), ("noncompliances", "Noncompliances")])
    out = write_build(DATASET, "FSIS Quarterly Enforcement Report tables (FY2015-FY2026)", rows, listing_block, summary, inputs)
    print(json.dumps({"dataset": DATASET, "records": len(rows), "report": report}, indent=1))
    return out


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        fetch()
    elif sys.argv[1:] == ["build"]:
        build()
    else:
        raise SystemExit(__doc__)
