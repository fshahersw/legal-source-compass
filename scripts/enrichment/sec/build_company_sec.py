"""Step 5: build and publish the SEC company-intelligence datasets for MDL defendants.

Inputs (private/acq/sec-companies): mdl_inputs.json, efts_hits.json, evidence.json, submissions/, companyfacts/.
Outputs (corpus):
  company_sec_profiles    one summary record per registrant (+ summary:overview)
  company_sec_mdl_links   one record per registrant x MDL with the verified evidence filings
  company_sec_financials  one record per registrant with annual and quarterly XBRL series
Run with --dry-run to write private/scratch/sec-companies/preview.json without publishing.
"""
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402
import fetch_xbrl as fx  # noqa: E402
import financials as fin  # noqa: E402
import sec_http as h  # noqa: E402
import targets as tg  # noqa: E402

ACQ = h.ACQ
ROOT = HERE.parents[2]
TODAY = date.today().isoformat()
JPML_SOURCE = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive"
EFTS_UI = "https://efts.sec.gov/LATEST/search-index"
TIER_LABEL = {
    "A": "Filing cites the MDL number",
    "B": "Filing cites the official MDL caption",
    "C": "Filing describes the MDL by its subject (requires review)",
}
ROLE_LABEL = {
    "defendant": "Excerpt describes claims against the company",
    "not_named": "Excerpt says the company is not named",
    "plaintiff": "Excerpt describes the company as a claimant",
    "unclear": "Role not stated in excerpt",
}
# Only links whose evidence excerpt reads the company as a defendant count toward exposure totals;
# "unclear" links are shown and summed separately, never mixed in.
EXPOSURE_ROLES = {"defendant"}

# Decisions from the independent verification of the first publication (2026-10-18). Each one was made
# by reading the evidence filing; the reason is published on the link. Rules are tried first; these
# entries apply only where the deterministic rules cannot reach the reviewed reading.
REVIEWED_DROP = {
    ("0001121404", 2738): "Sanofi 20-F: the nearby 'MDL' is the Zantac MDL appeal; the filing never cites MDL 2738 or the talc caption.",
    ("0000935703", 2924): "Dollar Tree 10-K: Zantac cases were in Pennsylvania state court and dismissed; the MDL sentence concerns acetaminophen.",
    ("0000356130", 1358): "EMC Insurance 10-K: the company is an insurer defending policyholders' MTBE claims, not a party.",
}
REVIEWED_ROLE = {
    ("0001410636", 1358): ("plaintiff", "American Water subsidiaries 'are each plaintiffs' in the MTBE lawsuits."),
    ("0001410635", 1358): ("plaintiff", "American Water subsidiaries 'are each plaintiffs' in the MTBE lawsuits."),
    ("0000745308", 2179): ("plaintiff", "St. Joe 'joined the MDL' and 'asserted claims' against BP and others."),
    ("0001900304", 2789): ("defendant", "Haleon: 'The Group is a defendant in the ongoing PPI litigation'."),
    ("0000872589", 3180): ("defendant", "Regeneron: product liability lawsuits 'against the Company' claiming Dupixent caused lymphoma."),
    ("0001124139", 1507): ("defendant", "Schering AG: Berlex HRT lawsuits removed to MDL Docket No. 1507."),
}
REVIEW_NOTE = {
    ("0000834071", 2151): "Toyota Motor Credit is a finance subsidiary; the filing may describe Toyota's litigation as an affiliate or indemnitee.",
    ("0000818686", 2243): "Teva: confirm whether claims are against Teva or covered by an indemnity / dismissed.",
    ("0001303523", 2913): "BAT: the filing describes a Reynolds / RJR Vapor action naming JUUL; confirm participation in the MDL.",
    ("0001964738", 2666): "Solventum: Bair Hugger liabilities are allocated with 3M under the separation agreements (indemnity).",
    ("0001821825", 2243): "Organon: Fosamax liabilities are allocated with Merck under the separation agreements (indemnity).",
    ("0001666700", 2873): "DuPont de Nemours: the filing names EIDP and Chemours as AFFF defendants, not DuPont de Nemours, Inc.",
}
METRIC_LABEL = {
    "revenue": "Revenue", "net_income": "Net income", "assets": "Total assets", "cash": "Cash and equivalents",
    "rnd": "R&D expense", "litigation_accrual": "Litigation / loss-contingency accrual", "possible_loss": "Estimate of possible loss",
    "litigation_expense": "Litigation expense in period", "legal_payments": "Payments for legal settlements",
}
FLAG_RULES = {
    "accrual_surge": "Litigation accrual up 50% or more on the prior fiscal year while pending actions in the company's linked MDLs grew over the last 12 months (accrual from the latest or prior fiscal year of a company still filing XBRL)",
    "accrual_heavy": "Litigation accrual equal to 5% or more of same-year revenue (latest or prior fiscal year of a company still filing XBRL)",
    "expense_spike": "Litigation expense at least double the prior fiscal year (latest or prior fiscal year of a company still filing XBRL)",
    "docket_growth": "Pending actions across MDLs where it is a defendant up 25% or more in 12 months (at least 100 pending)",
    "multi_mdl": "Its own filings describe it as a defendant in three or more pending MDLs",
}
FLAG_LABEL = {
    "accrual_surge": "Accrual surge with growing docket", "accrual_heavy": "Accrual ≥ 5% of revenue",
    "expense_spike": "Litigation expense doubled", "docket_growth": "Linked docket growing 25%+",
    "multi_mdl": "3+ pending MDLs",
}


def load(name):
    return json.loads((ACQ / name).read_text())


def money(v, unit):
    if v is None:
        return "Not recorded"
    sign = "-" if v < 0 else ""
    a = abs(v)
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= div:
            return f"{sign}{a / div:,.2f}{suf} {unit}"
    return f"{sign}{a:,.0f} {unit}"


def pct(v):
    return "Not recorded" if v is None else f"{v:,.2f}%"


def fmt(n):
    return "Not recorded" if n is None else f"{n:,}"


def edgar_company_url(cik):
    return f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=&dateb=&owner=include&count=40"


def filing_index_url(cik, adsh):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{adsh.replace('-', '')}/{adsh}-index.htm"


def profile_from_submissions(cik, sub, fallback_name):
    if not sub:
        return {"cik": cik, "name": fallback_name, "tickers": [], "exchanges": [], "sic": None, "sic_description": None,
                "state_of_incorporation": None, "business_state": None, "business_city": None, "fiscal_year_end": None,
                "entity_type": None, "category": None, "former_names": []}
    biz = (sub.get("addresses") or {}).get("business") or {}
    return {
        "cik": cik, "name": sub.get("name") or fallback_name, "tickers": sub.get("tickers") or [],
        "exchanges": [e for e in (sub.get("exchanges") or []) if e], "sic": sub.get("sic") or None,
        "sic_description": sub.get("sicDescription") or None,
        "state_of_incorporation": sub.get("stateOfIncorporation") or None,
        # EDGAR's own descriptions of its state / country codes (for example 'I0' -> 'France').
        "state_of_incorporation_name": sub.get("stateOfIncorporationDescription") or None,
        "business_state": biz.get("stateOrCountry") or None, "business_city": (biz.get("city") or "").title() or None,
        "business_state_name": biz.get("stateOrCountryDescription") or None,
        "business_foreign": bool(biz.get("isForeignLocation")),
        "fiscal_year_end": sub.get("fiscalYearEnd") or None, "entity_type": sub.get("entityType") or None,
        "category": sub.get("category") or None,
        "former_names": [f["name"] for f in (sub.get("formerNames") or [])][:4],
    }


def latest_point(points):
    return points[-1] if points else None


def compact_point(p):
    return None if not p else {"fy": p["fy"], "end": p["end"], "value": p["value"], "unit": p["unit"], "concept": p["concept"], "accn": p["accn"], "form": p["form"], "filed": p["filed"]}


def build_financials(cik, facts):
    entity = facts.get("facts") or {}
    annual = {m: fin.metric_series(entity, m, "annual") for m in fin.METRICS}
    quarterly = {m: fin.metric_series(entity, m, "quarterly") for m in fin.METRICS}
    raw = sorted({c for tax in ("us-gaap", "ifrs-full") for c in (entity.get(tax) or {}) if c in fin.RAW_CONCEPTS})
    derived = {
        "accrual_pct_revenue": fin.ratio_same_year(annual["litigation_accrual"], annual["revenue"]),
        "expense_pct_revenue": fin.ratio_same_year(annual["litigation_expense"], annual["revenue"]),
        "yoy": {m: fin.yoy(annual[m]) for m in ("revenue", "net_income", "litigation_accrual", "litigation_expense")},
    }
    taxonomy = "ifrs-full" if "ifrs-full" in entity and "us-gaap" not in entity else "us-gaap"
    return {"annual": annual, "quarterly": quarterly, "derived": derived, "concepts_present": raw, "taxonomy": taxonomy}


def mention_years(verified, search):
    years = defaultdict(lambda: {"verified": set(), "search": set()})
    for v in verified:
        years[v["file_date"][:4]]["verified"].add(v["adsh"])
    for s in search:
        if s["file_date"]:
            years[s["file_date"][:4]]["search"].add(s["adsh"])
    return {y: v for y, v in years.items()}


def main(dry_run=False):
    inputs = load("mdl_inputs.json")
    hits = load("efts_hits.json")
    evidence = load("evidence.json")
    mdl_info = {m["mdl"]: m for m in inputs["mdls"]}
    targets = {t["mdl"]: t for t in hits["targets"]}
    queries_by_mdl = defaultdict(list)
    for q in hits["queries"]:
        queries_by_mdl[(q["mdl"], q["tier"])].append(q["search_url"])
    pairs = [p for p in evidence["pairs"] if p["tier"] and (p["cik"], p["mdl"]) not in REVIEWED_DROP]
    dropped = [p for p in evidence["pairs"] if p["tier"] and (p["cik"], p["mdl"]) in REVIEWED_DROP]
    print(len(dropped), "links dropped by review:", [(p["cik"], p["mdl"]) for p in dropped])

    # Registrant metadata and XBRL
    companies = {}
    for cik in sorted({p["cik"] for p in pairs}):
        sub = h.get_json(fx.submissions_url(cik), kind="submissions")
        name = next(p["name"] for p in pairs if p["cik"] == cik).split("  (")[0].strip()
        prof = profile_from_submissions(cik, sub, name)
        body = h.get(fx.companyfacts_url(cik), kind="companyfacts", compress=True, timeout=180)
        facts = json.loads(body) if body else {}
        companies[cik] = {"profile": prof, "fin": build_financials(cik, facts) if facts else None}

    link_rows, by_company = [], defaultdict(list)
    for p in pairs:
        t = targets[p["mdl"]]
        m = mdl_info.get(p["mdl"], {})
        roles = [v["role"] for v in reversed(p["verified"])]
        role = next((r for r in roles if r != "unclear"), "unclear")
        role_source, role_note = "rule", None
        if (p["cik"], p["mdl"]) in REVIEWED_ROLE:
            reviewed, role_note = REVIEWED_ROLE[(p["cik"], p["mdl"])]
            role_source = "rule" if reviewed == role else "review"
            role = reviewed
        dismissed = bool(p["verified"][-1].get("dismissed"))
        review_note = REVIEW_NOTE.get((p["cik"], p["mdl"]))
        title = t["title"]
        truncated = len(tg.caption_core(title).split()) <= 3
        search = p["search_hits"].get(p["tier"], [])
        years = mention_years(p["verified"], search)
        status = m.get("status") or t["status"]
        link = {
            "cik": p["cik"], "company": companies[p["cik"]]["profile"]["name"], "mdl": p["mdl"],
            "mdl_title": title, "mdl_status": status, "title_truncated": truncated, "mdl_type": m.get("type") or t.get("type"),
            "pending": m.get("pending") if status == "pending" else None,
            "change_12m": m.get("change_12m") if status == "pending" else None,
            "district": m.get("district") or t.get("district"), "judge": m.get("judge") or t.get("judge"),
            "date_transferred": m.get("date_transferred"), "date_closed": m.get("date_closed"),
            "termination_year": t.get("termination_year"),
            "tier": p["tier"], "tier_label": TIER_LABEL[p["tier"]], "role": role, "role_label": ROLE_LABEL[role],
            "role_counts": dict(Counter(v["role"] for v in p["verified"])),
            "verified_count": len({v["adsh"] for v in p["verified"]}), "checked": p["checked"],
            "search_count": len({s["adsh"] for s in search}),
            "first_verified": p["verified"][0]["file_date"], "last_verified": p["verified"][-1]["file_date"],
            "first_search": search[0]["file_date"] if search else None, "last_search": search[-1]["file_date"] if search else None,
            "by_year": [{"year": int(y), "verified": len(v["verified"]), "search": len(v["search"])} for y, v in sorted(years.items())],
            "verified": [
                {"adsh": v["adsh"], "form": v["form"], "file_date": v["file_date"], "period_ending": v["period_ending"],
                 "url": v["url"], "index_url": filing_index_url(p["cik"], v["adsh"]), "matched": v["matched"],
                 "role": v["role"], "dismissed": bool(v.get("dismissed")),
                 "co_registrants": [c.split("  (")[0] for c in v["co_registrants"]],
                 **({"excerpt": v["excerpt"]} if i >= len(p["verified"]) - 6 or i == 0 else {})}
                for i, v in enumerate(p["verified"])
            ],
            "search_urls": queries_by_mdl[(p["mdl"], p["tier"])],
            "counts_toward_exposure": role in EXPOSURE_ROLES and not dismissed and not review_note,
            "dismissed": dismissed, "review": bool(review_note), "review_note": review_note,
            "role_source": role_source, "role_note": role_note,
            # Monthly JPML pending counts for this MDL as published in mdl_analytics (unchanged).
            "series": [{"date": x["date"], "pending": x["pending"]} for x in m.get("series") or []
                       if isinstance(x.get("pending"), int) and x.get("date")],
        }
        by_company[p["cik"]].append(link)

    # Company summaries
    profiles, fin_rows = [], []
    pending_total_all = sum(m["pending"] or 0 for m in inputs["mdls"] if m["status"] == "pending")
    for cik, c in companies.items():
        prof, fdata = c["profile"], c["fin"]
        links = sorted(by_company[cik], key=lambda l: (-(l["pending"] or 0), l["mdl"]))
        exposure_links = [l for l in links if l["counts_toward_exposure"]]
        pending_links = [l for l in exposure_links if l["mdl_status"] == "pending"]
        pending_actions = sum(l["pending"] or 0 for l in pending_links) if pending_links else None
        # Split by evidence strength, and the "unclear role" links kept apart from the total.
        pending_ab = sum(l["pending"] or 0 for l in pending_links if l["tier"] in ("A", "B")) if pending_links else None
        pending_c = sum(l["pending"] or 0 for l in pending_links if l["tier"] == "C") if pending_links else None
        unclear_links = [l for l in links if l["mdl_status"] == "pending" and l["role"] == "unclear"
                         and not l["dismissed"] and not l["review"]]
        pending_unclear = sum(l["pending"] or 0 for l in unclear_links) if unclear_links else None
        changes = [l["change_12m"] for l in pending_links if l["change_12m"] is not None]
        change_12m = sum(changes) if changes else None
        base = (pending_actions - change_12m) if pending_actions is not None and change_12m is not None else None
        change_pct = round(100 * change_12m / base, 1) if base else None
        annual = fdata["annual"] if fdata else {m: [] for m in fin.METRICS}
        derived = fdata["derived"] if fdata else {"accrual_pct_revenue": [], "expense_pct_revenue": [], "yoy": {}}
        latest = {m: compact_point(latest_point(annual[m])) for m in fin.METRICS}
        acc_yoy = (derived["yoy"].get("litigation_accrual") or [{}])[-1].get("change_pct") if annual["litigation_accrual"] else None
        exp_yoy = (derived["yoy"].get("litigation_expense") or [{}])[-1].get("change_pct") if annual["litigation_expense"] else None
        acc = latest["litigation_accrual"]
        ratio_any = next((r["pct"] for r in derived["accrual_pct_revenue"] if acc and r["fy"] == acc["fy"]), None)
        # Financial flags use only current figures: the fiscal year must be the company's latest
        # reported fiscal year (any tracked metric) or the one before it.
        latest_fy = max((p["fy"] for m in fin.METRICS for p in annual[m][-1:]), default=None)
        still_reporting = latest_fy is not None and latest_fy >= date.today().year - 2

        def current(point):
            return bool(point) and still_reporting and point["fy"] >= latest_fy - 1
        # Recency rule for the headline accrual: only the latest or prior fiscal year of a company still
        # filing XBRL is "current"; older accruals stay visible but are labelled and not ranked.
        accrual_current = current(acc)
        ratio = ratio_any if accrual_current else None
        exp = latest["litigation_expense"]
        flags = []
        if current(acc) and acc_yoy is not None and acc_yoy >= 50 and change_12m is not None and change_12m > 0:
            flags.append("accrual_surge")
        if current(acc) and ratio is not None and ratio >= 5:
            flags.append("accrual_heavy")
        if current(exp) and exp_yoy is not None and exp_yoy >= 100:
            flags.append("expense_spike")
        if change_pct is not None and change_pct >= 25 and (pending_actions or 0) >= 100:
            flags.append("docket_growth")
        if len(pending_links) >= 3:
            flags.append("multi_mdl")
        has_fin = bool(fdata and (annual["revenue"] or annual["net_income"] or annual["assets"]))
        # Subsidiaries that only appear as co-registrants on another linked company's filings.
        co_parents = set()
        if not has_fin:
            for l in links:
                for v in l["verified"]:
                    for co in v["co_registrants"]:
                        co_parents.add(co)
        # Badge = strongest evidence among the links that contribute to the pending-actions total.
        tier_best = min((l["tier"] for l in pending_links), default=None)
        tier_any = min(l["tier"] for l in links)
        unit = (latest["revenue"] or latest["net_income"] or latest["assets"] or {}).get("unit")
        spark = {m: [{"fy": p["fy"], "v": p["value"]} for p in annual[m]] for m in ("revenue", "net_income", "litigation_accrual", "litigation_expense")}
        years = defaultdict(lambda: {"verified": set(), "search": set()})
        for l in links:
            for v in l["verified"]:
                years[int(v["file_date"][:4])]["verified"].add(v["adsh"])
        for p in pairs:
            if p["cik"] == cik:
                for s in p["search_hits"].get(p["tier"], []):
                    if s["file_date"]:
                        years[int(s["file_date"][:4])]["search"].add(s["adsh"])
        mentions = [{"year": y, "verified": len(v["verified"]), "search": len(v["search"])} for y, v in sorted(years.items())]
        # Sum of JPML pending actions across the company's pending exposure MDLs, per monthly report;
        # "mdls" says how many of those MDLs appear in that report (an MDL created later is absent).
        pend_sum = defaultdict(lambda: [0, 0])
        for l in pending_links:
            for x in l["series"]:
                pend_sum[x["date"]][0] += x["pending"]
                pend_sum[x["date"]][1] += 1
        pending_series = [{"date": d, "pending": v[0], "mdls": v[1]} for d, v in sorted(pend_sum.items())]
        summary = {
            "company": prof,
            "has_financials": has_fin, "co_registrant_of": sorted(co_parents)[:4] if co_parents else [],
            "currency": unit, "taxonomy": fdata["taxonomy"] if fdata else None,
            "mdls": [{k: l[k] for k in ("mdl", "mdl_title", "mdl_status", "mdl_type", "pending", "change_12m", "tier", "role", "verified_count", "first_verified", "last_verified", "counts_toward_exposure", "district", "judge", "dismissed", "review", "title_truncated")} for l in links],
            "exposure": {
                "linked_mdls": len(links), "pending_mdls": len(pending_links), "pending_actions": pending_actions,
                "pending_change_12m": change_12m, "pending_change_pct": change_pct,
                "share_of_all_pending_pct": round(100 * pending_actions / pending_total_all, 2) if pending_actions and pending_total_all else None,
                "strongest_tier": tier_best, "strongest_tier_any": tier_any,
                "excluded_by_role": len(links) - len(exposure_links),
                "roles": dict(Counter(l["role"] for l in links)),
                "pending_actions_ab": pending_ab, "pending_actions_c": pending_c,
                "pending_actions_unclear": pending_unclear, "pending_mdls_unclear": len(unclear_links),
                "dismissed_links": sum(1 for l in links if l["dismissed"]), "review_links": sum(1 for l in links if l["review"]),
            },
            "latest": latest, "accrual_pct_revenue": ratio, "accrual_yoy_pct": acc_yoy, "expense_yoy_pct": exp_yoy,
            "accrual_current": accrual_current, "accrual_pct_revenue_any": ratio_any, "latest_fy": latest_fy,
            "accrual_pct_series": derived["accrual_pct_revenue"],
            "spark": spark, "mentions_by_year": mentions, "pending_series": pending_series,
            "verified_filings": sum(l["verified_count"] for l in links),
            "flags": flags,
        }
        name = prof["name"]
        tick = ", ".join(prof["tickers"]) if prof["tickers"] else ""
        facts_list = [
            ["CIK", cik], ["Tickers", tick or "Not recorded"], ["SIC", f"{prof['sic']} · {prof['sic_description']}" if prof["sic"] else "Not recorded"],
            ["State of incorporation", prof["state_of_incorporation_name"] or prof["state_of_incorporation"] or "Not recorded"],
            ["Business address", ", ".join(x for x in (prof["business_city"], prof["business_state_name"] or prof["business_state"]) if x) or "Not recorded"],
            ["Linked MDLs (own filings)", str(len(links))],
            ["Pending actions, linked MDLs where the company is a defendant", f"{fmt(pending_actions)} (A/B {fmt(pending_ab)} · C {fmt(pending_c)})"],
            ["Revenue (latest FY)", money(latest["revenue"]["value"], latest["revenue"]["unit"]) + f" · FY{latest['revenue']['fy']}" if latest["revenue"] else "Not recorded"],
            ["Litigation accrual (latest FY, company-wide, not MDL-specific)", money(acc["value"], acc["unit"]) + f" · FY{acc['fy']}{'' if accrual_current else ' (not current)'} · {acc['concept']}" if acc else "Not recorded"],
            ["Accrual as % of revenue", pct(ratio)],
            ["Sources", "SEC EDGAR full-text search, filing documents, submissions and XBRL companyfacts; JPML pending MDL reports"],
        ]
        profiles.append(cw.record(
            "company_sec_profiles", cik, name,
            source_url=edgar_company_url(cik),
            subtitle=" · ".join(x for x in [tick, prof["sic_description"] or "", f"{len(links)} linked MDL{'s' if len(links) != 1 else ''}"] if x),
            cells={"company": name, "tickers": tick or "—", "sector": prof["sic_description"] or "—", "mdls": str(len(links)),
                   "pending": fmt(pending_actions), "revenue": money(latest["revenue"]["value"], latest["revenue"]["unit"]) if latest["revenue"] else "Not recorded",
                   "accrual": money(acc["value"], acc["unit"]) if acc else "Not recorded", "accrual_pct": pct(ratio)},
            facts=facts_list,
            badges=[FLAG_LABEL[f] for f in flags],
            links=[{"url": f"/companies/{cik}", "label": "Company intelligence"}, {"url": edgar_company_url(cik), "label": "EDGAR filings"},
                   {"url": fx.companyfacts_url(cik), "label": "XBRL companyfacts (SEC)"}],
            text=" ".join([name, tick, prof["sic_description"] or "", " ".join(prof["former_names"]), " ".join(str(l["mdl"]) + " " + l["mdl_title"] for l in links)]),
            filters={"tier": [tier_best or "none"], "flag": flags or ["none"], "has_financials": ["yes" if has_fin else "no"], "sic": [prof["sic"] or ""]},
            state=prof["business_state"] if prof["business_state"] and len(prof["business_state"]) == 2 and not prof.get("business_foreign") else "",
            extra={"kind": "company", "summary": summary},
        ))
        if fdata:
            fin_rows.append(cw.record(
                "company_sec_financials", cik, f"{name} — XBRL financial series",
                source_url=fx.companyfacts_url(cik),
                subtitle=f"{fdata['taxonomy']} · {len(fdata['annual']['revenue'])} fiscal years of revenue · {len(fdata['concepts_present'])} tracked concepts reported",
                cells={"company": name, "taxonomy": fdata["taxonomy"], "years": str(len(fdata["annual"]["revenue"])), "concepts": str(len(fdata["concepts_present"]))},
                facts=[["CIK", cik], ["Taxonomy", fdata["taxonomy"]], ["Tracked concepts reported", ", ".join(fdata["concepts_present"]) or "None"],
                       ["Rules", "Annual: 340-380 day periods from 10-K/20-F/40-F; quarterly: 80-100 day periods; one value per period, latest filed; balances only on the company's own period-end dates; no currency conversion"],
                       ["Source", f"SEC XBRL companyfacts API, retrieved {TODAY}"]],
                text=f"{name} xbrl financials",
                filters={"taxonomy": [fdata["taxonomy"]]},
                links=[{"url": fx.companyfacts_url(cik), "label": "XBRL companyfacts (SEC)"}, {"url": f"/companies/{cik}", "label": "Company intelligence"}],
                extra={"kind": "financials", "cik": cik, "name": name, "retrieved": TODAY, **fdata, "labels": METRIC_LABEL},
            ))

    for cik, links in by_company.items():
        name = companies[cik]["profile"]["name"]
        for l in links:
            latest_v = l["verified"][-1]
            link_rows.append(cw.record(
                "company_sec_mdl_links", f"{cik}:{l['mdl']}", f"{name} — MDL {l['mdl']}",
                source_url=latest_v["url"],
                subtitle=f"{l['tier_label']} · {l['verified_count']} verified filing{'s' if l['verified_count'] != 1 else ''} · {l['role_label']}",
                cells={"company": name, "mdl": str(l["mdl"]), "litigation": l["mdl_title"], "tier": l["tier"], "role": l["role"].replace("_", " "),
                       "verified": str(l["verified_count"]), "first": l["first_verified"], "last": l["last_verified"]},
                facts=[["Company", f"{name} (CIK {cik})"], ["MDL", f"{l['mdl']} · {l['mdl_title']}"], ["Evidence tier", l["tier_label"]],
                       ["Role in latest excerpt (deterministic phrase rule; requires review)", l["role_label"]],
                       ["Verified filings", str(l["verified_count"])], ["Full-text search matches", str(l["search_count"])],
                       ["First / last verified filing", f"{l['first_verified']} / {l['last_verified']}"],
                       ["Latest verified filing", f"{latest_v['form']} filed {latest_v['file_date']} · accession {latest_v['adsh']}"],
                       ["Method", "Candidate from EDGAR full-text search; the filing document was downloaded and the rule re-checked against its text before linking."]],
                links=[{"url": latest_v["url"], "label": f"{latest_v['form']} {latest_v['file_date']} (SEC)"}, {"url": latest_v["index_url"], "label": "Filing index (SEC)"},
                       {"url": f"/companies/{cik}", "label": "Company intelligence"}, {"url": f"/records/mdl_analytics/{l['mdl']}", "label": "MDL record"}],
                text=f"{name} {l['mdl']} {l['mdl_title']} {l['tier_label']}",
                filters={"tier": [l["tier"]], "role": [l["role"]], "mdl": [str(l["mdl"])], "cik": [cik], "status": [l["mdl_status"]]},
                extra={"kind": "link", "link": l},
            ))

    profiles.append(overview_record(inputs, targets, pairs, by_company, companies, profiles))
    if dry_run:
        out = ROOT / "private" / "scratch" / "sec-companies" / "preview.json"
        out.write_text(json.dumps({"profiles": profiles, "links": link_rows[:50], "financials": fin_rows[:5]}, indent=1, default=str))
        print("preview", len(profiles), len(link_rows), len(fin_rows))
        return
    common = {"source": "SEC EDGAR (efts.sec.gov full-text search, www.sec.gov filing documents, data.sec.gov submissions and XBRL companyfacts) and JPML pending MDL reports", "retrieved": TODAY}
    cw.publish("company_sec_profiles", "SEC company intelligence for MDL defendants", profiles,
               listing_block=cw.listing([("company", "Company"), ("tickers", "Ticker"), ("sector", "Sector (SIC)"), ("mdls", "Linked MDLs"), ("pending", "Pending actions"), ("revenue", "Revenue"), ("accrual", "Litigation accrual"), ("accrual_pct", "Accrual % revenue")],
                                        [("tier", "Strongest counted evidence", {**TIER_LABEL, "none": "No pending MDL read as defendant"}), ("flag", "Flag", {**FLAG_LABEL, "none": "No flag"}), ("has_financials", "XBRL financials", {"yes": "Reported", "no": "Not reported"})]),
               summary={**common, "companies": len(profiles) - 1})
    cw.publish("company_sec_mdl_links", "Company–MDL links from SEC filings", link_rows,
               listing_block=cw.listing([("company", "Company"), ("mdl", "MDL"), ("litigation", "Litigation"), ("tier", "Tier"), ("role", "Role (excerpt)"), ("verified", "Verified filings"), ("first", "First"), ("last", "Last")],
                                        [("tier", "Evidence tier", TIER_LABEL), ("role", "Role in excerpt", ROLE_LABEL), ("status", "MDL status", {"pending": "Pending", "terminated": "Terminated", "no_longer_listed": "No longer listed"})]),
               summary={**common, "links": len(link_rows)})
    cw.publish("company_sec_financials", "XBRL financial series for MDL-linked companies", fin_rows,
               listing_block=cw.listing([("company", "Company"), ("taxonomy", "Taxonomy"), ("years", "Revenue years"), ("concepts", "Tracked concepts")], [("taxonomy", "Taxonomy", {"us-gaap": "US GAAP", "ifrs-full": "IFRS"})]),
               summary={**common, "companies": len(fin_rows)})


def overview_record(inputs, targets, pairs, by_company, companies, profiles):
    pending_targets = [t for t in targets.values() if t["status"] == "pending"]
    coverage = []
    for t in sorted(targets.values(), key=lambda t: (t["status"] != "pending", -(t["pending"] or 0), t["mdl"])):
        linked = [(cik, l) for cik, ls in by_company.items() for l in ls if l["mdl"] == t["mdl"]]
        coverage.append({
            "mdl": t["mdl"], "title": t["title"], "status": t["status"], "pending": t["pending"], "type": t.get("type"),
            "title_truncated": len(tg.caption_core(t["title"]).split()) <= 3,
            "companies": [{"cik": cik, "name": companies[cik]["profile"]["name"], "tier": l["tier"], "role": l["role"],
                           "counted": l["counts_toward_exposure"], "dismissed": l["dismissed"], "review": l["review"],
                           "has_financials": bool(companies[cik]["fin"])} for cik, l in sorted(linked, key=lambda x: (not x[1]["counts_toward_exposure"], x[1]["tier"]))],
        })
    counted_ab = counted_c = unclear_only = 0
    for row in coverage:
        if row["status"] != "pending" or not row["pending"]:
            continue
        counted = [c for c in row["companies"] if c["counted"]]
        if counted:
            if any(c["tier"] in ("A", "B") for c in counted):
                counted_ab += row["pending"]
            else:
                counted_c += row["pending"]
        elif any(c["role"] == "unclear" and not c["dismissed"] and not c["review"] for c in row["companies"]):
            unclear_only += row["pending"]
    years = defaultdict(lambda: {"A": set(), "B": set(), "C": set()})
    for p in pairs:
        for v in p["verified"]:
            years[int(v["file_date"][:4])][p["tier"]].add(v["adsh"])
    tiers = Counter(p["tier"] for p in pairs)
    roles = Counter(l["role"] for ls in by_company.values() for l in ls)
    sectors = defaultdict(lambda: {"companies": 0, "pending": 0})
    accrual_ratios = []
    for r in profiles:
        s = r["item"]["summary"]
        key = s["company"]["sic_description"] or "Not recorded"
        sectors[key]["companies"] += 1
        sectors[key]["pending"] += s["exposure"]["pending_actions"] or 0
        if s["accrual_pct_revenue"] is not None:
            accrual_ratios.append(s["accrual_pct_revenue"])
    overview = {
        "as_of": TODAY, "jpml_as_of": max((m["as_of"] for m in inputs["mdls"] if m.get("as_of")), default=None),
        "target_mdls": len(targets), "pending_targets": len(pending_targets),
        "mdls_with_links": len({p["mdl"] for p in pairs}),
        "pending_actions_counted": counted_ab + counted_c, "pending_actions_counted_ab": counted_ab,
        "pending_actions_counted_c": counted_c, "pending_actions_unclear_only": unclear_only,
        "dropped_by_review": len(REVIEWED_DROP), "role_reviews": len(REVIEWED_ROLE), "review_notes": len(REVIEW_NOTE),
        "pending_mdls_with_links": len({p["mdl"] for p in pairs if targets[p["mdl"]]["status"] == "pending"}),
        "companies": len(companies), "companies_with_financials": sum(1 for c in companies.values() if c["fin"]),
        "links": len(pairs), "tiers": dict(tiers), "roles": dict(roles),
        "verified_filings": len({v["adsh"] for p in pairs for v in p["verified"]}),
        "filings_by_year": [{"year": y, **{k: len(v[k]) for k in "ABC"}} for y, v in sorted(years.items())],
        "coverage": coverage,
        "sectors": sorted(({"sector": k, **v} for k, v in sectors.items()), key=lambda s: -s["pending"]),
        "median_accrual_pct_revenue": round(statistics.median(accrual_ratios), 2) if accrual_ratios else None,
        "flag_rules": FLAG_RULES, "flag_labels": FLAG_LABEL, "tier_labels": TIER_LABEL, "role_labels": ROLE_LABEL,
        "method": [
            "Targets: pending products-liability, common-disaster and air-disaster MDLs from JPML monthly reports, MDLs that left the pending report with a products-liability or personal-injury caption, and products-liability MDLs terminated since 2012 per the JPML terminated-litigations report (number search only).",
            "Candidates come from EDGAR full-text search (2001 onward). Every candidate filing is downloaded and the rule is re-checked against the document text; search hits alone never create a link.",
            "Tier A: the filing contains 'MDL No. <n>', 'MDL <n>', 'MDL Docket No. <n>' or the federal master docket '<yy>-md-<n>'. Tier B: the filing contains every word of the official JPML caption in order. Tier C (requires review): 'MDL' or 'multidistrict' in the same paragraph as a caption subject term and within 500 characters of it, with a products-liability term and every required manufacturer term in that paragraph, a filing date on or after the JPML docket date, and no other target MDL's subject in the MDL sentence or closer to the MDL mention.",
            "Only the registrant's own 10-K, 10-Q, 8-K, 20-F, 6-K, 40-F, registration statements and annual reports count; fund, ownership and asset-backed filers are excluded, and a paragraph describing the registrant as an insurer defending policyholders' claims never counts.",
            "Role is a deterministic phrase reading of the match's own paragraph and the next one (never an earlier paragraph). Only links read as 'defendant' count toward pending-action totals; 'role not stated' links are summed separately; 'not named', claimant, dismissal-language and review-flagged links are never counted. Totals are split by evidence strength (A/B vs C).",
            "Reviewed decisions from an independent verification are published on the link (dropped links, role corrections, review notes).",
            "Financials are the registrant's own XBRL facts (standard us-gaap / ifrs-full concepts only; company-specific extension tags are not in the SEC companyfacts API). The litigation accrual is the company's total reported accrual for the concept named, company-wide and not MDL-specific; it is 'current' only for the latest or prior fiscal year of a company still filing XBRL.",
        ],
    }
    return cw.record(
        "company_sec_profiles", "summary:overview", "SEC company intelligence overview",
        source_url="https://www.sec.gov/edgar/search/",
        subtitle=f"{overview['companies']} registrants · {overview['links']} verified company–MDL links · {overview['mdls_with_links']} MDLs",
        cells={"company": "Overview", "tickers": "—", "sector": "—", "mdls": str(overview["mdls_with_links"]), "pending": "—", "revenue": "—", "accrual": "—", "accrual_pct": "—"},
        facts=[["Registrants linked", str(overview["companies"])], ["Company–MDL links", str(overview["links"])], ["Verified filings", str(overview["verified_filings"])],
               ["Target MDLs searched", str(overview["target_mdls"])], ["Built", TODAY]],
        text="summary overview", filters={"_listing": ["no"], "kind": ["summary"]},
        extra={"kind": "summary", "overview": overview},
    )


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
