import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import sc_common as sc  # noqa: E402
import to_landing  # noqa: E402

URL = "https://example.test/code/t1"
CFG = {"jurisdiction": "ZZ", "publisher": "Fixture Publisher", "publisher_url": "https://example.test/", "source_system": "zz-code",
       "code_title": "Fixture Code", "parser": {"name": "zz-fixture", "version": "1"}, "source_url_patterns": ["^https://example\\.test/code/"],
       "structure": {"levels": ["title", "section"], "unit": "one publisher page"},
       "section_id": {"scheme": "official_citation_path", "regex": "^[0-9]+\\.[0-9]+(~[0-9]+)?$", "example": "1.01", "citation_format": "Fixture § <path>"},
       "currency": {"basis": "publisher_statement", "location": "page footer"}, "review": {"reviewed_by": "test", "reviewed_at": "2026-10-06"},
       "currency_defaults": {"basis": "publisher_statement", "statement": "Current through October 1, 2026", "through_date": "2026-10-01", "edition": "2026"}}


def stage(work, route="direct", raws=1):
    raw = b"<html>fixture</html>"
    sha = sc.sha256_hex(raw)
    os.makedirs(os.path.join(work, "raw"), exist_ok=True)
    open(os.path.join(work, "raw", "a"), "wb").write(raw)
    rec = {"url": URL, "http_status": 200, "retrieved_at": "2026-10-06T10:00:00Z", "bytes": len(raw), "route": route, "state": "complete",
           "sha256": sha, "file": "raw/a"}
    open(os.path.join(work, "receipts.jsonl"), "w").write(json.dumps(rec) + "\n")
    text = "Title 1\n1.01 One. Alpha.\n1.02 [Reserved]\n1.03 \n1.01 One again.\n"
    shas = [sha] * raws
    chapters = [{"native_id": "title 1/x", "heading": "Title 1", "text": text, "raw_sha256s": shas, "source_urls": [URL]}]
    def sec(num, body, label=None):
        a = text.index(body)
        return {"chapter_native_id": "title 1/x", "citation": f"Fixture § {num}", "citation_path": num, "heading": None, "start": a, "end": a + len(body),
                "history": None, "status_label": label, "hierarchy": [{"level": "title", "number": "1", "heading": "Title 1"}, {"level": "section", "number": num, "heading": None}]}
    secs = [sec("1.01", "1.01 One. Alpha.\n"), sec("1.02", "1.02 [Reserved]\n", "[Reserved]"), sec("1.01", "1.01 One again.\n")]
    sc.write_packet(work, "ZZ", source="fixture", edition="2026", chapters=chapters, sections=secs)


class ToLanding(unittest.TestCase):
    def test_conversion(self):
        with tempfile.TemporaryDirectory() as work:
            stage(work)
            r = to_landing.convert(work, CFG)
            self.assertEqual((r["units"], r["sections"], r["objects"], r["gaps_no_text"]), (1, 3, 2, 0))
            secs = [json.loads(x) for x in open(os.path.join(work, "landing", "sections.jsonl"), encoding="utf-8")]
            self.assertEqual([s["citation_path"] for s in secs], ["1.01", "1.02", "1.01~2"])
            self.assertEqual(secs[1]["status_note"], "[Reserved]")
            self.assertIn("[Reserved]", secs[1]["text"])
            self.assertEqual(secs[0]["span"]["unit"], "unicode_code_points")
            objs = [json.loads(x) for x in open(os.path.join(work, "landing", "objects.jsonl"))]
            self.assertEqual({o["kind"] for o in objs}, {"publisher_original", "unit_text_derivative"})
            unit = json.loads(open(os.path.join(work, "landing", "units.jsonl")).readline())
            self.assertEqual(unit["unit_key"], "title_1_x")
            self.assertEqual(unit["retrieval_method"], "publisher_page")

    def test_literally_empty_section_is_a_gap_and_proxy_is_recorded(self):
        with tempfile.TemporaryDirectory() as work:
            stage(work, route="firecrawl")
            sp = os.path.join(work, "packet", "sections.jsonl")
            rows = [json.loads(x) for x in open(sp, encoding="utf-8")]
            ch = json.loads(open(os.path.join(work, "packet", "chapters.jsonl"), encoding="utf-8").readline())
            text = open(os.path.join(work, "packet", "chapter-text", ch["text_sha256"] + ".txt"), encoding="utf-8").read()
            rows[1]["start"] = rows[1]["end"] = text.index("1.03 ")
            rows[1]["text_sha256"] = sc.sha256_hex("")
            rows[1]["citation_path"] = "1.03"
            open(sp, "w", encoding="utf-8").write("".join(json.dumps(r) + "\n" for r in rows))
            r = to_landing.convert(work, CFG)
            self.assertEqual((r["sections"], r["gaps_no_text"]), (2, 1))
            unit = json.loads(open(os.path.join(work, "landing", "units.jsonl")).readline())
            self.assertEqual((unit["retrieval_method"], unit["proxy"]), ("proxied_fetch", "firecrawl"))

    def test_unit_from_several_originals_is_refused(self):
        with tempfile.TemporaryDirectory() as work:
            stage(work, raws=2)
            with self.assertRaises(SystemExit):
                to_landing.convert(work, CFG)


if __name__ == "__main__":
    unittest.main()
