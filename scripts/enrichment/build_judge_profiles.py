"""Build the top ~1,000 sitting federal judge profiles from the FJC Biographical Directory.

Inputs: private/acq/fjc/judges.csv (FJC export), corpus datasets cl_people, judges, mdl_analytics, court_analytics.
Output dataset: judge_profiles_fjc, keyed by FJC nid. Links to existing judge pages only on exact matches:
an MDL record pairing the profile with the CourtListener person, or a unique exact full name in the same state.
"""
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus_writer as cw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FJC_CSV = ROOT / "private" / "acq" / "fjc" / "judges.csv"
FJC_URL = "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export"
TODAY = date(2026, 10, 17)
LIMIT = 1000

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


def norm(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z ]", "", re.sub(r"[\s.,]+", " ", name.lower())).strip()


SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def name_tokens(name: str):
    return [t for t in norm(name).split() if t not in SUFFIXES]


def years_between(start: str, end: date = TODAY):
    if not start:
        return None
    d = date.fromisoformat(start[:10])
    return round((end - d).days / 365.25, 1)


def services(row):
    out = []
    for i in range(1, 7):
        court = row.get(f"Court Name ({i})", "").strip()
        if not court:
            continue
        vote = row.get(f"Ayes/Nays ({i})", "").strip()
        out.append({
            "court": court,
            "court_id": court_id(court),
            "court_type": row.get(f"Court Type ({i})", "").strip(),
            "title": row.get(f"Appointment Title ({i})", "").strip(),
            "president": row.get(f"Appointing President ({i})", "").strip(),
            "party": row.get(f"Party of Appointing President ({i})", "").strip(),
            "reappointing_president": row.get(f"Reappointing President ({i})", "").strip() or None,
            "aba_rating": row.get(f"ABA Rating ({i})", "").strip() or None,
            "nomination": row.get(f"Nomination Date ({i})", "").strip() or None,
            "hearing": row.get(f"Hearing Date ({i})", "").strip() or None,
            "confirmation": row.get(f"Confirmation Date ({i})", "").strip() or None,
            "vote": vote or None,
            "senate_vote_type": row.get(f"Senate Vote Type ({i})", "").strip() or None,
            "commission": row.get(f"Commission Date ({i})", "").strip() or None,
            "chief_begin": row.get(f"Service as Chief Judge, Begin ({i})", "").strip() or None,
            "chief_end": row.get(f"Service as Chief Judge, End ({i})", "").strip() or None,
            "senior_status": row.get(f"Senior Status Date ({i})", "").strip() or None,
            "termination": row.get(f"Termination ({i})", "").strip() or None,
            "termination_date": row.get(f"Termination Date ({i})", "").strip() or None,
        })
    return out


def education(row):
    out = []
    for i in range(1, 6):
        school = row.get(f"School ({i})", "").strip()
        if school:
            out.append({"school": school, "degree": row.get(f"Degree ({i})", "").strip() or None,
                        "year": row.get(f"Degree Year ({i})", "").strip() or None})
    return out


def full_name(row):
    parts = [row["First Name"], row["Middle Name"], row["Last Name"]]
    name = " ".join(p.strip() for p in parts if p and p.strip())
    if row.get("Suffix", "").strip():
        name += ", " + row["Suffix"].strip()
    return name


def main():
    fjc = list(csv.DictReader(FJC_CSV.open(encoding="utf-8-sig")))
    cl_people = cw.fetch_all("cl_people", "id,item")
    judges = cw.fetch_all("judges", "id,title,state,item")
    mdl = [r for r in cw.fetch_all("mdl_analytics", "id,item") if (r["item"] or {}).get("kind") == "mdl"]
    mdls_item = cw.fetch_all("mdls", "id,item")
    courts = {r["id"]: r["item"].get("analytics", {}) for r in cw.fetch_all("court_analytics", "id,item")}

    cl_by_fjc = {}
    for r in cl_people:
        cells = (r["item"] or {}).get("cells", {})
        if cells.get("fjc_id"):
            cl_by_fjc[str(cells["fjc_id"])] = {"cl_id": str(cells.get("native_id")), "slug": cells.get("slug")}

    profile_by_cl = {}
    for r in mdls_item:
        it = r["item"] or {}
        if it.get("judge_cl_person_id") and it.get("judge_profile_id"):
            profile_by_cl[str(it["judge_cl_person_id"])] = it["judge_profile_id"]

    judges_by_name = defaultdict(list)
    for r in judges:
        judges_by_name[(norm(r["title"] or ""), r.get("state") or "")].append(r["id"])

    mdls_by_court_surname = defaultdict(list)
    for r in mdl:
        a = r["item"]["analytics"]
        if a.get("status") != "pending" or not a.get("judge") or not a.get("district"):
            continue
        tokens = name_tokens(a["judge"])
        if not tokens:
            continue
        cid = "dcd" if a["district"] == "DC" else a["district"].lower() + "d"
        mdls_by_court_surname[(cid, tokens[-1])].append({
            "mdl": a["mdl"], "title": r["item"]["title"], "pending": a["pending"], "type": a.get("type"),
            "district": a["district"], "judge_as_printed": a["judge"], "first": tokens[0],
        })

    sitting_keys = defaultdict(int)
    court_surnames = defaultdict(int)
    for row in fjc:
        open_services = [s for s in services(row) if not s["termination"]]
        if open_services:
            surname_key = (name_tokens(row["Last Name"]) or [""])[-1]
            sitting_keys[(surname_key, (row["First Name"].strip() or "?")[0].lower())] += 1
            court_surnames[(open_services[-1]["court_id"] or "", surname_key)] += 1
    matched_mdls = set()

    candidates = []
    for row in fjc:
        serv = services(row)
        sitting = [s for s in serv if not s["termination"]]
        if not sitting:
            continue
        current = sitting[-1]
        name = full_name(row)
        surname = (name_tokens(row["Last Name"]) or [""])[-1]
        given = {t[0] for t in name_tokens(f"{row['First Name']} {row['Middle Name']}")}
        # Same court + surname is unambiguous when only one sitting judge of that court has the surname
        # (covers printed nicknames such as "Beth" for Mary Elizabeth); otherwise require a matching initial.
        unique_in_court = court_surnames[(current["court_id"] or "", surname)] == 1
        my_mdls = [
            m for m in mdls_by_court_surname.get((current["court_id"] or "", surname), [])
            if unique_in_court or m["first"][0] in given
        ]
        # Judges sitting by designation preside over MDLs outside their own court: accept only when exactly
        # one sitting judge nationally has this surname and first initial.
        first_initial = (row["First Name"].strip() or "?")[0].lower()
        if sitting_keys[(surname, first_initial)] == 1:
            for (cid, s), items in mdls_by_court_surname.items():
                if s == surname and cid != (current["court_id"] or ""):
                    my_mdls += [m for m in items if m["first"][0] == first_initial and m["mdl"] not in {x["mdl"] for x in my_mdls}]
        matched_mdls.update(m["mdl"] for m in my_mdls)
        senior = bool(current["senior_status"])
        is_district = (current["court_id"] or "").endswith("d") and current["court_id"] not in ("cadc",)
        workload = (courts.get(current["court_id"] or "", {}).get("metrics", {}).get("per_judge_weighted_filings") or [None])[-1] or 0
        tier = 0 if my_mdls else (1 if is_district and not senior else (2 if current["court_id"] in CIRCUITS.values() or current["court_id"] == "scotus" else (3 if is_district else 4)))
        candidates.append((tier, -sum(m["pending"] for m in my_mdls), -workload, name, row, serv, current, my_mdls))

    candidates.sort(key=lambda c: c[:4])
    chosen = candidates[:LIMIT]

    rows, linked, linked_by = [], 0, defaultdict(int)
    for tier, _, _, name, row, serv, current, my_mdls in chosen:
        nid = row["nid"].strip()
        cl = cl_by_fjc.get(row["jid"].strip())
        state = court_state(current["court_id"])
        profile = None
        if cl and cl["cl_id"] in profile_by_cl:
            profile, basis = profile_by_cl[cl["cl_id"]], "mdl_record_cl_person"
        else:
            hits = judges_by_name.get((norm(name), state or ""), [])
            if len(hits) == 1:
                profile, basis = hits[0], "unique_exact_name_state"
            else:
                basis = "no_unique_exact_match" if hits else "not_found"
        if profile:
            linked += 1
        linked_by[basis] += 1
        first_commission = next((s["commission"] for s in serv if s["commission"]), None)
        court_stats = courts.get(current["court_id"] or "")
        status = "Senior" if current["senior_status"] else ("Chief Judge" if current["chief_begin"] and not current["chief_end"] else "Active")
        birth_year = int(row["Birth Year"]) if row["Birth Year"].strip().isdigit() else None
        facts = [
            ["Name", name],
            ["Current court", current["court"]],
            ["Status", status + (f" since {current['senior_status']}" if current["senior_status"] else "")],
            ["Appointing president", f"{current['president']} ({current['party']})" if current["president"] else "Not recorded"],
            ["ABA rating", current["aba_rating"] or "Not recorded"],
            ["Nominated", current["nomination"] or "Not recorded"],
            ["Confirmed", (current["confirmation"] or "Not recorded") + (f" ({current['vote'].strip()})" if current["vote"] else "")],
            ["Commissioned", current["commission"] or "Not recorded"],
            ["Years of Article III service", str(years_between(first_commission)) if first_commission else "Not recorded"],
            ["Born", ", ".join(p for p in [str(birth_year) if birth_year else "", row["Birth City"].strip(), row["Birth State"].strip()] if p) or "Not recorded"],
            ["Education", "; ".join(f"{e['school']}, {e['degree'] or ''} {e['year'] or ''}".strip() for e in education(row)) or "Not recorded"],
            ["Other federal judicial service", "; ".join(row[f"Other Federal Judicial Service ({i})"].strip() for i in range(1, 5) if row[f"Other Federal Judicial Service ({i})"].strip()) or "None recorded"],
            ["Pending MDLs as transferee judge", f"{len(my_mdls)} ({sum(m['pending'] for m in my_mdls):,} actions)" if my_mdls else "None"],
            ["FJC record", f"nid {nid}, jid {row['jid'].strip()}"],
            ["Source", "Federal Judicial Center, Biographical Directory of Article III Federal Judges (export)"],
        ]
        cells = {
            "judge": name, "court": current["court"].replace("U.S. District Court for the ", "").replace("U.S. Court of Appeals for the ", ""),
            "status": status, "appointed_by": current["president"] or "—", "commissioned": (current["commission"] or "")[:4] or "—",
            "aba": current["aba_rating"] or "—", "mdls": str(len(my_mdls)) if my_mdls else "—",
        }
        badges = [b for b in [status, f"{len(my_mdls)} pending MDLs" if my_mdls else None, current["party"] or None] if b]
        links = [{"url": f"https://www.fjc.gov/node/{nid}", "label": "FJC biographical directory entry"}]
        if profile:
            links.insert(0, {"url": f"/judges/{profile}", "label": "Judge profile"})
        if current["court_id"]:
            links.append({"url": f"/courts/{current['court_id']}", "label": "Court profile"})
        if cl:
            links.append({"url": f"https://www.courtlistener.com/person/{cl['cl_id']}/{cl['slug'] or ''}/", "label": "CourtListener person"})
        rows.append(cw.record(
            "judge_profiles_fjc", nid, name, source_url=f"https://www.fjc.gov/node/{nid}",
            subtitle=f"{current['title']} · {cells['court']} · {status}", state=state or "",
            cells=cells, facts=facts, badges=badges, links=links,
            text=f"{current['court']} {current['president']} {row['Professional Career'][:2000]}",
            filters={
                "status": [status.lower().replace(" ", "_")], "party": [(current["party"] or "not_recorded").lower()],
                "court": [current["court_id"] or ""], "court_level": ["district" if tier in (0, 1, 3) and (current["court_id"] or "").endswith("d") else "appellate_or_other"],
                "mdl_judge": ["yes" if my_mdls else "no"], "judge_profile": [profile] if profile else [],
                "cl_person": [cl["cl_id"]] if cl else [],
            },
            extra={
                "kind": "judge",
                "profile": {
                    "nid": nid, "jid": row["jid"].strip(), "name": name, "birth_year": birth_year,
                    "birth_place": ", ".join(p for p in [row["Birth City"].strip(), row["Birth State"].strip()] if p) or None,
                    "gender": row["Gender"].strip() or None, "services": serv, "current_court_id": current["court_id"],
                    "status": status, "education": education(row), "career": row["Professional Career"].strip() or None,
                    "other_federal_service": [row[f"Other Federal Judicial Service ({i})"].strip() for i in range(1, 5) if row[f"Other Federal Judicial Service ({i})"].strip()],
                    "years_service": years_between(first_commission) if first_commission else None,
                    "age": (TODAY.year - birth_year) if birth_year else None,
                    "mdls": sorted(my_mdls, key=lambda m: -m["pending"]),
                    "court_workload": {k: (v or [None])[-1] for k, v in (court_stats or {}).get("metrics", {}).items()} if court_stats else None,
                    "judge_profile_id": profile, "judge_profile_basis": basis, "cl_person_id": cl["cl_id"] if cl else None,
                },
            },
        ))
    print(json.dumps({"selected": len(rows), "tiers": {t: sum(1 for c in chosen if c[0] == t) for t in range(5)},
                      "linked_to_judge_page": linked, "link_basis": linked_by,
                      "with_cl_person": sum(1 for r in rows if r["item"]["profile"]["cl_person_id"]),
                      "mdl_judges": sum(1 for r in rows if r["item"]["profile"]["mdls"])}, indent=1))
    cw.publish(
        "judge_profiles_fjc", "Federal judge profiles — top 1,000 sitting judges (FJC Biographical Directory)", rows,
        listing_block=cw.listing(
            [("judge", "Judge"), ("court", "Court"), ("status", "Status"), ("appointed_by", "Appointed by"), ("commissioned", "Commissioned"), ("aba", "ABA rating"), ("mdls", "Pending MDLs")],
            [("status", "Status", {"active": "Active", "chief_judge": "Chief Judge", "senior": "Senior"}),
             ("party", "Appointing party", {"democratic": "Democratic", "republican": "Republican"}),
             ("mdl_judge", "MDL transferee judge", {"yes": "Has pending MDLs", "no": "No pending MDLs"})],
        ),
        summary={"source": FJC_URL, "selection": "sitting Article III judges: MDL transferee judges, then active district, appellate, senior district by court workload", "limit": LIMIT},
    )


if __name__ == "__main__":
    main()
