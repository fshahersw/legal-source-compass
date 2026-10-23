"""Offline unit tests for the enforcement_actions extractors and parsers (synthetic fixtures, no network).

  cd scripts/enrichment/enforcement_actions && python3 -B -m unittest -v test_enforcement_actions
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as ex  # noqa: E402
import ftc_parse  # noqa: E402
import sec_parse  # noqa: E402


class TextTests(unittest.TestCase):
    def test_html_to_text_blocks_and_entities(self):
        text = ex.html_to_text("<p>WASHINGTON &ndash; Acme&nbsp;Corp. paid.</p><p>Second&#039;s line</p><script>x()</script>")
        self.assertEqual(text, "WASHINGTON – Acme Corp. paid.\nSecond's line")

    def test_long_sentence_window_is_a_word_bounded_span(self):
        text = ("word " * 120) + "paid $5 million " + ("more " * 120) + "end."
        pos = text.index("$5")
        s = ex.sentence_at(text, pos, limit=200)
        self.assertIn(s, text)
        self.assertIn("$5 million", s)
        self.assertTrue(s.startswith("word") and s.endswith("more"))
        self.assertLessEqual(len(s), 200)

    def test_sentences_ignore_abbreviations(self):
        text = "Acme Inc. of Washington, D.C. agreed to pay $5 million. The U.S. Attorney said so."
        spans = ex.sentence_spans(text)
        self.assertEqual(len(spans), 2)
        self.assertEqual(text[spans[0][0]:spans[0][1]], "Acme Inc. of Washington, D.C. agreed to pay $5 million.")


class AmountTests(unittest.TestCase):
    def test_values_and_multipliers(self):
        text = "Acme agreed to pay $1.5 million to settle claims. It also paid $310,000.50 in restitution and $2 billion."
        amounts = ex.extract_amounts(text)
        self.assertEqual([a["as_written"] for a in amounts], ["$1.5 million", "$310,000.50", "$2 billion"])
        self.assertEqual([a["value_usd"] for a in amounts], [1500000.0, 310000.5, 2000000000.0])
        self.assertEqual(amounts[0]["keyword"], "settlement")
        self.assertEqual(amounts[1]["keyword"], "restitution")
        for a in amounts:
            self.assertEqual(text[a["offset"]:a["offset"] + len(a["as_written"])], a["as_written"])
            self.assertIn(a["sentence"], text)

    def test_statutory_maximum_is_labelled(self):
        amounts = ex.extract_amounts("The charge carries a maximum penalty of 20 years in prison and a $250,000 fine.")
        self.assertEqual(amounts[0]["keyword"], "statutory maximum")

    def test_range_start_has_no_value(self):
        amounts = ex.extract_amounts("Losses were between $2 to $3 million.")
        self.assertTrue(amounts[0]["range_start"])
        self.assertNotIn("value_usd", amounts[0])
        self.assertEqual(amounts[1]["value_usd"], 3000000.0)

    def test_ambiguous_multiplier_has_no_value(self):
        amounts = ex.extract_amounts("The SEC filed a partially-settled action for raising nearly $6,705,000 million.")
        self.assertTrue(amounts[0]["ambiguous_as_written"])
        self.assertNotIn("value_usd", amounts[0])
        self.assertNotEqual(amounts[0].get("keyword"), "settlement")

    def test_no_amounts(self):
        self.assertEqual(ex.extract_amounts("No money was mentioned."), [])

    def test_verify_spans_counts_mismatch(self):
        text = "Paid $5 million."
        items = ex.extract_amounts(text)
        self.assertEqual(ex.verify_spans(text, items), 0)
        self.assertEqual(ex.verify_spans(text, [{"as_written": "$6 million", "offset": 5}]), 1)


class StatuteTests(unittest.TestCase):
    def test_usc_forms(self):
        text = ("He violated 18 U.S.C. § 1343 and 21 U.S.C. §§ 841(a)(1), and Title 18, United States Code, "
                "Section 1956(h), plus 42 C.F.R. § 1001.952 and the False Claims Act.")
        cites = [s["cite"] for s in ex.extract_statutes(text)]
        self.assertEqual(cites, ["18 U.S.C. § 1343", "21 U.S.C. § 841(a)(1)", "18 U.S.C. § 1956(h)",
                                 "42 C.F.R. § 1001.952", "False Claims Act"])

    def test_duplicates_collapse(self):
        cites = ex.extract_statutes("18 U.S.C. § 1343 ... 18 USC 1343 ... 18 U.S.C. Section 1343")
        self.assertEqual([c["cite"] for c in cites], ["18 U.S.C. § 1343"])

    def test_no_false_positive_on_years(self):
        self.assertEqual(ex.extract_statutes("In 2019 the company sold 18 units."), [])


class DocketTests(unittest.TestCase):
    def test_federal_forms(self):
        text = "Case No. 1:23-cr-00123-ABC; also 22-CR-220 and 3:21-cv-1234-JD-MEH in MDL No. 2741."
        dockets = [d["as_written"] for d in ex.extract_dockets(text)]
        self.assertIn("1:23-cr-00123-ABC", dockets)
        self.assertIn("22-CR-220", dockets)
        self.assertIn("3:21-cv-1234-JD-MEH", dockets)
        mdl = [d for d in ex.extract_dockets(text) if d["form"] == "MDL number"]
        self.assertEqual(mdl[0]["mdl"], 2741)

    def test_prefixed_number(self):
        dockets = ex.extract_dockets("Civil Action No. 2:19-1234 was filed.")
        self.assertEqual(dockets[0]["as_written"], "2:19-1234")

    def test_spaced_civil_numbers(self):
        dockets = [d["as_written"] for d in ex.extract_dockets("SEC v. Doe, Civil Action No. 01 C 6574 (N.D. Ill.); No. 98 Civ. 2183 (S.D.N.Y.)")]
        self.assertEqual(dockets, ["01 C 6574", "98 Civ. 2183"])
        self.assertEqual(ex.extract_dockets("No. 98 people attended in 2001"), [])

    def test_phone_numbers_and_dates_are_not_dockets(self):
        self.assertEqual(ex.extract_dockets("Call 202-514-2007 on 10-22-2026."), [])


class CourtTests(unittest.TestCase):
    def test_district_court_names(self):
        courts = ex.extract_courts("filed in the U.S. District Court for the Southern District of New York and "
                                   "the United States District Court for the District of Columbia.")
        self.assertEqual([c["court_id"] for c in courts], ["nysd", "dcd"])

    def test_unknown_division_has_no_id(self):
        courts = ex.extract_courts("the U.S. District Court for the Central District of Texas")
        self.assertEqual(len(courts), 1)
        self.assertNotIn("court_id", courts[0])

    def test_attorney_office_is_not_a_court(self):
        self.assertEqual(ex.extract_courts("U.S. Attorney for the Eastern District of Virginia"), [])

    def test_appeals_and_special(self):
        courts = ex.extract_courts("The U.S. Court of Appeals for the Fourth Circuit and the U.S. Court of Federal Claims.")
        self.assertEqual([c["court_id"] for c in courts], ["ca4", "uscfc"])

    def test_bluebook_cites(self):
        self.assertEqual(ex.bluebook_district_id("M.D. Fla."), "flmd")
        self.assertEqual(ex.bluebook_district_id("S.D.N.Y."), "nysd")
        self.assertEqual(ex.bluebook_district_id("D.D.C."), "dcd")
        self.assertEqual(ex.bluebook_district_id("N.D.W. Va."), "wvnd")
        self.assertIsNone(ex.bluebook_district_id("C.D. Tex."))
        cites = ex.extract_court_cites("SEC v. Doe, No. 26-cv-02430 (M.D. Fla. filed Oct. 19, 2026) and (S.D.N.Y.)")
        self.assertEqual([c["court_id"] for c in cites], ["flmd", "nysd"])


class PartyTests(unittest.TestCase):
    def test_company_subject(self):
        body = "Wells Fargo Bank, N.A. agreed to pay..."
        parties = ex.title_parties("Wells Fargo Bank Agrees to Pay $1.2 Billion for Improper Mortgage Lending", body)
        self.assertEqual(parties, [{"as_written": "Wells Fargo Bank", "role": "subject", "kind": "organization (suffix in name)"}])

    def test_person_named_by_publisher(self):
        parties = ex.title_parties("James Hunley Indicted For Hobbs Act Robbery", "James Hunley, 30, was indicted.")
        self.assertEqual(parties[0]["as_written"], "James Hunley")
        self.assertEqual(parties[0]["kind"], "named in title")

    def test_descriptors_are_not_names(self):
        for title in ["Columbus Man Sentenced to 240 Months", "Former CEO Charged With Fraud",
                      "Jury Convicts Man Of Attempted Bank Robbery", "Three Men Indicted On Conspiracy",
                      "Justice Department Reaches Agreement With City"]:
            self.assertEqual(ex.title_parties(title, title), [], title)

    def test_body_corroboration_required(self):
        self.assertEqual(ex.title_parties("Acme Widgets Agrees to Pay $5 Million", "A company agreed to pay."), [])

    def test_object_after_against(self):
        parties = ex.title_parties("Justice Department Files Lawsuit Against Sairam Enterprises Inc. For Discriminating",
                                   "the lawsuit against Sairam Enterprises Inc. alleges")
        self.assertEqual(parties[0]["as_written"], "Sairam Enterprises Inc.")
        self.assertEqual(parties[0]["role"], "object")

    def test_two_companies(self):
        body = "Iron Mountain Inc. and Recall Holdings Ltd. agreed. Iron Mountain ... Recall Holdings ..."
        parties = ex.title_parties("Iron Mountain and Recall Holdings Agree to Divest Records Management Assets", body)
        self.assertEqual([p["as_written"] for p in parties], ["Iron Mountain", "Recall Holdings"])


class NormalizeTests(unittest.TestCase):
    def test_exact_key(self):
        self.assertEqual(ex.normalize_company("ABBOTT LABORATORIES"), ex.normalize_company("Abbott Laboratories"))
        self.assertEqual(ex.normalize_company("3M Company"), "3m")
        self.assertEqual(ex.normalize_company("Johnson & Johnson"), "johnson and johnson")
        self.assertEqual(ex.normalize_company("The Boeing Co."), "boeing")
        self.assertNotEqual(ex.normalize_company("Abbott"), ex.normalize_company("Abbott Laboratories"))
        self.assertEqual(ex.normalize_company(None), "")


class LinkTests(unittest.TestCase):
    def test_unique_match_and_ambiguous_key(self):
        import links

        companies = links.Companies()
        self.assertEqual(companies.match("Pfizer Inc.")["cik"], "0000078003")
        self.assertEqual(companies.match("3M Company")["cik"], "0000066740")
        # KIANTONE PIPELINE CORP and KIANTONE PIPELINE CO share a key: never linked
        self.assertIsNone(companies.match("Kiantone Pipeline Corporation"))
        self.assertEqual(companies.stats["ambiguous"], 1)
        # partnership markers are kept: Sunoco LP is not SUNOCO INC
        self.assertIsNone(companies.match("Sunoco LP"))
        self.assertIsNone(companies.match("Acme Widgets"))

    def test_every_mapped_court_id_exists(self):
        import links

        courts = links.Courts()
        ids = set(ex.DISTRICTS.values()) | set(ex.CIRCUITS.values()) | {cid for _, cid in ex._SPECIAL}
        self.assertEqual(len(set(ex.DISTRICTS.values())), 94)
        self.assertEqual(sorted(i for i in ids if not courts.valid(i)), [])


class SettleConfirmTests(unittest.TestCase):
    def setUp(self):
        import settle_confirm

        self.sc = settle_confirm

    def test_name_checks(self):
        page = "Welcome to the Amazon Return Settlement website. Amazon.com agreed..."
        self.assertEqual(self.sc.confirm_name("Amazon Return Settlement", page)[0], "exact phrase")
        self.assertEqual(self.sc.confirm_name("Amazon $309.5M Return Policy Settlement (California)", page + " policy")[0], "all party words")
        self.assertIsNone(self.sc.confirm_name("Walmart Return Settlement", page)[0])

    def test_deadline_forms_and_contradiction(self):
        self.assertEqual(self.sc.confirm_deadline("2026-12-01", "File by December 1, 2026.")["status"], "confirmed")
        self.assertEqual(self.sc.confirm_deadline("2026-12-01", "Postmarked by 12/01/2026.")["as_written"], "12/01/2026")
        r = self.sc.confirm_deadline("2026-12-01", "The claim deadline is January 5, 2027.")
        self.assertEqual(r["status"], "contradicted")
        self.assertEqual(r["page_date_as_written"], "January 5, 2027")
        self.assertEqual(self.sc.confirm_deadline("2026-12-01", "Nothing here.")["status"], "not_found")
        self.assertEqual(self.sc.confirm_deadline(None, "x")["status"], "not_in_lead")

    def test_amounts_same_value(self):
        found, status = self.sc.confirm_amounts("A $309.5 million fund.", "Amazon will pay $309,500,000 into a fund.")
        self.assertEqual(status, "confirmed")
        self.assertEqual(found[0]["page_as_written"], "$309,500,000")
        self.assertEqual(found[0]["status"], "confirmed (same value)")
        self.assertEqual(self.sc.confirm_amounts("$5 million", "No money.")[1], "not_found")
        self.assertEqual(self.sc.confirm_amounts(None, "x")[1], "not_in_lead")

    def test_courts_and_cases_on_page(self):
        page = ("Superior Court of the State of California, County of Los Angeles, Case No. 22STCV12345. "
                "Also in the United States District Court for the Northern District of California, No. 3:23-cv-05544.")
        courts = self.sc.stated_courts(page)
        self.assertIn("cand", [c["court_id"] for c in courts])
        self.assertTrue(any(c["as_written"].startswith("Superior Court of the State of California") for c in courts))
        self.assertIn("3:23-cv-05544", [c["as_written"] for c in self.sc.stated_case_numbers(page)])


class FtcParseTests(unittest.TestCase):
    def test_csv_cp1252_and_links(self):
        raw = ('"MatterEnforcementFY","MatterEnforcementDate","MatterNumber","MatterName","MatterIndustry","Matterhyperlink"\r\n'
               '"2026","6/18/2026 0:00:00","2510096","Aurobindo/Lannett","Health Care \u2013 Drugs","#https://www.ftc.gov/x#"\r\n').encode("cp1252")
        rows = ftc_parse.read_csv_rows(raw)
        self.assertEqual(rows[0]["MatterIndustry"], "Health Care – Drugs")
        self.assertEqual(ftc_parse.strip_hash_link(rows[0]["Matterhyperlink"]), "https://www.ftc.gov/x")
        self.assertEqual(ftc_parse.parse_us_date(rows[0]["MatterEnforcementDate"]), "2026-06-18")
        self.assertIsNone(ftc_parse.parse_us_date(""))
        self.assertIsNone(ftc_parse.strip_hash_link(""))

    def test_listing_and_case_page(self):
        listing = ('<article about="/legal-library/browse/cases-proceedings/x" class="node node--type-case node--view-mode-search-result node--1">'
                   '<h3 class="node-title"><a href="/legal-library/browse/cases-proceedings/x">Acme, In the Matter of</a></h3>'
                   '<div class="field field--name-field-case-action-type field--type-list-string field--label-inline"><div class="field__label">Type of Action</div><div class="field__items"><div class="field__item">Administrative</div></div></div>'
                   '<div class="field field--name-field-matter-number field--type-string field--label-inline"><div class="field__label">FTC Matter/File Number</div><div class="field__items"><div class="field__item">261 0115</div></div></div>'
                   '</article>')
        rows = ftc_parse.parse_listing(listing)
        self.assertEqual(rows[0]["name"], "Acme, In the Matter of")
        self.assertEqual(rows[0]["action_type"], "Administrative")
        self.assertEqual(rows[0]["matter_number"], "261 0115")
        self.assertIsNone(rows[0]["status"])
        page = ('<h1 class="page-title">Acme</h1><article about="/x" class="node node--type-case node--view-mode-full node--2">'
                '<div class="field field--name-field-docket-number field--type-string field--label-inline"><div class="field__label">Docket Number</div><div class="field__items"><div class="field__item">C-4801</div><div class="field__item">9410</div></div></div>'
                '</article><article about="/t" class="node node--type-case-timeline-item node--view-mode-full node--3">'
                '<div class="field field--name-field-date field--type-datetime"><div class="field__items"><div class="field__item"><time datetime="2026-01-02T12:00:00Z">Jan 2</time></div></div></div>'
                '<a href="/system/files/a.pdf" type="application/pdf">Complaint</a> <span class="file-size">(1 KB)</span></article>')
        case = ftc_parse.parse_case(page, "https://www.ftc.gov/x")
        self.assertEqual(case["docket_numbers"], ["C-4801", "9410"])
        self.assertEqual(case["documents"][0]["title"], "Complaint")
        self.assertEqual(case["documents"][0]["date"], "2026-01-02")
        self.assertIsNone(ftc_parse.parse_case("<html></html>", "u"))


class SecParseTests(unittest.TestCase):
    def test_listing_row(self):
        html = ('<tr class="pr-list-page-row"><td><time datetime="2026-10-20T18:47:40Z">Oct</time></td><td>'
                "<div class='release-view__respondents'><a href='/enforcement-litigation/litigation-releases/lr-26675'>Terrance P. Berland and David Michael Scalzo</a></div>"
                '<div class="view-table_subfield view-table_subfield_release_number"> <span class="view-table_subfield_label">Release No.</span> <span class="view-table_subfield_value">LR-26675</span> </div>'
                '<div class="view-table_subfield view-table_subfield_see_also"> <span class="view-table_subfield_label">See Also: </span> <span class="view-table_subfield_value"><span><a href="/files/c.pdf" type="application/pdf">SEC Complaint</a></span></span> </div>'
                '</td></tr>')
        rows = sec_parse.parse_listing(html)
        self.assertEqual(rows[0]["release_number"], "LR-26675")
        self.assertEqual(rows[0]["date"], "2026-10-20")
        self.assertEqual(rows[0]["url"], "https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26675")
        self.assertEqual(rows[0]["respondents"], "Terrance P. Berland and David Michael Scalzo")
        self.assertIsNone(rows[0]["file_number"])


if __name__ == "__main__":
    unittest.main()
