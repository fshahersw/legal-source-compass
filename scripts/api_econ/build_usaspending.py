"""USAspending.gov federal awards to companies in our sets, linked by exact identifier only → company_federal_awards.

Who is looked up:
  * every firm in sam_exclusions (classification "Firm") that carries a SAM Unique Entity ID (UEI): the UEI is the
    exact key on both sides;
  * companies of company_sec_profiles only where an official record states both the company's SEC CIK and its UEI or
    DUNS (scripts/api_econ/company_identifier_crosswalk.json; each entry must cite that record). SEC filings and
    USAspending publish no common identifier, so the file starts empty and no SEC company is linked by name.

How (api.usaspending.gov v2, no key; requests one second apart):
  1. POST search/spending_by_category/recipient with recipient_search_text = ten UEIs at a time and the full search period
     (FY2008 to FY2026; USAspending's search starts 2007-10-01): recipients whose published UEI equals one of ours
     exactly. Text matches on names are discarded by that equality check.
  2. per matched recipient: GET recipient/<recipient_id>/ (name, UEI, legacy DUNS, parent, location, business types),
     POST search/spending_over_time (fiscal-year obligations by award type, recipient_id filter; the sum is checked
     against step 1), POST search/spending_by_award for contracts, grants, direct payments and other assistance (the five
     largest awards of each; again only rows whose Recipient UEI equals ours; loans appear in the fiscal-year totals).
Amounts are obligations as USAspending publishes them (transactions dated in the period); nothing is estimated.

  python3 -I -B scripts/api_econ/build_usaspending.py --lookup-from-corpus      read sam_exclusions firms (read-only GET;
                                                                                 EXTERNAL_SUPABASE_URL/KEY in the env)
  python3 -I -B scripts/api_econ/build_usaspending.py --acquire [--limit 200]    query USAspending (responses kept)
  python3 -I -B scripts/api_econ/build_usaspending.py                            build
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

DATASET = "company_federal_awards"
API = "https://api.usaspending.gov/api/v2"
PERIOD = [{"start_date": "2007-10-01", "end_date": "2026-09-30"}]
RAW = ec.ACQ / "usaspending"
LOOKUP = ec.BUILD / "lookups" / "sam_exclusion_firms.json"
XWALK = Path(__file__).resolve().parent / "company_identifier_crosswalk.json"
UEI = re.compile(r"^[A-Z0-9]{12}$")
# award type groups USAspending accepts in one award search (loans need other fields and are counted in the
# fiscal-year totals only)
GROUPS = {
    "contracts": ["A", "B", "C", "D"],
    "grants": ["02", "03", "04", "05"],
    "direct_payments": ["06", "10"],
    "other_assistance": ["09", "11"],
}
FIELDS = ["Award ID", "Recipient Name", "Recipient UEI", "Award Amount", "Awarding Agency", "Awarding Sub Agency",
          "Start Date", "End Date", "Description", "generated_internal_id"]


def lookup_from_corpus() -> None:
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_KEY must be set (read-only use)")
    headers = {"apikey": key, "Accept": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    out, offset = [], 0
    flt = urllib.parse.quote(json.dumps({"classification": ["Firm"]}))
    while True:
        q = (f"{url}/rest/v1/corpus_records?select=id,title,detail&dataset=eq.sam_exclusions&filters=cs.{flt}"
             f"&order=id.asc&limit=1000&offset={offset}")
        with urllib.request.urlopen(urllib.request.Request(q, headers=headers), timeout=120) as res:
            page = json.loads(res.read())
        for r in page:
            d = r["detail"] or {}
            uei = (d.get("unique_entity_id") or "").strip()
            if UEI.match(uei):
                out.append({"record_id": r["id"], "name": r["title"], "uei": uei, "exclusion_type": d.get("exclusion_type"),
                            "excluding_agency": d.get("excluding_agency"), "active_date": d.get("active_date"),
                            "termination_date": d.get("termination_date"), "source_url": d.get("source_url")})
        if len(page) < 1000:
            break
        offset += 1000
    LOOKUP.parent.mkdir(parents=True, exist_ok=True)
    LOOKUP.write_text(json.dumps({"read_at": ec.utc_now(), "dataset": "sam_exclusions", "filter": "classification Firm with a 12-character UEI",
                                  "rows": out}))
    print(json.dumps({"firm_records_with_uei": len(out), "distinct_uei": len({r["uei"] for r in out})}))


def post(http: ec.Http, path: str, body: dict) -> dict:
    return json.loads(http.get(f"{API}/{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}))


def acquire(limit: int | None) -> None:
    look = json.loads(LOOKUP.read_text())
    targets: dict[str, dict] = {}
    for r in look["rows"]:
        targets.setdefault(r["uei"], {"uei": r["uei"], "sam": []})["sam"].append(r)
    xw = json.loads(XWALK.read_text()) if XWALK.exists() else {"entries": []}
    for e in xw["entries"]:
        if UEI.match(e.get("uei", "")):
            targets.setdefault(e["uei"], {"uei": e["uei"], "sam": []}).setdefault("sec", []).append(e)
    ueis = sorted(targets)[:limit] if limit else sorted(targets)
    http = ec.Http(min_interval=1.0, timeout=120)
    RAW.mkdir(parents=True, exist_ok=True)
    matched: dict[str, list[dict]] = {}
    # ten UEIs a request: larger text searches were refused with HTTP 503
    for i in range(0, len(ueis), 10):
        batch = ueis[i:i + 10]
        page = 1
        while True:
            doc = post(http, "search/spending_by_category/recipient/", {
                "filters": {"recipient_search_text": batch, "time_period": PERIOD}, "category": "recipient",
                "limit": 100, "page": page})
            for r in doc.get("results", []):
                if r.get("uei") in batch:
                    matched.setdefault(r["uei"], []).append(r)
            if not doc.get("page_metadata", {}).get("hasNext"):
                break
            page += 1
    details = {}
    for uei, recs in sorted(matched.items()):
        entry = {"category": recs, "recipients": [], "awards": {}}
        for r in recs:
            rid = r.get("recipient_id")
            if not rid:
                continue
            prof = json.loads(http.get(f"{API}/recipient/{urllib.parse.quote(rid)}/"))
            over = post(http, "search/spending_over_time/", {"group": "fiscal_year", "filters": {"recipient_id": rid, "time_period": PERIOD}})
            entry["recipients"].append({"recipient_id": rid, "profile": prof, "over_time": over.get("results", [])})
        for g, codes in GROUPS.items():
            try:
                doc = post(http, "search/spending_by_award/", {
                    "filters": {"recipient_search_text": [uei], "award_type_codes": codes, "time_period": PERIOD},
                    "fields": FIELDS, "sort": "Award Amount", "order": "desc", "limit": 5, "page": 1})
            except RuntimeError as e:
                entry.setdefault("errors", []).append({"group": g, "error": str(e)})
                continue
            entry["awards"][g] = [a for a in doc.get("results", []) if a.get("Recipient UEI") == uei]
        details[uei] = entry
    out = {"retrieved_at": ec.utc_now(), "queried_ueis": len(ueis), "matched": len(details), "targets": {u: targets[u] for u in ueis},
           "details": details, "requests": http.requests}
    (RAW / "usaspending_responses.json").write_text(json.dumps(out))
    print(json.dumps({"queried": len(ueis), "matched": len(details), "requests": len(http.requests)}))


def fy_rows(over: list[dict]) -> list[dict]:
    keys = ["Contract_Obligations", "Idv_Obligations", "Grant_Obligations", "Direct_Obligations", "Loan_Obligations", "Other_Obligations"]
    out = []
    for r in over:
        fy = str(r.get("time_period", {}).get("fiscal_year", ""))
        if not fy:
            continue
        vals = {k: r.get(k) for k in keys}
        total = r.get("aggregated_amount")
        if total or any(vals.values()):
            out.append({"fiscal_year": fy, "total": total, **{k.lower(): v for k, v in vals.items()}})
    return out


def money(v) -> str:
    return ec.NOT_RECORDED if v is None else f"${v:,.2f}"


def build() -> tuple[list[dict], list[dict], dict]:
    raw = json.loads((RAW / "usaspending_responses.json").read_text())
    rows = []
    mismatched_totals = []
    for uei, d in sorted(raw["details"].items()):
        target = raw["targets"][uei]
        recips = d["recipients"]
        if not recips:
            continue
        prof = recips[0]["profile"]
        name = prof.get("name") or d["category"][0].get("name") or uei
        category_total = round(sum(r.get("amount") or 0 for r in d["category"]), 2)
        years = []
        for rc in recips:
            years.extend(fy_rows(rc["over_time"]))
        by_fy: dict[str, dict] = {}
        for y in years:
            cur = by_fy.setdefault(y["fiscal_year"], {"fiscal_year": y["fiscal_year"], "total": 0.0})
            for k, v in y.items():
                if k != "fiscal_year" and isinstance(v, (int, float)):
                    cur[k] = round(cur.get(k, 0.0) + v, 2)
        fy_list = [by_fy[k] for k in sorted(by_fy)]
        over_total = round(sum(y["total"] for y in fy_list), 2)
        if abs(over_total - category_total) > 0.01:
            mismatched_totals.append({"uei": uei, "category_total": category_total, "fiscal_year_sum": over_total})
        awards = {g: [{"award_id": a.get("Award ID"), "amount": a.get("Award Amount"), "agency": a.get("Awarding Agency"),
                       "sub_agency": a.get("Awarding Sub Agency"), "start": a.get("Start Date"), "end": a.get("End Date"),
                       "description": a.get("Description"), "url": f"https://www.usaspending.gov/award/{a.get('generated_internal_id')}"}
                      for a in lst] for g, lst in d["awards"].items()}
        sam = target.get("sam", [])
        links = [{"url": f"https://www.usaspending.gov/recipient/{r['recipient_id']}/latest", "label": "Recipient on USAspending"} for r in recips]
        links += [{"url": f"/records/sam_exclusions/{s['record_id']}", "label": f"SAM exclusion record ({s.get('exclusion_type') or 'type not recorded'})"} for s in sam]
        sec = target.get("sec", [])
        links += [{"url": f"/companies/{e['cik']}", "label": "Company profile"} for e in sec]
        loc = prof.get("location") or {}
        place = ", ".join(x for x in [loc.get("city_name"), loc.get("state_code"), loc.get("country_name")] if x) or ec.NOT_RECORDED
        facts = [
            ["Recipient (as USAspending publishes it)", name],
            ["Unique Entity ID (UEI)", uei],
            ["Legacy DUNS", prof.get("duns") or ec.NOT_RECORDED],
            ["Parent", f"{prof.get('parent_name') or ec.NOT_RECORDED} (UEI {prof.get('parent_uei') or ec.NOT_RECORDED})"],
            ["Location", place],
            ["Business types", ", ".join(prof.get("business_types") or []) or ec.NOT_RECORDED],
            ["Obligations FY2008–FY2026", f"{money(category_total)} (transactions dated 2007-10-01 to 2026-09-30)"],
            ["Fiscal years with obligations", ", ".join(y["fiscal_year"] for y in fy_list) or ec.NOT_RECORDED],
            ["How this company is in our sets", "; ".join(
                [f"SAM exclusion record {s['record_id']} names this exact UEI ({s.get('exclusion_type') or 'type not recorded'}, active {s.get('active_date') or 'date not recorded'})" for s in sam]
                + [f"SEC CIK {e['cik']} stated with this UEI in {e.get('source_url')}" for e in sec])],
            ["Reading", "An award listed here is not evidence that it was made while an exclusion was in effect; compare the award dates with the exclusion's active and termination dates."],
            ["Source", "USAspending.gov API v2 (search/spending_by_category/recipient, recipient, search/spending_over_time, search/spending_by_award)"],
        ]
        top = max((a for lst in awards.values() for a in lst), key=lambda a: a["amount"] or 0, default=None)
        rows.append(ec.record(
            DATASET, f"usas:{uei}", name, source_url=links[0]["url"],
            subtitle=f"Federal awards · {money(category_total)} obligated FY2008–FY2026 · UEI {uei}",
            state=loc.get("state_code") or "",
            cells={"recipient": name, "uei": uei, "obligations": money(category_total),
                   "years": f"{fy_list[0]['fiscal_year']}–{fy_list[-1]['fiscal_year']}" if fy_list else ec.NOT_RECORDED,
                   "largest_award": money(top["amount"]) if top else ec.NOT_RECORDED,
                   "link": "SAM exclusion (UEI)" if sam else "SEC (crosswalk)"},
            facts=facts,
            text=f"federal awards contracts grants USAspending {name} {uei}",
            filters={"link": ["sam_exclusion" if sam else "sec_crosswalk"], **({"state": [loc["state_code"]]} if loc.get("state_code") else {})},
            links=links,
            extra={"kind": "federal_awards", "awards": {
                "uei": uei, "duns": prof.get("duns"), "recipient_ids": [r["recipient_id"] for r in recips], "name": name,
                "parent": {"name": prof.get("parent_name"), "uei": prof.get("parent_uei"), "duns": prof.get("parent_duns")},
                "location": loc, "business_types": prof.get("business_types") or [], "total_obligations": category_total,
                "fiscal_years": fy_list, "top_awards": awards, "period": PERIOD[0],
                "sam_exclusions": [{k: s.get(k) for k in ("record_id", "exclusion_type", "excluding_agency", "active_date", "termination_date")} for s in sam],
                "sec": [{"cik": e["cik"], "source_url": e.get("source_url")} for e in sec]}},
        ))
    inputs = [{"url": r["url"], "sha256": r["sha256"]} for r in raw["requests"]]
    return rows, inputs, {"queried_ueis": raw["queried_ueis"], "matched": raw["matched"], "retrieved_at": raw["retrieved_at"],
                          "totals_not_matching_fiscal_year_sum": mismatched_totals}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lookup-from-corpus", action="store_true")
    ap.add_argument("--acquire", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=str(ec.BUILD / "usaspending"))
    a = ap.parse_args(argv)
    if a.lookup_from_corpus:
        lookup_from_corpus()
        return
    if a.acquire:
        acquire(a.limit or None)
        return
    rows, inputs, extra = build()
    xw = json.loads(XWALK.read_text()) if XWALK.exists() else {"entries": []}
    ec.write_build(
        Path(a.out), DATASET, "Federal awards (USAspending.gov) to companies in our SAM exclusion and SEC sets, by exact UEI",
        ec.listing([("recipient", "Recipient"), ("uei", "UEI"), ("obligations", "Obligations FY2008–FY2026"), ("years", "Fiscal years"),
                    ("largest_award", "Largest award"), ("link", "In our sets via")],
                   [("link", "Linked through", {"sam_exclusion": "SAM exclusion (exact UEI)", "sec_crosswalk": "SEC company (official crosswalk)"})]),
        {"source": "https://api.usaspending.gov/", "terms": "USAspending.gov data are U.S. government works; no key or licence is required.",
         "method": __doc__.split("How (")[1].split("\n\n")[0] if "How (" in __doc__ else "",
         "linking": "Exact identifier only: the SAM exclusion record's UEI equals the USAspending recipient's UEI; SEC companies only through official crosswalk entries (none recorded). No name matching.",
         "sec_crosswalk_entries": len(xw["entries"]), "sample": bool(a.limit), **extra},
        rows, inputs)


if __name__ == "__main__":
    main(sys.argv[1:])
