"""Offline unit tests for the enforcement_series builders (synthetic fixtures only, no network, no raw files).

Run: cd scripts/enrichment/enforcement_series && python3 -B -m unittest -v test_enforcement_series
"""
import json
import unittest

import appropriations as ap
import build_enforcement_series as be
import criminal_charts as cc
import extract_workload as ew
import harmonize as hz
import metrics as mx
import sherman_fines as sf
import workload_html as wh
import workload_pdf as wp


# ------------------------------------------------------------------------------------------------ PDF word-box reader
def w(text, x0, x1, bottom, size=12.0):
    return {"text": text, "x0": x0, "x1": x1, "top": bottom - size, "bottom": bottom, "size": size, "y": bottom}


def line_words(label, cells, bottom, years_x, label_x=20):
    """A table line: label words then one value word right-aligned under each year column."""
    words = [w(t, label_x + 40 * i, label_x + 40 * i + 30, bottom) for i, t in enumerate(label.split())] if label else []
    for x1, text in zip(years_x, cells):
        if text is not None:
            words.append(w(text, x1 - 6 * len(text), x1, bottom))
    return words


class PdfReaderTests(unittest.TestCase):
    YEARS = [2015, 2016, 2017, 2018, 2019]
    X = [300, 340, 380, 420, 460]

    def page(self):
        words = []
        words += line_words("TOTAL CRIMINAL CASES", [str(y) for y in self.YEARS], 60, self.X)
        words += line_words("Filed", ["60", "51", "-", "18", "26"], 80, self.X)
        words += line_words("Pending", ["59", "68", "64", None, "66"], 100, self.X)
        words.append(w("3", 462, 466, 94, size=7.0))  # footnote mark above the FY2019 pending cell
        return [words]

    def test_values_dash_and_missing_cell(self):
        tables, footnotes, orphans = wp.read_pages(self.page())
        self.assertEqual(len(tables), 1)
        rows = {r["label"]: r for r in tables[0]["rows"]}
        self.assertEqual(rows["Filed"]["values"][2015]["as_published"], "60")
        self.assertEqual(rows["Filed"]["values"][2015]["value"], 60)
        # a printed dash is kept as printed with no numeric value (never 0)
        self.assertEqual(rows["Filed"]["values"][2017]["as_published"], "-")
        self.assertIsNone(rows["Filed"]["values"][2017]["value"])
        # a cell the page does not print is simply absent: Not recorded downstream
        self.assertNotIn(2018, rows["Pending"]["values"])

    def test_parse_number(self):
        self.assertEqual(wp.parse_number("$1,475,109"), 1475109)
        self.assertEqual(wp.parse_number("609.8"), 609.8)
        self.assertIsNone(wp.parse_number("-"))


# ------------------------------------------------------------------------------------------------ HTML reader
HTML_TABLES = """
<table><tr><td>intro</td></tr></table>
<table>
<tr><th>Total Criminal Cases</th><th>1980</th><th>1981</th><th>1982</th><th>1983</th><th>1984</th></tr>
<tr><td>Filed</td><td>55</td><td>70</td><td>-</td><td>98</td><td>100</td></tr>
<tr><td>Terminated</td><td>61</td><td>59</td><td>87</td><td>93<a href="#N_6_"><sup>6</sup></a></td><td>82 7</td></tr>
<tr><td>Grand Juries</td></tr>
<tr><td>&nbsp;&nbsp;-&nbsp;Initiated</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr>
</table>
"""


class HtmlReaderTests(unittest.TestCase):
    def setUp(self):
        self.tables = wh.read_html_tables(HTML_TABLES)

    def test_table_found_with_locator(self):
        self.assertEqual(len(self.tables), 1)
        t = self.tables[0]
        self.assertEqual(t["index"], 1)  # second <table> of the page
        self.assertEqual(t["years"], [1980, 1981, 1982, 1983, 1984])

    def test_marks_dash_and_subheading(self):
        rows = {r["label"]: r for r in self.tables[0]["rows"]}
        self.assertEqual(rows["Filed"]["values"][2]["as_published"], "-")
        self.assertEqual(rows["Terminated"]["values"][3], {"as_published": "93", "marks": ["6"]})
        self.assertEqual(rows["Terminated"]["values"][4], {"as_published": "82", "marks": ["7"]})  # "82 7": value with a footnote printed as text
        bullet = [r for r in self.tables[0]["rows"] if "Initiated" in r["label"]][0]
        self.assertEqual(bullet["group"], "Grand Juries")

    def test_clean_label_and_cell(self):
        self.assertEqual(ew.clean_label("  - Granted"), ("Granted", True))
        self.assertEqual(ew.clean_label("Filed"), ("Filed", False))
        c = ew.cell("-", [], {"page": 1})
        self.assertTrue(c["dash"])
        self.assertIsNone(c["value"])
        self.assertEqual(ew.cell("$1,201", ["2"], {})["value"], 1201)


# ------------------------------------------------------------------------------------------------ metric rules
def table(heading, rows, tid="ed:pdf:t00"):
    return {"id": tid, "kind": "pdf", "page": 1, "heading": heading, "heading_marks": [], "section": None, "notes": [], "years": [2015],
            "rows": [{"label": lab, "published_label": lab, "sub": False, "group": None, "marks": [], "page": 1, "values": {2015: ew.cell(v, [], {"page": 1})}} for lab, v in rows]}


class RuleTests(unittest.TestCase):
    def test_single_match(self):
        tables = [table("TOTAL CRIMINAL CASES", [("Filed", "60"), ("Won", "45")])]
        t, r = mx.select_row(tables, mx.R(r"^TOTAL CRIMINAL CASES$", r"^Filed$"))
        self.assertEqual(r["values"][2015]["value"], 60)

    def test_no_match_and_ambiguous_match_raise(self):
        tables = [table("TOTAL CRIMINAL CASES", [("Filed", "60")]), table("TOTAL CRIMINAL CASES", [("Filed", "61")], tid="ed:pdf:t01")]
        with self.assertRaises(mx.RuleError):
            mx.select_row(tables, mx.R(r"^TOTAL CRIMINAL CASES$", r"^Filed$"))  # two tables match: never guess
        with self.assertRaises(mx.RuleError):
            mx.select_row(tables, mx.R(r"^NO SUCH TABLE$", r"^Filed$"))

    def test_previous_row_constraint(self):
        t = [table("Indictments", [("Total Corporations Fines", "9"), ("No. of Corporations", "5"), ("Total Corporation Damages", "7"), ("No. of Corporations", "3")])]
        _, r = mx.select_row(t, mx.R(r"^Indictments$", r"^No\. of Corporations$", prev=r"^Total Corporations Fines$"))
        self.assertEqual(r["values"][2015]["value"], 5)

    def test_real_rules_have_one_rule_per_known_edition(self):
        for m in mx.METRICS:
            self.assertTrue(set(m["rules"]) <= set(mx.ORDER), m["key"])
        self.assertEqual(len({m["key"] for m in mx.METRICS}), len(mx.METRICS))


# ------------------------------------------------------------------------------------------------ series, derived figures, YoY
def cell_(edition, text, value=None, dash=False):
    return {"as_published": text, "value": value if value is not None else (None if dash else int(text.replace(",", "").replace("$", ""))), "dash": dash, "marks": [], "label_marks": [], "heading_marks": [],
            "edition": edition, "heading": "H", "label": "L", "kind": "pdf", "page": 1, "notes": []}


def entry(edition, text, **kw):
    return {"cell": cell_(edition, text, **kw), "alts": []}


class SeriesTests(unittest.TestCase):
    def test_later_edition_supersedes_and_earlier_value_is_kept(self):
        per = {"fy2010_2019": {2018: cell_("fy2010_2019", "2,117")}, "fy2015_2024": {2018: cell_("fy2015_2024", "2,111")}, hz.CHART: {2018: cell_(hz.CHART, "9")}}
        primary, alts = hz.pick(per, 2018)
        self.assertEqual(primary["as_published"], "2,111")
        self.assertEqual({a["edition"] for a in alts}, {"fy2010_2019", hz.CHART})
        self.assertEqual(hz.pick(per, 2030), (None, []))

    def test_chart_only_fills_years_no_edition_prints(self):
        per = {"fy2015_2024": {2024: cell_("fy2015_2024", "20")}, hz.CHART: {2024: cell_(hz.CHART, "20"), 2025: cell_(hz.CHART, "27")}}
        self.assertEqual(hz.pick(per, 2025)[0]["as_published"], "27")
        self.assertEqual(hz.pick(per, 2024)[0]["edition"], "fy2015_2024")

    def test_derived_ratios_and_not_recorded(self):
        series = {"crim_won": {2000: entry("e", "9"), 2001: entry("e", "-", dash=True)}, "crim_lost": {2000: entry("e", "1"), 2001: entry("e", "1")},
                  "fine_corporate_000": {2000: entry("e", "1,000")}, "fine_corporations_n": {2000: entry("e", "0")},
                  "fine_individual_000": {1980: entry("e", "100")}, "fine_total_000": {}}
        d = hz.derive(series, [2000, 2001], {2000: 500}, {})
        self.assertEqual(d["crim_win_rate_pct"][2000]["value"], 90.0)
        self.assertNotIn(2001, d["crim_win_rate_pct"])  # a printed dash is never read as zero
        self.assertNotIn(2000, d["fine_corporate_avg_000"])  # zero denominator: Not recorded
        self.assertEqual(d["appropriation_total_000"][2000]["value"], 500)

    def test_total_fines_computed_only_before_1990_and_basis_recorded(self):
        series = {"fine_individual_000": {1985: entry("e", "10"), 1995: entry("e", "10")}, "fine_corporate_000": {1985: entry("e", "90"), 1995: entry("e", "90")},
                  "fine_total_000": {1995: entry("e", "100")}}
        d = hz.derive(series, [1985, 1995], {1985: 50, 1995: 25}, {})
        self.assertEqual(d["fine_total_000_best"][1985], {"value": 100, "basis": "computed", "inputs": ["fine_individual_000", "fine_corporate_000"]})
        self.assertEqual(d["fine_total_000_best"][1995]["basis"], "published")
        self.assertEqual(d["fines_to_appropriation_ratio"][1985]["value"], 2.0)

    def test_civil_filed_extension_from_fy2020_only(self):
        series = {"civil_filed": {2019: entry("e", "19")}, "merger_complaints_filed": {2019: entry("e", "10"), 2021: entry("e", "8")}, "conduct_complaints_filed": {2019: entry("e", "9"), 2021: entry("e", "2")}}
        d = hz.derive(series, [2019, 2021], {}, {})
        self.assertEqual(d["civil_filed_best"][2019]["basis"], "published")
        self.assertEqual(d["civil_filed_best"][2021], {"value": 10, "basis": "computed", "inputs": ["merger_complaints_filed", "conduct_complaints_filed"]})

    def test_yoy_trailing_mean_and_cross_edition_flag(self):
        series = {"crim_filed": {1989: entry("fy1980_1989", "86"), 1990: entry("fy1990_1999", "75"), 1991: entry("fy1990_1999", "81")}}
        pct, cross = hz.yoy(series, {}, "crim_filed", 1990)
        self.assertEqual((pct, cross), (-12.8, True))
        pct, cross = hz.yoy(series, {}, "crim_filed", 1991)
        self.assertEqual((pct, cross), (8.0, False))
        self.assertEqual(hz.yoy(series, {}, "crim_filed", 1989), (None, False))  # FY1988 absent
        self.assertIsNone(hz.trailing_mean(series, {}, "crim_filed", 1991))  # needs five numeric years
        full = {"crim_filed": {y: entry("e", str(10 * (y - 1999))) for y in range(2000, 2006)}}
        self.assertEqual(hz.trailing_mean(full, {}, "crim_filed", 2005), 40.0)  # mean of 20, 30, 40, 50, 60

    def test_yoy_zero_prior_is_none(self):
        series = {"crim_filed": {2000: entry("e", "0"), 2001: entry("e", "5")}}
        self.assertEqual(hz.yoy(series, {}, "crim_filed", 2001), (None, False))


class IdentityTests(unittest.TestCase):
    def ed(self, terminated, won, lost, dismissed):
        def row(label, v, sub=False):
            return {"label": label, "sub": sub, "values": {2000: ew.cell(v, [], {})}}
        return {"key": "fy2000_2009", "years": [2000], "tables": [{"heading": "TOTAL CIVIL CASES", "page": 5, "rows": [row("Terminated", terminated), row("Won", won, True), row("Lost", lost, True), row("Dismissed", dismissed, True)]}]}

    def test_pass_fail_and_dash_as_zero_in_check_only(self):
        n, failed = hz.identity_checks(self.ed("12", "10", "1", "1"))
        self.assertEqual((n, len(failed)), (1, 0))
        n, failed = hz.identity_checks(self.ed("12", "10", "-", "1"))
        self.assertEqual((n, len(failed)), (1, 1))
        self.assertEqual(failed[0]["sum_of_parts"], 11)
        n, failed = hz.identity_checks(self.ed("-", "10", "1", "1"))
        self.assertEqual(n, 0)  # a dash total is not tested


class FootnoteTests(unittest.TestCase):
    def test_footer_stripped_and_overrides_applied(self):
        text, repaired = hz.clean_footnote("fy1980_1989", "9", "This unusually high number of civil cases. Antitrust Division, Workload Statistics 4")
        self.assertEqual((text, repaired), ("This unusually high number of civil cases.", False))
        text, repaired = hz.clean_footnote("fy1990_1999", "6", "first CID issued in an investigation. This statistic includes only")
        self.assertTrue(repaired)
        self.assertTrue(text.startswith("This statistic includes only first CID"))


# ------------------------------------------------------------------------------------------------ appropriations
APPR_HTML = """
<p>(Updated September 2026)</p>
<p>*The fiscal year from 1903 to 1976 was from July 1 through June 30. In 1977, it changed to the current period from October 1 through September 30.</p>
<table>
<tr><th>Fiscal Year</th><th>General Fund</th><th>Fee</th><th>Total</th><th>Notes</th></tr>
<tr><td>2011</td><td>60,844</td><td>102,000</td><td>162,844</td><td>rescission</td></tr>
<tr><td>2010</td><td>61,170</td><td>102,000</td><td>163,170</td><td></td></tr>
<tr><td>2009</td><td>-</td><td>157,788</td><td>157,788</td><td></td></tr>
<tr><td>1904</td><td>500</td><td>-</td><td>500</td><td>one note spans rows</td></tr>
<tr><td>1905</td><td>0</td><td>-</td><td>0</td></tr>
</table>
"""
APPR_CSV = 'Appropriation Figures\nFiscal Year,"General Fund","Fee","Total",Notes\n2011,60844,102000,162844,rescission\n2010,53170,110000,163170,\n2009,0,157788,157788,\n1904,500,,500,one note spans rows\n1905,0,,0,one note spans rows\n'


class AppropriationTests(unittest.TestCase):
    def test_html_dash_and_spanned_note(self):
        rows, meta = ap.read_html(APPR_HTML)
        self.assertEqual(meta["updated"], "September 2026")
        self.assertTrue(rows[2009]["gf"]["dash"])
        self.assertIsNone(rows[2009]["gf"]["value"])
        self.assertTrue(rows[1905]["note_spanned"])
        self.assertEqual(rows[1905]["note"], "one note spans rows")

    def test_compare_flags_value_conflict_only(self):
        html_rows, _ = ap.read_html(APPR_HTML)
        csv_rows = ap.read_csv(APPR_CSV)
        cmp_ = ap.compare(html_rows, csv_rows)
        fields = {(c["fy"], c["field"]) for c in cmp_["conflicts"]}
        self.assertEqual(fields, {(2010, "gf"), (2010, "fee")})  # dash vs 0 and dash vs blank are representation, not conflict
        self.assertEqual(cmp_["representation"], [])

    def test_build_shows_not_recorded_for_conflicting_split_and_estimates(self):
        html_rows, meta = ap.read_html(APPR_HTML)
        html_rows[2011]["note"] = "Estimate"
        ctx = {"appr_html": html_rows, "appr_conflicts": {2010: {"xls_gf": "53170", "xls_fee": "110000"}}, "appr_url": "https://example.test/a", "appr_meta": meta, "appr_comparison": {"conflicts": [], "representation": []}}
        rows, summary = be.build_appropriations(ctx)
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(by_id["fy2010"]["item"]["cells"]["general_fund_000"], be.NR)
        self.assertEqual(by_id["fy2010"]["item"]["cells"]["total_000"], 163170)
        self.assertEqual(by_id["fy2011"]["item"]["cells"]["status"], "Estimate")
        self.assertEqual(by_id["fy1904"]["item"]["cells"]["yoy_pct"], be.NR)  # no FY1903 in this fixture
        self.assertEqual(by_id["fy2010"]["item"]["cells"]["yoy_pct"], round((163170 - 157788) / 157788 * 100, 1))
        self.assertTrue(all(r["dataset"] == be.APPROP_DS and r["source_url"] for r in rows))
        self.assertEqual(json.loads(json.dumps(rows)), rows)  # JSON round-trip stable (no int keys)


# ------------------------------------------------------------------------------------------------ fines list
FINES_HTML = """
<table><tr><td>pdf note</td></tr></table>
<table>
<tr><th>Defendant (FY)</th><th>Product</th><th>Fine ($ Millions)</th><th>Geographic Scope</th><th>Country</th></tr>
<tr><td>Pfizer Inc. (1999)</td><td>Sorbates</td><td>$20</td><td>International</td><td>U.S.</td></tr>
<tr><td>Acme Corp (2012)</td><td>Parts</td><td>$34</td><td>International</td><td>Japan</td></tr>
<tr><td>Acme Corp (2012)</td><td>Parts</td><td>$12.5</td><td>Domestic</td><td>U.S.</td></tr>
</table>
"""


class FinesTests(unittest.TestCase):
    def test_row_parsing_via_tables(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as fh:
            fh.write(FINES_HTML)
        try:
            rows = sf.read_html(fh.name)
        finally:
            os.unlink(fh.name)
        self.assertEqual([r["fy"] for r in rows], [1999, 2012, 2012])
        self.assertEqual(rows[2]["fine_millions"], 12.5)
        self.assertEqual(rows[0]["defendant"], "Pfizer Inc.")

    def test_pdf_line_pattern(self):
        line = "Teva Pharmaceuticals USA, Inc.                    2023       Generic Drugs                                  $225         Domestic         U.S."
        m = sf.LINE_RE.match(line)
        self.assertEqual((m.group("fy"), m.group("fine"), m.group("scope")), ("2023", "225", "Domestic"))

    def test_compare_flags_text_and_number_differences(self):
        a = [{"position": 1, "defendant": "NSK Ltd", "fy": 2014, "product": "P", "fine_millions": 34.0, "scope": "International", "country": "Japan"}]
        b = [{"position": 1, "defendant": "NSK Ltd.", "fy": 2014, "product": "P", "fine_millions": 34.078, "scope": "International", "country": "Japan"}]
        c = sf.compare(a, b, [{"fy": 2014, "fine_millions": 34.0, "scope": "International"}])
        self.assertEqual({d["field"] for d in c["differences"]}, {"defendant", "fine_millions"})
        self.assertEqual(c["pdf_only"], [])

    def test_ids_are_unique_for_repeat_defendants(self):
        ids = be.assign_fine_ids([{"fy": 2012, "defendant": "Acme Corp"}, {"fy": 2012, "defendant": "Acme Corp"}, {"fy": 2013, "defendant": "Acme Corp"}])
        self.assertEqual(ids, ["fine:2012:acme-corp", "fine:2012:acme-corp-2", "fine:2013:acme-corp"])


class CompanyMatchTests(unittest.TestCase):
    PROFILES = [{"cik": "0000078003", "name": "PFIZER INC"}, {"cik": "0000818686", "name": "TEVA PHARMACEUTICAL INDUSTRIES LTD"}, {"cik": "0000000001", "name": "Twin Co"}, {"cik": "0000000002", "name": "TWIN CO."}]

    def test_name_key(self):
        self.assertEqual(be.name_key("Pfizer Inc."), be.name_key("PFIZER  INC"))
        self.assertNotEqual(be.name_key("Pfizer Inc."), be.name_key("Pfizer"))

    def test_unique_exact_match_nonmatch_and_ambiguous(self):
        fines = [{"id": "a", "defendant": "Pfizer Inc."}, {"id": "b", "defendant": "Teva Pharmaceuticals USA, Inc."}, {"id": "c", "defendant": "Twin Co"}, {"id": "d", "defendant": "Unknown Ltd"}]
        out, ambiguous = be.exact_company_matches(fines, self.PROFILES)
        self.assertEqual(out["a"], "0000078003")
        self.assertIsNone(out["b"])  # different name: no fuzzy merge
        self.assertIsNone(out["c"])  # two profiles share the normalised name: ambiguous, not linked
        self.assertEqual(ambiguous, ["c"])
        self.assertIsNone(out["d"])
        near = be.company_near_misses(fines, self.PROFILES, out)
        self.assertEqual([n["defendant"] for n in near], ["Teva Pharmaceuticals USA, Inc."])


# ------------------------------------------------------------------------------------------------ criminal charts
class ChartTests(unittest.TestCase):
    TABLE = '<main><table><thead><tr><th>Fiscal Year</th><th>Fine Amounts<br/>in $ Millions</th></tr></thead><tbody><tr><th scope="row">2016</th><td>458</td></tr><tr><th scope="row">2017</th><td>2000</td></tr></tbody></table><div class="node-updated-date">Updated December 9, 2025</div></main>'

    def test_table_and_updated(self):
        header, rows = cc.read_table(self.TABLE)
        self.assertEqual(header[1], "Fine Amounts in $ Millions")
        self.assertEqual([(r["fy"], r["values"]) for r in rows], [(2016, ["458"]), (2017, ["2000"])])
        self.assertEqual(cc.updated(self.TABLE), "December 9, 2025")

    def test_decade_averages_with_nbsp_entity(self):
        markup = "<p>1990-1999 Average - 8</p><p>2020-2025&nbsp;Average - 17</p>"
        self.assertEqual([(d["from"], d["to"], d["months"]) for d in cc.read_decade_averages(markup)], [(1990, 1999, 8), (2020, 2025, 17)])

    def test_millions_match_rounds_or_truncates_at_printed_precision(self):
        self.assertTrue(be.millions_match(633993, "633"))  # truncated
        self.assertTrue(be.millions_match(10601, "10.6"))
        self.assertTrue(be.millions_match(2011, "2"))
        self.assertFalse(be.millions_match(2785856, "2000"))  # FY2017: the chart page and the workload report disagree
        self.assertIsNone(be.millions_match(None, "6"))


class FormatTests(unittest.TestCase):
    def test_not_recorded_and_formats(self):
        self.assertEqual(be.fmt_int(None), "Not recorded")
        self.assertEqual(be.fmt_int(1234567), "1,234,567")
        self.assertEqual(be.fmt_int(10.5), "10.5")
        self.assertEqual(be.fmt_pct(None), "Not recorded")
        self.assertEqual(be.cellv(None), "Not recorded")
        self.assertEqual(be.decade(1999), "1990s")
        self.assertEqual(be.slug("Société Air France & KLM"), "soci-t-air-france-klm")


if __name__ == "__main__":
    unittest.main()
