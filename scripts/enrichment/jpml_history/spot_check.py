"""Spot-check displayed figures in the built datasets against the raw PDFs they came from.

  python3 -I -B scripts/enrichment/jpml_history/spot_check.py

The checks are chosen by a fixed rule (not by looking at the outcome): monthly reports at five dates and fiscal-year
editions at nine years. For each check the figure is read from the BUILD file (what a user would see), the raw PDF is
searched on its own (pdftotext of a single page, a regex written for this script, not the parsers), and the source line
is stored with the PDF page number. Output: private/build/jpml_history/spot_checks.json
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_jpml_history as bh  # noqa: E402

ACQ, OUT = bh.ACQ, bh.OUT
MONTHLY_MONTHS = ["2024-10", "2025-03", "2025-09", "2026-04", "2026-10"]
FY_YEARS = [1992, 1996, 2001, 2005, 2010, 2014, 2018, 2022, 2025]
MONTHLY_MDLS = [2738, 2873]
FY_MDLS = {1992: 875, 1996: 875, 2001: 1203, 2005: 1657, 2010: 2047, 2014: 2323, 2018: 2738, 2022: 2873, 2025: 3060}
FY_DISTRICTS = {1992: "pennsylvania-e", 1996: "illinois-n", 2001: "new-jersey", 2005: "louisiana-e", 2010: "california-n", 2014: "minnesota", 2018: "south-carolina", 2022: "illinois-n", 2025: "new-jersey"}


def page_text(pdf: Path, page: int) -> str:
    return subprocess.run(["pdftotext", "-layout", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, text=True, check=True).stdout


def pages_of(pdf: Path):
    return subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout.split("\f")


def num_rx(n: int) -> str:
    """The integer as printed: with thousands commas or without (older editions print 138006)."""
    s, c = str(n), f"{n:,}"
    return r"(?:" + re.escape(c) + r"|" + re.escape(s) + r")"


def find(pdf: Path, line_rx: str, seq: list, window: int = 0):
    """First page/line where line_rx matches and the integers in seq appear in that order on that line (window=0) or
    within `window` following lines. Returns (page, excerpt) or (None, None)."""
    for pno, text in enumerate(pages_of(pdf), 1):
        lines = text.splitlines()
        for i, l in enumerate(lines):
            if not re.search(line_rx, l):
                continue
            blob = " ".join(x.strip() for x in lines[i: i + 1 + window])
            rx = r"(?<![\d,])" + r"\s+(?:[^\d]*?\s+)?".join(num_rx(n) for n in seq) + r"(?![\d,])"
            m = re.search(rx, blob)
            if m:
                # confirm on a fresh single-page extraction
                again = page_text(pdf, pno)
                if re.search(line_rx, again, re.M):
                    return pno, " ".join(blob.split())[:230]
    return None, None


def load(ds):
    return {r["id"]: r for r in json.loads((OUT / f"{ds}.json").read_text())["rows"]}


def main():
    manifest = bh.load_manifest()
    mdls, months, extra = load("jpml_pending_history_mdls"), load("jpml_pending_history_months"), load("jpml_statistics_extra")
    by_month = {}
    for url, e in manifest.items():
        if e["path"].startswith("reports/") and "Actions_Pending" in e["path"]:
            by_month[bh.pr.date_from_filename(url)[:7]] = (url, ACQ / e["path"])
    fy_pdf = {int(e["link_text"].split()[-1]): (url, ACQ / e["path"]) for url, e in manifest.items() if e.get("stat_type") == "Fiscal Year"}
    checks = []

    def add(report, pdf, where, dataset, row, field, shown, page, excerpt):
        checks.append({"report": report, "pdf": str(pdf.relative_to(ACQ.parents[1])), "dataset": dataset, "row": row, "field": field, "displayed": shown, "pdf_page": page, "source_line": excerpt, "match": page is not None, "where": where})

    # monthly reports: report totals and two MDL lines
    for m in MONTHLY_MONTHS:
        url, pdf = by_month[m]
        ms = months[m]["item"]["month_stats"]
        page, ex = find(pdf, r"Report Totals:", [ms["pending_mdls"], ms["pending_actions"], ms["total_actions"]])
        add(url, pdf, "Report Totals line", "jpml_pending_history_months", m, "pending_mdls / pending_actions / total_actions", [ms["pending_mdls"], ms["pending_actions"], ms["total_actions"]], page, ex)
        for mdl in MONTHLY_MDLS:
            pt = next(p for p in mdls[str(mdl)]["item"]["history"]["series"] if p["month"] == m)
            page, ex = find(pdf, rf"MDL\s*-\s*{mdl}\b", [pt["pending"], pt["total"]])
            add(url, pdf, f"MDL -{mdl} row", "jpml_pending_history_mdls", str(mdl), f"series {m} pending / total", [pt["pending"], pt["total"]], page, ex)
    # fiscal-year editions: grand totals, one district, one MDL
    for fy in FY_YEARS:
        url, pdf = fy_pdf[fy]
        s = extra[f"fy:{fy}"]["item"]["fy_stats"]
        page, ex = find(pdf, r"(?:GRAND\s+TOTALS?|^\s*TOTALS?)\b", [s["cum_closed"], s["pending"]])
        add(url, pdf, "Circuit-and-District table, grand total row", "jpml_statistics_extra", f"fy:{fy}", "cum_closed / pending", [s["cum_closed"], s["pending"]], page, ex)
        dist = extra[f"district:{FY_DISTRICTS[fy]}"]["item"]
        pt = next(p for p in dist["series"] if p["fy"] == fy)
        labels = "|".join(re.escape(x).replace(r"\ ", r"\s+") for x in dist["printed_labels"])
        page, ex = find(pdf, rf"^\s*(?:{labels})(?=\s)", [pt["pending"]])
        # the pending figure is the last number on the district line; require it at the end
        if page is not None and not re.search(num_rx(pt["pending"]) + r"\s*(?:\S*)?$", ex):
            page, ex = None, ex
        add(url, pdf, "Circuit-and-District table, district row", "jpml_statistics_extra", f"district:{FY_DISTRICTS[fy]}", f"FY{fy} pending", pt["pending"], page, ex)
        mdl = FY_MDLS[fy]
        hist = extra[f"mdl:{mdl}"]["item"]["fy_history"]
        pt = next((p for p in hist["series"] if p["fy"] == fy), None)
        if pt is None:
            add(url, pdf, f"Summary by Docket, MDL {mdl}", "jpml_statistics_extra", f"mdl:{mdl}", f"FY{fy} series", None, None, f"MDL {mdl} has no FY{fy} point in the build (not listed in that edition)")
            checks[-1]["match"] = None
            continue
        seq = [pt["transferred"], pt["filed_in_transferee"], pt["closed"], pt["remanded"], pt["pending"]]
        page, ex = find(pdf, rf"^\s*{mdl}\s+\S", seq, window=40)
        add(url, pdf, f"Summary by Docket, MDL {mdl}", "jpml_statistics_extra", f"mdl:{mdl}", f"FY{fy} transferred / filed in transferee / closed / remanded / pending", seq, page, ex)

    done = [c for c in checks if c["match"] is not None]
    summary = {"checks": len(done), "matches": sum(1 for c in done if c["match"]), "mismatches": sum(1 for c in done if not c["match"]), "reports": len({c["report"] for c in done}), "values_checked": sum(len(c["displayed"]) if isinstance(c["displayed"], list) else 1 for c in done), "not_applicable": [c for c in checks if c["match"] is None]}
    (OUT / "spot_checks.json").write_text(json.dumps({"summary": summary, "checks": checks}, indent=1, ensure_ascii=False))
    print(json.dumps(summary, ensure_ascii=False)[:600])
    for c in checks:
        print(("OK " if c["match"] else "NO ") if c["match"] is not None else "-- ", c["dataset"], c["row"], c["field"], c["displayed"], "p." + str(c["pdf_page"]), (c["source_line"] or "")[:110])


if __name__ == "__main__":
    main()
