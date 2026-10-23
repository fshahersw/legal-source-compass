"""Offline tests for scripts/documents (synthetic text only; no network).

Run: cd scripts/documents && python3 -B -m unittest -v test_documents
"""

from __future__ import annotations

import gzip
import json
import os
import tempfile
import unittest
from pathlib import Path

from citations import extract_citations, ts_view
from extract import extract_document_pages, extract_page, sentence_bounds
from run_pipeline import ConfigError, creds, load, write_extractions
from state_codes import state_code_citations

HERE = Path(__file__).resolve().parent


def kinds(rows, kind):
    return [r for r in rows if r["kind"] == kind]


class CitationParity(unittest.TestCase):
    def test_matches_the_typescript_parser_on_the_shared_fixture(self):
        fixture = json.loads((HERE / "fixtures" / "citation_parity.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(fixture["cases"]), 10)
        total = 0
        for case in fixture["cases"]:
            got = [ts_view(c) for c in extract_citations(case["text"], 200)]
            # JSON has no undefined: the TypeScript output omits absent optional fields, like ts_view does
            want = [{k: v for k, v in c.items()} for c in case["expected"]]
            self.assertEqual(got, want, case["text"])
            total += len(want)
        self.assertGreaterEqual(total, 30)

    def test_short_forms_are_not_citations(self):
        self.assertEqual(extract_citations("Id. at 650. 576 U.S. at 650. Supra note 3."), [])


class ExtractPage(unittest.TestCase):
    TEXT = (
        "Case 3:16-md-02738-MAS-RLS Document 33091 Filed 06/26/24 Page 1 of 3 PageID: 12345\n"
        "IN RE: TALC PRODUCTS LIABILITY LITIGATION, MDL No. 2738\n"
        "Plaintiffs sue under 42 U.S.C. §§ 1981, 1983 and 1985(3). See Obergefell v. Hodges, 576 U.S. 644, 651 (2015).\n"
        "FDA rules at 21 C.F.R. parts 210-211 and 21 C.F.R. § 314.50 apply, as does Cal. Bus. & Prof. Code § 17200.\n"
        "On January 5, 2024 the Court (No. 3:16-md-2738) approved a settlement of $1.25 million. The U.S. Inc. paid $5,000.\n"
        "A hearing on 02/30/2024 is impossible; the conference on 3/4/2025 is set. They may 5, 2024 decide.\n"
    )

    def setUp(self):
        self.rows = extract_page(self.TEXT)

    def test_every_row_is_the_exact_substring_at_its_offsets(self):
        self.assertTrue(self.rows)
        for r in self.rows:
            self.assertEqual(self.TEXT[r["start"] : r["end"]], r["matched"])

    def test_statutory_list_items_get_their_own_spans(self):
        usc = kinds(self.rows, "usc")
        self.assertEqual([r["key"] for r in usc], ["usc:42:1981", "usc:42:1983", "usc:42:1985"])
        self.assertEqual(usc[0]["matched"], "42 U.S.C. §§ 1981")
        self.assertEqual(usc[1]["matched"], "1983")
        self.assertEqual(usc[2]["matched"], "1985(3)")
        self.assertEqual(usc[2]["value"]["pin"], "(3)")
        self.assertEqual(usc[1]["normalized"], "42 U.S.C. § 1983")
        self.assertEqual(len({r["start"] for r in self.rows if r["kind"] == "usc"}), 3)

    def test_cfr_sections_and_adjacent_parts(self):
        cfr = kinds(self.rows, "cfr")
        self.assertEqual([r["key"] for r in cfr], ["cfr-part:21:210", "cfr-part:21:211", "cfr:21:314.50"])
        self.assertEqual(cfr[0]["matched"], "21 C.F.R. parts 210")
        self.assertEqual(cfr[1]["matched"], "211")

    def test_case_citation_key_and_pin(self):
        case = kinds(self.rows, "case_citation")
        self.assertEqual(len(case), 1)
        self.assertEqual(case[0]["key"], "case:576 U.S. 644")
        self.assertEqual(case[0]["matched"], "576 U.S. 644")
        self.assertEqual(case[0]["value"], {"group": 1, "pin": "651"})

    def test_state_code(self):
        st = kinds(self.rows, "state_code")
        self.assertEqual(len(st), 1)
        self.assertEqual(st[0]["matched"], "Cal. Bus. & Prof. Code § 17200")
        self.assertEqual(st[0]["value"], {"state": "CA", "code": "Cal. Bus. & Prof. Code", "section": "17200"})

    def test_mdl_numbers_are_not_docket_numbers(self):
        self.assertEqual([r["key"] for r in kinds(self.rows, "mdl_number")], ["mdl:2738"])
        dockets = kinds(self.rows, "docket_number")
        self.assertEqual([r["matched"] for r in dockets], ["3:16-md-2738"], "the ECF header docket is page furniture")
        self.assertEqual(dockets[0]["key"], "docket:3:16-md-02738")

    def test_dates_are_real_calendar_dates_outside_the_header(self):
        dates = kinds(self.rows, "date")
        self.assertEqual([r["normalized"] for r in dates], ["2024-01-05", "2025-03-04"])
        self.assertEqual(dates[0]["matched"], "January 5, 2024")

    def test_dollar_amounts_with_exact_values_and_sentences(self):
        amounts = kinds(self.rows, "dollar_amount")
        self.assertEqual([r["value"]["amount"] for r in amounts], [1250000, 5000])
        self.assertEqual(amounts[0]["normalized"], "$1,250,000")
        self.assertEqual(amounts[0]["value"]["multiplier"], "million")
        self.assertEqual(
            amounts[0]["value"]["sentence"],
            "On January 5, 2024 the Court (No. 3:16-md-2738) approved a settlement of $1.25 million.",
        )
        self.assertEqual(amounts[1]["value"]["sentence"], "The U.S. Inc. paid $5,000.")
        v = amounts[0]["value"]
        self.assertEqual(self.TEXT[v["sentence_start"] : v["sentence_end"]], v["sentence"])

    def test_rows_never_overlap_a_citation(self):
        cites = [r for r in self.rows if r["kind"] in ("case_citation", "usc", "cfr", "state_code")]
        for r in self.rows:
            if r in cites:
                continue
            for c in cites:
                self.assertTrue(r["end"] <= c["start"] or r["start"] >= c["end"], (r, c))


class EdgeCases(unittest.TestCase):
    def test_no_extractions_in_plain_prose(self):
        self.assertEqual(extract_page("The parties met and conferred about the schedule for discovery."), [])

    def test_header_variants_are_page_furniture(self):
        for header in (
            "Case: 2:18-md-02846-EAS-KAJ Doc #: 904 Filed: 07/07/25 Page: 3 of 3 PAGEID #: 9643",
            "CASE 0:22-md-03031-JRT-JFD Doc. 1609 Filed 07/16/26 Page 13 of 48",
            "Case 9:20-md-02924-RLR Document 7361 Entered on FLSD Docket 10/25/2024 Page 7 of 9",
        ):
            rows = extract_page("Signed on June 1, 2020.\n" + header)
            self.assertEqual([r["kind"] for r in rows], ["date"], header)

    def test_dash_joined_section_numbers(self):
        rows = extract_page("Under 42 U.S.C. § 1395w–26(b)(3) and 40 C.F.R. § 86.1845–04, but 42 U.S.C. §§ 1981–1983 is a range.")
        usc = kinds(rows, "usc")
        self.assertEqual([r["key"] for r in usc], ["usc:42:1395w-26", "usc:42:1981:1983"])
        self.assertEqual(usc[0]["normalized"], "42 U.S.C. § 1395w-26")
        self.assertTrue(usc[0]["value"]["dash_joined"])
        cfr = kinds(rows, "cfr")
        self.assertEqual(cfr[0]["key"], "cfr:40:86.1845-04")
        self.assertEqual(cfr[0]["matched"], "40 C.F.R. § 86.1845–04")

    def test_amount_abbreviations(self):
        rows = kinds(extract_page("A $2.5M increase, a $40K fee, a $3 MM reserve, $4 M later and $7Mil."), "dollar_amount")
        self.assertEqual(
            [(r["matched"], r["value"]["amount"]) for r in rows],
            [("$2.5M", 2500000), ("$40K", 40000), ("$3 MM", 3000000)],
            "a lone letter after a space is ambiguous and not taken",
        )

    def test_dotted_state_sections_refuse_glued_footnotes(self):
        cites = state_code_citations("Minn. Stat. § 604.01.4 The statute; Minn. Stat. § 604.02, subd. 1; RCW 4.16.080.")
        self.assertEqual([c["normalized"] for c in cites], ["Minn. Stat. § 604.02", "RCW 4.16.080"])

    def test_state_sections_that_run_on_are_not_shortened(self):
        text = (
            "Utah Code Ann. § 13-11-\n19(4)(a); Neb. Rev. Stat. § 87¬301; Neb. Rev. Stat. § 25-21, 187.12; "
            "N.J. Stat. Ann. § 2A:58C–5c; Neb. Rev. Stat. § 59-1601."
        )
        cites = state_code_citations(text)
        self.assertEqual([c["section"] for c in cites], ["2A:58C-5c", "59-1601"])
        self.assertEqual(text[cites[0]["start"]:cites[0]["end"]], "N.J. Stat. Ann. § 2A:58C–5c")  # matched text stays exact
        self.assertEqual(cites[0]["key"], "state:NJ:N.J. Stat. Ann.:2A:58C-5c")

    def test_sections_split_by_a_text_layer_space_are_not_taken(self):
        text = "(citing 21 C.F.R. 1301.7 l(a)); 15 U.S.C. § 1681 e(a); 28 U.S.C. § 1332 (a); 21 C.F.R. § 1301.74(b)."
        rows = extract_page(text)
        self.assertEqual([r["key"] for r in rows if r["kind"] in ("usc", "cfr")], ["usc:28:1332", "cfr:21:1301.74"])
        self.assertEqual([r["kind"] for r in rows if r["start"] < text.index(";")], [])  # nothing else takes the span

    def test_amounts_that_read_wrong_are_not_taken(self):
        rows = kinds(extract_page("($720 plus million recovered); a hold of $1 1.00; fees of $5.00 $5.00"), "dollar_amount")
        self.assertEqual([r["matched"] for r in rows], ["$5.00", "$5.00"])

    def test_cents_and_bare_numbers(self):
        rows = extract_page("Costs of $12.50 and 1,000 widgets; USD 5 is not written with a dollar sign.")
        self.assertEqual([(r["matched"], r["value"]["amount"]) for r in rows if r["kind"] == "dollar_amount"], [("$12.50", 12.5)])

    def test_mdl_forms_and_non_matches(self):
        rows = extract_page(
            "MDL 2804; MDL-3092; Multidistrict Litigation No. 2846; the MDL Court; MDL 3:17-md-2804; mdl 12; "
            "MDL No. 23-md-3083-ADB; No. MDL 15-02641-PHX; MDL No.: 3:15-MD-02672-CRB."
        )
        self.assertEqual([r["key"] for r in kinds(rows, "mdl_number")], ["mdl:2804", "mdl:3092", "mdl:2846"])

    def test_date_forms(self):
        rows = extract_page("Signed 5th day of March, 2021; filed 2021-03-05; Sept. 30, 2026; 13/45/2020; 1/2/99; JUNE 1, 2020.")
        self.assertEqual([r["normalized"] for r in kinds(rows, "date")], ["2021-03-05", "2021-03-05", "2026-09-30", "2020-06-01"])

    def test_state_code_forms(self):
        text = (
            "735 ILCS 5/13-202; N.J.S.A. 2A:58C-2; Tex. Civ. Prac. & Rem. Code § 16.003; K.S.A. 2019 Supp. 60-513; "
            "Fla. Stat. § 95.11(3). Mass. Gen. Laws ch. 93A, § 9; 42 Pa. C.S. § 5524; RCW 4.16.080; O.C.G.A. § 9-3-33."
        )
        got = [(c["state"], c["section"]) for c in state_code_citations(text)]
        self.assertEqual(
            got,
            [("IL", "13-202"), ("NJ", "2A:58C-2"), ("TX", "16.003"), ("KS", "60-513"), ("FL", "95.11(3)"), ("MA", "9"),
             ("PA", "5524"), ("WA", "4.16.080"), ("GA", "9-3-33")],
        )
        self.assertEqual(state_code_citations("Kansas law, California code and section 5 of the contract."), [])

    def test_sentence_bounds_respect_abbreviations_and_blank_lines(self):
        text = "Heading\n\nSmith v. Jones Co. paid $5 under No. 4. Next sentence."
        s, e = sentence_bounds(text, text.index("$5"), text.index("$5") + 2)
        self.assertEqual(text[s:e], "Smith v. Jones Co. paid $5 under No. 4.")

    def test_long_sentences_are_clipped_around_the_amount(self):
        text = "word " * 400 + "a payment of $7 was made " + "word " * 400 + "."
        rows = kinds(extract_page(text), "dollar_amount")
        self.assertLessEqual(len(rows[0]["value"]["sentence"]), 500)
        self.assertIn("$7", rows[0]["value"]["sentence"])

    def test_document_pages_rows(self):
        rows = extract_document_pages([{"sha256": "a" * 64, "page": 3, "text": "See 28 U.S.C. § 1407."}])
        self.assertEqual(rows[0]["sha256"], "a" * 64)
        self.assertEqual(rows[0]["page"], 3)
        self.assertEqual(rows[0]["key"], "usc:28:1407")
        self.assertEqual(set(rows[0]), {"sha256", "page", "start", "end", "kind", "matched", "normalized", "key", "value"})


class Pipeline(unittest.TestCase):
    def test_build_files_manifest_and_load_batches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pages = [[{"sha256": "b" * 64, "page": 1, "text": "MDL No. 2738 and 42 U.S.C. § 1983 on June 1, 2020."}]]
            man = write_extractions("t1", iter(pages), root)
            self.assertEqual(man["rows"], 3)
            self.assertEqual(man["rows_by_kind"]["mdl_number"], 1)
            f = root / "t1" / "extractions.jsonl.gz"
            self.assertEqual(man["files"][0]["bytes"], f.stat().st_size)
            with gzip.open(f, "rt", encoding="utf-8") as g:
                self.assertEqual(len(g.read().splitlines()), 3)
            sent = []
            receipt = load("t1", root, send=lambda rows: sent.append(list(rows)) or {"accepted": len(rows) - 1, "rejected": {"text_mismatch": 1}})
            self.assertEqual(receipt["accepted"], 2)
            self.assertEqual(receipt["rejected"], {"text_mismatch": 1})
            self.assertEqual(len(sent), 1)
            self.assertTrue((root / "t1" / "load-receipt.json").exists())
        with self.assertRaises(SystemExit):
            write_extractions("Bad Build", iter([]), Path(tempfile.gettempdir()))

    def test_credentials_only_from_environment(self):
        saved = {k: os.environ.pop(k, None) for k in ("EXTERNAL_SUPABASE_URL", "EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "EXTERNAL_SUPABASE_KEY")}
        try:
            with self.assertRaises(ConfigError):
                creds()
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
