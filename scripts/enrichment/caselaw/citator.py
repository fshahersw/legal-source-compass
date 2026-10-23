"""Case-law stage 2c: per-case citator members in private storage, two kinds:

    cd scripts/enrichment/caselaw
    python3 -I -B citator.py run --kind citedby [--partitions 64] [--only 0,1] [--no-upload]
    python3 -I -B citator.py run --kind authorities [--partitions 16]
    python3 -I -B citator.py status

citedby needs only local CourtListener tables (it does not depend on the text extraction): the stage-1 selection
(unblocked clusters of the three tiers = the cases), the 2026-09-30 tables in private/acq/courtlistener/db (opinion ->
cluster, cluster, docket, citation map, citations, courts) and parentheticals.parquet (parentheticals.py).
authorities needs the reading store's anchors (read_store.py: the citation links of each opinion's own text), so it is
rebuilt after the reading store.

citedby, for every case (cluster) C of the three tiers ("caselaw-citator/1"):
  cited_by        citing opinions in the citation map whose cluster is not C and is not blocked (cluster or docket);
                  cited_by_cases = their distinct clusters
  by_court        [court_id, citing opinions] (all courts), by_decade [decade, citing opinions] (decade of the citing
                  cluster's date_filed; null = undated), by_court_decade [court_id, decade, citing opinions]
  citing          the top CITING_TOP citing cases ranked by the citing case's own CourtListener citation_count (most
                  cited first), then the number of times it cites C (citation-map depth, summed over its opinions),
                  then newest first, then cluster id; each with name, court, date, first citation, depth, opinions
                  and held (1 when that case has a page here)
  parentheticals  up to 50 (parentheticals.py: best per CourtListener group, by score) with the describing case
authorities, for every case whose stored opinions carry citation links ("caselaw-authorities/1"):
  the cases C's own opinions cite, from the html_with_citations links stage 1 recorded: cited cluster, name, court,
  date, first citation, anchors (links in the text; when the case holds a combined text besides its separate opinions,
  the larger of the two counts, since the texts repeat each other), the first anchor's text and held. Links to C
  itself and to blocked clusters are left out; a link without a cluster id is resolved through the opinion table, and kept as
  unresolved (cluster null) when that fails.
Objects: caselaw/citator/<snapshot>/{c|a}<partition>-<seq>-<sha256[:12]>.jsonl.gz, one gzip member per case (cases
are partitioned by cluster_id % partitions). A case with nothing to show gets no member (pointer null).

Outputs (private/build/caselaw_read/citator/): objects.jsonl (upload receipts), index/c<NN>.tsv.gz (cluster_id, key,
offset, length, cited_by, cited_by_cases, parentheticals, member_sha256), index/a<NN>.tsv.gz (cluster_id, key, offset,
length, authorities, member_sha256), partitions.json (state per kind and partition).
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import read_store as rs  # noqa: E402

SNAPSHOT = "2026-09-30"
CITATOR_FORMAT = "caselaw-citator/1"
AUTHORITIES_FORMAT = "caselaw-authorities/1"
PREFIX = f"caselaw/citator/{SNAPSHOT}"
CITING_TOP = 200
DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
OUT = os.path.join(ROOT, "private", "build", "caselaw_read", "citator")
PAREN = os.path.join(OUT, "parentheticals.parquet")
ANCHORS = os.path.join(ROOT, "private", "build", "caselaw_read", "read", "anchors")
ANCHORS_PARQUET = os.path.join(OUT, "anchors.parquet")
EMPTY_PAREN = os.path.join(OUT, "parentheticals-empty.parquet")
OBJECT_TARGET = 24_000_000
CL_OPINION = "https://www.courtlistener.com/opinion/{}/"

# CourtListener citation types, in the display order used here: neutral, federal, state, early SCOTUS, regional,
# specialty, West, Lexis, journal (anything else last)
CITE_TYPE_ORDER = {8: 0, 1: 1, 2: 2, 5: 3, 3: 4, 4: 5, 7: 6, 6: 7, 9: 8}


def cite_order_sql(alias: str = "c") -> str:
    """Sort key of a citation: CourtListener type (CITE_TYPE_ORDER), then within a type the official U.S. Reports before
    the Supreme Court Reporter and Lawyers' Edition, database citations (LEXIS, WL) last, then volume."""
    cases = " ".join(f"WHEN {k} THEN {v}" for k, v in CITE_TYPE_ORDER.items())
    pref = (f"CASE WHEN {alias}.reporter = 'U.S.' THEN 0 WHEN {alias}.reporter = 'S. Ct.' THEN 1 "
            f"WHEN {alias}.reporter LIKE 'L. Ed.%' THEN 2 WHEN {alias}.reporter LIKE '%LEXIS%' OR {alias}.reporter = 'WL' THEN 9 ELSE 5 END")
    vol = f"least(coalesce(try_cast({alias}.volume AS BIGINT), 0), 999999)"
    return f"((CASE {alias}.type {cases} ELSE 99 END) * 10 + {pref}) * 1000000 + {vol}"


def connect(memory: str = "4GB", threads: int = 2):
    import duckdb

    con = duckdb.connect()
    con.execute(f"PRAGMA threads={threads}")
    con.execute(f"PRAGMA memory_limit='{memory}'")
    con.execute("SET preserve_insertion_order=false")
    tmp = os.path.join(OUT, "duck_tmp")
    os.makedirs(tmp, exist_ok=True)
    con.execute(f"SET temp_directory='{tmp}'")
    con.execute("SET max_temp_directory_size='300MB'")
    for name in ("opinion", "cluster", "docket", "cmap", "citation", "small"):
        con.execute(f"ATTACH '{os.path.join(DB, name + '.duckdb')}' AS {name} (READ_ONLY)")
    return con


def _step(con, label: str, sql: str) -> None:
    t = time.time()
    con.execute(sql)
    print(f"[citator]   {label}: {time.time() - t:.1f}s", flush=True)


def prepare(con, selection: str = rs.SELECTION, anchors_glob: str | None = None) -> dict:
    """Shared tables: tier cases, opinion->cluster, cluster facts (court, date, blocked), first citation, anchors."""
    t0 = time.time()
    _step(con, "sel", f"CREATE TEMP TABLE sel AS SELECT opinion_id, cluster_id, type FROM read_parquet('{selection}') WHERE NOT blocked")
    _step(con, "cases", "CREATE TEMP TABLE cases AS SELECT DISTINCT cluster_id FROM sel")
    _step(con, "o2c", "CREATE TEMP TABLE o2c AS SELECT id, cluster_id FROM opinion.opinion")
    _step(con, "cfacts", """CREATE TEMP TABLE cfacts AS
        SELECT k.id AS cluster_id, d.court_id, k.date_filed, k.citation_count,
               coalesce(k.blocked, false) OR coalesce(d.blocked, false) AS blocked
        FROM cluster.cluster k LEFT JOIN docket.docket d ON d.id = k.docket_id""")
    _step(con, "firstcite", f"""CREATE TEMP TABLE firstcite AS
        SELECT cluster_id, arg_min(volume || ' ' || reporter || ' ' || page, {cite_order_sql()}) AS cite
        FROM citation.citation c GROUP BY cluster_id""")
    anchors_glob = anchors_glob or os.path.join(ANCHORS, "*.tsv.gz")
    files = sorted(glob.glob(anchors_glob))
    if files:
        _step(con, "anchors_raw", f"""CREATE TEMP TABLE anchors_raw AS SELECT * FROM read_csv({json.dumps(files)}, delim='\t', header=true, quote='', escape='', auto_detect=false,
            columns={{'citing_opinion_id': 'BIGINT', 'citing_cluster_id': 'BIGINT', 'cited_cluster_id': 'BIGINT', 'cited_opinion_id': 'BIGINT',
                      'anchors': 'INTEGER', 'first_text': 'VARCHAR'}}, nullstr='')""")
    else:
        con.execute("""CREATE TEMP TABLE anchors_raw (citing_opinion_id BIGINT, citing_cluster_id BIGINT, cited_cluster_id BIGINT,
                       cited_opinion_id BIGINT, anchors INTEGER, first_text VARCHAR)""")
    # a link without a cluster id is resolved through the opinion table when possible; kept on disk, read per partition
    _step(con, "anchors", f"""COPY (
        SELECT a.citing_cluster_id, coalesce(a.cited_cluster_id, o.cluster_id) AS cited_cluster_id, a.cited_opinion_id,
               a.citing_opinion_id, a.anchors, a.first_text
        FROM anchors_raw a LEFT JOIN o2c o ON o.id = a.cited_opinion_id) TO '{ANCHORS_PARQUET}' (FORMAT parquet, COMPRESSION zstd)""")
    n_anchors = con.execute("SELECT count(*) FROM anchors_raw").fetchone()[0]
    con.execute("DROP TABLE anchors_raw")
    if not os.path.exists(PAREN):
        con.execute(f"""COPY (SELECT * FROM (VALUES (NULL::BIGINT, NULL::BIGINT, NULL::VARCHAR, NULL::DOUBLE, NULL::BIGINT, NULL::BIGINT,
                        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT)) t(described_cluster_id, id, text, score, describing_opinion_id,
                        describing_cluster_id, group_id, rnk, total) WHERE false) TO '{EMPTY_PAREN}' (FORMAT parquet)""")
    con.execute("CREATE TEMP TABLE courts AS SELECT id AS court_id, coalesce(nullif(short_name, ''), full_name) AS name FROM small.courts")
    return {"cases": con.execute("SELECT count(*) FROM cases").fetchone()[0], "anchor_files": len(files), "anchors": n_anchors,
            "anchors_sha256": files_digest(files), "parentheticals_file": PAREN if os.path.exists(PAREN) else None,
            "seconds": round(time.time() - t0, 1)}


def files_digest(paths: list[str]) -> str:
    """One sha256 over the names and bytes of the given files (the anchors are deterministic gzip, mtime 0)."""
    h = hashlib.sha256()
    for p in paths:
        h.update(os.path.basename(p).encode() + b"\0")
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        h.update(b"\0")
    return h.hexdigest()


PARTITION_SQL = """
CREATE OR REPLACE TEMP TABLE pc AS SELECT cluster_id FROM cases WHERE cluster_id % {P} = {p};
CREATE OR REPLACE TEMP TABLE e AS
  SELECT s.cluster_id AS cited, o.cluster_id AS citing, m.citing_opinion_id AS citing_op, m.depth
  FROM cmap.cmap m
  JOIN sel s ON s.opinion_id = m.cited_opinion_id
  JOIN pc ON pc.cluster_id = s.cluster_id
  JOIN o2c o ON o.id = m.citing_opinion_id
  JOIN cfacts f ON f.cluster_id = o.cluster_id
  WHERE o.cluster_id <> s.cluster_id AND NOT f.blocked;
CREATE OR REPLACE TEMP TABLE counts AS
  SELECT cited, count(DISTINCT citing_op) AS cited_by, count(DISTINCT citing) AS cited_by_cases FROM e GROUP BY cited;
CREATE OR REPLACE TEMP TABLE ops AS SELECT DISTINCT e.cited, e.citing, e.citing_op FROM e;
CREATE OR REPLACE TEMP TABLE bcd AS
  SELECT ops.cited, f.court_id, CAST(year(f.date_filed) // 10 * 10 AS INTEGER) AS decade, count(*) AS n
  FROM ops JOIN cfacts f ON f.cluster_id = ops.citing GROUP BY ALL;
CREATE OR REPLACE TEMP TABLE pairs AS
  SELECT e.cited, e.citing, sum(e.depth) AS depth, count(DISTINCT e.citing_op) AS opinions FROM e GROUP BY e.cited, e.citing;
CREATE OR REPLACE TEMP TABLE topc AS
  SELECT * FROM (
    SELECT p.*, f.court_id, f.date_filed, f.citation_count,
           row_number() OVER (PARTITION BY p.cited ORDER BY f.citation_count DESC NULLS LAST, p.depth DESC, f.date_filed DESC NULLS LAST, p.citing) AS rnk
    FROM pairs p JOIN cfacts f ON f.cluster_id = p.citing) WHERE rnk <= {TOP};
"""

OUTPUT_SQL = """
WITH
 cnt AS (SELECT * FROM counts),
 bc AS (SELECT cited, list([court_id, CAST(n AS VARCHAR)] ORDER BY n DESC, court_id) AS l FROM (SELECT cited, court_id, sum(n) n FROM bcd GROUP BY ALL) GROUP BY cited),
 bd AS (SELECT cited, list([CAST(decade AS VARCHAR), CAST(n AS VARCHAR)] ORDER BY decade NULLS LAST) AS l FROM (SELECT cited, decade, sum(n) n FROM bcd GROUP BY ALL) GROUP BY cited),
 bcdl AS (SELECT cited, list([court_id, CAST(decade AS VARCHAR), CAST(n AS VARCHAR)] ORDER BY court_id, decade NULLS LAST) AS l FROM bcd GROUP BY cited),
 ct AS (SELECT t.cited, list(struct_pack(cluster_id := t.citing, name := k.case_name, court_id := t.court_id, date := CAST(t.date_filed AS VARCHAR),
                 citation := fc.cite, citation_count := t.citation_count, depth := t.depth, opinions := t.opinions,
                 held := CASE WHEN h.cluster_id IS NULL THEN 0 ELSE 1 END) ORDER BY t.rnk) AS l
        FROM topc t JOIN cluster.cluster k ON k.id = t.citing LEFT JOIN firstcite fc ON fc.cluster_id = t.citing
        LEFT JOIN cases h ON h.cluster_id = t.citing GROUP BY t.cited),
 pr AS (SELECT p.described_cluster_id AS cited, max(p.total) AS total,
               list(struct_pack(text := p.text, score := p.score, cluster_id := p.describing_cluster_id, opinion_id := p.describing_opinion_id,
                    name := k.case_name, court_id := f.court_id, date := CAST(f.date_filed AS VARCHAR), citation := fc.cite,
                    held := CASE WHEN h.cluster_id IS NULL THEN 0 ELSE 1 END) ORDER BY p.rnk) AS l
        FROM read_parquet('{PAREN}') p JOIN pc ON pc.cluster_id = p.described_cluster_id
        JOIN cluster.cluster k ON k.id = p.describing_cluster_id JOIN cfacts f ON f.cluster_id = p.describing_cluster_id
        LEFT JOIN firstcite fc ON fc.cluster_id = p.describing_cluster_id LEFT JOIN cases h ON h.cluster_id = p.describing_cluster_id
        WHERE p.described_cluster_id % {P} = {p}
        GROUP BY p.described_cluster_id)
SELECT pc.cluster_id, coalesce(cnt.cited_by, 0), coalesce(cnt.cited_by_cases, 0), bc.l, bd.l, bcdl.l, ct.l, coalesce(pr.total, 0), pr.l
FROM pc LEFT JOIN cnt ON cnt.cited = pc.cluster_id LEFT JOIN bc ON bc.cited = pc.cluster_id LEFT JOIN bd ON bd.cited = pc.cluster_id
LEFT JOIN bcdl ON bcdl.cited = pc.cluster_id LEFT JOIN ct ON ct.cited = pc.cluster_id LEFT JOIN pr ON pr.cited = pc.cluster_id
ORDER BY pc.cluster_id
"""

AUTH_SQL = """
WITH
 pc AS (SELECT cluster_id FROM cases WHERE cluster_id % {P} = {p}),
 -- a case that has a combined text (010combined) besides separate opinions holds the same text twice: its links are
 -- counted from the separate opinions or from the combined text, whichever has more, never added together
 dual AS (SELECT s.cluster_id FROM sel s JOIN pc ON pc.cluster_id = s.cluster_id GROUP BY s.cluster_id
          HAVING count(*) FILTER (WHERE s.type = '010combined') > 0 AND count(*) FILTER (WHERE s.type <> '010combined') > 0),
 a0 AS (
  SELECT a.*, CASE WHEN o.type = '010combined' AND d.cluster_id IS NOT NULL THEN 'combined' ELSE 'separate' END AS grp
  FROM read_parquet('{ANCHORS}') a JOIN pc ON pc.cluster_id = a.citing_cluster_id
  LEFT JOIN sel o ON o.opinion_id = a.citing_opinion_id LEFT JOIN dual d ON d.cluster_id = a.citing_cluster_id
  LEFT JOIN cfacts f ON f.cluster_id = a.cited_cluster_id
  WHERE a.citing_cluster_id % {P} = {p} AND (a.cited_cluster_id IS NULL OR a.cited_cluster_id <> a.citing_cluster_id)
    AND NOT coalesce(f.blocked, false)),
 auth AS (
  SELECT citing_cluster_id AS cluster_id, cited_cluster_id,
         greatest(coalesce(sum(anchors) FILTER (WHERE grp = 'separate'), 0), coalesce(sum(anchors) FILTER (WHERE grp = 'combined'), 0)) AS anchors,
         arg_min(first_text, citing_opinion_id) AS first_text, min(cited_opinion_id) AS cited_opinion_id
  FROM a0
  GROUP BY citing_cluster_id, cited_cluster_id, CASE WHEN cited_cluster_id IS NULL THEN cited_opinion_id END)
SELECT a.cluster_id, count(*) AS n,
       list(struct_pack(cluster_id := a.cited_cluster_id, opinion_id := a.cited_opinion_id, name := k.case_name, court_id := f.court_id,
            date := CAST(f.date_filed AS VARCHAR), citation := fc.cite, anchors := a.anchors, first_text := a.first_text,
            held := CASE WHEN h.cluster_id IS NULL THEN 0 ELSE 1 END)
            ORDER BY f.date_filed NULLS LAST, a.cited_cluster_id NULLS LAST, a.cited_opinion_id) AS l
FROM auth a LEFT JOIN cluster.cluster k ON k.id = a.cited_cluster_id LEFT JOIN cfacts f ON f.cluster_id = a.cited_cluster_id
LEFT JOIN firstcite fc ON fc.cluster_id = a.cited_cluster_id LEFT JOIN cases h ON h.cluster_id = a.cited_cluster_id
GROUP BY a.cluster_id
ORDER BY a.cluster_id
"""


def _int(v):
    return None if v is None else int(v)


SOURCES = {"citation_map": "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/citation-map-2026-09-30.csv.bz2",
           "parentheticals": "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/parentheticals-2026-09-30.csv.bz2",
           "clusters": "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinion-clusters-2026-09-30.csv.bz2"}


def citator_record(row, court_names: dict) -> dict | None:
    """One OUTPUT_SQL row -> the cited-by JSON for one case (None when nothing cites or describes it)."""
    (cid, cited_by, cited_by_cases, by_court, by_decade, by_cd, citing, paren_total, parens) = row
    if not cited_by and not paren_total:
        return None
    courts = set()
    by_court = [[c, int(n)] for c, n in (by_court or [])]
    by_decade = [[None if d is None else int(d), int(n)] for d, n in (by_decade or [])]
    by_cd = [[c, None if d is None else int(d), int(n)] for c, d, n in (by_cd or [])]
    courts.update(c for c, _ in by_court)
    citing_out = []
    for c in citing or []:
        citing_out.append({"cluster_id": c["cluster_id"], "name": c["name"], "court_id": c["court_id"], "date": c["date"],
                           "citation": c["citation"], "citation_count": c["citation_count"], "depth": _int(c["depth"]),
                           "opinions": _int(c["opinions"]), "held": c["held"]})
        courts.add(c["court_id"])
    paren_out = []
    for p in parens or []:
        paren_out.append({"text": p["text"], "score": None if p["score"] is None else round(float(p["score"]), 4),
                          "cluster_id": p["cluster_id"], "opinion_id": p["opinion_id"], "name": p["name"], "court_id": p["court_id"],
                          "date": p["date"], "citation": p["citation"], "held": p["held"]})
        courts.add(p["court_id"])
    courts.discard(None)
    return {
        "format": CITATOR_FORMAT, "cluster_id": cid, "snapshot": SNAPSHOT,
        "cited_by": {"opinions": int(cited_by), "cases": int(cited_by_cases)},
        "by_court": by_court, "by_decade": by_decade, "by_court_decade": by_cd,
        "citing": citing_out, "citing_rank": "citing case's CourtListener citation count, then times it cites this case, then newest",
        "parentheticals": paren_out, "parentheticals_total": int(paren_total),
        "courts": {c: court_names.get(c) for c in sorted(courts)},
        "sources": SOURCES,
    }


def authorities_record(row, court_names: dict) -> dict | None:
    """One AUTH_SQL row -> the cited-authorities JSON for one case."""
    cid, n, auths = row
    if not n:
        return None
    out, courts = [], set()
    for a in auths or []:
        out.append({"cluster_id": a["cluster_id"], "opinion_id": a["opinion_id"], "name": a["name"], "court_id": a["court_id"],
                    "date": a["date"], "citation": a["citation"], "anchors": _int(a["anchors"]), "first_text": a["first_text"],
                    "held": a["held"]})
        courts.add(a["court_id"])
    courts.discard(None)
    return {"format": AUTHORITIES_FORMAT, "cluster_id": cid, "snapshot": SNAPSHOT, "authorities": out,
            "courts": {c: court_names.get(c) for c in sorted(courts)},
            "source": "citation links CourtListener placed in this case's opinions (html_with_citations, opinions bulk 2026-09-30)"}


# 2: citation order U.S. > S. Ct. > L. Ed., LEXIS/WL last; combined texts not double-counted in authorities
BUILDER_VERSION = "caselaw-citator-builder/2"


def prep_inputs(kind: str, prep: dict) -> dict:
    """What a partition depends on besides the local CourtListener tables (which are a fixed snapshot): cited-by members
    on the parentheticals only, cited authorities on the reading store's anchors (their exact bytes)."""
    if kind == "citedby":
        return {"parentheticals_file": bool(prep.get("parentheticals_file"))}
    return {"anchors": prep.get("anchors"), "anchor_files": prep.get("anchor_files"), "anchors_sha256": prep.get("anchors_sha256"),
            "parentheticals_file": bool(prep.get("parentheticals_file"))}


def inputs_match(kind: str, prev_inputs: dict | None, prep: dict) -> bool:
    want = prep_inputs(kind, prep)
    prev_inputs = prev_inputs or {}
    return all(prev_inputs.get(k) == v for k, v in want.items())


KINDS = {
    "citedby": {"letter": "c", "format": CITATOR_FORMAT, "partitions": 64,
                "columns": ["cluster_id", "key", "offset", "length", "cited_by", "cited_by_cases", "parentheticals", "member_sha256"]},
    "authorities": {"letter": "a", "format": AUTHORITIES_FORMAT, "partitions": 16,
                    "columns": ["cluster_id", "key", "offset", "length", "authorities", "member_sha256"]},
}


def partition_rows(con, kind: str, p: int, P: int):
    if kind == "citedby":
        paren = PAREN if os.path.exists(PAREN) else EMPTY_PAREN
        con.execute(PARTITION_SQL.format(P=P, p=p, TOP=CITING_TOP))
        return con.execute(OUTPUT_SQL.format(P=P, p=p, PAREN=paren))
    return con.execute(AUTH_SQL.format(P=P, p=p, ANCHORS=ANCHORS_PARQUET))


def build_partition(con, kind: str, p: int, P: int, st, court_names: dict, upload: bool = True) -> dict:
    t0 = time.time()
    spec = KINDS[kind]
    cur = partition_rows(con, kind, p, P)
    members = []
    stats = collections.Counter()
    meta = {}
    while True:
        rows = cur.fetchmany(5000)
        if not rows:
            break
        for row in rows:
            stats["cases"] += 1
            rec = citator_record(row, court_names) if kind == "citedby" else authorities_record(row, court_names)
            if rec is None:
                stats["empty"] += 1
                continue
            body = json.dumps(rec, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            m = rs.gzip_member(body)
            members.append(((rec["cluster_id"],), rec["cluster_id"], m))
            if kind == "citedby":
                meta[rec["cluster_id"]] = [rec["cited_by"]["opinions"], rec["cited_by"]["cases"], rec["parentheticals_total"]]
                stats["with_citing"] += 1 if rec["cited_by"]["opinions"] else 0
                stats["citing_listed"] += len(rec["citing"])
                stats["parentheticals_listed"] += len(rec["parentheticals"])
            else:
                meta[rec["cluster_id"]] = [len(rec["authorities"])]
                stats["authorities_listed"] += len(rec["authorities"])
            meta[rec["cluster_id"]].append(hashlib.sha256(m).hexdigest())
            stats["json_bytes"] += len(body)
    objects = rs.pack(members, OBJECT_TARGET)
    receipts, index_rows = [], []
    os.makedirs(rs.TMP, exist_ok=True)
    for seq, obj in enumerate(objects):
        blob = b"".join(m[2] for m in obj)
        sha = hashlib.sha256(blob).hexdigest()
        key = f"{PREFIX}/{spec['letter']}{p:02d}-{seq:04d}-{sha[:12]}.jsonl.gz"
        off = 0
        for _order, cid, m in obj:
            index_rows.append([cid, key, off, len(m), *meta[cid]])
            off += len(m)
        rec = {"key": key, "kind": kind, "partition": p, "seq": seq, "bytes": len(blob), "sha256": sha, "cases": len(obj), "format": spec["format"]}
        if upload:
            receipt = rs.put_blob(st, key, blob, sha)
            rec.update({"state": receipt["state"], "readback_ok": receipt["readback_ok"], "verified_at": receipt["verified_at"]})
        receipts.append(rec)
        stats["objects"] += 1
        stats["bytes"] += len(blob)
    rs.write_tsv_gz(os.path.join(OUT, "index", f"{spec['letter']}{p:02d}.tsv.gz"), spec["columns"], index_rows)
    return {"kind": kind, "partition": p, "partitions": P, "objects": receipts, "counts": dict(stats), "seconds": round(time.time() - t0, 1),
            "format": spec["format"], "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def run(kind: str, P: int | None, only: list[int] | None, upload: bool) -> int:
    import store

    os.makedirs(OUT, exist_ok=True)
    P = P or KINDS[kind]["partitions"]
    # index files of an earlier run with more partitions would be read together with these: refuse to mix
    stale = [f for f in glob.glob(os.path.join(OUT, "index", f"{KINDS[kind]['letter']}*.tsv.gz")) if int(os.path.basename(f)[1:3]) >= P]
    if stale:
        raise SystemExit(f"index files from a run with more partitions exist: {stale[:3]}")
    con = connect()
    prep = prepare(con)
    print(f"[citator] prepared {prep}", flush=True)
    court_names = dict(con.execute("SELECT court_id, name FROM courts").fetchall())
    st = store.Storage() if upload else None
    state_path = os.path.join(OUT, "partitions.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    for p in range(P):
        if only and p not in only:
            continue
        prev = state.get(f"{kind}:{p}")
        if (upload and prev and prev.get("partitions") == P and prev.get("builder") == BUILDER_VERSION and inputs_match(kind, prev.get("inputs"), prep)
                and all(o.get("readback_ok") for o in prev["objects"])
                and os.path.exists(os.path.join(OUT, "index", f"{KINDS[kind]['letter']}{p:02d}.tsv.gz"))):
            continue  # already built from the same inputs by this builder version
        res = build_partition(con, kind, p, P, st, court_names, upload)
        res["builder"] = BUILDER_VERSION
        res["inputs"] = prep_inputs(kind, prep)
        res["prepared"] = prep
        state[f"{kind}:{p}"] = res
        with open(state_path + ".tmp", "w") as h:
            json.dump(state, h, indent=1, sort_keys=True)
        os.replace(state_path + ".tmp", state_path)
        if upload:
            with open(os.path.join(OUT, "objects.jsonl"), "a") as h:
                for o in res["objects"]:
                    h.write(json.dumps(o, sort_keys=True) + "\n")
        c = res["counts"]
        print(f"[citator] {kind} partition {p}/{P}: {c.get('cases', 0):,} cases, {c.get('cases', 0) - c.get('empty', 0):,} members, "
              f"{c.get('bytes', 0) / 1e6:.1f} MB, {res['seconds']}s, free {shutil.disk_usage(OUT).free / 1e9:.1f} GB", flush=True)
    shutil.rmtree(os.path.join(OUT, "duck_tmp"), ignore_errors=True)
    return 0


def status() -> int:
    p = os.path.join(OUT, "partitions.json")
    state = json.load(open(p)) if os.path.exists(p) else {}
    tot = collections.defaultdict(collections.Counter)
    for v in state.values():
        tot[v.get("kind", "citedby")].update(v["counts"])
    print(json.dumps({"partitions": len(state), "totals": {k: dict(v) for k, v in tot.items()}}, indent=1))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--kind", choices=sorted(KINDS), default="citedby")
    r.add_argument("--partitions", type=int, default=0)
    r.add_argument("--only", default="")
    r.add_argument("--no-upload", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "run":
        return run(a.kind, a.partitions or None, [int(x) for x in a.only.split(",") if x], not a.no_upload)
    return status()


if __name__ == "__main__":
    sys.exit(main())
