"""Offline tests for the PDF row reader and the PDF edition acceptance rules (text fixtures, no PDF files, no network)."""
import unittest

import pdf_ingest as I
import pdf_rows as R
import test_normalize as T


def render(ref, mutate=None, drop=None, label_style="published"):
    """Render a normalized reference table the way pdftotext -layout prints a Judicial Business PDF."""
    lines = [
        "",
        "      Table C-4A.",
        "      U.S. District Courts—Civil Cases Terminated, by District and Action Taken,",
        "      During the 12-Month Period Ending September 30, 2014",
        "                                    Court Action",
        "        Circuit and District Total No Court Action Total Percent Reaching Trial",
        "",
    ]
    for r in ref["rows"]:
        if drop and r["entity_id"] == drop:
            continue
        label = r["label"]
        if r["entity"] == "national":
            label = "TOTAL"
        elif r["entity"] == "circuit":
            label = label.upper()
        if label == "GU" and label_style == "old":
            label = "GUAM"
        vals = list(r["values"])
        if mutate and (r["entity"], r["entity_id"]) == mutate[0]:
            vals[mutate[1]] += mutate[2]
        cells = []
        for v in vals:
            cells.append("-" if v is None else (f"{v:,}" if isinstance(v, int) else f"{v:.1f}"))
        lines.append("      " + label.ljust(8) + "\t" + "   ".join(f"{c:>9}" for c in cells))
        if r["entity"] == "circuit":
            lines.append("")
    lines.append("")
    return "\n".join(lines)


class RowReaderTests(unittest.TestCase):
    def test_to_number(self):
        self.assertEqual(R.to_number("23,074"), (23074, None))
        self.assertEqual(R.to_number("1.1"), (1.1, None))
        self.assertEqual(R.to_number("-"), (None, "dash"))
        self.assertEqual(R.to_number("(NA)"), (None, "na"))
        self.assertEqual(R.to_number("-5.2"), (-5.2, None))
        self.assertEqual(R.to_number("12%"), (12, "pct"))

    def test_rows_need_the_exact_figure_count(self):
        text = "  NY,S\t10,690   1,660   9,030\n  NY,W\t2,062   363\n  Table C-4A.\n  CT 1 2 3\n"
        rows, rejected = R.rows_from_text(text, 3)
        self.assertEqual([r[0] for r in rows], ["NY,S", "CT"])
        self.assertEqual(rejected[0][1], 2)

    def test_spelled_out_circuits_and_leading_period_decimals(self):
        text = "     DISTRICT OF COLUMBIA   1,535   1,417   -7.7\n     FIRST   1,456   1,610   10.6\n     ELEVENTH   7,248   7,162   -.3\n"
        rows, rejected = R.rows_from_text(text, 3)
        self.assertEqual([R.CIRCUIT_WORDS[label] for label, _ in rows], ["DC", "1ST", "11TH"])
        self.assertEqual(R.to_number(rows[2][1][2]), (-0.3, None))
        self.assertEqual(rejected, [])

    def test_old_guam_label(self):
        rows, _ = R.rows_from_text("  GUAM\t23   5   18\n", 3)
        self.assertEqual(rows[0][0], "GUAM")


class PdfEditionTests(unittest.TestCase):
    def setUp(self):
        self.ref = T.normalized()
        self.entry = {"pub": "JB", "table": "C-4A", "period_end": "2014-09-30", "title": "listing"}

    def test_clean_edition_is_accepted_and_keeps_printed_figures(self):
        norm, reasons = I.parse_pdf_table(render(self.ref), self.ref, self.entry)
        self.assertEqual(reasons, [])
        self.assertEqual(norm["period_end"], "2014-09-30")
        total = next(r for r in norm["rows"] if r["entity"] == "national")
        ref_total = next(r for r in self.ref["rows"] if r["entity"] == "national")
        self.assertEqual(total["values"][:3], ref_total["values"][:3])

    def test_guam_printed_as_guam_is_still_guam(self):
        norm, reasons = I.parse_pdf_table(render(self.ref, label_style="old"), self.ref, self.entry)
        self.assertEqual(reasons, [])
        self.assertIn("gud", {r["entity_id"] for r in norm["rows"]})

    def test_broken_identity_is_rejected(self):
        norm, reasons = I.parse_pdf_table(render(self.ref, mutate=(("district", "nysd"), 0, 5)), self.ref, self.entry)
        self.assertIsNone(norm)
        self.assertTrue(any("roll-up identity" in r for r in reasons))

    def test_missing_court_is_rejected_never_filled(self):
        norm, reasons = I.parse_pdf_table(render(self.ref, drop="nysd"), self.ref, self.entry)
        self.assertIsNone(norm)
        self.assertTrue(any("court set differs" in r for r in reasons))

    def test_an_unreadable_national_total_row_alone_is_left_out_not_guessed(self):
        norm, reasons = I.parse_pdf_table(render(self.ref, drop="national"), self.ref, self.entry)
        self.assertEqual(reasons, [])
        self.assertNotIn("national", {r["entity"] for r in norm["rows"]})
        self.assertTrue(any("national Total row" in w for w in norm["warnings"]))

    def test_other_period_is_rejected(self):
        norm, reasons = I.parse_pdf_table(render(self.ref), self.ref, {**self.entry, "period_end": "2013-09-30"})
        self.assertIsNone(norm)
        self.assertTrue(any("period in title" in r for r in reasons))

    def test_wrong_table_is_rejected(self):
        norm, reasons = I.parse_pdf_table(render(self.ref), self.ref, {**self.entry, "table": "C-4"})
        self.assertIsNone(norm)
        self.assertTrue(any("title table" in r for r in reasons))


_D = "predominant_nature_of_debt"


class ColumnIdentityTests(unittest.TestCase):
    """F-2 PDFs word the headings differently from the spreadsheet; they are accepted on the table's own sums."""

    D = "predominant_nature_of_debt"
    KEYS = (["total_filings", "total_chapter_7", "total_chapter_11", "total_chapter_13"]
            + [f"{_D}/business_filings/{x}" for x in ("total", "chapter_7", "chapter_11", "chapter_13")]
            + [f"{_D}/nonbusiness_filings/{x}" for x in ("total", "chapter_7", "chapter_11", "chapter_13")])

    def rows(self, national_business=5, tweak=None):
        # total, ch7, ch11, ch13 | business total, 7, 11, 13 | nonbusiness total, 7, 11, 13
        court = [100, 60, 10, 30, 8, 3, 2, 3, 92, 57, 8, 27]
        national = [1000, 600, 100, 300, national_business, 2, 1, 2, 995, 598, 99, 298]
        out = []
        for entity, values in (("district", court), ("national", national)):
            vals = list(values)
            if tweak and entity == "district":
                vals[tweak[0]] += tweak[1]
            out.append({"entity": entity, "values": vals, "flags": [None] * len(vals)})
        return out

    def ref(self):
        return {"columns": [{"key": k} for k in self.KEYS]}

    def test_a_consistent_reworded_table_passes(self):
        spec = I.HEADER_OVERRIDES["f-2"]
        self.assertTrue(I.column_identities_hold(self.ref(), self.rows(), spec))

    def test_a_shifted_column_fails(self):
        spec = I.HEADER_OVERRIDES["f-2"]
        self.assertFalse(I.column_identities_hold(self.ref(), self.rows(tweak=(5, 1)), spec))

    def test_business_larger_than_nonbusiness_fails(self):
        spec = I.HEADER_OVERRIDES["f-2"]
        rows = self.rows()
        rows[1]["values"][4], rows[1]["values"][8] = rows[1]["values"][8], rows[1]["values"][4]
        self.assertFalse(I.column_identities_hold(self.ref(), rows, spec))

    def test_a_reference_with_other_columns_never_passes(self):
        spec = I.HEADER_OVERRIDES["f-2"]
        self.assertFalse(I.column_identities_hold({"columns": [{"key": "total_all_chapters"}]}, self.rows(), spec))


class YearOrderTests(unittest.TestCase):
    REF = {"period_end": "2017-09-30", "columns": [{"path": ["Filed", "2016"]}, {"path": ["Filed", "2017"]}, {"path": ["Filed", "Percent Change"]}]}

    @staticmethod
    def pdf(years_line, title_tail="2012 and 2013"):
        return "\n".join([
            "Table C.", "U.S. District Courts", "During the 12-Month Periods Ending September 30,", f"  {title_tail}", "  Filings",
            f"  Circuit {years_line} Change", "  TOTAL  1,000   1,100   10.0", "  DC  10  11  10.0", "",
        ])

    def test_prior_year_first_matches_the_reference_order(self):
        ok, why = I.year_order_matches(self.pdf("2012 2013"), self.REF, "2013-09-30")
        self.assertTrue(ok, why)

    def test_current_year_first_is_rejected_so_columns_are_never_swapped(self):
        ok, why = I.year_order_matches(self.pdf("2013 2012"), self.REF, "2013-09-30")
        self.assertFalse(ok)
        self.assertIn("2013", why)

    def test_other_years_are_rejected(self):
        ok, _ = I.year_order_matches(self.pdf("2011 2012"), self.REF, "2013-09-30")
        self.assertFalse(ok)

    def test_heading_block_skips_the_title_and_its_wrapped_year_line(self):
        block = I.heading_block(self.pdf("2012 2013"))
        self.assertEqual([line.strip() for line in block], ["Filings", "Circuit 2012 2013 Change"])


class PdfNotesTests(unittest.TestCase):
    def test_notes_under_the_last_data_row_are_joined_into_paragraphs(self):
        text = "\n".join([
            "Table X-1A.", "  TOTAL   673   563.1   409.4   114.5", "  DC   15   299.3   252.2   35.9", "",
            "Note: Case weights are based on the district court case weighting system approved by the",
            "Judicial Conference in March 2016. Data for the territorial courts are not included.",
            "12", "Page 4 of 4", "",
        ])
        self.assertEqual(I.pdf_notes(text), ["Note: Case weights are based on the district court case weighting system approved by the Judicial Conference in March 2016. Data for the territorial courts are not included."])

    def test_a_table_without_notes_has_none(self):
        self.assertEqual(I.pdf_notes("  TOTAL   1   2   3\n  DC   1   2   3\n"), [])


if __name__ == "__main__":
    unittest.main()
