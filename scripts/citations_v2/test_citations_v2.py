"""Offline tests for the canonical citation extractor (citations-v2), Python side.

Run: python3 -I -B -m unittest discover -s scripts/citations_v2 -p 'test_*.py' -v

The same golden fixture (src/lib/citations/fixtures/golden.json) is checked by src/lib/citations/engine.test.ts against
the TypeScript engine, so both engines are held to one output.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build_patterns  # noqa: E402
import engine  # noqa: E402

ROOT = HERE.parents[1]
GOLDEN = json.loads((ROOT / "src" / "lib" / "citations" / "fixtures" / "golden.json").read_text(encoding="utf-8"))


class PatternTable(unittest.TestCase):
    def test_generated_files_are_current(self):
        js, ts = build_patterns.render(build_patterns.build())
        self.assertEqual(build_patterns.OUT_JSON.read_text(encoding="utf-8"), js, "run build_patterns.py")
        self.assertEqual(build_patterns.OUT_TS.read_text(encoding="utf-8"), ts, "run build_patterns.py")

    def test_dialect_guard_refuses_python_only_syntax(self):
        for bad in (r"\bword", r"(?>x)", r"x*+", r"(?i)x", r"(?P<n>x)", r"a{,3}", r"a.b"):
            with self.assertRaises(ValueError, msg=bad):
                build_patterns.check_dialect("t", bad)

    def test_vendored_reporters_are_pinned(self):
        pin = json.loads((ROOT / "scripts" / "vendor" / "reporters-db" / "PINNED.json").read_text(encoding="utf-8"))
        import hashlib

        for f in pin["files"]:
            data = (ROOT / "scripts" / "vendor" / "reporters-db" / f["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), f["sha256"], f["file"])

    def test_every_state_and_dc_has_statute_and_regulation_forms(self):
        table = engine.default().table
        for kind in ("state_statute", "state_regulation"):
            self.assertEqual(len({r["state"] for r in table["rules"] if r["kind"] == kind}), 51, kind)


class Golden(unittest.TestCase):
    def test_texts(self):
        self.assertGreaterEqual(len(GOLDEN["texts"]), 25)
        for t in GOLDEN["texts"]:
            self.assertEqual(engine.extract(t["text"]), t["expected"], t["id"])

    def test_documents(self):
        for d in GOLDEN["documents"]:
            self.assertEqual(engine.extract_pages(d["pages"]), d["expected"], d["id"])

    def test_matched_is_the_exact_code_point_slice(self):
        for t in GOLDEN["texts"]:
            for c in t["expected"]:
                self.assertEqual(t["text"][c["start"] : c["end"]], c["matched"], t["id"])


class Behaviour(unittest.TestCase):
    def kinds(self, text):
        return [(c["kind"], c["key"]) for c in engine.extract(text)]

    def test_short_forms_resolve_only_with_an_antecedent(self):
        self.assertEqual(self.kinds("Id. at 650. 576 U.S. at 650. Smith, supra, at 4."),
                         [("short", None), ("case", None), ("short", None)])

    def test_unresolved_bates_like_numbers_are_not_citations(self):
        self.assertEqual(engine.extract("Exhibit 12 at 3; DEF-000123; Dkt. No. 45 at 6; Page 4 of 9."), [])

    def test_state_is_never_inferred(self):
        # "Health & Safety Code § 25249.6" names no state: no state statute is read, the section stays an unlinked short form
        got = engine.extract("Health & Safety Code § 25249.6 requires a warning.")
        self.assertEqual([(c["kind"], c["key"], c["short_status"]) for c in got], [("short", None, "none")])

    def test_string_cite_makes_id_ambiguous(self):
        got = engine.extract("See A v. B, 1 F.3d 2 (1st Cir. 1993); C v. D, 3 F.3d 4 (2d Cir. 1993). Id. at 5.")
        self.assertEqual(got[-1]["short_status"], "ambiguous")
        self.assertIsNone(got[-1]["key"])

    def test_pins_never_run_into_the_next_citation(self):
        got = engine.extract("576 U.S. 644, 651, 135 S. Ct. 2584 (2015)")
        self.assertEqual([c["pin"] for c in got], ["651", None])
        self.assertEqual({c["group"] for c in got}, {1})

    def test_repeated_citations_each_keep_their_offsets(self):
        text = "See 42 U.S.C. § 1983. " * 500
        got = engine.extract(text)
        self.assertEqual(len(got), 500)
        self.assertTrue(all(text[c["start"] : c["end"]] == "42 U.S.C. § 1983" for c in got))


if __name__ == "__main__":
    unittest.main()
