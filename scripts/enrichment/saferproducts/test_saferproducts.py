"""Offline tests for the SaferProducts.gov enrichment (synthetic fixtures only; no network, no files read).

  cd scripts/enrichment/saferproducts && python3 -B -m unittest -v test_saferproducts

Covers parsing (export structure, dates, severity, age bands), placeholder and contact-detail guards, company-name keys,
hazard-theme rules, aggregation math (YoY, year-to-date, growth eligibility and ranking, same-model clusters, lags,
precision intervals), exact-key matching (match, no match, ambiguous) and the Not-recorded paths.
"""
import csv
import datetime as dt
import io
import unittest

import analysis as A
import crosscheck as X
import spdb_lib as L
import theme_precision as TP

D = dt.date


def make_row(**over):
    base = {
        "report_no": "20260101-ABCDE-123456", "report_date": "1/5/2026", "sent_date": "1/6/2026", "pub_date": "1/20/2026",
        "submitter": "Consumer", "product_desc": "Widget", "category": "Kitchen", "subcategory": "Cooking", "ptype": "Ovens (278)",
        "pcode": "278", "mfr": "Acme Inc.", "brand": "Acme", "model": "A-1", "retailer": "Shop", "purchase_date": "1/1/2025",
        "description": "The oven caught fire.", "state": "Ohio", "severity": "Incident, No Injury", "age": "30", "comments": "",
        "associated": "",
    }
    base.update(over)
    return {L.COLUMNS[k]: v for k, v in base.items()}


def make_csv(rows, header=None, disclaimer=True):
    header = header or [L.COLUMNS[k] for k in L.COLUMNS]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    if disclaimer:
        writer.writerow(["Disclaimer: CPSC does not guarantee the accuracy of this data."])
    writer.writerow(header)
    for row in rows:
        writer.writerow([row.get(h, "") for h in header] if isinstance(row, dict) else row)
    return out.getvalue()


def rep(**over):
    report, reason = L.to_report(make_row(**over))
    assert report is not None, reason
    return report


class DateTests(unittest.TestCase):
    def test_valid_and_timestamp(self):
        self.assertEqual(L.parse_date("3/7/2024"), D(2024, 3, 7))
        self.assertEqual(L.parse_date("12/31/2020 10:15:00 AM"), D(2020, 12, 31))

    def test_blank_malformed_impossible_are_none(self):
        for bad in ("", None, "2024-03-07", "13/1/2020", "2/30/2020", "garbage"):
            self.assertIsNone(L.parse_date(bad), bad)

    def test_plausible_year(self):
        self.assertTrue(L.plausible_year(D(2011, 5, 6)))
        self.assertFalse(L.plausible_year(D(1999, 1, 1)))
        self.assertFalse(L.plausible_year(None))


class SeverityAgeTests(unittest.TestCase):
    def test_severity_groups(self):
        self.assertEqual(L.severity_group("Death"), "death")
        for level in ("Injury, Hospital Admission", "Injury, Emergency Department Treatment Received", "Injury, Seen by Medical Professional",
                      "Injury, First Aid Received by Non-Medical Professional", "Injury, No First Aid or Medical Attention Received", "Injury, Level of care not known"):
            self.assertEqual(L.severity_group(level), "injury", level)
        self.assertEqual(L.severity_group("Incident, No Injury"), "incident_no_injury")
        self.assertEqual(L.severity_group("No Incident, No Injury"), "no_incident")
        self.assertEqual(L.severity_group("Unspecified"), "unspecified")

    def test_severity_not_recorded_and_unmapped(self):
        self.assertEqual(L.severity_group(""), "not_recorded")
        self.assertEqual(L.severity_group("Something new"), "unmapped")

    def test_age_parse(self):
        self.assertEqual(L.parse_age("30"), 30.0)
        self.assertEqual(L.parse_age("0.5"), 0.5)
        for bad in ("", "abc", "-1", "121", "1e3", None):
            self.assertIsNone(L.parse_age(bad), bad)

    def test_age_bands_use_whole_years(self):
        cases = [(0.99, "under_1"), (1, "1_4"), (4.9, "1_4"), (5, "5_12"), (12.99, "5_12"), (13, "13_17"), (17.5, "13_17"),
                 (18, "18_64"), (64.9, "18_64"), (65, "65_plus"), (120, "65_plus"), (None, "not_recorded")]
        for age, band in cases:
            self.assertEqual(L.age_band(age), band, age)


class PlaceholderContactTests(unittest.TestCase):
    def test_placeholders(self):
        for value in ("", "Unknown", "N/A", "n/a", "None", "I don't know", "I don’t know", "[REDACTED]", "Gift", "???", "unknown model"):
            self.assertTrue(L.is_placeholder(value), value)
        for value in ("Whirlpool", "Model 5", "Unknownville Co"):
            self.assertFalse(L.is_placeholder(value), value)

    def test_contact_like_values_are_withheld(self):
        self.assertTrue(L.contact_like("john.doe@example.com"))
        self.assertTrue(L.contact_like("call 555-123-4567 now"))
        self.assertTrue(L.contact_like("10 Strawberry Street"))
        self.assertEqual(L.guard_contact("10 Strawberry Street"), L.WITHHELD)
        self.assertTrue(L.is_placeholder(L.WITHHELD))

    def test_business_names_and_sites_pass(self):
        for value in ("www.amazon.com", "Juki, www.jukihome.com", "Street Hockey Inc", "3M Co", "Model 12 Streetwise", "AB-1234", "Acme"):
            self.assertFalse(L.contact_like(value), value)
            self.assertEqual(L.guard_contact(value), value)

    def test_report_withholds_and_counts(self):
        report = rep(brand="bob@example.com", mfr="Acme Inc.")
        self.assertEqual(report.brand, L.WITHHELD)
        self.assertEqual(report.contact_withheld, 1)
        self.assertEqual(report.mfr, "Acme Inc.")


class CompanyKeyTests(unittest.TestCase):
    def test_key_rules(self):
        self.assertEqual(L.company_key("Walmart Inc."), "walmart")
        self.assertEqual(L.company_key("The Home Depot, Inc."), "home depot")
        self.assertEqual(L.company_key("AT&T Corp"), "at and t")
        self.assertEqual(L.company_key("WHIRLPOOL CORPORATION"), L.company_key("Whirlpool Corp."))
        self.assertEqual(L.company_key("Foo Bar/DE"), "foo bar")
        self.assertEqual(L.company_key("Co"), "co")  # a lone legal word is not stripped to nothing

    def test_different_names_have_different_keys(self):
        self.assertNotEqual(L.company_key("GE Appliances"), L.company_key("GE Lighting"))

    def test_strip_location(self):
        self.assertEqual(L.strip_location("Acme Inc., of Reno, Nev."), "Acme Inc.")
        self.assertEqual(L.strip_location("KTM Motorrad AG, of Austria"), "KTM Motorrad AG")
        self.assertEqual(L.strip_location("Bank of America"), "Bank of America")
        self.assertEqual(L.strip_location("House of Marley, LLC"), "House of Marley, LLC")


class IncidentCsvTests(unittest.TestCase):
    def test_parse_counts_duplicates_malformed_blank(self):
        rows = [
            make_row(),
            make_row(),  # duplicate report number
            make_row(report_no="20260102-ABCDE-123457", severity="Death", age="2"),
            make_row(report_no="BADNUMBER"),  # malformed report number
            ["short", "row"],  # wrong column count
            [""] * len(L.COLUMNS),  # blank row
        ]
        parsed = L.parse_incident_csv(make_csv(rows))
        self.assertEqual(len(parsed["reports"]), 2)
        self.assertEqual(parsed["stats"]["duplicates"], 1)
        self.assertEqual(parsed["stats"]["malformed"], 2)
        self.assertEqual(parsed["stats"]["blank_rows"], 1)
        self.assertTrue(parsed["disclaimer"].startswith("Disclaimer"))
        by_no = {r.report_no: r for r in parsed["reports"]}
        self.assertEqual(by_no["20260102-ABCDE-123457"].severity, "death")
        self.assertEqual(by_no["20260102-ABCDE-123457"].band, "1_4")

    def test_missing_required_column_raises(self):
        header = [L.COLUMNS[k] for k in L.COLUMNS if k != "severity"]
        with self.assertRaises(L.ExportError):
            L.parse_incident_csv(make_csv([], header=header))

    def test_row_before_header_raises(self):
        with self.assertRaises(L.ExportError):
            L.parse_incident_csv("not a header\r\n1,2,3\r\n")

    def test_blank_fields_become_not_recorded_not_guesses(self):
        report = rep(category="", state="", age="", severity="", sent_date="", purchase_date="", description="")
        self.assertEqual(report.category, "Not recorded")
        self.assertEqual(report.state, "Not recorded")
        self.assertIsNone(report.age)
        self.assertEqual(report.band, "not_recorded")
        self.assertEqual(report.severity, "not_recorded")
        self.assertIsNone(report.sent_date)
        self.assertIsNone(report.purchase_date)
        self.assertFalse(report.has_description)
        self.assertEqual(report.themes, set())

    def test_comment_and_associated_flags(self):
        report = rep(comments="We reviewed this.", associated="20260101-AAAAA-111111, 20260101-BBBBB-222222")
        self.assertTrue(report.has_comment)
        self.assertEqual(report.assoc, 2)

    def test_decode_prefers_utf8_then_cp1252(self):
        self.assertEqual(L.decode_export("café".encode("utf-8"))[1], "utf-8")
        text, enc = L.decode_export("café".encode("cp1252"))
        self.assertEqual((text, enc), ("café", "cp1252"))
        self.assertEqual(L.decode_export(b"\xef\xbb\xbfabc")[0], "abc")


class RecallsCsvTests(unittest.TestCase):
    def test_two_blocks_and_malformed(self):
        text = (
            "Disclaimer: x\r\n"
            "Title,Date,Summary,Repair Number\r\n"
            "Repair thing,1/2/2020,sum,R1\r\n"
            "Title,Date,Summary,Recall Number,Recall URL\r\n"
            "Recall one,3/4/2021,sum,10001,https://www.cpsc.gov/Recalls/2021/x\r\n"
            "Recall two,bad date,sum,10002,https://www.cpsc.gov/Recalls/2021/y\r\n"
            "Short,3/4/2021\r\n"
        )
        parsed = L.parse_recalls_csv(text)
        kinds = [(r["number"], r["kind"]) for r in parsed["rows"]]
        self.assertEqual(kinds, [("R1", "repair"), ("10001", "recall")])
        self.assertEqual(parsed["rows"][1]["url"], "https://www.cpsc.gov/Recalls/2021/x")
        self.assertEqual(parsed["stats"]["malformed"], 2)

    def test_unknown_header_raises(self):
        with self.assertRaises(L.ExportError):
            L.parse_recalls_csv("Title,Date,Summary,Something\r\n")


class ThemeTests(unittest.TestCase):
    def test_positive_cases(self):
        cases = {
            "fire": "the stove caught fire last night", "burn": "she got a second degree burn", "battery": "the lithium battery swelled",
            "choking": "this is a choking hazard", "strangulation": "a cord wrapped around his neck", "tip_over": "the dresser tipped over",
            "fall": "my son fell off the bed", "laceration": "the blade caused a laceration", "lead": "the paint contains lead",
            "poisoning": "possible chemical exposure and poisoning", "ingestion": "the toddler swallowed a magnet",
            "electric_shock": "i received an electric shock", "carbon_monoxide": "the carbon monoxide detector went off",
            "suffocation": "the baby could have suffocated",
        }
        for theme, text in cases.items():
            self.assertIn(theme, L.theme_hits(text), theme)

    def test_documented_false_positive_guards(self):
        self.assertNotIn("fall", L.theme_hits("she fell asleep on the couch"))
        self.assertNotIn("poisoning", L.theme_hits("the product is non-toxic"))
        self.assertNotIn("poisoning", L.theme_hits("food poisoning from the fridge"))
        self.assertNotIn("fire", L.theme_hits("i ignited the burner and cooked"))
        self.assertNotIn("suffocation", L.theme_hits("the fire was smothered with a blanket"))
        self.assertNotIn("lead", L.theme_hits("this led me to call the company"))
        self.assertNotIn("choking", L.theme_hits("the choke lever was loose"))
        self.assertNotIn("electric_shock", L.theme_hits("i was shocked to find it broken"))

    def test_blank_and_apostrophe_folding(self):
        self.assertEqual(L.theme_hits(""), set())
        self.assertEqual(L.theme_hits(None), set())
        self.assertIn("suffocation", L.theme_hits("the baby couldn’t breathe"))

    def test_stem_prefilter_never_drops_a_regex_match(self):
        # found by the independent verifier: the regex matched these but the old fall stems did not contain 'slip'/'trip'
        for text in ("she sliped and fell on the stairs", "the wet floor caused me to trip", "he was tripping over the cord and fell over"):
            lowered = text.lower()
            for tid, (_label, rx, stems) in L.THEMES.items():
                if rx.search(lowered):
                    self.assertTrue(any(s in lowered for s in stems), "%s stems miss %r" % (tid, text))
        self.assertIn("fall", L.theme_hits("she sliped and fell on the stairs"))
        self.assertIn("fall", L.theme_hits("the wet floor caused me to trip"))

    def test_every_theme_has_stems_covering_its_regex(self):
        for tid, (_label, rx, stems) in L.THEMES.items():
            self.assertTrue(stems, tid)
            self.assertTrue(rx.pattern, tid)


class StatsTests(unittest.TestCase):
    def test_pct_change_median_percentile(self):
        self.assertEqual(L.pct(1, 4), 25.0)
        self.assertIsNone(L.pct(1, 0))
        self.assertEqual(L.change_pct(150, 100), 50.0)
        self.assertIsNone(L.change_pct(5, 0))
        self.assertIsNone(L.median([]))
        self.assertEqual(L.median([1, 3, 2]), 2)
        self.assertEqual(L.percentile_nearest_rank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9)
        self.assertEqual(L.percentile_nearest_rank([7], 90), 7)
        self.assertIsNone(L.percentile_nearest_rank([], 90))

    def test_ratio_interval(self):
        ratio, low, high = L.ratio_ci95(200, 100)
        self.assertEqual(ratio, 2.0)
        self.assertLess(low, 2.0)
        self.assertGreater(high, 2.0)
        # exp(ln 2 -/+ 1.96 * sqrt(1/200 + 1/100)) = 1.5732 / 2.5424
        self.assertAlmostEqual(low, 1.5732, places=3)
        self.assertAlmostEqual(high, 2.5424, places=3)
        self.assertIsNone(L.ratio_ci95(0, 10))
        self.assertIsNone(L.ratio_ci95(10, 0))

    def test_wilson_interval(self):
        self.assertEqual(TP.wilson(20, 20), (83.9, 100.0))
        self.assertEqual(TP.wilson(0, 20), (0.0, 16.1))
        self.assertIsNone(TP.wilson(0, 0))
        low, high = TP.wilson(17, 20)
        self.assertEqual((low, high), (64.0, 94.8))


def fixture_reports():
    """2019: 2 reports, 2020: 4, 2021 (partial, through 3/15): 3; one 2021 report outside the year-to-date window."""
    rows = []
    n = 100000
    for pub in ["2/1/2019", "6/1/2019", "1/10/2020", "2/10/2020", "7/10/2020", "11/10/2020", "1/15/2021", "3/1/2021", "3/15/2021"]:
        n += 1
        month, day, year = (int(p) for p in pub.split("/"))
        rows.append(rep(report_no="%04d0101-ABCDE-%06d" % (year, n), report_date="%d/1/%d" % (month, year), sent_date="", pub_date=pub))
    return rows


class SeriesTests(unittest.TestCase):
    def setUp(self):
        self.reports = fixture_reports()
        self.ctx = A.Ctx(self.reports)

    def test_context_flags_partial_years(self):
        self.assertEqual(self.ctx.pub_years, [2019, 2020, 2021])
        self.assertTrue(self.ctx.pub_partial(2019))  # starts 2/1, not 1/1
        self.assertFalse(self.ctx.pub_partial(2020))
        self.assertTrue(self.ctx.pub_partial(2021))
        self.assertEqual(self.ctx.cutoff, (3, 15))
        self.assertEqual(self.ctx.last_complete, 2020)

    def test_yoy_and_comparability(self):
        rows = A.series_rows(self.reports, self.ctx)["published"]
        by_year = {r["year"]: r for r in rows}
        self.assertEqual([by_year[y]["reports"] for y in (2019, 2020, 2021)], [2, 4, 3])
        self.assertEqual(by_year[2020]["yoy_pct"], 100.0)
        self.assertFalse(by_year[2020]["yoy_comparable"])  # 2019 is partial
        self.assertIsNone(by_year[2019]["yoy_pct"])

    def test_year_to_date_window_and_excluding_largest(self):
        rows = A.series_rows(self.reports, self.ctx)["published"]
        ytd = next(r for r in rows if r["year"] == 2021)["ytd"]
        self.assertEqual(ytd["through"], "03-15")
        self.assertEqual(ytd["reports"], 3)
        self.assertEqual(ytd["prior_year_same_window"], 2)  # 1/10 and 2/10 of 2020; later 2020 dates excluded
        self.assertEqual(ytd["change_vs_prior_year_pct"], 50.0)
        self.assertEqual(ytd["base_year_same_window"], 1)  # 2019-02-01 only
        self.assertEqual(ytd["excluding_largest_company"]["company"], "Acme Inc.")

    def test_complete_year_has_no_ytd_and_no_2019_change_for_base(self):
        rows = A.series_rows(self.reports, self.ctx)["published"]
        row = next(r for r in rows if r["year"] == 2020)
        self.assertNotIn("ytd", row)
        self.assertIsNone(next(r for r in rows if r["year"] == 2019)["change_vs_2019_pct"])

    def test_empty_cohort_block_is_safe(self):
        block = A.block([], "full")
        self.assertEqual(block["reports"], 0)
        self.assertIsNone(block["manufacturer_comment_rate_pct"])
        self.assertIsNone(block["lag"]["report_to_publication_days"]["median"])


class GrowthTests(unittest.TestCase):
    def ctx_for_years(self, last_year):
        reports = [rep(report_no="%d0101-ABCDE-100001" % last_year, report_date="1/1/%d" % last_year, pub_date="12/31/%d" % last_year),
                   rep(report_no="%d0101-ABCDE-100002" % (last_year - 6), report_date="1/1/%d" % (last_year - 6), pub_date="1/1/%d" % (last_year - 6))]
        return A.Ctx(reports)

    def test_eligibility_needs_volume_in_both_windows(self):
        ctx = self.ctx_for_years(2024)
        self.assertEqual((ctx.recent, ctx.prior), ((2022, 2024), (2019, 2021)))  # last complete year 2024
        recent_years = range(ctx.recent[0], ctx.recent[1] + 1)
        prior_years = range(ctx.prior[0], ctx.prior[1] + 1)
        ok = {**{y: 20 for y in recent_years}, **{y: 20 for y in prior_years}}
        g = A.growth_block(ok, ctx)
        self.assertTrue(g["eligible"])  # 60 and 60
        self.assertEqual(g["change_pct"], 0.0)
        thin = {**{y: 20 for y in recent_years}, prior_years[0]: 5}
        g2 = A.growth_block(thin, ctx)
        self.assertFalse(g2["eligible"])
        self.assertIsNotNone(g2["change_pct"])  # still computed, just not ranked

    def test_zero_prior_has_no_change_or_ratio(self):
        ctx = self.ctx_for_years(2024)
        g = A.growth_block({y: 40 for y in range(ctx.recent[0], ctx.recent[1] + 1)}, ctx)
        self.assertIsNone(g["change_pct"])
        self.assertIsNone(g["ratio"])
        self.assertFalse(g["eligible"])

    def test_rank_growth_orders_eligible_only(self):
        def rec(name, change, eligible):
            return {"kind": "type", "name": name, "growth": {"eligible": eligible, "change_pct": change}}
        records = [rec("a", 10.0, True), rec("b", 50.0, True), rec("c", 99.0, False), rec("d", -5.0, True)]
        A.rank_growth(records)
        ranks = {r["name"]: (r["growth"]["rank"], r["growth"]["rank_of"]) for r in records}
        self.assertEqual(ranks, {"b": (1, 3), "a": (2, 3), "d": (3, 3), "c": (None, None)})


class ClusterLagTests(unittest.TestCase):
    def test_same_model_clusters_are_exact_and_skip_placeholders(self):
        reports = [rep(report_no="2026010%d-ABCDE-10000%d" % (i, i), brand="Samsung", model="RF28") for i in range(1, 4)]
        reports += [rep(report_no="2026020%d-ABCDE-20000%d" % (i, i), brand="Samsung", model="rf28") for i in range(1, 4)]  # case differs
        reports += [rep(report_no="2026030%d-ABCDE-30000%d" % (i, i), brand="Acme", model="Unknown") for i in range(1, 6)]  # placeholder model
        reports += [rep(report_no="2026040%d-ABCDE-40000%d" % (i, i), brand="Acme", model="Z9") for i in range(1, 3)]  # below threshold
        out = A.model_clusters(reports)
        keys = {(c["brand"], c["model"]): c["reports"] for c in out["top"]}
        self.assertEqual(keys, {("Samsung", "RF28"): 3, ("Samsung", "rf28"): 3})
        self.assertEqual(out["clusters"], 2)
        self.assertEqual(out["reports_in_clusters"], 6)

    def test_lag_block_orders_dates_and_counts_gaps(self):
        reports = [
            rep(report_no="20260101-AAAAA-100001", report_date="1/1/2026", sent_date="1/3/2026", pub_date="1/11/2026"),
            rep(report_no="20260101-AAAAA-100002", report_date="1/1/2026", sent_date="", pub_date="1/21/2026"),
            rep(report_no="20260101-AAAAA-100003", report_date="1/10/2026", sent_date="1/12/2026", pub_date="1/5/2026"),  # published before report: excluded
        ]
        lag = A.lag_block(reports)
        self.assertEqual(lag["report_to_publication_days"]["n"], 2)
        self.assertEqual(lag["report_to_publication_days"]["median"], 15)
        self.assertEqual(lag["no_sent_date"], 1)
        self.assertEqual(lag["sent_after_publication"], 1)
        self.assertEqual(lag["report_to_sent_days"]["n"], 2)

    def test_lag_with_no_dates_is_none_not_zero(self):
        lag = A.lag_block([])
        self.assertIsNone(lag["report_to_publication_days"]["median"])
        self.assertIsNone(lag["report_to_publication_days"]["p90"])


class SecMatchTests(unittest.TestCase):
    def setUp(self):
        self.index = A.sec_index(["0000104169|Walmart Inc.", "0000935703|DOLLAR TREE, INC.", "0000111111|Acme Corp", "0000222222|ACME INC"])

    def test_unique_match_by_normalised_key(self):
        self.assertEqual(A.sec_match("WALMART", self.index), ("matched", "0000104169", "Walmart Inc."))
        self.assertEqual(A.sec_match("Dollar Tree", self.index)[0], "matched")

    def test_ambiguous_is_not_linked(self):
        status, ciks, titles = A.sec_match("Acme", self.index)
        self.assertEqual(status, "ambiguous")
        self.assertEqual(sorted(ciks), ["0000111111", "0000222222"])

    def test_unmatched_and_near_names_do_not_match(self):
        self.assertEqual(A.sec_match("Walmart Stores", self.index), ("unmatched", None, None))
        self.assertEqual(A.sec_match("", self.index), ("unmatched", None, None))


class RecallCrosscheckTests(unittest.TestCase):
    def export_rows(self):
        return [
            {"number": "100", "date": D(2020, 1, 1), "title": "Recall A", "kind": "recall", "url": "u1"},
            {"number": "200", "date": D(2021, 2, 2), "title": "Recall B", "kind": "recall", "url": "u2"},
            {"number": "R9", "date": D(2021, 5, 5), "title": "Repair", "kind": "repair", "url": None},
        ]

    def corpus_rows(self):
        return [
            {"recall_number": "100", "date": "2020-01-01", "title": "recall a", "url": "u1"},
            {"recall_number": "200", "date": "2021-02-03", "title": "Recall B", "url": "u2"},  # date differs
            {"recall_number": "300", "date": "2022-03-03", "title": "Recall C", "url": "u3"},
        ]

    def test_compare_recalls(self):
        out = X.compare_recalls(self.export_rows(), self.corpus_rows(), ["2020|1", "2021|3", "2022|1"])
        self.assertEqual(out["matched"], 2)
        self.assertEqual(out["export_only"], ["R9"])
        self.assertEqual(out["corpus_only"], ["300"])
        self.assertEqual(out["date_mismatch"], ["200"])
        self.assertEqual(out["title_mismatch"], [])  # case-folded equal
        years = {y["year"]: y for y in out["years"]}
        self.assertTrue(years[2020]["agree"])
        self.assertFalse(years[2021]["agree"])  # export 2 vs corpus 1
        self.assertEqual(years[2022]["aggregates"], 1)

    def test_company_match_levels_and_no_match(self):
        corpus = [
            {"recall_number": "1", "manufacturers": ["Acme Inc."], "importers": [], "distributors": []},
            {"recall_number": "2", "manufacturers": ["Widgets Co., of Reno, Nev."], "importers": ["Import LLC"], "distributors": []},
        ]
        exact, norm, strip = X.recall_name_maps(corpus)
        self.assertEqual(X.match_company("Acme Inc.", exact, norm, strip)[0], "exact_string")
        self.assertEqual(X.match_company("ACME INC", exact, norm, strip)[0], "normalised")
        level, firms = X.match_company("Widgets Co.", exact, norm, strip)
        self.assertEqual(level, "normalised_after_location_strip")
        self.assertEqual(firms, {"Widgets Co., of Reno, Nev.": {"2"}})
        self.assertEqual(X.match_company("Acme Holdings", exact, norm, strip), (None, {}))

    def test_product_pairs_need_exact_text(self):
        recall = {"1": {"products": [{"name": "Super Heater 3000"}, {"name": "Hat"}]}}
        reports = [
            rep(report_no="20260101-AAAAA-100001", product_desc="Super Heater 3000"),
            rep(report_no="20260101-AAAAA-100002", product_desc="super-heater 3000"),  # punctuation/case folded: still equal
            rep(report_no="20260101-AAAAA-100003", product_desc="Super Heater 3000 Deluxe"),  # superstring: no pair
            rep(report_no="20260101-AAAAA-100004", product_desc="Hat"),  # too short to key (under 4 chars)
        ]
        pairs = X.product_pairs(reports, recall, ["1"])
        self.assertEqual(sorted(r.report_no[-1] for r, _n in pairs), ["1", "2"])

    def test_mdl_exact_pairs_and_candidates_stay_separate(self):
        mdl = [{"mdl": "2875", "product": "Valsartan, losartan (ARBs)"}, {"mdl": "3014", "product": "Philips CPAP / BiPAP"}]
        reports = [rep(brand="Philips", report_no="20260101-AAAAA-100001"), rep(brand="Valsartan, losartan", report_no="20260101-AAAAA-100002")]
        pairs = X.mdl_exact_pairs(mdl, reports)
        self.assertEqual([(p["mdl"], p["field"]) for p in pairs], [("2875", "brand")])  # "Philips" alone is not the label
        words = {(c["mdl"], c["word"]) for c in X.mdl_candidates(mdl, reports)}
        self.assertIn(("3014", "philips"), words)

    def test_text_key(self):
        self.assertEqual(X.text_key("  Super-Heater (3000)! "), "super heater 3000")
        self.assertEqual(X.text_key(None), "")


class StatesTests(unittest.TestCase):
    def test_state_class(self):
        self.assertEqual(A.state_class("Ohio"), "us_state")
        self.assertEqual(A.state_class("Puerto Rico"), "us_territory")
        self.assertEqual(A.state_class("United States"), "united_states_unspecified")
        self.assertEqual(A.state_class("Unspecified"), "unspecified")
        self.assertEqual(A.state_class("Not recorded"), "unspecified")
        self.assertEqual(A.state_class("Ontario"), "other_country_or_region")


if __name__ == "__main__":
    unittest.main()
