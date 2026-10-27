"""Offline tests for the documents text-extraction backlog (worklist, summary, verify, SQL contract, extractor credentials).

Run: cd scripts/documents && python3 -B -m unittest -v test_text_backlog
No network, no credentials, no database: the RPC is faked and the SQL contract is checked as text.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "pdf_text"))

import text_backlog as tb  # noqa: E402
import pdf_text_extract as px  # noqa: E402

CONTRACT = ROOT / "database" / "contracts" / "documents-text-backlog-v1.sql"
ROLLBACK = ROOT / "database" / "contracts" / "documents-text-backlog-v1.rollback.sql"


def sha(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def row(label: str, rank: int, filed: str | None = None, **over) -> dict:
    s = sha(label)
    base = {"sha256": s, "bytes": 1000, "bucket": "corpus-originals", "storage_key": "seeger-weiss/pdf-sha256/" + s[:2] + "/" + s + ".pdf",
            "rank": rank, "sources": [{1: "official-court", 2: "courtlistener"}.get(rank, "docketbird")],
            "collections": ["court_mdl_pages" if rank == 1 else "docket_filings"], "mdls": ["2738"], "documents": 1,
            "latest_filed": filed, "open": True}
    base.update(over)
    return base


class Ordering(unittest.TestCase):
    def test_court_pages_first_then_courtlistener_then_docketbird_newest_first(self):
        rows = [row("db-old", 3, "2019-01-01"), row("cl", 2, "2024-05-01"), row("oc-undated", 1), row("db-new", 3, "2025-12-31"),
                row("oc-new", 1, "2026-10-01"), row("oc-old", 1, "2001-02-03")]
        kept, dropped = tb.order_rows(rows)
        self.assertEqual([r["sha256"] for r in kept],
                         [sha("oc-new"), sha("oc-old"), sha("oc-undated"), sha("cl"), sha("db-new"), sha("db-old")])
        self.assertEqual(dropped, {"bad_sha": 0, "duplicate": 0, "no_object": 0, "not_open": 0})

    def test_unusable_rows_are_dropped_and_counted_never_guessed(self):
        rows = [row("a", 3), row("a", 3), row("b", 3, storage_key=None), row("c", 3, open=False), {"sha256": "XYZ", "rank": 1}, row("d", 2)]
        kept, dropped = tb.order_rows(rows)
        self.assertEqual([r["sha256"] for r in kept], [sha("d"), sha("a")])
        self.assertEqual(dropped, {"bad_sha": 1, "duplicate": 1, "no_object": 1, "not_open": 1})

    def test_checksum_matches_the_sql_definition(self):
        shas = [sha(str(i)) for i in range(5)]
        # SQL: md5(string_agg(sha256, E'\n' order by sha256 collate "C"))
        expected = hashlib.md5("\n".join(sorted(shas)).encode()).hexdigest()
        self.assertEqual(tb.checksum(reversed(shas)), expected)

    def test_summary_counts_by_rank_source_and_collection(self):
        rows = [row("x", 1, documents=2, bytes=10), row("y", 3, bytes=5, mdls=["3043", "3081"]), row("z", 3, bytes=7)]
        s = tb.summarize(rows)
        self.assertEqual(s["shas"], 3)
        self.assertEqual(s["documents"], 4)
        self.assertEqual(s["bytes"], 22)
        self.assertEqual(s["by_rank"], {"1": {"shas": 1, "documents": 2, "bytes": 10}, "3": {"shas": 2, "documents": 2, "bytes": 12}})
        self.assertEqual(s["shas_by_source"], {"docketbird": 2, "official-court": 1})
        self.assertEqual(s["shas_by_collection"], {"court_mdl_pages": 1, "docket_filings": 2})
        self.assertEqual(s["mdls_listed"], 3)
        self.assertEqual(s["held_shas"], 0)
        self.assertEqual(s["md5_not_extracted_only"], s["md5_sorted_sha_list"])

    def test_held_byte_sets_go_last_and_have_their_own_checksum(self):
        rows = [row("held", 4, "2026-10-20", held=True, statuses=["withheld_policy"]), row("db", 3, "2001-01-01"), row("oc", 1)]
        kept, _ = tb.order_rows(rows)
        self.assertEqual([r["sha256"] for r in kept][-1], sha("held"))
        s = tb.summarize(kept)
        self.assertEqual(s["held_shas"], 1)
        self.assertEqual(s["md5_not_extracted_only"], tb.checksum([sha("db"), sha("oc")]))
        self.assertEqual(s["md5_sorted_sha_list"], tb.checksum([sha("db"), sha("oc"), sha("held")]))


class Paging(unittest.TestCase):
    def test_pages_until_empty_and_sends_the_last_key(self):
        rows = sorted((row(str(i), 3) for i in range(5)), key=lambda r: r["sha256"])
        calls = []

        def fake(fn, body):
            calls.append((fn, dict(body)))
            after = body["p_after"]
            batch = [r for r in rows if r["sha256"] > after][: body["p_limit"]]
            return {"rows": batch, "last": batch[-1]["sha256"] if batch else None}

        got = tb.fetch_backlog(fake, page=2)
        self.assertEqual([r["sha256"] for r in got], [r["sha256"] for r in rows])
        self.assertEqual([c[0] for c in calls], ["documents_text_backlog_v1"] * 4)
        self.assertEqual(calls[1][1]["p_after"], rows[1]["sha256"])

    def test_a_page_that_does_not_advance_stops_the_run(self):
        r = row("stuck", 3)
        with self.assertRaises(RuntimeError):
            tb.fetch_backlog(lambda fn, body: {"rows": [r], "last": ""}, page=1)


class Verify(unittest.TestCase):
    def test_tally_reports_every_state_and_only_stored_is_done(self):
        wl = [row(n, 3) for n in ("ok", "ocr", "fail", "never", "refused", "transport")]
        s = {n: sha(n) for n in ("ok", "ocr", "fail", "never", "refused", "transport")}
        text = [{"sha256": s["ok"], "status": "failed"}, {"sha256": s["ok"], "status": "complete"},
                {"sha256": s["ocr"], "status": "partial_ocr_pending"}, {"sha256": s["fail"], "status": "failed"},
                {"sha256": s["refused"], "status": "complete"}, {"sha256": s["transport"], "status": "no_text"}]
        load = [{"sha256": s["ok"], "result": "stored"}, {"sha256": s["ocr"], "result": "stored"},
                {"sha256": s["refused"], "result": "not_open_scope"}, {"sha256": s["transport"], "result": "transport_error"}]
        out = tb.tally(wl, text, load)
        c = out["counts"]
        self.assertEqual((c["extracted"], c["extract_failed"], c["not_attempted"]), (4, 1, 1))
        self.assertEqual((c["stored"], c["load_refused"], c["load_error"], c["not_loaded"]), (2, 1, 1, 2))
        self.assertEqual(c["extract_status"], {"complete": 2, "no_text": 1, "partial_ocr_pending": 1})
        self.assertFalse(c["complete"])
        self.assertEqual(sorted(r["sha256"] for r in out["retry"]), sorted([s["fail"], s["never"], s["refused"], s["transport"]]))

    def test_verify_command_exit_code_and_retry_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            wl = tmp / "worklist.jsonl"
            staging = tmp / "staging"
            staging.mkdir()
            rows = [row("a", 1), row("b", 3)]
            tb.write_jsonl(wl, rows)
            tb.write_jsonl(staging / "text-receipts.jsonl", [{"sha256": r["sha256"], "status": "complete"} for r in rows])
            tb.write_jsonl(staging / "load-receipts.jsonl", [{"sha256": rows[0]["sha256"], "result": "stored"}])
            self.assertEqual(tb.main(["verify", "--worklist", str(wl), "--staging", str(staging)]), 1)
            retry = tb.read_jsonl(tmp / "worklist.jsonl.retry.jsonl")
            self.assertEqual([r["sha256"] for r in retry], [rows[1]["sha256"]])
            with (staging / "load-receipts.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"sha256": rows[1]["sha256"], "result": "stored"}) + "\n")
            self.assertEqual(tb.main(["verify", "--worklist", str(wl), "--staging", str(staging)]), 0)
            self.assertEqual(tb.read_jsonl(tmp / "worklist.jsonl.retry.jsonl"), [])

    def test_receipts_and_summary_never_carry_page_text(self):
        out = tb.summarize([row("a", 1)])
        self.assertNotIn("text", json.dumps(out).replace("md5_sorted_sha_list", ""))


class Contract(unittest.TestCase):
    sql = CONTRACT.read_text(encoding="utf-8")
    rollback = ROLLBACK.read_text(encoding="utf-8")

    def test_function_is_read_only_definer_with_empty_search_path_and_service_role_only(self):
        self.assertIn("create or replace function public.documents_text_backlog_v1(p_after text default '', p_limit integer default 2000)", self.sql)
        self.assertRegex(self.sql, r"language plpgsql stable security definer set search_path = ''")
        self.assertIn("revoke all on function public.documents_text_backlog_v1(text, integer) from public, anon, authenticated;", self.sql)
        self.assertIn("grant execute on function public.documents_text_backlog_v1(text, integer) to service_role;", self.sql)
        body = self.sql.split("as $$", 1)[1].split("end $$;", 1)[0].lower()
        for verb in ("insert ", "update ", "delete ", "truncate ", "alter ", "drop ", "create "):
            self.assertNotIn(verb, body, verb)

    def test_scope_is_every_listed_byte_set_without_stored_text_held_last_and_paging_is_bounded(self):
        body = self.sql.split("as $$", 1)[1]
        self.assertIn("d.text_status in ('not_extracted', 'withheld_policy')", body)
        self.assertIn("not exists (select 1 from corpus_ingest.pdf_texts t where t.sha256 = d.sha256)", body)
        self.assertIn("case when bool_or(d.text_status = 'withheld_policy') then 4", body)
        self.assertIn("'held', b.held", body)
        self.assertIn("p_limit not between 1 and 5000", body)
        self.assertIn("public.corpus_pdf_availability_v1(a.source_system, a.provider_flags) = 'open'", body)
        self.assertEqual(len(re.findall(r'collate "C"', body)) >= 3, True)

    def test_rollback_drops_only_this_function(self):
        code = [s.strip() for s in re.sub(r"--[^\n]*", "", self.rollback).split(";") if s.strip()]
        self.assertEqual(code, ["begin", "drop function if exists public.documents_text_backlog_v1(text, integer)", "commit"])


class WorklistProjectPin(unittest.TestCase):
    def test_worklist_refuses_another_project(self):
        import os
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"EXTERNAL_SUPABASE_URL": "https://other.supabase.co"}):
            self.assertEqual(tb.main(["worklist", "--out", str(Path(tmp, "w.jsonl"))]), 2)
            self.assertFalse(Path(tmp, "w.jsonl").exists())
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(tb.main(["worklist", "--out", str(Path(tmp, "w.jsonl"))]), 2)


class ExtractorCredentials(unittest.TestCase):
    URL = "https://xosqzzsnhxcyehcnirpa.supabase.co"

    def test_environment_only_right_project_and_a_server_key(self):
        with self.assertRaises(SystemExit):
            px.bucket_credentials({})
        with self.assertRaises(SystemExit):
            px.bucket_credentials({"EXTERNAL_SUPABASE_URL": "https://other.supabase.co", "EXTERNAL_SUPABASE_KEY": "sb_secret_x"})
        with self.assertRaises(SystemExit):
            px.bucket_credentials({"EXTERNAL_SUPABASE_URL": self.URL, "EXTERNAL_SUPABASE_KEY": "sb_publishable_x"})
        url, key = px.bucket_credentials({"EXTERNAL_SUPABASE_URL": self.URL + "/", "EXTERNAL_SUPABASE_SERVICE_ROLE_KEY": "sb_secret_y",
                                          "EXTERNAL_SUPABASE_KEY": "sb_secret_x"})
        self.assertEqual((url, key), (self.URL, "sb_secret_y"))

    def test_local_copies_are_hash_verified_and_no_bucket_needs_no_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = b"%PDF-1.4 good bytes"
            s = hashlib.sha256(good).hexdigest()
            Path(tmp, s + ".pdf").write_bytes(good)
            bad = b"%PDF-1.4 other bytes"
            fake = sha("claimed")
            Path(tmp, fake + ".pdf").write_bytes(bad)
            f = px.Fetcher([tmp], use_bucket=False, max_bytes=1 << 20, env={})
            self.assertEqual(f.get({"sha256": s, "bytes": len(good)}), (good, "local"))
            with self.assertRaises(px.Missing):
                f.get({"sha256": fake})
            self.assertEqual(px.default_key(s), "seeger-weiss/pdf-sha256/" + s[:2] + "/" + s + ".pdf")


if __name__ == "__main__":
    unittest.main()
