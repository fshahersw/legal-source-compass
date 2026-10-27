"""Owner decision 2026-10-27: sealing-related wording on a published court file no longer withholds its title."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive_titles as D
import build_keyword_release_plan as K
from test_derive_titles import page

BODY = "body text line that is long enough to dominate the page"
SHA = "a" * 64


def fp(rid, lines, **kw):
    return {"id": rid, "status": "ok", "sha256_verified": True, "sha256": SHA, "page_h": 792.0, "lines": lines, **kw}


def row(rid, name):
    return {"id": rid, "title": f"{name} (title not recorded)", "source_url": f"https://www.example.uscourts.gov/files/{name}", "item": {"cells": {"doc_type": "Court form"}}}


def art(rid):
    return {"route": f"/supplement-files/court_documents/{rid}", "sha256": SHA, "object_key": f"aa/{SHA}"}


SEALING_PAGE = page(("SEALING CHECKLIST", 16, True), ("Submissions under seal must include a redaction log.", 10, False), (BODY, 10, False), (BODY, 10, False))


class NoKeywordRule(unittest.TestCase):
    def test_derive_titles_has_no_keyword_rule(self):
        self.assertFalse(hasattr(D, "policy_withheld"))
        self.assertFalse(hasattr(D, "POLICY_WITHHELD_RE"))

    def test_sealing_wording_keeps_title(self):
        t, m, why = D.title_from_first_page(SEALING_PAGE, 792.0)
        self.assertEqual((t, m, why), ("SEALING CHECKLIST", D.METHOD_BLOCK, None))

    def test_ocr_path_has_no_keyword_rule(self):
        lines = [dict(l, c=0.99) for l in page(("EX PARTE HEARING SCHEDULE", 24, False), (BODY, 10, False), (BODY, 10, False), (BODY, 10, False))]
        t, m, why = D.title_from_ocr_first_page(lines, 792.0)
        self.assertNotEqual(why, "ocr_policy_withheld")
        self.assertEqual(t, "EX PARTE HEARING SCHEDULE")


class KeywordReleasePlan(unittest.TestCase):
    def test_builds_title_rows_and_keeps_label_otherwise(self):
        ambiguous = page(("Alpha Program Overview", 14, True), (BODY, 10, False), (BODY, 10, False), ("Second Heading Elsewhere", 14, True), (BODY, 10, False), (BODY, 10, False))
        rows = [row("cd-1", "seal.pdf"), row("cd-2", "amb.pdf"), {**row("cd-3", "x.pdf"), "title": "Already Titled"}, row("cd-4", "bad.pdf")]
        arts = {r["id"]: art(r["id"]) for r in rows}
        fps = {"cd-1": fp("cd-1", SEALING_PAGE), "cd-2": fp("cd-2", ambiguous), "cd-4": fp("cd-4", SEALING_PAGE, sha256_verified=False)}
        plan, dmap, stats = K.build(rows, arts, fps)
        by = {p["id"]: p for p in plan}
        self.assertEqual(set(by), {"cd-1", "cd-2"})
        self.assertEqual(by["cd-1"]["new_title"], "SEALING CHECKLIST")
        self.assertEqual(by["cd-1"]["method"], D.METHOD_BLOCK)
        self.assertEqual(by["cd-1"]["old_title"], "seal.pdf (title not recorded)")
        self.assertEqual(by["cd-1"]["source_id"], f"corpus-originals:{SHA}")
        self.assertRegex(by["cd-1"]["source_text_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual((by["cd-2"]["method"], by["cd-2"]["reason"], by["cd-2"]["new_title"]), ("not_recorded", "multiple_title_blocks", "amb.pdf (title not recorded)"))
        self.assertEqual(stats["skipped:title_is_not_title_not_recorded"], 1)
        self.assertEqual(stats["skipped:first_page_not_verified"], 1)
        self.assertEqual(stats["former_keyword_rule_matched"], 1)
        self.assertNotIn("policy_withheld", {p["reason"] for p in plan})

    def test_reviewed_not_title_is_exact_to_id_and_string(self):
        (rid, text), reason = next(iter(K.REVIEWED_NOT_TITLES.items()))
        lines = page((text, 16, True), (BODY, 10, False), (BODY, 10, False), (BODY, 10, False))
        self.assertEqual(D.title_from_first_page(lines, 792.0)[0], text)
        plan, _, _ = K.build([row(rid, "cc1640inst.pdf"), row("other", "o.pdf")], {rid: art(rid), "other": art("other")}, {rid: fp(rid, lines), "other": fp("other", lines)})
        by = {p["id"]: p for p in plan}
        self.assertEqual((by[rid]["method"], by[rid]["reason"]), ("not_recorded", reason))
        self.assertEqual(by["other"]["new_title"], text, "the reviewed hold applies to that record only")


if __name__ == "__main__":
    unittest.main()
