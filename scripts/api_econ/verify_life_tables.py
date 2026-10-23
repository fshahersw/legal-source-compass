"""Prove the life-table parser against the published report: every age row of every table in the build, rounded the
way the NVSR report prints it (q(x) to six decimals; l(x), d(x), L(x), T(x) to whole numbers; e(x) to one decimal),
must equal the text of the report PDF (pdftotext -layout). Writes a JSON report; downloads each report PDF once to
private/acq/w1025_api-econ/nchs/pdf/ (hash recorded) and can delete them afterwards (--delete-pdfs).

  python3 -I -B scripts/api_econ/verify_life_tables.py [--years 2024,2023] [--delete-pdfs]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_life_tables as blt  # noqa: E402
import econ_common as ec  # noqa: E402

PDF_DIR = ec.ACQ / "nchs" / "pdf"


def q(v: str, places: str) -> str:
    return str(Decimal(v).quantize(Decimal(places), rounding=ROUND_HALF_UP))


def printed(row: list[str]) -> list[str]:
    age, qx, lx, dx, Lx, Tx, ex = row
    whole = lambda v: f"{int(Decimal(v).quantize(Decimal('1'), rounding=ROUND_HALF_UP)):,}"  # noqa: E731
    return [age, q(qx, "0.000001"), whole(lx), whole(dx), whole(Lx), whole(Tx), q(ex, "0.1")]


ROW = re.compile(r"^\s*(\d{1,3}\s*[\u2010-\u2015\u2212-]\s*\d{1,3}|\d{1,3} and (?:over|older))((?:\s?\.)*)\s+(\d[\d.,\s]*)$")


def pdf_tables(text: str) -> dict[int, dict[str, list[str]]]:
    """Table number -> age -> printed cells, from the layout text (continuation pages included)."""
    out: dict[int, dict[str, list[str]]] = {}
    current = None
    for line in text.splitlines():
        m = re.match(r"^\s*Table (\d+)\.? Life table for", line)
        if m:
            current = int(m.group(1))
            out.setdefault(current, {})
            continue
        if current is None:
            continue
        m = ROW.match(line.replace("–", "-"))
        if not m:
            continue
        age = re.sub(r"\s+", "", re.sub("[‐-―−]", "-", m.group(1))) if "and" not in m.group(1) else re.sub(r"\s+", " ", m.group(1)).replace(" and older", " and over")
        cells = re.findall(r"\d[\d,]*(?:\.\d+)?", m.group(3))
        if len(cells) == 6:
            out[current].setdefault(age, cells)
    return out


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default=",".join(str(y) for y in blt.REPORTS))
    ap.add_argument("--delete-pdfs", action="store_true")
    a = ap.parse_args(argv)
    http = ec.Http(min_interval=1.0)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    report = {"checked_rows": 0, "mismatches": [], "tables": 0, "pdfs": []}
    for y in [int(x) for x in a.years.split(",") if x]:
        vol, count, pdf_url, _ = blt.REPORTS[y]
        pdf = PDF_DIR / f"nvsr{vol}.pdf"
        if not pdf.exists():
            pdf.write_bytes(http.get(pdf_url))
        report["pdfs"].append({"url": pdf_url, "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "bytes": pdf.stat().st_size})
        text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
        tables = pdf_tables(text)
        for n in range(1, count + 1):
            title, rows = blt.parse_table(blt.raw_path(y, n))
            got = tables.get(n, {})
            report["tables"] += 1
            for row in rows:
                want = printed(row)
                cells = got.get(want[0])
                report["checked_rows"] += 1
                plain = lambda xs: [x.replace(",", "") for x in xs]  # noqa: E731
                if cells is None or plain(cells) != plain(want[1:]):
                    diff = None
                    if cells is not None and len(cells) == 6:
                        diff = [k for k, (a1, b1) in enumerate(zip(plain(cells), plain(want[1:]))) if a1 != b1]
                    report["mismatches"].append({"year": y, "table": n, "age": want[0], "workbook_rounded": want[1:], "pdf": cells,
                                                 "columns_differing": [blt.COLUMNS[1 + k] for k in diff] if diff else None,
                                                 "workbook": row[1:]})
                elif cells != want[1:]:
                    report.setdefault("format_only", []).append({"year": y, "table": n, "age": want[0], "note": "the PDF prints this row without thousands separators"})
        if a.delete_pdfs:
            pdf.unlink()
    out = ec.BUILD / "nchs" / "verify_life_tables.json"
    out.write_text(json.dumps(report, indent=1))
    print(json.dumps({"tables": report["tables"], "checked_rows": report["checked_rows"], "mismatches": len(report["mismatches"]),
                      "format_only": len(report.get("format_only", [])),
                      "sample": report["mismatches"][:5]}))


if __name__ == "__main__":
    main(sys.argv[1:])
