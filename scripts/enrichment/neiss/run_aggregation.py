"""Run the NEISS aggregation passes and cache the reduced results under private/build/neiss/cache/.

  python3 -I -B scripts/enrichment/neiss/run_aggregation.py core [workers]          annual series, every year 1997-2025
  python3 -I -B scripts/enrichment/neiss/run_aggregation.py themes [workers]        narrative themes, annual totals
  python3 -I -B scripts/enrichment/neiss/run_aggregation.py poolseg [workers]       pooled product / dimension profiles per design segment
  python3 -I -B scripts/enrichment/neiss/run_aggregation.py themepoolseg [workers]  pooled narrative-theme profiles per design segment

Pooled profiles cover 2021-2025 in two design segments (2021-2023 and 2024-2025, because CPSC re-stratified the sample in 2024);
build_neiss.py combines the segments with the conservative bound in pooling.py.
"""
import multiprocessing
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aggregate as A  # noqa: E402

YEARS = list(range(1997, 2026))
POOL_YEARS = YEARS[-5:]
SEGMENTS = [[2021, 2022, 2023], [2024, 2025]]


def year_job(y):
    t = time.time()
    res, info = A.run_pass([y], A.year_keys, collect_meta=True)
    A.save_cache(A.cache_path("core", [y]), {"year": y, "res": res, "info": info, "version": A.AGG_VERSION})
    return y, len(res), info["entries"], round(time.time() - t, 1)


def theme_year_job(y):
    import themes
    t = time.time()
    res, info = A.run_pass([y], A.theme_year_keys_factory(themes))
    A.save_cache(A.cache_path("themes", [y]), {"year": y, "res": res, "info": info, "version": A.AGG_VERSION, "themes_hash": themes.definitions_hash()})
    return y, len(res), info["entries"], round(time.time() - t, 1)


def poolseg_job(seg):
    t = time.time()
    res, info = A.run_pass(seg, A.pool_keys)
    if info["psu_multi_stratum"]:
        raise SystemExit(f"segment {seg}: hospital identifiers change stratum inside the segment: {info['psu_multi_stratum']}")
    A.save_cache(A.cache_path("poolseg", seg), {"years": seg, "res": res, "info": info, "version": A.AGG_VERSION})
    return seg, len(res), info["entries"], info["n_h"], round(time.time() - t, 1)


def themepoolseg_job(seg):
    import themes
    t = time.time()
    res, info = A.run_pass(seg, A.theme_pool_keys_factory(themes))
    if info["psu_multi_stratum"]:
        raise SystemExit(f"segment {seg}: hospital identifiers change stratum inside the segment: {info['psu_multi_stratum']}")
    A.save_cache(A.cache_path("themepoolseg", seg), {"years": seg, "res": res, "info": info, "version": A.AGG_VERSION,
                                                       "themes_hash": themes.definitions_hash()})
    return seg, len(res), info["entries"], round(time.time() - t, 1)


def main(argv):
    what = argv[0] if argv else "core"
    workers = int(argv[1]) if len(argv) > 1 else 4
    os.makedirs(A.CACHE_DIR, exist_ok=True)
    jobs = {"core": (year_job, YEARS), "themes": (theme_year_job, YEARS), "poolseg": (poolseg_job, SEGMENTS),
            "themepoolseg": (themepoolseg_job, SEGMENTS)}
    if what not in jobs:
        raise SystemExit(__doc__)
    fn, items = jobs[what]
    with multiprocessing.Pool(min(workers, len(items))) as pool:
        for out in pool.imap_unordered(fn, items):
            print(what, out, flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
