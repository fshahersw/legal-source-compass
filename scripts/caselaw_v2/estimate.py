"""Case law v2: exact volume per court group from the stage-1 table copies, and size estimates for storage and search.

    python3 -I -B scripts/caselaw_v2/estimate.py --opinion-db <opinion.duckdb> --cluster-db <cluster.duckdb> \
        [--sample-run sample] [--out private/build/w1025_caselaw/estimates.json]

The two DuckDB files are the stage-1 copies in private storage (corpus-originals courtlistener/duckdb/2026-10-23/
opinion.duckdb: id, cluster_id, per-field text lengths of all 10,903,928 opinions; cluster.duckdb: 10,174,551 clusters);
the docket table is the local slim copy. Counted exactly per tier and court (CourtListener court jurisdiction code, the
registry in courts.json): clusters, blocked clusters, clusters with at least one opinion (= the case rows a load creates),
opinions of unblocked clusters, and the bytes of each opinion's best text field (the field the renderer uses).
Estimates (labelled as such) scale those exact bytes by ratios measured on the bounded sample run (text characters per
raw byte, stored gzip bytes per raw byte, by tier) and on production (DB bytes per case row, tsvector bytes per text
character for full and prefix indexing).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DOCKET_DB, WORK, now, read_json, write_json  # noqa: E402

FIELD_PRIORITY = ["html_with_citations", "html_columbia", "html_lawbox", "xml_harvard", "html_anon_2020", "html", "plain_text"]


def best_len_sql() -> str:
    return "coalesce(" + ", ".join(f"nullif(o.len_{f}, 0)" for f in FIELD_PRIORITY) + ", 0)"


def exact(opinion_db: str, cluster_db: str) -> dict:
    import duckdb

    reg = read_json(os.path.join(WORK, "courts.json"))
    con = duckdb.connect()
    con.execute("PRAGMA threads=3")
    con.execute("PRAGMA memory_limit='3GB'")
    con.execute(f"ATTACH '{opinion_db}' AS o (READ_ONLY)")
    con.execute(f"ATTACH '{cluster_db}' AS k (READ_ONLY)")
    con.execute(f"ATTACH '{DOCKET_DB}' AS d (READ_ONLY)")
    con.execute("CREATE TEMP TABLE reg (court_id VARCHAR, level VARCHAR, tier INTEGER, excluded BOOLEAN)")

    def tier(c):
        if c["tier"]:
            return c["tier"]
        if c["court_id"] == "scotus":
            return 1
        return {"F": 2, "S": 3}.get(c["level"] or "")

    con.executemany("INSERT INTO reg VALUES (?, ?, ?, ?)",
                    [(c["court_id"], c["level"], tier(c), bool(c.get("excluded"))) for c in reg["courts"]])
    con.execute(f"""CREATE TEMP TABLE kc AS
        SELECT k.id AS cluster_id, d.court_id, coalesce(k.blocked, false) OR coalesce(d.blocked, false) AS blocked
        FROM k.cluster k LEFT JOIN d.docket d ON d.id = k.docket_id""")
    con.execute(f"""CREATE TEMP TABLE op AS
        SELECT o.cluster_id, {best_len_sql()}::BIGINT AS best_len, o.len_xml_harvard AS xml_len
        FROM o.opinion o""")
    rows = con.execute("""
        WITH ops AS (SELECT cluster_id, count(*) n, sum(best_len) b, count(*) FILTER (WHERE best_len = 0) empty
                     FROM op GROUP BY 1)
        SELECT coalesce(r.tier, 0) AS tier, coalesce(r.level, 'unknown') AS level, kc.court_id, bool_or(r.excluded) AS excluded,
               count(*) clusters, count(*) FILTER (WHERE kc.blocked) blocked,
               count(*) FILTER (WHERE NOT kc.blocked AND ops.n > 0) cases,
               coalesce(sum(ops.n) FILTER (WHERE NOT kc.blocked), 0) opinions,
               coalesce(sum(ops.b) FILTER (WHERE NOT kc.blocked), 0) best_bytes,
               coalesce(sum(ops.empty) FILTER (WHERE NOT kc.blocked), 0) no_text
        FROM kc LEFT JOIN reg r ON r.court_id = kc.court_id LEFT JOIN ops ON ops.cluster_id = kc.cluster_id
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""").fetchall()
    cols = ["tier", "level", "court_id", "excluded", "clusters", "blocked", "cases", "opinions", "best_bytes", "no_text"]
    per_court = [dict(zip(cols, r)) for r in rows]
    con.close()
    return {"per_court": per_court}


def ratios(sample_run: str | None) -> dict:
    """Per tier: text chars / raw bytes and stored gzip bytes / raw bytes, from a sample run's unit reports."""
    import glob

    out = {}
    if not sample_run:
        return out
    agg: dict = {}
    for p in glob.glob(os.path.join(WORK, "runs", sample_run, "units", "u*.json")):
        u = read_json(p)
        for t, v in u["by_tier"].items():
            a = agg.setdefault(int(t), {"raw_bytes": 0, "text_chars": 0, "gzip_bytes": 0, "opinions": 0})
            for k in a:
                a[k] += v.get(k, 0)
    for t, a in agg.items():
        if a["raw_bytes"]:
            out[t] = {"text_per_raw": a["text_chars"] / a["raw_bytes"], "gzip_per_raw": a["gzip_bytes"] / a["raw_bytes"],
                      "sample_opinions": a["opinions"], "sample_raw_bytes": a["raw_bytes"]}
    return out


# measured on production 2026-10-23 (caselaw_status_v1 bytes / rows; SCOTUS text index; see the doc for the queries)
DB_BYTES_PER_CASE = 6_261_506_048 / 4_033_288  # caselaw.cases incl. indexes and TOAST, per row
DB_BYTES_PER_OPINION_ENTRY = 60                 # one opinions-jsonb entry with a pointer (part of the row above)


def tsv_ratio(tsv: dict, tier: int, scope: str) -> float | None:
    t = (tsv.get("tiers") or {}).get(str(tier))
    if t and t.get("opinions", 0) >= 200:
        return t["disk_per_char"][scope]
    a = (tsv.get("all") or {}).get(scope)
    return a["disk_per_char"] if a else None


def summarise(ex: dict, rt: dict, tsv: dict) -> dict:
    groups: dict = {}
    for r in ex["per_court"]:
        key = r["tier"] if not r["excluded"] else "excluded"
        g = groups.setdefault(str(key), {"courts": 0, "clusters": 0, "blocked": 0, "cases": 0, "opinions": 0, "best_bytes": 0, "no_text": 0})
        g["courts"] += 1
        for k in ("clusters", "blocked", "cases", "opinions", "best_bytes", "no_text"):
            g[k] += int(r[k] or 0)
    # tiers without a sample of their own use the pooled sample ratios
    pooled = {k: sum(v[k] * v["sample_raw_bytes"] for v in rt.values()) / max(1, sum(v["sample_raw_bytes"] for v in rt.values()))
              for k in ("text_per_raw", "gzip_per_raw")} if rt else {"text_per_raw": 0.70, "gzip_per_raw": 0.27}
    for t, g in groups.items():
        if not t.isdigit():
            continue
        q = rt.get(int(t)) or pooled
        text = g["best_bytes"] * q["text_per_raw"]
        g["est_text_chars"] = int(text)
        g["est_read_store_gzip_bytes"] = int(g["best_bytes"] * q["gzip_per_raw"])
        g["est_db_case_bytes"] = int(g["cases"] * DB_BYTES_PER_CASE)
        for scope in ("full", "strip", "prefix2000", "prefix1000"):
            r = tsv_ratio(tsv, int(t), scope)
            g[f"est_tsv_{scope}_bytes"] = int(text * r) if r is not None else None
        g["ratio_source"] = "sample" if int(t) in rt else "pooled sample"
    return groups


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--opinion-db", required=True)
    ap.add_argument("--cluster-db", required=True)
    ap.add_argument("--sample-run", default="sample")
    ap.add_argument("--tsv-ratios", default=os.path.join(WORK, "tsv_ratios.json"), help="tsv_measure.mjs output")
    ap.add_argument("--out", default=os.path.join(WORK, "estimates.json"))
    a = ap.parse_args()
    ex = exact(a.opinion_db, a.cluster_db)
    rt = ratios(a.sample_run)
    tsv = read_json(a.tsv_ratios, {})
    groups = summarise(ex, rt, tsv)
    out = {"built_at": now(), "inputs": {"opinion_db": os.path.basename(a.opinion_db), "cluster_db": os.path.basename(a.cluster_db),
                                         "docket_db": os.path.relpath(DOCKET_DB, os.path.dirname(os.path.dirname(WORK)))},
           "ratios": rt, "tsv": {"all": tsv.get("all"), "tiers": tsv.get("tiers")},
           "db_bytes_per_case": DB_BYTES_PER_CASE, "groups": groups, "per_court": ex["per_court"]}
    write_json(a.out, out)
    print(json.dumps({"ratios": rt, "groups": groups}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
