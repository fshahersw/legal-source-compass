"""Offline tests for the case-law extraction (synthetic fixtures, no network, no credentials).

    cd scripts/enrichment/caselaw && python3 -B -m unittest -v test_caselaw
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "courtlistener"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import extract_text as et  # noqa: E402
import html_text as ht  # noqa: E402
import select_tiers  # noqa: E402
import store  # noqa: E402

try:
    import duckdb  # noqa: F401

    HAVE_DUCKDB = True
except ImportError:  # the selection test needs DuckDB (private/scratch/pylib)
    HAVE_DUCKDB = False


# ==================================================================================================== HTML -> text
class RenderTests(unittest.TestCase):
    def r(self, s):
        return ht.render(s).text

    def test_paragraphs_breaks_entities_nested(self):
        s = "<p>Hello&nbsp;<b>wor<i>ld</i></b>!</p>\n<p>Line<br>two<br/><br><br>three</p>"
        self.assertEqual(self.r(s), "Hello world!\n\nLine\ntwo\n\nthree")

    def test_entities(self):
        self.assertEqual(self.r("<p>&amp;sect; &sect; &#167; &#x27;x&#39; AT&amp;T &lt;b&gt;</p>"), "&sect; § § 'x' AT&T <b>")

    def test_whitespace_outside_pre(self):
        self.assertEqual(self.r("  <div>\n\t a \n\n  b\u2003c\u00a0 </div>  "), "a b c")

    def test_courtlistener_footnotes_kept_with_markers(self):
        s = ('<p>Text<sup id="fn1_ref"><a href="#fn1" class="footnote">1</a></sup> more.</p>'
             '<div class="footnotes"><div class="footnote" id="fn1"><a href="#fn1_ref">1</a> <p>Footnote body.</p></div></div>')
        self.assertEqual(self.r(s), "Text1 more.\n\n1\n\nFootnote body.")

    def test_harvard_xml(self):
        s = ('<?xml version="1.0" encoding="utf-8"?>\n<opinion type="majority"><author id="x">SMITH, J.</author>\n'
             '<p id="a">The court<footnotemark>1</footnotemark> held <page-number citation-index="1" label="232">*232</page-number>that.</p>\n'
             '<footnote label="1"><p id="b">See <em>id.</em></p></footnote></opinion>')
        out = ht.render(s)
        self.assertEqual(out.text, "SMITH, J.\n\nThe court1 held *232that.\n\n1 See id.")
        self.assertEqual(out.pages, [{"page": "232", "citation_index": 1, "offset": out.text.index("*232"), "marker_end": out.text.index("that.")}])
        self.assertEqual(out.stats["unknown_tags"], {})

    def test_inline_pre_and_citation_offsets(self):
        s = ('<pre class="inline">Line one\n   indented    line\n\n\n\nafter gap </pre><span class="citation" data-id="5">'
             '<a href="/opinion/7/case-name/" aria-description="Citation for case: A &gt; B">1 U.S. 1</a></span>'
             '<pre class="inline">, and <span class="citation no-link">2 F. 3</span> tail</pre>')
        out = ht.render(s)
        self.assertEqual(out.text, "Line one\nindented line\n\nafter gap 1 U.S. 1, and 2 F. 3 tail")
        self.assertEqual(len(out.citations), 1)
        c = out.citations[0]
        self.assertEqual((c["opinion_id"], c["cluster_id"]), (5, 7))
        self.assertEqual(out.text[c["start"]:c["end"]], "1 U.S. 1")
        self.assertEqual(out.stats["no_link_citations"], 1)

    def test_block_pre(self):
        self.assertEqual(self.r("before<pre>  a\n b</pre>after"), "before\n\na\nb\n\nafter")

    def test_tables(self):
        self.assertEqual(self.r("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>x"), "a b\nc\n\nx")

    def test_comments_script_style_dropped_stray_lt_kept(self):
        s = "<p>a <!-- hidden --> b<script>var x = '<p>';</script><style>p{}</style> if a < b and c<3</p>"
        out = ht.render(s)
        self.assertEqual(out.text, "a b if a < b and c<3")
        self.assertEqual(out.stats["skipped_script_style"], 2)
        self.assertEqual(out.stats["stray_lt"], 2)

    def test_attribute_values_with_gt_and_quotes(self):
        self.assertEqual(self.r('<span title="a > b">x</span><a class=foo" href=\'/y\'>y</a>'), "xy")

    def test_cdata_is_literal(self):
        self.assertEqual(self.r("<p><![CDATA[x < y &amp; z]]></p>"), "x < y &amp; z")

    def test_unknown_tags_are_inline_and_counted(self):
        out = ht.render("<p>a<newtag>b</newtag>c</p>")
        self.assertEqual(out.text, "abc")
        self.assertEqual(out.stats["unknown_tags"], {"newtag": 2})

    def test_no_words_dropped(self):
        words = "Alpha beta, gamma; delta. Epsilon".split()
        s = "<div><p>" + "</p><p><em>".join(words) + "</em></p></div>"
        self.assertEqual(self.r(s).split(), words)

    def test_page_label_link(self):
        s = ('<p id="p-8"><a class="page-label" data-citation-index="1" data-label="150" href="#p150" id="p150">\n    *150\n   </a>'
             '\n   On 7 January 2013, Marshall <a href="/x">left</a>.</p>')
        out = ht.render(s)
        self.assertEqual(out.text, "*150 On 7 January 2013, Marshall left.")
        self.assertEqual([(p["page"], p["citation_index"], p["offset"]) for p in out.pages], [("150", 1, 0)])
        self.assertEqual(ht.harvard_page_labels(s), [("150", 1)])

    def test_harvard_page_labels_all_encodings_in_order(self):
        x = ('<opinion><author><span citation-index="1" class="star-pagination" label="966"> *966 </span> FAHY, J.</author>'
             '<p>a <page-number citation-index="2" label="12">*12</page-number> b <span class="citation" data-id="4">1 U.S. 1</span>'
             ' <a class="page-label" data-label="967" data-citation-index="1" href="#p967">*967</a> c *968 d</p></opinion>')
        self.assertEqual(ht.harvard_page_labels(x), [("966", 1), ("12", 2), ("967", 1)])
        out = ht.render(x)
        self.assertEqual([(p["page"], p["citation_index"]) for p in out.pages], [("966", 1), ("12", 2), ("967", 1)])
        self.assertEqual(ht.paginate("html_with_citations", out, x)["pages_source"], "chosen_markup")

    def test_star_pagination_span(self):
        out = ht.render('<p>and <span citation-index="1" class="star-pagination" label="274"> *274 </span> for</p>')
        self.assertEqual(out.text, "and *274 for")
        self.assertEqual(out.pages[0]["page"], "274")
        self.assertEqual(out.text[out.pages[0]["offset"]:], "*274 for")

    def test_plain_text_verbatim(self):
        raw = "  UNITED STATES  \r\n\n\n   v.   \t"
        out = ht.render_field("plain_text", raw)
        self.assertEqual(out.text, raw)
        self.assertEqual(out.citations, [])


class PaginateTests(unittest.TestCase):
    XML = ('<opinion><p>First page text <page-number citation-index="1" label="11">*11</page-number>second '
           'page<page-number citation-index="1" label="12">*12</page-number> third.</p></opinion>')

    def test_no_xml(self):
        out = ht.render("<p>x</p>")
        self.assertEqual(ht.paginate("html_with_citations", out, None)["pages_source"], None)

    def test_no_markers(self):
        out = ht.render("<p>x</p>")
        self.assertEqual(ht.paginate("html_with_citations", out, "<opinion><p>x</p></opinion>")["pages_source"], "no_markers")

    def test_chosen_markup(self):
        out = ht.render(self.XML.replace("<opinion>", "<div>").replace("</opinion>", "</div>"))
        pg = ht.paginate("html_with_citations", out, self.XML)
        self.assertEqual(pg["pages_source"], "chosen_markup")
        self.assertEqual([p["page"] for p in pg["pages"]], ["11", "12"])
        self.assertTrue(out.text[pg["pages"][0]["offset"]:].startswith("*11second"))

    def test_aligned_when_chosen_lacks_markers(self):
        chosen = '<p>First page text second <span class="citation" data-id="3"><a href="/opinion/4/x/">page</a></span> third.</p>'
        out = ht.render(chosen)
        pg = ht.paginate("html_with_citations", out, self.XML)
        self.assertEqual(pg["pages_source"], "aligned")
        self.assertIsNone(pg["text_paginated"])
        self.assertEqual(out.text[pg["pages"][0]["offset"]:], "second page third.")
        self.assertEqual(out.text[pg["pages"][1]["offset"]:], "third.")

    def test_unalignable_keeps_xml_text(self):
        out = ht.render("<p>Completely different words.</p>")
        pg = ht.paginate("html_lawbox", out, self.XML)
        self.assertEqual(pg["pages_source"], "xml_harvard_text")
        self.assertEqual(pg["text_paginated"], "First page text *11second page*12 third.")
        self.assertEqual(pg["text_paginated"][pg["pages"][1]["offset"]:], "*12 third.")


# ==================================================================================================== CSV records
def q(v):
    if v is None:
        return ""
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'


def make_record(oid, cluster, **fields):
    row = {c: None for c in et.COLUMNS}
    row.update({"id": str(oid), "date_created": "2020-01-01 00:00:00+00", "date_modified": "2021-01-01 00:00:00+00", "author_str": "",
                "per_curiam": "f", "joined_by_str": "", "type": "010combined", "sha1": "ab", "local_path": "", "extracted_by_ocr": "f",
                "cluster_id": str(cluster)})
    for f in ("plain_text", "html", "html_lawbox", "html_columbia", "html_anon_2020", "xml_harvard", "xml_scan", "html_with_citations"):
        row[f] = ""
    row.update(fields)
    return (",".join(q(row[c]) for c in et.COLUMNS) + "\n").encode("utf-8")


class CsvTests(unittest.TestCase):
    def test_split_fields_nulls_escapes_newlines(self):
        rec = make_record(9, 3, plain_text='He said "hi"\\n\nback\\slash', author_id=None, page_count=None)
        vals = et.split_fields(rec)
        self.assertEqual(len(vals), len(et.COLUMNS))
        self.assertEqual(vals[et.COL["plain_text"]], 'He said "hi"\\n\nback\\slash'.encode())
        self.assertIsNone(vals[et.COL["author_id"]])
        self.assertEqual(vals[et.COL["html"]], b"")
        self.assertEqual(et.record_id(rec), 9)

    def test_field_priority(self):
        self.assertEqual(et.FIELD_PRIORITY, select_tiers.FIELD_PRIORITY)
        self.assertEqual(et.FIELD_PRIORITY, ["html_with_citations", "html_columbia", "html_lawbox", "xml_harvard", "html_anon_2020", "html", "plain_text"])
        meta = (5, 3, 2, "ca9", "t2", "1999-01-02", "Published", False, False, False)
        rec = make_record(5, 3, plain_text="plain", html="<p>h</p>", html_lawbox="<p>lawbox <i>text</i></p>", xml_harvard="<opinion><p>x</p></opinion>")
        row, facts = et.build_record(rec, meta)
        self.assertEqual(row["source_field"], "html_lawbox")
        self.assertEqual(row["fields_present"], ["html_lawbox", "xml_harvard", "html", "plain_text"])
        self.assertEqual(row["raw"], "<p>lawbox <i>text</i></p>")
        self.assertEqual(row["raw_sha256"], hashlib.sha256(b"<p>lawbox <i>text</i></p>").hexdigest())
        self.assertEqual(row["text"], "lawbox text")
        self.assertEqual(row["pages_source"], "no_markers")
        rec = make_record(5, 3, plain_text="  verbatim  ")
        row, _ = et.build_record(rec, meta)
        self.assertEqual((row["source_field"], row["text"], row["renderer"]), ("plain_text", "  verbatim  ", "verbatim"))
        rec = make_record(5, 3)
        row, facts = et.build_record(rec, meta)
        self.assertEqual((row["source_field"], row["raw"], row["text"], facts["src"]), (None, "", "", "none"))

    def test_record_carries_type_author_and_flags(self):
        meta = (5, 3, 2, "ca9", "t2", None, None, True, False, True)
        rec = make_record(5, 4, html_with_citations="<p>x</p>", type="040dissent", author_id="77", per_curiam="t")
        row, facts = et.build_record(rec, meta)
        self.assertEqual((row["type"], row["author_id"], row["per_curiam"], row["blocked"], row["docket_blocked"]), ("040dissent", 77, True, True, True))
        self.assertEqual(row["csv_cluster_id"], 4)
        self.assertTrue(facts["cluster_mismatch"])
        with self.assertRaises(et.PipelineError):
            et.build_record(make_record(6, 3, html="<p>x</p>"), meta)

    def _pieces(self, data, sizes):
        out, pos = [], 0
        for s in sizes:
            out.append(data[pos:pos + s])
            pos += s
        out.append(data[pos:])
        return out

    def _stream(self, pieces, first=0):
        for i in range(first, len(pieces)):
            p = pieces[i]
            h = len(p) // 2
            for part in (p[:h], p[h:]):
                if part:
                    yield i, part
            yield i, None

    def test_scanner_offsets_and_resume(self):
        recs = [make_record(i, i, plain_text=("x" * (i * 37 % 500)) + '"q"\n' * (i % 3)) for i in range(1, 60)]
        data = et.HEADER + b"".join(recs)
        pieces = self._pieces(data, [700, 900, 1500, 50, 2000, 3000])
        starts = [sum(len(p) for p in pieces[:i]) for i in range(len(pieces))]
        sc = et.Scanner(self._stream(pieces), 0, 0, header=True)
        got = list(sc.records())
        self.assertEqual([r for _, _, r in got], recs)
        pos = len(et.HEADER)
        for (seg, off, rec), expected in zip(got, recs):
            self.assertEqual(starts[seg] + off, pos)
            pos += len(expected)
        self.assertEqual(sc.trailing, b"")
        # resume from the first record that starts in piece 3: same records from there on
        k = next(i for i, (seg, _, _) in enumerate(got) if seg >= 3)
        seg, off, _ = got[k]
        again = list(et.Scanner(self._stream(pieces, seg), seg, off).records())
        self.assertEqual(again, got[k:])

    def test_scanner_header_and_trailing(self):
        with self.assertRaises(et.PipelineError):
            list(et.Scanner(self._stream([b"id,other\n"]), 0, 0, header=True).records())
        data = et.HEADER + make_record(1, 1, html="<p>a</p>") + make_record(2, 2, html="<p>b</p>")[:-30]
        sc = et.Scanner(self._stream([data]), 0, 0, header=True)
        self.assertEqual(len(list(sc.records())), 1)
        self.assertGreater(len(sc.trailing), 0)


# ==================================================================================================== selection
@unittest.skipUnless(HAVE_DUCKDB, "duckdb not importable")
class SelectionTests(unittest.TestCase):
    def test_tiers_blocked_groups(self):
        import duckdb

        con = duckdb.connect()
        for name in ("opinion", "cluster", "docket", "small"):
            con.execute(f"ATTACH ':memory:' AS {name}")
        lens = ", ".join(f"len_{f} INTEGER" for f in select_tiers.FIELD_PRIORITY)
        con.execute(f"CREATE TABLE opinion.opinion (id BIGINT, cluster_id BIGINT, author_id BIGINT, type VARCHAR, {lens})")
        con.execute("CREATE TABLE cluster.cluster (id BIGINT, docket_id BIGINT, date_filed DATE, precedential_status VARCHAR, blocked BOOLEAN)")
        con.execute("CREATE TABLE docket.docket (id BIGINT, court_id VARCHAR, blocked BOOLEAN)")
        con.execute("CREATE TABLE small.courts (id VARCHAR, jurisdiction VARCHAR)")
        con.executemany("INSERT INTO small.courts VALUES (?, ?)", [["scotus", "F"], ["ca9", "F"], ["cal", "S"], ["cand", "FD"], ["calctapp", "SA"]])
        dockets = [[1, "scotus", False], [2, "ca9", True], [3, "cal", False], [4, "cand", False], [5, "calctapp", False], [6, "ca9", False]]
        con.executemany("INSERT INTO docket.docket VALUES (?, ?, ?)", dockets)
        clusters = [[10, 1, "1973-01-22", "Published", False], [20, 2, "1995-05-05", "Unpublished", False], [30, 3, None, "Published", True],
                    [40, 4, "2001-01-01", "Published", False], [50, 5, "2001-01-01", "Published", False], [60, 6, None, "Published", False]]
        con.executemany("INSERT INTO cluster.cluster VALUES (?, ?, ?, ?, ?)", clusters)

        def op(i, cluster, **lens):
            vals = [lens.get(f, 0) for f in select_tiers.FIELD_PRIORITY]
            return [i, cluster, None, "010combined", *vals]

        rows = [op(100, 10, html_with_citations=500, plain_text=400), op(200, 20, html_lawbox=3000, xml_harvard=9),
                op(201, 20, plain_text=10), op(300, 30, xml_harvard=7), op(400, 40, html=5), op(500, 50, html=5),
                op(600, 60, html=1000), op(700, 999, html=5)]
        con.executemany(f"INSERT INTO opinion.opinion VALUES ({', '.join('?' * (4 + len(select_tiers.FIELD_PRIORITY)))})", rows)
        big = select_tiers.build(con, big_court_bytes=1000)
        self.assertEqual(big, {"ca9"})
        got = {r[0]: r[1:] for r in con.execute(
            "SELECT opinion_id, tier, court_id, blocked, cluster_blocked, docket_blocked, best_field, best_len, shard_group, date_filed FROM sel2").fetchall()}
        self.assertEqual(sorted(got), [100, 200, 201, 300, 600])  # cand (FD), calctapp (SA) and the orphan 700 are not selected
        self.assertEqual(got[100][:2], ("t1", "scotus"))
        self.assertEqual(got[200][:5], ("t2", "ca9", True, False, True))
        self.assertEqual(got[300][:5], ("t3", "cal", True, True, False))
        self.assertEqual(got[200][5:7], ("html_lawbox", 3000))
        self.assertEqual(got[201][5], "plain_text")
        self.assertEqual(got[200][7], "t2/ca9/1990s")
        self.assertEqual(got[600][7], "t2/ca9/undated")
        self.assertEqual(got[100][7], "t1/scotus")
        for oid, v in got.items():
            self.assertEqual(v[7], select_tiers.shard_group(v[0], v[1], v[8], big))


# ==================================================================================================== storage fakes
class FakeResponse:
    def __init__(self, status, body=b"", headers=None):
        self.status_code = status
        self.content = body
        self.text = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
        self.headers = headers or {}

    def iter_content(self, n):
        for i in range(0, len(self.content), n):
            yield self.content[i:i + n]

    def close(self):
        pass


class FakeBucket:
    """In-memory Supabase Storage object API (standard upload + authenticated GET)."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.fail_keys: set[str] = set()  # uploads answer 500
        self.corrupt_reads: set[str] = set()  # readback returns altered bytes
        self.posts = collections.Counter()

    def _key(self, url, marker):
        return url.split(marker, 1)[1].split("/", 1)[1]

    def post(self, url, data=None, headers=None, timeout=None):
        key = self._key(url, "/storage/v1/object/")
        body = data.read() if hasattr(data, "read") else data
        self.posts[key] += 1
        if key in self.fail_keys:
            return FakeResponse(500, b'{"error":"boom"}')
        if key in self.objects and headers.get("x-upsert") != "true":
            return FakeResponse(400, b'{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')
        self.objects[key] = body
        return FakeResponse(200, b'{"Key":"x"}')

    def get(self, url, headers=None, timeout=None, stream=None, params=None):
        key = self._key(url, "/storage/v1/object/authenticated/")
        if key not in self.objects:
            return FakeResponse(400, b'{"statusCode":"404","error":"not_found","message":"Object not found"}')
        body = self.objects[key]
        # like the real CDN in front of authenticated reads: a plain GET may be served the cached earlier version
        if not (params and params.get("readback")):
            body = self.cache.setdefault(key, body)
        if key in self.corrupt_reads:
            body = body[:-1] + bytes([body[-1] ^ 1])
        if self.flaky_reads.get(key):
            self.flaky_reads[key] -= 1
            body = b"not yet"
        return FakeResponse(200, body)


FakeBucket.cache = None  # set per instance below
_fake_init = FakeBucket.__init__


def _init_with_cache(self):
    _fake_init(self)
    self.cache = {}
    self.flaky_reads = {}


FakeBucket.__init__ = _init_with_cache
RealStorage = store.Storage


def fake_storage(bucket, retries=0):
    return RealStorage(url="https://example.invalid", key="test-key", session=bucket, check_project=False, retries=retries, reread_pause=0)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "s.jsonl.gz")
        with open(self.path, "wb") as h:
            h.write(gzip.compress(b'{"a":1}\n', mtime=0))
        self.sha, self.n = store.sha256_file(self.path)
        self.b = FakeBucket()
        self.s = fake_storage(self.b)

    def tearDown(self):
        self.tmp.cleanup()

    def test_upload_and_readback(self):
        r = self.s.put_verified("k/a.gz", self.path, self.sha, self.n)
        self.assertEqual((r["state"], r["readback_ok"], r["readback_sha256"]), ("uploaded", True, self.sha))

    def test_identical_object_is_left_alone(self):
        self.s.put_verified("k/a.gz", self.path, self.sha, self.n)
        r = self.s.put_verified("k/a.gz", self.path, self.sha, self.n)
        self.assertEqual(r["state"], "already_present")

    def test_checksum_mismatch_on_readback_raises_after_retries(self):
        self.b.corrupt_reads.add("k/a.gz")
        with self.assertRaises(store.ReadbackMismatch):
            self.s.put_verified("k/a.gz", self.path, self.sha, self.n, attempts=3)
        self.assertEqual(self.b.posts["k/a.gz"], 3)  # first upload + two re-uploads

    def test_foreign_object_with_other_bytes_is_refused(self):
        self.b.objects["k/a.gz"] = b"someone else's bytes"
        with self.assertRaises(store.ChecksumConflict):
            self.s.put_verified("k/a.gz", self.path, self.sha, self.n, may_replace=lambda sha: False)
        self.assertEqual(self.b.objects["k/a.gz"], b"someone else's bytes")

    def test_own_older_object_is_replaced(self):
        old = b"older trial bytes"
        self.b.objects["k/a.gz"] = old
        old_sha = hashlib.sha256(old).hexdigest()
        r = self.s.put_verified("k/a.gz", self.path, self.sha, self.n, may_replace=lambda sha: sha == old_sha)
        self.assertEqual((r["state"], r["replaced_sha256"]), ("replaced", old_sha))
        self.assertEqual(hashlib.sha256(self.b.objects["k/a.gz"]).hexdigest(), self.sha)

    def test_replace_is_verified_past_a_stale_read_cache(self):
        old = b"older trial bytes"
        self.b.objects["k/a.gz"] = old
        self.b.get("https://example.invalid/storage/v1/object/authenticated/b/k/a.gz")  # the CDN now holds the old bytes
        old_sha = hashlib.sha256(old).hexdigest()
        r = self.s.put_verified("k/a.gz", self.path, self.sha, self.n, may_replace=lambda sha: sha == old_sha)
        self.assertEqual((r["state"], r["readback_sha256"]), ("replaced", self.sha))

    def test_transient_readback_difference_is_reread_not_reuploaded(self):
        self.b.flaky_reads["k/a.gz"] = 1
        r = self.s.put_verified("k/a.gz", self.path, self.sha, self.n)
        self.assertTrue(r["readback_ok"])
        self.assertEqual(self.b.posts["k/a.gz"], 1)

    def test_local_file_changed_is_refused(self):
        with self.assertRaises(store.StoreError):
            self.s.put_verified("k/a.gz", self.path, "0" * 64, self.n)


# ==================================================================================================== shards, checkpoint, resume
class FakeSeg:
    def __init__(self, idx):
        self.idx = idx


class FakeReader:
    """Stands in for pbz2's reader: segment i of the 'compressed' file decodes to pieces[i]; a --limit cut keeps a prefix."""

    def __init__(self, pieces, first, limit, seg_bytes):
        self.full_size = len(pieces) * seg_bytes
        self.size = min(self.full_size, limit) if limit else self.full_size
        last = -(-self.size // seg_bytes)
        self.pieces_ = pieces
        self.segments = [FakeSeg(i) for i in range(first, last)]
        self.cut = self.size < self.full_size

    def pieces(self):
        for k, s in enumerate(self.segments):
            data = self.pieces_[s.idx]
            if self.cut and k == len(self.segments) - 1:
                data = data[: len(data) // 2]
            for j in range(0, len(data), 997):
                yield s.idx, data[j:j + 997]
            yield s.idx, None

    def close(self):
        pass


class FakeSelection:
    def __init__(self, rows):
        self.rows = rows  # oid -> meta tuple + group
        self.groups = sorted({r[-1] for r in rows.values()})
        self.order = sorted(rows)
        self.n = len(rows)
        self.group_code = [self.groups.index(rows[o][-1]) for o in self.order]

    def row_of(self, oid):
        return self.order.index(oid) if oid in self.rows else -1

    def meta(self, row):
        return self.rows[self.order[row]][:-1]


@unittest.skipUnless("fork" in __import__("multiprocessing").get_all_start_methods(), "the extractor's worker pool uses fork")
class ResumeTests(unittest.TestCase):
    """Run the real Run/session/upload code on a synthetic stream: trial with a limit, then the full run, then compare
    with a clean full run; and a run stopped by an upload failure, then resumed."""

    SEGMENTS = 9

    @classmethod
    def setUpClass(cls):
        recs, sel = [], {}
        courts = [("t1", "scotus", "t1/scotus/1990s"), ("t2", "ca9", "t2/ca9"), ("t3", "cal", "t3/cal")]
        for i in range(1, 140):
            body = "<p>" + ("word%d " % i) * (i * 7 % 90 + 1) + "</p>"
            fields = {"html_with_citations": body} if i % 4 else {"plain_text": "plain %d" % i}
            if i % 5 == 0:
                fields["xml_harvard"] = '<opinion><p>x<page-number citation-index="1" label="%d">*%d</page-number>y</p></opinion>' % (i, i)
            recs.append(make_record(i, 1000 + i, **fields))
            if i % 3:
                tier, court, group = courts[i % 3]
                sel[i] = (i, 1000 + i, 5000 + i, court, tier, "1995-01-01", "Published", i % 11 == 0, False, i % 11 == 0, group)
        data = et.HEADER + b"".join(recs)
        n = cls.SEGMENTS
        cuts = [len(data) * k // n for k in range(n + 1)]
        cls.pieces = [data[cuts[k]:cuts[k + 1]] for k in range(n)]
        cls.selected = set(sel)
        cls.sel = sel

    def setUp(self):
        self.saved = {k: getattr(et, k) for k in ("WORK", "SHARDS", "CHECKPOINT", "MANIFEST", "UNITS_DIR", "RUNS", "SEGMENT_MB", "INPUT_BYTES",
                                                  "UNIT_SEGMENTS", "SHARD_MAX", "BATCH_BYTES", "MAX_PENDING", "segment_reader", "Selection",
                                                  "verify_input")}
        self.saved_storage = store.Storage
        self.bucket = FakeBucket()

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(et, k, v)
        store.Storage = self.saved_storage

    def configure(self, root):
        et.WORK = os.path.join(root, "work")
        et.SHARDS = os.path.join(root, "shards")
        et.CHECKPOINT = os.path.join(et.WORK, "checkpoint.json")
        et.MANIFEST = os.path.join(et.WORK, "shards.jsonl")
        et.UNITS_DIR = os.path.join(et.WORK, "units")
        et.RUNS = os.path.join(et.WORK, "runs.jsonl")
        et.SEGMENT_MB = 1
        et.INPUT_BYTES = self.SEGMENTS * 1_000_000
        et.UNIT_SEGMENTS = 3
        et.SHARD_MAX = 2500
        et.BATCH_BYTES = 1200
        et.MAX_PENDING = 4000
        pieces = self.pieces
        et.segment_reader = lambda first, limit, workers, stats: FakeReader(pieces, first, limit, 1_000_000)
        sel = self.sel
        et.Selection = lambda: FakeSelection(sel)
        bucket = self.bucket
        store.Storage = lambda: fake_storage(bucket)
        et.verify_input = lambda: None  # offline: the synthetic stream stands in for the pinned bulk file

    def run_once(self, limit_mb=None):
        args = argparse.Namespace(limit_mb=limit_mb, procs=2, workers=1, upload_threads=2, min_free_gb=0.0, no_upload=False)
        with contextlib_redirect():
            return et.Run(args).run()

    def stored(self, bucket):
        """opinion id -> number of occurrences across the stored shards, and key -> sha256."""
        seen = collections.Counter()
        shas = {}
        for key, body in bucket.objects.items():
            shas[key] = hashlib.sha256(body).hexdigest()
            for line in gzip.GzipFile(fileobj=io.BytesIO(body)):
                seen[json.loads(line)["opinion_id"]] += 1
        return seen, shas

    def test_trial_then_full_matches_clean_run(self):
        with tempfile.TemporaryDirectory() as root:
            self.configure(root)
            self.run_once(limit_mb=5)  # segments 0-4, segment 4 cut: unit 0 complete, unit 1 partial
            ck = read_json(et.CHECKPOINT)
            self.assertEqual(ck["units"]["0"]["status"], "complete")
            self.assertEqual(ck["units"]["1"]["status"], "partial")
            trial_keys = dict(self.stored(self.bucket)[1])
            unit0_trial = {k: v for k, v in trial_keys.items() if "-u000-" in k}
            self.run_once()  # resumes at unit 1, replaces its partial shards
            ck = read_json(et.CHECKPOINT)
            self.assertEqual([ck["units"][str(u)]["status"] for u in range(3)], ["complete"] * 3)
            seen, shas = self.stored(self.bucket)
            self.assertEqual(set(seen), self.selected)
            self.assertEqual(max(seen.values()), 1)
            self.assertEqual({k: v for k, v in shas.items() if "-u000-" in k}, unit0_trial)
            # the fixture is non-trivial: three units with shards each, parts rolled over by size, several gzip members
            self.assertEqual({re.search(r"-u(\d{3})-", k).group(1) for k in shas}, {"000", "001", "002"})
            self.assertTrue(any("-p01." in k for k in shas))
            self.assertTrue(any(json.loads(l)["gzip_members"] > 1 for l in read_lines(et.MANIFEST)))
            self.assertEqual(sorted(ck["boundaries"]), ["0", "1", "2"])
            states = collections.Counter(json.loads(l)["state"] for l in read_lines(et.MANIFEST))
            self.assertGreater(states["replaced"], 0)
            self.assertTrue(any(json.loads(l)["partial_unit"] for l in read_lines(et.MANIFEST)))
            self.assertTrue(all(json.loads(l)["readback_ok"] for l in read_lines(et.MANIFEST)))
            self.assertEqual(sum(len(f) for _, _, f in os.walk(et.SHARDS)), 0)  # local shards deleted after readback
            resumed = shas
        clean_bucket = FakeBucket()
        with tempfile.TemporaryDirectory() as root:
            self.bucket = clean_bucket
            self.configure(root)
            self.run_once()
            _, clean = self.stored(clean_bucket)
        self.assertEqual(resumed, clean)  # same keys, byte-identical shards

    def test_upload_failure_stops_and_resume_completes(self):
        with tempfile.TemporaryDirectory() as root:
            self.configure(root)
            clean_bucket = FakeBucket()
            self.bucket.fail_keys.add(f"{et.KEY_PREFIX}/t2/ca9/ca9-u001-p00.jsonl.gz")
            with self.assertRaises(et.PipelineError):
                self.run_once()
            ck = read_json(et.CHECKPOINT)
            self.assertEqual(ck["units"]["0"]["status"], "complete")
            self.assertNotEqual(ck["units"].get("1", {}).get("status"), "complete")
            self.assertIn("2", ck["boundaries"])
            self.bucket.fail_keys.clear()
            self.run_once()
            ck = read_json(et.CHECKPOINT)
            self.assertEqual([ck["units"][str(u)]["status"] for u in range(3)], ["complete"] * 3)
            seen, shas = self.stored(self.bucket)
            self.assertEqual(set(seen), self.selected)
            self.assertEqual(max(seen.values()), 1)
        with tempfile.TemporaryDirectory() as root:
            self.bucket = clean_bucket
            self.configure(root)
            self.run_once()
            self.assertEqual(self.stored(clean_bucket)[1], shas)

    def test_checkpoint_identity_and_version(self):
        with tempfile.TemporaryDirectory() as root:
            self.configure(root)
            ck = et.load_checkpoint()
            self.assertEqual(et.first_open_unit(ck), 0)
            ck["units"] = {"0": {"status": "complete", "extractor": et.VERSION}, "1": {"status": "partial", "extractor": et.VERSION}}
            self.assertEqual(et.first_open_unit(ck), 1)
            ck["units"]["0"]["extractor"] = "older"
            self.assertEqual(et.first_open_unit(ck), 0)
            et.write_json(et.CHECKPOINT, ck) if os.path.isdir(et.WORK) else (os.makedirs(et.WORK), et.write_json(et.CHECKPOINT, ck))
            et.UNIT_SEGMENTS = 4
            with self.assertRaises(et.PipelineError):
                et.load_checkpoint()

    def test_shard_names_and_multimember_gzip(self):
        self.assertEqual(et.shard_relpath("t2/ca9/1990s", 3, 1), "t2/ca9/ca9-1990s-u003-p01.jsonl.gz")
        self.assertEqual(et.shard_relpath("t3/iowa", 12, 0), "t3/iowa/iowa-u012-p00.jsonl.gz")
        with tempfile.TemporaryDirectory() as root:
            sf = et.ShardFile("t3/iowa", 0, 0, root=root)
            for i in range(3):
                data = json.dumps({"opinion_id": i}).encode() + b"\n"
                st = et.new_stats()
                st["json_bytes"] = len(data)
                sf.add(et.gzip_member(data), 1, i, i, st)
            d = sf.close()
            self.assertEqual(d["gzip_members"], 3)
            self.assertEqual(d["sha256"], store.sha256_file(d["local"])[0])
            self.assertEqual([json.loads(l)["opinion_id"] for l in gzip.open(d["local"])], [0, 1, 2])
            self.assertEqual(et.gzip_member(b"abc"), et.gzip_member(b"abc"))


def read_json(path):
    with open(path) as h:
        return json.load(h)


def read_lines(path):
    with open(path) as h:
        return h.readlines()


class contextlib_redirect:
    """Silence the run's progress output inside tests."""

    def __enter__(self):
        self.saved = sys.stdout
        sys.stdout = io.StringIO()

    def __exit__(self, *exc):
        sys.stdout = self.saved
        return False


if __name__ == "__main__":
    unittest.main()
