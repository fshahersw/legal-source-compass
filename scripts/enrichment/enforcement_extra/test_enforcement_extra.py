"""Offline unit tests for the enforcement_extra parsers and aggregations (synthetic fixtures, no network).

  cd scripts/enrichment/enforcement_extra && python3 -B -m unittest -v test_enforcement_extra
"""
import io
import json
import os
import tempfile
import unittest

import common
import eousa
import exclusions as ex
import fsis
import fsis_qer
import ussc
from build_fsis import class_of, number_year_of
from ussc_codes import RANGE_SCHEMES, year_spec


def sam_row(**kw):
    base = {k: "" for k in ("Classification", "Name", "Prefix", "First", "Middle", "Last", "Suffix", "Address 1", "Address 2",
                            "Address 3", "Address 4", "City", "State / Province", "Country", "Zip Code", "Unique Entity ID",
                            "Exclusion Program", "Excluding Agency", "CT Code", "Exclusion Type", "Additional Comments",
                            "Active Date", "Termination Date", "Record Status", "Cross-Reference", "SAM Number", "CAGE", "NPI",
                            "Creation_Date")}
    base.update({"SAM Number": "46f774dc-79c1-4a03-b480-21a39b3069c8", "Classification": "Individual", "Country": "USA"})
    base.update(kw)
    return base


class SamTests(unittest.TestCase):
    def test_individual_name_and_prefix_rules(self):
        self.assertEqual(ex.sam_display_name(sam_row(Prefix="Dr.", First="Ariel", Last="Fernandez")), ("Dr. Ariel Fernandez", False))
        self.assertEqual(ex.sam_display_name(sam_row(Prefix="#09594-510", First="Simone", Middle="Courtney", Last="Gueringer")),
                         ("Simone Courtney Gueringer", True))
        self.assertEqual(ex.sam_display_name(sam_row(Classification="Firm", Name="0DAY TECHNOLOGIES")), ("0DAY TECHNOLOGIES", False))

    def test_fields_dates_and_privacy(self):
        f = ex.sam_record_fields(sam_row(First="A", Last="B", City="HONOLULU, HI 96819", **{"State / Province": "HI"},
                                         **{"Active Date": "2024-10-09", "Termination Date": "2220-09-17", "NPI": "0000000000"}))
        self.assertEqual(f["active"], "2024-10-09")
        self.assertEqual(f["termination"], "2220-09-17")  # kept as published
        self.assertEqual(f["city"], "HONOLULU, HI")
        self.assertTrue(f["city_zip_removed"])
        self.assertEqual(f["npi"], "")
        self.assertEqual(f["usps"], "HI")
        self.assertEqual(ex.sam_record_fields(sam_row(**{"Termination Date": "Indefinite", "First": "X"}))["termination"], "Indefinite")
        self.assertIsNone(ex.sam_record_fields(sam_row(**{"SAM Number": "not-a-uuid", "First": "X"})))
        self.assertIsNone(ex.iso_date("2024-13-01"))
        self.assertIsNone(ex.iso_date("0"))

    def test_comment_withheld_for_individual_facility_address(self):
        c = "INELIGIBLE FOR AWARDS TO BE PERFORMED AT THIS FACILITY ONLY: 3308 Briarwood Rd., Umpqua, OR 97486-9733"
        f = ex.sam_record_fields(sam_row(First="D", Last="V", **{"Additional Comments": c, "Zip Code": "97486"}))
        self.assertTrue(f["comment_withheld"])
        self.assertEqual(f["comments"], ex.COMMENT_WITHHELD)
        firm = ex.sam_record_fields(sam_row(Classification="Firm", Name="Amvest Energy, Inc.", **{"Additional Comments": c}))
        self.assertFalse(firm["comment_withheld"])
        self.assertEqual(firm["comments"], c)

    def test_company_match_exact_unique_only(self):
        index = ex.company_index([["0000078003", "PFIZER INC"], ["0000000001", "ACME CO"], ["0000000002", "Acme Co."], ["bad", "X"]])
        self.assertEqual(ex.match_company("Pfizer, Inc.", index), ("0000078003", "matched"))
        self.assertEqual(ex.match_company("ACME CO", index), (None, "ambiguous"))
        self.assertEqual(ex.match_company("Pfizer Corporation", index), (None, "none"))
        self.assertNotEqual(ex.company_key("BP PLC"), ex.company_key("BP LLC"))


class LeieTests(unittest.TestCase):
    ROW = {"LASTNAME": "AKINS", "FIRSTNAME": "DANIEL", "MIDNAME": "LEE", "BUSNAME": "", "GENERAL": "PHYSICIAN (MD, DO)",
           "SPECIALTY": "GENERAL PRACTICE", "UPIN": "", "NPI": "1942203880", "DOB": "19600101", "ADDRESS": "1 MAIN ST",
           "CITY": "CLEARWATER", "STATE": "FL", "ZIP": "33755", "EXCLTYPE": "1128b4", "EXCLDATE": "20140720", "REINDATE": "0",
           "WAIVERDATE": "0", "WVRSTATE": ""}

    def test_fields_and_authority(self):
        f = ex.leie_record_fields(self.ROW)
        self.assertEqual(f["name"], "AKINS, DANIEL LEE")
        self.assertEqual(f["kind"], "Individual")
        self.assertEqual((f["ssa_section"], f["usc"]), ("1128(b)(4)", "42 U.S.C. 1320a-7(b)(4)"))
        self.assertEqual(f["excluded"], "2014-07-20")
        self.assertIsNone(f["reinstated"])
        self.assertNotIn("DOB", json.dumps(f))
        self.assertNotIn("19600101", json.dumps(f))
        self.assertNotIn("1 MAIN ST", json.dumps(f))

    def test_unknown_code_and_entity(self):
        f = ex.leie_record_fields({**self.ROW, "LASTNAME": "", "FIRSTNAME": "", "MIDNAME": "", "BUSNAME": "#1 MARKETING SERVICE, INC", "EXCLTYPE": "BRCH SA"})
        self.assertEqual(f["kind"], "Entity")
        self.assertIsNone(f["ssa_section"])
        self.assertEqual(f["code"], "BRCH SA")

    def test_key_ignores_dob_and_address(self):
        a = ex.leie_key(ex.leie_record_fields(self.ROW))
        b = ex.leie_key(ex.leie_record_fields({**self.ROW, "DOB": "19700202", "ADDRESS": "9 ELM ST"}))
        self.assertEqual(a, b)


class UsscTests(unittest.TestCase):
    SAS = """LENGTH DISTRICT 3 SENTTOT 8;
INPUT
   zone $ 1                 DISTRICT  3-4   SENTTOT  5-10
   sentimp  11   STATMIN 12-15 OFFTYPE2 16-17 DEPART 18 SENSPLT0 19-24 ;
LABEL DISTRICT='x';"""

    def test_sas_positions_input_block_only_and_case_insensitive(self):
        pos = ussc.sas_positions(self.SAS, ["DISTRICT", "SENTTOT", "SENTIMP", "STATMIN", "MISSING"])
        self.assertEqual(pos, {"DISTRICT": (3, 4), "SENTTOT": (5, 10), "SENTIMP": (11, 11), "STATMIN": (12, 15)})

    def test_year_spec(self):
        self.assertEqual(year_spec(2025)["offense"], "OFFGUIDE")
        self.assertEqual(year_spec(2012)["range"], "BOOKERCD")
        self.assertEqual(year_spec(2003, {"DEPART"})["range"], "DEPART")
        self.assertEqual(year_spec(2004, {"DEPART_A", "DEPART"})["range"], "DEPART_A")
        self.assertEqual(year_spec(2010)["prison"], "SENTTOT")

    def test_aggregate_math(self):
        spec = year_spec(2025)
        recs = [
            {"DISTRICT": "41", "OFFGUIDE": "17", "SENTIMP": "1", "SENTTCAP": "6", "SENSPCAP": "6", "SENTRNGE": "0", "STATMIN": "0"},
            {"DISTRICT": "41", "OFFGUIDE": "17", "SENTIMP": "1", "SENTTCAP": "12", "SENSPCAP": "12", "SENTRNGE": "8", "STATMIN": "0"},
            {"DISTRICT": "41", "OFFGUIDE": "10", "SENTIMP": "1", "SENTTCAP": "999", "SENSPCAP": "470", "SENTRNGE": "6", "STATMIN": "120"},
            {"DISTRICT": "41", "OFFGUIDE": "10", "SENTIMP": "4", "SENTTCAP": "", "SENSPCAP": "0", "SENTRNGE": "2", "STATMIN": "."},
            {"DISTRICT": "99", "OFFGUIDE": "10", "SENTIMP": "4", "SENTTCAP": "", "SENSPCAP": "0", "SENTRNGE": "", "STATMIN": "0"},
        ]
        agg = ussc.aggregate(recs, spec)
        self.assertEqual(agg["records"], 5)
        self.assertEqual(agg["unknown_district"], 1)
        t = ussc.summarize_unit(agg["districts"][41], spec["offense"])["total"]
        self.assertEqual(t["cases"], 4)
        self.assertEqual(t["prison_n"], 3)
        self.assertEqual(t["prison_median"], 12.0)
        self.assertEqual(t["prison_mean"], round((6 + 12 + 470) / 3, 2))  # capped at 470
        self.assertEqual(t["sentence_median"], 9.0)  # 0, 6, 12, 470
        self.assertEqual((t["within"], t["above"], t["below_gov"], t["below_other"]), (1, 1, 1, 1))
        self.assertEqual(t["within_pct"], 25.0)
        self.assertEqual((t["mm_valid"], t["mm_yes"], t["mm_pct"]), (3, 1, 33.3))
        self.assertEqual(t["sentence_types"], {"1": 3, "4": 1})
        n = ussc.summarize_unit(agg["national"], spec["offense"])["total"]
        self.assertEqual(n["cases"], 5)
        offs = {o["label"]: o["cases"] for o in ussc.summarize_unit(agg["districts"][41], spec["offense"])["offenses"]}
        self.assertEqual(offs, {"Immigration": 2, "Drug Trafficking": 2})

    def test_range_schemes_cover_codebook_codes(self):
        self.assertEqual(sorted(RANGE_SCHEMES["SENTRNGE"]), list(range(9)))
        self.assertEqual(sorted(RANGE_SCHEMES["BOOKERCD"]), list(range(12)))
        self.assertIsNone(RANGE_SCHEMES["DEPART"][8])

    def test_empty_cells_are_not_recorded(self):
        t = ussc.summarize_cell(ussc._empty_cell())
        self.assertIsNone(t["prison_median"])
        self.assertIsNone(t["within_pct"])
        self.assertIsNone(t["mm_pct"])


TEASER = """<section class="recall-teaser"><div class="recall-teaser__grid"><div class="recall-teaser__left">
<div class="recall-teaser__tags"><span class="tag tag--active">016-2026</span>
<a class="tag tag--high - class i" href="https://www.fsis.usda.gov/taxonomy/term/9">High - Class I</a>
<a class="tag tag--reason" href="https://www.fsis.usda.gov/taxonomy/term/19">Import Violation</a></div>
<h3 class="recall-teaser__title"><a href="https://www.fsis.usda.gov/recalls-alerts/x-recalls-fish">X Inc. Recalls Fish &amp; Chips</a></h3>
<span class="recall-teaser__establishment"><a href="https://www.fsis.usda.gov/inspection/fsis-inspected-establishments/x" hreflang="en">X Inc./</a></span>
</div><div class="recall-teaser__right"><div class="recall-teaser__status"><span class="tag tag--closed">Closed</span></div>
<div class="recall-teaser__date">Mon, 08/17/2026 - Fri, 09/11/2026</div><div class="recall-teaser__states">California, Nationwide</div></div></div>
<div class="recall-teaser__summary"><p>WASHINGTON – X Inc. is recalling approximately 1,996 pounds of fish skin...</p></div>
<div class="recall-teaser__products"><h5>Impacted Products</h5><span>50-g bags</span></div>
<div class="recall-teaser__products"><h5>Quantity Recovered</h5>439 lbs</div></section>"""


class FsisTests(unittest.TestCase):
    def test_parse_teaser(self):
        it = fsis.parse_listing(TEASER)[0]
        self.assertEqual(it["number"], "016-2026")
        self.assertEqual(it["risk"], "High - Class I")
        self.assertEqual(it["reasons"], ["Import Violation"])
        self.assertEqual(it["title"], "X Inc. Recalls Fish & Chips")
        self.assertEqual(it["establishments"][0]["name"], "X Inc.")
        self.assertEqual((it["start"], it["end"], it["current"]), ("2026-08-17", "2026-09-11", False))
        self.assertEqual(it["pounds"], 1996.0)
        self.assertEqual(it["pounds_evidence"], "recalling approximately 1,996 pounds")
        self.assertEqual(it["recovered"], "439 lbs")
        self.assertEqual(fsis.usps_codes(it["states"]), ["CA"])

    def test_no_pounds_is_not_recorded(self):
        self.assertEqual(fsis.pounds_from("FSIS is issuing a public health alert"), (None, None))

    def test_current_dates_and_classes(self):
        self.assertEqual(fsis.parse_dates("Sat, 08/08/2026 - Current"), ("2026-08-08", None, True))
        self.assertEqual(class_of("Marginal - Class III"), "III")
        self.assertEqual(class_of("Public Health Alert"), "PHA")
        self.assertEqual(number_year_of("019-020-2026"), "2026")
        self.assertEqual(number_year_of("027-2016 EXP"), "2016")
        self.assertIsNone(number_year_of("PHA-10062026-01"))

    def test_qer_tables_keep_quotes(self):
        md = "**Table 1. Verification Procedures Performed**\n\n| Quarter | Procedures | NRs | Rate |\n| --- | --- | --- | --- |\n" \
             "| First Quarter (Oct – Dec 2025) | 1,986,516 | 20,690 | 99.0% |\n| Fourth Quarter (Jul – Sep 2026) |  |  |  |\n" \
             "| TOTAL | 5,878,007 | 66,628 |  |\n\n**Table 8. Administrative Actions: Large Establishments**\n\n| Name | Action |\n| --- | --- |\n| ACME | Suspension |\n"
        tables, skipped = fsis_qer.parse_tables(md)
        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]["rows"][0]["values"], [1986516, 20690, 99.0])
        self.assertEqual(tables[0]["rows"][1]["label"], "TOTAL")
        self.assertIn(tables[0]["rows"][0]["quote"], md)
        self.assertEqual(skipped, ["Table 8. Administrative Actions: Large Establishments"])


class EousaTests(unittest.TestCase):
    def test_rows_rejoin_split_charge(self):
        text = "FISCAL_YEAR,LEAD_CHARGE,PROGRAM_CATEGORY,A_COUNT,B_COUNT\n2025,08 :01326a, b2,055,NULL,1\n2025,18 :00922,040,2,NULL\n"
        rows = [r for _, r in eousa.read_rows(io.StringIO(text), 1, 3)]
        self.assertEqual(rows[0], ["2025", "08 :01326a, b2", "055", "NULL", "1"])
        self.assertEqual(eousa.count("NULL"), 0)

    def test_court_ids(self):
        known = {"txsd", "akd", "nmid", "dcd", "lamd"}
        self.assertEqual(eousa.court_id_for("TXS", known), "txsd")
        self.assertEqual(eousa.court_id_for("AK", known), "akd")
        self.assertEqual(eousa.court_id_for("LAM", known), "lamd")
        self.assertIsNone(eousa.court_id_for("ZZX", known))

    def test_code_tables_and_titles(self):
        g = "GS_PROG_CAT\n \nCode Description                Status MasterCode\n---- -------------------------- ------ ----------\n" \
            "055  Violations of the INA      A      IMMI      \n06G  Money Laundering (Other)   A      GOVE\n \nGS_X\n"
        t = eousa.code_tables(g)["GS_PROG_CAT"]
        self.assertEqual(t["055"]["description"], "Violations of the INA")
        self.assertEqual(t["06G"]["master"], "GOVE")
        self.assertEqual(eousa.charge_title("18 :00922g1"), "18")
        self.assertIsNone(eousa.charge_title("05S:5-64-443a1"))


class BuildFileTests(unittest.TestCase):
    def test_stream_rows_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            old = common.BUILD
            common.BUILD = d
            try:
                rows = [{"id": f"r{i}", "text": "x" * (i * 50)} for i in range(200)]
                path = common.write_build("t_ds", "T", rows, {"columns": []}, {"s": 1}, [])
                self.assertEqual(list(common.iter_build_rows(path, chunk=4096)), rows)
                self.assertEqual(common.read_build_meta(path)["dataset"], "t_ds")
            finally:
                common.BUILD = old

    def test_facts_and_compact(self):
        self.assertEqual(common.facts_pairs([("A", None)], [("B", ""), ("C", "x")]), [["A", "Not recorded"], ["C", "x"]])
        self.assertEqual(common.compact({"a": None, "b": "", "c": 0}), {"c": 0})


if __name__ == "__main__":
    unittest.main()
