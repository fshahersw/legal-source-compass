"""USSC individual offender datafiles FY2002-FY2025 -> ussc_sentencing_districts (aggregates only).

  python3 -I -B build_ussc.py years [FY ...]   download each year's zip (about 21-27 MB), aggregate it, upload the
                                               unchanged zip to the private bucket corpus-originals
                                               (enforcement_extra/ussc/<date>/<file>, sha256 readback) and delete
                                               the local copy; writes private/build/enforcement_extra/ussc_years/FY<y>.json
  python3 -I -B build_ussc.py assemble         build private/build/enforcement_extra/ussc_sentencing_districts.json

No person-level row is stored anywhere: only district x offense x sentence-type aggregates.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

from common import ACQ, BUILD, PRIVATE, download, latest_manifest, manifest_append, require_space, utc_now, with_source, write_build
from ussc import aggregate, available_variables, iter_csv, iter_fixed, summarize_unit
from ussc_codes import CODEBOOK_URL, DATAFILES_PAGE, DISTRICTS, OFFENSE_TABLES, RANGE_SCHEMES, SENTIMP, datafile_url, range_candidates, year_spec

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "caselaw"))
import corpus_writer as writer  # noqa: E402

YEARS = list(range(2002, 2026))
YEAR_DIR = os.path.join(BUILD, "ussc_years")
RECEIPTS = os.path.join(ACQ, "ussc", "_storage_receipts.jsonl")
DATASET = "ussc_sentencing_districts"


def upload(path: str, sha: str, nbytes: int) -> dict:
    import store  # scripts/enrichment/caselaw/store.py (credentials from the environment / env.sh, never printed)

    store.CONTENT_TYPE = "application/zip"
    key = f"enforcement_extra/ussc/{dt.date.today().isoformat()}/{os.path.basename(path)}"
    receipt = store.Storage().put_verified(key, path, sha, nbytes)
    with open(RECEIPTS, "a", encoding="utf-8") as f:
        f.write(json.dumps(receipt, sort_keys=True) + "\n")
    return receipt


def process_year(fy: int, keep_local: bool = False) -> dict:
    os.makedirs(YEAR_DIR, exist_ok=True)
    out_path = os.path.join(YEAR_DIR, f"FY{fy}.json")
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            return json.load(f)
    url = datafile_url(fy)
    name = url.rsplit("/", 1)[-1]
    local = os.path.join(ACQ, "ussc", name)
    entry = latest_manifest(f"acq/enforcement_extra/ussc/{name}")
    if not os.path.exists(local):
        require_space(60 * 1024**2)
        entry = download(url, local, method="direct GET", min_interval=2.0)
    elif not entry:
        from common import sha256_file

        sha, n = sha256_file(local)
        entry = {"url": url, "path": os.path.relpath(local, PRIVATE), "sha256": sha, "bytes": n, "stored_as": "unchanged",
                 "retrieved_at": utc_now(), "http_status": 200, "method": "direct GET (fetched earlier for inspection)"}
        manifest_append(entry)
    wanted = set(year_spec(fy).values()) | set(range_candidates(fy))
    spec = year_spec(fy, available_variables(local, sorted(wanted)))
    names = sorted(set(spec.values()))
    reader = iter_csv(local, names) if name.endswith("_csv.zip") else iter_fixed(local, names)
    found = set()

    def tracked():
        for rec in reader:
            if not found:
                found.update(k for k, v in rec.items())
            yield rec

    agg = aggregate(tracked(), spec)
    result = {
        "fy": fy, "url": url, "file": name, "sha256": entry["sha256"], "bytes": entry["bytes"], "retrieved_at": entry["retrieved_at"],
        "spec": spec, "variables_found": sorted(found), "variables_missing": sorted(set(names) - found),
        "records": agg["records"], "unknown_district": agg["unknown_district"],
        "national": summarize_unit(agg["national"], spec["offense"]),
        "districts": {str(code): summarize_unit(unit, spec["offense"]) for code, unit in sorted(agg["districts"].items())},
    }
    if not keep_local:
        receipt = upload(local, entry["sha256"], entry["bytes"])
        result["storage"] = {"bucket": receipt["bucket"], "key": receipt["key"], "state": receipt["state"], "readback_ok": receipt["readback_ok"]}
        os.remove(local)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, separators=(",", ":"))
    os.replace(tmp, out_path)
    print(json.dumps({"fy": fy, "records": result["records"], "districts": len(result["districts"]), "unknown_district": result["unknown_district"],
                      "missing": result["variables_missing"], "storage": result.get("storage", {}).get("state")}), flush=True)
    return result


# ------------------------------------------------------------------------------------------------ assemble
def _measure_cells(t: dict) -> dict:
    return {
        "cases": t["cases"], "prison_median": t["prison_median"], "prison_mean": t["prison_mean"],
        "sentence_median": t["sentence_median"], "sentence_mean": t["sentence_mean"],
        "within_pct": t["within_pct"], "above_pct": t["above_pct"], "below_pct": t["below_pct"], "mm_pct": t["mm_pct"],
    }


def assemble() -> str:
    years = {}
    for fy in YEARS:
        p = os.path.join(YEAR_DIR, f"FY{fy}.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                years[fy] = json.load(f)
    if not years:
        raise SystemExit("no aggregated years; run build_ussc.py years")
    rows, inputs = [], []
    national_series = []
    for fy, y in sorted(years.items()):
        inputs.append({"url": y["url"], "path": (y.get("storage") or {}).get("key") or f"acq/enforcement_extra/ussc/{y['file']}", "sha256": y["sha256"]})
        spec = y["spec"]
        period = f"FY{fy} (October 1, {fy - 1} - September 30, {fy})"
        units = [("national", None, y["national"])] + [(DISTRICTS[int(c)][1], int(c), u) for c, u in y["districts"].items()]
        for court_id, code, unit in units:
            t = unit["total"]
            if code is None:
                title = f"All federal districts: sentencing, FY{fy}"
                state, links, name = "", [], "All districts"
            else:
                label, _, usps, name = DISTRICTS[code]
                title = f"{name}: sentencing, FY{fy}"
                state = usps
                links = [{"url": f"/courts/{court_id}", "label": f"{name} court profile"}, {"url": f"/places/{usps}", "label": f"{usps} place profile"}]
            if code is None:
                national_series.append({"fy": fy, **_measure_cells(t)})
            rid = f"ussc:{fy}:{court_id}"
            profile = {
                "fy": fy, "court_id": None if code is None else court_id, "district_code": code,
                "district_label": None if code is None else DISTRICTS[code][0], "name": name,
                "offense_variable": spec["offense"], "range_variable": spec["range"], "prison_variable": spec["prison"],
                "total": t, "offenses": unit["offenses"], "offense_by_sentence_type": unit["offense_by_sentence_type"],
            }
            facts = [
                ["Fiscal year", period],
                ["Individuals sentenced (records in the USSC datafile)", f"{t['cases']:,}"],
                ["Sentenced to prison (length recorded)", f"{t['prison_n']:,}"],
                ["Median length of imprisonment", "Not recorded" if t["prison_median"] is None else f"{t['prison_median']} months"],
                ["Mean length of imprisonment", "Not recorded" if t["prison_mean"] is None else f"{t['prison_mean']} months"],
                ["Median sentence length (all cases; probation = 0)", "Not recorded" if t["sentence_median"] is None else f"{t['sentence_median']} months"],
                ["Mean sentence length (all cases; probation = 0)", "Not recorded" if t["sentence_mean"] is None else f"{t['sentence_mean']} months"],
                ["Within guideline range", "Not recorded" if t["within_pct"] is None else f"{t['within_pct']}% of {t['range_valid']:,} cases with a range code"],
                ["Above range", "Not recorded" if t["above_pct"] is None else f"{t['above_pct']}%"],
                ["Below range", "Not recorded" if t["below_pct"] is None else f"{t['below_pct']}%"],
                ["Convicted under a statute with a mandatory minimum (STATMIN > 0)", "Not recorded" if t["mm_pct"] is None else f"{t['mm_pct']}% of {t['mm_valid']:,}"],
                ["Offense-type variable", f"{spec['offense']} (USSC codebook)"],
                ["Guideline-range variable", f"{spec['range']} (USSC codebook)"],
                ["Imprisonment variable", f"{spec['prison']} (months; capped at 470, life = 470)"],
                ["Source", f"U.S. Sentencing Commission individual offender datafile {y['file']}"],
            ]
            top = [o for o in unit["offenses"] if o["code"] is not None][:3]
            subtitle = f"{t['cases']:,} individuals sentenced" + (" · top offenses: " + ", ".join(o["label"].split(" (")[0] for o in top) if top else "")
            cells = {
                "fy": fy, "district": name, "cases": t["cases"], "prison_median": t["prison_median"], "prison_mean": t["prison_mean"],
                "sentence_median": t["sentence_median"], "sentence_mean": t["sentence_mean"],
                "within_pct": t["within_pct"], "below_pct": t["below_pct"], "above_pct": t["above_pct"], "mm_pct": t["mm_pct"],
            }
            filters = {"fy": [str(fy)], "scope": ["national" if code is None else "district"]}
            if code is not None:
                filters["court"] = [court_id]
                filters["state"] = [state]
            rows.append(writer.record(
                DATASET, rid, title, source_url=y["url"], cells=cells, facts=facts,
                text=f"{name} federal sentencing FY{fy} {' '.join(o['label'] for o in top)}", filters=filters,
                subtitle=subtitle, links=links, state=state, extra={"profile": profile},
            ))
    rows = [with_source(r) for r in rows]
    rows.sort(key=lambda r: (r["item"]["profile"]["fy"], r["id"]))
    summary = {
        "source": {
            "publisher": "United States Sentencing Commission",
            "datafiles_page": DATAFILES_PAGE, "codebook": CODEBOOK_URL,
            "terms": "Federal government work (17 U.S.C. 105); the Commission makes these datasets, without individual identifiers, available to the public (Public Access to Commission Documents and Data policy).",
            "files": [{"fy": fy, "url": y["url"], "sha256": y["sha256"], "bytes": y["bytes"], "retrieved_at": y["retrieved_at"],
                       "storage_key": (y.get("storage") or {}).get("key"), "records": y["records"],
                       "records_outside_the_94_districts": y["unknown_district"], "variables_missing": y["variables_missing"]}
                      for fy, y in sorted(years.items())],
        },
        "years": sorted(years), "records": len(rows),
        "grain": "One record per fiscal year x district (94 districts) plus one national record per fiscal year; each record holds offense-type x sentence-type aggregates.",
        "definitions": {
            "cases": "Every record in the year's individual datafile for the district (one sentenced individual's case each).",
            "offense_type": "OFFTYPE2 (FY2002-FY2009), OFFTYPSB (FY2010-FY2017) and OFFGUIDE (FY2018 onward): the primary-offense variable the Commission's Sourcebook used in that year. The three schemes use different categories; offense trends across FY2009/FY2010 and FY2017/FY2018 are not comparable.",
            "sentence_type": {str(k): v for k, v in SENTIMP.items()},
            "sentence_length": "The Commission's 'sentence length' (Statistical Information Packet, Table 7): SENSPCAP (FY2018 onward) or SENSPLT0 capped at 470 months (FY2002-FY2017); prison plus alternative confinement, with probation-only and fine-only cases counted as zero months; median and mean over every case with a value.",
            "length_of_imprisonment":"SENTTCAP (FY2018 onward; sentences over 470 months capped at 469.99, life = 470) or SENTTOT (FY2002-FY2017; capped here at 470 months, life = 470). Only cases with a recorded prison term; probation-only and fine-only cases are excluded. Median and mean over those cases, in months.",
            "guideline_range": "SENTRNGE (FY2018 onward), BOOKERCD (FY2005-FY2017; FY2005 covers the post-Booker cases the variable classifies), DEPART_A (FY2003-FY2004) and DEPART (FY2002), grouped as within, above (upward departures and above-range variances) and below (government-sponsored, other, and DEPART codes that combine both). Shares use the cases with a classifiable code as the denominator.",
            "range_groups": {k: {str(c): b for c, b in v.items()} for k, v in RANGE_SCHEMES.items()},
            "mandatory_minimum": "Share of cases whose total statutory minimum prison term (STATMIN) is greater than zero, among cases with STATMIN recorded.",
            "rounding": "Percentages to one decimal; months to two decimals.",
        },
        "national_series": national_series,
        "offense_labels": {k: {str(c): l for c, l in v.items()} for k, v in OFFENSE_TABLES.items()},
        "notes": [
            "Aggregated from the Commission's public individual datafiles; no person-level data is stored or shown.",
            "The Commission's published Sourcebook tables apply further exclusions in some tables; differences found when checking samples are listed in REPORT.md.",
            "District pages link to /courts/<court id> through the USSC DISTRICT code crosswalk in ussc_codes.py.",
        ],
    }
    listing_block = writer.listing(
        [("fy", "FY"), ("district", "District"), ("cases", "Sentenced"), ("prison_median", "Median prison (months)"),
         ("within_pct", "Within range %"), ("mm_pct", "Mandatory minimum %")],
        [("fy", "Fiscal year", {str(y): f"FY{y}" for y in sorted(years, reverse=True)}),
         ("scope", "Scope", {"district": "District", "national": "All districts"})],
    )
    return write_build(DATASET, "Federal sentencing by district (USSC datafiles, FY2002-FY2025)", rows, listing_block, summary, inputs)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    if sys.argv[1] == "years":
        targets = [int(a) for a in sys.argv[2:] if a.isdigit()] or YEARS
        keep = "--keep-local" in sys.argv
        for fy in targets:
            process_year(fy, keep_local=keep)
    elif sys.argv[1] == "assemble":
        print(assemble())
    else:
        raise SystemExit(__doc__)
