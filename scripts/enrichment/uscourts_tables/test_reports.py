"""Offline tests for reports.py on text copied from the published reports (Delayed-Notice Search Warrant reports, the Director's
reports on the FISA courts, the Crime Victims' Rights reports); no PDF files, no network."""
import unittest

import reports as RP

# Delayed-Notice Search Warrant report, fiscal year 2010, Table 1 (pdftotext -layout), first circuit block
D1_2010 = """
                                    Average                          Granted                                Granted
                             Total    delay      Warrant               as                Extension            as
                           requests (in days)   requests   Granted   modified   Denied   requests Granted   modified   Denied

ALL CIRCUITS                  199       49        153       147         5         1         46       43        3         0


FIRST CIRCUIT                 199       49        153       147         5         1         46       43        3         0
MAINE                          30       50         21           21      0         0          9        8        1         0
MASSACHUSETTS                  95       40         71           71      0         0         24       24        0         0
NEW HAMPSHIRE                  23       76         14           14      0         0          9        7        2         0
PUERTO RICO                    51       53         47           41      5         1          4        4        0         0

                                                 3
""".splitlines()

# fiscal year 2007, Table 1: no Denied columns (none was denied that year)
D1_2007 = """
                                           Avg                           Granted                       Granted
                                 Total    delay      Warrant               as       Extension            as
                               requests (in days)   requests   Granted   modified   requests Granted   modified

ALL CIRCUITS                       2        90           1        1          0          1        1         0


DC CIRCUIT                        2        90           1        1          0          1        1         0
DISTRICT OF COLUMBIA              2        90           1        1          0          1        1         0
""".splitlines()

# fiscal year 2010, Table 2 (shortened to rows that add up): a label printed over two lines, dashes in percent columns, the notes
D2_2010 = """

                                       Reports                             Warrants                  Extensions

 Offense                    Number               Percent*       Number            Percent*   Number          Percent*


Total                           3200                100%             1880              100%    1320                100%


Drugs                          3034                 76%             1764              74%     1270                81%
Fugitive/Supervised              47                    -              47               2%        0                   -
  Release Violation
IEEPA**                          36                    -             16                  -      20                   -
Other                            83                    -              53                 -      30                   -


* Percentages not shown where the percentage is less than 2%.
** International Emergency Economic Powers Act, 50 U.S.C. § 1701-1707.
""".splitlines()

# fiscal year 2016, Table 2: percentages under 2 percent are left blank
D2_2016 = """
 Offense                              Number   Percent*    Number   Percent*      Number    Percent*

 Total                                     945   100%      641       100%        304       100%

 Fraud                                       582     4%        451          5%         131          2%
 Sex Offenses                                362     2%        190          3%         173
 Contraband                                    1                0                       1
""".splitlines()

FISC_2025 = ("Summary of Findings The FISC disclosed that it received 287 applications and certifications in 2025. After consideration by the "
             "Court, 179 orders were granted, 91 orders were modified, 15 orders were denied in part, and 4 applications were denied in full. "
             "Explanation of Selected Terms More detailed statistics appear in the table below.")
FISC_2024 = ("Summary of Findings The FISC disclosed that it received 356 applications and certifications in 2024. After consideration by the "
             "Court, 267 orders were granted, 72 orders were modified, 15 orders were denied in part, and no application was denied in full. "
             "Explanation of Selected Terms")
FISC_2015 = ("Summary of Findings From June 8, 2015, to December 31, 2015, the FISC disclosed that it received 1,010 applications. After "
             "consideration by the court, 836 orders were granted, 169 orders were modified, and 5 applications were denied. Explanation of Selected Terms")


class NumberTests(unittest.TestCase):
    def test_figures_and_words(self):
        self.assertEqual(RP.count_of("1,010"), 1010)
        self.assertEqual(RP.count_of("seven"), 7)
        self.assertEqual(RP.count_of("Thirty-five"), 35)
        self.assertEqual(RP.count_of("no"), 0)
        self.assertIsNone(RP.count_of("five-six"))
        self.assertIsNone(RP.count_of("several"))
        self.assertIsNone(RP.count_of("1,01"))


class CourtLabelTests(unittest.TestCase):
    def test_state_names_and_districts(self):
        self.assertEqual(RP.dnsw_entity("NEW YORK (EASTERN)"), ("district", "nyed"))
        self.assertEqual(RP.dnsw_entity("MISSOURI (wESTERN)"), ("district", "mowd"))  # printed so in the 2010 report
        self.assertEqual(RP.dnsw_entity("MAINE"), ("district", "med"))
        self.assertEqual(RP.dnsw_entity("DISTRICT OF COLUMBIA"), ("district", "dcd"))
        self.assertEqual(RP.dnsw_entity("NORTHERN MARIANAS"), ("district", "nmid"))
        self.assertEqual(RP.dnsw_entity("GUAM"), ("district", "gud"))
        self.assertEqual(RP.dnsw_entity("DC CIRCUIT"), ("circuit", "cadc"))
        self.assertEqual(RP.dnsw_entity("ELEVENTH CIRCUIT"), ("circuit", "ca11"))
        self.assertEqual(RP.dnsw_entity("ALL CIRCUITS"), ("national", "national"))

    def test_no_closest_match(self):
        self.assertIsNone(RP.dnsw_entity("ATLANTIS"))
        self.assertIsNone(RP.dnsw_entity("NEW YORK (UPPER)"))
        self.assertIsNone(RP.dnsw_entity("TWELFTH CIRCUIT"))


def table1(lines):
    parsed, why = RP.parse_dnsw1_lines(lines)
    assert parsed is not None, why
    cols, rows, _ = parsed
    return RP.make_norm(pub="DNSW", table="DNSW 1", period_end="2010-09-30", title="t", title_listing="t", phrase=None, months=12, scope="district",
                        columns=cols, rows=rows, notes=[], printed_id="DNSW 1", sheet="PDF")


class Table1Tests(unittest.TestCase):
    def test_a_report_table_reads_and_adds_up(self):
        norm = table1(D1_2010)
        self.assertEqual([c["key"] for c in norm["columns"]][:3], ["all_applications", "average_delay_in_days", "warrants/total"])
        self.assertEqual([(r["entity"], r["entity_id"]) for r in norm["rows"]][:3], [("national", "national"), ("circuit", "ca1"), ("district", "med")])
        self.assertEqual(norm["rows"][-1]["values"], [51, 53, 47, 41, 5, 1, 4, 4, 0, 0])
        self.assertEqual(RP.dnsw_identities(norm, "DNSW 1"), [])

    def test_a_figure_that_breaks_the_circuit_sum_fails(self):
        lines = [line.replace("MASSACHUSETTS                  95", "MASSACHUSETTS                  96") for line in D1_2010]
        norm = table1(lines)
        fails = RP.dnsw_identities(norm, "DNSW 1")
        self.assertTrue(any("MASSACHUSETTS: all_applications 96" in f for f in fails))
        self.assertTrue(any(f.startswith("ca1 all_applications") for f in fails))

    def test_the_2007_layout_without_denied_columns(self):
        norm = table1(D1_2007)
        keys = [c["key"] for c in norm["columns"]]
        self.assertNotIn("warrants/denied", keys)
        self.assertEqual(len(keys), 8)
        self.assertEqual(RP.dnsw_identities(norm, "DNSW 1"), [])

    def test_an_unknown_label_stops_the_table(self):
        lines = D1_2010 + ["ATLANTIS                        1       30          1             1       0         0          0       0        0        0"]
        parsed, why = RP.parse_dnsw1_lines(lines)
        self.assertIsNone(parsed)
        self.assertIn("row label not a court: 'ATLANTIS'", why[0])


def table2(lines):
    parsed, why = RP.parse_dnsw2_lines(lines)
    assert parsed is not None, why
    cols, rows, notes = parsed
    norm = RP.make_norm(pub="DNSW", table="DNSW 2", period_end="2010-09-30", title="t", title_listing="t", phrase=None, months=12, scope="category",
                        columns=cols, rows=rows, notes=notes, printed_id="DNSW 2", sheet="PDF")
    return norm


class Table2Tests(unittest.TestCase):
    def test_wrapped_label_dashes_and_notes(self):
        norm = table2(D2_2010)
        labels = [r["label"] for r in norm["rows"]]
        self.assertEqual(labels, ["Total", "Drugs", "Fugitive/Supervised Release Violation", "IEEPA", "Other"])
        fug = norm["rows"][2]
        self.assertEqual(fug["values"], [47, None, 47, 2, 0, None])
        self.assertEqual(fug["flags"], [None, "dash", None, None, None, "dash"])
        self.assertEqual(norm["rows"][3]["marks"], ["**"])
        self.assertEqual(len(norm["notes"]), 2)
        self.assertEqual(RP.dnsw_identities(norm, "DNSW 2"), [])

    def test_blank_percentages_are_not_printed_not_zero(self):
        norm = table2(D2_2016)
        sex = next(r for r in norm["rows"] if r["label"] == "Sex Offenses")
        self.assertEqual(sex["values"], [362, 2, 190, 3, 173, None])
        self.assertEqual(sex["flags"][5], None)
        fails = RP.dnsw_identities(norm, "DNSW 2")
        self.assertIn("Sex Offenses: all applications 362 != warrants 190 + extensions 173", fails)

    def test_table_titles_with_the_period_on_the_next_line(self):
        text = "\n".join(["Table 2. Offenses Specified for Delayed-Notice Warrant and Extension Requests for 12-Month Period Ending",
                          "September 30, 2016", ""] + D2_2016 + ["Graph 1. Periods of Delayed Notice"])
        blocks = RP.dnsw_pdf_tables(text)
        (key, lines), = blocks.items()
        self.assertEqual(key[:2], ("DNSW 2", "2016-09-30"))
        self.assertTrue(any("Sex Offenses" in line for line in lines))


class SpreadsheetTests(unittest.TestCase):
    def test_the_title_over_the_headings_is_the_title(self):
        head = "DNSW Table 1. U.S. District Courts—Applications for Delayed Notice Search Warrants and Extensions, During the 12-Month Period Ending September 30, 2021"
        sheet = {"title_raw": "", "period_end_from_title": None,
                 "columns": [{"path": [head, "All Applications"]}, {"path": [head, "Warrants", "Total"]}]}
        self.assertTrue(RP.lift_title(sheet))
        self.assertEqual(sheet["columns"][1]["path"], ["Warrants", "Total"])
        self.assertEqual(sheet["period_end_from_title"], "2021-09-30")

    def test_rows_that_differ_only_in_case_are_kept_apart(self):
        rows = [RP.make_row(1, "Fraud", "category", "fraud", [1537]), RP.make_row(2, "fraud", "category", "fraud", [24])]
        rows[1]["label_raw"] = "fraud"
        norm = {"rows": rows}
        RP.distinct_labels(norm)
        self.assertEqual([r["entity_id"] for r in rows], ["fraud", "fraud~2"])


class FiscTests(unittest.TestCase):
    def test_summary_totals(self):
        totals, _, period = RP.fisc_summary(FISC_2025)
        self.assertEqual(totals, {"applications_or_certifications": 287, "orders_granted": 179, "orders_modified": 91, "orders_denied_in_part": 15,
                                  "applications_or_certifications_denied": 4})
        self.assertIsNone(period)

    def test_no_application_denied_is_zero_as_printed(self):
        totals, _, _ = RP.fisc_summary(FISC_2024)
        self.assertEqual(totals["applications_or_certifications_denied"], 0)

    def test_the_first_report_covers_part_of_the_year(self):
        totals, _, period = RP.fisc_summary(FISC_2015)
        self.assertEqual(period, "From June 8, 2015, to December 31, 2015")
        self.assertNotIn("orders_denied_in_part", totals)
        self.assertEqual(totals["applications_or_certifications"], 1010)

    def test_label_length(self):
        words = lambda *t: [{"text": x} for x in t]  # noqa: E731
        self.assertEqual(RP.label_length(words("1805", "and", "1824†", "216")), 3)
        self.assertEqual(RP.label_length(words("1805", "only", "34")), 2)
        self.assertEqual(RP.label_length(words("1842", "1")), 1)


class CvraTests(unittest.TestCase):
    def test_the_sentence_forms(self):
        cases = {
            "In the past year, the courts have reported the denial of relief under the Act in one case and mandamus actions brought pursuant to the Act in two additional cases. This report":
                {"cases_with_relief_denied": 1, "mandamus_actions": 2},
            "In the past year, the AO has received reports from the courts on seven mandamus actions brought per the provisions of the Act. What follows":
                {"mandamus_actions": 7},
            "Last year, the AO received reports from the appellate courts on four mandamus actions brought per the provisions of the CVRA and identified one appellate court case and six district court cases that meet the statute's reporting criteria.":
                {"mandamus_actions": 4, "appellate_court_cases": 1, "district_court_cases": 6},
            "For that year, 5 mandamus actions in appellate courts were identified as brought per the provisions of the CVRA and 10 district court cases were identified as meeting the statute’s reporting criteria.":
                {"mandamus_actions": 5, "district_court_cases": 10},
        }
        for text, want in cases.items():
            counts, sentence = RP.cvra_counts(text)
            self.assertEqual(counts, want, text[:60])
            self.assertTrue(sentence)

    def test_no_known_sentence_gives_no_counts(self):
        self.assertEqual(RP.cvra_counts("This report summarises several cases."), ({}, None))


if __name__ == "__main__":
    unittest.main()
