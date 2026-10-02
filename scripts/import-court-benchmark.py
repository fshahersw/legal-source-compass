"""Derive Table C metrics from the unmodified official workbook; requires openpyxl."""
import hashlib
import json
from pathlib import Path
import re
import openpyxl

source = Path("public/data/quality/reference/uscourts-table-c-2025.xlsx")
sheet = openpyxl.load_workbook(source, data_only=True).active
columns = {"filed2024": 1, "filed2025": 2, "terminated2024": 4, "terminated2025": 5, "pending2024": 7, "pending2025": 8}
districts = []
total = None
notes = []
for row in sheet.values:
    label = row[0]
    if not isinstance(label, str):
        continue
    if label.startswith("NOTE:"):
        notes.append(label)
    if label == "Total" or re.fullmatch(r"[A-Z]{2,3}(?:,[A-Z]+)?[^A-Za-z0-9]*", label):
        counts = {}
        for name, index in columns.items():
            value = row[index]
            if not isinstance(value, (int, float)) or value != int(value):
                raise ValueError(f"Invalid count for {label}: {name}")
            counts[name] = int(value)
        if label == "Total":
            total = counts
        else:
            districts.append({"labelAsPublished": label, "jurisdictionCode": label.split(",")[0].replace("\ufffd", ""), **counts})
if total is None or len(districts) != 94:
    raise ValueError("Table C does not contain its national total and 94 district rows")
for name in columns:
    if sum(row[name] for row in districts) != total[name]:
        raise ValueError(f"District counts do not reconcile: {name}")
states = {}
for district in districts:
    code = district["jurisdictionCode"]
    counts = states.setdefault(code, {name: 0 for name in columns})
    for name in columns:
        counts[name] += district[name]
report = {
    "schemaVersion": 1,
    "title": "U.S. district court civil workload · Table C",
    "sourceUrl": "https://www.uscourts.gov/data-news/data-tables/2025/09/30/judicial-business/c",
    "downloadUrl": "https://www.uscourts.gov/sites/default/files/document/jb_c_0930.2025.xlsx",
    "reportingPeriodEnd": "2025-09-30",
    "period": "12-month periods ending September 30, 2024 and 2025",
    "sourceFile": {"path": "uscourts-table-c-2025.xlsx", "bytes": source.stat().st_size, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()},
    "qualification": "Publisher workload statistics for U.S. district court civil cases, separate from the saved corpus case catalog. Jurisdiction aggregates sum district rows only; circuit subtotals are excluded. Pending counts include MDL transfers. These figures do not establish case outcome probabilities or nationwide legal-data completeness.",
    "totals": total,
    "districts": districts,
    "jurisdictions": [{"code": code, **counts} for code, counts in sorted(states.items())],
    "notesAsPublished": notes,
}
output = source.with_name("uscourts-table-c-2025.json")
output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"output": str(output), "districts": len(districts), "jurisdictions": len(states), "totals": total}))
