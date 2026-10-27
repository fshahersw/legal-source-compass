"""Offline tests for the "Not classified" release builder, its metadata merge and corpus_writer.append. No network.

  python -I -B -m unittest discover -s scripts/enrichment/bundle_unclassified -p "test_*.py" -v
"""
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
import build_unclassified as bu  # noqa: E402
import corpus_writer as cw  # noqa: E402
import publish_unclassified as pu  # noqa: E402

COURT_COLUMNS = (
    "id", "manifest", "wave", "source_url", "final_url", "host", "filename", "local_rel_path", "sha256", "bytes",
    "content_type", "extension", "download_status", "http_status", "started_at", "completed_at", "jurisdiction_codes",
    "authority_lanes", "state", "court_state", "doc_type", "doc_type_basis", "link_status", "court_id",
    "candidate_court_ids", "title", "text_extracted",
)


def court_doc(rid, url, sha, *, doc_type="other_unknown", link="none", state=None, court_state=None, court_id=None, candidates="[]", title=None, wave="wave_002", final=None):
    return {
        "id": rid, "manifest": "court_expansion_file_download_v2_4_2026-08-20", "wave": wave, "source_url": url,
        "final_url": final or url, "host": url.split("/")[2].removeprefix("www."), "filename": url.rsplit("/", 1)[-1],
        "local_rel_path": "x", "sha256": sha, "bytes": 33130, "content_type": "application/pdf", "extension": "pdf",
        "download_status": "downloaded", "http_status": 200, "started_at": "2026-08-21T08:39:55Z",
        "completed_at": "2026-08-21T08:39:56Z", "jurisdiction_codes": "[]", "authority_lanes": "[]", "state": state,
        "court_state": court_state, "doc_type": doc_type,
        "doc_type_basis": "no_family_no_pattern_match" if doc_type == "other_unknown" else "filename_url_pattern:" + doc_type,
        "link_status": link, "court_id": court_id, "candidate_court_ids": candidates, "title": title,
        "text_extracted": int(bool(title)),
    }


def make_court_db(path, docs):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE documents (" + ", ".join(COURT_COLUMNS) + ")")
    con.executemany("INSERT INTO documents VALUES (" + ",".join("?" * len(COURT_COLUMNS)) + ")", [tuple(d[c] for c in COURT_COLUMNS) for d in docs])
    con.commit()
    con.close()


def make_source_db(path, docs):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE docs(id INTEGER PRIMARY KEY, url TEXT, host TEXT, family TEXT, title TEXT, title_basis TEXT, filename TEXT, ext TEXT, sha256 TEXT, bytes INTEGER, raw_path TEXT, text_path TEXT, text_sha256 TEXT, text_chars INTEGER, extraction_status TEXT, fetched_at TEXT, http_status INTEGER, other_urls TEXT)")
    con.execute("CREATE TABLE docs_fts_content(id INTEGER PRIMARY KEY, c0, c1, c2)")
    for d in docs:
        body = d.pop("body", None)
        cols = list(d)
        con.execute(f"INSERT INTO docs({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [d[c] for c in cols])
        con.execute("INSERT INTO docs_fts_content VALUES (?,?,?,?)", (d["id"], d.get("title"), d["url"], body))
    con.commit()
    con.close()


def source_doc(rid, url, *, family="uncategorized", ext="pdf", raw_ext=None, body=None, chars=None, sha_of=None):
    text_sha = hashlib.sha256((sha_of if sha_of is not None else (body or "")).encode()).hexdigest() if body is not None else None
    return {
        "id": rid, "url": url, "host": url.split("/")[2], "family": family, "title": f"Doc {rid}", "title_basis": "link text from the discovery list",
        "filename": url.rsplit("/", 1)[-1], "ext": ext, "sha256": f"{rid:064d}", "bytes": 21894,
        "raw_path": f"raw/00/{rid:064d}.{raw_ext or ext}", "text_path": None, "text_sha256": text_sha,
        "text_chars": chars if chars is not None else (len(body) if body else 0),
        "extraction_status": "extracted" if body else "unsupported_format", "fetched_at": "2026-09-19T21:48:12+00:00",
        "http_status": 200, "other_urls": None, "body": body,
    }


class CourtBuild(unittest.TestCase):
    def build(self, docs):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "index.sqlite3")
            make_court_db(path, docs)
            return bu.build_court(path)

    def test_releases_only_unclassified_rows_with_not_classified_label(self):
        rows, held, counts = self.build([
            court_doc("a:1", "https://www.uscourts.gov/forms/a.pdf", "1" * 64, doc_type="court_form"),
            court_doc("a:2", "https://cacd.uscourts.gov/files/2023%20Press%20Release.pdf", "2" * 64, link="matched", court_id="cacd", court_state="CA"),
        ])
        self.assertEqual(counts, {"native_rows": 2, "published_snapshot_rows": 1, "unclassified_rows": 1})
        self.assertEqual(held, [])
        [row] = rows
        self.assertEqual(row["id"], "a:2")
        self.assertEqual(row["category"], "court_documents")
        self.assertEqual(row["filters"]["doc_type"], ["other_unknown"])
        self.assertEqual(row["item"]["cells"]["doc_type"], "Not classified")
        self.assertEqual(row["title"], "2023 Press Release.pdf (title not recorded)")
        self.assertEqual(row["filters"]["court"], ["cacd"])
        self.assertEqual(row["filters"]["state"], [])
        self.assertEqual(row["state"], "")
        self.assertEqual(row["item"]["cells"]["jurisdiction"], "CA")
        self.assertIn("State: state of the matched court", row["item"]["badges"])
        self.assertIn({"url": "#courts?id=cacd", "label": "Court detail"}, row["detail"]["links"])
        self.assertNotIn("/supplement-files/", json.dumps(row))
        self.assertEqual(row["item"]["cells"]["size"], "32.4 KB")

    def test_ambiguous_host_lists_candidates_and_never_picks_a_court(self):
        rows, _, _ = self.build([court_doc("a:3", "https://www.wicourts.gov/forms/x.doc", "3" * 64, link="ambiguous", state="WI", candidates='["wisctapp", "wis", "reg-ST-wi_state"]')])
        facts = dict(map(tuple, rows[0]["detail"]["facts"]))
        self.assertEqual(facts["Candidate courts (host is shared, never guessed)"], "reg-ST-wi_state, wis, wisctapp")
        self.assertEqual(rows[0]["filters"]["court"], [])
        self.assertEqual(rows[0]["filters"]["state"], ["WI"])
        self.assertEqual(rows[0]["state"], "WI")
        self.assertNotIn("Court detail", json.dumps(rows[0]["detail"]["links"]))

    def test_byte_identical_alias_of_a_published_or_released_row_is_held(self):
        rows, held, _ = self.build([
            court_doc("p:1", "https://www.courts.ms.gov/a/Map.pdf", "4" * 64, doc_type="opinion"),
            court_doc("u:1", "https://courts.ms.gov/a/map.pdf?v=1", "4" * 64),
            court_doc("u:2", "https://www.vacourts.gov/static/sitemap.xml", "5" * 64),
            court_doc("u:3", "https://vacourts.gov/static/sitemap.xml", "5" * 64),
            court_doc("u:4", "https://vacourts.gov/static/other.xml", "5" * 64),
        ])
        self.assertEqual([r["id"] for r in rows], ["u:3", "u:4"])
        by_id = {h["id"]: h for h in held}
        self.assertEqual(by_id["u:1"]["survivor_is"], "published")
        self.assertEqual(by_id["u:2"]["survivor_id"], "u:3")
        self.assertEqual({h["reason"] for h in held}, {"duplicate_file_address_alias"})

    def test_first_page_heading_is_a_fact_never_the_title(self):
        rows, _, _ = self.build([
            court_doc("a:5", "https://x.gov/y/notice.pdf", "6" * 64, title="FOR IMMEDIATE RELEASE"),
            court_doc("a:6", "https://x.gov/y/z.pdf", "7" * 64, title="r:.. ~ i::: Ө s"),
        ])
        first, second = rows
        self.assertEqual(first["title"], "notice.pdf (title not recorded)")
        self.assertIn(["First-page heading recorded at indexing (verbatim; not reviewed as a title)", "FOR IMMEDIATE RELEASE"], first["detail"]["facts"])
        self.assertFalse(any(f[0].startswith("First-page heading") for f in second["detail"]["facts"]))

    def test_redirected_address_is_recorded(self):
        rows, _, _ = self.build([court_doc("a:7", "https://legis.iowa.gov/d.pdf", "8" * 64, final="https://www.legis.iowa.gov/d.pdf")])
        self.assertIn(["Address after redirects (as recorded)", "https://www.legis.iowa.gov/d.pdf"], rows[0]["detail"]["facts"])
        self.assertEqual(rows[0]["source_url"], "https://legis.iowa.gov/d.pdf")


class SourceBuild(unittest.TestCase):
    def build(self, docs):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "documents.sqlite3")
            make_source_db(path, docs)
            return bu.build_source(path)

    def test_uncategorized_rows_released_office_bin_kept_html_page_view_held(self):
        rows, held, counts = self.build([
            source_doc(1, "https://content.naic.org/f/a.xlsx", ext="xlsx", raw_ext="bin"),
            source_doc(2, "https://github.com/usgpo/api/blob/main/s.json", ext="json", raw_ext="html", body="page"),
            source_doc(3, "https://www.mnd.uscourts.gov/f/form.pdf", family="court_forms"),
            source_doc(4, "https://akleg.gov/a.pdf", body="Short text"),
        ])
        self.assertEqual(counts["unclassified_rows"], 3)
        self.assertEqual([r["id"] for r in rows], ["1", "4"])
        self.assertEqual(held[0]["id"], "2")
        self.assertEqual(held[0]["reason"], "saved_bytes_not_the_named_file")
        xlsx, pdf = rows
        self.assertEqual(xlsx["filters"], {"agency": ["uncategorized"], "type": ["xlsx"], "text": ["no"], "_listing": ["yes"]})
        self.assertEqual(xlsx["item"]["cells"]["agency"], "Not classified")
        self.assertEqual(xlsx["item"]["cells"]["size"], "22 KB")
        self.assertIn("No extractable text (scan or unsupported)", xlsx["item"]["badges"])
        self.assertEqual(pdf["text"], "Short text")
        self.assertEqual(pdf["detail"]["sections"], [{"heading": "Extracted text", "text": "Short text"}])

    def test_truncated_index_text_is_labelled_as_a_prefix(self):
        rows, _, _ = self.build([source_doc(5, "https://sdsos.gov/a.pdf", body="x" * 70000, chars=200000, sha_of="full text differs")])
        facts = dict(map(tuple, rows[0]["detail"]["facts"]))
        self.assertIn("First 70,000 of 200,000 characters", facts["Search text"])
        self.assertEqual(rows[0]["detail"]["sections"][0]["heading"], "Extracted text (first 60,000 of 200,000 characters)")
        self.assertEqual(len(rows[0]["detail"]["sections"][0]["text"]), 60000)


class Formatting(unittest.TestCase):
    def test_sizes_match_published_cells(self):
        self.assertEqual(bu.binary_size(60363), "58.9 KB")
        self.assertEqual(bu.binary_size(220674), "215.5 KB")
        self.assertEqual(bu.decimal_size(193169), "193 KB")
        self.assertEqual(bu.decimal_size(2986489), "3.0 MB")
        self.assertEqual(bu.decimal_size(None), "Not recorded")

    def test_normalised_address(self):
        self.assertEqual(bu.normalised_address("https://www.A.gov/X%20Y.PDF?v=1#p"), bu.normalised_address("http://a.gov/x y.pdf"))

    def test_hash_guard_refuses_another_snapshot(self):
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            handle.write(b"not the snapshot")
        try:
            with self.assertRaises(SystemExit):
                bu.require_hash(handle.name, bu.COURT_INDEX_SHA256, "court index")
        finally:
            os.unlink(handle.name)


LIVE_LISTING = {
    "total": 3, "qualification": "old", "columns": [],
    "filters": [
        {"name": "q", "type": "search", "label": "Search"},
        {"name": "doc_type", "type": "select", "label": "Document type", "options": [{"count": 2, "label": "Court form", "value": "court_form"}, {"count": 1, "label": "Opinion", "value": "opinion"}]},
        {"name": "host", "type": "select", "label": "Source host", "options": [{"count": 3, "label": "a.gov", "value": "a.gov"}, {"count": 1, "label": "gone.gov", "value": "gone.gov"}]},
    ],
}


class MergeMetadata(unittest.TestCase):
    def merged(self):
        live = {"id": "court_documents", "label": "Court documents", "listing": LIVE_LISTING, "listing_modes": {"default": LIVE_LISTING},
                "summary": {"records": 3, "excluded_uncategorized": 2, "native_default_records": 5}, "label_review": {"v": 1}, "expected_records": 3}
        live_filters = [{"doc_type": ["court_form"], "host": ["a.gov"]}, {"doc_type": ["court_form"], "host": ["a.gov"]}, {"doc_type": ["opinion"], "host": ["a.gov"]}]
        new = [{"id": "n1", "ordinal": 10, "filters": {"doc_type": ["other_unknown"], "host": ["b.gov"]}}]
        report = {"held": {"duplicate_file_address_alias": 1}, "rows_sha256": "r", "ids_sha256": "i", "source_sha256": "s"}
        return live, pu.merge_metadata("court_documents", live, {"imported_records": 3, "expected_records": 3, "manifest_sha256": "m"}, live_filters, new, report)

    def test_counts_options_and_preserved_keys(self):
        live, md = self.merged()
        self.assertEqual(md["label_review"], {"v": 1})
        self.assertEqual(md["listing"]["total"], 4)
        doc_type = {o["value"]: (o["label"], o["count"]) for o in md["listing"]["filters"][1]["options"]}
        self.assertEqual(doc_type, {"court_form": ("Court form", 2), "opinion": ("Opinion", 1), "other_unknown": ("Not classified", 1)})
        hosts = [o["value"] for o in md["listing_modes"]["default"]["filters"][2]["options"]]
        self.assertEqual(hosts, ["a.gov", "b.gov"])  # zero-count option dropped, new host appended
        self.assertEqual(md["summary"]["excluded_uncategorized"], 0)
        self.assertEqual(md["summary"]["not_classified_records"], 1)
        self.assertEqual(md["summary"]["native_default_records"], 5)
        self.assertIn("4 records: 3 with a document type from the source classifier and 1 it could not classify", md["listing"]["qualification"])
        self.assertIn("1 byte-identical files", md["listing"]["qualification"])

    def test_before_state_is_stored_for_rollback_and_live_input_untouched(self):
        live, md = self.merged()
        before = md[pu.RELEASE_KEY]["before"]
        self.assertEqual(before["metadata"]["listing"], LIVE_LISTING)
        self.assertEqual(before["metadata"]["summary"], {"records": 3, "excluded_uncategorized": 2, "native_default_records": 5})
        self.assertEqual(before["columns"]["manifest_sha256"], "m")
        self.assertEqual(md[pu.RELEASE_KEY]["first_ordinal"], 10)
        self.assertEqual(live["listing"]["total"], 3)

    def test_ids_md5_matches_postgres_string_agg(self):
        self.assertEqual(pu.ids_md5(["b", "a:2", "A"]), hashlib.md5("A\na:2\nb".encode()).hexdigest())


class FakeRest:
    def __init__(self, live_ids, max_ordinal):
        self.live = {i: {"id": i, "ordinal": n} for n, i in enumerate(live_ids)}
        self.max_ordinal = max_ordinal
        self.calls = []

    def call(self, method, path, body=None, prefer="return=minimal"):
        self.calls.append((method, path.split("?")[0], prefer))
        if method == "GET" and path.startswith("corpus_records?select=ordinal"):
            return [{"ordinal": self.max_ordinal}]
        if method == "POST":
            for row in body:
                self.live.setdefault(row["id"], row)
            return None
        return None


class Append(unittest.TestCase):
    def setUp(self):
        self.saved = (cw._call, cw._count, cw.fetch_all)

    def tearDown(self):
        cw._call, cw._count, cw.fetch_all = self.saved

    def install(self, fake):
        cw._call = fake.call
        cw._count = lambda dataset: len(fake.live)
        cw.fetch_all = lambda dataset, select="id": [{"id": i} for i in fake.live]

    def test_appends_without_delete_and_patches_after_count(self):
        fake = FakeRest(["x1", "x2"], 1)
        self.install(fake)
        rows = [{"dataset": "court_documents", "id": f"n{i}", "filters": {}} for i in range(3)]
        self.assertEqual(cw.append("court_documents", rows, metadata={"m": 1}, expected_before=2, first_ordinal=2, manifest_sha256="d"), 5)
        methods = [c[0] for c in fake.calls]
        self.assertNotIn("DELETE", methods)
        self.assertEqual(methods[-1], "PATCH")
        self.assertTrue(all("ignore-duplicates" in c[2] for c in fake.calls if c[0] == "POST"))
        self.assertEqual([r["ordinal"] for r in rows], [2, 3, 4])

    def test_refuses_when_live_count_or_ids_or_ordinals_differ(self):
        rows = [{"dataset": "court_documents", "id": "n1", "filters": {}}]
        fake = FakeRest(["x1", "x2", "x3"], 2)
        self.install(fake)
        with self.assertRaises(RuntimeError):
            cw.append("court_documents", rows, metadata={}, expected_before=2, first_ordinal=3, manifest_sha256="d")
        fake = FakeRest(["x1", "n1"], 1)
        self.install(fake)
        with self.assertRaises(RuntimeError):
            cw.append("court_documents", rows, metadata={}, expected_before=1, first_ordinal=2, manifest_sha256="d")
        fake = FakeRest(["x1"], 5)
        self.install(fake)
        with self.assertRaises(RuntimeError):
            cw.append("court_documents", rows, metadata={}, expected_before=1, first_ordinal=2, manifest_sha256="d")
        self.assertFalse([c for c in fake.calls if c[0] in ("POST", "PATCH")])

    def test_resume_skips_rows_already_written(self):
        fake = FakeRest(["x1", "n0"], 1)
        self.install(fake)
        rows = [{"dataset": "court_documents", "id": f"n{i}", "filters": {}} for i in range(2)]
        self.assertEqual(cw.append("court_documents", rows, metadata={}, expected_before=1, first_ordinal=1, manifest_sha256="d", resume=True), 3)
        posted = [c for c in fake.calls if c[0] == "POST"]
        self.assertEqual(len(posted), 1)

    def test_rejects_rows_of_another_dataset_before_any_call(self):
        fake = FakeRest([], 0)
        self.install(fake)
        with self.assertRaises(ValueError):
            cw.append("court_documents", [{"dataset": "other", "id": "a"}], metadata={}, expected_before=0, first_ordinal=0, manifest_sha256="d")
        self.assertEqual(fake.calls, [])


class PublishMain(unittest.TestCase):
    """publish_unclassified.main end to end on a tiny packet, with the REST layer faked."""

    def setUp(self):
        self.saved = (cw._call, cw._count, cw.fetch_all, cw.append)
        self.tmp = tempfile.TemporaryDirectory()
        db = os.path.join(self.tmp.name, "index.sqlite3")
        make_court_db(db, [
            court_doc("p:1", "https://a.gov/x.pdf", "1" * 64, doc_type="court_form"),
            court_doc("u:1", "https://a.gov/y.pdf", "2" * 64),
        ])
        rows, held, counts = bu.build_court(db)
        files = bu.write_dataset(self.tmp.name, "court_documents", rows, held)
        report = {"datasets": {"court_documents": {**counts, **files, "source_sha256": "s", "released": len(rows), "held": {}}}}
        for name, value in (("report.json", report), ("live_before.json", {"court_documents": {"count": 1, "ids_md5": pu.ids_md5(["p:1"]), "max_ordinal": 0}})):
            with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as handle:
                json.dump(value, handle)
        self.live_md = {"listing": LIVE_LISTING, "summary": {"records": 1}}
        self.appended = []
        cw._call = lambda method, path, body=None, prefer=None: [{"imported_records": 1, "expected_records": 1, "manifest_sha256": "m", "metadata": self.live_md}]
        cw.fetch_all = lambda dataset, select="id": [{"id": "p:1", "filters": {"doc_type": ["court_form"], "host": ["a.gov"]}}]
        cw.append = lambda *a, **k: self.appended.append((a, k))

    def tearDown(self):
        cw._call, cw._count, cw.fetch_all, cw.append = self.saved
        self.tmp.cleanup()

    def test_dry_run_writes_metadata_and_does_not_append(self):
        self.assertEqual(pu.main(["--packet", self.tmp.name, "--dataset", "court_documents"]), 0)
        self.assertEqual(self.appended, [])
        after = pu.read_json(os.path.join(self.tmp.name, "metadata.court_documents.after.json"))
        self.assertEqual(after["listing"]["total"], 2)
        self.assertEqual(after[pu.RELEASE_KEY]["first_ordinal"], 1)

    def test_execute_appends_with_guards_from_packet(self):
        self.assertEqual(pu.main(["--packet", self.tmp.name, "--dataset", "court_documents", "--execute"]), 0)
        (args, kwargs), = self.appended
        self.assertEqual(kwargs["expected_before"], 1)
        self.assertEqual(kwargs["first_ordinal"], 1)
        self.assertEqual([r["id"] for r in args[1]], ["u:1"])

    def test_refuses_when_live_ids_changed(self):
        cw.fetch_all = lambda dataset, select="id": [{"id": "p:2", "filters": {}}]
        with self.assertRaises(SystemExit):
            pu.main(["--packet", self.tmp.name, "--dataset", "court_documents", "--execute"])
        self.assertEqual(self.appended, [])

    def test_refuses_a_tampered_rows_file(self):
        with open(os.path.join(self.tmp.name, "court_documents.rows.jsonl"), "a", encoding="utf-8") as handle:
            handle.write("\n")
        with self.assertRaises(SystemExit):
            pu.main(["--packet", self.tmp.name, "--dataset", "court_documents", "--execute"])


if __name__ == "__main__":
    unittest.main()
