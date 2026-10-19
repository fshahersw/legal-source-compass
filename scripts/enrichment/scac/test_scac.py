"""Unit tests for the SCAC page parsers (python3 -B -m unittest test_scac, run from this directory)."""
import datetime as dt
import io
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scac_lib as sl  # noqa: E402

CHART = """<script> var chartData = [
  {cld_filing_year: '1996', cnt: 110} ,  {cld_filing_year: '1997', cnt: 174} ]; </script>"""
HEAT = """<tiny>max: 1688</tiny>
<ul id="mapnav" class="nav">
 <li title="Technology"><a class="zoom">Technology <tiny style="float: right;">1688</tiny></a></li>
 <li title="Consumer Non-Cyclical"><a>Consumer Non-Cyclical <tiny style="float: right;">1,214</tiny></a></li>
</ul>
<!--<ul class="nav heat-map"><li><a href="#">2009 <span>1,234</span></a></li></ul>-->
<div>6879 total Filings</div>"""
TOP = """<div class="accordion-group hm-r95to100"><div class="accordion-heading"><a class="accordion-toggle">
<div class="top-offenders-entity">Enron Corporation</div><div class="top-offenders-sanctions">$ 7,227,390,000</div></a></div>
<div class="accordion-inner"><p>On or around 09/08/2008 the case settled after ruling on summary judgment</p>
<table><tbody><tr class="table-link"><td>Settlement Ruling Pending</td><td>No</td></tr>
<tr class="table-link"><td>Fees &amp; Expenses</td><td> $ 688,047,528</td></tr></tbody></table>
<a class="btn" href="filings-case.html?id=102098">Case Page</a></div></div>
<div class="accordion-group"><div class="accordion-heading"><a>
<div class="top-offenders-entity">Robbins Geller Rudman & Dowd LLP </div><div class="top-offenders-sanctions">956</div></a></div>
<a class="btn" onclick="$('#input_filing_plaintif_law_firm_id').val(1439);">Related Filings</a></div>"""
TRENDS = """<h4>SPACs <div class="pull-right"><small class="hidden-phone"> 2 Filings | First case filed on 01/30/2019 | Last case filed on 04/18/2025 &nbsp;</small></div></h4>
<table><tr class="table-link" page="current-trends" onclick="window.location='filings-case.html?id=5'">
<td>Acme SPAC Corp.</td><td>04/18/2025</td><td class="hidden-phone">S.D. New York</td><td class="hidden-phone">NASDAQ</td><td class="hidden-phone">ACME</td><td class="hidden-phone">Financial</td></tr>
<tr class="table-link" page="current-trends" onclick="window.location='filings-case.html?id=6'">
<td>Beta Holdings</td><td>01/30/2019</td><td class="hidden-phone">D. Delaware</td><td class="hidden-phone">N/A</td><td class="hidden-phone">N/A</td><td class="hidden-phone">Services</td></tr></table>
<h4>Cannabis <div class="pull-right"><small> 0 Filings | First case filed on 04/18/2014 | Last case filed on 10/17/2024</small></div></h4>"""
STATS = """Box scores or key statistics from 1996 to YTD <span>S.D. New York</span> Most Active District Court
$ 119,351,176,861 Total $ Amount of All Settlements 53,195 Total # of Defendants (Individual and Companies) sued
3,004 Number of Filings Settled 3,306 Number of Filings Dismissed 535 Number of Filings Still Ongoing
Technology Most frequently Sued Sector Biotechnology &amp; Drugs Most Frequently Sued Industry NASDAQ Exchange of Most Frequently Sued Issuers"""


class Pages(unittest.TestCase):
    def test_year_chart(self):
        self.assertEqual(sl.year_chart(CHART), [(1996, 110), (1997, 174)])
        self.assertEqual(sl.year_chart("<p>no chart</p>"), [])

    def test_heat_list_ignores_commented_template(self):
        self.assertEqual(sl.heat_list(HEAT), [("Technology", 1688), ("Consumer Non-Cyclical", 1214)])
        self.assertEqual(sl.total_filings(HEAT), 6879)

    def test_accordions(self):
        a = sl.accordions(TOP)
        self.assertEqual(a[0]["entity"], "Enron Corporation")
        self.assertEqual(sl.money(a[0]["figure"]), 7227390000)
        self.assertEqual(sl.money(a[0]["details"]["Fees & Expenses"]), 688047528)
        self.assertEqual(a[0]["case_id"], 102098)
        self.assertEqual((a[1]["entity"], a[1]["figure"], a[1]["scac_firm_id"]), ("Robbins Geller Rudman & Dowd LLP", "956", 1439))

    def test_current_trends(self):
        t = sl.current_trends(TRENDS)
        self.assertEqual([(x["name"], x["filings"], x["first"], x["last"]) for x in t],
                         [("SPACs", 2, "2019-01-30", "2025-04-18"), ("Cannabis", 0, "2014-04-18", "2024-10-17")])
        self.assertEqual(t[0]["rows"][0], {"case_id": 5, "name": "Acme SPAC Corp.", "filed": "2025-04-18", "court": "S.D. New York",
                                           "exchange": "NASDAQ", "ticker": "ACME", "sector": "Financial"})
        self.assertEqual(t[1]["rows"], [])

    def test_key_stats(self):
        k = dict(sl.key_stats(STATS))
        self.assertEqual(k["Most Active District Court"], "S.D. New York")
        self.assertEqual(k["Number of Filings Still Ongoing"], "535")
        self.assertEqual(k["Most Frequently Sued Industry"], "Biotechnology & Drugs")
        self.assertEqual(sl.key_stats("nothing here"), [])

    def test_dates(self):
        self.assertEqual(sl.us_date("On or around 09/08/2008 the case"), "2008-09-08")
        self.assertIsNone(sl.us_date("02/30/2020"))


class Series(unittest.TestCase):
    def test_fred_csv_skips_missing_days(self):
        s = sl.fred_csv(b"observation_date,VIXCLS\n2024-01-02,13.20\n2024-01-03,\n2024-12-31,17.35\n2025-01-02,.\n")
        self.assertEqual(s, [(dt.date(2024, 1, 2), 13.2), (dt.date(2024, 12, 31), 17.35)])
        y = sl.yearly(s)[2024]
        self.assertAlmostEqual(y["mean"], 15.275)
        self.assertEqual((y["max"], y["last"], y["n"]), (17.35, 17.35, 2))

    def test_ff_annual(self):
        body = "note\n,Mkt-RF,SMB,HML,RF\n192607,   2.89,  -2.42,  -2.75,   0.22\n\n Annual Factors: January-December \n,Mkt-RF,SMB,HML,RF\n  2024,  19.76, -11.31,  -8.43,   5.26\n\nCopyright\n"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("F-F_Research_Data_Factors.csv", body)
        self.assertEqual(sl.ff_annual(buf.getvalue()), {2024: {"Mkt-RF": 19.76, "SMB": -11.31, "HML": -8.43, "RF": 5.26}})


if __name__ == "__main__":
    unittest.main()
