import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from parsing import (  # noqa: E402
    case_states,
    clean_text,
    defendant_key,
    fiscal_year,
    hazard_categories,
    mentions_death,
    mentions_injury,
    mentions_standard_violation,
    money,
    normalize_country,
    parse_units,
    primary_statute,
    recall_units,
    reports_none,
    us_date,
)


class EpaParsing(unittest.TestCase):
    def test_money(self):
        self.assertEqual(money("4720"), 4720.0)
        self.assertEqual(money("16418935846.16"), 16418935846.16)
        self.assertIsNone(money(""))
        self.assertIsNone(money("abc"))
        self.assertIsNone(money("-5"))
        self.assertEqual(money("0"), 0.0)

    def test_dates(self):
        self.assertEqual(fiscal_year("2024"), 2024)
        self.assertIsNone(fiscal_year(""))
        self.assertIsNone(fiscal_year("24"))
        self.assertEqual(us_date("05/14/1990"), "1990-05-14")
        self.assertIsNone(us_date("1990-05-14"))

    def test_primary_statute(self):
        self.assertEqual(primary_statute([("0", "CWA"), ("1", "CAA"), ("1", "RCRA")]), "CAA")
        self.assertIsNone(primary_statute([("0", "CWA")]))
        self.assertIsNone(primary_statute([]))

    def test_defendant_key_keeps_exact_name(self):
        self.assertEqual(defendant_key("  BP Products  North America, Inc. "), "BP Products North America, Inc.")
        self.assertNotEqual(defendant_key("BP Products North America Inc."), defendant_key("BP Products North America, Inc."))

    def test_case_states(self):
        self.assertEqual(case_states(["tx", "TX", "", "LA", "X", "  "]), ["LA", "TX"])


class CpscParsing(unittest.TestCase):
    def test_hazards(self):
        self.assertEqual(hazard_categories("The heaters can overheat, posing a fire hazard."), ["fire_burn"])
        self.assertIn("choking", hazard_categories("The horn can detach, posing a choking hazard to children."))
        self.assertIn("suffocation", hazard_categories("posing a serious entrapment hazard and risk of death by asphyxiation"))
        self.assertIn("tip_over", hazard_categories("Dressers Recalled Due to Tip-Over Hazard"))
        self.assertIn("chemical", hazard_categories("Surface paint contains excessive levels of lead"))
        self.assertNotIn("chemical", hazard_categories("A loose bolt can lead to a fall"))
        self.assertEqual(hazard_categories("Recall of Basketball Shoes"), ["other"])
        self.assertEqual(hazard_categories(""), ["other"])

    def test_standard(self):
        self.assertTrue(mentions_standard_violation("The bed rails violate the mandatory standard"))
        self.assertTrue(mentions_standard_violation("fails to meet the federal flammability standard"))
        self.assertFalse(mentions_standard_violation("posing a fire hazard"))

    def test_death_mentions(self):
        self.assertTrue(mentions_death("A 79-year-old man died from smoke inhalation"))
        self.assertTrue(mentions_death("five infant fatalities have occurred"))
        self.assertFalse(mentions_death("There have been no reports of injury or death and one report of property damage."))
        self.assertFalse(mentions_death("No injuries or deaths have been reported."))
        self.assertFalse(mentions_death("None reported."))
        self.assertTrue(mentions_death("No injuries reported. CPSC is aware of seven deaths since 2005."))

    def test_injury_mentions(self):
        self.assertTrue(mentions_injury("resulting in 15 fires and 350 burn injuries"))
        self.assertFalse(mentions_injury("No injuries have been reported."))
        self.assertFalse(mentions_injury("No incidents or injuries have been reported."))
        self.assertTrue(reports_none("None reported."))
        self.assertTrue(reports_none("No incidents or injuries have been reported."))
        self.assertFalse(reports_none("The firm has received 3 reports of burns."))

    def test_units(self):
        self.assertEqual(parse_units("About 14,250"), 14250)
        self.assertEqual(parse_units("Approximately 500 units"), 500)
        self.assertEqual(parse_units("About 1.2 million"), 1200000)
        self.assertEqual(parse_units("About one million"), 1000000)
        self.assertIsNone(parse_units("More than 25 million"))
        self.assertIsNone(parse_units("About 7,200 weed trimmers, 192 brushcutters and 344 augers"))
        self.assertIsNone(parse_units("Up to 9 million"))
        self.assertIsNone(parse_units("About 1.5"))
        self.assertIsNone(parse_units(""))

    def test_recall_units(self):
        self.assertEqual(recall_units([{"NumberOfUnits": "About 1,000"}, {"NumberOfUnits": "About 1,000"}]), 1000)
        self.assertIsNone(recall_units([{"NumberOfUnits": "About 1,000"}, {"NumberOfUnits": "About 2,000"}]))
        self.assertIsNone(recall_units([{"NumberOfUnits": ""}]))

    def test_hazard_exclusions(self):
        battery = "When button cell batteries are swallowed, they can cause chemical burns and blood poisoning."
        self.assertNotIn("fire_burn", hazard_categories(battery))
        self.assertNotIn("chemical", hazard_categories(battery))
        self.assertIn("ingestion", hazard_categories(battery))
        self.assertNotIn("tip_over", hazard_categories("The dart tips can break"))
        self.assertIn("tip_over", hazard_categories("The dresser tips over if not anchored"))

    def test_country(self):
        known = {"China", "United States", "Mexico", "Bosnia and Herzegovina", "Japan"}
        self.assertEqual(normalize_country("China (batteries)", known), ["China"])
        self.assertEqual(normalize_country("Bosnia and Herzegovina", known), ["Bosnia and Herzegovina"])
        self.assertEqual(normalize_country("United States and Mexico", known), ["United States", "Mexico"])
        self.assertEqual(normalize_country("United States (crossbows), China (sensors)", known), ["United States", "China"])
        self.assertEqual(normalize_country("Japan and assembled in the United States", known), ["Japan and assembled in the United States"])
        self.assertEqual(normalize_country("", known), [])

    def test_clean(self):
        self.assertEqual(clean_text("  a \n b  "), "a b")


if __name__ == "__main__":
    unittest.main()
