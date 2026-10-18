"""Parse CPSC's published "NEISS Data Highlights" tables (estimate, CV, number of injuries per product grouping).

Source files: private/acq/neiss/docs/NEISS-Data-Highlights-<year>.pdf (https://www.cpsc.gov/cgibin/NEISSQuery/Data/Highlights/<year>/...).
The PDFs are converted with `pdftotext -layout`; only the first three numeric columns of each row are used:
  Product Grouping | Estimated Number of Injuries | CV | Number of Injuries (cases)
Rows whose numbers do not parse cleanly are skipped (the PDFs contain a few typographical slips; they are never repaired).
"""
import re
import subprocess

ROW_RE = re.compile(r"^\s*([A-Za-z][^\d]*?)\s{2,}(\d{1,3}(?:,\d{3})*)\s+(\.\d{2})\s+(\d{1,3}(?:,\d{3})*)\s")


def pdf_text(path):
    return subprocess.run(["pdftotext", "-layout", path, "-"], check=True, capture_output=True, text=True).stdout


def parse_highlights(text):
    """Return [{group, estimate, cv, cases}] for rows with est, CV (.dd) and cases."""
    rows = []
    for line in text.splitlines():
        m = ROW_RE.match(line)
        if not m:
            continue
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        rows.append({"group": name, "estimate": int(m.group(2).replace(",", "")), "cv": float(m.group(3)),
                     "cases": int(m.group(4).replace(",", ""))})
    return rows
