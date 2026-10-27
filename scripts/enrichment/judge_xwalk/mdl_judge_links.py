"""Exact transferee-judge links for the mdls registry (dry run: no network, no writes).

The registry joined each JPML-printed transferee judge to a judges profile by name (judge_match_kind exact, middle_initial, middle_omitted,
first_initial) or by a saved CourtListener person bridge. The owner rule allows a link only on an exact identifier or a unique exact name.
This builder re-derives every MDL's link from the CourtListener docket assignment instead (corpus_ingest.relationships: the master docket's
dockets.assigned_to_id, CourtListener bulk data of 2026-09-30) mapped to a judges profile through judge_cl_crosswalk:

  * the assigned person resolves to a profile only through a unique 'exact_id' crosswalk row (FJC nid -> FJC jid == CourtListener
    people.fjc_id, native ids only), else a unique row of an exact-name tier ('exact_name_same_court' / 'exact_name_same_state');
    'parent_profile_link' rows are directory stubs of the same person and never outrank the exact_id row; 'compatible_name_*' rows
    (middle name compatible only) never resolve;
  * outcome per MDL (OUTCOMES):
      confirmed   the assigned person's profile is the linked profile: the link now rests on the docket assignment (exact id)
      new         no profile was linked and the docket names one (only where the JPML report prints no judge)
      conflict    the docket's profile differs from the JPML-printed judge's profile: both are shown, neither is linked
      kept_exact  the JPML-printed name equals the profile name exactly in the same court, or a saved native person bridge links it;
                  no docket assignment contradicts it
      review      a name-variant link (middle initial, omitted middle name, first initial) that no identifier confirms: kept only as a
                  candidate marked 'needs review', never as a link
      unlinked    nothing was linked and nothing exact links it
The docket assignment is CourtListener's as of its last refresh and may lag a reassignment; a disagreement is shown, never resolved.
"""
from collections import Counter

LINKED_EXACT_TIERS = ("exact_name_same_court", "exact_name_same_state")
NAME_VARIANTS = {"middle_initial", "middle_omitted", "first_initial"}
OUTCOMES = ("confirmed", "new", "conflict", "kept_exact", "review", "unlinked")
ASSIGNED_AS_OF = "2026-09-30"
BASIS_DOCKET = "cl_docket_assigned_to"


def person_profile(profiles):
    """(profile id, tier) of a CourtListener person from its crosswalk rows, or (None, reason)."""
    profiles = profiles or []
    exact = sorted({p["judges_id"] for p in profiles if p.get("tier") == "exact_id"})
    if len(exact) == 1:
        return exact[0], "exact_id"
    if len(exact) > 1:
        return None, "several_exact_id_profiles"
    named = sorted({(p["judges_id"], p["tier"]) for p in profiles if p.get("tier") in LINKED_EXACT_TIERS})
    if len(named) == 1:
        return named[0]
    if len(named) > 1:
        return None, "several_exact_name_profiles"
    if any(p.get("tier", "").startswith("compatible_name") for p in profiles):
        return None, "compatible_name_only"
    return None, "no_profile_for_person"


def person_name(name):
    if not name:
        return None
    parts = [name.get("first"), name.get("middle"), name.get("last")]
    text = " ".join(p.strip() for p in parts if p and p.strip())
    suffix = (name.get("suffix") or "").strip()
    return f"{text} {suffix}".strip() if text else None


def classify(m):
    """Decision for one mdls snapshot row: {outcome, profile, person, person_profile, tier, reason, ...}."""
    assigned = m.get("assigned") or []
    a = assigned[0] if len(assigned) == 1 else None
    person = a["person"] if a else None
    a_profile, a_tier = person_profile(a.get("profiles")) if a else (None, "no_docket_assignment" if not assigned else "several_assignments")
    a_entity = a_name = None
    if a and a_profile:
        hit = next((p for p in a["profiles"] if p["judges_id"] == a_profile), {})
        a_entity, a_name = hit.get("entity_id"), hit.get("name")
    cur = m.get("judge_profile_id")
    kind = m.get("judge_match_kind")
    out = {"id": m["id"], "mdl": m.get("mdl_number"), "row_md5": m["row_md5"], "printed": m.get("judge_name_as_printed"), "current_profile": cur,
           "match_kind": kind, "person": person, "person_name": person_name(a.get("name")) if a else None, "person_profile": a_profile,
           "person_profile_tier": a_tier if a_profile else None, "person_profile_reason": None if a_profile else a_tier,
           "person_profile_entity": a_entity, "person_profile_name": a_name, "evidence_sha256": a.get("evidence_sha256") if a else None}
    if a_profile and cur:
        out.update(outcome="confirmed" if a_profile == cur else "conflict", profile=a_profile if a_profile == cur else None)
    elif a_profile and not cur:
        if m.get("judge_name_as_printed"):
            out.update(outcome="conflict", profile=None)  # the JPML prints a judge no profile was linked for; the docket names someone: show both
        else:
            out.update(outcome="new", profile=a_profile)
    elif cur and kind in NAME_VARIANTS:
        out.update(outcome="review", profile=None)
    elif cur and kind in ("exact", "cl_person_native_bridge"):
        clash = person and m.get("judge_cl_person_id") and str(m["judge_cl_person_id"]) != str(person)
        out.update(outcome="conflict" if clash else "kept_exact", profile=None if clash else cur)
    elif cur:
        out.update(outcome="review", profile=None)  # a link with no recorded basis
    else:
        out.update(outcome="unlinked", profile=None)
    out["link_evidence"] = {"confirmed": BASIS_DOCKET, "new": BASIS_DOCKET,
                            "kept_exact": "cl_person_native_bridge" if kind == "cl_person_native_bridge" else "jpml_exact_name_court"}.get(out["outcome"])
    out["review"] = {"conflict": "cl_assigned_to_differs", "review": "name_variant_unconfirmed"}.get(out["outcome"])
    if out["outcome"] in ("kept_exact", "unlinked") and person and not a_profile:
        out["review"] = "cl_assigned_to_unresolved"  # the docket names a person no profile is established for; the link (if any) stands
    # CourtListener person on the record: the docket assignee when there is one, else the person of a still-linked profile's own bridge
    if person:
        out["cl_person"], out["cl_person_basis"] = person, (
            "judge_profile_native_bridge+" + BASIS_DOCKET if out["outcome"] == "confirmed" and str(m.get("judge_cl_person_id") or "") == str(person)
            and "judge_profile_native_bridge" in (m.get("judge_cl_person_basis") or "") else BASIS_DOCKET)
    elif out["profile"]:
        out["cl_person"], out["cl_person_basis"] = m.get("judge_cl_person_id"), m.get("judge_cl_person_basis")
    else:
        out["cl_person"], out["cl_person_basis"] = None, None
    return out


def tally(decisions, snapshot):
    before_kinds = Counter(m.get("judge_match_kind") or "(none)" for m in snapshot)
    return {
        "mdls": len(snapshot),
        "numeric_master_dockets": sum(1 for m in snapshot if str(m.get("cl_docket_id") or "").isdigit()),
        "with_docket_assignment": sum(1 for m in snapshot if m.get("assigned")),
        "linked_before": sum(1 for m in snapshot if m.get("judge_profile_id")),
        "linked_before_by_match_kind": dict(sorted(before_kinds.items())),
        "linked_after": sum(1 for d in decisions if d["profile"]),
        "linked_after_by_evidence": dict(sorted(Counter(d["link_evidence"] for d in decisions if d["profile"]).items())),
        "outcomes": {o: sum(1 for d in decisions if d["outcome"] == o) for o in OUTCOMES},
        "needs_review": dict(sorted(Counter(d["review"] for d in decisions if d["review"]).items())),
    }
