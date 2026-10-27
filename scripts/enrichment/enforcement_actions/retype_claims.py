"""Retype settlement_claims_official: amount roles and registry-verified MDL links on the published rows.

The official pages behind the dataset were read once (build_settlements.py); their raw files are not in every working
copy. This step needs only the published rows: every fact it adds is computed from text already published on the row
(the amount's own sentence, the case number as written) and from the MDL registry (the mdls dataset). Nothing is
fetched, inferred or summed. build_settlements.py applies the same retype when it builds from the raw pages.

What a row stores is time-independent: the confirmed deadline date, never a "closes within 30 days" status (readers
compute the status against today). The lead list the candidate settlements came from is not cited or linked on any
row: every published fact is from the official page, and the list's licence is an open owner question.

  # 1. read-only export of the published rows, the dataset entry and the MDL registry (lead, EXTERNAL_SUPABASE_*)
  python3 -I -B scripts/enrichment/enforcement_actions/retype_claims.py --export
  # 2. dry run: write the packet and the change report (no network)
  python3 -I -B scripts/enrichment/enforcement_actions/retype_claims.py --build
  # 3. publish the packet (lead only; replaces the dataset's rows with the retyped rows, same ids)
  python3 -I -B scripts/enrichment/enforcement_actions/retype_claims.py --publish

Files (git-ignored): private/acq/de-settlements-sec/settlement_claims_official.export.json and mdls.registry.json
(exports), private/build/de-settlements-sec/settlement_claims_official.json (packet: dataset, label, listing_block,
summary, rows) and settlement_claims_official.report.json (counts and every changed headline).
"""
import argparse
import copy
import json
import os
import sys
from collections import Counter
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import settle_types as stypes  # noqa: E402

DATASET = "settlement_claims_official"
NOT_RECORDED = "Not recorded"
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
# private/ lives in the main checkout; a worktree points here with CORPUS_PRIVATE_ROOT
PRIVATE = os.environ.get("CORPUS_PRIVATE_ROOT") or os.path.join(ROOT, "private")
EXPORT = os.path.join(PRIVATE, "acq", "de-settlements-sec", f"{DATASET}.export.json")
REGISTRY = os.path.join(PRIVATE, "acq", "de-settlements-sec", "mdls.registry.json")
PACKET = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{DATASET}.json")
REPORT = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{DATASET}.report.json")
SELECT = "id,category,state,title,source_url,item,detail,text,filters,ordinal"
LEAD_HOST = "settlesignal.com"
TYPE_RULE = ("Each dollar figure is typed from its own sentence on the official page: settlement fund total, per claimant, "
             "aggregate cap or other (fees and costs, service award, penalty, agency distribution round, addition to a "
             "fund, an agency order total that includes a penalty, estimate, eligibility threshold, or not stated). The "
             "headline is the largest settlement fund total; a per-claimant figure is never shown as the settlement "
             "amount, and a figure of $100,000 or more counts as per claimant only with per-unit wording. Figures are "
             "never summed.")
MDL_RULE = ("An MDL is linked only when a case number on the official page is that MDL's own master docket in the MDL "
            "registry (same office, year, md/ml/mn and number, e.g. 2:19-ml-02905 is MDL 2905) and, when the page names "
            "the court, the MDL's transferee court is that court. Captions and product names never link.")
DEADLINE_NOTE = ("Deadlines are dates the official page states. The status (open, closing soon, past) is not stored; "
                 "every reader computes it against today. Confirm on the official page before relying on a date.")
DROP_FACTS = ("Dollar figures confirmed on the page", "Settlement fund total", "Per-claimant figures",
              "MDL (case number in MDL docket form)", "MDL (case number is the MDL master docket)", "Claim deadline status",
              "Discovery source")


def load_registry(path=None):
    """{mdl_number: entry} from the MDL registry export; building without it would link unverified docket numbers."""
    path = path or REGISTRY
    if not os.path.exists(path):
        raise SystemExit(f"MDL registry export missing: {path}; run --export first")
    return stypes.registry_index(json.load(open(path, encoding="utf-8"))["rows"])


def amount_fact(a):
    role = stypes.ROLE_LABEL[a["role"]]
    if a["role"] == "other":
        role += f": {stypes.OTHER_DETAIL_LABEL.get(a.get('detail') or 'unclear', 'not stated')}"
    sentence = (a.get("sentence") or "")[:200]
    return f"{a['page_as_written']} — {role} — \"{sentence}\""


def is_lead_link(link):
    return (urlsplit(link.get("url") or "").hostname or "").endswith(LEAD_HOST)


def retype_row(row, as_of, registry):
    """The published row with typed amounts and registry-verified MDL links (input unchanged). as_of only orders the
    rows and feeds the report; nothing time-relative is stored on the row."""
    out = copy.deepcopy(row)
    out.pop("ordinal", None)
    item = out["item"]
    s = item["settlement"]
    typed = stypes.type_amounts(s.get("amounts") or [])
    for a in typed:
        a["role_label"] = stypes.ROLE_LABEL[a["role"]]
    s["amounts"] = typed
    head = stypes.headline(typed)
    per = stypes.first_of(typed, "per_claimant")
    s["fund_total"] = {k: head[k] for k in ("page_as_written", "value_usd", "sentence")} if head else None
    s["amount_rule"] = TYPE_RULE
    court_ids = [c.get("court_id") for c in s.get("courts") or [] if isinstance(c, dict)]
    mdls = stypes.mdl_links(s.get("case_numbers") or [], registry, court_ids)
    s["mdl_links"] = mdls
    s.pop("discovery", None)
    dl = (s.get("deadline") or {}).get("date")
    for k in ("state", "state_as_of"):
        (s.get("deadline") or {}).pop(k, None)

    cells = item["cells"]
    cells.pop("deadline_state", None)
    cells["deadline"] = dl or NOT_RECORDED
    cells["fund_total"] = head["page_as_written"] if head else NOT_RECORDED
    cells["per_claimant"] = per["page_as_written"] if per else NOT_RECORDED
    cells["amount"] = cells["fund_total"]
    cells["mdl"] = ", ".join(f"MDL {m['mdl']}" for m in mdls) or NOT_RECORDED

    f = out["filters"]
    f.pop("deadline_state", None)
    f["has_deadline"] = ["yes" if dl else "no"]
    f["deadline_year"] = [dl[:4]] if dl else []
    f["amount_role"] = sorted({a["role"] for a in typed}) or ["none"]
    f["mdl"] = [str(m["mdl"]) for m in mdls]

    facts = [x for x in out["detail"]["facts"] if x[0] not in DROP_FACTS]
    at = next((i for i, x in enumerate(facts) if x[0] == "Claim deadline"), len(facts) - 1) + 1
    added = [
        ["Settlement fund total", f"{head['page_as_written']} — \"{(head.get('sentence') or '')[:200]}\"" if head else NOT_RECORDED],
        ["Per-claimant figures", "; ".join(a["page_as_written"] for a in typed if a["role"] == "per_claimant") or NOT_RECORDED],
        ["Dollar figures confirmed on the page", "; ".join(amount_fact(a) for a in typed) or NOT_RECORDED],
        ["MDL (case number is the MDL master docket)", "; ".join(f"MDL {m['mdl']} ({m['case_number']})" for m in mdls) or NOT_RECORDED],
    ]
    out["detail"]["facts"] = facts[:at] + added + facts[at:]
    for holder in (item, out["detail"]):
        holder["links"] = [l for l in holder.get("links") or [] if not is_lead_link(l)
                           and not (l.get("url") or "").startswith("/matters/lens/")]
    for m in mdls:
        link = {"url": f"/matters/lens/{m['mdl']}", "label": f"MDL {m['mdl']} (case number {m['case_number']} on the official page)"}
        item["links"].append(link)
        out["detail"]["links"].append(dict(link))
    return out


def sort_key_for(as_of):
    """Open deadlines first (soonest first), then past deadlines (latest first), then rows with no deadline."""
    def key(row):
        dl = ((row["item"]["settlement"].get("deadline") or {}).get("date")) or ""
        state = stypes.deadline_state(dl or None, as_of)
        if state in ("within_30_days", "upcoming"):
            return (0, dl, row["id"])
        if state == "past":
            return (1, "".join(chr(0x10FFFF - ord(ch)) for ch in dl), row["id"])
        return (2, "", row["id"])
    return key


def listing_block():
    sys.path.insert(0, os.path.dirname(HERE))
    import corpus_writer as writer  # noqa: E402

    return writer.listing(
        [("settlement", "Settlement"), ("deadline", "Claim deadline"),
         ("fund_total", "Settlement fund total"), ("per_claimant", "Per claimant"), ("mdl", "MDL"),
         ("court", "Court"), ("case_number", "Case no."), ("official_page", "Official page"), ("verified", "Confirmed facts")],
        [("has_deadline", "Claim deadline confirmed", {"yes": "Deadline confirmed on the page", "no": "No deadline confirmed"}),
         ("amount_role", "Dollar figure type", {**stypes.ROLE_LABEL, "none": "No dollar figure confirmed"}),
         ("verified", "Confirmed fact", {"deadline": "Deadline", "amount": "Dollar figure", "court": "Court", "case number": "Case number"})])


def retype_all(rows, as_of, registry):
    out = sorted((retype_row(r, as_of, registry) for r in rows), key=sort_key_for(as_of))
    report = {"as_of": str(as_of), "rows": len(out), "deadline_state": Counter(), "amount_roles": Counter(),
              "other_details": Counter(), "rows_with_fund_total": 0, "rows_with_per_claimant_only": 0,
              "per_claimant_at_or_above_ceiling": [], "mdl_links": [], "mdl_docket_form_not_verified": [],
              "headline_changes": [], "lead_links_removed": 0}
    before = {r["id"]: r for r in rows}
    for r in out:
        s = r["item"]["settlement"]
        report["deadline_state"][stypes.deadline_state(s.get("deadline", {}).get("date"), as_of)] += 1
        for a in s["amounts"]:
            report["amount_roles"][a["role"]] += 1
            if a["role"] == "other":
                report["other_details"][a.get("detail") or "unclear"] += 1
            if a["role"] == "per_claimant" and (a.get("value_usd") or 0) >= stypes.PER_CLAIMANT_MAX_USD:
                report["per_claimant_at_or_above_ceiling"].append({"id": r["id"], "figure": a["page_as_written"], "basis": a.get("role_basis")})
        if s["fund_total"]:
            report["rows_with_fund_total"] += 1
        elif any(a["role"] == "per_claimant" for a in s["amounts"]):
            report["rows_with_per_claimant_only"] += 1
        linked = {m["mdl"] for m in s["mdl_links"]}
        for m in s["mdl_links"]:
            report["mdl_links"].append({"id": r["id"], "mdl": m["mdl"], "case_number": m["case_number"]})
        for c in s.get("case_numbers") or []:
            n = stypes.mdl_from_case_number(c.get("as_written") if isinstance(c, dict) else c)
            if n is not None and n not in linked:
                report["mdl_docket_form_not_verified"].append({"id": r["id"], "case_number": c.get("as_written") if isinstance(c, dict) else c})
        old_row = before[r["id"]]
        report["lead_links_removed"] += sum(1 for l in old_row["item"].get("links") or [] if is_lead_link(l))
        old = old_row["item"]["cells"].get("amount")
        new = r["item"]["cells"]["fund_total"]
        if old != new and not (old == "Not confirmed on the official page" and new == NOT_RECORDED):
            report["headline_changes"].append({"id": r["id"], "settlement": r["title"], "was": old, "now": new,
                                               "per_claimant": r["item"]["cells"]["per_claimant"]})
    report["lead_mentions_left"] = [r["id"] for r in out if LEAD_HOST.split(".")[0] in json.dumps(r, ensure_ascii=False).lower()]
    for k in ("deadline_state", "amount_roles", "other_details"):
        report[k] = dict(report[k])
    return out, report


def clean_summary(summary):
    """The dataset summary without the lead list's credit, licence or stored deadline states."""
    s = dict(summary or {})
    for k in ("discovery_credit", "discovery_source", "deadline_state_as_of", "deadline_states"):
        s.pop(k, None)
    s["source"] = "Official settlement pages (settlement administrators, courts, agencies)"
    s["deadline_note"] = DEADLINE_NOTE
    s["amount_rule"], s["mdl_rule"] = TYPE_RULE, MDL_RULE
    return s


def summary_for(old_summary, report):
    s = clean_summary(old_summary)
    s.update({"retyped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "amount_roles": report["amount_roles"]})
    return s


def export():
    import corpus_writer as writer  # noqa: E402

    rows = writer.fetch_all(DATASET, select=SELECT)
    meta = writer._call("GET", f"corpus_datasets?select=id,label,metadata,imported_records&id=eq.{DATASET}", prefer="return=representation")
    os.makedirs(os.path.dirname(EXPORT), exist_ok=True)
    with open(EXPORT, "w", encoding="utf-8") as h:
        json.dump({"dataset": DATASET, "exported_at": datetime.now(timezone.utc).isoformat(), "meta": meta[0] if meta else None, "rows": rows}, h, ensure_ascii=False)
    mdls = writer.fetch_all("mdls", select="id,item")
    reg = [{"mdl_number": (m.get("item") or {}).get("mdl_number"), "master_docket": (m.get("item") or {}).get("master_docket"),
            "cl_court_id": (m.get("item") or {}).get("cl_court_id"), "court_name": (m.get("item") or {}).get("court_name")} for m in mdls]
    with open(REGISTRY, "w", encoding="utf-8") as h:
        json.dump({"dataset": "mdls", "exported_at": datetime.now(timezone.utc).isoformat(), "rows": reg}, h, ensure_ascii=False)
    print(json.dumps({"exported": len(rows), "file": EXPORT, "mdl_registry": len(reg)}))


def build(as_of):
    blob = json.load(open(EXPORT, encoding="utf-8"))
    rows = [r for r in blob["rows"] if r.get("item", {}).get("settlement")]
    if len(rows) != len(blob["rows"]):
        raise SystemExit(f"{len(blob['rows']) - len(rows)} exported rows have no item.settlement; refusing to build")
    meta = blob.get("meta") or {}
    expected = meta.get("imported_records")
    if expected is not None and expected != len(rows):
        raise SystemExit(f"export holds {len(rows)} rows but the dataset says {expected}; export again")
    out, report = retype_all(rows, as_of, load_registry())
    if report["lead_mentions_left"]:
        raise SystemExit(f"the lead list is still named on {len(report['lead_mentions_left'])} rows")
    if report["per_claimant_at_or_above_ceiling"] and any(not a["basis"] for a in report["per_claimant_at_or_above_ceiling"]):
        raise SystemExit("a per-claimant figure at or above the ceiling has no basis")
    md = meta.get("metadata") or {}
    packet = {"dataset": DATASET, "label": meta.get("label") or "Settlement claims confirmed on official pages",
              "listing_block": listing_block(), "summary": summary_for(md.get("summary"), report), "rows": out,
              "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
              "inputs": [{"path": os.path.relpath(EXPORT, PRIVATE), "rows": len(rows)}, {"path": os.path.relpath(REGISTRY, PRIVATE)}]}
    os.makedirs(os.path.dirname(PACKET), exist_ok=True)
    with open(PACKET, "w", encoding="utf-8") as h:
        json.dump(packet, h, ensure_ascii=False, separators=(",", ":"))
    with open(REPORT, "w", encoding="utf-8") as h:
        json.dump(report, h, ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ("rows", "deadline_state", "amount_roles", "other_details", "rows_with_fund_total", "rows_with_per_claimant_only")}))
    print(json.dumps({"mdl_links": len(report["mdl_links"]), "mdl_docket_form_not_verified": len(report["mdl_docket_form_not_verified"]),
                      "headline_changes": len(report["headline_changes"]), "lead_links_removed": report["lead_links_removed"],
                      "per_claimant_at_or_above_ceiling": len(report["per_claimant_at_or_above_ceiling"]), "packet": PACKET}))


def publish():
    import corpus_writer as writer  # noqa: E402

    packet = json.load(open(PACKET, encoding="utf-8"))
    if packet["dataset"] != DATASET:
        raise SystemExit("packet is for another dataset")
    # The export reads rows without their dataset column; corpus_writer.publish posts rows as given, so stamp it here.
    rows = [{**r, "dataset": DATASET} for r in packet["rows"]]
    writer.publish(DATASET, packet["label"], rows, listing_block=packet["listing_block"], summary=packet["summary"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--export", action="store_true")
    mode.add_argument("--build", action="store_true")
    mode.add_argument("--publish", action="store_true")
    ap.add_argument("--as-of", default=None, help="date that orders the rows and the report's deadline counts (default: today, UTC); never stored on a row")
    args = ap.parse_args(argv)
    if args.export:
        export()
    elif args.build:
        build(date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date())
    else:
        publish()


if __name__ == "__main__":
    main()
