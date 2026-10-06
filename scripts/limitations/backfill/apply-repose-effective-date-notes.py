#!/usr/bin/env python3
"""
Intake notes from repose effective-date research (2026-10-06). Updates /tmp/lim/backfill entries only:
cross-checks and blocker text. Never sets repose[].effectiveFrom (derived dates stay out of the calculator).
See internal report: repose-effective-dates-2026-10-06.md (sol-statute-backfiller run).
"""
from __future__ import annotations

import json
from pathlib import Path

WORK = Path("/tmp/lim/backfill/entries")
CAPTURES = Path("/tmp/lim/backfill/captures")


def load(st: str) -> dict:
    return json.loads((WORK / f"{st}.json").read_text())


def save(st: str, doc: dict) -> None:
    (WORK / f"{st}.json").write_text(json.dumps(doc, indent=2) + "\n")


def find(doc: dict, claim: str = "medical_malpractice", variant: str = "general") -> dict:
    for e in doc["entries"]:
        if e["claimType"] == claim and (e.get("variant") or "general") == variant:
            return e
    raise KeyError(f"{doc['jurisdiction']} {claim}/{variant}")


def has_capture(st: str, capture_id: str) -> bool:
    return (CAPTURES / st / f"{capture_id}.json").is_file()


def add_cross(e: dict, capture_id: str, note: str) -> None:
    if not has_capture(e.get("_state", ""), capture_id):
        return
    checks = e.setdefault("crossChecks", [])
    if any(c.get("captureId") == capture_id for c in checks):
        return
    checks.append({"captureId": capture_id, "note": note})


def append_blocker(e: dict, issue: str, why: str) -> None:
    blockers = e.setdefault("blockers", [])
    for b in blockers:
        if b.get("issue") == issue:
            b["why"] = why
            return
    blockers.append({"issue": issue, "why": why})


# Iowa
ia = load("IA")
e = find(ia)
e["_state"] = "IA"
add_cross(
    e,
    "ia-redbook-1975-76",
    "Official Register 1975-76 (legis.iowa.gov): regular-session public acts take effect the fourth day of "
    "July next after passage unless otherwise provided. Ch. 239 is approved June 30, 1975 with no effective clause. "
    "A derived candidate effective date of 1975-07-04 is documented in repose-effective-dates-2026-10-06; not loaded "
    "as effectiveFrom because it is not printed in the act.",
)
append_blocker(
    e,
    "6-year repose effectiveFrom: no printed effective date",
    "614.1(9) was added by 1975 Acts ch. 239 § 26 (ia-1975-ch239; approved June 30, 1975) with no effective-date "
    "clause. ia-redbook-1975-76 records the July-4 default for regular-session public acts; a derived candidate of "
    "1975-07-04 is documented but not loaded as effectiveFrom (derived, not printed). effectiveFrom remains null.",
)
save("IA", ia)

# Nebraska
ne = load("NE")
e = find(ne)
e["_state"] = "NE"
for cid, note in [
    (
        "ne-journal-88-r2-raw",
        "1984 Legislature journal: convened Jan. 4, 1984; sine die April 9, 1984; LB 692 passed final reading after "
        "emergency clause failed.",
    ),
    (
        "ne-const-iii-27",
        "Neb. Const. art. III §27: acts take effect three calendar months after adjournment unless emergency.",
    ),
]:
    add_cross(e, cid, note)
append_blocker(
    e,
    "Repose effectiveFrom not printed in official text (Neb. Rev. Stat. 44-2828, ten years)",
    "LB 692 (ne-lb692-1984) has no printed effective date; journal shows sine die 1984-04-09 and failed emergency "
    "clause. Const. art. III §27 yields a derived candidate of 1984-07-09 or 1984-07-10 (day count unsettled). "
    "Not loaded as effectiveFrom; remains null.",
)
save("NE", ne)

# Oregon
or_ = load("OR")
e = find(or_)
e["_state"] = "OR"
for cid, note in [
    (
        "or-12-110-2026",
        "Fresh 2026 capture of ORS chapter 12; history line lists 1971 c.473 §1 among amendments to 12.110.",
    ),
    (
        "or-1971-table",
        "1971 comparative table: ch. 473 §1 maps to ORS 12.110 without Emer marker.",
    ),
    (
        "or-session-lengths",
        "1971 session: January 11 through June 10 (151 days).",
    ),
    (
        "or-const-iv-28",
        "Or. Const. art. IV §28: ninety days from end of session unless emergency.",
    ),
    (
        "or-2021-foreword",
        "Legislative foreword example: 90th day after sine die vs. day-after for act effective date.",
    ),
]:
    add_cross(e, cid, note)
append_blocker(
    e,
    "ORS 12.110(4) five-year repose effectiveFrom not printed in any official text",
    "The five-year limit in (4) was added by 1971 c.473 §1 per the ORS history line (or-12-110-2026, or-1971-table); "
    "1967 c.406 §1 carried a seven-year foreign-substance limit, not this five-year general repose. No enacted "
    "effective clause for 1971 c.473 is captured (Oregon Laws online from 1999 only). Derived candidate 1971-09-09 "
    "from sine die 1971-06-10 plus art. IV §28 is documented in repose-effective-dates-2026-10-06; effectiveFrom "
    "remains null.",
)
if "_state" in e:
    del e["_state"]
save("OR", or_)

# Vermont
vt = load("VT")
e = find(vt)
e["_state"] = "VT"
add_cross(
    e,
    "vt-time-1-ch3-full",
    "1 V.S.A. §212: laws take effect July 1 next following passage unless otherwise provided (post-1971 rule).",
)
append_blocker(
    e,
    "No effective date for the seven-year outer bound",
    "§521 history is only (Added 1977, No. 248 (Adj. Sess.).) with no effective clause on the statute page. "
    "1 V.S.A. §212 suggests a derived candidate of 1978-07-01 (medium confidence); not loaded as effectiveFrom.",
)
save("VT", vt)

# Illinois, North Dakota, Georgia — reaffirm Not recorded
il = load("IL")
e = find(il)
append_blocker(
    e,
    "4-year repose effectiveFrom: no printed effective date",
    "P.A. 79-1434 text is not on an official legislature host; ilga.gov shows only later history lines. Conflicting "
    "court-stated dates (Sept. 19 vs. Nov. 11, 1976) are not used. effectiveFrom remains null.",
)
save("IL", il)

nd = load("ND")
e = find(nd)
append_blocker(
    e,
    "Repose effectiveFrom not printed in official text",
    "1975 ch. 284 (nd-sl-1975-jcivl) is approved April 8, 1975 with no effective-date clause and no 1975 default "
    "rule found on ndlegis.gov. effectiveFrom remains null.",
)
save("ND", nd)

ga = load("GA")
e = find(ga)
e["_state"] = "GA"
add_cross(
    e,
    "ga-acts-1985-vol1-dlg",
    "Digital Library of Georgia: 1985 Acts vol. I p. 556, Act 424 (SB 170) malpractice text; approved March 27, 1985; "
    "no effective-date section (state-library host, not legis.ga.gov).",
)
append_blocker(
    e,
    "Repose effectiveFrom not printed in the enacting Act",
    "Act 424 (ga-acts-1985-vol1-dlg) has no effective-date clause; O.C.G.A. remains publisher-gated on legis.ga.gov. "
    "effectiveFrom remains null.",
)
save("GA", ga)

# strip helper keys
for st in ("IA", "NE", "OR", "VT", "GA"):
    doc = load(st)
    for ent in doc["entries"]:
        ent.pop("_state", None)
    save(st, doc)

print("Applied repose effective-date research notes (effectiveFrom unchanged).")
