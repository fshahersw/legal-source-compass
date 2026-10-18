"""Independent spot checks: recompute displayed figures straight from the raw DOL files with separate, minimal code
(no imports from the builder) and compare with private/build/osha/*.json.

Usage: python3 -I -B scripts/enrichment/osha/verify_osha.py [activity_nr | match:<REPORTING_ID>:<YYYY-MM-DD>:<name fragment> ...]
Writes private/build/osha/spot_checks.json; extra inspections (by ACTIVITY_NR, or resolved by report ID + open date + name fragment)
are dumped with their raw inspection and violation rows so they can be compared with the osha.gov establishment pages.
"""
import csv
import glob
import gzip
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "osha", "dol")
OUT = os.path.join(ROOT, "private", "build", "osha")


def rows(folder):
    for path in sorted(glob.glob(os.path.join(ACQ, folder, "*.csv.gz"))):
        with gzip.open(path, "rt", encoding="utf-8-sig", errors="replace", newline="") as handle:
            for row in csv.DictReader(handle):
                yield os.path.basename(path), row


def fy_of(text):
    text = (text or "").strip()
    if len(text) < 10 or not text[:4].isdigit():
        return None
    year, month = int(text[:4]), int(text[5:7])
    return year + 1 if month >= 10 else year


def amount(text):
    text = (text or "").strip()
    try:
        value = float(text)
    except ValueError:
        return 0.0
    return 0.0 if value != value else value


def main(extra):
    states = {r["id"].split(":")[1]: r["item"]["profile"] for r in json.load(open(os.path.join(OUT, "osha_inspections_states.json")))["rows"]}
    national = {r["id"].split(":")[1]: r["item"] for r in json.load(open(os.path.join(OUT, "osha_inspections_national.json")))["rows"]}
    employers = json.load(open(os.path.join(OUT, "osha_employers.json")))["rows"]
    year = lambda code, fy: next(e for e in states[code]["years"] if e["fy"] == fy)  # noqa: E731
    top = {e["item"]["employer"]["rank"]: e["item"]["employer"] for e in employers if e["item"]["employer"]["rank"] in (1, 2, 10, 250)}
    top_names = {e["name"]: rank for rank, e in top.items()}
    wanted_extra = {a for a in extra if not a.startswith("match:")}
    matchers = [a.split(":", 3)[1:] for a in extra if a.startswith("match:")]

    # raw pass 1: inspections
    count = {}
    aid_sets = {}
    days = []
    raw_extra = {}
    file_of = {}

    def bump(key, n=1):
        count[key] = count.get(key, 0) + n

    def tag(key, aid):
        aid_sets.setdefault(key, set()).add(aid)

    for fname, row in rows("inspection"):
        aid = row["ACTIVITY_NR"].strip()
        fy = fy_of(row["OPEN_DATE"])
        st = row["SITE_STATE"].strip().upper()
        itype = row["INSP_TYPE"].strip()
        rid = row["REPORTING_ID"].strip()
        if aid not in wanted_extra:
            for rid_want, day_want, frag in matchers:
                if rid == rid_want and row["OPEN_DATE"][:10] == day_want and frag.upper() in row["ESTAB_NAME"].upper():
                    wanted_extra.add(aid)
        if aid in wanted_extra:
            raw_extra[aid] = {"file": fname, "row": row, "violations": []}
        if fy == 2025:
            bump(("US", 2025, "inspections"))
            tag(("US", 2025), aid)
            if itype == "M":
                bump(("US", 2025, "fat_cat"))
            if st == "TX":
                bump(("TX", 2025, "inspections"))
            if st == "PR":
                bump(("PR", 2025, "inspections"))
            if st == "NY" and rid[2:3] == "5":
                bump(("NY", 2025, "state_plan"))
            if st == "WA" and len(rid) >= 3 and rid[2] != "5":
                bump(("WA", 2025, "federal"))
            if st in ("CA", "FL"):
                tag((st, 2025), aid)
            close = row["CLOSE_CASE_DATE"].strip()
            if close[:4].isdigit() and int(close[:4]) >= 1970:
                import datetime
                d = (datetime.date(int(close[:4]), int(close[5:7]), int(close[8:10])) - datetime.date(int(row["OPEN_DATE"][:4]), int(row["OPEN_DATE"][5:7]), int(row["OPEN_DATE"][8:10]))).days
                if d >= 0:
                    days.append(d)
        if fy == 2024:
            tag(("US", 2024), aid)
        if fy == 2010:
            bump(("US", 2010, "inspections"))
        if fy == 2020 and st == "OH" and itype in "ABCDFGJMN" and itype:
            bump(("OH", 2020, "unprogrammed"))
        if fy is not None and 2017 <= fy <= 2026 and row["ESTAB_NAME"].strip() in top_names:
            tag(("EMP", top_names[row["ESTAB_NAME"].strip()]), aid)
            bump(("EMP", top_names[row["ESTAB_NAME"].strip()], "inspections"))
    # raw pass 2: violations
    owner = {}
    for key, aids in aid_sets.items():
        for aid in aids:
            owner.setdefault(aid, []).append(key)
    seen_groups = set()
    for fname, row in rows("violation"):
        aid = row["ACTIVITY_NR"].strip()
        if aid in raw_extra:
            raw_extra[aid]["violations"].append({"file": fname, **{k: row[k] for k in ("CITATION_ID", "DELETE_FLAG", "STANDARD", "VIOL_TYPE", "ISSUANCE_DATE", "INITIAL_PENALTY", "CURRENT_PENALTY")}})
        if row["DELETE_FLAG"].strip().upper() == "X" or aid not in owner:
            continue
        cid = row["CITATION_ID"].strip()
        new_item = True
        if len(cid) > 5:   # lettered item group: count the citation item once per inspection
            if (aid, cid[:5]) in seen_groups:
                new_item = False
            seen_groups.add((aid, cid[:5]))
        for key in owner[aid]:
            bump(key + ("current",), amount(row["CURRENT_PENALTY"]))
            bump(key + ("initial",), amount(row["INITIAL_PENALTY"]))
            bump(key + ("type", row["VIOL_TYPE"].strip().upper()))
            if new_item:
                bump(key + ("item", row["VIOL_TYPE"].strip().upper()))
    days.sort()
    n = len(days)
    median_days = (days[n // 2] if n % 2 else (days[n // 2 - 1] + days[n // 2]) / 2) if n else None

    checks = [
        ("National FY2025 inspections", national["FY2025"]["year"]["inspections"], count.get(("US", 2025, "inspections"))),
        ("National FY2025 fatality/catastrophe (M) inspections", national["FY2025"]["year"]["fat_cat"], count.get(("US", 2025, "fat_cat"))),
        ("National FY2025 serious violations", national["FY2025"]["year"]["violations"]["serious"], count.get(("US", 2025, "type", "S"), 0)),
        ("National FY2025 current penalties ($)", national["FY2025"]["year"]["current_penalty"], round(count.get(("US", 2025, "current"), 0.0), 2)),
        ("National FY2024 initial penalties ($)", national["FY2024"]["year"]["initial_penalty"], round(count.get(("US", 2024, "initial"), 0.0), 2)),
        ("National FY2025 serious violation items (lettered groups counted once)", national["FY2025"]["year"]["items_by_type"]["serious"], count.get(("US", 2025, "item", "S"), 0)),
        ("National FY2025 total violation records", national["FY2025"]["year"]["violation_records"], sum(v for k, v in count.items() if k[:2] == ("US", 2025) and len(k) == 4 and k[2] == "type")),
        ("CA FY2025 repeat violation items", year("CA", 2025)["items_by_type"]["repeat"], count.get(("CA", 2025, "item", "R"), 0)),
        ("National FY2024 willful violations", national["FY2024"]["year"]["violations"]["willful"], count.get(("US", 2024, "type", "W"), 0)),
        ("National FY2025 median days to close", national["FY2025"]["year"]["median_days_to_close"], median_days),
        ("National FY2010 inspections", national["FY2010"]["year"]["inspections"], count.get(("US", 2010, "inspections"))),
        ("TX FY2025 inspections", year("TX", 2025)["inspections"], count.get(("TX", 2025, "inspections"))),
        ("PR FY2025 inspections", year("PR", 2025)["inspections"], count.get(("PR", 2025, "inspections"))),
        ("NY FY2025 State Plan inspections", year("NY", 2025)["state_plan"], count.get(("NY", 2025, "state_plan"))),
        ("WA FY2025 federal inspections", year("WA", 2025)["federal"], count.get(("WA", 2025, "federal"))),
        ("OH FY2020 unprogrammed inspections", year("OH", 2020)["unprogrammed"], count.get(("OH", 2020, "unprogrammed"))),
        ("CA FY2025 current penalties ($)", year("CA", 2025)["current_penalty"], round(count.get(("CA", 2025, "current"), 0.0), 2)),
        ("FL FY2025 repeat violations", year("FL", 2025)["violations"]["repeat"], count.get(("FL", 2025, "type", "R"), 0)),
    ]
    for rank, emp in sorted(top.items()):
        checks.append((f"Employer #{rank} '{emp['name']}' current penalties ($)", emp["current_penalty"], round(count.get(("EMP", rank, "current"), 0.0), 2)))
        checks.append((f"Employer #{rank} '{emp['name']}' inspections", emp["inspections"], count.get(("EMP", rank, "inspections"))))
    results = []
    for label, shown, raw in checks:
        ok = raw is not None and shown is not None and abs(float(shown) - float(raw)) < 0.01
        results.append({"check": label, "displayed": shown, "raw_recomputed": raw, "match": ok})
        print(("OK  " if ok else "MISMATCH ") + f"{label}: displayed={shown} raw={raw}")
    with open(os.path.join(OUT, "spot_checks.json"), "w") as handle:
        json.dump({"checks": results, "raw_inspections": raw_extra}, handle, indent=1, default=str)
    for aid, data in raw_extra.items():
        r = data["row"]
        live = [v for v in data["violations"] if v["DELETE_FLAG"].strip().upper() != "X"]
        print("INSPECTION", aid, data["file"], r["ESTAB_NAME"], r["SITE_CITY"], r["SITE_STATE"], "rid", r["REPORTING_ID"], "type", r["INSP_TYPE"],
              "scope", r["INSP_SCOPE"], "owner", r["OWNER_TYPE"], "open", r["OPEN_DATE"][:10], "close", r["CLOSE_CASE_DATE"][:10], "naics", r["NAICS_CODE"],
              "| violations", len(live), "initial", sum(amount(v["INITIAL_PENALTY"]) for v in live), "current", sum(amount(v["CURRENT_PENALTY"]) for v in live),
              "types", sorted(v["VIOL_TYPE"] for v in live))


if __name__ == "__main__":
    main(sys.argv[1:])
