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


if __name__ == "__main__":
    unittest.main()
