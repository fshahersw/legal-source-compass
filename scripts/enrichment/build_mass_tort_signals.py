"""Join products-liability MDLs to product-safety signals (openFDA adverse events and recalls, NHTSA complaints).

Inputs: scripts/enrichment/mass_tort_products.json, private/acq/openfda/<mdl>.json (fetch_openfda_signals.py),
private/acq/nhtsa/vehicle_mdl_signals.json (build_nhtsa.py), corpus dataset mdl_analytics.
Output dataset: agency_safety_mass_tort_signals, keyed by MDL number.

MDLs the JPML centralized after the last pending report (scripts/safety_v2/mdl_map.py JPML_ORDERS: 3194, 3195, 3199)
have no mdl_analytics row yet: their litigation block comes only from that explicit JPML evidence (the transfer order's
URL and date, the hearing-session record id) and their pending/total counts are absent ("Not recorded"), never 0.
An MDL whose product no FDA/NHTSA source reports on (mdl_map.NOT_MAPPED, e.g. 3199 Apple AirTag) gets a row of kind
"consumer" with no report counts and the reason.

  python -B scripts/enrichment/build_mass_tort_signals.py                       (lead: reads mdl_analytics, publishes)
  python -B scripts/enrichment/build_mass_tort_signals.py --dry-run --mdl-analytics <json> [--only 3194,3195] \
      [--openfda <dir>] --out <rows.json>                                        (no credentials, never writes the corpus)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "safety_v2"))
import corpus_writer as cw  # noqa: E402
import mdl_map  # noqa: E402

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


def merge_case_variants(terms):
    """openFDA counts spellings that differ only in letter case separately ("Diarrhoea" / "DIARRHOEA"): sum them per
    lower-cased term, label with the most reported spelling (ties: first seen), keep every spelling in `variants`,
    and re-sort by count (ties: first seen). Already-merged input keeps its stored `variants` without splitting the
    count, so the merge is idempotent. Same rule and folding (str.lower / String.toLowerCase) as mergeTermCase in
    src/lib/external/massTortSignals.functions.ts."""
    groups = {}
    for t in terms or []:
        term = (t.get("term") or "").strip() if isinstance(t, dict) and isinstance(t.get("term"), str) else ""
        count = t.get("count") if isinstance(t, dict) else None
        if not term or not isinstance(count, (int, float)) or isinstance(count, bool) or count < 0:
            continue
        key = term.lower()
        g = groups.setdefault(key, {"order": len(groups), "total": 0, "spellings": {}})
        stored = t.get("variants") if isinstance(t.get("variants"), list) else []
        for v in stored:
            spelling = v.strip() if isinstance(v, str) else ""
            if spelling and spelling.lower() == key:
                g["spellings"].setdefault(spelling, 0)  # a stored variant's own count is already inside `count`
        g["total"] += count
        g["spellings"][term] = g["spellings"].get(term, 0) + count
    out = []
    for g in sorted(groups.values(), key=lambda g: (-g["total"], g["order"])):
        best = max(g["spellings"].items(), key=lambda kv: kv[1])[0]  # max keeps the first of equal counts
        out.append({"term": best, "count": g["total"], "variants": list(g["spellings"])})
    return out


SOURCES_CONSUMER = ("No FDA or NHTSA source reports on this product", "https://www.jpml.uscourts.gov/")


def jpml_litigation(mdl, entry):
    """The litigation block for an MDL that has no mdl_analytics row yet, from explicit JPML evidence only
    (mdl_map.JPML_ORDERS, or the mapping entry's jpml_evidence). Counts the JPML has not published are None."""
    ev = mdl_map.JPML_ORDERS.get(int(mdl)) or {}
    own = (entry or {}).get("jpml_evidence") or {}
    if not ev and not own:
        return None
    return {"title": ev.get("title") or (entry or {}).get("product"), "analytics": {
        "pending": None, "total": None, "change_12m": None, "series": [], "judge": None,
        "district": ev.get("transferee_district"), "date_transferred": ev.get("order_date") or own.get("order_date"),
        "as_of": "not yet in a JPML pending report"},
        "jpml_evidence": {"dataset": ev.get("dataset") or own.get("dataset"), "record_id": ev.get("record_id") or own.get("record_id"),
                          "order_url": ev.get("order_url") or own.get("order_url"), "order_date": ev.get("order_date") or own.get("order_date"),
                          "outcome": own.get("outcome") or "Centralized (transfer order)"}}


def build_rows(mapping, mdls, vehicles, openfda_dir, only=None):
    rows, missing = [], []
    entries = list(mapping)
    mapped = {int(e["mdl"]) for e in entries}
    for mdl in sorted(mdl_map.JPML_ORDERS):
        if mdl not in mapped and mdl in mdl_map.NOT_MAPPED:
            entries.append({"mdl": mdl, "product": mdl_map.NOT_MAPPED[mdl].split(":")[0],
                            "kind": "consumer", "note": mdl_map.NOT_MAPPED[mdl]})
    for entry in entries:
        mdl = str(entry["mdl"])
        if only and int(mdl) not in only:
            continue
        litigation = mdls.get(mdl)
        jpml = None
        if not litigation:
            litigation = jpml = jpml_litigation(mdl, entry)
        if not litigation:
            missing.append(mdl)
            continue
        a = litigation["analytics"]
        kind = entry["kind"]
        source_label, source_url = SOURCES_CONSUMER if kind == "consumer" else SOURCES[kind]
        if kind == "vehicle":
            v = vehicles.get(mdl, {})
            signal = {"event_total": v.get("total"), "events_by_year": v.get("years", {}),
                      "event_breakdown": {"Crash": v.get("crash", 0), "Fire": v.get("fire", 0), "Persons injured": v.get("injured", 0), "Deaths": v.get("deaths", 0)},
                      "top_terms": [], "recall_total": None, "recent_recalls": [], "recall_breakdown": {}, "match_rule": entry.get("nhtsa")}
        elif kind == "consumer":
            signal = {"event_total": None, "events_by_year": {}, "event_breakdown": {}, "top_terms": [], "recall_total": None,
                      "recent_recalls": [], "recall_breakdown": {}, "not_mapped": entry.get("note")}
        else:
            path = Path(openfda_dir) / f"{mdl}.json"
            if not path.exists():
                missing.append(mdl)
                continue
            signal = json.loads(path.read_text())
            signal["top_terms"] = merge_case_variants(signal.get("top_terms"))
        years = signal.get("events_by_year") or {}
        recent = {y: n for y, n in years.items() if y >= "2015"}
        peak = max(recent.items(), key=lambda kv: kv[1]) if recent else (None, None)
        last_two = [years.get(str(y)) for y in (2024, 2025)]
        pending_text = (f"{a['pending']:,} actions ({a['as_of']})" if a.get("pending") is not None
                        else f"Not recorded (centralized {a.get('date_transferred')}; not yet in a JPML pending report)")
        facts = [
            ["MDL", f"{mdl} — {litigation['title']}"],
            ["Product", entry["product"]],
            ["Litigation pending", pending_text],
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
        if jpml:
            ev = jpml["jpml_evidence"]
            facts.insert(1, ["JPML evidence", f"{ev['outcome']} {ev['order_date']} ({ev['dataset']} {ev['record_id']})"])
        if entry.get("note"):
            facts.insert(2, ["Note", entry["note"]])
        pending_cell = "Not recorded" if a.get("pending") is None else f"{a['pending']:,}"
        badges = [b for b in [kind.title(), f"{pending_cell} pending" if a.get("pending") is not None else "Newly centralized",
                              f"{signal.get('recall_total')} recalls" if signal.get("recall_total") else None] if b]
        links = [{"url": f"/records/mdl_analytics/{mdl}", "label": "MDL analytics"}] if not jpml else \
            [{"url": jpml["jpml_evidence"]["order_url"], "label": "JPML transfer order"}]
        links += [{"url": source_url, "label": source_label}]
        links += [{"url": signal["queries"]["events"], "label": "openFDA query (events)"}] if (signal.get("queries") or {}).get("events") else []
        rows.append(cw.record(
            "agency_safety_mass_tort_signals", mdl, f"{entry['product']} — MDL {mdl}", source_url=source_url if not jpml else jpml["jpml_evidence"]["order_url"],
            subtitle=f"{source_label} · {fmt(signal.get('event_total'))} reports · {pending_cell} pending actions",
            cells={"mdl": mdl, "product": entry["product"], "kind": kind, "pending": pending_cell,
                   "reports": fmt(signal.get("event_total")), "recalls": fmt(signal.get("recall_total")) if kind != "vehicle" else "—",
                   "reports_2025": fmt(years.get("2025"))},
            facts=facts, badges=badges, links=links,
            text=f"{entry['product']} {litigation['title']} {' '.join(t['term'] for t in (signal.get('top_terms') or []))}",
            filters={"kind": [kind], "has_recalls": ["yes" if signal.get("recall_total") else "no"], "mdl": [mdl]},
            extra={"kind": "signal", "signal": {**{k: v for k, v in signal.items() if k not in ("queries",)}, "queries": signal.get("queries", {}),
                                                 "product": entry["product"], "product_kind": kind, "source": source_label, "source_url": source_url, "caveat": CAVEAT},
                   "litigation": {"mdl": int(mdl), "title": litigation["title"], "pending": a.get("pending"), "total": a.get("total"), "change_12m": a.get("change_12m"),
                                  "series": a.get("series", []), "judge": a.get("judge"), "district": a.get("district"), "date_transferred": a.get("date_transferred"),
                                  **({"jpml_evidence": jpml["jpml_evidence"]} if jpml else {})}},
        ))
    return rows, missing


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build agency_safety_mass_tort_signals")
    ap.add_argument("--dry-run", action="store_true", help="write rows to --out; never publish")
    ap.add_argument("--mdl-analytics", help="JSON list of mdl_analytics rows {id, item} (read-only snapshot) instead of a live read")
    ap.add_argument("--openfda", default=str(OPENFDA))
    ap.add_argument("--only", help="comma-separated MDL numbers (dry run only: a publish replaces the whole dataset)")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    only = {int(x) for x in args.only.split(",")} if args.only else None
    if only and not args.dry_run:
        raise SystemExit("--only needs --dry-run: publishing replaces the whole dataset")
    mapping = json.loads((Path(__file__).parent / "mass_tort_products.json").read_text())["mdls"]
    vehicles = json.loads(NHTSA.read_text()) if NHTSA.exists() else {}
    source = json.loads(Path(args.mdl_analytics).read_text()) if args.mdl_analytics else cw.fetch_all("mdl_analytics", "id,item")
    mdls = {r["id"]: r["item"] for r in source if (r["item"] or {}).get("kind") == "mdl"}
    rows, missing = build_rows(mapping, mdls, vehicles, args.openfda, only)
    print(json.dumps({"signals": len(rows), "missing": missing}))
    if args.dry_run:
        if args.out:
            Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        return rows
    cw.publish(
        "agency_safety_mass_tort_signals", "Mass-tort product signals (FDA adverse events, recalls, NHTSA complaints)", rows,
        listing_block=cw.listing(
            [("mdl", "MDL"), ("product", "Product"), ("kind", "Kind"), ("pending", "Pending actions"), ("reports", "Reports"), ("reports_2025", "Reports 2025"), ("recalls", "Recalls")],
            [("kind", "Product kind", {"drug": "Drug", "device": "Device", "food": "Food", "cosmetic": "Cosmetic", "vehicle": "Vehicle",
                                       "consumer": "Consumer product (no FDA/NHTSA reports)"}),
             ("has_recalls", "Recalls", {"yes": "Has recalls", "no": "No recalls matched"})],
        ),
        summary={"sources": [v[1] for v in SOURCES.values()], "caveat": CAVEAT},
    )
    return rows


if __name__ == "__main__":
    main()
