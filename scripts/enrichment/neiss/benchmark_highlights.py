"""Benchmark the cached annual estimates against CPSC's published "NEISS Data Highlights" tables, 2000-2024.

Single-code product groups only (Basketball 1205, Boxing 1207, Football 1211, Trampolines 1233, Horseback Riding 1239, Volleyball 1266,
Soccer 1267, Chain Saws 1411, Bowling 1206, Fishing 3223, Martial Arts 3257). Writes private/build/neiss/highlights_benchmark.json.

  python3 -I -B scripts/enrichment/neiss/benchmark_highlights.py
"""
import collections
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aggregate as A  # noqa: E402
import highlights as H  # noqa: E402
import neiss_lib as L  # noqa: E402

DOCS = os.path.join(A.ROOT, "private", "acq", "neiss", "docs")
SINGLE = {"Basketball": 1205, "Boxing": 1207, "Football": 1211, "Trampolines": 1233, "Horseback Riding": 1239, "Volleyball": 1266,
          "Soccer": 1267, "Chain Saws": 1411, "Bowling": 1206, "Fishing": 3223, "Martial Arts": 3257}


def main():
    rows = []
    for y in range(2000, 2025):
        pub = {r["group"]: r for r in H.parse_highlights(H.pdf_text(os.path.join(DOCS, f"NEISS-Data-Highlights-{y}.pdf")))}
        res = A.load_cache(A.cache_path("core", [y]))["res"]
        for g, code in SINGLE.items():
            p, t = pub.get(g), res.get(("prod", code))
            if not p or not t:
                continue
            cv = L.cv_of(t[0], t[2])
            d_est, d_cases = round(t[0]) - p["estimate"], t[1] - p["cases"]
            identical = abs(d_est) <= 1 and d_cases == 0
            near = (not identical) and abs(d_cases) <= 3 and abs(d_est) <= 0.001 * p["estimate"]
            cv_round = abs(round(cv, 2) - p["cv"]) < 1e-9
            cv_trunc = abs(math.floor(cv * 100 + 1e-9) / 100 - p["cv"]) < 1e-9
            rows.append({"year": y, "group": g, "code": code, "estimate": round(t[0]), "published_estimate": p["estimate"], "cases": t[1],
                         "published_cases": p["cases"], "cv": round(cv, 4), "published_cv": p["cv"],
                         "estimate_status": "identical" if identical else ("near" if near else "differs"),
                         "cv_status": "rounded" if cv_round else ("truncated" if cv_trunc else "differs"),
                         "cv_difference": round(abs(cv - p["cv"]), 4)})
    est = collections.Counter(r["estimate_status"] for r in rows)
    cvs = collections.Counter(r["cv_status"] for r in rows)
    worst = max((r["cv_difference"] for r in rows if r["cv_status"] == "differs"), default=0)
    out = {"comparisons": len(rows), "estimate_status": dict(est), "cv_status": dict(cvs), "largest_unexplained_cv_difference": worst,
           "max_case_difference": max(abs(r["cases"] - r["published_cases"]) for r in rows),
           "max_relative_estimate_difference": max(abs(r["estimate"] - r["published_estimate"]) / r["published_estimate"] for r in rows),
           "rows": rows}
    with open(os.path.join(A.ROOT, "private", "build", "neiss", "highlights_benchmark.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}))


if __name__ == "__main__":
    main()
