"""Retype settlement_claims_official: amount roles, exact MDL links and deadline states on the published rows.

The official pages behind the dataset were read once (build_settlements.py); their raw files are not in every working
copy. This step needs only the published rows: every fact it adds is computed from text already published on the row
(the amount's own sentence, the case number as written, the confirmed deadline date). Nothing is fetched, inferred or
summed. build_settlements.py applies the same retype when it builds from the raw pages.

  # 1. read-only export of the published rows and the dataset entry (lead, EXTERNAL_SUPABASE_* in the environment)
  python3 -I -B scripts/enrichment/enforcement_actions/retype_claims.py --export
  # 2. dry run: write the packet and the change report (no network)
  python3 -I -B scripts/enrichment/enforcement_actions/retype_claims.py --build --as-of 2026-10-27
  # 3. publish the packet (lead only; replaces the dataset's rows with the retyped rows, same ids)
  python3 -I -B scripts/enrichment/enforcement_actions/retype_claims.py --publish

Files (git-ignored): private/acq/de-settlements-sec/settlement_claims_official.export.json (export),
private/build/de-settlements-sec/settlement_claims_official.json (packet: dataset, label, listing_block, summary, rows)
and settlement_claims_official.report.json (counts and every changed headline).
"""
import argparse
import copy
import json
import os
import sys
from collections import Counter
from datetime import date, datetime, timezone

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
PACKET = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{DATASET}.json")
REPORT = os.path.join(PRIVATE, "build", "de-settlements-sec", f"{DATASET}.report.json")
SELECT = "id,category,state,title,source_url,item,detail,text,filters,ordinal"
TYPE_RULE = ("Each dollar figure is typed from its own sentence on the official page: settlement fund total, per claimant, "
             "aggregate cap or other (fees and costs, service award, penalty, agency distribution round, estimate, "
             "eligibility threshold, or not stated). The headline is the largest settlement fund total; a per-claimant "
             "figure is never shown as the settlement amount. Figures are never summed.")
MDL_RULE = ("An MDL is linked only when a case number on the official page is in the federal MDL docket form "
            "(<office>:<yy>-md|ml|mn-<number>, e.g. 2:19-ml-02905 is MDL 2905). Captions and product names never link.")


def amount_fact(a):
    role = stypes.ROLE_LABEL[a["role"]]
    if a["role"] == "other":
        role += f": {stypes.OTHER_DETAIL_LABEL.get(a.get('detail') or 'unclear', 'not stated')}"
    sentence = (a.get("sentence") or "")[:200]
    return f"{a['page_as_written']} — {role} — \"{sentence}\""


def retype_row(row, as_of):
    """The published row with typed amounts, exact MDL links and a deadline state against as_of (input unchanged)."""
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
    mdls = stypes.mdl_links(s.get("case_numbers") or [])
    s["mdl_links"] = mdls
    dl = (s.get("deadline") or {}).get("date")
    state = stypes.deadline_state(dl, as_of)
    s.setdefault("deadline", {})["state"] = state
    s["deadline"]["state_as_of"] = str(as_of)

    cells = item["cells"]
    cells["deadline"] = dl or NOT_RECORDED
    cells["deadline_state"] = stypes.DEADLINE_STATE_LABEL[state]
    cells["fund_total"] = head["page_as_written"] if head else NOT_RECORDED
    cells["per_claimant"] = per["page_as_written"] if per else NOT_RECORDED
    cells["amount"] = cells["fund_total"]
    cells["mdl"] = ", ".join(f"MDL {m['mdl']}" for m in mdls) or NOT_RECORDED

    f = out["filters"]
    f["deadline_state"] = [state]
    f["amount_role"] = sorted({a["role"] for a in typed}) or ["none"]
    f["mdl"] = [str(m["mdl"]) for m in mdls]

    facts = [x for x in out["detail"]["facts"] if x[0] not in (
        "Dollar figures confirmed on the page", "Settlement fund total", "Per-claimant figures",
        "MDL (case number in MDL docket form)", "Claim deadline status")]
    at = next((i for i, x in enumerate(facts) if x[0] == "Claim deadline"), len(facts) - 1) + 1
    added = [
        ["Claim deadline status", f"{stypes.DEADLINE_STATE_LABEL[state]} (as of {as_of})" if dl else NOT_RECORDED],
        ["Settlement fund total", f"{head['page_as_written']} — \"{(head.get('sentence') or '')[:200]}\"" if head else NOT_RECORDED],
        ["Per-claimant figures", "; ".join(a["page_as_written"] for a in typed if a["role"] == "per_claimant") or NOT_RECORDED],
        ["Dollar figures confirmed on the page", "; ".join(amount_fact(a) for a in typed) or NOT_RECORDED],
        ["MDL (case number in MDL docket form)", "; ".join(f"MDL {m['mdl']} ({m['case_number']})" for m in mdls) or NOT_RECORDED],
    ]
    out["detail"]["facts"] = facts[:at] + added + facts[at:]
    link_urls = {l.get("url") for l in item.get("links") or []}
    for m in mdls:
        url = f"/matters/lens/{m['mdl']}"
        if url not in link_urls:
            link = {"url": url, "label": f"MDL {m['mdl']} (case number {m['case_number']} on the official page)"}
            item["links"].append(link)
            out["detail"]["links"].append(link)
    return out


def sort_key(row):
    """Upcoming deadlines first (soonest first), then past deadlines (latest first), then rows with no deadline."""
    d = row["item"]["settlement"].get("deadline") or {}
    state, dl = d.get("state"), d.get("date") or ""
    if state in ("within_30_days", "upcoming"):
        return (0, dl, row["id"])
    if state == "past":
        return (1, "".join(chr(0x10FFFF - ord(ch)) for ch in dl), row["id"])
    return (2, "", row["id"])


def listing_block():
    sys.path.insert(0, os.path.dirname(HERE))
    import corpus_writer as writer  # noqa: E402

    return writer.listing(
        [("settlement", "Settlement"), ("deadline", "Claim deadline"), ("deadline_state", "Deadline status"),
         ("fund_total", "Settlement fund total"), ("per_claimant", "Per claimant"), ("mdl", "MDL"),
         ("court", "Court"), ("case_number", "Case no."), ("official_page", "Official page"), ("verified", "Confirmed facts")],
        [("deadline_state", "Claim deadline", {k: v for k, v in stypes.DEADLINE_STATE_LABEL.items()}),
         ("amount_role", "Dollar figure type", {**stypes.ROLE_LABEL, "none": "No dollar figure confirmed"}),
         ("verified", "Confirmed fact", {"deadline": "Deadline", "amount": "Dollar figure", "court": "Court", "case number": "Case number"})])


def retype_all(rows, as_of):
    out = sorted((retype_row(r, as_of) for r in rows), key=sort_key)
    report = {"as_of": str(as_of), "rows": len(out), "deadline_state": Counter(), "amount_roles": Counter(),
              "other_details": Counter(), "rows_with_fund_total": 0, "rows_with_per_claimant_only": 0,
              "mdl_links": [], "headline_changes": []}
    before = {r["id"]: r for r in rows}
    for r in out:
        s = r["item"]["settlement"]
        report["deadline_state"][s["deadline"]["state"]] += 1
        for a in s["amounts"]:
            report["amount_roles"][a["role"]] += 1
            if a["role"] == "other":
                report["other_details"][a.get("detail") or "unclear"] += 1
        if s["fund_total"]:
            report["rows_with_fund_total"] += 1
        elif any(a["role"] == "per_claimant" for a in s["amounts"]):
            report["rows_with_per_claimant_only"] += 1
        for m in s["mdl_links"]:
            report["mdl_links"].append({"id": r["id"], "mdl": m["mdl"], "case_number": m["case_number"]})
        old = before[r["id"]]["item"]["cells"].get("amount")
        new = r["item"]["cells"]["fund_total"]
        if old != new:
            report["headline_changes"].append({"id": r["id"], "settlement": r["title"], "was": old, "now": new,
                                               "per_claimant": r["item"]["cells"]["per_claimant"]})
    for k in ("deadline_state", "amount_roles", "other_details"):
        report[k] = dict(report[k])
    return out, report


def summary_for(old_summary, report, as_of):
    s = dict(old_summary or {})
    s.update({"amount_rule": TYPE_RULE, "mdl_rule": MDL_RULE, "retyped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
              "deadline_state_as_of": str(as_of), "deadline_states": report["deadline_state"], "amount_roles": report["amount_roles"],
              "deadline_note": "Deadlines are dates the official page states; the status is computed against the as-of date and the app recomputes it against today. Confirm on the official page before relying on a date."})
    return s


def export():
    import corpus_writer as writer  # noqa: E402

    rows = writer.fetch_all(DATASET, select=SELECT)
    meta = writer._call("GET", f"corpus_datasets?select=id,label,metadata,imported_records&id=eq.{DATASET}", prefer="return=representation")
    os.makedirs(os.path.dirname(EXPORT), exist_ok=True)
    with open(EXPORT, "w", encoding="utf-8") as h:
        json.dump({"dataset": DATASET, "exported_at": datetime.now(timezone.utc).isoformat(), "meta": meta[0] if meta else None, "rows": rows}, h, ensure_ascii=False)
    print(json.dumps({"exported": len(rows), "file": EXPORT}))


def build(as_of):
    blob = json.load(open(EXPORT, encoding="utf-8"))
    rows = [r for r in blob["rows"] if r.get("item", {}).get("settlement")]
    if len(rows) != len(blob["rows"]):
        raise SystemExit(f"{len(blob['rows']) - len(rows)} exported rows have no item.settlement; refusing to build")
    meta = blob.get("meta") or {}
    expected = meta.get("imported_records")
    if expected is not None and expected != len(rows):
        raise SystemExit(f"export holds {len(rows)} rows but the dataset says {expected}; export again")
    out, report = retype_all(rows, as_of)
    md = meta.get("metadata") or {}
    packet = {"dataset": DATASET, "label": meta.get("label") or "Settlement claims confirmed on official pages",
              "listing_block": listing_block(), "summary": summary_for(md.get("summary"), report, as_of), "rows": out,
              "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "inputs": [{"path": os.path.relpath(EXPORT, PRIVATE), "rows": len(rows)}]}
    os.makedirs(os.path.dirname(PACKET), exist_ok=True)
    with open(PACKET, "w", encoding="utf-8") as h:
        json.dump(packet, h, ensure_ascii=False, separators=(",", ":"))
    with open(REPORT, "w", encoding="utf-8") as h:
        json.dump(report, h, ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ("rows", "deadline_state", "amount_roles", "other_details", "rows_with_fund_total", "rows_with_per_claimant_only")}))
    print(json.dumps({"mdl_links": len(report["mdl_links"]), "headline_changes": len(report["headline_changes"]), "packet": PACKET}))


def publish():
    import corpus_writer as writer  # noqa: E402

    packet = json.load(open(PACKET, encoding="utf-8"))
    if packet["dataset"] != DATASET:
        raise SystemExit("packet is for another dataset")
    writer.publish(DATASET, packet["label"], packet["rows"], listing_block=packet["listing_block"], summary=packet["summary"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--export", action="store_true")
    mode.add_argument("--build", action="store_true")
    mode.add_argument("--publish", action="store_true")
    ap.add_argument("--as-of", default=None, help="deadline states are computed against this date (default: today, UTC)")
    args = ap.parse_args(argv)
    if args.export:
        export()
    elif args.build:
        build(date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date())
    else:
        publish()


if __name__ == "__main__":
    main()
