"""Build `congress_committees`: one record per committee and subcommittee the Congress.gov API lists (current and historical).

  python3 -I -B build_congress_committees.py

Reads only:
  private/build/congress/committee_list.json              acquire_committees.py --list
  private/build/congress/committee_congress_lists.json    acquire_committees.py --congress-lists (codes per Congress, plus the
                                                          newest list entry of every code seen)
  private/acq/congress/committee_{chamber}_{code}__*.json.gz   acquire_committees.py --details (responses, unchanged)
  private/acq/congress/_manifest.jsonl
Writes private/build/congress/congress_committees.json (publish_build.py format).

Rules: values are the API's own (name and type from the list, current flag, website, parent, subcommittees, name history and
counts from the detail). The Congress numbers a committee covers are the /committee/{congress} lists that name its code; a
Congress that does not list it is a gap, never filled in. A committee the API publishes only in per-Congress lists is kept from
that list entry and says so. The API publishes no committee membership, so the dataset holds none.
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
import committees_common as cc  # noqa: E402
import members_common as mc  # noqa: E402
from acquire_committees import CONGRESS_LISTS, LIST, stored_detail  # noqa: E402
from build_congress_members import manifest_by_path  # noqa: E402
from corpus_writer import record  # noqa: E402

DATASET = "congress_committees"
LABEL = "Congressional committees and subcommittees, current and historical (Congress.gov)"
OUT = api.BUILD / f"{DATASET}.json"
NO_MEMBERS = ("The Congress.gov API has a committee list, committee detail (parent, subcommittees, website, name history, related "
              "counts) and committee reports, bills, communications and nominations, but no committee-membership endpoint. No "
              "membership is stored or shown, and no other source is used for it.")


def newest_entry(chamber: str, code: str, manifest: dict[str, dict]) -> tuple[dict | None, dict | None]:
    base = api.stored_name(f"/committee/{chamber}/{code}", {"format": "json"})
    best, best_path = None, None
    for p in [base, *sorted(base.parent.glob(base.name.replace(".json.gz", "__at_*.json.gz")))]:
        if p.exists():
            d = json.loads(gzip.decompress(p.read_bytes())).get("committee") or {}
            if best is None or (d.get("updateDate") or "") >= (best.get("updateDate") or ""):
                best, best_path = d, p
    return (best, manifest.get(str(best_path.relative_to(api.ROOT)))) if best is not None else (None, None)


def build_row(item: dict, detail: dict | None, entry: dict | None, codes: set[str], by_congress: dict[str, list[str]],
              in_main_list: bool, stats: Counter) -> dict:
    code = item["systemCode"]
    chamber = item.get("chamber")
    parent = cc.parent_of(detail, codes) or cc.parent_of(item, codes)
    level = "subcommittee" if cc.is_subcommittee(code, parent) else "committee"
    ctype = mc.text((detail or {}).get("type")) or mc.text(item.get("committeeTypeCode"))
    current = (detail or {}).get("isCurrent") if isinstance((detail or {}).get("isCurrent"), bool) else None
    website = mc.https_url((detail or {}).get("committeeWebsiteUrl"))
    subs = cc.subcommittees(detail) or cc.subcommittees(item)
    for s in subs:
        s["listed"] = s["systemCode"] in codes
    hist = cc.history(detail)
    counts = cc.api_counts(detail)
    congresses = cc.congresses_listed(code, by_congress)
    label = cc.congress_ranges(congresses)
    name = mc.text(item.get("name")) or code
    stats["records"] += 1
    stats[level] += 1
    stats["detail_fetched" if detail else "detail_missing"] += 1
    stats["current" if current else "historical" if current is False else "current_unknown"] += 1
    stats["with_website"] += 1 if website else 0
    stats["with_congress_coverage"] += 1 if congresses else 0
    stats["parent_not_in_list"] += 1 if parent and not parent["listed"] else 0
    stats["only_in_congress_lists"] += 0 if in_main_list else 1
    committee = {
        "systemCode": code, "name": name, "chamber": chamber, "type": ctype, "level": level, "current": current, "website": website,
        "parent": parent, "subcommittees": subs, "congresses": congresses, "history": hist, "counts": counts,
        "listedInMainList": in_main_list,
        "source": {"api": f"https://api.congress.gov/v3/committee/{cc.chamber_path(chamber) or 'house'}/{code}",
                   "updateDate": (detail or {}).get("updateDate") or item.get("updateDate"),
                   "retrievedAt": (entry or {}).get("retrieved_at"), "responseSha256": (entry or {}).get("sha256"),
                   "detailFetched": bool(detail)},
    }
    cells = {"system_code": code, "name": name, "chamber": chamber, "type": ctype, "level": level,
             "current": ("yes" if current else "no") if current is not None else None,
             "parent_code": parent["systemCode"] if parent else None, "parent_name": parent["name"] if parent else None,
             "subcommittees": len(subs) if (detail is not None or subs) else None, "congresses": label,
             "first_congress": congresses[0] if congresses else None, "last_congress": congresses[-1] if congresses else None,
             "website": website}
    facts = [["System code", code], ["Name (as published)", name], ["Chamber", chamber or "Not recorded"],
             ["Level", "Subcommittee" if level == "subcommittee" else "Committee"], ["Type (as published)", ctype or "Not recorded"],
             ["Current (as published)", {True: "Yes", False: "No (historical)", None: "Not recorded"}[current]],
             ["Parent committee", f"{parent['name'] or 'Name not recorded'} ({parent['systemCode']})" if parent else "None recorded"],
             ["Subcommittees", str(len(subs)) if subs else ("None listed" if detail is not None else "Not recorded")],
             ["Congresses that list it", label or "Not recorded"],
             ["Official website", website or "Not recorded"],
             ["Reports / bills / communications / nominations (API counts)",
              " / ".join(f"{counts[k]:,}" if k in counts else "Not recorded" for k in cc.COUNT_KEYS)],
             ["Committee membership", "Not published by the Congress.gov API"],
             ["Source", "Congress.gov API v3 (Library of Congress), /committee and /committee/{chamber}/{systemCode}"]]
    links = [{"url": f"/law/legislation/committees/{code}", "label": "Committee page in this workspace"}]
    if website:
        links.insert(0, {"url": website, "label": "Official website"})
    words = [code, name, parent["name"] if parent else None, ctype] + [h.get("officialName") for h in hist] + [h.get("libraryOfCongressName") for h in hist]
    filters = {"chamber": [cc.chamber_path(chamber)] if cc.chamber_path(chamber) else [], "type": [ctype] if ctype else [], "level": [level],
               "current": ["yes" if current else "no"] if current is not None else [], "congress": [str(c) for c in congresses],
               "parent": [parent["systemCode"]] if parent else [], "name": [mc.norm(name)]}
    filters = {k: v for k, v in filters.items() if v}
    sub = ", ".join(x for x in (chamber, ctype if ctype and ctype != "Subcommittee" else None, "Subcommittee" if level == "subcommittee" else None, label) if x)
    row = record(DATASET, code, name, source_url=committee["source"]["api"], cells=cells, facts=facts, text=" ".join(w for w in words if w),
                 filters=filters, subtitle=sub, badges=[b for b in (chamber, ctype, "Current" if current else None) if b], links=links,
                 extra={"kind": "congress_committee"})
    row["detail"]["committee"] = committee
    return row


def main() -> None:
    lst = json.loads(LIST.read_text())
    cl = json.loads(CONGRESS_LISTS.read_text())
    by_congress, extra_items = cl["by_congress"], cl.get("items", {})
    items = {c["systemCode"]: c for c in lst["committees"]}
    in_main = set(items)
    for code, it in extra_items.items():  # published only in per-Congress lists
        items.setdefault(code, it)
    codes = set(items)
    manifest = manifest_by_path()
    rows, stats = [], Counter()
    digest = hashlib.sha256()
    for code in sorted(items):
        item = items[code]
        chamber = cc.chamber_path(item.get("chamber"))
        detail, entry = newest_entry(chamber, code, manifest) if chamber else (None, None)
        if detail and mc.text(detail.get("systemCode")) != code:
            raise SystemExit(f"{code}: the stored detail names {detail.get('systemCode')}")
        rows.append(build_row(item, detail, entry, codes, by_congress, code in in_main, stats))
        digest.update(f"{code} {(entry or {}).get('sha256')}\n".encode())
    rows.sort(key=lambda r: (r["filters"].get("current", ["zz"])[0] != "yes", r["filters"]["level"][0] != "committee",
                             r["filters"].get("chamber", ["zz"])[0], mc.norm(r["title"]), r["id"]))
    counts = {k: Counter() for k in ("chamber", "type", "level", "current", "congress")}
    for r in rows:
        for k in counts:
            for v in r["filters"].get(k, []):
                counts[k][v] += 1
    listing = {
        "page": 1, "limit": 50,
        "columns": [{"key": "name", "label": "Committee"}, {"key": "chamber", "label": "Chamber"}, {"key": "type", "label": "Type"},
                    {"key": "parent_name", "label": "Parent"}, {"key": "congresses", "label": "Congresses"}],
        "filters": [
            {"name": "q", "type": "search", "label": "Search"},
            {"name": "current", "type": "select", "label": "Status", "options": [
                {"label": "Current", "value": "yes", "count": counts["current"]["yes"]},
                {"label": "Historical", "value": "no", "count": counts["current"]["no"]}]},
            {"name": "chamber", "type": "select", "label": "Chamber", "options": [
                {"label": l, "value": v, "count": counts["chamber"][v]} for v, l in (("house", "House"), ("senate", "Senate"), ("joint", "Joint"))]},
            {"name": "level", "type": "select", "label": "Level", "options": [
                {"label": "Committees", "value": "committee", "count": counts["level"]["committee"]},
                {"label": "Subcommittees", "value": "subcommittee", "count": counts["level"]["subcommittee"]}]},
            {"name": "type", "type": "select", "label": "Type", "options": [
                {"label": t, "value": t, "count": n} for t, n in sorted(counts["type"].items(), key=lambda kv: -kv[1])]},
            {"name": "congress", "type": "select", "label": "Congress", "options": [
                {"label": f"{mc.ordinal(int(c))} Congress", "value": c, "count": n} for c, n in sorted(counts["congress"].items(), key=lambda kv: -int(kv[0]))]},
        ],
    }
    cong_nums = sorted(int(c) for c in by_congress)
    summary = {
        "source": "Congress.gov API v3 (Library of Congress), https://api.congress.gov/v3/committee, /committee/{congress} and /committee/{chamber}/{systemCode}; docs https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/CommitteeEndpoint.md",
        "licence": "Congress.gov data are U.S. Government works (public domain)",
        "retrieved": max(((r["detail"]["committee"]["source"].get("retrievedAt") or "")[:10] for r in rows)) or None,
        "records": len(rows), "listed_count": lst["listed_count"], "list_unique_codes": lst["unique_codes"], "list_duplicates": lst["duplicates"],
        "list_retrieved": lst["retrieved_at"][:10],
        "scope": f"Every committee and subcommittee the API lists ({lst['unique_codes']} distinct codes; {lst['listed_count']} rows, {lst['duplicates']} repeated) plus {len(items) - len(in_main)} the API names only in per-Congress lists; the per-Congress lists run from the {mc.ordinal(cong_nums[0])} to the {mc.ordinal(cong_nums[-1])} Congress.",
        "level_rule": "A committee the API gives a parent is a subcommittee; otherwise a system code ending in 00 is a full committee and any other ending a subcommittee (the API's documented rule). Older committees carry an authority-style id (n79043123) and are committees unless the API names a parent.",
        "name_rule": "Names are the API's; the only change is that a run of spaces inside a published name is shown as one space.",
        "type_rule": "Type is the API's committeeTypeCode/type as published; a subcommittee often carries its parent's type.",
        "congress_rule": "Congresses covered are those whose /committee/{congress} list names the committee's code. A Congress that does not list it is a gap, not filled in; committees named in no per-Congress list show 'Not recorded'.",
        "history_rule": "Name history is the API's history (official and Library of Congress name, start and end dates, type, establishing authority); a date the API omits is absent.",
        "membership_rule": NO_MEMBERS, "publishes_membership": cc.PUBLISHES_MEMBERSHIP,
        "stats": dict(sorted(stats.items())), "details_digest": digest.hexdigest(),
    }
    inputs = [{"url": "https://api.congress.gov/v3/committee", "path": str(LIST.relative_to(api.ROOT)), "sha256": hashlib.sha256(LIST.read_bytes()).hexdigest()},
              {"url": "https://api.congress.gov/v3/committee/{congress}", "path": str(CONGRESS_LISTS.relative_to(api.ROOT)), "sha256": hashlib.sha256(CONGRESS_LISTS.read_bytes()).hexdigest()},
              {"url": "https://api.congress.gov/v3/committee/{chamber}/{systemCode}", "path": "private/acq/congress/committee_*.json.gz", "sha256": digest.hexdigest()}]
    build = {"dataset": DATASET, "label": LABEL, "listing_block": listing, "summary": summary, "rows": rows, "built_at": api.now_utc(), "inputs": inputs}
    OUT.write_text(json.dumps(build, ensure_ascii=False))
    print(json.dumps({"records": len(rows), "bytes": OUT.stat().st_size, **stats}))


if __name__ == "__main__":
    main()
