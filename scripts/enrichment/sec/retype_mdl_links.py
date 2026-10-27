"""Apply the tier C rule to the published company_sec_mdl_links and recompute the company_sec_profiles exposure.

Tier C links ("the filing describes the MDL by its subject (requires review)") were published with
counts_toward_exposure=true and review=false on 69 links. The rule (exposure.py) gives every tier C link a review note,
review=true and counts_toward_exposure=false. The company profiles are recomputed from their own published MDL entries
with the builder's code (exposure.company_exposure), so the pending-action totals, flags, badges, filters and monthly
pending series stay consistent with the links. Before anything changes, every profile's published exposure is
recomputed from its published entries and must match exactly; any mismatch stops the build.

  python3 -I -B scripts/enrichment/sec/retype_mdl_links.py --export          # lead, read-only
  python3 -I -B scripts/enrichment/sec/retype_mdl_links.py --build           # dry run, no network
  python3 -I -B scripts/enrichment/sec/retype_mdl_links.py --publish         # lead only: links, then profiles

Files: private/acq/de-settlements-sec/{company_sec_mdl_links,company_sec_profiles}.export.json (exports) and
private/build/de-settlements-sec/{company_sec_mdl_links,company_sec_profiles}.json plus company_sec_retype.report.json.
"""
import argparse
import copy
import json
import os
import statistics
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import exposure as xp  # noqa: E402

LINKS, PROFILES = "company_sec_mdl_links", "company_sec_profiles"
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PRIVATE = os.environ.get("CORPUS_PRIVATE_ROOT") or os.path.join(ROOT, "private")
ACQ = os.path.join(PRIVATE, "acq", "de-settlements-sec")
BUILD = os.path.join(PRIVATE, "build", "de-settlements-sec")
REPORT = os.path.join(BUILD, "company_sec_retype.report.json")
SELECT = "id,category,state,title,source_url,item,detail,text,filters,ordinal"
COUNT_FACT = "Counted in pending-action totals"


def labels():
    import build_company_sec as b  # constants only; importing it does no network work

    return b.TIER_LABEL, b.FLAG_LABEL, b.fmt


def retype_link_row(row):
    """A published link row with the tier C rule applied (input unchanged)."""
    out = copy.deepcopy(row)
    out.pop("ordinal", None)
    link = xp.apply_tier_rule(out["item"]["link"])
    out["item"]["link"] = link
    facts = [f for f in out["detail"]["facts"] if f[0] != COUNT_FACT]
    reason = "Yes" if link["counts_toward_exposure"] else ("No: " + (link["review_note"] or (
        "dismissal language in the latest excerpt" if link.get("dismissed") else "the excerpt does not read the company as a defendant")))
    facts.append([COUNT_FACT, reason])
    out["detail"]["facts"] = facts
    out["filters"]["counted"] = ["yes" if link["counts_toward_exposure"] else "no"]
    out["filters"]["review"] = ["yes" if link["review"] else "no"]
    return out


def infer_pending_total(profiles):
    """The all-MDL pending total the builder divided by, read back from the published shares and checked on every row."""
    pairs = [(p["item"]["summary"]["exposure"]["pending_actions"], p["item"]["summary"]["exposure"]["share_of_all_pending_pct"])
             for p in profiles if p["id"] != "summary:overview"]
    pairs = [(a, s) for a, s in pairs if a and s]
    if not pairs:
        return None
    guess = round(statistics.median(a * 100 / s for a, s in pairs))
    fits = [t for t in range(guess - 400, guess + 401) if all(round(100 * a / t, 2) == s for a, s in pairs)]
    if len(fits) == 1:
        return fits[0]
    raise SystemExit(f"the published shares fit {len(fits)} totals ({fits[0] if fits else '-'}..{fits[-1] if fits else '-'}); "
                     "pass --pending-total (the sum of actions_pending over pending MDLs in the JPML report the build used)")


def check_total(profiles, total):
    """True when every published share is reproduced by this total."""
    return all(round(100 * a / total, 2) == s for a, s in (
        (p["item"]["summary"]["exposure"]["pending_actions"], p["item"]["summary"]["exposure"]["share_of_all_pending_pct"])
        for p in profiles if p["id"] != "summary:overview") if a and s)


def profile_links(profile):
    """The profile's published MDL entries in the shape company_exposure reads."""
    return [dict(m) for m in profile["item"]["summary"]["mdls"]]


def check_reproduces(profiles, total):
    bad = []
    for p in profiles:
        if p["id"] == "summary:overview":
            continue
        got, _ = xp.company_exposure(profile_links(p), total)
        want = p["item"]["summary"]["exposure"]
        diff = {k: (want.get(k), got.get(k)) for k in got if want.get(k) != got.get(k)}
        if diff:
            bad.append({"cik": p["id"], "diff": diff})
    return bad


def pending_label(exposure, fmt):
    """The pending-actions cell: a count, or, when no pending link is counted but some links await review, that known
    state ("None counted (3 links await review)") instead of "Not recorded", which would read as missing data."""
    if exposure["pending_actions"] is None and exposure.get("review_links"):
        n = exposure["review_links"]
        return f"None counted ({fmt(n)} link{'s' if n != 1 else ''} await{'s' if n == 1 else ''} review)"
    return fmt(exposure["pending_actions"])


FILTERS_ADDED = [
    {"name": "counted", "type": "select", "label": "Counted in pending-action totals", "options": [{"label": "Counted", "value": "yes"}, {"label": "Not counted", "value": "no"}]},
    {"name": "review", "type": "select", "label": "Requires review", "options": [{"label": "Requires review", "value": "yes"}, {"label": "No review note", "value": "no"}]},
]


def add_link_filters(listing):
    """The listing with the counted and review filters, each added only when absent (a second retype adds nothing)."""
    out = copy.deepcopy(listing or {})
    have = {f.get("name") for f in out.get("filters") or []}
    out.setdefault("filters", []).extend(copy.deepcopy(f) for f in FILTERS_ADDED if f["name"] not in have)
    return out


def retype_profile(profile, link_by_key, total):
    tier_label, flag_label, fmt = labels()
    out = copy.deepcopy(profile)
    out.pop("ordinal", None)
    s = out["item"]["summary"]
    cik = out["id"]
    for m in s["mdls"]:
        link = link_by_key.get((cik, int(m["mdl"])))
        if link is None:
            raise SystemExit(f"profile {cik} lists MDL {m['mdl']} but no link row exists")
        m["counts_toward_exposure"], m["review"] = link["counts_toward_exposure"], link["review"]
    before = s["exposure"]
    exposure, pending_links = xp.company_exposure(s["mdls"], total)
    s["exposure"] = exposure
    s["flags"] = xp.exposure_flags(s.get("flags"), exposure, s.get("accrual_current"), s.get("accrual_yoy_pct"))
    s["pending_series"] = xp.pending_series(pending_links, {int(k[1]): v["series"] for k, v in link_by_key.items() if k[0] == cik})
    out["item"]["cells"]["pending"] = pending_label(exposure, fmt)
    out["item"]["badges"] = [flag_label[f] for f in s["flags"]]
    out["filters"]["tier"] = [exposure["strongest_tier"] or "none"]
    out["filters"]["flag"] = s["flags"] or ["none"]
    for f in out["detail"]["facts"]:
        if f[0] == "Pending actions, linked MDLs where the company is a defendant":
            f[1] = (pending_label(exposure, fmt) if exposure["pending_actions"] is None and exposure.get("review_links") else
                    f"{fmt(exposure['pending_actions'])} (A/B {fmt(exposure['pending_actions_ab'])} · C {fmt(exposure['pending_actions_c'])})")
    change = {"cik": cik, "company": out["title"], "pending_before": before.get("pending_actions"), "pending_after": exposure["pending_actions"],
              "pending_mdls_before": before.get("pending_mdls"), "pending_mdls_after": exposure["pending_mdls"],
              "tier_before": before.get("strongest_tier"), "tier_after": exposure["strongest_tier"],
              "flags_before": profile["item"]["summary"].get("flags"), "flags_after": s["flags"]}
    return out, change


def retype_overview(overview_row, link_by_key, company_rows):
    out = copy.deepcopy(overview_row)
    out.pop("ordinal", None)
    ov = out["item"]["overview"]
    for row in ov["coverage"]:
        for c in row["companies"]:
            link = link_by_key.get((c["cik"], int(row["mdl"])))
            if link is not None:
                c["counted"], c["review"] = link["counts_toward_exposure"], link["review"]
        row["companies"].sort(key=lambda c: (not c["counted"], c["tier"]))
    before = {k: ov.get(k) for k in ("pending_actions_counted", "pending_actions_counted_ab", "pending_actions_counted_c", "pending_actions_unclear_only")}
    ab, c, unclear = xp.coverage_totals(ov["coverage"])
    ov.update({"pending_actions_counted": ab + c, "pending_actions_counted_ab": ab, "pending_actions_counted_c": c,
               "pending_actions_unclear_only": unclear,
               "tier_c_review_links": sum(1 for (cik, mdl), l in link_by_key.items() if l["tier"] == "C")})
    sectors = {}
    for r in company_rows:
        sm = r["item"]["summary"]
        key = sm["company"].get("sic_description") or "Not recorded"
        e = sectors.setdefault(key, {"sector": key, "companies": 0, "pending": 0})
        e["companies"] += 1
        e["pending"] += sm["exposure"]["pending_actions"] or 0
    ov["sectors"] = sorted(sectors.values(), key=lambda x: -x["pending"])
    ov["method"] = [m.replace("'not named', claimant, dismissal-language and review-flagged links are never counted. Totals are split by evidence strength (A/B vs C).",
                              "'not named', claimant, dismissal-language, tier C and review-flagged links are never counted (every tier C link carries a review note). Totals are split by evidence strength (A/B vs C); the C share is zero while tier C links await review.")
                    for m in ov.get("method") or []]
    after = {k: ov[k] for k in before}
    return out, {"before": before, "after": after}


def retype_all(link_rows, profile_rows, total=None):
    total = total or infer_pending_total(profile_rows)
    if not check_total(profile_rows, total):
        raise SystemExit(f"--pending-total {total} does not reproduce the published shares")
    mismatches = check_reproduces(profile_rows, total)
    if mismatches:
        raise SystemExit(f"published exposure not reproduced for {len(mismatches)} profiles: {json.dumps(mismatches[:3])}")
    links = [retype_link_row(r) for r in sorted(link_rows, key=lambda r: r.get("ordinal", 0))]
    link_by_key = {(r["item"]["link"]["cik"], int(r["item"]["link"]["mdl"])): r["item"]["link"] for r in links}
    companies, changes, overview = [], [], None
    for p in sorted(profile_rows, key=lambda r: r.get("ordinal", 0)):
        if p["id"] == "summary:overview":
            overview = p
            continue
        row, change = retype_profile(p, link_by_key, total)
        companies.append(row)
        if change["pending_before"] != change["pending_after"] or change["flags_before"] != change["flags_after"]:
            changes.append(change)
    profiles = list(companies)
    ov_change = None
    if overview is not None:
        ov_row, ov_change = retype_overview(overview, link_by_key, companies)
        profiles.append(ov_row)
    before_c = sum(1 for r in link_rows if r["item"]["link"]["tier"] == "C" and (r["item"]["link"]["counts_toward_exposure"] or not r["item"]["link"]["review"]))
    report = {
        "pending_total_all": total, "links": len(links), "profiles": len(profiles),
        "tier_c_links": sum(1 for r in links if r["item"]["link"]["tier"] == "C"),
        "tier_c_links_changed": before_c,
        "tier_c_counted_after": sum(1 for r in links if r["item"]["link"]["tier"] == "C" and r["item"]["link"]["counts_toward_exposure"]),
        "tier_c_without_review_after": sum(1 for r in links if r["item"]["link"]["tier"] == "C" and not r["item"]["link"]["review"]),
        "companies_with_pending_before": sum(1 for p in profile_rows if p["id"] != "summary:overview" and p["item"]["summary"]["exposure"]["pending_actions"]),
        "companies_with_pending_after": sum(1 for p in companies if p["item"]["summary"]["exposure"]["pending_actions"]),
        "overview": ov_change, "company_changes": changes,
    }
    return links, profiles, report


def load(name):
    return json.load(open(os.path.join(ACQ, f"{name}.export.json"), encoding="utf-8"))


def export():
    import corpus_writer as writer  # noqa: E402

    os.makedirs(ACQ, exist_ok=True)
    for name in (LINKS, PROFILES):
        rows = writer.fetch_all(name, select=SELECT)
        meta = writer._call("GET", f"corpus_datasets?select=id,label,metadata,imported_records&id=eq.{name}", prefer="return=representation")
        with open(os.path.join(ACQ, f"{name}.export.json"), "w", encoding="utf-8") as h:
            json.dump({"dataset": name, "exported_at": datetime.now(timezone.utc).isoformat(), "meta": meta[0] if meta else None, "rows": rows}, h, ensure_ascii=False)
        print(json.dumps({"exported": name, "rows": len(rows)}))


def build(total=None):
    exports = {n: load(n) for n in (LINKS, PROFILES)}
    for n, blob in exports.items():
        expected = (blob.get("meta") or {}).get("imported_records")
        if expected is not None and expected != len(blob["rows"]):
            raise SystemExit(f"{n}: export holds {len(blob['rows'])} rows but the dataset says {expected}; export again")
    links, profiles, report = retype_all(exports[LINKS]["rows"], exports[PROFILES]["rows"], total)
    os.makedirs(BUILD, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for name, rows in ((LINKS, links), (PROFILES, profiles)):
        md = (exports[name].get("meta") or {}).get("metadata") or {}
        listing = add_link_filters(md.get("listing")) if name == LINKS else copy.deepcopy(md.get("listing") or {})
        listing.pop("total", None)
        summary = {**(md.get("summary") or {}), "tier_c_rule": xp.TIER_C_NOTE, "retyped_at": stamp}
        packet = {"dataset": name, "label": exports[name]["meta"]["label"], "listing_block": listing, "summary": summary, "rows": rows, "built_at": stamp}
        with open(os.path.join(BUILD, f"{name}.json"), "w", encoding="utf-8") as h:
            json.dump(packet, h, ensure_ascii=False, separators=(",", ":"))
    with open(REPORT, "w", encoding="utf-8") as h:
        json.dump(report, h, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k not in ("company_changes",)}))
    print(json.dumps({"companies_changed": len(report["company_changes"]), "report": REPORT}))


def publish():
    import corpus_writer as writer  # noqa: E402

    for name in (LINKS, PROFILES):
        packet = json.load(open(os.path.join(BUILD, f"{name}.json"), encoding="utf-8"))
        writer.publish(name, packet["label"], packet["rows"], listing_block=packet["listing_block"], summary=packet["summary"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--export", action="store_true")
    mode.add_argument("--build", action="store_true")
    mode.add_argument("--publish", action="store_true")
    ap.add_argument("--pending-total", type=int, default=None, help="all-MDL pending total the published shares used (default: read back from them)")
    args = ap.parse_args(argv)
    if args.export:
        export()
    elif args.build:
        build(args.pending_total)
    else:
        publish()


if __name__ == "__main__":
    main()
