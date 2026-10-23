"""Check the USSC aggregates against the Commission's own published Statistical Information Packets.

For each (fiscal year, district) sample the packet PDF is downloaded once (private/acq/enforcement_extra/ussc/packets/,
manifest line), converted with pdftotext -layout, and these published cells are compared with the aggregates in
private/build/enforcement_extra/ussc_years/FY<y>.json:
  Table 1  individuals sentenced by type of crime (district N), and the TOTAL
  Table 5  sentence type TOTAL row for the district (prison only, prison+alternatives, probation+alternatives,
           probation only, fine only)
  Table 7  mean and median sentence length (months, rounded by USSC to whole months), TOTAL and per type of crime
  Table 8  within-range count and percentage, and upward departure + upward variance for the district

  python3 -I -B verify_ussc.py            prints every comparison and a failure count; exits 1 on any mismatch
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

from common import ACQ, BUILD, download, latest_manifest
from ussc_codes import DISTRICTS

PACKET_URL = "https://www.ussc.gov/sites/default/files/pdf/research-and-publications/federal-sentencing-statistics/state-district-circuit/{fy}/{code}{yy}.pdf"
# (fiscal year, USSC packet file code, USSC DISTRICT code)
SAMPLES = [(2025, "txs", 41), (2025, "nys", 8), (2025, "az", 70), (2025, "iln", 52), (2024, "flm", 30), (2022, "cac", 73)]
# Packet row labels that differ from the codebook's OFFGUIDE labels
PACKET_TO_OFFGUIDE = {"Money Laundering": "Money Launder", "Sexual Abuse": "Sex Abuse"}
SENTENCE_TYPE_ORDER = ["1", "2", "3", "4", "0"]  # prison only, prison+alt, probation+alt, probation only, fine only


def num(s: str) -> int:
    return int(s.replace(",", ""))


def packet_text(fy: int, code: str) -> tuple[str, str]:
    yy = f"{fy % 100:02d}"
    url = PACKET_URL.format(fy=fy, code=code, yy=yy)
    pdf = os.path.join(ACQ, "ussc", "packets", f"{code}{yy}.pdf")
    if not os.path.exists(pdf):
        download(url, pdf, method="direct GET", min_interval=2.0)
    out = subprocess.run(["pdftotext", "-layout", pdf, "-"], check=True, capture_output=True, text=True).stdout
    return url, out


def section(text: str, title: str) -> str:
    i = text.find(title)
    if i < 0:
        return ""
    j = text.find("SOURCE:", i)
    return text[i:j if j > 0 else len(text)]


def offense_rows(block: str) -> dict[str, list[str]]:
    rows = {}
    for line in block.splitlines():
        m = re.match(r"^([A-Z][A-Za-z/ ,.'-]+?)\s{2,}((?:[\d,.\-]+\s+)*[\d,.\-]+)\s*$", line.strip())
        if m:
            rows[m.group(1).strip()] = m.group(2).split()
    return rows


def compare(fy: int, code: str, dcode: int, checks: list) -> None:
    url, text = packet_text(fy, code)
    with open(os.path.join(BUILD, "ussc_years", f"FY{fy}.json"), encoding="utf-8") as f:
        y = json.load(f)
    unit = y["districts"][str(dcode)]
    total = unit["total"]
    by_label = {o["label"]: o for o in unit["offenses"]}
    where = f"FY{fy} {DISTRICTS[dcode][3]} ({url.rsplit('/', 1)[-1]})"

    def check(what, published, ours):
        checks.append({"where": where, "what": what, "published": published, "ours": ours, "match": published == ours})

    t1 = offense_rows(section(text, "DISTRIBUTION OF SENTENCED INDIVIDUALS"))
    if "TOTAL" in t1:
        check("Table 1 TOTAL individuals", num(t1["TOTAL"][2]), total["cases"])
    for label, vals in t1.items():
        if label == "TOTAL" or len(vals) < 4:
            continue
        ours = by_label.get(PACKET_TO_OFFGUIDE.get(label, label))
        check(f"Table 1 {label}", num(vals[2]), ours["cases"] if ours else 0)
    t5 = section(text, "SENTENCE TYPE BY TYPE OF CRIME\n")
    # the district table is the second "SENTENCE TYPE BY TYPE OF CRIME" section (Table 5)
    parts = text.split("SENTENCE TYPE BY TYPE OF CRIME")
    if len(parts) >= 3:
        rows5 = offense_rows(parts[2].split("SOURCE:")[0])
        if "TOTAL" in rows5:
            v = rows5["TOTAL"]
            published = [num(v[i]) for i in (1, 3, 5, 7, 9)] if len(v) >= 10 else None
            ours = [total["sentence_types"].get(k, 0) for k in SENTENCE_TYPE_ORDER]
            check("Table 5 sentence types (prison, prison+alt, probation+alt, probation, fine)", published, ours)
    t7 = offense_rows(section(text, "SENTENCE LENGTH BY TYPE OF CRIME"))
    for label, vals in t7.items():
        if len(vals) < 6:
            continue
        mean_s, median_s = vals[3], vals[4]
        cell = total if label == "TOTAL" else by_label.get(PACKET_TO_OFFGUIDE.get(label, label))
        if mean_s == "--" or cell is None:
            continue
        check(f"Table 7 {label} mean months", int(mean_s), None if cell["sentence_mean"] is None else round_half_up(cell["sentence_mean"]))
        check(f"Table 7 {label} median months", int(median_s), None if cell["sentence_median"] is None else round_half_up(cell["sentence_median"]))
    t8 = section(text, "SENTENCE IMPOSED RELATIVE TO THE GUIDELINE RANGE")
    m = re.search(r"TOTAL CASES\s+([\d,]+)\s+[\d.]+\s+([\d,]+)", t8)
    if m:
        check("Table 8 cases with a range comparison", num(m.group(2)), total["range_valid"])
    m = re.search(r"Within Guideline Range\s+([\d,]+)\s+([\d.]+)\s+([\d,]+)\s+([\d.]+)", t8)
    if m:
        check("Table 8 within range N", num(m.group(3)), total["within"])
        check("Table 8 within range %", float(m.group(4)), total["within_pct"])
    up_dep = re.search(r"Upward Departure\S*\s+([\d,]+)\s+[\d.]+\s+([\d,]+)", t8)
    up_var = re.search(r"Upward Variance\S*\s+([\d,]+)\s+[\d.]+\s+([\d,]+)", t8)
    if up_dep and up_var:
        check("Table 8 above range N (upward departure + upward variance)", num(up_dep.group(2)) + num(up_var.group(2)), total["above"])


def round_half_up(x: float) -> int:
    return int(x + 0.5)


def main() -> int:
    checks: list = []
    for fy, code, dcode in SAMPLES:
        try:
            compare(fy, code, dcode, checks)
        except FileNotFoundError as err:
            print(f"skip FY{fy} {code}: {err}")
    bad = [c for c in checks if not c["match"]]
    for c in checks:
        print(("OK  " if c["match"] else "DIFF"), c["where"], "|", c["what"], "| published", c["published"], "| ours", c["ours"])
    print(json.dumps({"checks": len(checks), "mismatches": len(bad)}))
    out = os.path.join(BUILD, "verify_ussc.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"checks": checks, "mismatches": len(bad)}, f, indent=1)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
