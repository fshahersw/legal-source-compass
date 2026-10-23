"""List the tables whose earlier (PDF-only) editions can be read against a workbook reference, and how many PDFs that is.

A table qualifies when its workbook editions parse as a district, bankruptcy or appeals table (one row per court) and the
listing holds PDF-only editions of the same table number. Prints a comma list for acquire.py --tables and the PDF counts per
publication. Usage: python3 -I -B plan_pdf.py [--min-xlsx 3]
"""
import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

PARSED = F.ROOT / "private" / "build" / "uscourts_tables" / "parsed"


def court_tables(min_xlsx):
    seen = defaultdict(set)
    count = Counter()
    for path in PARSED.glob("*/*/*.json.gz"):
        doc = json.loads(gzip.decompress(path.read_bytes()))
        for n in doc["sheets"]:
            if n["scope"] in ("district", "bankruptcy", "appeals"):
                seen[doc["source"]["table"]].add(n["scope"])
                count[doc["source"]["table"]] += 1
    return {t: sorted(s) for t, s in seen.items() if count[t] >= min_xlsx}


def main():
    min_xlsx = int(sys.argv[sys.argv.index("--min-xlsx") + 1]) if "--min-xlsx" in sys.argv else 3
    tables = court_tables(min_xlsx)
    listing = json.loads((F.ACQ / "listing_index.json").read_text())
    per_pub = Counter()
    per_table = Counter()
    for pn, name in (("77", "JB"), ("78", "STFJ"), ("79", "FJCS"), ("32", "BF")):
        for e in listing.get(pn, {}).get("tables", []):
            if e["table"] not in tables:
                continue
            has_book = any(f.lower().endswith((".xlsx", ".xls")) for f in e["files"])
            has_pdf = any(f.lower().endswith(".pdf") for f in e["files"])
            if has_pdf and not has_book:
                per_pub[name] += 1
                per_table[e["table"]] += 1
    print("tables with workbook editions as court tables:", len(tables))
    print("PDF-only editions:", dict(per_pub), "total", sum(per_pub.values()))
    print(",".join(sorted(tables)))
    print({t: per_table[t] for t in sorted(per_table)})


if __name__ == "__main__":
    main()
