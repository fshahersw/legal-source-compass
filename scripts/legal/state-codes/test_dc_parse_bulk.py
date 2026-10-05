import importlib.util
from pathlib import Path
import unittest
import io
import json
import tarfile
import tempfile

spec = importlib.util.spec_from_file_location("dc_parser", Path(__file__).with_name("dc-parse-bulk.py"))
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)


class PublisherArticleTests(unittest.TestCase):
    def test_full_text_retains_notes_and_inline_citations_without_navigation(self):
        raw = '''<meta property="og:url" content="https://code.dccouncil.gov/us/dc/council/code/sections/12-301"/>
        <nav>irrelevant site text</nav><article class="content"><div>
        <h1 id="/us/dc/council/code/sections/12-301">§ 12–301. Limitation.</h1>
        <p><span>(a)</span> Body <a href="/source#x">§ 1</a> — 😀.</p>
        <aside><h4>History</h4><p>Complete later note.</p></aside>
        <script>untrustedCode()</script></div></article><footer>site footer</footer>'''.encode()
        result = dc.parse_article(raw)
        self.assertEqual(result["text"], "§ 12–301. Limitation.\n(a) Body § 1 — 😀.\nHistory\nComplete later note.")
        self.assertEqual(result["links"], ["/source#x"])
        self.assertEqual(result["title"], "§ 12–301. Limitation.")

    def test_missing_or_multiple_articles_fail(self):
        for raw in [b"<html>No statute</html>", b'<article class="content">x</article><article class="content">y</article>']:
            with self.assertRaises(ValueError):
                dc.parse_article(raw)

    def test_invalid_utf8_fails_instead_of_replacement_characters(self):
        with self.assertRaises(UnicodeDecodeError):
            dc.parse_article(b"\xff")

    def test_member_paths_are_not_extracted_or_traversed(self):
        for name in ["/absolute/file", "root/../escape", "root/unsafe\\file"]:
            with self.assertRaises(ValueError):
                dc.safe_member(name)
        self.assertEqual(dc.safe_member("root/us/dc/council/code/sections/28:2-725.html"), "us/dc/council/code/sections/28:2-725.html")

    def test_native_paths_preserve_section_identity(self):
        self.assertEqual(dc.native_path("us/dc/council/code/sections/28:2-725.html"), "/us/dc/council/code/sections/28:2-725")
        self.assertEqual(dc.native_path("us/dc/council/code/titles/12/index.html"), "/us/dc/council/code/titles/12")

    def test_title28_filename_alias_requires_two_matching_publisher_identities(self):
        identity = "/us/dc/council/code/sections/28:2-725"
        self.assertEqual(dc.validate_identity({"native_id": identity, "source_url": dc.HOST + identity}, "us/dc/council/code/sections/28~2-725.html"), (identity, "title-28-colon-to-tilde"))
        with self.assertRaises(ValueError):
            dc.validate_identity({"native_id": identity, "source_url": dc.HOST + identity + "x"}, "us/dc/council/code/sections/28~2-725.html")

    def test_whole_archive_reconciles_nullable_toc_and_rejects_changed_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "source.tar.gz"
            identity = "/us/dc/council/code"
            page = f'<meta property="og:url" content="{dc.HOST}{identity}"><article class="content"><h1 id="{identity}">Code</h1></article>'
            files = {"metadata.json": json.dumps({"meta": {"build": {"codified-date": "2026-05-19"}}}),
                     "us/dc/council/code/index.html": page,
                     "us/dc/council/code/index.json": json.dumps({"p": identity, "t": "Code", "sp": None,
                         "c": [{"p": identity + "#(a)", "t": "(a)", "et": "para"}, {"p": identity + "#(a)", "t": "(1)", "et": "para"}]})}
            with tarfile.open(archive, "w:gz") as t:
                for name, content in files.items():
                    b = content.encode(); member = tarfile.TarInfo("publisher/" + name); member.size = len(b)
                    t.addfile(member, io.BytesIO(b))
            commit = "a" * 40
            receipt = {"repository": "https://github.com/dccouncil/law-html", "commit": commit,
                       "status": 200, "whole_object_verified": True,
                       "url": f"https://api.github.com/repos/DCCouncil/law-html/tarball/{commit}",
                       "bytes": archive.stat().st_size, "sha256": dc.file_digest(archive),
                       "retrieved_at": "2026-10-05T22:00:00Z", "source_codified_date": "2026-05-19"}
            evidence = root / "receipt.json"; evidence.write_text(json.dumps(receipt))
            result = dc.run(archive, evidence, root / "output")
            self.assertTrue(result["toc_reconciled"])
            self.assertEqual(result["counts"]["outlines"], 1)
            self.assertEqual(result["counts"]["fragment_identities"], 1)
            self.assertEqual(result["checks"]["fragment_identity_conflicts"], 1)
            self.assertFalse(result["published"])
            with self.assertRaises(ValueError): dc.run(archive, evidence, root / "output")
            archive.write_bytes(archive.read_bytes() + b"tampered")
            with self.assertRaises(ValueError): dc.run(archive, evidence, root / "changed")


if __name__ == "__main__":
    unittest.main()
