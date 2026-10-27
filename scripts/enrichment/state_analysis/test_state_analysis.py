"""Offline unit tests for the state_analysis stream (synthetic fixtures, no network, no raw files).

Run: cd scripts/enrichment/state_analysis && python3 -B -m unittest -v test_state_analysis
"""
from __future__ import annotations

import gzip
import os
import tempfile
import unittest

import sa_acs
import sa_districts as SD
import sa_sources as S
import sa_stats as ST


class SourceParsing(unittest.TestCase):
    def test_acs_value_sentinels(self):
        self.assertEqual(S.acs_value("1234"), 1234.0)
        self.assertIsNone(S.acs_value("-666666666"))
        self.assertIsNone(S.acs_value(""))
        self.assertIsNone(S.acs_value("N"))

    def test_read_acs_controlled_moe_is_zero(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "t.dat.gz")
            with gzip.open(p, "wt") as h:
                h.write("GEO_ID|B01003_E001|B01003_M001\n0500000US01001|100|-555555555\n1400000US01001020100|5|2\n")
            rows = S.read_acs(p)
        self.assertEqual(rows["0500000US01001"]["B01003_M001"], 0.0)
        self.assertNotIn("1400000US01001020100", rows)  # tract rows are not kept

    def test_zip5_and_masked(self):
        self.assertEqual(S.zip5("60601"), "60601")
        self.assertEqual(S.zip5("60601-1234"), "60601")
        self.assertIsNone(S.zip5("606XX"))
        self.assertIsNone(S.zip5(""))

    def test_assign_zcta_whole_split_tie(self):
        self.assertEqual(S.assign_zcta([("01001", 10)]), ("01001", True))
        self.assertEqual(S.assign_zcta([("01001", 10), ("01003", 30)]), ("01003", False))
        self.assertEqual(S.assign_zcta([("01001", 10), ("01003", 10)]), (None, False))  # tie: not assigned
        self.assertEqual(S.assign_zcta([("01001", 0), ("01003", 5)]), ("01003", True))  # water-only part ignored

    def test_norm_county(self):
        self.assertEqual(S.norm_county("St. Louis County"), S.norm_county("Saint Louis"))
        self.assertEqual(S.norm_county("Ste. Genevieve County"), "stegenevieve")
        self.assertEqual(S.norm_county("DeKalb County"), S.norm_county("De Kalb"))
        self.assertNotEqual(S.norm_county("Wood County"), S.norm_county("Woods"))

    def test_split_names(self):
        self.assertEqual(S.split_names("Riverside and San Bernardino"), ["Riverside", "San Bernardino"])
        self.assertEqual(S.split_names("A, B, and King and Queen"), ["A", "B", "King and Queen"])
        self.assertEqual(S.split_names("Newport News, Hampton and Williamsburg"), ["Newport News", "Hampton", "Williamsburg"])
        self.assertEqual(S.split_names("Durham (excluding x, y), Forsyth"), ["Durham (excluding x, y)", "Forsyth"])

    def test_parse_composition(self):
        c = S.parse_composition("(b) The Southern District comprises the counties of Bronx, Dutchess, and Westchester and concurrently with the Eastern District, the waters within the Eastern District.")
        self.assertEqual(c["counties"], ["Bronx", "Dutchess", "Westchester"])
        c = S.parse_composition("(1) The Eastern Division comprises the counties of Crawford, Warren, and Washington, and the city of Saint Louis.")
        self.assertEqual(c["cities"], ["Saint Louis"])
        self.assertEqual(c["counties"], ["Crawford", "Warren", "Washington"])
        c = S.parse_composition("(3) The Southern Division comprises Orange County.")
        self.assertEqual(c["counties"], ["Orange"])
        c = S.parse_composition("(a) The Eastern District comprises the counties of Wake, Wilson, those portions of Hoke and Moore counties encompassing the Fort.")
        self.assertEqual(c["counties"], ["Wake", "Wilson"])
        self.assertEqual(len(c["partial"]), 1)
        c = S.parse_composition("(b) The Middle District comprises the counties of Durham (excluding that portion of Durham County encompassing the Institution, Butner, North Carolina), Forsyth.")
        self.assertEqual(c["counties"], ["Durham", "Forsyth"])
        self.assertIn("Durham", c["exceptions"])

    def test_parse_usc_sections(self):
        page = ('<h3 class="section-head">&sect;81. Alabama</h3><p class="statutory-body">Alabama is divided into two judicial districts.</p>'
                '<h3 class="analysis-subhead">Northern District</h3><p class="statutory-body">(a) The Northern District comprises the counties of Jefferson and Shelby.</p>'
                '<p class="statutory-body">Court for the Northern District shall be held at Birmingham.</p>'
                '<h3 class="analysis-subhead">Southern District</h3><p class="statutory-body">(b) The Southern District comprises the counties of Mobile.</p>'
                '<p class="source-credit">(credit)</p>'
                '<h3 class="section-head">&sect;82. Arizona</h3><p class="statutory-body">Arizona constitutes one judicial district.</p><p class="source-credit">x</p>')
        secs = S.parse_usc_chapter5(page)
        self.assertEqual([s["usps"] for s in secs], ["AL", "AZ"])
        al = secs[0]
        self.assertFalse(al["single"])
        self.assertEqual([d["court_suffix"] for d in al["districts"]], ["n", "s"])
        self.assertEqual(al["districts"][0]["divisions"][0]["held_at"], ["Birmingham"])
        self.assertTrue(secs[1]["single"])


class Districts(unittest.TestCase):
    def _section(self):
        return [{"section": "81", "state": "Alabama", "usps": "AL", "single": False, "districts": [
            {"name": "Northern District", "court_suffix": "n", "divisions": [{"name": "Northern District", "counties": ["Jefferson", "Shelbie"], "cities": [], "held_at": [], "text": "t"}]},
            {"name": "Southern District", "court_suffix": "s", "divisions": [{"name": "Southern District", "counties": ["Mobile", "Gone"], "cities": [], "held_at": [], "text": "t"}]},
        ]}]

    def test_exact_alias_and_unmatched(self):
        counties = {"AL": [("01073", "Jefferson County"), ("01117", "Shelby County"), ("01097", "Mobile County"), ("01001", "Autauga County")]}
        fjc = {"01117": {"alnd": 40, "alsd": 2}}
        out, rep = SD.assign(self._section(), counties, fjc, [], {"alnd", "alsd"})
        self.assertEqual(out["01073"]["court_id"], "alnd")
        self.assertEqual(out["01117"]["method"], "spelling")  # 'Shelbie' -> Shelby, corroborated by the IDB
        self.assertEqual(out["01097"]["court_id"], "alsd")
        self.assertNotIn("01001", out)  # never assigned by elimination
        self.assertEqual([u["name"] for u in rep["unmatched_names"]], ["Gone"])
        self.assertEqual([u["fips"] for u in rep["unassigned"]], ["01001"])

    def test_alias_needs_corroboration(self):
        counties = {"AL": [("01073", "Jefferson County"), ("01117", "Shelby County"), ("01097", "Mobile County")]}
        fjc = {"01117": {"alnd": 1, "alsd": 30}}  # residents file elsewhere: not corroborated
        out, rep = SD.assign(self._section(), counties, fjc, [], {"alnd", "alsd"})
        self.assertNotIn("01117", out)
        self.assertTrue(any(u["name"] == "Shelbie" for u in rep["unmatched_names"]))

    def test_ambiguous_near_match_not_assigned(self):
        sec = self._section()
        sec[0]["districts"][0]["divisions"][0]["counties"] = ["Jefferson", "Clar"]
        counties = {"AL": [("01073", "Jefferson County"), ("01025", "Clarke County"), ("01027", "Clay County"), ("01097", "Mobile County")]}
        out, rep = SD.assign(sec, counties, {"01025": {"alnd": 50}, "01027": {"alnd": 50}}, [], {"alnd", "alsd"})
        self.assertNotIn("01025", out)
        self.assertNotIn("01027", out)

    def test_va_rule_parsing(self):
        text = ("(1) The Alexandria Division shall consist of the City of Alexandria and the Counties of Loudoun, Fairfax, and Stafford and any other "
                "city or town geographically within the exterior boundaries of said counties. (2) The Norfolk Division shall consist of the Cities of Norfolk "
                "and Suffolk, and the Counties of Accomack, Westmoreland, and any other city or town geographically within the exterior boundaries of said counties.")
        rules = SD.parse_va_rules(text, "vaed", "u", "r")
        self.assertEqual(rules[0]["cities"], ["Alexandria"])
        self.assertEqual(rules[0]["counties"], ["Loudoun", "Fairfax", "Stafford"])
        self.assertEqual(rules[1]["cities"], ["Norfolk", "Suffolk"])
        self.assertEqual(rules[1]["counties"], ["Accomack", "Westmoreland"])
        wd = SD.parse_va_rules("(1) Abingdon Division. The Abingdon Division embraces the counties of Smyth, the city of Bristol, Dickenson, and the city of Norton;", "vawd", "u", "r")
        self.assertEqual(wd[0]["cities"], ["Bristol", "Norton"])
        self.assertEqual(wd[0]["counties"], ["Smyth", "Dickenson"])


class Stats(unittest.TestCase):
    def test_ranks_ties(self):
        self.assertEqual(ST.ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4])

    def test_spearman_perfect_and_missing(self):
        rho, n = ST.spearman([1, 2, 3, 4, None], [10, 20, 30, 40, 50])
        self.assertAlmostEqual(rho, 1.0)
        self.assertEqual(n, 4)
        rho, n = ST.spearman([1, 2], [2, 1])
        self.assertIsNone(rho)

    def test_t_p_value(self):
        self.assertAlmostEqual(ST.t_two_sided_p(2.0, 10), 0.07339, places=4)
        self.assertAlmostEqual(ST.t_two_sided_p(0.0, 10), 1.0, places=6)

    def test_bh(self):
        adj = ST.bh_adjust([0.01, 0.04, 0.03, 0.5])
        # sorted p: 0.01, 0.03, 0.04, 0.5 (m = 4); step-up minima: 0.04, 0.0533, 0.0533, 0.5
        self.assertAlmostEqual(adj[0], 0.04)
        self.assertAlmostEqual(adj[1], 0.04 * 4 / 3)
        self.assertAlmostEqual(adj[2], 0.04 * 4 / 3)
        self.assertAlmostEqual(adj[3], 0.5)

    def test_test_family_min_n(self):
        xs = {str(i): float(i) for i in range(9)}
        out = ST.test_family(xs, {"y": {str(i): float(i) for i in range(9)}}, {"y": "Y"})
        self.assertIsNone(out[0]["rho"])  # fewer than 10 pairs: not tested
        xs = {str(i): float(i) for i in range(12)}
        out = ST.test_family(xs, {"y": {str(i): float(-i) for i in range(12)}}, {"y": "Y"})
        self.assertAlmostEqual(out[0]["rho"], -1.0)

    def test_quantile(self):
        self.assertEqual(ST.quantile([1, 2, 3, 4], 0.5), 2.5)
        self.assertIsNone(ST.quantile([], 0.5))


class CoreProduct(unittest.TestCase):
    def test_suppressed_rate(self):
        self.assertAlmostEqual(ST.suppressed_rate(50, 100_000), 10.0)
        self.assertIsNone(ST.suppressed_rate(4, 100_000))  # under 5 filings: not published, never 0
        self.assertIsNone(ST.suppressed_rate(0, 100_000))
        self.assertIsNone(ST.suppressed_rate(None, 100_000))
        self.assertIsNone(ST.suppressed_rate(50, None))
        self.assertIsNone(ST.suppressed_rate(50, 0))
        self.assertAlmostEqual(ST.suppressed_rate(5, 50_000), 2.0)

    def test_core_group_count(self):
        self.assertEqual(ST.core_group_count({"product": 12, "civil_rights": 3}, "product"), 12)
        self.assertEqual(ST.core_group_count({"civil_rights": 3}, "product"), 0)
        self.assertEqual(ST.core_group_count({}, "product"), 0)
        self.assertIsNone(ST.core_group_count(None, "product"))


class Acs(unittest.TestCase):
    def test_share_and_moe(self):
        cells = {"poverty_rate": {"num": ["C17002_002", "C17002_003"], "den": "C17002_001"}}
        row = {"C17002_E001": 1000.0, "C17002_M001": 10.0, "C17002_E002": 50.0, "C17002_M002": 5.0, "C17002_E003": 50.0, "C17002_M003": 5.0}
        v, moe = sa_acs.measure(row, cells, "poverty_rate")
        self.assertAlmostEqual(v, 10.0)
        expected = ((5 ** 2 + 5 ** 2) - 0.1 ** 2 * 10 ** 2) ** 0.5 / 1000 * 100
        self.assertAlmostEqual(moe, expected)

    def test_not_recorded_when_cell_missing(self):
        cells = {"poverty_rate": {"num": ["C17002_002"], "den": "C17002_001"}}
        self.assertEqual(sa_acs.measure({"C17002_E001": 1000.0}, cells, "poverty_rate"), (None, None))

    def test_resolve_cells_rejects_missing_label(self):
        with self.assertRaises(SystemExit):
            sa_acs.resolve_cells({"B01003_001": "Total"})


if __name__ == "__main__":
    unittest.main()
