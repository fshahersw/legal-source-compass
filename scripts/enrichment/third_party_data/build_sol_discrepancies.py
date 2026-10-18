"""PRIVATE review report: Advottic statute-of-limitations table vs the corpus limitations datasets.

Owner hold: Time Limits data is never created, edited or published here. The Advottic table is never published.
This builder only writes a private discrepancy/review report:
  private/build/third_party_data/sol_discrepancies.md
  private/build/third_party_data/sol_discrepancies.json

Inputs (read-only): private/acq/third_party_data/advottic/statute-of-limitations.json and the read-only corpus lookups
private/build/third_party_data/lookups/{limitation_periods,statutory_limitations_review}.json.

Usage: python3 -I -B build_sol_discrepancies.py
"""
import collections
import hashlib
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")
LOOKUPS = os.path.join(BUILD, "lookups")
ADVOTTIC_PATH = os.path.join(ACQ, "advottic", "statute-of-limitations.json")
ADVOTTIC_URL = "https://advottic.com/open-data/statute-of-limitations.json"

# Advottic claim category -> corpus statutory_limitations_review claim_type (None = no corpus counterpart)
REVIEW_MAP = collections.OrderedDict([
    ("personal-injury", "personal_injury"),
    ("wrongful-death", "wrongful_death"),
    ("medical-malpractice", None),
    ("written-contract", None),
    ("oral-contract", None),
    ("property-damage", None),
    ("fraud", None),
    ("defamation", None),
    ("debt-collection", None),
])
MAP_NOTES = {
    "personal-injury": "Compared only with corpus `limitations` rules of ordinary scope (rule ids '-general-'/'-baseline-'/'-limitations-N-'); special-scope rules (latent toxic, asbestos, device, etc.) are listed but not compared.",
    "wrongful-death": "Compared only with corpus `limitations` rules of ordinary scope; accrual (death vs. injury) is not compared.",
    "medical-malpractice": "No corpus cited rule for medical malpractice.",
}
UNMAPPED_CORPUS = {
    "product_liability": "Corpus has product-liability rules; Advottic has no product category (its personal-injury description mentions defective products, but no product-specific period is given). Not compared.",
}
ORDINARY_SCOPES = {"general", "baseline"}
SPECIAL_ID = re.compile(r"^legal-review:(?P<st>[a-z]{2})-(?P<claim>personal_injury|product_liability|wrongful_death)-(?P<scope>[a-z_]+?)(?:-review)?-\d{8}")
NUMBERED_ID = re.compile(r"^legal-review:(?P<st>[a-z]{2})-limitations-\d+-\d{8}")
PERIOD_TEXT = re.compile(r"^\s*(\d+(?:\.\d+)?)\s+years?\s*$", re.I)


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def years_text(value):
    """'2 years' -> 2.0; anything else -> None (not parsed, never guessed)."""
    match = PERIOD_TEXT.match(value or "")
    return float(match.group(1)) if match else None


def fmt_years(value):
    if value is None:
        return "Not recorded"
    if float(value).is_integer():
        return f"{int(value)} year" + ("" if int(value) == 1 else "s")
    return f"{value} years"


def rule_scope(rule):
    """('ordinary'|'special'|'unknown', scope label) from the deterministic rule id."""
    match = SPECIAL_ID.match(rule["id"])
    if match:
        scope = match.group("scope")
        return ("ordinary" if scope in ORDINARY_SCOPES else "special"), scope
    if NUMBERED_ID.match(rule["id"]):
        return "ordinary", "numbered"
    return "unknown", ""


def rule_years(rule):
    period = rule.get("period")
    if not isinstance(period, dict) or period.get("amount") is None:
        return None, "no period stated"
    if period.get("unit") != "calendar_years":
        return None, f"unit {period.get('unit')} not comparable"
    return float(period["amount"]), ""


def load_advottic(path=ADVOTTIC_PATH):
    data = json.load(open(path, encoding="utf-8"))
    cells = {}
    for state in data["states"]:
        for claim, value in state["limits"].items():
            cells[(state["abbr"], claim)] = {"state": state["abbr"], "state_name": state["name"], "claim": claim,
                                             "years": value.get("years"), "note": value.get("note") or ""}
    return data, cells


def load_limitation_periods(path=os.path.join(LOOKUPS, "limitation_periods.json")):
    blob = json.load(open(path, encoding="utf-8"))["rows"][0]["blob"]
    rows = {}
    for line in blob.split("\n"):
        parts = line.split("\t")
        parts += [""] * (8 - len(parts))
        rid, state, claim, period, section, check, review_fact, review_id = parts[:8]
        rows[(state, claim)] = {"id": rid, "state": state, "claim": claim, "period_text": period, "years": years_text(period),
                                "section": section, "check": check, "review_fact": review_fact, "review_id": review_id}
    return rows


def load_review(path=os.path.join(LOOKUPS, "statutory_limitations_review.json")):
    return json.load(open(path, encoding="utf-8"))["rows"]


def compare_review(adv_cells, review):
    by_key = collections.defaultdict(list)
    for rule in review:
        if rule["rule_kind"] == "limitations":
            by_key[(rule["state"], rule["claim_type"])].append(rule)
    results = []
    for (state, claim), cell in sorted(adv_cells.items()):
        corpus_claim = REVIEW_MAP.get(claim)
        if corpus_claim is None:
            continue
        rules = by_key.get((state, corpus_claim), [])
        ordinary, other = [], []
        for rule in rules:
            scope_kind, scope = rule_scope(rule)
            years, why = rule_years(rule)
            entry = {"rule_id": rule["id"], "pinpoint": rule["pinpoint"], "source_url": rule["source_url"], "scope": scope,
                     "scope_text": rule.get("scope") or rule.get("subtitle") or "", "years": years, "review_status": rule.get("review_status"),
                     "rule_version": rule.get("rule_version"), "not_comparable": why}
            (ordinary if scope_kind == "ordinary" and years is not None else other).append(entry)
        if not rules:
            status = "corpus_lacks"
        elif not ordinary:
            status = "not_comparable"
        elif all(e["years"] == float(cell["years"]) for e in ordinary):
            status = "agree"
        elif any(e["years"] == float(cell["years"]) for e in ordinary):
            status = "mixed"
        else:
            status = "disagree"
        results.append({"state": state, "advottic_claim": claim, "corpus_claim": corpus_claim, "advottic_years": cell["years"],
                        "advottic_note": cell["note"], "status": status, "compared_rules": ordinary, "other_rules": other})
    return results


def compare_lp(adv_cells, lp_rows):
    out = []
    for key, cell in sorted(adv_cells.items()):
        row = lp_rows.get(key)
        if row is None:
            status = "missing_in_limitation_periods"
        elif row["years"] is None:
            status = "unparsed_period"
        else:
            status = "identical" if row["years"] == float(cell["years"]) else "different"
        out.append({"state": key[0], "claim": key[1], "advottic_years": cell["years"], "advottic_note": cell["note"], "status": status,
                    "limitation_periods_id": row["id"] if row else None, "limitation_periods_period": row["period_text"] if row else None,
                    "section_checked": (row or {}).get("section") or "", "code_check": (row or {}).get("check") or "",
                    "primary_source_review": (row or {}).get("review_fact") or ""})
    extra = sorted(set(lp_rows) - set(adv_cells))
    return out, extra


def md_table(headers, rows):
    def esc(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(esc(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def main():
    data, adv = load_advottic()
    lp = load_limitation_periods()
    review = load_review()
    vs_lp, lp_extra = compare_lp(adv, lp)
    vs_review = compare_review(adv, review)
    lp_counts = collections.Counter(r["status"] for r in vs_lp)
    rv_counts = collections.Counter(r["status"] for r in vs_review)
    code_check_counts = collections.Counter(r["code_check"] for r in vs_lp)
    lacking = collections.defaultdict(list)
    for (state, claim), cell in sorted(adv.items()):
        if REVIEW_MAP.get(claim) is None:
            lacking[claim].append(state)
    for r in vs_review:
        if r["status"] == "corpus_lacks":
            lacking[r["advottic_claim"]].append(r["state"])
    review_items = []
    for r in vs_review:
        if r["status"] in ("disagree", "mixed"):
            review_items.append({"kind": "advottic_vs_cited_rule", "state": r["state"], "claim": r["advottic_claim"], "advottic_years": r["advottic_years"],
                                 "advottic_note": r["advottic_note"], "corpus": [{k: e[k] for k in ("rule_id", "years", "pinpoint", "source_url", "scope_text")} for e in r["compared_rules"]],
                                 "action": "Review only: confirm against the cited statute; do not change Time Limits data from this report."})
    for r in vs_lp:
        if r["code_check"] == "Saved statute states a different period":
            review_items.append({"kind": "limitation_periods_code_check", "state": r["state"], "claim": r["claim"], "advottic_years": r["advottic_years"],
                                 "limitation_periods_period": r["limitation_periods_period"], "section_checked": r["section_checked"],
                                 "action": "Already flagged in limitation_periods (the saved statute states a different period); review only."})
    for r in vs_lp:
        if r["status"] == "different":
            review_items.append({"kind": "advottic_version_drift", "state": r["state"], "claim": r["claim"], "advottic_years": r["advottic_years"],
                                 "limitation_periods_period": r["limitation_periods_period"],
                                 "action": "Advottic's current file differs from the copy reproduced in limitation_periods; review only."})
    inputs = [{"url": ADVOTTIC_URL, "path": os.path.relpath(ADVOTTIC_PATH, ROOT), "sha256": sha256(ADVOTTIC_PATH)}]
    for name in ("limitation_periods", "statutory_limitations_review"):
        path = os.path.join(LOOKUPS, name + ".json")
        inputs.append({"url": f"corpus dataset {name} (read-only SQL lookup)", "path": os.path.relpath(path, ROOT), "sha256": sha256(path)})
    report = {
        "title": "Advottic statute-of-limitations table vs corpus limitations datasets (private review report)",
        "hold": "PRIVATE. Never publish. Owner hold: Time Limits data is not created, edited or published from this report; every item is a review item only.",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": {"name": data["name"], "version": data.get("version"), "dateModified": data.get("dateModified"), "license": data.get("license"),
                   "publisher": data.get("publisher", {}).get("name"), "url": ADVOTTIC_URL,
                   "terms": "Advottic open-data page: CC BY 4.0 with attribution; no per-entry statutory citations in the file",
                   "third_party": True},
        "inputs": inputs,
        "advottic_cells": len(adv),
        "mapping": [{"advottic_claim": c, "advottic_label": next((t["label"] for t in data["claimTypes"] if t["id"] == c), c),
                     "limitation_periods_claim": c, "statutory_limitations_review_claim": REVIEW_MAP[c] or "none", "note": MAP_NOTES.get(c, "No corpus cited rule for this category.")}
                    for c in REVIEW_MAP],
        "unmapped_corpus_claims": UNMAPPED_CORPUS,
        "vs_limitation_periods": {"counts": dict(lp_counts), "code_check_counts": dict(code_check_counts), "rows_only_in_limitation_periods": [list(k) for k in lp_extra],
                                  "independence": "limitation_periods reproduces the Advottic table (its qualification cites 'Advottic Legal Data, reviewed 2026-06-08, CC BY 4.0'); agreement with it is a version check, not independent confirmation.",
                                  "rows": vs_lp},
        "vs_statutory_limitations_review": {"counts": dict(rv_counts), "rows": vs_review},
        "lacking": {claim: states for claim, states in lacking.items()},
        "review_items": review_items,
    }
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "sol_discrepancies.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
    write_md(report)
    print(json.dumps({"vs_limitation_periods": dict(lp_counts), "vs_review": dict(rv_counts), "review_items": len(review_items)}))


def write_md(rep):
    rv = rep["vs_statutory_limitations_review"]
    lp = rep["vs_limitation_periods"]
    out = [f"# {rep['title']}", "", f"> **{rep['hold']}**", "",
           f"Generated {rep['generated_at']}. Source: {rep['source']['name']} v{rep['source']['version']} ({rep['source']['dateModified']}), "
           f"publisher {rep['source']['publisher']}, license {rep['source']['license']} — a third-party compilation with no per-entry statutory citations. "
           f"{rep['advottic_cells']} cells (51 jurisdictions x 9 claim categories).", "",
           "## Inputs", "", md_table(["Input", "Path", "sha256"], [[i["url"], i["path"], i["sha256"][:16] + "…"] for i in rep["inputs"]]), "",
           "## Category mapping", "",
           md_table(["Advottic category", "Label", "limitation_periods", "statutory_limitations_review", "Note"],
                    [[m["advottic_claim"], m["advottic_label"], m["limitation_periods_claim"], m["statutory_limitations_review_claim"], m["note"]] for m in rep["mapping"]]), "",
           "Corpus categories with no Advottic counterpart: " + "; ".join(f"`{k}` — {v}" for k, v in rep["unmapped_corpus_claims"].items()), "",
           "## A. Advottic file vs `limitation_periods` (459 rows)", "", lp["independence"], "",
           md_table(["Status", "Cells"], sorted(lp["counts"].items())), "",
           "Code checks already recorded in `limitation_periods` (whether the period wording was found in the saved state code):", "",
           md_table(["limitation_periods check", "Cells"], sorted(lp["code_check_counts"].items(), key=lambda kv: -kv[1])), ""]
    diffs = [r for r in lp["rows"] if r["status"] != "identical"]
    if diffs:
        out += ["Cells that differ between the current Advottic file and `limitation_periods`:", "",
                md_table(["State", "Claim", "Advottic now", "limitation_periods"], [[r["state"], r["claim"], fmt_years(r["advottic_years"]), r["limitation_periods_period"]] for r in diffs]), ""]
    else:
        out += ["No cell differs: the current Advottic file (v2026.06) matches the copy reproduced in `limitation_periods`.", ""]
    flagged = [r for r in lp["rows"] if r["code_check"] == "Saved statute states a different period"]
    out += ["Cells where `limitation_periods` already found a different period in the saved statute:", "",
            md_table(["State", "Claim", "Advottic", "Section checked", "Primary-source review"],
                     [[r["state"], r["claim"], fmt_years(r["advottic_years"]), r["section_checked"] or "Not recorded", r["primary_source_review"] or "Not recorded"] for r in flagged]), "",
            "## B. Advottic vs `statutory_limitations_review` (cited primary-source rules)", "",
            md_table(["Status", "Cells"], sorted(rv["counts"].items())), "",
            "Status meanings: `agree` every ordinary-scope cited rule states the Advottic period; `disagree` none does; `mixed` several ordinary-scope rules state different periods; "
            "`not_comparable` cited rules exist but state no calendar-year period of ordinary scope; `corpus_lacks` no cited rule for that state and claim.", ""]
    dis = [r for r in rv["rows"] if r["status"] in ("disagree", "mixed")]
    out += ["### Disagreements (review items)", "",
            md_table(["State", "Claim", "Advottic", "Advottic caveat", "Corpus period", "Corpus authority", "Corpus source", "Corpus scope"],
                     [[r["state"], r["advottic_claim"], fmt_years(r["advottic_years"]), r["advottic_note"] or "—",
                       "; ".join(fmt_years(e["years"]) for e in r["compared_rules"]), "; ".join(e["pinpoint"] for e in r["compared_rules"]),
                       "; ".join(e["source_url"] for e in r["compared_rules"]), "; ".join(e["scope_text"][:120] for e in r["compared_rules"])] for r in dis]) if dis else "None.", ""]
    agree = [r for r in rv["rows"] if r["status"] == "agree"]
    out += ["### Agreements", "",
            md_table(["State", "Claim", "Period", "Corpus authority"],
                     [[r["state"], r["advottic_claim"], fmt_years(r["advottic_years"]), "; ".join(e["pinpoint"] for e in r["compared_rules"])] for r in agree]), ""]
    nc = [r for r in rv["rows"] if r["status"] == "not_comparable"]
    out += ["### Not comparable (cited rules exist, no ordinary-scope calendar-year period)", "",
            md_table(["State", "Claim", "Advottic", "Corpus rules"],
                     [[r["state"], r["advottic_claim"], fmt_years(r["advottic_years"]), "; ".join(f"{e['rule_id'].split(':')[1]} ({e['not_comparable'] or e['scope']})" for e in r["other_rules"])] for r in nc]) if nc else "None.", ""]
    out += ["## C. Items we lack (Advottic cells with no corpus cited rule)", "",
            md_table(["Advottic category", "Jurisdictions without a cited corpus rule", "Count"],
                     [[claim, ", ".join(states), len(states)] for claim, states in rep["lacking"].items()]), "",
            "These are gaps only. Advottic values for them are not evidence and must not be loaded into Time Limits.", "",
            f"## Review items ({len(rep['review_items'])})", "",
            "Every item is for human review against the official code; none changes any served rule. Full list with source URLs in `sol_discrepancies.json` (`review_items`).", ""]
    with open(os.path.join(BUILD, "sol_discrepancies.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(out))


if __name__ == "__main__":
    main()
