"""Offline tests for the oversight builders: synthetic fixtures, no network, no reads from private/.

  cd scripts/enrichment/oversight && python3 -B -X utf8 -m unittest test_oversight
"""
import gzip
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "enforcement_actions"))

import build_doj_oig as bdo  # noqa: E402
import build_doj_site as bds  # noqa: E402
import build_osc as bosc  # noqa: E402
import build_oversight as bo  # noqa: E402
import doj_oig as dj  # noqa: E402
import extract as ex  # noqa: E402
import match  # noqa: E402
import pagefind as pf  # noqa: E402
import parse_doj_oig as pj  # noqa: E402
import parse_doj_site as pds  # noqa: E402
import parse_osc as posc  # noqa: E402
import parse_oversight as po  # noqa: E402
import rows as rw  # noqa: E402

# ------------------------------------------------------------------------------------------------ fixtures


def listing_row(date, agency, title, kind, location, href, oig, oig_path, number=None, recs=None, desc=None):
    when = f'<time datetime="{date}T12:00:00Z">x</time>' if date else ""
    parts = [f'<div class="field field--name-field-report-submitting-oig field--type-entity-reference field--label-inline clearfix"><div class="title display-inline">Submitting OIG</div><div class="field__item display-inline">{oig}</div></div>']
    if desc:
        parts.append(f'<div class="field field--name-body field--type-text-with-summary field--label-inline clearfix"><div class="title display-inline">Report Description</div><div class="field__item display-inline"><p>{desc}</p>\n</div></div>')
    if recs is not None:
        parts.append(f'<div class="field field--name-field-report-number-of-recs field--type-integer field--label-inline clearfix"><div class="title display-inline">Number of Recommendations</div><div class="field__item display-inline">{recs}</div></div>')
    if number:
        parts.append(f'<div class="field field--name-field-report-number field--type-string field--label-inline clearfix"><div class="title display-inline">Report Number</div><div class="field__item display-inline">{number}</div></div>')
    return (
        '<tr class="listing-table__row table-row">'
        f'<td data-label="Report Date">{when}</td><td data-label="Agency Reviewed / Investigated">{agency}</td>'
        f'<td data-label="Report Title">{title}</td><td data-label="Type">{kind}</td><td data-label="Location">{location}</td>'
        f'<td class="action-cell" data-label="action-cell-report-link" rowspan="2"><a href="{href}" hreflang="en">View Report</a></td></tr>'
        '<tr class="listing-table__accordion-toggle"><td data-label="View Report Highlights" colspan="5"></td></tr>'
        '<tr class="listing-table__container hidden"><td data-label="View Report Highlights" colspan="6"><article><div>'
        + "".join(parts)
        + f'<h2><a href="{oig_path}"><div class="field field--name-name field--type-string field--label-hidden field__item">{oig}</div></a></h2>'
        "</div></article></td></tr>"
    )


OVERSIGHT_PAGE = (
    "<table><tbody>"
    + listing_row("2026-10-19", "National Aeronautics and Space Administration", "NASA&#039;s Role in the Decadal Survey", "Audit", "Agency-Wide",
                  "/reports/audit/nasas-role", "National Aeronautics and Space Administration OIG", "/inspectors-general/nasa-oig",
                  number="IG-27-001", recs=8, desc="NASA contracts   with the Academies.")
    + listing_row("2026-09-21", "Amtrak (National Railroad Passenger Corporation)", "Amtrak Employee Resigns", "Investigation", "Charlotte, NC",
                  "/node/192463", "Amtrak (National Railroad Passenger Corporation) OIG", "/inspectors-general/amtrak-oig", recs=0)
    + listing_row(None, "", "An undated memo", "Other", "Agency-Wide", "/reports/other/undated", "Department of Justice OIG",
                  "/inspectors-general/department-justice-oig")
    + "</tbody></table>"
)

DOJ_LISTING = (
    '<div class="views-row"><div class="views-field views-field-field-publication-date"><div class="field-content"><time datetime="2026-10-15T12:00:00Z" class="datetime">10/15/2026</time></div></div>'
    '<div class="views-field views-field-title"><span class="field-content"><a href="/reports/inspection-berlin" hreflang="en">Inspection of FCI Berlin</a></span></div>'
    '<span><span>Type: </span><span>Inspection / Evaluation</span></span> | <span class="views-field views-field-field-doj-component"><span class="views-label">Component(s): </span><span class="field-content">Federal Bureau of Prisons</span></span>'
    ' | <span class="views-field views-field-field-location"><span class="field-content">Berlin, NH\nUnited States</span></span></div>'
    '<div class="views-row"><div class="views-field views-field-field-publication-date"><div class="field-content"><time datetime="2019-11-27T12:00:00Z">11/27/2019</time></div></div>'
    '<div class="views-field views-field-title"><span class="field-content"><a href="/reports/semiannual-2019">Semiannual Report</a></span></div>'
    '<span><span>Type: </span><span>Semiannual Report</span></span></div>'
)

DOJ_NEW = (
    '<article class="node report-detail-full"><div class="grid-row"><div class="field__label report-field-label">Posted Date</div><div class="report-field-item"><div class="field__item"><time datetime="2026-09-30T12:00:00Z">September 30, 2026</time></div></div></div>'
    '<div class="grid-row"><div class="field__label report-field-label">Report Number</div><div class="report-field-item"><div class="field__item">26-105</div></div></div>'
    '<div class="grid-row"><div class="field__label report-field-label">Component</div><div class="report-field-item"><div class="field__items"><div class="field__item">Office of Justice Programs</div><div class="field__item">Federal Bureau of Prisons</div></div></div></div>'
    '<div class="grid-row"><div class="field__label report-field-label">Location</div><div class="report-field-item"><div class="field__item"><p class="address"><span>Salem</span> , <span>OR</span><br><span>United States</span></p></div></div></div>'
    '<div class="grid-row"><div class="field__label report-field-label">Number of Recommendations</div><div class="report-field-item"><div class="field__item">7</div></div></div>'
    '</article><a href="/sites/default/files/reports/26-105.pdf">PDF</a>'
)

DOJ_OLD = (
    '<article class="node report-detail-full"><div class="doj-field-container"><div class="grid-row"><div class="doj-field-label"><div class="field__label">Posted Date</div></div><div class="doj-field-item"><div class="field__item"><time>November 27, 2019</time></div></div></div></div>'
    '<div class="doj-field-container"><div class="grid-row"><div class="doj-field-label"><div class="field__label">Questioned Costs</div></div><div class="doj-field-item"><div content="4577633" class="field__item">$4,577,633</div></div></div></div>'
    '<div class="doj-field-container"><div class="grid-row"><div class="doj-field-label"><div class="field__label">Funds for Better Use</div></div><div class="doj-field-item"><div class="field__item">$0</div></div></div></div>'
    '</article>'
)

REPORT_PAGE = (
    '<div class="field field--name-field-report-file field--type-entity-reference field--label-visually_hidden"><div class="title usa-sr-only">Report File</div>'
    '<div class="field__item"><div><div class="field field--name-field-media-document field__item"><a class="pdf-icon report-download-button usa-button" href="/sites/default/files/documents/reports/2026-10/IG-27-001.pdf" target="_blank">View Report</a></div></div></div></div>'
    '<div class="field field--name-field-report-date-issued field--type-datetime field--label-above"><div class="title">Date Issued</div><div class="field__item"><time datetime="2026-10-19T12:00:00Z">Monday, October 19, 2026</time></div></div>'
    '<div class="field field--name-field-report-number field--type-string field--label-above"><div class="title">Report Number</div><div class="field__item">IG-27-001</div></div>'
    '<div class="field field--name-field-report-number-of-recs field--type-integer field--label-above"><div class="title">Number of Recommendations</div><div class="field__item">8</div></div>'
    '<div class="field field--name-field-net-questioned-costs field--type-bigint field--label-above"><div class="title">Questioned Costs</div><div content="1250000" class="field__item">$1,250,000</div></div>'
    '<div class="field field--name-field-net-funds-for-better-use field--type-bigint field--label-above"><div class="title">Funds for Better Use</div><div content="0" class="field__item">$0</div></div>'
    '<div class="field field--name-field-report-link field--type-link field--label-above"><div class="title">External Link</div><div class="field__item"><a href="https://oig.nasa.gov/x.pdf?a=1&amp;b=2">link</a></div></div>'
)


AGENCY_ROWS = [
    ["268", "Justice Department"], ["497", "Treasury Department"], ["221", "Health and Human Services Department"],
    ["410", "Postal Service"], ["6", "Agency for International Development"], ["192", "Federal Trade Commission"],
    ["900", "Dup Agency"], ["901", "Dup Agency"],
]


def cbor_header(major, n):
    if n < 24:
        return bytes([(major << 5) | n])
    if n < 256:
        return bytes([(major << 5) | 24, n])
    return bytes([(major << 5) | 25]) + n.to_bytes(2, "big")


def cbor(value):
    if isinstance(value, int):
        return cbor_header(0, value)
    if isinstance(value, str):
        b = value.encode()
        return cbor_header(3, len(b)) + b
    if isinstance(value, list):
        return cbor_header(4, len(value)) + b"".join(cbor(v) for v in value)
    raise TypeError(value)


def pf_file(value):
    return gzip.compress(pf.MARKER + cbor(value))


# ------------------------------------------------------------------------------------------------ tests


class OversightListing(unittest.TestCase):
    def setUp(self):
        self.rows = po.parse_listing(OVERSIGHT_PAGE)

    def test_three_reports_in_page_order(self):
        self.assertEqual([r["path"] for r in self.rows], ["/reports/audit/nasas-role", "/node/192463", "/reports/other/undated"])

    def test_fields_as_published(self):
        r = self.rows[0]
        self.assertEqual((r["date"], r["type"], r["location"], r["report_number"], r["recommendations"]),
                         ("2026-10-19", "Audit", "Agency-Wide", "IG-27-001", 8))
        self.assertEqual(r["title"], "NASA's Role in the Decadal Survey")
        self.assertEqual(r["oig"], "National Aeronautics and Space Administration OIG")
        self.assertEqual(r["oig_path"], "/inspectors-general/nasa-oig")
        self.assertEqual(r["description"], "NASA contracts with the Academies.")

    def test_zero_recommendations_is_zero_not_missing(self):
        self.assertEqual(self.rows[1]["recommendations"], 0)
        self.assertIsNone(self.rows[1]["report_number"])
        self.assertIsNone(self.rows[1]["description"])

    def test_missing_date_and_agency_are_none(self):
        r = self.rows[2]
        self.assertIsNone(r["date"])
        self.assertIsNone(r["agency_reviewed"])
        self.assertIsNone(r["recommendations"])

    def test_a_description_with_its_own_table_does_not_cut_the_highlights(self):
        row = listing_row("2025-02-25", "Department of Housing and Urban Development", "Boston audit", "Audit", "Agency-Wide", "/reports/audit/boston",
                          "Department of Housing and Urban Development OIG", "/inspectors-general/hud-oig", number="2025-CH-1001", recs=11,
                          desc="Findings. <table><tbody><tr><td>1</td></tr></tbody></table> More text.")
        # the real page puts the number and recommendations after the description
        parsed = po.parse_listing("<table><tbody>" + row + "</tbody></table>")
        self.assertEqual((parsed[0]["report_number"], parsed[0]["recommendations"]), ("2025-CH-1001", 11))

    def test_node_links_are_kept(self):
        self.assertEqual(self.rows[1]["path"], "/node/192463")

    def test_money_text_only_plain_dollars(self):
        self.assertEqual(po.parse_money("$1,234,567"), 1234567.0)
        self.assertIsNone(po.parse_money("about $5"))
        self.assertIsNone(po.parse_money(None))


class AgencyMatching(unittest.TestCase):
    def setUp(self):
        self.agencies = match.Agencies(AGENCY_ROWS)

    def test_keys(self):
        self.assertEqual(match.agency_key("Department of Justice OIG"), "justice department")
        self.assertEqual(match.agency_key("Department of Health & Human Services OIG"), "health and human services department")
        self.assertEqual(match.agency_key("Department of the Treasury OIG"), "treasury department")
        self.assertEqual(match.agency_key("U.S. Postal Service OIG"), "postal service")
        self.assertEqual(match.agency_key("U.S. Agency for International Development OIG"), "agency for international development")
        self.assertEqual(match.agency_key(""), "")

    def test_exact_match_by_documented_key(self):
        self.assertEqual(self.agencies.match("Department of Justice OIG")["id"], "268")
        self.assertEqual(self.agencies.match("Federal Trade Commission OIG")["id"], "192")
        self.assertEqual(self.agencies.match("Department of the Treasury OIG")["id"], "497")

    def test_no_match_stays_unlinked(self):
        self.assertIsNone(self.agencies.match("Treasury Inspector General for Tax Administration"))
        self.assertIsNone(self.agencies.match("Department of War OIG"))
        self.assertIsNone(self.agencies.match("Federal Reserve Board & CFPB OIG"))

    def test_ambiguous_key_never_links(self):
        self.assertIsNone(self.agencies.match("Dup Agency"))
        self.assertEqual(self.agencies.stats["ambiguous"], 1)

    def test_stats_count_each_name_once(self):
        for _ in range(3):
            self.agencies.match("Department of Justice OIG")
        self.assertEqual(self.agencies.stats["names_tried"], 1)

    def test_companies_exact_ambiguous_and_missing(self):
        rows = [["0000842742", "Akamai Technologies, Inc."], ["0000000001", "Twin Corp"], ["0000000002", "TWIN CORPORATION"], ["summary:overview", "x"]]
        companies = match.Companies(rows, ex.normalize_company)
        self.assertEqual(companies.match("Akamai Technologies, Inc.")["cik"], "0000842742")
        self.assertEqual(companies.match("In Re Akamai Technologies")["cik"] if companies.match("In Re Akamai Technologies") else None, None)
        self.assertIsNone(companies.match("Twin Corp"))
        self.assertEqual(companies.stats["ambiguous"], 1)
        self.assertIsNone(companies.match("Johnson Controls, Inc."))


class RecordsAndTrends(unittest.TestCase):
    def setUp(self):
        self.agencies = match.Agencies(AGENCY_ROWS)
        self.items = po.parse_listing(OVERSIGHT_PAGE)
        for r in self.items:
            r["retrieved_at"] = "2026-10-23T08:00:00Z"

    def test_record_shape_and_not_recorded(self):
        row = bo.build_record(self.items[2], self.agencies)
        self.assertEqual((row["dataset"], row["category"]), ("oversight_reports", "oversight_reports"))
        self.assertNotIn("ordinal", row)
        facts = dict(row["detail"]["facts"])
        self.assertEqual(facts["Report date"], "Not recorded")
        self.assertEqual(facts["Number of recommendations"], "Not recorded")
        self.assertEqual(row["item"]["oversight"]["year"], None)
        self.assertEqual(row["filters"]["year"], [])
        self.assertEqual(row["filters"]["has_recommendations"], ["not_recorded"])
        self.assertEqual(row["item"]["oversight"]["oig_agency_id"], "268")
        self.assertEqual(row["filters"]["oig_agency"], ["268"])

    def test_zero_recommendations_recorded_as_zero(self):
        row = bo.build_record(self.items[1], self.agencies)
        self.assertEqual(dict(row["detail"]["facts"])["Number of recommendations"], "0")
        self.assertEqual(row["filters"]["has_recommendations"], ["no"])
        self.assertNotIn("oig_agency", row["filters"])

    def test_ids_are_stable_and_distinct(self):
        ids = [bo.build_record(r, self.agencies)["id"] for r in self.items]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(ids[0], bo.build_record(self.items[0], self.agencies)["id"])

    def test_long_description_is_clipped_and_marked(self):
        r = dict(self.items[0], description="word " * 400)
        row = bo.build_record(r, self.agencies)
        body = row["item"]["oversight"]
        self.assertTrue(body["description_clipped"])
        self.assertLessEqual(len(body["description"]), 1200)

    def test_series_sums_only_stated_recommendations(self):
        items = [
            {"date": "2025-03-01", "type": "Audit", "recommendations": 5},
            {"date": "2025-07-01", "type": "Audit", "recommendations": None},
            {"date": "2025-08-01", "type": "Other", "recommendations": 0},
            {"date": None, "type": "Audit", "recommendations": 9},
        ]
        s = bo.series(items)
        self.assertEqual(len(s), 1)
        self.assertEqual((s[0]["reports"], s[0]["recs"], s[0]["recs_reports"]), (3, 5, 2))
        self.assertEqual(s[0]["types"], {"Audit": 2, "Other": 1})
        t = bo.totals(items)
        self.assertEqual((t["reports"], t["dated"], t["undated"]), (4, 3, 1))
        self.assertEqual(t["recs"], 14)
        self.assertEqual(t["first_date"], "2025-03-01")

    def test_money_by_year_skips_aggregate_types_and_counts_coverage(self):
        items = [
            {"date": "2024-02-01", "type": "Audit", "questioned": 100.0, "better_use": None},
            {"date": "2024-03-01", "type": "Audit", "questioned": 0.0, "better_use": 50.0},
            {"date": "2024-06-01", "type": "Semiannual Report", "questioned": 9999.0, "better_use": 9999.0},
            {"date": None, "type": "Audit", "questioned": 5.0, "better_use": 5.0},
        ]
        m = bo.money_by_year(items)
        self.assertEqual(len(m), 1)
        self.assertEqual((m[0]["reports"], m[0]["questioned_reports"], m[0]["questioned_costs"]), (2, 2, 100.0))
        self.assertEqual((m[0]["better_use_reports"], m[0]["funds_better_use"]), (1, 50.0))

    def test_trend_rows(self):
        rows = bo.build_trends(self.items, self.agencies, "2026-10-19")
        ids = [r["id"] for r in rows]
        self.assertEqual(ids[0], "national")
        self.assertIn("oig:department-justice-oig", ids)
        doj = next(r for r in rows if r["id"] == "oig:department-justice-oig")
        self.assertEqual(doj["filters"]["agency_id"], ["268"])
        self.assertEqual(doj["item"]["trend"]["totals"]["undated"], 1)
        amtrak = next(r for r in rows if r["id"] == "oig:amtrak-oig")
        self.assertNotIn("agency_id", amtrak["filters"])


class ReportPages(unittest.TestCase):
    def test_report_page_fields_as_printed(self):
        d = po.parse_report_page(REPORT_PAGE)
        self.assertEqual((d["date"], d["report_number"], d["recommendations"]), ("2026-10-19", "IG-27-001", 8))
        self.assertEqual(d["questioned_costs"], {"text": "$1,250,000", "value": 1250000.0})
        self.assertEqual(d["funds_better_use"], {"text": "$0", "value": 0.0})
        self.assertEqual(d["external_url"], "https://oig.nasa.gov/x.pdf?a=1&b=2")
        self.assertEqual(d["file_url"], "https://www.oversight.gov/sites/default/files/documents/reports/2026-10/IG-27-001.pdf")

    def test_missing_fields_are_none_not_zero(self):
        d = po.parse_report_page("<html></html>")
        self.assertEqual((d["date"], d["questioned_costs"], d["funds_better_use"], d["file_url"], d["recommendations"]), (None, None, None, None, None))

    def test_record_carries_money_and_links_only_when_the_page_was_read(self):
        agencies = match.Agencies(AGENCY_ROWS)
        item = po.parse_listing(OVERSIGHT_PAGE)[0]
        item["retrieved_at"] = "2026-10-23T08:00:00Z"
        plain = bo.build_record(item, agencies)
        self.assertNotIn("questioned_costs", plain["item"]["oversight"])
        read = bo.build_record(item, agencies, None, po.parse_report_page(REPORT_PAGE))
        self.assertEqual(read["item"]["oversight"]["questioned_costs"]["value"], 1250000.0)
        self.assertEqual(dict(read["detail"]["facts"])["Questioned costs (as the report page prints them)"], "$1,250,000")
        self.assertIn("Report file (hosted on Oversight.gov)", [link["label"] for link in read["item"]["links"]])

    def test_money_totals_only_when_every_report_of_the_oig_was_read(self):
        agencies = match.Agencies(AGENCY_ROWS)
        items = po.parse_listing(OVERSIGHT_PAGE)
        detail = po.parse_report_page(REPORT_PAGE)
        partial = {bo.detail_key(items[0]["path"]): detail}
        rows = bo.build_trends(items, agencies, "2026-10-19", None, partial)
        nasa = next(r for r in rows if r["id"] == "oig:nasa-oig")
        # NASA has one report in the fixture and it was read, so its money block exists
        self.assertEqual(nasa["item"]["trend"]["money"]["years"][0]["questioned_costs"], 1250000.0)
        amtrak = next(r for r in rows if r["id"] == "oig:amtrak-oig")
        self.assertNotIn("money", amtrak["item"]["trend"])


class DojOig(unittest.TestCase):
    def test_listing(self):
        rows = pj.parse_listing(DOJ_LISTING)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["components"], ["Federal Bureau of Prisons"])
        self.assertEqual(rows[0]["date"], "2026-10-15")
        self.assertEqual(rows[0]["type"], "Inspection / Evaluation")
        self.assertEqual(rows[1]["components"], [])
        self.assertIsNone(rows[1]["location"])

    def test_new_template(self):
        d = pj.parse_report(DOJ_NEW)
        self.assertEqual(d["number"], ["26-105"])
        self.assertEqual(d["component"], ["Office of Justice Programs", "Federal Bureau of Prisons"])
        self.assertEqual(d["recs"], ["7"])
        self.assertEqual(d["pdf"], "https://oig.justice.gov/sites/default/files/reports/26-105.pdf")
        self.assertEqual(d["money"], {})

    def test_old_template_money_keeps_text_and_machine_value(self):
        d = pj.parse_report(DOJ_OLD)
        self.assertEqual(d["money"]["questioned_costs"], {"text": "$4,577,633", "value": 4577633.0})
        self.assertEqual(d["money"]["funds_better_use"], {"text": "$0", "value": 0.0})
        self.assertEqual(pj.iso_date(d["posted"][0]), "2019-11-27")

    def test_report_file_prefers_the_download_button_and_keeps_non_pdf_files(self):
        page = '<a class="x" href="/sites/default/files/legacy/reports/INS/a0103.htm" target="_blank">Download report</a><a href="/sites/default/files/other.pdf">x</a>'
        self.assertEqual(pj.report_file(page), "https://oig.justice.gov/sites/default/files/legacy/reports/INS/a0103.htm")
        self.assertEqual(pj.report_file('<a href="/sites/default/files/reports/26-1.pdf">PDF</a>'), "https://oig.justice.gov/sites/default/files/reports/26-1.pdf")
        self.assertIsNone(pj.report_file("<p>nothing</p>"))

    def test_extra_labels_are_kept(self):
        page = ('<article class="report-detail-full"><div class="doj-field-container"><div class="grid-row"><div class="field__label">Participating OIG</div>'
                '<div class="field__item">Department of State OIG</div></div></div>'
                '<div class="doj-field-container"><div class="grid-row"><div class="field__label">Description</div><div class="field__item"><p>A joint review.</p></div></div></div></article>')
        d = pj.parse_report(page)
        self.assertEqual(d["participants"], ["Department of State OIG"])
        self.assertEqual(d["description"], ["A joint review."])

    def test_page_without_detail_block_is_none(self):
        self.assertIsNone(pj.parse_report("<html></html>"))

    def test_merge_and_record(self):
        listing = pj.parse_listing(DOJ_LISTING)[0]
        merged = dj.merge(listing, pj.parse_report(DOJ_NEW))
        self.assertEqual(merged["number"], "26-105")
        self.assertEqual(merged["location"], "Salem, OR United States")
        self.assertEqual(merged["recommendations"], 7)
        row = bdo.build_record(merged)
        self.assertEqual(row["id"], "dojoig:inspection-berlin")
        self.assertEqual(dict(row["detail"]["facts"])["Questioned costs (as the OIG states them)"], "Not recorded")
        self.assertEqual(row["filters"]["has_amount"], ["no"])
        self.assertEqual(row["filters"]["component"], ["Office of Justice Programs", "Federal Bureau of Prisons"])

    def test_merge_without_detail_page(self):
        merged = dj.merge(pj.parse_listing(DOJ_LISTING)[1], None)
        self.assertFalse(merged["has_detail"])
        self.assertIsNone(merged["number"])
        self.assertIsNone(merged["pdf"])

    def test_crosslink_needs_equal_unique_number_and_date(self):
        doj = [{"path": "/a", "number": "26-105", "date": "2026-09-30"}, {"path": "/b", "number": "26-106", "date": "2026-09-30"},
               {"path": "/c", "number": None, "date": "2026-09-30"}, {"path": "/d", "number": "26-107", "date": "2026-01-01"}]
        ov = [{"path": "/reports/x", "oig": "Department of Justice OIG", "report_number": "26-105", "date": "2026-09-30"},
              {"path": "/reports/y1", "oig": "Department of Justice OIG", "report_number": "26-106", "date": "2026-09-30"},
              {"path": "/reports/y2", "oig": "Department of Justice OIG", "report_number": "26-106", "date": "2026-09-30"},
              {"path": "/reports/z", "oig": "Department of Justice OIG", "report_number": "26-107", "date": "2026-01-02"},
              {"path": "/reports/other", "oig": "Other OIG", "report_number": "26-105", "date": "2026-09-30"}]
        self.assertEqual(dj.crosslink(doj, ov), {"/a": "/reports/x"})


class PagefindAndOsc(unittest.TestCase):
    def test_cbor_meta_and_filter(self):
        meta = pf.parse_meta(pf_file(["1.4.0", [["en_a", 10], ["en_b", 20], ["en_c", 30]], [], [["content-type", "en_f"]], []]))
        self.assertEqual(meta["pages"], [("en_a", 10), ("en_b", 20), ("en_c", 30)])
        self.assertEqual(meta["filters"], {"content-type": "en_f"})
        flt = pf.parse_filter(pf_file(["content-type", [["case", [0, 1]], ["press-release", [2]]]]))
        self.assertEqual(flt["values"], {"case": [0, 1], "press-release": [2]})
        self.assertEqual(pf.case_page_hashes(meta, flt, "case"), ["en_a", "en_b"])
        self.assertEqual(pf.case_page_hashes(meta, flt, "none"), [])

    def test_fragment_and_entry(self):
        raw = gzip.compress(pf.MARKER + json.dumps({"url": "/case/DI-1/", "meta": {"title": "t"}}).encode())
        self.assertEqual(pf.parse_fragment(raw)["url"], "/case/DI-1/")
        self.assertEqual(pf.parse_entry(b'{"languages":{"en":{"hash":"en_2ea63","page_count":3}}}'), "en_2ea63")

    def test_case_fragment(self):
        frag = {"url": "/case/DI-08-0177/", "filters": {"agency": ["U.S. Navy"]},
                "meta": {"case-number": "DI-08-0177", "agency": "U.S. Navy", "case-location": "Location: Jacksonville, Florida",
                         "date-iso": "2008-12-02", "date": "December 02, 2008", "case-results-json": '["Totally unsubstantiated"]',
                         "case-files-json": '[{"label":"Agency Report","href":"/~assets/cases/x.pdf"}]'}}
        c = posc.parse_case(frag)
        self.assertEqual((c["number"], c["agency"], c["location"], c["date_closed"]), ("DI-08-0177", "U.S. Navy", "Jacksonville, Florida", "2008-12-02"))
        self.assertEqual(c["files"], [{"label": "Agency Report", "url": "https://www.osc.gov/~assets/cases/x.pdf"}])
        row = bosc.case_record(c)
        self.assertEqual(row["id"], "oscdi:DI-08-0177")
        self.assertEqual(row["filters"], {"_listing": ["yes"], "agency": ["U.S. Navy"], "year": ["2008"], "result": ["Totally unsubstantiated"]})

    def test_case_without_number_or_with_bad_json(self):
        self.assertIsNone(posc.parse_case({"meta": {}}))
        c = posc.parse_case({"url": "/case/x/", "meta": {"case-number": "DI-1", "case-results-json": "{bad", "case-files-json": "nope", "date-iso": "soon"}})
        self.assertEqual((c["results"], c["files"], c["date_closed"]), ([], [], None))
        row = bosc.case_record(c)
        self.assertEqual(row["filters"]["year"], [])
        self.assertEqual(row["item"]["cells"]["closed"], "Not recorded")

    def test_press_fragment_and_tags(self):
        p = posc.parse_press({"url": "/news/2026-10-08/x/", "content": "WASHINGTON ...", "filters": {"tag": ["Hatch Act", "Whistleblower"]},
                              "meta": {"title": "OSC Announces Settlements", "date-iso": "2026-10-08", "date": "October 08, 2026"}})
        self.assertEqual((p["title"], p["date"], p["tags"]), ("OSC Announces Settlements", "2026-10-08", ["Hatch Act", "Whistleblower"]))
        self.assertEqual(p["url"], "https://www.osc.gov/news/2026-10-08/x/")
        self.assertIsNone(posc.parse_press({"meta": {}}))

    def test_resources(self):
        page = ('<ul><li class="usa-icon-list__item resource-item x" data-resource-parent="Federal" data-resource-topic="Coverage">\n<a href="/~assets/docs/a.pdf" class="y"><div class="usa-icon-list__content">FAA &amp; Others</div></a>\n</li>'
                '<li class="usa-icon-list__item resource-item x" data-resource-topic="Annual Reports to Congress"><a href="/resources/b/"><div class="usa-icon-list__content">FY 2025 Annual Report to Congress</div></a></li></ul>')
        items = posc.parse_resources(page)
        self.assertEqual([(i["title"], i["parent"], i["topic"], i["file_type"]) for i in items],
                         [("FAA & Others", "Federal", "Coverage", "PDF"), ("FY 2025 Annual Report to Congress", None, "Annual Reports to Congress", "Web page")])
        self.assertEqual(items[0]["url"], "https://www.osc.gov/~assets/docs/a.pdf")

    def test_dates_and_fiscal_years_only_when_printed(self):
        self.assertEqual(posc.trailing_date("Testimony on 'Hatch Act,' June 26, 2019"), "2019-06-26")
        self.assertEqual(posc.trailing_date("Confirmation Hearing of X, June 28, 2017"), "2017-06-28")
        self.assertIsNone(posc.trailing_date("Testimony about the 2019 campaign"))
        self.assertEqual(posc.fiscal_year("FY 2025 Annual Report to Congress"), 2025)
        self.assertIsNone(posc.fiscal_year("OSC Lapse Plan September 2025"))

    def test_publication_record_ids_distinguish_topics(self):
        a = bosc.pub_record("advisory_opinion", "T", "https://www.osc.gov/x.pdf", group="Candidacy", parent="Federal")
        b = bosc.pub_record("advisory_opinion", "T", "https://www.osc.gov/x.pdf", group="Coverage", parent="Federal")
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual(a["filters"]["kind"], ["advisory_opinion"])


class JusticeSite(unittest.TestCase):
    RES = ('<ol reversed="reversed"><li><a href="/criminal/media/1/dl?inline"><strong>Balt SAS</strong></a> (3/17/2026)</li>'
           '<li><a href="/media/2/dl?inline" target="_blank"><strong>In re: Akamai Technologies, Inc.</strong></a> (6/6/2016)</li>'
           '<li><a href="/media/3/dl"><strong>Liberty Mutual</strong></a> (8/07/25)</li><li><a href="/x"><strong>No date</strong></a></li></ol>')

    def test_resolutions(self):
        rows = pds.parse_resolutions(self.RES)
        self.assertEqual([r["date"] for r in rows], ["2026-03-17", "2016-06-06", "2025-08-07"])
        self.assertEqual(pds.company_name(rows[1]["label"]), "Akamai Technologies, Inc.")
        self.assertEqual(rows[1]["url"], "https://www.justice.gov/media/2/dl?inline")

    def test_date_rules(self):
        self.assertEqual(pds.resolution_date("12/21/22"), "2022-12-21")
        self.assertIsNone(pds.resolution_date("13/40/22"))
        self.assertIsNone(pds.resolution_date("soon"))

    def test_company_link_only_on_exact_unique_key(self):
        companies = match.Companies([["0000001234", "Akamai Technologies, Inc."]], ex.normalize_company)
        rows = pds.parse_resolutions(self.RES)
        linked = [bds.cep_record(r, companies) for r in rows]
        self.assertEqual([r["item"]["cep"]["company_cik"] for r in linked], [None, "0000001234", None])
        self.assertEqual(linked[1]["filters"]["company"], ["0000001234"])
        self.assertNotIn("company", linked[0]["filters"])
        self.assertIn({"url": "/companies/0000001234", "label": "Company profile: Akamai Technologies, Inc."}, linked[1]["item"]["links"])

    def test_budget_page_groups_links_under_headings(self):
        page = ('<div class="field_body"><h3>Agency Financial Reports</h3><p><a href="/doj/fy-2025-agency-financial-report" title="FY 2025 Agency Financial Report">2025 </a>| <a href="/doj/fy-2024-agency-financial-report">2024</a></p>'
                '<h3>Budget Fact Sheets</h3><p><a href="/media/9/dl">FY 2021</a></p></div></main>')
        rows = pds.parse_budget_page(page)
        self.assertEqual([(r["group"], r["label"]) for r in rows], [("Agency Financial Reports", "2025"), ("Agency Financial Reports", "2024"), ("Budget Fact Sheets", "FY 2021")])
        self.assertEqual(bds.label_year("FY 2019/FY 2021", None), 2019)
        self.assertIsNone(bds.label_year("Plan", None))

    def test_eeo_page(self):
        page = ('<div class="field_body"><h2>Reports, FY2026 3rd Quarter</h2><p>Department of Justice (DOJ) - &nbsp;<a href="/jmd/media/1/dl?inline">PDF</a>&nbsp;<span>| </span><a href="/jmd/no-fear-1">HTML</a></p>'
                '<p>No links here</p></div></main>')
        rows = pds.parse_eeo_page(page)
        self.assertEqual([(r["entity"], r["kind"]) for r in rows], [("Department of Justice (DOJ)", "PDF"), ("Department of Justice (DOJ)", "HTML")])

    def test_library_guides(self):
        page = '<a href="/jmd/ls/state" class="usa-nav__link "><span>State and Federal Court Resources</span></a><a href="/jmd/ls/state" class="usa-nav__link "><span>dup</span></a>'
        self.assertEqual(pds.parse_library_guides(page), [{"title": "State and Federal Court Resources", "url": "https://www.justice.gov/jmd/ls/state"}])


class Helpers(unittest.TestCase):
    def test_clip_cuts_at_word_boundary(self):
        text, clipped = rw.clip("alpha beta gamma delta", 12)
        self.assertEqual((text, clipped), ("alpha beta", True))
        self.assertEqual(rw.clip("short", 12), ("short", False))
        self.assertEqual(rw.clip(None, 12), (None, False))

    def test_money_label_and_facts(self):
        self.assertEqual(rw.money_label(None), "Not recorded")
        self.assertEqual(rw.money_label(1250000), "$1.25 million")
        self.assertEqual(rw.money_label(0), "$0")
        self.assertEqual(rw.facts_list([("a", None), ("b", ""), ("c", [1, None, 2]), ("d", 0)]),
                         [["a", "Not recorded"], ["b", "Not recorded"], ["c", "1; 2"], ["d", "0"]])

    def test_visible_text_joins_inline_tags_and_separates_blocks(self):
        from textclean import clean

        self.assertEqual(clean('<p class="a"><span>Salem</span>, <span>OR</span><br><span>United States</span></p>'), "Salem, OR United States")
        self.assertEqual(clean("<ul><li>One</li><li>Two&nbsp;three</li></ul>"), "One Two three")
        self.assertEqual(clean("a &amp; b"), "a & b")
        self.assertEqual(clean(None), "")

    def test_stable_id_is_deterministic(self):
        self.assertEqual(rw.stable_id("x", "a"), rw.stable_id("x", "a"))
        self.assertNotEqual(rw.stable_id("x", "a"), rw.stable_id("x", "b"))


if __name__ == "__main__":
    unittest.main()
