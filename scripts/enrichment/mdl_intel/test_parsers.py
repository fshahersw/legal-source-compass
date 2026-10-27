"""Unit tests for the mdl-intel parsers (run: python3 -m unittest scripts/enrichment/mdl_intel/test_parsers.py)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import build_courts_summary as bcs  # noqa: E402
import contact_redaction as cr  # noqa: E402
import extract_court_pages as ec  # noqa: E402
import parse_govinfo as pg  # noqa: E402
import parse_jpml as pj  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

SUMMARY = """
YEAR   HEARINGS    PANEL    MOTIONS FOR
2025      6        192          32               21              278              16               187            1,300        53
2008      6        254          96               85             3,182             23               158            8.210        51
Jan-Dec 2000      7           239          62          51          545           15              88           9,056        289
"""

CATEGORY = """
Year     Denied   Moot    Motion     Admin.   Stricken   Totals
                         Withdrawn   Closed
1973        5       -        -         -         -         5
2012       35       9        4         -         1        49
2013       25       7        4         -         -        99
Totals    564     201       173        2         4        944
"""

DISTRICT = """
  United States Judicial Panel on Multidistrict Litigation                                Report Date: 10/1/2026
 ALN              Anna M. Manasco (U.S. District Judge)           MDL -2406 IN RE: Blue Cross Blue Shield Antitrust Litigation                                                                    22           110
 CAC              James V. Selna (Sr. District Judge)             MDL -2151 IN RE: Toyota Motor Corp. Unintended Acceleration Litigation        5           466
                  Andre Birotte, Jr (U.S. District Judge)         MDL -2814 IN RE: Ford Motor Co. DPS6 PowerShift Transmission Products Liability Litigation                                      135         1,313
"""

NOTICE = """
DATE OF HEARING SESSION:                   September 25, 2025
LOCATION OF HEARING SESSION:               Santiago E. Campus U.S. Courthouse
                                    SECTION A
MDL No. 3160 − IN RE: ARCHERY PRODUCTS ANTITRUST LITIGATION
   Motion of plaintiff Shawn Butter to transfer the following actions to the United States District Court for the Western District of Pennsylvania:
               District of Minnesota
       BABST v. ARCHERY TRADE ASSOCIATION, INC., ET AL., C.A. No. 0:25−02721
       JANOCHOSKI v. HOYT ARCHERY, INC., ET AL., C.A. No. 0:25−02788
                                    SECTION B
MDL No. 2846 − IN RE: DAVOL, INC./C.R. BARD, INC., POLYPROPYLENE HERNIA MESH PRODUCTS
               LIABILITY LITIGATION
   Opposition of plaintiff Angela Krinn to transfer of the following action to the United States District Court for the Southern District of Ohio:
       KRINN v. LAL, ET AL., C.A. No. 1:25−00001
"""


class JpmlParsers(unittest.TestCase):
    def test_summary_rows_and_period_thousands(self):
        rows = pj.parse_summary_table(SUMMARY)
        self.assertEqual(rows[2025]["motions_granted"], 21)
        self.assertEqual(rows[2025]["tag_along_transfers"], 1300)
        self.assertEqual(rows[2008]["tag_along_transfers"], 8210)
        self.assertEqual(rows[2008]["printed"]["tag_along_transfers"], "8.210")
        self.assertEqual(rows[2000]["hearings"], 7)

    def test_category_table_drops_inconsistent_rows(self):
        rows = pj.parse_category_table(CATEGORY)
        self.assertEqual(rows[1973]["denied"], 5)
        self.assertEqual(rows[2012]["stricken"], 1)
        self.assertNotIn(2013, rows)  # printed total disagrees with components -> not stored

    def test_by_district_carries_district_down(self):
        rows = pj.parse_by_district(DISTRICT)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[2]["district"], "CAC")
        self.assertEqual(rows[2]["judge"], "Andre Birotte, Jr")
        self.assertEqual(rows[2]["total"], 1313)
        self.assertEqual(pj.report_date(DISTRICT), "2026-10-01")

    def test_hearing_location_lines_and_city(self):
        text = (
            "DATE OF HEARING SESSION:                   September 25, 2025\n\n"
            "LOCATION OF HEARING SESSION:               Santiago E. Campus U.S. Courthouse\n"
            "                                           Martha Vázquez Historical Courtroom, 2nd Floor\n"
            "                                           106 South Federal Place\n"
            "                                           Santa Fe, New Mexico 87501\n\n\n"
            "TIME OF HEARING SESSION: In those matters designated for oral argument, counsel\n"
        )
        out = pj.parse_hearing_notice(text)
        self.assertEqual(out["location"], "Santiago E. Campus U.S. Courthouse")
        self.assertEqual(out["location_lines"][-1], "Santa Fe, New Mexico 87501")
        self.assertEqual(len(out["location_lines"]), 4)
        self.assertEqual((out["location_city"], out["location_state"]), ("Santa Fe", "New Mexico"))

    def test_hearing_location_without_city_line_is_not_guessed(self):
        out = pj.parse_hearing_notice(NOTICE)
        self.assertEqual(out["location_lines"], ["Santiago E. Campus U.S. Courthouse"])  # "SECTION A" is not in the column
        self.assertIsNone(out["location_city"])
        self.assertIsNone(pj.parse_hearing_notice("no location here")["location_city"])

    def test_hearing_notice(self):
        out = pj.parse_hearing_notice(NOTICE)
        self.assertEqual(out["session_date"], "2025-09-25")
        a, b = out["matters"]
        self.assertEqual((a["section"], a["mdl"], a["actions_listed"]), ("A", 3160, 2))
        self.assertEqual(a["requested_district"], "Western District of Pennsylvania")
        self.assertEqual(b["section"], "B")
        self.assertIn("LIABILITY LITIGATION", b["title"])
        self.assertIsNone(b["requested_district"])

    def test_type_distribution_split_labels(self):
        text = "Products Liability:\n  61 MDLs, 33%\nAntitrust:\n46 MDLs, 24.9%\nNot A Type: 4 MDLs"
        self.assertEqual(pj.parse_type_distribution(text), {"Products Liability": 61, "Antitrust": 46})

    def test_archive_order_link(self):
        p = pj.parse_archive_order_link("MDL-3188 - Order Deeming Motion Withdrawn and Vacating the May 28, 2026, Hearing Session Order - 3 actions")
        self.assertEqual((p["mdl"], p["kind"], p["session"], p["scope"]), (3188, "withdrawn", "2026-05-28", "3 actions"))

    def test_order_pdf_operative(self):
        text = "Case MDL No. 3194 Document 54 Filed 10/02/26 Page 1 of 5 IN RE: ABBOTT LABORATORIES SPINAL CORD STIMULATOR PRODUCTS LIABILITY LITIGATION ... IT IS THEREFORE ORDERED that the actions listed on Schedule A are transferred to the Northern District of Illinois and, with the consent of that court, assigned to the Honorable Lindsay C. Jenkins, for coordinated or consolidated pretrial proceedings."
        out = pj.parse_order_pdf_text(text)
        self.assertEqual(out["filed"], "2026-10-02")
        self.assertEqual(out["transferee_district"], "Northern District of Illinois")
        self.assertEqual(out["transferee_judge"], "Lindsay C. Jenkins")


class GovInfoParser(unittest.TestCase):
    def test_transfer_order_text(self):
        t = "TRANSFER ORDER re: pldg. (2 in MDL No. 3138), (1 in MDL No. 3138) Transferring 2 action(s) to Judge Christine P. O'Hearn in the D. New Jersey.Signed by Judge Karen K. Caldwell, Chair, PANEL ON MULTIDISTRICT LITIGATION, on 2/6/2025. Associated Cases: MDL No. 3138"
        out = pg.parse_subtitle(t)
        self.assertEqual(out["kind"], "transfer_order")
        self.assertEqual(out["pleadings"], [1, 2])
        self.assertEqual(out["actions_transferred"], 2)
        self.assertEqual(out["transferee_judge"], "Christine P. O'Hearn")
        self.assertEqual(out["transferee_court"], "D. New Jersey")
        self.assertEqual(out["signed_date"], "2025-02-06")

    def test_denial_and_docket_sheet(self):
        self.assertEqual(pg.classify("ORDER DENYING TRANSFER re: pldg. (1 in MDL No. 3198)"), "order_denying_transfer")
        self.assertEqual(pg.classify("DOCKET SHEET (TL)"), "docket_sheet")
        self.assertEqual(pg.classify("MDL No. 2936, ARE/1:19-cv-00082 (TB)TRANSFER ORDER re: pldg. (1 in MDL No. 2936)"), "transfer_order")


class CourtPageExtractor(unittest.TestCase):
    HTML = b"""<html><head><title>MDL 3140</title></head><body><nav>Menu</nav><main>
    <h1>Depo-Provera MDL No. 3140</h1>
    <p>The first bellwether trial is set for March 2, 2027, before Judge Rodgers.</p>
    <table><tr><td><b>September 04, 2026</b></td><td><a href="/files/cmo17.pdf">Case Management Order 17</a></td><td>Appointment of lien resolution master</td></tr></table>
    <h3>Plaintiffs' Lead Counsel</h3><p>Jane Doe, Example LLP</p>
    </main></body></html>"""

    def test_quotes_orders_and_leadership(self):
        out = ec.extract(self.HTML, "https://www.flnd.uscourts.gov/mdl3140", "2026-10-18", 3140)
        self.assertTrue(out["mentions_mdl"])
        self.assertEqual(out["orders"][0]["date"], "2026-09-04")
        self.assertEqual(out["orders"][0]["kind"], "case_management_order")
        self.assertEqual(out["orders"][0]["number"], "17")
        bw = [q for q in out["quotes"] if q["category"] == "bellwether"]
        self.assertEqual(bw[0]["text"], "The first bellwether trial is set for March 2, 2027, before Judge Rodgers.")
        self.assertEqual(bw[0]["dates_mentioned"], ["2027-03-02"])
        self.assertEqual(out["leadership_blocks"][0]["lines"], ["Jane Doe, Example LLP"])

    def test_dates(self):
        self.assertEqual(ec.parse_date("9-11-2026"), ("9-11-2026", "2026-09-11"))
        self.assertEqual(ec.parse_date("2025.02.07 - PTO"), ("2025.02.07", "2025-02-07"))
        self.assertEqual(ec.parse_date("13/45/2026"), (None, None))

    def test_slug_rule(self):
        self.assertTrue(ec.shares_slug("https://www.njd.uscourts.gov/j-j-talcum-powder-orders", "https://www.njd.uscourts.gov/johnson-johnson-talcum-powder-litigation"))
        self.assertFalse(ec.shares_slug("https://www.njd.uscourts.gov/standing-orders", "https://www.njd.uscourts.gov/johnson-johnson-talcum-powder-litigation"))
        # a judge's biography page shares only court-administration words with the court's duty-judge schedules
        bio = "https://www.flsd.uscourts.gov/content/senior-judge-federico-Moreno"
        self.assertFalse(ec.shares_slug("https://www.flsd.uscourts.gov/duty-judge-assignment-schedule-district-judges", bio))
        self.assertFalse(ec.shares_slug("https://www.flsd.uscourts.gov/duty-judge-assignment-schedule-magistrate-judges", bio))


class CourtPageList(unittest.TestCase):
    def test_removed_entries_are_ledgered_and_not_fetched(self):
        import json

        pages = json.loads((Path(__file__).parent / "court_pages.json").read_text())
        removed = pages["_removed"]
        self.assertNotIn("2599", pages)  # not an MDL page (judge biography); see the ledger entry
        for mdl, entry in removed.items():
            if mdl.startswith("_"):
                continue
            self.assertNotIn(mdl, pages)
            self.assertTrue(entry["urls"] and entry["reason"] and entry["removed"])
        for key, urls in pages.items():
            if not key.startswith("_"):
                self.assertTrue(key.isdigit() and isinstance(urls, list) and all(u.startswith("https://") and ".uscourts.gov/" in u for u in urls), key)


class CachedRetrievalDate(unittest.TestCase):
    def test_cached_extraction_keeps_the_fetch_date(self):
        import os
        import tempfile
        from datetime import datetime, timezone

        import fetch_court_pages as fcp

        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "page.html"
            raw.write_bytes(b"<html></html>")
            fetched = datetime(2026, 10, 18, 8, 39, tzinfo=timezone.utc).timestamp()
            os.utime(raw, (fetched, fetched))
            self.assertEqual(fcp.retrieved_on(raw, refresh=False, today="2026-11-02"), "2026-10-18")  # cached copy: its fetch date
            self.assertEqual(fcp.retrieved_on(raw, refresh=True, today="2026-11-02"), "2026-11-02")  # live fetch: today
            self.assertEqual(fcp.retrieved_on(Path(tmp) / "absent", refresh=False, today="2026-11-02"), "2026-11-02")


class CourtTableRows(unittest.TestCase):
    # ILSD (MDL 3004) prints "</td" without ">" on one row; rows must keep their own dates.
    ILSD = b"""<html><body><main><h1>Paraquat Products Liability Litigation</h1><table>
    <tr><td style="width:132px">Date Posted</td><td>Date Signed</td><td>Description</td></tr>
    <tr><td style="width:132px">10-14-2026</td><td style="width:139px">10-14-2026</td>
    <td style="width:904px"><a href="/sites/ilsd/files/A.pdf"><span>VACATED 10-14-26: AMENDED ORDER re Hearing</span></a></td></tr>
    <tr><td style="width:132px">4-8-2026</td><td style="width:139px">4-8-2026</td>
    <td style="width:904px"><a href="/sites/ilsd/files/ParaquatCMO24.pdf" target="_new"><span>Order No. 24 - Providing Special Master with Access</span></a></td
    </tr>
    <tr><td style="width:132px">2-11-2026</td><td style="width:139px">2-11-2026</td>
    <td style="width:904px"><a href="/sites/ilsd/files/ParaquatCMO23.pdf" target="_new"><span>Order No. 23 - Relating to Voluntary Dismissals</span></a></td>
    </tr>
    <tr><td>1-5-2026</td><td>1-5-2026</td><td><a href="/sites/ilsd/files/B.pdf">Order Extending Stay</a></td></tr>
    </table>
    <p>Counsel appearing via WebEx should notify their respective liaison counsel two days in advance.</p>
    <p>The Court entered Order No. 22 reappointing Plaintiffs' leadership.</p>
    </main></body></html>"""

    def test_ilsd_rows_keep_their_own_dates(self):
        out = ec.extract(self.ILSD, "https://www.ilsd.uscourts.gov/paraquat-products-liability-litigation", "2026-10-18", 3004)
        by_url = {o["url"].rsplit("/", 1)[-1]: o for o in out["orders"]}
        self.assertEqual(by_url["ParaquatCMO24.pdf"]["date"], "2026-04-08")
        self.assertEqual(by_url["ParaquatCMO23.pdf"]["date"], "2026-02-11")
        self.assertEqual(by_url["B.pdf"]["date"], "2026-01-05")
        self.assertTrue(by_url["A.pdf"]["vacated"])
        self.assertEqual(len({o["row_text"] for o in out["orders"]}), len(out["orders"]))  # no container text
        lead = [q["text"] for q in out["quotes"] if q["category"] == "leadership"]
        self.assertEqual(lead, ["The Court entered Order No. 22 reappointing Plaintiffs' leadership."])

    def test_nested_unquoted_anchor_and_cand_docket_row(self):
        flnd = b"""<table><tr><td><strong><span>October 18, 2023</span></strong></td><td>
        <a href="/order-fairness"><a href=https://www.flnd.uscourts.gov/files/Order%20on%20Fairness.pdf target="_blank">Order on Fairness Hearing and Exhibits</a></a></td></tr></table>"""
        out = ec.extract(flnd, "https://www.flnd.uscourts.gov/mdl2885-orders-by-date", "2026-10-18", 2885)
        self.assertEqual([(o["date"], o["title"]) for o in out["orders"]], [("2023-10-18", "Order on Fairness Hearing and Exhibits")])
        cand = b"""<table><tr><td>10-16-26</td><td><a href="https://ecf.cand.uscourts.gov/doc1/1">3590</a></td><td>CASE MANAGEMENT ORDER NO. 38 (Appointing a Special Master)</td></tr>
        <tr><td>10-12-26</td><td><a href="https://ecf.cand.uscourts.gov/doc1/2">3565</a></td><td>TRANSCRIPT ORDER for proceedings held on 10/9/2026</td></tr></table>"""
        out = ec.extract(cand, "https://cand.uscourts.gov/cases-e-filing/cases/422-md-03047-ygr/x", "2026-10-18", 3047)
        self.assertEqual([(o["date"], o["title"][:28]) for o in out["orders"]], [("2026-10-16", "CASE MANAGEMENT ORDER NO. 38")])


class CourtLeadership(unittest.TestCase):
    # Modeled on the N.D. Ill. MDL detail page structure (MDL 3026): role headings in <span><strong>, consecutive
    # headings, counsel name and firm separated by <br> inside <td> cells. Names here are synthetic.
    ILND = b"""<html><body><main><h1>In re: Example Formula Products Liability Litigation, MDL No. 9026</h1>
    <div class='panel panel-default'><div class='panel-heading'><h4 class='panel-title'><a href='#c1'><i class='fa'></i>&nbsp;Lead Counsel List</a></h4></div>
    <div id='c1' class='panel-collapse'><div class='panel-body'>
    <span style="font-size: 14px;"><strong><span style="text-decoration: underline;"> PLAINTIFFS' COUNSEL </span></strong></span><br /><br />
    <span style="font-size: 14px;"><strong> Plaintiffs' Co-Lead Counsel </strong></span><br />
    <table class="table"><tr>
      <td> Anna B. Carter<br /> Carter // Dunn, PLLC <br /><br /> Ben Ellis<br /> Ellis, Fox &amp; Gray, LLP </td>
      <td> Cara Hale <br /> Hale Ives P.A. </td><td></td></tr></table>
    <span style="font-size: 14px;"><strong> Plaintiffs' Executive Committee </strong><span style="white-space:pre;"> </span></span><br />
    <table class="table"><tr><td> Dan Jones<br /> Jones &amp; Kay </td><td> Eve Lund<br /> Lund Mor </td></tr></table>
    <span style="font-size: 14px;"><strong>Plaintiffs' Liaison Counsel</strong></span><br />
    <table class="table"><tr><td> Anna B. Carter </td><td></td></tr></table>
    <span style="font-size: 14px;"><strong><span style="text-decoration: underline;">DEFENDANT'S LEAD COUNSEL</span></strong></span><br />
    <span style="font-size: 14px;"><br /></span>
    <span style="font-size: 14px;"><strong> Acme's Lead Counsel </strong></span><br />
    <table class="table"><tr><td> Fay Nash </td><td></td></tr></table>
    <span style="font-size: 14px;"><strong>Acme's Co-Liaison Counsel</strong></span><br />
    <table class="table"><tr><td> Gil Orr </td><td> Hal Poe </td></tr></table>
    </div></div></div>
    <div class='panel'><div class='panel-heading'><h4 class='panel-title'>Frequently Asked Questions</h4></div>
    <div class='panel-body'><p>Multidistrict litigation is litigation pending in more than one federal district.</p></div></div>
    </main></body></html>"""

    def test_blocks_do_not_overlap_and_keep_element_boundaries(self):
        out = ec.extract(self.ILND, "https://www.ilnd.uscourts.gov/mdl-details.aspx?x", "2026-10-18", 9026)
        blocks = {b["heading"]: b for b in out["leadership_blocks"]}
        self.assertEqual(list(blocks), ["Plaintiffs' Co-Lead Counsel", "Plaintiffs' Executive Committee", "Plaintiffs' Liaison Counsel", "Acme's Lead Counsel", "Acme's Co-Liaison Counsel"])
        self.assertEqual(blocks["Plaintiffs' Co-Lead Counsel"]["lines"], ["Anna B. Carter", "Carter // Dunn, PLLC", "Ben Ellis", "Ellis, Fox & Gray, LLP", "Cara Hale", "Hale Ives P.A."])
        self.assertEqual(blocks["Plaintiffs' Executive Committee"]["lines"], ["Dan Jones", "Jones & Kay", "Eve Lund", "Lund Mor"])  # printed text kept as is
        self.assertEqual(blocks["Plaintiffs' Liaison Counsel"]["lines"], ["Anna B. Carter"])
        self.assertEqual(blocks["Acme's Co-Liaison Counsel"]["lines"], ["Gil Orr", "Hal Poe"])
        self.assertEqual(blocks["Plaintiffs' Co-Lead Counsel"]["group"], "PLAINTIFFS' COUNSEL")
        self.assertEqual(blocks["Plaintiffs' Liaison Counsel"]["group"], "PLAINTIFFS' COUNSEL")
        self.assertEqual(blocks["Acme's Lead Counsel"]["group"], "DEFENDANT'S LEAD COUNSEL")
        every_line = [ln for b in out["leadership_blocks"] for ln in b["lines"]]
        self.assertFalse(any(ln in blocks for ln in every_line))  # no heading repeated as another block's line
        self.assertFalse(any("Multidistrict" in ln or ln.endswith("…") for ln in every_line))  # stops at the next h4; nothing cut
        self.assertEqual(blocks["Plaintiffs' Co-Lead Counsel"]["lines_total"], 6)

    def test_inline_label_nested_heading_and_line_cap(self):
        html = b"""<main><p><strong>Lead Counsel:</strong> Jane Doe, Example LLP</p>
        <h3><strong>Plaintiffs' Steering Committee</strong></h3><ul>""" + b"".join(b"<li>Member %d</li>" % i for i in range(ec.LEAD_LINES + 10)) + b"""</ul>
        <h2>Orders</h2><p>Order No. 1</p></main>"""
        blocks = ec.leadership_blocks(BeautifulSoup(html, "lxml").find("main"))
        self.assertEqual([b["heading"] for b in blocks], ["Lead Counsel:", "Plaintiffs' Steering Committee"])  # h3 > strong is one heading
        self.assertEqual(blocks[0]["lines"], ["Jane Doe, Example LLP"])
        self.assertEqual(len(blocks[1]["lines"]), ec.LEAD_LINES)
        self.assertEqual(blocks[1]["lines_total"], ec.LEAD_LINES + 10)
        self.assertNotIn("Order No. 1", blocks[1]["lines"])

    def test_column_tables_ecf_listings_order_titles_and_name_headings(self):
        # N.D. Ga. style: role per column in <th>, names in the <td> below; M.D. Fla. style CM/ECF party listing;
        # S.D.N.Y. style order links titled "Order: ... Leadership"; E.D. Ark. style "Name, role" in <strong>.
        html = b"""<main><h2>Contact Information</h2>
        <table><thead><tr><th><h4>Plaintiffs' Counsel</h4><p>Plaintiff Co-Lead Counsel</p></th><th><br/>Plaintiff Liaison Counsel</th></tr></thead>
        <tbody><tr><td><strong>Erin Roe</strong><br/>ROE LAW LLP</td><td><strong>Carl Poe</strong><br/>POE LLC</td></tr>
        <tr><td><strong>Ann Moe</strong><br/>MOE PC</td></tr></tbody></table>
        <h3>Plaintiff's Counsel</h3><p>Plaintiff</p><p>Robert Doe</p><p>represented by</p><p>Jane Roe</p>
        <h3>Orders</h3><p><strong>Order: Plaintiffs' Leadership</strong></p><p>December 2, 2022</p>
        <h3>Plaintiffs' MDL Lead Counsel</h3><p><strong>Paul Q. Ames, MDL Liaison Counsel</strong><br/>Ames &amp; Bell, PLC</p>
        <p></p><p><strong><u>Key Documents</u></strong></p><ul><li><a href="/files/MDL-Transfer-Order.pdf">JPML Transfer Order entered 02/05/2026.</a></li></ul>
        </main>"""
        blocks = ec.leadership_blocks(BeautifulSoup(html, "lxml").find("main"))
        got = {b["heading"]: b for b in blocks}
        self.assertEqual(list(got), ["Plaintiff Co-Lead Counsel", "Plaintiff Liaison Counsel", "Plaintiffs' MDL Lead Counsel"])
        self.assertEqual(got["Plaintiff Co-Lead Counsel"]["lines"], ["Erin Roe", "ROE LAW LLP", "Ann Moe", "MOE PC"])
        self.assertEqual(got["Plaintiff Co-Lead Counsel"]["group"], "Plaintiffs' Counsel")
        self.assertEqual(got["Plaintiff Liaison Counsel"]["lines"], ["Carl Poe", "POE LLC"])
        self.assertEqual(got["Plaintiffs' MDL Lead Counsel"]["lines"], ["Paul Q. Ames, MDL Liaison Counsel", "Ames & Bell, PLC"])

    def test_last_updated_is_metadata_and_groups_end_at_the_next_heading_of_their_level(self):
        # D. Minn. style (MDL 2441): h3 accordion headings, "Last Updated" first, sub-roles in <strong> inside <p>.
        # Names here are synthetic.
        html = b"""<main><h3>Plaintiffs' Lead Counsel</h3><div><p><em>Last Updated: July 20, 2015</em></p>
        <p><em>Jane Doe, Chairperson</em><br/><strong>Doe &amp; Roe</strong><br/>225 W. Wacker Drive, Suite 1515</p></div>
        <h3>Plaintiffs' Liaison Counsel</h3><div><p><em>Last Updated: January 17, 2014</em></p>
        <p><span><strong>Liaison Counsel to the District of Minnesota</strong></span><br/><em>Al Nemo</em><br/><strong>Nemo Ltd.</strong></p>
        <p><span><strong>Liaison Counsel to the State Courts</strong></span><br/><em>Bo Bern</em><br/><strong>Bern LLC</strong></p></div>
        <h3>Defendants' Lead Counsel</h3><div><p><em>Last Updated: May 27, 2016</em></p><p><em>Kim Cat</em><br/><strong>Cat PC</strong></p></div>
        <h3>Defendants' Liaison Counsel</h3><div><p><em>Kim Cat</em><br/><strong>Cat PC</strong></p></div></main>"""
        blocks = ec.leadership_blocks(BeautifulSoup(html, "lxml").find("main"))
        got = {b["heading"]: b for b in blocks}
        self.assertEqual(list(got), ["Plaintiffs' Lead Counsel", "Liaison Counsel to the District of Minnesota", "Liaison Counsel to the State Courts",
                                     "Defendants' Lead Counsel", "Defendants' Liaison Counsel"])
        self.assertEqual(got["Plaintiffs' Lead Counsel"]["lines"][:2], ["Jane Doe, Chairperson", "Doe & Roe"])
        self.assertEqual(got["Plaintiffs' Lead Counsel"]["updated"], "Last Updated: July 20, 2015")
        self.assertFalse(any(ln.startswith("Last Updated") for b in blocks for ln in b["lines"]))
        sub = got["Liaison Counsel to the District of Minnesota"]
        self.assertEqual((sub["group"], sub["lines"], sub["updated"]), ("Plaintiffs' Liaison Counsel", ["Al Nemo", "Nemo Ltd."], "Last Updated: January 17, 2014"))
        self.assertEqual(got["Liaison Counsel to the State Courts"]["group"], "Plaintiffs' Liaison Counsel")
        # the plaintiffs' group ends at the next h3: the defense roles are not filed under it
        self.assertIsNone(got["Defendants' Lead Counsel"]["group"])
        self.assertIsNone(got["Defendants' Liaison Counsel"]["group"])
        self.assertEqual(got["Defendants' Lead Counsel"]["updated"], "Last Updated: May 27, 2016")
        self.assertIsNone(got["Defendants' Liaison Counsel"]["updated"])
        self.assertIsNone(ec.updated_line("Last Updated: soon"))
        self.assertIsNone(ec.updated_line("Jane Doe"))

    def test_misspelled_and_co_counsel_role_headings(self):
        # S.D. Ill. MDL 3004 prints "CO-LEAD PLANTIFF'S COUNSEL" (sic); N.D. Ohio MDL 2197 prints "Plaintiffs' Lead Co-Counsel".
        self.assertTrue(ec.is_lead_heading_text("CO-LEAD PLANTIFF'S COUNSEL"))
        self.assertTrue(ec.is_lead_heading_text("Plaintiffs' Lead Co-Counsel"))
        self.assertFalse(ec.is_lead_heading_text("Claims Administrator:"))
        html = b"""<main><h3>Lead Counsel and Plaintiffs' Executive Committee</h3><div>
        <table><tr><td><span><u><strong>CO-LEAD PLANTIFF'S COUNSEL</strong></u></span></td></tr>
        <tr><td><strong>Ann Doe</strong><br/>Doe LLP</td></tr></table>
        <table><tr><td><span><u><strong>PLAINTIFFS' EXECUTIVE COMMITTEE</strong></u></span></td></tr>
        <tr><td><strong>Bo Roe</strong><br/>Roe PC</td></tr></table></div></main>"""
        blocks = ec.leadership_blocks(BeautifulSoup(html, "lxml").find("main"))
        self.assertEqual([(b["group"], b["heading"], b["lines"]) for b in blocks], [
            ("Lead Counsel and Plaintiffs' Executive Committee", "CO-LEAD PLANTIFF'S COUNSEL", ["Ann Doe", "Doe LLP"]),
            ("Lead Counsel and Plaintiffs' Executive Committee", "PLAINTIFFS' EXECUTIVE COMMITTEE", ["Bo Roe", "Roe PC"]),
        ])

    def test_role_per_row_tables(self):
        # N.D. Ohio style (MDL 2197 / 3092): one role per row, role in the first cell, names in the second (synthetic).
        html = b"""<main><table><tbody>
        <tr><td>Judge:</td><td>Hon. Example Judge</td></tr>
        <tr><td><p>Plaintiffs' Co-Lead Counsel:</p></td><td><p>Ann Doe<br/>DOE LLP<br/>100 Main Street, Suite 2<br/>Cleveland, Ohio 44139<br/>(216) 555-0100<br/>ann@example.com</p>
          <p>Bo Roe<br/>ROE PC<br/>12 Elm Road, #100<br/>Atlanta, Georgia 30319</p></td></tr>
        <tr><td>Plaintiffs' Lead Co-Counsel</td><td>Cy Poe<br/>Poe &amp; Moe</td></tr>
        <tr><td>Claims Administrator:</td><td>Hon. Dee Lee<br/>1 Center Plaza</td></tr>
        <tr><td> </td><td> </td></tr>
        </tbody></table>
        <table><tr><td><a href="/files/cmo2.pdf">Doc #35</a></td><td>03/08/2024</td><td>Case Management Order No. 2 (Plaintiff's Leadership)</td></tr></table></main>"""
        blocks = ec.leadership_blocks(BeautifulSoup(html, "lxml").find("main"))
        self.assertEqual([b["heading"] for b in blocks], ["Plaintiffs' Co-Lead Counsel:", "Plaintiffs' Lead Co-Counsel"])
        self.assertEqual(blocks[0]["lines"][:3], ["Ann Doe", "DOE LLP", "100 Main Street, Suite 2"])  # the builder removes the contacts
        lead = bcs.leadership_from_pages([{"url": "https://x.uscourts.gov/mdl", "leadership_blocks": blocks}])
        self.assertEqual(lead[0]["lines"], ["Ann Doe", "DOE LLP", "Bo Roe", "ROE PC"])
        self.assertTrue(lead[0]["contact_lines_removed"])
        self.assertEqual(lead[1]["lines"], ["Cy Poe", "Poe & Moe"])

    def test_quicktabs_role_tabs(self):
        # E.D. La. style (MDL 2740 contacts): role names are the tab links, names are in the matching tab page;
        # a role label printed as a <p> inside a tab page starts a sub-list grouped under the tab (synthetic names).
        html = """<main><div id="quicktabs-view__MDL__page_9" class="quicktabs-wrapper"><ul class="quicktabs-tabs">
        <li><a href="?qt=0" id="quicktabs-tab-view__MDL__page_9-0" class="quicktabs-tab">Chambers</a></li>
        <li><a href="?qt=1" id="quicktabs-tab-view__MDL__page_9-1" class="quicktabs-tab">Plaintiffs’ Liaison Counsel</a></li>
        <li><a href="?qt=2" id="quicktabs-tab-view__MDL__page_9-2" class="quicktabs-tab">Defendants’ Co-Lead Counsel</a></li></ul>
        <div class="quicktabs_main">
        <div id="quicktabs-tabpage-view__MDL__page_9-0" class="quicktabs-tabpage"><p>Section H - Phone: (504) 555-0100</p></div>
        <div id="quicktabs-tabpage-view__MDL__page_9-1" class="quicktabs-tabpage quicktabs-hide"><table><tbody><tr>
          <td><ul><li><strong>Ann Doe </strong><br/>Doe, Roe &amp; Poe, LLP<br/>701 Main Street<br/>Suite 3650<br/>New Orleans, Louisiana 70139<br/>Phone: (504) 555-0101<br/>Facsimile: Not Available<br/>Email: <a href="mailto:ann@example.com">ann@example.com</a></li></ul></td>
          <td><ul><li><strong>Bo Roe </strong>(Co-Lead Counsel)<br/>Roe Firm, PLC<br/>2800 Energy Centre<br/>1100 Main Street</li></ul></td></tr></tbody></table></div>
        <div id="quicktabs-tabpage-view__MDL__page_9-2" class="quicktabs-tabpage quicktabs-hide"><p>ACME DEFENDANTS' LEAD COUNSEL</p>
          <table><tr><td><p>Acme U.S. LLC</p></td><td><p>Cy Poe<br/>POE &amp; LEE<br/>2555 Grand Boulevard<br/>Telephone: (816) 555-0102<br/>Telefax; 816-555-0103</p></td></tr></table>
          <p>OTHER DEFENDANTS LEAD COUNSEL</p>
          <table><tr><td><p>Beta Inc.</p></td><td><p>Di Moe<br/>GREAT FIRM, LLP Terminus 200<br/>3333 Main Road NE, Suite 2500<br/>Telefax: 216-555-0104</p></td></tr></table></div>
        </div></div></main>""".encode()
        blocks = ec.leadership_blocks(BeautifulSoup(html, "lxml").find("main"))
        self.assertEqual([(b["group"], b["heading"]) for b in blocks], [
            (None, "Plaintiffs’ Liaison Counsel"),
            ("Defendants’ Co-Lead Counsel", "ACME DEFENDANTS' LEAD COUNSEL"),
            ("Defendants’ Co-Lead Counsel", "OTHER DEFENDANTS LEAD COUNSEL"),
        ])  # the Chambers tab names no role; "Bo Roe (Co-Lead Counsel)" is a member line, not a sub-heading
        self.assertEqual(blocks[0]["lines"][:2], ["Ann Doe", "Doe, Roe & Poe, LLP"])
        self.assertIn("Bo Roe (Co-Lead Counsel)", blocks[0]["lines"])
        lead = bcs.leadership_from_pages([{"url": "https://www.laed.uscourts.gov/x-contacts", "leadership_blocks": blocks}])
        self.assertEqual([b["lines"] for b in lead], [
            ["Ann Doe", "Doe, Roe & Poe, LLP", "Bo Roe (Co-Lead Counsel)", "Roe Firm, PLC"],
            ["Acme U.S. LLC", "Cy Poe", "POE & LEE"],
            ["Beta Inc.", "Di Moe", "GREAT FIRM, LLP"],
        ])
        self.assertTrue(all(b["contact_lines_removed"] for b in lead))

    def test_clip_cuts_at_a_word_boundary_and_marks_it(self):
        self.assertEqual(ec.clip("short", 10), "short")
        self.assertEqual(ec.clip("Ellen A. Presby Ferrer Poirot", 14), "Ellen A. …")
        self.assertEqual(ec.clip("Ellen A. Presby Ferrer", 15), "Ellen A. Presby …")
        self.assertEqual(ec.clip("Supercalifragilistic word", 5), "Supercalifragilistic …")
        self.assertEqual(ec.clip("Supercalifragilistic", 5), "Supercalifragilistic")


class CourtSummaryBuilder(unittest.TestCase):
    def test_leadership_redacts_contacts_dedupes_and_counts(self):
        long_line = "Firm " + " ".join(f"Partner{i}" for i in range(80))
        page = {"url": "https://x.uscourts.gov/a", "leadership_blocks": [
            {"heading": "Plaintiffs' Lead Counsel", "group": "PLAINTIFFS' COUNSEL", "lines": ["Jane Doe", "Example LLP", "100 Main Street", "jdoe@example.com", long_line], "lines_total": 7},
        ]}
        again = {"url": "https://x.uscourts.gov/b", "leadership_blocks": page["leadership_blocks"]}
        out = bcs.leadership_from_pages([page, again])
        self.assertEqual(len(out), 1)  # the same block on a second page is kept once
        b = out[0]
        self.assertEqual(b["lines"][:2], ["Jane Doe", "Example LLP"])
        self.assertTrue(b["contact_lines_removed"])
        self.assertNotIn("100 Main Street", b["lines"])
        self.assertTrue(b["lines"][2].endswith(" …") and len(b["lines"][2]) <= bcs.LEAD_LINE_CHARS + 2)
        self.assertRegex(b["lines"][2], r"Partner\d+ …$")  # whole words only
        self.assertEqual(b["lines_not_shown"], 2)  # beyond the extractor's cap
        self.assertEqual(b["group"], "PLAINTIFFS' COUNSEL")

    def test_page_flag_names_what_extraction_read(self):
        self.assertEqual(bcs.page_flag([], [], [], []), "no_court_page")
        self.assertEqual(bcs.page_flag([], [], [], [], [{"url": "f", "error": "fetch_failed"}]), "page_fetch_failed")
        self.assertIsNone(bcs.page_flag([{}], [{"url": "o"}], [], []))
        # no order extracted is not "the page lists no orders": the page may list orders the extractor did not read
        self.assertEqual(bcs.page_flag([{}], [], [{"category": "bellwether"}], []), "page_orders_not_extracted")
        self.assertEqual(bcs.page_flag([{}], [], [], [{"heading": "Lead Counsel"}]), "page_orders_not_extracted")
        self.assertEqual(bcs.page_flag([{}], [], [], []), "page_unreadable")

    def test_leadership_carries_updated_text(self):
        page = {"url": "https://x.uscourts.gov/a", "leadership_blocks": [
            {"heading": "Defendants' Lead Counsel", "group": None, "lines": ["Kim M. Catullo", "Gibbons PC"], "lines_total": 2, "updated": "Last Updated: May 27, 2016"},
        ]}
        self.assertEqual(bcs.leadership_from_pages([page])[0]["updated"], "Last Updated: May 27, 2016")

    def test_counsel_rule_reaches_counsel_text_only(self):
        """Owner decisions 2026-10-03 (counsel without contact fields) and 2026-10-27 (nothing else withheld)."""
        m = bcs.CONTACT_MARKER
        court = "Order | Open Court Conference November 10, 2016 at 1:00 p.m. Courtroom 16B, Carl B. Stokes U.S. Courthouse, 801 West Superior Avenue, Cleveland, OH 44113 | 10/20/2016"
        self.assertEqual(bcs.counsel_redact(court, marker=m), (cr.tidy(court), False))
        self.assertIn("801 West Superior Avenue", bcs.counsel_redact(court, "bellwether", marker=m)[0])
        admin = "Claims Administrator: | Hon. James J. Roe, 100 Main Street, Columbus, OH 43215"
        self.assertEqual(bcs.counsel_redact(admin, "settlement", marker=m)[0], cr.tidy(admin))
        counsel = "Plaintiffs' liaison counsel Jane Doe, Doe LLP, 100 Main Street, Columbus, OH 43215, (614) 555-0100."
        text, removed = bcs.counsel_redact(counsel, "settlement", marker=m)
        self.assertTrue(removed)
        self.assertNotIn("555-0100", text)
        self.assertNotIn("100 Main Street", text)
        firm = "Write to Roe Smith LLP at 100 Main Street, Columbus, OH 43215."
        self.assertTrue(bcs.counsel_redact(firm, marker=m)[1])
        dial = "To participate in the status conference, call (877) 336-1831 and enter access code 455209."
        self.assertTrue(bcs.counsel_redact(dial, "leadership", marker=m)[1])  # leadership statements always follow the counsel rule
        self.assertFalse(bcs.counsel_redact(dial, "bellwether", marker=m)[1])
        self.assertEqual(cr.redact("Order of 10/14/2026 at 9:30 ."), (cr.tidy("Order of 10/14/2026 at 9:30 ."), False))


class MassTortTermMerge(unittest.TestCase):
    # build_mass_tort_signals.py lives one directory up; tested here so the CI Python contract suite covers it.
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).parent.parent))
        import build_mass_tort_signals as mts  # noqa: E402

        cls.mts = mts

    def test_case_variants_merge_like_the_app(self):
        raw = [{"term": "Diarrhoea", "count": 292}, {"term": "Vomiting", "count": 270}, {"term": "DIARRHOEA", "count": 247},
               {"term": "VOMITING", "count": 222}, {"term": "Pyrexia", "count": 187}, {"term": "", "count": 9}, {"term": "Rash", "count": True}]
        out = self.mts.merge_case_variants(raw)
        self.assertEqual(out[:3], [
            {"term": "Diarrhoea", "count": 539, "variants": ["Diarrhoea", "DIARRHOEA"]},
            {"term": "Vomiting", "count": 492, "variants": ["Vomiting", "VOMITING"]},
            {"term": "Pyrexia", "count": 187, "variants": ["Pyrexia"]},
        ])
        self.assertEqual(len(out), 3)

    def test_merge_is_idempotent_and_folds_with_lower(self):
        once = self.mts.merge_case_variants([{"term": "Rash", "count": 5}, {"term": "RASH", "count": 5}, {"term": "Fatigue", "count": 10}])
        self.assertEqual(self.mts.merge_case_variants(once), once)
        self.assertEqual(once[0], {"term": "Rash", "count": 10, "variants": ["Rash", "RASH"]})
        # str.lower (as String.toLowerCase in the app), not casefold: "ß" and "ss" stay distinct terms
        self.assertEqual(len(self.mts.merge_case_variants([{"term": "Straße", "count": 1}, {"term": "STRASSE", "count": 1}])), 2)


class ContactRedaction(unittest.TestCase):
    def test_counsel_line_keeps_name_and_firm(self):
        text = "Christopher A. Seeger Seeger Weiss LLP 55 Challenger Road, 6th Floor Ridgefield Park, NJ 07660 (212) 584-0700 cseeger@seegerweiss.com"
        self.assertEqual(cr.redact(text), ("Christopher A. Seeger Seeger Weiss LLP", True))

    def test_labels_po_box_suite_and_spelled_number(self):
        text = "Kim M. Catullo Gibbons PC One Gateway Center Newark, NJ 07102 Phone: (212) 613-2001 Email: kcatullo@gibbonslaw.com Joseph F Rice Motley Rice PO Box 1792 Mt Pleasant, SC 29465 843-216-9000 Fax: 843.216.9290 UB Greensfelder LLP #1400 Cincinnati, OH 45202"
        clean, removed = cr.redact(text)
        self.assertTrue(removed)
        self.assertEqual(clean, "Kim M. Catullo Gibbons PC Joseph F Rice Motley Rice UB Greensfelder LLP")
        self.assertNotRegex(clean, r"\d|@")

    def test_dates_and_order_numbers_survive(self):
        text = "Last Updated: May 27, 2016 Pretrial Order No. 18 appointing leadership in MDL No. 3140 on March 16, 2025."
        self.assertEqual(cr.redact(text), (text, False))

    def test_document_numbers_are_not_suite_numbers(self):
        # '#NN' on court pages is a document number; only a unit number right after a street word and a comma is address.
        for text in ("Exhibit A to CMO #22", "Order (Related Doc # 671)", "Doc #35 | 03/08/2024 | Case Management Order No. 2", "Pretrial Order #4"):
            self.assertEqual(cr.redact(text), (text, False))
            self.assertEqual(cr.redact(text, marker="[contact removed]"), (text, False))
        self.assertEqual(cr.redact_lines(["1932 North Druid Hills Road, #100"]), ([], True))
        self.assertEqual(cr.redact("Childers LLC, 1932 North Druid Hills Road, #100 Atlanta, Georgia 30319", marker="[contact removed]")[0], "Childers LLC, [contact removed]")
        self.assertEqual(cr.redact("Write to Doe LLC at Druid Hills Road, #100.", marker="[contact removed]"),
                         ("Write to Doe LLC at Druid Hills Road, [contact removed].", True))
        self.assertEqual(cr.redact("UB Greensfelder LLP #1400 Cincinnati, OH 45202"), ("UB Greensfelder LLP", True))

    def test_unavailable_fields_telefax_and_firm_with_building(self):
        lines = ["Ann Doe", "Facsimile: Not Available", "Fax: N/A", "Telefax: 216-555-0104", "Telefax; 678-555-0105", "Telefax",
                 "GREAT FIRM, LLP Terminus 200", "3333 Main Road NE, Suite 2500", "Roe Partners 12", "100 Elm Street"]
        kept, removed = cr.redact_lines(lines)
        self.assertTrue(removed)
        self.assertEqual(kept, ["Ann Doe", "GREAT FIRM, LLP"])  # a line without a firm suffix above a street line is a building
        self.assertEqual(cr.redact("Contact Ann Doe (Facsimile: Not Available).", marker="[contact removed]")[0], "Contact Ann Doe [contact removed].")
        self.assertEqual(cr.redact_lines(["Smith Jones LLP Plaza 7"]), (["Smith Jones LLP Plaza 7"], False))  # no street line below: kept

    def test_per_element_counsel_lines_lose_every_contact_line(self):
        # Counsel blocks are now one line per page element, so an address spans several lines.
        lines = ["Timothy J. Becker", "JOHNSON // BECKER, PLLC", "444 Cedar Street, Suite 1800", "St. Paul, MN 55101", "Tel.:",
                 "Trent B. Miracle", "SIMMONS HANLY CONROY", "One Court Street", "Alton, IL 62002", "Panagiotis V. Albanis",
                 "MORGAN & MORGAN", "Naples, Florida", "Post Office Box 2208", "516/466-6500", "Name and Address", "Telephone", "Email",
                 "Lori G. Cohen", "Greenberg Traurig, LLP", "Terminus 200", "3333 Piedmont Road NE, Suite 2500", "Wes Bowden",
                 "Fears Law Firm", "310 4th Avenue South", "150 3 rd Avenue South", "(212) 555-0100 (fax)", "11th. Floor",
                 "Third and Fourth Floor", "Plaza Seven Bldg.", "Irvine CA 92606", "Houston, TX 770606"]
        kept, removed = cr.redact_lines(lines)
        self.assertTrue(removed)
        self.assertEqual(kept, ["Timothy J. Becker", "JOHNSON // BECKER, PLLC", "Trent B. Miracle", "SIMMONS HANLY CONROY", "Panagiotis V. Albanis",
                                "MORGAN & MORGAN", "Lori G. Cohen", "Greenberg Traurig, LLP", "Wes Bowden", "Fears Law Firm"])

    def test_firm_suffixes_and_people_survive_line_rules(self):
        lines = ["Hale Ives, PA", "Douglas & London, P.C.", "One Legal Group", "Two members of the Court's leadership", "Stephanie E. Parker",
                 "Stinson Leonard Street", "James R. Dugan, II"]
        self.assertEqual(cr.redact_lines(lines), (lines, False))
        self.assertEqual(cr.redact("Counsel: (516) 466-6500 and 516/466-6665")[0], "Counsel: and")
        self.assertEqual(cr.redact("Order of 10/14/2026 at 9:30")[0], "Order of 10/14/2026 at 9:30")

    def test_marker_in_sentences_and_line_drops(self):
        clean, removed = cr.redact("Email Liaison Counsel (Donna Welch at donna.welch@kirkland.com).", marker="[contact removed]")
        self.assertEqual(clean, "Email Liaison Counsel (Donna Welch at [contact removed]).")
        lines, removed = cr.redact_lines(["Jane Doe, Example LLP", "100 Main Street", "Suite 400", "jdoe@example.com"])
        self.assertEqual((lines, removed), (["Jane Doe, Example LLP"], True))

    def test_building_name_above_its_suite_line_is_address(self):
        # S.D. Ohio MDL 2974 prints a building name, with a trailing comma, above the suite line (firm/person synthetic).
        lines, removed = cr.redact_lines(["Chris Doe", "Example Snow LLP", "Renaissance at Colony Park,", "Suite 1400", "1020 Highland Colony Parkway",
                                          "Ridgeland, MS 39158", "Pat Roe,", "Roe LLP"])
        self.assertTrue(removed)
        self.assertEqual(lines, ["Chris Doe", "Example Snow LLP", "Pat Roe", "Roe LLP"])  # a comma alone drops nothing (redact trims it)

    def test_sentence_pointing_at_a_removed_contact_keeps_the_marker(self):
        # N.D. Ill. MDL 3060 prints this sentence under Defendants' Liaison Counsel (address synthetic here).
        lines, removed = cr.redact_lines(["Heidi Doe", "Example Austin LLP", "Any time-sensitive communications intended for the full defense group may be sent to MDL9999_DefenseLiaison@example.com.",
                                          "Questions: (212) 555-0100", "Jane Roe Phone: (212) 555-0101", "Ph.: (212) 555-0102", "Ph,: 212-555-0103"])
        self.assertTrue(removed)
        self.assertEqual(lines, ["Heidi Doe", "Example Austin LLP",
                                 "Any time-sensitive communications intended for the full defense group may be sent to [contact removed].",
                                 "Questions: [contact removed]", "Jane Roe"])


if __name__ == "__main__":
    unittest.main()
