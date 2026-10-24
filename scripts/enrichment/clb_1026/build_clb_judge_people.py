"""Build clb_judge_people: each judge's record in CourtListener's people database, as recorded.

One record per CourtListener person with at least one position at a court (people-db positions with a court id) or an ABA
rating. Each record carries, exactly as stored and joined only on CourtListener ids:
* every position (judicial and other), with nomination, committee, hearing, confirmation, vote, start, termination and
  retirement dates at the precision CourtListener recorded, how the person was selected, the termination reason, the
  appointing official (appointer position -> its person), the predecessor and the court (court id -> /courts/<id> when that
  id is in the court directory);
* education (degree level, degree text, year, school; an aliased school also shows the school it is an alias of);
* recorded political affiliations with the source CourtListener gives for each (Ballot, Appointer, Other) and their dates;
* ABA ratings (rating, year rated) from CourtListener's REST API (aba-ratings endpoint; not in the bulk files), with the
  retrieval time of the page each rating came from.
Codes are shown with CourtListener's own display names (HTTP OPTIONS legends). Retention events: CourtListener holds none
(0 rows in the bulk file and the API on 2026-10-24); the summary says so. Nothing is inferred, merged or estimated.
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import clb1026_common as cm  # noqa: E402
import cl_api  # noqa: E402
import corpus_writer as writer  # noqa: E402

DATASET = "clb_judge_people"
FILES = {
    "people": "people-db-people-2026-09-30.csv.bz2",
    "positions": "people-db-positions-2026-09-30.csv.bz2",
    "educations": "people-db-educations-2026-09-30.csv.bz2",
    "schools": "people-db-schools-2026-09-30.csv.bz2",
    "affiliations": "people-db-political-affiliations-2026-09-30.csv.bz2",
    "retention": "people-db-retention-events-2026-09-30.csv.bz2",
    "courts": "courts-2026-09-30.csv.bz2",
    "origins": "originating-court-information-2026-09-30.csv.bz2",
}
EXPORT_DAY = "2026-09-30"
SUFFIX = {"jr": "Jr.", "sr": "Sr.", "1": "I", "2": "II", "3": "III", "4": "IV"}
PERSON_URL = "https://www.courtlistener.com/person/{pid}/"
ABA_URL = cl_api.API + "aba-ratings/"
MAX_POSITIONS = 60  # most positions a person has is far below this; a cap guards the record size


def full_name(p: dict) -> str:
    parts = [cm.blank(p.get(k)) for k in ("name_first", "name_middle", "name_last")]
    name = " ".join(x for x in parts if x)
    suf = cm.blank(p.get("name_suffix"))
    if suf:
        name += " " + SUFFIX.get(suf.lower(), suf)
    return name or "Name not recorded"


def aba_ratings() -> tuple[dict[int, list[dict]], dict]:
    """person id -> [{rating, label, year, id, retrieved_at, page_sha256}] from the archived aba-ratings pages (ordered by id)."""
    index = cl_api.load_index()
    url = cl_api.build_url("aba-ratings/", [("order_by", "id")])
    out: dict[int, list[dict]] = defaultdict(list)
    pages, seen, first_at, last_at = 0, set(), None, None
    total = None
    while url:
        rec = index.get(("GET", url))
        if not rec:
            raise SystemExit("aba-ratings pages are not all archived: run fetch_api_reference.py")
        body = json.loads(cl_api.read_raw(rec["sha256"]))
        pages += 1
        first_at = first_at or rec["retrieved_at"]
        last_at = rec["retrieved_at"]
        for r in body["results"]:
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            person = r.get("person") or ""
            pid = cm.as_int(person.rstrip("/").rsplit("/", 1)[-1]) if person.startswith(cl_api.API + "people/") else None
            if pid is None:
                continue
            out[pid].append({"id": r["id"], "rating": r.get("rating"), "year": r.get("year_rated"), "retrieved_at": rec["retrieved_at"], "page_sha256": rec["sha256"]})
        url = body.get("next")
    count_rec = index.get(("GET", cl_api.build_url("aba-ratings/", {"count": "on"})))
    if count_rec:
        total = json.loads(cl_api.read_raw(count_rec["sha256"])).get("count")
    return out, {"pages": pages, "rows": len(seen), "endpoint_count": total, "first_retrieved_at": first_at, "last_retrieved_at": last_at}


def build() -> dict:
    leg = cm.legends()
    spine = cm.spine_ids()
    paths = {k: cm.bulk_path(v) for k, v in FILES.items()}
    courts = {r["id"]: {"name": cm.blank(r["full_name"]) or r["id"], "jurisdiction": cm.blank(r["jurisdiction"])} for r in cm.pg_rows(paths["courts"])}
    people = {int(r["id"]): r for r in cm.pg_rows(paths["people"])}
    schools = {int(r["id"]): r for r in cm.pg_rows(paths["schools"])}
    retention_rows = sum(1 for _ in cm.pg_rows(paths["retention"]))
    positions = [r for r in cm.pg_rows(paths["positions"])]
    pos_by_id = {int(r["id"]): r for r in positions}
    by_person = defaultdict(list)
    for r in positions:
        pid = cm.as_int(r["person_id"])
        if pid is not None:
            by_person[pid].append(r)
    edus = defaultdict(list)
    for r in cm.pg_rows(paths["educations"]):
        pid = cm.as_int(r["person_id"])
        if pid is not None:
            edus[pid].append(r)
    affs = defaultdict(list)
    for r in cm.pg_rows(paths["affiliations"]):
        pid = cm.as_int(r["person_id"])
        if pid is not None:
            affs[pid].append(r)
    aba, aba_meta = aba_ratings()
    # appeals whose originating-court record names the person as the lower-court judge (assigned_to_id / ordering_judge_id,
    # exact CourtListener person ids); notice-of-appeal dates after the export day are counted apart, never charted
    lower = defaultdict(lambda: {"assigned": 0, "ordering": 0, "noa_years": Counter(), "noa_after_export": 0, "no_noa_date": 0})
    origin_rows = 0
    for r in cm.pg_rows(paths["origins"]):
        origin_rows += 1
        for col, key in (("assigned_to_id", "assigned"), ("ordering_judge_id", "ordering")):
            jid = cm.as_int(r[col])
            if jid is None:
                continue
            d = lower[jid]
            d[key] += 1
            if key == "assigned":
                noa = cm.show_date(r["date_filed_noa"], None)
                if not noa:
                    d["no_noa_date"] += 1
                elif noa > EXPORT_DAY:
                    d["noa_after_export"] += 1
                else:
                    d["noa_years"][int(noa[:4])] += 1

    def school_view(sid):
        s = schools.get(sid) if sid is not None else None
        if not s:
            return None
        alias = cm.as_int(s.get("is_alias_of_id"))
        canon = schools.get(alias) if alias is not None else None
        return {"id": sid, "name": cm.blank(s["name"]), "alias_of": ({"id": alias, "name": cm.blank(canon["name"])} if canon else None)}

    def person_ref(pid):
        p = people.get(pid) if pid is not None else None
        return {"id": pid, "name": full_name(p)} if p else None

    def position_view(r):
        pt = cm.blank(r["position_type"])
        cid = cm.blank(r["court_id"])
        appointer = None
        aid = cm.as_int(r["appointer_id"])
        if aid is not None and aid in pos_by_id:
            ap = pos_by_id[aid]
            ref = person_ref(cm.as_int(ap["person_id"]))
            if ref:
                appointer = {**ref, "position_id": aid, "position": cm.label(leg, "positions", "position_type", ap["position_type"]) or cm.blank(ap["job_title"])}
        dates = {
            "nominated": cm.show_date(r["date_nominated"], None),
            "elected": cm.show_date(r["date_elected"], None),
            "recess_appointment": cm.show_date(r["date_recess_appointment"], None),
            "referred_to_committee": cm.show_date(r["date_referred_to_judicial_committee"], None),
            "committee_action": cm.show_date(r["date_judicial_committee_action"], None),
            "hearing": cm.show_date(r["date_hearing"], None),
            "confirmation": cm.show_date(r["date_confirmation"], None),
            "start": cm.show_date(r["date_start"], r["date_granularity_start"]),
            "termination": cm.show_date(r["date_termination"], r["date_granularity_termination"]),
            "retirement": cm.show_date(r["date_retirement"], None),
        }
        votes = {"type": cm.label(leg, "positions", "vote_type", r["vote_type"]), "voice_vote": cm.bool_flag(r["voice_vote"]),
                 "yes": cm.as_int(r["votes_yes"]), "no": cm.as_int(r["votes_no"]),
                 "yes_percent": cm.as_float(r["votes_yes_percent"]), "no_percent": cm.as_float(r["votes_no_percent"])}
        return {
            "id": int(r["id"]),
            "position_type": pt,
            "position": cm.label(leg, "positions", "position_type", pt) if pt else None,
            "job_title": cm.clip(r["job_title"], 160),
            "court_id": cid if cid in courts else None,
            "court": courts[cid]["name"] if cid in courts else None,
            "court_link": cm.court_link(cid, spine) if cid in courts else None,
            "organization": cm.clip(r["organization_name"], 160),
            "school": school_view(cm.as_int(r["school_id"])),
            "location": ", ".join(x for x in (cm.blank(r["location_city"]), cm.label(leg, "positions", "location_state", r["location_state"])) if x) or None,
            "sector": cm.label(leg, "positions", "sector", r["sector"]),
            "how_selected": cm.label(leg, "positions", "how_selected", r["how_selected"]),
            "nomination_process": cm.label(leg, "positions", "nomination_process", r["nomination_process"]),
            "committee_action": cm.label(leg, "positions", "judicial_committee_action", r["judicial_committee_action"]),
            "termination_reason": cm.label(leg, "positions", "termination_reason", r["termination_reason"]),
            "dates": dates,
            "votes": votes if any(v is not None for v in votes.values()) else None,
            "appointer": appointer,
            "predecessor": person_ref(cm.as_int(r["predecessor_id"])),
            "has_inferred_values": cm.bool_flag(r["has_inferred_values"]),
        }

    def sort_key(pv):
        return (pv["dates"]["start"] or pv["dates"]["nominated"] or pv["dates"]["confirmation"] or "9999", pv["id"])

    selected = sorted(pid for pid in people if any(cm.blank(r["court_id"]) for r in by_person.get(pid, [])) or pid in aba)
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    stats = Counter()
    for pid in selected:
        p = people[pid]
        name = full_name(p)
        pvs = sorted((position_view(r) for r in by_person.get(pid, [])), key=sort_key)
        court_pvs = [x for x in pvs if x["court_id"]]
        educ = []
        for e in sorted(edus.get(pid, []), key=lambda e: (cm.as_int(e["degree_year"]) or 9999, int(e["id"]))):
            lvl = cm.blank(e["degree_level"])
            educ.append({"id": int(e["id"]), "degree_level": lvl, "degree": cm.label(leg, "educations", "degree_level", lvl) if lvl else None,
                         "degree_detail": cm.clip(e["degree_detail"], 120), "year": cm.as_int(e["degree_year"]), "school": school_view(cm.as_int(e["school_id"]))})
        aff = []
        for a in sorted(affs.get(pid, []), key=lambda a: (a["date_start"] or "9999", int(a["id"]))):
            aff.append({"id": int(a["id"]), "party_code": cm.blank(a["political_party"]), "party": cm.label(leg, "political-affiliations", "political_party", a["political_party"]),
                        "source_code": cm.blank(a["source"]), "source": cm.label(leg, "political-affiliations", "source", a["source"]),
                        "start": cm.show_date(a["date_start"], a["date_granularity_start"]), "end": cm.show_date(a["date_end"], a["date_granularity_end"])})
        ratings = [{"rating_code": r["rating"], "rating": cm.label(leg, "aba-ratings", "rating", r["rating"]), "year": r["year"], "id": r["id"], "retrieved_at": r["retrieved_at"]}
                   for r in sorted(aba.get(pid, []), key=lambda r: (r["year"] or 0, r["id"]))]
        alias = cm.as_int(p.get("is_alias_of_id"))
        profile = {
            "person_id": pid, "name": name, "slug": cm.blank(p["slug"]), "fjc_id": cm.as_int(p["fjc_id"]), "alias_of": person_ref(alias) if alias else None,
            "born": cm.show_date(p["date_dob"], p["date_granularity_dob"]), "died": cm.show_date(p["date_dod"], p["date_granularity_dod"]),
            "positions": pvs[:MAX_POSITIONS], "positions_total": len(pvs), "court_positions": len(court_pvs),
            "education": educ, "political_affiliations": aff, "aba_ratings": ratings, "retention_events": [],
            "courts": sorted({x["court_id"] for x in court_pvs}),
            "lower_court_appeals": ({"assigned": lower[pid]["assigned"], "ordering": lower[pid]["ordering"],
                                     "by_notice_year": [[y, n] for y, n in sorted(lower[pid]["noa_years"].items())],
                                     "notice_after_export": lower[pid]["noa_after_export"], "no_notice_date": lower[pid]["no_noa_date"]}
                                    if pid in lower else None),
        }
        stats["people"] += 1
        stats["positions"] += len(pvs)
        stats["with_education"] += bool(educ)
        stats["with_aba"] += bool(ratings)
        stats["aba_ratings"] += len(ratings)
        stats["with_affiliation"] += bool(aff)
        stats["inferred_positions"] += sum(1 for x in pvs if x["has_inferred_values"])
        stats["with_lower_court_appeals"] += pid in lower
        latest = court_pvs[-1] if court_pvs else None
        law = next((e for e in educ if e["degree_level"] in ("jd", "llb")), None)
        first_conf = next((x for x in court_pvs if x["dates"]["confirmation"]), None)
        fact_pairs = [
            ("CourtListener person id", pid),
            ("FJC id as recorded", cm.as_int(p["fjc_id"])),
            ("Positions on record", f"{len(pvs)} ({len(court_pvs)} at a court)"),
            ("Latest court position", f"{latest['position'] or latest['job_title'] or 'Position'}, {latest['court']} ({latest['dates'].get('start') or 'start not recorded'} – {latest['dates'].get('termination') or 'no end recorded'})" if latest else None),
            ("Law degree", f"{law['degree']}, {law['school']['name'] if law['school'] else 'school not recorded'}{', ' + str(law['year']) if law['year'] else ''}" if law else None),
            ("ABA ratings", "; ".join(f"{r['rating'] or r['rating_code']} ({r['year'] or 'year not recorded'})" for r in ratings) or None),
            ("First recorded confirmation", f"{first_conf['dates']['confirmation']} ({first_conf['court']})" if first_conf else None),
            ("Political affiliations recorded", "; ".join(f"{a['party'] or a['party_code']} (source: {a['source'] or 'not recorded'})" for a in aff) or None),
            ("Appeals naming this person as the lower-court judge", f"{lower[pid]['assigned']:,} (CourtListener originating-court records)" if pid in lower and lower[pid]["assigned"] else None),
        ]
        # a fact CourtListener does not record is left out of the facts list (the profile keeps the full structure)
        facts = cm.facts([(k, v) for k, v in fact_pairs if v is not None])
        links = [{"label": "CourtListener person page", "url": PERSON_URL.format(pid=pid)}]
        # the court of the latest court position only (every position carries its own court link in the profile)
        if latest and latest["court_link"]:
            links.append({"label": latest["court"], "url": latest["court_link"]})
        rows.append(writer.record(
            DATASET, str(pid), f"{name}: CourtListener people database record", source_url=cm.BULK_BASE + FILES["positions"],
            subtitle=" · ".join(x for x in [f"{len(court_pvs)} court position{'s' if len(court_pvs) != 1 else ''}" if court_pvs else None,
                                            f"{len(educ)} degree{'s' if len(educ) != 1 else ''}" if educ else None,
                                            f"ABA: {ratings[-1]['rating'] or ratings[-1]['rating_code']}" if ratings else None] if x),
            cells={"judge": name, "court": latest["court"] if latest else None, "position": (latest["position"] or latest["job_title"]) if latest else None,
                   "start": latest["dates"]["start"] if latest else None, "end": latest["dates"]["termination"] if latest else None,
                   "selected": latest["how_selected"] if latest else None, "law_school": law["school"]["name"] if law and law["school"] else None,
                   "aba": (ratings[-1]["rating"] or ratings[-1]["rating_code"]) if ratings else None, "positions": len(pvs)},
            badges=["CourtListener people database"] + (["ABA rating"] if ratings else []),
            facts=facts,
            text=" ".join([name, *sorted({x["court"] for x in court_pvs if x["court"]})[:6]]),
            filters={"court": profile["courts"][:20] or ["none"], "aba": sorted({r["rating_code"] for r in ratings}) or ["none"]},
            links=links, extra={"profile": cm.compact(profile)}))
    rows.sort(key=lambda r: (-r["item"]["profile"].get("court_positions", 0), r["id"]))
    inputs = [cm.bulk_input(v) for v in FILES.values()]
    inputs.append({"url": ABA_URL, "path": "private/acq/clb_1026/api (aba-ratings pages ordered by id)", "sha256": None,
                   "retrieved_at": aba_meta["last_retrieved_at"], "pages": aba_meta["pages"]})
    for ep in ("positions", "educations", "political-affiliations", "aba-ratings", "courts", "people"):
        src = leg[ep]["_source"]
        inputs.append({"url": src["url"], "path": "OPTIONS legend", "sha256": src["sha256"], "retrieved_at": src["retrieved_at"]})
    summary = {
        "source": "CourtListener people database bulk files (people, positions, educations, schools, political affiliations, retention events, courts; Sept 30, 2026) and the aba-ratings REST endpoint (Free Law Project)",
        "snapshot": cm.SNAPSHOT, "terms": cm.TERMS,
        "totals": dict(stats) | {"aba_rows_fetched": aba_meta["rows"], "aba_endpoint_count": aba_meta["endpoint_count"], "aba_pages": aba_meta["pages"],
                                 "retention_event_rows_bulk": retention_rows, "originating_court_rows": origin_rows,
                                 "lower_court_judge_ids": len(lower), "lower_court_judge_ids_not_selected": sum(1 for j in lower if j not in set(selected)), "aba_retrieved": f"{aba_meta['first_retrieved_at']} to {aba_meta['last_retrieved_at']}"},
        "definitions": {
            "selection": "one record per CourtListener person with at least one position at a court, or an ABA rating",
            "dates": "shown to the precision CourtListener recorded (year, month or day); confirmation, nomination and hearing dates are stored as days",
            "appointer": "the appointing official is the person holding the position CourtListener links as appointer (exact id join)",
            "political affiliation source": leg["political-affiliations"]["_help"].get("source"),
            "has inferred values": leg["positions"]["_help"].get("has_inferred_values"),
            "aba rating": "rating and year as stored by CourtListener (aba-ratings endpoint, fetched page by page on the retrieval dates given)",
            "code labels": "CourtListener's own display names for its codes, read from the API's OPTIONS responses on the retrieval date given in inputs",
            "lower-court appeals": "originating-court records (one per appeal docket in CourtListener's collection) whose assigned_to_id or ordering_judge_id is the person's id; by year of the notice of appeal as recorded; a notice date after Sept 30, 2026 is counted apart",
        },
        "caveats": [
            "CourtListener's people database covers federal judges comprehensively and state judges partially; a missing value means CourtListener records none.",
            f"Retention events: CourtListener records none ({retention_rows} rows in the bulk file; the retention-events endpoint reported a count of 0 on 2026-10-24).",
            "Person sources (the people-db source notes, 20,430 rows) were not fetched: the endpoint pages 20 rows per request.",
            "Political affiliations are shown only as recorded, with the source CourtListener gives; nothing is inferred from an appointer or a court.",
        ],
        "grain": "one record per CourtListener person (court position or ABA rating)",
    }
    return {
        "dataset": DATASET,
        "label": "Judges in CourtListener's people database: positions, appointments, confirmations, education and ABA ratings (Sept 30, 2026)",
        "listing_block": writer.listing([("judge", "Judge"), ("court", "Latest court"), ("position", "Position"), ("start", "Start"), ("end", "End"),
                                         ("selected", "Selected by"), ("law_school", "Law school"), ("aba", "ABA rating"), ("positions", "Positions")],
                                        [("aba", "ABA rating", {"ewq": "Exceptionally Well Qualified", "wq": "Well Qualified", "q": "Qualified", "nq": "Not Qualified", "nqa": "Not Qualified By Reason of Age", "none": "No rating recorded"})]),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs,
    }


if __name__ == "__main__":
    cm.write_build(build())
