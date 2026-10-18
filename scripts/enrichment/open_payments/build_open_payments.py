"""Build and publish the Open Payments lane datasets.

  company_payments_manufacturers  one record per reporting entity (top 300 by 2017-2025 general + research dollars)
  company_payments_states         one record per U.S. state / territory, plus a national record (id op-state-US)
  company_adverse_manufacturers   one record per device-linked top-300 entity searched in MAUDE (openFDA)

Sources and precedence (no value is inferred):
  * Program years 2019-2025 totals: CMS summary datasets (DKAN API) fetched by fetch_summaries.py; they reconcile to
    the cent with the CMS national Summary Dashboard (reconcile.py, run as a gate here).
  * Program years 2017-2018 totals: sums of the CMS archived detail files (archive_aggregate.py).
  * Recipient-state, first-listed-product and product-type breakdowns per entity: sums of the CMS detail files for
    every year (CMS publishes no such summary). For 2019-2025 each entity-year's detail sum is checked against the
    CMS summary total; the number of matching entity-years is stored on every record.
  * Nature-of-payment codes: nature_codes.json (codes matched to labels by exact dollar and record agreement).
  * MAUDE: fetch_maude.py (exact normalized-name rule; requires review).

Run order: fetch_summaries.py -> fetch_details.py -> build_open_payments.py --prepare -> fetch_maude.py
           -> build_open_payments.py --publish
"""
import datetime as dt
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from op_model import ACQ, API_YEARS, ARCHIVE_YEARS, YEARS, count, load_api, load_detail, money, ranked  # noqa: E402
from op_sources import ARCHIVE_PAGE, BY_ENTITY, DASHBOARD, DATASET_PAGE, DOWNLOAD_PAGE, ENTITY_PROFILE, NATURE_BY_ENTITY, STATE_NATURE, STATE_TOTALS, ZIPS  # noqa: E402
import reconcile  # noqa: E402

TOP = 300
DEVICE_SHARE_SEARCH = 0.10
DEVICE_TYPES = {"Device", "Medical Supply"}
COVERED_RESEARCH = {"Covered Recipient Physician", "Covered Recipient Teaching Hospital", "Covered Recipient Non-Physician Practitioner"}
NATURE = json.load(open(os.path.join(HERE, "nature_codes.json")))["codes"]
LABEL_CODE = {label: code for code, label in NATURE.items()}
TODAY = dt.date.today().isoformat()
LATEST = API_YEARS[-1]

STATE_NAMES = {}


def fmt_usd(v):
    if v is None:
        return "Not recorded"
    if abs(v) >= 1e9:
        return f"${v / 1e9:,.2f}B"
    if abs(v) >= 1e6:
        return f"${v / 1e6:,.1f}M"
    return f"${v:,.0f}"


def cents(v):
    return round(v / 100, 2)


def details():
    return {year: load_detail(year) for year in YEARS}


def entity_profiles():
    out = {}
    for row in load_api("entity_profile")["rows"]:
        eid = str(row.get("amgpo_making_payment_id") or "").strip()
        alts = [row.get(f"amgpo_making_payment_alternate_name{i}") for i in range(1, 6)]
        out[eid] = {
            "name": (row.get("amgpo_making_payment_name") or "").strip(),
            "state": (row.get("amgpo_making_payment_state") or "").strip(),
            "country": (row.get("amgpo_making_payment_country") or "").strip(),
            "alts": [a.strip() for a in alts if isinstance(a, str) and a.strip()],
        }
    return out


def nature_by_entity():
    """{eid: {year: {code: [amount, records]}}} from CMS summaries (2019-2025) and archive sums (2017-2018)."""
    out = defaultdict(lambda: defaultdict(dict))
    for year in API_YEARS:
        for row in load_api(f"nature_by_entity_{year}")["rows"]:
            code = str(row.get("nature_of_payment_type_code") or "").strip()
            amount = money(row.get("total_amount"))
            if code not in NATURE or amount is None:
                raise SystemExit(f"unmapped nature code {code!r} in {year}")
            out[str(row["amgpo_id"]).strip()][year][code] = [amount, count(row.get("number_of_transaction"))]
    for year in ARCHIVE_YEARS:
        for eid, label, amount, n in load_detail(year)["general_by_entity_nature"]:
            if label not in LABEL_CODE:
                raise SystemExit(f"unmapped nature label {label!r} in {year}")
            out[eid][year][LABEL_CODE[label]] = [cents(amount), n]
    return out


def entity_checks(det, years):
    """Compare every 2019-2025 entity-year detail sum with the CMS summary total."""
    checks, mismatches = {}, []
    for year in API_YEARS:
        gen = {r[0]: (r[1], r[2]) for r in det[year]["general_by_entity"]}
        res = {r[0]: (r[1], r[2]) for r in det[year]["research_by_entity"]}
        for eid, by_year in years.items():
            if year not in by_year:
                continue
            s = by_year[year]
            g, r = gen.get(eid, (0, 0)), res.get(eid, (0, 0))
            ok = abs(cents(g[0]) - s["general"]) <= 1 and g[1] == s["generalRecords"] and abs(cents(r[0]) - s["research"]) <= 1 and r[1] == s["researchRecords"]
            checks.setdefault(eid, [0, 0])
            checks[eid][1] += 1
            if ok:
                checks[eid][0] += 1
            else:
                mismatches.append({"entity": eid, "year": year, "detail_general": cents(g[0]), "summary_general": s["general"], "detail_research": cents(r[0]), "summary_research": s["research"]})
    return checks, mismatches


def per_entity_breakdowns(det):
    states = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    states_latest = defaultdict(dict)
    ptypes = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    products = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for year in YEARS:
        d = det[year]
        for eid, st, amount, n in d["general_by_entity_state"]:
            states[eid][st][0] += amount
            states[eid][st][1] += n
            if year == LATEST:
                states_latest[eid][st] = [amount, n]
        for eid, ptype, amount, n in d["general_by_entity_product_type"]:
            ptypes[eid][ptype][0] += amount
            ptypes[eid][ptype][1] += n
        for eid, rows in d["general_top_products_by_entity"].items():
            for prod, ptype, amount, n in rows:
                products[eid][(prod, ptype)][0] += amount
                products[eid][(prod, ptype)][1] += n
    return states, states_latest, ptypes, products


def state_slices(d, limit):
    rows = [{"state": st, "amount": cents(v[0]), "records": v[1]} for st, v in d.items() if st and len(st) == 2 and st.isalpha()]
    return sorted(rows, key=lambda r: -r["amount"])[:limit]


def manufacturer_records(top, years, names, det):
    profiles = entity_profiles()
    natures = nature_by_entity()
    checks, mismatches = entity_checks(det, years)
    states, states_latest, ptypes, products = per_entity_breakdowns(det)
    rank_general = {eid: i + 1 for i, (eid, *_) in enumerate(sorted(top, key=lambda t: -t[2]))}
    rank_research = {eid: i + 1 for i, (eid, *_) in enumerate(sorted(top, key=lambda t: -t[3]))}
    rows, device_linked, models = [], {}, []
    for rank, (eid, combined, general, research) in enumerate(top, 1):
        by_year = years[eid]
        latest_year = max(by_year)
        prof = profiles.get(eid, {})
        latest_name = names[eid][latest_year].get("name") or prof.get("name") or eid
        alt = sorted({n for n in [prof.get("name", "")] + prof.get("alts", []) + [v.get("name", "") for v in names[eid].values()] if n and n != latest_name})
        series = []
        for year in YEARS:
            v = by_year.get(year)
            series.append({
                "year": int(year),
                "general": v["general"] if v else 0.0,
                "generalRecords": v["generalRecords"] if v else 0,
                "research": v["research"] if v else 0.0,
                "researchRecords": v["researchRecords"] if v else 0,
                "source": ("summary" if year in API_YEARS else "archive"),
            })
        nat = defaultdict(lambda: [0.0, 0])
        for year, codes in natures.get(eid, {}).items():
            for code, (amount, n) in codes.items():
                nat[code][0] += amount
                nat[code][1] += n or 0
        nature = sorted(({"code": c, "label": NATURE[c], "amount": round(v[0], 2), "records": v[1]} for c, v in nat.items()), key=lambda r: -r["amount"])
        nature_latest = sorted(({"code": c, "label": NATURE[c], "amount": round(v[0], 2), "records": v[1]} for c, v in natures.get(eid, {}).get(LATEST, {}).items()), key=lambda r: -r["amount"])
        type_rows = sorted(({"type": t or "Not recorded", "amount": cents(v[0]), "records": v[1]} for t, v in ptypes[eid].items()), key=lambda r: -r["amount"])
        device_amount = sum(r["amount"] for r in type_rows if r["type"] in DEVICE_TYPES)
        device_share = round(device_amount / general, 4) if general > 0 else None
        prod_rows = sorted(({"name": p, "type": t or "Not recorded", "amount": cents(v[0]), "records": v[1]} for (p, t), v in products[eid].items()), key=lambda r: -r["amount"])[:12]
        totals = {
            "general": round(general, 2),
            "research": round(research, 2),
            "generalRecords": sum(s["generalRecords"] or 0 for s in series),
            "researchRecords": sum(s["researchRecords"] or 0 for s in series),
        }
        check = checks.get(eid, [0, 0])
        sources = [
            {"label": "CMS summary: payments grouped by reporting entities (2019-2025)", "url": DATASET_PAGE + BY_ENTITY},
            {"label": f"CMS summary: reporting entities and nature of payments ({LATEST})", "url": DATASET_PAGE + NATURE_BY_ENTITY[LATEST]},
            {"label": "CMS reporting entity profile information", "url": DATASET_PAGE + ENTITY_PROFILE},
            {"label": "CMS detail files 2019-2025 (Dataset Downloads)", "url": DOWNLOAD_PAGE},
            {"label": "CMS archived detail files 2017-2018", "url": ARCHIVE_PAGE},
        ]
        payments = {
            "entityId": eid,
            "name": latest_name,
            "altNames": alt,
            "hqState": names[eid][latest_year].get("state") or prof.get("state") or None,
            "country": names[eid][latest_year].get("country") or prof.get("country") or None,
            "rank": rank,
            "rankGeneral": rank_general[eid],
            "rankResearch": rank_research[eid],
            "totals": totals,
            "years": series,
            "nature": nature,
            "natureLatest": nature_latest,
            "states": state_slices(states[eid], 12),
            "statesLatest": state_slices(states_latest[eid], 8),
            "latestYear": int(LATEST),
            "productTypes": type_rows,
            "products": prod_rows,
            "deviceShare": device_share,
            "stateCheck": {"matched": check[0], "of": check[1]},
            "sourceUrl": f"https://openpaymentsdata.cms.gov/company/{eid}",
            "sources": sources,
        }
        models.append(payments)
        if device_share is not None and device_share >= DEVICE_SHARE_SEARCH:
            device_linked[eid] = latest_name
        latest = series[-1]
        cells = {
            "rank": str(rank), "manufacturer": latest_name, "hq": payments["hqState"] or "—",
            "general": fmt_usd(totals["general"]), "research": fmt_usd(totals["research"]),
            "latest": fmt_usd(latest["general"]), "device_share": "—" if device_share is None else f"{device_share * 100:.0f}%",
        }
        facts = [
            ["CMS reporting entity ID", eid],
            ["Headquarters (as reported to CMS)", ", ".join(x for x in [payments["hqState"], payments["country"]] if x) or "Not recorded"],
            ["General payments, 2017-2025", fmt_usd(totals["general"])],
            ["Research payments, 2017-2025", fmt_usd(totals["research"])],
            [f"General payments, {LATEST}", fmt_usd(latest["general"])],
            ["Rank (general + research, 2017-2025)", f"{rank} of {TOP}"],
            ["Largest nature of payment", nature[0]["label"] if nature else "Not recorded"],
            ["Share on device / medical supply records", cells["device_share"]],
            ["Detail-file check against CMS summary", f"{check[0]} of {check[1]} program years match"],
            ["Sources", "CMS Open Payments summary datasets (2019-2025); archived detail files (2017-2018)"],
        ]
        rows.append({
            "id": f"op-{eid}", "title": latest_name, "payments": payments, "cells": cells, "facts": facts,
            "subtitle": f"#{rank} · {fmt_usd(totals['general'])} general · {fmt_usd(totals['research'])} research · 2017-2025",
            "device": "yes" if eid in device_linked else "no",
        })
    return rows, device_linked, mismatches


def state_records(det):
    totals = defaultdict(lambda: defaultdict(lambda: {"general": 0.0, "generalRecords": 0, "research": 0.0, "researchRecords": 0, "physicians": None, "npps": None, "teachingHospitals": None}))
    for row in load_api("state_totals")["rows"]:
        if row.get("country_code") != "US" or not row.get("state_code"):
            continue
        st, year = row["state_code"].strip(), str(row["program_year"])
        STATE_NAMES[st] = row["state_name"].strip()
        t = totals[st][year]
        amount = sum(money(row.get(f"total_payment_amount_{k}")) or 0 for k in ("physician", "non_physician_practitioner", "teaching_hospital"))
        records = sum(count(row.get(f"total_payment_count_{k}")) or 0 for k in ("physician", "non_physician_practitioner", "teaching_hospital"))
        if row["payment_type"] == "General":
            t["general"] += amount
            t["generalRecords"] += records
            rtype = row["recipient_type"]
            field = {"Covered Recipient Physician": ("physicians", "total_number_of_physicians"), "Covered Recipient Non-Physician Practitioner": ("npps", "total_number_of_non_physician_practitioners"), "Covered Recipient Teaching Hospital": ("teachingHospitals", "total_number_of_teaching_hospitals")}.get(rtype)
            if field:
                t[field[0]] = count(row.get(field[1]))
        elif row["payment_type"] == "Research":
            t["research"] += amount
            t["researchRecords"] += records
    for year in ARCHIVE_YEARS:
        d = det[year]
        for st, rtype, amount, n in d["general_by_state_recipient_type"]:
            if len(st) == 2 and st in STATE_NAMES:
                t = totals[st][year]
                t["general"] += cents(amount)
                t["generalRecords"] += n
        for st, rtype, amount, n in d["research_by_state_recipient_type"]:
            if len(st) == 2 and st in STATE_NAMES and rtype in COVERED_RESEARCH:
                t = totals[st][year]
                t["research"] += cents(amount)
                t["researchRecords"] += n
    nature = defaultdict(lambda: defaultdict(float))
    for year in API_YEARS:
        for row in load_api(f"state_nature_{year}")["rows"]:
            if row.get("country_code") != "US" or not row.get("state_code"):
                continue
            amount = sum(money(row.get(f"total_payment_amount_{k}")) or 0 for k in ("physician", "non_physician_practitioner", "teaching_hospital"))
            nature[(row["state_code"].strip(), year)][row["nature_of_payment"].strip()] += amount
    for year in ARCHIVE_YEARS:
        for st, label, amount, n in det[year]["general_by_state_nature"]:
            if st in STATE_NAMES:
                nature[(st, year)][label] += cents(amount)
    out = []
    for st in sorted(totals):
        years = []
        for year in YEARS:
            t = totals[st].get(year)
            src = "summary" if year in API_YEARS else "archive"
            if t is None:
                years.append({"year": int(year), "general": None, "generalRecords": None, "research": None, "researchRecords": None, "physicians": None, "npps": None, "teachingHospitals": None, "source": src})
            else:
                years.append({"year": int(year), "general": round(t["general"], 2), "generalRecords": t["generalRecords"], "research": round(t["research"], 2), "researchRecords": t["researchRecords"], "physicians": t["physicians"], "npps": t["npps"], "teachingHospitals": t["teachingHospitals"], "source": src})
        combined = defaultdict(float)
        by_year = {}
        for year in YEARS:
            labels = nature.get((st, year), {})
            by_year[year] = sorted(({"label": k, "amount": round(v, 2)} for k, v in labels.items() if v), key=lambda r: -r["amount"])
            for k, v in labels.items():
                combined[k] += v
        out.append({"state": st, "name": STATE_NAMES[st].title().replace(" Of ", " of ").replace(" And ", " and "), "years": years, "nature": sorted(({"label": k, "amount": round(v, 2)} for k, v in combined.items() if v), key=lambda r: -r["amount"]), "natureByYear": by_year, "sourceUrl": DATASET_PAGE + STATE_TOTALS})
    return out


def national_record(det):
    dash = reconcile.dashboard()
    years = []
    for year in YEARS:
        if year in API_YEARS:
            years.append({"year": int(year), "general": dash["Total Dollar Amount of all Payment Records - General Payments"][year], "generalRecords": count(dash["Total Number of all Payment Records - General Payments"][year]), "research": dash["Total Dollar Amount of all Payment Records - Research Payments"][year], "researchRecords": count(dash["Total Number of all Payment Records - Research Payments"][year]), "physicians": None, "npps": None, "teachingHospitals": None, "source": "summary"})
        else:
            d = det[year]
            years.append({"year": int(year), "general": cents(d["general_total"][0]), "generalRecords": d["general_total"][1], "research": cents(d["research_total"][0]), "researchRecords": d["research_total"][1], "physicians": None, "npps": None, "teachingHospitals": None, "source": "archive"})
    by_year, combined = {}, defaultdict(float)
    for year in API_YEARS:
        acc = defaultdict(float)
        for row in load_api(f"nature_by_entity_{year}")["rows"]:
            acc[NATURE[str(row["nature_of_payment_type_code"]).strip()]] += money(row.get("total_amount")) or 0
        by_year[year] = acc
    for year in ARCHIVE_YEARS:
        by_year[year] = {label: cents(amount) for label, amount, n in det[year]["general_by_nature"]}
    for acc in by_year.values():
        for k, v in acc.items():
            combined[k] += v
    entities = dash["Total Number of Companies Making Payments (AM/GPO Making Payment)"]
    return {
        "state": "US", "name": "United States (national, all recipients)", "years": years,
        "nature": sorted(({"label": k, "amount": round(v, 2)} for k, v in combined.items()), key=lambda r: -r["amount"]),
        "natureByYear": {y: sorted(({"label": k, "amount": round(v, 2)} for k, v in acc.items()), key=lambda r: -r["amount"]) for y, acc in by_year.items()},
        # CMS dashboard count of companies making payments; not reproduced for archived years (definitions differ).
        "reportingEntities": {y: count(entities[y]) for y in API_YEARS},
        "sourceUrl": DATASET_PAGE + DASHBOARD,
    }


def adverse_records(device_linked, totals_by_eid):
    path = os.path.join(ACQ, "maude_matches.json")
    if not os.path.exists(path):
        return [], None
    data = json.load(open(path))
    out = []
    for r in data["results"]:
        eid = r["entityId"]
        kind = r.get("kind", "open_payments")
        if kind == "open_payments" and eid not in device_linked:
            continue
        matched = bool(r["matchedNames"])
        reports, denominators = r.get("reportsByYear") or {}, r.get("denominatorByYear") or {}
        years = []
        for y in YEARS:
            n, d = reports.get(y, 0), denominators.get(y, 0)
            if n or d:
                years.append({"year": int(y), "reports": n, "denominator": d, "coverage": round(n / d, 4) if d else None})
        total = sum(y["reports"] for y in years)
        denominator = sum(y["denominator"] for y in years)
        out.append({
            "id": f"maude-sec-{eid}" if kind == "sec" else f"maude-{eid}", "kind": kind, "cik": r.get("cik"),
            "sicDescription": r.get("sicDescription"),
            "entityId": eid, "name": r.get("secName") if kind == "sec" else device_linked[eid], "matched": matched,
            "matchedNames": sorted(({"name": k, "reports": v} for k, v in r["matchedNames"].items()), key=lambda x: -x["reports"]),
            "years": years if matched else [],
            "total": total if matched else None,
            # Coverage: attributed reports / reports whose manufacturer name matches the phrase search or an
            # attributed spelling (2017-2025). Low coverage = most same-name reports sit under unattributed spellings.
            "denominator": denominator if matched else None,
            "coverage": round(total / denominator, 4) if matched and denominator else None,
            "ambiguous": [{"name": a["name"], "owners": a["owners"]} for a in r.get("ambiguous", [])],
            "keys": r["keys"], "discoverUrls": r["discoverUrls"], "seriesUrl": r.get("seriesUrl"), "denominatorUrl": r.get("denominatorUrl"), "retrievedAt": r.get("retrievedAt"),
            "unattributed": [{"name": n, "reportsAllTime": c} for n, c in r.get("unattributed", [])],
            "generalPayments": totals_by_eid.get(eid),
        })
    return out, data.get("generated_at")


def publish(manufacturers, states, national, adverse, adverse_generated, mismatches):
    import corpus_writer as cw

    generated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    method = {
        "ranking": f"Top {TOP} CMS reporting entities by general plus research payment dollars, program years 2017-2025. Each CMS reporting entity ID is a separate company; affiliates are not combined.",
        "years": "2019-2025 from CMS summary datasets (reconciled to the cent with the CMS Summary Dashboard). 2017-2018 are sums of the CMS archived detail files.",
        "nature": "General payments by nature of payment. Summary code numbers were matched to labels by exact dollar and record agreement with the detail data (2020, 2021, 2025).",
        "states": "Recipient state of the covered recipient (physician, non-physician practitioner, teaching hospital). Research totals include covered recipients only.",
        "products": "First product listed on each general-payment record; a record's full amount is credited to that product.",
        "maude": "MAUDE reports (date received) whose device manufacturer name is the same company name as the CMS reporting entity or SEC registrant: case and punctuation ignored, legal forms must agree (Inc., Corp. and Co. are one form; Ltd. and plc differ); plants, divisions and subsidiaries are not merged, so counts are a lower bound. Each spelling has one owner per source: the company whose current name matches it, otherwise it is ambiguous and excluded. Coverage = attributed reports / reports whose manufacturer name matches the phrase search or an attributed spelling. Requires review.",
    }
    rows = []
    for m in manufacturers:
        p = m["payments"]
        rows.append(cw.record(
            "company_payments_manufacturers", m["id"], m["title"], source_url=p["sourceUrl"], subtitle=m["subtitle"],
            cells=m["cells"], facts=m["facts"],
            links=[{"url": p["sourceUrl"], "label": "CMS Open Payments company profile"}] + [{"url": s["url"], "label": s["label"]} for s in p["sources"]],
            text=" ".join([p["name"], *p["altNames"], p["hqState"] or ""]),
            filters={"hq": [p["hqState"] or "not_recorded"], "device": [m["device"]]},
            badges=["Device-linked"] if m["device"] == "yes" else [],
            extra={"kind": "open_payments_manufacturer", "payments": p},
        ))
    cw.publish(
        "company_payments_manufacturers", "Open Payments: top manufacturers", rows,
        listing_block=cw.listing(
            [("rank", "Rank"), ("manufacturer", "Reporting entity"), ("hq", "HQ"), ("general", "General 2017-25"), ("research", "Research 2017-25"), ("latest", f"General {LATEST}"), ("device_share", "Device share")],
            [("device", "Device-linked", {"yes": "Device or supply share >= 10%", "no": "Other"})],
        ),
        summary={"generated_at": generated, "retrieved": TODAY, "source": "CMS Open Payments (openpaymentsdata.cms.gov)", "program_years": "2017-2025", "top": TOP, "method": method, "detail_summary_mismatches": len(mismatches), "datasets": {"by_entity": BY_ENTITY, "nature_by_entity": NATURE_BY_ENTITY, "entity_profile": ENTITY_PROFILE}, "zips": ZIPS},
    )
    srows = []
    for s in [national] + states:
        latest = s["years"][-1]
        srows.append(cw.record(
            "company_payments_states", f"op-state-{s['state']}", s["name"], source_url=s["sourceUrl"],
            subtitle=f"{fmt_usd(latest['general'])} general payments in {LATEST}",
            cells={"state": s["name"], "general": fmt_usd(latest["general"]), "research": fmt_usd(latest["research"]), "records": f"{latest['generalRecords']:,}" if latest["generalRecords"] is not None else "—"},
            facts=[[f"General payments, {LATEST}", fmt_usd(latest["general"])], [f"Research payments, {LATEST}", fmt_usd(latest["research"])], ["General payments, 2017-2025", fmt_usd(sum(y["general"] or 0 for y in s["years"]))], ["Largest nature of payment (2017-2025)", s["nature"][0]["label"] if s["nature"] else "Not recorded"], ["Source", "CMS state-level payment totals (2019-2025); archived detail files (2017-2018)"]],
            links=[{"url": s["sourceUrl"], "label": "CMS state-level summary dataset"}, {"url": DATASET_PAGE + STATE_NATURE[LATEST], "label": f"CMS state totals by nature of payment ({LATEST})"}, {"url": ARCHIVE_PAGE, "label": "CMS archived detail files"}],
            text=f"{s['state']} {s['name']}", filters={"kind": ["national" if s["state"] == "US" else "state"]}, state="" if s["state"] == "US" else s["state"],
            extra={"kind": "open_payments_state", "payments": s},
        ))
    cw.publish(
        "company_payments_states", "Open Payments: totals by recipient state", srows,
        listing_block=cw.listing([("state", "State"), ("general", f"General {LATEST}"), ("research", f"Research {LATEST}"), ("records", f"General records {LATEST}")], [("kind", "Kind", {"state": "State or territory", "national": "National"})]),
        summary={"generated_at": generated, "retrieved": TODAY, "source": "CMS Open Payments", "method": method},
    )
    if adverse:
        arows = []
        for a in adverse:
            arows.append(cw.record(
                "company_adverse_manufacturers", a["id"], a["name"],
                source_url=a["seriesUrl"] or (a["discoverUrls"][0] if a["discoverUrls"] else "https://open.fda.gov/apis/device/event/"),
                subtitle=(f"{a['total']:,} MAUDE reports received 2017-2025 · exact-name match, requires review" if a["matched"] else "No MAUDE manufacturer name matched exactly"),
                cells={"manufacturer": a["name"], "matched": "Exact-name match" if a["matched"] else "No match", "reports": f">= {a['total']:,}" if a["total"] is not None else "—", "coverage": f"{a['coverage'] * 100:.0f}%" if a["coverage"] is not None else "—", "names": str(len(a["matchedNames"]))},
                facts=[["Matching rule", method["maude"]], ["Matched MAUDE spellings", "; ".join(n["name"] for n in a["matchedNames"]) or "None"], ["Reports received 2017-2025 (lower bound)", f"{a['total']:,}" if a["total"] is not None else "Not applicable"], ["Name coverage 2017-2025", f"{a['coverage'] * 100:.1f}% of {a['denominator']:,} same-name reports" if a["coverage"] is not None else "Not applicable"], ["Ambiguous spellings excluded", "; ".join(x["name"] for x in a["ambiguous"]) or "None"], ["Retrieved", a["retrievedAt"] or "Not recorded"], ["Review status", "Requires review"]],
                links=[{"url": u, "label": "openFDA query"} for u in ([a["seriesUrl"]] if a["seriesUrl"] else []) + a["discoverUrls"]] + [{"url": "https://open.fda.gov/apis/device/event/", "label": "openFDA device adverse events"}],
                text=" ".join([a["name"], *[n["name"] for n in a["matchedNames"]]]), filters={"matched": ["yes" if a["matched"] else "no"], "kind": [a["kind"]]}, badges=["Requires review", "SEC registrant" if a["kind"] == "sec" else "Open Payments entity"],
                extra={"kind": "maude_manufacturer", "adverse": a},
            ))
        cw.publish(
            "company_adverse_manufacturers", "MAUDE reports by manufacturer (exact-name match)", arows,
            listing_block=cw.listing([("manufacturer", "Company"), ("matched", "Match"), ("reports", "Reports 2017-2025"), ("coverage", "Name coverage"), ("names", "Spellings")], [("matched", "Matched", {"yes": "Exact-name match", "no": "No match"}), ("kind", "Company source", {"open_payments": "Open Payments entity", "sec": "SEC registrant"})]),
            summary={"generated_at": generated, "maude_retrieved": adverse_generated, "source": "openFDA device/event (MAUDE)", "rule": method["maude"], "searched": len(adverse), "matched": sum(1 for a in adverse if a["matched"]), "ambiguous_spellings": json.load(open(os.path.join(ACQ, "maude_matches.json"))).get("ambiguous", {}), "scope": f"Top-{TOP} Open Payments entities with >= {int(DEVICE_SHARE_SEARCH * 100)}% of 2017-2025 general-payment dollars on device or medical supply records, plus company_sec_profiles registrants with SIC {'/'.join(SEC_SIC_PREFIXES)}x", "faers": "Not attributed: FAERS public data has no reliable manufacturer field."},
        )


SEC_SIC_PREFIXES = ("283", "384", "385")  # drugs; surgical/medical instruments; ophthalmic goods


def sec_targets():
    """SEC companies (dataset company_sec_profiles, other lane) whose SIC code is pharmaceutical or medical-device."""
    import corpus_writer as cw

    try:
        rows = cw.fetch_all("company_sec_profiles", select="id,title,item")
    except Exception as error:  # dataset absent or unreadable: the SEC scope is simply empty
        print("company_sec_profiles not read:", error)
        return []
    out = []
    for row in rows:
        company = ((row.get("item") or {}).get("summary") or {}).get("company") or {}
        sic = str(company.get("sic") or "")
        cik = str(company.get("cik") or row["id"])
        if not sic.startswith(SEC_SIC_PREFIXES) or not cik.isdigit():
            continue
        former = [f.get("name") if isinstance(f, dict) else f for f in company.get("former_names") or []]
        out.append({"cik": cik, "name": company.get("name") or row["title"], "former": [f for f in former if isinstance(f, str) and f.strip()], "sic": sic, "sicDescription": company.get("sic_description"), "usBased": company.get("business_foreign") is False})
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--publish"
    if reconcile.main():
        raise SystemExit("summary datasets do not reconcile with the CMS dashboard; not publishing")
    top, years, names = ranked(TOP)
    det = details()
    manufacturers, device_linked, mismatches = manufacturer_records(top, years, names, det)
    previous = os.path.join(ACQ, "device_linked.json")
    sec = sec_targets() if mode == "--prepare" or not os.path.exists(previous) else json.load(open(previous)).get("sec", [])
    json.dump({"entities": list(device_linked), "names": device_linked, "rule": f"device or medical supply share >= {DEVICE_SHARE_SEARCH}", "sec": sec, "sec_rule": f"company_sec_profiles with SIC starting {', '.join(SEC_SIC_PREFIXES)}"}, open(os.path.join(ACQ, "device_linked.json"), "w"), indent=1)
    print("manufacturers", len(manufacturers), "device-linked", len(device_linked), "sec targets", len(sec), "detail/summary mismatches", len(mismatches))
    for m in mismatches[:10]:
        print("  mismatch", m)
    if mode == "--prepare":
        return
    states = state_records(det)
    national = national_record(det)
    totals = {m["payments"]["entityId"]: m["payments"]["totals"]["general"] for m in manufacturers}
    adverse, adverse_generated = adverse_records(device_linked, totals)
    print("states", len(states), "adverse", len(adverse))
    publish(manufacturers, states, national, adverse, adverse_generated, mismatches)


if __name__ == "__main__":
    main()
