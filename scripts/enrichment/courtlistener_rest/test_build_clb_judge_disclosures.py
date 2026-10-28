"""Offline test of build_clb_judge_disclosures.build() on synthetic tables (no DuckDB files, no network).

The builder's DuckDB connections are replaced by an in-memory SQLite stand-in (TRY_CAST rewritten to CAST), so the whole build path
runs: redacted lines keep CourtListener's text, unreadable report file names are listed with attribution 'not_checked', reports whose
file name carries another surname and conflict persons stay out, and reimbursements are not capped.

    cd scripts/enrichment/courtlistener_rest && python3 -B -m unittest -v test_build_clb_judge_disclosures
"""
import importlib
import os
import re
import sqlite3
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

AO = "https://x/financial-disclosures/2017/"
SCHEMA = f"""
create table courts(id, full_name); insert into courts values ('ca5','Fifth Circuit'),('wawd','W.D. Wash.');
create table person(id, name_first, name_middle, name_last, name_suffix);
insert into person values ('1','Robert',null,'King',null),('2','Ann',null,'Jones',null),('3','Carl',null,'Smith',null),
 ('4','Dana',null,'Lee',null),('5','Eli',null,'Park',null);
create table position(person_id, court_id, date_start, position_type);
insert into position values ('5','wawd','2001-01-01','jud');
create table fd(id, person_id, year, report_type, is_amended, page_count, has_been_extracted);
insert into fd values ('10','1','2017','1','f','5','t'),('11','1','2018','1','f','5','t'),('12','1','2019','1','f','5','t'),
 ('20','2','2017','1','f','5','t'),('21','2','2018','1','f','5','t'),('30','3','2017','1','f','5','t'),
 ('40','4','2017','1','f','5','t'),('41','4','2018','1','f','5','t'),
 ('50','5','2017','1','f','5','t'),('51','5','2018','1','f','5','t'),('52','5','2019','1','f','5','t');
create table fd_file(id, filepath, download_filepath);
insert into fd_file values (10,'us/federal/judicial/financial-disclosures/1/a.pdf','{AO}King-RB.%20B.%2005.%20TXW_R_17.tiff'),
 (11,null,null),(12,null,'{AO}Brown-RB.%20B.%2005.%20TXW_R_17.tiff'),
 (20,null,'{AO}Jones-AB.%20J3.%2002.%20NYS_R_17.tiff'),(21,null,'{AO}Jones-AB.%20J3.%2003.%20PAE_R_17.tiff'),(30,null,null),
 (40,null,'{AO}Lee-DA.%20J3.%2009.%20WAW_R_17.tiff'),(41,null,'{AO}Lee-DA.%20J3.%2003.%20WAW_R_18.tiff'),
 (50,null,'{AO}Park-E.%20J3.%2009.%20WAW_R_17.tiff'),(51,null,'{AO}Park-E.%20J3.%2009.%20WAW_R_18.tiff'),(52,null,'{AO}Park-E.%20B.%2005.%20TXW_R_19.tiff');
create table fd_gift(id, financial_disclosure_id, source, description, value, redacted);
insert into fd_gift values (1,'10','HEE TRUST','CASH','$14,000.00','t'),(2,'11','Bar Assn','Book','$50','f'),(3,'12','Other','Pen','$5','f'),
 (4,'20','A','B','C','f'),(5,'30','S','D','V','f'),(6,'40','L1','x','1','f'),(7,'41','L2','y','2','f'),
 (8,'50','P1','x','1','f'),(9,'51','P2','y','2','f'),(10,'52','P3','z','3','f');
create table fd_reimbursement(id, financial_disclosure_id, source, date_raw, location, purpose, items_paid_or_provided, redacted);
create table fd_agreement(id, financial_disclosure_id, date_raw, parties_and_terms, redacted);
insert into fd_agreement values (1,'21','2002','Pension','t');
create table fd_investment(id, financial_disclosure_id, redacted); create table fd_position(id, financial_disclosure_id, redacted);
create table fd_debt(id, financial_disclosure_id, redacted); create table fd_non_investment_income(id, financial_disclosure_id, redacted);
create table fd_spousal_income(id, financial_disclosure_id, redacted);
"""


class _Conn:
    def __init__(self, db):
        self.db = db

    def execute(self, sql):
        return self.db.execute(re.sub(r"TRY_CAST\((\w+) AS (\w+)\)", r"CAST(\1 AS \2)", sql))


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db = sqlite3.connect(":memory:")
        db.executescript(SCHEMA)
        db.executemany("insert into fd_reimbursement values (?, '10', 'Univ', 'May', 'NY', 'Teach', 'travel', 'f')", [(100 + i,) for i in range(300)])
        fake = types.ModuleType("duckdb")
        fake.connect = lambda *a, **k: _Conn(db)
        saved = sys.modules.get("duckdb")
        sys.modules["duckdb"] = fake
        try:
            import rest_common as rc
            saved_ids = (rc.spine_ids, rc.published_ids)
            rc.spine_ids = lambda: set()
            rc.published_ids = lambda ds: set()
            sys.modules.pop("build_clb_judge_disclosures", None)
            b = importlib.import_module("build_clb_judge_disclosures")
            cls.spec = b.build()["clb_judge_disclosures"]
            rc.spine_ids, rc.published_ids = saved_ids
        finally:
            sys.modules.pop("build_clb_judge_disclosures", None)
            if saved is None:
                sys.modules.pop("duckdb", None)
            else:
                sys.modules["duckdb"] = saved
        cls.rows = {r["id"]: r["item"]["profile"] for r in cls.spec["rows"]}

    def test_redacted_keeps_text_and_unchecked_is_listed_with_label(self):
        p = self.rows["1"]
        self.assertEqual([(g["report_id"], g["attribution"], g["redacted"], g["source"]) for g in p["gifts"]],
                         [(11, "not_checked", False, "Bar Assn"), (10, "checked", True, "HEE TRUST")])
        self.assertEqual(p["items_listed_attribution_not_checked"], {"gifts": 1, "reimbursements": 0, "agreements": 0})

    def test_mismatch_withheld_with_reason(self):
        p = self.rows["1"]
        self.assertEqual(p["items_withheld"], {"gifts": 1, "reimbursements": 0, "agreements": 0})
        self.assertEqual(p["items_withheld_by_reason"]["other_surname"]["gifts"], 1)

    def test_no_reimbursement_cap(self):
        p = self.rows["1"]
        self.assertEqual((p["reimbursements_listed"], len(p["reimbursements"]), p["items_total"]["reimbursements"]), (300, 300, 300))

    def test_conflict_lists_nothing(self):
        p = self.rows["2"]
        self.assertEqual(p["attribution"]["status"], "conflict")
        self.assertEqual((p["gifts"], p["agreements"]), ([], []))
        self.assertEqual(p["items_withheld_by_reason"]["attribution_conflict"], {"gifts": 1, "reimbursements": 0, "agreements": 1})

    def test_circuit_digit_only_differs_inside_one_district(self):
        p = self.rows["4"]
        self.assertEqual((p["attribution"]["status"], p["attribution"]["conflict_resolution"]), ("consistent", "same_district"))
        self.assertEqual(sorted(g["report_id"] for g in p["gifts"]), [40, 41])
        self.assertEqual(p["items_withheld"], {"gifts": 0, "reimbursements": 0, "agreements": 0})
        self.assertTrue(all(x["conflict_hold"] is None for x in p["report_list"]))

    def test_conflict_resolved_by_the_recorded_court(self):
        p = self.rows["5"]
        self.assertEqual((p["attribution"]["status"], p["attribution"]["conflict_resolution"], p["attribution"]["conflict_district"]),
                         ("conflict", "recorded_court", "WAW"))
        self.assertEqual(sorted(g["report_id"] for g in p["gifts"]), [50, 51])
        self.assertEqual(p["items_withheld_by_reason"]["attribution_conflict"], {"gifts": 1, "reimbursements": 0, "agreements": 0})
        self.assertEqual({x["id"]: x["conflict_hold"] for x in p["report_list"]}, {50: False, 51: False, 52: True})

    def test_person_with_only_unreadable_file_names(self):
        p = self.rows["3"]
        self.assertEqual(p["attribution"]["status"], "unchecked")
        self.assertEqual([g["attribution"] for g in p["gifts"]], ["not_checked"])

    def test_listed_plus_withheld_is_total_and_summary(self):
        for p in self.rows.values():
            for k in ("gifts", "reimbursements", "agreements"):
                self.assertEqual(len(p[k]) + p["items_withheld"][k], p["items_total"][k])
        t = self.spec["summary"]["totals"]
        self.assertEqual(t["items_withheld"], {"gifts": 3, "reimbursements": 0, "agreements": 1})
        self.assertEqual((t["people_with_attribution_conflict"], t["people_with_circuit_code_variance_only"]), (2, 1))
        self.assertEqual(t["items_listed_attribution_not_checked"]["gifts"], 2)
        badges = {r["id"]: r["item"]["badges"] for r in self.spec["rows"]}
        self.assertIn("Some items: attribution not checked", badges["3"])
        self.assertNotIn("Reimbursements are listed up to", " ".join(self.spec["summary"]["caveats"]))


    def test_publish_tally_guards_the_rule(self):
        import copy

        import publish_judge_disclosures as pj
        t = pj.tally(self.spec["rows"])
        self.assertEqual((t["withheld_total"], t["withheld_other_surname"], t["withheld_conflict"], t["listed_from_mismatch_or_conflict"]), (4, 1, 3, 0))
        self.assertEqual((t["listed_redacted"], t["listed_not_checked"]), (1, 2))
        bad = copy.deepcopy(self.spec["rows"])
        p = next(r for r in bad if r["id"] == "1")["item"]["profile"]
        p["gifts"].append({"year": 2019, "report_id": 12, "redacted": False, "attribution": "checked"})  # report 12: another surname
        self.assertEqual(pj.tally(bad)["listed_from_mismatch_or_conflict"], 1)
        bad = copy.deepcopy(self.spec["rows"])
        p = next(r for r in bad if r["id"] == "5")["item"]["profile"]
        p["gifts"].append({"year": 2019, "report_id": 52, "redacted": False, "attribution": "checked"})  # report 52: held for the conflict
        self.assertEqual(pj.tally(bad)["listed_from_mismatch_or_conflict"], 1)


if __name__ == "__main__":
    unittest.main()
