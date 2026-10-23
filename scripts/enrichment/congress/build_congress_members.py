"""Build `congress_members`: one record per member of Congress the Congress.gov API lists (current and historical).

  python3 -I -B build_congress_members.py

Reads only:
  private/build/congress/member_list.json          acquire_members.py --list (the /member list, every page)
  private/acq/congress/member_{bioguideId}__*.json.gz   acquire_members.py --details (the /member/{id} responses, unchanged)
  private/acq/congress/_manifest.jsonl             URL, sha256 and retrieval time of every stored response
  private/build/legislation/parsed/*.jsonl.gz      the parsed Bill Status records congress_bills was built from
  private/build/legislation/congress_bills.meta.json   dataset facts of the published bill collection
Writes private/build/congress/congress_members.json (publish_build.py format).

What a record holds: the API's own values (names, birth/death year, per-Congress terms, party history, leadership posts, official
website, portrait URL with its credit, sponsored/cosponsored counts with the date retrieved) and, labelled separately, counts and
cosponsored-measure lists taken from the stored congress_bills records (108th-119th Congress). Exact bioguide id matches only.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cg_api as api  # noqa: E402
import members_common as mc  # noqa: E402
from acquire_members import LIST, stored_detail  # noqa: E402
from corpus_writer import record  # noqa: E402

DATASET = "congress_members"
LABEL = "Members of Congress, current and historical (Congress.gov)"
OUT = api.BUILD / f"{DATASET}.json"
PARSED = api.ROOT / "private" / "build" / "legislation" / "parsed"
BILLS_META = api.ROOT / "private" / "build" / "legislation" / "congress_bills.meta.json"
NOTE_COUNTS = ("Sponsored and cosponsored counts are the totals Congress.gov reports for the member on the date retrieved; they span "
               "every Congress in its data. The lists behind them can include amendments as well as bills and resolutions (a check of 28 "
               "members found amendments in the sponsored list of 22 and in the cosponsored list of 2 of 11), so they are not counts of "
               "bills alone. Cosponsored counts exclude withdrawn cosponsorships (Congress.gov change, April 2026).")
NOTE_BILLS = ("Counts and lists under 'In this collection' come from the stored congress_bills records (GovInfo Bill Status, 108th-119th "
              "Congress) and cover only those measures. A measure counts as sponsored when the member is its first-listed sponsor; "
              "a cosponsorship counts unless it was withdrawn.")


def manifest_by_path() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for e in api.lc.manifest_entries(api.MANIFEST):
        if e.get("path"):
            out[e["path"]] = e  # later entries (a dated refresh of the same path) win
    return out


def newest_detail_entry(bio: str, manifest: dict[str, dict]) -> tuple[dict | None, dict | None]:
    """The newest stored detail response and its manifest entry (retrieval time, sha256)."""
    base = api.stored_name(f"/member/{bio}", {"format": "json"})
    best, best_path = None, None
    for p in [base, *sorted(base.parent.glob(base.name.replace(".json.gz", "__at_*.json.gz")))]:
        if p.exists():
            d = json.loads(gzip.decompress(p.read_bytes())).get("member") or {}
            if best is None or (d.get("updateDate") or "") >= (best.get("updateDate") or ""):
                best, best_path = d, p
    if best is None:
        return None, None
    return best, manifest.get(str(best_path.relative_to(api.ROOT)))


def index_bills() -> tuple[mc.BillIndex, dict]:
    idx = mc.BillIndex()
    for f in sorted(PARSED.glob("*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                idx.add(int(r["congress"]), r["type"], str(r["number"]), r.get("sponsors", []), r.get("cosponsors", []))
    meta = json.loads(BILLS_META.read_text())
    info = {"records": meta["rows"], "rowsSha256": meta["rows_sha256"], "manifestSha256": meta["manifest_sha256"],
            "retrieved": meta["summary"]["retrieved"], "builtAt": meta["built_at"]}
    return idx, info


def fmt_district(d) -> str | None:
    if not isinstance(d, int):
        return None
    return "At large" if d == 0 else str(d)


def build_row(listed: dict, detail: dict | None, entry: dict | None, idx: mc.BillIndex, bills: dict, stats: Counter) -> dict:
    bio = listed["bioguideId"]
    ts = mc.terms(detail, listed)
    ph = mc.party_history(detail, listed)
    nm = mc.names(detail, listed)
    cur = detail.get("currentMember") if detail and isinstance(detail.get("currentMember"), bool) else None
    last = mc.latest_term(ts) or {}
    state_code = last.get("stateCode")
    state_name = last.get("stateName") or mc.text(listed.get("state"))
    district = last.get("district") if isinstance(last.get("district"), int) else (listed.get("district") if isinstance(listed.get("district"), int) else None)
    chamber = last.get("chamber")
    mtype = last.get("memberType")
    party = ph[-1]["party"] if ph else None
    party_abbr = ph[-1].get("abbreviation") if ph else None
    years = mc.years_label(ts, cur)
    sp_api = mc.count_of((detail or {}).get("sponsoredLegislation"))
    co_api = mc.count_of((detail or {}).get("cosponsoredLegislation"))
    retrieved = ((entry or {}).get("retrieved_at") or "")[:10] or None
    website = mc.https_url((detail or {}).get("officialWebsiteUrl"))
    portrait = mc.depiction((detail or {}).get("depiction")) or mc.depiction(listed.get("depiction"))
    billx = idx.member(bio)
    covered = mc.covered_congresses(ts)
    stats["records"] += 1
    stats["detail_fetched" if detail else "detail_missing"] += 1
    stats["current" if cur else "former" if cur is False else "current_unknown"] += 1
    stats["with_portrait"] += 1 if portrait else 0
    stats["with_website"] += 1 if website else 0
    stats["multi_party"] += 1 if len(ph) > 1 else 0
    stats["with_sponsored_in_bills"] += 1 if billx["sponsoredTotal"] else 0
    stats["with_cosponsored_in_bills"] += 1 if billx["cosponsoredTotal"] else 0

    bills_block = {"collection": "congress_bills", "coverage": "108th-119th Congress", "sponsoredRule": "first-listed sponsor",
                   "cosponsoredRule": "not withdrawn", "billsRetrieved": bills["retrieved"], "billsManifestSha256": bills["manifestSha256"],
                   "congressesServedInCollection": covered, "servedOnlyInCollection": mc.fully_covered(ts),
                   **{k: v for k, v in billx.items() if k != "cosponsored"}}
    member = {
        "bioguideId": bio, "names": nm, "birthYear": mc.year((detail or {}).get("birthYear")),
        "deathYear": mc.year((detail or {}).get("deathYear")), "current": cur, "state": state_name, "stateCode": state_code,
        "district": district, "chamber": chamber, "memberType": mtype, "years": years, "terms": ts, "partyHistory": ph,
        "leadership": mc.leadership(detail), "officialWebsite": website, "portrait": portrait,
        "legislation": {"sponsored": sp_api, "cosponsored": co_api, "retrieved": retrieved, "note": NOTE_COUNTS},
        "bills": bills_block,
        "source": {"api": mc.api_url(bio), "bioguide": mc.bio_url(bio), "updateDate": (detail or {}).get("updateDate") or listed.get("updateDate"),
                   "retrievedAt": (entry or {}).get("retrieved_at"), "responseSha256": (entry or {}).get("sha256"),
                   "detailFetched": bool(detail), "listPartyOnly": bool(ph and ph[0].get("listOnly"))},
    }
    title = nm["direct"] or nm["inverted"] or bio
    sub_parts = [mtype or (last.get("chamber") or None), state_name, (f"District {fmt_district(district)}" if district is not None and chamber == "House of Representatives" else None)]
    subtitle = ", ".join(p for p in sub_parts if p) + (f" · {years}" if years else "")
    cells = {"bioguide": bio, "name": nm["inverted"], "display_name": nm["direct"], "party": party, "party_abbreviation": party_abbr,
             "state": state_name, "state_code": state_code, "district": fmt_district(district) if chamber == "House of Representatives" else None,
             "chamber": chamber, "member_type": mtype, "first_year": min((t["startYear"] for t in ts if t.get("startYear")), default=None),
             "years": years, "current": ("yes" if cur else "no") if cur is not None else None, "congresses": len({t["congress"] for t in ts if t.get("congress")}) or None,
             "sponsored_reported": sp_api, "cosponsored_reported": co_api, "retrieved": retrieved}
    facts = [["Bioguide ID", bio], ["Name (as published)", nm["inverted"] or "Not recorded"], ["Name, first name first", nm["direct"] or "Not recorded"],
             ["Currently serving (as published)", {True: "Yes", False: "No", None: "Not recorded"}[cur]],
             ["Latest party (from the API's party history)", party or "Not recorded"],
             ["Party history", "; ".join(f"{p['party']} from {p.get('startYear') or 'year not recorded'}" for p in ph) or "Not recorded"],
             ["State of the latest term", state_name or "Not recorded"], ["Chamber of the latest term", chamber or "Not recorded"],
             ["Member type", mtype or "Not recorded"], ["Years of service (terms as published)", years or "Not recorded"],
             ["Congresses with a term", str(cells["congresses"]) if cells["congresses"] else "Not recorded"],
             ["Born", str(member["birthYear"]) if member["birthYear"] else "Not recorded"],
             ["Died", str(member["deathYear"]) if member["deathYear"] else "Not recorded"],
             ["Official website", website or "Not recorded"],
             ["Sponsored legislation (Congress.gov count, may include amendments)", f"{sp_api:,} on {retrieved}" if sp_api is not None and retrieved else "Not recorded"],
             ["Cosponsored legislation (Congress.gov count, may include amendments)", f"{co_api:,} on {retrieved}" if co_api is not None and retrieved else "Not recorded"],
             ["Source", "Congress.gov API v3 (Library of Congress), /member and /member/{bioguideId}"]]
    links = [{"url": mc.bio_url(bio), "label": "Biographical Directory of the United States Congress"}]
    if website:
        links.append({"url": website, "label": "Official website"})
    links.append({"url": f"/law/legislation/members/{bio}", "label": "Member page in this workspace"})
    words = [bio, nm["inverted"], nm["direct"], nm["first"], nm["last"], nm["nick"], state_name, party] + [p.get("direct") or p.get("inverted") for p in nm["previous"]]
    words += [p["party"] for p in ph] + [t.get("stateName") for t in ts]
    served = sorted({mc.CHAMBER_SHORT[t["chamber"]] for t in ts if t.get("chamber") in mc.CHAMBER_SHORT})
    filters = {"chamber": served, "state": sorted({t["stateCode"] for t in ts if t.get("stateCode")}),
               "party": sorted({p["party"] for p in ph}), "current": ["yes" if cur else "no"] if cur is not None else [],
               "congress": [str(c) for c in sorted({t["congress"] for t in ts if t.get("congress")})],
               "member_type": sorted({t["memberType"] for t in ts if t.get("memberType")}),
               "name": sorted({k for k in (mc.norm(nm["inverted"]), mc.norm(nm["direct"])) if k}),
               "last_name": [mc.norm(nm["last"])] if nm["last"] else [],
               "has_bills": ["sponsored"] * bool(billx["sponsoredTotal"]) + ["cosponsored"] * bool(billx["cosponsoredTotal"])}
    if cur and state_code:
        filters["represents"] = [state_code]
    filters = {k: v for k, v in filters.items() if v}
    row = record(DATASET, bio, title, source_url=mc.api_url(bio), cells=cells, facts=facts, text=" ".join(w for w in words if w),
                 filters=filters, subtitle=subtitle, badges=[b for b in (party, "Current" if cur else None) if b], links=links,
                 extra={"kind": "congress_member"})
    row["detail"]["member"] = member
    row["detail"]["cosponsored"] = {"bioguideId": bio, "collection": "congress_bills", "coverage": "108th-119th Congress",
                                    "rule": "cosponsorships not withdrawn; numbers per Congress and measure type",
                                    "byCongress": billx["cosponsored"], "total": billx["cosponsoredTotal"]}
    return row



def main() -> None:
    lst = json.loads(LIST.read_text())
    listed = {m["bioguideId"]: m for m in lst["members"]}
    manifest = manifest_by_path()
    idx, bills = index_bills()
    rows, stats = [], Counter()
    digest = hashlib.sha256()
    for bio in sorted(listed):
        detail, entry = newest_detail_entry(bio, manifest)
        if detail and detail.get("bioguideId") != bio:
            raise SystemExit(f"{bio}: the stored detail names {detail.get('bioguideId')}")
        rows.append(build_row(listed[bio], detail, entry, idx, bills, stats))
        digest.update(f"{bio} {(entry or {}).get('sha256')}\n".encode())
    rows.sort(key=lambda r: (r["filters"].get("current", ["zz"])[0] != "yes", mc.norm(r["item"]["cells"].get("name")), r["id"]))
    unknown = sorted((set(idx.sponsored) | set(idx.cosponsored) | set(idx.withdrawn)) - set(listed))
    if unknown:
        raise SystemExit(f"bill records name bioguide ids that are not members: {unknown[:5]}")
    counts = {k: Counter() for k in ("chamber", "state", "party", "current", "congress")}
    labels: dict[str, str] = {}
    for r in rows:
        for k in counts:
            for v in r["filters"].get(k, []):
                counts[k][v] += 1
        for t in r["detail"]["member"]["terms"]:
            if t.get("stateCode") and t.get("stateName"):
                labels.setdefault(t["stateCode"], t["stateName"])
    cur_n = counts["current"]["yes"]
    listing = {
        "page": 1, "limit": 50,
        "columns": [{"key": "name", "label": "Member"}, {"key": "party", "label": "Party"}, {"key": "state", "label": "State"},
                    {"key": "district", "label": "District"}, {"key": "chamber", "label": "Chamber"}, {"key": "years", "label": "Years"}],
        "filters": [
            {"name": "q", "type": "search", "label": "Search"},
            {"name": "current", "type": "select", "label": "Status", "options": [
                {"label": "Currently serving", "value": "yes", "count": counts["current"]["yes"]},
                {"label": "Not currently serving", "value": "no", "count": counts["current"]["no"]}]},
            {"name": "chamber", "type": "select", "label": "Chamber served in", "options": [
                {"label": "Senate", "value": "senate", "count": counts["chamber"]["senate"]},
                {"label": "House of Representatives", "value": "house", "count": counts["chamber"]["house"]}]},
            {"name": "state", "type": "select", "label": "State or territory served", "options": [
                {"label": labels.get(c, c), "value": c, "count": n} for c, n in sorted(counts["state"].items(), key=lambda kv: labels.get(kv[0], kv[0]))]},
            {"name": "party", "type": "select", "label": "Party (any in party history)", "options": [
                {"label": p, "value": p, "count": n} for p, n in sorted(counts["party"].items(), key=lambda kv: -kv[1])]},
            {"name": "congress", "type": "select", "label": "Congress served in", "options": [
                {"label": f"{mc.ordinal(int(c))} Congress", "value": c, "count": n}
                for c, n in sorted(counts["congress"].items(), key=lambda kv: -int(kv[0]))]},
        ],
    }
    ts_all = [t for r in rows for t in r["detail"]["member"]["terms"] if t.get("congress")]
    summary = {
        "source": "Congress.gov API v3 (Library of Congress), https://api.congress.gov/v3/member and /member/{bioguideId}; docs https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/MemberEndpoint.md",
        "licence": "Congress.gov data are U.S. Government works (public domain); portraits are shown by their Congress.gov URL with the credit the API gives",
        "retrieved": max((r["detail"]["member"]["source"].get("retrievedAt") or "")[:10] for r in rows) or None,
        "records": len(rows), "listed_count": lst["listed_count"], "list_retrieved": lst["retrieved_at"][:10],
        "scope": f"Every member the API lists ({lst['listed_count']}): service from the {min(t['congress'] for t in ts_all)}th through the {max(t['congress'] for t in ts_all)}th Congress; {cur_n} currently serving (the API's currentMember flag).",
        "name_rule": "Names are the API's invertedOrderName (last name first) and directOrderName; previous names are listed with the dates the API gives. The only change to a published name is that a run of spaces inside it is shown as one space.",
        "party_rule": "Party history is the API's partyHistory (name, abbreviation, start year). The party beside a name is the latest entry. The end of an earlier party is not shown because the API does not give it.",
        "term_rule": "Terms are the API's per-Congress terms (chamber, member type, state, district, start and end year as published). A current term has no end year.",
        "count_rule": NOTE_COUNTS, "bills_rule": NOTE_BILLS,
        "bills_collection": bills, "committee_membership": "The Congress.gov API publishes no committee membership for members; none is shown.",
        "contact_rule": "Office addresses and telephone numbers the API also publishes are not stored; the official website is.",
        "link_rule": "Bill pages link to a member only when the bill's sponsor or cosponsor bioguide id equals a record id here (exact match).",
        "stats": dict(sorted(stats.items())),
        "bill_index": {"bills_read": idx.bills, "no_sponsor": idx.no_sponsor, "multi_sponsor": idx.multi_sponsor,
                       "sponsor_without_id": idx.sponsor_without_id, "cosponsor_without_id": idx.cosponsor_without_id},
        "details_digest": digest.hexdigest(),
    }
    inputs = [{"url": "https://api.congress.gov/v3/member", "path": str(LIST.relative_to(api.ROOT)), "sha256": hashlib.sha256(LIST.read_bytes()).hexdigest()},
              {"url": "https://api.congress.gov/v3/member/{bioguideId}", "path": "private/acq/congress/member_*.json.gz", "sha256": digest.hexdigest()},
              {"url": "congress_bills (GovInfo Bill Status)", "path": str(BILLS_META.relative_to(api.ROOT)), "sha256": bills["rowsSha256"]}]
    build = {"dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summary, "rows": rows, "built_at": api.now_utc(), "inputs": inputs}
    OUT.write_text(json.dumps(build, ensure_ascii=False))
    print(json.dumps({"records": len(rows), "bytes": OUT.stat().st_size, **stats}))


if __name__ == "__main__":
    main()
