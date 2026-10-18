"""Offline unit tests for the CourtListener bulk helpers (no DuckDB, no network)."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clb_common as cc  # noqa: E402
import schema_catalog as sc  # noqa: E402

SCHEMA = """
CREATE TABLE public.search_court (
    id character varying(15) NOT NULL,
    in_use boolean NOT NULL,
    "position" double precision NOT NULL,
    start_date date,
    CONSTRAINT search_court_check CHECK ((start_date IS NOT NULL))
);

CREATE TABLE public.people_db_party (
    id integer NOT NULL,
    name text NOT NULL
);

COMMENT ON COLUMN public.search_court.in_use IS 'Whether this jurisdiction is in use''s scope.';
ALTER TABLE ONLY public.people_db_party
    ADD CONSTRAINT fk1 FOREIGN KEY (id) REFERENCES public.search_court(id) DEFERRABLE INITIALLY DEFERRED;
"""
LOAD = r"""
psql --command "\COPY public.search_court (
	       id, in_use, position
	   ) FROM '$BULK_DIR/courts-2026-09-30.csv' WITH (FORMAT csv, ENCODING utf8, ESCAPE '\', HEADER)" --host x
psql --command "\COPY public.search_docket (id, court_id) FROM '$BULK_DIR/dockets-2026-09-30.csv' WITH (FORMAT csv)" --host x
"""


class SchemaTests(unittest.TestCase):
    def test_parse_schema_columns_comments_and_foreign_keys(self):
        t = sc.parse_schema(SCHEMA)
        self.assertEqual(list(t), ["search_court", "people_db_party"])
        cols = {c["name"]: c for c in t["search_court"]["columns"]}
        self.assertEqual(list(cols), ["id", "in_use", "position", "start_date"])  # CONSTRAINT lines are not columns
        self.assertTrue(cols["id"]["not_null"])
        self.assertFalse(cols["start_date"]["not_null"])
        self.assertEqual(cols["id"]["type"], "character varying(15)")
        self.assertEqual(cols["in_use"]["comment"], "Whether this jurisdiction is in use's scope.")
        self.assertEqual(t["people_db_party"]["foreign_keys"], [{"column": "id", "references": "search_court", "referenced_column": "id"}])

    def test_parse_bulk_files_maps_tables_to_files(self):
        b = sc.parse_bulk_files(LOAD)
        self.assertEqual(b["search_court"], {"file": "courts", "columns": ["id", "in_use", "position"]})
        self.assertEqual(b["search_docket"]["file"], "dockets")


class HelperTests(unittest.TestCase):
    def test_source_flags_decode_bits_and_keep_unknown_bits(self):
        self.assertEqual(cc.source_flags(9), ["RECAP", "FJC IDB"])
        self.assertEqual(cc.source_flags(2), ["Scraper"])
        self.assertEqual(cc.source_flags(0), ["Default"])
        self.assertEqual(cc.source_flags(17), ["RECAP", "Harvard"])
        self.assertEqual(cc.source_flags(33), ["RECAP", "other flags (32)"])
        self.assertEqual(cc.source_flags(None), [])

    def test_parse_date_and_years_between_never_guess(self):
        self.assertEqual(cc.parse_date("2014-12-19"), dt.date(2014, 12, 19))
        self.assertEqual(cc.parse_date("2021-01-28 05:39:13+00"), dt.date(2021, 1, 28))
        self.assertIsNone(cc.parse_date("12/19/2014"))
        self.assertIsNone(cc.parse_date(""))
        self.assertIsNone(cc.years_between(dt.date(2020, 1, 1), dt.date(2019, 1, 1)))
        self.assertAlmostEqual(cc.years_between(dt.date(2000, 1, 1), dt.date(2010, 1, 1)), 10.0, places=2)
        self.assertEqual(cc.r2(34.014), 34.01)
        self.assertIsNone(cc.r2(None))

    def test_median_share_and_top_counts(self):
        self.assertEqual(cc.median([1, 3, 2]), 2.0)
        self.assertEqual(cc.median([1, 2, 3, 4]), 2.5)
        self.assertIsNone(cc.median([None]))
        self.assertIsNone(cc.share(1, 0))
        self.assertEqual(cc.share(1, 3), 33.3)
        top = cc.top_counts(["a_pres", "a_pres", "a_gov", None, ""], 5, cc.HOW_SELECTED_LABEL)
        self.assertEqual(top[0], {"value": "a_pres", "label": "Appointed by the President", "count": 2, "share_pct": 66.7})

    def test_full_name_decodes_suffix_codes_only(self):
        self.assertEqual(cc.full_name("Barack", "Hussein", "Obama", "2"), "Barack Hussein Obama II")
        self.assertEqual(cc.full_name("A", "", "B", "jr"), "A B Jr.")
        self.assertEqual(cc.full_name("A", None, "B", "Esq"), "A B Esq")
        self.assertEqual(cc.full_name(None, None, None, None), "Name not recorded")

    def test_decade_and_jurisdiction_labels(self):
        self.assertEqual(cc.decade(dt.date(1999, 12, 31)), 1990)
        self.assertIsNone(cc.decade(None))
        self.assertEqual(cc.JURISDICTION_LABEL["FD"], "Federal district")
        self.assertIn("jud", cc.JUDICIAL_POSITIONS)
        self.assertNotIn("clerk", cc.JUDICIAL_POSITIONS)

    def test_fiscal_year_follows_the_ao_october_rule(self):
        self.assertEqual(cc.fiscal_year(dt.date(2024, 9, 30)), 2024)
        self.assertEqual(cc.fiscal_year(dt.date(2024, 10, 1)), 2025)
        self.assertEqual(cc.fiscal_year(dt.date(2025, 1, 15)), 2025)
        self.assertIsNone(cc.fiscal_year(None))

    def test_ratio_and_rounding_never_invent_values(self):
        self.assertEqual(cc.ratio(1, 4), 0.25)
        self.assertIsNone(cc.ratio(5, 0))
        self.assertIsNone(cc.ratio(None, 5))
        self.assertEqual(cc.ratio(2, 3, 2), 0.67)
        self.assertEqual(cc.r1(2.25), 2.2)  # Python rounds half to even
        self.assertIsNone(cc.r1(None))

    def test_shares_drops_empty_values_and_breaks_ties_stably(self):
        out = cc.shares([("b", 5), ("a", 5), (None, 9), ("", 3), ("c", 0), ("d", 2)], total=20, limit=3, labels={"a": "Alpha"})
        self.assertEqual([r["value"] for r in out], ["a", "b", "d"])  # tie between a and b resolved by value; None, empty and zero dropped
        self.assertEqual(out[0], {"value": "a", "label": "Alpha", "count": 5, "share_pct": 25.0})
        self.assertEqual(cc.shares([("x", 1)], total=0), [{"value": "x", "label": "x", "count": 1, "share_pct": None}])

    def test_fisher_interval_and_strength_labels(self):
        lo, hi = cc.fisher_ci(0.5, 94)
        self.assertLess(lo, 0.5)
        self.assertGreater(hi, 0.5)
        # by hand: z = atanh(0.5) = 0.549306, se = 1/sqrt(91) = 0.104828, z -/+ 1.96 se = 0.343843 / 0.754769, tanh -> 0.3309 / 0.6380
        self.assertAlmostEqual(lo, 0.3309, places=3)
        self.assertAlmostEqual(hi, 0.6380, places=3)
        self.assertIsNone(cc.fisher_ci(0.5, 3))
        self.assertIsNone(cc.fisher_ci(1.0, 50))
        self.assertEqual([cc.strength(x) for x in (0.0, 0.19, 0.2, 0.39, 0.4, 0.59, 0.6, 0.79, 0.8, -0.9)],
                         ["very weak or none", "very weak or none", "weak", "weak", "moderate", "moderate", "strong", "strong", "very strong", "very strong"])

    def test_jurisdiction_labels_cover_tribal_military_and_territorial_codes(self):
        for code in ("TRA", "TRT", "TRS", "TRX", "MA", "TS", "TA", "TT"):
            self.assertIn(code, cc.JURISDICTION_LABEL)
        self.assertNotIn("St", cc.JURISDICTION_LABEL)  # an unexplained stored code stays unlabelled rather than guessed

    def test_spearman_handles_ties_missing_values_and_short_input(self):
        rho, n = cc.spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])
        self.assertAlmostEqual(rho, 1.0)
        self.assertEqual(n, 5)
        rho, n = cc.spearman([1, 2, 3, 4], [4, 3, 2, 1])
        self.assertAlmostEqual(rho, -1.0)
        rho, n = cc.spearman([1, None, 3, 4, 5], [2, 9, None, 8, 10])
        self.assertEqual(n, 3)  # only pairs with both values
        rho, n = cc.spearman([1, 1, 1], [1, 2, 3])
        self.assertIsNone(rho)  # no variance in one variable
        rho, n = cc.spearman([1, 2], [2, 1])
        self.assertIsNone(rho)
        rho, n = cc.spearman([1, 2, 2, 3], [1, 2, 3, 3])
        self.assertGreater(rho, 0.8)


if __name__ == "__main__":
    unittest.main()
