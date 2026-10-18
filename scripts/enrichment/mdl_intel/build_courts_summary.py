"""mdl_intel_court_pages (one record per pending products-liability MDL) and mdl_intel_summary (derived analytics).

Court pages: quotes are verbatim text from the official transferee-court MDL page(s) (court_pages_extracted.json);
orders are the page's own order links with the date printed beside them. JPML facts (judge, district, actions)
come from the JPML pending-MDL reports of 10/1/2026 parsed by this lane. Growth figures come from the published
mdl_analytics dataset (JPML monthly 'Distribution of Pending MDL Dockets by Actions Pending' reports).
"""
import collections
import json
import re
import statistics
from datetime import date
from pathlib import Path

import parse_jpml as pj
from contact_redaction import redact, redact_lines
from extract_court_pages import clip, parse_date

CONTACT_MARKER = "[contact removed]"
CONTACT_METHOD = (
    "Counsel are shown without contact fields (owner decision 2026-10-03): e-mail addresses, NANP phone/fax numbers, "
    "street addresses, Suite / P.O. Box / floor fragments, a unit number right after a street name ('Road, #100'), "
    "'City, ST ZIP' and contact labels with no value ('Facsimile: Not Available') are removed from court-page text by explicit "
    "patterns. In counsel lists, lines starting with a street number, Suite or P.O. Box are dropped, as are lines that are "
    "only 'City, State' (state spelled out), only a contact-field label ('Telephone', 'Name and Address'), premises "
    "('Third and Fourth Floor', 'Plaza Seven Bldg.') or a building name printed above its street line ('Terminus 200'; "
    "a firm name on the same line is kept). Counsel blocks that lost text are marked 'contact lines removed'; in quoted "
    "sentences, and in a counsel line whose sentence points at the removed contact ('may be sent to …'), each removal is "
    "shown as '[contact removed]'. Names, firms and roles are kept as printed."
)
from common import ACQ, HERE, JPML, TODAY, cw, district_name, fmt, months_between, normalize_district, pct  # noqa: E402

COURT_DATASET = "mdl_intel_court_pages"
SUMMARY_DATASET = "mdl_intel_summary"
BY_TYPE_URL = f"{JPML}/sites/jpml/files/Pending_MDL_Dockets_By_MDL_Type-October-1-2026.pdf"
BY_DISTRICT_URL = f"{JPML}/sites/jpml/files/Pending_MDL_Dockets_By_District-October-1-2026.pdf"
ARCHIVE_URL = f"{JPML}/pending-mdl-reports-archive"
QUOTE_CAP = 30
ORDER_CAP = 80
LEAD_BLOCK_CAP = 16  # leadership headings per MDL
LEAD_LINE_CAP = 60  # lines shown per heading; the rest is counted in lines_not_shown
LEAD_LINE_CHARS = 400  # longer lines are cut at a word boundary and end with " …"
MIN_GROWTH = 100
MIN_ORDERS = 10  # a page listing fewer orders (e.g. a recent-filings feed) cannot support a negative finding
FAST_GROWTH_RULE = (
    f"Transferred MDL whose court page lists at least {MIN_ORDERS} orders and whose pending actions grew 25% or more and by at least {MIN_GROWTH} "
    "actions over the 12 months to the latest JPML monthly report (mdl_analytics growth = fast_growth)"
)


def hhi(shares):
    return round(sum((100 * s) ** 2 for s in shares), 0)


def state_of(code):
    return (code or "")[:2] if code else None


def load():
    by_type = pj.parse_by_type((ACQ / "txt" / "by_type.txt").read_text())
    by_district = pj.parse_by_district((ACQ / "txt" / "by_district.txt").read_text())
    report_date = pj.report_date((ACQ / "txt" / "by_district.txt").read_text())
    pages = json.loads((ACQ / "court_pages_extracted.json").read_text())
    searched = json.loads((HERE / "court_pages.json").read_text())
    try:
        analytics = {int(r["id"]): r["item"].get("analytics") for r in cw.fetch_all("mdl_analytics", select="id,item") if r["id"].isdigit()}
    except Exception as error:  # dataset unavailable: growth stays "Not recorded"
        print("mdl_analytics unavailable:", error)
        analytics = {}
    return by_type, by_district, report_date, pages, searched, analytics


MONTH_DATE = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}"
RE_BW_TRIAL_DATE = re.compile(
    rf"bellwether[^.;]{{0,60}}?\btrials?\b[^.;]{{0,40}}?\b(?:set|scheduled|begin|begins|commence|commences|start|starts)\b[^.;]{{0,30}}?({MONTH_DATE})",
    re.I,
)
NOT_A_TRIAL_DATE = re.compile(r"deadline|submi|propos|brief", re.I)
ORDINAL = re.compile(r"\b(second|third|fourth|fifth|sixth|next|subsequent|additional|remaining|later|another)\b", re.I)
RE_BW_WORD = re.compile(r"bellwether", re.I)


def bellwether_first_date(quotes, transferred):
    """Earliest date stated as when a bellwether trial is set / scheduled / begins, within one clause of a quote.

    Deadline language (deadline, submission, proposed, briefing) inside the matched clause, or an ordinal before the
    trial ('second', 'next', 'subsequent', …), disqualifies the date. Returns (iso date, quote text, quote url).
    """
    dates = []
    for q in quotes:
        if q["category"] != "bellwether":
            continue
        for m in RE_BW_TRIAL_DATE.finditer(q["text"]):
            lead_in = q["text"][max(0, m.start() - 40):m.start() + 60]
            if NOT_A_TRIAL_DATE.search(m.group(0)) or ORDINAL.search(lead_in):
                continue
            _, iso = parse_date(m.group(1))
            if iso and (not transferred or iso > transferred):
                dates.append((iso, q["text"], q.get("url")))
    return sorted(dates)[0] if dates else (None, None, None)


def earliest_bellwether_activity(quotes, orders, transferred):
    """Earliest dated bellwether mention on the court pages (a quoted statement naming 'bellwether' with a date in it,
    or an order whose title/row names 'bellwether'), after transfer."""
    dates = []
    for q in quotes:
        if RE_BW_WORD.search(q["text"]):
            dates += [d for d in q.get("dates_mentioned", []) if not transferred or d > transferred]
    for o in orders:
        if o.get("date") and RE_BW_WORD.search(o["title"] + " " + o["row_text"]) and (not transferred or o["date"] > transferred):
            dates.append(o["date"])
    return min(dates) if dates else None


def leadership_from_pages(items):
    """Leadership blocks across an MDL's court pages: contact details removed (contact_redaction), lines longer than
    LEAD_LINE_CHARS cut at a word boundary and marked, at most LEAD_LINE_CAP lines per heading with the remainder
    counted, and a block repeated on another page (same heading, same lines) kept once."""
    out, seen = [], set()
    for p in items:
        for b in p.get("leadership_blocks", []):
            lines, removed = redact_lines(b["lines"])
            heading, head_removed = redact(b["heading"])
            if not lines or not heading:
                continue
            key = (" ".join(heading.lower().split()), tuple(lines))
            if key in seen:
                continue
            seen.add(key)
            shown = [clip(ln, LEAD_LINE_CHARS) for ln in lines[:LEAD_LINE_CAP]]
            beyond_extract = max(0, (b.get("lines_total") or len(b["lines"])) - len(b["lines"]))
            group = redact(b["group"])[0] if b.get("group") else None
            out.append({
                "heading": heading, "group": group or None, "lines": shown, "lines_not_shown": beyond_extract + len(lines) - len(shown),
                "url": p["url"], "contact_lines_removed": removed or head_removed, "note": "contact lines removed" if removed or head_removed else None,
                "updated": b.get("updated"),
            })
    return out[:LEAD_BLOCK_CAP]


def page_flag(items, orders, quotes, lead_blocks, failed=()):
    """Court-page coverage flag, naming what extraction read (never what the page itself contains): no page located
    (no_court_page); located but no page could be fetched (page_fetch_failed); a fetched page from which nothing at
    all was extracted (page_unreadable); or no order extracted, but quoted statements or leadership were
    (page_orders_not_extracted: the page may still list orders the extractor did not read)."""
    if not items:
        return "page_fetch_failed" if failed else "no_court_page"
    if orders:
        return None
    return "page_orders_not_extracted" if quotes or lead_blocks else "page_unreadable"


def court_records(by_type, by_district, report_date, pages, searched, analytics, hearing_page_orders):
    dist = {r["mdl"]: r for r in by_district}
    pl = [r for r in by_type if r["type"] == "Products Liability"]
    new_orders = {o["mdl"]: o for o in hearing_page_orders if o["kind"] == "transfer_order"}
    rows, summaries = [], []
    for r in pl:
        mdl = r["mdl"]
        d = dist.get(mdl) or {}
        a = analytics.get(mdl) or {}
        items = [p for p in pages.get(str(mdl), []) if not p.get("error")]
        failed = [p for p in pages.get(str(mdl), []) if p.get("error")]
        quotes, seen_q = [], set()
        for p in items:
            for q in p.get("quotes", []):
                text, removed = redact(q["text"], marker=CONTACT_MARKER)
                if len(text.replace(CONTACT_MARKER, "").strip(" .,;:()")) < 15:
                    continue  # nothing but contact details
                key = (q["category"], text)
                if key in seen_q:
                    continue
                seen_q.add(key)
                quotes.append(q | {"text": text, "contact_details_removed": removed, "url": p["url"], "retrieved": p["retrieved"]})
        orders, seen_o = [], set()
        for p in items:
            for o in p.get("orders", []):
                if o["url"] in seen_o:
                    continue
                seen_o.add(o["url"])
                orders.append(o | {"title": redact(o["title"])[0], "row_text": redact(o["row_text"], marker=CONTACT_MARKER)[0], "page": p["url"]})
        orders.sort(key=lambda o: (o["date"] or "", o["title"]), reverse=True)
        lead_blocks = leadership_from_pages(items)
        by_cat = collections.defaultdict(list)
        for q in quotes:
            longer = any(o is not q and o["category"] == q["category"] and o["url"] == q["url"] and len(o["text"]) > len(q["text"]) and q["text"] in o["text"] for o in quotes)
            if not longer:
                by_cat[q["category"]].append(q)
        transferred = r["date_transferred"]  # as listed in the JPML pending report of 10/1/2026
        status = "transferred" if transferred else "not_transferred_as_of_report"
        pending_order = new_orders.get(mdl) or {}
        judge = d.get("judge") or r["judge"] or pending_order.get("transferee_judge")
        district = d.get("district") or r["district"]
        district_label = district_name(district) if district else normalize_district(pending_order.get("transferee_district"))
        bw_date, bw_quote, bw_url = bellwether_first_date(quotes, transferred)
        bw_orders = [o for o in orders if re.search(r"bellwether|trial|pilot", o["title"] + " " + o["row_text"], re.I)]
        settlement_orders = [o for o in orders if re.search(r"settlement|qualified settlement fund|lien", o["title"] + " " + o["row_text"], re.I)]
        leadership_orders = [o for o in orders if re.search(r"leadership|lead counsel|steering committee|liaison", o["title"] + " " + o["row_text"], re.I)]
        dated = [o for o in orders if o["date"] and not o.get("vacated")]
        latest = dated[0] if dated else None
        growth = a.get("growth")
        change = a.get("change_12m")
        has_bw = bool(by_cat.get("bellwether")) or bool(bw_orders)
        page_read = bool(items) and bool(orders)
        earliest_bw = earliest_bellwether_activity(quotes, orders, transferred)
        bw_suppressed = bool(bw_date and earliest_bw and earliest_bw < bw_date)
        flags = [f for f in [page_flag(items, orders, quotes, lead_blocks, failed)] if f]
        if status != "transferred":
            flags.append("not_transferred_as_of_report")
        if status == "transferred" and page_read and len(orders) >= MIN_ORDERS and growth == "fast_growth" and (change or 0) >= MIN_GROWTH and not has_bw:
            flags.append("fast_growth_no_bellwether_quote")
        age = round(months_between(transferred, report_date) / 12, 1) if transferred and report_date else None
        rec = {
            "mdl": mdl, "title": r["title"], "type": r["type"], "status": status,
            "transfer_order_filed": pending_order.get("filed"), "transfer_order_url": pending_order.get("url"),
            "district": district, "district_label": district_label, "judge": judge,
            "judge_title": d.get("judge_title"), "master_docket": r["master_docket"], "date_filed": r["date_filed"], "date_transferred": transferred,
            "pending": d.get("pending"), "total": d.get("total"), "report_date": report_date, "age_years": age,
            "change_12m": a.get("change_12m"), "new_12m": a.get("new_12m"), "growth": growth, "growth_as_of": a.get("as_of"),
            "pages": [{"url": p["url"], "title": p["title"], "retrieved": p["retrieved"], "sha256": p["sha256"], "role": p.get("role"), "orders": len(p.get("orders", [])), "quotes": len(p.get("quotes", []))} for p in items],
            "failed_pages": [{"url": p["url"], "status": p.get("status")} for p in failed], "searched_urls": searched.get(str(mdl), []),
            "orders_total": len(orders), "orders": orders[:ORDER_CAP], "latest_order": latest,
            "quotes": {cat: by_cat.get(cat, [])[:QUOTE_CAP] for cat in ("leadership", "bellwether", "settlement")},
            "quote_counts": {cat: len(by_cat.get(cat, [])) for cat in ("leadership", "bellwether", "settlement")},
            "leadership_blocks": lead_blocks, "bellwether_orders": len(bw_orders), "settlement_orders": len(settlement_orders), "leadership_orders": len(leadership_orders),
            "first_bellwether_date_quoted": bw_date, "first_bellwether_quote": bw_quote, "first_bellwether_url": bw_url,
            "earliest_bellwether_activity": earliest_bw,
            "months_transfer_to_quoted_bellwether": months_between(transferred, bw_date) if bw_date and transferred and not bw_suppressed else None,
            "bellwether_timing_note": f"Not computed: the court pages mention bellwether activity dated {earliest_bw}, before the quoted trial date" if bw_suppressed else None,
            "flags": flags,
            "contact_method": CONTACT_METHOD,
            "contact_lines_removed": any(b["contact_lines_removed"] for b in lead_blocks) or any(q["contact_details_removed"] for q in quotes),
        }
        summaries.append(rec)
        primary = items[0]["url"] if items else BY_TYPE_URL
        facts = [
            ["MDL number", str(mdl)], ["Transferee court (JPML)", district_label or "Not recorded"], ["Transferee judge (JPML)", judge or "Not recorded"],
            ["Date transferred (JPML)", transferred or "Not recorded"], ["Actions pending (JPML 10/1/2026)", fmt(d.get("pending"))], ["Total actions (historical)", fmt(d.get("total"))],
            ["Change in pending, 12 months (JPML monthly reports)", fmt(a.get("change_12m"))], ["Official court pages", str(len(items)) if items else ("Located, could not be fetched" if failed else "None located")],
            ["Orders extracted from court pages", fmt(len(orders))], ["Latest dated order on court page", f"{latest['date']} — {latest['title']}" if latest else "Not recorded"],
            ["Leadership statements quoted", fmt(rec["quote_counts"]["leadership"])], ["Bellwether / trial statements quoted", fmt(rec["quote_counts"]["bellwether"])],
            ["Settlement statements quoted", fmt(rec["quote_counts"]["settlement"])], ["Earliest quoted bellwether-trial date", bw_date or "Not recorded"], ["Status (JPML report 10/1/2026)", "Transferred" if status == "transferred" else "Not transferred as of the report" + (f" (transfer order filed {pending_order.get('filed')})" if pending_order.get("filed") else "")],
            ["Flags", ", ".join(flags) or "None"], ["Retrieved", items[0]["retrieved"] if items else TODAY],
            ["Counsel contact details", "Removed — " + CONTACT_METHOD],
        ]
        links = [{"url": p["url"], "label": f"Court page: {p['title'][:60]}"} for p in items[:4]] + [{"url": BY_TYPE_URL, "label": "JPML pending MDLs by type (10/1/2026)"}, {"url": f"/matters/lens/{mdl}", "label": f"MDL {mdl} lens"}]
        title = r["title"].replace("IN RE:", "In re:").replace("IN Re:", "In re:")
        rows.append(cw.record(
            COURT_DATASET, str(mdl), title, source_url=primary,
            subtitle=f"MDL {mdl} · {district_label or 'Transferee court not recorded'} · {judge or 'Judge not recorded'} · {fmt(d.get('pending'))} pending",
            cells={"mdl": str(mdl), "litigation": title[:120], "court": district_label or "—", "judge": judge or "—", "pending": fmt(d.get("pending")), "orders": fmt(len(orders)), "latest": (latest or {}).get("date") or "—", "bellwether": "Quoted" if has_bw else "Not quoted"},
            facts=facts, text=f"{r['title']} {judge} {district_label} " + " ".join(q["text"] for q in quotes[:40]),
            badges=[b for b in ["Court page" if items else ("Court page not fetched" if failed else "No court page located"), "Bellwether quoted" if has_bw else None, "Fast growth, no bellwether quote" if "fast_growth_no_bellwether_quote" in flags else None] if b],
            filters={"kind": ["mdl"], "court_page": ["yes" if items else "no"], "bellwether": ["yes" if has_bw else "no"], "flag": flags or ["none"], "district": [district or ""], "date": (latest or {}).get("date") or ""},
            links=links, extra={"kind": "mdl", "court": rec},
        ))
    return rows, summaries


def summary_records(by_type, by_district, report_date, analytics, courts, stats_overview, hearings_overview):
    pending_actions = sum(r["pending"] for r in by_district)
    by_dist = collections.defaultdict(lambda: {"mdls": 0, "pending": 0, "total": 0, "judges": set()})
    by_judge = collections.defaultdict(lambda: {"mdls": 0, "pending": 0, "districts": set(), "list": []})
    by_state = collections.defaultdict(lambda: {"mdls": 0, "pending": 0})
    for r in by_district:
        g = by_dist[r["district"]]
        g["mdls"] += 1
        g["pending"] += r["pending"]
        g["total"] += r["total"]
        g["judges"].add(r["judge"])
        j = by_judge[r["judge"]]
        j["mdls"] += 1
        j["pending"] += r["pending"]
        j["districts"].add(r["district"])
        j["list"].append({"mdl": r["mdl"], "title": r["title"], "pending": r["pending"]})
        s = by_state[state_of(r["district"])]
        s["mdls"] += 1
        s["pending"] += r["pending"]
    n = len(by_district)
    districts = sorted(({"district": k, "label": district_name(k), "mdls": v["mdls"], "pending": v["pending"], "total": v["total"], "judges": len(v["judges"]), "share_pending_pct": round(100 * v["pending"] / pending_actions, 2), "share_mdls_pct": round(100 * v["mdls"] / n, 2)} for k, v in by_dist.items()), key=lambda x: -x["pending"])
    judges = sorted(({"judge": k, "mdls": v["mdls"], "pending": v["pending"], "districts": sorted(v["districts"]), "share_pending_pct": round(100 * v["pending"] / pending_actions, 2), "mdl_list": sorted(v["list"], key=lambda x: -x["pending"])[:6]} for k, v in by_judge.items()), key=lambda x: (-x["pending"], x["judge"]))
    concentration = {
        "report_date": report_date, "mdls": n, "pending_actions": pending_actions, "districts": len(by_dist), "judges": len(by_judge),
        "hhi_district_pending": hhi([d["pending"] / pending_actions for d in districts]), "hhi_district_mdls": hhi([d["mdls"] / n for d in districts]),
        "hhi_judge_pending": hhi([j["pending"] / pending_actions for j in judges]), "hhi_judge_mdls": hhi([j["mdls"] / n for j in judges]),
        "top5_district_share_pct": round(sum(d["share_pending_pct"] for d in districts[:5]), 1), "top5_judge_share_pct": round(sum(j["share_pending_pct"] for j in judges[:5]), 1),
        "multi_mdl_judges": sum(1 for j in judges if j["mdls"] > 1),
    }
    ages = []
    for r in by_type:
        if r["date_transferred"] and report_date:
            ages.append({"mdl": r["mdl"], "type": r["type"], "age_years": round(months_between(r["date_transferred"], report_date) / 12, 2)})
    buckets = [("<1 yr", 0, 1), ("1–2 yrs", 1, 2), ("2–3 yrs", 2, 3), ("3–5 yrs", 3, 5), ("5–10 yrs", 5, 10), ("10+ yrs", 10, 999)]
    age_dist = [{"bucket": b, "all": sum(1 for x in ages if lo <= x["age_years"] < hi), "products_liability": sum(1 for x in ages if lo <= x["age_years"] < hi and x["type"] == "Products Liability")} for b, lo, hi in buckets]
    pend = [a for a in analytics.values() if a and a.get("status") == "pending" and a.get("change_12m") is not None]
    leaders = sorted(pend, key=lambda a: -a["change_12m"])[:15]
    growth_leaders = [{"mdl": a["mdl"], "type": a.get("type"), "pending": a.get("pending"), "change_12m": a["change_12m"], "new_12m": a.get("new_12m"), "growth": a.get("growth"), "pct_12m": round(100 * a["change_12m"] / (a["pending"] - a["change_12m"]), 1) if a.get("pending") and a["pending"] - a["change_12m"] > 0 else None} for a in leaders]
    titles = {r["mdl"]: r["title"] for r in by_type}
    for g in growth_leaders:
        g["title"] = titles.get(g["mdl"])
    bw = [{"mdl": c["mdl"], "title": c["title"], "date_transferred": c["date_transferred"], "first_bellwether_date_quoted": c["first_bellwether_date_quoted"], "months": c["months_transfer_to_quoted_bellwether"], "note": c["bellwether_timing_note"], "quote": c["first_bellwether_quote"], "url": c["first_bellwether_url"]} for c in courts if c["first_bellwether_date_quoted"]]
    flagged = [{"mdl": c["mdl"], "title": c["title"], "pending": c["pending"], "change_12m": c["change_12m"], "flags": c["flags"], "court_pages": len(c["pages"])} for c in courts if c["flags"]]
    transferred_pl = [c for c in courts if c["status"] == "transferred"]
    not_transferred = [{"mdl": c["mdl"], "title": c["title"], "transfer_order_filed": c["transfer_order_filed"], "judge": c["judge"], "district_label": c["district_label"]} for c in courts if c["status"] != "transferred"]
    granted_by_district = collections.Counter((m.get("evidence") or {}).get("district") for m in hearings_overview.get("_matters", []) if m["section"] == "A" and m["outcome"] == "granted")
    grant_series = [{"year": s["year"], "filed": s["motions_filed"], "granted": s["motions_granted"], "denied_moot_withdrawn": s["motions_denied_moot_withdrawn"], "rate_all": s["grant_rate_all_pct"], "rate_merits": s["grant_rate_merits_pct"], "denied": (s["categories"] or {}).get("denied"), "consistent": s["categories_consistent"]} for s in stats_overview["series"]]
    coverage = []
    jp = {s["year"]: s for s in stats_overview["series"]}
    for c in hearings_overview["govinfo_coverage_by_year"]:
        y = c["year"]
        if y in jp:
            coverage.append({"year": y, "govinfo_initial_transfer_orders": c.get("initial_transfer_orders", 0), "jpml_granted": jp[y]["motions_granted"], "govinfo_initial_denials": c.get("initial_denials", 0), "jpml_denied": (jp[y]["categories"] or {}).get("denied")})
    pl_courts = len([c for c in transferred_pl if c["pages"]])
    overview = {
        "as_of": report_date, "retrieved": TODAY,
        "kpis": {"pending_mdls": n, "pending_actions": pending_actions, "pl_mdls": len(transferred_pl), "pl_listed": len(courts), "pl_not_transferred": len(not_transferred), "pl_with_court_page": pl_courts, "pl_pages_read": sum(1 for c in transferred_pl if c["pages"] and c["orders_total"]), "pl_bellwether_quoted": sum(1 for c in transferred_pl if c["quote_counts"]["bellwether"] or c["bellwether_orders"]), "flagged_fast_growth_no_bellwether": sum(1 for c in courts if "fast_growth_no_bellwether_quote" in c["flags"]), "median_age_years_all": round(statistics.median(x["age_years"] for x in ages), 1) if ages else None, "median_age_years_pl": round(statistics.median(x["age_years"] for x in ages if x["type"] == "Products Liability"), 1) if ages else None, "ten_year_grant_rate_median": stats_overview["ten_year"]["median_grant_rate_all_pct"]},
        "age_coverage": {"with_transfer_date": len(ages), "listed_mdls": len(by_type), "pl_with_transfer_date": sum(1 for x in ages if x["type"] == "Products Liability"), "pl_listed": sum(1 for r in by_type if r["type"] == "Products Liability")},
        "pl_not_transferred": not_transferred,
        "grant_rate_series": grant_series, "concentration": concentration, "districts": districts, "judges": judges[:60], "states": [{"state": k, **v} for k, v in sorted(by_state.items()) if k],
        "age_distribution": age_dist, "growth_leaders": growth_leaders, "bellwether_timing": sorted(bw, key=lambda x: x["months"] if x["months"] is not None else 1e9), "flags": flagged,
        "granted_transferee_districts": [{"district": k, "count": v} for k, v in granted_by_district.most_common() if k],
        "govinfo_vs_jpml": coverage, "fast_growth_rule": FAST_GROWTH_RULE,
        "rules": {
            "grant_rate_all": "granted ÷ (granted + denied, moot or withdrawn) — JPML summary table, latest edition",
            "grant_rate_merits": "granted ÷ (granted + denied) — denied from the termination-by-category figures",
            "hhi": "Herfindahl–Hirschman index on shares of pending actions (or dockets), 0–10,000. Bands borrowed from the 2023 DOJ/FTC Merger Guidelines: above 1,800 highly concentrated, 1,000–1,800 moderately concentrated, below 1,000 unconcentrated",
            "hhi_bands": {"high": 1800, "moderate": 1000},
            "age": "years from JPML date transferred to the 10/1/2026 report date",
            "bellwether_timing": "first date (after transfer) that a court-page statement gives for when a bellwether trial is set, scheduled or begins (same clause; deadline/submission language and ordinals such as 'second' or 'next' excluded); months are not computed when the pages show dated bellwether activity before that date; the statement is stored verbatim",
            "flag": FAST_GROWTH_RULE + " and no court-page sentence or order title mentions bellwether/trial/pilot",
            "contacts": CONTACT_METHOD,
            "quotes": "Statements are verbatim sentences, list items or table rows from the court page (each table row parsed on its own); a row's cells are joined with ' | '. Leadership statements must name a leadership role (lead counsel, co-lead, steering/executive committee) or an appointment of counsel, leadership or a committee.",
            "leadership": "Leadership lists are the lines under each court-page heading that names a leadership role, up to the next such heading or any other section heading (or a list of documents); a heading printed directly above other role headings is kept as their group. Each line is one page element as printed (a name and a firm in separate elements stay separate lines); counsel contact details are removed; docket counsel-of-record listings ('represented by') are not leadership and are left out.",
            "page_flags": "Flags describe what extraction read, not what the court page contains: no_court_page = no official court page located; page_fetch_failed = a court page was located but could not be fetched; page_unreadable = a fetched court page from which nothing was extracted (no orders, no quoted statements, no leadership); page_orders_not_extracted = no order could be extracted from the located page, but quoted statements or leadership were (the page may still list orders, e.g. as document links the extractor does not read).",
        },
    }
    rows = [cw.record(
        SUMMARY_DATASET, "summary:overview", "MDL intelligence overview", source_url=BY_DISTRICT_URL,
        subtitle=f"{n} pending MDLs · {fmt(pending_actions)} actions · HHI (district, actions) {fmt(int(concentration['hhi_district_pending']))}",
        cells={"metric": "Overview", "value": fmt(n), "detail": f"as of {report_date}"},
        facts=[["Report date", report_date], ["Pending MDLs", fmt(n)], ["Pending actions", fmt(pending_actions)], ["HHI by district (pending actions)", fmt(int(concentration["hhi_district_pending"]))], ["HHI by judge (pending actions)", fmt(int(concentration["hhi_judge_pending"]))], ["Products-liability MDLs with an official court page located", f"{pl_courts} of {len(courts)}"], ["Retrieved", TODAY]],
        text="mdl intelligence overview concentration grant rate", filters={"_listing": ["no"], "kind": ["summary"]},
        links=[{"url": BY_DISTRICT_URL, "label": "JPML pending MDLs by district (10/1/2026)"}, {"url": BY_TYPE_URL, "label": "JPML pending MDLs by type (10/1/2026)"}, {"url": ARCHIVE_URL, "label": "JPML monthly reports archive"}],
        extra={"kind": "summary", "overview": overview},
    )]
    for dct in districts:
        rows.append(cw.record(
            SUMMARY_DATASET, f"district:{dct['district']}", f"{dct['label']} — pending MDLs", source_url=BY_DISTRICT_URL,
            subtitle=f"{dct['mdls']} MDLs · {fmt(dct['pending'])} pending actions · {dct['share_pending_pct']}% of all",
            cells={"metric": dct["label"], "value": fmt(dct["pending"]), "detail": f"{dct['mdls']} MDLs · {dct['judges']} judges"},
            facts=[["District", dct["label"]], ["Pending MDLs", fmt(dct["mdls"])], ["Pending actions", fmt(dct["pending"])], ["Share of pending actions", pct(dct["share_pending_pct"])], ["Transferee judges", fmt(dct["judges"])], ["Source", "JPML Distribution of Pending MDL Dockets by District, report date " + report_date]],
            text=f"district {dct['label']} {dct['district']}", filters={"kind": ["district"], "state": [state_of(dct["district"])]},
            links=[{"url": BY_DISTRICT_URL, "label": "JPML pending MDLs by district (PDF)"}], state=state_of(dct["district"]) or "", extra={"kind": "district", "district": dct},
        ))
    return rows, overview


def publish(stats_overview, hearings_overview, hearing_page_orders):
    by_type, by_district, report_date, pages, searched, analytics = load()
    crow, courts = court_records(by_type, by_district, report_date, pages, searched, analytics, hearing_page_orders)
    cw.publish(
        COURT_DATASET, "MDL Intelligence · transferee-court MDL pages (products liability)", crow,
        listing_block=cw.listing([("mdl", "MDL"), ("litigation", "Litigation"), ("court", "Court"), ("judge", "Judge"), ("pending", "Pending"), ("orders", "Orders listed"), ("latest", "Latest order"), ("bellwether", "Bellwether")], [("court_page", "Court page", {"yes": "Located", "no": "Not located"}), ("bellwether", "Bellwether quoted", {"yes": "Yes", "no": "No"})]),
        summary={"records": len(crow), "with_court_page": sum(1 for c in courts if c["pages"]), "source": "Official transferee-court MDL pages (*.uscourts.gov)", "retrieved": TODAY},
    )
    srows, overview = summary_records(by_type, by_district, report_date, analytics, courts, stats_overview, hearings_overview)
    cw.publish(
        SUMMARY_DATASET, "MDL Intelligence · derived analytics", srows,
        listing_block=cw.listing([("metric", "District / metric"), ("value", "Pending actions"), ("detail", "Detail")], []),
        summary={"records": len(srows), "as_of": report_date, "retrieved": TODAY},
    )
    return courts, overview


def court_page_preview(extracted_path, out_path):
    """Offline preview (no credentials, nothing published): the court-page fields this builder derives from an
    extraction file (fetch_court_pages.py --out), per MDL — leadership blocks, coverage flag and counts."""
    pages = json.loads(Path(extracted_path).read_text())
    out = {}
    for mdl, entries in sorted(pages.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0):
        if not mdl.isdigit():
            continue
        items = [p for p in entries if not p.get("error")]
        orders = {o["url"] for p in items for o in p.get("orders", [])}
        quotes = {(q["category"], q["text"]) for p in items for q in p.get("quotes", [])}
        lead = leadership_from_pages(items)
        failed = [p["url"] for p in entries if p.get("error")]
        out[mdl] = {
            "pages": [p["url"] for p in items], "failed_pages": failed,
            "orders_total": len(orders), "quotes": len(quotes), "flag": page_flag(items, orders, quotes, lead, failed), "leadership_blocks": lead,
        }
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) == 4 and sys.argv[1] == "--preview":
        preview = court_page_preview(sys.argv[2], sys.argv[3])
        print(json.dumps({"mdls": len(preview), "with_leadership": sum(1 for v in preview.values() if v["leadership_blocks"]), "out": sys.argv[3]}))
    else:
        raise SystemExit("usage: build_courts_summary.py --preview <court_pages_extracted.json> <out.json>  (publishing runs through run_all.py)")
