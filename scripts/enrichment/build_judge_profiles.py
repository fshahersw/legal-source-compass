"""Build `judge_profiles_fjc`: every judge in the FJC Biographical Directory of Article III Federal Judges (4,077 judges).

Inputs (all local; no corpus writes here; publish the build file with private/scratch/enrich/publish_build.py):
  * private/acq/judge_xwalk/fjc_judges.csv - FJC export (https://www.fjc.gov/sites/default/files/history/judges.csv),
    retrieved 2026-10-19 (sha256 in private/acq/judge_xwalk/_manifest.jsonl);
  * private/acq/judiciary/fjc_bio/sites/default/files/history/other-nominations-recess.csv - the FJC category file of other
    (including unsuccessful) nominations and recess appointments, one row per entry;
  * private/build/judiciary/lookups/judges_xwalk_lookup.jsonl - corpus `judges` records with their native FJC nid
    (detail.evidence.ids.fjc_nid; checked equal to the live corpus by an md5 over id:nid pairs, see lookups/LOOKUPS.md);
  * private/build/judiciary/lookups/cl_people_xwalk_lookup.jsonl - CourtListener people with their FJC jid (fjc_id);
  * private/build/judiciary/lookups/live_profile_mdls.json, live_court_workload.json - the pending-MDL assignments and
    court workload figures of the previous judge_profiles_fjc publication, carried over unchanged by FJC nid / court id.
Output: private/build/judiciary/judge_profiles_fjc.json (build file), keyed by FJC nid.

Links: /judges/<id> only when exactly one corpus `judges` record carries this nid as its native FJC id; CourtListener
person only when its fjc_id equals the row's jid. Gender and race or ethnicity are shown exactly as the FJC records them and
labelled so; they are never used in any comparison. The appointing president's party is a fact about the appointment and is
labelled "Appointed by a <party> president", never shown as the judge's own party.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "private").exists():
    ROOT = Path("/home/user/legal-source-compass")
FJC_CSV = ROOT / "private" / "acq" / "judge_xwalk" / "fjc_judges.csv"
OTHER_NOMS = ROOT / "private" / "acq" / "judiciary" / "fjc_bio" / "sites" / "default" / "files" / "history" / "other-nominations-recess.csv"
LOOKUPS = ROOT / "private" / "build" / "judiciary" / "lookups"
OUT = ROOT / "private" / "build" / "judiciary" / "judge_profiles_fjc.json"
DATASET = "judge_profiles_fjc"
FJC_URL = "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export"
FJC_CSV_URL = "https://www.fjc.gov/sites/default/files/history/judges.csv"
OTHER_NOMS_URL = "https://www.fjc.gov/sites/default/files/history/other-nominations-recess.csv"
AS_OF = date(2026, 10, 19)  # retrieval date of the FJC export
DEMOGRAPHICS_LABEL = "as recorded by the Federal Judicial Center"

STATES = {
    "Alabama": "al", "Alaska": "ak", "Arizona": "az", "Arkansas": "ar", "California": "ca", "Colorado": "co",
    "Connecticut": "ct", "Delaware": "de", "District of Columbia": "dc", "Florida": "fl", "Georgia": "ga",
    "Guam": "gu", "Hawaii": "hi", "Idaho": "id", "Illinois": "il", "Indiana": "in", "Iowa": "ia", "Kansas": "ks",
    "Kentucky": "ky", "Louisiana": "la", "Maine": "me", "Maryland": "md", "Massachusetts": "ma", "Michigan": "mi",
    "Minnesota": "mn", "Mississippi": "ms", "Missouri": "mo", "Montana": "mt", "Nebraska": "ne", "Nevada": "nv",
    "New Hampshire": "nh", "New Jersey": "nj", "New Mexico": "nm", "New York": "ny", "North Carolina": "nc",
    "North Dakota": "nd", "Northern Mariana Islands": "nmi", "Ohio": "oh", "Oklahoma": "ok", "Oregon": "or",
    "Pennsylvania": "pa", "Puerto Rico": "pr", "Rhode Island": "ri", "South Carolina": "sc", "South Dakota": "sd",
    "Tennessee": "tn", "Texas": "tx", "Utah": "ut", "Vermont": "vt", "Virgin Islands": "vi", "Virginia": "va",
    "Washington": "wa", "West Virginia": "wv", "Wisconsin": "wi", "Wyoming": "wy",
}
STATE_NAMES = {v: k for k, v in STATES.items()}
DIRECTIONS = {"Northern": "n", "Southern": "s", "Eastern": "e", "Western": "w", "Middle": "m", "Central": "c"}
CIRCUITS = {"First": "ca1", "Second": "ca2", "Third": "ca3", "Fourth": "ca4", "Fifth": "ca5", "Sixth": "ca6", "Seventh": "ca7",
            "Eighth": "ca8", "Ninth": "ca9", "Tenth": "ca10", "Eleventh": "ca11", "District of Columbia": "cadc", "Federal": "cafc"}
SPECIAL = {"gu": "gud", "nmi": "nmid", "vi": "vid"}


def court_id(name: str):
    name = name.strip()
    if name == "Supreme Court of the United States":
        return "scotus"
    if name == "U.S. Court of International Trade":
        return "cit"
    if name == "U.S. District Court for the District of Columbia":
        return "dcd"
    m = re.match(r"U\.S\. Court of Appeals for the (.+?) Circuit$", name)
    if m:
        return CIRCUITS.get(m.group(1))
    m = re.match(r"U\.S\. District Court for the (?:(\w+) )?District of (.+)$", name)
    if m:
        state = STATES.get(m.group(2))
        if not state:
            return None
        if m.group(1):
            return state + DIRECTIONS.get(m.group(1), "?") + "d"
        return SPECIAL.get(state, state + "d")
    return None


def court_state(cid):
    if not cid or cid.startswith("ca") and cid[2:].isdigit() or cid in ("cadc", "cafc", "scotus", "cit"):
        return None
    for code, name in STATE_NAMES.items():
        if cid.startswith(code) and (cid == code + "d" or (len(cid) == len(code) + 2 and cid[len(code)] in "nsewmc")):
            return name
    return None


def v(row: dict, key: str):
    """A CSV value as published, with surrounding whitespace removed; blank -> None."""
    s = (row.get(key) or "").strip()
    return s or None


def party_label(party: str | None) -> str | None:
    """'Republican' -> 'Appointed by a Republican president'. Values that are not a party name are stated as recorded."""
    if not party:
        return None
    if party.startswith("None"):
        return f"Appointing president's party: {party}"
    article = "an" if party[0].upper() in "AEIOU" else "a"
    return f"Appointed by {article} {party} president"


def vote_label(vote_type: str | None, ayes_nays: str | None) -> str:
    """The Senate vote as the FJC records it: 'Voice vote', 'Roll call 53-43', 'Roll call (tally not recorded)'."""
    tally = (ayes_nays or "").strip()
    if vote_type == "Voice":
        return "Voice vote"
    if vote_type == "Roll Call":
        m = re.fullmatch(r"(\d+)\s*/\s*(\d+)", tally)
        return f"Roll call {m.group(1)}-{m.group(2)}" if m else "Roll call (tally not recorded)"
    if vote_type:
        return f"{vote_type} (as recorded)"
    return "Not recorded"


def services(row):
    out = []
    for i in range(1, 7):
        court = v(row, f"Court Name ({i})")
        if not court:
            continue
        party = v(row, f"Party of Appointing President ({i})")
        vote_type = v(row, f"Senate Vote Type ({i})")
        ayes = v(row, f"Ayes/Nays ({i})")
        out.append({
            "court": court, "court_id": court_id(court), "court_type": v(row, f"Court Type ({i})"),
            "title": v(row, f"Appointment Title ({i})") or "", "president": v(row, f"Appointing President ({i})") or "",
            "party": party or "", "appointing_party_label": party_label(party),
            "reappointing_president": v(row, f"Reappointing President ({i})"),
            "reappointing_party": v(row, f"Party of Reappointing President ({i})"),
            "aba_rating": v(row, f"ABA Rating ({i})"), "seat_id": v(row, f"Seat ID ({i})"),
            "statute": v(row, f"Statute Authorizing New Seat ({i})"),
            "recess_appointment": v(row, f"Recess Appointment Date ({i})"),
            "nomination": v(row, f"Nomination Date ({i})"),
            "committee_referral": v(row, f"Committee Referral Date ({i})"),
            "hearing": v(row, f"Hearing Date ({i})"),
            "committee_action": v(row, f"Judiciary Committee Action ({i})"),
            "committee_action_date": v(row, f"Committee Action Date ({i})"),
            "senate_vote_type": vote_type, "vote": ayes, "vote_label": vote_label(vote_type, ayes),
            "confirmation": v(row, f"Confirmation Date ({i})"), "commission": v(row, f"Commission Date ({i})"),
            "chief_begin": v(row, f"Service as Chief Judge, Begin ({i})"), "chief_end": v(row, f"Service as Chief Judge, End ({i})"),
            "chief2_begin": v(row, f"2nd Service as Chief Judge, Begin ({i})"), "chief2_end": v(row, f"2nd Service as Chief Judge, End ({i})"),
            "senior_status": v(row, f"Senior Status Date ({i})"), "termination": v(row, f"Termination ({i})"),
            "termination_date": v(row, f"Termination Date ({i})"),
        })
    return out


def education(row):
    out = []
    for i in range(1, 6):
        school = v(row, f"School ({i})")
        if school:
            out.append({"school": school, "degree": v(row, f"Degree ({i})"), "year": v(row, f"Degree Year ({i})")})
    return out


def full_name(row):
    name = " ".join(p.strip() for p in [row["First Name"], row["Middle Name"], row["Last Name"]] if p and p.strip())
    if (row.get("Suffix") or "").strip():
        name += ", " + row["Suffix"].strip()
    return name


def years_between(start: str | None, end: date):
    if not start:
        return None
    return round((end - date.fromisoformat(start[:10])).days / 365.25, 1)


def status_of(serv):
    sitting = [s for s in serv if not s["termination"]]
    if not sitting:
        return "Service ended", None
    cur = sitting[-1]
    if cur["senior_status"]:
        return "Senior", cur
    if (cur["chief_begin"] and not cur["chief_end"]) or (cur["chief2_begin"] and not cur["chief2_end"]):
        return "Chief Judge", cur
    return "Active", cur


def load_lookups():
    judges_by_nid = defaultdict(list)
    for line in (LOOKUPS / "judges_xwalk_lookup.jsonl").open():
        r = json.loads(line)
        nid = (r.get("ev") or {}).get("fjc_nid")
        if nid:
            judges_by_nid[str(nid)].append(r["id"])
    cl_by_jid = defaultdict(list)
    for line in (LOOKUPS / "cl_people_xwalk_lookup.jsonl").open():
        r = json.loads(line)
        if r.get("fjc") and not r.get("alias_of"):
            cl_by_jid[str(r["fjc"])].append(r["nid"])
    mdls = {r["nid"]: r for r in json.loads((LOOKUPS / "live_profile_mdls.json").read_text())}
    workload = {r["court"]: r["workload"] for r in json.loads((LOOKUPS / "live_court_workload.json").read_text())}
    return judges_by_nid, cl_by_jid, mdls, workload


def other_nominations():
    out = defaultdict(list)
    if not OTHER_NOMS.exists():
        return out
    for r in csv.DictReader(OTHER_NOMS.open(encoding="utf-8-sig")):
        text = (r.get("Other Nominations/Recess Appointments") or "").strip()
        if text:
            out[r["nid"].strip()].append({"sequence": int(r["Sequence"]) if (r.get("Sequence") or "").strip().isdigit() else None, "text": text})
    for v_ in out.values():
        v_.sort(key=lambda x: x["sequence"] or 0)
    return out


def build_row(row, judges_by_nid, cl_by_jid, mdls, workload, others, link_stats):
    nid = row["nid"].strip()
    jid = row["jid"].strip()
    name = full_name(row)
    serv = services(row)
    status, current = status_of(serv)
    last = current or (serv[-1] if serv else None)
    sitting = current is not None
    hits = judges_by_nid.get(nid, [])
    profile = hits[0] if len(hits) == 1 else None
    basis = "native_fjc_nid" if profile else ("several_records_with_nid" if hits else "no_record_with_nid")
    link_stats[basis] += 1
    cls = cl_by_jid.get(jid, [])
    cl = cls[0] if len(cls) == 1 else None
    first_commission = next((s["commission"] for s in serv if s["commission"]), None)
    end = AS_OF if sitting else next((date.fromisoformat(s["termination_date"][:10]) for s in reversed(serv) if s["termination_date"]), None)
    years = years_between(first_commission, end) if (first_commission and end) else None
    birth_year = int(row["Birth Year"]) if row["Birth Year"].strip().isdigit() else None
    death_year = int(row["Death Year"]) if row["Death Year"].strip().isdigit() else None
    my_mdls = sorted((mdls.get(nid) or {}).get("mdls") or [], key=lambda m: -m.get("pending", 0)) if sitting else []
    cur_court = current["court_id"] if current else None
    other_noms = others.get(nid, [])
    party = last["party"] if last else ""
    plabel = last["appointing_party_label"] if last else None
    gender = v(row, "Gender")
    race = v(row, "Race or Ethnicity")
    facts = [
        ["Name", name],
        ["Court" if sitting else "Last court", last["court"] if last else "Not recorded"],
        ["Status", status + (f" since {current['senior_status']}" if current and current["senior_status"] else "")],
        ["Appointing president", f"{last['president']} ({plabel})" if last and last["president"] and plabel else (last["president"] if last and last["president"] else "Not recorded")],
        ["Seat", (last or {}).get("seat_id") or "Not recorded"],
        ["Statute authorizing the seat", (last or {}).get("statute") or "Not recorded (seat not created by a recorded statute)"],
        ["ABA rating (as recorded by the FJC)", (last or {}).get("aba_rating") or "Not recorded"],
        ["Nominated", (last or {}).get("nomination") or "Not recorded"],
        ["Referred to the Judiciary Committee", (last or {}).get("committee_referral") or "Not recorded"],
        ["Hearing", (last or {}).get("hearing") or "Not recorded"],
        ["Committee action", " ".join(x for x in [(last or {}).get("committee_action"), (last or {}).get("committee_action_date")] if x) or "Not recorded"],
        ["Confirmed", " · ".join(x for x in [(last or {}).get("confirmation") or "Not recorded", (last or {}).get("vote_label")] if x)],
        ["Commissioned", (last or {}).get("commission") or "Not recorded"],
        ["Years of Article III service", str(years) if years is not None else "Not recorded"],
        ["Born", ", ".join(p for p in [str(birth_year) if birth_year else "", row["Birth City"].strip(), row["Birth State"].strip()] if p) or "Not recorded"],
        ["Died", ", ".join(p for p in [str(death_year) if death_year else "", row["Death City"].strip(), row["Death State"].strip()] if p) or "Not recorded"],
        [f"Gender ({DEMOGRAPHICS_LABEL})", gender or "Not recorded"],
        [f"Race or ethnicity ({DEMOGRAPHICS_LABEL})", race or "Not recorded"],
        ["Other nominations and recess appointments", "; ".join(o["text"] for o in other_noms) or "None recorded"],
        ["Education", "; ".join(f"{e['school']}, {e['degree'] or ''} {e['year'] or ''}".strip() for e in education(row)) or "Not recorded"],
        ["Other federal judicial service", "; ".join(x for x in (v(row, f"Other Federal Judicial Service ({i})") for i in range(1, 5)) if x) or "None recorded"],
        ["Pending MDLs as transferee judge", f"{len(my_mdls)} ({sum(m.get('pending', 0) for m in my_mdls):,} actions)" if my_mdls else "None"],
        ["FJC record", f"nid {nid}, jid {jid}"],
        ["Source", "Federal Judicial Center, Biographical Directory of Article III Federal Judges (export of 2026-10-19)"],
    ]
    short_court = (last["court"] if last else "").replace("U.S. District Court for the ", "").replace("U.S. Court of Appeals for the ", "")
    cells = {"judge": name, "court": short_court, "status": status, "appointed_by": (last or {}).get("president") or "—",
             "commissioned": ((last or {}).get("commission") or "")[:4] or "—", "aba": (last or {}).get("aba_rating") or "—",
             "mdls": str(len(my_mdls)) if my_mdls else "—"}
    badges = [b for b in [status, plabel, f"{len(my_mdls)} pending MDLs" if my_mdls else None] if b]
    links = [{"url": f"https://www.fjc.gov/node/{nid}", "label": "FJC biographical directory entry"}]
    if profile:
        links.insert(0, {"url": f"/judges/{profile}", "label": "Judge profile"})
    courts_served = sorted({s["court_id"] for s in serv if s["court_id"]})
    for cid in ([cur_court] if cur_court else []) or ([last["court_id"]] if last and last["court_id"] else []):
        links.append({"url": f"/courts/{cid}", "label": "Court profile"})
    if cl:
        links.append({"url": f"/records/cl_people/cl:people:{cl}", "label": "CourtListener person record"})
        links.append({"url": f"https://www.courtlistener.com/person/{cl}/", "label": "CourtListener person"})
    state = court_state(cur_court or (last or {}).get("court_id"))
    return {
        "dataset": DATASET, "id": nid, "category": DATASET, "state": state or "", "title": name,
        "source_url": f"https://www.fjc.gov/node/{nid}",
        "item": {
            "id": nid, "title": name, "subtitle": f"{(last or {}).get('title', '')} · {short_court} · {status}", "cells": cells,
            "badges": badges, "links": links, "kind": "judge",
            "profile": {
                "nid": nid, "jid": jid, "name": name, "birth_year": birth_year,
                "birth_place": ", ".join(p for p in [row["Birth City"].strip(), row["Birth State"].strip()] if p) or None,
                "death_year": death_year, "death_place": ", ".join(p for p in [row["Death City"].strip(), row["Death State"].strip()] if p) or None,
                "gender": gender, "race_ethnicity": race, "demographics_label": DEMOGRAPHICS_LABEL,
                "services": serv, "current_court_id": cur_court, "sitting": sitting, "status": status,
                "education": education(row), "career": v(row, "Professional Career"),
                "other_federal_service": [x for x in (v(row, f"Other Federal Judicial Service ({i})") for i in range(1, 5)) if x],
                "other_nominations": other_noms,
                "years_service": years, "years_service_basis": "first commission to 2026-10-19 (sitting) or to the last termination date",
                "age": (AS_OF.year - birth_year) if (birth_year and sitting and not death_year) else None,
                "mdls": my_mdls, "court_workload": workload.get(cur_court) if cur_court else None,
                "judge_profile_id": profile, "judge_profile_basis": basis, "cl_person_id": cl,
            },
        },
        "detail": {"id": nid, "title": name, "subtitle": f"{(last or {}).get('title', '')} · {short_court} · {status}", "facts": facts, "links": links},
        "text": " ".join(x for x in [nid, name, last["court"] if last else "", (last or {}).get("president", ""), (row["Professional Career"] or "")[:2000]] if x),
        "filters": {
            "_listing": ["yes"], "status": [status.lower().replace(" ", "_")],
            "party": [(party or "not_recorded").lower().replace(" ", "_")],
            # `court` holds the current court of sitting judges only (court pages list sitting judges from it)
            "court": [cur_court] if cur_court else [], "courts_served": courts_served,
            "sitting": ["yes" if sitting else "no"], "mdl_judge": ["yes" if my_mdls else "no"],
            "judge_profile": [profile] if profile else [], "cl_person": [cl] if cl else [], "fjc_nid": [nid],
        },
    }


def main():
    raw = FJC_CSV.read_bytes()
    fjc = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    judges_by_nid, cl_by_jid, mdls, workload = load_lookups()
    others = other_nominations()
    link_stats = Counter()
    rows = [build_row(r, judges_by_nid, cl_by_jid, mdls, workload, others, link_stats) for r in fjc]
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "duplicate nid"
    carried = sum(1 for r in rows if r["item"]["profile"]["mdls"])
    missing_mdl = sorted(set(mdls) - {r["id"] for r in rows if r["item"]["profile"]["mdls"]})
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stats = {
        "judges": len(rows), "sitting": sum(r["item"]["profile"]["sitting"] for r in rows),
        "status": dict(Counter(r["item"]["profile"]["status"] for r in rows)),
        "judge_page_links": dict(link_stats), "with_cl_person": sum(1 for r in rows if r["item"]["profile"]["cl_person_id"]),
        "with_other_nominations": sum(1 for r in rows if r["item"]["profile"]["other_nominations"]),
        "other_nomination_entries": sum(len(r["item"]["profile"]["other_nominations"]) for r in rows),
        "mdl_judges_carried": carried, "previous_mdl_judges_not_sitting_or_missing": missing_mdl,
        "senate_vote_type_first_appointment": dict(Counter((r["item"]["profile"]["services"] or [{}])[0].get("senate_vote_type") or "blank" for r in rows)),
    }
    build = {
        "dataset": DATASET, "label": "Federal judge profiles - all Article III judges (FJC Biographical Directory)",
        "listing_block": {
            "page": 1, "limit": 50,
            "columns": [{"key": "judge", "label": "Judge"}, {"key": "court", "label": "Court"}, {"key": "status", "label": "Status"},
                        {"key": "appointed_by", "label": "Appointed by"}, {"key": "commissioned", "label": "Commissioned"},
                        {"key": "aba", "label": "ABA rating"}, {"key": "mdls", "label": "Pending MDLs"}],
            "filters": [{"name": "q", "type": "search", "label": "Search"},
                        {"name": "status", "type": "select", "label": "Status", "options": [{"label": "Active", "value": "active"}, {"label": "Chief Judge", "value": "chief_judge"}, {"label": "Senior", "value": "senior"}, {"label": "Service ended", "value": "service_ended"}]},
                        {"name": "party", "type": "select", "label": "Appointing president's party", "options": [{"label": "Appointed by a Democratic president", "value": "democratic"}, {"label": "Appointed by a Republican president", "value": "republican"}]},
                        {"name": "mdl_judge", "type": "select", "label": "MDL transferee judge", "options": [{"label": "Has pending MDLs", "value": "yes"}, {"label": "No pending MDLs", "value": "no"}]}],
        },
        "summary": {
            "source": FJC_URL, "source_file": FJC_CSV_URL, "other_nominations_file": OTHER_NOMS_URL, "as_of": AS_OF.isoformat(),
            "coverage": "all 4,077 judges in the FJC Biographical Directory of Article III Federal Judges (1789 to present), sitting and former",
            "citation": "History of the Federal Judiciary. http://www.fjc.gov. Web site of the Federal Judicial Center.",
            "demographics": f"Gender and race or ethnicity are shown exactly {DEMOGRAPHICS_LABEL}; they are not used in any comparison.",
            "party_rule": "Party values are the party of the appointing president and are labelled 'Appointed by a <party> president'.",
            "vote_rule": "Senate Vote Type 'Voice' is shown as 'Voice vote'; roll calls show the FJC Ayes/Nays tally.",
            "link_rule": "Judge profile link only when exactly one corpus judges record carries the FJC nid as its native id; CourtListener person only when its fjc_id equals the FJC jid.",
            "carried_over": "Pending MDL assignments and court workload figures are carried unchanged from the previous judge_profiles_fjc publication (built from JPML reports and court_analytics).",
            "stats": stats, "built_at": built,
        },
        "rows": rows, "built_at": built,
        "inputs": [{"url": FJC_CSV_URL, "path": str(FJC_CSV.relative_to(ROOT)), "sha256": hashlib.sha256(raw).hexdigest()},
                   {"url": OTHER_NOMS_URL, "path": str(OTHER_NOMS.relative_to(ROOT)), "sha256": hashlib.sha256(OTHER_NOMS.read_bytes()).hexdigest() if OTHER_NOMS.exists() else None}],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build))
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
