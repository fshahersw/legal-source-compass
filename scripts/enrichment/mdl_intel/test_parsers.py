"""Unit tests for the mdl-intel parsers (run: python3 -m unittest scripts/enrichment/mdl_intel/test_parsers.py)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import contact_redaction as cr  # noqa: E402
import extract_court_pages as ec  # noqa: E402
import parse_govinfo as pg  # noqa: E402
import parse_jpml as pj  # noqa: E402

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

    def test_marker_in_sentences_and_line_drops(self):
        clean, removed = cr.redact("Email Liaison Counsel (Donna Welch at donna.welch@kirkland.com).", marker="[contact removed]")
        self.assertEqual(clean, "Email Liaison Counsel (Donna Welch at [contact removed]).")
        lines, removed = cr.redact_lines(["Jane Doe, Example LLP", "100 Main Street", "Suite 400", "jdoe@example.com"])
        self.assertEqual((lines, removed), (["Jane Doe, Example LLP"], True))


if __name__ == "__main__":
    unittest.main()
