"""Build ftc_enforcement_actions (FTC enforcement CSV/XLSX files, CC0) and ftc_cases (FTC Legal Library).

  python3 -I -B scripts/enrichment/enforcement_actions/build_ftc.py

Reads only private/acq/enforcement_actions/ftc/ and the saved lookups. Every value comes from the FTC file or page
it cites; absent values are "Not recorded". Actions link to an FTC case page record only when the 7-digit matter
number is equal (spaces removed); companies link only on a unique exact normalised name.
"""
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_common as bc  # noqa: E402
import enf_common as ec  # noqa: E402
import extract as ex  # noqa: E402
import ftc_parse  # noqa: E402
import links  # noqa: E402

FILES = os.path.join(ec.ACQ, "ftc", "files")
BASE = "https://www.ftc.gov"
SOURCES = {
    "merger": ("Merger enforcement action", BASE + "/system/files/ftc_gov/data/FTC-Merger-Enforcement-Actions.csv", "FTC-Merger-Enforcement-Actions.csv"),
    "nonmerger": ("Nonmerger (conduct) enforcement action", BASE + "/system/files/ftc_gov/data/FTC-Nonmerger-Enforcement-Actions.csv", "FTC-Nonmerger-Enforcement-Actions.csv"),
    "bc_penalty": ("Competition civil penalty action", BASE + "/system/files/ftc_gov/data/FTC-BC-Civil-Penalty-Actions.csv", "FTC-BC-Civil-Penalty-Actions.csv"),
    "bcp_penalty": ("Consumer protection civil penalty", BASE + "/system/files/ftc_gov/documents/civil_penalty_cases_fy2000-2026.xlsx", "civil_penalty_cases_fy2000-2026.xlsx"),
}
DATASETS_PAGE = BASE + "/policy-notices/open-government/data-sets"
LICENCE = "CC0 1.0 (as listed for the FTC enforcement data sets on data.gov / ftc.gov)"


def matter_key(value):
    """'261 0115' / '2610115' / '261-0115' -> '2610115'; anything that is not exactly 7 digits -> None."""
    digits = re.sub(r"[\s\-]", "", value or "")
    return digits if re.fullmatch(r"\d{7}", digits) else None


def stable_id(prefix, *parts):
    return prefix + hashlib.sha1("|".join(str(p or "") for p in parts).encode()).hexdigest()[:14]


def name_parts(name):
    """Party names inside an FTC matter name, as written: 'A/B' and 'A, In the Matter of' forms."""
    if not name:
        return []
    n = re.sub(r",?\s*(?:In the Matter of|et al\.?|FTC v\.|U\.S\. v\.|FTC, et al\. v\.|FTC et al\. v\.)\s*$", "", name).strip(" ,")
    n = re.sub(r"\s*\((?:Order Violation Investigation|[^)]*)\)\s*$", "", n).strip()
    parts = [p.strip() for p in n.split("/") if p.strip()]
    return parts or [n]


def read_actions():
    rows = []
    for kind in ("merger", "nonmerger", "bc_penalty"):
        label, url, fname = SOURCES[kind]
        raw = ec.read_gz(os.path.join(FILES, fname + ".gz"))
        for i, r in enumerate(ftc_parse.read_csv_rows(raw)):
            rows.append({
                "kind": kind, "kind_label": label, "source_url": url, "line": i + 2,
                "fy": ftc_parse.pick(r, "MatterEnforcementFY", "MatterFYCivilPenalty"),
                "date": ftc_parse.parse_us_date(ftc_parse.pick(r, "MatterEnforcementDate", "MatterCivilPenaltyDate")),
                "date_raw": ftc_parse.pick(r, "MatterEnforcementDate", "MatterCivilPenaltyDate"),
                "matter_number": ftc_parse.pick(r, "MatterNumber"),
                "name": ftc_parse.pick(r, "MatterName"),
                "action_type": ftc_parse.pick(r, "Matter Enforcement Type", "MatterEnforcementType", "MatterCivilPenaltyType"),
                "industry": ftc_parse.pick(r, "MatterIndustry"),
                "page": ftc_parse.strip_hash_link(ftc_parse.pick(r, "Matterhyperlink", "MatterHyperlink")),
                "matter_type": ftc_parse.pick(r, "MatterType"),
            })
    import openpyxl

    label, url, fname = SOURCES["bcp_penalty"]
    wb = openpyxl.load_workbook(io.BytesIO(ec.read_gz(os.path.join(FILES, fname + ".gz"))), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    header = None
    for i, values in enumerate(ws.iter_rows(values_only=True), 1):
        if header is None:
            header = [str(v or "").strip() for v in values]
            continue
        rec = dict(zip(header, values))
        number, name = rec.get("Case Number"), rec.get("Case Name")
        if not number or not name:  # blank spacer and the workbook's total line
            continue
        date = rec.get("Date of Order")
        amount = rec.get("Ordered Amount")
        rows.append({
            "kind": "bcp_penalty", "kind_label": label, "source_url": url, "line": i,
            "fy": None, "date": date.strftime("%Y-%m-%d") if hasattr(date, "strftime") else None,
            "date_raw": str(date) if date is not None else None,
            "matter_number": str(number).strip(), "name": str(name).strip(),
            "action_type": "Civil penalty order", "industry": None, "page": None,
            "office": (str(rec.get("Office")).strip() if rec.get("Office") else None),
            "ordered_amount": float(amount) if isinstance(amount, (int, float)) else None,
            "basis": (str(rec.get("Basis")).strip() if rec.get("Basis") else None),
        })
    return rows


def read_cases():
    """Listing rows (all cases) merged with parsed case pages where read."""
    list_reader = ec.PackReader(os.path.join(ec.ACQ, "ftc", "listing"))
    listed = {}
    for row in list_reader.rows_by_pack():
        for case in ftc_parse.parse_listing(list_reader.get(row["url"]).decode("utf-8", "replace")):
            listed.setdefault(case["url"], {**case, "listing_url": row["url"]})
    case_dir = os.path.join(ec.ACQ, "ftc", "cases")
    pages = {}
    if os.path.exists(os.path.join(case_dir, "index.jsonl")):
        reader = ec.PackReader(case_dir)
        for row in reader.rows_by_pack():
            if row["status"] != 200:
                continue
            parsed = ftc_parse.parse_case(reader.get(row["url"]).decode("utf-8", "replace"), row["url"])
            if parsed:
                parsed["retrieved_at"] = row["retrieved_at"]
                parsed["sha256"] = row["sha256"]
                pages[row["url"]] = parsed
    return listed, pages


FTC_COURT = re.compile(r"^(?:U\.S\. District Court(?: for the)?\s)?(?:(?P<div>Northern|Southern|Eastern|Western|Middle|Central)\s)?District of (?P<state>.+)$")


def court_id_for(name, courts):
    m = FTC_COURT.match((name or "").strip())
    if not m:
        return None
    cid = ex.district_id(m.group("div"), m.group("state").strip())
    return cid if cid and courts.valid(cid) else None


def main():
    companies = links.Companies()
    courts = links.Courts()
    actions = read_actions()
    listed, pages = read_cases()

    # ---------------------------------------------------------------- ftc_cases
    case_rows = []
    case_by_matter = defaultdict(list)
    stats = Counter()
    for path, lc in sorted(listed.items(), key=lambda kv: (kv[1].get("last_updated") or ""), reverse=True):
        url = BASE + path
        page = pages.get(url)
        slug = path.rsplit("/", 1)[-1]
        rid = "ftc-case:" + slug
        matter_numbers = (page or {}).get("matter_numbers") or ([lc["matter_number"]] if lc.get("matter_number") else [])
        keys = sorted({k for k in (matter_key(m) for m in matter_numbers) if k})
        for k in keys:
            case_by_matter[k].append(rid)
        court_names = (page or {}).get("federal_court") or []
        court_links = [(n, court_id_for(n, courts)) for n in court_names]
        docs = (page or {}).get("documents") or []
        docs_sorted = sorted(docs, key=lambda d: d.get("date") or "", reverse=True)
        first_doc = min((d["date"] for d in docs if d.get("date")), default=None)
        name = (page or {}).get("name") or lc.get("name") or slug
        party_links = []
        for part in name_parts(lc.get("name") or name):
            m = companies.match(part)
            if m:
                party_links.append({**m, "as_written": part})
        stats["cases"] += 1
        stats["case_pages_read"] += bool(page)
        stats["with_court_id"] += any(c for _, c in court_links)
        stats["company_links"] += len(party_links)
        link_list = [{"url": url, "label": "FTC case page"}]
        link_list += [{"url": f"/courts/{cid}", "label": f"Court: {courts.name(cid)}"} for _, cid in court_links if cid]
        link_list += [{"url": f"/companies/{p['cik']}", "label": f"SEC registrant: {p['registrant']} (exact name match)"} for p in party_links]
        case = {
            "slug": slug, "url": url, "name": name, "long_title": (page or {}).get("long_title"),
            "status": (page or {}).get("status") or lc.get("status"), "action_type": lc.get("action_type"),
            "last_updated": (page or {}).get("last_updated") or lc.get("last_updated"),
            "matter_numbers": matter_numbers, "matter_keys": keys,
            "civil_action_numbers": (page or {}).get("civil_action_numbers") or [],
            "docket_numbers": (page or {}).get("docket_numbers") or [],
            "courts": [{"name": n, "court_id": c} for n, c in court_links],
            "tags": (page or {}).get("tags") or [],
            "summary": bc.clip((page or {}).get("summary") or lc.get("summary"), 700)[0],
            "documents_total": len(docs), "first_document_date": first_doc,
            "documents": [{"title": d["title"], "url": d["href"] if d["href"].startswith("http") else BASE + d["href"], "date": d.get("date"), "size": d.get("size")} for d in docs_sorted[:40]],
            "companies": party_links, "page_read": bool(page),
            "page_retrieved_at": (page or {}).get("retrieved_at"), "page_sha256": (page or {}).get("sha256"),
        }
        mission = "Competition" if "Competition" in case["tags"] else ("Consumer Protection" if "Consumer Protection" in case["tags"] else None)
        year = (case["last_updated"] or "")[:4]
        case_rows.append(bc.record(
            "ftc_cases", rid, name, source_url=url,
            subtitle=" · ".join(x for x in [case["action_type"], case["status"], f"updated {case['last_updated']}" if case["last_updated"] else None] if x),
            cells={"case": name, "type": case["action_type"] or bc.NOT_RECORDED, "status": case["status"] or bc.NOT_RECORDED,
                   "matter": ", ".join(matter_numbers) or bc.NOT_RECORDED, "updated": case["last_updated"] or bc.NOT_RECORDED,
                   "court": "; ".join(n for n, _ in court_links) or bc.NOT_RECORDED,
                   "documents": case["documents_total"] if page else bc.NOT_RECORDED},
            facts=[("Case", name), ("Full caption (as published)", case["long_title"]), ("FTC matter/file number", matter_numbers),
                   ("Type of action", case["action_type"]), ("Case status", case["status"]), ("Last updated (FTC)", case["last_updated"]),
                   ("Civil action number", case["civil_action_numbers"]), ("Docket number", case["docket_numbers"]),
                   ("Federal court", court_names), ("Tags", case["tags"]),
                   ("Documents listed on the case page", case["documents_total"] if page else None),
                   ("Earliest document date", first_doc), ("Case page read", "yes" if page else "no (listing row only)"),
                   ("Source", "FTC Legal Library, Cases and Proceedings (ftc.gov)")],
            text=" ".join(filter(None, [name, case["long_title"], " ".join(matter_numbers), " ".join(case["civil_action_numbers"]), " ".join(case["docket_numbers"])])),
            filters={"action_type": [case["action_type"]] if case["action_type"] else [], "status": [case["status"]] if case["status"] else [],
                     "year": [year] if year else [], "mission": [mission] if mission else [],
                     "court": [c for _, c in court_links if c], "page_read": ["yes" if page else "no"],
                     "company": sorted({p["cik"] for p in party_links})},
            links=link_list, extra={"ftc_case": case},
        ))

    # ---------------------------------------------------------------- ftc_enforcement_actions
    action_rows = []
    seen_ids = Counter()
    for a in actions:
        key = matter_key(a["matter_number"])
        case_ids = sorted(set(case_by_matter.get(key, []))) if key else []
        party_links = []
        for part in name_parts(a["name"]):
            m = companies.match(part)
            if m:
                party_links.append({**m, "as_written": part})
        base_id = stable_id(f"ftc-action:{a['kind']}:", a["fy"], a["date_raw"], a["matter_number"], a["name"], a["action_type"])
        seen_ids[base_id] += 1
        rid = base_id if seen_ids[base_id] == 1 else f"{base_id}-{seen_ids[base_id]}"
        stats["actions"] += 1
        stats[f"actions_{a['kind']}"] += 1
        stats["actions_with_case_record"] += bool(case_ids)
        stats["action_company_links"] += len(party_links)
        name = a["name"] or "Name withheld by the FTC (confidential action)"
        year = (a["date"] or "")[:4]
        link_list = []
        if a["page"]:
            link_list.append({"url": a["page"], "label": "FTC page for this action (from the data file)"})
        link_list += [{"url": f"/records/ftc_cases/{cid}", "label": "FTC case page record (same matter number)"} for cid in case_ids]
        link_list += [{"url": f"/companies/{p['cik']}", "label": f"SEC registrant: {p['registrant']} (exact name match)"} for p in party_links]
        action = {**{k: a.get(k) for k in ("kind", "kind_label", "fy", "date", "matter_number", "name", "action_type", "industry", "page", "matter_type", "office", "ordered_amount", "basis", "line")},
                  "matter_key": key, "case_ids": case_ids, "companies": party_links}
        action_rows.append(bc.record(
            "ftc_enforcement_actions", rid, name, source_url=a["source_url"],
            subtitle=" · ".join(x for x in [a["kind_label"], a["action_type"], a["date"]] if x),
            cells={"action": name, "kind": a["kind_label"], "type": a["action_type"] or bc.NOT_RECORDED,
                   "date": a["date"] or bc.NOT_RECORDED, "matter": a["matter_number"] or bc.NOT_RECORDED,
                   "amount": bc.money_label(a.get("ordered_amount")) if a["kind"] == "bcp_penalty" else "Not in this file"},
            facts=[("Matter", name), ("Data file", a["kind_label"]), ("Fiscal year (FTC)", a["fy"]), ("Date", a["date"]),
                   ("FTC matter number", a["matter_number"]), ("Enforcement type", a["action_type"]), ("Industry (FTC)", a["industry"]),
                   ("Matter type", a.get("matter_type")), ("Office", a.get("office")),
                   ("Ordered amount", bc.money_label(a.get("ordered_amount")) if a["kind"] == "bcp_penalty" else None),
                   ("Basis (statute as stated)", a.get("basis")), ("Row in data file", a["line"]),
                   ("Source", f"FTC data set ({a['kind_label']}), {LICENCE}")],
            text=" ".join(filter(None, [name, a["matter_number"], a["action_type"], a["industry"], a.get("basis")])),
            filters={"kind": [a["kind"]], "year": [year] if year else [], "type": [a["action_type"]] if a["action_type"] else [],
                     "amount": [bc.amount_bucket(a.get("ordered_amount"))] if a["kind"] == "bcp_penalty" else [],
                     "has_case_page": ["yes" if case_ids else "no"], "company": sorted({p["cik"] for p in party_links})},
            links=link_list, extra={"ftc_action": action},
        ))
    action_rows.sort(key=lambda r: (r["item"]["ftc_action"]["date"] or ""), reverse=True)

    kinds = Counter(r["item"]["ftc_action"]["kind"] for r in action_rows)
    summary_actions = {
        "source": "FTC enforcement data sets: merger, nonmerger and Bureau of Competition civil-penalty actions (CSV) and Bureau of Consumer Protection civil-penalty cases FY2000-2026 (XLSX)",
        "source_page": DATASETS_PAGE, "licence": LICENCE,
        "files": {k: SOURCES[k][1] for k in SOURCES}, "counts_by_file": dict(kinds),
        "coverage": "Merger/nonmerger/BC penalty: FY1996 to the latest quarter in each file; BCP penalties: orders dated FY2000-FY2026",
        "matching": "Linked to an ftc_cases record only when the 7-digit FTC matter number is equal (spaces/hyphens removed); companies only on a unique exact normalised name (extract.normalize_company)",
        "notes": "Merger actions that the FTC lists as Restructured, Abandoned or Fix-it-First carry no date, name or matter number in the file (confidentiality); they are kept as published.",
        "stats": {k: v for k, v in stats.items() if k.startswith("action")},
    }
    bc.write_build("ftc_enforcement_actions", "FTC enforcement actions (merger, conduct and civil-penalty data sets)", action_rows,
                   bc.listing([("action", "Matter"), ("kind", "Data file"), ("type", "Enforcement type"), ("date", "Date"), ("matter", "Matter no."), ("amount", "Ordered amount")],
                              [("kind", "Data file", {k: SOURCES[k][0] for k in SOURCES}),
                               ("amount", "Ordered amount (consumer protection penalties)", bc.AMOUNT_BUCKETS),
                               ("has_case_page", "FTC case page record", {"yes": "Linked by matter number", "no": "No case page record"})]),
                   summary_actions, bc.manifest_inputs(["private/acq/enforcement_actions/ftc/files"]))
    summary_cases = {
        "source": "FTC Legal Library: Cases and Proceedings (listing pages and case pages)",
        "source_page": BASE + "/legal-library/browse/cases-proceedings",
        "terms": "U.S. Government work (ftc.gov); read at one request per 5 s as robots.txt Crawl-delay requires",
        "coverage": f"{stats['cases']} cases listed; {stats['case_pages_read']} case pages read (newest 'Last Updated' first)",
        "matching": "Courts linked only when the page's Federal Court name maps to exactly one current district court id; companies only on a unique exact normalised name",
        "stats": {k: v for k, v in stats.items() if not k.startswith("action")},
    }
    bc.write_build("ftc_cases", "FTC cases and proceedings (Legal Library)", case_rows,
                   bc.listing([("case", "Case"), ("type", "Type of action"), ("status", "Status"), ("matter", "Matter no."), ("updated", "Last updated"), ("court", "Federal court"), ("documents", "Documents")],
                              [("action_type", "Type of action", {"Federal": "Federal court", "Administrative": "Administrative"}),
                               ("status", "Case status", {"Pending": "Pending", "Closed": "Closed"}),
                               ("mission", "Mission (FTC tag)", {"Competition": "Competition", "Consumer Protection": "Consumer Protection"}),
                               ("page_read", "Case page read", {"yes": "Yes", "no": "Listing row only"})]),
                   summary_cases, bc.manifest_inputs(["private/acq/enforcement_actions/ftc/listing", "private/acq/enforcement_actions/ftc/cases"]))
    print(json.dumps(dict(stats)))
    print(json.dumps({"company_match": companies.stats}))


if __name__ == "__main__":
    main()
