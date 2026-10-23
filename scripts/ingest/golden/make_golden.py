"""Golden outputs of the ORIGINAL Python builders for the ingest fixtures (src/lib/ingest/fixtures/).

The TypeScript ports in src/lib/ingest/sources/ must produce exactly these rows and values; the vitest suites compare
them. Nothing here touches the network or the corpus.

  python3 -I -B scripts/ingest/golden/make_golden.py [--ftc-data DIR] [--rules-from RAW.json ...]

  cpsc-rows.json    rows build_cpsc.main() publishes for fixtures/cpsc-recalls.json (retrieved 2026-10-23)
  cpsc-rules.json   parsing.py rule outputs (death/injury/none/hazard/standard/units/country) for recorded texts
  hsr-rows.json     rows build_hsr.build_notices() writes for fixtures/ftc-hsr-pages.json (needs scripts/enrichment/ftc_data,
                    or --ftc-data pointing at a copy of it)
"""
import argparse
import importlib
import json
import os
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FIX = os.path.join(ROOT, "src", "lib", "ingest", "fixtures")
GOLD = os.path.join(FIX, "golden")
RETRIEVED = "2026-10-23T14:00:00Z"


def dump(name, value):
    os.makedirs(GOLD, exist_ok=True)
    with open(os.path.join(GOLD, name), "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        handle.write("\n")


def cpsc(rules_from):
    sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "enforcement"))
    sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
    build = importlib.import_module("build_cpsc")
    parsing = importlib.import_module("parsing")
    raws = json.load(open(os.path.join(FIX, "cpsc-recalls.json"), encoding="utf-8"))
    with tempfile.TemporaryDirectory() as acq:
        json.dump(raws, open(os.path.join(acq, "recalls_fixture.json"), "w"))
        json.dump({"retrieved": RETRIEVED, "windows": [{"file": "recalls_fixture.json"}]}, open(os.path.join(acq, "manifest.json"), "w"))
        captured = {}
        build.ACQ = acq
        build.writer.publish = lambda dataset, label, rows, **kw: captured.setdefault(dataset, rows)
        build.main(False)
    rows = captured["agency_safety_cpsc_recalls_api"]
    values = [parsing.clean_text(c.get("Country")) for r in raws for c in r.get("ManufacturerCountries") or []]
    dump("cpsc-rows.json", {"retrieved": RETRIEVED[:10], "standalone": sorted({v for v in values if v and "(" not in v}), "rows": rows})

    # rule-level cases: the fixture's texts, texts kept from earlier runs, and texts from extra raw API files
    path = os.path.join(GOLD, "cpsc-rules.json")
    cases = json.load(open(path, encoding="utf-8"))["cases"] if os.path.exists(path) else []
    texts = {c["text"] for c in cases}
    countries = set(json.load(open(path, encoding="utf-8")).get("countries", {}).keys()) if os.path.exists(path) else set()
    units = set(json.load(open(path, encoding="utf-8")).get("units", {}).keys()) if os.path.exists(path) else set()

    def add_from(records):
        for r in records:
            inj = " ".join(build.names(r.get("Injuries")))
            haz = " ".join(build.names(r.get("Hazards")) + [parsing.clean_text(r.get("Title"))])
            for t in (inj, haz):
                if t and t not in texts and len(texts) < 350:
                    texts.add(t)
            for c in r.get("ManufacturerCountries") or []:
                countries.add(c.get("Country") or "")
            for p in r.get("Products") or []:
                units.add(p.get("NumberOfUnits") or "")

    add_from(raws)
    for f in rules_from:
        add_from(json.load(open(f, encoding="utf-8")))
    synthetic = [
        "None reported.", "No injuries or deaths have been reported.", "The firm is not aware of any injuries or deaths.",
        "Two deaths were reported in Canada. CPSC estimates 10 deaths per year.", "A child died in the United States.",
        "One death was reported outside the U.S. in Mexico.", "A death in New Mexico was reported.",
        "No reports of injury or death. A similar product caused a fatality.", "café burns reported; fire hazard",
        "The firm has received 3 reports of the units overheating, including 1 report of minor burns.",
        "Deaths reported in Ontario and Quebec.", "Fatalities: the dog died.",
    ]
    for t in synthetic:
        texts.add(t)
    std = sorted({v for v in (parsing.clean_text(c) for c in countries) if v and "(" not in v})
    standalone = set(std)
    out_cases = []
    for t in sorted(texts):
        out_cases.append({
            "text": t,
            "death_class": parsing.death_mention_class(t),
            "foreign_only": parsing.death_foreign_only(t),
            "mentions_death": parsing.mentions_death(t),
            "mentions_injury": parsing.mentions_injury(t),
            "reports_none": parsing.reports_none(t),
            "hazard_categories": parsing.hazard_categories(t),
            "standard_violation": parsing.mentions_standard_violation(t),
        })
    for u in ["About 14,250", "1.2 million", "Approximately 500 units", "2.5 thousand", "1.5", "one", "Ten units.",
              "About 1,000 (in addition, 200 in Canada)", "More than 100", "3.5 million units", "0.5 thousand", "2.5 million"]:
        units.add(u)
    for c in ["China (batteries)", "China and Vietnam", "Bosnia and Herzegovina", "China, Vietnam", "Trinidad and Tobago",
              "Mexico; United States", "United States (assembled), Canada", " ,China. "]:
        countries.add(c)
    dump("cpsc-rules.json", {
        "cases": out_cases,
        "standalone": std,
        "countries": {c: parsing.normalize_country(c, standalone) for c in sorted(countries)},
        "units": {u: parsing.parse_units(u) for u in sorted(units)},
    })
    print(json.dumps({"cpsc_rows": len(rows), "rule_cases": len(out_cases), "countries": len(countries), "units": len(units)}))


def hsr(ftc_dir):
    if not ftc_dir or not os.path.isdir(ftc_dir):
        print(json.dumps({"hsr": "skipped (scripts/enrichment/ftc_data not available; pass --ftc-data)"}))
        return
    sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
    sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "ftc_sentinel"))
    sibling = os.path.join(os.path.dirname(os.path.abspath(ftc_dir)), "ftc_sentinel")
    if os.path.isdir(sibling):
        sys.path.insert(0, sibling)  # the ftc_sentinel helpers that ship with this copy of ftc_data
    sys.path.insert(0, ftc_dir)
    build = importlib.import_module("build_hsr")
    pages = json.load(open(os.path.join(FIX, "ftc-hsr-pages.json"), encoding="utf-8"))
    rows, summary, _inputs, meta = build.build_notices(pages=[(f"page{i}", p) for i, p in enumerate(pages)], entries={})
    dump("hsr-rows.json", {"rows": rows, "summary_notices": summary["notices"], "calendar": {str(k): v for k, v in meta["calendar"].items()}})
    print(json.dumps({"hsr_rows": len(rows)}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ftc-data", default=os.path.join(ROOT, "scripts", "enrichment", "ftc_data"))
    ap.add_argument("--rules-from", nargs="*", default=[])
    ap.add_argument("--only", choices=["cpsc", "hsr"], default=None)
    a = ap.parse_args()
    if a.only in (None, "cpsc"):
        cpsc(a.rules_from)
    if a.only in (None, "hsr"):
        hsr(a.ftc_data)
