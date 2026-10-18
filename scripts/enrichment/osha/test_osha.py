"""Offline unit tests for the OSHA enrichment builder (synthetic fixtures, no network).

Run: cd scripts/enrichment/osha && python3 -B -m unittest -v test_osha
"""
import collections
import csv
import datetime
import gzip
import io
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import build_osha as B  # noqa: E402
import osha_parsing as P  # noqa: E402
import sir_published as SIR  # noqa: E402


class ParsingTests(unittest.TestCase):
    def test_dates_and_fiscal_year(self):
        self.assertEqual(P.parse_date("2008-01-04 00:00:00+00:00"), datetime.date(2008, 1, 4))
        self.assertIsNone(P.parse_date("NaT"))
        self.assertIsNone(P.parse_date(""))
        self.assertIsNone(P.parse_date("2021-02-30 00:00:00"))
        self.assertEqual(P.fiscal_year(datetime.date(2025, 9, 30)), 2025)
        self.assertEqual(P.fiscal_year(datetime.date(2025, 10, 1)), 2026)
        self.assertIsNone(P.fiscal_year(None))

    def test_money_and_not_recorded(self):
        self.assertEqual(P.money("1250"), 1250.0)
        self.assertEqual(P.money("1,250.50"), 1250.5)
        self.assertIsNone(P.money(""))
        self.assertIsNone(P.money("nan"))
        self.assertIsNone(P.money("abc"))
        self.assertEqual(P.money_label(None), "Not recorded")
        self.assertEqual(P.money_label(1234.6), "$1,235")
        self.assertEqual(B.facts([("A", None), ("B", 3)]), [["A", "Not recorded"], ["B", "3"]])

    def test_classification(self):
        self.assertEqual(P.inspection_class("H"), "programmed")
        self.assertEqual(P.inspection_class("M"), "unprogrammed")
        self.assertEqual(P.inspection_class("B"), "unprogrammed")
        self.assertEqual(P.inspection_class("E"), "other")
        self.assertEqual(P.inspection_class(""), "other")
        self.assertEqual(P.jurisdiction("0950411"), "state_plan")
        self.assertEqual(P.jurisdiction("0111700"), "federal")
        self.assertIsNone(P.jurisdiction(""))
        self.assertEqual(P.viol_key("s"), "serious")
        self.assertEqual(P.viol_key("W"), "willful")
        self.assertEqual(P.viol_key("X"), "other_codes")

    def test_naics_sector(self):
        self.assertEqual(P.naics_sector("236220"), "23")
        self.assertEqual(P.naics_sector("332710"), "31-33")
        self.assertEqual(P.naics_sector("493110"), "48-49")
        self.assertIsNone(P.naics_sector("000000"))
        self.assertIsNone(P.naics_sector(""))
        self.assertIsNone(P.naics_sector("nan"))

    def test_standard_section(self):
        self.assertEqual(B.standard_section("19260501 B13"), "1926.501")
        self.assertEqual(B.standard_section("19100147 C04 I"), "1910.147")
        self.assertEqual(B.standard_section("5A0001"), "5A0001")
        self.assertIsNone(B.standard_section(""))

    def test_statistics(self):
        self.assertEqual(P.median([3, 1, 2]), 2.0)
        self.assertEqual(P.median([4, 1, 2, 3]), 2.5)
        self.assertIsNone(P.median([]))
        self.assertEqual(P.nearest_rank([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90), 90.0)
        self.assertEqual(P.nearest_rank([5], 99), 5.0)
        self.assertAlmostEqual(P.top_share([90, 5, 5], 0.01), 0.9)
        self.assertIsNone(P.top_share([0, 0], 0.5))
        self.assertEqual(P.pct_change(110, 100), 10.0)
        self.assertIsNone(P.pct_change(5, 0))
        self.assertEqual(P.penalty_bucket(0), "0")
        self.assertEqual(P.penalty_bucket(999.99), "1-999")
        self.assertEqual(P.penalty_bucket(999.995), "1-999")
        self.assertEqual(P.penalty_bucket(1000), "1000-4999")
        self.assertEqual(P.penalty_bucket(750000), "500000+")


class CompanyMatchTests(unittest.TestCase):
    def setUp(self):
        self.index = P.build_title_index([
            {"id": "0000037996", "title": "FORD MOTOR CO"},
            {"id": "0000101462", "title": "UNITED REFINING CO"},
            {"id": "0001040270", "title": "United  Refining Co"},
            {"id": "summary:overview", "title": "SEC company intelligence overview"},
        ])

    def test_exact_unique_match_after_case_and_space(self):
        self.assertEqual(P.match_company("Ford  Motor Co ", self.index), ("matched", "0000037996"))

    def test_non_match_keeps_punctuation(self):
        self.assertEqual(P.match_company("FORD MOTOR COMPANY", self.index), ("no_match", None))
        self.assertEqual(P.match_company("FORD MOTOR CO.", self.index), ("no_match", None))

    def test_ambiguous_is_not_linked(self):
        self.assertEqual(P.match_company("UNITED REFINING CO", self.index), ("ambiguous", None))

    def test_non_cik_ids_ignored(self):
        self.assertEqual(P.match_company("SEC company intelligence overview", self.index), ("no_match", None))


def violation_row(aid, viol_type, init, curr, delete="", citation=""):
    return {"ACTIVITY_NR": str(aid), "DELETE_FLAG": delete, "VIOL_TYPE": viol_type, "INITIAL_PENALTY": init, "CURRENT_PENALTY": curr,
            "STANDARD": "19260501 B13", "CITATION_ID": citation}


def inspection_row(aid, state, opened, closed, itype, rid, naics, name="ACME ROOFING LLC"):
    return {"ACTIVITY_NR": str(aid), "SITE_STATE": state, "OPEN_DATE": opened, "CLOSE_CASE_DATE": closed, "INSP_TYPE": itype,
            "REPORTING_ID": rid, "NAICS_CODE": naics, "ESTAB_NAME": name, "SAFETY_HLTH": "S", "INSP_SCOPE": "A", "SITE_CITY": "AUSTIN"}


class AggregationTests(unittest.TestCase):
    def test_violation_table_excludes_deleted_and_sums(self):
        table = B.ViolationTable()
        for row in [violation_row(1, "S", "1000", "600"), violation_row(1, "W", "5000", "4000"), violation_row(1, "O", "", "nan"),
                    violation_row(1, "S", "9999", "9999", delete="X"), violation_row(2, "R", "300", "300"), violation_row("", "S", "1", "1")]:
            table.add(row)
        one = table.get(1)
        self.assertEqual(one["items"], 3)
        self.assertEqual(one["violations"]["serious"], 1)
        self.assertEqual(one["violations"]["willful"], 1)
        self.assertEqual(one["violations"]["other"], 1)
        self.assertEqual(one["initial"], 6000.0)
        self.assertEqual(one["current"], 4600.0)
        self.assertEqual(one["grouped_total"], 3)  # no CITATION_ID letters: every record is an item
        self.assertEqual(table.stats["deleted"], 1)
        self.assertEqual(table.stats["no_activity_nr"], 1)
        self.assertEqual(table.stats["initial_blank"], 1)
        self.assertIsNone(table.get(3))


    def test_lettered_item_groups_count_once_as_items_but_every_row_is_a_record(self):
        table = B.ViolationTable()
        rows = [violation_row(5, "S", "400", "400", citation="01001A"), violation_row(5, "S", "0", "0", citation="01001B"),
                violation_row(5, "S", "0", "0", citation="01001C"), violation_row(5, "R", "900", "900", citation="01002"),
                violation_row(5, "S", "300", "300", citation="02001A"), violation_row(5, "S", "0", "0", citation="02001B", delete="X"),
                violation_row(6, "S", "100", "100", citation="01001A")]   # another inspection with the same citation id
        for row in rows:
            table.add(row)
        five = table.get(5)
        self.assertEqual(five["items"], 5)                      # records: the deleted row is excluded
        self.assertEqual(five["violations"]["serious"], 4)
        self.assertEqual(five["grouped_total"], 3)               # items 01001, 01002, 02001
        self.assertEqual(five["grouped"]["serious"], 2)
        self.assertEqual(five["grouped"]["repeat"], 1)
        self.assertEqual(table.get(6)["grouped_total"], 1)
        self.assertEqual(table.stats["lettered_group_records_not_counted_as_items"], 2)
        self.assertEqual(five["initial"], 1600.0)                # penalties are sums over records, unaffected by grouping

    def test_state_year_bucket_math(self):
        table = B.ViolationTable()
        for row in [violation_row(10, "S", "1000", "500"), violation_row(10, "S", "1000", "500"), violation_row(11, "R", "200", "0")]:
            table.add(row)
        bucket = B.blank_year()
        rows = [inspection_row(10, "TX", "2024-10-03 00:00:00+00:00", "2024-12-02 00:00:00+00:00", "M", "0655500", "238160"),
                inspection_row(11, "TX", "2025-01-10 00:00:00+00:00", "NaT", "H", "0627100", "000000"),
                inspection_row(12, "TX", "2025-03-01 00:00:00+00:00", "2025-03-11 00:00:00+00:00", "E", "", "332710")]
        for row in rows:
            aid = int(row["ACTIVITY_NR"])
            B.add_inspection(bucket, row, P.inspection_class(row["INSP_TYPE"]), P.jurisdiction(row["REPORTING_ID"]),
                             P.naics_sector(row["NAICS_CODE"]), table.get(aid), B.close_days(row))
        entry = B.finish_year(2025, bucket, {"23": "Construction", "31-33": "Manufacturing"})
        self.assertEqual(entry["inspections"], 3)
        self.assertEqual((entry["programmed"], entry["unprogrammed"], entry["other_type"]), (1, 1, 1))
        self.assertEqual(entry["fat_cat"], 1)
        self.assertEqual((entry["federal"], entry["state_plan"], entry["jurisdiction_not_recorded"]), (1, 1, 1))
        self.assertEqual(entry["violations"]["serious"], 2)
        self.assertEqual(entry["violations"]["repeat"], 1)
        self.assertEqual(entry["initial_penalty"], 2200.0)
        self.assertEqual(entry["current_penalty"], 1000.0)
        self.assertEqual(entry["current_to_initial_pct"], 45.45)
        self.assertEqual(entry["penalized_inspections"], 1)
        self.assertEqual(entry["median_current_penalty"], 1000.0)
        self.assertEqual(entry["open_cases"], 1)
        self.assertEqual(entry["closed_cases"], 2)
        self.assertEqual(entry["median_days_to_close"], 35.0)  # (60 + 10) / 2
        self.assertEqual(entry["naics_not_recorded"], 1)
        self.assertEqual([s["sector"] for s in entry["top_naics"]], ["23", "31-33"])
        nat = B.national_extras(entry, bucket)
        self.assertEqual(nat["penalty_distribution"]["0"], 2)
        self.assertEqual(nat["penalty_distribution"]["1000-4999"], 1)
        self.assertEqual(nat["top1pct_share_current_penalty"], 100.0)

    def test_sum_years_window(self):
        entries = []
        for fy, n, pen in [(2015, 5, 10.0), (2016, 7, 20.0), (2025, 3, 30.0), (2026, 9, 40.0)]:
            e = {k: 0 for k in ("inspections", "programmed", "unprogrammed", "other_type", "fat_cat", "accident", "complaint", "referral",
                                "follow_up", "federal", "state_plan", "jurisdiction_not_recorded", "with_violations", "violation_items",
                                "open_cases", "violation_records")}
            e.update({"fy": fy, "inspections": n, "initial_penalty": pen, "current_penalty": pen, "violations": P.blank_violations(),
                      "items_by_type": P.blank_violations()})
            entries.append(e)
        total = B.sum_years(entries, 2016, 2025)
        self.assertEqual(total["inspections"], 10)
        self.assertEqual(total["current_penalty"], 50.0)
        self.assertEqual(total["fy_range"], [2016, 2025])

    def test_close_days_guards(self):
        self.assertEqual(B.close_days({"OPEN_DATE": "2020-01-01", "CLOSE_CASE_DATE": "2020-01-31"}), 30)
        self.assertIsNone(B.close_days({"OPEN_DATE": "2020-01-01", "CLOSE_CASE_DATE": "2019-12-31"}))
        self.assertIsNone(B.close_days({"OPEN_DATE": "2020-01-01", "CLOSE_CASE_DATE": "0120-01-01"}))
        self.assertIsNone(B.close_days({"OPEN_DATE": "2020-01-01", "CLOSE_CASE_DATE": "NaT"}))

    def test_site_code_and_plan_status(self):
        self.assertEqual(B.site_code({"SITE_STATE": "tx"}), "TX")
        self.assertEqual(B.site_code({"SITE_STATE": "PR"}), "PR")
        self.assertEqual(B.site_code({"SITE_STATE": "UK"}), B.OTHER)
        self.assertEqual(B.site_code({"SITE_STATE": ""}), B.OTHER)
        self.assertTrue(B.plan_status("CA").startswith("State Plan (private"))
        self.assertTrue(B.plan_status("NY").startswith("State Plan (state/local"))
        self.assertEqual(B.plan_status("TX"), "Federal OSHA (no State Plan)")
        self.assertEqual(B.plan_status(B.OTHER), "Not applicable")


class CsvReadingTests(unittest.TestCase):
    def test_gz_rows_reads_bom_header_in_chunk_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.join(tmp, "dol", "violation")
            os.makedirs(folder)
            for n, aid in ((10, "2"), (2, "1")):
                buffer = io.StringIO()
                writer = csv.writer(buffer)
                writer.writerow(["ACTIVITY_NR", "VIOL_TYPE"])
                writer.writerow([aid, "S"])
                with gzip.open(os.path.join(folder, f"2026-10-17_chunk_{n}.csv.gz"), "wt", encoding="utf-8-sig", newline="") as out:
                    out.write(buffer.getvalue())
            saved = B.ACQ
            B.ACQ = tmp
            try:
                rows = list(B.gz_rows("violation"))
            finally:
                B.ACQ = saved
            self.assertEqual([r["ACTIVITY_NR"] for r in rows], ["1", "2"])
            self.assertIn("ACTIVITY_NR", rows[0])


class InspectionNumberTests(unittest.TestCase):
    def test_modern_numbers_follow_the_observed_pattern(self):
        # ACTIVITY_NR -> osha.gov inspection number, as read on five establishment pages (search-index snippets of osha.gov)
        pairs = {"343371712": "1337171.015", "340574045": "1057404.015", "342810868": "1281086.015",
                 "343716221": "1371622.015", "348170341": "1817034.015"}
        for activity, shown in pairs.items():
            self.assertEqual(B.inspection_number(activity), shown)
            self.assertEqual(B.inspection_number(int(activity)), shown)

    def test_legacy_numbers_unchanged(self):
        self.assertEqual(B.inspection_number("310463336"), "310463336")
        self.assertEqual(B.inspection_number(1234), "1234")


class ScanInspectionTests(unittest.TestCase):
    COLUMNS = ["ACTIVITY_NR", "REPORTING_ID", "ESTAB_NAME", "SITE_CITY", "SITE_STATE", "NAICS_CODE", "INSP_TYPE", "INSP_SCOPE",
               "SAFETY_HLTH", "OPEN_DATE", "CLOSE_CASE_DATE"]

    def scan(self, rows, violations=()):
        tmp = tempfile.mkdtemp()
        folder = os.path.join(tmp, "dol", "inspection")
        os.makedirs(folder)
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=self.COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({c: row.get(c, "") for c in self.COLUMNS})
        with gzip.open(os.path.join(folder, "2026-10-17_chunk_1.csv.gz"), "wt", encoding="utf-8-sig", newline="") as out:
            out.write(buffer.getvalue())
        table = B.ViolationTable()
        for row in violations:
            table.add(row)
        saved = B.ACQ
        B.ACQ = tmp
        try:
            return B.scan_inspections(table)
        finally:
            B.ACQ = saved

    def base(self, aid, name, opened, state="TX"):
        return {"ACTIVITY_NR": str(aid), "REPORTING_ID": "0627100", "ESTAB_NAME": name, "SITE_CITY": "AUSTIN", "SITE_STATE": state,
                "NAICS_CODE": "238160", "INSP_TYPE": "H", "INSP_SCOPE": "A", "SAFETY_HLTH": "S", "OPEN_DATE": opened, "CLOSE_CASE_DATE": "NaT"}

    def test_dates_before_fy1972_are_excluded_and_counted(self):
        years, national, other, employers, stats = self.scan([
            self.base(1, "OLD ONE", "1970-05-01 00:00:00+00:00"), self.base(2, "NEW ONE", "2020-05-01 00:00:00+00:00"),
            self.base(3, "NO DATE", "NaT")])
        self.assertEqual(sorted(national), [2020])
        self.assertEqual(stats["before_fy1972_excluded"], 1)
        self.assertEqual(stats["no_id_or_open_date"], 1)

    def test_employer_names_are_exact_never_merged(self):
        rows = [self.base(10, "ACME ROOFING LLC", "2020-05-01 00:00:00+00:00"), self.base(11, "ACME ROOFING, LLC", "2020-06-01 00:00:00+00:00"),
                self.base(12, "  ACME ROOFING LLC ", "2021-06-01 00:00:00+00:00"), self.base(13, "acme roofing llc", "2021-07-01 00:00:00+00:00")]
        violations = [violation_row(10, "S", "1000", "800"), violation_row(11, "S", "500", "500"), violation_row(12, "W", "9000", "9000")]
        years, national, other, employers, stats = self.scan(rows, violations)
        self.assertEqual(sorted(employers), ["ACME ROOFING LLC", "ACME ROOFING, LLC", "acme roofing llc"])
        acme = employers["ACME ROOFING LLC"]
        self.assertEqual(acme.inspections, 2)       # outer whitespace is trimmed, nothing else
        self.assertEqual(acme.current, 9800.0)
        self.assertEqual(employers["ACME ROOFING, LLC"].current, 500.0)
        self.assertEqual(employers["acme roofing llc"].current, 0.0)


def sir_table(rows):
    return "\n".join("| " + " | ".join(str(c) for c in row) + " |" for row in rows)


def sir_fixture(al_total=2315, al_years=(305, 323, 302, 393, 362, 294, 336)):
    """A small, internally consistent stand-in for private/acq/osha/_pages/sir_published_tables_*.md."""
    national = [["Year", "Total Amputations", "Total Hospitalized", "Total Reports", "Total Loss of Eye(s)"]]
    for year in range(2025, 2014, -1):
        national.append([year, 100 + year % 10, 500, 550, 1])
    parts = ["Upper extremities", "Lower extremities", "Trunk", "Multiple body parts", "Head", "Body systems", "Other body parts", "Neck, including throat"]
    blocks = [
        ("national_dashboard", national),
        ("annual_2024_sector_counts", [["Sector", "h avg", "h 2024", "a avg", "a 2024"], ["23 Construction", "300", "300", "60", "60"],
                                       ["31-33 Manufacturing", "200", "200", "44", "44"], ["Total", "500", "500", "104", "104"]]),
        ("annual_2024_sector_rates", [["Sector", "n avg", "r avg", "n 2024", "r 2024"], ["23 Construction", "360", "25.9", "360", "21.1"],
                                      ["31-33 Manufacturing", "244", "-", "244", "-"], ["TOTAL", "604", "7.8", "604", "6.7"]]),
        ("lookback_state_counts", [["State", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "Total", "Rate"],
                                   ["Alabama", *al_years, f"{al_total:,}", "17.4"]]),
        ("lookback_text_facts", [["Fact", "Value"], ["Northern Mariana Islands 2015-2021", "7"], ["Puerto Rico 2015-2021", "11"],
                                 ["U.S. Virgin Islands 2015-2021", "16"], ["North Dakota average annual rate per 100,000 FTE workers", "21.9"],
                                 ["Hospitalization SIRs 2015-2021", "700"], ["Amputation SIRs 2015-2021", "300"],
                                 ["Amputations also requiring hospitalization 2015-2021", "100"]]),
        ("lookback_body_parts", [["Sector", "NAICS", *parts, "Total"], ["Construction", "23", 100, 100, 50, 50, 50, 50, 50, 50, 500],
                                 ["Manufacturing", "31-33", 100, 100, 50, 50, 25, 25, 25, 25, 400]]),
        ("annual_2024_text_facts", [["Fact", "Value"], ["Total SIRs 2024", "550"], ["Inpatient hospitalizations 2024", "500"],
                                    ["Amputations 2024", "104"], ["Eye losses 2024", "1"]]),
        ("report_2022_2023_text", [["Fact", "Value"], ["Hospitalizations plus amputations 2022-2023", "1,205"]]),
    ]
    return "# fixture\n" + "\n".join(f"\n## SECTION {name}\nfree text lines are ignored\n{sir_table(rows)}\n" for name, rows in blocks)


class SirPublishedTests(unittest.TestCase):
    NAMES = {"Alabama": "AL"}

    def test_number_never_turns_missing_into_zero(self):
        self.assertEqual(SIR.number("1,058"), 1058)
        self.assertEqual(SIR.number("21.9"), 21.9)
        self.assertEqual(SIR.number("16"), 16)
        for blank in ("", "-", "N/A"):
            self.assertIsNone(SIR.number(blank))
        with self.assertRaises(ValueError):
            SIR.number("abc")

    def test_sections_parse_only_table_rows(self):
        sections = SIR.load_sections(sir_fixture())
        self.assertEqual(len(sections["national_dashboard"]), 12)
        self.assertNotIn("fixture", sections)
        self.assertEqual(sections["lookback_state_counts"][1][0], "Alabama")

    def test_validate_accepts_a_consistent_fixture(self):
        out = SIR.validate(SIR.load_sections(sir_fixture()), self.NAMES)
        self.assertEqual(out["body_part_grand_total"], 900)
        self.assertEqual(out["states"][0]["total"], 2315)
        self.assertEqual(out["sector_counts"]["23"]["hosp_2024"], 300)
        self.assertIsNone(out["sector_rates"]["31-33"]["rate_2024"])

    def test_state_years_that_do_not_sum_are_rejected(self):
        with self.assertRaises(ValueError):
            SIR.validate(SIR.load_sections(sir_fixture(al_total=2316)), self.NAMES)

    def test_unknown_jurisdiction_is_rejected(self):
        with self.assertRaises(ValueError):
            SIR.validate(SIR.load_sections(sir_fixture()), {"Alabamaa": "AL"})

    def test_body_part_row_that_does_not_sum_is_rejected(self):
        text = sir_fixture().replace("| 50 | 50 | 50 | 50 | 50 | 50 | 500 |", "| 50 | 50 | 50 | 50 | 50 | 50 | 501 |")
        self.assertNotEqual(text, sir_fixture())
        with self.assertRaises(ValueError):
            SIR.validate(SIR.load_sections(text), self.NAMES)

    def test_dashboard_must_agree_with_the_annual_report(self):
        text = sir_fixture().replace("| Total SIRs 2024 | 550 |", "| Total SIRs 2024 | 551 |")
        self.assertNotEqual(text, sir_fixture())
        with self.assertRaises(ValueError):
            SIR.validate(SIR.load_sections(text), self.NAMES)


class SirBuildTests(unittest.TestCase):
    def build(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sir.md")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(text)
            saved = B.SIR_FILE
            B.SIR_FILE = path
            try:
                return B.build_sir()
            finally:
                B.SIR_FILE = saved

    def test_rows_and_not_recorded(self):
        dataset, label, rows, listing, summary = self.build(sir_fixture())
        self.assertEqual(dataset, "osha_severe_injuries")
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len([i for i in ids if i.startswith("osha-sir:year:")]), 11)
        self.assertEqual(sorted(i.split(":")[-1] for i in ids if i.startswith("osha-sir:state:")), ["AL", "MP", "ND", "PR", "VI"])
        self.assertEqual(len([i for i in ids if i.startswith("osha-sir:sector:")]), 2)
        self.assertIn("osha-sir:summary", ids)
        for row in rows:
            self.assertTrue(row["source_url"].startswith("https://www.osha.gov/"))
            self.assertEqual(row["category"], "osha_severe_injuries")
        by_id = {r["id"]: r for r in rows}
        nd = dict(by_id["osha-sir:state:ND"]["detail"]["facts"])
        self.assertEqual(nd["Severe injury reports 2015–2021"], "Not recorded")
        self.assertIsNone(by_id["osha-sir:state:ND"]["item"]["cells"]["reports"])
        al = by_id["osha-sir:state:AL"]["item"]["state"]
        self.assertEqual(al["peak_year"], 2018)
        self.assertEqual(al["change_2021_vs_2015_pct"], 10.16)
        self.assertEqual(dict(by_id["osha-sir:state:AL"]["detail"]["facts"])["Hospitalizations / amputations / eye losses"], "Not recorded")
        year_2025 = by_id["osha-sir:year:2025"]["item"]["year"]
        self.assertTrue(year_2025["partial_year"])
        self.assertIsNone(year_2025["yoy_reports_pct"])
        self.assertEqual(by_id["osha-sir:year:2024"]["item"]["year"]["yoy_reports_pct"], 0.0)
        sector = by_id["osha-sir:sector:31-33"]["item"]["sector"]
        self.assertIsNone(sector["rate_2024"])
        self.assertIsNone(sector["rate_change_pct"])
        self.assertEqual(sector["body_part_share_pct_computed"]["Upper extremities"], 25.0)
        self.assertTrue(summary["status"].startswith("PARTIAL"))
        self.assertEqual(by_id["osha-sir:summary"]["item"]["profile"]["body_part_totals_2015_2021"]["reports"], 900)

    def test_broken_table_stops_the_build(self):
        with self.assertRaises(ValueError):
            self.build(sir_fixture(al_total=1))


if __name__ == "__main__":
    unittest.main()
