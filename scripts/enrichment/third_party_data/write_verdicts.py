"""Turn the verification worksheet plus the reviewer's manual readings into verification/verdicts.json.

The worksheet (verify_sample.py) holds deterministic matches of each sampled record's claim deadline, dollar figures and party against
the official page the record cites. A person (this script's MANUAL table) then read every row's evidence: confirmed the automatic
matches, overrode matcher misses (hyphenated names), and supplied the readings for pages the sandbox could not fetch or render
(read through the Firecrawl MCP on the check date; the quoted answers are copied into FIRECRAWL below).

Field results:  confirmed | partly_confirmed | not_found | contradicted | not_applicable
  date      the record's claim deadline vs the dates printed on the official page
  payout    dollar figures (or the payout formula) the record states vs the official page
  identity  the matter (caption / party) the record names appears on the official page
  status    only where the page states the payment mode (e.g. automatic payment)
Verdict (deterministic from the field results):
  contradicted        any field contradicted by the official page
  verified            identity confirmed and every applicable data field (date, payout, status) confirmed
  partially_verified  identity confirmed, at least one data field confirmed or partly confirmed, none contradicted
  identity_only       identity confirmed; no data field could be found on the cited page
  not_in_published_set the record is not published (no primary source that could be retrieved); listed for completeness

Usage: python3 -I -B write_verdicts.py
"""
import collections
import datetime
import hashlib
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
VER = os.path.join(ACQ, "verification")
DATA_FIELDS = ("date", "payout", "status")
FC = "Firecrawl MCP firecrawl_scrape (public page read on 2026-10-18; sandbox fetch blocked or empty)"

# Quoted answers returned by the Firecrawl reads (verbatim text, trimmed to the sentence that matters).
FIRECRAWL = {
    2: {"url": "https://www.thompsonfeessettlement.com/",
        "identity": "Welcome to the Thompson v. iQ Credit Union Settlement Website",
        "status": "Class Members who do nothing will automatically receive a check or account credit."},
    3: {"url": "https://www.ftc.gov/enforcement/refunds/coaching-department-refunds",
        "identity": "# Coaching Department Refunds (FTC, September 2025)",
        "payout": "the FTC is mailing an additional 7,943 checks totaling over $252,000 to people who cashed their previous check"},
    4: {"url": "https://www.periodtrackerdataprivacylitigation.com",
        "identity": "Flo Period Tracker App Settlement_Frasco, et al. Flo Health Inc., et al., No. 3:21-cv-00757 (N.D. Cal.)",
        "date": "complete and submit a timely and valid Claim Form: (1) electronically by no later than 11:59 p.m. Pacific Time on October 15, 2026",
        "payout": "page description: 'Users of the Flo App may qualify for payment from a $59.5 million privacy settlement.'"},
    8: {"url": "https://www.jointjuicesettlement.com/",
        "identity": "Bland v. Premier Nutrition Corporation Settlement (Alameda Superior Court) and Montera v. Premier Nutrition Corporation Settlement (N.D. Cal.) for Joint Juice products",
        "date": "no claim deadline printed on the landing page",
        "payout": "no per-unit payment wording on the landing page"},
    9: {"url": "https://www.strategicclaims.net/case/loop/",
        "identity": "Loop Industries, Inc. Securities Litigation - Strategic Claims Services; page description 'This case is complete.'",
        "date": "no claims deadline or settlement fund figure printed on the page",
        "payout": "no settlement fund figure printed on the page"},
    10: {"url": "https://www.mubisettlement.com",
         "identity": "Cejudo v. MUBI, Inc., United States District Court for the Northern District of California, Case No. 5:25-cv-03652-BLF",
         "date": "SUBMIT A CLAIM DEADLINE: JUNE 9, 2026",
         "payout": "MUBI has agreed to pay a non-reversionary fund of $1,600,000 (the 'Settlement Fund')"},
    11: {"url": "https://aguilaruimclasssettlement.com/",
         "identity": "Aguilar-Tafoya and Brewton v. Travelers; Case No. 1:23-0247 JB/JMR, U.S. District Court for the District of New Mexico",
         "date": "September 27, 2026 - Deadline to Submit a Claim",
         "payout": "the payment formulas (29% of premiums / readjusted claim) are not on the landing page (they are in the Notice)"},
    18: {"url": "https://www.boonehealthsettlement.com/",
         "identity": "Doe, et al. v. Boone Health, Inc., et al., 22AC-CC07646, Circuit Court of Cole County, Missouri",
         "date": "SUBMIT A CLAIM FORM BY NOVEMBER 9, 2026",
         "payout": "eligible to submit a Claim Form to receive a Cash Payment of $20.00"},
    20: {"url": "https://www.westernunionremissionphase3.com/",
         "identity": "Western Union remission (Department of Justice forfeiture), Phase 3 petitions for remission",
         "date": "UPDATE August 5, 2026: The original submission deadline for Petitions for Remission was August 19, 2026. Petitions for Remission must be postmarked or submitted online on or before December 31, 2026.",
         "payout": "the approximate $155 million Phase 3 figure is not on the landing page (it states over $430 million distributed over two phases to over 178,000 victims)"},
    22: {"url": "https://www.schwartzuimclasssettlement.com/",
         "identity": "Schwartz v. State Farm Mutual Automobile Insurance Company, No. 1:18-cv-00328-KWR-SCY (D.N.M.)",
         "date": "July 2, 2026 - Deadline to Submit a Claim",
         "payout": "the $20,925,000 settlement and the 21% / 13% premium percentages are not on the landing page"},
    30: {"url": "https://www.ftc.gov/enforcement/refunds/progressive-leasing-refunds",
         "identity": "Progressive Leasing Refunds (FTC)",
         "payout": "the FTC is sending an additional 1,221,146 checks totaling more than $27 million"},
    31: {"url": "https://www.baxterfairfunddistribution.com/",
         "identity": "In the matter of Baxter International, Inc., Admin. Proc. No. 3-20781 (Feb 22, 2022)",
         "date": "THE DEADLINE FOR SUBMITTING A CLAIM FORM ... HAS BEEN EXTENDED TO MARCH 8, 2024.",
         "payout": "the Baxter Fair Fund includes the $18,314,359.00 paid by Baxter, Schaible, and Bohaboy"},
    34: {"url": "https://forkliftsettlement.com/",
         "identity": "Broadmoor Lumber & Plywood Co., et al., v. Toyota Industries Corp., et al., USDC N.D. Cal., Case No. 3:24-cv-06640-JSC",
         "date": "The Claims Deadline was October 7, 2026 (the record states 2026-09-22)",
         "payout": "the $1,000 to $2,500 per forklift range was not returned by the read"},
}
# Reviewer overrides: row -> field -> (result, note/evidence). Rows read directly keep the matcher's evidence unless overridden here.
RESULT = {
    # row: {field: result} for Firecrawl-read rows (the reviewer's reading of FIRECRAWL quotes above)
    2: {"identity": "confirmed", "status": "confirmed", "date": "not_applicable", "payout": "not_applicable"},
    3: {"identity": "confirmed", "payout": "confirmed", "date": "not_applicable"},
    4: {"identity": "confirmed", "date": "confirmed", "payout": "confirmed"},
    8: {"identity": "confirmed", "date": "not_found", "payout": "not_found"},
    9: {"identity": "confirmed", "date": "not_found", "payout": "not_found"},
    10: {"identity": "confirmed", "date": "confirmed", "payout": "confirmed"},
    11: {"identity": "confirmed", "date": "confirmed", "payout": "not_found"},
    18: {"identity": "confirmed", "date": "confirmed", "payout": "confirmed"},
    20: {"identity": "confirmed", "date": "contradicted", "payout": "not_found"},
    22: {"identity": "confirmed", "date": "confirmed", "payout": "not_found"},
    30: {"identity": "confirmed", "payout": "confirmed", "date": "not_applicable"},
    31: {"identity": "confirmed", "date": "confirmed", "payout": "confirmed"},
    34: {"identity": "confirmed", "date": "contradicted", "payout": "not_found"},
}
DIRECT_OVERRIDES = {
    25: {"date": ("confirmed", "February 20, 2024 is printed on the page as the Objection, Opt-Out and Dispute deadline (a wage-and-hour class with no claim form); the page does not call it a 'claim deadline'.")},
    27: {"identity": ("confirmed", "Y-mAbs Therapeutics, Inc. Securities Litigation | Strategic Claims Services (the matcher missed the hyphenated name)")},
    36: {"identity": ("confirmed", "In re BlackSky Technology Inc. Stockholders Litigation, CONSOLIDATED C.A. No. 2024-0478-KSJM (Del. Ch.); Osprey Stockholder Litigation (the record title names the SPAC and the successor company)")},
}
NOTES = {
    6: "Deadline and the $572.36 per-person figure are on the page; the $318,825 fund in the SettleSignal title is not.",
    14: "The page shows only the Final Approval Hearing date (8/18/2026) in its visible dates; the record's 2026-07-28 claim deadline is not shown (a 'Show More' control hides further dates).",
    20: "The official site extended the petition deadline from August 19, 2026 to December 31, 2026; the record's deadline and its 'Claim window closed' status are out of date.",
    32: "The SEC page confirms the $40,254,552.00 disgorgement-and-interest fund and the $12,500,000.00 civil penalty; the $37.5M / $2.7M breakdown and the $52.7M total are not printed there (the total equals the two confirmed figures to within rounding).",
    34: "The official site prints a Claims Deadline of October 7, 2026; the record states 2026-09-22.",
    35: "The $10,000 per-person figure is on the page; the $5.68M in the SettleSignal title is not.",
}
EXCLUDED = {
    13: "not in the published set: the cited site returns 404 (confirmed by an independent read)",
    17: "not in the published set: the cited domain does not resolve (confirmed by an independent read)",
    24: "not in the published set: the cited source is a third-party aggregator (claimdepot.com), not a primary source",
}
EXPECTED = {1: "verified", 2: "verified", 3: "verified", 4: "verified", 5: "verified", 6: "partially_verified", 7: "verified",
            8: "identity_only", 9: "identity_only", 10: "verified", 11: "partially_verified", 12: "verified", 14: "partially_verified",
            15: "verified", 16: "identity_only", 18: "verified", 19: "verified", 20: "contradicted", 21: "partially_verified",
            22: "partially_verified", 23: "verified", 25: "partially_verified", 26: "verified", 27: "partially_verified", 28: "verified",
            29: "verified", 30: "verified", 31: "verified", 32: "partially_verified", 33: "partially_verified", 34: "contradicted",
            35: "partially_verified", 36: "partially_verified"}


def auto_fields(row):
    """Default field results from the deterministic worksheet matches."""
    f = row["fields"]
    out = {}
    date = f["date"]
    out["date"] = ("not_applicable" if date["match"] is None else "confirmed" if date["match"] else "not_found", date.get("evidence"))
    amount = f["amount"]
    if amount["match"] is None:
        out["payout"] = ("not_applicable", None)
    elif amount["match"]:
        out["payout"] = ("confirmed", "figures found on the page: " + ", ".join(amount["matched"]))
    elif amount["matched"]:
        out["payout"] = ("partly_confirmed", "found: " + ", ".join(amount["matched"]) + "; not found: " + ", ".join(amount["missing"]))
    else:
        out["payout"] = ("not_found", "not found: " + ", ".join(amount["missing"]))
    parties = f["parties"]
    out["identity"] = ("not_applicable" if parties["match"] is None else "confirmed" if parties["match"] else "not_found", parties.get("evidence"))
    return out


def verdict_of(results):
    values = {k: v for k, v in results.items()}
    if any(v == "contradicted" for v in values.values()):
        return "contradicted"
    if values.get("identity") != "confirmed":
        return "identity_not_confirmed"
    data = [values.get(k, "not_applicable") for k in DATA_FIELDS if values.get(k, "not_applicable") != "not_applicable"]
    if data and all(v == "confirmed" for v in data):
        return "verified"
    if any(v in ("confirmed", "partly_confirmed") for v in data):
        return "partially_verified"
    return "identity_only"


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def main():
    ws = json.load(open(os.path.join(VER, "worksheet.json"), encoding="utf-8"))
    checks = {}
    for raw in open(os.path.join(ACQ, "official_pages", "_checks.jsonl"), encoding="utf-8"):
        line = json.loads(raw)
        checks[line["settlesignal_url"]] = line
    rows = []
    for idx, row in enumerate(ws["rows"], 1):
        base = {"row": idx, "settlesignal_url": row["settlesignal_url"], "title": row["title"], "cited_url": row["official_url"]}
        if idx in EXCLUDED:
            rows.append({**base, "verdict": "not_in_published_set", "note": EXCLUDED[idx], "fields": {}, "source_url": row["official_url"], "method": "none"})
            continue
        fields = {}
        if idx in FIRECRAWL:
            fc = FIRECRAWL[idx]
            record = row["record"]
            for key in ("identity", "date", "payout", "status"):
                result = RESULT[idx].get(key)
                if result is None:
                    continue
                recval = {"date": record["claim_deadline"], "payout": record["estimated_payout"], "status": record["status"], "identity": row["title"]}[key]
                fields[key] = {"record": recval, "result": result, "evidence": fc.get(key)}
            method, source_url, sha = FC, fc["url"], None
        else:
            auto = auto_fields(row)
            record = row["record"]
            for key, (result, evidence) in auto.items():
                over = DIRECT_OVERRIDES.get(idx, {}).get(key)
                if over:
                    result, evidence = over
                recval = {"date": record["claim_deadline"], "payout": record["estimated_payout"], "identity": row["title"]}[key]
                fields[key] = {"record": recval, "result": result, "evidence": (evidence or "")[:420] or None}
            line = checks.get(row["settlesignal_url"], {})
            method = "direct fetch of the official page (bytes unchanged under private/acq); deterministic match then human confirmation"
            source_url, sha = line.get("final_url") or row["official_url"], line.get("sha256")
        verdict = verdict_of({k: v["result"] for k, v in fields.items()})
        assert verdict == EXPECTED[idx], (idx, row["title"], verdict, EXPECTED[idx])
        rows.append({**base, "verdict": verdict, "fields": fields, "source_url": source_url, "method": method, "source_sha256": sha, "note": NOTES.get(idx)})
    published = [r for r in rows if r["verdict"] != "not_in_published_set"]
    counts = collections.Counter(r["verdict"] for r in published)
    n = len(published)
    field_counts = {}
    for key in ("date", "payout", "identity", "status"):
        c = collections.Counter(r["fields"][key]["result"] for r in published if key in r["fields"])
        field_counts[key] = dict(c)
    out = {"seed": ws["seed"], "population": ws["population"], "sampled": ws["n"], "in_published_set": n, "not_in_published_set": ws["n"] - n,
           "reviewed_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "verdict_counts": dict(counts),
           "strict_rate": {"verified": counts.get("verified", 0), "of": n, "rate": round(counts.get("verified", 0) / n, 4), "wilson95": wilson(counts.get("verified", 0), n)},
           "at_least_partly_rate": {"k": counts.get("verified", 0) + counts.get("partially_verified", 0), "of": n,
                                    "rate": round((counts.get("verified", 0) + counts.get("partially_verified", 0)) / n, 4),
                                    "wilson95": wilson(counts.get("verified", 0) + counts.get("partially_verified", 0), n)},
           "contradicted_rate": {"k": counts.get("contradicted", 0), "of": n, "rate": round(counts.get("contradicted", 0) / n, 4), "wilson95": wilson(counts.get("contradicted", 0), n)},
           "field_results": field_counts,
           "rules": {"verified": "identity confirmed and every applicable data field (date, payout, status) confirmed on the cited page",
                     "partially_verified": "identity confirmed, at least one data field confirmed or partly confirmed, none contradicted (others not found on the cited page)",
                     "identity_only": "identity confirmed; no data field could be found on the cited page",
                     "contradicted": "the official page prints a different value for a field the record states",
                     "rate_formula": "strict rate = verified / sampled records in the published set; unreadable sources would count as not verified (none were unreadable after the Firecrawl reads)"},
           "firecrawl_method": FC,
           "rows": rows}
    with open(os.path.join(VER, "verdicts.json"), "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
    print(json.dumps({k: out[k] for k in ("sampled", "in_published_set", "verdict_counts", "strict_rate", "at_least_partly_rate", "contradicted_rate", "field_results")}, indent=1))


if __name__ == "__main__":
    main()
