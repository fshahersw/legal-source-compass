"""Build `judicial_nominations` (Congress.gov API v3) and `judicial_confirmation_votes` (senate.gov roll-call vote XML).

Inputs are the responses stored by crawl_congress.py and crawl_senate.py; this script makes no network request.

judicial_nominations - one record per nomination (PN citation, including part numbers such as PN150-3) received in the
97th-119th Congresses (January 1981 - October 2026) whose Congress.gov organization is the judiciary or the Supreme Court:
  * scope: Article III judgeships (Supreme Court, courts of appeals, district courts, Court of International Trade) and the
    territorial district courts (Guam, Virgin Islands, Northern Mariana Islands), classified from the published description
    (position title as a fallback). Other judiciary-organization nominations (Tax Court, Court of Federal Claims, Court of
    Appeals for Veterans Claims or for the Armed Forces, District of Columbia local courts, Sentencing Commission and others)
    are excluded and counted in the summary;
  * actions as published: referral, hearings (Congress.gov hearing records with S.Hrg. citations, else the hearing actions),
    committee actions, calendar, cloture and other floor votes, confirmation (voice vote, unanimous consent or yea-nay with
    the tally and record vote number), withdrawal, return to the President or rejection;
  * status: confirmed, withdrawn, returned to the President, rejected (disapproved), pending (119th Congress, no final action)
    or no final action recorded;
  * predecessor: the 'vice ...' clause of the description exactly as published; 'new position' when published so;
  * Senate roll-call votes (senate.gov XML, 101st Congress on) whose question names the nomination's PN in the same
    Congress, with yea/nay/not-voting counts by party as published;
  * FJC link (exact keys only): the nominee's surname (accents and punctuation removed, lower case) + the court id + an exact
    date: the FJC nomination date equal to the date the Senate received the nomination, or the FJC confirmation date equal to
    the Congress.gov confirmation date, or an FJC 'other nomination' entry naming the same court and date. Only a unique judge
    is linked; ambiguous and unmatched nominations stay unlinked and are counted.

judicial_confirmation_votes - one record per Senate roll-call vote (101st Congress on) whose question names at least one
nomination in judicial_nominations: question, result, counts, party split and every senator's vote exactly as published
(name as printed by the Senate, party, state, vote cast), the judicial nominations covered and the number of other
nominations on en bloc votes. 1981-1988 votes exist only as Congress.gov action tallies (no member-level XML is published).
"""
from __future__ import annotations

import collections
import gzip
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parent))
import fetchlib as fl  # noqa: E402
import build_judge_profiles as bjp  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
CONG = fl.ACQ / "congress"
SENATE = fl.ACQ / "senate" / "legislative" / "LIS" / "roll_call_votes"
BASE = "https://api.congress.gov/v3"
CONGRESSES = range(97, 120)
PAGE = 250
JUDICIAL_ORGS = {"The Judiciary", "Supreme Court of the United States", "The Supreme Court of the United States", "District Court of Guam"}
NOM_DATASET = "judicial_nominations"
VOTE_DATASET = "judicial_confirmation_votes"
ORDINALS = {"first": "First", "second": "Second", "third": "Third", "fourth": "Fourth", "fifth": "Fifth", "sixth": "Sixth",
            "seventh": "Seventh", "eighth": "Eighth", "ninth": "Ninth", "tenth": "Tenth", "eleventh": "Eleventh",
            "district of columbia": "District of Columbia", "federal": "Federal"}
STATES_LOWER = {k.lower(): v for k, v in bjp.STATES.items()}
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                       "october", "november", "december"], 1)}
CATEGORY_LABEL = {"supreme_court": "Supreme Court", "circuit": "Court of appeals", "district": "District court",
                  "international_trade": "Court of International Trade", "territorial_district": "Territorial district court"}
STATUS_LABEL = {"confirmed": "Confirmed", "withdrawn": "Withdrawn", "returned": "Returned to the President", "rejected": "Rejected by the Senate",
                "pending": "Pending", "no_final_action": "No final action recorded"}
OUT_OF_SCOPE = [("tax_court", r"tax court"), ("federal_claims", r"court of federal claims|claims court|court of claims"),
                ("veterans", r"veterans"), ("armed_forces", r"armed forces|military appeals"),
                ("dc_local", r"superior court of the district of columbia|district of columbia court of appeals"),
                ("sentencing_commission", r"sentencing commission"), ("other", r".")]


# ------------------------------------------------------------------------------------------------ stored responses
def stored(path: str, **params) -> dict | None:
    query = "&".join(f"{k}={v}" for k, v in sorted({"format": "json", **params}.items()))
    f = CONG / (fl.safe_name(f"{BASE}{path}?{query}") + ".gz")
    return json.loads(gzip.decompress(f.read_bytes())) if f.exists() else None


def cite_path(entry: dict) -> str:
    part = str(entry.get("partNumber") or "00")
    return f"/nomination/{entry['congress']}/{entry['number']}" + ("" if part in ("", "00") else f"-{int(part)}")


def list_entries():
    for c in CONGRESSES:
        offset = 0
        while True:
            page = stored(f"/nomination/{c}", limit=PAGE, offset=offset)
            if page is None:
                break
            items = page.get("nominations") or []
            yield from items
            offset += PAGE
            if not items or offset >= ((page.get("pagination") or {}).get("count") or 0):
                break


# ------------------------------------------------------------------------------------------------ parsing helpers
def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


DIRECTION = {"northern": "n", "northen": "n", "southern": "s", "eastern": "e", "western": "w", "middle": "m", "central": "c"}


def state_code(name: str) -> str | None:
    name = re.sub(r"^the ", "", name.strip())
    return "dc" if name == "columbia" else STATES_LOWER.get(name)


def district_ids(text: str) -> list[str]:
    """Court ids for 'District Judge for the <Region> District of <State>' and for combined judgeships such as 'the Eastern
    and Western Districts of Missouri' (one id per district named)."""
    t = text
    m = re.search(r"district judge,? (?:for|of) the ((?:(?:northern|northen|southern|eastern|western|middle|central),? (?:and )?)+)districts? of "
                  r"([a-z .]+?)(?:,|\.|;| vice\b| to\b| for\b|$)", t)
    if m:
        state = state_code(m.group(2))
        regions = re.findall(r"northern|northen|southern|eastern|western|middle|central", m.group(1))
        return [state + DIRECTION[r] + "d" for r in regions] if state else []
    m = re.search(r"district judge,? (?:for|of) the district of ([a-z .]+?)(?:,|\.|;| vice\b| to\b| for\b|$)", t)
    if m:
        state = state_code(m.group(1))
        return [bjp.SPECIAL.get(state, state + "d")] if state else []
    return []


def classify(text: str) -> tuple[str, str | None, str | None]:
    """(category, court id or None, out-of-scope reason or None) from a nomination description or position title. A
    combined judgeship naming several districts has no single court id (see district_ids)."""
    t = re.sub(r"\s+", " ", (text or "").replace("U. S.", "U.S.").replace("Judgefor", "Judge for")).lower()
    for reason, pat in OUT_OF_SCOPE[:-1]:
        if re.search(pat, t):
            return "out_of_scope", None, reason
    if re.search(r"chief justice of the united states|justice of the supreme court", t):
        return "supreme_court", "scotus", None
    if "court of international trade" in t:
        return "international_trade", "cit", None
    for name, cid in (("guam", "gud"), ("virgin islands", "vid"), ("northern mariana islands", "nmid")):
        if re.search(rf"district court (?:of|for) (?:the )?{name}", t) or (name in t and re.search(r"\bjudge\b", t) and "district judge" not in t):
            return "territorial_district", cid, None
    m = re.search(r"circuit judge(?:,)? (?:for|of) the ([a-z ]+?) circuit", t)
    if m:
        return "circuit", bjp.CIRCUITS.get(ORDINALS.get(m.group(1).strip(), "")), None
    if "circuit judge" in t:
        return "circuit", None, None
    if re.search(r"district judge", t):
        ids = district_ids(t)
        cid = ids[0] if len(ids) == 1 else None
        return ("territorial_district" if cid in ("gud", "vid", "nmid") else "district"), cid, None
    return "out_of_scope", None, "other"


def predecessor(description: str | None) -> tuple[str | None, bool]:
    d = (description or "").strip()
    new = bool(re.search(r"new position", d, re.I))
    m = re.search(r",?\s+vice\s+(.+?)\s*\.?\s*(?:\(new position\))?\s*$", d, re.I | re.S)
    return (m.group(1).strip().rstrip(".,;") if m else None), new


def tally(text: str) -> tuple[int | None, int | None, int | None]:
    m = re.search(r"(\d+)\s*-\s*(\d+)", text)
    rv = re.search(r"Record Vote (?:Number|No)\s*[:.]?\s*(?:EX\.?\s*)?(\d+)", text, re.I)
    return (int(m.group(1)) if m else None, int(m.group(2)) if m else None, int(rv.group(1)) if rv else None)


def confirmation_method(text: str) -> str:
    t = text.lower()
    if "yea-nay" in t or "roll call" in t or re.search(r"\d+\s*-\s*\d+", t):
        return "Roll call"
    if "unanimous consent" in t:
        return "Unanimous consent"
    if "voice" in t:
        return "Voice vote"
    return "As published"


FINAL = [("confirmed", lambda a: a["actionCode"] == "S05310"),
         ("rejected", lambda a: a["actionCode"] == "S05315" or re.search(r"nomination disapproved|rejected by the senate", a["text"], re.I)),
         ("withdrawn", lambda a: a["actionCode"] == "S05330" or re.search(r"withdrawal of nomination", a["text"], re.I)),
         ("returned", lambda a: a["actionCode"] == "S05335" or re.search(r"returned to the president|failed of confirmation|failed under provisions of rule xxxi", a["text"], re.I))]


def parse_actions(actions: list[dict]) -> dict:
    acts = sorted(({"date": a.get("actionDate"), "actionCode": a.get("actionCode") or "", "text": (a.get("text") or "").strip(),
                    "type": a.get("type"), "committees": [c.get("name") for c in a.get("committees") or [] if c.get("name")]}
                   for a in actions), key=lambda a: (a["date"] or "", a["actionCode"]))
    out = {"received_action": None, "referral": None, "hearing_actions": [], "committee_actions": [], "calendar": None,
           "cloture": [], "floor_votes": [], "confirmation": None, "final": None}
    for a in acts:
        code, text = a["actionCode"], a["text"]
        if code in ("S05110", "S05120") and out["received_action"] is None:
            out["received_action"] = a["date"]
        if code == "S05120" and out["referral"] is None:
            m = re.search(r"referred to the (Committee on [A-Za-z' ,]+?)(?: pursuant|\.|$)", text)
            out["referral"] = {"date": a["date"], "committee": (a["committees"] or [None])[0] or (m.group(1).strip() if m else None)}
        elif code in ("S05750", "S05755", "S05198"):
            m = re.search(r"S\.\s*Hrg\.\s*([\d-]+(?:,?\s*(?:pt|part)\.?\s*\d+)?)", text, re.I)
            out["hearing_actions"].append({"date": a["date"], "citation": ("S.Hrg. " + m.group(1)) if m else None, "text": text})
        elif a["type"] == "Committee" or code in ("S05155", "S05160", "S05890", "S05885", "S05780", "S05770", "S05140", "S05230"):
            out["committee_actions"].append({"date": a["date"], "code": code, "text": text})
        if code in ("S05180", "S05181") and out["calendar"] is None:
            m = re.search(r"Calendar No\.\s*(\d+)", text)
            out["calendar"] = {"date": a["date"], "number": int(m.group(1)) if m else None}
        if code in ("S05235", "S05240"):
            y, n, rv = tally(text)
            out["cloture"].append({"date": a["date"], "text": text, "yeas": y, "nays": n, "record_vote": rv})
        if re.search(r"yea-nay vote|record vote", text, re.I) and code != "S05310":
            y, n, rv = tally(text)
            out["floor_votes"].append({"date": a["date"], "code": code, "text": text, "yeas": y, "nays": n, "record_vote": rv})
        if code == "S05310":
            y, n, rv = tally(text)
            method = confirmation_method(text)
            out["confirmation"] = {"date": a["date"], "method": method, "text": text, "yeas": y if method == "Roll call" else None,
                                   "nays": n if method == "Roll call" else None, "record_vote": rv}
        for status, test in FINAL:
            if test(a):
                out["final"] = {"status": status, "date": a["date"], "text": text}
                break
    return out


def nominee_names(item: dict, base: str) -> list[dict]:
    names = []
    for n in (item.get("nominees") or []):
        rec = stored(f"{base}/{n.get('ordinal')}") or {}
        for p in rec.get("nominees") or []:
            names.append({"ordinal": n.get("ordinal"), "first": p.get("firstName"), "middle": p.get("middleName"), "last": p.get("lastName"),
                          "suffix": p.get("suffix"), "state": p.get("state"), "position_title": n.get("positionTitle"),
                          "organization": n.get("organization")})
        if not rec.get("nominees"):
            names.append({"ordinal": n.get("ordinal"), "first": None, "middle": None, "last": None, "suffix": None, "state": None,
                          "position_title": n.get("positionTitle"), "organization": n.get("organization")})
    return names


# ------------------------------------------------------------------------------------------------ FJC index
def fjc_index():
    import csv

    names = {}
    for r in csv.DictReader(bjp.FJC_CSV.read_bytes().decode("utf-8-sig").splitlines()):
        names[r["nid"].strip()] = {"last": norm(r["Last Name"]), "first": norm(r["First Name"])}
    build = json.loads((BUILD / "judge_profiles_fjc.json").read_text())
    idx = {"nomination": collections.defaultdict(set), "confirmation": collections.defaultdict(set), "other": collections.defaultdict(set)}
    profiles = {}
    for row in build["rows"]:
        p = row["item"]["profile"]
        nid = p["nid"]
        profiles[nid] = {"judge_profile_id": p.get("judge_profile_id"), "name": p["name"], "services": p["services"]}
        last = names.get(nid, {}).get("last")
        if not last:
            continue
        for s in p["services"]:
            if not s.get("court_id"):
                continue
            if s.get("nomination"):
                idx["nomination"][(s["court_id"], last, s["nomination"][:10])].add(nid)
            if s.get("confirmation"):
                idx["confirmation"][(s["court_id"], last, s["confirmation"][:10])].add(nid)
        for o in p.get("other_nominations") or []:
            m = re.match(r"Nominated to (.+?), ([A-Z][a-z]+) (\d{1,2}), (\d{4})", o["text"])
            if m and m.group(2).lower() in MONTHS:
                cid = bjp.court_id(m.group(1))
                if cid:
                    day = f"{m.group(4)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(3)):02d}"
                    idx["other"][(cid, last, day)].add(nid)
    return idx, profiles, names


def fjc_link(idx, courts, last, received, confirmed):
    """Exact-key link: surname + one of the nomination's court ids + an equal date; a unique FJC judge only."""
    if not (courts and last):
        return None, "missing_key"
    hits, bases = set(), []
    for basis, key in (("nomination_date", ("nomination", received)), ("confirmation_date", ("confirmation", confirmed)),
                       ("other_nomination_date", ("other", received))):
        if key[1]:
            h = set().union(*(idx[key[0]].get((court, last, key[1]), set()) for court in courts))
            if h:
                hits |= h
                bases.append(basis)
    if len(hits) == 1:
        return next(iter(hits)), "+".join(bases)
    return None, "ambiguous" if hits else "no_match"


# ------------------------------------------------------------------------------------------------ Senate XML
def senate_votes():
    out = []
    for f in sorted(SENATE.glob("*/*.xml.gz")):
        r = ET.fromstring(gzip.decompress(f.read_bytes()))
        t = lambda tag: (r.findtext(tag) or "").strip()  # noqa: E731
        congress, session, number = int(t("congress")), int(t("session")), int(t("vote_number"))
        m = re.match(r"([A-Za-z]+) (\d{1,2}), (\d{4})", t("vote_date"))
        vdate = f"{m.group(3)}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}" if m else None
        pns = list(dict.fromkeys(re.findall(r"\bPN\d+(?:-\d+)?\b", t("vote_question_text")) + [t("document/document_name")]))
        members = [{"name": (m_.findtext("member_full") or "").strip(), "first": (m_.findtext("first_name") or "").strip(),
                    "last": (m_.findtext("last_name") or "").strip(), "party": (m_.findtext("party") or "").strip(),
                    "state": (m_.findtext("state") or "").strip(), "vote": (m_.findtext("vote_cast") or "").strip()} for m_ in r.iter("member")]
        split = collections.defaultdict(collections.Counter)
        for mb in members:
            split[mb["party"]][mb["vote"]] += 1
        num = lambda tag: int(t(tag)) if t(tag).isdigit() else None  # noqa: E731
        vid = f"{congress}-{session}-{number}"
        stem = f"vote{congress}{session}/vote_{congress}_{session}_{number:05d}"
        out.append({
            "vote_id": vid, "congress": congress, "session": session, "vote_number": number, "date": vdate,
            "question": t("question"), "vote_question_text": t("vote_question_text")[:600], "title": t("vote_title"),
            "result": t("vote_result"), "result_text": t("vote_result_text"), "majority_requirement": t("majority_requirement"),
            "yeas": num("count/yeas"), "nays": num("count/nays"), "present": num("count/present"), "absent": num("count/absent"),
            "tie_breaker": t("tie_breaker/by_whom") or None, "pns": [p for p in pns if p],
            "party_split": [{"party": p, "yea": c["Yea"], "nay": c["Nay"], "not_voting": c["Not Voting"],
                             "present": c["Present"] + c["Present, Giving Live Pair"]} for p, c in sorted(split.items())],
            "members": members,
            "source_url": f"https://www.senate.gov/legislative/LIS/roll_call_votes/{stem}.xml",
            "page_url": f"https://www.senate.gov/legislative/LIS/roll_call_votes/{stem}.htm",
        })
    return out


# ------------------------------------------------------------------------------------------------ build
def main() -> None:
    spine = {json.loads(line)["id"] for line in (BUILD / "lookups" / "court_spine_xwalk_lookup.jsonl").open()}
    idx, profiles, fjc_names = fjc_index()
    stats = collections.Counter()
    excluded = collections.Counter()
    noms = []
    seen = set()
    for entry in list_entries():
        if entry.get("organization") not in JUDICIAL_ORGS:
            continue
        base = cite_path(entry)
        if base in seen:  # list pages are sorted by update date; an entry can repeat across pages
            stats["list_entries_repeated"] += 1
            continue
        seen.add(base)
        stats["judiciary_org_entries"] += 1
        item = (stored(base) or {}).get("nomination")
        if not item:
            stats["details_not_stored"] += 1
            continue
        names = nominee_names(item, base)
        desc = item.get("description") or ""
        text = desc or " ".join(n["position_title"] or "" for n in names)
        cat, court, reason = classify(text)
        if cat == "out_of_scope":
            excluded[reason] += 1
            continue
        court_ids = [court] if court else [c for c in district_ids(re.sub(r"\s+", " ", text.replace("Judgefor", "Judge for")).lower()) if c in spine]
        if court and court not in spine:
            stats["court_id_not_in_spine"] += 1
            court, court_ids = None, []
        if not court:
            stats["combined_districts" if len(court_ids) > 1 else "court_not_identified"] += 1
        actions = []
        offset = 0
        while True:
            page = stored(f"{base}/actions", limit=PAGE, offset=offset)
            if page is None:
                break
            actions += page.get("actions") or []
            offset += PAGE
            if offset >= ((page.get("pagination") or {}).get("count") or 0):
                break
        if not actions:
            stats["actions_not_stored"] += 1
        hearings = (stored(f"{base}/hearings", limit=PAGE, offset=0) or {}).get("hearings") or []
        pa = parse_actions(actions)
        prev, new_position = predecessor(desc)
        final = pa["final"]
        status = final["status"] if final else ("pending" if entry["congress"] == 119 else "no_final_action")
        received = item.get("receivedDate")
        conf = pa["confirmation"]
        last = norm(names[0]["last"]) if names and names[0]["last"] else None
        nid, basis = fjc_link(idx, court_ids, last, received, conf["date"] if conf else None)
        stats[f"fjc_link_{basis.split('+')[0] if nid else basis}"] += 1
        if nid and names and names[0]["first"] and fjc_names.get(nid, {}).get("first") != norm(names[0]["first"]):
            stats["fjc_link_first_name_differs"] += 1
        citation = item.get("citation") or entry.get("citation")
        noms.append({
            "id": f"nom:{entry['congress']}-{citation}", "citation": citation, "congress": entry["congress"], "number": item.get("number"),
            "part_number": item.get("partNumber"), "received_date": received, "description": desc or None,
            "nominee_name": nominee_name(desc, names),
            "nominees": names, "position_title": names[0]["position_title"] if names else None, "category": cat, "court_id": court, "court_ids": court_ids,
            "predecessor_text": prev, "new_position": new_position,
            "status": status, "status_date": final["date"] if final else None, "status_text": final["text"] if final else None,
            "latest_action": item.get("latestAction"),
            "referral": pa["referral"],
            "hearings": [{"date": h.get("date"), "citation": h.get("citation")} for h in hearings] or
                        [{"date": h["date"], "citation": h["citation"]} for h in pa["hearing_actions"]],
            "committee_actions": pa["committee_actions"], "calendar": pa["calendar"], "cloture": pa["cloture"],
            "floor_votes": pa["floor_votes"], "confirmation": conf,
            "actions_count": len(actions), "senate_votes": [],
            "fjc_nid": nid, "fjc_link_basis": basis if nid else None, "fjc_link_status": "exact" if nid else basis,
            "judge_profile_id": profiles.get(nid, {}).get("judge_profile_id") if nid else None,
            "fjc_name": profiles.get(nid, {}).get("name") if nid else None,
            "congress_url": f"https://www.congress.gov/nomination/{ordinal(entry['congress'])}-congress/{citation.replace('PN', '')}",
        })
        stats[f"status_{status}"] += 1
        stats[f"category_{cat}"] += 1

    by_key = {(n["congress"], n["citation"]): n for n in noms}
    votes_out = []
    vstats = collections.Counter()
    for v in senate_votes():
        vstats["xml_votes"] += 1
        judicial = [by_key[(v["congress"], p)] for p in v["pns"] if (v["congress"], p) in by_key]
        if not judicial:
            vstats["xml_votes_without_judicial_nomination"] += 1
            continue
        v["judicial_nominations"] = [{"id": n["id"], "citation": n["citation"], "nominee": n["nominee_name"], "court_id": n["court_id"],
                                      "fjc_nid": n["fjc_nid"], "judge_profile_id": n["judge_profile_id"]} for n in judicial]
        v["other_nominations_count"] = len(v["pns"]) - len(judicial)
        votes_out.append(v)
        summary = {k: v[k] for k in ("vote_id", "date", "question", "result_text", "yeas", "nays", "party_split", "page_url", "source_url")}
        summary["en_bloc_size"] = len(v["pns"])
        for n in judicial:
            n["senate_votes"].append(summary)
    for n in noms:
        n["senate_votes"].sort(key=lambda s: (s["date"] or "", s["vote_id"]))
        conf = n["confirmation"]
        if conf and conf.get("record_vote") and n["congress"] >= 101:
            match = [s for s in n["senate_votes"] if s["question"] == "On the Nomination" and s["vote_id"].endswith(f"-{conf['record_vote']}")]
            stats["roll_call_confirmations_101_on"] += 1
            stats["roll_call_confirmations_with_xml"] += bool(match)

    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nom_rows = [nom_record(n) for n in noms]
    vote_rows = [vote_record(v) for v in votes_out]
    write(NOM_DATASET, "Nominations to federal judgeships, 1981-2026 (Congress.gov)", nom_rows, built, {
        "source": "Congress.gov API v3 (Library of Congress): nominations, nominees, actions and hearings, 97th-119th Congresses",
        "source_page": "https://api.congress.gov/", "terms": "Congress.gov data are U.S. government works; the API is free with an api.data.gov key.",
        "definitions": __doc__.split("judicial_confirmation_votes -", 1)[0].split("judicial_nominations -", 1)[1].strip(),
        "as_of": "2026-10-22", "stats": dict(stats), "excluded_out_of_scope": dict(excluded),
        "names": "Nominee and predecessor names are shown exactly as published by Congress.gov.", "built_at": built,
    }, listing_nominations())
    write(VOTE_DATASET, "Senate roll-call votes on judicial nominations, 1989-2026 (senate.gov)", vote_rows, built, {
        "source": "U.S. Senate roll-call vote XML (senate.gov, Legislative Information System), 101st-119th Congresses",
        "source_page": "https://www.senate.gov/legislative/votes_new.htm", "terms": "U.S. Senate public records (U.S. government work).",
        "definitions": "judicial_confirmation_votes -" + __doc__.split("judicial_confirmation_votes -", 1)[1],
        "party_split": "counts of members by the party code printed in the vote XML (D, R, I, ID) and the vote cast as printed",
        "stats": dict(vstats), "built_at": built,
    }, listing_votes())
    print(json.dumps({"nominations": len(nom_rows), "votes": len(vote_rows), **stats, **{f"excluded_{k}": v for k, v in excluded.items()}, **vstats}))


def nominee_name(desc: str, names: list[dict]) -> str | None:
    """The name as printed at the start of the description ('Aida M. Delgado-Colon, of Puerto Rico, to be ...'), else the
    nominee record's name parts."""
    if ", of " in desc:
        head = re.split(r",\s+of\s+", desc, maxsplit=1)[0].strip()
        if head and len(head) <= 120:
            return head
    if names and names[0]["last"]:
        return " ".join(x for x in [names[0]["first"], names[0]["middle"], names[0]["last"], names[0]["suffix"]] if x)
    return None


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def nom_record(n: dict) -> dict:
    conf = n["confirmation"]
    vote = "Not recorded"
    if conf:
        vote = f"Roll call {conf['yeas']}-{conf['nays']}" if conf["method"] == "Roll call" and conf["yeas"] is not None else conf["method"]
    title = f"{n['citation']} ({ordinal(n['congress'])} Congress): {n['nominee_name'] or 'Nominee not recorded'}"
    court_label = CATEGORY_LABEL[n["category"]]
    facts = [["Nomination", f"{n['citation']}, {ordinal(n['congress'])} Congress"], ["Nominee (as published)", n["nominee_name"] or "Not recorded"],
             ["Position (as published)", n["position_title"] or "Not recorded"], ["Description (as published)", n["description"] or "Not recorded"],
             ["Received in the Senate", n["received_date"] or "Not recorded"],
             ["Predecessor (as published)", n["predecessor_text"] or ("New position" if n["new_position"] else "Not recorded")],
             ["Referred", " · ".join(x for x in [(n["referral"] or {}).get("date"), (n["referral"] or {}).get("committee")] if x) or "Not recorded"],
             ["Hearings", "; ".join(" ".join(x for x in [h["date"], h["citation"]] if x) for h in n["hearings"]) or "None recorded"],
             ["Committee actions", "; ".join(f"{a['date']}: {a['text']}" for a in n["committee_actions"]) or "None recorded"],
             ["Cloture", "; ".join(f"{a['date']}: {a['text']}" for a in n["cloture"]) or "None recorded"],
             ["Confirmation vote", vote + (f" (record vote {conf['record_vote']})" if conf and conf.get("record_vote") else "")],
             ["Status", STATUS_LABEL[n["status"]] + (f", {n['status_date']}" if n["status_date"] else "")],
             ["Senate roll-call votes (senate.gov)", "; ".join(f"{s['date']} {s['question']}: {s['result_text']}" for s in n["senate_votes"]) or "None"],
             ["FJC judge", n["fjc_name"] or ("Not linked (no exact match)" if n["fjc_link_status"] == "no_match" else "Not linked")],
             ["Source", "Congress.gov API v3 (nomination, nominees, actions, hearings)"]]
    links = [{"url": n["congress_url"], "label": "Congress.gov nomination"}]
    for cid in reversed(n["court_ids"]):
        links.insert(0, {"url": f"/courts/{cid}", "label": "Court profile"})
    if n["judge_profile_id"]:
        links.insert(0, {"url": f"/judges/{n['judge_profile_id']}", "label": "Judge profile"})
    for s in n["senate_votes"]:
        links.append({"url": s["page_url"], "label": f"Senate roll call {s['vote_id']} ({s['question']})"})
    cells = {"nomination": n["citation"], "congress": str(n["congress"]), "nominee": n["nominee_name"] or "—", "court": court_label,
             "received": n["received_date"] or "—", "status": STATUS_LABEL[n["status"]], "vote": vote}
    badges = [STATUS_LABEL[n["status"]], court_label] + (["Roll call"] if conf and conf["method"] == "Roll call" else [])
    filters = {"_listing": ["yes"], "congress": [str(n["congress"])], "status": [n["status"]], "category": [n["category"]],
               "court": list(n["court_ids"]), "year": [(n["received_date"] or "")[:4]] if n["received_date"] else [],
               "vote_type": [vote.split(" ")[0].lower() if conf else "none"], "fjc_nid": [n["fjc_nid"]] if n["fjc_nid"] else [],
               "judge_profile": [n["judge_profile_id"]] if n["judge_profile_id"] else [], "fjc_linked": ["yes" if n["fjc_nid"] else "no"]}
    item = {"id": n["id"], "title": title, "subtitle": "Congress.gov nomination", "cells": cells, "badges": badges, "links": links, "kind": "nomination",
            **{k: v for k, v in n.items() if k != "id"}}
    return {"dataset": NOM_DATASET, "id": n["id"], "category": NOM_DATASET, "state": "", "title": title, "source_url": n["congress_url"],
            "item": {"id": n["id"], **{k: v for k, v in item.items() if k != "id"}},
            "detail": {"id": n["id"], "title": title, "subtitle": "Congress.gov nomination", "facts": facts, "links": links},
            "text": f"{n['citation']} {n['nominee_name'] or ''} {n['description'] or ''}", "filters": filters}


def vote_record(v: dict) -> dict:
    noms = v["judicial_nominations"]
    label = noms[0]["nominee"] if len(noms) == 1 else f"{len(noms)} judicial nominations"
    title = f"Senate vote {v['vote_id']}: {v['question']} ({label})"
    split = "; ".join(f"{p['party']}: {p['yea']} yea, {p['nay']} nay, {p['not_voting']} not voting" for p in v["party_split"])
    facts = [["Vote", f"{ordinal(v['congress'])} Congress, session {v['session']}, roll call {v['vote_number']}"], ["Date", v["date"] or "Not recorded"],
             ["Question", v["question"]], ["Result (as published)", v["result_text"]],
             ["Tally", f"{v['yeas']} yea, {v['nays']} nay"], ["By party (as published in the vote record)", split],
             ["Majority required", v["majority_requirement"] or "Not recorded"],
             ["Judicial nominations covered", "; ".join(f"{n['citation']} {n['nominee'] or ''}".strip() for n in noms)],
             ["Other nominations on the same vote", str(v["other_nominations_count"])],
             ["Source", "U.S. Senate roll-call vote XML (senate.gov)"]]
    links = [{"url": v["page_url"], "label": "Senate roll-call vote (senate.gov)"}, {"url": v["source_url"], "label": "Vote XML (senate.gov)"}]
    for n in noms[:20]:
        if n["judge_profile_id"]:
            links.append({"url": f"/judges/{n['judge_profile_id']}", "label": f"Judge profile ({n['nominee'] or n['citation']})"})
    cells = {"vote": v["vote_id"], "date": v["date"] or "—", "question": v["question"], "nominee": label, "result": v["result_text"],
             "yeas": str(v["yeas"]), "nays": str(v["nays"])}
    filters = {"_listing": ["yes"], "congress": [str(v["congress"])], "question": [re.sub(r"[^a-z]+", "_", v["question"].lower()).strip("_")],
               "court": sorted({n["court_id"] for n in noms if n["court_id"]}), "nomination": [n["id"] for n in noms][:200],
               "judge_profile": sorted({n["judge_profile_id"] for n in noms if n["judge_profile_id"]}),
               "year": [(v["date"] or "")[:4]] if v["date"] else [], "en_bloc": ["yes" if len(v["pns"]) > 1 else "no"]}
    rid = f"vote:{v['vote_id']}"
    item = {"id": rid, "title": title, "subtitle": "Senate roll-call vote", "cells": cells, "badges": [v["question"]], "links": links,
            "kind": "vote", **{k: val for k, val in v.items()}}
    return {"dataset": VOTE_DATASET, "id": rid, "category": VOTE_DATASET, "state": "", "title": title, "source_url": v["page_url"],
            "item": item, "detail": {"id": rid, "title": title, "subtitle": "Senate roll-call vote", "facts": facts, "links": links},
            "text": f"{title} {v['title']}", "filters": filters}


def listing_nominations() -> dict:
    return {"page": 1, "limit": 50,
            "columns": [{"key": "nomination", "label": "Nomination"}, {"key": "congress", "label": "Congress"}, {"key": "nominee", "label": "Nominee"},
                        {"key": "court", "label": "Court level"}, {"key": "received", "label": "Received"}, {"key": "status", "label": "Status"},
                        {"key": "vote", "label": "Confirmation vote"}],
            "filters": [{"name": "q", "type": "search", "label": "Search"},
                        {"name": "status", "type": "select", "label": "Status", "options": [{"label": v, "value": k} for k, v in STATUS_LABEL.items()]},
                        {"name": "category", "type": "select", "label": "Court level", "options": [{"label": v, "value": k} for k, v in CATEGORY_LABEL.items()]},
                        {"name": "vote_type", "type": "select", "label": "Confirmation vote", "options": [
                            {"label": "Roll call", "value": "roll"}, {"label": "Voice vote", "value": "voice"},
                            {"label": "Unanimous consent", "value": "unanimous"}, {"label": "No confirmation", "value": "none"}]}]}


def listing_votes() -> dict:
    return {"page": 1, "limit": 50,
            "columns": [{"key": "vote", "label": "Vote"}, {"key": "date", "label": "Date"}, {"key": "question", "label": "Question"},
                        {"key": "nominee", "label": "Nomination"}, {"key": "result", "label": "Result"}, {"key": "yeas", "label": "Yea"},
                        {"key": "nays", "label": "Nay"}],
            "filters": [{"name": "q", "type": "search", "label": "Search"},
                        {"name": "question", "type": "select", "label": "Question", "options": [
                            {"label": "On the nomination", "value": "on_the_nomination"},
                            {"label": "On the cloture motion", "value": "on_the_cloture_motion"}]},
                        {"name": "en_bloc", "type": "select", "label": "En bloc", "options": [{"label": "En bloc", "value": "yes"}, {"label": "Single nomination", "value": "no"}]}]}


def write(dataset: str, label: str, rows: list, built: str, summary: dict, listing: dict) -> None:
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), f"duplicate ids in {dataset}"
    build = {"dataset": dataset, "label": label, "listing_block": listing, "summary": summary, "rows": rows, "built_at": built,
             "inputs": [{"url": "https://api.congress.gov/v3/nomination", "path": "private/acq/judiciary/congress (see private/acq/judiciary/_manifest.jsonl)"},
                        {"url": "https://www.senate.gov/legislative/LIS/roll_call_votes/", "path": "private/acq/judiciary/senate"}]}
    (BUILD / f"{dataset}.json").write_text(json.dumps(build))


if __name__ == "__main__":
    main()
