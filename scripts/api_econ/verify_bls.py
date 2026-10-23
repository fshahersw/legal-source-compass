"""Cross-checks for the BLS builds (writes private/build/w1025_api-econ/bls/verify_bls.json):

  1. OEWS: every occupation of the national row (built from the bulk time-series file) against BLS's own May <year>
     national workbook (https://www.bls.gov/oes/special-requests/oesm<yy>nat.zip): employment, hourly and annual mean,
     hourly median and the annual percentiles must be the same numbers.
  2. CPI: BLS CUUR0000SA0 (bulk file) against FRED CPIAUCNS (econ_fred_observations build) for every month both hold.

  python3 -I -B scripts/api_econ/verify_bls.py --oews-zip <path to oesmYYnat.zip>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

COLS = {"employment": "TOT_EMP", "hourly_mean": "H_MEAN", "annual_mean": "A_MEAN", "hourly_median": "H_MEDIAN",
        "annual_p10": "A_PCT10", "annual_p25": "A_PCT25", "annual_median": "A_MEDIAN", "annual_p75": "A_PCT75",
        "annual_p90": "A_PCT90"}


def num(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip().replace(",", "")
    if re.fullmatch(r"-?\d+(\.\d+)?", v):
        return f"{float(v):.2f}"
    return v


def oews_check(zpath: Path) -> dict:
    build = json.loads((ec.BUILD / "bls" / "econ_bls_oews.json").read_text())
    nat = next(r for r in build["rows"] if r["id"] == "oews:N0000000")["item"]["oews"]
    fields = nat["fields"]
    tmp = ec.BUILD / "bls" / "_nat.xlsx"
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith(".xlsx"))
        tmp.write_bytes(z.read(name))
    cells = ec.read_xlsx(tmp)
    tmp.unlink()
    head = cells[0]
    idx = {h: i for i, h in enumerate(head) if h}
    compared = equal = 0
    diffs = []
    special = {}
    for r in cells[1:]:
        code = (r[idx["OCC_CODE"]] or "").replace("-", "")
        if (r[idx["AREA_TYPE"]] or "") not in ("1",) or not code:
            continue
        ours = nat["occupations"].get(code)
        if ours is None:
            diffs.append({"occupation": code, "issue": "in the workbook, not in the bulk file"})
            continue
        for f, col in COLS.items():
            w = r[idx[col]] if idx[col] < len(r) else None
            o = ours[fields.index(f)]
            compared += 1
            if num(w) == num(o):
                equal += 1
            elif w is not None and not re.fullmatch(r"-?[\d.,]+", w.strip()):
                special.setdefault(f"workbook {w.strip()!r} / bulk {o!r}", 0)
                special[f"workbook {w.strip()!r} / bulk {o!r}"] += 1
            else:
                diffs.append({"occupation": code, "field": f, "workbook": w, "bulk": o})
    missing = [d["occupation"] for d in diffs if d.get("issue")]
    values = [d for d in diffs if not d.get("issue")]
    return {"workbook": str(zpath.name), "compared": compared, "equal": equal, "special_value_pairs": special,
            "value_differences": values[:50], "value_difference_count": len(values),
            "workbook_only_occupations": len(missing), "workbook_only_sample": missing[:12],
            "note": "workbook-only codes are broad SOC groups (e.g. 11-1010) the bulk time-series file does not carry"}


def cpi_check() -> dict:
    cpi = json.loads((ec.BUILD / "bls" / "econ_bls_cpi_areas.json").read_text())
    bls = next(r for r in cpi["rows"] if r["id"] == "cpi:CUUR0000SA0")["item"]["cpi"]["obs"]
    bls_m = {f"{y}-{p[1:]}-01": v for y, p, v, _ in bls if re.fullmatch(r"M(0[1-9]|1[0-2])", p)}
    fred_path = ec.BUILD / "fred" / "econ_fred_observations.json"
    if not fred_path.exists():
        return {"skipped": "no FRED build"}
    fred = json.loads(fred_path.read_text())
    f_obs = {o[0]: o[1] for r in fred["rows"] if r["id"].startswith("fred:CPIAUCNS:") for o in r["item"]["fred"]["obs"]}
    both = sorted(set(bls_m) & set(f_obs))
    diffs = [{"month": m, "bls": bls_m[m], "fred": f_obs[m]} for m in both if (f_obs[m] or "-") != bls_m[m].strip() and not (f_obs[m] is None and bls_m[m].strip() == "-")]
    return {"months_compared": len(both), "differences": diffs[:20], "difference_count": len(diffs),
            "first": both[0] if both else None, "last": both[-1] if both else None}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--oews-zip", required=True)
    a = ap.parse_args(argv)
    report = {"oews_national": oews_check(Path(a.oews_zip)), "cpi_us_vs_fred": cpi_check()}
    out = ec.BUILD / "bls" / "verify_bls.json"
    out.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("differences", "value_differences")} for k, v in report.items()}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
