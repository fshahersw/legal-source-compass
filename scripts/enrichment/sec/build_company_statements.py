"""Build company_sec_statements and company_sec_segments for the registrants in company_sec_profiles.

Inputs (SEC EDGAR via sec_http, cached under private/acq/sec-companies): data.sec.gov submissions and XBRL companyfacts; for
each registrant the two latest 10-K (or 20-F) and two latest 10-Q filings' XBRL instance documents, the latest annual
filing's label linkbase and its primary document (for the business description and the website the company names).

company_sec_statements (one record per registrant): profile (tickers, exchanges, SIC, state of incorporation, fiscal year
end, filer category, the website and investor-relations site the company names in its latest annual report, and the
opening of the Item 1 business section quoted from that report), the three financial statements annual and quarterly
(statements.py rules), margins and growth, the logo when one was acquired from the company's own site, and the filing list.
company_sec_segments (one record per registrant with dimensional facts): revenue and operating income by business
segment, product or service, and geography (segments.py rules) with the members-versus-total check per period.

    python3 -I -B scripts/enrichment/sec/build_company_statements.py
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import fetch_xbrl as fx  # noqa: E402
import sec_http as h  # noqa: E402
import segments as sg  # noqa: E402
import statements as st  # noqa: E402

BUILD = h.ROOT / "private" / "build" / "sec_statements"
LOOK = BUILD / "lookups"
ANNUAL = {"10-K", "20-F", "40-F", "10-KT"}
PERIODIC = ANNUAL | {"10-Q", "10-K/A", "10-Q/A"}
LISTED_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "40-F", "6-K", "DEF 14A", "S-1", "S-4", "424B2"}
STATE_NAMES = {}
SOURCE_NOTE = "SEC EDGAR: data.sec.gov submissions and XBRL companyfacts, and the registrant's own 10-K/10-Q/20-F filings on www.sec.gov"
NO_PRICE = "No market price source is connected; prices are not shown."


def archive_base(cik: str, accn: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accn.replace('-', '')}/"


def filing_index_url(cik: str, accn: str) -> str:
    return f"{archive_base(cik, accn)}{accn}-index.htm"


def recent_filings(sub: dict) -> list[dict]:
    r = sub.get("filings", {}).get("recent", {})
    out = []
    for i, form in enumerate(r.get("form", [])):
        out.append({"form": form, "accn": r["accessionNumber"][i], "date": r["filingDate"][i], "report_date": r.get("reportDate", [""] * (i + 1))[i] or None,
                    "primary": r["primaryDocument"][i], "items": (r.get("items") or [""] * (i + 1))[i] or "",
                    "xbrl": bool((r.get("isXBRL") or [0] * (i + 1))[i]), "description": (r.get("primaryDocDescription") or [""] * (i + 1))[i] or ""})
    return out


def instance_and_labels(cik: str, accn: str, primary: str) -> tuple[str | None, str | None]:
    idx = h.get_json(archive_base(cik, accn) + "index.json", kind="filing_index")
    if not idx:
        return None, None
    names = [i["name"] for i in idx.get("directory", {}).get("item", [])]
    stem = re.sub(r"\.htm[l]?$", "", primary or "")
    instance = next((n for n in names if n == f"{stem}_htm.xml"), None)
    if not instance:
        xmls = [n for n in names if n.endswith(".xml") and not re.search(r"_(cal|def|lab|pre)\.xml$|FilingSummary\.xml$", n)]
        instance = xmls[0] if len(xmls) == 1 else next((n for n in xmls if n.endswith("_htm.xml")), None)
    labels = next((n for n in names if n.endswith("_lab.xml")), None)
    return instance, labels


TAG = re.compile(r"<[^>]+>")


def html_text(data: bytes) -> str:
    text = data.decode("utf-8", errors="replace")
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</h\d>", "\n", text)
    text = TAG.sub(" ", text)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


DESCRIBE = ("You read the Item 1 (Business) section of a company's annual report. Copy, word for word, one to three consecutive "
            "sentences from the text that best say what the company is and what it does (products, services, markets). Do not "
            "paraphrase, shorten or join non-consecutive sentences. Skip forward-looking-statement notices, defined terms, "
            "tables of contents and cross-references. Answer only JSON: {\"quote\": \"...\"} or {\"quote\": null} if none fits.")


def business_windows(text: str) -> list[str]:
    """Text following each Item 1 (Business) heading that is followed by prose (tables of contents are skipped)."""
    out = []
    for m in re.finditer(r"(?i)items?\s*1\s*\.?\s*(?:(?:and|&)\s*2\s*\.?\s*)?[.:\-–—]?\s*business\b\.?", text):
        rest = text[m.end(): m.end() + 9000]
        if sum(len(p) for p in rest.split("\n") if len(p.strip()) > 120) >= 400 and not re.match(r"(?is)\s*item\s*1a", rest[:300]):
            out.append(rest)
    return out


def business_excerpt(text: str) -> str | None:
    """1-3 consecutive sentences from Item 1 (Business), chosen by a small model and kept only when they appear verbatim."""
    import llm

    for window in business_windows(text)[:2]:
        answer = llm.ask_json(DESCRIBE, window, max_tokens=500)
        quote = answer.get("quote") if isinstance(answer, dict) else None
        if isinstance(quote, str) and llm.verbatim(quote, window) and len(quote) <= 1200:
            return llm.normalize(quote)
    return None


DOMAIN = r"((?:https?://)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|us|health|bio|io|de|ch|co\.uk|com\.au))"


def websites(text: str) -> tuple[str | None, str | None]:
    """The company's website and investor site as its annual report names them (most frequent near 'website' wording)."""
    found = Counter()
    for m in re.finditer(r"(?i)(?:web\s?site|internet (?:site|address)|investor relations)[^.\n]{0,140}?" + DOMAIN, text):
        d = m.group(1).lower()
        d = re.sub(r"^https?://", "", d)
        if any(x in d for x in ("sec.gov", "xbrl", "fasb", "pcaob", "nyse", "nasdaq", "federalregister", "fda.gov", "gov")):
            continue
        found[d] += 1
    if not found:
        return None, None
    ir = next((d for d, _ in found.most_common() if "investor" in d or d.startswith("ir.")), None)
    site = next((d for d, _ in found.most_common() if d != ir), None)
    return site, ir


def compact_cell(c: dict | None):
    if not c:
        return None
    flag = 2 if c.get("computed") else 1 if c.get("derived") else 0
    v = c["v"]
    v = round(v, 4) if isinstance(v, float) and not float(v).is_integer() else (int(v) if isinstance(v, float) else v)
    return [v, c.get("accn"), c.get("concept"), flag]


def compact_statements(s: dict) -> dict:
    lines = {}
    for key, line in s["lines"].items():
        meta = st.LINE_INDEX.get(key)
        lines[key] = {"label": meta[1] if meta else "Free cash flow" if key == "fcf" else key,
                      "statement": meta[2] if meta else "cashflow", "unit": line["unit"],
                      "annual": [compact_cell(c) for c in line["annual"]], "quarterly": [compact_cell(c) for c in line["quarterly"]]}
    return {"annual_periods": s["annual_periods"], "quarterly_periods": s["quarterly_periods"], "lines": lines,
            "margins": s["margins"], "growth": s["growth"]}


def build_segments(cik: str, filings: list[dict]):
    annual = [f for f in filings if f["form"] in ANNUAL and f["xbrl"]][:2]
    quarterly = [f for f in filings if f["form"] == "10-Q" and f["xbrl"]][:2]
    labels: dict[str, str] = {}
    used, dims, totals = [], [], []
    for i, f in enumerate(annual + quarterly):
        instance, label_file = instance_and_labels(cik, f["accn"], f["primary"])
        if not instance:
            continue
        data = h.get(archive_base(cik, f["accn"]) + instance, kind="xbrl_instance", suffix=".xml", compress=True, timeout=180)
        if not data:
            continue
        if i == 0 and label_file:
            lab = h.get(archive_base(cik, f["accn"]) + label_file, kind="xbrl_labels", suffix=".xml", compress=True, timeout=180)
            if lab:
                labels = sg.parse_labels(lab)
        contexts, facts = sg.parse_instance(data)
        d, t = sg.segment_facts(contexts, facts, f["form"])
        for x in d + t:
            x["accn"] = f["accn"]
            x["filed"] = f["date"]
        dims += d
        totals += t
        used.append({"form": f["form"], "accn": f["accn"], "date": f["date"], "url": archive_base(cik, f["accn"]) + instance})
    if not dims:
        return None, used
    # latest filing wins per (axis, member, concept, period)
    best: dict[tuple, dict] = {}
    for x in sorted(dims, key=lambda x: x["filed"]):
        best[(x["axis"], x["member"], x["concept"], x["start"], x["end"], x["unit"])] = x
    tbest: dict[tuple, dict] = {}
    for x in sorted(totals, key=lambda x: x["filed"]):
        tbest[(x["concept"], x["start"], x["end"], x["unit"])] = x
    dims, totals = list(best.values()), list(tbest.values())
    checks = sg.sum_checks(dims, totals)
    axes_out = []
    for axis in sorted({x["axis"] for x in dims}, key=lambda a: list(sg.AXES).index(a)):
        rows = [x for x in dims if x["axis"] == axis]
        for concept_group, group_name in ((sg.REVENUE, "revenue"), (sg.OPERATING, "operating_income")):
            crow = [x for x in rows if x["concept"] in concept_group]
            if not crow:
                continue
            # Net sales of goods only stands in for revenue on an axis that tags no revenue concept proper.
            if any(x["concept"] != "RevenueFromSaleOfGoods" for x in crow):
                crow = [x for x in crow if x["concept"] != "RevenueFromSaleOfGoods"]
            concept = Counter(x["concept"] for x in crow).most_common(1)[0][0]
            crow = [x for x in crow if x["concept"] == concept]
            members = sorted({x["member"] for x in crow}, key=lambda m: -max(x["value"] for x in crow if x["member"] == m))[:40]
            grains = {}
            for grain in ("annual", "quarterly"):
                g = [x for x in crow if x["grain"] == grain and x["member"] in members]
                periods = sorted({(x["start"], x["end"]) for x in g}, key=lambda p: p[1])
                if grain == "quarterly":
                    periods = periods[-8:]
                values = {m: [next((x["value"] for x in g if x["member"] == m and (x["start"], x["end"]) == p), None) for p in periods] for m in members}
                values = {m: v for m, v in values.items() if any(val is not None for val in v)}
                if periods and values:
                    grains[grain] = {"periods": [{"start": s, "end": e} for s, e in periods], "values": values,
                                     "accn": {m: [next((x["accn"] for x in g if x["member"] == m and (x["start"], x["end"]) == p), None) for p in periods] for m in values}}
            if grains:
                axes_out.append({"axis": axis, "kind": sg.AXES[axis], "measure": group_name, "concept": concept, "unit": crow[0]["unit"],
                                 "members": [{"member": m, "label": lab} for m, lab in zip(members, sg.member_labels(members, labels))],
                                 **grains,
                                 "checks": [c for c in checks if c["axis"] == axis and c["concept"] == concept]})
    return axes_out, used


def supplement(cik: str, filings: list[dict], facts: dict) -> tuple[dict, list[dict]]:
    """Periodic reports filed after the latest one SEC companyfacts includes, read from their own XBRL instance documents
    (only when this registrant is the filing's primary entity, so a combined filing never lends another entity's facts)."""
    known, last = set(), ""
    for cs in facts.values():
        for node in cs.values():
            for fs in (node.get("units") or {}).values():
                for f in fs:
                    known.add(f.get("accn"))
                    last = max(last, f.get("filed") or "")
    pending = sorted((f for f in filings if f["form"] in PERIODIC and f["xbrl"] and f["accn"] not in known and f["date"] > last), key=lambda f: f["date"])
    used = []
    for f in pending:
        instance, _ = instance_and_labels(cik, f["accn"], f["primary"])
        data = h.get(archive_base(cik, f["accn"]) + instance, kind="xbrl_instance", suffix=".xml", compress=True, timeout=180) if instance else None
        if not data:
            continue
        entity, extra = sg.consolidated_facts(data, st.line_concepts())
        if entity != cik or not extra:
            continue
        facts = st.merge_facts(facts, extra, accn=f["accn"], form=f["form"], filed=f["date"])
        used.append({"form": f["form"], "accn": f["accn"], "date": f["date"], "url": archive_base(cik, f["accn"]) + instance})
    return facts, used


def build_one(cik: str, name: str, logos: dict):
    sub = h.get_json(fx.submissions_url(cik), kind="submissions")
    if not sub:
        return None
    filings = recent_filings(sub)
    body = h.get(fx.companyfacts_url(cik), kind="companyfacts", compress=True, timeout=180)
    facts = json.loads(body)["facts"] if body else {}
    supplemented: list[dict] = []
    if facts:
        facts, supplemented = supplement(cik, filings, facts)
    statements = st.build_statements(facts) if facts else None
    latest_annual = next((f for f in filings if f["form"] in ANNUAL), None)
    description = site = ir = None
    if latest_annual:
        doc = h.get(archive_base(cik, latest_annual["accn"]) + latest_annual["primary"], kind="filing_docs", suffix=".htm", compress=True, timeout=180)
        if doc:
            text = html_text(doc)
            description = business_excerpt(text)
            site, ir = websites(text)
    segs, segs_used = build_segments(cik, filings) if facts else (None, [])
    revenue_unit = (statements or {}).get("lines", {}).get("revenue", {}).get("unit") if statements else None
    profile = {
        "cik": cik, "name": sub.get("name") or name, "tickers": sub.get("tickers") or [], "exchanges": [e for e in (sub.get("exchanges") or []) if e],
        "sic": sub.get("sic") or None, "sic_description": sub.get("sicDescription") or None,
        "state_of_incorporation": sub.get("stateOfIncorporation") or None, "fiscal_year_end": sub.get("fiscalYearEnd") or None,
        "category": sub.get("category") or None, "entity_type": sub.get("entityType") or None,
        "former_names": [f.get("name") for f in (sub.get("formerNames") or []) if f.get("name")][:5],
        "website": site, "ir_website": ir,
        "description": description,
        "description_source": {"form": latest_annual["form"], "accn": latest_annual["accn"], "date": latest_annual["date"],
                               "url": archive_base(cik, latest_annual["accn"]) + latest_annual["primary"]} if latest_annual and description else None,
        "logo": logos.get(cik), "currency": revenue_unit, "price_note": NO_PRICE,
        "statements_supplement": supplemented,
    }
    listed = [{"form": f["form"], "accn": f["accn"], "date": f["date"], "report_date": f["report_date"], "items": f["items"],
               "description": f["description"], "url": archive_base(cik, f["accn"]) + f["primary"], "index_url": filing_index_url(cik, f["accn"])}
              for f in filings if f["form"] in LISTED_FORMS][:120]
    return {"cik": cik, "profile": profile, "statements": compact_statements(statements) if statements else None, "filings": listed,
            "segments": segs, "segments_used": segs_used}


def statements_record(r: dict, retrieved: str):
    p = r["profile"]
    s = r["statements"]
    years = [x["fy"] for x in s["annual_periods"]] if s else []
    quarters = len(s["quarterly_periods"]) if s else 0
    lines = sorted(s["lines"]) if s else []
    return cw.record(
        "company_sec_statements", r["cik"], f"{p['name']}: financial statements", source_url=fx.companyfacts_url(r["cik"]),
        subtitle=(f"FY{years[0]}–FY{years[-1]} · {quarters} quarters · {len(lines)} line items" if s else "No XBRL statements filed"),
        cells={"company": p["name"], "tickers": ", ".join(p["tickers"]) or None, "sic": p["sic_description"], "years": len(years), "quarters": quarters,
               "lines": len(lines), "segments": "yes" if r["segments"] else "no"},
        facts=[["Company", p["name"]], ["CIK", r["cik"]], ["Tickers", ", ".join(p["tickers"]) or "Not recorded"],
               ["Exchanges", ", ".join(p["exchanges"]) or "Not recorded"], ["SIC", f"{p['sic']} · {p['sic_description']}" if p["sic"] else "Not recorded"],
               ["Fiscal years", f"FY{years[0]}–FY{years[-1]}" if years else "Not recorded"], ["Quarters", str(quarters)],
               ["Website named in the annual report", p["website"] or "Not recorded"],
               ["Rules", "Own 10-K/10-Q/20-F/40-F facts only; one value per period, latest filed; quarters as filed, otherwise derived from year-to-date values of the same concept, or the full year less three quarters (marked); per-share values never derived; computed lines and margins use the same period and unit"],
               *([["Recent filings read directly", "; ".join(f"{u['form']} {u['date']} ({u['accn']})" for u in p["statements_supplement"])
                   + ": not yet in SEC companyfacts, so their consolidated facts were read from the filing's XBRL instance document"]]
                 if p.get("statements_supplement") else []),
               ["Source", f"{SOURCE_NOTE}, retrieved {retrieved}"]],
        text=" ".join([p["name"], " ".join(p["tickers"]), p["sic_description"] or "", p["description"] or ""]),
        filters={"sic": [p["sic"] or "not_recorded"], "segments": ["yes" if r["segments"] else "no"]},
        links=[{"url": f"/companies/{r['cik']}", "label": "Company profile"}, {"url": fx.companyfacts_url(r["cik"]), "label": "XBRL companyfacts (SEC)"}],
        extra={"profile": {"kind": "statements", **p, "statements": s, "filings": r["filings"], "retrieved": retrieved}},
    )


def segments_record(r: dict, retrieved: str):
    p = r["profile"]
    kinds = sorted({a["kind"] for a in r["segments"]})
    return cw.record(
        "company_sec_segments", r["cik"], f"{p['name']}: segment and geographic revenue",
        source_url=r["segments_used"][0]["url"] if r["segments_used"] else fx.companyfacts_url(r["cik"]),
        subtitle=" · ".join(f"{len([a for a in r['segments'] if a['kind'] == k and a['measure'] == 'revenue'][0]['members']) if [a for a in r['segments'] if a['kind'] == k and a['measure'] == 'revenue'] else 0} {k} members" for k in kinds),
        cells={"company": p["name"], "axes": ", ".join(kinds), "filings": len(r["segments_used"])},
        facts=[["Company", p["name"]], ["Axes", ", ".join(kinds)],
               ["Filings read", "; ".join(f"{u['form']} {u['date']} ({u['accn']})" for u in r["segments_used"])],
               ["Rules", "XBRL instance facts with exactly one segment, product/service or geographic axis (optionally with the operating-segments consolidation member); member names from the filing's label linkbase; members are checked against the consolidated total and differences reported, not adjusted"],
               ["Source", f"Registrant's XBRL instance documents on www.sec.gov, retrieved {retrieved}"]],
        text=" ".join([p["name"]] + [m["label"] for a in r["segments"] for m in a["members"]]),
        filters={"axis": kinds},
        links=[{"url": f"/companies/{r['cik']}", "label": "Company profile"}] + [{"url": u["url"], "label": f"XBRL instance, {u['form']} {u['date']}"} for u in r["segments_used"]],
        extra={"profile": {"kind": "segments", "cik": r["cik"], "name": p["name"], "axes": r["segments"], "filings_used": r["segments_used"], "retrieved": retrieved}},
    )


def main():
    t0 = time.time()
    companies = json.loads((LOOK / "companies.json").read_text())
    logos_path = BUILD / "logos.json"
    logos = json.loads(logos_path.read_text()) if logos_path.exists() else {}

    def one(c):
        try:
            return build_one(c["cik"], c["name"], logos)
        except Exception as error:  # noqa: BLE001 - reported, not swallowed
            return {"cik": c["cik"], "error": str(error)[:300]}

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(one, companies))
    errors = [r for r in results if r and "error" in r]
    good = [r for r in results if r and "error" not in r]
    retrieved = time.strftime("%Y-%m-%d", time.gmtime())
    srows = [statements_record(r, retrieved) for r in good]
    grows = [segments_record(r, retrieved) for r in good if r["segments"]]
    (BUILD / "raw_results.json").write_text(json.dumps(good, default=str))
    for dataset, label, rows, listing in (
        ("company_sec_statements", "Company financial statements from SEC XBRL (annual and quarterly)", srows,
         cw.listing([("company", "Company"), ("tickers", "Tickers"), ("sic", "Industry"), ("years", "Fiscal years"), ("quarters", "Quarters"), ("lines", "Line items"), ("segments", "Segments")],
                    [("segments", "Segment data", {"yes": "Has segment data", "no": "No segment data"})])),
        ("company_sec_segments", "Company segment, product and geographic revenue from SEC XBRL instance documents", grows,
         cw.listing([("company", "Company"), ("axes", "Axes"), ("filings", "Filings read")], [("axis", "Axis", {"segment": "Business segment", "product": "Product or service", "geography": "Geography"})])),
    ):
        spec = {"dataset": dataset, "label": label, "rows": rows, "listing_block": listing,
                "summary": {"source": SOURCE_NOTE, "totals": {"records": len(rows)}, "errors": len(errors)},
                "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "inputs": [{"url": "https://data.sec.gov/", "path": "private/acq/sec-companies", "sha256": hashlib.sha256(json.dumps([c["cik"] for c in companies]).encode()).hexdigest()}]}
        path = BUILD / f"{dataset}.json"
        path.write_text(json.dumps(spec, ensure_ascii=False, sort_keys=True, default=str))
        print(dataset, len(rows), "rows", path.stat().st_size // 1024, "KB")
    print("errors", len(errors), [e["cik"] + ": " + e["error"][:100] for e in errors][:10])
    print("with description", sum(1 for r in good if r["profile"]["description"]), "with website", sum(1 for r in good if r["profile"]["website"]),
          "with statements", sum(1 for r in good if r["statements"]), "with segments", len(grows), f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
