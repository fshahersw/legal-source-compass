"""Offline unit tests for the judiciary stream (codebook decoding, aggregation rules, exact-key matching, Not-recorded paths).

  cd scripts/enrichment/judiciary && python3 -B -m unittest -v test_judiciary
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import build_appeals as ba  # noqa: E402
import build_bankruptcy as bb  # noqa: E402
import build_criminal as bc  # noqa: E402
import build_judge_profiles as bjp  # noqa: E402
import extract_idb as ex  # noqa: E402
import idb_common as ic  # noqa: E402
import jcodes as jc  # noqa: E402

DISTRICT_FIXTURE = """
DISTRICT
(DISTRICT)

00 - Maine                       47 - Ohio - Northern
08 - New York - Southern         3A - Florida - Middle
7- - Alaska                      90 - District of Columbia
44 - Kentucky – Western

-8 = Missing data

OFFICE
(OFFICE)
"""

APPENDIX_FIXTURE = """
                              Appendix A
NATURE OF SUIT CODES

CODE   DESCRIPTION
110    INSURANCE
365    PERSONAL INJURY -PRODUCT LIABILITY
                             Appendix B
CRIMINAL OFFENSE CODES

CODE       DESCRIPTION
6801       CONTROLLED SUB-SELL,DISTRIBUTE,OR D
8720   IMMIGRATION LAWS, ILLIGAL RE-ENTRY
9400   FOOD & DRUG ACT
4601   BANK FRAUD
9999   FEDERAL STATUTES, OTHER
                              Appendix C
DISTRICT CODES
"""


class Codebooks(unittest.TestCase):
    def test_district_parse_matches_table(self):
        parsed = jc.parse_districts(DISTRICT_FIXTURE)
        self.assertEqual(parsed, {"00": "Maine", "47": "Ohio - Northern", "08": "New York - Southern", "3A": "Florida - Middle",
                                  "7-": "Alaska", "90": "District of Columbia", "44": "Kentucky - Western"})
        for code, label in parsed.items():
            self.assertEqual(jc.DISTRICTS[code], label)

    def test_full_codebook_district_table(self):
        path = Path("/home/user/legal-source-compass/private/build/judiciary/criminal_codebook.txt")
        if not path.exists():
            self.skipTest("codebook text not present")
        self.assertEqual(jc.parse_districts(path.read_text()), jc.DISTRICTS)

    def test_court_ids(self):
        self.assertEqual(jc.district_court_id("08"), "nysd")
        self.assertEqual(jc.district_court_id("3A"), "flmd")
        self.assertEqual(jc.district_court_id("7-"), "akd")
        self.assertEqual(jc.district_court_id("90"), "dcd")
        self.assertEqual(jc.district_court_id("94"), "nmid")
        self.assertIsNone(jc.district_court_id("-8"))
        self.assertIsNone(jc.district_court_id("21"))  # unused code in the list
        self.assertEqual(jc.circuit_id("0"), "cadc")
        self.assertEqual(jc.circuit_id("09"), "ca9")
        self.assertIsNone(jc.circuit_id("13"))

    def test_bankruptcy_court_ids_exceptions(self):
        self.assertEqual(jc.bankruptcy_court_id("nysd"), "nysb")
        self.assertEqual(jc.bankruptcy_court_id("azd"), "arb")  # Arizona, not Arkansas
        self.assertEqual(jc.bankruptcy_court_id("ned"), "nebraskab")  # 'neb' is the Nebraska Supreme Court
        self.assertIsNone(jc.bankruptcy_court_id("ca9"))

    def test_appendices(self):
        nos = jc.parse_nos(APPENDIX_FIXTURE)
        self.assertEqual(nos, {110: "INSURANCE", 365: "PERSONAL INJURY -PRODUCT LIABILITY"})
        off = jc.parse_offenses(APPENDIX_FIXTURE)
        self.assertEqual(off["8720"], "IMMIGRATION LAWS, ILLIGAL RE-ENTRY")
        self.assertNotIn("110", off)

    def test_offense_groups(self):
        off = jc.parse_offenses(APPENDIX_FIXTURE)
        self.assertEqual(jc.offense_group("6801", off), "drugs")
        self.assertEqual(jc.offense_group("8720", off), "immigration")
        self.assertEqual(jc.offense_group("4601", off), "fraud")
        self.assertEqual(jc.offense_group("9400", off), "regulatory_other")  # exception: FOOD & DRUG ACT is not a drug offense
        self.assertEqual(jc.offense_group("9999", off), "regulatory_other")
        self.assertEqual(jc.offense_group("1234", off), "not_in_codebook")
        self.assertEqual(jc.offense_group("-8", off), "not_recorded")
        self.assertEqual(jc.offense_group("", off), "not_recorded")

    def test_chapter_code_sets(self):
        self.assertEqual(jc.chapter("7", "2010-01-01"), "7")
        self.assertEqual(jc.chapter("7", "2001-01-01"), "13")  # code 7 meant chapter 13 before Oct 17, 2005
        self.assertEqual(jc.chapter("5", "old"), "11")
        self.assertEqual(jc.chapter("15m", "new"), "15")
        self.assertEqual(jc.chapter("", "new"), "not_recorded")
        self.assertEqual(jc.chapter("99", "new"), "not_in_codebook")

    def test_dates_and_labels(self):
        self.assertEqual(jc.mdy_to_iso("06/30/2026"), "2026-06-30")
        self.assertIsNone(jc.mdy_to_iso("01/01/1900"))
        self.assertIsNone(jc.mdy_to_iso("-8"))
        self.assertEqual(jc.label(jc.OUTCOME, 2), "Reversed / vacated")
        self.assertEqual(jc.label(jc.OUTCOME, 4), "Code 4 (not in the codebook)")
        self.assertEqual(jc.label(jc.OUTCOME, None), "Not recorded")


class Sentences(unittest.TestCase):
    def test_sentence_types(self):
        self.assertEqual(jc.sentence_type("dismissed", "24", "", ""), "not_convicted")
        self.assertEqual(jc.sentence_type("convicted_plea", "24", "36", "0"), "prison")
        self.assertEqual(jc.sentence_type("convicted_plea", "-4", "-8", "-8"), "prison")  # life
        self.assertEqual(jc.sentence_type("convicted_jury", "-3", "-8", "-8"), "sealed")
        self.assertEqual(jc.sentence_type("convicted_plea", "0", "36", "0"), "probation")
        self.assertEqual(jc.sentence_type("convicted_plea", "-8", "-8", "500"), "fine_only")
        self.assertEqual(jc.sentence_type("convicted_plea", "-2", "-8", "-8"), "no_sentence")

    def test_disposition_groups_match_table_d4_columns(self):
        self.assertEqual(jc.CRIM_DISP_GROUP[4], "convicted_plea")
        self.assertEqual(jc.CRIM_DISP_GROUP[17], "convicted_bench")
        self.assertEqual(jc.CRIM_DISP_GROUP[19], "convicted_jury")
        self.assertEqual(jc.CRIM_DISP_GROUP[16], "acquitted_bench")
        self.assertEqual(jc.CRIM_DISP_GROUP[12], "dismissed")
        self.assertNotIn(6, jc.CRIM_DISP_GROUP)


class Appeals(unittest.TestCase):
    RAW = {"STATUSCD": "L", "TRMTYPE": "4", "APPTYPE": "4", "DDIST": "08", "AGENCY": "-9", "NOS": "365", "DKTDATE": "01/10/2024",
           "JUDGDATE": "03/10/2024", "TAPEYEAR": "2024", "CIRCUIT": "2", "DISP": "2", "OUTCOME": "2", "PROCTERM": "-8", "METHOD": "-8",
           "PUBSTAT": "3", "JOINAPP": "0", "OPDISP": "-8"}

    def test_extract_decode(self):
        r = ex.appeal_record(self.RAW)
        self.assertEqual((r["circuit"], r["origin"], r["type_group"], r["nos"], r["days"]), ("ca2", "nysd", "civil_private", "365", "60"))
        agency = ex.appeal_record({**self.RAW, "TRMTYPE": "1", "APPTYPE": "1", "DDIST": "-8", "AGENCY": "EPA"})
        self.assertEqual((agency["origin"], agency["nos"]), ("agency:EPA", ""))
        missing = ex.appeal_record({**self.RAW, "TRMTYPE": "-8", "APPTYPE": "-8", "DDIST": "-8"})
        self.assertEqual((missing["type_group"], missing["origin"]), ("not_recorded", "not_recorded"))

    def test_nature_of_proceeding(self):
        self.assertEqual(ba.nature("3", "530"), "us_prisoner")
        self.assertEqual(ba.nature("3", "463"), "us_prisoner")  # alien detainee habeas, as in Table B-5
        self.assertEqual(ba.nature("4", "365"), "private_civil")
        self.assertEqual(ba.nature("19", ""), "criminal")
        self.assertEqual(ba.nature("22", ""), "original")
        self.assertEqual(ba.nature("", ""), "not_recorded")

    def _row(self, **kw):
        base = {"status": "L", "fy": "2025", "circuit": "ca2", "origin": "nysd", "trmtype": "4", "nos": "365", "agency": "",
                "disp": "2", "outcome": "2", "pubstat": "2", "days": "30", "joinapp": "0", "opdisp": "-8"}
        return ba.decode({**base, **kw})

    def test_merits_exclude_consolidated_and_rates(self):
        acc = ba.Acc()
        for _ in range(9):
            acc.add(self._row(outcome="1"))
        acc.add(self._row(outcome="2"))
        acc.add(self._row(outcome="2", joinapp="2"))  # consolidated member: terminated, not a merits termination
        s = acc.summary()
        self.assertEqual((s["terminated"], s["merits_appeals"], s["reversed"], s["consolidated"]), (11, 10, 1, 1))
        self.assertEqual(s["reversed_pct"], 10.0)
        self.assertEqual(s["median_days"], 30.0)

    def test_percent_not_shown_under_base_ten(self):
        acc = ba.Acc()
        for _ in range(9):
            acc.add(self._row(outcome="2"))
        self.assertIsNone(acc.summary()["reversed_pct"])

    def test_original_proceedings_use_opdisp(self):
        r = self._row(trmtype="6", nos="", opdisp="1", outcome="-8")
        self.assertEqual(r["outcome"], "op_granted")
        self.assertIsNone(self._row(status="S"))


class CriminalAndBankruptcy(unittest.TestCase):
    def test_criminal_decode(self):
        off = jc.parse_offenses(APPENDIX_FIXTURE)
        row = {"fy": "2025", "district": "08", "ctfil": "1", "cttr": "1", "ctpn": "0", "ctpnwof": "0", "ctfiltrn": "1", "cttrtrn": "1",
               "foffcd1": "6801", "toffcd1": "6801", "disp1": "4", "pristot": "60", "probtot": "-8", "finetot": "0", "procdate": "",
               "termdate": "", "tcounsel": "2", "procdays": "200", "status": "J"}
        r = bc.decode(row, off)
        self.assertEqual((r["court"], r["off_t"], r["disp"], r["sent"], r["prison"], r["days"]), ("nysd", "drugs", "convicted_plea", "prison", 60, 200))
        acc = bc.Acc()
        bc.add(acc, r)
        self.assertEqual(acc.summary()["convicted"], 1)
        r2 = bc.decode({**row, "cttr": "0", "disp1": "-8"}, off)
        self.assertIsNone(r2["sent"])

    def test_bankruptcy_keys(self):
        rec = {"SNAPSHOT": "09/30/2024", "SNAPFILE": "1", "SNAPCLOS": "0", "SNAPPEND": "1", "DISTRICT": "08", "ORGFLDT": "03/01/2024",
               "FILEDATE": "03/01/2024", "CRNTCHP": "11", "ORGFLCHP": "11", "NTRDBT": "b", "CRNTFLSUBCHP": "V", "ORGFLSUBCHP": "", "ORGNTRDBT": ""}
        keys = ex.bankruptcy_key(rec)
        self.assertEqual(keys[0], ("2024", "08", "filed", "11", "11", "new", "new", "b", True, "blank"))
        self.assertEqual([k[2] for k in keys], ["filed", "pending_end"])
        jun = ex.bankruptcy_key({**rec, "SNAPSHOT": "06/30/2026"})
        self.assertEqual(jun[0][0], "2026-06-30")  # the June snapshot is a 12-month period, never labelled FY2026
        old = ex.bankruptcy_key({**rec, "ORGFLDT": "05/01/2001", "FILEDATE": "02/01/2024", "ORGFLCHP": "7", "CRNTCHP": "7"})
        self.assertEqual(old[0][5:7], ("old", "new"))
        self.assertEqual(bb.chapter_of("filed", "7", "7", "old", "new"), "7")  # a reopened case filed in 2024 uses the new code set

    def test_common(self):
        self.assertIsNone(ic.pct(1, 9))
        self.assertEqual(ic.pct(1, 10), 10.0)
        self.assertEqual(ic.rank_desc({"a": 3, "b": 5, "c": 5, "d": None}), {"b": 1, "c": 1, "a": 3})
        self.assertEqual(ic.fmt_int(None), "Not recorded")


class JudgeProfiles(unittest.TestCase):
    def test_party_label_never_bare(self):
        self.assertEqual(bjp.party_label("Republican"), "Appointed by a Republican president")
        self.assertEqual(bjp.party_label("Democratic"), "Appointed by a Democratic president")
        self.assertEqual(bjp.party_label("None (reassignment)"), "Appointing president's party: None (reassignment)")
        self.assertIsNone(bjp.party_label(None))

    def test_vote_label(self):
        self.assertEqual(bjp.vote_label("Voice", "  "), "Voice vote")
        self.assertEqual(bjp.vote_label("Roll Call", " 53/43"), "Roll call 53-43")
        self.assertEqual(bjp.vote_label("Roll Call", ""), "Roll call (tally not recorded)")
        self.assertEqual(bjp.vote_label(None, None), "Not recorded")

    def test_court_ids_and_status(self):
        self.assertEqual(bjp.court_id("U.S. District Court for the Southern District of New York"), "nysd")
        self.assertEqual(bjp.court_id("U.S. Court of Appeals for the Ninth Circuit"), "ca9")
        self.assertIsNone(bjp.court_id("U.S. Circuit Court for the District of Maine"))
        serv = [{"termination": "Elevated", "senior_status": None, "chief_begin": None, "chief_end": None, "chief2_begin": None, "chief2_end": None},
                {"termination": None, "senior_status": "2020-01-01", "chief_begin": None, "chief_end": None, "chief2_begin": None, "chief2_end": None}]
        self.assertEqual(bjp.status_of(serv)[0], "Senior")
        self.assertEqual(bjp.status_of(serv[:1])[0], "Service ended")


if __name__ == "__main__":
    unittest.main()
