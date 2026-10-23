"""Offline tests for the judge_practices stream: listing and judge-page parsers on stored fixtures of differently built court websites,
title and date reading, redaction, document type detection and profile matching. No network.

    cd scripts/enrichment/judge_practices && python3 -B -m unittest -v test_judge_practices
"""
from __future__ import annotations

import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract_text as xt  # noqa: E402
import fetchlib as fl  # noqa: E402
import parse_lib as pl  # noqa: E402

FX = os.path.join(HERE, "fixtures")


def fixture(name: str) -> bytes:
    with open(os.path.join(FX, name), "rb") as h:
        return h.read()


# fixture -> the page address it was fetched from
URL = {
    "nysd_listing_district.html": "https://www.nysd.uscourts.gov/judges/district-judges",
    "nysd_judge_liman.html": "https://www.nysd.uscourts.gov/hon-lewis-j-liman",
    "nysd_judge_parker_magistrate.html": "https://www.nysd.uscourts.gov/hon-katharine-h-parker",
    "cand_listing.html": "https://www.cand.uscourts.gov/judges",
    "cand_judge_ygr.html": "https://www.cand.uscourts.gov/judges/ygr/gonzalez-rogers-yvonne",
    "alsd_listing.html": "https://www.alsd.uscourts.gov/judges-information",
    "alsd_judge_dubose.html": "https://www.alsd.uscourts.gov/judges/us-district-judge-kristi-k-dubose",
    "kyed_listing_table.html": "https://www.kyed.uscourts.gov/judges",
    "cod_listing.html": "http://www.cod.uscourts.gov/JudicialOfficers.aspx",
    "cod_judge_domenico.html": "http://www.cod.uscourts.gov/JudicialOfficers/ActiveArticleIIIJudges/HonDanielDDomenico.aspx",
}


class ListingParsers(unittest.TestCase):
    def entries(self, name):
        return pl.judge_entries(fixture(name), URL[name])

    def test_nysd_drupal10_list_of_honorifics(self):
        es = self.entries("nysd_listing_district.html")
        self.assertEqual(len(es), 47)
        self.assertEqual(es[0].name_text, "Hon. Ronnie Abrams")
        self.assertEqual(es[0].url, "https://www.nysd.uscourts.gov/hon-ronnie-abrams")
        self.assertEqual(es[0].listing_title, "United States District Judges")
        names = [e.name_text for e in es]
        self.assertIn("Hon. Alison J. Nathan Circuit Judge Sitting by Designation", names)  # a judge page, kept whole as published
        self.assertTrue(all(e.url.startswith("https://www.nysd.uscourts.gov/hon-") for e in es))

    def test_nysd_filters_and_quicklinks_are_not_judges(self):
        urls = {e.url for e in self.entries("nysd_listing_district.html")}
        self.assertNotIn("https://www.nysd.uscourts.gov/judges/magistrate-judges", urls)
        self.assertNotIn("https://www.nysd.uscourts.gov/judges/law-clerk-hiring-information", urls)

    def test_cand_titles_in_link_text_and_headings(self):
        es = {e.name_text: e for e in self.entries("cand_listing.html")}
        self.assertEqual(len(es), 36)
        e = es["Charles R. Breyer, Senior District Judge"]
        self.assertEqual(e.role_text, "Senior District Judge")
        self.assertEqual(e.heading, "District Judges")
        self.assertEqual(es["Nathanael Cousins, Chief Magistrate Judge"].role_text, "Chief Magistrate Judge")
        self.assertEqual(es["Laurel Beeler, Magistrate Judge"].heading, "Magistrate Judges")

    def test_alsd_drupal7_menu_title_for_senior_judges(self):
        es = {e.name_text: e for e in self.entries("alsd_listing.html")}
        self.assertEqual(len(es), 11)
        # the page text says only "Judge ..."; the site's own menu entry for the same page carries the full title
        self.assertEqual(es["Judge Callie V. S. Granade"].menu_role, "Senior U.S. District Judge")
        self.assertEqual(es["Judge William E. Cassady"].menu_role, "U.S. Magistrate Judge on Recall")

    def test_kyed_table_columns_give_the_heading(self):
        es = {e.name_text: e for e in self.entries("kyed_listing_table.html")}
        self.assertEqual(len(es), 10)  # five district, one senior, four magistrate judges
        self.assertEqual(es["David L. Bunning"].heading, "DISTRICT JUDGES")
        self.assertEqual(es["Danny C. Reeves"].heading, "SENIOR JUDGES")
        self.assertEqual(es["Edward B. Atkins"].heading, "MAGISTRATE JUDGES")

    def test_cod_dnn_aspx_headings(self):
        es = {e.name_text: e for e in self.entries("cod_listing.html")}
        self.assertEqual(len(es), 24)
        self.assertEqual(es["Hon. John L. Kane"].heading, "Senior Article III Judges")
        self.assertEqual(es["Hon. Richard T. Gurley"].heading, "Article I Magistrate Judges")

    def test_no_contact_details_in_entries(self):
        for name in URL:
            if "listing" in name:
                for e in self.entries(name):
                    self.assertNotIn("@", e.name_text + e.block)
                    self.assertFalse(re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", e.block))


class JudgePages(unittest.TestCase):
    def page(self, name, level="district", entry=None):
        return pl.parse_judge_page(fixture(name), URL[name], court_level=level, entry=entry)

    def test_nysd_liman_documents_with_dates_and_no_hiring_page(self):
        jp = self.page("nysd_judge_liman.html")
        self.assertEqual(jp.name_as_published, "Hon. Lewis J. Liman")
        self.assertEqual(jp.name, "Lewis J. Liman")
        titles = [d.title for d in jp.documents]
        self.assertEqual(titles, ["Case Management Plan and Scheduling Order", "Individual Practices in Civil Cases",
                                  "Individual Practices in Criminal Cases", "Model Protective Order", "Policy on the Use of Electronic Devices"])
        civil = jp.documents[1]
        self.assertEqual((civil.date_text, civil.date, civil.file_type, civil.kind), ("April 7th, 2025", "2025-04-07", "pdf", "file"))
        self.assertTrue(civil.url.endswith("Individual%20Practices%20in%20Civil%20Cases_updated%204.7.2025.pdf"))
        self.assertIn("Law Clerk and Intern Hiring Information", [x["title"] for x in jp.excluded])

    def test_nysd_magistrate_judge_page(self):
        jp = self.page("nysd_judge_parker_magistrate.html")
        self.assertEqual(jp.name, "Katharine H. Parker")
        self.assertEqual(len(jp.documents), 13)
        self.assertEqual(jp.documents[1].title, "Use of AI Rule")
        self.assertEqual(jp.documents[1].date, "2025-11-12")

    def test_nysd_title_comes_from_the_listing_it_sits_under(self):
        es = pl.judge_entries(fixture("nysd_listing_district.html"), URL["nysd_listing_district.html"])
        liman = next(e for e in es if e.name_text == "Hon. Lewis J. Liman")
        jp = self.page("nysd_judge_liman.html", entry=liman)
        self.assertEqual(jp.title_as_published, "United States District Judges")
        self.assertEqual(jp.title_source, "listing page heading")
        self.assertEqual((jp.title_class, jp.title_basis), ("district_judge", "listing"))

    def test_cand_title_in_page_heading_and_standing_orders(self):
        jp = self.page("cand_judge_ygr.html")
        self.assertEqual(jp.name, "Yvonne Gonzalez Rogers")
        self.assertEqual(jp.title_as_published, "Chief District Judge")
        self.assertEqual(jp.title_class, "chief_district_judge")
        names = [d.title for d in jp.documents]
        self.assertIn("Judge Gonzalez Rogers' Civil Standing Order", names)
        self.assertEqual(len(jp.documents), 7)
        self.assertTrue(all(d.url.startswith("https://www.cand.uscourts.gov/sites/default/files/standing-orders/") for d in jp.documents))

    def test_alsd_title_below_heading_and_no_documents(self):
        jp = self.page("alsd_judge_dubose.html")
        self.assertEqual(jp.name, "Kristi K. DuBose")
        self.assertEqual(jp.title_as_published, "U.S. District Judge")
        self.assertEqual(jp.title_class, "district_judge")
        self.assertEqual(jp.documents, [])  # the page lists only a "Communication" tab: address and telephone, which are not kept

    def test_cod_title_of_document_is_the_row_label_not_pdf(self):
        jp = self.page("cod_judge_domenico.html")
        titles = [(d.title, d.file_type) for d in jp.documents]
        self.assertEqual(titles[0], ("Practice Standards - Civil (Revised December 1, 2025)", "pdf"))
        self.assertIn(("Exhibit List", "doc"), titles)
        self.assertEqual(jp.documents[0].date, "2025-12-01")
        self.assertIsNone(jp.documents[1].date)  # "(Redline)" states no date

    def test_nothing_personal_is_extracted(self):
        for name in URL:
            if "judge" in name and "listing" not in name:
                jp = self.page(name)
                blob = repr(jp)
                self.assertNotIn("@", blob)
                self.assertFalse(re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", blob))


class Titles(unittest.TestCase):
    def test_role_phrase(self):
        self.assertEqual(pl.role_phrase("Chief U.S. District Judge Jeffrey U. Beaverstock"), "Chief U.S. District Judge")
        self.assertEqual(pl.role_phrase("Yvonne Gonzalez Rogers, Chief District Judge"), "Chief District Judge")
        self.assertEqual(pl.role_phrase("Hon. Alison J. Nathan Circuit Judge Sitting by Designation"), "Circuit Judge Sitting by Designation")
        self.assertEqual(pl.role_phrase("Senior Judge"), "Senior Judge")
        self.assertEqual(pl.role_phrase("U.S. Magistrate Judge Cassady on Recall"), "U.S. Magistrate Judge on Recall")
        self.assertIsNone(pl.role_phrase("Courtroom 15C"))
        self.assertEqual(pl.role_phrase("James B. Clark, III United States Magistrate Judge"), "United States Magistrate Judge")  # III is the name's
        self.assertEqual(pl.role_phrase("Article III Judge"), "Article III Judge")

    def test_classify_title(self):
        c = pl.classify_title
        self.assertEqual(c("Senior U.S. District Judge", "district"), ("senior_district_judge", "text"))
        self.assertEqual(c("Chief Magistrate Judge", "district"), ("chief_magistrate_judge", "text"))
        self.assertEqual(c("Chief Judge", "district"), ("chief_district_judge", "court_type"))
        self.assertEqual(c("Chief Judge", "bankruptcy"), ("chief_bankruptcy_judge", "court_type"))
        self.assertEqual(c("Judge", "district"), (None, None))  # nothing says district, senior or magistrate
        self.assertEqual(c("Senior Circuit Judge", "district")[0], "other")
        self.assertEqual(c("Active Article III Judges", "district")[0], "district_judge")
        self.assertEqual(c(None, "district"), (None, None))

    def test_judge_link_text(self):
        ok = ["Hon. Ronnie Abrams", "Judge Terry F. Moorer", "Vince Chhabria, District Judge", "U.S. Magistrate Judge Bivins",
              "Chief Judge Bess M. Parrish Creswell", "Judge Joseph G. Rosania, Jr. (JGR)"]
        no = ["Judge Information", "Judges' Calendars", "Judicial Conduct & Disability", "Judges", "U.S. Bankruptcy Judge",
              "Judge Biographies", "Magistrate Judge Vacancy in the Northern District", "Judge's Procedures", "Judge Search"]
        for t in ok:
            self.assertTrue(pl.looks_like_judge_link(t), t)
        for t in no:
            self.assertFalse(pl.looks_like_judge_link(t), t)

    def test_strip_name_and_norm_name(self):
        self.assertEqual(pl.strip_name("Hon. Lewis J. Liman"), "Lewis J. Liman")
        self.assertEqual(pl.strip_name("Vince Chhabria, District Judge"), "Vince Chhabria")
        self.assertEqual(pl.strip_name("Chief Judge Bess M. Parrish Creswell"), "Bess M. Parrish Creswell")
        self.assertEqual(pl.strip_name("Judge Joseph G. Rosania, Jr. (JGR)"), "Joseph G. Rosania, Jr.")
        self.assertEqual(pl.norm_name("Hon. Andrew L. Carter Jr."), pl.norm_name("Andrew L. Carter"))

    def test_former_judges_are_not_roster_entries(self):
        self.assertTrue(pl.is_former("https://www.mdb.uscourts.gov/judges-info/portraits/paul-mannes", ()))
        self.assertTrue(pl.is_former("https://x.uscourts.gov/judges/a-b", ("Retired Judges",)))
        self.assertIsNone(pl.is_former("https://x.uscourts.gov/judges/a-b", ("Senior Judges",)))


class Dates(unittest.TestCase):
    def test_dates_only_when_printed(self):
        p = pl.parse_date
        self.assertEqual(p("April 7th, 2025"), ("April 7th, 2025", "2025-04-07"))
        self.assertEqual(p("Revised 4/7/25"), ("4/7/25", "2025-04-07"))
        self.assertEqual(p("updated 12/01/2025"), ("12/01/2025", "2025-12-01"))
        self.assertEqual(p("Practice Standards (Revised December 1, 2025)"), ("December 1, 2025", "2025-12-01"))
        self.assertEqual(p("Revised January 2025"), ("January 2025", None))  # month and year only: shown as printed, no day invented
        self.assertEqual(p("Individual Practices"), (None, None))
        self.assertEqual(p("Order 13/45/2025"), (None, None))


class Documents(unittest.TestCase):
    def test_detect_type_uses_bytes_not_the_url(self):
        self.assertEqual(xt.detect_type(b"%PDF-1.7\n", "pdf"), "pdf")
        self.assertEqual(xt.detect_type(b"<!DOCTYPE html><html><body>Not found</body></html>", "pdf"), "html")
        self.assertEqual(xt.detect_type(b"PK\x03\x04....", "docx"), "docx")
        self.assertEqual(xt.detect_type(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "doc"), "doc")
        self.assertEqual(xt.detect_type(b"{\\rtf1\\ansi", None), "rtf")

    def test_redaction(self):
        text = "\n".join([
            "Send proposed orders to chambers@example.gov or call (212) 805-0000 ext. 12.",
            "Courtroom Deputy: Jane Q. Public, (212) 805-0001",
            "The law clerk will review the submission.",
            "Case No. 1:20-cv-01234 was filed on 12/01/2025.",
        ])
        out, n = xt.redact(text)
        self.assertNotIn("@", out)
        self.assertNotIn("805-0000", out)
        self.assertNotIn("Jane", out)
        self.assertIn("The law clerk will review the submission.", out)  # no name and no contact: kept
        self.assertIn("1:20-cv-01234", out)
        self.assertEqual((n["emails"], n["phones"], n["staff_lines"]), (1, 1, 1))

    def test_cap_keeps_whole_lines_and_says_when_truncated(self):
        text = "\n".join(f"line {i} " + "x" * 50 for i in range(2000))
        capped, truncated, total = xt.cap(text, 10_000)
        self.assertTrue(truncated)
        self.assertEqual(total, len(text))
        self.assertLessEqual(len(capped), 10_000)
        self.assertTrue(capped.endswith("x" * 50))

    def test_html_document_text_drops_navigation(self):
        html = (b"<html><body><nav>Home Judges</nav><div id='content'><h1>Procedures</h1><p>" + b"Parties shall confer. " * 10 +
                b"</p></div><footer>Contact</footer></body></html>")
        out = xt.html_text(html)
        self.assertIn("Parties shall confer.", out.text)
        self.assertNotIn("Home Judges", out.text)


class Fetching(unittest.TestCase):
    def test_one_clock_per_court_site(self):
        self.assertEqual(fl.pace_key("www.cand.uscourts.gov"), "cand")
        self.assertEqual(fl.pace_key("ecf.cand.uscourts.gov"), "cand")
        self.assertEqual(fl.pace_key("apps.cacd.uscourts.gov"), "cacd")
        self.assertEqual(fl.pace_key("www.example.org"), "www.example.org")

    def test_page_store_path_is_stable(self):
        a = fl.page_path("https://www.nysd.uscourts.gov/judges")
        self.assertEqual(a, fl.page_path("https://www.nysd.uscourts.gov/judges"))
        self.assertNotEqual(a, fl.page_path("https://www.nysd.uscourts.gov/judges?x=1"))


class SurnamesThatSpellWords(unittest.TestCase):
    """Real surnames that contain or spell page words (Laplante, Casey, Feeney, Chambers) are names; page labels are not."""

    def test_stop_words_match_whole_words_only(self):
        for name in ("Joseph N. Laplante", "Patrick Casey Pitts", "Mary Feeney", "Lienau Smith", "Robert C. Chambers"):
            self.assertTrue(pl.person_like(pl.strip_name(name)), name)
        for label in ("Case Information", "Chambers Procedures", "Court Forms", "Local Rules"):
            self.assertFalse(pl.is_person_name(label), label)
        self.assertEqual(pl.strip_name("Robert C. Chambers"), "Robert C. Chambers")
        self.assertEqual(pl.strip_name("Judge Smith Chambers"), "Smith")

    def test_accented_last_first_and_honorific_after_the_title(self):
        self.assertEqual(pl.reorder_last_first("Márquez, Rosemary"), "Rosemary Márquez")
        self.assertEqual(pl.strip_name("Chief Judge Honorable Laura Taylor Swain"), "Laura Taylor Swain")
        self.assertEqual(pl.resolve_name(["Márquez, Rosemary"])[1], "Rosemary Márquez")

    def test_link_text_that_runs_on_into_telephone_numbers_keeps_the_name_and_title(self):
        t = pl.trim_long_judge_text
        self.assertEqual(t("Carol Bagley Amon District Judge Secretary: (718) 613-2410 Courtroom Deputy: Jane Roe"), "Carol Bagley Amon District Judge")
        self.assertEqual(t("Joan M. Azrack District Judge Brooklyn: (718) 613-2530 Central Islip: (631) 712-5600"), "Joan M. Azrack District Judge")
        self.assertIsNone(t("Hon. Alison J. Nathan Circuit Judge Sitting by Designation"))  # nothing but name and title: kept as printed
        self.assertIsNone(t("Judge Information and Procedures for Attorneys"))
        es = pl.judge_entries(b"<html><body><main><h1>Judges</h1><ul>"
                              b"<li><a href='/district-judge-carol-amon'>Carol Bagley Amon District Judge Secretary: (718) 613-2410 Courtroom Deputy: Jane Roe</a></li>"
                              b"<li><a href='/district-judge-frederic-block'>Frederic Block District Judge Chambers: (718) 613-2420 Courtroom Deputy: Joe Doe</a></li>"
                              b"</ul></main></body></html>", "https://www.nyed.uscourts.gov/district-judges")
        self.assertEqual([e.name_text for e in es], ["Carol Bagley Amon District Judge", "Frederic Block District Judge"])
        self.assertNotIn("718", str([e.name_text for e in es]))  # no telephone number is carried


class CaseSpecificFilings(unittest.TestCase):
    """A judge's page may link the judge's decisions in particular cases; those are not rules or practices."""

    def test_decisions_are_left_out_and_practice_documents_kept(self):
        cs = pl.case_specific
        self.assertIsNotNone(cs("OPINION AND ORDER DENYING AMENDED PETITION FOR WRIT OF HABEAS CORPUS", "17-11356: LEONARD WARE v. SHAWN BREWER"))
        self.assertIsNotNone(cs("Scheduling Order", "06-14431 (civil) 99-20011 (criminal) : Robinson v. United States of America"))
        self.assertIsNotNone(cs("In re Peterson, 566 B.R. 179 (Bankr. M.D. Tenn. Apr. 7, 2017)", "Judge Tabs"))
        self.assertIsNotNone(cs("Harley-Davidson v. The Partnerships", "Judge Thomas M. Durkin"))
        self.assertIsNone(cs("Print All Practice Guidelines", "Trials +"))
        self.assertIsNone(cs("Vest v. Freightliner (Wrongful Death)", "Sample Jury Instructions"))          # a sample the judge posts
        self.assertIsNone(cs("In re: Possession and Use of Personal Electronic Devices", "Federal Judicial Service"))  # an administrative order
        self.assertIsNone(cs("Order Granting Motion to Extend Automatic Stay", "Judge Tabs"))                 # the judge's form of order

    def test_document_links_reports_why(self):
        html = (b"<html><body><main><h2>17-11356: LEONARD WARE v. SHAWN BREWER</h2><p><a href='/pdffiles/17-11356Opn.pdf'>OPINION AND ORDER</a></p>"
                b"<h2>Practice Guidelines</h2><p><a href='/pdffiles/guidelines.pdf'>Civil Practice Guidelines</a></p></main></body></html>")
        links = pl.extract_links(html, "https://www.mied.uscourts.gov/judges/lawson")
        docs, excluded = pl.document_links(links, "https://www.mied.uscourts.gov/judges/lawson", {"www.mied.uscourts.gov"})
        self.assertEqual([d.title for d in docs], ["Civil Practice Guidelines"])
        self.assertTrue(excluded and "docket number heading" in excluded[0]["reason"])


class JudgePageText(unittest.TestCase):
    """A judge's own page that carries the judge's practices in its text: when it counts, and what is left out of the stored text."""

    PRACTICES = ("Page limits: opening and opposition briefs may not exceed twenty-five pages and replies may not exceed ten pages. "
                 "Courtesy copies: send one courtesy copy of every motion over fifty pages to chambers. Proposed orders must be submitted with every motion. "
                 "Discovery disputes: do not file a motion; call chambers to arrange a conference. A continuance is granted only for good cause. "
                 "Pretrial conference: counsel must file a joint pretrial statement. Summary judgment motions require a pre-motion letter. ") * 3
    PAGE = ("<html><body><main><h1>District Judge Jane Roe</h1><p>Courtroom Deputy:</p><p>Mary Smith, Phone: (555) 123-4567, Email: mary_smith@example.gov</p>"
            "<p>Judicial Assistant:</p><p>John Doe (555) 765-4321</p><h2>Practices</h2><p>" + PRACTICES + "</p></main></body></html>").encode()
    BIO = ("<html><body><main><h1>District Judge Jane Roe</h1><p>" + "Judge Roe was born in Ohio, graduated from State University and practiced law. " * 40
           + "</p></main></body></html>").encode()

    def test_only_a_page_that_states_practices_counts(self):
        self.assertIsNotNone(xt.inline_practices(self.PAGE))
        self.assertIsNone(xt.inline_practices(self.BIO))
        self.assertIsNone(xt.inline_practices(b"<html><body><main><h1>Judge Roe</h1><p>Page limits and proposed orders.</p></main></body></html>"))

    def test_staff_blocks_in_the_header_are_left_out_of_the_text(self):
        ex = xt.inline_practices(self.PAGE)
        text, counts = xt.redact_page(ex.text)
        for leaked in ("Mary Smith", "John Doe", "mary_smith", "555", "@"):
            self.assertNotIn(leaked, text)
        self.assertIn("[staff contact block omitted]", text)
        self.assertIn("Page limits: opening and opposition briefs", text)  # prose is never dropped
        self.assertGreaterEqual(counts["staff_blocks"], 1)  # chained labels are one block

    def test_prose_that_mentions_a_courtroom_deputy_is_kept_unless_it_names_one(self):
        keep, _ = xt.drop_staff_blocks("Intro\nCourtroom deputies schedule hearings through the calendar clerk and they answer questions about filing by phone.\nEnd")
        self.assertIn("answer questions about filing", keep)


class CourtAbbreviationsAndPageTitles(unittest.TestCase):
    """Sites that print "Sr. Judge" and "Mag. Judge", and judge pages titled by what they hold ("Procedures for Hearings before Hon. ...")."""

    def test_sr_and_mag_are_read_as_senior_and_magistrate(self):
        c = pl.classify_title
        self.assertEqual(c("Sr. Judge", "district"), ("senior_district_judge", "court_type"))
        self.assertEqual(c("Mag. Judge", "district"), ("magistrate_judge", "text"))
        self.assertEqual(pl.role_phrase("Sr. Judge Paul A. Magnuson"), "Sr. Judge")
        self.assertEqual(pl.strip_name("Sr. Judge Paul A. Magnuson"), "Paul A. Magnuson")
        self.assertEqual(pl.strip_name("Mag. Judge Elizabeth Cowan Wright"), "Elizabeth Cowan Wright")

    def test_text_roster_reads_the_abbreviated_titles(self):
        html = (b"<html><body><main><h1>Chambers Contact Information</h1><h2>U.S. District Court Judges</h2>"
                b"<p>Chief Judge Eric C. Tostrud</p><p>Sr. Judge Paul A. Magnuson</p>"
                b"<h2>U.S. District Court Magistrate Judges</h2><p>Mag. Judge Leo I. Brisbois</p></main></body></html>")
        es = pl.text_roster(html, "https://www.mnd.uscourts.gov/chambers-contact-information")
        self.assertEqual([e.name_text for e in es], ["Chief Judge Eric C. Tostrud", "Sr. Judge Paul A. Magnuson", "Mag. Judge Leo I. Brisbois"])
        titles = [pl.entry_only_judge(e, "district") for e in es]
        self.assertEqual([t.name for t in titles], ["Eric C. Tostrud", "Paul A. Magnuson", "Leo I. Brisbois"])
        self.assertEqual([t.title_class for t in titles], ["chief_district_judge", "senior_district_judge", "magistrate_judge"])
        self.assertEqual(titles[1].title_as_published, "Sr. Judge")  # as printed, never expanded

    def test_name_from_a_procedures_page_title(self):
        self.assertEqual(pl.strip_name("Procedures for Hearings before Hon. Frank J. Santoro - Norfolk"), "Frank J. Santoro")
        self.assertEqual(pl.strip_name("Procedures for Hearings before Hon. Brian F. Kenney, Chief Judge"), "Brian F. Kenney")
        self.assertEqual(pl.strip_name("Hon. Lewis J. Liman"), "Lewis J. Liman")
        self.assertEqual(pl.strip_name("Procedures for Hearings before Hon.Klinette H. Kindred"), "Klinette H. Kindred")
        # the name is reported as the page prints it, without the words around it and without the location suffix
        self.assertEqual(pl.resolve_name(["Procedures for Hearings before Hon. Frank J. Santoro - Norfolk"]), ("Hon. Frank J. Santoro", "Frank J. Santoro"))
        self.assertEqual(pl.resolve_name(["Procedures for Hearings before Hon.Klinette H. Kindred"]), ("Hon. Klinette H. Kindred", "Klinette H. Kindred"))

    def test_surname_only_names_take_the_full_name_only_when_the_page_prints_exactly_one(self):
        f = pl.full_name_from_text
        self.assertEqual(f("Judge Maddox Home Judge Selene D. Maddox Calendars", "Maddox"), ("Judge Selene D. Maddox", "Selene D. Maddox"))
        self.assertIsNone(f("Judge Maddox Judge Maddox Calendars", "Maddox"))                    # only menu entries
        self.assertIsNone(f("Judge Pat Jones and Judge Sam Jones", "Jones"))                     # two different people
        self.assertTrue(pl.person_like("James A Soto") and pl.person_like("M. Page Kelley") and pl.person_like("Denise Page Hood"))
        self.assertFalse(pl.person_like("Remote Access") or pl.person_like("Page Information") or pl.person_like("Role of the Judge"))

    def test_breadcrumb_in_capitals_and_page_labels(self):
        self.assertEqual(pl.strip_name("HOME >> JUDGES > CHIEF JUDGE JACOB A. BROWN"), "Jacob A. Brown")
        self.assertFalse(pl.person_like("Remote Access"))
        self.assertTrue(pl.person_like("Jacob A. Brown"))

    def test_retired_and_deceased_marks_in_a_listing(self):
        self.assertTrue(pl.former_marker("Judge Diane Finkle (ret.)"))
        self.assertTrue(pl.former_marker("Judge Arthur N. Votolato (dec.)"))
        self.assertIsNone(pl.former_marker("Judge John A. Dorsey"))

    def test_text_roster_splits_lines_and_does_not_share_a_rows_links(self):
        html = (b"<html><body><main><table><tr><td><p><strong>District Judges</strong></p>"
                b"<p>Hon. Leonie M. Brinkema<br/>Hon. Rossie David Alston, Jr.</p>"
                b"<p><strong>Magistrate Judges</strong></p><p>Hon. Ivan D. Davis<br/>Hon. John F. Anderson (<em>Recall Status</em>)</p></td>"
                b"<td><ul><li><a href='/files/telephone.pdf'>Telephone Directory</a></li></ul></td></tr></table></main></body></html>")
        es = pl.text_roster(html, "https://www.vaed.uscourts.gov/Alexandria")
        self.assertEqual([pl.strip_name(e.name_text) for e in es], ["Leonie M. Brinkema", "Rossie David Alston, Jr.", "Ivan D. Davis", "John F. Anderson"])
        self.assertEqual([e.heading for e in es], ["District Judges", "District Judges", "Magistrate Judges", "Magistrate Judges"])
        self.assertTrue(all(not e.docs for e in es))
        js = [pl.entry_only_judge(e, "district") for e in es]
        self.assertEqual([j.title_class for j in js], ["district_judge", "district_judge", "magistrate_judge", "magistrate_judge"])


class RosterRowsAndWrapperPages(unittest.TestCase):
    def test_first_line_roster_keeps_the_name_and_the_rows_documents_but_not_the_number(self):
        html = (b"<html><body><main><h2>District Judges</h2><table>"
                b"<tr><td>Judge John D. Rainey<br/>(361) 788-5030</td><td><a href='/sites/txs/files/rainey%20procedures.pdf'>view procedures</a></td></tr>"
                b"<tr><td>Judge Nelva Gonzales Ramos<br/>(361) 693-6457</td><td><a href='/sites/txs/files/ramos-rules.pdf'>view local rules</a></td></tr>"
                b"</table></main></body></html>")
        base = "https://www.txs.uscourts.gov/page/district-magistrate-judges-procedures-schedules"
        self.assertEqual(pl.text_roster(html, base), [])  # without the option a name with a number under it is not read
        es = pl.text_roster(html, base, first_line=True)
        self.assertEqual([pl.strip_name(e.name_text) for e in es], ["John D. Rainey", "Nelva Gonzales Ramos"])
        self.assertFalse(any(re.search(r"\d{3}", e.name_text or "") for e in es))
        self.assertEqual([[d.href.rsplit("/", 1)[-1] for d in e.docs] for e in es], [["rainey%20procedures.pdf"], ["ramos-rules.pdf"]])

    def test_override_regexes_accept_percent_escapes_in_capitals(self):
        import json

        with open(os.path.join(HERE, "site_overrides.json"), encoding="utf-8") as h:
            ov = json.load(h)
        links = [pl.Link(text="United States District Judge Diana Saldaña", href="https://www.txs.uscourts.gov/content/united-states-district-judge-diana-salda%C3%B1a",
                         chrome=False, heading=None, headings=(), block="")]
        got = pl.regex_entries(links, ov["txsd"]["entry_href_regex"], main_only=True)
        self.assertEqual(len(got), 1)
        self.assertTrue(re.search(ov["azd"]["entry_href_regex"], "https://www.azd.uscourts.gov/judge-orders/m%C3%A1rquez-rosemary"))

    def test_a_cms_file_page_with_the_site_header_in_its_main_region_gives_its_file(self):
        import fetch_docs as fd

        header = "<p>" + "Skip to main content United States Bankruptcy Court Northern District of Georgia " * 12 + "</p>"
        html = (f"<html><head><title>pwb_rome_date.pdf | Northern District of Georgia</title></head><body><main>{header}"
                "<a href='/sites/default/files/romepwbupdatefeb2026.pdf'>pwb_rome_date.pdf</a></main></body></html>").encode()
        self.assertEqual(fd.wrapper_file(html, "https://www.ganb.uscourts.gov/file/pwbdatesrome"),
                         "https://www.ganb.uscourts.gov/sites/default/files/romepwbupdatefeb2026.pdf")
        other = html.replace(b"pwb_rome_date.pdf</a>", b"Local rules</a>")  # a link whose text is not the page's title is not a wrapper of long pages
        self.assertIsNone(fd.wrapper_file(other, "https://www.ganb.uscourts.gov/file/pwbdatesrome"))


class AppAdapters(unittest.TestCase):
    """Courts whose pages are single-page apps: the judges and documents come from the court's own JSON service (stored fixtures, no network)."""

    @staticmethod
    def fake_get_page(mapping):
        from types import SimpleNamespace as NS

        def get_page(url, refresh=False):
            body = mapping.get(url)
            if body is None:
                return NS(ok=False, body=None, final_url=url, status=404, blocked=None, error=None, cached=True, sha256=None)
            return NS(ok=True, body=body, final_url=url, status=200, blocked=None, error=None, cached=True, sha256="0" * 64)

        return get_page

    def test_cacd_judges_titles_documents_and_placeholder(self):
        from unittest import mock

        import adapter_cacd as ac

        mapping = {ac.LIST_URL: fixture("cacd_judge_list.json"),
                   f"{ac.API}/judge/0c70dff4-48eb-46eb-3e9d-08ddece20de6": fixture("cacd_judge_detail_gee.json")}
        result = {"listing_pages": [], "judges": [], "problems": []}
        with mock.patch.object(ac.fl, "get_page", side_effect=self.fake_get_page(mapping)):
            out = ac.crawl({"level": "district"}, {}, False, False, result)
        by = {j["name"]: j for j in out["judges"]}
        self.assertEqual(set(by), {"Dolly M. Gee", "Percy Anderson", "Alka Sagar"})  # the "Visiting" placeholder is not a person
        self.assertTrue(any("placeholder 'Visiting District Judge'" in p for p in out["problems"]))
        gee = by["Dolly M. Gee"]
        self.assertEqual((gee["title_as_published"], gee["title_class"]), ("Chief Judge", "chief_district_judge"))
        self.assertEqual(gee["page_url"], "https://apps.cacd.uscourts.gov/Jps/honorable-dolly-m-gee")
        self.assertEqual([(d["title"], d["file_type"]) for d in gee["documents"]],
                         [("DMG Initial Standing Order.docx", "docx"), ("DMG - Rule16 Sched Conf Setting Order", "pdf")])
        self.assertEqual(gee["documents"][1]["url"], f"{ac.API}/file/d5968783-db1a-4733-8b0a-9f1ac5138d46")
        self.assertEqual(by["Alka Sagar"]["title_class"], "magistrate_judge")
        self.assertEqual(by["Percy Anderson"]["status"], 404)  # detail not served: recorded as unread, never guessed
        self.assertNotIn("phone", str(out).lower())  # nothing but names, titles, addresses and document titles is kept

    def test_hid_titles_from_the_service_and_document_addresses(self):
        from unittest import mock

        import adapter_hid as ah

        mapping = {ah.LIST_URL: fixture("hid_judges.json")}
        result = {"listing_pages": [], "judges": [], "problems": []}
        with mock.patch.object(ah.fl, "get_page", side_effect=self.fake_get_page(mapping)):
            out = ah.crawl({"level": "district"}, {}, False, False, result)
        by = {j["name"]: j for j in out["judges"]}
        self.assertEqual(set(by), {"Derrick K. Watson", "Jill A. Otake", "Wes Reber Porter", "Helen Gillmor"})
        self.assertEqual(by["Derrick K. Watson"]["title_class"], "chief_district_judge")
        self.assertEqual(by["Wes Reber Porter"]["title_class"], "magistrate_judge")
        self.assertEqual(by["Helen Gillmor"]["title_class"], "senior_district_judge")
        otake = by["Jill A. Otake"]  # the printed title is only "Judge": the service's own type field says District
        self.assertEqual((otake["title_as_published"], otake["title_class"], otake["title_basis"]), ("Judge", "district_judge", "court_data"))
        self.assertEqual(by["Wes Reber Porter"]["name_as_published"], "Mag. Judge Wes Reber Porter")
        docs = by["Derrick K. Watson"]["documents"]
        self.assertEqual(docs[0]["url"], "https://www.hid.uscourts.gov/cms/assets/c469aec9-f838-4845-ac11-44df5700d995")
        self.assertEqual(docs[1]["url"], "https://www.hid.uscourts.gov/reqrmts/DKW/DKW%20Standing%20Order%20Settlement%209%2022.pdf")
        self.assertEqual([d["file_type"] for d in docs], ["pdf", "pdf"])


class ManualRoster(unittest.TestCase):
    """A judge named in an override roster is recorded only when the name (and title) appear verbatim on the page named as the source."""

    PAGE = (b"<html><body><main><h1>Judges' Info</h1><h2>Judges</h2><p>Kimberly Bacher</p><p>Chief Bankruptcy Judge</p>"
            b"<a href='/x.pdf'>Judge Peter G. Cary, sitting by designation</a></main></body></html>")
    COURT = {"court_id": "tstb", "host": "www.tstb.uscourts.gov", "home_url": "https://www.tstb.uscourts.gov/", "level": "bankruptcy",
             "name": "Test Bankruptcy Court", "shared_with": []}

    def run_court(self, roster):
        from types import SimpleNamespace as NS
        from unittest import mock

        import crawl_courts as cc

        src = "https://www.tstb.uscourts.gov/judges-info"

        def fake_get_page(url, refresh=False):
            if url == src:
                return NS(ok=True, body=self.PAGE, final_url=url, status=200, blocked=None, error=None, cached=True, sha256="0" * 64)
            return NS(ok=False, body=None, final_url=url, status=404, blocked=None, error=None, cached=True, sha256=None)

        robots = NS(status=200, delay=None, allows=lambda u: True)
        override = {"listing_urls": [src], "skip_link_entries": True, "no_sublistings": True, "no_index_docs": True, "manual_roster": roster}
        with mock.patch.object(cc.fl, "robots_for", return_value=robots), mock.patch.object(cc.fl, "get_page", side_effect=fake_get_page), \
                mock.patch.object(cc, "home_body", return_value=(None, "test")), mock.patch.object(cc.fl, "request_count", return_value=0):
            return cc.crawl_court(self.COURT, override, False, False), src

    def test_verbatim_entries_are_recorded_with_the_title_as_printed(self):
        res, src = self.run_court([
            {"source_url": "https://www.tstb.uscourts.gov/judges-info", "name": "Kimberly Bacher", "title": "Chief Bankruptcy Judge",
             "evidence": "Kimberly Bacher\\s+Chief Bankruptcy Judge"},
            {"source_url": "https://www.tstb.uscourts.gov/judges-info", "name": "Peter G. Cary", "title": "Judge Peter G. Cary, sitting by designation",
             "evidence": "Judge Peter G\\. Cary, sitting by designation"},
        ])
        by = {j["name"]: j for j in res["judges"]}
        self.assertEqual(set(by), {"Kimberly Bacher", "Peter G. Cary"})
        self.assertEqual(by["Kimberly Bacher"]["title_class"], "chief_bankruptcy_judge")
        self.assertEqual(by["Peter G. Cary"]["title_class"], "other")
        self.assertTrue(all(j["listing_only"] for j in res["judges"]))
        self.assertEqual(res["problems"], [])

    def test_a_name_not_on_the_page_is_not_recorded(self):
        res, _ = self.run_court([
            {"source_url": "https://www.tstb.uscourts.gov/judges-info", "name": "Some Other Person", "title": "Bankruptcy Judge",
             "evidence": "Some Other Person"},
            {"source_url": "https://www.tstb.uscourts.gov/judges-info", "name": "Kimberly Bacher", "title": "Bankruptcy Judge"},  # no evidence given
            {"source_url": "https://www.tstb.uscourts.gov/missing", "name": "Kimberly Bacher", "evidence": "Kimberly Bacher"},
        ])
        self.assertEqual(res["judges"], [])
        self.assertEqual(len(res["problems"]), 3)


if __name__ == "__main__":
    unittest.main()
