"""Spot checks for osha_severe_injuries.json: displayed values vs the values printed in OSHA's PDFs.

The expected values below were typed from the Firecrawl reads of the PDFs themselves (page text quoted in the comment), not parsed
from the saved capture the builder uses, so a transcription slip in the capture would show up as a mismatch here.
There is no raw record-level file for these figures (the SIR zip is bot-walled), so this checks transcription fidelity only.

Usage: python3 -I -B scripts/enrichment/osha/verify_sir.py     (writes private/build/osha/spot_checks_sir.json)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "private", "build", "osha")

# (row id, path inside the row's item, expected, where it is printed)
CHECKS = [
    ("osha-sir:state:AL", ("state", "total"), 2315, "Seven-Year Lookback p.6 Table 2, Alabama Total '2,315'"),
    ("osha-sir:state:AL", ("state", "rate_per_100k_fte_per_year"), 17.4, "Table 2, Alabama rate '17.4'"),
    ("osha-sir:state:NY", ("state", "total"), 3541, "Table 2, New York Total '3,541'"),
    ("osha-sir:state:NY", ("state", "by_year", "2018"), 579, "Table 2, New York 2018 '579'"),
    ("osha-sir:state:FL", ("state", "by_year", "2017"), 1099, "Table 2, Florida 2017 '1,099'"),
    ("osha-sir:state:DC", ("state", "total"), 220, "Table 2, District of Columbia Total '220'"),
    ("osha-sir:state:GU", ("state", "total"), 28, "p.4 text 'Guam (n=28)' and Table 2 Guam Total '28'"),
    ("osha-sir:state:PR", ("state", "total"), 11, "p.4 text 'Puerto Rico (n=11)'"),
    ("osha-sir:state:ND", ("state", "rate_per_100k_fte_per_year"), 21.9, "p.4 text 'North Dakota ... (21.9 per 100,000 FTE workers)'"),
    ("osha-sir:year:2024", ("year", "reports"), 9034, "2024 Annual Report p.2 'a total of 9,034 Severe Injury Reports'"),
    ("osha-sir:year:2024", ("year", "hospitalized"), 7327, "2024 Annual Report p.2 '7,327 Inpatient hospitalizations'"),
    ("osha-sir:year:2024", ("year", "amputations"), 2426, "2024 Annual Report p.2 '2,426 Amputations'"),
    ("osha-sir:year:2019", ("year", "reports"), 11075, "Dashboard chart text '2019 Total Reports: 11075'"),
    ("osha-sir:year:2019", ("year", "hospitalized"), 9070, "Dashboard chart text '2019 Total Hospitalized: 9070'"),
    ("osha-sir:year:2023", ("year", "eye_losses"), 8, "Dashboard chart text '2023 Total Loss of Eye(s): 8'"),
    ("osha-sir:sector:31-33", ("sector", "hospitalizations_2024"), 1865, "2024 Annual Report p.3 table, Manufacturing 2024 hospitalizations '1,865'"),
    ("osha-sir:sector:31-33", ("sector", "amputations_2024"), 1348, "2024 Annual Report p.3 table, Manufacturing 2024 amputations '1,348'"),
    ("osha-sir:sector:23", ("sector", "rate_2024"), 21.1, "2024 Annual Report p.4 text 'dropping from 25.9 to 21.1 incidents per 100,000 FTE'"),
    ("osha-sir:sector:23", ("sector", "rate_avg_2015_2023"), 25.9, "same sentence"),
    ("osha-sir:sector:23", ("sector", "body_parts_2015_2021", "Multiple body parts"), 1797, "Lookback Table 3, Construction 'Multiple body parts 1,797'"),
    ("osha-sir:sector:31-33", ("sector", "body_parts_2015_2021", "Upper extremities"), 14000, "Lookback Table 3, Manufacturing 'Upper extremities 14,000'"),
    ("osha-sir:summary", ("profile", "body_part_totals_2015_2021", "reports"), 70206, "56,696 + 18,559 - 5,049 (Lookback p.2 text)"),
]


def dig(obj, path):
    for key in path:
        obj = obj[key]
    return obj


def main():
    with open(os.path.join(OUT, "osha_severe_injuries.json"), encoding="utf-8") as handle:
        rows = {r["id"]: r for r in json.load(handle)["rows"]}
    results, bad = [], 0
    for rid, path, expected, where in CHECKS:
        shown = dig(rows[rid]["item"], path)
        ok = abs(float(shown) - float(expected)) < 1e-9
        bad += not ok
        results.append({"row": rid, "field": ".".join(path), "displayed": shown, "printed_in_source": expected, "where": where, "match": ok})
        print(("OK  " if ok else "MISMATCH ") + f"{rid} {'.'.join(path)}: displayed={shown} source={expected}  [{where}]")
    with open(os.path.join(OUT, "spot_checks_sir.json"), "w", encoding="utf-8") as handle:
        json.dump({"checks": results, "mismatches": bad}, handle, indent=1)
    print(f"{len(results)} checks, {bad} mismatches")


if __name__ == "__main__":
    main()
