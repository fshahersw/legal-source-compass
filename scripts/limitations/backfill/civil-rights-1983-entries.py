#!/usr/bin/env python3
"""Write civil_rights_1983 matrix entries from each state's personal-injury capture (pi-<st>).

42 U.S.C. § 1983 has no federal limitations period; federal courts borrow the forum state's general or residual
personal-injury statute (Owens v. Okure, 488 U.S. 235 (1989); captured as US/cr-us-owens-okure-1989). Each entry quotes
the state's statute literally from the fresh capture and is marked basis "general_period" because the mapping comes
from federal case law, not from the state text. Accrual is a federal question (Wallace v. Kato, 549 U.S. 384 (2007)).

Writes LIM_WORK/<ENTRIES_DIR>/<st>.json (default entries-1983). Usage: LIM_BUNDLE=... LIM_WORK=... civil-rights-1983-entries.py
"""
import json
import os
import re
from pathlib import Path

BUNDLE = Path(os.environ["LIM_BUNDLE"])
WORK = Path(os.environ["LIM_WORK"])
OUT = WORK / os.environ.get("ENTRIES_DIR", "entries-1983")
CLAIM = "civil_rights_1983"

# Flagged: the personal-injury rule is itself flagged, or federal courts borrow a different statute or subsection.
FLAGGED = {
    "AR": "The state's personal-injury rule is flagged in this release.",
    "DC": "The personal-injury rule is flagged in this release.",
    "GA": "The personal-injury rule is flagged in this release.",
    "MS": "The personal-injury rule is flagged in this release.",
    "OR": "The personal-injury rule is flagged in this release.",
    "WY": "The personal-injury rule is flagged in this release.",
    "FL": "Federal courts borrow Florida's four-year residual statute for § 1983, not the two-year negligence period cited by the personal-injury rule.",
    "CT": "Federal courts borrow Conn. Gen. Stat. § 52-577 (three years) for § 1983, not the negligence period in § 52-584.",
    "LA": "Louisiana changed delictual prescription from one to two years for acts after July 1, 2024; § 1983 application across the transition is unresolved here.",
    "TN": "Tennessee has a civil-rights-specific subsection, § 28-3-104(a)(1)(B), distinct from the personal-injury subsection cited.",
    "WI": "Which Wisconsin statute governs § 1983 after the 2018 amendment of § 893.54 is not resolved here.",
}
NOTE = ("No federal limitations period: federal courts borrow the forum state's general or residual personal-injury "
        "statute (Owens v. Okure, 488 U.S. 235 (1989)). Accrual is a federal question (Wallace v. Kato, 549 U.S. 384 (2007)); "
        "state tolling rules apply. The state's statute is quoted literally from the capture.")


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


def main():
    rules = {r["id"]: r for r in json.loads((BUNDLE / "rules.json").read_text())["rules"]}
    coverage = json.loads((BUNDLE / "coverage.json").read_text())["coverage"]
    OUT.mkdir(parents=True, exist_ok=True)
    tally = {}
    for row in coverage:
        st = row["state"]
        cell = next((c for c in row["claimCoverage"] if c["claimType"] == "personal_injury"), None)
        rule = rules.get(cell.get("ruleId")) if cell else None
        cap = WORK / "captures" / st / f"pi-{st.lower()}.txt"
        if not rule or not cap.exists():
            entry = not_recorded(f"No personal-injury capture is available for {st} in this release.")
        else:
            entry = build(st, rule, norm(cap.read_text(encoding="utf-8")))
        tally[entry["status"]] = tally.get(entry["status"], 0) + 1
        (OUT / f"{st.lower()}.json").write_text(json.dumps({"jurisdiction": st, "entries": [entry]}, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({"dir": str(OUT), "byStatus": tally}))


def build(st, rule, text):
    prov = rule.get("provenance") or {}
    evidence = norm(prov.get("periodEvidence"))
    lowered = text.lower()
    at = lowered.find(evidence.lower()) if evidence else -1
    if at < 0:
        return not_recorded(f"The personal-injury period words were not found literally in the fresh {st} capture.")
    # Excerpt: the rule's own excerpt when it is still literal, otherwise the surrounding sentence-sized window.
    excerpt = norm(prov.get("excerpt"))
    if not excerpt or excerpt.lower() not in lowered or evidence.lower() not in excerpt.lower():
        start = max(0, text.rfind(". ", 0, at) + 2)
        end = text.find(". ", at + len(evidence))
        excerpt = text[start: (end + 1) if end > 0 else min(len(text), at + len(evidence) + 300)].strip()
    # Take the period words from inside the excerpt so their case matches the quoted passage exactly.
    inner = excerpt.lower().find(evidence.lower())
    period_evidence = excerpt[inner: inner + len(evidence)] if inner >= 0 else text[at: at + len(evidence)]
    period = rule["period"]
    unit = {"calendar_years": "years", "calendar_months": "months", "calendar_days": "days"}[period["unit"]]
    accrual_match = re.search(r"(?:after|from) the (?:cause of action|right of action|right to bring the same)[^.;]{0,40}?accru\w*", text, re.I)
    accrual = ({"kind": "accrual", "text": "Federal law sets accrual (Wallace v. Kato); the state text's accrual wording is quoted for reference.",
                "evidence": accrual_match.group(0)} if accrual_match else
               {"kind": "not_recorded", "text": "", "evidence": ""})
    status = "flagged" if st in FLAGGED else "verified"
    citation = (prov.get("citation") or rule.get("pinpoint") or "").strip()
    return {
        "claimType": CLAIM, "status": status, "basis": "general_period", "authorityKind": "statute",
        "period": {"amount": period["amount"], "unit": unit}, "periodEvidence": period_evidence,
        "citation": f"{citation} (borrowed for 42 U.S.C. § 1983 under Owens v. Okure, 488 U.S. 235 (1989))",
        "excerpt": excerpt, "captureId": f"pi-{st.lower()}", "accrual": accrual, "tolling": [], "repose": [],
        "lastAmended": {"text": "Not recorded", "date": None, "evidence": ""}, "effectiveDate": None, "crossChecks": [],
        "confidence": "medium", "confidenceNote": NOTE + (f" Flag: {FLAGGED[st]}" if st in FLAGGED else ""),
        "flags": ["borrowing_unresolved"] if st in FLAGGED else [],
    }


def not_recorded(reason):
    return {"claimType": CLAIM, "status": "not_recorded", "period": None, "periodEvidence": "", "citation": "", "excerpt": "",
            "captureId": "", "accrual": {"kind": "not_recorded", "text": "", "evidence": ""}, "tolling": [], "repose": [],
            "lastAmended": {"text": "Not recorded", "date": None, "evidence": ""}, "effectiveDate": None, "crossChecks": [],
            "confidence": "low", "confidenceNote": reason, "flags": [], "notRecordedReason": reason}


if __name__ == "__main__":
    main()
