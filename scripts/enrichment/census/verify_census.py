"""Independent verification of the Census build files.

  python3 -I -B scripts/enrichment/census/verify_census.py [--sample 30] [--seed 20261023]

1. Re-request random stored values (measure, geography, year) from the Census Data API with a single-geography,
   single-measure request and recompute the figure with its own small implementation of the arithmetic (it does not use
   census_spec.compute_measure); the stored value and margin of error must match exactly after rounding.
2. Additivity: for every additive count cell, county values sum to the state value and states sum to the nation, per
   vintage, where every addend is published; Population Estimates counties sum to states and states to the nation.
3. County Business Patterns: county totals against state totals, state totals against the nation (the Bureau's noise
   infusion makes these approximately, not exactly, additive, so differences are reported, not failed).

Writes private/build/census/VERIFY.json and prints the counts. The exit code is non-zero if any value mismatches.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import acquire_census as A  # noqa: E402
import census_http as C  # noqa: E402
import census_load as L  # noqa: E402
import census_spec as S  # noqa: E402

BUILD = os.path.join(C.ROOT, "private", "build", "census")


def load_build(name: str) -> dict:
    with open(os.path.join(BUILD, name + ".json"), encoding="utf-8") as handle:
        return json.load(handle)


# ------------------------------------------------------------------------------------------ independent arithmetic
def num(x):
    return None if x in (None, "") else float(x)


def live_figure(survey: str, year: int, geoid: str, key: str):
    """(value, moe, note) for one measure from a fresh single-geography request, with separately written formulas."""
    m = S.MEASURE_BY_KEY[key]
    cells = list(dict.fromkeys(m.cells))
    level = "us" if geoid == "US" else ("state" if len(geoid) == 2 else "county")
    geo = {"us": {"for": "us:1"}, "state": {"for": f"state:{geoid}"}, "county": {"for": f"county:{geoid[2:]}", "in": f"state:{geoid[:2]}"}}[level]
    url = C.build_url(f"{year}/acs/{survey}", {"get": "NAME," + ",".join(v for c in cells for v in (c + "E", c + "M")), **geo})
    data = C.load(url)
    header, row = data[0], data[1]  # type: ignore[index]
    est, moe = {}, {}
    for c in cells:
        est[c] = num(row[header.index(c + "E")])
        moe[c] = num(row[header.index(c + "M")])
    if any(v is None or v <= -200000000 for v in est.values()):
        return None, None, None
    for c in cells:  # a controlled estimate carries MOE -555555555 and counts as zero in sums
        if moe[c] == -555555555:
            moe[c] = 0.0
    if m.kind == "value":
        c = m.plus[0]
        raw = num(row[header.index(c + "M")])
        if raw == -555555555:
            return est[c], None, "c"
        if raw is None or raw <= -200000000:
            return est[c], None, "m"
        return est[c], raw, None
    sign = {c: 1 for c in m.plus}
    for c in m.minus:
        sign[c] = -1
    # the "plus" list of the language measure repeats the total that is also its denominator
    numerator = sum(sign[c] * est[c] for c in sign if c in m.plus or c in m.minus)
    parts = [moe[c] for c in list(m.plus) + list(m.minus)]
    den = est[m.den]  # type: ignore[index]
    p = numerator / den
    raw_moes = [num(row[header.index(c + "M")]) for c in list(m.plus) + list(m.minus) + [m.den]]
    if all(r == -555555555 for r in raw_moes):
        return p * 100, None, "c"
    if any(r is None or (r <= -200000000 and r != -555555555) for r in raw_moes):
        return p * 100, None, "m"
    sq = sum(x * x for x in parts)
    rad = sq - (p * moe[m.den]) ** 2  # type: ignore[index]
    if rad < 0:
        rad = sq + (p * moe[m.den]) ** 2  # type: ignore[index]
    return p * 100, math.sqrt(rad) / den * 100, None


def stored_precision(key: str):
    return {"int": 0, "dollars": 0, "dec1": 1, "pct": 3}[S.MEASURE_BY_KEY[key].fmt]


def same(a, b, places):
    if a is None or b is None:
        return a is None and b is None
    return round(a, places) == round(b, places)


def sample_checks(n: int, seed: int) -> dict:
    rng = random.Random(seed)
    plan = {
        "census_acs_states": ("acs5", max(1, round(n * 0.4))),
        "census_acs1_states": ("acs1", max(1, round(n * 0.1))),
        "census_acs_counties": ("acs5", n - max(1, round(n * 0.4)) - max(1, round(n * 0.1))),
    }
    results, mismatches = [], []
    for dataset, (survey, count) in plan.items():
        rows = load_build(dataset)["rows"]
        picks = 0
        attempts = 0
        while picks < count and attempts < 2000:
            attempts += 1
            row = rng.choice(rows)
            c = row["item"]["census"]
            key = rng.choice(sorted(c["series"]))
            year = rng.choice(sorted(c["series"][key]))
            stored = c["series"][key][year]
            if stored[0] is None:
                continue
            places = stored_precision(key)
            try:
                v, moe, note = live_figure(survey, int(year), c["geoid"], key)
            except Exception as error:  # noqa: BLE001 - recorded, counted as a failed check
                results.append({"dataset": dataset, "geoid": c["geoid"], "year": year, "measure": key, "error": str(error)[:160]})
                mismatches.append(results[-1])
                picks += 1
                continue
            stored_note = stored[2] if len(stored) > 2 and isinstance(stored[2], str) else None
            ok = same(v, stored[0], places) and same(moe, stored[1], places) and note == stored_note
            entry = {
                "dataset": dataset,
                "geoid": c["geoid"],
                "name": c["name"],
                "year": int(year),
                "measure": key,
                "stored": stored,
                "live": [None if v is None else round(v, places), None if moe is None else round(moe, places), note],
                "match": ok,
            }
            results.append(entry)
            if not ok:
                mismatches.append(entry)
            picks += 1
    return {"checked": len(results), "mismatches": mismatches, "results": results}


# ------------------------------------------------------------------------------------------------ additivity
def additivity() -> dict:
    out: dict = {}
    for survey in ("acs5", "acs1"):
        years, levels = A.SURVEYS[survey]
        counted = [c for c in S.ALL_CELLS if c not in ("B01002_001", "B19013_001", "B19301_001", "B25077_001")]
        stats = {"checked": 0, "exact": 0, "differ": 0, "examples": []}
        states_vs_us = {"checked": 0, "exact": 0, "differ": 0, "examples": []}
        for year in years:
            cells_by_level = {}
            for level in levels:
                parts = [L.read_acs_response(C.load(u), level) for u in A.data_urls(survey, year, level)]  # type: ignore[arg-type]
                cells_by_level[level] = L.merge_batches(parts)[1]
            states = cells_by_level["state"]
            us = cells_by_level["us"]["US"]
            for cell in counted:
                if cell not in us:
                    continue
                total = 0.0
                ok = True
                for fips, row in states.items():
                    if fips == "72":
                        continue
                    est = row.get(cell)
                    if est is None or est.estimate is None:
                        ok = False
                        break
                    total += est.estimate
                if ok and us[cell].estimate is not None:
                    states_vs_us["checked"] += 1
                    if total == us[cell].estimate:
                        states_vs_us["exact"] += 1
                    else:
                        states_vs_us["differ"] += 1
                        if len(states_vs_us["examples"]) < 6:
                            states_vs_us["examples"].append({"year": year, "cell": cell, "states_sum": total, "us": us[cell].estimate})
            if "county" in cells_by_level:
                sums: dict[str, dict[str, float]] = {}
                complete: dict[str, dict[str, bool]] = {}
                for geoid, row in cells_by_level["county"].items():
                    for cell in counted:
                        est = row.get(cell)
                        ok = est is not None and est.estimate is not None
                        sums.setdefault(geoid[:2], {}).setdefault(cell, 0.0)
                        complete.setdefault(geoid[:2], {}).setdefault(cell, True)
                        if ok:
                            sums[geoid[:2]][cell] += est.estimate  # type: ignore[union-attr]
                        else:
                            complete[geoid[:2]][cell] = False
                for fips, row in states.items():
                    for cell in counted:
                        est = row.get(cell)
                        if est is None or est.estimate is None or not complete.get(fips, {}).get(cell):
                            continue
                        stats["checked"] += 1
                        if sums[fips][cell] == est.estimate:
                            stats["exact"] += 1
                        else:
                            stats["differ"] += 1
                            if len(stats["examples"]) < 8:
                                stats["examples"].append({"year": year, "state": fips, "cell": cell, "county_sum": sums[fips][cell], "state": est.estimate})
        out[survey] = {"counties_vs_state": stats, "states_vs_nation": states_vs_us}
    return out


def pep_additivity() -> dict:
    base = os.path.join(C.ACQ, "pep")
    out = {}
    for vintage, states_file, county_file, years in (
        ("v2025", "NST-EST2025-ALLDATA.csv", "co-est2025-alldata.csv", [str(y) for y in range(2020, 2026)]),
        ("v2019", "nst-est2019-alldata.csv", "co-est2019-alldata.csv", [str(y) for y in range(2010, 2020)]),
    ):
        states = L.read_pep_file(os.path.join(base, states_file), "state")
        counties = L.read_pep_file(os.path.join(base, county_file), "county")
        stats = {"county_vs_state": [0, 0], "state_vs_nation": [0, 0], "examples": []}
        for year in years:
            sums: dict[str, int] = {}
            for geoid, row in counties.items():
                if year in row["pop"]:
                    sums[geoid[:2]] = sums.get(geoid[:2], 0) + row["pop"][year]
            for fips, total in sums.items():
                if fips in states and year in states[fips]["pop"]:
                    stats["county_vs_state"][0] += 1
                    if total == states[fips]["pop"][year]:
                        stats["county_vs_state"][1] += 1
                    elif len(stats["examples"]) < 6:
                        stats["examples"].append({"vintage": vintage, "year": year, "state": fips, "county_sum": total, "state": states[fips]["pop"][year]})
            nation = states["US"]["pop"].get(year)
            parts = [r["pop"].get(year) for g, r in states.items() if g not in ("US", "72")]
            if nation is not None and all(p is not None for p in parts):
                stats["state_vs_nation"][0] += 1
                stats["state_vs_nation"][1] += int(sum(parts) == nation)  # type: ignore[arg-type]
        out[vintage] = stats
    return out


def cbp_additivity() -> dict:
    import statistics  # noqa: PLC0415

    import acquire_cbp as B  # noqa: PLC0415

    out = {}
    year = B.LATEST
    counties = L.read_cbp_response(C.load(B.cbp_url(year, "county")), "county", "NAICS2017")  # type: ignore[arg-type]
    states = L.read_cbp_response(C.load(B.cbp_url(year, "state")), "state", "NAICS2017")  # type: ignore[arg-type]
    us = L.read_cbp_response(C.load(B.cbp_url(year, "us")), "us", "NAICS2017")  # type: ignore[arg-type]
    for field in ("estab", "emp", "pay"):
        csum: dict[str, int] = {}
        for geoid, sectors in counties.items():
            v = sectors.get("00", {}).get(field)
            if v is not None and geoid[:2] in L.STATE_USPS:
                csum[geoid[:2]] = csum.get(geoid[:2], 0) + v
        diffs = {}
        for fips, sectors in states.items():
            total = sectors.get("00", {}).get(field)
            if total and fips in csum and fips in L.STATE_USPS:
                diffs[fips] = (csum[fips] - total) / total
        nation = us["US"]["00"][field]
        ssum = sum(s["00"][field] for g, s in states.items() if g in L.STATE_USPS and g != "72" and s.get("00", {}).get(field) is not None)
        worst = max(diffs, key=lambda k: abs(diffs[k]))
        out[field] = {
            "states_compared": len(diffs),
            "county_sum_vs_state_median_abs_relative_difference": statistics.median(abs(d) for d in diffs.values()),
            "county_sum_vs_state_max_abs_relative_difference": abs(diffs[worst]),
            "county_sum_vs_state_max_at_state_fips": worst,
            "states_sum_vs_nation_relative_difference": (ssum - nation) / nation,
        }
    return out


def main(argv: list[str]) -> int:
    n = int(argv[argv.index("--sample") + 1]) if "--sample" in argv else 30
    seed = int(argv[argv.index("--seed") + 1]) if "--seed" in argv else 20261023
    report = {"seed": seed, "sample": sample_checks(n, seed)}
    report["additivity_acs"] = additivity()
    report["additivity_pep"] = pep_additivity()
    report["additivity_cbp"] = cbp_additivity()
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "VERIFY.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, sort_keys=True)
    sample = report["sample"]
    print(f"live re-requests: {sample['checked']} checked, {len(sample['mismatches'])} mismatches")
    for survey, parts in report["additivity_acs"].items():
        for name, s in parts.items():
            print(f"ACS {survey} {name}: {s['checked']} checked, {s['exact']} exact, {s['differ']} differ")
    for vintage, s in report["additivity_pep"].items():
        print(f"PEP {vintage}: county sums vs state {s['county_vs_state']}, state sums vs nation {s['state_vs_nation']}")
    print("CBP:", json.dumps(report["additivity_cbp"]))
    return 1 if sample["mismatches"] else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
