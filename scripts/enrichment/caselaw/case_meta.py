"""Case-law stage 2d: one metadata row per case (cluster) of the three tiers, ready for caselaw.cases.

    cd scripts/enrichment/caselaw
    python3 -I -B case_meta.py            # -> private/build/caselaw_read/meta/cases-pNN.jsonl.gz, courts.json, meta.json

Inputs (local, read only): the stage-1 selection (unblocked clusters of tiers t1-t3 and their unblocked opinions), the
CourtListener 2026-09-30 tables (cluster, docket, citation, courts, panel, people), the reading-store index
(read_store.py: per opinion object key, byte offset, length, author_str, per_curiam), the citator index (citator.py:
pointer and counts) and, when present, names.parquet (names.py: case_name_full from the clusters bulk file).

Row fields (all as CourtListener publishes them; nothing inferred):
  cluster_id, tier (1 scotus, 2 federal appellate, 3 state highest), court_id, date_filed, date_approx,
  case_name, case_name_full (only when it differs from case_name), docket_number, precedential_status,
  citation_count (CourtListener's), citations (every parallel citation "volume reporter page", ordered by
  CourtListener type: neutral, federal, state, early SCOTUS, regional, specialty, West, Lexis, journal; within a type
  U.S. before S. Ct. before L. Ed., LEXIS/WL last), judges (cluster.judges text), panel (names
  of the panel members CourtListener links, "first middle last suffix"), disposition, scdb ({"id", "decision_direction",
  "votes_majority", "votes_minority"} as CourtListener provides them, only when an SCDB id is present),
  opinions [{"id", "type", "author", "per_curiam", "key", "s", "n"}] (key/s/n only when the text is in the reading
  store; ordered by CourtListener type code, then id), citator [key, offset, length] (cited-by member),
  authorities_ref [key, offset, length] (cited-authorities member) and the counts cited_by, cited_by_cases,
  parentheticals, authorities.
"""
from __future__ import annotations

import collections
import glob
import gzip
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import citator as ct  # noqa: E402
import read_store as rs  # noqa: E402

OUT = os.path.join(ROOT, "private", "build", "caselaw_read", "meta")
NAMES = os.path.join(ROOT, "private", "build", "caselaw_read", "meta", "names.parquet")
READ_INDEX = os.path.join(ROOT, "private", "build", "caselaw_read", "read", "index", "*.tsv.gz")
CITEDBY_INDEX = os.path.join(ROOT, "private", "build", "caselaw_read", "citator", "index", "c*.tsv.gz")
AUTH_INDEX = os.path.join(ROOT, "private", "build", "caselaw_read", "citator", "index", "a*.tsv.gz")
PARTS = 16
TIER = {"t1": 1, "t2": 2, "t3": 3}


def _tsv(files: list[str], columns: dict) -> str:
    cols = "{" + ", ".join(f"'{k}': '{v}'" for k, v in columns.items()) + "}"
    return f"read_csv({json.dumps(files)}, delim='\t', header=true, quote='', escape='', nullstr='', auto_detect=false, columns={cols})"


def clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def case_row(r: dict, opinions: list[dict]) -> dict:
    """Assemble one row from the joined record r (see SQL below) and its opinions."""
    full = clean(r.get("case_name_full"))
    # CourtListener leaves case_name empty on some clusters; its full name is then the only name it publishes
    name = clean(r["case_name"]) or full or "Not recorded"
    scdb = None
    if clean(r.get("scdb_id")):
        scdb = {"id": clean(r["scdb_id"]), "decision_direction": r.get("scdb_decision_direction"),
                "votes_majority": r.get("scdb_votes_majority"), "votes_minority": r.get("scdb_votes_minority")}
    citator = None
    if r.get("citator_key"):
        citator = [r["citator_key"], int(r["citator_offset"]), int(r["citator_length"])]
    authorities_ref = None
    if r.get("auth_key"):
        authorities_ref = [r["auth_key"], int(r["auth_offset"]), int(r["auth_length"])]
    return {
        "cluster_id": int(r["cluster_id"]), "tier": TIER[r["tier"]], "court_id": r["court_id"],
        "date_filed": r["date_filed"], "date_approx": bool(r.get("date_approx")),
        "case_name": name, "case_name_full": full if full and full != name else None,
        "docket_number": clean(r.get("docket_number")), "precedential_status": clean(r.get("precedential_status")),
        "citation_count": r.get("citation_count"), "citations": list(r.get("citations") or []),
        "judges": clean(r.get("judges")), "panel": list(r["panel"]) if r.get("panel") else None,
        "disposition": clean(r.get("disposition")), "scdb": scdb, "opinions": opinions, "citator": citator, "authorities_ref": authorities_ref,
        "cited_by": int(r.get("cited_by") or 0), "cited_by_cases": int(r.get("cited_by_cases") or 0),
        "parentheticals": int(r.get("parentheticals") or 0), "authorities": int(r.get("authorities") or 0),
    }


def opinion_entry(o: dict) -> dict:
    e = {"id": int(o["opinion_id"]), "type": o["type"], "author": clean(o.get("author_str")),
         "per_curiam": bool(o.get("per_curiam")) if o.get("per_curiam") is not None else None}
    if o.get("key"):
        e.update({"key": o["key"], "s": int(o["offset"]), "n": int(o["length"])})
    return e


PREP_SQL = """
CREATE TEMP TABLE sel AS SELECT opinion_id, cluster_id, tier, type FROM read_parquet('{selection}') WHERE NOT blocked;
"""

PART_SQL = """
CREATE OR REPLACE TEMP TABLE clp AS SELECT cluster_id, any_value(tier) AS tier FROM sel WHERE cluster_id % {P} = {p} GROUP BY cluster_id;
CREATE OR REPLACE TEMP TABLE cites AS
  SELECT c.cluster_id, list(c.volume || ' ' || c.reporter || ' ' || c.page ORDER BY {cite_order}, c.reporter, c.page) AS citations
  FROM citation.citation c JOIN clp ON clp.cluster_id = c.cluster_id GROUP BY c.cluster_id;
CREATE OR REPLACE TEMP TABLE pnames AS
  SELECT TRY_CAST(p.opinioncluster_id AS BIGINT) AS cluster_id,
         list(concat_ws(' ', nullif(trim(pe.name_first), ''), nullif(trim(pe.name_middle), ''), nullif(trim(pe.name_last), ''),
                        nullif(trim(pe.name_suffix), '')) ORDER BY pe.name_last, pe.name_first, pe.id) AS panel
  FROM small.cluster_panel p JOIN small.person pe ON pe.id = p.person_id
  JOIN clp ON clp.cluster_id = TRY_CAST(p.opinioncluster_id AS BIGINT) GROUP BY 1;
CREATE OR REPLACE TEMP TABLE opl AS
  SELECT s.cluster_id, list(struct_pack(opinion_id := s.opinion_id, type := s.type, author_str := r.author_str, per_curiam := r.per_curiam,
                                        key := r.key, "offset" := r."offset", length := r.length) ORDER BY s.opinion_id) AS ops
  FROM sel s JOIN clp ON clp.cluster_id = s.cluster_id
  LEFT JOIN (SELECT * FROM read_parquet('{ridx}') WHERE cluster_id % {P} = {p}) r ON r.opinion_id = s.opinion_id
  GROUP BY s.cluster_id;
"""

MAIN_SQL = """
SELECT clp.cluster_id, clp.tier, d.court_id, CAST(k.date_filed AS VARCHAR) AS date_filed, k.date_filed_is_approximate AS date_approx,
       k.case_name, n.case_name_full, d.docket_number, k.precedential_status, k.citation_count, ci.citations,
       k.judges, pn.panel, k.disposition, k.scdb_id, k.scdb_decision_direction, k.scdb_votes_majority, k.scdb_votes_minority,
       x.key AS citator_key, x."offset" AS citator_offset, x.length AS citator_length, x.cited_by, x.cited_by_cases,
       x.parentheticals, ax.key AS auth_key, ax."offset" AS auth_offset, ax.length AS auth_length, ax.authorities,
       opl.ops
FROM clp JOIN cluster.cluster k ON k.id = clp.cluster_id JOIN docket.docket d ON d.id = k.docket_id
LEFT JOIN opl ON opl.cluster_id = clp.cluster_id
LEFT JOIN cites ci ON ci.cluster_id = clp.cluster_id LEFT JOIN pnames pn ON pn.cluster_id = clp.cluster_id
LEFT JOIN (SELECT * FROM read_parquet('{names}') WHERE cluster_id % {P} = {p}) n ON n.cluster_id = clp.cluster_id
LEFT JOIN (SELECT * FROM read_parquet('{cidx}') WHERE cluster_id % {P} = {p}) x ON x.cluster_id = clp.cluster_id
LEFT JOIN (SELECT * FROM read_parquet('{aidx}') WHERE cluster_id % {P} = {p}) ax ON ax.cluster_id = clp.cluster_id
ORDER BY clp.cluster_id
"""

INDEX_SPECS = {
    "ridx": (READ_INDEX, {"opinion_id": "BIGINT", "cluster_id": "BIGINT", "key": "VARCHAR", "offset": "BIGINT", "length": "BIGINT",
                          "text_sha256": "VARCHAR", "text_chars": "BIGINT", "type": "VARCHAR", "author_str": "VARCHAR", "per_curiam": "INTEGER",
                          "stage1_key": "VARCHAR", "stage1_sha256": "VARCHAR", "member_sha256": "VARCHAR"},
             "opinion_id, cluster_id, key, \"offset\", length, author_str, per_curiam"),
    "cidx": (CITEDBY_INDEX, {"cluster_id": "BIGINT", "key": "VARCHAR", "offset": "BIGINT", "length": "BIGINT", "cited_by": "INTEGER",
                             "cited_by_cases": "INTEGER", "parentheticals": "INTEGER", "member_sha256": "VARCHAR"},
             "cluster_id, key, \"offset\", length, cited_by, cited_by_cases, parentheticals"),
    "aidx": (AUTH_INDEX, {"cluster_id": "BIGINT", "key": "VARCHAR", "offset": "BIGINT", "length": "BIGINT", "authorities": "INTEGER",
                          "member_sha256": "VARCHAR"},
             "cluster_id, key, \"offset\", length, authorities"),
}
EMPTY = {
    "ridx": "SELECT NULL::BIGINT AS opinion_id, NULL::BIGINT AS cluster_id, NULL::VARCHAR AS key, NULL::BIGINT AS \"offset\", NULL::BIGINT AS length, "
            "NULL::VARCHAR AS author_str, NULL::INTEGER AS per_curiam WHERE false",
    "cidx": "SELECT NULL::BIGINT AS cluster_id, NULL::VARCHAR AS key, NULL::BIGINT AS \"offset\", NULL::BIGINT AS length, NULL::INTEGER AS cited_by, "
            "NULL::INTEGER AS cited_by_cases, NULL::INTEGER AS parentheticals WHERE false",
    "aidx": "SELECT NULL::BIGINT AS cluster_id, NULL::VARCHAR AS key, NULL::BIGINT AS \"offset\", NULL::BIGINT AS length, NULL::INTEGER AS authorities WHERE false",
    "names": "SELECT NULL::BIGINT AS cluster_id, NULL::VARCHAR AS case_name_full WHERE false",
}


def index_parquets(con) -> dict:
    """Copy the TSV indexes into parquet files (read per partition) and check them; returns {name: (path, files)}."""
    out = {}
    tmp = os.path.join(OUT, "_work")
    os.makedirs(tmp, exist_ok=True)
    for name, (pattern, cols, keep) in INDEX_SPECS.items():
        files = sorted(glob.glob(pattern))
        path = os.path.join(tmp, f"{name}.parquet")
        src = f"SELECT {keep} FROM {_tsv(files, cols)}" if files else EMPTY[name]
        con.execute(f"COPY ({src}) TO '{path}' (FORMAT parquet, COMPRESSION zstd)")
        out[name] = (path, len(files))
    names = os.path.join(tmp, "names.parquet")
    con.execute(f"COPY ({f'SELECT cluster_id, case_name_full FROM read_parquet({NAMES!r})' if os.path.exists(NAMES) else EMPTY['names']}) "
                f"TO '{names}' (FORMAT parquet)")
    out["names"] = (names, 1 if os.path.exists(NAMES) else 0)
    ridx = out["ridx"][0]
    dup = con.execute(f"SELECT count(*) - count(DISTINCT opinion_id) FROM read_parquet('{ridx}')").fetchone()[0]
    if dup:
        raise SystemExit(f"{dup} opinions occur twice in the reading-store index")
    stray = con.execute(f"SELECT count(*) FROM read_parquet('{ridx}') WHERE opinion_id NOT IN (SELECT opinion_id FROM sel)").fetchone()[0]
    if stray:
        raise SystemExit(f"{stray} reading-store opinions are not unblocked selected opinions")
    for name in ("cidx", "aidx"):
        d = con.execute(f"SELECT count(*) - count(DISTINCT cluster_id) FROM read_parquet('{out[name][0]}')").fetchone()[0]
        if d:
            raise SystemExit(f"{d} cases occur twice in the {name} index")
    return out


def build() -> dict:
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    con = ct.connect(memory="3GB", threads=2)
    con.execute(PREP_SQL.format(selection=rs.SELECTION))
    idx = index_parquets(con)
    stats = collections.Counter()
    courts = collections.Counter()
    for p in range(PARTS):
        con.execute(PART_SQL.format(P=PARTS, p=p, cite_order=ct.cite_order_sql("c"), ridx=idx["ridx"][0]))
        cur = con.execute(MAIN_SQL.format(P=PARTS, p=p, names=idx["names"][0], cidx=idx["cidx"][0], aidx=idx["aidx"][0]))
        cols = [d[0] for d in cur.description]
        path = os.path.join(OUT, f"cases-p{p:02d}.jsonl.gz")
        with gzip.open(path + ".tmp", "wt", encoding="utf-8", compresslevel=6) as h:
            while True:
                rows = cur.fetchmany(20000)
                if not rows:
                    break
                for row in rows:
                    r = dict(zip(cols, row))
                    ops = sorted(r.pop("ops") or [], key=lambda o: (rs.type_rank(o["type"]), o["opinion_id"]))
                    opinions = [opinion_entry(o) for o in ops]
                    rec = case_row(r, opinions)
                    h.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
                    stats["cases"] += 1
                    stats[f"tier{rec['tier']}"] += 1
                    stats["opinions"] += len(opinions)
                    stats["opinions_with_text"] += sum(1 for o in opinions if "key" in o)
                    stats["cases_with_text"] += 1 if any("key" in o for o in opinions) else 0
                    stats["cases_with_citator"] += 1 if rec["citator"] else 0
                    stats["cases_with_authorities"] += 1 if rec["authorities_ref"] else 0
                    stats["with_full_name"] += 1 if rec["case_name_full"] else 0
                    stats["with_scdb"] += 1 if rec["scdb"] else 0
                    stats["with_panel"] += 1 if rec["panel"] else 0
                    stats["no_citations"] += 0 if rec["citations"] else 1
                    stats["no_name"] += 1 if rec["case_name"] == "Not recorded" else 0
                    courts[(rec["tier"], rec["court_id"])] += 1
        os.replace(path + ".tmp", path)
        print(f"[meta] partition {p}: {stats['cases']:,} cases so far ({time.time() - t0:.0f}s)", flush=True)
    court_rows = con.execute("SELECT id, full_name, short_name, citation_string FROM small.courts").fetchall()
    info = {r[0]: r for r in court_rows}
    out_courts = [{"court_id": c, "tier": t, "full_name": info[c][1], "short_name": clean(info[c][2]), "citation_string": clean(info[c][3]), "cases": n}
                  for (t, c), n in sorted(courts.items())]
    with open(os.path.join(OUT, "courts.json"), "w") as h:
        json.dump(out_courts, h, indent=1)
    meta = {"stats": dict(stats), "courts": len(out_courts), "index_files": {k: v[1] for k, v in idx.items()},
            "seconds": round(time.time() - t0, 1), "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(os.path.join(OUT, "meta.json"), "w") as h:
        json.dump(meta, h, indent=1)
    print(json.dumps(meta, indent=1))
    return meta


if __name__ == "__main__":
    build()
