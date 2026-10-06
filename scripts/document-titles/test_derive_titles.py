import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive_titles as D


def L(t, s=12.0, b=False, y=0.0):
    return {"t": t, "s": s, "b": b, "y": y, "x": 72.0, "x1": 300.0}


def page(*rows):
    out, y = [], 40.0
    for r in rows:
        out.append(L(r[0], r[1], r[2], y))
        y += 16
    return out


class FirstPage(unittest.TestCase):
    def derive(self, *rows):
        return D.title_from_first_page(page(*rows), 792.0)

    def test_table_block(self):
        t, m, why = self.derive(("Table C-1.", 12, True), ("U.S. District Courts—Civil Cases Commenced", 12, True), ("During the 12-Month Period Ending December 31, 2009", 12, True),
                                ("Total cases column heading text", 8, True), ("Private civil cases column heading", 8, True), ("1,234 5,678 9,012 3,456 7,890 1,234 5,678", 8, False))
        self.assertEqual(t, "Table C-1. U.S. District Courts—Civil Cases Commenced During the 12-Month Period Ending December 31, 2009")
        self.assertEqual(m, D.METHOD_BLOCK)

    def test_court_caption_alone_is_rejected(self):
        t, m, why = self.derive(("IN THE UNITED STATES DISTRICT COURT", 14, True), ("FOR THE MIDDLE DISTRICT OF GEORGIA", 14, True), ("In re:", 10, False), ("body text line that is long enough to dominate the page", 10, False), ("body text line that is long enough to dominate the page", 10, False), ("body text line that is long enough to dominate the page", 10, False))
        self.assertIsNone(t)
        self.assertEqual(why, "caption_only")

    def test_several_prominent_blocks_are_ambiguous(self):
        t, m, why = self.derive(("Alpha Program Overview", 14, True), ("body text line that is long enough to dominate the page", 10, False), ("body text line that is long enough to dominate the page", 10, False), ("Second Heading Elsewhere", 14, True), ("body text line that is long enough to dominate the page", 10, False), ("body text line that is long enough to dominate the page", 10, False))
        self.assertIsNone(t)
        self.assertEqual(why, "multiple_title_blocks")

    def test_uniform_typography_without_doctype_heading(self):
        t, m, why = self.derive(("Some paragraph text that runs on", 12, False), ("another paragraph line here", 12, False))
        self.assertIsNone(t)
        self.assertEqual(why, "uniform_typography")

    def test_doctype_heading_with_caption(self):
        t, m, why = self.derive(("IN THE SUPREME COURT OF ALABAMA", 12, False), ("April 1, 2010", 12, False), ("ORDER", 12, False), ("IT IS ORDERED that the rule is amended as follows.", 12, False))
        self.assertEqual((t, m), ("ORDER — IN THE SUPREME COURT OF ALABAMA", D.METHOD_DOCTYPE))

    def test_generic_type_without_caption_is_rejected(self):
        t, m, why = self.derive(("FILED", 10, False), ("ORDER", 16, True), ("body body body body", 10, False))
        self.assertIsNone(t)
        self.assertEqual(why, "generic_type_without_caption")

    def test_generic_type_gets_caption_above(self):
        t, m, why = self.derive(("United States District Court", 12, True), ("Southern District of Texas", 12, True), ("ORDER", 18, True), ("body body body body", 10, False))
        self.assertEqual(t, "ORDER — United States District Court Southern District of Texas")

    def test_no_text_layer(self):
        self.assertEqual(D.title_from_first_page([], 792.0)[2], "no_text_layer")

    def test_body_sentence_and_garble_rejected(self):
        for text in ("Whether you have a driver’s license and, if so, the driver’s license number [ ] none", "kbbiaorg Q(onmittge ott fRulrs", "AMENDED ORDF:R", "BOARDONJUDICIALSTANDARDS", "ليست وثيقة رسمية", "MEMORANDUM TO:"):
            self.assertIsNotNone(D.quality_reason(text), text)

    def test_names_list_rejected(self):
        self.assertIsNotNone(D.quality_reason("Parker, C.J., and Bolin, Shaw, Wise, Bryan, Sellers, Mendheim, Stewart, and Mitchell, JJ., concur"))

    def test_hyphen_join(self):
        self.assertEqual(D.join_lines(["Non-", "jury trials"]), "Nonjury trials")


class Markdown(unittest.TestCase):
    def test_first_h1_accepted(self):
        self.assertEqual(D.title_from_markdown("# Civil Justice Reform Act of 1990\n\ntext")[:2], ("Civil Justice Reform Act of 1990", D.METHOD_H1))

    def test_h1_must_be_first_heading(self):
        self.assertEqual(D.title_from_markdown("## Sub heading\n\n# Later H1\n")[2], "first_heading_is_not_h1")

    def test_no_heading(self):
        self.assertEqual(D.title_from_markdown("plain text only")[2], "no_heading")

    def test_caption_and_boilerplate_rejected(self):
        self.assertIsNotNone(D.title_from_markdown("# IN THE CIRCUIT COURT OF THE NINTH JUDICIAL CIRCUIT\n")[2])
        self.assertIsNotNone(D.title_from_markdown("# THIS PAGE INTENTIONALLY BLANK\n")[2])
        self.assertIsNotNone(D.title_from_markdown("# September 29, 1971\n")[2])

    def test_committee_letterhead_and_run_on_lines_rejected(self):
        self.assertEqual(D.title_from_markdown("# COMMITTEE ON RULES OF PRACTICE AND PROCEDURE\n")[2], "letterhead_or_court_caption")
        self.assertEqual(D.title_from_markdown("# " + "Annual Report of the Committee on Rules " * 4 + "\n")[2], "letterhead_or_court_caption")

    def test_markup_removed_wording_kept(self):
        self.assertEqual(D.title_from_markdown("# **Notice of Hearing**\n")[0], "Notice of Hearing")


if __name__ == "__main__":
    unittest.main()
