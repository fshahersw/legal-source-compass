"""Build `state_bills`: one record per bill for the current and the preceding regular session of every state, DC and PR.

  python3 -I -B build_state_bills.py [--month 2026-10]

Reads only private/acq/legislation/openstates/<month>/ (acquire_openstates.py extracts of the Open States public data dump).
Steps: choose two sessions per jurisdiction (openstates_common.SELECTION_RULE); split the child tables of the chosen bills
into per-jurisdiction shards (private/build/legislation/state_shards/, deleted at the end); then build each jurisdiction's
records. Writes private/build/legislation/state_bills.rows.jsonl.gz, state_bills.meta.json (publish_stream.py) and
state_bills.stats.json (per state/session counts, milestone counts, official-source coverage).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common as cm  # noqa: E402
import openstates_common as oc  # noqa: E402
from corpus_writer import record  # noqa: E402

DATASET = "state_bills"
LABEL = "State legislation: bills of the current and preceding regular session (Open States)"
CHILD = {"actions": "bill_id", "sponsorships": "bill_id", "sources": "bill_id", "versions": "bill_id", "documents": "bill_id"}
LINKS = {"version_links": ("version_id", "versions"), "document_links": ("document_id", "documents")}
MAX_ACTIONS = 400


def read(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)


def choose_sessions(src: Path) -> tuple[dict, dict, dict]:
    sessions = {s["id"]: s for s in read(src / "sessions.jsonl.gz")}
    stats: dict[str, dict] = defaultdict(lambda: {"bills": 0, "max_first": ""})
    for b in read(src / "bills.jsonl.gz"):
        st = stats[b["legislative_session_id"]]
        st["bills"] += 1
        d = oc.day(b.get("first_action_date")) or ""
        if d > st["max_first"]:
            st["max_first"] = d
    by_j: dict[str, list] = defaultdict(list)
    for sid, st in stats.items():
        s = sessions.get(sid)
        if not s or not oc.is_regular(s) or not st["bills"]:
            continue
        if s.get("start_date") and s["start_date"] > oc.TODAY:
            continue
        by_j[s["jurisdiction_id"]].append((st["max_first"], s.get("start_date") or "", s))
    chosen = {}
    for j, items in by_j.items():
        items.sort(key=lambda x: (x[0], x[1]), reverse=True)
        chosen[j] = [{"id": s["id"], "identifier": s["identifier"], "name": s["name"], "role": role,
                      "start_date": s.get("start_date") or None, "end_date": s.get("end_date") or None,
                      "classification": s.get("classification") or None, "bills": stats[s["id"]]["bills"],
                      "latest_first_action": stats[s["id"]]["max_first"] or None}
                     for role, (_, _, s) in zip(("current", "preceding"), items[:2])]
    return sessions, chosen, {k: dict(v) for k, v in stats.items()}


def shard(src: Path, tmp: Path, keep: dict[str, str]) -> None:
    """Split the chosen bills and their child rows into per-jurisdiction files (bill id -> state abbreviation in `keep`)."""
    tmp.mkdir(parents=True, exist_ok=True)
    handles: dict[tuple, object] = {}

    def out(st: str, name: str):
        k = (st, name)
        if k not in handles:
            (tmp / st).mkdir(exist_ok=True)
            handles[k] = gzip.open(tmp / st / f"{name}.jsonl.gz", "wt", encoding="utf-8", compresslevel=3)
        return handles[k]

    for b in read(src / "bills.jsonl.gz"):
        st = keep.get(b["id"])
        if st:
            out(st, "bills").write(json.dumps(b) + "\n")
    owner: dict[str, dict[str, str]] = {"versions": {}, "documents": {}}
    for name, key in CHILD.items():
        for r in read(src / f"{name}.jsonl.gz"):
            st = keep.get(r[key])
            if not st:
                continue
            if name in owner:
                owner[name][r["id"]] = st
            out(st, name).write(json.dumps(r) + "\n")
    for name, (key, parent) in LINKS.items():
        for r in read(src / f"{name}.jsonl.gz"):
            st = owner[parent].get(r[key])
            if st:
                out(st, name).write(json.dumps(r) + "\n")
    for h in handles.values():
        h.close()


def load_shard(tmp: Path, st: str, name: str) -> list[dict]:
    p = tmp / st / f"{name}.jsonl.gz"
    return list(read(p)) if p.exists() else []


def build_state(st: str, tmp: Path, sess: dict, chosen_ids: dict, org_class: dict, org_name: dict, stats: Counter,
                seen: set) -> list[dict]:
    bills = load_shard(tmp, st, "bills")
    group = defaultdict(lambda: defaultdict(list))
    for name in CHILD:
        for r in load_shard(tmp, st, name):
            group[r["bill_id"]][name].append(r)
    vlinks, dlinks = defaultdict(list), defaultdict(list)
    for r in load_shard(tmp, st, "version_links"):
        vlinks[r["version_id"]].append({"mediaType": r.get("media_type") or None, "url": r.get("url")})
    for r in load_shard(tmp, st, "document_links"):
        dlinks[r["document_id"]].append({"mediaType": r.get("media_type") or None, "url": r.get("url")})
    rows = []
    state_name = oc.STATES[st]
    for b in bills:
        s = sess[b["legislative_session_id"]]
        role = chosen_ids[s["id"]]
        g = group.get(b["id"], {})
        acts = []
        for a in g.get("actions", []):
            a["classification"] = oc.pg_array(a.get("classification"))
            acts.append(a)
        acts.sort(key=lambda a: (a.get("date") or "", int(a.get("order") or 0)))
        ms = oc.milestones(acts, org_class)
        status, status_label = oc.status(ms)
        latest = acts[-1] if acts else None
        sponsors = [{k: v for k, v in {"name": sp.get("name"), "primary": sp.get("primary") == "t",
                                       "classification": sp.get("classification") or None,
                                       "entityType": sp.get("entity_type") or None}.items() if v is not None}
                    for sp in sorted(g.get("sponsorships", []), key=lambda x: (x.get("primary") != "t", x.get("name") or ""))]
        versions = [{k: v for k, v in {"note": v_.get("note") or None, "date": oc.day(v_.get("date")),
                                       "classification": v_.get("classification") or None,
                                       "links": [l for l in vlinks.get(v_["id"], []) if l.get("url")]}.items() if v}
                    for v_ in sorted(g.get("versions", []), key=lambda x: (x.get("date") or "", x.get("note") or ""))]
        documents = [{k: v for k, v in {"note": d.get("note") or None, "date": oc.day(d.get("date")),
                                        "classification": d.get("classification") or None,
                                        "links": [l for l in dlinks.get(d["id"], []) if l.get("url")]}.items() if v}
                     for d in sorted(g.get("documents", []), key=lambda x: (x.get("date") or "", x.get("note") or ""))]
        sources_all = [{"url": x.get("url"), "note": x.get("note") or None} for x in g.get("sources", [])]
        official = oc.official_sources(g.get("sources", []))
        os_url = oc.openstates_url(st, s["identifier"], b["identifier"])
        rid = oc.record_id(st, s["identifier"], b["identifier"])
        if rid in seen:
            rid = f"{rid}-{b['id'].split('/')[-1][:8]}"
            stats["id_collisions"] += 1
        seen.add(rid)
        classification = oc.pg_array(b.get("classification"))
        subjects = oc.pg_array(b.get("subject"))
        first = oc.day(b.get("first_action_date"))
        la_date = oc.day(latest.get("date")) if latest else oc.day(b.get("latest_action_date"))
        la_desc = (latest.get("description") if latest else None) or b.get("latest_action_description") or None
        compact = [{k: v for k, v in {"d": oc.day(a.get("date")), "x": a.get("description"),
                                      "c": a.get("classification") or None,
                                      "o": org_name.get(a.get("organization_id") or "")}.items() if v}
                   for a in acts[-MAX_ACTIONS:]]
        bill = {
            "state": st, "stateName": state_name, "ocdId": b["id"], "identifier": b["identifier"], "title": b.get("title"),
            "session": {"id": s["identifier"], "name": s["name"], "role": role, "start": s.get("start_date") or None,
                        "end": s.get("end_date") or None},
            "classification": classification, "subjects": subjects, "chamber": org_name.get(b.get("from_organization_id") or ""),
            "firstActionDate": first,
            "latestAction": {"date": la_date, "description": la_desc,
                             "classification": (latest.get("classification") if latest else None) or None} if (la_date or la_desc) else None,
            "actionCount": len(acts), "actions": compact, "actionsShown": len(compact), "milestones": ms,
            "status": status, "statusLabel": status_label, "sponsors": sponsors, "versions": versions, "documents": documents,
            "sources": sources_all, "officialSources": official, "openStatesUrl": os_url,
            "openStatesUpdated": b.get("updated_at"),
        }
        primary = [x["name"] for x in sponsors if x.get("primary")]
        sponsor_label = primary[0] if primary else (sponsors[0]["name"] if sponsors else None)
        source_url = official[0]["url"] if official else os_url
        stats["records"] += 1
        stats[f"status_{status}"] += 1
        stats["official_source" if official else "no_official_source"] += 1
        for n in oc.MILESTONE_ORDER:
            if ms.get(n):
                stats[f"milestone_{n}"] += 1
        cells = {"citation": f"{b['identifier']} ({state_name}, {s['name']})", "identifier": b["identifier"], "state": st,
                 "session": s["identifier"], "session_name": s["name"], "title": (b.get("title") or "")[:600] or None,
                 "sponsor": sponsor_label, "first_action_date": first, "latest_action_date": la_date,
                 "latest_action": (la_desc or "")[:400] or None, "status": status, "status_label": status_label,
                 "classification": ", ".join(classification) or None}
        facts = [["Bill", f"{b['identifier']}, {state_name} {s['name']}"], ["Title", b.get("title") or "Not recorded"],
                 ["Classification", ", ".join(classification) or "Not recorded"],
                 ["Primary sponsor (as published)", sponsor_label or "Not recorded"],
                 ["First action", first or "Not recorded"],
                 ["Latest action", f"{la_date or 'Date not recorded'}: {la_desc or 'Not recorded'}"],
                 ["Status (from Open States action classifications)", status_label],
                 ["Official source", source_url if official else "Not recorded (Open States page shown)"],
                 ["Source", "Open States public data (public domain dedication)"]]
        links = ([{"url": o["url"], "label": "Official legislature page"} for o in official[:2]]
                 + [{"url": os_url, "label": "Open States bill page"}, {"url": f"/places/{st}", "label": f"{state_name} profile"}])
        text = " ".join(x for x in [b["identifier"], oc.ident_key(b["identifier"]), b.get("title") or "", state_name, st,
                                    s["name"], " ".join(subjects), " ".join(x["name"] for x in sponsors[:6] if x.get("name"))] if x)
        outcome = oc.outcome(ms)
        stats[f"outcome_{outcome}"] += 1
        bill["outcome"] = outcome
        filters = {"state": [st], "session": [s["identifier"]], "session_role": [role], "status": [status], "outcome": [outcome],
                   "milestone": [n for n in oc.MILESTONE_ORDER if ms.get(n)], "ident": [oc.ident_key(b["identifier"])],
                   "classification": classification[:6], "subject": subjects[:40]}
        filters = {k: v for k, v in filters.items() if v}
        title = f"{b['identifier']} ({state_name} {s['name']}): {b.get('title') or 'Title not recorded'}"
        row = record(DATASET, rid, title[:1000], source_url=source_url, cells=cells, facts=facts, text=text, filters=filters,
                     subtitle=status_label, badges=[state_name, status_label], links=links, state=st,
                     extra={"kind": "state_bill"})
        row["detail"]["bill"] = bill
        rows.append(row)
    rows.sort(key=lambda r: (r["item"]["cells"].get("latest_action_date") or "", r["id"]), reverse=True)
    return rows


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="2026-10")
    a = ap.parse_args(argv)
    src = cm.ACQ / "openstates" / a.month
    manifest = json.loads((src / "dump_manifest.json").read_text())
    sessions, chosen, session_stats = choose_sessions(src)
    chosen_ids = {x["id"]: x["role"] for v in chosen.values() for x in v}
    keep: dict[str, str] = {}
    for b in read(src / "bills.jsonl.gz"):
        if b["legislative_session_id"] in chosen_ids:
            s = sessions[b["legislative_session_id"]]
            keep[b["id"]] = oc.abbr(s["jurisdiction_id"])
    tmp = cm.BUILD / "state_shards"
    if tmp.exists():
        shutil.rmtree(tmp)
    shard(src, tmp, keep)
    orgs = list(read(src / "organizations.jsonl.gz"))
    org_class = {o["id"]: o.get("classification") or "" for o in orgs}
    org_name = {o["id"]: o.get("name") or "" for o in orgs}
    stats: Counter = Counter()
    per_session: dict[str, int] = {}
    out_path = cm.BUILD / f"{DATASET}.rows.jsonl.gz"
    tmp_out = out_path.with_suffix(".part")
    digest = hashlib.sha256()
    n = 0
    seen: set[str] = set()
    with gzip.open(tmp_out, "wt", encoding="utf-8") as out:
        for st in sorted(oc.STATES):
            rows = build_state(st, tmp, sessions, chosen_ids, org_class, org_name, stats, seen)
            for row in rows:
                key = f"{st}|{row['filters']['session'][0]}"
                per_session[key] = per_session.get(key, 0) + 1
                out.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")
                digest.update((("\n" if n else "") + json.dumps(row, sort_keys=True)).encode())
                n += 1
            print(json.dumps({"state": st, "records": len(rows)}), flush=True)
    tmp_out.replace(out_path)
    shutil.rmtree(tmp)
    sessions_out = {oc.abbr(j): v for j, v in sorted(chosen.items())}
    missing = sorted(set(oc.STATES) - set(sessions_out))
    summary = {
        "source": "Open States public data: monthly PostgreSQL dump " + manifest["url"] + " (linked from " + manifest["data_page"] + ")",
        "licence": "Public domain dedication: \"" + manifest["licence_statement"] + "\" (Open States bulk data page)",
        "dump": {"etag": manifest["headers"]["ETag"], "last_modified": manifest["headers"]["Last-Modified"],
                 "bytes": manifest["bytes_streamed"], "sha256": manifest["sha256"], "retrieved_at": manifest["retrieved_at"]},
        "records": n, "session_rule": oc.SELECTION_RULE, "sessions": sessions_out, "jurisdictions_without_sessions": missing,
        "milestone_rules": oc.MILESTONE_RULES, "outcome_rule": oc.OUTCOME_RULE,
        "source_url_rule": "Each record's source URL is the first legislature URL Open States records for the bill (http(s), not Open States or a commercial host); the Open States bill page is a secondary link and is used as the source URL only when no legislature URL is recorded.",
        "actions_rule": f"Action count is every action in the dump; the record lists the {MAX_ACTIONS} most recent actions at most.",
        "stats": dict(sorted(stats.items())), "per_state_session": per_session,
    }
    listing = {
        "page": 1, "limit": 50,
        "columns": [{"key": "citation", "label": "Bill"}, {"key": "title", "label": "Title"}, {"key": "sponsor", "label": "Sponsor"},
                    {"key": "latest_action_date", "label": "Latest action"}, {"key": "status_label", "label": "Status"}],
        "filters": [
            {"name": "q", "type": "search", "label": "Search"},
            {"name": "state", "type": "select", "label": "State",
             "options": [{"label": oc.STATES[s], "value": s, "count": sum(v for k, v in per_session.items() if k.startswith(s + "|"))}
                         for s in sorted(oc.STATES) if s in sessions_out]},
            {"name": "session", "type": "select", "label": "Session",
             "options": [{"label": f"{oc.STATES[s]} {x['name']}", "value": x["identifier"], "state": s, "role": x["role"],
                          "count": per_session.get(f"{s}|{x['identifier']}", 0)}
                         for s, v in sorted(sessions_out.items()) for x in v]},
            {"name": "status", "type": "select", "label": "Status",
             "options": [{"label": lab, "value": key, "count": stats[f"status_{key}"]} for key, lab in
                         (("became_law", "Became law"), ("signed", "Signed by the executive"), ("vetoed", "Vetoed"),
                          ("passed_both", "Passed both chambers"), ("passed_legislature", "Passed the legislature"),
                          ("passed_lower", "Passed lower chamber"), ("passed_upper", "Passed upper chamber"),
                          ("introduced", "Introduced"), ("not_recorded", "Not recorded")) if stats[f"status_{key}"]]},
        ],
    }
    raw = hashlib.sha256(out_path.read_bytes()).hexdigest()
    meta = {"dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summary,
            "rows_file": str(out_path.relative_to(cm.ROOT)), "rows": n, "rows_sha256": raw, "manifest_sha256": digest.hexdigest(),
            "inputs": [{"url": manifest["url"], "sha256": manifest["sha256"], "bytes": manifest["bytes_streamed"],
                        "extracts": str(src.relative_to(cm.ROOT))}], "built_at": cm.now_utc()}
    (cm.BUILD / f"{DATASET}.meta.json").write_text(json.dumps(meta, indent=1, sort_keys=True, ensure_ascii=False))
    (cm.BUILD / f"{DATASET}.stats.json").write_text(json.dumps({"stats": summary["stats"], "per_state_session": per_session,
                                                                 "sessions": sessions_out, "session_bill_counts": session_stats},
                                                                indent=1, sort_keys=True))
    print(json.dumps({"records": n, "missing_jurisdictions": missing, "stats": {k: v for k, v in stats.items() if not k.startswith("milestone")}}))


if __name__ == "__main__":
    main(sys.argv[1:])
