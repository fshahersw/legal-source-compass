"""Spot-check built figures by re-running independent openFDA queries (live, read-only).

Each check takes a figure shown in a built row and asks openFDA for the same quantity by a different route than the
builder used: the builder sums count= aggregates by day; the check runs a date-range search and reads meta.results.total
(limit=1; the returned case record is discarded, never stored). Writes private/build/fda_adverse_events/spot_checks.json.
Usage: python3 -I -B scripts/enrichment/fda_adverse_events/spot_check_fda_adverse_events.py
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fae_common as fc  # noqa: E402

ROOT = HERE.parents[2]
BUILD = ROOT / "private" / "build" / "fda_adverse_events"
PRODUCTS = BUILD / "lookups" / "mass_tort_products.json"


def load(ds):
    return {r["id"]: r for r in json.loads((BUILD / f"{ds}.json").read_text())["rows"]}


def total(url):
    req = urllib.request.Request(url, headers={"User-Agent": fc.USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.load(resp)["meta"]["results"]["total"]
        except urllib.error.HTTPError as err:
            body = json.loads(err.read() or b"{}")
            if err.code == 404 and (body.get("error") or {}).get("message") == "No matches found!":
                return 0
            if err.code >= 500 and attempt < 2:
                time.sleep(5)
                continue
            return f"HTTP {err.code}"
        finally:
            time.sleep(0.6)


def rng(field, y):
    return f"{field}:[{y}0101+TO+{y}1231]"


def main():
    products = {e["mdl"]: e for e in json.loads(PRODUCTS.read_text())["mdls"]}
    P, N, D, C = (load(d) for d in ("fda_faers_product_series", "fda_faers_national_series", "fda_device_event_series", "fda_caers_series"))
    ex = lambda m: fc.enc_expr(products[m].get("faers") or products[m].get("maude") or products[m].get("caers"))  # noqa: E731
    pt = lambda rows, rid, y, f: next(p[f] for p in rows[rid]["item"]["series"] if p["year"] == y)  # noqa: E731
    checks = []

    def add(desc, shown, where, endpoint, search):
        checks.append({"figure": desc, "shown": shown, "raw_source": where,
                       "check_url": fc.build_url(endpoint, search, None, 1)})

    for m, y in ((2924, 2020), (3094, 2025), (3092, 2023), (2973, 2021), (3180, 2024), (1871, 2010)):
        add(f"FAERS MDL {m} reports received {y}", pt(P, str(m), y, "reports"), f"openfda/faers_{m}_year_all.json (count=receivedate, days of {y} summed)",
            "drug/event.json", f"{ex(m)}+AND+{rng('receivedate', y)}")
    add("FAERS MDL 3006 death-outcome reports 2022", pt(P, "3006", 2022, "deaths"), "openfda/faers_3006_year_death.json",
        "drug/event.json", f"{ex(3006)}+AND+seriousnessdeath:1+AND+{rng('receivedate', 2022)}")
    add("FAERS MDL 2740 serious reports 2017", pt(P, "2740", 2017, "serious"), "openfda/faers_2740_year_serious.json",
        "drug/event.json", f"{ex(2740)}+AND+serious:1+AND+{rng('receivedate', 2017)}")
    add("FAERS MDL 3050 lawyer-reported reports 2021", pt(P, "3050", 2021, "lawyer"), "openfda/faers_3050_year_lawyer.json",
        "drug/event.json", f"{ex(3050)}+AND+primarysource.qualification:4+AND+{rng('receivedate', 2021)}")
    term = next(t for t in P["2973"]["item"]["top_reactions_all"] if len(t["variants"]) == 1)
    add(f"FAERS MDL 2973 reaction '{term['term']}' (all years)", term["count"], "openfda/faers_2973_pt_all.json",
        "drug/event.json", f"{ex(2973)}+AND+patient.reaction.reactionmeddrapt.exact:{fc.phrase(term['term'])}")
    add("FAERS MDL 3006 female patients (all years)", next(s["count"] for s in P["3006"]["item"]["sex"] if s["code"] == 2),
        "openfda/faers_3006_sex.json", "drug/event.json", f"{ex(3006)}+AND+patient.patientsex:2")
    add("FAERS MDL 2924 consumer-reported (all years)", next(s["count"] for s in P["2924"]["item"]["reporters"] if s["code"] == 5),
        "openfda/faers_2924_qual.json", "drug/event.json", f"{ex(2924)}+AND+primarysource.qualification:5")
    bucket = next(x for x in P["2924"]["item"]["age_years"] if x["label"] == "65–85 years")
    add("FAERS MDL 2924 onset age 65–85 years (unit: years)", bucket["count"], "openfda/faers_2924_age_years_ge65.json (terms 65 to 85.999 summed)",
        "drug/event.json", f"{ex(2924)}+AND+patient.patientonsetageunit:801+AND+patient.patientonsetage:[65+TO+85.999]")
    prob = next(t for t in D["3014"]["item"]["top_problems_all"] if len(t["variants"]) == 1)
    add(f"MAUDE MDL 3014 device problem '{prob['term']}' (all years)", prob["count"], "openfda/maude_3014_problems_all.json",
        "device/event.json", f"{ex(3014)}+AND+product_problems.exact:{fc.phrase(prob['term'])}")
    alt = fc.ALT_FAERS[3079]
    add("FAERS MDL 3079 reports received 2024 (alternate search on the reported drug name)", pt(P, "3079", 2024, "reports"),
        "openfda/faers_3079alt_year_all.json", "drug/event.json", f"{fc.enc_expr(alt['faers'])}+AND+{rng('receivedate', 2024)}")
    add("FAERS MDL 3079 reports, all years, recorded search (alternate used because this is 0)", P["3079"]["item"]["recorded_search_reports"],
        "openfda/faers_3079_year_all.json (404 'No matches found!')", "drug/event.json", ex(3079))
    for y in (2015, 2025):
        add(f"FAERS national reports {y}", N[str(y)]["item"]["point"]["reports"], "openfda/faers_nat_year_all.json", "drug/event.json", rng("receivedate", y))
    add("FAERS national death-outcome reports 2024", N["2024"]["item"]["point"]["deaths"], "openfda/faers_nat_year_death.json",
        "drug/event.json", f"seriousnessdeath:1+AND+{rng('receivedate', 2024)}")
    for m, y in ((3014, 2021), (2921, 2019), (3181, 2023), (2846, 2018)):
        add(f"MAUDE MDL {m} reports received {y}", pt(D, str(m), y, "reports"), f"openfda/maude_{m}_year_all.json",
            "device/event.json", f"{ex(m)}+AND+{rng('date_received', y)}")
    add("MAUDE MDL 2570 injury reports 2016", pt(D, "2570", 2016, "injury"), "openfda/maude_2570_year_injury.json",
        "device/event.json", f"{ex(2570)}+AND+event_type:Injury+AND+{rng('date_received', 2016)}")
    add("MAUDE national reports 2024", pt(D, "national", 2024, "reports"), "openfda/maude_nat_year_all.json", "device/event.json", rng("date_received", 2024))
    add("CAERS national reports 2019", C["year-2019"]["item"]["point"]["reports"], "openfda/caers_nat_year_all.json", "food/event.json", rng("date_created", 2019))
    add("CAERS MDL 3037 reports 2022", pt(C, "mdl-3037", 2022, "reports"), "openfda/caers_3037_year_all.json",
        "food/event.json", f"{ex(3037)}+AND+{rng('date_created', 2022)}")
    add("CAERS industry Cosmetics reports (all years)", C["industry-cosmetics"]["item"]["reports"], "openfda/caers_nat_industry.json",
        "food/event.json", "products.industry_name.exact:" + fc.phrase("Cosmetics"))
    add("CAERS MDL 3060 hair relaxer reports (all years)", C["mdl-3060"]["item"]["total"], "openfda/caers_3060_year_all.json",
        "food/event.json", ex(3060))
    for c in checks:
        c["live"] = total(c["check_url"])
        c["match"] = c["live"] == c["shown"]
        c["checked_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        print(("MATCH " if c["match"] else "DIFF  ") + f"{c['figure']}: shown {c['shown']} live {c['live']}", flush=True)
    out = {"checks": checks, "count": len(checks), "mismatches": sum(not c["match"] for c in checks)}
    (BUILD / "spot_checks.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"count": out["count"], "mismatches": out["mismatches"]}))


if __name__ == "__main__":
    main()
