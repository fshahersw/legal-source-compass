"""Select the top-tier court opinions of the CourtListener 2026-09-30 snapshot and plan their shard groups.

    python3 -I -B select_tiers.py

Reads the local DuckDB copies of the snapshot (private/acq/courtlistener/db/: opinion, cluster, docket, small.courts)
and writes

* private/build/caselaw/work/selection.parquet: one row per selected opinion (opinion_id, cluster_id, docket_id,
  court_id, tier, date_filed, precedential_status, blocked, cluster_blocked, docket_blocked, type, author_id,
  best_field, best_len, shard_group), ordered by opinion_id;
* private/build/caselaw/work/selection_report.json: counts per tier and per court, blocked counts, the courts split
  by decade, and the opinions that cannot be tiered (no cluster, docket or court row).

Tiers (an opinion belongs to its cluster's docket's court):
  t1  court_id = 'scotus'
  t2  courts.jurisdiction = 'F' (federal appellate), excluding scotus
  t3  courts.jurisdiction = 'S' (state highest courts)

`blocked` is CourtListener's own flag: true when the cluster or the docket is blocked (from search engines).
Blocked opinions are selected and extracted; later stages must not show or index them.

Shard groups: `<tier>/<court>` or, for courts whose selected best-field text totals at least BIG_COURT_BYTES,
`<tier>/<court>/<decade>` (decade of the cluster's date_filed, e.g. 1990s; `undated` when the date is missing).
best_field/best_len come from the per-field lengths recorded at ingest and use the same priority as extract_text.py.
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
WORK = os.path.join(ROOT, "private", "build", "caselaw", "work")
SNAPSHOT = "2026-09-30"
BIG_COURT_BYTES = 1_000_000_000

# CourtListener's own order of text fields, best first (extract_text.py uses the same list)
FIELD_PRIORITY = ["html_with_citations", "html_columbia", "html_lawbox", "xml_harvard", "html_anon_2020", "html", "plain_text"]

TIER_SQL = "CASE WHEN d.court_id = 'scotus' THEN 't1' WHEN c.jurisdiction = 'F' THEN 't2' WHEN c.jurisdiction = 'S' THEN 't3' END"


def best_field_sql() -> tuple[str, str]:
    name = "CASE " + " ".join(f"WHEN coalesce(o.len_{f}, 0) > 0 THEN '{f}'" for f in FIELD_PRIORITY) + " END"
    size = "coalesce(" + ", ".join(f"nullif(o.len_{f}, 0)" for f in FIELD_PRIORITY) + ", 0)"
    return name, size


def shard_group(tier: str, court: str, date_filed, big: set[str]) -> str:
    if court not in big:
        return f"{tier}/{court}"
    if date_filed is None:
        return f"{tier}/{court}/undated"
    return f"{tier}/{court}/{(date_filed.year // 10) * 10}s"


def build(con, big_court_bytes: int = BIG_COURT_BYTES) -> set[str]:
    """Create temp table sel2 (the selection with shard groups) from attached catalogs opinion, cluster, docket, small."""
    bname, bsize = best_field_sql()
    con.execute(
        f"""CREATE TEMP TABLE sel AS
            SELECT o.id AS opinion_id, o.cluster_id, k.docket_id, d.court_id, {TIER_SQL} AS tier, k.date_filed,
                   k.precedential_status, coalesce(k.blocked, false) OR coalesce(d.blocked, false) AS blocked,
                   coalesce(k.blocked, false) AS cluster_blocked, coalesce(d.blocked, false) AS docket_blocked,
                   o.type, o.author_id, {bname} AS best_field, {bsize}::BIGINT AS best_len
            FROM opinion.opinion o
            JOIN cluster.cluster k ON k.id = o.cluster_id
            JOIN docket.docket d ON d.id = k.docket_id
            JOIN small.courts c ON c.id = d.court_id
            WHERE {TIER_SQL} IS NOT NULL"""
    )
    dup = con.execute("SELECT count(*) - count(DISTINCT opinion_id) FROM sel").fetchone()[0]
    if dup:
        raise SystemExit(f"{dup} duplicate opinion ids in the selection")
    big = {r[0] for r in con.execute("SELECT court_id FROM sel GROUP BY 1 HAVING sum(best_len) >= ?", [big_court_bytes]).fetchall()}
    con.execute("CREATE TEMP TABLE big(court_id VARCHAR)")
    if big:
        con.executemany("INSERT INTO big VALUES (?)", [[c] for c in sorted(big)])
    con.execute(
        """CREATE TEMP TABLE sel2 AS
           SELECT s.*, CASE WHEN b.court_id IS NULL THEN s.tier || '/' || s.court_id
                            WHEN s.date_filed IS NULL THEN s.tier || '/' || s.court_id || '/undated'
                            ELSE s.tier || '/' || s.court_id || '/' || CAST((year(s.date_filed) // 10) * 10 AS VARCHAR) || 's' END AS shard_group
           FROM sel s LEFT JOIN big b ON b.court_id = s.court_id ORDER BY s.opinion_id"""
    )
    return big


def main() -> int:
    import duckdb

    os.makedirs(WORK, exist_ok=True)
    t0 = time.time()
    con = duckdb.connect()
    con.execute("PRAGMA threads=2")
    con.execute("PRAGMA memory_limit='4GB'")
    for name in ("opinion", "cluster", "docket", "small"):
        con.execute(f"ATTACH '{os.path.join(DB, name + '.duckdb')}' AS {name} (READ_ONLY)")
    big = build(con)
    out = os.path.join(WORK, "selection.parquet")
    tmp = out + ".tmp"
    con.execute(f"COPY sel2 TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)")
    os.replace(tmp, out)

    total_opinions = con.execute("SELECT count(*) FROM opinion.opinion").fetchone()[0]
    untiered = con.execute(
        """SELECT count(*) FILTER (WHERE k.id IS NULL), count(*) FILTER (WHERE k.id IS NOT NULL AND d.id IS NULL),
                  count(*) FILTER (WHERE d.id IS NOT NULL AND c.id IS NULL)
           FROM opinion.opinion o LEFT JOIN cluster.cluster k ON k.id = o.cluster_id
           LEFT JOIN docket.docket d ON d.id = k.docket_id LEFT JOIN small.courts c ON c.id = d.court_id"""
    ).fetchone()
    per_tier = [
        dict(zip(("tier", "opinions", "courts", "blocked", "with_text", "best_field_bytes", "published"), r))
        for r in con.execute(
            """SELECT tier, count(*), count(DISTINCT court_id), count(*) FILTER (WHERE blocked), count(*) FILTER (WHERE best_len > 0),
                      sum(best_len), count(*) FILTER (WHERE precedential_status = 'Published')
               FROM sel2 GROUP BY 1 ORDER BY 1"""
        ).fetchall()
    ]
    per_court = [
        dict(zip(("tier", "court_id", "jurisdiction", "full_name", "opinions", "blocked", "with_text", "best_field_bytes", "first_date", "last_date", "decade_split"), r))
        for r in con.execute(
            """SELECT s.tier, s.court_id, c.jurisdiction, c.full_name, count(*), count(*) FILTER (WHERE s.blocked), count(*) FILTER (WHERE s.best_len > 0),
                      sum(s.best_len), CAST(min(s.date_filed) AS VARCHAR), CAST(max(s.date_filed) AS VARCHAR), b.court_id IS NOT NULL
               FROM sel2 s JOIN small.courts c ON c.id = s.court_id LEFT JOIN big b ON b.court_id = s.court_id
               GROUP BY 1, 2, 3, 4, b.court_id ORDER BY 1, 5 DESC, 2"""
        ).fetchall()
    ]
    best_fields = dict(con.execute("SELECT coalesce(best_field, 'none'), count(*) FROM sel2 GROUP BY 1 ORDER BY 2 DESC").fetchall())
    groups = con.execute("SELECT shard_group, count(*), sum(best_len) FROM sel2 GROUP BY 1 ORDER BY 1").fetchall()
    report = {
        "snapshot": SNAPSHOT,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": {
            name: os.path.join("private", "acq", "courtlistener", "db", name + ".duckdb") for name in ("opinion", "cluster", "docket", "small")
        },
        "tier_rules": {"t1": "court_id = 'scotus'", "t2": "courts.jurisdiction = 'F' (federal appellate), court_id <> 'scotus'", "t3": "courts.jurisdiction = 'S' (state highest courts)"},
        "blocked_rule": "cluster.blocked OR docket.blocked (CourtListener's flag)",
        "field_priority": FIELD_PRIORITY,
        "opinions_in_snapshot": total_opinions,
        "selected": sum(t["opinions"] for t in per_tier),
        "not_tierable": {"no_cluster_row": untiered[0], "no_docket_row": untiered[1], "no_court_row": untiered[2]},
        "per_tier": per_tier,
        "best_field": best_fields,
        "big_court_bytes": BIG_COURT_BYTES,
        "decade_split_courts": sorted(big),
        "shard_groups": len(groups),
        "per_court": per_court,
        "groups": [{"group": g, "opinions": n, "best_field_bytes": b} for g, n, b in groups],
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(WORK, "selection_report.json"), "w") as h:
        json.dump(report, h, indent=1, default=str)
    print(json.dumps({k: report[k] for k in ("selected", "opinions_in_snapshot", "not_tierable", "per_tier", "best_field", "decade_split_courts", "shard_groups", "seconds")}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
