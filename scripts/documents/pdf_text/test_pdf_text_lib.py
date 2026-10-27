"""Unit tests of the pure extractor helpers: synthetic PDFs, a fake OCR engine, no network, no models.
Run: python -I -B scripts/documents/pdf_text/test_pdf_text_lib.py   (needs PyMuPDF; skipped without it)"""
import hashlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import fitz  # noqa: E402
except ImportError:  # the extractor's own Python has PyMuPDF; another interpreter skips the PDF tests instead of failing
    fitz = None

import pdf_text_lib as lib  # noqa: E402

PARAGRAPH = ("The Court has considered the parties submissions regarding the proposed case management order and finds that the schedule "
             "set out below is reasonable and necessary for the efficient conduct of this litigation. ")


def make_pdf(pages: list, encrypt: bool = False) -> bytes:
    """pages: list of ('text', str) | ('image', None) | ('stamp+image', str) | ('blank', None)"""
    doc = fitz.open()
    for kind, payload in pages:
        page = doc.new_page(width=612, height=792)
        if kind == "text":
            page.insert_textbox(fitz.Rect(40, 40, 570, 750), payload, fontsize=10)
        elif kind in ("image", "stamp+image"):
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 306, 396), False)
            pix.clear_with(250)
            page.insert_image(page.rect, pixmap=pix)
            if kind == "stamp+image":
                page.insert_text((40, 20), payload, fontsize=8)
    if encrypt:
        return doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
    return doc.tobytes()


class FakeOcr:
    label = "fake-ocr 0"

    def __init__(self):
        self.calls = 0

    def recognize(self, low, high):
        self.calls += 1
        assert len(low) == len(high) == 1
        return [{"text": "UNITED STATES DISTRICT COURT\nIN RE: EXAMPLE MDL 9999\nSeeger Weiss LLP appointed Co-Lead Counsel", "confidence": 0.93, "lines": 3, "low_conf_lines": 0}]


class NormalizeTests(unittest.TestCase):
    def test_ligatures_zero_width_spaces_and_controls(self):
        raw = "ﬁnancial ﬂow​ of  funds\x00 with soft­hyphen\r\n\r\n\r\nnext   line\t\there\n"
        self.assertEqual(lib.normalize_text(raw), "financial flow of funds with softhyphen\n\nnext line here")

    def test_empty_and_whitespace(self):
        self.assertEqual(lib.normalize_text(None), "")
        self.assertEqual(lib.normalize_text(" \n \n"), "")

    def test_lone_surrogates_are_dropped(self):
        self.assertEqual(lib.normalize_text("ab\ud800cd"), "abcd")

    def test_garbled_detection(self):
        cids = "(cid:12)" * 40
        self.assertTrue(lib.looks_garbled(lib.normalize_text(cids), lib.garble_ratio(cids)))
        broken = "�" * 60 + "a" * 40
        self.assertTrue(lib.looks_garbled(lib.normalize_text(broken), lib.garble_ratio(broken)))
        self.assertFalse(lib.looks_garbled(PARAGRAPH * 3))
        self.assertFalse(lib.looks_garbled("Total ........ 12\n" * 20))
        # readable pages with a few unmappable glyphs (5-17% replacement characters was common in the real library) are NOT garbled
        for share in (0.05, 0.10, 0.17):
            raw = PARAGRAPH * 3
            raw = raw[: int(len(raw) * (1 - share))] + "�" * int(len(raw) * share)
            self.assertLess(lib.garble_ratio(raw), lib.GARBLE_UNREADABLE)
            self.assertFalse(lib.looks_garbled(lib.normalize_text(raw), lib.garble_ratio(raw)))
        self.assertEqual(lib.garble_ratio("�� 7"), 0.0)  # too short to judge

    def test_replacement_characters_are_dropped_from_stored_text(self):
        self.assertEqual(lib.normalize_text("doesn�t matter �"), "doesnt matter")


class ClassifyTests(unittest.TestCase):
    def test_states(self):
        no_paths = lambda: 0
        self.assertEqual(lib.classify_page(PARAGRAPH, 0.0, no_paths), ("text", None))
        self.assertEqual(lib.classify_page("Exhibit A", 0.0, no_paths), ("text", None))
        self.assertEqual(lib.classify_page("", 0.0, no_paths), ("blank", None))
        self.assertEqual(lib.classify_page("", 0.9, no_paths), ("ocr_pending", "image_page"))
        self.assertEqual(lib.classify_page("Case 1:16-md-02738 Document 1 Filed 07/12/16 Page 2 of 20 PageID: 1234", 0.9, no_paths), ("ocr_pending", "image_page"))
        self.assertEqual(lib.classify_page("", 0.0, lambda: 500), ("ocr_pending", "image_or_vector_page"))
        cid_page = "(cid:1)" * 60 + PARAGRAPH
        self.assertEqual(lib.classify_page(lib.normalize_text(cid_page), 0.0, no_paths, lib.garble_ratio(cid_page)), ("ocr_pending", "bad_text_layer"))
        mostly_symbols = "�" * 300 + "x"
        self.assertEqual(lib.classify_page(lib.normalize_text(mostly_symbols), 0.0, no_paths, lib.garble_ratio(mostly_symbols)), ("ocr_pending", "bad_text_layer"))
        self.assertEqual(lib.classify_page(PARAGRAPH, 0.95, no_paths), ("text", None))  # a searchable scan keeps its existing text layer


@unittest.skipIf(fitz is None, "PyMuPDF (fitz) is not installed in this interpreter")
class ProcessTests(unittest.TestCase):
    def test_text_and_blank_and_image_pages(self):
        data = make_pdf([("text", PARAGRAPH * 3), ("blank", None), ("image", None), ("stamp+image", "Case 1:16-md-02738 Document 14 Filed 07/12/16 Page 4 of 20")])
        sha = hashlib.sha256(data).hexdigest()
        rec = lib.process_pdf(data, sha, source="local")
        self.assertEqual(rec["page_count"], 4)
        self.assertEqual([m["state"] for m in rec["pages_meta"]], ["text", "blank", "ocr_pending", "ocr_pending"])
        self.assertEqual(rec["status"], "partial_ocr_pending")
        self.assertEqual(rec["ocr_pending_pages"], 2)
        self.assertEqual(rec["pages_with_text"], 1)
        self.assertEqual([r["page"] for r in rec["pages"]], [1])
        self.assertEqual(rec["pages"][0]["engine"], "pdf-text-layer")
        self.assertIn("considered the parties", rec["pages"][0]["text"])
        self.assertEqual(rec["chars"], len(rec["pages"][0]["text"]))
        self.assertTrue(rec["engine_version"].startswith("pymupdf "))
        self.assertEqual(len(rec["text_sha256"]), 64)

    def test_ocr_fills_pending_pages_and_labels_them(self):
        data = make_pdf([("text", PARAGRAPH * 2), ("image", None), ("stamp+image", "Case 1:16-md-02738 Document 14 Filed 07/12/16 Page 4 of 20")])
        sha = hashlib.sha256(data).hexdigest()
        ocr = FakeOcr()
        rec = lib.process_pdf(data, sha, source="local", ocr=ocr)
        self.assertEqual(ocr.calls, 2)
        self.assertEqual(rec["status"], "complete")
        self.assertEqual(rec["ocr_pending_pages"], 0)
        self.assertEqual(rec["pages_with_text"], 3)
        engines = {r["page"]: r["engine"] for r in rec["pages"]}
        self.assertEqual(engines, {1: "pdf-text-layer", 2: "surya-ocr", 3: "surya-ocr"})
        ocr_rows = [r for r in rec["pages"] if r["engine"] == "surya-ocr"]
        self.assertTrue(all(r["ocr_confidence"] == 0.93 for r in ocr_rows))
        self.assertTrue(all("ocr_confidence" not in r for r in rec["pages"] if r["engine"] == "pdf-text-layer"))
        self.assertIn("fake-ocr 0", rec["engine_version"])
        self.assertIn("Seeger Weiss", ocr_rows[0]["text"])

    def test_max_ocr_pages_leaves_the_rest_pending(self):
        data = make_pdf([("image", None), ("image", None), ("image", None)])
        sha = hashlib.sha256(data).hexdigest()
        rec = lib.process_pdf(data, sha, source="local", ocr=FakeOcr(), max_ocr_pages=1)
        self.assertEqual(rec["ocr_pending_pages"], 2)
        self.assertEqual(rec["status"], "partial_ocr_pending")

    def test_hash_mismatch_is_refused_before_extraction(self):
        data = make_pdf([("text", PARAGRAPH)])
        with self.assertRaises(ValueError):
            lib.process_pdf(data, "0" * 64, source="local")

    def test_encrypted_and_garbage_are_unreadable_records(self):
        data = make_pdf([("text", PARAGRAPH)], encrypt=True)
        rec = lib.process_pdf(data, hashlib.sha256(data).hexdigest(), source="bucket")
        self.assertEqual(rec["status"], "unreadable")
        self.assertEqual(rec["page_count"], 0)
        self.assertEqual(rec["pages"], [])
        junk = b"%PDF-1.4 this is not a pdf"
        rec = lib.process_pdf(junk, hashlib.sha256(junk).hexdigest(), source="bucket")
        self.assertEqual(rec["status"], "unreadable")

    def test_no_text_document(self):
        data = make_pdf([("blank", None), ("blank", None)])
        rec = lib.process_pdf(data, hashlib.sha256(data).hexdigest(), source="local")
        self.assertEqual(rec["status"], "no_text")
        self.assertEqual(rec["pages_with_text"], 0)

    def test_record_round_trip_and_payload_matches_the_database_contract(self):
        data = make_pdf([("text", PARAGRAPH * 2), ("image", None)])
        sha = hashlib.sha256(data).hexdigest()
        rec = lib.process_pdf(data, sha, source="local", ocr=FakeOcr())
        with tempfile.TemporaryDirectory() as tmp:
            lib.write_record(tmp, rec)
            back = lib.read_record(tmp, sha)
        self.assertEqual(back, rec)
        for key in ("sha256", "status", "page_count", "ocr_pending_pages", "engine_version", "extractor_version", "text_sha256", "pages_meta", "pages"):
            self.assertIn(key, back)
        self.assertIn(back["status"], ("complete", "partial_ocr_pending", "no_text", "unreadable"))
        self.assertEqual((back["status"] == "partial_ocr_pending"), back["ocr_pending_pages"] > 0)
        for row in back["pages"]:
            self.assertEqual(row["engine"] == "surya-ocr", row.get("ocr_confidence") is not None)

    def test_long_page_is_truncated_and_flagged(self):
        pages = [{"page": 1, "text": "word " * 100000, "state": "text", "reason": None, "image_cover": 0.0}]
        rec = lib.build_record(sha256="a" * 64, size=1, pages=pages, status_hint=None, note=None, pymupdf_version="x", ocr_label=None, source="local")
        self.assertEqual(len(rec["pages"][0]["text"]), lib.MAX_PAGE_CHARS)
        self.assertTrue(rec["pages"][0]["truncated"])
        self.assertTrue(rec["pages_meta"][0]["truncated"])


if __name__ == "__main__":
    unittest.main()
