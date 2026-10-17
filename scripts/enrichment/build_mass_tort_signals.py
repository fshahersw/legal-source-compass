"""Join products-liability MDLs to product-safety signals (openFDA adverse events and recalls, NHTSA complaints).

Inputs: scripts/enrichment/mass_tort_products.json, private/acq/openfda/<mdl>.json (fetch_openfda_signals.py),
private/acq/nhtsa/vehicle_mdl_signals.json (build_nhtsa.py), corpus dataset mdl_analytics.
Output dataset: agency_safety_mass_tort_signals, keyed by MDL number.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import corpus_writer as cw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OPENFDA = ROOT / "private" / "acq" / "openfda"
NHTSA = ROOT / "private" / "acq" / "nhtsa" / "vehicle_mdl_signals.json"
SOURCES = {
    "drug": ("FDA Adverse Event Reporting System (FAERS) via openFDA", "https://open.fda.gov/apis/drug/event/"),
    "device": ("FDA MAUDE device adverse event reports via openFDA", "https://open.fda.gov/apis/device/event/"),
    "food": ("FDA CFSAN Adverse Event Reporting System (CAERS) via openFDA", "https://open.fda.gov/apis/food/event/"),
    "cosmetic": ("FDA CFSAN Adverse Event Reporting System (CAERS) via openFDA", "https://open.fda.gov/apis/food/event/"),
    "vehicle": ("NHTSA ODI vehicle owner complaints, received 2020–2026", "https://www.nhtsa.gov/nhtsa-datasets-and-apis"),
}
CAVEAT = ("Reports are voluntary submissions that mention the product; they do not establish that the product "
          "caused an event, and counts change as reports are added, deduplicated or revised.")


def fmt(n):
    return "Not recorded" if n is None else f"{n:,}"


def main():
    mapping = json.loads((Path(__file__).parent / "mass_tort_products.json").read_text())["mdls"]
    vehicles = json.loads(NHTSA.read_text()) if NHTSA.exists() else {}
    mdls = {r["id"]: r["item"] for r in cw.fetch_all("mdl_analytics", "id,item") if (r["item"] or {}).get("kind") == "mdl"}
    rows, missing = [], []
    for entry in mapping:
        mdl = str(entry["mdl"])
        litigation = mdls.get(mdl)
        if not litigation:
            missing.append(mdl)
            continue
        a = litigation["analytics"]
        kind = entry["kind"]
        source_label, source_url = SOURCES[kind]
        if kind == "vehicle":
            v = vehicles.get(mdl, {})
            signal = {"event_total": v.get("total"), "events_by_year": v.get("years", {}),
                      "event_breakdown": {"Crash": v.get("crash", 0), "Fire": v.get("fire", 0), "Persons injured": v.get("injured", 0), "Deaths": v.get("deaths", 0)},
                      "top_terms": [], "recall_total": None, "recent_recalls": [], "recall_breakdown": {}, "match_rule": entry.get("nhtsa")}
        else:
            path = OPENFDA / f"{mdl}.json"
            if not path.exists():
                missing.append(mdl)
                continue
            signal = json.loads(path.read_text())
        years = signal.get("events_by_year") or {}
        recent = {y: n for y, n in years.items() if y >= "2015"}
        peak = max(recent.items(), key=lambda kv: kv[1]) if recent else (None, None)
        last_two = [years.get(str(y)) for y in (2024, 2025)]
        facts = [
            ["MDL", f"{mdl} — {litigation['title']}"],
            ["Product", entry["product"]],
            ["Litigation pending", f"{a['pending']:,} actions ({a['as_of']})"],
            ["12-month change in pending", "Not recorded" if a.get("change_12m") is None else f"{a['change_12m']:+,}"],
            ["Signal source", source_label],
            ["Reports mentioning the product", fmt(signal.get("event_total"))],
            ["Peak reporting year since 2015", f"{peak[0]} ({peak[1]:,})" if peak[0] else "Not recorded"],
            ["Reports received 2024 / 2025", " / ".join(fmt(x) for x in last_two)],
            ["Outcome breakdown", "; ".join(f"{k}: {v:,}" for k, v in (signal.get("event_breakdown") or {}).items()) or "Not recorded"],
            ["Most-reported terms", "; ".join(f"{t['term']} ({t['count']:,})" for t in (signal.get("top_terms") or [])[:8]) or "Not recorded"],
            ["Recalls matching the product", fmt(signal.get("recall_total")) if kind != "vehicle" else "See NHTSA recalls dataset"],
            ["Caveat", CAVEAT],
        ]
        badges = [b for b in [entry["kind"].title(), f"{a['pending']:,} pending", f"{signal.get('recall_total')} recalls" if signal.get("recall_total") else None] if b]
        rows.append(cw.record(
            "agency_safety_mass_tort_signals", mdl, f"{entry['product']} — MDL {mdl}", source_url=source_url,
            subtitle=f"{source_label} · {fmt(signal.get('event_total'))} reports · {a['pending']:,} pending actions",
            cells={"mdl": mdl, "product": entry["product"], "kind": kind, "pending": f"{a['pending']:,}",
                   "reports": fmt(signal.get("event_total")), "recalls": fmt(signal.get("recall_total")) if kind != "vehicle" else "—",
                   "reports_2025": fmt(years.get("2025"))},
            facts=facts, badges=badges,
            links=[{"url": f"/records/mdl_analytics/{mdl}", "label": "MDL analytics"}, {"url": source_url, "label": source_label}]
            + ([{"url": signal["queries"]["events"], "label": "openFDA query (events)"}] if signal.get("queries", {}).get("events") else []),
            text=f"{entry['product']} {litigation['title']} {' '.join(t['term'] for t in (signal.get('top_terms') or []))}",
            filters={"kind": [kind], "has_recalls": ["yes" if signal.get("recall_total") else "no"], "mdl": [mdl]},
            extra={"kind": "signal", "signal": {**{k: v for k, v in signal.items() if k not in ("queries",)}, "queries": signal.get("queries", {}),
                                                 "product": entry["product"], "product_kind": kind, "source": source_label, "source_url": source_url, "caveat": CAVEAT},
                   "litigation": {"mdl": int(mdl), "title": litigation["title"], "pending": a["pending"], "total": a["total"], "change_12m": a.get("change_12m"),
                                  "series": a.get("series", []), "judge": a.get("judge"), "district": a.get("district"), "date_transferred": a.get("date_transferred")}},
        ))
    print(json.dumps({"signals": len(rows), "missing": missing}))
    cw.publish(
        "agency_safety_mass_tort_signals", "Mass-tort product signals (FDA adverse events, recalls, NHTSA complaints)", rows,
        listing_block=cw.listing(
            [("mdl", "MDL"), ("product", "Product"), ("kind", "Kind"), ("pending", "Pending actions"), ("reports", "Reports"), ("reports_2025", "Reports 2025"), ("recalls", "Recalls")],
            [("kind", "Product kind", {"drug": "Drug", "device": "Device", "food": "Food", "cosmetic": "Cosmetic", "vehicle": "Vehicle"}),
             ("has_recalls", "Recalls", {"yes": "Has recalls", "no": "No recalls matched"})],
        ),
        summary={"sources": [v[1] for v in SOURCES.values()], "caveat": CAVEAT},
    )


if __name__ == "__main__":
    main()
