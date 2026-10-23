"""Build fsis_recalls from FSIS's public recall listing pages (2014-2026) and check it against FSIS's annual summaries.

Inputs: private/acq/enforcement_extra/fsis/listing/*.html.gz (unfiltered pages 0-65 and the year facets 2014-2018,
read through Firecrawl; see fsis_crawl.py) and fsis/summaries/summary_<year>.html.gz (official annual totals).

  python3 -I -B build_fsis.py
"""
from __future__ import annotations

import collections
import glob
import gzip
import json
import re
import os
import sys

from common import ACQ, BUILD, compact, manifest_entries, write_build
from fsis import parse_listing, usps_codes
from fsis_summaries import parsed as official_totals

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import corpus_writer as writer  # noqa: E402

DATASET = "fsis_recalls"
LISTING_URL = "https://www.fsis.usda.gov/recalls"
STATE_NAMES = {v: k for k, v in {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY",
    "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
    "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Puerto Rico": "PR", "Guam": "GU", "American Samoa": "AS", "U.S. Virgin Islands": "VI",
    "Northern Mariana Islands": "MP"}.items()}


def class_of(risk: str | None) -> str | None:
    if not risk:
        return None
    r = risk.lower()
    if "public health alert" in r:
        return "PHA"
    for c in ("III", "II", "I"):
        if r.endswith(f"class {c.lower()}"):
            return c
    return None


def number_year_of(number: str) -> str | None:
    """The year printed in a recall number ('026-2026', '019-020-2026', '005-2026-EXP'); None for PHA numbers."""
    if number.upper().startswith("PHA"):
        return None
    years = re.findall(r"(?<!\d)(20\d\d)(?!\d)", number)
    return years[-1] if years else None


def load_items() -> tuple[list[dict], dict]:
    items, by_url, pages = [], {}, 0
    for p in sorted(glob.glob(os.path.join(ACQ, "fsis", "listing", "*.html.gz"))):
        pages += 1
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for it in parse_listing(f.read()):
                if it["url"] in by_url:
                    continue
                by_url[it["url"]] = it
                items.append(it)
    return items, {"pages": pages}


def build() -> str:
    items, info = load_items()
    official = official_totals()
    rows = []
    year_counts = collections.defaultdict(lambda: collections.Counter())
    numbered = collections.defaultdict(lambda: collections.Counter())
    year_pounds = collections.Counter()
    for it in items:
        slug = it["url"].rstrip("/").rsplit("/", 1)[-1]
        cls = class_of(it["risk"])
        year = it["start"][:4] if it["start"] else None
        expansion = "EXP" in it["number"].upper()  # "027-2016 EXP", "059-2015 expansion": an expansion of an earlier recall
        number_year = number_year_of(it["number"])
        if year:
            year_counts[year][cls or "unclassified"] += 1
            if it["kind"] == "Recall" and it["pounds"] is not None:
                year_pounds[year] += it["pounds"]
        if number_year and cls in ("I", "II", "III") and not expansion:
            numbered[number_year][cls] += 1
        codes = usps_codes(it["states"])
        est = "; ".join(e["name"] for e in it["establishments"]) or None
        products = it["products"][:8]
        links = [{"url": f"/places/{c}", "label": f"{STATE_NAMES[c]} place profile"} for c in codes[:12]]
        links += [{"url": e["url"], "label": f"FSIS establishment page: {e['name']}"} for e in it["establishments"] if e.get("url")][:3]
        cells = compact({
            "number": it["number"], "kind": it["kind"], "class": cls, "expansion": expansion or None, "risk": it["risk"], "reason": "; ".join(it["reasons"]) or None,
            "date": it["start"], "closed": it["end"], "status": it["status"], "states": it["states_raw"], "pounds": it["pounds"],
            "establishment": est,
        })
        detail = {
            "recall_number": it["number"] or None,
            "type": it["kind"],
            "class": it["risk"],
            "reason_category": "; ".join(it["reasons"]) or None,
            "recall_date": it["start"],
            "closed_date": it["end"] if it["end"] else ("Open (FSIS shows 'Current')" if it["current"] else None),
            "status": it["status"],
            "distribution": it["states_raw"],
            "establishment": est,
            **compact({
                "pounds_recalled": None if it["pounds"] is None else f"{it['pounds']:,.0f} (FSIS release: “{it['pounds_evidence']}”)",
                "quantity_recovered": it["recovered"],
                "impacted_products": products or None,
                "summary_excerpt": it["summary"],
            }),
            "source": "FSIS Recalls & Public Health Alerts listing (fsis.usda.gov/recalls)",
        }
        filters = {"kind": [it["kind"]]}
        if cls:
            filters["class"] = [cls]
        if year:
            filters["year"] = [year]
        if it["reasons"]:
            filters["reason"] = it["reasons"][:3]
        if codes:
            filters["state"] = codes
        if it["states_raw"] == "Nationwide":
            filters["nationwide"] = ["yes"]
        row = writer.record(
            DATASET, f"fsis:{slug}", it["title"], source_url=it["url"], cells=cells, facts=[],
            text=" ".join(p for p in (it["number"], est, "; ".join(it["reasons"]), it["states_raw"], " ".join(products)) if p),
            filters=filters, subtitle=" · ".join(p for p in (it["number"], it["risk"], it["start"]) if p), links=links,
            state=codes[0] if len(codes) == 1 else "",
        )
        row["detail"] = {"id": row["id"], "title": row["title"], "subtitle": row["item"]["subtitle"], **detail, "links": links}
        rows.append(row)
    rows.sort(key=lambda r: (r["item"]["cells"].get("date") or "", r["id"]), reverse=True)
    comparison = []
    for y in sorted(official):
        o = official[y]
        ys = str(y)
        domestic = sum(numbered[ys].values())
        comparison.append({
            "year": y, "official_recalls": o["recalls"],
            "listing_recalls_by_number_year_excluding_expansions": domestic,
            "difference": None if o["recalls"] is None else domestic - o["recalls"],
            "listing_recalls_by_recall_date_all": sum(n for k, n in year_counts[ys].items() if k in ("I", "II", "III")),
            "official_phas": o["phas"], "listing_phas_by_date": year_counts[ys].get("PHA", 0),
            "official_by_class": {k: v["recalls"] for k, v in o["by_class"].items()},
            "listing_by_class": {k: numbered[ys].get(k, 0) for k in ("I", "II", "III")},
            "official_pounds": o["pounds"], "listing_pounds_found_in_excerpts": round(year_pounds[ys]),
        })
    entries = [e for e in manifest_entries() if e.get("path", "").startswith("acq/enforcement_extra/fsis/listing/")]
    summary = {
        "source": {
            "publisher": "U.S. Department of Agriculture, Food Safety and Inspection Service",
            "listing": LISTING_URL,
            "annual_summaries": "https://www.fsis.usda.gov/food-safety/recalls-public-health-alerts/annual-recall-summaries",
            "retrieval": "FSIS's recall API (https://www.fsis.usda.gov/fsis/api/recall/v/1) and its file downloads answer this "
                         "environment with an Akamai 403 (Access Denied), which was not bypassed. The public listing pages were read "
                         "through the Firecrawl scrape service at no more than one request per second; unfiltered pages 0-65 cover "
                         "2018-2026, and pages beyond 65 returned FSIS's 'Site Maintenance' page (HTTP 503), so 2014-2018 were read "
                         "through the listing's own year facet.",
            "pages": info["pages"],
            "first_retrieved": min((e["retrieved_at"] for e in entries), default=None),
            "last_retrieved": max((e["retrieved_at"] for e in entries), default=None),
            "terms": "U.S. government work published by USDA FSIS.",
        },
        "records": len(rows),
        "by_year": {y: dict(c) for y, c in sorted(year_counts.items())},
        "official_comparison": comparison,
        "definitions": {
            "class": "FSIS risk label on the listing card (High - Class I, Low - Class II, Marginal - Class III, Public Health Alert).",
            "recall_date": "First date in the card's date range; closed_date is the second date, or open when FSIS shows 'Current'.",
            "pounds_recalled": "Only when the card's own release excerpt says 'recalling approximately N pounds' (the quoted phrase is kept); otherwise not recorded.",
            "distribution": "The card's state list as published (or 'Nationwide'); /places links only for exact state names.",
        },
        "notes": [
            "Listing cards only: the full release pages were not fetched, so pounds are missing where the card excerpt is cut before the quantity.",
            "Recall numbers are shown exactly as published (some carry suffixes such as -EXP or lower-case 'pha').",
            "Numbers marked EXP or 'expansion' are expansions of an earlier recall (flag 'expansion'); FSIS's annual summaries do not "
            "count them separately. Counted by the year in the recall number and without expansions, the listing matches FSIS's "
            "published annual recall totals exactly in 10 of 12 years (2014-2025); 2015 has one more and 2020 one fewer (see official_comparison).",
        ],
    }
    listing_block = writer.listing(
        [("number", "Number"), ("date", "Date"), ("class", "Class"), ("reason", "Reason"), ("establishment", "Establishment"), ("pounds", "Pounds")],
        [("kind", "Type", {"Recall": "Recall", "Public health alert": "Public health alert"}),
         ("class", "Class", {"I": "Class I", "II": "Class II", "III": "Class III", "PHA": "Public health alert"}),
         ("year", "Year", {str(y): str(y) for y in range(2026, 2013, -1)})],
    )
    inputs = [{"url": e["url"], "path": e["path"], "sha256": e["sha256"]} for e in entries]
    out = write_build(DATASET, "FSIS meat, poultry and egg product recalls and public health alerts (2014-2026)", rows, listing_block, summary, inputs)
    print(json.dumps({"dataset": DATASET, "records": len(rows), "file": out}))
    for c in comparison:
        print(json.dumps(c))
    return out


if __name__ == "__main__":
    build()
