"""Judges x districts x MDL defendants cross-analysis.

Inputs (all official or primary):
- private/acq/judges-cross/fjc_judges.csv — FJC Biographical Directory export (https://www.fjc.gov/sites/default/files/history/judges.csv)
- private/acq/judges-cross/jpml_terminated_fy2025.pdf — JPML "Multidistrict Litigations Terminated Through September 30, 2025"
- private/acq/judges-cross/financial-disclosure*.csv.bz2, people-db-people*.csv.bz2 — CourtListener bulk data
  (judicial financial disclosures as extracted by Free Law Project from the AO-released reports)
- corpus datasets judge_profiles_fjc, mdl_analytics, mdls, court_analytics, sw_matter_parties_v1, company_sec_mdl_links (optional)

Outputs: judge_cross_profiles (per judge + summary), judge_cross_districts (per district + national summary),
judge_cross_disclosure_matches (per name match + per-judge coverage + summary).

Run: cd <repo> && . private/scratch/env.sh && python3 scripts/enrichment/judges_cross/build_judges_cross.py [--dry]
"""
import bz2
import csv
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import common as c  # noqa: E402
import corpus_writer as cw  # noqa: E402
import disclosure_match as dm  # noqa: E402
from build_judge_profiles import full_name, services  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "judges-cross"
SCRATCH = ROOT / "private" / "scratch" / "judges-cross"
FJC_CSV = ACQ / "fjc_judges.csv"
FJC_URL = "https://www.fjc.gov/sites/default/files/history/judges.csv"
FJC_PAGE = "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export"
TERMINATED_PDF = ACQ / "jpml_terminated_fy2025.pdf"
TERMINATED_URL = "https://www.jpml.uscourts.gov/sites/jpml/files/JPML_Fiscal_Year_2025_Terminated_Litigations_Report_0.pdf"
JPML_PENDING_URL = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive"
CL_BULK = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/"
CL_DATE = "2026-09-30"
CL_FILES = {
    "people": f"people-db-people-{CL_DATE}.csv.bz2",
    "disclosures": f"financial-disclosures-{CL_DATE}.csv.bz2",
    "investments": f"financial-disclosure-investments-{CL_DATE}.csv.bz2",
}
REVIEW_LABEL = "Requires review — disclosure name match, not a finding"
NEAR_LABEL = "Near match — review: alias, parent, ticker or name prefix; not a finding"
DISCLOSURE_YEARS = 3
GROSS_VALUE = {
    "J": "$1–$15,000", "K": "$15,001–$50,000", "L": "$50,001–$100,000", "M": "$100,001–$250,000",
    "N": "$250,001–$500,000", "O": "$500,001–$1,000,000", "P1": "$1,000,001–$5,000,000",
    "P2": "$5,000,001–$25,000,000", "P3": "$25,000,001–$50,000,000", "P4": "More than $50,000,000",
    "-1": "Extraction failed",
}
REPORT_TYPE = {"-1": "Not recorded", "0": "Nomination", "1": "Initial", "2": "Annual", "3": "Final"}
TENURE_BUCKETS = [(0, 5, "Under 5 yrs"), (5, 10, "5–10 yrs"), (10, 15, "10–15 yrs"), (15, 20, "15–20 yrs"),
                  (20, 30, "20–30 yrs"), (30, 200, "30+ yrs")]

# Companies named verbatim in the JPML caption of a pending products-liability MDL. Only names that identify a
# company (not a product or drug) are listed; build() asserts each one is a literal substring of the caption.
CAPTION_COMPANIES = {
    2738: ["Johnson & Johnson"], 3015: ["Johnson & Johnson"],
    2846: ["Davol, Inc.", "C.R. Bard, Inc."], 3081: ["Bard"],
    2570: ["Cook Medical, Inc."], 3029: ["Covidien"], 3044: ["Exactech"], 2921: ["Allergan"],
    3026: ["Abbott Laboratories"], 3037: ["Abbott"], 3014: ["Philips"],
    3125: ["AngioDynamics, Inc.", "Navilyst Medical, Inc."], 3087: ["Future Motion, Inc."],
    2814: ["Ford Motor Co."], 2672: ["Volkswagen"], 2197: ["DePuy Orthopaedics, Inc."],
    2753: ["Atrium Medical Corp."], 3052: ["Kia", "Hyundai"], 2599: ["Takata"], 2768: ["Stryker"], 2441: ["Stryker"],
    3181: ["Boston Scientific Corporation"], 2905: ["ZF-TRW"], 3178: ["ByHeart, Inc."], 2913: ["Juul Labs, Inc."],
    3078: ["Generac"], 2151: ["Toyota Motor Corp."], 2885: ["3M"], 2859: ["Zimmer"], 2782: ["Ethicon"],
    2816: ["Sorin"],
}


def fmt(n):
    return "Not recorded" if n is None else (f"{n:,}" if isinstance(n, int) else str(n))


def read_bz2_csv(name):
    with bz2.open(ACQ / name, "rt", encoding="utf-8", newline="") as handle:
        # The bulk files are PostgreSQL CSV exports in which quotes inside a field are backslash-escaped.
        yield from csv.DictReader(handle, escapechar="\\", doublequote=True)


# --------------------------------------------------------------------------------------------- FJC bench

def load_fjc():
    rows = list(csv.DictReader(FJC_CSV.open(encoding="utf-8-sig")))
    people = []
    for row in rows:
        serv = services(row)
        first_commission = next((s["commission"] for s in serv if s["commission"]), None)
        sitting = [s for s in serv if not s["termination"]]
        current = sitting[-1] if sitting else None
        status = None
        if current:
            status = "Senior" if current["senior_status"] else ("Chief Judge" if current["chief_begin"] and not current["chief_end"] else "Active")
        people.append({
            "nid": row["nid"].strip(), "jid": row["jid"].strip(), "name": full_name(row),
            "first": row["First Name"].strip(), "middle": row["Middle Name"].strip(),
            "surname": c.name_tokens(row["Last Name"]), "suffix": c.suffix_key(row.get("Suffix", "")), "services": serv, "current": current, "status": status,
            "first_commission": first_commission, "gender": row["Gender"].strip() or None,
        })
    return people


# ----------------------------------------------------------------------------------- JPML terminated report

def load_terminated():
    text = subprocess.run(["pdftotext", "-layout", str(TERMINATED_PDF), "-"], capture_output=True, text=True, check=True).stdout
    rows, headers, unparsed, printed_total = c.parse_terminated_text(text)
    per_header = Counter(r["district_code"] for r in rows)
    coverage = [{"code": h["code"], "name": h["name"].title().replace(" Of ", " of "), "court_id": h["court_id"], "printed": h["printed"],
                 "parsed": per_header.get(h["code"], 0)} for h in headers]
    return rows, coverage, {"lines": unparsed, "printed_total": printed_total}


def match_history(rows, people):
    """Match terminated-MDL transferee judges to FJC people.

    Candidates: FJC judges commissioned to the row's district court (or the printed court hint) no later than the
    termination year, with the same surname and a compatible generational suffix. A match needs exactly one candidate
    whose given names/initials all agree ("strict"); failing that, exactly one candidate whose first given name or
    initial agrees ("first_initial" — FJC records a different or no middle name). Anything else stays unmatched.
    """
    by_court = defaultdict(list)
    for p in people:
        for s in p["services"]:
            cid = c.district_court_id(s["court"])
            if cid and s["commission"]:
                by_court[cid].append((p, int(s["commission"][:4])))
    matched, status = defaultdict(list), Counter()
    for row in rows:
        if not row.get("judge_printed", True):
            # No judge printed (e.g. MDL 2641): nothing is attached without separate documented evidence.
            status["judge_not_printed"] += 1
            continue
        judges = c.parse_jpml_judges(row["transferee_judge"])
        if not judges:
            status["unparsed_name"] += 1
            continue
        for j in judges:
            if j["court"] == "circuit":
                status["circuit_judge_by_designation"] += 1
                continue
            court = j["court"] or row["court_id"]
            pool = {p["nid"]: p for p, year in by_court.get(court, [])
                    if p["surname"] == j["surname"] and year <= row["termination_year"] and (not j["suffix"] or j["suffix"] == p["suffix"])}
            strict = [p for p in pool.values() if c.given_consistent(j["given"], p["first"], p["middle"])]
            loose = [p for p in pool.values() if c.first_initial_consistent(j["given"], p["first"], p["middle"])]
            if len(strict) == 1:
                hit, basis = strict[0], "strict"
            elif not strict and len(loose) == 1:
                hit, basis = loose[0], "first_initial"
            else:
                status["ambiguous" if (strict or loose) else "no_candidate"] += 1
                continue
            matched[hit["nid"]].append({**row, "match_basis": basis, "judge_as_printed": row["transferee_judge"], "shared": len(judges) > 1})
            status[f"matched_{basis}"] += 1
    return matched, status


def match_exits(mdls, terminated_numbers, people):
    """MDLs that left the JPML pending report after the terminated report's cut-off (2025-09-30) appear in neither
    report. Recover them from the monthly pending series (last listing, closing date from the JPML recently-
    terminated list) and match the judge as printed there with the same court + surname + given-name rules."""
    by_court = defaultdict(list)
    for p in people:
        for s in p["services"]:
            cid = c.district_court_id(s["court"])
            if cid and s["commission"]:
                by_court[cid].append((p, int(s["commission"][:4])))
    matched, status, rows = defaultdict(list), Counter(), []
    for m in mdls.values():
        if m.get("status") == "pending" or m["mdl"] in terminated_numbers:
            continue
        closed = m.get("date_closed")
        if closed and closed <= "2025-09-30":
            continue
        court = c.pending_district_court_id(m.get("district"))
        year = int((closed or m["as_of"])[:4])
        row = {"mdl": m["mdl"], "caption": m["title"], "district_name": m.get("district") or "", "court_id": court,
               "termination_year": year, "actions_total": m.get("total"), "date_closed": closed, "last_listed": m["as_of"],
               "status": m.get("status"), "transferee_judge": m.get("judge") or "", "source": "jpml_pending_exit"}
        rows.append(row)
        parsed = c.parse_pending_judge(m.get("judge") or "")
        if not parsed or not court:
            status["exit_unparsed"] += 1
            continue
        pool = {}
        for p, start in by_court.get(court, []):
            given = c.pending_name_split(parsed, p["surname"])
            if given is not None and start <= year and (not parsed["suffix"] or parsed["suffix"] == p["suffix"]):
                pool[p["nid"]] = (p, given)
        strict = [p for p, g in pool.values() if c.given_consistent(g, p["first"], p["middle"])]
        loose = [p for p, g in pool.values() if c.first_initial_consistent(g, p["first"], p["middle"])]
        if len(strict) == 1:
            hit, basis = strict[0], "strict"
        elif not strict and len(loose) == 1:
            hit, basis = loose[0], "first_initial"
        else:
            status["exit_ambiguous" if (strict or loose) else "exit_no_candidate"] += 1
            continue
        matched[hit["nid"]].append({**row, "match_basis": basis, "judge_as_printed": row["transferee_judge"], "shared": False})
        status[f"exit_matched_{basis}"] += 1
    return matched, status, rows


# --------------------------------------------------------------------------------------- CourtListener

def load_cl_people():
    by_fjc, people = {}, {}
    for row in read_bz2_csv(CL_FILES["people"]):
        people[row["id"]] = row
        if row["fjc_id"]:
            by_fjc.setdefault(row["fjc_id"], []).append(row["id"])
    return by_fjc, people


def load_disclosures(person_ids):
    by_person = defaultdict(list)
    for row in read_bz2_csv(CL_FILES["disclosures"]):
        if row["person_id"] in person_ids:
            by_person[row["person_id"]].append(row)
    return by_person


def load_investments(disclosure_ids):
    by_fd = defaultdict(list)
    for row in read_bz2_csv(CL_FILES["investments"]):
        if row["financial_disclosure_id"] in disclosure_ids:
            by_fd[row["financial_disclosure_id"]].append(row)
    for rows in by_fd.values():
        rows.sort(key=lambda r: int(r["id"]))
    return by_fd


def resolve_cl_person(person, pending_mdls, cl_by_fjc, cl_people, docket_people):
    """CourtListener person id for an FJC judge.

    1. CourtListener people bulk row whose fjc_id equals the FJC jid (exactly one), following is_alias_of.
    2. Otherwise the CourtListener assigned_to person of the judge's MDL master dockets (mdls dataset), only when all
       of them agree and that person's last name equals the FJC surname.
    Conflicting ids resolve to None.
    """
    def canonical(pid):
        row = cl_people.get(pid)
        return row["is_alias_of_id"] if row and row.get("is_alias_of_id") else pid

    crosswalk = cl_by_fjc.get(person["jid"], [])
    fjc_id = canonical(crosswalk[0]) if len(crosswalk) == 1 else None
    docket_ids = {canonical(docket_people[m["mdl"]]) for m in pending_mdls if m["mdl"] in docket_people}
    if fjc_id and docket_ids and docket_ids != {fjc_id}:
        return None, "conflicting_ids"
    if fjc_id:
        return fjc_id, "courtlistener_fjc_id"
    if len(docket_ids) == 1:
        pid = next(iter(docket_ids))
        row = cl_people.get(pid)
        if row and c.name_tokens(row["name_last"]) == person["surname"]:
            return pid, "courtlistener_docket_assigned_to"
    return None, "not_found"


# ------------------------------------------------------------------------------------------------ build

def mdl_rows():
    out = {}
    for r in cw.fetch_all("mdl_analytics", "id,title,item"):
        it = r["item"] or {}
        if it.get("kind") == "mdl":
            out[it["analytics"]["mdl"]] = {**it["analytics"], "title": r["title"]}
    return out


def party_evidence():
    """Defendants listed on master dockets (CourtListener RECAP party lists stored in sw_matter_parties_v1)."""
    out = defaultdict(list)
    for r in cw.fetch_all("sw_matter_parties_v1", "id,source_url,item"):
        cells = (r["item"] or {}).get("cells", {})
        if cells.get("kind") != "party" or "Defendant" not in (cells.get("party_types") or ""):
            continue
        name = (cells.get("party_name") or "").strip()
        if not name or cells.get("name_withheld"):
            continue
        try:
            mdl = int(cells.get("mdl"))
        except (TypeError, ValueError):
            continue
        out[mdl].append({"company": name, "kind": "docket_party", "label": "Defendant on the MDL master docket (CourtListener RECAP party list)",
                         "url": r.get("source_url") or "", "detail": f"{cells.get('docket_number')} ({cells.get('court_id')}) · party types: {cells.get('party_types')}"})
    return out


def sec_evidence():
    """Company <-> MDL links from the SEC lane, used only when each row carries explicit filing evidence."""
    try:
        rows = cw.fetch_all("company_sec_mdl_links", "id,source_url,item")
    except Exception as error:  # dataset not published yet
        print(json.dumps({"company_sec_mdl_links": f"unavailable: {str(error)[:120]}"}))
        return defaultdict(list), False
    out = defaultdict(list)
    for r in rows:
        it = r["item"] or {}
        link = it.get("link") or {}
        name = (it.get("cells") or {}).get("company")
        # Explicit evidence only: the filing cites the MDL number or official caption (tiers A/B) and the excerpt
        # describes claims against the company. Subject-only (tier C) and unclear-role links are not used.
        if link.get("tier") not in ("A", "B") or link.get("role") != "defendant" or not name:
            continue
        try:
            mdl = int(link.get("mdl"))
        except (TypeError, ValueError):
            continue
        latest = (link.get("verified") or [{}])[-1]
        out[mdl].append({"company": str(name), "kind": "sec_filing",
                         "label": f"Company's own SEC filing: {link.get('tier_label') or 'cites the MDL'}; excerpt describes claims against the company",
                         "url": latest.get("url") or r.get("source_url") or "", "cik": str(link.get("cik") or "") or None,
                         "detail": f"{latest.get('form', '')} filed {latest.get('file_date', '')} · accession {latest.get('adsh', '')}".strip()})
    return out, bool(rows)


def build(dry=False):
    people = load_fjc()
    by_nid = {p["nid"]: p for p in people}
    profiles = {r["id"]: r["item"] for r in cw.fetch_all("judge_profiles_fjc", "id,item")}
    judges_photos = {}
    for r in cw.fetch_all("judges", "id,item"):
        photo = ((r["item"] or {}).get("photo_url") or "").strip()
        if photo:
            judges_photos[r["id"]] = photo
    mdls = mdl_rows()
    pending = {k: v for k, v in mdls.items() if v.get("status") == "pending"}
    total_pending_actions = sum(v["pending"] for v in pending.values())
    as_of = max(v["as_of"] for v in pending.values())
    courts = {r["id"]: (r["item"] or {}).get("analytics", {}) for r in cw.fetch_all("court_analytics", "id,item")}
    terminated, coverage, unparsed = load_terminated()
    history, history_status = match_history(terminated, people)
    exits, exit_status, exit_rows = match_exits(mdls, {r["mdl"] for r in terminated}, people)
    for nid, items in exits.items():
        history[nid].extend(items)
    history_status.update(exit_status)

    # ---------------------------------------------------------------------------------- per-judge records
    judge_pending = {}
    for nid, item in profiles.items():
        mlist = []
        for m in item["profile"].get("mdls", []):
            a = pending.get(m["mdl"])
            if not a:
                continue
            mlist.append({"mdl": a["mdl"], "title": a["title"], "type": a.get("type"), "mass_tort": a.get("mass_tort"),
                          "pending": a["pending"], "total": a["total"], "change_12m": a.get("change_12m"),
                          "date_transferred": a.get("date_transferred"), "district": a.get("district"), "judge_as_printed": a.get("judge")})
        judge_pending[nid] = sorted(mlist, key=lambda m: -m["pending"])
    assigned = {m["mdl"] for v in judge_pending.values() for m in v}
    unassigned = [{"mdl": a["mdl"], "title": a["title"], "judge": a.get("judge"), "district": a.get("district"), "pending": a["pending"]}
                  for a in pending.values() if a["mdl"] not in assigned]

    cl_by_fjc, cl_people = load_cl_people()
    docket_people = {}
    for r in cw.fetch_all("mdls", "id,item"):
        it = r["item"] or {}
        if it.get("judge_cl_person_id") and isinstance(it.get("mdl_number"), int):
            docket_people[it["mdl_number"]] = str(it["judge_cl_person_id"])
    sitting_nids = {p["nid"] for p in people if p["current"]}
    judge_nids = sorted({n for n, v in judge_pending.items() if v} | {n for n in history if n in sitting_nids})
    records = []
    for nid in judge_nids:
        p = by_nid.get(nid)
        if not p or not p["current"]:
            continue
        cur = p["current"]
        prof = (profiles.get(nid) or {}).get("profile") or {}
        pend = judge_pending.get(nid, [])
        # An MDL still listed in the pending report (e.g. a few remaining actions) may also appear in the terminated
        # report; it is counted once, as pending, so its actions are not added twice.
        pending_numbers = {m["mdl"] for m in pend}
        also_pending = sorted({h["mdl"] for h in history.get(nid, []) if h["mdl"] in pending_numbers})
        hist = sorted((h for h in history.get(nid, []) if h["mdl"] not in pending_numbers), key=lambda h: (-h["termination_year"], str(h["mdl"])))
        hist_out = []
        for h in hist:
            exit_row = h.get("source") == "jpml_pending_exit"
            hist_out.append({
                "mdl": h["mdl"], "caption": h["caption"], "district": h["district_name"], "court_id": h["court_id"],
                "year": h["termination_year"],
                "transferred": None if exit_row else h["actions_transferred"], "filed": None if exit_row else h["actions_filed_in_transferee"],
                "closed": None if exit_row else h["actions_closed"], "remanded": None if exit_row else h["actions_remanded"],
                "actions": (h.get("actions_total") or 0) if exit_row else h["actions_transferred"] + h["actions_filed_in_transferee"],
                "source": "jpml_pending_exit" if exit_row else "jpml_terminated_fy2025",
                "date_closed": h.get("date_closed"), "last_listed": h.get("last_listed"),
                "judge_as_printed": h["judge_as_printed"], "shared": h["shared"], "basis": h["match_basis"],
            })
        pending_actions = sum(m["pending"] for m in pend)
        pending_total = sum(m["total"] for m in pend)
        hist_actions = sum(h["actions"] for h in hist_out)
        cl_id, cl_basis = resolve_cl_person(p, pend, cl_by_fjc, cl_people, docket_people)
        court_id = c.district_court_id(cur["court"]) or prof.get("current_court_id")
        rec = {
            "nid": nid, "jid": p["jid"], "name": p["name"], "court": cur["court"], "court_id": court_id,
            "state": c.court_state(court_id) if court_id else None, "circuit": c.court_circuit(court_id) if court_id else None,
            "status": p["status"], "senior": bool(cur["senior_status"]), "senior_since": cur["senior_status"],
            "president": cur["president"] or None, "party": cur["party"] or None,
            "first_commission": p["first_commission"], "court_commission": cur["commission"],
            "years_since_commission": c.years_between(p["first_commission"]),
            "pending_mdls": pend, "pending_mdl_count": len(pend), "pending_actions": pending_actions,
            "pending_total_actions": pending_total,
            "pending_share_pct": round(100 * pending_actions / total_pending_actions, 2) if total_pending_actions else None,
            "products_liability_mdls": sum(1 for m in pend if m["type"] == "Products Liability"),
            "historical_mdls": hist_out, "historical_mdl_count": len(hist_out), "historical_actions": hist_actions,
            "terminated_report_also_pending": also_pending,
            "total_mdls": len(pend) + len(hist_out), "total_actions_handled": pending_total + hist_actions,
            "judge_profile_id": prof.get("judge_profile_id"), "in_fjc_profiles": nid in profiles,
            "cl_person_id": cl_id, "cl_person_basis": cl_basis,
            "cl_slug": cl_people[cl_id]["slug"] if cl_id and cl_id in cl_people else None,
            "photo": judges_photos.get(prof.get("judge_profile_id") or ""),
        }
        records.append(rec)
    ranked = sorted(records, key=lambda r: (-r["pending_actions"], -r["total_mdls"], r["name"]))
    for i, r in enumerate(ranked):
        r["rank_pending_actions"] = i + 1 if r["pending_actions"] else None

    # ---------------------------------------------------------------------------------- disclosures
    disclosure = build_disclosures(records, pending, cl_people)

    # ---------------------------------------------------------------------------------- districts
    districts = build_districts(people, pending, terminated, courts, records, as_of)

    return {
        "as_of": as_of, "records": records, "unassigned": unassigned, "history_status": history_status,
        "coverage": coverage, "unparsed": unparsed, "terminated_rows": len(terminated), "disclosure": disclosure,
        "districts": districts, "total_pending_actions": total_pending_actions, "pending_mdls": len(pending),
        "terminated_judge_not_printed": [{"mdl": r["mdl"], "caption": r["caption"], "district": r["district_name"], "year": r["termination_year"]}
                                         for r in terminated if not r.get("judge_printed", True)],
        "exits": [{k: r[k] for k in ("mdl", "caption", "district_name", "date_closed", "last_listed", "transferee_judge", "actions_total")} for r in exit_rows],
    }


def build_disclosures(records, pending, cl_people):
    sec, sec_present = sec_evidence()
    parties = party_evidence()
    by_ticker, tickers_by_cik = dm.load_sec_tickers(ACQ / "sec_company_tickers.json")
    aliases = dm.resolve_aliases(by_ticker)
    targets = [r for r in records if r["products_liability_mdls"]]
    person_ids = {r["cl_person_id"] for r in targets if r["cl_person_id"]}
    fds = load_disclosures(person_ids)
    selected = {}
    for pid, rows in fds.items():
        years = sorted({int(r["year"]) for r in rows if r["year"].isdigit()}, reverse=True)[:DISCLOSURE_YEARS]
        selected[pid] = [r for r in rows if r["year"].isdigit() and int(r["year"]) in years]
    investments = load_investments({r["id"] for rows in selected.values() for r in rows})

    matches, coverage = [], []
    for r in targets:
        pl_mdls = [m for m in r["pending_mdls"] if m["type"] == "Products Liability"]
        companies, excluded = [], Counter()
        for m in pl_mdls:
            caption = pending[m["mdl"]]["title"]
            for name in CAPTION_COMPANIES.get(m["mdl"], []):
                assert name in caption, (m["mdl"], name)
                companies.append({"mdl": m["mdl"], "company": name, "kind": "caption", "label": "Named in the JPML MDL caption",
                                  "url": JPML_PENDING_URL, "detail": caption, "cik": None})
            for e in parties.get(m["mdl"], []):
                reason = dm.non_company_reason(e["company"])
                if reason:
                    excluded[reason] += 1
                else:
                    companies.append({"mdl": m["mdl"], "cik": None, **e})
            companies += [{"mdl": m["mdl"], **e} for e in sec.get(m["mdl"], [])]
        keyed = defaultdict(list)
        for comp in companies:
            key = c.company_key(comp["company"])
            if len(key) >= 2:
                keyed[key].append(comp)
        pid = r["cl_person_id"]
        all_years = sorted({int(x["year"]) for x in fds.get(pid, []) if x["year"].isdigit()}) if pid else []
        sel = selected.get(pid, []) if pid else []
        lines = 0
        judge_matches = []
        for fd in sorted(sel, key=lambda x: (-int(x["year"]), int(x["id"]))):
            rows = investments.get(fd["id"], [])
            lines += len(rows)
            pdf = ("https://storage.courtlistener.com/" + fd["filepath"]) if fd["filepath"] else fd["download_filepath"]
            for ordinal, inv in enumerate(rows, 1):
                key = c.company_key(inv["description"])
                if not key:
                    continue
                seen = set()
                for party_key, comps in keyed.items():
                    for comp in comps:
                        sec_tickers = {t.lower() for t in tickers_by_cik.get(comp.get("cik") or "", []) if len(t) >= 2}
                        hit = dm.classify(key, party_key, int(fd["year"]), aliases, sec_tickers)
                        if not hit or (comp["mdl"], comp["company"]) in seen:
                            continue
                        seen.add((comp["mdl"], comp["company"]))
                        tier, rule = hit
                        judge_matches.append({
                            "nid": r["nid"], "judge": r["name"], "judge_profile_id": r["judge_profile_id"], "cl_person_id": pid,
                            "mdl": comp["mdl"], "mdl_title": pending[comp["mdl"]]["title"], "company": comp["company"],
                            "company_key": party_key, "investment_key": key, "tier": tier, "rule": rule,
                            "evidence_kind": comp["kind"], "evidence_label": comp["label"],
                            "evidence_url": comp["url"], "evidence_detail": comp["detail"],
                            "investment": inv["description"], "investment_id": inv["id"], "line": ordinal,
                            "lines_in_report": len(rows), "page": int(inv["page_number"]) if inv["page_number"].isdigit() else None,
                            "year": int(fd["year"]), "disclosure_id": fd["id"], "report_type": REPORT_TYPE.get(fd["report_type"], "Not recorded"),
                            "amended": fd["is_amended"] == "t", "disclosure_url": pdf,
                            "gross_value_code": inv["gross_value_code"] or None, "gross_value": GROSS_VALUE.get(inv["gross_value_code"]),
                            "income_type": inv["income_during_reporting_period_type"] or None,
                            "transaction": inv["transaction_during_reporting_period"] or None,
                            "redacted": inv["redacted"] == "t",
                            "label": REVIEW_LABEL if tier == "match" else NEAR_LABEL,
                        })
        if not pid:
            status = "no_courtlistener_person"
        elif not all_years:
            status = "no_disclosures"
        elif not lines:
            status = "no_extracted_investments"
        else:
            status = "checked"
        coverage.append({
            "nid": r["nid"], "judge": r["name"], "judge_profile_id": r["judge_profile_id"], "cl_person_id": pid,
            "cl_slug": r["cl_slug"], "cl_person_basis": r["cl_person_basis"], "status": status, "years_available": all_years,
            "years_checked": sorted({int(x["year"]) for x in sel}), "reports_checked": len(sel), "lines_checked": lines,
            "mdls": [{"mdl": m["mdl"], "title": m["title"], "transferred": m.get("date_transferred"),
                      # The MDL was created after the judge's latest available report, so no report can show holdings
                      # while the judge presided over it.
                      "after_latest_report": (m.get("date_transferred") or "") > f"{all_years[-1]}-12-31" if all_years and m.get("date_transferred") else None}
                     for m in pl_mdls],
            "companies_checked": sorted({comp["company"] for comp in companies}),
            "companies_by_source": dict(Counter(comp["kind"] for comp in companies)),
            "parties_not_compared": dict(excluded),
            "matches": sum(1 for x in judge_matches if x["tier"] == "match"),
            "near_matches": sum(1 for x in judge_matches if x["tier"] == "near_match"),
            "latest_report_year": all_years[-1] if all_years else None,
            "reports": [{"id": x["id"], "year": int(x["year"]), "url": ("https://storage.courtlistener.com/" + x["filepath"]) if x["filepath"] else x["download_filepath"],
                         "lines": len(investments.get(x["id"], [])), "amended": x["is_amended"] == "t"} for x in sorted(sel, key=lambda x: -int(x["year"]))],
        })
        matches += judge_matches
    return {"matches": matches, "coverage": coverage, "sec_present": sec_present,
            "party_mdls": sorted(parties), "sec_mdls": sorted(sec)}


def build_districts(people, pending, terminated, courts, records, as_of):
    bench = defaultdict(list)
    for p in people:
        cur = p["current"]
        if not cur:
            continue
        cid = c.district_court_id(cur["court"])
        if cid:
            bench[cid].append(p)
    mdl_by_court = defaultdict(list)
    for a in pending.values():
        cid = c.pending_district_court_id(a.get("district"))
        if cid:
            mdl_by_court[cid].append(a)
    term_by_court = defaultdict(list)
    for t in terminated:
        if t["court_id"]:
            term_by_court[t["court_id"]].append(t)
    rec_by_nid = {r["nid"]: r for r in records}
    out = []
    for cid in sorted(set(bench) | set(mdl_by_court)):
        judges = bench.get(cid, [])
        active = [p for p in judges if p["status"] in ("Active", "Chief Judge")]
        senior = [p for p in judges if p["status"] == "Senior"]
        parties_active = Counter(p["current"]["party"] or "Not recorded" for p in active)
        parties_all = Counter(p["current"]["party"] or "Not recorded" for p in judges)
        years_active = [c.years_between(p["first_commission"]) for p in active]
        years_all = [c.years_between(p["first_commission"]) for p in judges]
        tenure = Counter()
        for y in years_all:
            if y is None:
                continue
            for lo, hi, label in TENURE_BUCKETS:
                if lo <= y < hi:
                    tenure[label] += 1
        presidents = Counter(p["current"]["president"] or "Not recorded" for p in judges)
        mdl_list = sorted(mdl_by_court.get(cid, []), key=lambda a: -a["pending"])
        by_judge = defaultdict(int)
        for a in mdl_list:
            by_judge[a.get("judge") or "Not recorded"] += a["pending"]
        pending_actions = sum(a["pending"] for a in mdl_list)
        top_judge = max(by_judge.items(), key=lambda kv: kv[1]) if by_judge else None
        term = term_by_court.get(cid, [])
        workload = courts.get(cid, {}).get("metrics", {}) if courts.get(cid) else {}
        judgeships = (workload.get("judgeships") or [None])[-1] if isinstance(workload.get("judgeships"), list) else None
        out.append({
            "court_id": cid, "state": c.court_state(cid), "circuit": c.court_circuit(cid),
            "sitting": len(judges), "active": len(active), "senior": len(senior),
            "chief": next((p["name"] for p in judges if p["status"] == "Chief Judge"), None),
            "party_active": dict(parties_active), "party_all": dict(parties_all),
            "median_years_active": c.median(years_active), "median_years_all": c.median(years_all),
            "tenure": {label: tenure.get(label, 0) for _, _, label in TENURE_BUCKETS},
            "presidents": dict(presidents.most_common()),
            "judgeships": judgeships,
            "pending_mdls": len(mdl_list), "pending_actions": pending_actions,
            "mass_tort_mdls": sum(1 for a in mdl_list if a.get("mass_tort")),
            "products_liability_mdls": sum(1 for a in mdl_list if a.get("type") == "Products Liability"),
            "mdl_judges": len(by_judge), "top_judge": top_judge[0] if top_judge else None,
            "top_judge_share_pct": round(100 * top_judge[1] / pending_actions, 1) if top_judge and pending_actions else None,
            "hhi_by_judge": c.hhi(list(by_judge.values())),
            "mdls": [{"mdl": a["mdl"], "title": a["title"], "judge": a.get("judge"), "type": a.get("type"), "pending": a["pending"]} for a in mdl_list],
            "terminated_mdls": len(term), "terminated_actions": sum(t["actions_closed"] + (t["actions_remanded"] or 0) for t in term),
            "judges": sorted([
                {"nid": p["nid"], "name": p["name"], "status": p["status"], "party": p["current"]["party"] or None,
                 "president": p["current"]["president"] or None, "years": c.years_between(p["first_commission"]),
                 "pending_mdls": (rec_by_nid.get(p["nid"]) or {}).get("pending_mdl_count", 0),
                 "historical_mdls": (rec_by_nid.get(p["nid"]) or {}).get("historical_mdl_count", 0)}
                for p in judges], key=lambda j: (j["status"] == "Senior", -(j["years"] or 0))),
        })
    return out


# ---------------------------------------------------------------------------------------------- publish

def court_name(cid):
    if cid == "dcd":
        return "District of Columbia"
    state = c.court_state(cid)
    if not state:
        return cid
    direction = {v: k for k, v in c.DIRECTIONS.items()}
    code = c.STATES[state]
    rest = cid[len(code):]
    if len(rest) == 2 and rest[0] in direction:
        return f"{direction[rest[0]]} District of {state}"
    return f"District of {state}"


def publish(result, dry=False):
    as_of = result["as_of"]
    records = result["records"]
    rows = []
    for r in records:
        links = [{"url": f"https://www.fjc.gov/node/{r['nid']}", "label": "FJC biographical directory entry"}]
        if r["judge_profile_id"]:
            links.insert(0, {"url": f"/judges/{r['judge_profile_id']}", "label": "Judge profile"})
        if r["court_id"]:
            links.append({"url": f"/courts/{r['court_id']}", "label": "Court profile"})
        if r["cl_person_id"]:
            links.append({"url": f"https://www.courtlistener.com/person/{r['cl_person_id']}/{r['cl_slug'] or ''}/", "label": "CourtListener person"})
        links.append({"url": JPML_PENDING_URL, "label": "JPML pending MDL reports"})
        links.append({"url": TERMINATED_URL, "label": "JPML terminated MDLs through FY2025"})
        facts = [
            ["Judge", r["name"]], ["Court", r["court"]], ["Status", r["status"] + (f" since {r['senior_since']}" if r["senior_since"] else "")],
            ["Appointing president (FJC)", f"{r['president']} ({r['party']})" if r["president"] else "Not recorded"],
            ["First Article III commission", r["first_commission"] or "Not recorded"],
            ["Years since first commission", fmt(r["years_since_commission"])],
            ["Pending MDLs (JPML, as of " + as_of + ")", str(r["pending_mdl_count"])],
            ["Actions pending in those MDLs", fmt(r["pending_actions"])],
            ["Share of all pending MDL actions", f"{r['pending_share_pct']}%" if r["pending_share_pct"] is not None else "Not applicable"],
            ["Terminated MDLs matched (JPML terminated report through FY2025, plus MDLs that left the pending report after 2025-09-30)", str(r["historical_mdl_count"])],
            ["Actions in terminated MDLs (transferred + filed; last printed total for later closures)", fmt(r["historical_actions"])],
            ["Total actions handled", fmt(r["total_actions_handled"])],
            ["Method", "Pending MDLs from judge_profiles_fjc; terminated MDLs matched on court, surname and initials, unique in the FJC directory"],
        ]
        rows.append(cw.record(
            "judge_cross_profiles", r["nid"], r["name"], source_url=f"https://www.fjc.gov/node/{r['nid']}",
            subtitle=f"{court_name(r['court_id']) if r['court_id'] else r['court']} · {r['status']} · {r['pending_mdl_count']} pending / {r['historical_mdl_count']} terminated MDLs",
            state=r["state"] or "",
            cells={"judge": r["name"], "court": court_name(r["court_id"]) if r["court_id"] else r["court"], "status": r["status"],
                   "party": r["party"] or "Not recorded", "years": fmt(r["years_since_commission"]), "pending_mdls": str(r["pending_mdl_count"]),
                   "pending_actions": fmt(r["pending_actions"]), "historical_mdls": str(r["historical_mdl_count"])},
            facts=facts, links=links,
            badges=[b for b in [r["status"], f"{r['pending_mdl_count']} pending MDLs" if r["pending_mdl_count"] else None,
                                 f"{r['historical_mdl_count']} terminated MDLs" if r["historical_mdl_count"] else None] if b],
            text=" ".join([r["court"], r["president"] or "", " ".join(m["title"] for m in r["pending_mdls"])]),
            filters={"status": [r["status"].lower().replace(" ", "_")], "party": [(r["party"] or "not_recorded").lower()],
                     "court": [r["court_id"] or ""], "judge_profile": [r["judge_profile_id"]] if r["judge_profile_id"] else [],
                     "pending_mdl": ["yes" if r["pending_mdl_count"] else "no"], "circuit": [str(r["circuit"])] if r["circuit"] is not None else []},
            extra={"kind": "judge", "cross": {**r, "as_of": as_of}},
        ))
    scatter = [{k: r[k] for k in ("nid", "name", "court_id", "state", "circuit", "status", "party", "president", "years_since_commission",
                                   "pending_mdl_count", "pending_actions", "historical_mdl_count", "historical_actions", "total_actions_handled",
                                   "pending_share_pct", "judge_profile_id", "photo", "rank_pending_actions", "products_liability_mdls")}
               | {"top_mdl": r["pending_mdls"][0]["title"] if r["pending_mdls"] else None}
               for r in records]
    with_pending = [r for r in records if r["pending_mdl_count"]]
    top10 = sorted(with_pending, key=lambda r: -r["pending_actions"])[:10]
    summary = {
        "as_of": as_of, "pending_mdls": result["pending_mdls"], "pending_actions": result["total_pending_actions"],
        "judges": len(records), "judges_with_pending": len(with_pending),
        "judges_with_history_only": sum(1 for r in records if not r["pending_mdl_count"]),
        "judges_multi_pending": sum(1 for r in with_pending if r["pending_mdl_count"] > 1),
        "top10_judge_share_pct": round(100 * sum(r["pending_actions"] for r in top10) / result["total_pending_actions"], 1),
        "hhi_by_judge": c.hhi([r["pending_actions"] for r in with_pending]),
        "median_years_pending_judges": c.median([r["years_since_commission"] for r in with_pending]),
        "unassigned_pending": result["unassigned"],
        "history": {"rows": result["terminated_rows"], "status": dict(result["history_status"]), "districts": result["coverage"],
                    "unparsed_lines": len(result["unparsed"]["lines"]), "unparsed_examples": result["unparsed"]["lines"][:10],
                    "printed_litigations": result["unparsed"]["printed_total"],
                    "judge_not_printed": result["terminated_judge_not_printed"], "exits_fy2026": result["exits"]},
        "scatter": scatter,
    }
    rows.append(cw.record(
        "judge_cross_profiles", "summary:overview", "MDL judges — experience and current load", source_url=JPML_PENDING_URL,
        subtitle=f"{len(with_pending)} judges with pending MDLs · {len(records)} sitting judges with MDL experience · as of {as_of}",
        cells={"judge": "Summary", "court": "—", "status": "—", "party": "—", "years": "—", "pending_mdls": str(result["pending_mdls"]),
               "pending_actions": fmt(result["total_pending_actions"]), "historical_mdls": "—"},
        facts=[["As of", as_of], ["Sitting judges with MDL experience", str(len(records))], ["Judges with pending MDLs", str(len(with_pending))],
               ["Top 10 judges' share of pending actions", f"{summary['top10_judge_share_pct']}%"], ["HHI of pending actions by judge", fmt(summary["hhi_by_judge"])]],
        text="summary overview", filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "summary": summary},
    ))

    # districts
    drows = []
    nat_pending = sum(d["pending_actions"] for d in result["districts"])
    for d in result["districts"]:
        name = court_name(d["court_id"])
        d["name"] = name
        d["share_pending_pct"] = round(100 * d["pending_actions"] / nat_pending, 2) if nat_pending else None
        dem = d["party_active"].get("Democratic", 0)
        rep = d["party_active"].get("Republican", 0)
        drows.append(cw.record(
            "judge_cross_districts", d["court_id"], name, source_url=FJC_URL,
            subtitle=f"{d['active']} active · {d['senior']} senior · {d['pending_mdls']} pending MDLs ({fmt(d['pending_actions'])} actions)",
            state=d["state"] or "",
            cells={"district": name, "active": str(d["active"]), "senior": str(d["senior"]), "dem_rep": f"{dem} / {rep}",
                   "median_years": fmt(d["median_years_active"]), "pending_mdls": str(d["pending_mdls"]), "pending_actions": fmt(d["pending_actions"]),
                   "terminated_mdls": str(d["terminated_mdls"])},
            facts=[["District", name], ["Sitting Article III judges (FJC)", str(d["sitting"])], ["Active (incl. chief)", str(d["active"])],
                   ["Senior", str(d["senior"])], ["Active judges by appointing party", ", ".join(f"{k}: {v}" for k, v in d["party_active"].items()) or "None"],
                   ["Median years since first commission (active)", fmt(d["median_years_active"])],
                   ["Authorized judgeships (US Courts FCMS, June 2026; FJC bench counts use a different as-of date)",
                    f"{d['judgeships']:g}" if isinstance(d["judgeships"], (int, float)) else "Not recorded"],
                   ["Pending MDLs", str(d["pending_mdls"])], ["Pending MDL actions", fmt(d["pending_actions"])],
                   ["Top MDL judge share of district's pending actions", f"{d['top_judge_share_pct']}%" if d["top_judge_share_pct"] is not None else "Not applicable"],
                   ["Terminated MDLs through FY2025 (JPML)", str(d["terminated_mdls"])],
                   ["Sources", "FJC Biographical Directory export; JPML pending and terminated MDL reports; US Courts FCMS"]],
            links=[{"url": f"/courts/{d['court_id']}", "label": "Court profile"}, {"url": FJC_PAGE, "label": "FJC export"},
                   {"url": JPML_PENDING_URL, "label": "JPML pending MDL reports"}],
            text=f"{name} {d['state'] or ''}",
            filters={"circuit": [str(d["circuit"])] if d["circuit"] is not None else [], "has_mdl": ["yes" if d["pending_mdls"] else "no"]},
            extra={"kind": "district", "district": {**d, "as_of": as_of}},
        ))
    national = national_summary(result["districts"], records, as_of)
    drows.append(cw.record(
        "judge_cross_districts", "summary:national", "Federal district benches — national summary", source_url=FJC_URL,
        subtitle=f"{national['sitting']} sitting district judges · {national['districts']} districts · as of {as_of}",
        cells={"district": "National", "active": str(national["active"]), "senior": str(national["senior"]), "dem_rep": "—",
               "median_years": fmt(national["median_years_active"]), "pending_mdls": str(national["pending_mdls"]),
               "pending_actions": fmt(national["pending_actions"]), "terminated_mdls": str(national["terminated_mdls"])},
        facts=[["Districts", str(national["districts"])], ["Sitting district judges", str(national["sitting"])],
               ["HHI of pending MDL actions by district", fmt(national["hhi_by_district"])]],
        text="national summary", filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "national": national},
    ))

    # disclosures
    disc = result["disclosure"]
    mrows = []
    for m in disc["matches"]:
        rid = f"{m['tier']}:{m['nid']}:{m['mdl']}:{m['disclosure_id']}:{m['investment_id']}:{c.company_key(m['company']).replace(' ', '-')}"
        mrows.append(cw.record(
            "judge_cross_disclosure_matches", rid, f"{m['judge']} — {m['investment']}", source_url=m["disclosure_url"],
            subtitle=f"{m['label']} · MDL {m['mdl']} · {m['year']} report, line {m['line']}",
            cells={"judge": m["judge"], "mdl": str(m["mdl"]), "company": m["company"], "investment": m["investment"], "year": str(m["year"]),
                   "line": str(m["line"]), "label": m["label"]},
            facts=[["Label", m["label"]], ["Tier", "Exact name match" if m["tier"] == "match" else "Near match"], ["Judge", m["judge"]],
                   ["MDL", f"{m['mdl']} — {m['mdl_title']}"],
                   ["Company (party evidence)", f"{m['company']} — {m['evidence_label']}"],
                   ["Disclosed investment (as extracted)", m["investment"]], ["Report year", str(m["year"])],
                   ["Line / page", f"Line {m['line']} of {m['lines_in_report']} extracted investment rows, page {m['page'] or 'not recorded'}"],
                   ["Gross value code", f"{m['gross_value_code']} ({m['gross_value']})" if m["gross_value_code"] else "Not recorded"],
                   ["Matching rule", m["rule"] + " (names compared after removing case, punctuation, corporate suffixes and security words)"],
                   ["Source", "CourtListener bulk financial-disclosure investments " + CL_DATE + "; disclosure PDF linked"]],
            links=[{"url": m["disclosure_url"], "label": f"Disclosure report {m['year']} (PDF)"},
                   {"url": m["evidence_url"], "label": m["evidence_label"]}] + ([{"url": f"/judges/{m['judge_profile_id']}", "label": "Judge profile"}] if m["judge_profile_id"] else []),
            badges=["Requires review" if m["tier"] == "match" else "Near match — review", f"MDL {m['mdl']}"],
            text=f"{m['company']} {m['investment']} {m['mdl_title']}",
            filters={"kind": [m["tier"]], "mdl": [str(m["mdl"])], "judge": [m["nid"]], "evidence": [m["evidence_kind"]],
                     "judge_profile": [m["judge_profile_id"]] if m["judge_profile_id"] else []},
            extra={"kind": m["tier"], "match": m},
        ))
    for cov in disc["coverage"]:
        mrows.append(cw.record(
            "judge_cross_disclosure_matches", f"coverage:{cov['nid']}", f"Disclosure coverage — {cov['judge']}",
            source_url=(cov["reports"][0]["url"] if cov["reports"] else CL_BULK + CL_FILES["disclosures"]),
            subtitle=f"{cov['status'].replace('_', ' ')} · years checked {', '.join(map(str, cov['years_checked'])) or 'none'} · {cov['matches']} name matches",
            cells={"judge": cov["judge"], "mdl": ", ".join(str(m["mdl"]) for m in cov["mdls"]), "company": f"{len(cov['companies_checked'])} companies checked",
                   "investment": f"{cov['lines_checked']} lines checked", "year": ", ".join(map(str, cov["years_checked"])) or "—", "line": "—",
                   "label": cov["status"].replace("_", " ")},
            facts=[["Status", cov["status"].replace("_", " ")], ["Disclosure years available in CourtListener", ", ".join(map(str, cov["years_available"])) or "None"],
                   ["Years checked", ", ".join(map(str, cov["years_checked"])) or "None"], ["Investment lines checked", str(cov["lines_checked"])],
                   ["Companies checked", "; ".join(cov["companies_checked"]) or "None with explicit party evidence"], ["Name matches", str(cov["matches"])]],
            links=[{"url": x["url"], "label": f"{x['year']} report (PDF)"} for x in cov["reports"]],
            text=f"coverage {cov['judge']}", filters={"_listing": ["no"], "kind": ["coverage"], "judge": [cov["nid"]],
                                                       "judge_profile": [cov["judge_profile_id"]] if cov["judge_profile_id"] else []},
            extra={"kind": "coverage", "coverage": cov},
        ))
    status_counts = Counter(cov["status"] for cov in disc["coverage"])
    dsummary = {
        "as_of": as_of, "cl_bulk_date": CL_DATE, "judges_targeted": len(disc["coverage"]), "status": dict(status_counts),
        "matches": sum(1 for m in disc["matches"] if m["tier"] == "match"),
        "near_matches": sum(1 for m in disc["matches"] if m["tier"] == "near_match"),
        "judges_with_matches": len({m["nid"] for m in disc["matches"] if m["tier"] == "match"}),
        "judges_with_near_matches": len({m["nid"] for m in disc["matches"] if m["tier"] == "near_match"}),
        "near_label": NEAR_LABEL, "alias_table": [{k: v for k, v in a.items() if k != "names"} | {"names": a["names"]} for a in dm.REVIEWED_ALIASES],
        "parties_not_compared": dict(sum((Counter(cov["parties_not_compared"]) for cov in disc["coverage"]), Counter())),
        "sec_links_used": disc["sec_present"], "party_evidence_mdls": disc["party_mdls"], "sec_evidence_mdls": disc["sec_mdls"],
        "caption_companies": {str(k): v for k, v in CAPTION_COMPANIES.items()}, "years_per_judge": DISCLOSURE_YEARS,
        "label": REVIEW_LABEL,
        "latest_year_distribution": dict(Counter(str(max(cov["years_available"])) if cov["years_available"] else "none" for cov in disc["coverage"])),
    }
    mrows.append(cw.record(
        "judge_cross_disclosure_matches", "summary:disclosures", "Disclosure name matches — summary", source_url=CL_BULK + CL_FILES["investments"],
        subtitle=f"{dsummary['matches']} name matches for {dsummary['judges_with_matches']} judges · {dsummary['judges_targeted']} judges checked",
        cells={"judge": "Summary", "mdl": "—", "company": "—", "investment": "—", "year": "—", "line": "—", "label": REVIEW_LABEL},
        facts=[["Judges targeted (transferee judges of pending products-liability MDLs)", str(dsummary["judges_targeted"])],
               ["Name matches", str(dsummary["matches"])], ["Label", REVIEW_LABEL]],
        text="summary disclosures", filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "summary": dsummary},
    ))
    out = {"profiles": len(rows), "districts": len(drows), "matches": len(disc["matches"]), "coverage": len(disc["coverage"]),
           "coverage_status": dict(status_counts), "history_status": dict(result["history_status"]), "unassigned": len(result["unassigned"])}
    print(json.dumps(out, indent=1))
    (SCRATCH / "last_build.json").write_text(json.dumps({"summary": summary | {"scatter": len(scatter)}, "national": national, "disclosure": dsummary,
                                                        "matches": disc["matches"], "coverage": disc["coverage"]}, indent=1, default=str))
    if dry:
        return
    cw.publish("judge_cross_profiles", "MDL judges — experience, load and appointment (FJC × JPML)", rows,
               listing_block=cw.listing([("judge", "Judge"), ("court", "Court"), ("status", "Status"), ("party", "Appointing party"), ("years", "Years since commission"),
                                         ("pending_mdls", "Pending MDLs"), ("pending_actions", "Pending actions"), ("historical_mdls", "Terminated MDLs")],
                                        [("status", "Status", {"active": "Active", "chief_judge": "Chief Judge", "senior": "Senior"}),
                                         ("party", "Appointing party", {"democratic": "Democratic", "republican": "Republican"}),
                                         ("pending_mdl", "Pending MDLs", {"yes": "Has pending MDLs", "no": "Terminated only"})]),
               summary={"source": [FJC_URL, JPML_PENDING_URL, TERMINATED_URL], "as_of": as_of, "retrieved": str(c.TODAY)})
    cw.publish("judge_cross_districts", "Federal district benches and MDL concentration (FJC × JPML)", drows,
               listing_block=cw.listing([("district", "District"), ("active", "Active"), ("senior", "Senior"), ("dem_rep", "Active D / R"), ("median_years", "Median yrs (active)"),
                                         ("pending_mdls", "Pending MDLs"), ("pending_actions", "Pending actions"), ("terminated_mdls", "Terminated MDLs")],
                                        [("has_mdl", "Pending MDLs", {"yes": "Has pending MDLs", "no": "None"})]),
               summary={"source": [FJC_URL, JPML_PENDING_URL, TERMINATED_URL], "as_of": as_of, "retrieved": str(c.TODAY)})
    cw.publish("judge_cross_disclosure_matches", "Judicial disclosure × MDL defendant name matches (requires review)", mrows,
               listing_block=cw.listing([("judge", "Judge"), ("mdl", "MDL"), ("company", "Company"), ("investment", "Disclosed investment"), ("year", "Year"), ("line", "Line"), ("label", "Label")],
                                        [("evidence", "Party evidence", {"caption": "MDL caption", "docket_party": "Docket party list", "sec_filing": "SEC filing"})]),
               summary={"source": [CL_BULK + v for v in CL_FILES.values()], "label": REVIEW_LABEL, "as_of": as_of, "retrieved": str(c.TODAY)})


def national_summary(districts, records, as_of):
    sitting = sum(d["sitting"] for d in districts)
    party = Counter()
    tenure = Counter()
    for d in districts:
        party.update(d["party_active"])
        tenure.update(d["tenure"])
    years_active = []
    for d in districts:
        years_active += [j["years"] for j in d["judges"] if j["status"] != "Senior"]
    pending = [d for d in districts if d["pending_actions"]]
    total = sum(d["pending_actions"] for d in districts)
    top = sorted(pending, key=lambda d: -d["pending_actions"])
    circuits = defaultdict(lambda: {"districts": 0, "active": 0, "senior": 0, "pending_mdls": 0, "pending_actions": 0, "Democratic": 0, "Republican": 0})
    for d in districts:
        k = str(d["circuit"]) if d["circuit"] is not None else "Not recorded"
        circuits[k]["districts"] += 1
        circuits[k]["active"] += d["active"]
        circuits[k]["senior"] += d["senior"]
        circuits[k]["pending_mdls"] += d["pending_mdls"]
        circuits[k]["pending_actions"] += d["pending_actions"]
        circuits[k]["Democratic"] += d["party_active"].get("Democratic", 0)
        circuits[k]["Republican"] += d["party_active"].get("Republican", 0)
    return {
        "as_of": as_of, "districts": len(districts), "sitting": sitting, "active": sum(d["active"] for d in districts),
        "senior": sum(d["senior"] for d in districts), "party_active": dict(party), "tenure": {label: tenure.get(label, 0) for _, _, label in TENURE_BUCKETS},
        "median_years_active": c.median(years_active), "pending_mdls": sum(d["pending_mdls"] for d in districts), "pending_actions": total,
        "districts_with_pending": len(pending), "hhi_by_district": c.hhi([d["pending_actions"] for d in districts]),
        "top5_district_share_pct": round(100 * sum(d["pending_actions"] for d in top[:5]) / total, 1) if total else None,
        "terminated_mdls": sum(d["terminated_mdls"] for d in districts),
        "circuits": dict(sorted(circuits.items(), key=lambda kv: (len(kv[0]), kv[0]))),
        "rows": [{k: d[k] for k in ("court_id", "state", "circuit", "sitting", "active", "senior", "party_active", "party_all", "median_years_active",
                                     "median_years_all", "tenure", "pending_mdls", "pending_actions", "mass_tort_mdls", "products_liability_mdls", "mdl_judges",
                                     "top_judge", "top_judge_share_pct", "hhi_by_judge", "terminated_mdls", "judgeships", "share_pending_pct")} | {"name": court_name(d["court_id"])}
                 for d in districts],
    }


def main():
    dry = "--dry" in sys.argv
    result = build(dry)
    publish(result, dry)


if __name__ == "__main__":
    main()
