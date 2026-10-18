"""Offline tests for the jpml_history stream (synthetic fixtures, no network, no PDFs).

Run: cd scripts/enrichment/jpml_history && python3 -B -m unittest -v test_jpml_history
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import analytics as an  # noqa: E402
import parse_reports as pr  # noqa: E402
import parse_stats as ps  # noqa: E402

PENDING = """United States Judicial Panel on Multidistrict Litigation                        Report Date: 12/2/2025

                       MDL Statistics Report - Distribution of Pending MDL Dockets by Actions Pending
 MDL Filters:
  Status: Transferred
  Limited to Active Litigations


District         Judge (Title)                                   Docket No. Litigation                                         Actions Now Total Actions
                                                                                                                                 Pending (Historical)
NJ               Michael A. Shipp (U.S. District Judge)          MDL -2738 IN RE: Talc Products Liability Litigation             67,670      69,340
                 Brian R. Martinotti (U.S. District Judge)       MDL -3080 IN RE: Insulin Pricing Litigation                       445         526
                 James V. Selna (Sr. District Judge)
CAC                                                              MDL -3052 IN RE: Kia Hyundai Vehicle Theft Litigation             109         109
                 Laura M. Provinzino (District Judge)
                 Harvey E. Schlesinger (Sr. District Judge)
FLM              Marcia M. Howard (U.S. District Judge)          MDL -2626 IN RE: Disposable Contact Lens Antitrust Litigation       0          60
                 Virginia M. Covington (Sr. District Judge)

Report Totals:                                                     4                                               68,224      70,035

 Total Number of MDL Dockets: 4
 Total Number of Transferee Districts: 3



 Total Number of Transferee Judges: 7
             1 District Judge
             3 Sr. District Judge
             3 U.S. District Judge

                       -- All Counts Are Based on the Report Filters Selected When Running the Report --

 Docket Count      Range of the Number of Actions PENDING in a Docket          Dockets        Action Count   Actions
        1           MDLs with between 0 and 10 Pending Actions                  25%              0            0%
        0           MDLs with between 11 and 100 Pending Actions                0%               0            0%
        2           MDLs with 101 and 999 Pending Actions                       50%            554            0.81%
        1           MDLs with 1,000 or more Pending Actions                     25%         67,670           99.19%
"""

TYPES = """                       MDL Statistics Report - Docket Type Summary
  MDL Filters:
    Limited to Active Litigations

Antitrust
  2626 IN RE: Disposable Contact Lens Antitrust Litigation        Schlesinger, Harvey E.     FLM   3:15-md-2626   04/06/2015   06/08/2015
  3198 IN RE: National Collegiate Athletic Association Eligibility Rules Antitrust Litigation                08/01/2026


        Number of Antitrust Litigations Listed: 2


Products Liability
2738 IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and      Shipp, Michael A.          NJ    3:16-md-2738   07/15/2016   10/04/2016
Products Liability
2782 IN RE: Ethicon Physiomesh Flexible Composite Hernia Mesh Products Liability Litigation Story, Richard W.      GAN   1:17-md-2782   03/09/2017   06/02/2017
3132 IN RE: Midwest Energy Emissions Corp. Patent Litigation           Locher, Stephen H.      IAS                    10/16/2024   12/12/2024


        Number of Products Liability Litigations Listed: 3

 _____________________

   MDLs Listed on this Report: 5
"""

TERMINATED = """ MDL Statistics Report - Docket Summary Listing
MDL Filters:
 Status: Transferred
 Closed Between: 1/1/2025 - 8/1/2025
 Limited to Closed Litigations
 1869 IN RE: Rail Freight Fuel Surcharge Antitrust Litigation        Howell, Beryl A.          DC         1:07-mc-489     06/06/2007   11/06/2007      07/08/2025
 2504 IN RE: Amazon.com, Inc., Fulfillment Center Fair Labor Standards Act (FLSA) and         Hale, David J.           KYW         3:14-md-2504    10/12/2013   02/19/2014      01/13/2025
 Wage and Hour Litigation
_____
 MDLs Listed on this Report: 2
"""

SPINE = [
    {"id": "ilnd", "title": "District Court, N.D. Illinois"},
    {"id": "njd", "title": "District Court, D. New Jersey"},
    {"id": "dcd", "title": "District Court, District of Columbia"},
    {"id": "dup1", "title": "District Court, D. Utah"},
    {"id": "dup2", "title": "District Court, D. Utah"},
]


class PendingReportParsing(unittest.TestCase):
    def setUp(self):
        self.parsed = pr.parse_pending_report(PENDING)
        self.rows = {r["mdl"]: r for r in self.parsed["rows"]}

    def test_rows_totals_and_identity(self):
        self.assertEqual(len(self.parsed["rows"]), 4)
        self.assertEqual(pr.report_date(PENDING), "2025-12-02")
        self.assertEqual(pr.report_type_from_title(pr.report_title(PENDING)), "actions_pending")
        self.assertEqual(self.parsed["printed"]["pending"], 68224)
        self.assertEqual(self.rows[2738]["pending"], 67670)
        self.assertEqual(self.rows[2738]["total"], 69340)

    def test_blank_district_repeats_row_above(self):
        self.assertEqual(self.rows[3080]["district_printed"], "")
        self.assertEqual(self.rows[3080]["district"], "NJ")
        self.assertEqual(self.rows[3052]["district"], "CAC")

    def test_two_and_three_judges_centred_on_the_mdl_line(self):
        self.assertEqual([j["name"] for j in self.rows[3052]["judges"]], ["James V. Selna", "Laura M. Provinzino"])
        self.assertEqual(self.rows[3052]["judge"], "James V. Selna / Laura M. Provinzino")
        self.assertEqual([j["name"] for j in self.rows[2626]["judges"]], ["Harvey E. Schlesinger", "Marcia M. Howard", "Virginia M. Covington"])
        self.assertEqual(self.rows[2738]["judges"], [{"name": "Michael A. Shipp", "title": "U.S. District Judge"}])

    def test_header_wrap_is_not_a_judge(self):
        self.assertFalse(any(j["name"] == "Pending" for r in self.parsed["rows"] for j in r["judges"]))
        self.assertEqual(self.parsed["unparsed"], [])

    def test_validation_passes_with_printed_totals_and_buckets(self):
        v = pr.validate_pending(self.parsed)
        self.assertTrue(v["valid"], v)
        self.assertEqual(v["warnings"], [])

    def test_validation_fails_when_printed_sum_differs(self):
        bad = pr.parse_pending_report(PENDING.replace("68,224", "68,225"))
        v = pr.validate_pending(bad)
        self.assertFalse(v["valid"])
        self.assertIn("sum_pending_vs_printed", [c["check"] for c in v["checks"] if not c["ok"]])

    def test_missing_row_fails_row_count(self):
        bad = pr.parse_pending_report(PENDING.replace("MDL -3080", "MDLX3080"))
        self.assertFalse(pr.validate_pending(bad)["valid"])

    def test_file_name_dates(self):
        self.assertEqual(pr.date_from_filename("Pending_MDL_Dockets_By_District-July-1-2025_0.pdf"), "2025-07-01")
        self.assertEqual(pr.date_from_filename("Pending_MDL_Dockets_By_Actions_Pending-Febraury-14-2020.pdf"), "2020-02-14")
        self.assertIsNone(pr.date_from_filename("notes.pdf"))


class TypeAndTerminatedParsing(unittest.TestCase):
    def test_type_sections_tight_judge_filed_only_and_wrapped_heading(self):
        parsed = pr.parse_type_report(TYPES)
        rows = {r["mdl"]: r for r in parsed["rows"]}
        self.assertEqual(rows[2738]["type"], "Products Liability")
        self.assertEqual(rows[2782]["judge"], "Story, Richard W.")
        self.assertFalse(rows[3198]["transferred"])
        self.assertIsNone(rows[3132]["master_docket"])
        # the wrapped title line "Products Liability" inside the section is a continuation, not a new heading
        self.assertEqual(rows[2782]["type"], "Products Liability")
        self.assertTrue(rows[2738]["title"].endswith("Products Liability"))
        self.assertEqual(pr.report_filters(TYPES), ["Limited to Active Litigations"])
        self.assertTrue(pr.validate_type(parsed)["valid"])

    def test_type_count_mismatch_invalid(self):
        parsed = pr.parse_type_report(TYPES.replace("Listed: 3", "Listed: 4"))
        self.assertFalse(pr.validate_type(parsed)["valid"])

    def test_terminated_rows_and_window(self):
        parsed = pr.parse_terminated_report(TERMINATED)
        self.assertEqual([r["mdl"] for r in parsed["rows"]], [1869, 2504])
        self.assertEqual(parsed["rows"][0]["date_closed"], "2025-07-08")
        self.assertEqual(parsed["printed"]["closed_between"], ["2025-01-01", "2025-08-01"])
        self.assertTrue(pr.validate_terminated(parsed)["valid"])


class Aggregation(unittest.TestCase):
    def test_hhi_and_top_shares(self):
        self.assertEqual(an.hhi([50, 50]), 5000.0)
        self.assertEqual(an.hhi([100]), 10000.0)
        self.assertIsNone(an.hhi([0, 0]))
        self.assertEqual(an.top_n_share([60, 30, 10], 1), 60.0)
        self.assertEqual(an.top_n_share([60, 30, 10], 10), 100.0)

    def test_changes_need_both_months(self):
        pts = {"2025-01": {"pending": 100, "total": 150}, "2026-01": {"pending": 130, "total": 200}, "2025-12": {"pending": 0, "total": 10}}
        self.assertEqual(an.change(pts, "2026-01", 12), 30)
        self.assertEqual(an.pct_change(pts, "2026-01", 12), 30.0)
        self.assertEqual(an.change(pts, "2026-01", 12, "total"), 50)
        self.assertIsNone(an.change(pts, "2026-01", 3))  # 2025-10 missing
        self.assertIsNone(an.pct_change(pts, "2026-01", 1))  # base 0 -> not computed

    def test_months_and_periods(self):
        self.assertEqual(an.month_diff("2024-10", "2026-10"), 24)
        self.assertEqual(an.shift_month("2025-01", -1), "2024-12")
        series = [{"month": "2025-01", "d": "NJ", "p": 5}, {"month": "2025-02", "d": "NJ", "p": 9}, {"month": "2025-03", "d": "PAE", "p": 9}]
        self.assertEqual(an.periods(series, "d"), [{"value": "NJ", "from": "2025-01", "to": "2025-02", "reports": 2}, {"value": "PAE", "from": "2025-03", "to": "2025-03", "reports": 1}])
        self.assertEqual(an.peak(series, "p")["month"], "2025-02")  # tie -> earliest


class CourtMatching(unittest.TestCase):
    def test_exact_unique_match(self):
        self.assertEqual(an.match_court("ILN", SPINE)["court_id"], "ilnd")
        self.assertEqual(an.match_court("NJ", SPINE)["court_id"], "njd")
        self.assertEqual(an.match_court("DC", SPINE)["court_id"], "dcd")

    def test_non_match(self):
        m = an.match_court("TXW", SPINE)
        self.assertIsNone(m["court_id"])
        self.assertEqual(m["status"], "unmatched")

    def test_ambiguous_match_links_nothing(self):
        m = an.match_court("UT", SPINE)
        self.assertIsNone(m["court_id"])
        self.assertEqual(m["status"], "ambiguous")

    def test_unrecognised_code(self):
        self.assertEqual(an.match_court("XXQ", SPINE)["status"], "no_label")
        self.assertEqual(an.match_court(None, SPINE)["status"], "no_label")


class NotRecorded(unittest.TestCase):
    def test_formatting(self):
        self.assertEqual(an.fmt(None), "Not recorded")
        self.assertEqual(an.signed(None), "Not recorded")
        self.assertEqual(an.pct(None), "Not recorded")
        self.assertEqual(an.signed(-5), "-5")
        self.assertEqual(an.signed(1234), "+1,234")

    def test_month_without_type_report_has_no_products_share(self):
        import build_jpml_history as b

        parsed = pr.parse_pending_report(PENDING)
        primary = {"rows": parsed["rows"], "printed": parsed["printed"], "report_date": "2025-12-02", "type": "actions_pending", "url": "u", "sha256": "x", "valid": True, "printed_title": "t"}
        months = {"2025-12": {"month": "2025-12", "primary": primary, "pick": {"actions_pending": primary, "district": None, "mdl_number": None, "mdl_type": None}, "cross_checks": [], "all": {"actions_pending": [primary]}}}
        stats = b.build_month_stats(months, [], SPINE)
        self.assertIsNone(stats[0]["products_liability"]["actions_pct"])
        self.assertEqual(an.pct(stats[0]["products_liability"]["actions_pct"]), "Not recorded")
        self.assertIsNone(stats[0]["entered"])
        self.assertEqual(stats[0]["by_age"][0]["band"], "Not recorded")


class StatsParsing(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(ps.to_int("1,234"), 1234)
        self.assertEqual(ps.to_int("-"), None)
        self.assertEqual(ps.to_int("12a"), None)


# ---------------------------------------------------------------- fiscal-year statistics fixtures (synthetic)

def _nums(values):
    return "      ".join(f"{v:,}" if isinstance(v, int) and v >= 1000 else str(v) for v in values)


def dline(num=None, caption="", judge="", transferor="", nums=None):
    """One line of a Summary-by-Docket page: MDL number right-aligned to column 16, caption at 17, judge at 61,
    transferor list at 87, the five printed numbers last (after leader dots)."""
    s = " " * 12 + (f"{num:>4}" if num is not None else "    ") + " " + caption.ljust(42) + "  " + judge.ljust(24) + "  " + transferor
    if nums is not None:
        s = s.rstrip() + "…………" + "      " + _nums(nums)
    return s.rstrip()


def cont(text="", col=87, nums=None):
    s = " " * col + text
    if nums is not None:
        s += "…………" + "      " + _nums(nums)
    return s


PAGE_HEADER = [
    "        SUMMARY BY DOCKET OF MULTIDISTRICT LITIGATION PENDING AS OF SEPTEMBER 30, 2010, OR CLOSED SINCE OCTOBER 1, 2009",
    "                                                                                              Cases Terminated",
    "Index to MDL No.        MDL Caption        Transferee Judge   Transferor Districts and Number   Total Tr'd   Total Filed   Dismissed   Remanded   Cases Pending",
    "Tr'e Dist.                                               of Cases Transferred                       in Tr'e Court",
]


def docket_text(printed_count=4, totals=(574, 4086, 4530, 0, 130), dc_count=2, with_duplicate=True, e3_pending=17):
    e1 = [8, 16, 24, 0, 0]
    e2 = [99, 12, 3, 0, 105]  # 99 + 12 - (3 + 3 adjustment) = 105
    e3 = [462, 4054, 4499, 0, e3_pending]
    e4 = [5, 4, 1, 0, 8]
    lines = [
        "   SUMMARY BY DOCKET OF", "MULTIDISTRICT LITIGATION", "PENDING AS OF SEPTEMBER 30, 2010", *PAGE_HEADER, "",
        "                   Grand Totals………………………",
        f"                              ………..{printed_count} Total Litigations" + " " * 20 + _nums(totals), "",
        "                                          DISTRICT OF COLUMBIA CIRCUIT", "",
        f"   090             DISTRICT OF COLUMBIA                                   {dc_count} Litigations",
        dline(1869, "Rail Freight Fuel Surcharge AT*", "Friedman, P.L.", "1-ALN; 1-FLM; 2-ILN", e1),
        dline(2656, "Domestic Airline Travel AT*", "Kollar-Kotelly, C", "1-CAC; 25-CAN; 1-FLM;"),
        cont("13-MN; 17-NYE; 5-NYS;"),
        cont("(No. II)", col=17),
        cont("3-TXW; 1-VT", nums=e2),
        cont("Reassigned to PAE tr'or judge", nums=[0, 0, 3, 0, 0]), "",
        "                                          FIRST CIRCUIT", "",
        "   101             MASSACHUSETTS                                          1 Litigation",
        dline(2428, "Fresenius GranuFlo PL", "Motz, J.F.; Davis, A.M.;", "1-ALM; 2-ALN;"),
        " " * 61 + "and Blake, C.C.".ljust(26) + "3-ARK" + "…………" + "      " + _nums(e3), "",
        "                                          EIGHTH CIRCUIT", "",
        "                    IOWA SOUTHERN                                        1 Ltigations",
        dline(3078, "Generac Solar Power Systems", "", "1-CAE; 2-CAN; 1-FLM", e4),
    ]
    if with_duplicate:
        # the report prints a page twice: the same heading and entry again
        lines += ["", *PAGE_HEADER, "", "                                          FIRST CIRCUIT (continued)",
                  "   101             MASSACHUSETTS                                          1 Litigation",
                  dline(2428, "Fresenius GranuFlo PL", "Motz, J.F.; Davis, A.M.;", "1-ALM; 2-ALN;"),
                  " " * 61 + "and Blake, C.C.".ljust(26) + "3-ARK" + "…………" + "      " + _nums(e3)]
    lines += [""] * 3 + ["     BUT NOT TRANSFERRED", "Summary of Litigations Docketed but Not Transferred"]
    return "\n".join(lines) + "\n"


def district_text(massachusetts_pending=16):
    row = lambda label, vals: f"{label:<34}" + "   ".join(f"{v:,}" if isinstance(v, int) and v >= 1000 else str(v) for v in vals)
    lines = [
        "   SUMMARY OF MULTIDISTRICT LITIGATION BY CIRCUIT AND DISTRICT UNDER 28 U.S.C. § 1407",
        "                       12 Months Ending September 30, 2010                       Cumulative 1968-2010",
        "   Circuit and District    Index   Into Dist.  Out of Dist.  Net Change  Filed  Terminated  Into Dist.  Out of Dist.  Net Change  Filed  Terminated  Pending", "",
        row("  GRAND TOTALS", [10, 10, "-", 4, 6, 100, 100, "-", 40, 70, 30]), "",
        row("DISTRICT OF COLUMBIA CIRCUIT", [2, 3, -1, 0, 1, 20, 5, 15, 1, 10, 4]),
        row("District of Columbia    090", [2, 3, -1, 0, 1, 20, 5, 15, 1, 10, 4]), "",
        row("FIRST CIRCUIT", [8, 7, 1, 4, 5, 80, 95, -15, 39, 60, 26]),
        row("Maine*   100", [3, 2, 1, 1, 2, 30, 35, -5, 9, 20, 10]),
        row("Massachusetts   101", [5, 5, 0, 3, 3, 50, 60, -10, 30, 40, massachusetts_pending]), "",
    ]
    return "\n".join(lines) + "\n"


class FiscalYearTables(unittest.TestCase):
    def test_district_key_normalises_printed_variants_only_from_a_fixed_list(self):
        self.assertEqual(ps.district_key("ILLINOIS NORTHERN"), "illinois|N")
        self.assertEqual(ps.district_key("Illinois, N."), "illinois|N")
        self.assertEqual(ps.district_key("ILLINOIS, NORTHERN"), "illinois|N")
        self.assertEqual(ps.district_key("N. Carolina E."), "north carolina|E")
        self.assertEqual(ps.district_key("Tennesee, M."), "tennessee|M")
        self.assertEqual(ps.district_key("MASSACHUSSETTS"), "massachusetts|")
        self.assertEqual(ps.district_key("Maine*"), "maine|")
        self.assertEqual(ps.district_key("Northern Mariana Islands"), "northern mariana islands|")  # leading 'Northern' is the name
        self.assertNotEqual(ps.district_key("Kentucky, E."), ps.district_key("Kentucky, W."))

    def test_district_table_circuits_codes_and_footnote_marks(self):
        d = ps.parse_district_table(district_text())
        self.assertEqual(d["period"], (12, 2010))
        self.assertEqual([c["label"] for c in d["circuits"]], ["DISTRICT OF COLUMBIA CIRCUIT", "FIRST CIRCUIT"])
        first = d["circuits"][1]["districts"]
        self.assertEqual([(x["label"], x["code"]) for x in first], [("Maine", "100"), ("Massachusetts", "101")])
        self.assertEqual(d["grand"]["values"][10], 30)
        self.assertTrue(ps.validate_district_table(d)["valid"])

    def test_district_table_with_a_wrong_row_fails_not_repaired(self):
        v = ps.validate_district_table(ps.parse_district_table(district_text(massachusetts_pending=17)))
        self.assertFalse(v["valid"])
        self.assertIn("pending", " ".join(c["check"] for c in v["failed_required"]))

    def test_docket_entries_judges_adjustments_blank_judge_and_misspelt_heading(self):
        k = ps.parse_docket_table(docket_text())
        rows = {r["mdl"]: r for r in k["rows"]}
        self.assertEqual(sorted(rows), [1869, 2428, 2656, 3078])
        self.assertEqual(rows[1869]["values"], [8, 16, 24, 0, 0])
        self.assertEqual(rows[2656]["caption"], "Domestic Airline Travel AT* (No. II)")  # wrapped caption
        self.assertEqual(rows[2656]["adjustments"][0]["label"], "Reassigned to PAE tr'or judge")
        self.assertEqual(rows[2656]["adjustments"][0]["values"], [0, 0, 3, 0, 0])
        self.assertEqual(rows[2428]["judge"], "Motz, J.F.; Davis, A.M.; and Blake, C.C.")  # judge list wrapped to a second line
        self.assertIsNone(rows[3078]["judge"])  # the report prints no judge for this entry
        self.assertEqual(rows[3078]["district_name"], "IOWA SOUTHERN")
        self.assertIsNone(rows[3078]["district_code"])  # heading without a printed code stays without one
        self.assertEqual(k["district_heads"]["iowa|S"]["printed"], 1)  # 'Ltigations' misspelling still closes the heading
        self.assertEqual(k["printed_count"], 4)
        self.assertEqual(len(k["duplicates_dropped"]), 1)  # the repeated page's second copy of MDL 2428
        self.assertEqual(k["orphans"], [])

    def test_valid_docket_checks_sums_with_adjustments_and_the_balance_identity(self):
        v = ps.validate_docket_table(ps.parse_docket_table(docket_text()))
        self.assertTrue(v["valid"], v["failed"])
        self.assertEqual(v["attribution"]["status"], "verified")
        names = [c["check"] for c in v["checks"]]
        self.assertIn("sum:closed", names)
        self.assertIn("entry_balance_transferred_plus_filed_minus_closed_minus_remanded_equals_pending", names)

    def test_totals_that_do_not_add_up_exclude_the_edition(self):
        v = ps.validate_docket_table(ps.parse_docket_table(docket_text(totals=(574, 4086, 4530, 0, 131))))
        self.assertFalse(v["valid"])
        self.assertEqual([c["check"] for c in v["failed"]], ["sum:pending"])

    def test_entry_count_must_equal_the_printed_total_litigations(self):
        v = ps.validate_docket_table(ps.parse_docket_table(docket_text(printed_count=5)))
        self.assertIn("entry_count_vs_total_litigations", [c["check"] for c in v["failed"]])

    def test_balance_identity_catches_numbers_in_the_wrong_columns(self):
        # MDL 2428 printed with pending 18 where transferred + filed - closed - remanded = 17; the totals line is made to agree
        # with the printed entries, so only the per-entry balance can reject the edition
        v = ps.validate_docket_table(ps.parse_docket_table(docket_text(totals=(574, 4086, 4530, 0, 131), e3_pending=18)))
        self.assertFalse(v["valid"])
        self.assertEqual([c["check"] for c in v["failed"]], ["entry_balance_transferred_plus_filed_minus_closed_minus_remanded_equals_pending"])
        self.assertEqual(v["failed"][0]["failures"][0]["mdl"], 2428)

    def test_district_attribution_is_flagged_when_neither_count_nor_pending_agree(self):
        text = docket_text(dc_count=3)  # the heading says 3 litigations over 2 entries
        k = ps.parse_docket_table(text)
        v = ps.validate_docket_table(k)
        self.assertTrue(v["valid"])  # numbers still add up
        self.assertEqual(v["attribution"]["status"], "unverified")
        self.assertEqual(v["attribution"]["count_differences"], {"district of columbia|": [2, 3]})
        # a district table that agrees on pending actions restores 'verified' (matched on the printed code, else the name)
        full = district_text() + text
        d = ps.parse_district_table(full)
        v2 = ps.validate_docket_table(ps.parse_docket_table(full), d)
        self.assertEqual(v2["attribution"]["pending_agree"], False)  # fixture totals differ on purpose
        self.assertEqual(v2["attribution"]["status"], "unverified")

    def test_a_missing_second_page_of_an_entry_is_incomplete_not_guessed(self):
        text = docket_text().replace(dline(3078, "Generac Solar Power Systems", "", "1-CAE; 2-CAN; 1-FLM", [5, 4, 1, 0, 8]), dline(3078, "Generac Solar Power Systems", "Ellis, S.L.", "1-CAE; 2-CAN;"))
        k = ps.parse_docket_table(text)
        self.assertEqual(k["incomplete"], [{"mdl": 3078, "line": k["incomplete"][0]["line"]}])
        self.assertFalse(ps.validate_docket_table(k)["valid"])

    def test_line_pages_counts_form_feeds(self):
        self.assertEqual(ps.line_pages("a\nb\fc\nd\fe"), [1, 1, 2, 2, 3])

    def test_narrative_sentences_and_word_numbers(self):
        n = ps.parse_narrative("The Panel granted nineteen motions. The Panel transferred 1,398 cases that were pending in 66 district courts to 45 transferee districts. there were 197,118 actions pending in 158 MDLs in 45 transferee district courts.")
        self.assertEqual(n["motions_granted_fy"]["value"], 19)
        self.assertEqual(n["cases_transferred_fy"]["value"], 1398)
        self.assertEqual(n["pending_mdls_fy_end"]["value"], 158)
        self.assertEqual(ps.word_number("twenty-one"), 21)
        self.assertIsNone(ps.word_number("several"))


# ---------------------------------------------------------------- fiscal-year dataset builder (synthetic editions)

import build_statistics_extra as bse  # noqa: E402
import build_jpml_history as bh  # noqa: E402

SPINE_FY = SPINE + [
    {"id": "vid", "title": "District Court, Virgin Islands"},
    {"id": "ilnd2", "title": "District Court, N.D. Illinois"},
    {"id": "nyed", "title": "District Court, E.D. New York"},
    {"id": "mad", "title": "District Court, D. Massachusetts"},
]


def edition(fy, text):
    ed = bse.parse_edition(text)
    ed.update({"url": f"https://example.invalid/{fy}.pdf", "path": f"statistics/{fy}.pdf", "sha256": "x", "bytes": 1, "link_text": f"Fiscal Year {fy}", "link_year": fy, "year_agrees": True, "retrieved_at": "2026-10-18T00:00:00Z"})
    ed["district_ok"] = ed["district_check"]["valid"]
    ed["docket_ok"] = ed["docket_check"]["valid"]
    return ed


class FiscalYearBuilder(unittest.TestCase):
    def setUp(self):
        self.text = district_text() + docket_text()
        self.ed = edition(2010, self.text)

    def test_fixture_edition_validates(self):
        self.assertTrue(self.ed["district_ok"])
        self.assertTrue(self.ed["docket_ok"], self.ed["docket_check"]["failed"])

    def test_fy_stats_formulas(self):
        s = bse.fy_stats(self.ed, None)
        self.assertEqual((s["transferred"], s["filed_in_transferee"], s["closed"], s["pending"]), (10, 4, 6, 30))
        self.assertEqual(s["subjected"], 14)  # transferred + filed
        self.assertIsNone(s["roll_forward_residual"])  # no previous edition
        d = s["docket"]
        self.assertEqual((d["entries"], d["mdls_with_pending_actions"], d["pending_total"]), (4, 3, 130))
        self.assertEqual(d["top1_share_pct"], round(100 * 105 / 130, 2))
        self.assertEqual(d["top10_share_pct"], 100.0)
        self.assertEqual(d["hhi_mdl_pending"], round(sum((100 * v / 130) ** 2 for v in (0, 105, 17, 8)), 1))

    def test_roll_forward_residual_only_for_consecutive_editions(self):
        prev = edition(2009, self.text)
        s = bse.fy_stats(self.ed, prev)
        self.assertEqual(s["roll_forward_residual"], 30 - (30 + 14 - 6))
        self.assertIsNone(bse.fy_stats(self.ed, edition(2007, self.text))["roll_forward_residual"])

    def test_failed_docket_edition_is_not_recorded_and_says_why(self):
        bad = edition(2011, district_text() + docket_text(totals=(574, 4086, 4530, 0, 999)))
        self.assertFalse(bad["docket_ok"])
        s = bse.fy_stats(bad, None)
        self.assertIsNone(s["docket"])
        rows = bse.fy_rows([bad], {2011: s})
        facts = dict(map(tuple, rows[0]["detail"]["facts"]))
        self.assertTrue(facts["Summary by Docket"].startswith("Not recorded"))
        self.assertEqual(rows[0]["item"]["cells"]["top10"], "Not recorded")
        self.assertIn("Docket table not validated", rows[0]["item"]["badges"])
        self.assertEqual(bse.mdl_points([bad]), {})  # nothing from an excluded docket table reaches a series
        self.assertIn("sum:pending", bse.exclusion_reason(bad, "docket"))

    def test_mdl_points_sum_entries_of_one_mdl_under_two_districts(self):
        ed = edition(2010, self.text)
        extra = dict(ed["docket"]["rows"][0])
        extra.update({"district_name": "NEW YORK EASTERN", "district_key": "new york|E", "district_code": "207", "values": [1, 2, 3, 0, 0], "adjustments": []})
        ed["docket"]["rows"].append(extra)  # MDL 1869 printed under a second district
        pts = bse.mdl_points([ed])
        p = pts[1869][0]
        self.assertEqual(p["parts"], 2)
        self.assertEqual(p["transferred"], 8 + 1)
        self.assertIn(" / ", p["district"])
        self.assertEqual(pts[2656][0]["adjustments"], [{"label": "Reassigned to PAE tr'or judge", "values": [0, 0, 3, 0, 0]}])
        self.assertTrue(pts[1869][0]["class_action_asterisk"])
        self.assertEqual(pts[1869][0]["caption"], "Rail Freight Fuel Surcharge AT")  # the asterisk is kept as a flag, not in the caption

    def test_mdl_series_peak_gaps_and_excluded_editions(self):
        e10 = edition(2010, self.text)
        e11 = edition(2011, district_text() + docket_text(totals=(574, 4086, 4530, 0, 999)))  # excluded
        e12 = edition(2012, self.text)
        pts = bse.mdl_points([e10, e11, e12])
        rec = bse.mdl_record_data(2656, pts[2656], [e10, e11, e12], [])
        self.assertEqual((rec["first_fy"], rec["last_fy"], rec["fiscal_years"]), (2010, 2012, 2))
        self.assertEqual(rec["edition_excluded_years_inside_span"], [2011])
        self.assertEqual(rec["peak_pending"], 105)
        self.assertEqual(rec["peak_fy"], 2010)  # a tie resolves to the earliest year
        self.assertEqual(rec["pending_vs_peak_pct"], 100.0)
        self.assertEqual(rec["series"][1]["pending_change_vs_prev_fy"], None)  # FY2011 is not a validated edition: no adjacent comparison

    def test_court_keys_unique_match_ambiguous_and_non_match(self):
        self.assertEqual(an.match_court_key("illinois|N", SPINE_FY)["status"], "ambiguous")  # two spine titles are identical
        self.assertIsNone(an.match_court_key("illinois|N", SPINE_FY)["court_id"])
        m = an.match_court_key("new york|E", SPINE_FY)
        self.assertEqual((m["status"], m["court_id"]), ("matched", "nyed"))
        self.assertEqual(an.match_court_key("district of columbia|", SPINE_FY)["court_id"], "dcd")
        self.assertEqual(an.match_court_key("massachusetts|", SPINE_FY)["court_id"], "mad")
        self.assertEqual(an.match_court_key("virgin islands|", SPINE_FY)["court_id"], "vid")  # territories also tried under their bare name
        none = an.match_court_key("wyoming|", SPINE_FY)
        self.assertEqual((none["status"], none["court_id"]), ("unmatched", None))
        self.assertEqual(an.match_court_key("", SPINE_FY)["status"], "no_label")
        self.assertEqual(an.court_label_from_key("new york|E"), "E.D. New York")
        self.assertEqual(an.court_label_from_key("maine|"), "D. Maine")

    def test_district_rows_link_only_unique_exact_courts_and_skip_inactive_districts(self):
        s = {2010: bse.fy_stats(self.ed, None)}
        rows, courts = bse.district_rows([self.ed], s, SPINE_FY)
        ids = {r["id"] for r in rows}
        self.assertEqual(ids, {"district:district-of-columbia", "district:maine", "district:massachusetts"})
        dc = next(r for r in rows if r["id"] == "district:district-of-columbia")
        self.assertIn({"url": "/courts/dcd", "label": "District of Columbia (court page)"}, dc["item"]["links"])
        mad = next(r for r in rows if r["id"] == "district:massachusetts")
        self.assertEqual(mad["item"]["series"][0]["pending"], 16)
        maine = next(r for r in rows if r["id"] == "district:maine")  # no 'D. Maine' in this spine: no court link
        self.assertFalse(any(link["url"].startswith("/courts/") for link in maine["item"]["links"]))
        self.assertEqual(courts["maine|"]["status"], "unmatched")

    def test_reconciliation_with_monthly_reports_and_notes(self):
        monthly = {1869: {"2010-10": 0}, 2656: {"2010-10": 140}, 2428: {"2010-10": 17}, 9999: {"2010-10": 5}}
        r = bse.reconcile([self.ed], monthly)[0]
        self.assertEqual((r["mdls_in_both"], r["identical_pending"]), (3, 2))
        self.assertEqual(r["only_in_monthly_report"], [9999])
        self.assertEqual(r["differences"], [{"mdl": 2656, "fy_end": 105, "monthly": 140}])
        notes = bse.month_notes([r])
        self.assertIn("MDL 2656 105 (Sept 30) vs 140", notes["2010-10"][0])
        self.assertEqual(bse.mdl_notes([r])[2656], ["FY2010 Statistical Analysis prints 105 pending at Sept 30, 2010; the 2010-10 monthly report prints 140."])
        self.assertEqual(bse.reconcile([self.ed], None), [])  # no monthly data: nothing is claimed

    def test_cross_reference_rates_count_non_matches(self):
        recs = {1869: {"last_fy": 2010}, 2656: {"last_fy": 2010}, 777: {"last_fy": 2008}}
        lookups = {"known": {1869, 777}, "terminated": {777: [2008]}}
        courts = {"maine|": {"court_id": None}, "illinois|N": {"court_id": "ilnd"}}
        x = bse.cross_references(recs, lookups, {1869: {}}, courts)
        self.assertEqual((x["mdl_numbers"], x["lens_link_targets_with_known_content"], x["in_monthly_pending_history"]), (3, 2, 1))
        self.assertEqual((x["last_listed_before_latest_edition_and_in_terminated_history"], x["last_fy_equals_termination_year"]), (1, 1))
        self.assertEqual((x["districts"], x["districts_matched_to_court_spine"], x["districts_unmatched"]), (2, 1, ["maine|"]))


class MonthlyDatasetFields(unittest.TestCase):
    def test_growth_buckets_match_mdl_analytics(self):
        self.assertEqual(bh.growth_bucket(None), "insufficient_history")
        self.assertEqual(bh.growth_bucket(25.0), "fast_growth")
        self.assertEqual(bh.growth_bucket(24.9), "growing")
        self.assertEqual(bh.growth_bucket(5.0), "growing")
        self.assertEqual(bh.growth_bucket(4.9), "stable")
        self.assertEqual(bh.growth_bucket(-4.9), "stable")
        self.assertEqual(bh.growth_bucket(-5.0), "declining")

    def test_status_three_states_and_mass_tort_definition(self):
        self.assertEqual(bh.STATUS3["listed_after_closing_date"], "pending")
        self.assertEqual(bh.STATUS3["closing_date_before_last_listing"], "no_longer_listed")
        self.assertEqual(bh.MASS_TORT_TYPES, {"Products Liability", "Common Disaster", "Air Disaster"})

    def test_lifetime_curve_labels_both_sources_and_never_blends_them(self):
        r = {"series": [{"report_date": "2025-10-01", "pending": 9}, {"report_date": "2025-11-03", "pending": 8}]}
        fy = {"series": [{"date": "2025-09-30", "pending": 10, "fy": 2025}, {"date": "2024-09-30", "pending": 12, "fy": 2024}]}
        curve = bh.lifetime_curve(r, fy)
        self.assertEqual([(p["date"], p["source"]) for p in curve], [("2024-09-30", "fiscal_year_statistics"), ("2025-09-30", "fiscal_year_statistics"), ("2025-10-01", "monthly_report"), ("2025-11-03", "monthly_report")])
        self.assertEqual([p["source"] for p in bh.lifetime_curve(r, None)], ["monthly_report", "monthly_report"])  # MDL not in a validated edition: Not recorded, no invented history


class MdlRowKeysAndLinks(unittest.TestCase):
    def setUp(self):
        parsed = pr.parse_pending_report(PENDING)
        primary = {"rows": parsed["rows"], "printed": parsed["printed"], "report_date": "2025-12-02", "type": "actions_pending", "url": "https://example.invalid/r.pdf", "sha256": "x", "valid": True, "printed_title": "t"}
        months = {"2025-12": {"month": "2025-12", "primary": primary, "pick": {"actions_pending": primary, "district": None, "mdl_number": None, "mdl_type": None}, "cross_checks": [], "all": {"actions_pending": [primary]}}}
        hist, self.courts = bh.build_mdl_history(months, SPINE, {})
        self.rows = {r["id"]: r for r in bh.mdl_rows(hist, "2025-12", ["2025-12"])}

    def test_ids_are_plain_mdl_numbers_and_lens_links_use_the_exact_number(self):
        self.assertEqual(sorted(self.rows), ["2626", "2738", "3052", "3080"])
        self.assertIn("/matters/lens/2738", [x["url"] for x in self.rows["2738"]["item"]["links"]])
        self.assertEqual(self.rows["2738"]["item"]["cells"]["mdl"], "2738")

    def test_court_link_only_on_a_unique_exact_title(self):
        urls = {mdl: [x["url"] for x in r["item"]["links"] if x["url"].startswith("/courts/")] for mdl, r in self.rows.items()}
        self.assertEqual(urls["2738"], ["/courts/njd"])  # 'NJ' -> District Court, D. New Jersey
        self.assertEqual(urls["3080"], ["/courts/njd"])  # blank district cell repeats the row above (carried, labelled)
        self.assertEqual(urls["3052"], [])  # 'CAC' has no court_spine title in this lookup: no link, no guess
        self.assertEqual(self.courts["CAC"]["status"], "unmatched")

    def test_field_names_follow_mdl_analytics_and_unknown_values_say_not_recorded(self):
        a = self.rows["2738"]["item"]["analytics"]
        for key in ("mdl", "type", "mass_tort", "status", "district", "judge", "pending", "total", "as_of", "change_12m", "new_12m", "resolved_12m", "growth", "peak_pending", "series"):
            self.assertIn(key, a)
        self.assertEqual(a["series"], [{"date": "2025-12-02", "pending": 67670, "total": 69340}])
        f = self.rows["2738"]["filters"]
        self.assertEqual((f["status"], f["growth"], f["mass_tort"], f["type"]), (["pending"], ["insufficient_history"], ["no"], ["not_recorded"]))
        self.assertEqual(self.rows["2738"]["item"]["cells"]["type"], "Not recorded")  # no Docket Type Summary read: no type is inferred from the caption
        self.assertEqual(self.rows["2738"]["item"]["cells"]["change_12m"], "Not recorded")
        facts = dict(map(tuple, self.rows["2738"]["detail"]["facts"]))
        self.assertTrue(facts["Fiscal-year-end history (Sept 30, JPML Statistical Analysis)"].startswith("Not recorded"))


if __name__ == "__main__":
    unittest.main()
