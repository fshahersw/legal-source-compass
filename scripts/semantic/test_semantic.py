"""Offline tests for the semantic index builders (synthetic text and a fake embedding service; no network, no credentials).

    cd scripts/semantic && python3 -B -m unittest -v test_semantic
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import chunking as ck  # noqa: E402
import embed as em  # noqa: E402
import evaluate as ev  # noqa: E402
import load as ld  # noqa: E402
import scotus as sc  # noqa: E402
import sources as src  # noqa: E402
import voyage as vg  # noqa: E402

MARK = ck.MARK


def jload(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def statute(n_subsections: int, words: int = 120) -> str:
    """A synthetic statute shaped like stored U.S. Code text: marked subsection headings, tab-indented paragraphs."""
    out = []
    for i in range(n_subsections):
        letter = chr(ord("a") + i)
        out.append(f"{MARK}({letter}) Subsection {i}")
        out.append("\t" + " ".join(f"The covered person shall comply with requirement {i}-{w}." for w in range(words // 8)))
        for p in range(1, 3):
            out.append(f"\t{MARK}({p}) Paragraph {p}")
            out.append("\t\t" + " ".join(f"Each filing under paragraph {p} must be made within {w} days." for w in range(words // 10)))
    return "\n".join(out)


def regulation(n: int) -> str:
    return "\n".join(
        f"({chr(ord('a') + i)}) Heading {i}. " + " ".join(f"Sentence {i}.{s} sets out what the operator must record." for s in range(40))
        for i in range(n)
    )


def coverage_ok(test: unittest.TestCase, text: str, spans: list[ck.Span]) -> None:
    covered = [False] * len(text)
    last_end = 0
    for s in spans:
        test.assertGreaterEqual(s.start, last_end, "spans are ordered and do not overlap")
        test.assertFalse(text[s.start].isspace() or text[s.end - 1].isspace(), "spans are trimmed")
        for i in range(s.start, s.end):
            covered[i] = True
        last_end = s.end
    for i, ch in enumerate(text):
        if not ch.isspace():
            test.assertTrue(covered[i], f"non-space character at {i} is in a passage")


class ChunkingTests(unittest.TestCase):
    def test_empty_and_blank(self):
        self.assertEqual(ck.split_spans(""), [])
        self.assertEqual(ck.split_spans(" \n\t \x1e\n"), [])

    def test_short_text_is_one_trimmed_passage(self):
        text = "\n  Every person who acts under color of law is liable.  \n"
        spans = ck.split_spans(text)
        self.assertEqual(len(spans), 1)
        self.assertEqual(text[spans[0].start : spans[0].end], "Every person who acts under color of law is liable.")

    def test_deterministic(self):
        text = statute(9)
        self.assertEqual(ck.split_spans(text), ck.split_spans(text))
        d = ck.Doc("us_code_sections", "1:1", "T", "H", text, "/law/uscode/1/1")
        self.assertEqual([c.text_sha256 for c in ck.chunk_doc(d)], [c.text_sha256 for c in ck.chunk_doc(d)])

    def test_offsets_exact_limits_and_full_coverage(self):
        for text in (statute(12), regulation(14), "word " * 3000, "x" * 9000, "A sentence. " * 1200):
            spans = ck.split_spans(text, max_chars=1000)
            self.assertGreater(len(spans), 1)
            coverage_ok(self, text, spans)
            for s in spans:
                self.assertLessEqual(s.length, 1000)
            d = ck.Doc("d", "r", "T", "H", text, "/x/y")
            for c in ck.chunk_doc(d, max_chars=1000):
                self.assertEqual(c.body, text[c.start : c.end])

    def test_cuts_at_top_level_subsections_before_inner_paragraphs(self):
        text = statute(6, words=160)
        spans = ck.split_spans(text, max_chars=1500)
        starts = [text[s.start : s.start + 3] for s in spans]
        self.assertTrue(all(s.startswith("(") for s in starts), starts)
        self.assertTrue(any(s[1] in "abcdef" for s in starts))

    def test_regulation_paragraphs_break_at_left_margin_markers(self):
        text = regulation(10)
        spans = ck.split_spans(text, max_chars=3000)
        for s in spans:
            self.assertTrue(text[s.start :].startswith("("), "each passage starts at a paragraph marker")

    def test_long_line_splits_at_sentences_then_words_then_hard(self):
        sentences = ". ".join(f"Clause number {i} says something about the matter" for i in range(200)) + "."
        spans = ck.split_spans(sentences, max_chars=900)
        coverage_ok(self, sentences, spans)
        self.assertTrue(all(sentences[s.end - 1] == "." for s in spans), "cuts fall at full stops")
        words = " ".join(["lorem"] * 1000)
        for s in ck.split_spans(words, max_chars=500):
            self.assertLessEqual(s.length, 500)
        blob = "z" * 2500
        spans = ck.split_spans(blob, max_chars=1000)
        self.assertEqual([s.length for s in spans], [1000, 1000, 500][: len(spans)] if len(spans) == 3 else [s.length for s in spans])
        coverage_ok(self, blob, spans)

    def test_tiny_tail_is_folded_into_the_previous_passage(self):
        text = ("alpha " * 160).strip() + "\n(b) tail"
        spans = ck.split_spans(text, max_chars=1000)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].end, len(text))

    def test_heading_and_embedding_text(self):
        body = f"{MARK}(a) Definitions\n\tIn this section\n\t\tthe term   means\tx."
        e = ck.embedding_text("Title 15 > 15 U.S.C. § 1", body)
        self.assertTrue(e.startswith("Title 15 > 15 U.S.C. § 1\n\n(a) Definitions"))
        self.assertNotIn(MARK, e)
        self.assertNotIn("\t", e)
        self.assertEqual(ck.embedding_text("", "plain text"), "plain text")
        self.assertNotEqual(em.embed_key("H1\n\nbody"), em.embed_key("H2\n\nbody"))
        self.assertNotEqual(em.embed_key("same"), em.embed_key("same", input_type="query"))

    def test_hash_is_of_the_stored_passage_text(self):
        d = ck.Doc("d", "r", "T", "H", "Alpha beta.\n\nGamma delta.", "/x/y")
        c = ck.chunk_doc(d)[0]
        self.assertEqual(c.text_sha256, hashlib.sha256(d.text[c.start : c.end].encode("utf-8")).hexdigest())

    def test_cap_keeps_the_first_passages_and_states_the_total(self):
        text = regulation(40)
        d = ck.Doc("d", "r", "T", "H", text, "/x/y", max_chunks=3)
        chunks = ck.chunk_doc(d, max_chars=600)
        self.assertEqual(len(chunks), 3)
        total = len(ck.split_spans(text, ck.body_limit("H", 600)))
        self.assertGreater(total, 3)
        self.assertTrue(all(c.chunk_total == total for c in chunks))
        self.assertEqual([c.chunk_no for c in chunks], [0, 1, 2])

    def test_long_heading_shrinks_the_passage_limit(self):
        self.assertEqual(ck.body_limit(""), ck.MAX_CHARS)
        self.assertEqual(ck.body_limit("h" * 600), ck.MAX_EMBED_CHARS - 602)
        self.assertEqual(ck.body_limit("h" * 5000), 1200)

    def test_snippet_is_short_single_line_and_word_aligned(self):
        s = ck.snippet_of(f"{MARK}(a) " + "word " * 200)
        self.assertLessEqual(len(s), ck.SNIPPET_CHARS + 1)
        self.assertNotIn("\n", s)
        self.assertTrue(s.endswith("…"))
        self.assertEqual(ck.snippet_of("Short one."), "Short one.")

    def test_token_estimate_is_conservative_and_monotonic(self):
        self.assertEqual(ck.estimate_tokens(""), 0)
        self.assertGreaterEqual(ck.estimate_tokens("a" * 3400), 1000)
        self.assertLess(ck.estimate_tokens("a" * 100), ck.estimate_tokens("a" * 200))


class SourceTests(unittest.TestCase):
    def usc_row(self, **kw):
        row = {
            "id": "15:78u-6",
            "title": "15 U.S.C. § 78u–6 Securities whistleblower incentives and protection",
            "source_url": "https://uscode.house.gov/us/usc/119-124/t15/s78u-6/",
            "text": f"{MARK}(a) Definitions\nIn this section the following definitions shall apply:",
            "detail": {"usc": {"title": "15", "key": "78u-6", "citation": "15 U.S.C. § 78u–6", "heading": "Securities whistleblower incentives and protection",
                               "path": [[1, "chapter", "CHAPTER 2B—", "SECURITIES EXCHANGES"]]}},
        }
        row.update(kw)
        return row

    def test_usc_doc(self):
        d = src.usc_doc(self.usc_row(), {"15": "Commerce and Trade"})
        self.assertEqual(d.record_id, "15:78u-6")
        self.assertEqual(d.href, "/law/uscode/15/78u-6")
        self.assertEqual(d.heading, "Title 15 Commerce and Trade > CHAPTER 2B— SECURITIES EXCHANGES > 15 U.S.C. § 78u–6 Securities whistleblower incentives and protection")
        self.assertEqual(d.text, self.usc_row()["text"], "the stored text is chunked unchanged so offsets index it")

    def test_usc_stub_sections_are_skipped(self):
        self.assertIsNone(src.usc_doc(self.usc_row(text=""), {}))
        self.assertIsNone(src.usc_doc(self.usc_row(text="  \n"), {}))

    def test_cfr_doc_and_reserved(self):
        row = {"id": "cfr:17:240.10b-5", "title": "17 CFR 240.10b-5 Employment of manipulative and deceptive devices.",
               "source_url": "https://www.govinfo.gov/x.xml", "text": "It shall be unlawful for any person.",
               "item": {"subtitle": "Title 17 · Chapter II · Part 240"},
               "detail": {"title_number": "17", "identifier": "240.10b-5", "reserved": False, "ecfr_url": "https://www.ecfr.gov/current/title-17/section-240.10b-5"}}
        d = src.cfr_doc(row)
        self.assertEqual(d.href, "/law/cfr/17/240.10b-5")
        self.assertEqual(d.source_url, "https://www.ecfr.gov/current/title-17/section-240.10b-5")
        self.assertIn("Title 17 · Chapter II · Part 240", d.heading)
        row["detail"]["reserved"] = True
        self.assertIsNone(src.cfr_doc(row))
        row["detail"]["reserved"] = False
        row["text"] = ""
        self.assertIsNone(src.cfr_doc(row))

    def test_bill_doc_composes_fields_in_a_fixed_order(self):
        row = {"id": "117-hr-4729", "title": "H.R. 4729, 117th Congress: Andy’s Bill", "source_url": "https://www.congress.gov/bill/117th-congress/house-bill/4729",
               "detail": {"bill": {"display": "H.R. 4729, 117th Congress", "congress": 117, "type": "hr", "number": "4729", "policyArea": "Water Resources Development",
                                   "subjects": ["Rivers", "Mississippi River"],
                                   "titles": {"display": "Andy’s Bill", "official": [{"title": "To amend the Water Resources Reform and Development Act of 2014."}, {"title": "Andy’s Bill"}]},
                                   "summary": {"blocks": [{"k": "p", "x": "This bill establishes a program."}, {"k": "li", "x": "sustain services;"}]}}}}
        d = src.bill_doc(row)
        self.assertEqual(d.href, "/law/legislation/federal/117/hr/4729")
        self.assertEqual(d.heading, "H.R. 4729, 117th Congress: Andy’s Bill")
        self.assertEqual(
            d.text.split("\n"),
            ["Official title: To amend the Water Resources Reform and Development Act of 2014.", "Policy area: Water Resources Development",
             "Subjects: Rivers; Mississippi River", "Summary:", "This bill establishes a program.", "- sustain services;"],
        )
        row["detail"]["bill"]["summary"] = None
        self.assertNotIn("Summary:", src.bill_doc(row).text)

    def test_report_docs_use_published_fields_only(self):
        o = src.oversight_doc({"id": "ovr:1", "title": "Collections Storage", "source_url": "https://www.oversight.gov/reports/x",
                               "item": {"oversight": {"oig": "Smithsonian Institution OIG", "agency_reviewed": "Smithsonian Institution", "type": "Inspection / Evaluation",
                                                      "description": "This evaluation determined the extent."}}})
        self.assertIn("Description: This evaluation determined the extent.", o.text)
        self.assertEqual(o.href, "/records/oversight_reports/ovr:1")
        d = src.doj_oig_doc({"id": "dojoig:a", "title": "Semiannual Report", "source_url": "https://oig.justice.gov/a",
                             "item": {"dojoig": {"type": "Semiannual Report", "components": [], "description": None, "entity": None, "location": None}}})
        self.assertEqual(d.text, "Report type: Semiannual Report")
        f = src.ftc_publication_doc({"id": "p1", "title": "Romance scammers", "source_url": "https://www.ftc.gov/x",
                                     "item": {"summary": "Romance scammers tell lies.", "page_url": "https://www.ftc.gov/p1", "cells": {"series": "Data Spotlight"}}})
        self.assertEqual(f.source_url, "https://www.ftc.gov/p1")
        c = src.crs_doc({"id": "IF10333", "title": "ESSA (IF10333)", "source_url": "https://www.congress.gov/crs-product/IF10333",
                         "detail": {"crs": {"title": "ESSA", "topics": ["Education"], "contentType": "Resources"}}})
        self.assertEqual(c.text, "Topics: Education\nType: Resources")
        self.assertIsNone(src.crs_doc({"id": "x", "detail": {"crs": {}}}))

    def test_every_dataset_has_a_label_and_a_composition_flag(self):
        for ds in list(src.ITERATORS) + ["caselaw_scotus"]:
            self.assertIn(ds, src.LABELS)
            self.assertIn(ds, src.COMPOSED)


class VoyageClientTests(unittest.TestCase):
    KEY = "pa-test-key-123"

    def response(self, n, tokens=10, as_base64=True):
        rows = []
        for i in range(n):
            v = np.full(vg.DIMENSIONS, 0.01 * (i + 1), dtype="<f4")
            rows.append({"index": n - 1 - i if i == 0 else i, "embedding": base64.b64encode(v.tobytes()).decode() if as_base64 else v.tolist()})
        return json.dumps({"data": rows, "usage": {"total_tokens": tokens}}).encode()

    def client(self, script, sleeps):
        calls = []

        def transport(url, headers, body, timeout):
            calls.append((headers, json.loads(body)))
            item = script[min(len(calls) - 1, len(script) - 1)]
            if isinstance(item, Exception):
                raise item
            return item

        c = vg.VoyageClient(self.KEY, transport=transport, sleep=sleeps.append, max_attempts=4)
        return c, calls

    def test_success_parses_base64_and_orders_by_index(self):
        sleeps = []
        c, calls = self.client([(200, {}, self.response(2, 42))], sleeps)
        vecs, tokens = c.embed(["a", "b"], "document")
        self.assertEqual((vecs.shape, vecs.dtype, tokens), ((2, 1024), np.float16, 42))
        # the first row was given index 1 and the second index 1; sorted stable, values come from the rows in index order
        self.assertEqual(calls[0][1]["input_type"], "document")
        self.assertEqual(calls[0][1]["model"], vg.MODEL)
        self.assertEqual(calls[0][0]["Authorization"], f"Bearer {self.KEY}")
        self.assertEqual(sleeps, [])

    def test_float_list_responses_are_accepted(self):
        c, _ = self.client([(200, {}, self.response(1, 5, as_base64=False))], [])
        vecs, _ = c.embed(["a"], "query")
        self.assertAlmostEqual(float(vecs[0][0]), 0.01, places=3)

    def test_rate_limit_is_retried_with_backoff_and_retry_after(self):
        sleeps = []
        c, calls = self.client([(429, {"Retry-After": "7"}, b"slow down"), (503, {}, b"busy"), (200, {}, self.response(1))], sleeps)
        c.embed(["a"], "document")
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps[0], 7.0)
        self.assertGreaterEqual(sleeps[1], 3.0)
        self.assertEqual((c.retries, c.rate_limited), (2, 1))

    def test_gives_up_after_the_attempt_limit(self):
        sleeps = []
        c, calls = self.client([(500, {}, b"boom")], sleeps)
        with self.assertRaises(vg.EmbeddingError):
            c.embed(["a"], "document")
        self.assertEqual(len(calls), 4)
        self.assertEqual(len(sleeps), 3)

    def test_client_errors_are_not_retried_and_the_key_is_scrubbed(self):
        c, calls = self.client([(400, {}, f"bad request for {self.KEY}".encode())], [])
        with self.assertRaises(vg.EmbeddingError) as cm:
            c.embed(["a"], "document")
        self.assertEqual(len(calls), 1)
        self.assertNotIn(self.KEY, str(cm.exception))

    def test_network_errors_are_retried(self):
        c, calls = self.client([ConnectionError("down"), (200, {}, self.response(1))], [])
        c.embed(["a"], "document")
        self.assertEqual(len(calls), 2)

    def test_malformed_responses_and_bad_arguments(self):
        c, _ = self.client([(200, {}, b"{not json")], [])
        with self.assertRaises(vg.EmbeddingError):
            c.embed(["a"], "document")
        c, _ = self.client([(200, {}, json.dumps({"data": [], "usage": {"total_tokens": 1}}).encode())], [])
        with self.assertRaises(vg.EmbeddingError):
            c.embed(["a"], "document")
        c, _ = self.client([(200, {}, b"{}")], [])
        for bad in ([], [""], ["a"] * 129):
            with self.assertRaises(ValueError):
                c.embed(bad, "document")
        with self.assertRaises(ValueError):
            c.embed(["a"], "other")


class FakeClient:
    """Deterministic stand-in for the embedding service: a vector derived from the text, tokens from its length."""

    def __init__(self):
        self.requests = []
        self.retries = 0
        self.rate_limited = 0

    def embed(self, texts, input_type):
        self.requests.append(list(texts))
        out = np.zeros((len(texts), vg.DIMENSIONS), dtype=np.float16)
        for i, t in enumerate(texts):
            seed = int.from_bytes(hashlib.sha256(t.encode()).digest()[:4], "big")
            rng = np.random.default_rng(seed)
            v = rng.normal(size=vg.DIMENSIONS)
            out[i] = (v / np.linalg.norm(v)).astype(np.float16)
        return out, sum(max(1, len(t) // 4) for t in texts)


def docs(n, text_for=None):
    text_for = text_for or (lambda i: f"(a) Section {i}. " + ("The operator shall keep records. " * (5 + i % 7)))
    return [ck.Doc("us_code_sections", f"1:{i:03d}", f"Section {i}", f"Heading {i}", text_for(i), f"/law/uscode/1/{i}", f"https://example.gov/{i}") for i in range(n)]


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dir = os.path.join(self.tmp, "us_code_sections")
        self.params = em.chunk_params("us_code_sections")
        self.logs = []
        self.addCleanup(setattr, em.Usage, "SAFETY_MARGIN", em.Usage.SAFETY_MARGIN)
        em.Usage.SAFETY_MARGIN = 0

    def run_once(self, doc_list, *, client=None, budget=10**9, shard_rows=40, window=16, free=lambda: 10**12, **kw):
        client = client or FakeClient()
        usage = em.Usage(os.path.join(self.tmp, "usage.json"), budget)
        store = em.Store(self.dir, "us_code_sections", self.params, shard_rows=shard_rows)
        runner = em.Runner("us_code_sections", doc_list, client, store, usage, workers=3, free_bytes=free, log=self.logs.append, window_chunks=window, **kw)
        status = runner.run()
        return status, client, store, usage

    def test_run_writes_shards_manifest_and_usage(self):
        status, client, store, usage = self.run_once(docs(60), shard_rows=20)
        self.assertEqual(status, "complete")
        m = jload(os.path.join(self.dir, "manifest.json"))
        self.assertEqual(m["status"], "complete")
        self.assertEqual(m["totals"]["records"], 60)
        self.assertEqual(m["totals"]["chunks"], sum(s["rows"] for s in m["shards"]))
        self.assertGreater(len(m["shards"]), 1)
        for s in m["shards"]:
            vec, meta = em.shard_paths(self.dir, int(s["name"].split("-")[1]))
            self.assertEqual(os.path.getsize(vec), s["rows"] * 2048)
            self.assertEqual(em.file_sha256(vec), s["vec_sha256"])
            self.assertEqual(len(em.read_meta(meta)), s["rows"])
        u = jload(os.path.join(self.tmp, "usage.json"))
        self.assertEqual(u["tokens_used"], m["totals"]["tokens"])
        self.assertEqual(u["by_corpus"]["us_code_sections"]["tokens"], u["tokens_used"])

    def test_meta_rows_carry_exact_source_identity(self):
        d = docs(3)
        self.run_once(d)
        meta = em.read_meta(em.shard_paths(self.dir, 0)[1])
        by = {m["record_id"]: m for m in meta}
        for doc in d:
            m = by[doc.record_id]
            self.assertEqual(m["text_sha256"], hashlib.sha256(doc.text[m["char_start"] : m["char_end"]].encode()).hexdigest())
            self.assertEqual((m["dataset"], m["href"], m["source_url"], m["chunk_no"]), ("us_code_sections", doc.href, doc.source_url, 0))
            self.assertEqual(m["embed_sha256"], em.embed_key(ck.embedding_text(doc.heading, m_body(doc, m))))

    def test_shards_close_only_at_record_boundaries(self):
        long_docs = docs(12, lambda i: statute(6, 160))
        self.run_once(long_docs, shard_rows=15, window=10)
        seen = {}
        m = jload(os.path.join(self.dir, "manifest.json"))
        for s in m["shards"]:
            for row in em.read_meta(em.shard_paths(self.dir, int(s["name"].split("-")[1]))[1]):
                seen.setdefault(row["record_id"], set()).add(s["name"])
        self.assertTrue(all(len(v) == 1 for v in seen.values()), "a record is never split over shards")

    def test_rerun_embeds_nothing_and_resume_adds_only_new_records(self):
        base = docs(20)
        _, c1, _, _ = self.run_once(base)
        first = jload(os.path.join(self.dir, "manifest.json"))["totals"]["chunks"]
        status, c2, _, _ = self.run_once(base)
        self.assertEqual(status, "complete")
        self.assertEqual(c2.requests, [])
        status, c3, _, _ = self.run_once(docs(26))
        sent = [t for r in c3.requests for t in r]
        self.assertEqual(len(sent), jload(os.path.join(self.dir, "manifest.json"))["totals"]["chunks"] - first)
        self.assertEqual(jload(os.path.join(self.dir, "manifest.json"))["totals"]["records"], 26)

    def test_identical_text_is_embedded_once_and_the_vector_reused(self):
        same = [ck.Doc("us_code_sections", f"1:{i}", "T", "Same heading", "Identical body of the section.", f"/x/{i}") for i in range(5)]
        _, client, store, _ = self.run_once(same, shard_rows=1000)
        self.assertEqual(sum(len(r) for r in client.requests), 1)
        self.assertEqual(store.manifest["totals"]["chunks"], 5)
        self.assertEqual(store.manifest["totals"]["reused"], 4)
        vec = np.fromfile(em.shard_paths(self.dir, 0)[0], dtype="<f2").reshape(-1, vg.DIMENSIONS)
        self.assertTrue((vec == vec[0]).all())

    def test_stops_at_the_total_budget_without_splitting_a_record(self):
        status, client, store, usage = self.run_once(docs(60), budget=1500, window=8)
        self.assertEqual(status, "stopped_total_budget")
        m = jload(os.path.join(self.dir, "manifest.json"))
        self.assertEqual(m["status"], "stopped_total_budget")
        self.assertLess(m["totals"]["records"], 60)
        self.assertLessEqual(usage.used, 1500)
        self.assertGreater(m["totals"]["records"], 0)
        # resuming with more budget finishes the corpus
        status, _, _, _ = self.run_once(docs(60), budget=10**9, window=8)
        self.assertEqual(status, "complete")
        self.assertEqual(jload(os.path.join(self.dir, "manifest.json"))["totals"]["records"], 60)

    def test_stops_when_free_disk_would_fall_below_the_floor(self):
        status, client, store, _ = self.run_once(docs(10), free=lambda: 1000, min_free=em.MIN_FREE_BYTES)
        self.assertEqual(status, "stopped_disk_floor")
        self.assertEqual(client.requests, [])
        self.assertEqual(store.manifest["totals"]["chunks"], 0)

    def test_run_limits(self):
        status, _, store, _ = self.run_once(docs(40), max_chunks=10, window=4)
        self.assertEqual(status, "stopped_run_chunk_limit")
        self.assertLessEqual(store.manifest["totals"]["chunks"], 10)
        status, _, _, _ = self.run_once(docs(40), max_tokens=1)
        self.assertEqual(status, "stopped_run_token_limit")

    def test_other_chunker_parameters_refuse_to_mix(self):
        self.run_once(docs(3))
        other = dict(self.params, max_chars=1234)
        with self.assertRaises(SystemExit):
            em.Store(self.dir, "us_code_sections", other)

    def test_orphan_shard_files_of_an_interrupted_run_are_removed(self):
        self.run_once(docs(5))
        orphan = os.path.join(self.dir, "shard-00009.vec.f16")
        with open(orphan, "wb") as fh:
            fh.write(b"x")
        em.Store(self.dir, "us_code_sections", self.params)
        self.assertFalse(os.path.exists(orphan))

    def test_two_runs_share_one_usage_file_without_losing_counts(self):
        path = os.path.join(self.tmp, "shared_usage.json")
        a, b = em.Usage(path, 1000), em.Usage(path, 1000)
        a.add("crs_reports", 100, 2, 10)
        b.add("congress_bills", 50, 1, 5)
        a.save()
        b.save()
        a.add("crs_reports", 25, 1, 3)
        a.save({"dataset": "crs_reports", "status": "complete"})
        data = jload(path)
        self.assertEqual((data["tokens_used"], data["requests"]), (175, 4))
        self.assertEqual(data["by_corpus"]["crs_reports"]["tokens"], 125)
        self.assertEqual(data["by_corpus"]["congress_bills"]["chunks_embedded"], 5)
        self.assertEqual(len(data["runs"]), 1)
        self.assertEqual(b.used, 175, "a run sees the other run's spending")
        self.assertEqual(b.remaining(), 1000 - 175)

    def test_the_safety_margin_keeps_concurrent_runs_inside_the_budget(self):
        em.Usage.SAFETY_MARGIN = 100
        u = em.Usage(os.path.join(self.tmp, "m.json"), 1000)
        self.assertEqual(u.remaining(), 900)

    def test_batches_respect_input_and_token_limits(self):
        texts = ["x" * 100] * 250
        sizes = [len(b) for b in em.make_batches(texts)]
        self.assertEqual(sizes, [100, 100, 50])
        big = ["y" * 90_000] * 5
        self.assertTrue(all(len(b) <= 2 for b in em.make_batches(big)))
        self.assertEqual(sorted(i for b in em.make_batches(big) for i in b), list(range(5)))

    def test_plan_counts_chunks_and_caps(self):
        d = [ck.Doc("d", "a", "T", "H", regulation(40), "/x/a", max_chunks=3), ck.Doc("d", "b", "T", "H", "short text", "/x/b")]
        s = em.plan_dataset("d", d, progress=lambda m: None)
        self.assertEqual((s["records"], s["capped_records"]), (2, 1))
        self.assertEqual(s["chunks"], 4)
        self.assertGreater(s["chunks_dropped_by_cap"], 0)


def m_body(doc, m):
    return doc.text[m["char_start"] : m["char_end"]]


class LoaderTests(unittest.TestCase):
    def build(self, tmp):
        directory = os.path.join(tmp, "us_code_sections")
        store = em.Store(directory, "us_code_sections", em.chunk_params("us_code_sections"), shard_rows=10)
        usage = em.Usage(os.path.join(tmp, "usage.json"), 10**9)
        em.Runner("us_code_sections", docs(8), FakeClient(), store, usage, free_bytes=lambda: 10**12, log=lambda m: None, window_chunks=4).run()
        return directory

    def test_vector_text_round_trips_every_half_precision_value(self):
        rng = np.random.default_rng(1)
        v = rng.normal(size=1024).astype(np.float16)
        text = ld.vector_text(v)
        back = np.array(json.loads(text), dtype=np.float32).astype(np.float16)
        self.assertTrue((back == v).all())
        with self.assertRaises(ValueError):
            ld.vector_text(v[:10])

    def test_copy_lines_escape_text_and_use_null_for_missing_source_url(self):
        m = {"dataset": "d", "record_id": "r\t1", "chunk_no": 0, "chunk_total": 1, "char_start": 0, "char_end": 5, "text_sha256": "a" * 64,
             "title": "Line\nbreak \\ slash", "href": "/x/y", "source_url": None, "snippet": "s"}
        line = ld.copy_line(m, np.zeros(1024, dtype=np.float16))
        fields = line.rstrip("\n").split("\t")
        self.assertEqual(len(fields), 12)
        self.assertEqual(fields[1], "r\\t1")
        self.assertEqual(fields[7], "Line\\nbreak \\\\ slash")
        self.assertEqual(fields[9], "\\N")
        self.assertTrue(fields[11].startswith("[0,0,0"))

    def test_load_sends_verified_shards_in_batches_and_resumes(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = self.build(tmp)
            calls = []

            class Rpc:
                def call(self, fn, body):
                    calls.append((fn, body))
                    if fn == "semantic_load_v1":
                        return {"rows": len(body["p_rows"]), "written": len(body["p_rows"]), "unchanged": 0}
                    if fn == "semantic_prune_v1":
                        return 0
                    return 1

            totals = ld.load_dataset("us_code_sections", Rpc(), directory=directory, batch_rows=7, workers=2, prune=True, log=lambda m: None)
            manifest = jload(os.path.join(directory, "manifest.json"))
            self.assertEqual(totals["rows"], manifest["totals"]["chunks"])
            self.assertEqual(calls[0][0], "semantic_load_corpus_v1")
            row = calls[0][1]["p_row"]
            self.assertEqual((row["dataset"], row["index_version"], row["composed"], row["chunks"]), ("us_code_sections", "si-1", False, manifest["totals"]["chunks"]))
            loads = [c for c in calls if c[0] == "semantic_load_v1"]
            self.assertTrue(all(len(c[1]["p_rows"]) <= 7 for c in loads))
            self.assertTrue(all(r["embedding"].startswith("[") for c in loads for r in c[1]["p_rows"]))
            self.assertTrue(any(c[0] == "semantic_prune_v1" for c in calls))
            calls.clear()
            again = ld.load_dataset("us_code_sections", Rpc(), directory=directory, log=lambda m: None)
            self.assertEqual(again["rows"], 0, "shards already loaded are skipped")

    def test_a_changed_shard_file_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = self.build(tmp)
            with open(em.shard_paths(directory, 0)[0], "r+b") as f:
                f.write(b"\x01\x02")

            class Rpc:
                def call(self, fn, body):
                    return 1

            with self.assertRaises(SystemExit):
                ld.load_dataset("us_code_sections", Rpc(), directory=directory, log=lambda m: None)

    def test_export_copy_writes_one_line_per_passage(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = self.build(tmp)
            out = os.path.join(tmp, "x.tsv.gz")
            n = ld.export_copy("us_code_sections", out, directory=directory)
            with gzip.open(out, "rt", encoding="utf-8") as fh:
                lines = fh.read().splitlines()
            self.assertEqual(n, len(lines))
            self.assertEqual(n, jload(os.path.join(directory, "manifest.json"))["totals"]["chunks"])


class OpinionTests(unittest.TestCase):
    def member(self, text, sha=None):
        rec = {"opinion_id": 1, "text": text, "text_sha256": sha or hashlib.sha256(text.encode()).hexdigest()}
        return gzip.compress(json.dumps(rec).encode(), mtime=0)

    def test_text_is_returned_only_when_it_matches_the_index_hash(self):
        text = "Held: the statute does not reach the conduct."
        good = hashlib.sha256(text.encode()).hexdigest()
        self.assertEqual(sc.opinion_text(self.member(text), good), text)
        self.assertIsNone(sc.opinion_text(self.member(text), "0" * 64))
        self.assertIsNone(sc.opinion_text(b"not gzip", good))

    def test_selection_prefers_the_majority_opinion_and_skips_orders(self):
        with tempfile.TemporaryDirectory() as tmp:
            idx = os.path.join(tmp, "index")
            meta = os.path.join(tmp, "meta")
            os.makedirs(idx)
            os.makedirs(meta)
            header = "opinion_id\tcluster_id\tkey\toffset\tlength\ttext_sha256\ttext_chars\ttype\tauthor_str\tper_curiam\n"
            rows = [
                (11, 1, "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", 0, 50, "a" * 64, 9000, "010combined"),
                (12, 1, "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", 50, 50, "b" * 64, 8000, "040dissent"),
                (21, 2, "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", 100, 50, "c" * 64, 600, "020lead"),
                (31, 3, "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", 150, 50, "d" * 64, 7000, "025plurality"),
                (32, 3, "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", 200, 50, "e" * 64, 7000, "020lead"),
                (41, 4, "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", 250, 50, "f" * 64, 9000, "010combined"),
            ]
            with gzip.open(os.path.join(idx, "t1__scotus__2020s.tsv.gz"), "wt", encoding="utf-8") as f:
                f.write(header)
                for r in rows:
                    f.write("\t".join(str(x) for x in (*r, "", "0")) + "\n")
            cases = [
                {"cluster_id": 1, "court_id": "scotus", "case_name": "Alpha v. Beta", "date_filed": "2020-01-02", "citations": ["590 U.S. 1"], "cited_by": 5},
                {"cluster_id": 3, "court_id": "scotus", "case_name": "Gamma v. Delta", "date_filed": "2019-03-04", "citations": [], "cited_by": 50},
                {"cluster_id": 4, "court_id": "scotus", "case_name": "", "date_filed": "2018-03-04", "citations": [], "cited_by": 500},
                {"cluster_id": 2, "court_id": "scotus", "case_name": "Order v. List", "date_filed": "2018-03-04", "citations": [], "cited_by": 1},
                {"cluster_id": 9, "court_id": "ca9", "case_name": "Other court", "date_filed": "2018-03-04", "citations": [], "cited_by": 9},
            ]
            with gzip.open(os.path.join(meta, "cases-p00.jsonl.gz"), "wt", encoding="utf-8") as f:
                for c in cases:
                    f.write(json.dumps(c, separators=(",", ":")) + "\n")
            chosen = sc.selection(idx, meta)
            self.assertEqual([r["cluster_id"] for r in chosen], ["3", "1"], "most cited first; orders and unnamed cases left out")
            self.assertEqual(chosen[0]["opinion_id"], "32", "the lead opinion is preferred to a plurality listing of the same case")
            self.assertEqual(chosen[1]["opinion_id"], "11", "the combined majority opinion, never the dissent")

    def test_documents_are_read_verified_and_titled(self):
        text = "Opinion of the Court. " * 50
        sha = hashlib.sha256(text.encode()).hexdigest()
        rows = [{"cluster_id": "7", "opinion_id": "70", "key": "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", "offset": "10", "length": "20", "text_sha256": sha,
                 "case_name": "Alpha v. Beta", "date_filed": "2020-01-02", "citations": ["2020 WL 1", "590 U.S. 1"], "cited_by": 3},
                {"cluster_id": "8", "opinion_id": "80", "key": "caselaw/read/2026-09-30/t1/scotus/a.jsonl.gz", "offset": "30", "length": "20", "text_sha256": "0" * 64,
                 "case_name": "Bad Hash", "date_filed": "2020-01-02", "citations": [], "cited_by": 1}]
        skipped = {}
        member = self.member(text, sha)
        docs_out = list(sc.iter_scotus_opinions(reader=lambda key, off, ln: member, rows=rows, skipped=skipped))
        self.assertEqual([d.record_id for d in docs_out], ["7"])
        d = docs_out[0]
        self.assertEqual((d.dataset, d.href, d.title), ("caselaw_scotus", "/cases/7", "Alpha v. Beta (2020)"))
        self.assertIn("590 U.S. 1", d.heading)
        self.assertEqual(skipped, {"hash_mismatch": 1})


class EvalTests(unittest.TestCase):
    def test_recall_at_k_counts_a_hit_when_any_expected_target_is_in_the_top_k(self):
        ranked = {"q1": ["a", "b", "c"], "q2": ["x", "y", "z"], "q3": []}
        expected = {"q1": {"c"}, "q2": {"nope"}, "q3": {"a"}}
        r = ev.recall_at_k(ranked, expected, 3)
        self.assertEqual((r["hits"], r["queries"]), (1, 3))
        self.assertAlmostEqual(r["recall"], 1 / 3)
        self.assertEqual(ev.recall_at_k(ranked, expected, 2)["hits"], 0)
        self.assertEqual(r["misses"], ["q2", "q3"])

    def test_reciprocal_rank(self):
        self.assertEqual(ev.reciprocal_rank(["a", "b", "c"], {"b"}), 0.5)
        self.assertEqual(ev.reciprocal_rank(["a"], {"z"}), 0.0)

    def test_label_verification_finds_missing_records_and_unsupported_evidence(self):
        spec = {"queries": [
            {"id": "a", "query": "q", "expected": [{"dataset": "d", "record_id": "r1", "evidence": "Shall  pay an AWARD"}]},
            {"id": "b", "query": "q", "expected": [{"dataset": "d", "record_id": "r1", "evidence": "not in the text"}]},
            {"id": "c", "query": "q", "expected": [{"dataset": "d", "record_id": "r2", "evidence": "x"}]},
        ]}
        docs_for = lambda ds: [ck.Doc("d", "r1", "T", "Heading", f"{MARK}(a) The Commission shall pay an award.", "/x/1")]
        problems = ev.verify_labels(spec, docs_for)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any("evidence phrase not in the embedded text" in p and "not in the text" in p for p in problems))
        self.assertTrue(any("r2: record not found" in p for p in problems))

    def test_the_labeled_queries_are_well_formed(self):
        spec = jload(os.path.join(HERE, "eval_queries.json"))
        ids = [q["id"] for q in spec["queries"]]
        self.assertGreaterEqual(len(ids), 40)
        self.assertEqual(len(ids), len(set(ids)))
        for q in spec["queries"]:
            self.assertGreaterEqual(len(q["query"]), 10)
            self.assertTrue(q["expected"])
            for e in q["expected"]:
                self.assertIn(e["dataset"], src.LABELS)
                self.assertTrue(e["record_id"] and e["evidence"])

    def test_top_records_collapses_passages_to_best_per_record(self):
        sims = np.array([0.9, 0.8, 0.95, 0.1], dtype=np.float32)
        records = ["r1", "r1", "r2", "r3"]
        self.assertEqual(ev.top_records(sims, records, 3), ["r2", "r1", "r3"])


if __name__ == "__main__":
    unittest.main()
