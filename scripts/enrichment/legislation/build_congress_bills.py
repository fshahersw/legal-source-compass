"""Build `congress_bills`: one record per measure of the 108th-119th Congress from GovInfo Bill Status XML.

  python3 -I -B build_congress_bills.py

Reads only:
  private/build/legislation/parsed/{congress}-{type}.jsonl.gz      acquire_billstatus.py (values as published)
  private/acq/legislation/billstatus_state.json                    zip URL, SHA-256, retrieval time per Congress/type
  private/build/legislation/lookups/public_laws_enacted.json       fetch_lookups.py (read-only corpus lookup)
Writes private/build/legislation/:
  congress_bills.rows.jsonl.gz    one corpus row per line: newest Congress first, then latest action newest first
  congress_bills.meta.json        dataset, label, listing_block, summary, inputs, rows, rows_sha256 (publish_stream.py)
  congress_bills.stats.json       counts per Congress and type, milestone and law-resolution counts

Rules (also in the dataset summary): milestones only from published action codes/text (bills_common.MILESTONE_RULES);
actions dropped only when date, text and code are identical to an earlier action; the latest CRS summary is the one with the
greatest action date (then update date); a law number links to public_laws_enacted only on an exact unique match.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bills_common as bc  # noqa: E402
import common as cm  # noqa: E402
from billstatus_parse import TYPES  # noqa: E402
from corpus_writer import record  # noqa: E402

DATASET = "congress_bills"
LABEL = "Congressional bills and resolutions, 108th-119th Congress (GovInfo Bill Status)"
PARSED = cm.BUILD / "parsed"
STATE = cm.ACQ / "billstatus_state.json"
LOOKUP = cm.BUILD / "lookups" / "public_laws_enacted.json"
CONGRESSES = list(range(119, 107, -1))
MEMBER = re.compile(r"^BILLSTATUS-(\d+)([a-z]+)(\d+)\.xml$")
RIGHTS = "Public domain (17 U.S.C. 105, as stated in each Bill Status file's dc:rights)"
SUMMARY_NOTE = ("CRS summaries are written by the Congressional Research Service and published in the Bill Status file; "
                "the latest one is shown with its version and date. A summary describes the measure at that version only.")


def load_lookup() -> dict | None:
    if not LOOKUP.exists():
        return None
    return json.loads(LOOKUP.read_text())["by_key"]


def person(p: dict) -> dict:
    return {k: v for k, v in {"name": p.get("fullName"), "bioguide": p.get("bioguideId"), "party": p.get("party"),
                              "state": p.get("state"), "district": p.get("district"),
                              "byRequest": p.get("isByRequest") == "Y" or None,
                              "byRequestType": p.get("byRequestType")}.items() if v is not None}


def cosponsor(p: dict) -> dict:
    out = person(p)
    out["date"] = p.get("sponsorshipDate")
    out["original"] = p.get("isOriginalCosponsor") == "True"
    if p.get("sponsorshipWithdrawnDate"):
        out["withdrawn"] = p["sponsorshipWithdrawnDate"]
    return {k: v for k, v in out.items() if v is not None}


def titles(rec: dict) -> dict:
    official, short, other, seen = [], [], [], set()
    display = rec.get("title")
    for t in rec.get("titles", []):
        typ, text = t.get("type") or "", t.get("title")
        if typ == "Display Title":
            display = display or text
            continue
        key = text.strip().lower()
        bucket = official if typ.startswith("Official Title") else short if "Short Title" in typ else other
        tag = ("o" if bucket is official else "s" if bucket is short else "x", key)
        if tag in seen:
            continue
        seen.add(tag)
        bucket.append({"type": typ, "title": text})
    return {"display": display, "official": official, "short": short, "other": other}


def compact_actions(actions: list[dict], bill_votes: list[dict] | None = None) -> tuple[list[dict], list[dict], int]:
    kept, dropped = bc.dedupe_actions(actions)
    out, votes, seen_votes = [], [], {}
    for v in bill_votes or []:  # older Bill Status layout: votes listed at bill level with the action name
        url = v.get("url")
        key = url or (v.get("chamber"), v.get("date"), v.get("rollNumber"))
        if key not in seen_votes:
            seen_votes[key] = len(votes)
            votes.append({k: val for k, val in {"chamber": v.get("chamber"), "date": v.get("date"), "roll": v.get("rollNumber"),
                                                "session": v.get("sessionNumber"), "congress": v.get("congress"), "url": url,
                                                "action": v.get("fullActionName")}.items() if val})
    for a in kept:
        row = {"d": a.get("date"), "x": a.get("text")}
        if a.get("time"):
            row["tm"] = a["time"]
        if a.get("code"):
            row["c"] = a["code"]
        ch = bc.action_chamber(a)
        if ch:
            row["ch"] = ch
        if a.get("source"):
            row["s"] = a["source"]
        if a.get("type"):
            row["t"] = a["type"]
        if a.get("committees"):
            row["cm"] = a["committees"]
        idx = []
        for v in a.get("votes", []):
            url = v.get("url")
            key = url or (v.get("chamber"), v.get("date"), v.get("rollNumber"))
            if key not in seen_votes:
                seen_votes[key] = len(votes)
                votes.append({k: val for k, val in {"chamber": v.get("chamber"), "date": v.get("date"), "roll": v.get("rollNumber"),
                                                    "session": v.get("sessionNumber"), "congress": v.get("congress"), "url": url,
                                                    "action": a.get("text"), "actionDate": a.get("date")}.items() if val})
            idx.append(seen_votes[key])
        if idx:
            row["v"] = idx
        out.append(row)
    return out, votes, dropped


def related(rec: dict, known: set[str]) -> list[dict]:
    out = []
    for r in rec.get("relatedBills", []):
        c, t, n = r.get("congress"), r.get("type"), r.get("number")
        entry = {"congress": int(c) if c and c.isdigit() else c, "type": t, "number": n, "title": r.get("title"),
                 "relationships": [{"type": d.get("type"), "by": d.get("identifiedBy")} for d in r.get("relationships", [])],
                 "latestAction": r.get("latestAction")}
        if t in bc.TYPE_CITE and n and isinstance(entry["congress"], int):
            entry["citation"] = bc.display_citation(t, n, entry["congress"])
            rid = bc.bill_id(entry["congress"], t, n)
            if rid in known:
                entry["href"] = f"/law/legislation/federal/{entry['congress']}/{t}/{n}"
        out.append({k: v for k, v in entry.items() if v})
    return out


def build_row(rec: dict, unit: dict, known: set[str], lookup: dict | None, stats: Counter) -> dict:
    congress, btype, number = rec["congress"], rec["type"], rec["number"]
    rid = bc.bill_id(congress, btype, number)
    cite = bc.citation(btype, number)
    disp = bc.display_citation(btype, number, congress)
    tt = titles(rec)
    title_text = tt["display"] or (tt["official"][0]["title"] if tt["official"] else None) or "Title not recorded"
    actions, votes, dropped = compact_actions(rec.get("actions", []), rec.get("billVotes"))
    ms = bc.milestones(rec, rec.get("actions", []))
    st, st_label = bc.status(btype, ms)
    laws = [bc.law_entry(l, lookup, congress) for l in rec.get("laws", [])]
    for l in laws:
        stats[f"law_{(l.get('resolution') or {}).get('status')}"] += 1
    sponsors = [person(p) for p in rec.get("sponsors", [])]
    cos = [cosponsor(p) for p in rec.get("cosponsors", [])]
    current = [c for c in cos if not c.get("withdrawn")]
    reports = [bc.committee_report(c) for c in rec.get("committeeReports", [])]
    texts = [bc.text_version(t) for t in rec.get("textVersions", [])]
    xml_url = bc.billstatus_xml_url(congress, btype, number)
    published_cg = rec.get("legislationUrl")
    constructed_cg = bc.congress_gov_url(congress, btype, number)
    cg_url = published_cg or constructed_cg
    if published_cg and published_cg != constructed_cg:
        stats["congress_gov_url_differs_from_pattern"] += 1
    summary = rec.get("summary")
    la = rec.get("latestAction") or {}
    stats["records"] += 1
    stats[f"status_{st}"] += 1
    stats["actions_dropped_identical"] += dropped
    stats["summary_present"] += 1 if summary else 0
    stats["congress_gov_url_constructed"] += 0 if published_cg else 1
    for name in bc.MILESTONE_ORDER:
        if ms.get(name):
            stats[f"milestone_{name}"] += 1
            if ms[name].get("vitiated"):
                stats[f"vitiated_{name}"] += 1

    bill = {
        "congress": congress, "type": btype, "number": number, "citation": cite, "display": disp,
        "typeLabel": bc.TYPE_LABEL[btype], "originChamber": rec.get("originChamber"), "introduced": rec.get("introducedDate"),
        "titles": tt, "policyArea": rec.get("policyArea"), "subjects": rec.get("subjects", []),
        "sponsors": sponsors, "cosponsors": cos, "cosponsorCount": len(current),
        "originalCosponsorCount": sum(1 for c in current if c.get("original")),
        "withdrawnCosponsorCount": len(cos) - len(current),
        "committees": rec.get("committees", []), "latestAction": la or None,
        "actions": actions, "actionCount": len(actions), "actionsPublished": len(rec.get("actions", [])),
        "actionsDroppedIdentical": dropped, "votes": votes, "related": related(rec, known),
        "cbo": rec.get("cboCostEstimates", []), "reports": reports, "texts": texts, "laws": laws,
        "summary": ({"version": summary.get("actionDesc"), "versionCode": summary.get("versionCode"),
                     "date": summary.get("actionDate"), "updated": summary.get("updateDate"), "blocks": summary.get("blocks", [])}
                    if summary else None),
        "summaryCount": rec.get("summaryCount", 0), "notes": rec.get("notes", []), "amendmentCount": rec.get("amendmentCount", 0),
        "milestones": ms, "status": st, "statusLabel": st_label,
        "source": {"congressGov": cg_url, "congressGovFrom": "published" if published_cg else "constructed", "billStatusXml": xml_url, "xmlSha256": rec.get("memberSha256"),
                   "zip": unit["zip_url"], "zipSha256": unit["zip_sha256"], "retrievedAt": unit["retrieved_at"],
                   "updateDate": rec.get("updateDate"), "updateDateIncludingText": rec.get("updateDateIncludingText"),
                   "rights": rec.get("rights")},
    }
    sponsor_name = sponsors[0]["name"] if sponsors else None
    law_label = ", ".join(l["label"] for l in laws) or None
    cells = {"citation": disp, "congress": congress, "type": btype, "number": number, "title": title_text,
             "sponsor": sponsor_name, "introduced": rec.get("introducedDate"), "latest_action_date": la.get("actionDate"),
             "latest_action": (la.get("text") or "")[:400] or None, "status": st, "status_label": st_label, "law": law_label,
             "policy_area": rec.get("policyArea"), "cosponsors": len(current)}
    facts = [["Measure", disp], ["Title", title_text], ["Type", bc.TYPE_LABEL[btype]],
             ["Sponsor (as published)", sponsor_name or "Not recorded"], ["Introduced", rec.get("introducedDate") or "Not recorded"],
             ["Cosponsors", str(len(current))], ["Policy area", rec.get("policyArea") or "Not recorded"],
             ["Latest action", f"{la.get('actionDate') or 'Date not recorded'}: {la.get('text') or 'Not recorded'}"],
             ["Status (derived from action codes)", st_label], ["Resulting law", law_label or "None recorded"],
             ["Source", "GovInfo Bill Status XML (U.S. Government Publishing Office)"]]
    links = []
    if cg_url:
        links.append({"url": cg_url, "label": "Congress.gov bill page"})
    links.append({"url": xml_url, "label": "GovInfo Bill Status XML"})
    for l in laws:
        if (l.get("resolution") or {}).get("href"):
            links.append({"url": l["resolution"]["href"], "label": f"{l['label']} in the corpus"})
        if l.get("govinfo"):
            links.append({"url": l["govinfo"], "label": f"{l['label']} on GovInfo"})
    words = [cite, cite.replace(".", ""), f"{btype}{number}", f"{btype} {number}", title_text]
    words += [t["title"] for t in tt["official"][:3] + tt["short"][:8] + tt["other"][:4]]
    words += [rec.get("policyArea") or ""] + rec.get("subjects", [])[:60]
    words += [p.get("name") or "" for p in sponsors]
    for l in laws:
        words += [l["label"], f"Pub. L. {l['number']}" if l.get("type") == "Public Law" else ""]
    filters = {"congress": [str(congress)], "type": [btype], "number": [str(number)], "status": [st],
               "milestone": [m for m in bc.MILESTONE_ORDER if ms.get(m) and not ms[m].get("vitiated")],
               "chamber": [rec.get("originChamber")] if rec.get("originChamber") else [],
               "law": [l["number"] for l in laws if l.get("number") and (l.get("resolution") or {}).get("status") != "inconsistent"],
               "has_law": ["yes" if laws else "no"]}
    if rec.get("policyArea"):
        filters["policy_area"] = [rec["policyArea"]]
    if rec.get("subjects"):
        filters["subject"] = rec["subjects"][:80]
    if sponsors:
        sp = sponsors[0]
        filters["sponsor"] = [sp["bioguide"]] if sp.get("bioguide") else []
        if sp.get("party"):
            filters["sponsor_party"] = [sp["party"]]
        if sp.get("state"):
            filters["sponsor_state"] = [sp["state"]]
    filters = {k: v for k, v in filters.items() if v}
    title = f"{disp}: {title_text}"
    row = record(DATASET, rid, title, source_url=cg_url or xml_url, cells=cells, facts=facts,
                 text=" ".join(w for w in words if w), filters=filters, subtitle=st_label,
                 badges=[bc.TYPE_LABEL[btype], st_label], links=links, extra={"kind": "federal_bill"})
    row["detail"]["bill"] = bill
    return row


def listing_block(counts: Counter, policy: Counter) -> dict:
    return {
        "page": 1, "limit": 50,
        "columns": [{"key": "citation", "label": "Measure"}, {"key": "title", "label": "Title"},
                    {"key": "sponsor", "label": "Sponsor"}, {"key": "latest_action_date", "label": "Latest action"},
                    {"key": "status_label", "label": "Status"}],
        "filters": [
            {"name": "q", "type": "search", "label": "Search"},
            {"name": "congress", "type": "select", "label": "Congress",
             "options": [{"label": f"{bc.ordinal(c)} Congress", "value": str(c), "count": counts[f"congress:{c}"]} for c in CONGRESSES]},
            {"name": "type", "type": "select", "label": "Measure type",
             "options": [{"label": bc.TYPE_LABEL[t], "value": t, "count": counts[f"type:{t}"]} for t in TYPES]},
            {"name": "status", "type": "select", "label": "Status",
             "options": [{"label": label, "value": key, "count": counts[f"status:{key}"]} for key, label in
                         (("became_law", "Became law"), ("vetoed", "Vetoed"), ("to_president", "Presented to the President"),
                          ("passed_both", "Passed / agreed to in both chambers"), ("passed_house", "Passed / agreed to in House"),
                          ("passed_senate", "Passed / agreed to in Senate"), ("reported", "Reported by committee"),
                          ("introduced", "Introduced"), ("not_recorded", "Not recorded")) if counts[f"status:{key}"]]},
            {"name": "policy_area", "type": "select", "label": "Policy area",
             "options": [{"label": p, "value": p, "count": n} for p, n in sorted(policy.items())]},
        ],
    }


def main() -> None:
    state = json.loads(STATE.read_text())
    lookup = load_lookup()
    known: set[str] = set()  # every measure in the bulk listings (equal to the zip members; see the verify script)
    for key in state:
        listing = json.loads(gzip.decompress((cm.ACQ / "billstatus_listings" / f"BILLSTATUS-{key}.json.gz").read_bytes()))
        for f in listing["files"]:
            m = MEMBER.match(f.get("name", ""))
            if m:
                known.add(bc.bill_id(int(m.group(1)), m.group(2), m.group(3)))
    stats: Counter = Counter()
    counts: Counter = Counter()
    policy: Counter = Counter()
    per_unit: dict[str, int] = {}
    out_path = cm.BUILD / f"{DATASET}.rows.jsonl.gz"
    tmp = out_path.with_suffix(".part")
    digest = hashlib.sha256()
    n = 0
    seen_ids: set[str] = set()
    with gzip.open(tmp, "wt", encoding="utf-8") as out:
        for congress in CONGRESSES:
            rows = []
            for btype in TYPES:
                unit = state[f"{congress}-{btype}"]
                with gzip.open(cm.ROOT / unit["parsed_file"], "rt", encoding="utf-8") as fh:
                    for line in fh:
                        rec = json.loads(line)
                        if rec["congress"] != congress or rec["type"] != btype:
                            raise SystemExit(f"{rec.get('member')}: Congress/type differ from the zip it came from")
                        row = build_row(rec, unit, known, lookup, stats)
                        if row["id"] in seen_ids:
                            raise SystemExit(f"duplicate measure {row['id']}")
                        seen_ids.add(row["id"])
                        rows.append(row)
                        per_unit[f"{congress}-{btype}"] = per_unit.get(f"{congress}-{btype}", 0) + 1
                        counts[f"congress:{congress}"] += 1
                        counts[f"type:{btype}"] += 1
                        counts[f"status:{row['filters']['status'][0]}"] += 1
                        if row["item"]["cells"].get("policy_area"):
                            policy[row["item"]["cells"]["policy_area"]] += 1
            rows.sort(key=lambda r: (r["item"]["cells"].get("latest_action_date") or "", r["item"]["cells"]["type"],
                                     int(bc.norm_number(r["item"]["cells"]["number"]) or 0)), reverse=True)
            for row in rows:
                line = json.dumps(row, sort_keys=True, ensure_ascii=False)
                digest.update((("\n" if n else "") + json.dumps(row, sort_keys=True)).encode())
                out.write(line + "\n")
                n += 1
            print(json.dumps({"congress": congress, "records": len(rows)}), flush=True)
            del rows
    tmp.replace(out_path)
    raw = hashlib.sha256(out_path.read_bytes()).hexdigest()
    summary = {
        "source": "GovInfo bulk data, Bill Status XML (U.S. Government Publishing Office), per-type zips for the 108th-119th Congress, https://www.govinfo.gov/bulkdata/BILLSTATUS",
        "licence": RIGHTS,
        "retrieved": max(u["retrieved_at"] for u in state.values())[:10],
        "records": n,
        "scope": "Every measure GovInfo publishes in Bill Status for the 108th (2003) through 119th Congress: H.R., S., H.J.Res., S.J.Res., H.Con.Res., S.Con.Res., H.Res., S.Res.",
        "milestone_rules": bc.MILESTONE_RULES, "vitiation_rule": bc.VITIATION_RULE,
        "action_rule": "All published actions are kept; an action is dropped only when an earlier action of the same measure has the identical date, text and action code (a copy from another source system).",
        "summary_rule": SUMMARY_NOTE,
        "law_link_rule": "A resulting public law links to public_laws_enacted only when exactly one record there has the same Congress and law number and the number is not marked shared; otherwise the number and the GovInfo Link Service URL are shown. A law number whose Congress differs from the measure's own Congress (a publisher error seen on 2 measures) is shown as published but not linked and not used to find a law's bill.",
        "report_link_rule": "Committee report citations link to the GovInfo package page for the report (https://www.govinfo.gov/app/details/CRPT-{congress}{hrpt|srpt}{number}), with the GovInfo Link Service URL for the same report kept beside it; Part/Book/Errata suffixes are shown as printed.",
        "stats": dict(sorted(stats.items())), "per_congress_type": per_unit,
        "public_laws_enacted_lookup": "used" if lookup is not None else "not available",
    }
    inputs = [{"url": u["zip_url"], "sha256": u["zip_sha256"], "bytes": u["zip_bytes"], "retrieved_at": u["retrieved_at"],
               "stored": (u.get("storage") or {}).get("object")} for _, u in sorted(state.items())]
    meta = {"dataset": DATASET, "label": LABEL, "listing_block": listing_block(counts, policy), "summary": summary,
            "rows_file": str(out_path.relative_to(cm.ROOT)), "rows": n, "rows_sha256": raw, "manifest_sha256": digest.hexdigest(),
            "inputs": inputs, "built_at": cm.now_utc()}
    (cm.BUILD / f"{DATASET}.meta.json").write_text(json.dumps(meta, indent=1, sort_keys=True, ensure_ascii=False))
    (cm.BUILD / f"{DATASET}.stats.json").write_text(json.dumps({"stats": summary["stats"], "per_unit": per_unit,
                                                                 "counts": dict(counts)}, indent=1, sort_keys=True))
    print(json.dumps({"records": n, "rows_sha256": raw, "stats": {k: v for k, v in stats.items() if not k.startswith("milestone")}}))


if __name__ == "__main__":
    main()
