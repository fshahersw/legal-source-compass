#!/usr/bin/env python3
"""Write consumer_protection matrix entries (entries/<st>.json) from retained captures.

Every quoted string is cut from the capture text between literal anchors, so excerpts, period words and accrual
evidence are substrings of the official text by construction; verify-entries.ts re-checks them mechanically.
Usage: LIM_WORK=... consumer-protection-entries.py
"""
import json
import os
import re
import sys
from pathlib import Path

WORK = Path(os.environ.get("LIM_WORK", "/tmp/lim/backfill"))
CLAIM = "consumer_protection"


def text(state, capture_id):
    return re.sub(r"\s+", " ", (WORK / "captures" / state / f"{capture_id}.txt").read_text(encoding="utf-8"))


def cut(state, capture_id, start, end, occurrence=0):
    """The capture text from `start` through `end` (inclusive), at the given occurrence of `start`."""
    t = text(state, capture_id)
    positions = [m.start() for m in re.finditer(re.escape(start), t)]
    if len(positions) <= occurrence:
        raise SystemExit(f"{state} {capture_id}: start anchor not found: {start!r}")
    i = positions[occurrence]
    j = t.find(end, i)
    if j < 0:
        raise SystemExit(f"{state} {capture_id}: end anchor not found after start: {end!r}")
    return t[i:j + len(end)]


def entry(state, capture_id, citation, excerpt, period, period_evidence, accrual, *, status="verified", confidence="high",
          note, flags=(), tolling=(), repose=(), limbs=None, combine=None, last_amended=("Not recorded", None, "")):
    for label, needle in [("periodEvidence", period_evidence), ("accrual", accrual[2])]:
        if needle and needle not in excerpt and needle not in text(state, capture_id):
            raise SystemExit(f"{state}: {label} not in capture: {needle!r}")
    out = {
        "claimType": CLAIM,
        "status": status,
        "basis": "claim_specific",
        "authorityKind": "statute",
        "period": {"amount": period[0], "unit": period[1]},
        "periodEvidence": period_evidence,
        "citation": citation,
        "excerpt": excerpt,
        "captureId": capture_id,
        "accrual": {"kind": accrual[0], "text": accrual[1], "evidence": accrual[2]},
        "tolling": [{"text": t[0], "citation": t[1], "evidence": t[2]} for t in tolling],
        "repose": [{"years": r[0], "citation": r[1], "trigger": r[2], "evidence": r[3], "effectiveFrom": None, "applies": r[4]} for r in repose],
        "lastAmended": {"text": last_amended[0], "date": last_amended[1], "evidence": last_amended[2]},
        "effectiveDate": None,
        "crossChecks": [],
        "confidence": confidence,
        "confidenceNote": note,
        "flags": list(flags),
    }
    if limbs:
        out["periodLimbs"] = [{"amount": a, "unit": u, "from": f, "evidence": e} for a, u, f, e in limbs]
        out["periodCombine"] = combine
    return out


def not_recorded(reason):
    return {
        "claimType": CLAIM, "status": "not_recorded", "period": None, "periodEvidence": "", "citation": "", "excerpt": "",
        "captureId": "", "accrual": {"kind": "not_recorded", "text": "", "evidence": ""}, "tolling": [], "repose": [],
        "lastAmended": {"text": "Not recorded", "date": None, "evidence": ""}, "effectiveDate": None, "crossChecks": [],
        "confidence": "low", "confidenceNote": reason, "flags": [], "notRecordedReason": reason,
    }


INTERMEDIARY = ("Official publisher text from the reviewed full-code intake; the official host could not be read directly "
                "from the review environment, so the capture is an intermediary extraction.")
DIRECT = "Direct capture of the official legislature page; period and accrual words quoted literally."

E = {}

c = "cp-ak-45-50-531"
x = cut("AK", c, "(f) A person may not commence", "declared unlawful by AS 45.50.471.", 0)
E["AK"] = entry("AK", c, "AS 45.50.531(f)", x, (2, "years"), "more than two years after the person discovers",
                ("discovery", "Runs from when the person discovers or reasonably should have discovered that the loss resulted from an unlawful act or practice.",
                 "after the person discovers or reasonably should have discovered that the loss resulted"), note=DIRECT)

c = "cp-al-8-19-14"
x = cut("AL", c, "No action may be brought under this chapter more than one year", "giving rise to the cause of action", 0)
E["AL"] = entry("AL", c, "Ala. Code § 8-19-14", x, (1, "years"), "more than one year after the person bringing the action discovers",
                ("discovery", "Runs from when the person discovers or reasonably should have discovered the act or practice.",
                 "discovers or reasonably should have discovered the act or practice"),
                repose=[(4, "Ala. Code § 8-19-14", "date of the transaction giving rise to the cause of action",
                         "more than four years from the date of the transaction", "narrow")],
                note=DIRECT + " The four-year outer limit has a longer alternative for contracts or warranties over three years, so it is recorded but not computed.")

c = "cp-ca-civ-1783"
x = cut("CA", c, "Any action brought under the specific provisions of Section 1770", "method, act, or practice.", 0)
E["CA"] = entry("CA", c, "Cal. Civ. Code § 1783 (Consumers Legal Remedies Act)", x, (3, "years"), "not more than three years from the date of the commission",
                ("occurrence", "Runs from the date the method, act or practice was committed.", "from the date of the commission of such method, act, or practice"),
                confidence="medium", note=INTERMEDIARY + " Covers CLRA claims under Civ. Code § 1770 only; Unfair Competition Law claims have a separate period.")

c = "cp-co-6-1-115"
x = cut("CO", c, "6-1-115. Limitations. All actions brought under this article", "of the false, misleading, or deceptive act or practice.", 0)
E["CO"] = entry("CO", c, "Colo. Rev. Stat. § 6-1-115", x, (3, "years"), "within three years after the date on which the false, misleading, or deceptive act or practice occurred",
                ("occurrence", "Runs from the act or practice (or the last in a series), or from discovery, whichever ends later.",
                 "within three years after the consumer discovered or in the exercise of reasonable diligence should have discovered"),
                limbs=[(3, "years", "accrual", "within three years after the date on which the false, misleading, or deceptive act or practice occurred"),
                       (3, "years", "discovery", "within three years after the consumer discovered or in the exercise of reasonable diligence should have discovered")],
                combine="later",
                tolling=[("May be extended one year if the defendant's conduct induced the plaintiff to delay suit.", "Colo. Rev. Stat. § 6-1-115",
                          "may be extended for a period of one year if the plaintiff proves that failure to timely commence the action was caused by the defendant")],
                note=DIRECT)

c = "cp-ct-42-110g"
x = cut("CT", c, "(f) An action under this section may not be brought", "violation of this chapter.", 0)
E["CT"] = entry("CT", c, "Conn. Gen. Stat. § 42-110g(f)", x, (3, "years"), "more than three years after the occurrence of a violation",
                ("occurrence", "Runs from the occurrence of the violation.", "after the occurrence of a violation of this chapter"), confidence="medium", note=INTERMEDIARY)

c = "cp-hi-480-24"
x = cut("HI", c, "Any action to enforce a cause of action arising under this chapter", "during the period of the violation.", 0)
E["HI"] = entry("HI", c, "Haw. Rev. Stat. § 480-24", x, (4, "years"), "within four years after the cause of action accrues",
                ("accrual", "Runs from accrual; a continuing violation accrues at any time during the violation.", "a cause of action for a continuing violation is deemed to accrue at any time during the period of the violation"),
                note=DIRECT + " A separate exception in section 480-22 is not computed.")

c = "cp-id-48-619"
x = cut("ID", c, "No private action may be brought under this act", "after the cause of action accrues.", 0)
E["ID"] = entry("ID", c, "Idaho Code § 48-619", x, (2, "years"), "more than two (2) years after the cause of action accrues",
                ("accrual", "Runs from accrual.", "after the cause of action accrues"), note=DIRECT)

c = "cp-il-815-505-10a"
x = cut("IL", c, "(e) Any action for damages under this Section shall be forever barred", "after the cause of action accrued;", 0)
E["IL"] = entry("IL", c, "815 ILCS 505/10a(e)", x, (3, "years"), "within 3 years after the cause of action accrued",
                ("accrual", "Runs from accrual.", "after the cause of action accrued"),
                tolling=[("Suspended while an Attorney General or State's Attorney action on the same matter is pending.", "815 ILCS 505/10a(e)",
                          "the running of the foregoing statute of limitations")],
                confidence="medium", note=INTERMEDIARY)

c = "cp-in-24-5-0-5-5"
t_in = text("IN", c)
start_in = t_in.find("An action brought under section 4(a)")
if start_in < 0:
    start_in = t_in.find("(b)")
x = t_in[start_in: t_in.find("the occurrence of the deceptive act.", start_in) + len("the occurrence of the deceptive act.")]
E["IN"] = entry("IN", c, "Ind. Code § 24-5-0.5-5(b)", x, (2, "years"), "more than two (2) years after the occurrence of the deceptive act",
                ("occurrence", "Runs from the occurrence of the deceptive act.", "after the occurrence of the deceptive act"), confidence="medium",
                note=INTERMEDIARY + " Actions under section 4(c) have a separate five-year period not covered here.")

c = "cp-ky-367-220"
x = cut("KY", c, "(5) Any person bringing an action under this section", "whichever is later.", 0)
E["KY"] = entry("KY", c, "Ky. Rev. Stat. § 367.220(5)", x, (2, "years"), "within two (2) years after the violation",
                ("occurrence", "Runs from the violation; a later date applies when an Attorney General action ends later.", "within two (2) years after the violation of KRS 367.170"),
                confidence="medium", note=INTERMEDIARY + " The computed date assumes no Attorney General action; one year after such an action ends applies when later.")

c = "cp-la-51-1409"
x = cut("LA", c, "E. The action provided by this Section", "gave rise to this right of action.", 0)
E["LA"] = entry("LA", c, "La. R.S. 51:1409(E)", x, (1, "years"), "liberative prescription of one year running from the time of the transaction or act",
                ("occurrence", "Runs from the transaction or act that gave rise to the claim.", "running from the time of the transaction or act which gave rise to this right of action"),
                confidence="medium", note=INTERMEDIARY + " Prescriptive since Acts 2018, No. 337.")

c = "cp-ma-260-5a"
x = cut("MA", c, "Actions arising on account of violations of any law intended for the protection of consumers", "after the cause of action accrues.", 0)
E["MA"] = entry("MA", c, "Mass. Gen. Laws ch. 260, § 5A", x, (4, "years"), "within four years next after the cause of action accrues",
                ("accrual", "Runs from accrual.", "next after the cause of action accrues"), note=DIRECT + " Covers chapter 93A and the other listed consumer statutes.")

c = "cp-mi-445-911"
x = cut("MI", c, "(9) An action under this section must not be brought", "ends at a later date.", 0)
E["MI"] = entry("MI", c, "Mich. Comp. Laws § 445.911(9)", x, (6, "years"), "more than 6 years after the occurrence of the method, act, or practice",
                ("occurrence", "Runs from the occurrence; one year after the last payment applies when later.", "after the occurrence of the method, act, or practice that is the subject of the action"),
                note=DIRECT + " The computed date uses the six-year limb; one year after the last payment in the transaction applies when it ends later.")

c = "cp-ne-59-1612"
x = cut("NE", c, "Any action to enforce a claim for damages under section 59-1609", "after the cause of action accrues;", 0)
E["NE"] = entry("NE", c, "Neb. Rev. Stat. § 59-1612", x, (4, "years"), "within four years after the cause of action accrues",
                ("accrual", "Runs from accrual.", "after the cause of action accrues"), note=DIRECT)

c = "cp-nc-75-16-2"
x = cut("NC", c, "Any civil action brought under this Chapter", "after the cause of action accrues.", 0)
E["NC"] = entry("NC", c, "N.C. Gen. Stat. § 75-16.2", x, (4, "years"), "within four years after the cause of action accrues",
                ("accrual", "Runs from accrual.", "after the cause of action accrues"), note=DIRECT)

c = "cp-oh-1345-10"
x = cut("OH", c, "(C) An action under sections 1345.01 to 1345.13", "whichever is later.", 0)
E["OH"] = entry("OH", c, "Ohio Rev. Code § 1345.10(C)", x, (2, "years"), "more than two years after the occurrence of the violation",
                ("occurrence", "Runs from the occurrence of the violation; one year after Attorney General proceedings end applies when later.", "after the occurrence of the violation which is the subject of suit"),
                note=DIRECT + " The computed date assumes no Attorney General proceedings on the violation.")

c = "cp-or-646-638"
x = cut("OR", c, "(6) Actions brought under this section must be commenced", "of the unlawful method, act or practice.", 0)
E["OR"] = entry("OR", c, "Or. Rev. Stat. § 646.638(6)", x, (1, "years"), "within one year after the discovery of the unlawful method, act or practice",
                ("discovery", "Runs from discovery of the unlawful method, act or practice.", "after the discovery of the unlawful method, act or practice"), note=DIRECT)

c = "cp-sc-39-5-150"
x = cut("SC", c, "No action may be brought under this article more than three years", "which is the subject of the suit.", 0)
E["SC"] = entry("SC", c, "S.C. Code § 39-5-150", x, (3, "years"), "more than three years after discovery of the unlawful conduct",
                ("discovery", "Runs from discovery of the unlawful conduct.", "after discovery of the unlawful conduct"), note=DIRECT)

c = "cp-sd-37-24-33"
x = cut("SD", c, "No action under this chapter may be brought", "which is the subject of the action.", 0)
E["SD"] = entry("SD", c, "S.D. Codified Laws § 37-24-33", x, (4, "years"), "more than four years after the occurrence or discovery of the conduct",
                ("occurrence", "Runs from the occurrence or discovery of the conduct.", "after the occurrence or discovery of the conduct"),
                note=DIRECT + " Amended by SL 2008, ch 206 (four years).", last_amended=("SL 2008, ch 206, § 1", None, "SL 2008, ch 206, § 1"))

c = "cp-tx-bc-17-565"
x = cut("TX", c, "All actions brought under this subchapter must be commenced", "deceptive act or practice.", 0)
E["TX"] = entry("TX", c, "Tex. Bus. & Com. Code § 17.565", x, (2, "years"), "within two years after the date on which the false, misleading, or deceptive act or practice occurred",
                ("occurrence", "Runs from the act or practice, or from discovery, whichever ends later.", "within two years after the consumer discovered"),
                limbs=[(2, "years", "accrual", "within two years after the date on which the false, misleading, or deceptive act or practice occurred"),
                       (2, "years", "discovery", "within two years after the consumer discovered")],
                combine="later", note=DIRECT + " A separate 180-day extension for delay caused by the defendant is not computed.")

c = "cp-va-59-1-204-1"
x = cut("VA", c, "A. Any individual action pursuant to § 59.1-204", "as provided in § 8.01-230.", 0)
E["VA"] = entry("VA", c, "Va. Code § 59.1-204.1(A)", x, (2, "years"), "within two years after such accrual",
                ("accrual", "Runs from accrual as provided in Va. Code § 8.01-230.", "The cause of action shall accrue as provided in § 8.01-230."),
                note=DIRECT + " Applies to actions first accruing on or after July 1, 1995.")

c = "cp-wa-19-86-120"
x = cut("WA", c, "Any action to enforce a claim for damages under RCW 19.86.090", "after the cause of action accrues:", 0)
E["WA"] = entry("WA", c, "Wash. Rev. Code § 19.86.120", x, (4, "years"), "within four years after the cause of action accrues",
                ("accrual", "Runs from accrual.", "after the cause of action accrues"), note=DIRECT)

c = "cp-wi-100-18"
x = cut("WI", c, "No action may be commenced under this section more than 3 years", "which is the subject of the action.", 0)
E["WI"] = entry("WI", c, "Wis. Stat. § 100.18(11)(b)3.", x, (3, "years"), "more than 3 years after the occurrence of the unlawful act or practice",
                ("occurrence", "Runs from the occurrence of the unlawful act or practice.", "after the occurrence of the unlawful act or practice"),
                note=DIRECT + " Covers fraudulent representation claims under section 100.18.")

c = "cp-wy-40-12-109"
x = cut("WY", c, "within the following time limits notice in writing", "after the furnishing of notice as required under this section.", 0)
E["WY"] = entry("WY", c, "Wyo. Stat. § 40-12-109", x, (1, "years"), "within one (1) year after the furnishing of notice",
                ("other", "Suit must follow written notice given within one year of discovery or two years of the transaction (whichever first).",
                 "within one (1) year after the initial discovery of the unlawful deceptive trade practice"),
                status="flagged", flags=["notice_precondition"], note=DIRECT + " A notice step precedes the one-year suit period, so no date is computed.")

c = "cp-nh-358-a-3"
x = cut("NH", c, "IV-a. Transactions entered into more than 3 years prior", "in violation of this chapter;", 0)
E["NH"] = entry("NH", c, "N.H. Rev. Stat. § 358-A:3, IV-a", x, (3, "years"), "more than 3 years prior to the time the plaintiff knew",
                ("discovery", "An exemption for transactions entered into more than three years before the plaintiff knew or should have known of the conduct.",
                 "prior to the time the plaintiff knew, or reasonably should have known"),
                status="flagged", flags=["exemption_not_limitations_period"], confidence="medium",
                note=INTERMEDIARY + " This is a look-back exemption, not a limitations period; the general civil statute governs filing time.")

GENERAL = ("No limitations provision specific to the consumer-protection act was found in the reviewed official text; courts apply "
           "the state's general statute for liability created by statute or its catch-all period. Not computed pending a reviewed mapping.")
for st in ["AZ", "DE", "DC", "FL", "IA", "KS", "ME", "MD", "MN", "MS", "MO", "MT", "NV", "NJ", "NM", "NY", "ND", "OK", "PA", "RI", "VT", "WV"]:
    E[st] = not_recorded(GENERAL)
E["UT"] = not_recorded("Utah Code § 13-11-19 as amended in 2025 contains no limitations subsection in the captured official text; "
                       "the general statute for statutory liability would govern. Not computed pending a reviewed mapping.")
GATED = ("The official code is published only through a gated publisher; the retained text is a third-party historical archive "
         "({}). Not computed without an official capture.")
E["GA"] = not_recorded(GATED.format("O.C.G.A. § 10-1-401"))
E["TN"] = not_recorded(GATED.format("Tenn. Code § 47-18-110"))
E["AR"] = not_recorded(GATED.format("Ark. Code § 4-88-115"))


def main():
    out_dir = WORK / "entries"
    out_dir.mkdir(parents=True, exist_ok=True)
    for state, e in sorted(E.items()):
        (out_dir / f"{state.lower()}.json").write_text(json.dumps({"jurisdiction": state, "entries": [e]}, indent=1, ensure_ascii=False) + "\n")
    counts = {}
    for e in E.values():
        counts[e["status"]] = counts.get(e["status"], 0) + 1
    print(json.dumps({"jurisdictions": len(E), "byStatus": counts}))


if __name__ == "__main__":
    main()
