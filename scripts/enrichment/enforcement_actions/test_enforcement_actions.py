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

    def test_sentence_ends_after_a_number(self):
        text = "The victim suffered a loss of approximately $425,000. As part of her plea, she will forfeit $50,000."
        amounts = ex.extract_amounts(text)
        self.assertEqual(amounts[0]["sentence"], "The victim suffered a loss of approximately $425,000.")
        self.assertEqual(amounts[0]["keyword"], "alleged loss or scheme")
        self.assertEqual(amounts[1]["keyword"], "forfeiture")

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

    def test_bis_is_not_a_settlement_keyword(self):
        amounts = ex.extract_amounts("The Bank of International Settlements estimated contracts at $450 trillion.")
        self.assertIsNone(amounts[0].get("keyword"))

    def test_no_amounts(self):
        self.assertEqual(ex.extract_amounts("No money was mentioned."), [])

    def test_verify_spans_counts_mismatch(self):
        text = "Paid $5 million."
        items = ex.extract_amounts(text)
        self.assertEqual(ex.verify_spans(text, items), 0)
        self.assertEqual(ex.verify_spans(text, [{"as_written": "$6 million", "offset": 5}]), 1)

    def test_abbreviated_and_hyphenated_multipliers(self):
        text = "He paid $1-Million, then $2.8M and $13K; they agreed to pay $9 M to resolve it, at $300 K Street."
        amounts = ex.extract_amounts(text)
        self.assertEqual([a["as_written"] for a in amounts], ["$1-Million", "$2.8M", "$13K", "$9 M", "$300"])
        self.assertEqual([a["value_usd"] for a in amounts], [1e6, 2.8e6, 13000.0, 9e6, 300.0])
        self.assertEqual(ex.extract_amounts("La venta de $13M y $2.5 Medicare")[1]["as_written"], "$2.5")

    def test_special_assessment_is_not_a_resolution_figure(self):
        amounts = ex.extract_amounts("Watt was ordered to pay a $200.00 special assessment and $500.00 in restitution. "
                                     "He must pay a special assessment of $100.")
        self.assertEqual([a["keyword"] for a in amounts], ["special assessment", "restitution", "special assessment"])
        self.assertEqual(ex.headline_figure("Sentencings for November 15", amounts)["as_written"], "$500.00")

    def test_deal_values_and_program_totals_are_not_resolution_figures(self):
        text = ("The division filed a lawsuit to block the $107 billion transaction, along with a proposed settlement. "
                "Settlements and judgments since 1986 now total more than $85 billion. "
                "This settlement is part of the work of the RMBS Working Group, which has recovered $36.65 billion to date. "
                "Acme agreed to pay $5 million to settle allegations that, since 2012, it billed for unneeded tests.")
        kinds = [a["keyword"] for a in ex.extract_amounts(text)]
        self.assertEqual(kinds, ["transaction value", "cumulative total", "cumulative total", "settlement"])

    def test_billion_is_not_billing(self):
        self.assertIsNone(ex.extract_amounts("Revenue reached $3 billion last year.")[0].get("keyword"))
        self.assertEqual(ex.extract_amounts("The clinic billed Medicare $3 million.")[0]["keyword"], "alleged loss or scheme")

    def test_statutory_maximum_forms(self):
        for text in ("The charge provides for a sentence of up to 20 years in prison and a fine of $250,000 or twice the gross gain.",
                     "Each count carries up to five years in prison and a $250,000 fine.",
                     "He could receive a fine of $1 million."):
            self.assertEqual(ex.extract_amounts(text)[0]["keyword"], "statutory maximum", text)

    def test_foreign_multiplier_is_ambiguous(self):
        amounts = ex.extract_amounts("Acuerdo de liquidacion de $13 Mil Millones con el banco.")
        self.assertTrue(amounts[0]["ambiguous_as_written"])
        self.assertNotIn("value_usd", amounts[0])


class HeadlineTests(unittest.TestCase):
    DETROL_TITLE = "Pfizer to Pay $14.5 Million for Illegal Marketing of Drug Detrol"
    DETROL_BODY = ("The other nine suits were settled or dismissed in 2009 as part of the government's global resolution "
                   "with Pfizer, under which the company agreed to pay $2.3 billion dollars to resolve civil claims. "
                   "Pfizer Inc. has agreed to pay $14.5 million to resolve False Claims Act allegations.")

    def test_title_figure_is_the_headline(self):
        amounts = ex.extract_amounts(self.DETROL_BODY)
        head = ex.headline_figure(self.DETROL_TITLE, amounts)
        self.assertEqual(head, {"as_written": "$14.5 Million", "value_usd": 14500000.0, "source": "title"})
        self.assertIn(head["as_written"], self.DETROL_TITLE)

    def test_first_resolution_sentence_without_a_title_figure(self):
        body = ("The defendant faces a maximum fine of $250,000. The scheme caused losses of $3 million. "
                "She was ordered to pay $1.2 million in restitution. The court also imposed a $5 million judgment.")
        head = ex.headline_figure("Woman Sentenced for Health Care Fraud", ex.extract_amounts(body))
        self.assertEqual(head["source"], "first resolution sentence")
        self.assertEqual(head["as_written"], "$1.2 million")
        self.assertEqual(head["keyword"], "restitution")
        self.assertEqual(head["sentence"], "She was ordered to pay $1.2 million in restitution.")

    def test_figures_about_an_earlier_matter_are_skipped(self):
        body = ("In November 2009, the United States, numerous states, and Omnicare entered into a $98 million settlement "
                "agreement that resolved Omnicare's civil liability. The complaint seeks treble damages.")
        amounts = ex.extract_amounts(body)
        self.assertIsNone(ex.headline_figure("U.S. Files Suit Against Johnson & Johnson", amounts, "2010-01-15"))
        # undated, or dated less than two months before the release: kept
        self.assertEqual(ex.headline_figure("X", amounts, "2009-12-20")["as_written"], "$98 million")
        detrol = ex.extract_amounts(HeadlineTests.DETROL_BODY)
        head = ex.headline_figure("Pfizer Settles Detrol Claims", detrol, "2011-10-21")
        self.assertEqual((head["as_written"], head["earlier_matter_figures_skipped"]), ("$14.5 million", 1))
        self.assertFalse(ex.about_earlier_matter("Smith, who pleaded guilty in March 2014, was ordered to pay $5 million.", "2014-09-01"))
        self.assertTrue(ex.about_earlier_matter("In a separate settlement, the company paid $2 million.", "2014-09-01"))
        self.assertTrue(ex.about_earlier_matter("Previously, on March 30, 2002, two relatives settled for $4.7 million.", "2002-07-15"))
        # SEC releases report judgments entered weeks or months earlier: a six-month threshold keeps those
        judgment = "On November 8, 2021, a federal court entered a final judgment ordering Craig to pay $1.3 million."
        self.assertTrue(ex.about_earlier_matter(judgment, "2022-01-06"))
        self.assertFalse(ex.about_earlier_matter(judgment, "2022-01-06", min_months=6))

    def test_stock_paragraph_is_skipped(self):
        amounts = ex.extract_amounts("The task force has recovered $9 billion in settlements. Acme agreed to pay $2 million to settle.")
        amounts[0]["boilerplate"] = True
        self.assertEqual(ex.headline_figure("Acme Settles", amounts)["as_written"], "$2 million")

    def test_title_forms(self):
        cases = {
            "Agree to Pay More Than $9 M to Resolve False Claims Act Lawsuit": ("$9 M", 9e6),
            "Hospital Agrees to Pay Nearly 60M to Resolve Kickback Allegations": ("60M", 6e7),
            "Bank to Pay $1.2 Billion Settlement": ("$1.2 Billion", 1.2e9),
            "Kideys Sentenced To 60 Months And 1.4 Million Restitution": ("1.4 Million", 1.4e6),
            "Owner Ordered to Pay Over 5 Million Dollars in Restitution": ("5 Million", 5e6),
            "Michigan Man Ordered To Pay Over $1-Million In Restitution": ("$1-Million", 1e6),
            "Corporation Agrees to $ 1 Million Fine for Filling Wetlands": ("$ 1 Million", 1e6),
            "Company Settles False Claims Act Allegations for $5 Million": ("$5 Million", 5e6),
            "CH2M Hill Agrees to Pay United States $1.5 Million to Resolve Liability": ("$1.5 Million", 1.5e6),
            "Doctor Sentenced to 5 Years, Ordered to Pay $1.2 Million in Restitution": ("$1.2 Million", 1.2e6),
            "United States Recovers $8.4 Million In Fraudulent COVID Relief Funds From Family": ("$8.4 Million", 8.4e6),
            "U.S. Attorney's Office Collects More Than $47 Million In Civil And Criminal Actions": ("$47 Million", 4.7e7),
        }
        for title, (written, value) in cases.items():
            head = ex.headline_figure(title, [])
            self.assertEqual((head["as_written"], head["value_usd"], head["source"]), (written, value, "title"), title)
            self.assertIn(head["as_written"], title)

    def test_titles_without_a_resolution_figure(self):
        for title in ("Three Defendants Convicted In $3.2M Medicare Fraud Scheme",
                      "Former Executive Who Paid $5 Million in Bribes Sentenced",
                      "Man Faces Up To $250,000 Fine",
                      "Government Seeks $5M Penalty Against Company",
                      "Man Sentenced for $5 Million Fraud Scheme, Ordered to Pay Restitution",
                      "Man Admits To Possessing More Than 5 Million Images",
                      "3M Company Abandons Its Proposed Acquisition",
                      "Businessman Sentenced for Trying to Pay His $3.6 Million Tax Debt with Fictitious Instrument",
                      "Owner charged with failing to pay over $420,000 in taxes he withheld from employees",
                      "Attorney Who Failed to File Tax Returns and Pay More Than $3.1 Million Owed Sentenced"):
            self.assertIsNone(ex.headline_figure(title, []), title)

    def test_ambiguous_title_figure_falls_back_to_the_body(self):
        amounts = ex.extract_amounts("Acme agreed to pay $7 million to settle the claims.")
        head = ex.headline_figure("Acme to Pay $5 to $10 Million", amounts)
        self.assertEqual((head["source"], head["as_written"], head["title_figure_not_used"]),
                         ("first resolution sentence", "$7 million", "range"))
        head = ex.headline_figure("Acme to Pay $6,705,000 Million", amounts)
        self.assertEqual(head["title_figure_not_used"], "ambiguous as written")


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
