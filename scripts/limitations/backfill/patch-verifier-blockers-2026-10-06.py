#!/usr/bin/env python3
"""Apply independent-verifier .3 blocker fixes to /tmp/lim/backfill entries (2026-10-06)."""
from __future__ import annotations

import json
from pathlib import Path

WORK = Path("/tmp/lim/backfill/entries")

GATE_FLAG = "compiled_code_lexis_gate"
UNABLE_FLAG = "unable_to_verify_claim_mapping"


def load(st: str) -> dict:
    p = WORK / f"{st}.json"
    return json.loads(p.read_text())


def save(st: str, doc: dict) -> None:
    (WORK / f"{st}.json").write_text(json.dumps(doc, indent=2) + "\n")


def find(doc: dict, claim: str, variant: str = "general") -> dict:
    for e in doc["entries"]:
        if e["claimType"] == claim and (e.get("variant") or "general") == variant:
            return e
    raise KeyError(f"{doc['jurisdiction']} {claim}/{variant}")


def flag(e: dict, flags: list[str], issue: str, why: str) -> None:
    e["status"] = "flagged"
    e["flags"] = list(dict.fromkeys([*flags, *(e.get("flags") or [])]))
    blockers = e.get("blockers") or []
    if not any(b.get("issue") == issue for b in blockers):
        blockers.append({"issue": issue, "why": why})
    e["blockers"] = blockers


def demote_compute(e: dict, flags: list[str], issue: str, why: str) -> None:
    flag(e, flags, issue, why)
    e["repose"] = []


# --- Alaska property damage: personal-property-only baseline; repose not safely modelled ---
ak = load("AK")
e = find(ak, "property_damage")
flag(
    e,
    ["personal_property_only_baseline", "repose_not_modelled"],
    "Generic property_damage must not compute from personal-property-only § 09.10.070(a)(3) alone",
    "The verified text covers taking, detaining or injuring personal property only; real-property waste/trespass "
    "uses a separate variant. AS 09.10.055 repose also requires the earlier of substantial completion or last act, "
    "which the calculator does not model. Withheld pending subtype selection and repose modelling.",
)
save("AK", ak)

# --- Arkansas: Lexis compiled code gate — no computing baseline from gated statute captures ---
ar = load("AR")
for ct in (
    "personal_injury",
    "product_liability",
    "property_damage",
    "fraud",
    "contract_oral",
    "contract_written",
    "medical_malpractice",
    "wrongful_death",
):
    try:
        e = find(ar, ct)
    except KeyError:
        continue
    demote_compute(
        e,
        [GATE_FLAG],
        "Official compiled Arkansas Code text is behind a LexisNexis terms gate",
        "Period and accrual are corroborated only through court opinions quoting sections; the compiled code "
        "was not opened. The calculator does not issue a baseline date from gated publisher text.",
    )
save("AR", ar)

# --- Tennessee gate / unable-to-verify ---
tn = load("TN")
for ct in ("contract_oral", "contract_written", "medical_malpractice"):
    e = find(tn, ct)
    demote_compute(
        e,
        [GATE_FLAG],
        "Operative Tennessee Code section available only through gated Lexis compilation or opinion quotations",
        "No official legislative text of the operative section is in the captured sources without opening the "
        "Lexis terms gate. No baseline date is issued.",
    )
e = find(tn, "fraud")
flag(
    e,
    [UNABLE_FLAG],
    "Fraud claim mapping and discovery accrual not verified from official opinions",
    "Tenn. Code Ann. § 28-3-105(1) period is captured, but mapping generic fraud to that section and the "
    "discovery/concealment accrual require court opinions that could not be read fresh from official hosts. "
    "No baseline date is issued until an official opinion supports the mapping.",
)
e["repose"] = []
save("TN", tn)

# --- Louisiana Act 423 effective date (actions arising after effective date → from 2024-07-02) ---
la = load("LA")
for ct in ("product_liability", "property_damage", "personal_injury"):
    e = find(la, ct)
    if e.get("effectiveDate") == "2024-07-01":
        e["effectiveDate"] = "2024-07-02"
e = find(la, "property_damage", "immovable_property")
if e.get("effectiveDate") == "2024-07-01":
    e["effectiveDate"] = "2024-07-02"
corbello_accrual = (
    "Art. 3499 does not state when a cause of action accrues. In Corbello v. Iowa Production Co., "
    "the Louisiana Supreme Court held that the ten-year period runs from the date the cause of action arose "
    "(there, when the lease terminated and the lessee was to return the property). The court did not establish "
    "a general discovery accrual rule for written or oral contracts; contra non valentem and other accrual "
    "questions are not resolved here."
)
for ct in ("contract_written", "contract_oral"):
    e = find(la, ct)
    e["accrual"]["text"] = corbello_accrual
    e["accrual"]["evidence"] = "from the date that the cause of action arose"
save("LA", la)

# --- Hawaii fraud: Hancock holding is narrow ---
hi = load("HI")
e = find(hi, "fraud")
e["accrual"]["text"] = (
    "Statute: six years 'next after the cause of action accrued' (Haw. Rev. Stat. § 657-1(4)). "
    "The statute does not define accrual for fraud generally. Hancock v. Kulana Partners (Haw. 2019) applied "
    "a discovery start only in a deed-procured-by-fraud claim (fraud not rendering the deed void ab initio); "
    "that holding is not recorded here as governing all § 657-1(4) fraud claims. Haw. Rev. Stat. § 657-20 "
    "(fraudulent concealment) may extend commencement when applicable."
)
e["accrual"]["evidence"] = "next after the cause of action accrued"
save("HI", hi)

# --- Michigan medical malpractice: tolling note for 5838a(2)-(3) ---
mi = load("MI")
e = find(mi, "medical_malpractice")
for t in e.get("tolling") or []:
    if "5838a(2)-(3)" in t.get("citation", ""):
        t["text"] = (
            "Alternative window: the later of the 5805 period or 6 months after the plaintiff discovers or should "
            "have discovered the claim (5838a(2)). Subsection (2)'s six-year act-or-omission cap does not apply "
            "where discovery was prevented by the provider's fraudulent conduct or there is permanent "
            "reproductive-organ loss (5838a(2)(a)-(b)); in those cases subsection (3)'s discovery rule applies."
        )
save("MI", mi)

# --- Minnesota PI: correct § 541.073 cross-check (2025 statute) ---
mn = load("MN")
e = find(mn, "personal_injury")
for cc in e.get("crossChecks") or []:
    if cc.get("captureId") == "mn-541-073":
        cc["note"] = (
            "Minn. Stat. § 541.073 (2025 capture): for personal injury caused by sexual abuse, an action by a person "
            "18 years of age or older must be commenced within six years of the abuse; there is no time limitation "
            "for a person under 18. This is not the general negligence period under § 541.05 subd. 1(5)."
        )
save("MN", mn)

# --- Missouri MM + variants: repose window start not supported at 2018-08-28 only ---
mo = load("MO")
for variant in ("general", "foreign_object", "failure_to_inform_test_results"):
    e = find(mo, "medical_malpractice", variant)
    demote_compute(
        e,
        ["repose_effective_from_unsupported"],
        "Repose historical window start not verified from official revisor versions",
        "§ 516.105 repose is recorded with effectiveFrom 2018-08-28 (S.B. 871) only; earlier official versions "
        "already contained the repose text. No baseline date is issued until a supported repose window start is "
        "recorded from official sources.",
    )
    e["effectiveDate"] = None
save("MO", mo)

# --- Washington MM: later-of statute not modelled on this calculator branch ---
wa = load("WA")
e = find(wa, "medical_malpractice")
demote_compute(
    e,
    ["calculation_not_supported"],
    "RCW 4.16.350 later-of rule not modelled",
    "The statute requires the later of three years from the act or omission or one year from discovery, capped at "
    "eight years from the act. The calculator cannot reproduce that later-of structure on this branch; no baseline "
    "date is issued.",
)
save("WA", wa)

# --- Wisconsin MM / PL: wrong repose calculation ---
wi = load("WI")
for variant in ("general",):
    e = find(wi, "medical_malpractice", variant)
    demote_compute(
        e,
        ["calculation_not_supported"],
        "§ 893.55(1m) later-of and repose cap mis-modelled",
        "The five-year limit in par. (b) applies only to the one-year discovery alternative, not to the "
        "three-years-from-injury alternative in par. (a). No baseline date is issued until the later-of structure "
        "is modelled correctly.",
    )
e = find(wi, "wrongful_death", "death_from_medical_malpractice")
demote_compute(
    e,
    ["calculation_not_supported"],
    "§ 893.55(1m) later-of and repose cap mis-modelled",
    "The five-year limit in par. (b) applies only to the one-year discovery alternative, not to the "
    "three-years-from-injury alternative in par. (a). No baseline date is issued until the later-of structure "
    "is modelled correctly.",
)
e = find(wi, "product_liability")
demote_compute(
    e,
    ["repose_not_modelled"],
    "§ 895.047(5) manufacture-date repose not modelled",
    "Fifteen-year strict-liability repose runs from manufacture, not act or omission; the calculator must not apply "
    "accrual_repose_min from act_or_omission. No baseline date is issued.",
)
save("WI", wi)

# --- Nevada PD: restore NRS 11.202 in repose[] (disclosed, not computed) ---
nv = load("NV")
e = find(nv, "property_damage")
e["repose"] = [
    {
        "years": 10,
        "citation": "Nev. Rev. Stat. § 11.202(1)(b)",
        "trigger": "substantial completion of the improvement to real property (construction-deficiency property damage only)",
        "evidence": "more than 10 years after the substantial completion of such an improvement",
        "effectiveFrom": None,
    }
]
note = (
    "NRS 11.202(1)(b) bars construction-deficiency property-damage claims ten years after substantial completion "
    "(date under NRS 11.2055); exceptions in 11.202(2)-(3). Not computed here (trigger is substantial completion, "
    "not act or omission; no printed repose effectiveFrom)."
)
if note not in (e.get("confidenceNote") or ""):
    e["confidenceNote"] = (e.get("confidenceNote") or "").rstrip() + " " + note
save("NV", nv)

# --- Disputed variants ---
for st, ct, variant, issue, why in [
    (
        "MI",
        "medical_malpractice",
        "discovery_rule_and_repose",
        "5838a(2) discovery extension not modelled as accrual_repose_min",
        "Six months run from discovery with a later-of structure; accrual_repose_min from accrual would be wrong.",
    ),
    (
        "NC",
        "medical_malpractice",
        "foreign_object",
        "Foreign-object proviso can yield a deadline before the three-year floor",
        "Discovery must be applied as in the general rule (three-year minimum); one-year foreign-object calculation withheld.",
    ),
    (
        "OH",
        "medical_malpractice",
        "discovery_extension",
        "Ohio Admin. Code 2305.10(D) extension mis-modelled",
        "(D)(1) runs one year from discovery beyond the (C) cap; not a four-year repose from accrual.",
    ),
    (
        "NY",
        "personal_injury",
        "domestic_violence",
        "CPLR 215(9) preserves CPLR 214 limits",
        "The statute preserves section 214's limits (including three years for personal injury); the calculator "
        "does not issue a standalone two-year date without that qualification.",
    ),
    (
        "NY",
        "medical_malpractice",
        "cancer_misdiagnosis",
        "Repose effectiveFrom not verified from enacted text",
        "214-a repose effective date could not be verified from an official enacted effective clause.",
    ),
    (
        "PA",
        "personal_injury",
        "childhood_sexual_abuse",
        "§ 5533(b)(2)(i) runs from age 18, not abuse date",
        "Thirty-seven years runs from the day the person turns 18, not from the abuse/accrual date entered in the calculator.",
    ),
]:
    doc = load(st)
    e = find(doc, ct, variant)
    demote_compute(e, ["variant_calculation_withheld"], issue, why)
    save(st, doc)

print("Patched verifier blocker entries in", WORK)
