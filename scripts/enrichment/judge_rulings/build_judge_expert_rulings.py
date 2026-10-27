"""Build judge_expert_rulings: recorded expert-admissibility rulings in MDL dockets, with exact judge attribution (dry run by default).

Inputs (read-only snapshots, private/acq/de-judges-data, sha256-checked):
  snapshots/rulings_candidates  MDL documents typed order/opinion (documents.documents) and master-docket entries (sw_docket_entries_v1)
                                whose printed text names an expert / Daubert / Rule 702 motion with a disposition word
                                (scripts/enrichment/judge_rulings/snapshot_queries/candidates.sql)
  snapshots/mdls_judges         the MDL registry's transferee-judge fields
  mdl_links/packet.json         the exact MDL judge links of database/contracts/mdls-exact-judge-links-20261027-v1.sql
  audit_labels_2026-10-27.json  the reviewer's reading of every candidate (this directory): the measured precision and recall

Rules (rulings_parse.py): a record is one decided motion to exclude, strike, preclude or limit expert testimony, opinions or reports; the
outcome is read from the decretal words of the same clause and the printed text is quoted with it. A ruling is attributed to a judge only
when (1) its MDL is exactly linked to that judge (docket assignment, native bridge or unique exact name; never a name variant), (2) exactly
one judge is printed as signing it and that judge's surname equals the linked judge's, (3) no magistrate judge is named and (4) it is not a
report and recommendation. Every other ruling is published unattributed (judge_profile empty) with the reason. Documents and docket
entries that print the same ruling are counted once.

    python -I -B scripts/enrichment/judge_rulings/build_judge_expert_rulings.py            # dry run: build file + report under acq
    python -I -B scripts/enrichment/judge_rulings/build_judge_expert_rulings.py --publish  # LEAD ONLY: corpus_writer.publish
"""
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "judge_xwalk"))
import corpus_writer as cw  # noqa: E402
import rulings_parse as R  # noqa: E402
import snapshot_io as SN  # noqa: E402

DATASET = "judge_expert_rulings"
LABEL = "Recorded expert-admissibility rulings in MDL dockets"
OUT = SN.ACQ / "judge_rulings"
LABELS = HERE / "audit_labels_2026-10-27.json"
OUTCOME_LABEL = {"granted": "Granted", "granted_in_part": "Granted in part", "denied": "Denied", "denied_as_moot": "Denied as moot",
                 "deferred": "Deferred", "not_determined": "Not determined"}
SIDE_LABEL = {"plaintiffs": "Plaintiffs' motion", "defendants": "Defendants' motion", "not_printed": "Movant side not printed"}
BASIS_LABEL = {
    "mdl_transferee_judge+printed_signer": "MDL exactly linked to the judge, and the judge is printed as signing the order",
    "no_signer_printed": "No signing judge printed; not attributed",
    "several_signers": "More than one judge printed as signing; not attributed",
    "magistrate_judge_named": "A magistrate judge is named on the order; not attributed to the district judge",
    "signer_differs": "The printed signer is not the MDL's linked judge; not attributed",
    "report_and_recommendation": "Report and recommendation; not attributed",
    "mdl_judge_not_linked": "The MDL has no exact judge link; not attributed",
}
CAVEAT = ("Rulings found in published opinions and MDL filings in this corpus; not every ruling; outcomes depend on the motion, the expert and the "
          "record. Outcomes are read from the printed order text only.")


def judge_links(mdls, packet):
    """{mdl number: (profile id, judge name, evidence)} for MDLs exactly linked after the mdls-exact-judge-links contract."""
    names = {}
    for m in mdls:
        jl = (m.get("judge_links") or [{}])[0] or {}
        names[str(m["id"])] = jl.get("display_name") or jl.get("fjc_name")
    out = {}
    for d in packet["decisions"]:
        if d.get("profile"):
            name = d.get("person_profile_name") if d["outcome"] == "new" else names.get(str(d["id"]))
            out[str(d["id"])] = (d["profile"], name, d.get("link_evidence"))
    return out


def audit(candidate, rulings, labels):
    """Mark each parsed ruling agrees/disagrees with the reviewer's labels for the same text; return (agree, parsed, labelled, matched)."""
    want = Counter((x["outcome"], x["movant_side"]) for x in labels.get(candidate["id"], {}).get("rulings", []))
    left = Counter(want)
    agree = 0
    for r in rulings:
        k = (r["outcome"], r["movant_side"])
        if left[k] > 0:
            left[k] -= 1
            r["audit"] = "agrees"
            agree += 1
        else:
            r["audit"] = "disagrees"
    return agree, len(rulings), sum(want.values()), sum(want.values()) - sum(left.values())


def dedupe(items):
    """Drop rulings printed twice (the same order in several docket entries, or as a document and a docket entry)."""
    keep, by_number, by_text, unnumbered = [], {}, {}, {}
    for it in sorted(items, key=lambda x: (x["c"]["source"] != "sw_docket_entries_v1", x["c"]["date"] or "", x["c"]["id"], x["k"])):
        r, c = it["r"], it["c"]
        text_key = (c["mdl"], c["date"], r["outcome"], r["movant_side"], " ".join(R.fold(r["expert_as_printed"]))[:40])
        num_key = (c["mdl"], c["date"], r["outcome"], r["movant_side"], tuple(r["motion_numbers"])) if r["motion_numbers"] else None
        # numbered motions are the same ruling only with the same numbers (or when the other listing printed no number)
        dup = (by_number.get(num_key) or unnumbered.get(text_key)) if num_key else by_text.get(text_key)
        if dup:
            dup["also"].append(c)
            continue
        it["also"] = []
        if num_key:
            by_number[num_key] = it
        else:
            unnumbered[text_key] = it
        by_text.setdefault(text_key, it)
        keep.append(it)
    # a document and a docket entry of the same MDL and date that each print exactly one ruling with the same outcome are the same ruling
    by_day = defaultdict(list)
    for it in keep:
        by_day[(it["c"]["mdl"], it["c"]["date"])].append(it)
    drop = set()
    for group in by_day.values():
        docs = [x for x in group if x["c"]["source"] == "documents"]
        ents = [x for x in group if x["c"]["source"] != "documents"]
        if len(docs) == 1 and len(ents) == 1 and docs[0]["r"]["outcome"] == ents[0]["r"]["outcome"]:
            ents[0]["also"].append(docs[0]["c"])
            drop.add(id(docs[0]))
    return [x for x in keep if id(x) not in drop]


def build(cands, mdls, packet, labels):
    links = judge_links(mdls, packet)
    titles = {str(m["id"]): m.get("title") for m in mdls}
    items, tallies = [], Counter()
    for c in cands:
        rulings = R.parse(c["text"])
        a, n, lab, matched = audit(c, rulings, labels)
        tallies.update(agree=a, parsed=n, labelled=lab, matched=matched)
        for k, r in enumerate(rulings, 1):
            items.append({"c": c, "r": r, "k": k})
    kept = dedupe(items)
    rows, per_judge = [], defaultdict(list)
    for it in kept:
        c, r = it["c"], it["r"]
        mdl = str(c["mdl"])
        prof, jname, evidence = links.get(mdl, (None, None, None))
        basis, signer = R.attribution(c["text"], jname)
        attributed = basis == "mdl_transferee_judge+printed_signer"
        src = "entry" if c["source"] == "sw_docket_entries_v1" else "document"
        rid = f"{src}:{c['id']}:{it['k']}"
        sources = [c["source_url"]] + [x["source_url"] for x in it["also"] if x.get("source_url") and x["source_url"] != c["source_url"]]
        date = c["date"] or None
        title = f"{OUTCOME_LABEL[r['outcome']]}: motion to {verb_of(r)} {r['expert_as_printed'][:110]}".strip()
        facts = [["MDL", f"MDL {mdl}" + (f" · {titles.get(mdl)}" if titles.get(mdl) else "")], ["Court", c["court_id"] or "Not recorded"],
                 ["Docket", c["docket_number"] or "Not recorded"], ["Date", date or "Not recorded"],
                 ["Motion as printed", f"{r['movant_as_printed'] or 'Movant not printed'} {r['motion_kind']} to {verb_of(r)} {r['expert_as_printed']}".strip()],
                 ["Outcome", OUTCOME_LABEL[r["outcome"]]], ["Movant side", SIDE_LABEL[r["movant_side"]]],
                 ["Decided by (as printed)", signer or "Not recorded"], ["Attribution", BASIS_LABEL[basis]],
                 ["Decision as printed", r["quote"]], ["Note", CAVEAT]]
        lk = [{"url": u, "label": "Order as published" if i == 0 else "Same ruling, other listing"} for i, u in enumerate(sources)]
        lk.append({"url": f"/matters/{mdl}", "label": f"MDL {mdl}"})
        if attributed:
            lk.append({"url": f"/judges/{prof}", "label": "Judge profile"})
        rec = cw.record(
            DATASET, rid, title, source_url=c["source_url"],
            subtitle=f"MDL {mdl} · {c['court_id'] or 'court not recorded'} · {date or 'date not recorded'} · {SIDE_LABEL[r['movant_side']]}",
            cells={"date": date or "Not recorded", "mdl": mdl, "court": c["court_id"] or "Not recorded", "docket": c["docket_number"] or "Not recorded",
                   "expert": r["expert_as_printed"][:160], "movant": r["movant_as_printed"] or "Not printed", "outcome": OUTCOME_LABEL[r["outcome"]],
                   "decided_by": signer or "Not recorded", "attributed": "Yes" if attributed else "No"},
            facts=facts, links=lk, badges=[OUTCOME_LABEL[r["outcome"]]] + (["Judge attributed"] if attributed else []),
            text=f"{r['quote']} MDL {mdl} expert Daubert Rule 702", state="",
            filters={"kind": ["ruling"], "court": [c["court_id"]] if c["court_id"] else [], "year": [date[:4]] if date else [], "outcome": [r["outcome"]],
                     "movant": [r["movant_side"]], "mdl": [mdl], "attributed": ["yes" if attributed else "no"], **({"judge_profile": [prof]} if attributed else {})},
            extra={"kind": "ruling", "ruling": {"outcome": r["outcome"], "movant_side": r["movant_side"], "movant_as_printed": r["movant_as_printed"],
                                                "motion_kind": r["motion_kind"], "motion_numbers": r["motion_numbers"], "expert_as_printed": r["expert_as_printed"],
                                                "quote": r["quote"], "date": date, "mdl": mdl},
                   "attribution": {"basis": basis, "judge_profile": prof if attributed else None, "signer_as_printed": signer,
                                   "mdl_link_evidence": evidence if prof else None},
                   "audit": {"labels_file": LABELS.name, "verdict": r["audit"]}, "extractor": R.VERSION,
                   "sources": [{"source": x["source"], "id": x["id"], "url": x["source_url"]} for x in [c] + it["also"]]})
        rows.append(rec)
        if attributed:
            per_judge[prof].append((jname, r, date, mdl, c["source_url"]))
    rollups = []
    for prof, lst in sorted(per_judge.items()):
        by = defaultdict(Counter)
        for _, r, _, _, _ in lst:
            by[r["movant_side"]][r["outcome"]] += 1
        dates = sorted(d for _, _, d, _, _ in lst if d)
        name = lst[0][0]
        period = f"{dates[0]} to {dates[-1]}" if dates else "Not recorded"
        rollups.append(cw.record(
            DATASET, f"judge:{prof}", name or prof, source_url=lst[0][4], subtitle=f"{len(lst)} recorded rulings · {period}",
            cells={"rulings": str(len(lst)), "period": period, "mdls": ", ".join(sorted({m for *_, m, _ in lst}))},
            facts=[["Recorded rulings", str(len(lst))], ["Period", period]] + [[f"{SIDE_LABEL[s]}: {OUTCOME_LABEL[o]}", str(n)] for s in sorted(by) for o, n in sorted(by[s].items())]
                  + [["Note", CAVEAT]],
            links=[{"url": f"/judges/{prof}", "label": "Judge profile"}], text=f"{name} expert rulings Daubert Rule 702",
            filters={"kind": ["judge"], "judge_profile": [prof]},
            extra={"kind": "judge", "rollup": {"n": len(lst), "period_start": dates[0] if dates else None, "period_end": dates[-1] if dates else None,
                                               "by_movant": {s: dict(v) for s, v in by.items()}, "mdls": sorted({m for *_, m, _ in lst})}}))
    return rows, rollups, tallies, kept


def verb_of(r):
    m = re.search(r"(?i)\b(exclude|strike|preclude|limit)\b", r["quote"])
    return m.group(1).lower() if m else "exclude"


def summary(rows, rollups, tallies, inputs):
    rulings = [x for x in rows]
    attributed = [x for x in rulings if x["filters"].get("judge_profile")]
    per = Counter(x["filters"]["judge_profile"][0] for x in attributed)
    agree = sum(1 for x in rulings if x["item"]["audit"]["verdict"] == "agrees")
    dates = sorted(x["item"]["ruling"]["date"] for x in rulings if x["item"]["ruling"]["date"])
    return {
        "source": "Printed order titles and docket text of MDL dockets: court and GovInfo documents (documents.documents) and CourtListener docket entries "
                  "(sw_docket_entries_v1); free public sources",
        "period": [dates[0], dates[-1]] if dates else None,
        "records": {"rulings": len(rulings), "judge_rollups": len(rollups), "attributed_rulings": len(attributed)},
        "audit": {"method": "every candidate text was read by a reviewer and its rulings (outcome and movant side) written down before comparison; "
                            f"labels in scripts/enrichment/judge_rulings/{LABELS.name}",
                  "parsed_before_dedupe": tallies["parsed"], "agreeing_before_dedupe": tallies["agree"],
                  "precision_before_dedupe": round(tallies["agree"] / tallies["parsed"], 3) if tallies["parsed"] else None,
                  "labelled_rulings": tallies["labelled"], "found": tallies["matched"],
                  "recall": round(tallies["matched"] / tallies["labelled"], 3) if tallies["labelled"] else None,
                  "published_rulings_agreeing": agree, "published_precision": round(agree / len(rulings), 3) if rulings else None,
                  "sample": "all candidates (population below 200)",
                  "in_sample": "the parser's rules were written while reading these same candidates, so these figures are in-sample; a new snapshot "
                               "must be re-read and re-labelled before its precision is published"},
        "coverage": {"judges_with_1": sum(1 for v in per.values() if v >= 1), "judges_with_5": sum(1 for v in per.values() if v >= 5),
                     "judges_with_20": sum(1 for v in per.values() if v >= 20)},
        "attribution": {k: sum(1 for x in rulings if x["item"]["attribution"]["basis"] == k) for k in BASIS_LABEL},
        "outcomes": dict(Counter(x["item"]["ruling"]["outcome"] for x in rulings)),
        "rules": "exact attribution only: exact MDL judge link + the same judge printed as sole signer; magistrate-signed orders and reports and "
                 "recommendations never count for a district judge; no rates below 20 rulings; never rank judges on outcomes",
        "qualification": CAVEAT, "inputs": inputs, "extractor": R.VERSION,
    }


def main(argv):
    cands = SN.load("rulings_candidates")
    mdls = SN.load("mdls_judges")
    pk_path = SN.ACQ / "mdl_links" / "packet.json"
    packet_bytes = pk_path.read_bytes()
    packet = json.loads(packet_bytes.decode("utf-8"))
    labels = json.loads(LABELS.read_text(encoding="utf-8"))
    man = json.loads((SN.SNAP / "_manifest.json").read_text(encoding="utf-8"))
    if labels["candidates_snapshot_sha256"] != man["rulings_candidates"]["sha256"]:
        raise SystemExit("audit labels were written for another candidates snapshot; re-read the texts before building")
    inputs = {"rulings_candidates": man["rulings_candidates"]["sha256"], "mdls_judges": man["mdls_judges"]["sha256"],
              "mdl_links_packet": hashlib.sha256(packet_bytes).hexdigest(), "audit_labels": hashlib.sha256(LABELS.read_bytes()).hexdigest()}
    rows, rollups, tallies, _ = build(cands, mdls, packet, labels["labels"])
    summ = summary(rows, rollups, tallies, inputs)
    listing = cw.listing([("date", "Date"), ("mdl", "MDL"), ("expert", "Expert as printed"), ("movant", "Movant"), ("outcome", "Outcome"),
                          ("decided_by", "Decided by"), ("attributed", "Judge attributed")],
                         [("outcome", "Outcome", OUTCOME_LABEL), ("movant", "Movant", SIDE_LABEL), ("attributed", "Judge attributed", {"yes": "Yes", "no": "No"})])
    all_rows = rows + rollups
    OUT.mkdir(parents=True, exist_ok=True)
    build_file = {"dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summ, "rows": all_rows}
    data = json.dumps(build_file, ensure_ascii=False, sort_keys=True, indent=1).encode("utf-8")
    (OUT / f"{DATASET}.json").write_bytes(data)
    print(json.dumps({"rows": len(all_rows), "summary": {k: summ[k] for k in ("records", "audit", "coverage", "attribution", "outcomes", "period")},
                      "file": str(OUT / f"{DATASET}.json"), "sha256": hashlib.sha256(data).hexdigest()}, indent=1))
    if "--publish" in argv:  # LEAD ONLY: needs EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment
        cw.publish(DATASET, LABEL, all_rows, listing_block=listing, summary=summ)


if __name__ == "__main__":
    main(sys.argv[1:])
