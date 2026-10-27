"""Unit tests for the state-metrics parsers (synthetic fixtures shaped like the official files)."""
import io
import sys
import unittest
import urllib.parse
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parsers as p  # noqa: E402


def zip_bytes(name, text, bom=False):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, (b"\xef\xbb\xbf" if bom else b"") + text.encode("latin-1"))
    return buf.getvalue()


class NumberTests(unittest.TestCase):
    def test_numbers_and_footnote_codes(self):
        self.assertEqual(p.number("1,234"), 1234)
        self.assertEqual(p.number(" 6.7 "), 6.7)
        self.assertEqual(p.number("248878.0"), 248878.0)
        for blank in ("", "(D)", "(NA)", "*", None, "n/a"):
            self.assertIsNone(p.number(blank))


class YearSpanTests(unittest.TestCase):
    def test_span_of_recorded_years(self):
        self.assertEqual(p.year_span({"NJ": {"1999": 1.0, "2017": 2.0}, "NY": {"2005": None}}), "1999–2017")
        self.assertEqual(p.year_span({"NJ": {"2017": 1.0}}), "2017")
        self.assertIsNone(p.year_span({"NJ": {"2017": None}}))
        self.assertIsNone(p.year_span({}))


class CensusTests(unittest.TestCase):
    def test_states_and_nation_only(self):
        text = ("SUMLEV,REGION,DIVISION,STATE,NAME,POPESTIMATE2020,POPESTIMATE2021\n"
                "010,0,0,00,United States,331,332\n020,1,0,00,Northeast Region,57,57\n"
                "040,3,6,01,Alabama,5031,5049\n040,X,X,72,Puerto Rico,3281,3262\n")
        out = p.census_population(text, 2020, 2021)
        self.assertEqual(out["US"], {2020: 331, 2021: 332})
        self.assertEqual(out["AL"], {2020: 5031, 2021: 5049})
        self.assertNotIn("PR", out)
        self.assertEqual(len(out), 2)


class BeaTests(unittest.TestCase):
    def test_line_selection_and_suppressed_cells(self):
        text = ('GeoFIPS,GeoName,Region,TableName,LineCode,IndustryClassification,Description,Unit,2009,2010,2011\n'
                ' "00000",United States, ,SAGDP1,3,...,Current-dollar GDP ,Millions,1,2,3\n'
                ' "01000",Alabama,5,SAGDP1,3,...,Current-dollar GDP ,Millions,10,(D),12.5\n'
                ' "01000",Alabama,5,SAGDP1,1,...,Real GDP ,Millions,7,8,9\n'
                ' "91000",New England,1,SAGDP1,3,...,Current-dollar GDP ,Millions,5,5,5\n'
                'Last updated: September 30, 2026-- revised statistics\n')
        out, meta = p.bea_table(zip_bytes("SAGDP1__ALL_AREAS_1997_2025.csv", text), "SAGDP1", 3)
        self.assertEqual(out["US"], {2010: 2, 2011: 3})
        self.assertEqual(out["AL"], {2011: 12.5})  # (D) suppressed -> omitted, 2009 before first_year
        self.assertNotIn("91", "".join(out))
        self.assertTrue(meta["updated"].startswith("Last updated"))


class LausTests(unittest.TestCase):
    def test_annual_average_rate_only(self):
        text = ("series_id\tyear\tperiod\tvalue\tfootnote_codes\n"
                "LAUST010000000000003          \t2024\tM12\t   2.9\t\n"
                "LAUST010000000000003          \t2024\tM13\t   3.0\t\n"
                "LAUST010000000000006          \t2024\tM13\t2300000\t\n"
                "LAUCN010010000000003          \t2024\tM13\t   2.5\t\n"
                "LAUST720000000000003          \t2024\tM13\t   5.5\t\n")
        self.assertEqual(p.laus_annual(text, "03"), {"AL": {2024: 3.0}})
        self.assertEqual(p.laus_annual(text, "06"), {"AL": {2024: 2300000}})


class VsrrTests(unittest.TestCase):
    HEAD = "State,Year,Month,Period,Indicator,Data Value,Percent Complete,Percent Pending Investigation,State Name,Footnote,Footnote Symbol,Predicted Value\n"

    def row(self, st, year, month, value, indicator="Number of Drug Overdose Deaths", note=""):
        return f'{st},{year},{month},12 month-ending,{indicator},{value},100,0,x,"{note}",,{value}\n'

    def test_december_values_and_new_york_combination(self):
        text = self.HEAD + "".join([
            self.row("NY", 2023, "December", 3408), self.row("YC", 2023, "December", 3111),
            self.row("NY", 2024, "December", 2000), self.row("YC", 2024, "December", ""),
            self.row("AL", 2023, "November", 999), self.row("AL", 2023, "December", 1500),
            self.row("AL", 2024, "December", 1200, note="Underreported due to incomplete data."),
            self.row("AL", 2025, "March", 1100), self.row("PR", 2023, "December", 50),
            self.row("AL", 2023, "December", 7, indicator="Cocaine (T40.5)"),
        ])
        values, notes, latest = p.vsrr(text, "Number of Drug Overdose Deaths")
        self.assertEqual(values["NY"], {2023: 6519})  # 2024 NYC missing -> no combined value
        self.assertEqual(values["AL"], {2023: 1500, 2024: 1200})
        self.assertIn(2024, notes["AL"])
        self.assertEqual(latest["AL"], {"period": "2025-03", "value": 1100})
        self.assertNotIn("PR", values)
        self.assertNotIn("YC", values)


class FarsTests(unittest.TestCase):
    def test_bom_header_and_puerto_rico_excluded(self):
        text = "STATE,ST_CASE,FATALS\n1,10001,2\n1,10002,1\n72,720001,4\n11,110001,1\n"
        totals, crashes, name = p.fars_fatalities(zip_bytes("FARS2014NationalCSV/ACCIDENT.csv", text, bom=True))
        self.assertEqual(totals, {"AL": 3, "DC": 1})
        self.assertEqual(crashes["AL"], 2)
        self.assertTrue(name.endswith("ACCIDENT.csv"))


class SourceUrlTests(unittest.TestCase):
    def test_fars_archive_url_is_the_exact_yearly_file(self):
        self.assertEqual(p.fars_national_csv_url(2024),
                         "https://static.nhtsa.gov/nhtsa/downloads/FARS/2024/National/FARS2024NationalCSV.zip")
        self.assertEqual(p.fars_national_csv_url("2014"),
                         "https://static.nhtsa.gov/nhtsa/downloads/FARS/2014/National/FARS2014NationalCSV.zip")

    def test_builder_links_no_unlistable_bucket_folder(self):
        # static.nhtsa.gov is an S3 bucket: a folder URL there returns 404, so a source link must be a file or a page.
        import build_state_metrics as b
        self.assertEqual(b.SRC["fars"]["url"], p.FARS_LISTING)
        self.assertEqual(b.SRC["fars"]["page"], "https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars")
        for key, src in b.SRC.items():
            for field in ("url", "page"):
                parts = urllib.parse.urlsplit(src[field])
                with self.subTest(source=key, field=field):
                    self.assertEqual(parts.scheme, "https")
                    self.assertFalse(parts.netloc.startswith("static.") and parts.path.endswith("/"), src[field])


class ComplaintTests(unittest.TestCase):
    def line(self, odino, state, ldate, crash="N"):
        f = [""] * 49
        f[1], f[6], f[13], f[16] = odino, crash, state, ldate
        return "\t".join(f) + "\n"

    def test_unique_complaints_by_state_and_received_year(self):
        lines = [self.line("1", "CA", "20240105", "Y"), self.line("1", "CA", "20240105", "Y"),
                 self.line("2", "ca", "20251231"), self.line("3", "ON", "20250101"), self.line("4", "TX", "bad")]
        counts, crash, max_date = p.nhtsa_complaints(lines)
        self.assertEqual(counts, {"CA": {2024: 1, 2025: 1}})
        self.assertEqual(crash, {"CA": {2024: 1}})
        self.assertEqual(max_date, "20251231")


class FdaTests(unittest.TestCase):
    def test_firm_state_year_and_class(self):
        rows = [{"state": "NJ", "report_date": "2024-03-01", "classification": "Class I", "country": "United States"},
                {"state": "NJ", "report_date": "2024-05-01", "classification": "Class II", "country": "United States"},
                {"state": "NJ", "report_date": "2023-05-01", "classification": "Class II", "country": None},
                {"state": "ON", "report_date": "2024-05-01", "classification": "Class I", "country": "Canada"},
                {"state": "CA", "report_date": None, "classification": "Class I", "country": "United States"}]
        total, class1 = p.fda_enforcement(rows)
        self.assertEqual(total, {"NJ": {2024: 2, 2023: 1}})
        self.assertEqual(class1, {"NJ": {2024: 1}})


class StatsTests(unittest.TestCase):
    def test_per_capita_requires_same_year_population(self):
        self.assertEqual(p.per_capita({2023: 50, 2024: 10}, {2023: 1_000_000}, 100_000), {2023: 5.0})

    def test_per_capita_rounds_once(self):
        # $1,000.499M / 10,000 people = $100,049.9 -> 100,050 (rounding to cents first would not change it here,
        # but whole-dollar output must come from a single rounding of the exact quotient).
        self.assertEqual(p.per_capita({2024: 1000.499}, {2024: 10000}, 1_000_000, digits=0), {2024: 100050})
        self.assertIsInstance(p.per_capita({2024: 1000.0}, {2024: 3}, 1_000_000, digits=0)[2024], int)

    def test_change_points(self):
        self.assertEqual(p.change_points({2020: 8.1, 2025: 4.5}, 2025), -3.6)
        self.assertIsNone(p.change_points({2025: 4.5}, 2025))

    def test_ranks_ties_and_z(self):
        ranks = p.ranks_and_z({"A": 10, "B": 10, "C": 4, "D": None})
        self.assertEqual(ranks["A"][0], 1)
        self.assertEqual(ranks["B"][0], 1)
        self.assertEqual(ranks["C"][0], 3)
        self.assertNotIn("D", ranks)
        self.assertAlmostEqual(ranks["C"][1], -1.41, places=2)

    def test_change_and_quantiles(self):
        self.assertEqual(p.change_pct({2019: 100, 2024: 125}, 2024), 25.0)
        self.assertIsNone(p.change_pct({2024: 125}, 2024))
        self.assertIsNone(p.change_pct({2019: 0, 2024: 5}, 2024))
        self.assertEqual(p.median([3, 1, 2, 4]), 2.5)
        self.assertEqual(p.quantile([1, 2, 3, 4, 5], 0.25), 2)


if __name__ == "__main__":
    unittest.main()
