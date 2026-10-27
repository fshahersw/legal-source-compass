"""Pure exposure rules for company_sec_mdl_links and company_sec_profiles (no network, no corpus access).

Counting rule: a company-MDL link counts toward a company's pending-action totals only when its evidence excerpt reads
the company as a defendant, the link is not dismissed and it carries no review note. A tier C link ("the filing
describes the MDL by its subject") always carries a review note: it is shown, flagged for review and never counted.
Pending actions are the MDL-wide JPML count, so a company total is the sum over its counted MDLs and is never summed
across companies.
"""
from collections import Counter, defaultdict

EXPOSURE_ROLES = {"defendant"}
TIER_C_NOTE = ("Tier C: the filing describes the MDL by its subject, not by its number or caption; the link requires "
               "review and is not counted toward pending-action totals.")
FLAG_ORDER = ("accrual_surge", "accrual_heavy", "expense_spike", "docket_growth", "multi_mdl")


def review_note_for(tier, reviewed_note=None):
    """The link's review note: a reviewer's note first, else the tier C note, else None."""
    if reviewed_note:
        return reviewed_note
    return TIER_C_NOTE if tier == "C" else None


def counts_toward_exposure(role, dismissed, review_note):
    return role in EXPOSURE_ROLES and not dismissed and not review_note


def apply_tier_rule(link):
    """A link dict with review/review_note/counts_toward_exposure set by the rule above (input not changed)."""
    out = dict(link)
    note = review_note_for(out.get("tier"), out.get("review_note"))
    out["review_note"] = note
    out["review"] = bool(note)
    out["counts_toward_exposure"] = counts_toward_exposure(out.get("role"), bool(out.get("dismissed")), note)
    return out


def company_exposure(links, pending_total_all):
    """(exposure dict, pending counted links) for one company's links, exactly as build_company_sec.py publishes it.

    links: dicts with mdl_status, pending, change_12m, tier, role, counts_toward_exposure, dismissed, review."""
    exposure_links = [l for l in links if l["counts_toward_exposure"]]
    pending_links = [l for l in exposure_links if l["mdl_status"] == "pending"]
    pending_actions = sum(l["pending"] or 0 for l in pending_links) if pending_links else None
    pending_ab = sum(l["pending"] or 0 for l in pending_links if l["tier"] in ("A", "B")) if pending_links else None
    pending_c = sum(l["pending"] or 0 for l in pending_links if l["tier"] == "C") if pending_links else None
    unclear_links = [l for l in links if l["mdl_status"] == "pending" and l["role"] == "unclear"
                     and not l["dismissed"] and not l["review"]]
    pending_unclear = sum(l["pending"] or 0 for l in unclear_links) if unclear_links else None
    changes = [l["change_12m"] for l in pending_links if l["change_12m"] is not None]
    change_12m = sum(changes) if changes else None
    base = (pending_actions - change_12m) if pending_actions is not None and change_12m is not None else None
    change_pct = round(100 * change_12m / base, 1) if base else None
    exposure = {
        "linked_mdls": len(links), "pending_mdls": len(pending_links), "pending_actions": pending_actions,
        "pending_change_12m": change_12m, "pending_change_pct": change_pct,
        "share_of_all_pending_pct": round(100 * pending_actions / pending_total_all, 2) if pending_actions and pending_total_all else None,
        "strongest_tier": min((l["tier"] for l in pending_links), default=None),
        "strongest_tier_any": min((l["tier"] for l in links), default=None),
        "excluded_by_role": len(links) - len(exposure_links),
        "roles": dict(Counter(l["role"] for l in links)),
        "pending_actions_ab": pending_ab, "pending_actions_c": pending_c,
        "pending_actions_unclear": pending_unclear, "pending_mdls_unclear": len(unclear_links),
        "dismissed_links": sum(1 for l in links if l["dismissed"]), "review_links": sum(1 for l in links if l["review"]),
    }
    return exposure, pending_links


def exposure_flags(old_flags, exposure, accrual_current, accrual_yoy_pct):
    """Flags after an exposure change: the two accrual/expense-only flags are kept as published; the three that read
    the exposure (accrual_surge, docket_growth, multi_mdl) are recomputed with the builder's thresholds."""
    keep = {f for f in old_flags or [] if f in ("accrual_heavy", "expense_spike")}
    change, pct, pa = exposure["pending_change_12m"], exposure["pending_change_pct"], exposure["pending_actions"]
    if accrual_current and accrual_yoy_pct is not None and accrual_yoy_pct >= 50 and change is not None and change > 0:
        keep.add("accrual_surge")
    if pct is not None and pct >= 25 and (pa or 0) >= 100:
        keep.add("docket_growth")
    if exposure["pending_mdls"] >= 3:
        keep.add("multi_mdl")
    return [f for f in FLAG_ORDER if f in keep]


def pending_series(pending_links, series_by_mdl):
    """Monthly sum of JPML pending actions across the counted pending MDLs; 'mdls' = how many appear in that report."""
    sums = defaultdict(lambda: [0, 0])
    for l in pending_links:
        for x in series_by_mdl.get(l["mdl"]) or []:
            sums[x["date"]][0] += x["pending"]
            sums[x["date"]][1] += 1
    return [{"date": d, "pending": v[0], "mdls": v[1]} for d, v in sorted(sums.items())]


def coverage_totals(coverage):
    """(counted_ab, counted_c, unclear_only) pending actions across pending target MDLs, each MDL counted once."""
    counted_ab = counted_c = unclear_only = 0
    for row in coverage:
        if row["status"] != "pending" or not row["pending"]:
            continue
        counted = [c for c in row["companies"] if c["counted"]]
        if counted:
            if any(c["tier"] in ("A", "B") for c in counted):
                counted_ab += row["pending"]
            else:
                counted_c += row["pending"]
        elif any(c["role"] == "unclear" and not c["dismissed"] and not c["review"] for c in row["companies"]):
            unclear_only += row["pending"]
    return counted_ab, counted_c, unclear_only
