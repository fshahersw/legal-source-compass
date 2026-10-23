"""Offline tests for case-law stage 2 (reading store, parentheticals, citator, case metadata, loader).

    cd scripts/enrichment/caselaw && python3 -B -m unittest -v test_caselaw_read

Synthetic fixtures only: no network, no credentials. The citator and parenthetical SQL run on tiny in-memory DuckDB
catalogs named like the real attached databases.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import case_meta  # noqa: E402
import citator as ct  # noqa: E402
import load_caselaw  # noqa: E402
import parentheticals as pa  # noqa: E402
import read_store as rs  # noqa: E402

try:
    import duckdb  # noqa: F401

    HAVE_DUCKDB = True
except ImportError:
    HAVE_DUCKDB = False

VERSION = "caselaw-extract/2+html_text/1"


def stage1(oid, cid, text="Held: the statement is inadmissible. See 1 U.S. 1.", **kw):
    rec = {
        "opinion_id": oid, "cluster_id": cid, "docket_id": 9, "court_id": "scotus", "tier": "t1", "date_filed": "1966-06-13",
        "precedential_status": "Published", "blocked": False, "cluster_blocked": False, "docket_blocked": False,
        "type": "020lead", "author_id": None, "author_str": "Warren", "per_curiam": False, "joined_by_str": "",
        "page_count": None, "extracted_by_ocr": False, "download_url": None, "text": text,
        "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "text_chars": len(text),
        "citations": [], "pages_source": "chosen_markup", "pages": [], "text_paginated": None,
        "source_url": f"https://www.courtlistener.com/api/rest/v4/opinions/{oid}/", "snapshot": "2026-09-30", "renderer": "html_text/1",
    }
    rec.update(kw)
    return rec


# ==================================================================================================== reading store
class ReadingRecordTests(unittest.TestCase):
    def test_blocked_dropped(self):
        for flag in ("blocked", "cluster_blocked", "docket_blocked"):
            self.assertIsNone(rs.reading_record(stage1(1, 2, **{flag: True}), frozenset(), "k", "s"))

    def test_text_hash_checked(self):
        rec = stage1(1, 2)
        rec["text_sha256"] = "0" * 64
        with self.assertRaises(rs.ReadStoreError):
            rs.reading_record(rec, frozenset(), "k", "s")

    def test_fields_pages_citations_held(self):
        text = "See *437 Escobedo, 378 U.S. 478, and Doe, 1 F.2d 2."
        rec = stage1(5, 7, text=text, pages=[{"page": "437", "citation_index": 1, "offset": 4}],
                     citations=[{"opinion_id": 11, "cluster_id": 100, "start": 18, "end": 29},
                                {"opinion_id": 12, "cluster_id": 200, "start": 40, "end": 48},
                                {"opinion_id": 13, "cluster_id": None, "start": 0, "end": 3}])
        rr = rs.reading_record(rec, frozenset({100}), "caselaw/courtlistener/x.jsonl.gz", "abc")
        self.assertEqual(rr["format"], rs.READ_FORMAT)
        self.assertEqual(rr["pages"], [["437", 1, 4]])
        self.assertEqual(rr["citations"], [[18, 29, 100, 11, 1], [40, 48, 200, 12, 0], [0, 3, None, 13, 0]])
        blocked = rs.reading_record(rec, frozenset({100}), "k", "s", blocked=frozenset({200}))
        self.assertEqual(blocked["citations"][1], [40, 48, 200, 12, 2])
        self.assertEqual(rr["stage1"], {"key": "caselaw/courtlistener/x.jsonl.gz", "sha256": "abc"})
        self.assertNotIn("raw", rr)
        self.assertEqual(rr["author_str"], "Warren")
        self.assertIsNone(rr["joined_by_str"])  # empty string -> null

    def test_anchor_rows_aggregate_per_cited_cluster(self):
        text = "A v. B, 1 U.S. 1; again 1 U.S. 1; C, 2 F. 3."
        rr = rs.reading_record(stage1(5, 7, text=text, citations=[
            {"opinion_id": 11, "cluster_id": 100, "start": 8, "end": 16},
            {"opinion_id": 11, "cluster_id": 100, "start": 24, "end": 32},
            {"opinion_id": 12, "cluster_id": None, "start": 37, "end": 43}]), frozenset(), "k", "s")
        rows = rs.anchor_rows(rr)
        self.assertEqual(rows, [[5, 7, 100, 11, 2, "1 U.S. 1"], [5, 7, None, 12, 1, "2 F. 3"]])


class GzipAndPackTests(unittest.TestCase):
    def test_member_deterministic_and_concatenation(self):
        a, b = rs.gzip_member(b'{"a":1}'), rs.gzip_member(b'{"b":2}')
        self.assertEqual(a, rs.gzip_member(b'{"a":1}'))
        self.assertEqual(gzip.decompress(a + b), b'{"a":1}{"b":2}')
        members = list(rs.iter_gzip_members(a + b))
        self.assertEqual([(o, n) for o, n, _ in members], [(0, len(a)), (len(a), len(b))])
        self.assertEqual(zlib.decompress((a + b)[len(a):], 31), b'{"b":2}')

    def test_iter_jsonl_keeps_unicode_line_separators(self):
        recs = [{"t": "one two\x85three "}, {"t": "x"}]
        blob = gzip.compress("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs).encode("utf-8"))
        self.assertEqual(list(rs.iter_jsonl(blob)), recs)

    def test_pack_never_splits_a_cluster(self):
        members = [((c, 0, i), c, b"x" * 10) for i, c in enumerate([1, 1, 1, 2, 3, 3])]
        objs = rs.pack(members, target=15)
        self.assertEqual([[m[1] for m in o] for o in objs], [[1, 1, 1], [2, 3, 3]])
        self.assertEqual(sum(len(o) for o in objs), 6)
        self.assertEqual(len(rs.pack(members, target=10_000)), 1)

    def test_member_order_types(self):
        recs = [{"cluster_id": 1, "type": "040dissent", "opinion_id": 3}, {"cluster_id": 1, "type": "020lead", "opinion_id": 9},
                {"cluster_id": 1, "type": "010combined", "opinion_id": 20}, {"cluster_id": 0, "type": "999odd", "opinion_id": 1}]
        self.assertEqual([r["opinion_id"] for r in sorted(recs, key=rs.member_order)], [1, 20, 9, 3])

    def test_object_key_content_addressed(self):
        k = rs.object_key("t2/ca9/2000s", 3, "ab" * 32)
        self.assertEqual(k, "caselaw/read/2026-09-30/t2/ca9/ca9-2000s-0003-abababababab.jsonl.gz")
        self.assertEqual(rs.object_key("t3/me", 0, "cd" * 32), "caselaw/read/2026-09-30/t3/me/me-0000-cdcdcdcdcdcd.jsonl.gz")

    def test_tsv_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.tsv.gz")
            rs.write_tsv_gz(p, ["a", "b"], [[1, "tab\there\nnew\\line"], [2, None]])
            rows = list(rs.read_tsv_gz(p))
        self.assertEqual(rows, [{"a": "1", "b": "tab\there\nnew\\line"}, {"a": "2", "b": ""}])


class PutBlobTests(unittest.TestCase):
    """Upload from memory: never overwrite other bytes, always read back."""

    class Resp:
        def __init__(self, status, text=""):
            self.status_code, self.text = status, text

        def close(self):
            pass

    class FakeStorage:
        def __init__(self, post_status, stored):
            self.posted = []
            self.stored = stored  # bytes held under the key, or None
            self.h = {}
            self.timeout = 5
            outer = self
            post_resp = PutBlobTests.Resp(post_status, "Duplicate" if post_status == 409 else "")

            class S:
                def post(self, url, data, timeout, headers):
                    outer.posted.append((url, headers["x-upsert"]))
                    if post_status in (200, 201):
                        outer.stored = data
                    return post_resp

            self.s = S()

        def _retry(self, fn):
            return fn()

        def _object_url(self, key, authenticated=False):
            return "https://x/" + key

        def readback(self, key):
            if self.stored is None:
                return 404, None, 0
            return 200, hashlib.sha256(self.stored).hexdigest(), len(self.stored)

    def test_upload_then_readback(self):
        blob = b"abc"
        st = self.FakeStorage(200, None)
        r = rs.put_blob(st, "k", blob, hashlib.sha256(blob).hexdigest())
        self.assertEqual((r["state"], r["readback_ok"]), ("uploaded", True))
        self.assertEqual(st.posted, [("https://x/k", "false")])

    def test_existing_identical_object_is_kept(self):
        blob = b"abc"
        r = rs.put_blob(self.FakeStorage(409, blob), "k", blob, hashlib.sha256(blob).hexdigest())
        self.assertEqual(r["state"], "already_present")

    def test_existing_other_bytes_refused(self):
        import store

        blob = b"abc"
        with self.assertRaises(store.ChecksumConflict):
            rs.put_blob(self.FakeStorage(409, b"other"), "k", blob, hashlib.sha256(blob).hexdigest())
        with self.assertRaises(rs.ReadStoreError):
            rs.put_blob(self.FakeStorage(200, None), "k", blob, "0" * 64)


class ManifestTests(unittest.TestCase):
    def write(self, d, units, lines):
        ck = {"input": {"units": 3}, "units": {str(u): {"status": s, "extractor": VERSION} for u, s in units.items()}}
        cp, mp = os.path.join(d, "ck.json"), os.path.join(d, "m.jsonl")
        with open(cp, "w") as h:
            json.dump(ck, h)
        with open(mp, "w") as h:
            for e in lines:
                h.write(json.dumps(e) + "\n")
            h.write('{"path": "partial-line')  # an append in progress
        return cp, mp

    def entry(self, path, unit, sha, extractor=VERSION, **kw):
        e = {"path": path, "unit": unit, "part": 0, "group": "t1/scotus", "sha256": sha, "bytes": 1, "extractor": extractor,
             "readback_ok": True, "partial_unit": False}
        e.update(kw)
        return e

    def test_newest_line_per_key_and_complete_units(self):
        with tempfile.TemporaryDirectory() as d:
            cp, mp = self.write(d, {0: "complete", 1: "partial"}, [
                self.entry("a", 0, "old"), self.entry("a", 0, "new"), self.entry("b", 1, "x"),
                self.entry("c", 0, "y", extractor="caselaw-extract/1+html_text/1")])
            g = rs.current_shards("0", mp, cp, version=VERSION)
            self.assertEqual([(e["path"], e["sha256"]) for e in g["t1/scotus"]], [("a", "new")])
            with self.assertRaises(rs.ReadStoreError):
                rs.current_shards("all", mp, cp, version=VERSION)
            with self.assertRaises(rs.ReadStoreError):
                rs.current_shards("1", mp, cp, version=VERSION)

    def test_refuses_unverified_or_partial(self):
        with tempfile.TemporaryDirectory() as d:
            cp, mp = self.write(d, {0: "complete"}, [self.entry("a", 0, "s", readback_ok=False)])
            with self.assertRaises(rs.ReadStoreError):
                rs.current_shards("0", mp, cp, version=VERSION)
            cp, mp = self.write(d, {0: "complete"}, [self.entry("a", 0, "s", partial_unit=True)])
            with self.assertRaises(rs.ReadStoreError):
                rs.current_shards("0", mp, cp, version=VERSION)


# ==================================================================================================== parentheticals
class ParentheticalTests(unittest.TestCase):
    CSV = ('id,text,score,described_opinion_id,describing_opinion_id,group_id\n'
           '"1","holding that \\"x\\" applies","0.9","10","20","100"\n'
           '"2","other","0.5","11","21",\n'
           '"3","unscored",,"10","22","101"\n')

    def test_parse_rows_filters_and_nulls(self):
        rows = list(pa.parse_rows(io.StringIO(self.CSV), {10}))
        self.assertEqual(rows, [(1, 'holding that "x" applies', 0.9, 10, 20, 100), (3, "unscored", None, 10, 22, 101)])

    def test_header_checked(self):
        with self.assertRaises(ValueError):
            list(pa.parse_rows(io.StringIO("id,text\n"), {1}))

    @unittest.skipUnless(HAVE_DUCKDB, "DuckDB not available")
    def test_rank_group_dedupe_exclusions_top(self):
        import duckdb

        con = duckdb.connect()
        con.execute("CREATE TEMP TABLE praw (id BIGINT, text VARCHAR, score DOUBLE, described_opinion_id BIGINT, describing_opinion_id BIGINT, group_id BIGINT)")
        con.execute("""INSERT INTO praw VALUES
            (1, 'a', 0.9, 10, 20, 100), (2, 'a2', 0.95, 10, 21, 100),   -- same group: keep id 2
            (3, 'b', 0.5, 10, 22, NULL), (4, 'self', 0.99, 10, 23, 102), -- 23 is in the described cluster itself
            (5, 'blocked', 0.8, 10, 24, 103), (6, 'c', 0.7, 10, 25, 104)""")
        con.execute("CREATE TEMP TABLE sel AS SELECT * FROM (VALUES (10, 1000)) t(opinion_id, cluster_id)")
        con.execute("CREATE TEMP TABLE opin AS SELECT * FROM (VALUES (20, 2000), (21, 2001), (22, 2002), (23, 1000), (24, 2004), (25, 2005)) t(id, cluster_id)")
        con.execute("CREATE TEMP TABLE blk AS SELECT * FROM (VALUES (2000, false), (2001, false), (2002, false), (1000, false), (2004, true), (2005, false)) t(cluster_id, blocked)")
        con.execute(pa.RANK_SQL.format(top=2))
        rows = con.execute("SELECT id, rnk, total FROM pr_top ORDER BY rnk").fetchall()
        self.assertEqual(rows, [(2, 1, 3), (6, 2, 3)])


# ==================================================================================================== citator
@unittest.skipUnless(HAVE_DUCKDB, "DuckDB not available")
class CitatorSqlTests(unittest.TestCase):
    """Cases 1000 (two opinions) and 1001 are tier cases; citing clusters 2000-2004 in courts ca1/cal; 2003 is blocked."""

    def setUp(self):
        import duckdb

        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        self.con = con = duckdb.connect()
        for name in ("opinion", "cluster", "docket", "cmap", "citation", "small"):
            con.execute(f"ATTACH ':memory:' AS {name}")
        con.execute("CREATE TABLE opinion.opinion AS SELECT * FROM (VALUES (1,1000),(2,1000),(3,1001),(20,2000),(21,2001),(22,2002),(23,2003),(24,2004),(25,2000)) t(id, cluster_id)")
        con.execute("""CREATE TABLE cluster.cluster AS SELECT * FROM (VALUES
            (1000, 1, DATE '1966-06-13', 'Miranda v. Arizona', 500, false),
            (1001, 2, DATE '1970-01-01', 'Other v. Case', 3, false),
            (2000, 3, DATE '1999-05-01', 'Citing A', 50, false),
            (2001, 4, DATE '2005-01-01', 'Citing B', 50, false),
            (2002, 5, NULL, 'Citing C', 7, false),
            (2003, 6, DATE '2001-01-01', 'Blocked D', 99, true),
            (2004, 7, DATE '2011-01-01', 'Citing E', 1, false)) t(id, docket_id, date_filed, case_name, citation_count, blocked)""")
        con.execute("""CREATE TABLE docket.docket AS SELECT * FROM (VALUES (1,'scotus',false),(2,'scotus',false),(3,'ca1',false),(4,'cal',false),
            (5,'ca1',false),(6,'ca1',false),(7,'cal',true)) t(id, court_id, blocked)""")
        con.execute("""CREATE TABLE cmap.cmap AS SELECT * FROM (VALUES
            (1, 20, 2), (2, 25, 1), (1, 21, 1), (1, 22, 3), (1, 23, 1), (1, 24, 1), (2, 1, 1), (3, 20, 1)) t(cited_opinion_id, citing_opinion_id, depth)""")
        con.execute("""CREATE TABLE citation.citation AS SELECT * FROM (VALUES (1000,'16','L. Ed. 2d','694',1),(1000,'86','S. Ct.','1602',1),
            (1000,'384','U.S.','436',1),(1000,'1966','U.S. LEXIS','2817',6),(2000,'5','F.3d','1',1)) t(cluster_id, volume, reporter, page, type)""")
        con.execute("CREATE TABLE small.courts AS SELECT * FROM (VALUES ('scotus','Supreme Court','SCOTUS'),('ca1','First Circuit','1st Cir.'),('cal','California Supreme Court','')) t(id, full_name, short_name)")
        sel = os.path.join(d, "sel.parquet")
        con.execute(f"""COPY (SELECT * FROM (VALUES (1,1000,false,'020lead'),(2,1000,false,'040dissent'),(4,1000,false,'010combined'),
            (3,1001,false,'010combined'),(9,1002,true,'020lead')) t(opinion_id, cluster_id, blocked, type)) TO '{sel}' (FORMAT parquet)""")
        anchors = os.path.join(d, "a.tsv.gz")
        rs.write_tsv_gz(anchors, rs.ANCHOR_COLUMNS, [[1, 1000, 1001, 3, 2, "1 U.S. 1"], [1, 1000, None, 20, 1, "5 F.3d 1"],
                                                      [2, 1000, 1000, 1, 1, "self"], [2, 1000, 2003, 23, 1, "blocked"],
                                                      [2, 1000, 1001, 3, 1, "again"], [4, 1000, 1001, 3, 2, "combined copy"]])
        self._saved = (ct.PAREN, ct.ANCHORS_PARQUET, ct.EMPTY_PAREN)
        ct.PAREN = os.path.join(d, "none.parquet")
        ct.ANCHORS_PARQUET = os.path.join(d, "anchors.parquet")
        ct.EMPTY_PAREN = os.path.join(d, "paren-empty.parquet")
        self.prep = ct.prepare(con, selection=sel, anchors_glob=anchors)
        names = dict(con.execute("SELECT court_id, name FROM courts").fetchall())
        con.execute(ct.PARTITION_SQL.format(P=1, p=0, TOP=2))
        self.rows = {r[0]: ct.citator_record(r, names) for r in con.execute(ct.OUTPUT_SQL.format(P=1, p=0, PAREN=ct.EMPTY_PAREN)).fetchall()}
        self.auth = {r[0]: ct.authorities_record(r, names) for r in con.execute(ct.AUTH_SQL.format(P=1, p=0, ANCHORS=ct.ANCHORS_PARQUET)).fetchall()}

    def tearDown(self):
        ct.PAREN, ct.ANCHORS_PARQUET, ct.EMPTY_PAREN = self._saved
        self.tmp.cleanup()

    def test_counts_exclude_self_and_blocked(self):
        c = self.rows[1000]
        # citing opinions 20, 25 (cluster 2000), 21 (2001), 22 (2002); 23 blocked cluster, 24 blocked docket, 1-> self cluster
        self.assertEqual(c["cited_by"], {"opinions": 4, "cases": 3})
        self.assertEqual(sorted(c["by_court"]), [["ca1", 3], ["cal", 1]])
        self.assertEqual(c["by_decade"], [[1990, 2], [2000, 1], [None, 1]])

    def test_citing_rank_and_cap(self):
        c = self.rows[1000]
        # TOP=2: 2000 and 2001 both have count 50; 2000 cites it 3 times (2+1) -> first
        self.assertEqual([(x["cluster_id"], x["depth"], x["opinions"]) for x in c["citing"]], [(2000, 3, 2), (2001, 1, 1)])
        self.assertEqual(c["citing"][0]["citation"], "5 F.3d 1")
        self.assertEqual(c["citing"][0]["held"], 0)

    def test_authorities(self):
        c = self.auth[1000]
        self.assertEqual(c["format"], ct.AUTHORITIES_FORMAT)
        self.assertNotIn("authorities", self.rows[1000])
        got = [(a["cluster_id"], a["anchors"], a["first_text"], a["held"]) for a in c["authorities"]]
        # 1001 cited 3 times by the separate opinions (2 + 1) and twice by the combined text that repeats them: 3, not 5
        # (first text from the lowest citing opinion); null cluster resolved through opinion 20 -> 2000;
        # the self citation and the blocked cluster are left out
        self.assertEqual(got, [(1001, 3, "1 U.S. 1", 1), (2000, 1, "5 F.3d 1", 0)])
        self.assertEqual(c["courts"]["ca1"], "1st Cir.")
        self.assertEqual(c["courts"]["scotus"], "SCOTUS")

    def test_case_without_anything_has_no_record(self):
        self.assertEqual(self.rows[1001]["cited_by"], {"opinions": 1, "cases": 1})
        self.assertNotIn(1002, self.rows)  # blocked selection rows are not cases
        self.assertEqual(sorted(self.auth), [1000])  # 1001 has no anchors

    def test_first_citation_order(self):
        self.assertEqual(self.con.execute("SELECT cite FROM firstcite WHERE cluster_id = 1000").fetchone()[0], "384 U.S. 436")
        order = self.con.execute(f"""SELECT list(c.volume || ' ' || c.reporter || ' ' || c.page ORDER BY {ct.cite_order_sql('c')}, c.reporter)
                                     FROM citation.citation c WHERE cluster_id = 1000""").fetchone()[0]
        self.assertEqual(order, ["384 U.S. 436", "86 S. Ct. 1602", "16 L. Ed. 2d 694", "1966 U.S. LEXIS 2817"])


class CitatorRecordTests(unittest.TestCase):
    def test_empty_case_gives_none(self):
        self.assertIsNone(ct.citator_record((5, 0, 0, None, None, None, None, 0, None), {}))
        self.assertIsNone(ct.authorities_record((5, 0, None), {}))

    def test_parenthetical_only_case_has_a_record(self):
        rec = ct.citator_record((5, 0, 0, None, None, None, None, 1, [{"text": "t", "score": 0.5, "cluster_id": 9, "opinion_id": 8,
                                                                     "name": "N", "court_id": "ca1", "date": None, "citation": None, "held": 0}]),
                                {"ca1": "1st Cir."})
        self.assertEqual(rec["parentheticals_total"], 1)
        self.assertEqual(rec["courts"], {"ca1": "1st Cir."})


# ==================================================================================================== case rows and loader
class CaseRowTests(unittest.TestCase):
    def base(self, **kw):
        r = {"cluster_id": 7, "tier": "t1", "court_id": "scotus", "date_filed": "1966-06-13", "date_approx": False,
             "case_name": "Miranda v. Arizona", "case_name_full": "Miranda v. Arizona", "docket_number": " 759 ",
             "precedential_status": "Published", "citation_count": 5, "citations": ["384 U.S. 436"], "judges": "",
             "panel": None, "disposition": None, "scdb_id": "", "scdb_decision_direction": 2, "scdb_votes_majority": 5,
             "scdb_votes_minority": 4, "citator_key": None, "cited_by": None}
        r.update(kw)
        return r

    def test_not_recorded_and_full_name(self):
        row = case_meta.case_row(self.base(), [])
        self.assertIsNone(row["case_name_full"])  # same as case_name
        self.assertIsNone(row["scdb"])  # no SCDB id
        self.assertIsNone(row["judges"])
        self.assertEqual(row["docket_number"], "759")
        self.assertEqual(row["tier"], 1)
        self.assertIsNone(row["citator"])
        self.assertEqual(case_meta.case_row(self.base(case_name=" ", case_name_full=None), [])["case_name"], "Not recorded")
        only_full = case_meta.case_row(self.base(case_name="", case_name_full="IN RE ESTATE OF DOE"), [])
        self.assertEqual((only_full["case_name"], only_full["case_name_full"]), ("IN RE ESTATE OF DOE", None))

    def test_scdb_and_citator(self):
        row = case_meta.case_row(self.base(scdb_id="1965-120", case_name_full="ERNESTO A. MIRANDA v. ARIZONA",
                                           citator_key="caselaw/citator/2026-09-30/p00-0000-abc.jsonl.gz", citator_offset=5,
                                           citator_length=9, cited_by=3), [])
        self.assertEqual(row["scdb"], {"id": "1965-120", "decision_direction": 2, "votes_majority": 5, "votes_minority": 4})
        self.assertEqual(row["citator"], ["caselaw/citator/2026-09-30/p00-0000-abc.jsonl.gz", 5, 9])
        self.assertEqual(row["case_name_full"], "ERNESTO A. MIRANDA v. ARIZONA")

    def test_opinion_entry(self):
        self.assertEqual(case_meta.opinion_entry({"opinion_id": 3, "type": "040dissent", "author_str": "Harlan", "per_curiam": 0,
                                                  "key": "k", "offset": 10, "length": 20}),
                         {"id": 3, "type": "040dissent", "author": "Harlan", "per_curiam": False, "key": "k", "s": 10, "n": 20})
        self.assertEqual(case_meta.opinion_entry({"opinion_id": 4, "type": "020lead", "author_str": None, "per_curiam": None, "key": None}),
                         {"id": 4, "type": "020lead", "author": None, "per_curiam": None})
        self.assertEqual(case_meta.opinion_entry({"opinion_id": 5, "type": "020lead", "author_str": "Hunteriii", "author_name": "James Hunter III",
                                                  "per_curiam": 0})["author"], "James Hunter III")

    def test_to_db_row_maps_keys_to_object_ids(self):
        r = {"cluster_id": 1, "opinions": [{"id": 2, "key": "a", "s": 0, "n": 5}, {"id": 3}], "citator": ["b", 4, 6],
             "authorities_ref": ["c", 0, 9]}
        out = load_caselaw.to_db_row(r, {"a": 11, "b": 12, "c": 13})
        self.assertEqual(out["opinions"], [{"id": 2, "s": 0, "n": 5, "o": 11}, {"id": 3}])
        self.assertEqual(out["citator"], [12, 4, 6])
        self.assertEqual(out["authorities_ref"], [13, 0, 9])
        self.assertIsNone(load_caselaw.to_db_row({"opinions": [], "citator": None, "authorities_ref": None}, {})["citator"])
        self.assertEqual(r["opinions"][0]["key"], "a")  # input untouched


if __name__ == "__main__":
    unittest.main()
