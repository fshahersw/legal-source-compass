"""Offline tests for the ftc_data builders: synthetic fixtures only, no network, no reads of private/.

Run from this directory:  python3 -B -X utf8 -m unittest test_ftc_data
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import dnc_agg  # noqa: E402
import dnc_csv  # noqa: E402
import hsr_parse as H  # noqa: E402
import index_parse as IP  # noqa: E402


def rec(created="2026-09-15 10:00:00", violation="2026-09-14 09:00:00", state="Texas", subject="Dropped call or no message", robo="N", phone="2135369459", area="214", city="Dallas", rid="a"):
    return {
        "id": rid,
        "attributes": {
            "company-phone-number": phone, "created-date": created, "violation-date": violation, "consumer-city": city,
            "consumer-state": state, "consumer-area-code": area, "subject": subject, "recorded-message-or-robocall": robo,
        },
    }


class DncAggTests(unittest.TestCase):
    def test_parse_ts_accepts_only_real_timestamps(self):
        self.assertEqual(dnc_agg.parse_ts("2026-09-15 10:00:00"), (2026, 9, 15, 10, 0, 0))
        for bad in ("20261235", "G", "", None, "2026-02-30 00:00:00", "2026-13-01 00:00:00", "2026-09-15T10:00:00", "2026-09-15 24:00:00"):
            self.assertIsNone(dnc_agg.parse_ts(bad), bad)
        self.assertEqual(dnc_agg.parse_ts("2024-02-29 00:00:00"), (2024, 2, 29, 0, 0, 0))
        self.assertIsNone(dnc_agg.parse_ts("2025-02-29 00:00:00"))

    def test_state_code_is_exact_name_only(self):
        self.assertEqual(dnc_agg.state_code("Texas"), "TX")
        self.assertEqual(dnc_agg.state_code("  district of columbia "), "DC")
        self.assertEqual(dnc_agg.state_code("Puerto Rico"), "PR")
        for not_a_state in ("", None, "Tx", "Texas, USA", "British Columbia, Canada", "Guam", "Otsuka Holdings Co., Ltd."):
            self.assertIsNone(dnc_agg.state_code(not_a_state), not_a_state)

    def test_counts_by_published_values_and_quality(self):
        agg, q = {}, dnc_agg.new_quality()
        records = [
            rec(),
            rec(robo="Y", rid="b"),
            rec(robo="Y", rid="c", state="Ohio", subject="Reducing your debt (credit cards, mortgage, student loans)"),
            rec(state="", robo="", subject="", rid="d", phone="12", area=""),
            rec(created="2026-09-16 00:00:01", rid="e"),  # created on another day than requested
            rec(created="20261235", violation="G", state="Transcend Therapeutics, Inc.", rid="f"),
            rec(violation="2026-09-16 09:00:00", rid="g"),  # violation after creation
        ]
        for r in records:
            dnc_agg.add_record(r["attributes"], "2026-09-15", agg, q)
        self.assertEqual(q["records"], 7)
        self.assertEqual(sum(agg.values()), 7)
        self.assertEqual(q["bad_created"], 1)
        self.assertEqual(q["created_other_day"], 1)
        self.assertEqual(q["bad_violation"], 1)
        self.assertEqual(q["violation_after_created"], 1)
        self.assertEqual(q["state_blank"], 1)
        self.assertEqual(q["state_not_a_jurisdiction"], 1)
        self.assertEqual(q["subject_blank"], 1)
        self.assertEqual(q["robo_blank"], 1)
        self.assertEqual(q["phone_not_10_digits"], 1)
        self.assertEqual(q["area_code_not_3_digits"], 1)
        self.assertEqual(agg["Texas\tDropped call or no message\tN"], 3)  # records a, e and g
        self.assertEqual(agg["Texas\tDropped call or no message\tY"], 1)
        self.assertEqual(agg["\t\t"], 1)

    def test_values_are_kept_as_published_apart_from_edge_whitespace(self):
        agg, q = {}, dnc_agg.new_quality()
        dnc_agg.add_record(rec(state=" Texas ", subject="Medical  & prescriptions ")["attributes"], "2026-09-15", agg, q)
        self.assertEqual(list(agg), ["Texas\tMedical & prescriptions\tN"])

    def test_sum_agg_and_split_key(self):
        a = {"Texas\tx\tY": 2}
        b = {"Texas\tx\tY": 3, "Ohio\ty\tN": 1}
        total = dnc_agg.sum_agg([a, b])
        self.assertEqual(total, {"Texas\tx\tY": 5, "Ohio\ty\tN": 1})
        self.assertEqual(dnc_agg.split_key("Texas\tx\tY"), ("Texas", "x", "Y"))


CSV_HEAD = "Company_Phone_Number,Created_Date,Violation_Date,Consumer_City,Consumer_State,Consumer_Area_Code,Subject,Recorded_Message_Or_Robocall\n"


class DncCsvTests(unittest.TestCase):
    def test_counts_by_created_day_not_file_day(self):
        text = CSV_HEAD + (
            '9148670041,2026-09-16 00:02:01,2026-09-15 18:10:00,Fort Worth,Texas,817,"Reducing your debt (credit cards, mortgage, student loans)",Y\n'
            "8665549970,2026-09-15 23:59:59,2026-09-10 21:37:00,,North Carolina,781,Dropped call or no message,N\n"
            "5015598349,garbage,2026-09-15 16:15:00,,Texas,817,Dropped call or no message,Y\n"
            "1,2,3\n"
        )
        res = dnc_csv.aggregate_file(text.encode())
        self.assertTrue(res["header_ok"])
        self.assertEqual(res["rows"], 4)
        self.assertEqual(res["malformed_rows"], 1)
        self.assertEqual(sorted(res["days"]), ["2026-09-15", "2026-09-16", "undated"])
        self.assertEqual(sum(res["days"]["2026-09-16"]["agg"].values()), 1)
        self.assertEqual(res["days"]["undated"]["quality"]["bad_created"], 1)

    def test_embedded_newline_in_a_field_is_one_record(self):
        text = CSV_HEAD + '"9148670041\r\n7146563410",2026-09-16 00:02:01,2026-09-15 18:10:00,,Texas,817,Dropped call or no message,Y\n'
        res = dnc_csv.aggregate_file(text.encode())
        self.assertEqual(res["rows"], 1)
        self.assertEqual(res["days"]["2026-09-16"]["quality"]["phone_not_10_digits"], 1)

    def test_header_check_and_merge(self):
        bad = dnc_csv.aggregate_file(b"a,b\n1,2\n")
        self.assertFalse(bad["header_ok"])
        r1 = dnc_csv.aggregate_file((CSV_HEAD + "1234567890,2026-09-16 01:00:00,2026-09-16 00:00:00,,Ohio,614,Dropped call or no message,N\n").encode())
        r2 = dnc_csv.aggregate_file((CSV_HEAD + "1234567891,2026-09-16 02:00:00,2026-09-16 00:00:00,,Ohio,614,Dropped call or no message,N\n").encode())
        merged = dnc_csv.merge_days([r1, r2])
        self.assertEqual(merged["2026-09-16"]["files"], 2)
        self.assertEqual(merged["2026-09-16"]["agg"]["Ohio\tDropped call or no message\tN"], 2)
        self.assertEqual(merged["2026-09-16"]["quality"]["records"], 2)


def notice(txn="20262194", acquiring="Intercontinental Exchange, Inc.", acquired="MarketAxess Holdings Inc.", date="2026-10-21", rid="id1", title=None, entities=None):
    t = title if title is not None else f"{txn}: {acquiring}; {acquired}"
    return {
        "id": rid,
        "attributes": {
            "title": t, "created": "2026-10-22T13:22:50+00:00", "updated": "2026-10-22T13:22:50+00:00", "acquired-party": acquired,
            "acquiring-party": acquiring, "date": date, "acquired-entities": entities if entities is not None else [acquired],
            "transaction-number": txn,
        },
    }


class HsrTests(unittest.TestCase):
    def test_fiscal_year_boundaries(self):
        self.assertEqual(H.fiscal_year("2026-09-30"), 2026)
        self.assertEqual(H.fiscal_year("2026-10-01"), 2027)
        self.assertEqual(H.fiscal_year("2025-12-31"), 2026)
        self.assertEqual(H.fiscal_year("1999-01-01"), 1999)
        for bad in (None, "", "2026-13-01", "10/21/2026", "2026-10"):
            self.assertIsNone(H.fiscal_year(bad), bad)

    def test_normalize_and_empty_record(self):
        n = H.normalize_notice(notice())
        self.assertEqual(n["transaction_number"], "20262194")
        self.assertEqual(n["acquiring_party"], "Intercontinental Exchange, Inc.")
        self.assertEqual(n["acquired_entities"], ["MarketAxess Holdings Inc."])
        empty = {"id": "x", "attributes": {"title": ": ;", "created": "2025-08-28T16:35:33+00:00", "updated": "2025-08-28T16:35:33+00:00", "acquired-party": None, "acquiring-party": None, "date": None, "acquired-entities": [], "transaction-number": None}}
        self.assertIsNone(H.normalize_notice(empty))

    def test_title_status_never_hides_a_difference(self):
        self.assertEqual(H.title_status(H.normalize_notice(notice())), "matches")
        odd = H.normalize_notice(notice(title=": ; New Mountain Partners VI, L.P."))
        self.assertEqual(H.title_status(odd), "differs")
        self.assertEqual(H.composed_title(odd), "20262194: Intercontinental Exchange, Inc.; MarketAxess Holdings Inc.")
        partial = H.normalize_notice(notice(acquired="  "))
        self.assertIsNone(H.composed_title(partial))
        self.assertEqual(H.title_status(partial), "unavailable")

    def test_merge_pages_unions_by_api_id_and_flags_changes(self):
        p1 = {"data": [notice(rid="a"), notice(rid="b", txn="1")]}
        p2 = {"data": [notice(rid="a"), notice(rid="c", txn="2"), notice(rid="b", txn="9")]}
        out, stats = H.merge_pages([p1, p2])
        self.assertEqual(sorted(out), ["a", "b", "c"])
        self.assertEqual(stats["records_read"], 5)
        self.assertEqual(stats["distinct"], 3)
        self.assertEqual(stats["changed_between_passes"], ["b"])

    def test_row_ids_are_stable_and_distinguish_shared_transaction_numbers(self):
        a = H.normalize_notice(notice(rid="z", txn="20200001", date="2020-01-02"))
        b = H.normalize_notice(notice(rid="y", txn="20200001", date="2020-01-03", acquiring="Other Co"))
        c = H.normalize_notice(notice(rid="x", txn="20200002"))
        ids = H.assign_ids([a, b, c])
        self.assertEqual(ids["z"], "20200001-1")
        self.assertEqual(ids["y"], "20200001-2")
        self.assertEqual(ids["x"], "20200002")
        self.assertEqual(H.assign_ids([a, b, c]), ids)

    def test_counts_by_year_skip_undated_notices(self):
        ns = [H.normalize_notice(notice(rid=str(i), txn=str(i), date=d)) for i, d in enumerate(["2025-09-30", "2025-10-01", "2025-12-31", "2026-01-02"])]
        ns.append(H.normalize_notice(notice(rid="n", txn="n", date=None)))
        cal, fy, undated = H.counts_by_year(ns)
        self.assertEqual(cal, {2025: 3, 2026: 1})
        self.assertEqual(fy, {2025: 1, 2026: 3})
        self.assertEqual(undated, 1)

    def test_monthly_filings_calendar_year_from_fiscal_year(self):
        text = '"FYTransaction","MonthTransaction","TransactionReceived"\n1990,10,489\n1990,1,298\n1990,9,282\n1991,12,236\nbad,1,1\n1991,13,5\n'
        rows, problems = H.parse_monthly_filings(text)
        self.assertEqual([r["key"] for r in rows], ["1989-10", "1990-01", "1990-09", "1990-12"])
        self.assertEqual(rows[0]["transactions"], 489)
        self.assertEqual(len(problems), 2)  # the two lines that are not a fiscal year and month

    def test_monthly_filings_duplicate_lines(self):
        head = '"FYTransaction","MonthTransaction","TransactionReceived"\n'
        rows, problems = H.parse_monthly_filings(head + "1997,5,640\n2018,10,174\n1997,6,620\n2018,10,174\n")
        self.assertEqual([r["key"] for r in rows], ["1997-05", "2017-10", "1997-06"])
        self.assertIn("appears twice with the same value 174", problems[0])
        rows, problems = H.parse_monthly_filings(head + "2018,10,174\n2018,10,175\n2018,11,5\n")
        self.assertEqual([r["key"] for r in rows], ["2017-11"])
        self.assertIn("both dropped", problems[0])

    def test_monthly_basis_tells_filings_from_transactions(self):
        fys = [{"fy": 1990, "transactions_reported": 5, "filings_received": 10}, {"fy": 1999, "transactions_reported": 7, "filings_received": 14}, {"fy": 2000, "transactions_reported": 9, "filings_received": 18}]
        months = [{"fy": 1990, "transactions": 4}, {"fy": 1990, "transactions": 6}, {"fy": 1999, "transactions": 7}, {"fy": 2000, "transactions": 11}, {"fy": 2001, "transactions": 1}]
        out = H.monthly_basis(months, fys)
        self.assertEqual(out, {1990: (10, "filings"), 1999: (7, "transactions"), 2000: (11, "neither"), 2001: (1, "neither")})

    def test_fy_table_and_its_consistency_checks(self):
        text = (
            '"FY","TransactionsReported","FilingsReceived","AdjustedTransactions","SecondRequestTotal","SecondRequestFTC","SecondRequestPercentFTC","SecondRequestDOJ","SecondRequestPercentDOJ","EarlyTerminationTransactions","EarlyTerminationTransactionsGranted","EarlyTerminationTransactionsNotGranted"\n'
            "2022,3152,6288,3029,47,25,8.0e-03,22,7.0e-03,1345,5,1340\n"
            "2023,1805,3515,1735,37,26,0.01,11,6.0e-03,780,0,780\n"
            "2024,2031,4022,1973,59,30,0.01,28,0.01,858,3,855\n"
        )
        rows = H.parse_fy_table(text)
        self.assertEqual(rows[1]["et_granted"], 0)  # a recorded zero stays zero
        self.assertEqual(rows[0]["second_requests_total"], 47)
        problems = H.fy_table_problems(rows)
        self.assertEqual(problems, ["FY2024: second requests FTC + DOJ != total"])

    def test_csv_numbers_blank_is_none_not_zero(self):
        self.assertIsNone(H.to_int(""))
        self.assertIsNone(H.to_int("n/a"))
        self.assertEqual(H.to_int("1,234"), 1234)
        self.assertIsNone(H.to_float("x"))


LISTING = """
<html><body><main>
<div class="views-row"><article><div class="node__content">
 <div class="field--name-field-blog"><div class="field__item">Data Spotlight</div></div>
 <h3 class="node-title"><a href="/news-events/data-visualizations/data-spotlight/2026/04/example">Example   title</a></h3>
 <div class="field--name-field-date-time"><time datetime="2026-04-27T14:00:00Z">April 27, 2026</time></div>
 <div class="field--name-body"><div class="field__item">Scammers reach people in many ways...</div></div>
 <div class="file"><a href="/system/files/ftc_gov/pdf/x.pdf">Data Spotlight: Example</a><span class="file-size">(304.82 KB)</span></div>
</div></article></div>
<div class="views-row"><article><div class="node__content"></div></article></div>
<div class="views-row"><h2 class="node-title"><span class="field-content">Atlas paper</span></h2><time datetime="2026-03-10T12:00:00Z">March 2026</time><p>Abstract text.</p>
 <div class="file"><a href="/system/files/ftc_gov/pdf/a.pdf">Atlas paper</a><span class="file-size">(17.26 MB)</span></div></div>
<p>Displaying 1 - 20 of 559</p><a href="?page=27">last</a>
</main></body></html>
"""


class IndexParseTests(unittest.TestCase):
    def test_listing_items_as_published(self):
        items = IP.parse_views_listing(LISTING)
        self.assertEqual(len(items), 2)  # the empty banner row is not a report
        first = items[0]
        self.assertEqual(first["title"], "Example title")
        self.assertEqual(first["url"], "https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2026/04/example")
        self.assertEqual(first["date_display"], "April 27, 2026")
        self.assertEqual(first["date_iso"], "2026-04-27")
        self.assertEqual(first["summary"], "Scammers reach people in many ways...")
        self.assertEqual(first["files"], [{"title": "Data Spotlight: Example", "url": "https://www.ftc.gov/system/files/ftc_gov/pdf/x.pdf", "size": "304.82 KB"}])
        self.assertEqual(first["series_label"], "Data Spotlight")
        second = items[1]
        self.assertIsNone(second["url"])
        self.assertEqual(second["summary"], "Abstract text.")
        self.assertEqual(second["date_display"], "March 2026")

    def test_pager(self):
        shown, last, total = IP.parse_pager(LISTING)
        self.assertEqual(shown, "Displaying 1 - 20 of 559")
        self.assertEqual((last, total), (27, 559))

    def test_slug_helpers(self):
        self.assertEqual(IP.slug("Hello, World & Co.!"), "hello-world-co")
        self.assertEqual(IP.page_slug("https://www.ftc.gov/reports/some-report/?page=1"), "some-report")

    def test_file_sections_follow_headings(self):
        html = '<main><h2>Reports Menu</h2><h3>HSR Annual Reports</h3><div class="file"><a href="/a.pdf">48th Report (FY 2025)</a><span class="file-size">(1.6 MB)</span></div><h3>Other</h3><div class="file"><a href="/b.pdf">B</a></div></main>'
        files = IP.parse_file_sections(html)
        self.assertEqual([(f["section"], f["title"], f["size"]) for f in files], [("HSR Annual Reports", "48th Report (FY 2025)", "1.6 MB"), ("Other", "B", None)])

    def test_contributors_lists_keep_page_order_and_exact_names(self):
        html = (
            '<main><div class="field--name-body">'
            "<p>The Consumer Sentinel Network allows law enforcement to access consumer complaints.</p>"
            "<p>AARP Fraud Watch Network<br/>Alaska Attorney General<br/><span>Zillow Group</span></p>"
            "<p>In addition, the following entities refer complaints to the FTC:</p>"
            "<p>Apple Inc.<br/>Zelle</p></div></main>"
        )
        r = IP.parse_contributors(html)
        self.assertEqual(r["contributors"], ["AARP Fraud Watch Network", "Alaska Attorney General", "Zillow Group"])
        self.assertEqual(r["referrers"], ["Apple Inc.", "Zelle"])
        self.assertEqual(IP.parse_contributors("<main><p>nothing</p></main>")["contributors"], [])


import build_dnc as BD  # noqa: E402
import build_hsr as BH  # noqa: E402
import build_index as BI  # noqa: E402
import ftc_http as FH  # noqa: E402

POP = {"source": "test", "source_url": "https://example.test/pop.csv", "year": 2025, "vintage": 2025, "population": {"TX": 1_000_000, "OH": 500_000, "PR": 250_000}}


def day_agg(**counts):
    """{key: n} from keyword-free helper: pass state|subject|flag keys as a dict via day_agg(**{"Texas|Charities|Y": 3})."""
    return {k.replace("|", "\t"): n for k, n in counts.items()}


def day(agg):
    return {"agg": agg, "quality": dnc_agg.new_quality(), "source": "csv"}


class DncBuildTests(unittest.TestCase):
    def setUp(self):
        self.days = {
            "2026-02-01": day(day_agg(**{"Texas|Charities|Y": 6, "Texas|Other|N": 2, "Ohio|Other|Y": 1, "|Other|": 1})),
            "2026-02-02": day(day_agg(**{"Texas|Charities|Y": 4, "Ohio|Other|N": 3, "British Columbia, Canada|Other|Y": 1})),
        }

    def test_combine_prefers_the_ftc_file_and_reports_overlap(self):
        api = {"2026-02-01": {"agg": day_agg(**{"Texas|Charities|Y": 6}), "quality": dnc_agg.new_quality(), "source": "api"}, "2026-02-09": {"agg": {}, "quality": dnc_agg.new_quality(), "source": "api"}}
        days, overlap = BD.combine_days(self.days, api)
        self.assertEqual(days["2026-02-01"]["source"], "csv")
        self.assertEqual(days["2026-02-09"]["source"], "api")
        self.assertEqual(overlap, [{"day": "2026-02-01", "records_csv": 10, "records_api": 6, "identical": False}])

    def test_month_summary_counts_by_flag_state_and_subject_and_keeps_unassigned_states_out_of_states(self):
        s = BD.summarize_month(sorted(self.days), self.days)
        self.assertEqual((s["total"], s["robo_y"], s["robo_n"], s["robo_blank"]), (18, 12, 5, 1))
        self.assertEqual(s["by_state"]["TX"]["total"], 12)
        self.assertEqual(s["by_state"]["OH"]["total"], 4)
        self.assertEqual(s["unassigned_state"], {"Not recorded": 1, "British Columbia, Canada": 1})
        self.assertEqual(s["subjects"]["Charities"], 10)

    def test_rows_flag_a_partial_month_and_compute_rank_per_100k_and_share(self):
        rows, meta, overlap, per_file, official, pop_doc = BD.build(days=self.days, overlap=[], per_file=[], month_counts={}, official=[], population=POP, entries={})
        ids = [r["id"] for r in rows]
        self.assertEqual(ids, ["US-2026-02", "OH-2026-02", "TX-2026-02"])
        us = rows[0]["item"]
        self.assertFalse(us["complete"])  # 2 of 28 days
        self.assertEqual(us["days_covered"], 2)
        self.assertEqual(us["analytics"]["robocall_share_pct"], round(12 / 17 * 100, 2))
        tx = rows[2]["item"]
        self.assertEqual(tx["analytics"]["per100k"], 1.2)  # 12 / 1,000,000 * 100,000
        self.assertEqual(tx["analytics"]["rank_per100k"], 1)  # Texas 1.2 per 100,000 beats Ohio 0.8
        self.assertEqual(rows[1]["item"]["analytics"]["per100k"], 0.8)  # 4 / 500,000 * 100,000
        self.assertEqual(rows[1]["item"]["analytics"]["rank_per100k"], 2)
        self.assertEqual(rows[1]["state"], "OH")

    def test_a_month_with_every_day_is_complete(self):
        days = {f"2026-02-{d:02d}": day(day_agg(**{"Texas|Other|Y": 1})) for d in range(1, 29)}
        rows, meta, *_ = BD.build(days=days, overlap=[], per_file=[], month_counts={}, official=[], population=POP, entries={})
        self.assertTrue(meta["2026-02"]["complete"])
        self.assertEqual(rows[0]["item"]["days_covered"], 28)

    def test_count_only_month_has_no_subjects_or_state_rows(self):
        rows, meta, *_ = BD.build(days={}, overlap=[], per_file=[], month_counts={"2024-04": {"total": 1000, "robo_y": 600, "robo_n": 300}}, official=[], population=POP, entries={})
        self.assertEqual([r["id"] for r in rows], ["US-2024-04"])
        item = rows[0]["item"]
        self.assertEqual((item["method"], item["complete"], item["subjects"], item["metrics"]["no_flag"]), ("count", True, {}, None))
        self.assertEqual(meta["2024-04"]["method"], "count")

    def test_official_months_become_rows_and_crosscheck_compares_totals(self):
        official = [{"month": "2026-02", "live": 4, "robocall": 14, "total": 18, "parts_sum_equals_total": True}, {"month": "2026-03", "live": 1, "robocall": 1, "total": 2, "parts_sum_equals_total": True}]
        rows, meta, overlap, per_file, off, pop_doc = BD.build(days=self.days, overlap=[], per_file=[], month_counts={}, official=official, population=POP, entries={})
        self.assertIn("official-2026-03", [r["id"] for r in rows])
        check = BD.crosscheck_official(meta, official)
        self.assertEqual(check[0]["status"], "equal")
        self.assertEqual(check[1]["status"], "no matching month in this build")

    def test_named_subjects_leave_out_the_catch_all_buckets(self):
        self.assertEqual(BD.named_subjects({"Other": 9, "No Subject Provided": 8, "Charities": 1, "Medical & prescriptions": 5}), [("Medical & prescriptions", 5), ("Charities", 1)])

    def test_robocall_share_needs_both_answers(self):
        self.assertEqual(BD.robocall_share(3, 1), 75.0)
        self.assertIsNone(BD.robocall_share(None, 1))
        self.assertIsNone(BD.robocall_share(0, 0))


class HsrBuildTests(unittest.TestCase):
    def pages(self):
        return [("p0", {"data": [notice(rid="a", txn="20200001", date="2020-03-05"), notice(rid="b", txn="20200002", date="2020-10-05"), notice(rid="b", txn="20200002", date="2020-10-05")]}),
                ("p1", {"data": [notice(rid="c", txn="20200002", date="2020-10-06", acquiring="Other Co", title=": ; x"), {"id": "e", "attributes": {"title": ": ;", "acquired-party": None, "acquiring-party": None, "date": None, "acquired-entities": [], "transaction-number": None}}]})]

    def test_notice_rows_are_one_per_distinct_notice_with_series_and_empty_records_set_aside(self):
        rows, summary, inputs, meta = BH.build_notices(pages=self.pages(), entries={}, filing_fy_rows=[{"fy": 2020, "et_granted": 2}, {"fy": 2019, "et_granted": 9}])
        ids = [r["id"] for r in rows]
        self.assertEqual(ids, ["20200001", "20200002-1", "20200002-2", "series-by-year"])
        self.assertEqual(summary["empty_records_excluded"], 1)
        self.assertEqual(summary["passes"]["distinct"], 4)
        series = rows[-1]["item"]["series"]
        self.assertEqual(series["calendar_year"], {"2020": 3})
        self.assertEqual(series["fiscal_year"], {"2020": 1, "2021": 2})
        self.assertEqual(rows[-1]["filters"]["_listing"], ["no"])
        self.assertEqual(meta["crosscheck"], [{"fiscal_year": 2020, "notices_in_api": 1, "transactions_granted_in_ftc_table": 2}, {"fiscal_year": 2019, "notices_in_api": None, "transactions_granted_in_ftc_table": 9}])
        self.assertEqual(rows[2]["item"]["notice"]["title_status"], "differs")
        self.assertEqual(rows[0]["source_url"], "https://api.ftc.gov/v0/hsr-early-termination-notices?filter[id][value]=a")
        self.assertNotIn("api_key", json.dumps(rows))

    def test_published_party_names_are_never_changed_beyond_spacing(self):
        rows, *_ = BH.build_notices(pages=[("p", {"data": [notice(acquiring="Alan R.  Viterbi", title="20262194: Alan R. Viterbi; MarketAxess Holdings Inc.")]})], entries={})
        item = rows[0]["item"]["notice"]
        self.assertEqual(item["acquiring_party"], "Alan R. Viterbi")
        self.assertEqual(item["title_status"], "matches")


class IndexBuildTests(unittest.TestCase):
    def test_open_government_tables(self):
        html = (
            "<main><table><tr><th>Data Set Name</th><th>Dictionary</th><th>Description</th></tr>"
            '<tr><td><a href="/system/files/ftc_gov/data/A.csv">FTC A (CSV, 39.4&nbsp;KB)</a></td><td><a href="/system/files/ftc_gov/data/A-dictionary.csv">dict</a></td><td>Describes A.</td></tr>'
            '<tr><td><a href="/x/b.xlsx">B (CSV, 1 KB)</a></td><td></td><td>Describes B.</td></tr></table>'
            '<table><tr><th>Consumer Sentinel Network Data Book</th></tr><tr><td><a href="/x/csn.zip">CY 2024</a></td></tr></table>'
            '<table><tr><th>Do Not Call Data Books</th></tr><tr><td><a href="/x/dnc.zip">FY 2025 Data Book</a></td></tr></table></main>'
        )
        out = BI.parse_open_gov(html)
        self.assertEqual([o["name"] for o in out], ["FTC A", "B", "Consumer Sentinel Network Data Book CY 2024", "Do Not Call Data Book FY 2025"])
        self.assertEqual(out[0]["size"], "39.4 KB")
        self.assertEqual(out[0]["dictionary_url"], "https://www.ftc.gov/system/files/ftc_gov/data/A-dictionary.csv")
        self.assertIsNone(out[1]["dictionary_url"])
        self.assertEqual(BI.file_format("https://www.ftc.gov/x/b.xlsx"), "XLSX")

    def test_ids_stay_unique(self):
        taken = set()
        self.assertEqual([BI.unique("a", taken), BI.unique("a", taken), BI.unique("a", taken)], ["a", "a-2", "a-3"])


class FakeResponse:
    def __init__(self, status, body=b"{}", headers=None):
        self.status, self._body, self.headers = status, body, headers or {}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FetcherTests(unittest.TestCase):
    """The fetcher is exercised with a fake opener: no socket is opened."""

    def run_fetch(self, responses, host_url="https://api.ftc.gov/v0/x", **kw):
        import urllib.error
        import urllib.request

        calls = []

        def fake_open(req, timeout=None):
            calls.append(req)
            nxt = responses.pop(0)
            if nxt.status >= 400:
                raise urllib.error.HTTPError(req.full_url, nxt.status, "err", nxt.headers, __import__("io").BytesIO(nxt._body))
            return nxt

        old_open, old_sleep, old_key = urllib.request.urlopen, FH.time.sleep, FH.api_key
        urllib.request.urlopen, FH.time.sleep, FH.api_key = fake_open, lambda s: None, lambda: "SECRET-KEY"
        try:
            f = FH.Fetcher(interval_override={"api.ftc.gov": 0, "www.ftc.gov": 0}, **kw)
            return f, calls, f.get(host_url)
        finally:
            urllib.request.urlopen, FH.time.sleep, FH.api_key = old_open, old_sleep, old_key

    def test_key_travels_in_a_header_never_in_the_url(self):
        f, calls, resp = self.run_fetch([FakeResponse(200, b'{"data":[]}', {"X-Ratelimit-Remaining": "19000"})])
        self.assertEqual(calls[0].full_url, "https://api.ftc.gov/v0/x")
        self.assertEqual(calls[0].get_header("X-api-key"), "SECRET-KEY")
        self.assertNotIn("SECRET-KEY", calls[0].full_url)
        self.assertEqual(f.api_remaining, 19000)

    def test_transient_errors_are_retried_then_succeed(self):
        f, calls, resp = self.run_fetch([FakeResponse(503), FakeResponse(429, headers={"Retry-After": "1"}), FakeResponse(200)])
        self.assertEqual((resp.status, resp.attempts, len(calls)), (200, 3, 3))

    def test_a_long_retry_after_stops_the_run_instead_of_sleeping(self):
        with self.assertRaises(FH.RateLimited) as ctx:
            self.run_fetch([FakeResponse(429, headers={"Retry-After": "1406"})])
        self.assertEqual(ctx.exception.retry_after, 1406)

    def test_a_bot_wall_is_reported_not_retried(self):
        with self.assertRaises(FH.BotWall):
            self.run_fetch([FakeResponse(403)], host_url="https://www.ftc.gov/x")

    def test_gives_up_after_the_attempt_limit(self):
        with self.assertRaises(FH.FetchError):
            self.run_fetch([FakeResponse(500) for _ in range(3)], max_attempts=3)

    def test_ftc_gov_is_spaced_by_its_crawl_delay(self):
        self.assertEqual(FH.HOST_INTERVAL["www.ftc.gov"], 5.0)
        self.assertEqual(FH.HOST_INTERVAL["public.tableau.com"], 10.0)
        self.assertGreaterEqual(FH.HOST_INTERVAL["api.ftc.gov"], 2.0)


if __name__ == "__main__":
    unittest.main()
