"""Spot checks: displayed figures in the build files against the raw source rows (bulk CSV rows read by id, archived API
responses read by hash). Each check names the value, where it is in the source and whether it matches.

    python3 -I -B spot_check_clb_1026.py
Writes private/build/clb_1026/spot_checks.json.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import clb1026_common as cm  # noqa: E402
import cl_api  # noqa: E402

OUT = cm.OUT


def rows_by_id(name: str, ids: set[str], key: str = "id") -> dict[str, dict]:
    return {r[key]: r for r in cm.pg_rows(cm.bulk_path(name)) if r[key] in ids}


def build(ds: str) -> dict[str, dict]:
    return {r["id"]: r for r in json.load(open(os.path.join(OUT, ds + ".json")))["rows"]}


def main() -> None:
    checks = []

    def check(what, shown, source_value, where):
        checks.append({"what": what, "shown": shown, "source": source_value, "where": where, "match": shown == source_value})

    people = build("clb_judge_people")
    pos = rows_by_id("people-db-positions-2026-09-30.csv.bz2", {"51", "44", "7378", "7377"})
    ppl = rows_by_id("people-db-people-2026-09-30.csv.bz2", {"43", "1213", "45"})
    edu = rows_by_id("people-db-educations-2026-09-30.csv.bz2", {"4"})
    sch = rows_by_id("people-db-schools-2026-09-30.csv.bz2", {"3832"})
    ab = people["45"]["item"]["profile"]
    p51 = next(p for p in ab["positions"] if p["id"] == 51)
    check("Abrams: confirmation date (position 51)", p51["dates"]["confirmation"], pos["51"]["date_confirmation"], "people-db-positions row id 51, date_confirmation")
    check("Abrams: Senate vote yes", p51["votes"]["yes"], int(pos["51"]["votes_yes"]), "people-db-positions row 51, votes_yes")
    check("Abrams: Senate vote no", p51["votes"]["no"], int(pos["51"]["votes_no"]), "people-db-positions row 51, votes_no")
    appointer_person = pos[pos["51"]["appointer_id"]]["person_id"]
    check("Abrams: appointer name (appointer position -> person)", p51["appointer"]["name"],
          " ".join(x for x in (ppl[appointer_person]["name_first"], ppl[appointer_person]["name_middle"], ppl[appointer_person]["name_last"]) if x) + (" II" if ppl[appointer_person]["name_suffix"] == "2" else ""),
          f"positions row 51 appointer_id {pos['51']['appointer_id']} -> positions row person_id {appointer_person} -> people row {appointer_person}")
    jd = next(e for e in ab["education"] if e["id"] == 4)
    check("Abrams: J.D. year", jd["year"], int(edu["4"]["degree_year"]), "people-db-educations row 4, degree_year")
    check("Abrams: J.D. school", jd["school"]["name"], sch[edu["4"]["school_id"]]["name"], f"educations row 4 school_id {edu['4']['school_id']} -> schools row, name")
    rbg = people["1213"]["item"]["profile"]
    p7378 = next(p for p in rbg["positions"] if p["id"] == 7378)
    check("Ginsburg: Supreme Court start", p7378["dates"]["start"], cm.show_date(pos["7378"]["date_start"], pos["7378"]["date_granularity_start"]), "positions row 7378, date_start at its granularity")
    check("Ginsburg: Supreme Court end", p7378["dates"]["termination"], cm.show_date(pos["7378"]["date_termination"], pos["7378"]["date_granularity_termination"]), "positions row 7378, date_termination")
    check("Ginsburg: birth year", rbg["birth_year"], int(ppl["1213"]["date_dob"][:4]), "people row 1213, date_dob (year only)")
    # ABA ratings: the archived page that holds rating ids 2 and 738/739
    idx = cl_api.load_index()
    aba_rows = {}
    for (m, u), rec in idx.items():
        if m == "GET" and "/aba-ratings/" in u and "count=on" not in u:
            for r in json.loads(cl_api.read_raw(rec["sha256"]))["results"]:
                aba_rows[r["id"]] = (r, rec["sha256"][:12])
    for pid, rid in (("45", 2), ("1213", 738), ("1213", 739)):
        shown = next(a for a in people[pid]["item"]["profile"]["aba_ratings"] if a["id"] == rid)
        src, sha = aba_rows[rid]
        check(f"ABA rating id {rid} (person {pid})", [shown["rating_code"], shown["year"]], [src["rating"], src["year_rated"]], f"aba-ratings API page sha256 {sha}…, result id {rid}")
    # disclosures
    items = build("clb_judge_disclosure_items")
    nii = rows_by_id("financial-disclosures-non-investment-income-2026-09-30.csv.bz2", {"9"})
    fdp = rows_by_id("financial-disclosures-positions-2026-09-30.csv.bz2", {"21"})
    debt = rows_by_id("financial-disclosures-debts-2026-09-30.csv.bz2", {"21"})
    reps = rows_by_id("financial-disclosures-2026-09-30.csv.bz2", {nii["9"]["financial_disclosure_id"], fdp["21"]["financial_disclosure_id"], debt["21"]["financial_disclosure_id"], "1108"})
    for label, row, key, field, shown_field in (("non-investment income row 9", nii["9"], "non_investment_income", "income_amount", "amount_as_filed"),
                                                ("outside position row 21", fdp["21"], "outside_positions", "position", "position"),
                                                ("debt row 21", debt["21"], "debts", "value_code", "value_code")):
        rep = reps[row["financial_disclosure_id"]]
        listed = items.get(rep["person_id"], {}).get("item", {}).get("profile", {}).get("listed", {}).get(key, [])
        hit = next((x for x in listed if x.get("report_id") == int(rep["id"]) and x.get(shown_field) == cm.clip(row[field])), None)
        check(f"{label}: listed as filed for person {rep['person_id']}", hit.get(shown_field) if hit else None, cm.clip(row[field]),
              f"{label.split(' row')[0]} file row {row['id']}, {field} (report {rep['id']})")
    r1108 = reps["1108"]
    pr = items[r1108["person_id"]]["item"]["profile"]
    y = next(v for v in pr["years"] if v.get("year") == int(r1108["year"]))
    # count investment lines of every report this person filed for that year, read straight from the raw files
    rep_ids = {r["id"] for r in cm.pg_rows(cm.bulk_path("financial-disclosures-2026-09-30.csv.bz2")) if r["person_id"] == r1108["person_id"] and r["year"] == r1108["year"]}
    inv = sum(1 for r in cm.pg_rows(cm.bulk_path("financial-disclosure-investments-2026-09-30.csv.bz2")) if r["financial_disclosure_id"] in rep_ids)
    check(f"person {r1108['person_id']} {r1108['year']}: investment lines", y["items"]["investments"], inv, f"investments file rows with financial_disclosure_id in {sorted(rep_ids)}")
    check(f"person {r1108['person_id']} {r1108['year']}: report type label", y["report_types"][0][1], cm.legends()["financial-disclosures"]["report_type"][r1108["report_type"]],
          "financial-disclosures row 1108 report_type with the OPTIONS legend")
    # appeals and search counts
    ap = build("clb_court_appeals_to")
    e5 = rows_by_id("court-appeals-to-2026-09-30.csv.bz2", {"5"})["5"]
    check("appeal edge 5", [ap["edge:5"]["item"]["profile"]["from"]["court_id"], ap["edge:5"]["item"]["profile"]["to"]["court_id"]], [e5["from_court_id"], e5["to_court_id"]], "court-appeals-to row 5")
    sc_path = os.path.join(OUT, "clb_search_counts.json")
    if os.path.exists(sc_path):
        sc = build("clb_search_counts")
        for rid, sel in (("year:all", lambda p: next(x for x in p["points"] if x["year"] == 2020)),
                         ("court:ca9", lambda p: p["total"]),
                         ("topic:qualified_immunity", lambda p: next(x for x in p["points"] if x["year"] == 2015))):
            if rid not in sc:
                continue
            pt = sel(sc[rid]["item"]["profile"])
            body = json.loads(cl_api.read_raw(pt["sha256"]))
            check(f"search count {rid} ({pt['q']})", pt["count"], body["count"], f"archived API response sha256 {pt['sha256'][:12]}…, retrieved {pt['retrieved_at']}")
    with open(os.path.join(OUT, "spot_checks.json"), "w") as h:
        json.dump(checks, h, indent=1, default=str)
    for c in checks:
        print("OK  " if c["match"] else "FAIL", c["what"], "|", c["shown"], "|", c["where"])
    print(f"{sum(c['match'] for c in checks)} of {len(checks)} match")


if __name__ == "__main__":
    main()
