"""Unit tests for investor-document helpers: exhibit tables, document types, quote validation, XBRL comparison and the
verbatim check used for business descriptions. Run: python3 -m unittest scripts/enrichment/sec/test_ir_docs.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ir_docs as ir  # noqa: E402
import llm  # noqa: E402

INDEX = """
<table class="tableFile" summary="Document Format Files">
<tr><th scope="col">Seq</th><th scope="col">Description</th><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Size</th></tr>
<tr><td scope="row">1</td><td scope="row">8-K</td><td scope="row"><a href="/Archives/edgar/data/1800/000000180026000010/abt-20260415.htm">abt-20260415.htm</a></td><td scope="row">8-K</td><td scope="row">40123</td></tr>
<tr class="evenRow"><td scope="row">2</td><td scope="row">PRESS RELEASE &amp; FINANCIALS</td><td scope="row"><a href="/Archives/edgar/data/1800/000000180026000010/a2026q1ex991.htm">a2026q1ex991.htm</a></td><td scope="row">EX-99.1</td><td scope="row">350112</td></tr>
<tr><td scope="row">3</td><td scope="row">Investor presentation</td><td scope="row"><a href="/Archives/edgar/data/1800/000000180026000010/q1deck.pdf">q1deck.pdf</a></td><td scope="row">EX-99.2</td><td scope="row">2100331</td></tr>
<tr><td scope="row">4</td><td scope="row">GRAPHIC</td><td scope="row"><a href="/Archives/edgar/data/1800/000000180026000010/logo.jpg">logo.jpg</a></td><td scope="row">GRAPHIC</td><td scope="row">5021</td></tr>
</table>
"""

RELEASE = ("Abbott Reports First-Quarter 2026 Results. Worldwide sales of $11.16 billion increased 7.8 percent on a reported basis. "
           "Reported diluted EPS was $0.61. Net earnings were $1,077 million. Medical Devices sales were $5,123 million in the quarter.")


class Exhibits(unittest.TestCase):
    def test_rows_and_exhibit_99_filter(self):
        rows = ir.exhibit_rows(INDEX)
        self.assertEqual([r["type"] for r in rows], ["8-K", "EX-99.1", "EX-99.2", "GRAPHIC"])
        self.assertEqual(rows[1]["description"], "PRESS RELEASE & FINANCIALS")
        self.assertEqual(rows[1]["href"], "/Archives/edgar/data/1800/000000180026000010/a2026q1ex991.htm")
        self.assertEqual([r["document"] for r in rows if ir.is_exhibit_99(r)], ["a2026q1ex991.htm", "q1deck.pdf"])

    def test_document_types(self):
        rows = ir.exhibit_rows(INDEX)
        self.assertEqual(ir.document_type("2.02,9.01", rows[1], RELEASE), "earnings_release")
        self.assertEqual(ir.document_type("2.02,7.01,9.01", rows[2], "Q1 2026 results"), "presentation")
        transcript = {"description": "Transcript of earnings call", "document": "ex992.htm", "type": "EX-99.2"}
        self.assertEqual(ir.document_type("7.01", transcript, ""), "transcript")
        other = {"description": "Press release", "document": "ex991.htm", "type": "EX-99.1"}
        self.assertEqual(ir.document_type("7.01,9.01", other, "The company announced a new director."), "other")


class Validation(unittest.TestCase):
    def test_number_in_quote(self):
        self.assertTrue(ir.number_in("Net earnings were $1,077 million", 1077))
        self.assertTrue(ir.number_in("sales of $11.16 billion", 11.16))
        self.assertTrue(ir.number_in("a loss of $(17) million", -17))
        self.assertFalse(ir.number_in("Net earnings were $1,077 million", 1100))
        self.assertFalse(ir.number_in("no figure here", None))

    def test_only_verbatim_quoted_figures_are_kept(self):
        answer = {
            "period_label": "First quarter 2026", "period_end": "2026-03-31", "currency": "USD",
            "revenue": {"value": 11.16, "scale": "billions", "quote": "Worldwide sales of $11.16 billion increased 7.8 percent"},
            "net_income": {"value": 1077, "scale": "millions", "quote": "Net earnings were $1,077 million"},
            "eps_diluted": {"value": 0.62, "quote": "Reported diluted EPS was $0.61"},  # number not in the quote
            "segments": [{"name": "Medical Devices", "value": 5123, "scale": "millions", "quote": "Medical Devices sales were $5,123 million"},
                         {"name": "Diagnostics", "value": 2100, "scale": "millions", "quote": "Diagnostics sales were $2,100 million"}],  # not in text
            "kpis": [{"name": "Growth", "value": "7.8%", "quote": "increased 7.8 percent on a reported basis"}],
            "guidance": "not a list",
        }
        out = ir.validate_extraction(answer, RELEASE)
        self.assertEqual(out["revenue"]["value"], 11.16)
        self.assertEqual(out["net_income"]["value"], 1077)
        self.assertIsNone(out["eps_diluted"])
        self.assertEqual([s["name"] for s in out["segments"]], ["Medical Devices"])
        self.assertEqual(len(out["kpis"]), 1)
        self.assertEqual(out["guidance"], [])
        self.assertEqual(out["dropped"], 2)

    def test_bad_scale_and_period_are_dropped(self):
        answer = {"period_end": "March 2026", "revenue": {"value": 11.16, "scale": "lakhs", "quote": "Worldwide sales of $11.16 billion"}}
        out = ir.validate_extraction(answer, RELEASE)
        self.assertIsNone(out["period_end"])
        self.assertIsNone(out["revenue"])
        self.assertIsNone(ir.validate_extraction(["not", "a", "dict"], RELEASE))


class Comparison(unittest.TestCase):
    def test_amount_scales(self):
        self.assertEqual(ir.amount({"value": 11.16, "scale": "billions"}), 11.16e9)
        self.assertIsNone(ir.amount({"value": "11"}))

    def test_rounding_step_is_the_last_reported_digit(self):
        self.assertEqual(ir.rounding_step({"value": 0.4, "scale": "millions"}), 100000.0)
        self.assertEqual(ir.rounding_step({"value": 4486, "scale": "millions"}), 1e6)
        self.assertAlmostEqual(ir.rounding_step({"value": 0.61}), 0.01)
        self.assertIsNone(ir.rounding_step(None))

    def test_xbrl_check_statuses(self):
        self.assertEqual(ir.xbrl_check(None, 5.0, 0.01), "not_extracted")
        self.assertEqual(ir.xbrl_check(5.0, None, 0.01), "no_xbrl_value")
        self.assertEqual(ir.xbrl_check(11.16e9, 11.164e9, 0.005), "matches")
        self.assertEqual(ir.xbrl_check(0.0, 0.0, 0.005), "matches")
        self.assertEqual(ir.xbrl_check(4.486e9, 5.252e9, 0.005), "differs")
        # $0.4 million in the release, $369 thousand in XBRL: equal at the release's precision, not within 1%.
        self.assertEqual(ir.xbrl_check(0.4e6, 0.369e6, 0.01, 1e5), "rounded")
        self.assertEqual(ir.xbrl_check(0.4e6, 0.34e6, 0.01, 1e5), "differs")

    def test_quarter_for_uses_the_stated_period_then_the_filing_date(self):
        quarters = [{"end": "2025-09-30"}, {"end": "2025-12-31"}, {"end": "2026-03-31"}]
        self.assertEqual(ir.quarter_for("2026-03-29", "2026-04-15", quarters), 2)
        self.assertEqual(ir.quarter_for(None, "2026-01-28", quarters), 1)
        self.assertIsNone(ir.quarter_for("2026-06-30", "2026-07-20", quarters))
        self.assertIsNone(ir.quarter_for(None, "2026-09-01", quarters))


class Verbatim(unittest.TestCase):
    def test_verbatim_normalizes_whitespace_and_curly_quotes(self):
        source = "Abbott’s products   span diagnostics,\nmedical devices, nutritionals and branded generic medicines."
        self.assertTrue(llm.verbatim("Abbott's products span diagnostics, medical devices, nutritionals and branded generic medicines.", source))
        self.assertFalse(llm.verbatim("Abbott's products span diagnostics, devices, nutritionals and generic medicines.", source))
        self.assertFalse(llm.verbatim("too short", source))
        self.assertFalse(llm.verbatim(None, source))


if __name__ == "__main__":
    unittest.main()
