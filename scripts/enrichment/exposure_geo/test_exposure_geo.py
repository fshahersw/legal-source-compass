"""Offline tests for the exposure-geography builders: synthetic rows only, no network, no corpus writes.

Run: python -B -m unittest discover -s scripts/enrichment/exposure_geo -p "test_*.py" -v
"""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_partd as P  # noqa: E402
import build_places as PL  # noqa: E402
import build_ucmr5 as U  # noqa: E402
import exposure_common as X  # noqa: E402


def partd_row(level="State", code="34", desc="New Jersey", brand="Ozempic", generic="Semaglutide", claims="100", benes="40", **kw):
    row = {"Prscrbr_Geo_Lvl": level, "Prscrbr_Geo_Cd": code, "Prscrbr_Geo_Desc": desc, "Brnd_Name": brand, "Gnrc_Name": generic,
           "Tot_Prscrbrs": "12", "Tot_Clms": claims, "Tot_30day_Fills": "150.5", "Tot_Drug_Cst": "1000.25", "Tot_Benes": benes}
    row.update(kw)
    return row


class MappingTests(unittest.TestCase):
    def test_reviewed_map_validates_and_every_title_is_a_jpml_title(self):
        data = X.load_map()
        self.assertTrue(all(e["mdl_title"].startswith("IN RE:") for e in data["partd"]))
        self.assertEqual(data["ucmr5"]["mdl"], "2873")

    def test_class_mapping_without_a_cited_source_is_refused(self):
        data = copy.deepcopy(X.load_map())
        glp = next(e for e in data["partd"] if e["mdl"] == "3094")
        glp.pop("class_source_url")
        with self.assertRaises(ValueError):
            X.validate_map(data)

    def test_excluded_entry_needs_a_reason(self):
        data = copy.deepcopy(X.load_map())
        data["partd"].append({"mdl": "9999", "mdl_title": "IN RE: Example", "include": False})
        with self.assertRaises(ValueError):
            X.validate_map(data)

    def test_reviewed_places_links_cite_a_source(self):
        data = copy.deepcopy(X.load_map())
        data["places"][0]["source_url"] = ""
        with self.assertRaises(ValueError):
            X.validate_map(data)


class PartDTests(unittest.TestCase):
    def setUp(self):
        self.entries = {e["mdl"]: e for e in P.matchers(X.load_map())}

    def test_match_is_exact_and_case_sensitive(self):
        glp = self.entries["3094"]
        self.assertTrue(P.row_matches(glp, "Semaglutide", "Ozempic"))
        self.assertFalse(P.row_matches(glp, "semaglutide", "Ozempic"))
        self.assertFalse(P.row_matches(glp, "Insulin Degludec/Liraglutide", "Xultophy 100-3.6"))

    def test_brand_scope_and_excluded_brand(self):
        sub = self.entries["3092"]
        self.assertTrue(P.row_matches(sub, "Buprenorphine Hcl/Naloxone Hcl", "Suboxone"))
        self.assertFalse(P.row_matches(sub, "Buprenorphine Hcl/Naloxone Hcl", "Buprenorphine-Naloxone"))
        chantix = self.entries["3050"]
        self.assertTrue(P.row_matches(chantix, "Varenicline Tartrate", "Chantix"))
        self.assertFalse(P.row_matches(chantix, "Varenicline Tartrate", "Tyrvaya"))

    def test_excluded_mdl_has_no_matcher(self):
        self.assertNotIn("3043", self.entries)

    def test_geo_keeps_states_and_nation_only(self):
        self.assertEqual(P.geo_of(partd_row())["usps"], "NJ")
        self.assertEqual(P.geo_of(partd_row(level="National", code="", desc="National"))["usps"], "US")
        self.assertIsNone(P.geo_of(partd_row(code="9E", desc="Foreign Country")))
        self.assertIsNone(P.geo_of(partd_row(code="", desc="")))

    def test_sums_additive_fields_and_keeps_beneficiaries_per_product(self):
        products = [P.product(partd_row()), P.product(partd_row(brand="Trulicity", generic="Dulaglutide", claims="50", benes=""))]
        point = P.year_point(2024, products, {("Semaglutide", "Ozempic"), ("Dulaglutide", "Trulicity")})
        self.assertEqual(point["claims"], 150)
        self.assertIsNone(point["benes"])  # not additive across products
        self.assertFalse(point["lower_bound"])
        self.assertIsNone(products[1]["benes"])  # suppressed stays None, never 0

    def test_missing_product_marks_a_lower_bound(self):
        point = P.year_point(2024, [P.product(partd_row())], {("Semaglutide", "Ozempic"), ("Dulaglutide", "Trulicity")})
        self.assertTrue(point["lower_bound"])
        self.assertEqual(point["missing_products"], ["Trulicity (Dulaglutide)"])
        self.assertIsNone(point["benes"])  # a single present product is not the group total

    def test_single_product_group_keeps_beneficiaries(self):
        point = P.year_point(2024, [P.product(partd_row(brand="Elmiron", generic="Pentosan Polysulfate Sodium"))], {("Pentosan Polysulfate Sodium", "Elmiron")})
        self.assertEqual(point["benes"], 40)

    def test_unknown_total_when_a_product_figure_is_blank(self):
        point = P.year_point(2024, [P.product(partd_row()), P.product(partd_row(brand="Wegovy", claims=""))])
        self.assertIsNone(point["claims"])

    def test_records_cover_nation_and_state_with_sources(self):
        rows = {2023: [partd_row(level="National", code="", desc="National"), partd_row()], 2024: [partd_row(level="National", code="", desc="National")]}
        groups, skipped = P.collect(rows, list(self.entries.values()))
        recs = P.build_records(groups, [2023, 2024])
        ids = [r["id"] for r in recs]
        self.assertIn("partd:3094:US", ids)
        self.assertIn("partd:3094:NJ", ids)
        self.assertIn("partd:3163:NJ", ids)  # the same drugs belong to both GLP-1 MDLs by the reviewed map
        nj = next(r for r in recs if r["id"] == "partd:3094:NJ")
        self.assertEqual([p["year"] for p in nj["item"]["exposure"]["series"]], [2023])  # 2024 absent, not zero
        self.assertEqual(nj["state"], "NJ")
        self.assertTrue(nj["source_url"].startswith("https://data.cms.gov/"))
        self.assertEqual(skipped, {})

    def test_ranks_use_complete_values_only_and_share_the_national_total(self):
        nat = partd_row(level="National", code="", desc="National", brand="Elmiron", generic="Pentosan Polysulfate Sodium", claims="1000")
        rows = {2024: [
            nat,
            partd_row(code="34", desc="New Jersey", brand="Elmiron", generic="Pentosan Polysulfate Sodium", claims="300"),
            partd_row(code="36", desc="New York", brand="Elmiron", generic="Pentosan Polysulfate Sodium", claims="300"),
            partd_row(code="06", desc="California", brand="Elmiron", generic="Pentosan Polysulfate Sodium", claims="100"),
            partd_row(code="72", desc="Puerto Rico", brand="Elmiron", generic="Pentosan Polysulfate Sodium", claims="900"),
        ]}
        groups, _ = P.collect(rows, [self.entries["2973"]])
        recs = {r["id"]: r["item"]["exposure"] for r in P.build_records(groups, [2024])}
        self.assertEqual(recs["partd:2973:NJ"]["latest_rank"]["rank"], 1)
        self.assertEqual(recs["partd:2973:NY"]["latest_rank"]["rank"], 1)  # ties share a rank
        self.assertEqual(recs["partd:2973:CA"]["latest_rank"], {"year": 2024, "rank": 3, "of": 3, "measure": "claims", "share_of_national": 0.1})
        self.assertIsNone(recs["partd:2973:PR"]["latest_rank"])  # territories are not ranked
        self.assertIsNone(recs["partd:2973:US"]["latest_rank"])


def places_row(loc="34023", usps="NJ", mid="DIABETES", kind="CrdPrv", value="11.2", lo="10.1", hi="12.3"):
    return {"year": "2023", "stateabbr": usps, "statedesc": "New Jersey", "locationname": "Middlesex", "locationid": loc, "datasource": "BRFSS",
            "category": "Health Outcomes", "measure": "Diagnosed diabetes among adults", "measureid": mid, "data_value_unit": "%",
            "datavaluetypeid": kind, "data_value": value, "low_confidence_limit": lo, "high_confidence_limit": hi,
            "totalpopulation": "863162", "totalpop18plus": "670000"}


class PlacesTests(unittest.TestCase):
    def test_keeps_intervals_and_blank_values_stay_none(self):
        rows = [places_row(), places_row(kind="AgeAdjPrv", value="", lo="", hi=""), places_row(mid="ARTHRITIS"), places_row(loc="59", usps="US")]
        bodies = PL.collect(rows, {"DIABETES"})
        self.assertEqual(set(bodies), {"34023", "US"})
        m = bodies["34023"]["measures"]["DIABETES"]
        self.assertEqual(m["crude"], {"v": 11.2, "lo": 10.1, "hi": 12.3})
        self.assertIsNone(m["age_adjusted"]["v"])
        self.assertNotIn("ARTHRITIS", bodies["34023"]["measures"])

    def test_every_row_carries_county_geoids_and_unreviewed_links_are_dropped(self):
        mapping = X.load_map()
        bodies = PL.collect([places_row(), places_row(mid="HEARING"), places_row(loc="59", usps="US")], {"DIABETES", "HEARING"})
        recs = PL.build_records(bodies, mapping)
        self.assertEqual([r["county_geoids"] for r in recs], [[], ["34023"]])
        links = recs[1]["item"]["exposure"]["mdl_links"]
        self.assertEqual(links["HEARING"], [])
        self.assertIn("3094", links["DIABETES"][0]["mdls"])


def ucmr_row(pwsid="NJ1225001", contaminant="PFOA", sign="=", value="0.0042", state="NJ", sample="S1", date="3/14/2024"):
    return {"PWSID": pwsid, "PWSName": "Example Water", "Size": "L", "State": state, "Contaminant": contaminant, "MRL": "0.004",
            "AnalyticalResultsSign": sign, "AnalyticalResultValue": value, "SampleID": sample, "CollectionDate": date}


class UcmrTests(unittest.TestCase):
    def test_detections_non_detects_and_lithium(self):
        systems = U.aggregate([
            ucmr_row(),
            ucmr_row(contaminant="PFOS", sign="<", value=""),
            ucmr_row(contaminant="lithium", value="12"),
            ucmr_row(contaminant="PFOA", value="0.0031", sample="S2", date="9/1/2024"),
        ])
        s = systems["NJ1225001"]
        self.assertNotIn("lithium", s["analytes"])
        self.assertEqual(s["analytes"]["PFOA"]["max_ngl"], Decimal("4.2000"))
        self.assertEqual(s["analytes"]["PFOS"]["detects"], 0)
        self.assertIsNone(s["analytes"]["PFOS"]["max_ngl"])
        self.assertEqual((s["first"], s["last"]), ("2024-03-14", "2024-09-01"))

    def test_views_flag_threshold_and_keep_unknown_population_none(self):
        systems = U.aggregate([ucmr_row(), ucmr_row(pwsid="NJ0000002", value="0.0039"), ucmr_row(pwsid="NJ0000003", sign="<", value="")])
        sdwis = {"NJ1225001": {"population": 50000, "type": "CWS", "activity": "A"}}
        views = {v["pwsid"]: v for v in (U.system_view(s, {"NJ1225001": ["08817"]}, {}, sdwis) for s in systems.values())}
        self.assertEqual(views["NJ1225001"]["pfoa_pfos_at_or_above_4"], ["PFOA"])
        self.assertEqual(views["NJ0000002"]["pfoa_pfos_at_or_above_4"], [])
        self.assertIsNone(views["NJ0000002"]["population_served"])
        self.assertEqual(views["NJ1225001"]["pfoa_max_ngl"], 4.2)
        self.assertFalse(views["NJ0000003"]["any_detect"])
        st = U.state_view("NJ", list(views.values()))
        self.assertEqual((st["systems_sampled"], st["systems_with_detect"], st["systems_pfoa_pfos_at_or_above_4"]), (3, 2, 1))
        self.assertEqual(st["population_with_detect"], {"sum": 50000, "systems_with_population": 1, "systems_without_population": 1})

    def test_records_name_tribal_agencies_and_national_first(self):
        systems = U.aggregate([ucmr_row(), ucmr_row(pwsid="090000001", state="09")])
        views = [U.system_view(s, {}, {}, {}) for s in systems.values()]
        mdl = X.load_map()["ucmr5"]
        recs = U.state_records(views, mdl)
        self.assertEqual(recs[0]["id"], "ucmr5:state:US")
        tribal = next(r for r in recs if r["id"] == "ucmr5:state:09")
        self.assertEqual(tribal["item"]["exposure"]["agency_name"], "Tribal systems, EPA Region 9")
        self.assertEqual(tribal["state"], "")

    def test_reported_sources_prefers_yes(self):
        rows = [{"PWSID": "A", "AdditionalDataElement": "PotentialPFASSources", "Response": "No"},
                {"PWSID": "A", "AdditionalDataElement": "PotentialPFASSources", "Response": "Yes"},
                {"PWSID": "B", "AdditionalDataElement": "PFASOccurrence", "Response": "Yes"}]
        self.assertEqual(U.reported_sources(rows), {"A": "Yes"})


class PacketTests(unittest.TestCase):
    def test_packet_round_trip_and_tamper_check(self):
        rows = [X.record("exposure_test", "a", "A", source_url="https://example.gov", cells={}, facts=[], text="", filters={})]
        with tempfile.TemporaryDirectory() as tmp:
            out = X.write_packet(tmp, "exposure_test", "Test", rows, listing_block=X.listing([("a", "A")]), summary={})
            meta, back, manifest = X.read_packet(out)
            self.assertEqual(back, rows)
            self.assertEqual(manifest["records"], 1)
            with open(os.path.join(out, "records.jsonl"), "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rows[0]) + "\n")
            with self.assertRaises(ValueError):
                X.read_packet(out)

    def test_duplicate_ids_are_refused(self):
        row = X.record("exposure_test", "a", "A", source_url="https://example.gov", cells={}, facts=[], text="", filters={})
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
            X.write_packet(tmp, "exposure_test", "Test", [row, row], listing_block={}, summary={})


if __name__ == "__main__":
    unittest.main()
