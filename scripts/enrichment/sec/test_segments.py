"""Unit tests for XBRL instance and label parsing and segment sum checks.
Run: python3 -m unittest scripts/enrichment/sec/test_segments.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import segments as seg  # noqa: E402

INSTANCE = b"""<?xml version="1.0" encoding="utf-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
  xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:abc="http://abc.example/2025" xmlns:srt="http://fasb.org/srt/2025"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <xbrli:context id="FY"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="FY_A"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">abc:DevicesMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="FY_B"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">abc:DiagnosticsMember</xbrldi:explicitMember>
  <xbrldi:explicitMember dimension="srt:ConsolidationItemsAxis">us-gaap:OperatingSegmentsMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="FY_ALL"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">us-gaap:AllSegmentsMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="FY_ELIM"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">abc:DevicesMember</xbrldi:explicitMember>
  <xbrldi:explicitMember dimension="srt:ConsolidationItemsAxis">us-gaap:IntersegmentEliminationMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="FY_TWO"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">abc:DevicesMember</xbrldi:explicitMember>
  <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="Q3_A"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>
  <xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">abc:DevicesMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="I"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context>
 <us-gaap:Revenues contextRef="FY" unitRef="usd" decimals="-6">1000000000</us-gaap:Revenues>
 <us-gaap:Revenues contextRef="FY_A" unitRef="usd" decimals="-6">600000000</us-gaap:Revenues>
 <us-gaap:Revenues contextRef="FY_B" unitRef="usd" decimals="-6">400000000</us-gaap:Revenues>
 <us-gaap:Revenues contextRef="FY_ALL" unitRef="usd" decimals="-6">1000000000</us-gaap:Revenues>
 <us-gaap:Revenues contextRef="FY_ELIM" unitRef="usd" decimals="-6">-5000000</us-gaap:Revenues>
 <us-gaap:Revenues contextRef="FY_TWO" unitRef="usd" decimals="-6">500000000</us-gaap:Revenues>
 <us-gaap:Revenues contextRef="Q3_A" unitRef="usd" decimals="-6">150000000</us-gaap:Revenues>
 <us-gaap:OperatingIncomeLoss contextRef="FY" unitRef="usd" xsi:nil="true"/>
 <us-gaap:OperatingIncomeLoss contextRef="FY_A" unitRef="usd" decimals="-6">90000000</us-gaap:OperatingIncomeLoss>
 <us-gaap:OperatingIncomeLoss contextRef="FY_B" unitRef="usd" decimals="-6">40000000</us-gaap:OperatingIncomeLoss>
 <us-gaap:Assets contextRef="I" unitRef="usd" decimals="-6">5000000000</us-gaap:Assets>
</xbrli:xbrl>
"""

LABELS = b"""<?xml version="1.0" encoding="utf-8"?>
<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
 <link:labelLink xlink:type="extended" xlink:role="http://www.xbrl.org/2003/role/link">
  <link:loc xlink:type="locator" xlink:href="abc-20251231.xsd#abc_DevicesMember" xlink:label="loc_dev"/>
  <link:label xlink:type="resource" xlink:label="lab_dev" xlink:role="http://www.xbrl.org/2003/role/label">Medical Devices [Member]</link:label>
  <link:label xlink:type="resource" xlink:label="lab_dev" xlink:role="http://www.xbrl.org/2003/role/terseLabel">Devices</link:label>
  <link:labelArc xlink:type="arc" xlink:from="loc_dev" xlink:to="lab_dev"/>
  <link:loc xlink:type="locator" xlink:href="abc-20251231.xsd#abc_DiagnosticsMember" xlink:label="loc_dx"/>
  <link:label xlink:type="resource" xlink:label="lab_dx" xlink:role="http://www.xbrl.org/2003/role/label">Diagnostic Products [Member]</link:label>
  <link:labelArc xlink:type="arc" xlink:from="loc_dx" xlink:to="lab_dx"/>
 </link:labelLink>
</link:linkbase>
"""


class Instance(unittest.TestCase):
    def setUp(self):
        self.contexts, self.facts = seg.parse_instance(INSTANCE)

    def test_contexts_keep_explicit_members_and_periods(self):
        self.assertEqual(self.contexts["FY_B"]["dims"], {"StatementBusinessSegmentsAxis": "abc:DiagnosticsMember",
                                                         "ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"})
        self.assertEqual((self.contexts["Q3_A"]["start"], self.contexts["Q3_A"]["end"]), ("2025-07-01", "2025-09-30"))
        self.assertTrue(self.contexts["I"]["instant"])

    def test_only_tracked_numeric_concepts_are_kept(self):
        concepts = {(f["concept"], f["context"]) for f in self.facts}
        self.assertIn(("Revenues", "FY_A"), concepts)
        self.assertNotIn(("OperatingIncomeLoss", "FY"), concepts)  # nil
        self.assertFalse(any(f["concept"] == "Assets" for f in self.facts))

    def test_segment_facts_exclude_aggregates_eliminations_and_multi_axis_contexts(self):
        dimensional, totals = seg.segment_facts(self.contexts, self.facts, "10-K")
        annual_rev = {(d["member"], d["value"]) for d in dimensional if d["concept"] == "Revenues" and d["grain"] == "annual"}
        self.assertEqual(annual_rev, {("abc:DevicesMember", 600000000.0), ("abc:DiagnosticsMember", 400000000.0)})
        quarterly = [d for d in dimensional if d["grain"] == "quarterly"]
        self.assertEqual([(d["member"], d["value"]) for d in quarterly], [("abc:DevicesMember", 150000000.0)])
        self.assertEqual([(t["concept"], t["value"]) for t in totals], [("Revenues", 1000000000.0)])

    def test_annual_spans_in_a_10q_are_not_annual_segments(self):
        dimensional, _ = seg.segment_facts(self.contexts, self.facts, "10-Q")
        self.assertTrue(all(d["grain"] == "quarterly" for d in dimensional))


class Checks(unittest.TestCase):
    def test_sum_checks_report_matches_differences_and_missing_totals(self):
        contexts, facts = seg.parse_instance(INSTANCE)
        dimensional, totals = seg.segment_facts(contexts, facts, "10-K")
        checks = {(c["concept"], c["start"], c["end"]): c for c in seg.sum_checks(dimensional, totals)}
        rev = checks[("Revenues", "2025-01-01", "2025-12-31")]
        self.assertEqual((rev["status"], rev["sum"], rev["total"], rev["diff_pct"]), ("matches", 1000000000.0, 1000000000.0, 0.0))
        self.assertEqual(checks[("OperatingIncomeLoss", "2025-01-01", "2025-12-31")]["status"], "no_total")
        self.assertEqual(checks[("Revenues", "2025-07-01", "2025-09-30")]["status"], "no_total")

    def test_a_shortfall_beyond_tolerance_is_reported_not_forced(self):
        dimensional = [{"axis": "X", "concept": "Revenues", "start": "a", "end": "b", "unit": "usd", "member": m, "value": v}
                       for m, v in (("m1", 50.0), ("m2", 40.0))]
        totals = [{"concept": "Revenues", "start": "a", "end": "b", "unit": "usd", "value": 100.0}]
        (check,) = seg.sum_checks(dimensional, totals)
        self.assertEqual((check["status"], check["diff_pct"], check["sum"]), ("differs", -10.0, 90.0))


class Labels(unittest.TestCase):
    def test_terse_label_preferred_then_standard_without_member_suffix(self):
        labels = seg.parse_labels(LABELS)
        self.assertEqual(seg.member_label("abc:DevicesMember", labels), "Devices")
        self.assertEqual(seg.member_label("abc:DiagnosticsMember", labels), "Diagnostic Products")

    def test_unlabelled_members_are_humanized(self):
        self.assertEqual(seg.member_label("abc:NorthAmericaMember", {}), "North America")
        self.assertEqual(seg.humanize("us-gaap:USAndCanadaMember"), "US And Canada")

    def test_duplicate_labels_are_told_apart(self):
        labels = {"abc_HousingWestMember": "Housing", "abc_HousingEastMember": "Housing"}
        self.assertEqual(seg.member_labels(["abc:HousingWestMember", "abc:HousingEastMember"], labels),
                         ["Housing (Housing West)", "Housing (Housing East)"])


if __name__ == "__main__":
    unittest.main()
