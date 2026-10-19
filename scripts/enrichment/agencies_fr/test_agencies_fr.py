"""Offline unit tests for the agencies_fr parsers (synthetic fixtures, no network).

Run: cd scripts/enrichment/agencies_fr && python3 -B -m unittest -v test_agencies_fr
"""
import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parsers as P  # noqa: E402


class NameMatching(unittest.TestCase):
    def test_inverted_federal_register_names_match_natural_order(self):
        self.assertEqual(P.name_key("Land Management Bureau"), P.name_key("Bureau of Land Management"))
        self.assertEqual(P.name_key("Treasury Department"), P.name_key("Department of the Treasury"))
        self.assertEqual(P.name_key("Centers for Medicare & Medicaid Services"),
                         P.name_key("Centers for Medicare and Medicaid Services"))
        self.assertEqual(P.name_key("U.S. Customs and Border Protection"), P.name_key("Customs and Border Protection"))

    def test_different_organisations_do_not_match(self):
        self.assertNotEqual(P.name_key("Comptroller of the Currency"), P.name_key("Office of the Comptroller of the Currency"))
        self.assertNotEqual(P.name_key("Federal Trade Commission"), P.name_key("Federal Maritime Commission"))

    def test_match_requires_unique_key_on_both_sides(self):
        fr = [{"id": 1, "name": "Agriculture Department"}, {"id": 2, "name": "Secretary's Office"},
              {"id": 3, "name": "Office of the Secretary"}]
        other = [{"n": "Department of Agriculture"}, {"n": "Office of the Secretary"}, {"n": "Nonexistent Board"}]
        pairs, stats = P.match_names(fr, other, lambda a: a["name"], lambda o: o["n"])
        self.assertEqual([(a["id"], o["n"]) for a, o in pairs], [(1, "Department of Agriculture")])
        # "Secretary's Office" and "Office of the Secretary" share a key on the FR side -> ambiguous, no match
        self.assertEqual(stats["left_ambiguous_keys"], 1)
        self.assertIn("Nonexistent Board", stats["right_unmatched"])
        self.assertIn("Office of the Secretary", stats["right_unmatched"])

    def test_empty_names_never_match(self):
        self.assertEqual(P.name_key(None), "")
        index, _ = P.unique_index([{"name": ""}], lambda x: P.name_key(x["name"]))
        self.assertEqual(index, {})


class FederalRegister(unittest.TestCase):
    def test_facet_counts_drop_malformed(self):
        body = {"a": {"count": 3, "name": "A"}, "b": {"count": "x"}, "c": None, "d": {"count": -1}}
        self.assertEqual(P.facet_counts(body), {"a": 3})
        self.assertEqual(P.facet_counts(None), {})

    def test_year_and_month_series(self):
        body = {"2024-01-01": {"count": 5}, "2025-01-01": {"count": 0}, "bad": {"count": 9}}
        self.assertEqual(P.year_series(body), {"2024": 5, "2025": 0})
        self.assertEqual(P.month_series({"2026-10-01": {"count": 2}}), {"2026-10": 2})

    def test_compact_doc_requires_official_url(self):
        self.assertIsNone(P.compact_doc({"html_url": "https://example.com/x", "title": "T"}))
        doc = {"html_url": "https://www.federalregister.gov/documents/2026/01/02/x", "title": "  A  rule ",
               "cfr_references": [{"title": 40, "part": "52"}, {"title": 40, "part": "52"}, {"title": None, "part": "1"}],
               "abstract": "word " * 200}
        c = P.compact_doc(doc, abstract_chars=50)
        self.assertEqual(c["title"], "A rule")
        self.assertEqual(c["cfr"], ["40 CFR 52"])
        self.assertTrue(c["abstract"].endswith("…") and len(c["abstract"]) <= 50)

    def test_missing_title_is_not_recorded(self):
        c = P.compact_doc({"html_url": "https://www.federalregister.gov/d/1"})
        self.assertEqual(c["title"], P.NOT_RECORDED)
        self.assertIsNone(c["abstract"])

    def test_doc_agency_ids(self):
        doc = {"agencies": [{"id": 1}, {"raw_name": "X"}, {"id": 1}, {"id": 2}]}
        self.assertEqual(P.doc_agency_ids(doc), [1, 2])

    def test_admin_windows_and_rates(self):
        windows = [{"key": "a", "start": "2021-01-20", "end": "2025-01-19"}, {"key": "b", "start": "2025-01-20", "end": "2026-10-19"}]
        self.assertEqual(P.admin_for_date("2025-01-19", windows), "a")
        self.assertEqual(P.admin_for_date("2025-01-20", windows), "b")
        self.assertIsNone(P.admin_for_date("2020-01-01", windows))
        self.assertIsNone(P.admin_for_date("not a date", windows))
        self.assertEqual(P.window_days("2025-01-20", "2025-01-20"), 1)
        self.assertEqual(P.per_year(365, 365), 365.2)
        self.assertIsNone(P.per_year(5, 0))


UA_XML = """<RIN_INFO>
  <RIN>2060-AV12</RIN>
  <PUBLICATION><PUBLICATION_ID>202510</PUBLICATION_ID><PUBLICATION_TITLE>T</PUBLICATION_TITLE></PUBLICATION>
  <AGENCY><CODE>2060</CODE><NAME>Air and Radiation</NAME><ACRONYM>OAR</ACRONYM></AGENCY>
  <PARENT_AGENCY><CODE>2000</CODE><NAME>Environmental Protection Agency</NAME><ACRONYM>EPA</ACRONYM></PARENT_AGENCY>
  <RULE_TITLE>Example   Standards</RULE_TITLE>
  <ABSTRACT>&lt;p&gt;Proposes &amp;amp; amends.&lt;/p&gt;</ABSTRACT>
  <PRIORITY_CATEGORY>Economically Significant</PRIORITY_CATEGORY>
  <RIN_STATUS>Previously Published in The Unified Agenda</RIN_STATUS>
  <RULE_STAGE>Proposed Rule Stage</RULE_STAGE>
  <MAJOR>Yes</MAJOR>
  <CFR_LIST><CFR>40 CFR 60</CFR></CFR_LIST>
  <LEGAL_AUTHORITY_LIST><LEGAL_AUTHORITY>42 U.S.C. 7411</LEGAL_AUTHORITY></LEGAL_AUTHORITY_LIST>
  <LEGAL_DLINE_LIST><LEGAL_DLINE_INFO><DLINE_TYPE>Judicial</DLINE_TYPE><DLINE_ACTION_STAGE>Final</DLINE_ACTION_STAGE><DLINE_DATE>12/31/2026</DLINE_DATE><DLINE_DESC>Consent decree</DLINE_DESC></LEGAL_DLINE_INFO></LEGAL_DLINE_LIST>
  <RPLAN_ENTRY>Yes</RPLAN_ENTRY>
  <TIMETABLE_LIST>
    <TIMETABLE><TTBL_ACTION>ANPRM</TTBL_ACTION><TTBL_DATE>03/15/2025</TTBL_DATE><FR_CITATION>90 FR 1234</FR_CITATION></TIMETABLE>
    <TIMETABLE><TTBL_ACTION>NPRM</TTBL_ACTION><TTBL_DATE>12/00/2026</TTBL_DATE></TIMETABLE>
    <TIMETABLE><TTBL_ACTION>Final Rule</TTBL_ACTION><TTBL_DATE>To Be Determined</TTBL_DATE></TIMETABLE>
  </TIMETABLE_LIST>
</RIN_INFO>"""


class UnifiedAgenda(unittest.TestCase):
    def test_parse_rin(self):
        e = P.parse_ua_rin(ET.fromstring(UA_XML), "2026-10")
        self.assertEqual(e["rin"], "2060-AV12")
        self.assertEqual(e["title"], "Example Standards")
        self.assertEqual(e["abstract"], "Proposes & amends.")
        self.assertEqual(e["parent"]["name"], "Environmental Protection Agency")
        self.assertTrue(e["regulatoryPlan"])
        self.assertEqual(e["timetable"][0]["frUrl"], "https://www.federalregister.gov/citation/90-FR-1234")
        self.assertEqual(e["nextAction"]["action"], "NPRM")
        self.assertEqual(e["nextAction"]["month"], "2026-12")
        self.assertFalse(e["nextAction"]["passed"])
        self.assertEqual(len(e["legalDeadlines"]), 1)

    def test_next_action_skips_events_and_marks_passed_projections(self):
        tt = [
            {"action": "Interim Final Rule", "date": "11/20/2024", "month": "2024-11", "day": "2024-11-20", "frCitation": "89 FR 91529"},
            {"action": "Interim Final Rule Effective", "date": "11/20/2024", "month": "2024-11", "day": "2024-11-20", "frCitation": None},
            {"action": "Final Action", "date": "07/00/2026", "month": "2026-07", "day": None, "frCitation": None},
        ]
        n = P.next_scheduled(tt, "2026-10")
        self.assertEqual(n["action"], "Final Action")
        self.assertTrue(n["passed"])
        tbd = [{"action": "Final Rule", "date": "To Be Determined", "month": None, "day": None, "frCitation": None}]
        self.assertEqual(P.next_scheduled(tbd, "2026-10")["passed"], False)
        self.assertIsNone(P.next_scheduled(tt[:2], "2026-10"))

    def test_missing_fields_are_not_recorded(self):
        e = P.parse_ua_rin(ET.fromstring("<RIN_INFO><RIN>0000-AA00</RIN></RIN_INFO>"), "2026-10")
        self.assertEqual(e["stage"], P.NOT_RECORDED)
        self.assertEqual(e["priority"], P.NOT_RECORDED)
        self.assertIsNone(e["parent"])
        self.assertIsNone(e["nextAction"])

    def test_dates(self):
        self.assertEqual(P.ua_date("07/00/2026"), ("2026-07", None))
        self.assertEqual(P.ua_date("11/20/2024"), ("2024-11", "2024-11-20"))
        self.assertEqual(P.ua_date("02/31/2024"), ("2024-02", None))
        self.assertEqual(P.ua_date("13/01/2024"), (None, None))
        self.assertEqual(P.ua_date("To Be Determined"), (None, None))
        self.assertIsNone(P.fr_citation_url("90 FR"))

    def test_summary_counts(self):
        e1 = P.parse_ua_rin(ET.fromstring(UA_XML), "2026-10")
        e2 = P.parse_ua_rin(ET.fromstring("<RIN_INFO><RIN>0000-AA00</RIN><RULE_STAGE>Final Rule Stage</RULE_STAGE></RIN_INFO>"), "2026-10")
        s = P.agenda_summary([e1, e2])
        self.assertEqual(s["total"], 2)
        self.assertEqual(s["byStage"]["Proposed Rule Stage"], 1)
        self.assertEqual(s["byStage"]["Final Rule Stage"], 1)
        self.assertEqual(s["byPriority"]["Economically Significant"], 1)
        self.assertEqual(s["otherPriority"], 1)
        self.assertEqual(s["major"], 1)
        self.assertEqual(s["withLegalDeadline"], 1)


GOVMAN_XML = """<GovernmentManual>
 <Entity EntityId="10" ParentId="0"><AgencyName>Department of Example</AgencyName><Category>Executive Branch: Departments</Category>
  <Addresses><Address><FooterDetails><WebAddress>https://example.gov</WebAddress></FooterDetails></Address></Addresses>
  <MissionStatement><Record><Paragraph>Serve   the public.</Paragraph></Record></MissionStatement>
  <LeaderShipTables>
   <LeaderShipTable><FooterDetails><WebAddress>https://example.gov/leaders</WebAddress></FooterDetails><Header>*</Header>
    <LeaderShipTableValues>
     <Values><NameColumnValue>Jane Roe</NameColumnValue><TitleColumnValue>SECRETARY</TitleColumnValue></Values>
     <Values><NameColumnValue /><TitleColumnValue>-----------------------------</TitleColumnValue></Values>
     <Values><NameColumnValue /><TitleColumnValue>DIRECTORS</TitleColumnValue></Values>
     <Values><NameColumnValue>(vacancy)</NameColumnValue><TitleColumnValue>Deputy Secretary</TitleColumnValue></Values>
    </LeaderShipTableValues>
   </LeaderShipTable>
   <LeaderShipTable><Header>Empty</Header><LeaderShipTableValues /></LeaderShipTable>
  </LeaderShipTables>
  <Childrens><SubEntityLevelOne EntityId="11" ParentId="10"><AgencyName>Example Bureau</AgencyName><Category>X</Category></SubEntityLevelOne></Childrens>
 </Entity>
</GovernmentManual>"""


class GovernmentManual(unittest.TestCase):
    def test_entities_and_leadership(self):
        root = ET.fromstring(GOVMAN_XML)
        ents = P.govman_entities(root)
        self.assertEqual([(e["entityId"], e["parentEntityId"], e["level"]) for e in ents], [("10", None, 0), ("11", "10", 1)])
        rec = P.govman_record(ents[0], ["Example Bureau"])
        self.assertEqual(rec["mission"], "Serve the public.")
        self.assertEqual(rec["website"], "https://example.gov")
        self.assertEqual(len(rec["leadership"]), 1)  # the table without names is dropped
        rows = rec["leadership"][0]["rows"]
        self.assertEqual(rows[0], {"name": "Jane Roe", "title": "SECRETARY"})
        self.assertEqual(rows[1], {"heading": "DIRECTORS"})
        self.assertEqual(rows[2]["name"], "(vacancy)")  # printed text kept as printed
        self.assertEqual(rec["leadership"][0]["header"], "")
        self.assertEqual(rec["components"], ["Example Bureau"])

    def test_entity_without_details(self):
        ents = P.govman_entities(ET.fromstring(GOVMAN_XML))
        rec = P.govman_record(ents[1], [])
        self.assertIsNone(rec["mission"])
        self.assertIsNone(rec["website"])
        self.assertEqual(rec["leadership"], [])


class CensusAndMath(unittest.TestCase):
    def test_population_state_rows_only(self):
        rows = [{"SUMLEV": "010", "STATE": "00", "POPESTIMATE2025": "340000000"},
                {"SUMLEV": "040", "STATE": "6", "POPESTIMATE2025": "39000000"},
                {"SUMLEV": "040", "STATE": "72", "POPESTIMATE2025": "3200000"},
                {"SUMLEV": "040", "STATE": "99", "POPESTIMATE2025": "1"},
                {"SUMLEV": "040", "STATE": "11", "POPESTIMATE2025": ""}]
        self.assertEqual(P.census_population(rows), {"CA": 39000000, "PR": 3200000})

    def test_change_share_rank_median(self):
        self.assertEqual(P.pct_change(120, 100), 20.0)
        self.assertIsNone(P.pct_change(5, 0))
        self.assertIsNone(P.pct_change(None, 5))
        self.assertEqual(P.share_pct(1, 4), 25.0)
        self.assertIsNone(P.share_pct(1, 0))
        self.assertEqual(P.rank_desc({"a": 5, "b": 9, "c": 5, "d": None}), {"b": 1, "a": 2, "c": 2})
        self.assertEqual(P.median([3, 1, 2]), 2)
        self.assertEqual(P.median([4, 1, 2, 3]), 2.5)
        self.assertIsNone(P.median([None]))


if __name__ == "__main__":
    unittest.main()
