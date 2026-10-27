"""Offline tests for the FDA warning-letter index (synthetic cells shaped like the FDA.gov table on 2026-10-27)."""
import hashlib
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import build_warning_letters as build  # noqa: E402
import wl_parse as wp  # noqa: E402
import wl_rows  # noqa: E402

P = "/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/"


def time_cell(us):
    return f'<time datetime="2026-10-27T04:00:00Z">{us}</time>\n'


def cells(slug="pro-optics-llc-734689-10052026", company="Pro-Optics, LLC", posted="10/27/2026", issued="10/05/2026",
          office="Center for Devices and Radiological Health", subject="Investigational Device Exemptions (IDE)/Premarket Approval Application (PMA)",
          response="", closeout=""):
    return [time_cell(posted), time_cell(issued), f'<a href="{P}{slug}">{company}</a>', office, subject, response, closeout, ""]


SETTINGS = {"datatables": {"x": {
    "serverSide": True, "deferLoading": 2,
    "aoColumnHeaders": [{"content": h} for h in wp.HEADERS],
    "ajax": {"url": "/datatables/views/ajax", "type": "GET", "data": {"view_name": wp.VIEW_NAME, "total_items": 2}},
}}}


class Parse(unittest.TestCase):
    def test_row_fields(self):
        row = wp.parse_row(cells(subject="CGMP/Food/Adulterated<br />\r\n", company="Rama Food Manufacture Corp. "))
        self.assertEqual(row["slug"], "pro-optics-llc-734689-10052026")
        self.assertEqual(row["url"], "https://www.fda.gov" + P + "pro-optics-llc-734689-10052026")
        self.assertEqual(row["posted_date"], "2026-10-27")
        self.assertEqual(row["letter_issue_date"], "2026-10-05")
        self.assertEqual(row["company_name"], "Rama Food Manufacture Corp.")
        self.assertEqual(row["subject"], "CGMP/Food/Adulterated")
        self.assertIsNone(row["closeout_letter"])
        self.assertEqual(row["closeout_letter_urls"], [])

    def test_closeout_link_and_entities(self):
        close = f'<a href="{P}acme-1-11212023"><time datetime="x">12/01/2023</time>\n</a>'
        row = wp.parse_row(cells(company="A &amp; B Labs", closeout=close))
        self.assertEqual(row["company_name"], "A & B Labs")
        self.assertEqual(row["closeout_letter"], "12/01/2023")
        self.assertEqual(row["closeout_letter_urls"], ["https://www.fda.gov" + P + "acme-1-11212023"])

    def test_rejects_rows_without_one_letter_link(self):
        bad = cells()
        bad[2] = "Pro-Optics, LLC"
        with self.assertRaises(ValueError):
            wp.parse_row(bad)
        with self.assertRaises(ValueError):
            wp.parse_row(cells()[:7])

    def test_dates_are_never_guessed(self):
        self.assertEqual(wp.us_date("01/27/2021"), "2021-01-27")
        self.assertIsNone(wp.us_date("2021-01-27"))
        self.assertIsNone(wp.us_date("13/01/2021"))
        self.assertIsNone(wp.us_date(""))

    def test_union_keeps_every_closeout_link_but_refuses_changed_values(self):
        a = wp.parse_row(cells(closeout=f'<a href="{P}x-1">12/01/2023</a>'))
        b = wp.parse_row(cells(closeout=f'<a href="{P}x-1-0">12/01/2023</a>'))
        merged = wp.union([[a], [b]])[a["path"]]
        self.assertEqual(merged["closeout_letter_urls"], ["https://www.fda.gov" + P + "x-1", "https://www.fda.gov" + P + "x-1-0"])
        changed = wp.parse_row(cells(subject="Different"))
        with self.assertRaises(ValueError):
            wp.union([[a], [changed]])

    def test_table_settings(self):
        html = '<script type="application/json" data-drupal-selector="drupal-settings-json">' + json.dumps(SETTINGS) + "</script>"
        ajax, total = wp.table_settings(html)
        self.assertEqual(total, 2)
        broken = json.loads(json.dumps(SETTINGS))
        broken["datatables"]["x"]["aoColumnHeaders"][4]["content"] = "Topic"
        with self.assertRaises(ValueError):
            wp.table_settings('<script type="application/json" data-drupal-selector="drupal-settings-json">' + json.dumps(broken) + "</script>")


class Rows(unittest.TestCase):
    def test_row_shape_and_source_url(self):
        letter = wp.parse_row(cells())
        row = wl_rows.row(letter, captured="2026-10-27T14:48:26Z")
        self.assertEqual(row["dataset"], "agency_safety_fda_warning_letters_index")
        self.assertEqual(row["id"], "fda-wl:pro-optics-llc-734689-10052026")
        self.assertEqual(row["source_url"], letter["url"])
        self.assertEqual(row["title"], "Pro-Optics, LLC")
        self.assertEqual(row["item"]["snippet"], letter["subject"])
        self.assertEqual(row["item"]["dates"], {"posted_date": "2026-10-27", "letter_issue_date": "2026-10-05",
                                                "response_letter_date": None, "closeout_letter_date": None})
        self.assertEqual(row["filters"]["sort_date"], "2026-10-27")
        self.assertEqual(row["filters"]["firm_norm"], "PRO OPTICS LLC")
        facts = dict(row["detail"]["facts"])
        self.assertTrue(facts["FEI number"].startswith("Not recorded"))
        self.assertEqual(facts["Closeout letter"], "Not recorded")


class Build(unittest.TestCase):
    def _acq(self, pages, total, tamper=False):
        tmp = tempfile.mkdtemp()
        raw = os.path.join(tmp, "raw", "warning_letters")
        os.makedirs(raw)
        files = []
        for name, rows in pages:
            body = json.dumps({"recordsTotal": total, "recordsFiltered": total, "data": rows}).encode()
            with open(os.path.join(raw, name), "wb") as fh:
                fh.write(body)
            files.append({"file": name, "url": "https://www.fda.gov/x", "http_status": 200, "bytes": len(body),
                          "sha256": "0" * 64 if tamper else hashlib.sha256(body).hexdigest(), "retrieved_at": "2026-10-27T14:48:26Z"})
        with open(os.path.join(raw, "manifest.json"), "w") as fh:
            json.dump({"table_total": total, "passes": ["desc", "asc"], "files": files}, fh)
        return tmp

    def test_union_of_passes_must_equal_the_table_total(self):
        one = cells()
        two = cells(slug="rama-food-manufacture-corp-730689-09222026", company="Rama Food Manufacture Corp.", issued="09/22/2026")
        rows, summary = build.build(self._acq([("page_desc_00000.json", [one]), ("page_asc_00000.json", [two, one])], 2))
        self.assertEqual(len(rows), 2)
        self.assertEqual(summary["records"], 2)
        self.assertEqual(summary["by_posted_year"], {"2026": 2})
        with self.assertRaises(SystemExit):
            build.build(self._acq([("page_desc_00000.json", [one])], 2))

    def test_refuses_files_that_do_not_match_the_manifest(self):
        with self.assertRaises(SystemExit):
            build.build(self._acq([("page_desc_00000.json", [cells()])], 1, tamper=True))


if __name__ == "__main__":
    unittest.main()
