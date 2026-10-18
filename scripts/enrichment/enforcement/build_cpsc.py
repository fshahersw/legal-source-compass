"""Build CPSC recall datasets from the official SaferProducts.gov Recall REST API (per-year JSON windows).

Inputs (unchanged raw files): private/acq/enforcement/cpsc/recalls_<year>.json + manifest.json
Publishes:
  agency_safety_cpsc_recalls_api  one record per recall (full history from the API)
  regulatory_cpsc_aggregates      overview + per-year (hazard x manufacturer-country cube) + per-hazard + per-country + per-firm

Usage: python3 scripts/enrichment/enforcement/build_cpsc.py [--dry-run]
"""
import collections
import datetime as dt
import glob
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import corpus_writer as writer  # noqa: E402
from parsing import (  # noqa: E402
    HAZARD_LABELS,
    HAZARD_RULES,
    STANDARD_RULE,
    clean_text,
    hazard_categories,
    death_foreign_only,
    death_mention_class,
    mentions_injury,
    mentions_standard_violation,
    normalize_country,
    parse_units,
    recall_units,
    reports_none,
)

def record(*args, facts, **kwargs):
    """corpus_writer.record with facts given as {label, value} dicts; the entity view reads [label, value] pairs."""
    return writer.record(*args, facts=[[f["label"], "Not recorded" if f["value"] is None else str(f["value"])] for f in facts], **kwargs)


ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "enforcement", "cpsc")
API_DOC = "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information"
API_ONE = "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber={}"
API_YEAR = "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={y}-01-01&RecallDateEnd={y}-12-31"
TOP_COUNTRIES = 8
DEATH_RULE = ("Injury statement mentions death/died/fatal/killed after removing negated phrases. Product-related unless every death "
              "sentence carries a background marker (CPSC estimates, per year, since <year>, hazardous magnets, in the past, other or "
              "another firm's product, other recalled, similar, possibility, potential, can/could cause, risk of, an animal) or the "
              "statement opens with None reported / not aware of / has not received. Outside-U.S.-only when every product death "
              "sentence names a foreign place and no U.S. place. A text mention, not a verified death count.")
FIRM_MIN = 3


def names(entries, key="Name"):
    out = []
    for entry in entries or []:
        name = clean_text(entry.get(key))
        if name and name not in out:
            out.append(name)
    return out


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]


def load():
    manifest = json.load(open(os.path.join(ACQ, "manifest.json")))
    rows = []
    for path in sorted(glob.glob(os.path.join(ACQ, "recalls_*.json"))):
        rows.extend(json.load(open(path)))
    return manifest, rows


def shape(raw, standalone):
    hazards = names(raw.get("Hazards"))
    injuries = " ".join(names(raw.get("Injuries")))
    title = clean_text(raw.get("Title"))
    hazard_text = " ".join(hazards + [title])
    products = raw.get("Products") or []
    date = (raw.get("RecallDate") or "")[:10] or None
    return {
        "recall_id": raw.get("RecallID"),
        "recall_number": clean_text(raw.get("RecallNumber")),
        "date": date,
        "year": int(date[:4]) if date else None,
        "last_publish": (raw.get("LastPublishDate") or "")[:10] or None,
        "title": title,
        "url": clean_text(raw.get("URL")) or None,
        "description": clean_text(raw.get("Description"))[:1500] or None,
        "products": [
            {"name": clean_text(p.get("Name")) or None, "model": clean_text(p.get("Model"))[:200] or None, "type": clean_text(p.get("Type")) or None, "units_text": clean_text(p.get("NumberOfUnits")) or None, "units": parse_units(p.get("NumberOfUnits"))}
            for p in products[:12]
        ],
        "product_count": len(products),
        "units": recall_units(products),
        "hazards": [h[:1200] for h in hazards],
        "hazard_categories": hazard_categories(hazard_text),
        "standard_violation": mentions_standard_violation(hazard_text),
        "injuries": injuries[:1500] or None,
        "death_class": death_mention_class(injuries),
        "mentions_death": death_mention_class(injuries) == "product",
        "death_background": death_mention_class(injuries) == "background",
        "death_foreign_only": death_mention_class(injuries) == "product" and death_foreign_only(injuries),
        "mentions_injury": mentions_injury(injuries),
        "none_reported": reports_none(injuries),
        "remedies": [r[:800] for r in names(raw.get("Remedies"))][:4],
        "remedy_options": names(raw.get("RemedyOptions"), "Option"),
        "manufacturers": names(raw.get("Manufacturers")),
        "importers": names(raw.get("Importers")),
        "distributors": names(raw.get("Distributors")),
        "retailers": [r[:300] for r in names(raw.get("Retailers"))][:8],
        "countries_raw": names(raw.get("ManufacturerCountries"), "Country"),
        "countries": list(dict.fromkeys(c for v in names(raw.get("ManufacturerCountries"), "Country") for c in normalize_country(v, standalone))),
        "upc_count": len(raw.get("ProductUPCs") or []),
        "image": next((clean_text(i.get("URL")) for i in raw.get("Images") or [] if clean_text(i.get("URL"))), None),
        "consumer_contact": clean_text(raw.get("ConsumerContact"))[:400] or None,
    }


def counter_dict(counter, limit=None):
    return {k: v for k, v in counter.most_common(limit)}


def main(dry):
    manifest, raw_rows = load()
    retrieved = manifest["retrieved"][:10]
    values = [clean_text(c.get("Country")) for r in raw_rows for c in r.get("ManufacturerCountries") or []]
    standalone = {v for v in values if v and "(" not in v}
    recalls = sorted((shape(r, standalone) for r in raw_rows), key=lambda r: (r["date"] or "", r["recall_number"]))
    numbers = [r["recall_number"] for r in recalls]
    assert len(numbers) == len(set(numbers)), "duplicate recall numbers"
    as_of = max(r["date"] for r in recalls if r["date"])
    print("recalls", len(recalls), "as of", as_of, file=sys.stderr)

    rows = []
    for r in recalls:
        page = r["url"] or API_ONE.format(r["recall_number"])
        api = API_ONE.format(r["recall_number"])
        firms = r["manufacturers"] or r["importers"] or r["distributors"]
        rows.append(record(
            "agency_safety_cpsc_recalls_api", f"cpsc-api:{r['recall_number']}", r["title"] or f"CPSC recall {r['recall_number']}",
            source_url=page,
            subtitle=f"Recall {r['recall_number']} · {r['date'] or 'date not recorded'} · {', '.join(HAZARD_LABELS[k] for k in r['hazard_categories'][:2])}",
            cells={"recall_number": r["recall_number"], "date": r["date"], "hazard": ", ".join(HAZARD_LABELS[k] for k in r["hazard_categories"]), "firm": "; ".join(firms[:2]) or None, "country": ", ".join(r["countries"]) or None, "units": r["units"], "death_mention": "Product-related" + (" (outside U.S. only)" if r["death_foreign_only"] else "") if r["mentions_death"] else "Background / other product" if r["death_background"] else "No"},
            facts=[
                {"label": "Recall number", "value": r["recall_number"]},
                {"label": "Recall date", "value": r["date"] or "Not recorded"},
                {"label": "Hazard", "value": " ".join(r["hazards"])[:600] or "Not recorded"},
                {"label": "Hazard categories (keyword rule)", "value": ", ".join(HAZARD_LABELS[k] for k in r["hazard_categories"])},
                {"label": "Injuries (as stated)", "value": r["injuries"] or "Not recorded"},
                {"label": "Units (as stated)", "value": "; ".join(p["units_text"] for p in r["products"] if p["units_text"]) or "Not recorded"},
                {"label": "Manufacturers", "value": "; ".join(r["manufacturers"]) or "Not recorded"},
                {"label": "Importers", "value": "; ".join(r["importers"]) or "Not recorded"},
                {"label": "Distributors", "value": "; ".join(r["distributors"]) or "Not recorded"},
                {"label": "Manufactured in", "value": ", ".join(r["countries"]) or "Not recorded"},
                {"label": "Remedy", "value": ", ".join(r["remedy_options"]) or "Not recorded"},
                {"label": "Source", "value": f"CPSC Recall REST API, retrieved {retrieved}"},
            ],
            text=" ".join([r["recall_number"], r["title"], r["description"] or "", " ".join(r["hazards"]), " ".join(r["manufacturers"] + r["importers"] + r["distributors"]), " ".join(p["name"] or "" for p in r["products"]), " ".join(r["countries"])]),
            filters={"year": [str(r["year"]) if r["year"] else "none"], "hazard": r["hazard_categories"], "country": r["countries"] or ["none"], "death_mention": ["product" if r["mentions_death"] else "background" if r["death_background"] else "no"]},
            badges=[HAZARD_LABELS[k] for k in r["hazard_categories"][:3]] + (["Death mentioned" + (" (outside U.S.)" if r["death_foreign_only"] else "")] if r["mentions_death"] else ["Background death statistic"] if r["death_background"] else []),
            links=[{"label": "CPSC recall notice", "url": page}, {"label": "CPSC Recall API record", "url": api}],
            extra={"recall": r, "dates": {"date": r["date"]}},
        ))

    # ---------------------------------------------------------------- aggregates
    years = sorted({r["year"] for r in recalls if r["year"]})
    by_year = collections.defaultdict(list)
    for r in recalls:
        if r["year"]:
            by_year[r["year"]].append(r)
    country_total = collections.Counter(c for r in recalls for c in r["countries"])
    top_countries = [c for c, _ in country_total.most_common(TOP_COUNTRIES)]
    agg_rows = []
    year_items = []
    for year in years:
        items = by_year[year]
        hazards = collections.Counter(k for r in items for k in r["hazard_categories"])
        countries = collections.Counter(c for r in items for c in r["countries"])
        cube = collections.defaultdict(collections.Counter)
        for r in items:
            bucket = [c if c in top_countries else "Other countries" for c in r["countries"]] or ["Not recorded"]
            for k in r["hazard_categories"]:
                for c in set(bucket):
                    cube[k][c] += 1
        parsed_units = [r["units"] for r in items if r["units"] is not None]
        entry = {
            "year": year,
            "partial": year == int(as_of[:4]),
            "recalls": len(items),
            "with_country": sum(1 for r in items if r["countries"]),
            "hazards": counter_dict(hazards),
            "countries": counter_dict(countries),
            "hazard_country": {k: counter_dict(v) for k, v in cube.items()},
            "death_mentions": sum(r["mentions_death"] for r in items),
            "death_background": sum(r["death_background"] for r in items),
            "death_foreign_only": sum(r["death_foreign_only"] for r in items),
            "injury_mentions": sum(r["mentions_injury"] for r in items),
            "none_reported": sum(r["none_reported"] for r in items),
            "injury_text_missing": sum(1 for r in items if not r["injuries"]),
            "standard_violation": sum(r["standard_violation"] for r in items),
            "units_parsed_recalls": len(parsed_units),
            "units_sum": sum(parsed_units),
            "remedies": counter_dict(collections.Counter(o for r in items for o in r["remedy_options"])),
        }
        year_items.append(entry)
        agg_rows.append(("year", f"cpsc-agg:year:{year}", f"CPSC recalls in {year}", f"{len(items):,} recalls", entry, API_YEAR.format(y=year)))

    for key, label, pattern in HAZARD_RULES + [("other", HAZARD_LABELS["other"], "no pattern matched")]:
        items = [r for r in recalls if key in r["hazard_categories"]]
        series = collections.defaultdict(lambda: {"recalls": 0, "death_mentions": 0})
        for r in items:
            if r["year"]:
                series[r["year"]]["recalls"] += 1
                series[r["year"]]["death_mentions"] += r["mentions_death"]
        entry = {
            "key": key, "label": label, "rule": pattern, "recalls": len(items),
            "death_mentions": sum(r["mentions_death"] for r in items),
            "years": [{"year": y, **series[y]} for y in years if y in series],
            "countries": counter_dict(collections.Counter(c for r in items for c in r["countries"]), 10),
            "recent": [{"recall_number": r["recall_number"], "date": r["date"], "title": r["title"]} for r in items[-5:]][::-1],
        }
        agg_rows.append(("hazard", f"cpsc-agg:hazard:{key}", f"CPSC recalls — {label}", f"{len(items):,} recalls (keyword-classified)", entry, API_DOC))

    for country, total in country_total.most_common():
        items = [r for r in recalls if country in r["countries"]]
        series = collections.Counter(r["year"] for r in items if r["year"])
        entry = {
            "country": country, "recalls": total,
            "years": [{"year": y, "recalls": series[y]} for y in years if series[y]],
            "hazards": counter_dict(collections.Counter(k for r in items for k in r["hazard_categories"])),
            "death_mentions": sum(r["mentions_death"] for r in items),
        }
        agg_rows.append(("country", f"cpsc-agg:country:{slug(country)}", f"CPSC recalls — manufactured in {country}", f"{total:,} recalls", entry, API_DOC))

    as_of_date = dt.date.fromisoformat(as_of)
    cutoff = (as_of_date - dt.timedelta(days=730)).isoformat()
    firms = collections.defaultdict(lambda: {"roles": collections.Counter(), "recalls": []})
    for r in recalls:
        for role, key in (("manufacturer", "manufacturers"), ("importer", "importers"), ("distributor", "distributors")):
            for name in r[key]:
                firms[name]["roles"][role] += 1
                if not firms[name]["recalls"] or firms[name]["recalls"][-1]["recall_number"] != r["recall_number"]:
                    firms[name]["recalls"].append({"recall_number": r["recall_number"], "date": r["date"], "title": r["title"], "hazards": r["hazard_categories"], "death": r["mentions_death"]})
    firm_count = 0
    firm_summaries = []
    for name, value in sorted(firms.items(), key=lambda kv: (-len(kv[1]["recalls"]), kv[0])):
        items = value["recalls"]
        if len(items) < FIRM_MIN:
            continue
        firm_count += 1
        series = collections.Counter(int(x["date"][:4]) for x in items if x["date"])
        entry = {
            "name": name, "recalls": len(items), "roles": dict(value["roles"]),
            "first_date": min((x["date"] for x in items if x["date"]), default=None),
            "last_date": max((x["date"] for x in items if x["date"]), default=None),
            "recent_24m": sum(1 for x in items if x["date"] and x["date"] > cutoff),
            "death_mentions": sum(x["death"] for x in items),
            "years": [{"year": y, "recalls": series[y]} for y in sorted(series)],
            "hazards": counter_dict(collections.Counter(k for x in items for k in x["hazards"])),
            "latest": [{k: x[k] for k in ("recall_number", "date", "title")} for x in sorted(items, key=lambda x: x["date"] or "")[-6:]][::-1],
        }
        firm_summaries.append({k: entry[k] for k in ("name", "recalls", "recent_24m", "death_mentions", "first_date", "last_date", "roles")} | {"top_hazards": list(entry["hazards"])[:3], "id": f"cpsc-agg:firm:{slug(name)}-{firm_count}", "latest": entry["latest"][:3]})
        agg_rows.append(("firm", f"cpsc-agg:firm:{slug(name)}-{firm_count}", f"CPSC recalls — {name}", f"{len(items):,} recalls as manufacturer/importer/distributor", entry, API_DOC))

    overview = {
        "recalls": len(recalls), "as_of": as_of, "retrieved": retrieved, "first_date": recalls[0]["date"],
        "years": [{"year": y["year"], "recalls": y["recalls"], "partial": y["partial"]} for y in year_items],
        "hazard_labels": HAZARD_LABELS, "hazard_rules": {k: p for k, _, p in HAZARD_RULES}, "standard_rule": STANDARD_RULE,
        "top_countries": top_countries, "firm_min": FIRM_MIN, "firm_window_start": cutoff,
        "death_mentions": sum(r["mentions_death"] for r in recalls), "death_background": sum(r["death_background"] for r in recalls), "death_foreign_only": sum(r["death_foreign_only"] for r in recalls), "death_rule": DEATH_RULE, "injury_mentions": sum(r["mentions_injury"] for r in recalls),
        "with_country": sum(1 for r in recalls if r["countries"]), "units_parsed_recalls": sum(1 for r in recalls if r["units"] is not None),
        "api_doc": API_DOC, "api_year_template": API_YEAR,
        "country_rule": "Parenthetical qualifiers dropped; multi-country strings split only when every part is a standalone recorded country",
        "top_firms": firm_summaries[:30],
        "firm_clusters": sorted([f for f in firm_summaries if f["recent_24m"] >= FIRM_MIN], key=lambda f: (-f["recent_24m"], -f["recalls"], f["name"]))[:40],
    }
    agg_rows.insert(0, ("overview", "cpsc-agg:overview", "CPSC recalls — overview", f"{len(recalls):,} recalls through {as_of}", overview, API_DOC))
    print("aggregate records", len(agg_rows), "firms", firm_count, file=sys.stderr)

    built = []
    for kind, rid, title, subtitle, entry, url in agg_rows:
        built.append(record(
            "regulatory_cpsc_aggregates", rid, title, source_url=url, subtitle=subtitle,
            cells={"kind": kind, "name": title, "recalls": entry.get("recalls")},
            facts=[{"label": "Kind", "value": kind}, {"label": "Recalls", "value": f"{entry.get('recalls', 0):,}"}, {"label": "Source", "value": f"CPSC Recall REST API (per-year windows), retrieved {retrieved}"}, {"label": "Hazard classification", "value": "Deterministic keyword rules over hazard text and title; a recall can fall in several categories"}],
            text=title, filters={"kind": [kind]},
            links=[{"label": "CPSC Recall API documentation", "url": API_DOC}] + ([{"label": "API query for this year", "url": url}] if kind == "year" else []),
            extra={"agg": {"kind": kind, **entry}},
        ))
    if dry:
        with open(os.path.join(ROOT, "private", "scratch", "enforcement", "cpsc_dry.json"), "w") as out:
            json.dump({"overview": overview, "year2025": year_items[-2], "sample": rows[-1]}, out, indent=1)
        return
    common = {"source": API_DOC, "retrieved": retrieved, "as_of": as_of, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    hazard_opts = dict(HAZARD_LABELS)
    writer.publish(
        "agency_safety_cpsc_recalls_api", "CPSC recalls (official Recall API, full history)", rows,
        listing_block=writer.listing([("recall_number", "Recall"), ("date", "Date"), ("hazard", "Hazard (keyword rule)"), ("firm", "Firm"), ("country", "Manufactured in"), ("units", "Units"), ("death_mention", "Death mentioned")], [("hazard", "Hazard", hazard_opts), ("death_mention", "Death mentioned", {"product": "Product-related", "background": "Background / other product", "no": "No"})]),
        summary={**common, "grain": "one record per recall (RecallNumber)", "group": "cpsc", "windows": len(manifest["windows"]), "death_rule": DEATH_RULE},
    )
    writer.publish(
        "regulatory_cpsc_aggregates", "CPSC recall aggregates by year, hazard, manufacturer country and firm", built,
        listing_block=writer.listing([("kind", "Kind"), ("name", "Name"), ("recalls", "Recalls")], [("kind", "Kind", {"overview": "Overview", "year": "Year", "hazard": "Hazard", "country": "Country", "firm": "Firm"})]),
        summary={**common, "grain": "overview + year + hazard + country + firm records", "firm_rule": f"Exact recorded manufacturer/importer/distributor names with >= {FIRM_MIN} recalls"},
    )


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
