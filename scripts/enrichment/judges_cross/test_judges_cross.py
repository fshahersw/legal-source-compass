"""Unit tests for the judges-cross parsers and matchers. Run: python3 -m unittest discover scripts/enrichment/judges_cross"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import common as c  # noqa: E402
import disclosure_match as dm  # noqa: E402


class CourtIds(unittest.TestCase):
    def test_fjc_names(self):
        self.assertEqual(c.district_court_id("U.S. District Court for the Eastern District of Louisiana"), "laed")
        self.assertEqual(c.district_court_id("U.S. District Court for the District of New Jersey"), "njd")
        self.assertEqual(c.district_court_id("U.S. District Court for the District of Columbia"), "dcd")
        self.assertIsNone(c.district_court_id("U.S. Court of Appeals for the Ninth Circuit"))

    def test_jpml_headings(self):
        self.assertEqual(c.jpml_district_court_id("LOUISIANA EASTERN"), "laed")
        self.assertEqual(c.jpml_district_court_id("DISTRICT OF COLUMBIA"), "dcd")
        self.assertEqual(c.jpml_district_court_id("NEW YORK SOUTHERN"), "nysd")
        self.assertEqual(c.jpml_district_court_id("PUERTO RICO"), "prd")
        self.assertEqual(c.jpml_district_court_id("WEST VIRGINIA SOUTHERN"), "wvsd")
        self.assertIsNone(c.jpml_district_court_id("ATLANTIS NORTHERN"))

    def test_pending_codes_and_state(self):
        self.assertEqual(c.pending_district_court_id("OHS"), "ohsd")
        self.assertEqual(c.pending_district_court_id("DC"), "dcd")
        self.assertIsNone(c.pending_district_court_id("N/A"))
        self.assertEqual(c.court_state("wvsd"), "West Virginia")
        self.assertEqual(c.court_state("vaed"), "Virginia")
        self.assertEqual(c.court_circuit("laed"), 5)


class JudgeNames(unittest.TestCase):
    def test_initials(self):
        [j] = c.parse_jpml_judges("Caldwell, W.C.")
        self.assertEqual(j, {"surname": ["caldwell"], "given": ["w", "c"], "court": None, "suffix": None})

    def test_suffix_and_hint(self):
        [j] = c.parse_jpml_judges("Pointer, Jr., S.C. (ALN)")
        self.assertEqual(j["surname"], ["pointer"])
        self.assertEqual(j["given"], ["s", "c"])
        self.assertEqual(j["court"], "alnd")

    def test_full_names_and_two_judges(self):
        [j] = c.parse_jpml_judges("Rodgers, M. Casey")
        self.assertEqual(j["given"], ["m", "casey"])
        self.assertEqual(len(c.parse_jpml_judges("Bilby, R.M. & Roll, J.M.")), 2)
        self.assertEqual(len(c.parse_jpml_judges("Motz, J.F., Davis, A.M.")), 2)
        [j] = c.parse_jpml_judges("Rodney W. Sippel")
        self.assertEqual(j["surname"], ["sippel"])
        self.assertEqual(j["given"], ["rodney", "w"])
        [j] = c.parse_jpml_judges("Boulee, J-P")
        self.assertEqual(j["given"], ["j", "p"])
        [j] = c.parse_jpml_judges("Castel. P.K.")
        self.assertEqual(j["surname"], ["castel"])

    def test_suffix_parsing(self):
        [j] = c.parse_jpml_judges("Bartle, III, H.")
        self.assertEqual((j["surname"], j["given"], j["suffix"]), (["bartle"], ["h"], "iii"))
        [j] = c.parse_jpml_judges("Patterson, Jr., R.P.")
        self.assertEqual(j["suffix"], "jr")
        self.assertEqual(c.suffix_key("Jr."), "jr")
        self.assertIsNone(c.suffix_key(""))

    def test_brackets_and_loose(self):
        self.assertTrue(c.given_consistent(["w"], "[Percy]", "Whitman"))
        self.assertTrue(c.given_consistent(["a", "v"], "Alfred", "V."))
        self.assertFalse(c.given_consistent(["d", "l"], "Denise", ""))
        self.assertTrue(c.first_initial_consistent(["d", "l"], "Denise", ""))
        self.assertFalse(c.first_initial_consistent(["k"], "Denise", ""))

    def test_given_consistency(self):
        self.assertTrue(c.given_consistent(["w", "c"], "William", "Caldwell"))
        self.assertFalse(c.given_consistent(["w", "d"], "William", "Caldwell"))
        self.assertTrue(c.given_consistent(["m", "casey"], "Margaret", "Casey"))
        self.assertFalse(c.given_consistent(["charles"], "Carl", ""))
        self.assertFalse(c.given_consistent(["a", "b", "c"], "Ann", ""))


class Terminated(unittest.TestCase):
    TEXT = "\n".join([
        "                                     FIFTH CIRCUIT",
        "   53L         LOUISIANA EASTERN                                            (2 Litigations)",
        "   1657        Vioxx PL                                    Fallon, E.E.        6,985     3,335    10,314       6     2018",
        "   1873        FEMA Trailer Formaldehyde PL                Engelhardt, K.D.    1,053     3,775     4,827       1     2013",
        "                                     SIXTH CIRCUIT",
        "   647            OHIO NORTHERN                                     35 Litigations",
        "   2807  Sonic Corp. Customer Data Security Breach Litigation   Gwin, James S.   10   1   11   0   2023",
    ])

    def test_headers_and_rows(self):
        rows, headers, unparsed, _ = c.parse_terminated_text(self.TEXT)
        self.assertEqual([h["code"] for h in headers], ["53L", "647"])
        self.assertEqual(headers[0]["court_id"], "laed")
        self.assertEqual(headers[1]["printed"], 35)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["court_id"], "laed")
        self.assertEqual(rows[0]["actions_closed"], 10314)
        self.assertEqual(rows[2]["court_id"], "ohnd")
        self.assertEqual(rows[2]["circuit"], "Sixth Circuit")
        self.assertEqual(rows[2]["transferee_judge"], "Gwin, James S.")
        self.assertEqual(unparsed, [])

    def test_report_edge_rows(self):
        text = "\n".join([
            "                 CUMULATIVE TOTALS                                    (1,587 Litigations)       254,940",
            "                                     SIXTH CIRCUIT",
            "   643           KENTUCKY EASTERN                                               (6 Litigations)",
            "             8A Cincinnati Airport - 11/8/65 AD                                Swinford, M.        6        2        8        0       1972",
            "           2338 MF Global Holdings Ltd. Investment                     Marrero, V.                5             20           25        2,019",
            "           2712 Air Crash Over the Southern Indian Ocean              Jackson, K.B.                39              3          42                    2018",
            "           9999 Bad Arithmetic                                        Doe, J.                39              3          40                    2018",
            "           2641 Bard IVC Filters Products Liability Litigation                                                         165           8,524        8,584        105       2024",
            "           1173 American Airlines Flight 869 AD         Tjoflat, G.B. (11th Circuit)            10              4           12           2       2002",
            "             10    Antibiotic Drug (Non-Settling Cases) AT                                           Lord, M.W. (MN)",
        ])
        rows, _, unparsed, total = c.parse_terminated_text(text)
        self.assertEqual(total, 1587)
        by = {r["mdl"]: r for r in rows}
        self.assertEqual(by["8A"]["actions_closed"], 8)
        self.assertEqual(by[2338]["termination_year"], 2019)
        self.assertIsNone(by[2338]["actions_remanded"])
        self.assertIsNone(by[2712]["actions_remanded"])
        self.assertNotIn(9999, by)
        self.assertFalse(by[2641]["judge_printed"])
        self.assertEqual(by[2641]["transferee_judge"], "")
        self.assertEqual(by[1173]["transferee_judge"], "Tjoflat, G.B. (11th Circuit)")
        self.assertEqual(c.parse_jpml_judges(by[1173]["transferee_judge"])[0]["court"], "circuit")
        self.assertEqual(len(unparsed), 2)

    def test_pending_names(self):
        parsed = c.parse_pending_judge("Edmund A. Sargus, Jr")
        self.assertEqual(parsed, {"tokens": ["edmund", "a", "sargus"], "suffix": "jr"})
        self.assertEqual(c.pending_name_split(parsed, ["sargus"]), ["edmund", "a"])
        self.assertIsNone(c.pending_name_split(parsed, ["shipp"]))
        yg = c.parse_pending_judge("Yvonne Gonzalez Rogers")
        self.assertEqual(c.pending_name_split(yg, ["gonzalez", "rogers"]), ["yvonne"])


class CompanyKey(unittest.TestCase):
    def test_equivalents(self):
        self.assertEqual(c.company_key("Johnson & Johnson"), "johnson and johnson")
        self.assertEqual(c.company_key("JOHNSON & JOHNSON COM"), "johnson and johnson")
        self.assertEqual(c.company_key("Johnson & Johnson (JNJ) common stock"), "johnson and johnson")
        self.assertEqual(c.company_key("C.R. Bard, Inc."), "cr bard")
        self.assertEqual(c.company_key("C. R. Bard Inc"), "cr bard")
        self.assertEqual(c.company_key("3M Company"), "3m")
        self.assertEqual(c.company_key("Mead Johnson & Company, LLC"), "mead johnson")
        self.assertEqual(c.company_key("Abbott Laboratories, et al."), "abbott laboratories")
        self.assertEqual(c.company_key("Alphabet Inc. Class A"), "alphabet")
        self.assertEqual(c.company_key("Bank of America - cash accounts"), "bank of america")

    def test_non_equivalents(self):
        self.assertNotEqual(c.company_key("Abbott Labs"), c.company_key("Abbott Laboratories"))
        self.assertNotEqual(c.company_key("Johnson Controls"), c.company_key("Johnson & Johnson"))
        self.assertNotEqual(c.company_key("Koninklijke Philips NV"), c.company_key("Philips"))
        self.assertEqual(c.company_key("Common stock"), "")


class Stats(unittest.TestCase):
    def test_median_and_hhi(self):
        self.assertEqual(c.median([3, 1, 2]), 2)
        self.assertEqual(c.median([1, 2, 3, 4]), 2.5)
        self.assertIsNone(c.median([None]))
        self.assertEqual(c.hhi([50, 50]), 5000)
        self.assertEqual(c.hhi([100]), 10000)
        self.assertIsNone(c.hhi([0, 0]))


class DisclosureTiers(unittest.TestCase):
    BY_TICKER = {"JNJ": ("0000200406", "JOHNSON & JOHNSON"), "MMM": ("0000066740", "3M CO"), "ABT": ("0000001800", "ABBOTT LABORATORIES"),
                 "GNRC": ("0001474735", "GENERAC HOLDINGS INC."), "PHG": ("0000313216", "KONINKLIJKE PHILIPS NV"),
                 "ZBH": ("0001136869", "ZIMMER BIOMET HOLDINGS, INC."), "MDT": ("0001613103", "Medtronic plc"),
                 "ABBV": ("0001551152", "AbbVie Inc."), "BDX": ("0000010795", "BECTON DICKINSON & CO"), "SYK": ("0000310764", "STRYKER CORP"),
                 "BSX": ("0000885725", "BOSTON SCIENTIFIC CORP"), "TM": ("0001094517", "TOYOTA MOTOR CORP/"), "ANGO": ("0001275187", "ANGIODYNAMICS INC")}

    def setUp(self):
        self.aliases = dm.resolve_aliases(self.BY_TICKER)

    def test_tiers(self):
        k = c.company_key
        self.assertEqual(dm.classify(k("Johnson & Johnson Com"), k("Johnson & Johnson"), 2019, self.aliases, set())[0], "match")
        self.assertEqual(dm.classify(k("JNJ"), k("Johnson & Johnson"), 2019, self.aliases, set())[0], "near_match")
        self.assertEqual(dm.classify(k("Johnson & Johnson"), k("Ethicon, Inc."), 2019, self.aliases, set())[0], "near_match")
        self.assertEqual(dm.classify(k("Abbott Laboratories"), k("Abbott"), 2019, self.aliases, set())[0], "near_match")
        self.assertEqual(dm.classify(k("Koninklijke Philips NV ADR"), k("Philips"), 2019, self.aliases, set())[0], "near_match")
        self.assertEqual(dm.classify(k("Pfizer Inc Fund"), k("Pfizer Inc"), 2019, self.aliases, {"pfe"}), None)
        self.assertEqual(dm.classify(k("PFE"), k("Pfizer Inc"), 2019, self.aliases, {"pfe"})[0], "near_match")
        self.assertEqual(dm.classify(k("Boston Scientific Corp Bond 2025"), k("Boston Scientific Corporation"), 2019, self.aliases, set())[1],
                         "investment name begins with the party name")
        self.assertIsNone(dm.classify(k("Philips 66"), k("Philips"), 2019, self.aliases, set()))
        self.assertIsNone(dm.classify(k("Vanguard 500 Index"), k("Johnson & Johnson"), 2019, self.aliases, set()))

    def test_parent_dates(self):
        k = c.company_key
        self.assertIsNone(dm.classify(k("AbbVie Inc"), k("Allergan"), 2019, self.aliases, set()))
        self.assertEqual(dm.classify(k("AbbVie Inc"), k("Allergan"), 2020, self.aliases, set())[0], "near_match")
        self.assertIsNone(dm.classify(k("Becton Dickinson"), k("C.R. Bard, Inc."), 2017, self.aliases, set()))
        self.assertEqual(dm.classify(k("Becton Dickinson & Co"), k("C.R. Bard, Inc."), 2018, self.aliases, set())[0], "near_match")

    def test_bad_ticker_fails_loudly(self):
        with self.assertRaises(SystemExit):
            dm.resolve_aliases({**self.BY_TICKER, "JNJ": ("1", "SOMETHING ELSE")})

    def test_non_company_parties(self):
        for name in ["Defendants", "All Other Defendants", "United States of America", "State of New Jersey", "New Jersey",
                     "County of Suffolk", "Does 1-100", "Travelers Casualty Insurance Company"]:
            self.assertIsNotNone(dm.non_company_reason(name), name)
        for name in ["3M Company", "Monsanto Company", "Mutual Pharmaceutical Company, Inc.", "E. I. du Pont de Nemours and Company"]:
            self.assertIsNone(dm.non_company_reason(name), name)


def xw(judges_id, nid):
    return {"id": judges_id, "item": {"profile": {"fjc_nid": nid}}}


class ProfileIdsByNid(unittest.TestCase):
    """Exact /judges profile per FJC nid (de-judges-data): stored id, else a single bridging directory record; conflicts stay unlinked."""

    def test_stored_id_wins_and_agrees_with_bridge(self):
        self.assertEqual(c.profile_ids_by_nid({"1": "p1"}, [xw("p1", "1")]), {"1": "p1"})

    def test_bridge_fills_a_missing_stored_id(self):
        self.assertEqual(c.profile_ids_by_nid({"9280736": None}, [xw("bdfb", "9280736"), xw("stub", None)]), {"9280736": "bdfb"})

    def test_disagreement_is_never_resolved(self):
        self.assertEqual(c.profile_ids_by_nid({"1": "p1"}, [xw("p2", "1")]), {})

    def test_two_bridging_records_are_ambiguous(self):
        self.assertEqual(c.profile_ids_by_nid({"1": None}, [xw("p1", "1"), xw("p2", "1")]), {})

    def test_one_profile_claimed_by_two_nids_is_dropped(self):
        self.assertEqual(c.profile_ids_by_nid({"1": "p1", "2": None}, [xw("p1", "2")]), {})


class RelinkJudgeCross(unittest.TestCase):
    """relink_judge_cross_profiles.resolve and the contract text (synthetic snapshots)."""

    @classmethod
    def setUpClass(cls):
        import relink_judge_cross_profiles as R
        cls.R = R

    def snapshot(self):
        rec = lambda rid, prof, filt: {"id": rid, "kind": "judge", "nid": rid, "name": f"Judge {rid}", "judge_profile_id": prof, "photo": None,
                                       "filter_judge_profile": filt, "row_md5": "f" * 32}
        return {"records": [rec("1", None, []), rec("2", "p2", ["p2"]), rec("3", "p3", ["p3"]), rec("4", None, []),
                            {"id": "summary:overview", "kind": "summary", "row_md5": "e" * 32,
                             "scatter": [{"nid": "1", "judge_profile_id": None}, {"nid": "2", "judge_profile_id": "p2"}]}],
                "photos": {"p1": "/supplement-files/judge_portraits/x"}}

    def test_fills_only_missing_profiles_and_reports_conflicts(self):
        fjc = [{"nid": "1", "profiles": ["p1"]}, {"nid": "2", "profiles": ["p2"]}, {"nid": "3", "profiles": ["p3-other"]}, {"nid": "4", "profiles": []}]
        fills, conflicts, summary = self.R.resolve(self.snapshot(), fjc, [{"judges_id": "p1", "fjc_nid": "1"}])
        self.assertEqual([(f["id"], f["profile"], f["photo"]) for f in fills], [("1", "p1", "/supplement-files/judge_portraits/x")])
        self.assertEqual(conflicts, [{"id": "3", "name": "Judge 3", "stored": "p3", "resolved": "p3-other"}])  # kept, reported
        self.assertEqual(summary["entries"], [{"nid": "1", "profile": "p1", "photo": "/supplement-files/judge_portraits/x"}])

    def test_contract_guards_rows_and_writes_no_deletes(self):
        fills, conflicts, summary = self.R.resolve(self.snapshot(), [{"nid": "1", "profiles": ["p1"]}], [])
        sql = self.R.render_sql(fills, summary, conflicts, {"judge_cross_profiles": "x"},
                                {"judge_records": 4, "with_profile": 3, "with_profile_filter": 3})
        self.assertIn("md5(to_jsonb(r)::text) = c.original_record->>'row_md5'", sql)
        self.assertIn("'judge_profile', jsonb_build_array(x.profile)", sql)
        self.assertIn("ROLLBACK (exact", sql)
        self.assertNotIn("delete from", sql.lower())
        self.assertNotIn("insert into", self.R.preview_sql(fills).lower())


if __name__ == "__main__":
    unittest.main()
