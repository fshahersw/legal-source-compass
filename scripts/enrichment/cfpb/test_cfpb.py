"""Offline unit tests for the cfpb stream (synthetic fixtures only; no network, no acquired files).

Run: cd scripts/enrichment/cfpb && python3 -B -m unittest -v test_cfpb
"""
import csv
import io
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import aggregate  # noqa: E402
import build_cfpb  # noqa: E402
import cfpb_lib as lib  # noqa: E402
import reports  # noqa: E402

HEADER = aggregate.EXPECTED_HEADER
CR = "Credit reporting or other personal consumer reports"
ROWS = [
    # date, product, sub-product, issue, sub-issue, public response, company, state, zip, tags, via, sent, response, timely, id
    ["2023-01-01", "Mortgage", "FHA mortgage", "Trouble during payment process", "", "", "ACME BANK", "TX", "75001", "", "Web", "2023-01-02", "Closed with explanation", "Yes", "1"],
    ["2023-10-17", CR, "Credit reporting", "Incorrect information on your report", "", "", "Acme Bank", "TX", "75002", "Servicemember", "Web", "2023-10-17", "Closed with non-monetary relief", "Yes", "2"],
    ["2023-10-18", CR, "Credit reporting", "Improper use of your report", "", "", "ZETA CO", "", "", "", "Phone", "2023-10-18", "In progress", "No", "3"],
    ["2024-05-05", "Debt collection", "I do not know", "Attempts to collect debt not owed", "", "", "BETA LLC", "NJ", "07001", "", "Referral", "2024-05-06", "Closed with monetary relief", "Yes", "4"],
    ["2024-06-06", "Debt collection", "", "Attempts to collect debt not owed", "", "", "BETA LLC", "NJ", "07001", "", "Web", "2024-06-06", "Closed with monetary relief", "Yes", "5"],
    ["2025-12-31", "Mortgage", "FHA mortgage", "Trouble during payment process", "", "", "ACME BANK", "TX", "75001", "", "Web", "2025-12-31", "Untimely response", "No", "6"],
]
SEC_ROWS = [{"id": "0000000001", "title": "Acme Bank"}, {"id": "0000000002", "title": "BETA LLC"}, {"id": "0000000003", "title": "beta  llc"}]


def csv_text(rows, header=HEADER):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def synthetic_agg(rows=ROWS):
    acc = aggregate.aggregate_handle(io.StringIO(csv_text(rows)))
    return aggregate.finalize(acc, zip={"member_date": "2026-01-01 00:00"})


def synthetic_ctx(agg):
    ctx = {name: build_cfpb.parsed(agg, name) for name in ("nat", "natx", "natm", "st", "stx", "sti", "co", "cox", "cov", "cos", "coi")}
    ctx.update({"retrieved": "2026-10-18T00:00:00Z", "zip_info": agg["meta"]["zip"], "manifest": {}})
    return ctx


def pop(n):
    return {"population": n, "vintage": "Vintage 2025", "source": "synthetic"}


POPS = {"TX": {"2023": pop(1000), "2024": pop(1000), "2025": pop(1000)}, "NJ": {"2023": pop(500), "2024": pop(500), "2025": pop(500)}}


class AggregateTests(unittest.TestCase):
    def test_window_flag_bounds_inclusive(self):
        self.assertEqual(aggregate.window_flag("2023-10-18"), "2")
        self.assertEqual(aggregate.window_flag("2026-10-18"), "2")
        self.assertEqual(aggregate.window_flag("2026-10-19"), "0")
        self.assertEqual(aggregate.window_flag("2023-10-17"), "1")
        self.assertEqual(aggregate.window_flag("2020-10-18"), "1")
        self.assertEqual(aggregate.window_flag("2020-10-17"), "0")

    def test_counts_blanks_and_keys(self):
        agg = synthetic_agg()
        meta = agg["meta"]
        self.assertEqual(meta["rows"], 6)
        self.assertEqual((meta["min_day"], meta["max_day"]), ("2023-01-01", "2025-12-31"))
        self.assertEqual(meta["blank"]["State"], 1)
        self.assertEqual(meta["blank"]["Sub-product"], 1)
        self.assertEqual(meta["duplicate_ids"], 0)
        self.assertEqual(sum(agg["day"].values()), 6)
        # nat key: year, w, product, sub-product, issue
        self.assertEqual(agg["nat"][lib.SEP.join(("2023", "2", CR, "Credit reporting", "Improper use of your report"))], 1)
        self.assertEqual(agg["nat"][lib.SEP.join(("2024", "2", "Debt collection", "", "Attempts to collect debt not owed"))], 1)
        # company names kept exactly as recorded (no case merging)
        companies = {k.split(lib.SEP)[0] for k in agg["co"]}
        self.assertEqual(companies, {"ACME BANK", "Acme Bank", "ZETA CO", "BETA LLC"})

    def test_duplicates_and_bad_dates(self):
        rows = ROWS[:2] + [ROWS[1][:-1] + ["2"], ["05/01/2024"] + ROWS[0][1:-1] + ["9"]]
        acc = aggregate.aggregate_handle(io.StringIO(csv_text(rows)))
        self.assertEqual(acc["duplicate_ids"], 1)
        self.assertEqual(acc["bad_dates"], 1)
        self.assertEqual(sum(acc["day"].values()), 3)

    def test_header_guard(self):
        with self.assertRaises(ValueError):
            aggregate.aggregate_handle(io.StringIO(csv_text(ROWS, header=HEADER[:-1] + ["Consumer disputed?"])))


class LibTests(unittest.TestCase):
    def test_growth_and_cagr(self):
        self.assertEqual(lib.growth_pct(150, 100), 50.0)
        self.assertIsNone(lib.growth_pct(5, 0))
        self.assertIsNone(lib.growth_pct(5, None))
        self.assertEqual(lib.cagr_pct(400, 100, 2), 100.0)
        self.assertIsNone(lib.cagr_pct(400, 0, 2))

    def test_per_capita_and_not_recorded(self):
        self.assertEqual(lib.per_100k(25, 50000), 50.0)
        self.assertIsNone(lib.per_100k(25, None))
        self.assertEqual(lib.label(""), "Not recorded")
        self.assertEqual(lib.label("TX"), "TX")

    def test_share_shift_and_hhi(self):
        rows = {r["name"]: r for r in lib.share_shift({"a": 50, "b": 50}, {"a": 75, "b": 25})}
        self.assertEqual(rows["a"]["shift_pp"], 25.0)
        self.assertEqual(rows["b"]["shift_pp"], -25.0)
        new = {r["name"]: r for r in lib.share_shift({"a": 10}, {"a": 10, "c": 10})}
        self.assertEqual(new["c"]["share_a"], 0.0)
        self.assertEqual(new["c"]["shift_pp"], 50.0)
        self.assertEqual(lib.hhi({"x": 1}), 10000.0)
        self.assertEqual(lib.hhi({"x": 1, "y": 1}), 5000.0)
        self.assertIsNone(lib.hhi({}))

    def test_response_and_timely_rates(self):
        rates = lib.response_rates({"Closed with explanation": 2, "Closed with monetary relief": 1, "Closed with non-monetary relief": 1,
                                    "In progress": 4, "": 2, "Untimely response": 0})
        self.assertEqual(rates["closed"], 4)
        self.assertEqual(rates["relief_rate"], 50.0)
        self.assertEqual(rates["monetary_relief_rate"], 25.0)
        self.assertEqual(rates["untimely_response_share"], 0.0)
        t = lib.timely_rate({"Yes": 3, "No": 1, "": 5})
        self.assertEqual((t["rate"], t["not_recorded"]), (75.0, 5))
        self.assertIsNone(lib.timely_rate({})["rate"])

    def test_name_matching(self):
        index = lib.build_name_index(SEC_ROWS)
        self.assertEqual(lib.match_name("ACME  BANK", index), ("matched", "0000000001"))
        self.assertEqual(lib.match_name("Beta LLC", index), ("ambiguous", None))
        self.assertEqual(lib.match_name("ACME BANK, N.A.", index), ("unmatched", None))

    def test_census_rows_and_years(self):
        text = "SUMLEV,REGION,DIVISION,STATE,NAME,POPESTIMATE2024,POPESTIMATE2025\n010,0,0,00,United States,10,20\n040,3,7,48,Texas,30000000,31000000\n040,X,X,72,Puerto Rico,3200000,3180000\n"
        out = lib.census_population_rows(csv.DictReader(io.StringIO(text)), ["2024", "2025"], {"48": "TX"})
        self.assertEqual(out, {"TX": {"2024": 30000000, "2025": 31000000}})
        self.assertTrue(lib.year_complete("2024", "2011-12-01", "2026-10-18"))
        self.assertFalse(lib.year_complete("2011", "2011-12-01", "2026-10-18"))
        self.assertFalse(lib.year_complete("2026", "2011-12-01", "2026-10-18"))
        self.assertEqual(lib.sum_days({"2025-01-01": 2, "2025-02-01": 3, "2026-01-01": 9}, "2025-01-01", "2025-12-31"), 5)
        self.assertTrue(lib.is_credit_reporting(CR))
        self.assertFalse(lib.is_credit_reporting("Debt collection"))


class BuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agg = synthetic_agg()
        cls.ctx = synthetic_ctx(cls.agg)

    def test_national(self):
        rows, national, window, years = build_cfpb.national_rows(self.agg, self.ctx)
        self.assertEqual(national["complaints"], 6)
        self.assertEqual(window["complaints"], 4)
        self.assertEqual(window["prior_window"]["complaints"], 2)
        self.assertEqual(window["change_vs_prior_pct"], 100.0)
        by_year = {r["year"]: r for r in years}
        self.assertEqual(by_year["2023"]["complaints"], 3)
        self.assertIsNone(by_year["2023"]["yoy_pct"])  # 2022 not covered
        self.assertEqual(by_year["2024"]["yoy_pct"], -33.33)
        self.assertEqual(by_year["2025"]["yoy_pct"], -50.0)
        self.assertEqual(national["responses"]["relief_rate"], 60.0)
        self.assertEqual(national["timely"]["rate"], 66.67)
        self.assertEqual(national["consumer_disputed"]["status"], "Not recorded")
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("cfpb-national:window-2023-10-18-2026-10-18", ids)
        self.assertIn("cfpb-national:product:debt-collection", ids)
        for row in rows:
            self.assertTrue(row["source_url"].startswith("https://"))
            self.assertTrue(all(isinstance(f, list) and len(f) == 2 for f in row["detail"]["facts"]))
        sub = next(r for r in rows if r["id"] == "cfpb-national:product:debt-collection")["item"]["product"]["sub_products"]
        self.assertIn("Not recorded", [s["value"] for s in sub])

    def test_states(self):
        rows, profiles, rankings = build_cfpb.state_rows(self.agg, self.ctx, 6, pops=POPS)
        tx = profiles["TX"]
        self.assertEqual(tx["complaints"], 3)
        y2025 = next(r for r in tx["years"] if r["year"] == "2025")
        self.assertEqual(y2025["per_100k"], 100.0)  # 1 complaint / 1,000 residents x 100,000
        self.assertEqual(next(r for r in tx["years"] if r["year"] == "2023")["excluding_credit_reporting"], 1)
        nr = next(r for r in rows if r["id"] == "cfpb-state:NR")
        self.assertEqual(nr["item"]["state_profile"]["name"], "Not recorded")
        self.assertEqual(nr["item"]["links"][0]["url"], build_cfpb.CSV_URL)  # no /places link for unrecorded
        tx_row = next(r for r in rows if r["id"] == "cfpb-state:TX")
        self.assertEqual(tx_row["item"]["links"][0]["url"], "/places/TX")
        self.assertEqual(tx_row["state"], "TX")
        # 2024 -> 2025 rate change: TX 0 -> 100 per 100k is undefined (zero base); NJ 400 -> 0 = -100%
        self.assertIsNone(tx["analytics"]["rate_change_pct_2024_2025"])
        self.assertEqual(profiles["NJ"]["analytics"]["rate_change_pct_2024_2025"], -100.0)
        self.assertEqual(rankings["rate_change_pct"], [])  # 2022 not covered: no rise ranking, nothing imputed

    def test_companies_and_links(self):
        rows, profiles, rankings, counts, n_companies = build_cfpb.company_rows(self.agg, self.ctx, 6, sec_rows=SEC_ROWS)
        self.assertEqual(n_companies, 4)
        self.assertEqual([p["name"] for p in profiles], ["ACME BANK", "BETA LLC", "Acme Bank", "ZETA CO"])
        status = {p["name"]: p["sec_match"]["status"] for p in profiles}
        self.assertEqual(status, {"ACME BANK": "matched", "Acme Bank": "matched", "BETA LLC": "ambiguous", "ZETA CO": "unmatched"})
        self.assertEqual(dict(counts), {"matched": 2, "ambiguous": 1, "unmatched": 1})
        acme = next(r for r in rows if r["item"].get("company", {}).get("name") == "ACME BANK")
        self.assertEqual(acme["item"]["links"][0]["url"], "/companies/0000000001")
        beta = next(r for r in rows if r["item"].get("company", {}).get("name") == "BETA LLC")
        self.assertFalse(any(l["url"].startswith("/companies/") for l in beta["item"]["links"]))
        self.assertEqual(beta["item"]["company"]["responses"]["monetary_relief_rate"], 100.0)
        zeta = next(p for p in profiles if p["name"] == "ZETA CO")
        self.assertIsNone(zeta["responses"]["relief_rate"])  # only 'In progress': no closed complaints
        self.assertEqual(zeta["timely"]["rate"], 0.0)


class ReportTests(unittest.TestCase):
    PAGE = """
<div class="m-notification__message">2 filtered results</div>
<article class="o-post-preview" lang="en"><div class="m-meta-header"><div class="m-meta-header__item-group">
<span class="m-meta-header__item"> To Congress </span></div>
<div class="m-meta-header__item"><span class="a-date">Published <span class="datetime"><time datetime="2026-10-01T00:00:00">OCT 01, 2026</time></span></span></div></div>
<div class="o-post-preview__content"><h3 class="o-post-preview__title"><a href="/data-research/research-reports/a-report/">A &amp; B report</a></h3>
<div class="o-post-preview__description">  First   line.  </div>
<ul class="m-tag-group"><li><a href="?topics=ecoa" class="a-tag-topic"><span class="a-tag-topic__bullet">•</span><span class="a-tag-topic__text">ECOA</span></a></li></ul></div></article>
<article class="o-post-preview" lang="en"><div class="m-meta-header">
<div class="m-meta-header__item"><span class="a-date">Published <span class="datetime"><time datetime="2011-02-22T00:00:00">FEB 22, 2011</time></span></span></div></div>
<div class="o-post-preview__content"><h3 class="o-post-preview__title"><a href="https://www.consumerfinance.gov/data-research/research-reports/b/">B</a></h3>
<div class="o-post-preview__description">Cut off text...</div></div></article>
<label>1 out of 1 total pages</label>
"""

    def test_parse_page(self):
        entries, total, pages = reports.parse_page(self.PAGE)
        self.assertEqual((len(entries), total, pages), (2, 2, 1))
        a, b = entries
        self.assertEqual(a["title"], "A & B report")
        self.assertEqual(a["url"], "https://www.consumerfinance.gov/data-research/research-reports/a-report/")
        self.assertEqual(a["date"], "2026-10-01")
        self.assertEqual(a["categories"], ["To Congress"])
        self.assertEqual(a["description"], "First line.")
        self.assertEqual(a["topics"], [{"slug": "ecoa", "label": "ECOA"}])
        self.assertEqual(b["categories"], [])  # no category: stays empty, shown as Not recorded
        self.assertEqual(b["topics"], [])
        self.assertEqual(reports.slug_from_url(a["url"]), "a-report")


# ----------------------------------------------------------------------------------------------------------------------
# fix-round regression tests (verifier findings: state timely sum, unrounded ranking, product comparability, ...)

_NEXT_ID = [1000]


def row(day, product, company="ACME CO", state="TX", timely="Yes", response="Closed with explanation", tags="", via="Web"):
    _NEXT_ID[0] += 1
    return [day, product, "", "Some issue", "", "", company, state, "", tags, via, day, response, timely, str(_NEXT_ID[0])]


def month_days(first, last):
    """First day of every month from 'YYYY-MM' first to last inclusive."""
    y, m = int(first[:4]), int(first[5:])
    ey, em = int(last[:4]), int(last[5:])
    while (y, m) <= (ey, em):
        yield f"{y}-{m:02d}-01"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def product_rows():
    rows = [row(d, "Stable") for d in month_days("2020-01", "2026-10")] + [row("2026-10-18", "Stable")]
    rows += [row(d, "Old") for d in month_days("2020-01", "2024-07")]
    rows += [row(d, "New") for d in month_days("2024-08", "2026-10")]
    rows += [row(d, "Revived") for d in month_days("2020-01", "2021-12")] + [row(d, "Revived") for d in month_days("2024-08", "2026-10")]
    return rows


class RoundingTests(unittest.TestCase):
    def test_pct_never_hides_a_remainder(self):
        self.assertEqual(lib.pct(5, 5), 100.0)
        self.assertEqual(lib.pct(0, 5), 0.0)
        self.assertEqual(lib.pct(99999, 100000), 99.999)  # would round to 100.0 at 2 decimals
        self.assertLess(lib.pct(4507494, 4507494 + 93), 100.0)
        self.assertGreater(lib.pct(1, 18_504_768), 0.0)
        self.assertEqual(lib.pct(1, 3), 33.33)  # ordinary values keep 2 decimals
        self.assertIsNone(lib.pct(1, 0))

    def test_fmt_pct(self):
        self.assertEqual(lib.fmt_pct(99.998), "99.998%")
        self.assertEqual(lib.fmt_pct(100.0), "100.00%")
        self.assertEqual(lib.fmt_pct(0.0), "0.00%")
        self.assertEqual(lib.fmt_pct(66.67), "66.67%")
        self.assertEqual(lib.fmt_pct(None), "Not recorded")
        self.assertEqual(lib.fmt_pct(-33.33), "-33.33%")

    def test_timely_helpers(self):
        yes_no = lib.timely_rate({"Yes": 4507494, "No": 93})
        self.assertLess(yes_no["rate"], 100.0)
        self.assertLess(lib.timely_exact(yes_no), 1.0)
        self.assertEqual(lib.timely_exact(lib.timely_rate({"Yes": 5})), 1.0)
        self.assertIsNone(lib.timely_exact(lib.timely_rate({"": 3})))
        total = lib.sum_counters([{"Yes": 3, "No": 1}, {"Yes": 2, "No": 2}, {"Yes": 1}])
        self.assertEqual((total["Yes"], total["No"]), (6, 3))

    def test_month_helpers(self):
        prior = lib.month_range("2020-10-18", "2023-10-17")
        window = lib.month_range("2023-10-18", "2026-10-18")
        self.assertEqual((prior[0], prior[-1], len(prior)), ("2020-11", "2023-09", 35))
        self.assertEqual((window[0], window[-1], len(window)), ("2023-11", "2026-09", 35))
        self.assertEqual(lib.month_range("2024-01-01", "2024-02-29"), ["2024-01", "2024-02"])
        self.assertEqual(lib.year_months_recorded({"2023-08": 1, "2023-09": 2, "2022-12": 3}, "2023"), 2)
        months = list(m[:7] for m in month_days("2011-12", "2017-04")) + list(m[:7] for m in month_days("2023-08", "2026-10"))
        self.assertEqual(lib.month_runs(months), [("2011-12", "2017-04"), ("2023-08", "2026-10")])
        self.assertEqual(lib.month_runs(["2020-01", "2020-12"]), [("2020-01", "2020-12")])   # 10 empty months: same run
        self.assertEqual(lib.month_runs(["2020-01", "2021-03"]), [("2020-01", "2020-01"), ("2021-03", "2021-03")])  # 14 empty months
        self.assertEqual(lib.month_runs([]), [])


class StateTimelyTests(unittest.TestCase):
    """Blocker: the all-history state timely counts must add the Yes/No counts of every year (they used to keep one year)."""

    @classmethod
    def setUpClass(cls):
        rows = []
        for year, yes, no in (("2023", 3, 1), ("2024", 2, 2), ("2025", 1, 0)):
            rows += [row(f"{year}-03-0{i + 1}", "Mortgage", state="TX", timely="Yes") for i in range(yes)]
            rows += [row(f"{year}-04-0{i + 1}", "Mortgage", state="TX", timely="No") for i in range(no)]
        rows += [row("2023-05-01", "Mortgage", state="FM", timely="Yes"), row("2024-05-01", "Mortgage", state="FM", timely="Yes"),
                 row("2025-05-01", "Mortgage", state="FM", timely="No")]
        agg = synthetic_agg(rows)
        cls.ctx = synthetic_ctx(agg)
        cls.rows, cls.profiles, _ = build_cfpb.state_rows(agg, cls.ctx, len(rows), pops={"TX": {"2023": pop(1000), "2024": pop(1000), "2025": pop(1000)}})

    def test_all_history_timely_sums_every_year(self):
        tx = self.profiles["TX"]["timely"]
        self.assertEqual((tx["yes"], tx["no"], tx["rate"]), (6, 3, 66.67))
        fm = self.profiles["FM"]["timely"]
        self.assertEqual((fm["yes"], fm["no"], fm["rate"]), (2, 1, 66.67))  # Yes in two different years must add up (1 + 1)

    def test_all_history_agrees_with_per_year_figures(self):
        for profile in self.profiles.values():
            years = profile["years"]
            self.assertEqual(profile["complaints"], sum(r["complaints"] for r in years))
            tx_years = {r["year"]: r["timely_rate"] for r in years}
            if profile["code"] == "TX":
                self.assertEqual(tx_years, {"2023": 75.0, "2024": 50.0, "2025": 100.0})
            t = profile["timely"]
            self.assertEqual(t["yes"] + t["no"] + t["not_recorded"], profile["complaints"])  # nothing dropped, nothing counted twice

    def test_record_shows_the_all_history_figure(self):
        tx = next(r for r in self.rows if r["id"] == "cfpb-state:TX")
        self.assertEqual(tx["item"]["cells"]["timely_rate"], 66.67)
        fact = dict(tx["detail"]["facts"])["Timely response rate"]
        self.assertIn("66.67%", fact)
        self.assertIn("6 / 9", fact)
        self.assertIn("3 untimely", fact)
        self.assertEqual(tx["item"]["state_profile"]["timely"]["yes"], 6)


class RankingAndLabelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = [row("2024-05-05", "Mortgage", company="BIG CO", timely="Yes"), row("2024-05-06", "Mortgage", company="BIG CO", timely="No")]
        rows += [row(f"2024-06-0{i + 1}", "Mortgage", company="PERFECT INC", timely="Yes") for i in range(5)]
        rows += [row(f"2024-07-{i + 1:02d}", "Mortgage", company="MID LLC", timely="Yes") for i in range(10)] + [row("2024-08-01", "Mortgage", company="MID LLC", timely="No")]
        agg = synthetic_agg(rows)
        sep = lib.SEP
        yes_key = sep.join(("BIG CO", "2024", "2", "Closed with explanation", "Yes"))
        co_key = sep.join(("BIG CO", "2024", "2", "Mortgage"))
        assert agg["cox"][yes_key] == 1 and agg["co"][co_key] == 2
        agg["cox"][yes_key] = 4_507_494   # Experian-like: millions of Yes, a handful of No
        agg["cox"][sep.join(("BIG CO", "2024", "2", "Closed with explanation", "No"))] = 93
        agg["co"][co_key] = 4_507_494 + 93
        cls.ctx = synthetic_ctx(agg)
        cls.rows, cls.profiles, cls.rankings, _, _ = build_cfpb.company_rows(agg, cls.ctx, 5_000_000, sec_rows=SEC_ROWS)

    def test_timely_ranking_uses_the_unrounded_ratio(self):
        order = [r["company"] for r in self.rankings["timely_rate"]]
        self.assertEqual(order, ["PERFECT INC", "BIG CO", "MID LLC"])  # BIG CO has 93 'No': below a company with none
        big = self.rankings["timely_rate"][1]
        self.assertEqual((big["yes"], big["no"]), (4_507_494, 93))
        self.assertLess(big["value"], 100.0)

    def test_displayed_rate_is_never_100_when_there_are_untimely_responses(self):
        big = next(r for r in self.rows if r["item"].get("company", {}).get("name") == "BIG CO")
        self.assertLess(big["item"]["cells"]["timely_rate"], 100.0)
        fact = dict(big["detail"]["facts"])["Timely response rate"]
        self.assertTrue(fact.startswith("99.998%"), fact)
        self.assertIn("93 untimely", fact)
        self.assertIn("rank 2 of 3", fact)
        self.assertNotIn("100.00%", big["item"]["subtitle"])
        perfect = next(r for r in self.rows if r["item"].get("company", {}).get("name") == "PERFECT INC")
        self.assertTrue(dict(perfect["detail"]["facts"])["Timely response rate"].startswith("100.00%"))

    def test_summary_row_has_units_coverage_and_medians(self):
        analytics = next(r for r in self.rows if r["id"] == "cfpb-companies:analytics")
        labels = [f[0] for f in analytics["detail"]["facts"]]
        for needed in ("Coverage", "Units", "Medians (top 250)"):
            self.assertIn(needed, labels)
        self.assertEqual(analytics["item"]["medians"]["companies"], 3)

    def test_labels_do_not_call_the_relief_base_closed(self):
        for r in self.rows:
            for label_text, value in r["detail"]["facts"]:
                self.assertNotIn("closed complaints", value, f"{r['id']} {label_text}")
                self.assertNotIn("(closed", label_text)


class RankingTieTests(unittest.TestCase):
    """Two rates that round to the same 2-decimal value must still be ordered by the unrounded ratio, not by complaint count."""

    def test_equal_rounded_rates_rank_by_exact_ratio(self):
        rows = [row("2024-05-05", "Mortgage", company="X CORP", timely="Yes"), row("2024-05-06", "Mortgage", company="X CORP", timely="No"),
                row("2024-05-07", "Mortgage", company="Y CORP", timely="Yes"), row("2024-05-08", "Mortgage", company="Y CORP", timely="No")]
        agg = synthetic_agg(rows)
        sep = lib.SEP
        for company, yes, no in (("X CORP", 199_980, 20), ("Y CORP", 99_991, 9)):   # both 99.99% to 2 decimals; X has more complaints
            agg["cox"][sep.join((company, "2024", "2", "Closed with explanation", "Yes"))] = yes
            agg["cox"][sep.join((company, "2024", "2", "Closed with explanation", "No"))] = no
            agg["co"][sep.join((company, "2024", "2", "Mortgage"))] = yes + no
        ctx = synthetic_ctx(agg)
        _, profiles, rankings, _, _ = build_cfpb.company_rows(agg, ctx, 400_000, sec_rows=SEC_ROWS)
        rates = {p["name"]: p["timely"]["rate"] for p in profiles}
        self.assertEqual(rates["X CORP"], rates["Y CORP"])  # the rounded values tie at 99.99
        self.assertEqual([r["company"] for r in rankings["timely_rate"]], ["Y CORP", "X CORP"])


class ProductComparabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        agg = synthetic_agg(product_rows())
        cls.ctx = synthetic_ctx(agg)
        cls.rows, cls.national, cls.window, cls.years = build_cfpb.national_rows(agg, cls.ctx)
        cls.by_id = {r["id"]: r for r in cls.rows}

    def product(self, slug):
        return self.by_id[f"cfpb-national:product:{slug}"]["item"]["product"]

    def year(self, slug, y):
        return next(r for r in self.product(slug)["years"] if r["year"] == y)

    def test_stable_product_keeps_its_changes(self):
        self.assertEqual(self.year("stable", "2021")["yoy_pct"], 0.0)  # 12 months in 2020 and 2021
        self.assertIsNone(self.year("stable", "2020")["yoy_pct"])      # 2019 outside the data
        self.assertIsNone(self.year("stable", "2026")["yoy_pct"])      # incomplete year
        self.assertTrue(self.product("stable")["window"]["comparable"])
        self.assertEqual(self.product("stable")["window"]["change_pct"], 2.78)  # 37 vs 36 complaints

    def test_name_not_in_use_all_year_gives_no_change(self):
        new = self.product("new")
        self.assertEqual(self.year("new", "2024")["months_recorded"], 5)
        self.assertIsNone(self.year("new", "2025")["yoy_pct"])  # 2024 had only 5 months under this name
        self.assertIn("5 of 12 months of 2024", self.year("new", "2025")["yoy_note"])
        self.assertIsNone(new["window"]["change_pct"])
        self.assertFalse(new["window"]["comparable"])
        self.assertIn("not like-for-like", new["window"]["note"])

    def test_retired_name_has_no_trailing_zero_rows_or_minus_100(self):
        old = self.product("old")
        self.assertEqual([r["year"] for r in old["years"]], ["2020", "2021", "2022", "2023", "2024"])
        self.assertEqual(self.year("old", "2023")["yoy_pct"], 0.0)
        self.assertIsNone(self.year("old", "2024")["yoy_pct"])  # only 7 months of 2024
        for r in old["years"]:
            self.assertGreater(r["complaints"], 0)
            self.assertNotEqual(r["yoy_pct"], -100.0)

    def test_gap_in_the_name_splits_the_runs(self):
        revived = self.product("revived")
        self.assertEqual(revived["name_runs"], [{"from": "2020-01", "to": "2021-12"}, {"from": "2024-08", "to": "2026-10"}])
        self.assertIsNone(self.year("revived", "2025")["yoy_pct"])
        self.assertEqual(self.year("revived", "2021")["yoy_pct"], 0.0)
        self.assertIsNone(revived["window"]["change_pct"])

    def test_listing_cell_and_fact_show_not_recorded_for_renamed_products(self):
        new_row = self.by_id["cfpb-national:product:new"]
        self.assertIsNone(new_row["item"]["cells"]["change"])
        facts = dict(new_row["detail"]["facts"])
        self.assertIn("Not recorded", facts["3-year window vs preceding"])
        self.assertIn("2024-08 to 2026-10", facts["Name recorded in"])
        stable = dict(self.by_id["cfpb-national:product:stable"]["detail"]["facts"])
        self.assertIn("2.78%", stable["3-year window vs preceding"])
        self.assertEqual(self.by_id["cfpb-national:product:stable"]["item"]["cells"]["change"], 2.78)


class NationalFixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agg = synthetic_agg()
        cls.ctx = synthetic_ctx(cls.agg)
        cls.rows, cls.national, cls.window, cls.years = build_cfpb.national_rows(cls.agg, cls.ctx)
        cls.by_id = {r["id"]: r for r in cls.rows}

    def test_states_recorded_excludes_the_blank_group(self):
        self.assertEqual(self.national["states_recorded"], 2)  # TX, NJ; one complaint has a blank State
        self.assertEqual(self.national["state_not_recorded_complaints"], 1)

    def test_blank_tags_and_public_response_have_their_own_labels(self):
        tags = [t["value"] for t in self.national["tags"]]
        self.assertIn("No tag", tags)
        self.assertIn("Servicemember", tags)
        self.assertNotIn("Not recorded", tags)
        self.assertEqual([t["value"] for t in self.national["company_public_response"]], ["No public response"])
        window_tags = [t["value"] for t in self.window["tags"]]
        self.assertNotIn("Not recorded", window_tags)

    def test_previous_year_is_not_recorded_outside_coverage(self):
        first = self.by_id["cfpb-national:year:2023"]["item"]["year"]["top_companies"]
        self.assertTrue(first and all(c["previous_year"] is None for c in first))   # 2022 is not in the data
        later = self.by_id["cfpb-national:year:2024"]["item"]["year"]["top_companies"]
        self.assertTrue(all(isinstance(c["previous_year"], int) for c in later))    # 2023 is covered: a true zero stays 0

    def test_ytd_fact_carries_the_maturity_caveat(self):
        facts = dict(self.by_id["cfpb-national:all"]["detail"]["facts"])
        label_text = next(k for k in facts if "to date vs same period" in k)
        self.assertIn("not yet matured", facts[label_text])
        self.assertIn("understated", facts[label_text])
        self.assertIn("not yet matured", self.national["analytics"]["ytd"]["note"])

    def test_source_quote_keeps_the_page_punctuation(self):
        self.assertIn("consumers’ experiences", build_cfpb.NOT_VERIFIED)
        self.assertIn("“information”", build_cfpb.NOT_VERIFIED)
        self.assertNotIn("'", build_cfpb.NOT_VERIFIED)

    def test_listing_options_drop_values_no_row_carries(self):
        rows = [{"filters": {"sec_link": ["no"]}}, {"filters": {"sec_link": ["no"]}}]
        self.assertEqual(build_cfpb.used_options(rows, "sec_link", {"yes": "Linked", "no": "Not linked"}), {"no": "Not linked"})
        self.assertEqual(build_cfpb.used_options([], "sec_link", {"yes": "Linked"}), {})


class StateAndCompanyRowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agg = synthetic_agg()
        cls.ctx = synthetic_ctx(cls.agg)
        cls.state_rows, cls.profiles, cls.rankings = build_cfpb.state_rows(cls.agg, cls.ctx, 6, pops=POPS)
        cls.company_rows, cls.company_profiles, _, _, _ = build_cfpb.company_rows(cls.agg, cls.ctx, 6, sec_rows=SEC_ROWS)

    def test_state_rows_have_keys_sources_and_fact_shape(self):
        ids = [r["id"] for r in self.state_rows]
        self.assertEqual(len(ids), len(set(ids)))
        for r in self.state_rows:
            self.assertEqual(r["dataset"], "cfpb_complaints_states")
            self.assertRegex(r["id"], r"^cfpb-state:[A-Za-z0-9-]+$|^cfpb-states:analytics$")
            self.assertTrue(r["source_url"].startswith("https://"), r["id"])
            self.assertTrue(all(isinstance(f, list) and len(f) == 2 and f[1] for f in r["detail"]["facts"]), r["id"])
            labels = [f[0] for f in r["detail"]["facts"]]
            self.assertIn("Units", labels)
        by_id = {r["id"]: r for r in self.state_rows}
        self.assertIn("cfpb-state:NR", by_id)
        analytics = by_id["cfpb-states:analytics"]
        labels = [f[0] for f in analytics["detail"]["facts"]]
        for needed in ("Units", "Coverage", "Medians (50 states + DC)", "Credit-reporting caveat", "Fastest rise excluding credit reporting"):
            self.assertIn(needed, labels)
        self.assertEqual(analytics["item"]["medians"]["jurisdictions"], 2)
        self.assertEqual(analytics["item"]["medians"]["per_100k_2025"], 50.0)  # TX 100.0 and NJ 0.0

    def test_per_capita_fact_names_the_july_1_estimate(self):
        tx = dict(next(r for r in self.state_rows if r["id"] == "cfpb-state:TX")["detail"]["facts"])
        fact = next(v for k, v in tx.items() if k.startswith("Complaints per 100,000 residents"))
        self.assertIn("July 1, 2025 resident population estimate", fact)

    def test_company_rows_have_keys_sources_and_spellings(self):
        ids = [r["id"] for r in self.company_rows]
        self.assertEqual(len(ids), len(set(ids)))
        for r in self.company_rows:
            self.assertEqual(r["dataset"], "cfpb_complaints_companies")
            self.assertRegex(r["id"], r"^cfpb-company:[a-z0-9-]+$|^cfpb-companies:analytics$")
            self.assertTrue(r["source_url"].startswith("https://"), r["id"])
        acme = next(r for r in self.company_rows if r["item"].get("company", {}).get("name") == "ACME BANK")
        self.assertEqual(acme["item"]["company"]["other_spellings"], [{"name": "Acme Bank", "complaints": 1}])
        self.assertIn("Acme Bank (1 complaint)", dict(acme["detail"]["facts"])["Other recorded spellings (not merged)"])
        zeta = next(r for r in self.company_rows if r["item"].get("company", {}).get("name") == "ZETA CO")
        self.assertIn("None recorded", dict(zeta["detail"]["facts"])["Other recorded spellings (not merged)"])


class ReportFixTests(unittest.TestCase):
    PAGE = ReportTests.PAGE.replace('<span class="m-meta-header__item"> To Congress </span></div>',
                                    '<span class="m-meta-header__item"> Data spotlight </span>'
                                    '<span class="m-meta-header__item"> Data spotlight </span>'
                                    '<span class="m-meta-header__item"> Industry and markets </span></div>')

    def test_repeated_category_tag_counts_once(self):
        entries, total, pages = reports.parse_page(self.PAGE)
        self.assertEqual(entries[0]["categories"], ["Data spotlight", "Industry and markets"])
        self.assertEqual(entries[0]["category_tags_repeated"], 1)
        self.assertEqual(entries[1]["category_tags_repeated"], 0)

    def test_report_rows_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "reports"))
            with open(os.path.join(tmp, "reports", "page-001.html"), "w", encoding="utf-8") as handle:
                handle.write(self.PAGE)
            saved = build_cfpb.ACQ
            build_cfpb.ACQ = tmp
            try:
                ctx = {"manifest": {"private/acq/cfpb/reports/page-001.html": {"url": "https://www.consumerfinance.gov/data-research/research-reports/",
                                                                                 "retrieved_at": "2026-10-18T00:00:00Z"}}}
                rows, entries = build_cfpb.report_rows(ctx)
            finally:
                build_cfpb.ACQ = saved
        self.assertEqual([r["id"] for r in rows], ["cfpb-report:a-report", "cfpb-report:b"])
        first = rows[0]
        self.assertEqual(first["item"]["cells"]["category"], "Data spotlight, Industry and markets")
        self.assertEqual(first["filters"]["category"], ["data-spotlight", "industry-and-markets"])
        self.assertEqual(first["item"]["badges"], ["Data spotlight", "Industry and markets"])
        self.assertEqual(first["source_url"], "https://www.consumerfinance.gov/data-research/research-reports/a-report/")
        self.assertEqual(rows[1]["item"]["cells"]["category"], "Not recorded")  # no category stays Not recorded
        counts = {}
        for e in entries:
            for c in (e["categories"] or ["Not recorded"]):
                counts[c] = counts.get(c, 0) + 1
        self.assertEqual(counts["Data spotlight"], 1)


class MainGuardTests(unittest.TestCase):
    def test_dataset_id_collision_aborts(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "corpus_dataset_ids.json"), "w", encoding="utf-8") as handle:
                json.dump({"ids": "alpha,cfpb_complaints_states,omega"}, handle)
            saved = (build_cfpb.LOOKUPS, build_cfpb.load_manifest)
            build_cfpb.LOOKUPS, build_cfpb.load_manifest = tmp, (lambda: {})
            try:
                with self.assertRaises(SystemExit) as caught:
                    build_cfpb.main()
            finally:
                build_cfpb.LOOKUPS, build_cfpb.load_manifest = saved
        self.assertIn("already exist", str(caught.exception))
        self.assertIn("cfpb_complaints_states", str(caught.exception))

    def test_write_build_rejects_duplicate_ids_and_bad_names(self):
        saved = build_cfpb.OUT
        with tempfile.TemporaryDirectory() as tmp:
            build_cfpb.OUT = tmp
            try:
                with self.assertRaises(ValueError):
                    build_cfpb.write_build("ok_name", "x", [{"id": "a"}, {"id": "a"}], {}, {}, [])
                with self.assertRaises(ValueError):
                    build_cfpb.write_build("Bad-Name", "x", [{"id": "a"}], {}, {}, [])
            finally:
                build_cfpb.OUT = saved


if __name__ == "__main__":
    unittest.main()
