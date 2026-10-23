"""Offline unit tests for the FTC Consumer Sentinel / refunds / Do Not Call parsers, validators and analytics.

Run: cd scripts/enrichment/ftc_sentinel && python3 -B -m unittest -v test_ftc_sentinel
All fixtures are synthetic; the last class additionally checks the build files when they exist (skipped otherwise).
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import build_ftc_sentinel as B  # noqa: E402
import ftc_common as C  # noqa: E402
import ftc_dnc as D  # noqa: E402
import ftc_dnc_pdf as F  # noqa: E402
import ftc_national as N  # noqa: E402
import ftc_parse as P  # noqa: E402
import ftc_refunds as R  # noqa: E402
import ftc_states as S  # noqa: E402
import ftc_supplement as X  # noqa: E402


# Published strings (row provenance, facts, dataset summaries) name no third-party tool, crawler, search or AI vendor.
VENDOR_NAMES = r"(?i)firecrawl|tavily|browser[ _-]?use|apify|\bexa\b|anthropic|claude|openai|\bgpt|\bmcp\b"


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * len(header)) + " |"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


# --------------------------------------------------------------------------------------------------------------------
class NumberAndNameTests(unittest.TestCase):
    def test_state_names_survive_letter_spacing(self):
        self.assertEqual(P.state_usps("Ne wHa mps hi r e"), "NH")
        self.assertEqual(P.state_usps("Pue r t oRi c o"), "PR")
        self.assertEqual(P.state_usps("DistrictofColumbia"), "DC")
        self.assertEqual(P.state_usps("District of Columbia"), "DC")

    def test_non_state_text_is_not_a_state(self):
        self.assertIsNone(P.state_usps("Georgia, Department of Law"))
        self.assertIsNone(P.state_usps("Total"))
        self.assertIsNone(P.state_usps(""))

    def test_number_parsers_refuse_to_guess(self):
        self.assertEqual(P.to_int("1,234,567"), 1234567)
        self.assertIsNone(P.to_int("102,"))
        self.assertIsNone(P.to_int("12,34"))
        self.assertEqual(P.to_usd("$104,201,969"), 104201969)
        self.assertEqual(P.to_usd("$2,952M"), 2952000000)
        self.assertEqual(P.to_usd("$104.2M"), 104200000)
        self.assertIsNone(P.to_usd("104"))
        self.assertEqual(P.to_pct("39%"), 39.0)
        self.assertEqual(P.to_ordinal("22nd"), 22)
        self.assertIsNone(P.to_ordinal("22"))


class TableTests(unittest.TestCase):
    def test_header_and_rows(self):
        t = list(P.iter_tables(table(["State", "Reports"], [["Alabama", "1,000"], ["Alaska", "200"]])))[0]
        self.assertEqual(t["header"], ["State", "Reports"])
        self.assertEqual(len(t["rows"]), 2)

    def test_promoted_data_row_is_not_a_header(self):
        text = table(["27", "Tennessee", "5,311,697", "77,436"], [["28", "West Virginia", "1,380,744", "76,663"]])
        t = list(P.iter_tables(text))[0]
        self.assertIsNone(t["header"])
        self.assertEqual(len(t["rows"]), 2)
        text = table(["Government Documents", "Driver's License", "8,977", "+14%"], [["Government Documents", "Passport", "1,623", "+69%"]])
        self.assertIsNone(list(P.iter_tables(text))[0]["header"])

    def test_year_columns_stay_a_header(self):
        t = list(P.iter_tables(table(["", "2021", "2022", "2023"], [["Total", "1", "2", "3"]])))[0]
        self.assertEqual(t["header"], ["", "2021", "2022", "2023"])


# --------------------------------------------------------------------------------------------------------------------
def ranking_text(rows, basis="2023"):
    body = [[r if r is not None else "", n, f"{p:,}", f"{c:,}"] for r, n, p, c in rows]
    return "##### State Rankings\n" + table(["Rank", "State", "Reports per 100K Population", "# of Reports"], body) + f"\n*Population estimates are based on {basis} U.S. Census population estimates.*"


def full_ranking(descending_from=2000):
    names = [P.STATES[u] for u in P.RANKED_STATES]
    rows = [(i + 1, n, descending_from - i * 7, 1000 + i) for i, n in enumerate(names)]
    rows += [(None, "District of Columbia", 2500, 500), (None, "Puerto Rico", 300, 400)]
    return rows


class RankingTests(unittest.TestCase):
    def test_complete_ranking_validates(self):
        rows, problems = P.parse_rank_rows(ranking_text(full_ranking()))
        self.assertEqual(problems, [])
        self.assertEqual(len(rows), 52)
        self.assertIsNone(rows["DC"]["rank"])
        self.assertEqual(rows["AL"], {"rank": 1, "per100k": 2000, "reports": 1000})
        self.assertEqual(P.validate_ranking(rows, "t"), [])
        self.assertEqual(P.population_basis(ranking_text(full_ranking())), "2023")

    def test_missing_state_gap_and_rising_value_are_reported(self):
        rows = full_ranking()
        del rows[3]  # drop rank 4
        parsed, _ = P.parse_rank_rows(ranking_text(rows))
        problems = " ".join(P.validate_ranking(parsed, "t"))
        self.assertIn("missing", problems)
        self.assertIn("ranks are not 1..50", problems)
        rows = full_ranking()
        rows[10] = (11, rows[10][1], 99999, rows[10][3])  # per-100K higher than rank 1
        parsed, _ = P.parse_rank_rows(ranking_text(rows))
        self.assertIn("rises", " ".join(P.validate_ranking(parsed, "t")))

    def test_ranked_dc_is_a_problem(self):
        rows = full_ranking()
        rows[-2] = (51, "District of Columbia", 2500, 500)
        parsed, _ = P.parse_rank_rows(ranking_text(rows))
        self.assertIn("should be unranked", " ".join(P.validate_ranking(parsed, "t")))

    def test_appendix_c(self):
        text = table(["State", "# of Reports", "% Reporting Loss", "Total $ Loss", "Median $ Loss"], [["Alabama", "26,049", "39%", "$104,201,969", "$400"], ["Georgia, Department", "5", "1%", "$5", "$5"], ["Alaska", "x", "39%", "$1", "$1"]])
        rows, problems = P.parse_appendix_c(text)
        self.assertEqual(rows["AL"], {"reports": 26049, "pct_reporting_loss": 39.0, "total_loss_usd": 104201969, "median_loss_usd": 400})
        self.assertEqual(list(rows), ["AL"])
        self.assertEqual(len(problems), 1)  # Alaska's unreadable count is reported, not repaired


class StatePageTests(unittest.TestCase):
    VOCAB = {P.letters_key(x) for x in ["Credit Cards", "Identity Theft", "Imposter Scams", "Auto Related", "Banks and Lenders", "Debt Collection", "Internet Services", "Health Care", "Online Shopping and Negative Reviews", "Prizes, Sweepstakes and Lotteries", "Credit Bureaus and Information Furnishers"]}

    def page(self, extra_rows=()):
        cats = [("Credit Bureaus and Information Furnishers", 32), ("Identity Theft", 16), ("Imposter Scams", 10), ("Banks and Lenders", 5), ("Debt Collection", 5), ("Online Shopping and Negative Reviews", 5), ("Auto Related", 3), ("Prizes, Sweepstakes and Lotteries", 2), ("Internet Services", 2), ("Credit Cards", 2)]
        thefts = [("Credit Card", 39), ("Other Identity Theft", 36), ("Loan or Lease", 21)]
        return (
            "### Alabama\n" + table(["Category", "Share of reports (%)"], cats[:9])
            + "\n\n" + table(["Category", "Share (%)"], [cats[9]] + thefts + list(extra_rows))
            + "\n14th\n70,132\n16th\n13,596\n*Percentages are based on the total number of relevant 2024 reports from Alabama consumers.*"
        )

    def test_spilled_row_goes_back_to_categories(self):
        sp = P.parse_state_page(self.page(), self.VOCAB)
        self.assertEqual(len(sp["top_categories"]), 10)
        self.assertEqual(sp["top_categories"][-1], ("Credit Cards", 2))
        self.assertEqual([t[0] for t in sp["id_theft_types"]], ["Credit Card", "Other Identity Theft", "Loan or Lease"])
        self.assertEqual(P.validate_top_categories(sp["top_categories"]), [])
        self.assertEqual(P.validate_id_theft_types(sp["id_theft_types"]), [])
        self.assertEqual(sp["problems"], [])
        self.assertIn(70132, sp["integers"])
        self.assertEqual(sp["ordinals"], [14, 16])

    def test_damaged_label_is_reported_not_guessed(self):
        sp = P.parse_state_page(self.page([("ent or Tax-Related Fraud", 7)]), self.VOCAB)
        self.assertTrue(any("unclassified" in p for p in sp["problems"]))

    def test_page_identified_by_footnote_before_heading(self):
        self.assertEqual(P.identify_state_page(self.page()), ("AL", "footnote"))
        self.assertEqual(P.identify_state_page("### Alaska\nno footnote"), ("AK", "heading"))
        self.assertEqual(P.identify_state_page("no state anywhere"), (None, None))

    def test_top_category_validation(self):
        good = [("a", 30), ("b", 20), ("c", 10)] + [(f"x{i}", 1) for i in range(7)]
        self.assertEqual(P.validate_top_categories(good), [])
        self.assertTrue(P.validate_top_categories(good[:9]))
        self.assertTrue(P.validate_top_categories([("a", 1), ("b", 5)] + [(f"x{i}", 1) for i in range(8)]))
        self.assertTrue(P.validate_top_categories([("a", 60), ("b", 50)] + [(f"x{i}", 1) for i in range(8)]))


class StatesBookTests(unittest.TestCase):
    """parse_states on a synthetic one-edition book."""

    def book(self, drop_total_on_page=None):
        rank_rows = full_ranking()
        by_state = {n: (p, c) for _, n, p, c in rank_rows}
        parts = ["cover", "toc"] + ["filler"] * 17
        parts.append(ranking_text(rank_rows).replace("##### State Rankings", "#### StateRankings:FraudandOtherReports"))
        parts.append(ranking_text([(r, n, max(p // 10, 1), c // 5) for r, n, p, c in rank_rows]).replace("##### State Rankings", "#### StateRankings:IdentityTheftReports"))
        for usps, name in P.STATES.items():
            fo_reports = by_state[name][1]
            cats = [(c, 10 - i) for i, c in enumerate(["Identity Theft", "Imposter Scams", "Auto Related", "Banks and Lenders", "Debt Collection", "Internet Services", "Health Care", "Credit Cards", "Online Shopping and Negative Reviews", "Prizes, Sweepstakes and Lotteries"])]
            printed = "" if usps == drop_total_on_page else f"{fo_reports:,}"
            parts.append(f"### {name.replace(' ', '')}\n" + table(["Category", "Share of reports (%)"], cats) + f"\n{printed}\n*Percentages are based on the total number of relevant 2024 reports from {name.replace(' ', '')} consumers.*")
        rows = [[n, f"{c:,}", "40%", "$1,000", "$100"] for n, (p, c) in ((P.STATES[u], by_state[P.STATES[u]]) for u in P.STATES)]
        parts.append("**AppendixC:FraudReports**\n" + table(["State", "# of Reports", "% Reporting Loss", "Total $ Loss", "Median $ Loss"], [[r[0], f"{int(r[1].replace(',', '')) // 2:,}"] + r[2:] for r in rows]))
        # national category table so the vocabulary exists
        cat_rows = [[i + 1, c, f"{1000 - i:,}", "1.00%"] for i, c in enumerate(["Identity Theft", "Imposter Scams", "Auto Related", "Banks and Lenders", "Debt Collection", "Internet Services", "Health Care", "Credit Cards", "Online Shopping and Negative Reviews", "Prizes, Sweepstakes and Lotteries"])]
        parts[3] = "**ReportCategor ies**\n" + table(["Rank", "Category", "# of Reports", "%"], cat_rows)
        return "\n---\n".join(parts)

    def test_all_jurisdictions_parse_and_pages_confirm_totals(self):
        states, book, problems = S.parse_states(self.book(), 2024)
        self.assertEqual(problems, [])
        self.assertEqual(len(states), 52)
        self.assertEqual(book["population_basis_year"], "2023")
        self.assertTrue(all(s["checks"]["page_prints_fraud_other_total"] for s in states.values()))
        self.assertEqual(states["AL"]["fraud"]["reports"], 500)
        self.assertEqual(len(states["AL"]["top_categories"]), 10)

    def test_page_that_does_not_print_the_ranking_total_is_not_used(self):
        states, _, _ = S.parse_states(self.book(drop_total_on_page="TX"), 2024)
        self.assertIsNone(states["TX"]["top_categories"])
        self.assertTrue(any("does not print" in w for w in states["TX"]["withheld"]))
        self.assertIsNotNone(states["TX"]["fraud_other"])  # the ranking-table figures themselves are unaffected


# --------------------------------------------------------------------------------------------------------------------
class NationalTests(unittest.TestCase):
    def test_age_labels(self):
        self.assertEqual(N.age_label("80+"), "80 and Over")
        self.assertEqual(N.age_label("80 and Over"), "80 and Over")
        self.assertEqual(N.age_label("20 - 29"), "20 - 29")
        self.assertEqual(N.age_label("19 and under"), "19 and Under")
        self.assertIsNone(N.age_label("Email"))

    def test_comparable_changes_use_identical_names_only(self):
        old = [{"category": "Imposter Scams", "total_loss_usd": 100}, {"category": "Health Care", "total_loss_usd": 10}]
        new = [{"category": "Imposter Scams", "total_loss_usd": 150}, {"category": "Health Care", "total_loss_usd": 5}, {"category": "Investment Related", "total_loss_usd": 9}, {"category": "Imposter  Scams", "total_loss_usd": 1}]
        out, skipped = B.comparable_changes(old, new, "category", "total_loss_usd")
        self.assertEqual([(r["name"], r["change_pct"]) for r in out], [("Imposter Scams", 50.0), ("Health Care", -50.0)])
        self.assertEqual(skipped, ["Investment Related", "Imposter  Scams"])  # no fuzzy matching of near-identical names

    def test_definition_notices_cover_documented_years_only(self):
        self.assertEqual([n[:4] for n in B.notices_between(2022, 2024)], ["2023", "2024"])
        self.assertEqual(B.notices_between(2024, 2024), [])
        self.assertEqual(len(B.notices_between(2017, 2024)), 3)

    def test_fraud_summary_text_in_either_order(self):
        pages = ["cover", "toc", "x"] + ["filler"] * 3
        pages.append("**Report Categories**\n" + table(["Rank", "Category", "# of Reports", "%"], [[i + 1, f"Cat {chr(65 + i)}", f"{200 - i:,}", "1.0%"] for i in range(26)]))
        pages.append("#### Number of Fraud, Identity Theft and Other Reports by Year\n" + table(["Year", "# of Reports"], [["2023", "4,000"], ["2024", "5,000"]]))
        pages.append(table(["Year", "Fraud", "Identity Theft", "Other"], [["2023", "1,800", "1,000", "1,200"], ["2024", "2,000", "1,100", "1,900"]]))
        pages.append(table(["Report Type", "# of Reports", "Share of reports (%)"], [["Fraud", "2000", "40.0"], ["Identity Theft", "1100", "22.0"], ["Other", "1900", "38.0"]]))
        pages.append("#### Fraud Reports by Amount Lost\n\n2,000\nNumberofFraudReports\n\n500 (25%)\n$1,200,000\n\n#ofReportswith$Loss\n$300\n\nTotal$Loss\nMedian$Loss\n\n" + table(["Amount Lost", "# of Reports"], [[f"${i}", 45] for i in range(10)] + [["More than $10,000", 50]]))
        pages.append("#### StateRankings:FraudandOtherReports\n" + ranking_text(full_ranking()))
        sec, problems = N.parse_national(pages, 2024)
        self.assertEqual(sec["fraud_summary"], {"fraud_reports": 2000, "reports_with_loss": 500, "pct_reporting_loss": 25, "total_loss_usd": 1200000, "median_loss_usd": 300})
        self.assertEqual(sec["report_types"]["Other"]["reports"], 1900)
        self.assertEqual(sec["reports_by_type_by_year"][2024], {"fraud": 2000, "identity_theft": 1100, "other": 1900})
        self.assertFalse([p for p in problems if "fraud summary" in p or "history" in p])


# --------------------------------------------------------------------------------------------------------------------
class DncTests(unittest.TestCase):
    def test_unranked_rows_are_read_even_when_the_extraction_shifts_them(self):
        self.assertEqual(D._row(["1", "Arizona", "74,752", "1,028"])[:4], (1, "AZ", 74752, 1028))
        self.assertEqual(D._row(["", "District of Columbia", "5,392", "802"]), (None, "DC", 5392, 802))
        self.assertEqual(D._row(["Puerto Rico", "899", "28", ""]), (None, "PR", 899, 28))
        self.assertIsNone(D._row(["", "", "", ""]))

    def test_spaced_letter_state_names_in_rankings(self):
        text = "| Ra nk | Cons umerS t a t e | Active Registrations | Active Registrations per 100K Population |\n| --- | --- | --- | --- |\n| 1 | Ne wHa mps hi r e | 1,296,267 | 95,648 |\n"
        rk, _ = D.parse_dnc_rankings(["", "", "", "", text])
        self.assertEqual(rk["registrations"]["NH"]["count"], 1296267)

    def test_state_page_totals_in_ligature_stripped_and_bold_text(self):
        pages = [""] * 8 + ["## StateTotals\nComplaints:24,493 (#34naonally,per100Kpopulaon)\nAcveRegistraons:3,820,539 (#29naonally,per100Kpopulaon)",
                           "**Complaints:** 58,959 **(#35** nationally, per 100K population) **Active** Registrations: 3,624,168 **(#30** nationally, per 100K population)",
                           "Complaints:4,488 (NotRanked)", "Complaints: 3,345 (#4"]
        totals = D.parse_dnc_state_pages(pages)
        self.assertEqual([(t["complaints"], t["complaints_rank"], t["registrations"], t["registrations_rank"]) for t in totals],
                         [(24493, 34, 3820539, 29), (58959, 35, 3624168, 30), (4488, None, None, None), (3345, None, None, None)])

    def test_duplicate_totals_lines_on_one_page_merge_to_one(self):
        merged = D.merge_by_chunk([
            {"chunk": 9, "complaints": 100, "registrations": 5, "heading_usps": None, "complaints_rank": 3, "registrations_rank": 12},
            {"chunk": 9, "complaints": 100, "registrations": 5, "heading_usps": None, "complaints_rank": 3, "registrations_rank": 1},
            {"chunk": 10, "complaints": 7, "registrations": None, "heading_usps": None, "complaints_rank": None, "registrations_rank": None},
            {"chunk": 11, "complaints": 8, "registrations": None, "heading_usps": None, "complaints_rank": None, "registrations_rank": None},
            {"chunk": 11, "complaints": 9, "registrations": None, "heading_usps": None, "complaints_rank": None, "registrations_rank": None},
        ])
        self.assertEqual([m["chunk"] for m in merged], [9, 10])  # chunk 11 has two different counts: dropped, not guessed
        self.assertEqual(merged[0]["registrations_rank"], 12)  # the complete copy wins over the cut-off '#1'

    def test_adjudication_prefers_the_reading_the_per100k_confirms(self):
        medians = {"RI": 1_057_800}
        check = lambda c, p: D._loose_ok(medians, "RI", c, p)  # noqa: E731
        # table lost the leading 7 of 7,608; the printed per-100K (719) fits only the state page reading
        count, per, how, reasons = D.adjudicate(check, 608, 7608, 719, "complaints")
        self.assertEqual((count, per), (7608, 719))
        self.assertIn("state page", how)
        self.assertEqual(reasons, [])
        # per-100K lost its leading digit too: nothing confirms it, so it is withheld but the count survives
        count, per, how, reasons = D.adjudicate(check, 14875, 14875, 537, "complaints")
        self.assertEqual((count, per), (14875, None))
        self.assertTrue(any("fails the implied-population check" in r for r in reasons))
        # two disagreeing readings and nothing to adjudicate with: both withheld
        count, per, how, reasons = D.adjudicate(lambda c, p: False, 608, 7608, 719, "complaints")
        self.assertEqual((count, per), (None, None))

    def test_tight_check_requires_one_population_inside_an_edition(self):
        anchor = 1_000_000
        self.assertTrue(D._tight_ok(anchor, 7_200, 720, 80_000))
        self.assertFalse(D._tight_ok(anchor, 7_200, 1_720, 80_000))
        self.assertFalse(D._tight_ok(None, 7_200, 720, 80_000))

    def test_page_order_is_checked_against_the_tables(self):
        order = D.ALPHA_ORDER
        pages = [{"chunk": i, "complaints": 1000 + i, "complaints_rank": None, "registrations": None, "registrations_rank": None, "heading_usps": None} for i in range(52)]
        rankings = {"complaints": {u: {"count": 1000 + i, "rank": None, "per100k": 1, "chunk": 8} for i, u in enumerate(order)}, "registrations": {}}
        by_state, problems = D.assign_pages(pages, rankings, 2025)
        self.assertEqual(problems, [])
        self.assertEqual(by_state["DC"]["complaints"], 1000 + order.index("DC"))
        shifted = pages[1:] + pages[:1]
        by_state, problems = D.assign_pages(shifted, rankings, 2025)
        self.assertEqual(by_state, {})
        self.assertTrue(problems)
        by_state, problems = D.assign_pages(pages[:51], rankings, 2025)
        self.assertEqual(by_state, {})

    def test_alphabetical_order_puts_dc_between_delaware_and_florida(self):
        o = D.ALPHA_ORDER
        self.assertEqual(o[o.index("DE") + 1], "DC")
        self.assertEqual(o[o.index("DC") + 1], "FL")
        self.assertEqual(o[o.index("PA") + 1], "PR")

    def test_population_basis_in_plain_and_ligature_text(self):
        self.assertEqual(D.dnc_population_basis("Population estimates are based on 2021 U.S. Census"), "2021")
        self.assertEqual(D.dnc_population_basis("Populaonesmatesarebasedon2023U.S.Census"), "2023")
        self.assertIsNone(D.dnc_population_basis("nothing"))


class SupplementTests(unittest.TestCase):
    TEXT = ("Registry Complaints by State Rank Consumer State Complaints Complaints per 100K PopulaƟon 1 Delaware 2 Ohio 3 ConnecƟcut 4 Arizona 5 Maryland "
            "1,537 14,875 1,246 145,443 974 34,781 1,206 86,550 1,180 71,244 Rank Consumer State Complaints [...] other text")

    def test_names_and_pairs_are_matched_by_position(self):
        blocks = X.parse_rank_blocks(self.TEXT)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["kind"], "complaints")
        self.assertEqual(blocks[0]["rows"][0], {"rank": 1, "usps": "DE", "per100k": 1537, "count": 14875})
        self.assertEqual([r["usps"] for r in blocks[0]["rows"]], ["DE", "OH", "CT", "AZ", "MD"])  # ligature in 'ConnecƟcut' is resolved

    def test_overlapping_continuation_run_is_stitched(self):
        text = ("Rank Consumer State Active Registrations Active Registrations per 100K PopulaƟon 1 New Hampshire 2 Maine 3 Kansas 4 Vermont 5 Ohio "
                "95,000 1,000,000 94,000 2,000,000 93,000 3,000,000 [...] 94,000 2,000,000 93,000 3,000,000 92,000 4,000,000 91,000 5,000,000 more")
        rows = X.parse_rank_blocks(text)[0]["rows"]
        self.assertEqual([(r["usps"], r["per100k"], r["count"]) for r in rows],
                         [("NH", 95000, 1000000), ("ME", 94000, 2000000), ("KS", 93000, 3000000), ("VT", 92000, 4000000), ("OH", 91000, 5000000)])
        self.assertEqual(X.parse_rank_blocks(text)[0]["kind"], "registrations")

    def test_a_short_or_broken_chain_is_not_a_table(self):
        self.assertEqual(X.parse_rank_blocks("1 Delaware 2 Ohio 4 Arizona 5 Maryland 1,000 5 2,000 6"), [])

class DncPdfTests(unittest.TestCase):
    """Ranking tables read from the official PDF word layer, and consolidation around those rows."""

    def test_two_table_columns_on_one_text_row_are_both_read(self):
        rows = ["1 Arizona 74,752 1,028 27 West Virginia 13,021 730", "Puerto Rico 899 28", "District of Columbia 5,392 802", "Blank noise 12"]
        table, problems = F.parse_ranking_rows(rows)
        self.assertEqual(problems, [])
        self.assertEqual(table["AZ"], {"rank": 1, "count": 74752, "per100k": 1028})
        self.assertEqual(table["WV"], {"rank": 27, "count": 13021, "per100k": 730})
        self.assertEqual(table["PR"], {"rank": None, "count": 899, "per100k": 28})  # count/per-100K recognised whichever prints first
        self.assertEqual(table["DC"]["count"], 5392)
        self.assertNotIn("Blank noise", table)

    def test_per100k_first_column_order_is_handled(self):
        table, _ = F.parse_ranking_rows(["3 Nevada 960 30,159"])
        self.assertEqual(table["NV"], {"rank": 3, "count": 30159, "per100k": 960})

    def test_a_table_must_have_all_rows_and_a_clean_rank_chain(self):
        full = {u: {"rank": i + 1, "count": 100000 - i, "per100k": 5000 - i} for i, u in enumerate(P.RANKED_STATES)}
        full["DC"] = {"rank": None, "count": 1, "per100k": 1}
        full["PR"] = {"rank": None, "count": 1, "per100k": 1}
        self.assertEqual(F.validate_pdf_table(full, "t"), [])
        short = dict(full)
        del short["TX"]
        self.assertTrue(any("missing" in p for p in F.validate_pdf_table(short, "t")))
        rising = {**full, "AL": {"rank": 1, "count": 5, "per100k": 99999}}
        self.assertTrue(any("rises" in p for p in F.validate_pdf_table({**rising, "AK": {"rank": 2, "count": 5, "per100k": 99999 + 1}}, "t")))

    def _books(self, page_complaints=15000, per_complaints=1500):
        books = {}
        for fy in (2021, 2022, 2023):
            rankings = {"registrations": {"DE": {"rank": 19, "count": 800000, "per100k": 80000, "chunk": "PDF page 8"}},
                        "complaints": {"DE": {"rank": 1, "count": 15000, "per100k": per_complaints, "chunk": "PDF page 9"}}}
            pages = {"DE": {"chunk": 16, "complaints": page_complaints, "complaints_rank": 1, "registrations": 800000, "registrations_rank": 19, "heading_usps": None}}
            books[fy] = {"rankings": rankings, "pages": pages}
        return books

    def test_pdf_row_is_used_and_a_damaged_state_page_total_is_noted(self):
        recs = D.consolidate(self._books(page_complaints=5000))
        r = recs[("DE", 2022)]
        self.assertEqual((r["complaints"]["count"], r["complaints"]["per100k"], r["complaints"]["rank"]), (15000, 1500, 1))
        self.assertTrue(any("state page printed 5,000" in n for n in r["notes"]))
        self.assertEqual(r["withheld"], [])

    def test_an_implausible_per100k_is_withheld_but_the_count_is_kept(self):
        recs = D.consolidate(self._books(per_complaints=150))
        r = recs[("DE", 2022)]
        self.assertEqual((r["complaints"]["count"], r["complaints"]["per100k"]), (15000, None))
        self.assertTrue(any("fails the implied-population check" in w for w in r["withheld"]))
        self.assertIsNone(recs[("AL", 2022)]["complaints"])  # a jurisdiction with no row at all stays Not recorded

    def test_the_independent_text_reading_is_only_a_cross_check(self):
        # Tavily-style text parses to candidate rows, which build_dnc compares with the PDF rows and never publishes
        blocks = X.parse_rank_blocks(SupplementTests.TEXT)
        self.assertEqual(blocks[0]["rows"][0]["per100k"], 1537)


# --------------------------------------------------------------------------------------------------------------------
class DefectRegressionTests(unittest.TestCase):
    """Verifier findings D2-D4 and the provenance request."""

    def test_printed_percentages_are_shown_without_a_second_rounding(self):
        self.assertEqual(C.fmt_pct_exact(66.55), "66.55%")  # D2: not 66.5% (binary rounding) and not 66.6%
        self.assertEqual(C.fmt_pct_exact(93.0), "93%")
        self.assertEqual(C.fmt_pct_exact(100.0), "100%")
        self.assertEqual(C.fmt_pct_exact(91.4), "91.4%")
        self.assertEqual(C.fmt_pct_exact(0.5), "0.5%")
        self.assertEqual(C.fmt_pct_exact(None), "Not recorded")
        self.assertEqual(B.refund_display("pct_cashed", 66.55), "66.55%")
        self.assertEqual(R.convert("66.55%", "pct")[0], 66.55)
        cases, _, _ = R.parse_case_table([["A", "10/10/2024", "$1.00", "10", "5", "93.0%", ""]], R.SPECS[("first_distribution", 2024)])
        self.assertEqual(cases[0]["pct_cashed_printed"], "93.0%")  # shown verbatim, trailing zero included
        self.assertEqual(cases[0]["pct_cashed"], 93.0)

    def test_places_links_only_for_jurisdictions_the_app_resolves(self):
        routable = C.routable_places()
        self.assertEqual(len(routable), 51)  # D3: 50 states and DC in src/lib/corpus/geo.ts
        self.assertNotIn("PR", routable)
        self.assertEqual(C.places_links("PR", "Puerto Rico", routable), [])
        self.assertEqual(C.places_links("DC", "District of Columbia", routable)[0]["url"], "/places/DC")
        self.assertEqual(C.places_links("ZZ", "Nowhere", routable), [])
        self.assertEqual(C.routable_places("/nonexistent/geo.ts"), C.routable_places("/nonexistent/other.ts"))  # falls back to the same 51

    def test_known_misreading_is_corrected_and_original_kept(self):
        tables = {"closed": {"cases": [{"case": "Genius"}, {"case": "Genuis Brands"}]}, "first_distribution": {"cases": [{"case": "Genius"}]}}
        made = R.apply_name_corrections(2022, tables)
        self.assertEqual(made, [("closed", "Genius", "Geniux")])  # D4: only the (2022, closed) row; same text elsewhere is untouched
        self.assertEqual(tables["closed"]["cases"][0], {"case": "Geniux", "name_corrected_from": "Genius"})
        self.assertEqual(tables["first_distribution"]["cases"][0], {"case": "Genius"})
        self.assertEqual(R.apply_name_corrections(2023, {"closed": {"cases": [{"case": "Genius"}]}}), [])

    def test_names_are_checked_against_the_official_pdf_text(self):
        flat = "casesclosedin2022geniuxcommerceplanet"
        tables = {"closed": {"cases": [{"case": "Geniux"}, {"case": "Commerce Planet"}, {"case": "Genius"}]}}
        self.assertEqual(R.names_missing_from_pdf(tables, flat), ["Genius"])
        self.assertIsNone(R.names_missing_from_pdf(tables, None))  # no pdftotext: reported as unchecked, never as passed

    def test_provenance_says_which_hash_is_which(self):
        capture = {"path": "private/acq/x/cap.json", "sha256": "a" * 64, "url": "https://www.ftc.gov/x.pdf", "retrieved_at": "2026-10-18T12:00:00Z"}
        pdf = {"path": "private/acq/x/x.pdf", "sha256": "b" * 64, "url": "https://www.ftc.gov/x.pdf", "bytes": 10, "retrieved_at": "2026-10-18T16:00:00Z"}
        prov = C.provenance(capture, pdf, chunk=3)
        self.assertEqual((prov["capture_sha256"], prov["official_pdf_sha256"], prov["chunk"]), ("a" * 64, "b" * 64, 3))
        self.assertNotIn("sha256", prov)
        src = C.source_record(capture, pdf, name="n")
        self.assertIn("not of the PDF", src["capture_note"])
        self.assertIn("official PDF bytes", src["official_pdf_note"])
        self.assertEqual(src["official_pdf_bytes"], 10)
        self.assertNotIn("official_pdf_sha256", C.source_record(capture))  # HTML pages have no PDF

    def test_capture_and_pdf_must_share_one_url(self):
        manifest = {"csn-annual-data-book-2024.pdf": {"url": "https://www.ftc.gov/other.pdf", "path": "p", "sha256": "c" * 64}}
        capture = {"path": "private/acq/ftc_sentinel/pages/csn_databook_2024_pdf.json", "url": "https://www.ftc.gov/x.pdf"}
        with self.assertRaises(ValueError):
            C.official_pdf(manifest, capture)
        self.assertIsNone(C.official_pdf(manifest, {"path": "private/acq/ftc_sentinel/pages/ftc_refund_programs_index.json", "url": "u"}))

    def test_published_method_wording_names_no_third_party_service(self):
        capture = {"path": "private/acq/x/cap.json", "sha256": "a" * 64, "url": "https://www.ftc.gov/x.pdf", "retrieved_at": "2026-10-18T12:00:00Z"}
        published = [B.PAGE_SERVICE_METHOD, B.INDEPENDENT_READ_METHOD, C.source_record(capture)["capture_note"]]
        for text in published:
            self.assertNotRegex(text, VENDOR_NAMES)
        self.assertIn("external page-fetching service", B.PAGE_SERVICE_METHOD)
        self.assertIn("Akamai bot wall", B.PAGE_SERVICE_METHOD)  # the reason the service was used stays stated
        self.assertTrue(all("_tavily_" not in n for names in B.DNC_INDEPENDENT_READS.values() for n in names))


# --------------------------------------------------------------------------------------------------------------------
class RefundTests(unittest.TestCase):
    def test_cell_types(self):
        self.assertEqual(R.convert("$4,155,776.68", "money")[0], 4155776.68)
        self.assertEqual(R.convert("$3,053", "int"), (3053, "printed with a dollar sign"))
        self.assertEqual(R.convert("84.3%", "pct")[0], 84.3)
        self.assertEqual(R.convert("Jan-22", "date")[0], {"published": "Jan-22", "iso": "2022-01"})
        self.assertEqual(R.convert("2/24/22", "date")[0]["iso"], "2022-02-24")
        self.assertEqual(R.convert("10/10/2024", "date")[0]["iso"], "2024-10-10")
        self.assertEqual(R.convert("AT&amp;T", "name")[0], "AT&T")
        self.assertEqual(R.convert("$12", "name"), (None, None))
        self.assertEqual(R.convert("twelve", "int"), (None, None))

    FIRST = R.SPECS[("first_distribution", 2024)]

    def test_rows_read_by_type_despite_blank_header_column(self):
        rows = [["Alpha", "10/10/2024", "$100.00", "10", "5", "50.0%", ""], ["Beta, Inc.", "01/09/2024", "$200.50", "20", "10", "50.0%", ""], ["Totals", "", "$300.50", "30", "15", "50.0%", ""]]
        cases, totals, problems = R.parse_case_table(rows, self.FIRST)
        self.assertEqual(problems, [])
        self.assertEqual([c["case"] for c in cases], ["Alpha", "Beta, Inc."])
        self.assertEqual(R.total_discrepancies(cases, totals, self.FIRST), [])

    def test_unreadable_row_is_reported_and_left_out(self):
        rows = [["Alpha", "10/10/2024", "$100.00", "ten", "5", "50.0%", ""], ["Beta", "01/09/2024", "$200.50", "20", "10", "50.0%", ""]]
        cases, _, problems = R.parse_case_table(rows, self.FIRST)
        self.assertEqual([c["case"] for c in cases], ["Beta"])
        self.assertEqual(len(problems), 1)

    def test_printed_total_that_does_not_match_is_shown_not_hidden(self):
        rows = [["Alpha", "10/10/2024", "$100.00", "10", "5", "50.0%"], ["Totals", "", "$100.00", "12", "5", "50.0%"]]
        cases, totals, _ = R.parse_case_table(rows, self.FIRST)
        diffs = R.total_discrepancies(cases, totals, self.FIRST)
        self.assertEqual(diffs, [{"column": "eligible_consumers", "rows_sum": 10, "printed_total": 12, "difference": -2}])
        self.assertIsNone(R.total_discrepancies(cases, None, self.FIRST))

    def test_row_identities(self):
        ok = {"case": "A", "total_fund_usd": 100.0, "returned_usd": 90.0, "admin_usd": 6.0, "left_over_usd": 4.0, "consumers_sent_payment": 10, "consumers_cashed": 5, "pct_cashed": 50.0}
        self.assertEqual(R.row_rule_problems("closed", ok), [])
        self.assertTrue(R.row_rule_problems("closed", {**ok, "left_over_usd": 40.0}))
        self.assertTrue(R.row_rule_problems("closed", {**ok, "consumers_cashed": 11}))
        self.assertTrue(R.row_rule_problems("closed", {**ok, "pct_cashed": 80.0}))
        edu = {**ok, "education_campaigns_usd": 10.0, "left_over_usd": 4.0, "returned_usd": 80.0}
        self.assertEqual(R.row_rule_problems("closed", edu), [])
        first = {"case": "A", "sent_usd": 5.0, "eligible_consumers": 100, "consumers_cashed": 50, "pct_cashed": 50.0}
        self.assertEqual(R.row_rule_problems("first_distribution", first), [])
        self.assertTrue(R.row_rule_problems("first_distribution", {**first, "pct_cashed": 90.0}))

    def test_state_mailed_and_total_check(self):
        rows = [[u, "$1,000"] for u in P.STATES if u != "DC"] + [["Military Bases", "$500"]]
        md = "## Mailed\n" + table(["State", "$$ Mailed in 2024"], rows[:26]) + "\n\n" + table(["State", "$$ Mailed in 2024"], rows[26:])
        states, extras, problems = R.parse_state_mailed("\n---\n".join(["", "", md]), 2024)
        self.assertEqual(len(states), 51)
        self.assertEqual(extras["military_bases_usd"], 500)
        self.assertEqual(problems, [])
        md2 = md + "\n| Electronic &amp; International Payments $5 Total Sent $9 | |"
        _, extras2, problems2 = R.parse_state_mailed("\n---\n".join(["", "", md2]), 2024)
        self.assertTrue(problems2)  # states + military + electronic != printed total

    def test_state_mailed_2022_layout_has_virgin_islands_and_split_total_row(self):
        base = [[u, "$1,000"] for u in P.STATES if u != "DC"]
        # 2022: a VI row, 'Military Bases', then a label row without amounts and, last, one row carrying both amounts
        rows = base + [["VI", "$10"], ["Military Bases", "$500"], ["Electronic &amp; International Payments Total Sent", ""], ["$20 $51,530", ""]]
        md = "## Mailed\n" + table(["State", "$$ Mailed in 2022"], rows)
        states, extras, problems = R.parse_state_mailed("\n---\n".join(["", "", md]), 2022)
        self.assertEqual(len(states), 51)
        self.assertNotIn("VI", states)  # a territory outside the 52 listed jurisdictions is kept as an extra, not a state row
        self.assertEqual((extras["virgin_islands_usd"], extras["military_bases_usd"], extras["electronic_and_international_usd"], extras["total_sent_usd"]), (10, 500, 20, 51530))
        self.assertEqual(extras["parts_sum_usd"], 51530)
        self.assertEqual(problems, [])
        wrong = md.replace("$20 $51,530", "$20 $51,531")
        _, extras2, problems2 = R.parse_state_mailed("\n---\n".join(["", "", wrong]), 2022)
        self.assertEqual(extras2["total_sent_usd"], 51531)
        self.assertTrue(any("printed total 51531" in p for p in problems2))  # a printed total that disagrees with its parts is reported, never forced to agree

    def test_state_mailed_2024_layout_international_electronic_and_total(self):
        base = [[u, "$1,000"] for u in P.STATES if u != "DC"]
        md = "## Mailed\n" + table(["State", "$$ Mailed in 2024"], base + [["Military Bases", "$500"]]) + "\n\n**International Payments**\n**Total Sent:**\n\n**$7**\n**Electronic Payments (no geographic data) $13\n$51,520**\n\n<sup>1</sup>note"
        states, extras, problems = R.parse_state_mailed("\n---\n".join(["", "", md]), 2024)
        self.assertEqual(len(states), 51)
        self.assertEqual((extras["international_usd"], extras["electronic_no_geography_usd"], extras["total_sent_usd"], extras["parts_sum_usd"]), (7, 13, 51520, 51520))
        self.assertEqual(problems, [])
        _, _, problems2 = R.parse_state_mailed("\n---\n".join(["", "", md.replace("$51,520", "$51,519")]), 2024)
        self.assertTrue(any("printed total 51519" in p for p in problems2))

    def test_snapshot_must_sum_to_100(self):
        md = table(["Category", "Returned to Consumers (%)", "Sent to U.S. Treasury (%)", "Administrative Costs (%)"], [["2024", "93", "3.8", "3.2"], ["2023", "88.1", "2.9", "9.1"], ["2022", "90", "2.6", "1.7"]])
        rows, problems = R.parse_snapshot("\n---\n".join(["", md]), 2024)
        self.assertEqual(sorted(rows), [2023, 2024])  # the row that sums to 94.3 is dropped ...
        self.assertTrue(any("2022 sums to" in p for p in problems))  # ... and reported, never kept or rounded
        rows, problems = R.parse_snapshot("\n---\n".join(["", md]), 2022)
        self.assertIn("2022 snapshot row missing", problems)

    def test_program_list_parsing(self):
        md = ("| Refund Program | Date | Contact Info |\n| --- | --- | --- |\n"
              "| [Walmart Refunds](https://www.ftc.gov/enforcement/refunds/walmart-refunds) | October 2026 | 1-833-472-1990<br>Rust Consulting, Inc. |\n"
              "| [Amazon Refunds](https://www.ftc.gov/enforcement/refunds/amazon-refunds) | September 2026 |  |\n"
              "| [NutraClick Refunds](https://www.ftc.gov/enforcement/refunds/nutraclick-refunds)<br>**Products:** Force Factor, Peak Life | March 2025 | 1-844-735-1139<br>Analytics Consulting, LLC |\n")
        progs, problems = R.parse_refund_programs(md)
        self.assertEqual(problems, [])
        self.assertEqual([p["title"] for p in progs], ["Walmart Refunds", "Amazon Refunds", "NutraClick Refunds"])
        self.assertEqual(progs[0]["administrator"], "Rust Consulting, Inc.")
        self.assertIsNone(progs[1]["phone"])
        self.assertEqual(progs[2]["products"], "Force Factor, Peak Life")

    def test_data_page_snapshot_graphic(self):
        alt = "Graphic shows that FTC lawsuits resulted in $337.3 million returned to consumers. The total includes x. It also shows that $280.7 of that total was returned directly by the FTC to 3.1 million people. The FTC sent $11.5 million to the U.S. Treasury and spent $9.8 million on administrative costs."
        self.assertEqual(R.parse_data_page_snapshot(alt)["returned_directly_by_ftc_usd_m"], 280.7)
        self.assertIsNone(R.parse_data_page_snapshot("nothing here"))


class MatchingTests(unittest.TestCase):
    def test_exact_unique_match_after_documented_normalisation(self):
        targets = {"0000104169": "Walmart Inc.", "0000001": "Acme Corp", "0000002": "ACME CORP.", "0000003": "Other Co"}
        names = {"a": "WALMART INC", "b": "Acme Corp", "c": "Walmart", "d": "Other Co", "e": "AT&amp;T"}
        matches, ambiguous, unmatched = C.unique_exact_matches(names, targets)
        self.assertEqual(matches, {"a": "0000104169", "d": "0000003"})
        self.assertEqual(ambiguous, {"b": ["0000001", "0000002"]})  # two profiles share the key: no link
        self.assertEqual(sorted(unmatched), ["c", "e"])  # 'Walmart' is not 'Walmart Inc.': no suffix stripping, no fuzzy match

    def test_program_titles_lose_one_trailing_word_on_the_program_side_only(self):
        self.assertEqual(R.program_match_key("Warrior Trading Refunds"), R.case_key("Warrior Trading"))
        self.assertEqual(R.program_match_key("University of Phoenix Settlement"), R.case_key("University of Phoenix"))
        self.assertNotEqual(R.program_match_key("Fortnite Refunds"), R.case_key("Fortnite (Epic Games)"))
        self.assertEqual(R.program_match_key("Refunds Refunds"), R.case_key("Refunds"))
        self.assertEqual(R.case_key("Teami, LLC"), "teamillc")


class AnalyticsTests(unittest.TestCase):
    def test_growth_formulas(self):
        self.assertEqual(C.yoy_pct(150, 100), 50.0)
        self.assertEqual(C.yoy_pct(50, 100), -50.0)
        self.assertIsNone(C.yoy_pct(5, 0))
        self.assertIsNone(C.yoy_pct(None, 5))
        self.assertEqual(C.cagr_pct(100, 400, 2), 100.0)
        self.assertIsNone(C.cagr_pct(0, 400, 2))
        self.assertIsNone(C.cagr_pct(100, 400, 0))

    def test_rank_change_and_shares(self):
        self.assertEqual(C.rank_change(14, 10), 4)  # moved up four places
        self.assertEqual(C.rank_change(10, 14), -4)
        self.assertIsNone(C.rank_change(None, 10))
        self.assertEqual(C.share_pct(1, 4), 25.0)
        self.assertIsNone(C.share_pct(1, 0))
        self.assertEqual(C.ratio(10, 4), 2.5)

    def test_missing_values_display_as_not_recorded(self):
        self.assertEqual(C.fmt_int(None), "Not recorded")
        self.assertEqual(C.fmt_usd(None), "Not recorded")
        self.assertEqual(C.fmt_pct(None), "Not recorded")
        self.assertEqual(C.fmt_signed_pct(None), "Not recorded")
        self.assertEqual(C.fmt_rank(None), "Not recorded")
        self.assertEqual(C.fmt_usd(1234.5), "$1,234.50")
        self.assertEqual(C.fmt_usd(1234), "$1,234")
        self.assertEqual(C.fmt_signed_pct(5.0), "+5.0%")


class StateRecordTests(unittest.TestCase):
    """build_states on synthetic editions: Not recorded paths, rank changes and unranked jurisdictions."""

    def edition(self, year, shift=0, drop_fraud_for=None):
        states = {}
        ranked = P.RANKED_STATES
        for i, usps in enumerate(P.STATES):
            rank = ranked.index(usps) + 1 if usps in ranked else None
            fraud = None if usps == drop_fraud_for else {"reports": 100 + i, "pct_reporting_loss": 40.0, "total_loss_usd": 1000 * (i + 1) * (1 + shift), "median_loss_usd": 400}
            states[usps] = {"usps": usps, "year": year, "fraud_other": {"rank": (rank + shift) if rank and rank + shift <= 50 else rank, "per100k": 2000 - i, "reports": 1000 + i}, "identity_theft": {"rank": rank, "per100k": 300 - i, "reports": 200 + i}, "fraud": fraud, "top_categories": None if usps == "AK" else [{"category": "Identity Theft", "share_pct": 20}], "id_theft_types": [], "page_chunk": 30, "page_identified_by": "footnote", "checks": {}, "withheld": ["no state page found"] if usps == "AK" else []}
        return {"entry": {"url": f"https://example.test/{year}.pdf", "path": f"x/{year}.json", "sha256": "0" * 64, "retrieved_at": "2026-10-18T00:00:00Z"}, "pdf": {"path": f"x/{year}.pdf", "sha256": "1" * 64, "bytes": 1, "retrieved_at": "2026-10-18T00:00:00Z"}, "states": states, "book": {"year": year, "chunks": {"fraud_other_ranking": 1, "identity_theft_ranking": 2, "appendix_c": 3}, "population_basis_year": str(year - 1), "state_sums": {"total_loss_usd": sum(s["fraud"]["total_loss_usd"] for s in states.values() if s["fraud"])}}}

    def test_analytics_and_not_recorded_paths(self):
        books = {2023: self.edition(2023, shift=0), 2024: self.edition(2024, shift=1, drop_fraud_for="MT")}
        rows, summary = B.build_states(books, {"counts": {}})
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(len(rows), 104)
        al = by_id["AL-2024"]
        self.assertEqual(al["item"]["analytics"]["fraud_other_rank_change"], -1)  # rank 1 -> 2: moved down one place
        self.assertEqual(al["item"]["analytics"]["total_loss_yoy_pct"], 100.0)
        self.assertIn("/places/AL", [link["url"] for link in al["item"]["links"]])
        mt = by_id["MT-2024"]
        self.assertEqual(mt["item"]["cells"]["total_loss"], "Not recorded")
        self.assertIsNone(mt["item"]["analytics"]["total_loss_yoy_pct"])
        self.assertIsNone(mt["item"]["analytics"]["loss_share_of_state_sum_pct"])
        dc = by_id["DC-2024"]
        self.assertEqual(dc["item"]["cells"]["fraud_other_rank"], "Unranked")
        self.assertIsNone(dc["item"]["analytics"]["fraud_other_rank_change"])
        ak = by_id["AK-2024"]
        facts = dict(map(tuple, ak["detail"]["facts"]))
        self.assertEqual(facts["Top ten report categories (share of the state's reports)"], "Not recorded")
        self.assertIn("no state page found", facts["Not recorded because"])
        first = by_id["AL-2023"]
        self.assertIsNone(first["item"]["analytics"]["total_loss_yoy_pct"])  # no earlier edition loaded: nothing invented
        for r in rows:
            self.assertTrue(r["source_url"].startswith("https://"))
            self.assertEqual(r["category"], "ftc_sentinel_states")
        self.assertIn("2017", summary["formulas"]["cagr_pct"])


# --------------------------------------------------------------------------------------------------------------------
BUILD_DIR = os.path.join(C.BUILD)


@unittest.skipUnless(os.path.exists(os.path.join(BUILD_DIR, "ftc_sentinel_states.json")), "build files not generated yet")
class BuildFileTests(unittest.TestCase):
    """Invariants of the generated build files (run after build_ftc_sentinel.py)."""

    @classmethod
    def setUpClass(cls):
        cls.builds = {}
        for name in ("ftc_sentinel_states", "ftc_sentinel_national", "ftc_refunds", "ftc_refund_programs", "ftc_dnc_states"):
            with open(os.path.join(BUILD_DIR, f"{name}.json"), encoding="utf-8") as handle:
                cls.builds[name] = json.load(handle)

    def test_shape_and_unique_ids(self):
        for name, b in self.builds.items():
            ids = [r["id"] for r in b["rows"]]
            self.assertEqual(len(ids), len(set(ids)), name)
            self.assertEqual(b["dataset"], name)
            for r in b["rows"]:
                self.assertEqual((r["dataset"], r["category"]), (name, name))
                self.assertNotIn("ordinal", r)
                self.assertTrue(r["source_url"].startswith("https://"))
                self.assertTrue(r["title"].strip())
                for label, value in r["detail"]["facts"]:
                    self.assertIsInstance(value, str)
            self.assertTrue(b["inputs"] and all(set(i) == {"url", "path", "sha256"} for i in b["inputs"]))

    def test_expected_counts(self):
        self.assertEqual(len(self.builds["ftc_sentinel_states"]["rows"]), 52 * 8)
        self.assertEqual(len(self.builds["ftc_sentinel_national"]["rows"]), 9)
        self.assertEqual(len(self.builds["ftc_dnc_states"]["rows"]), 52 * 5)

    def test_refund_state_table_totals_are_recorded_for_every_year_and_differences_are_shown(self):
        rows = {r["id"]: r for r in self.builds["ftc_refunds"]["rows"]}
        v22, v23, v24 = (rows[f"{y}-summary"]["item"]["values"] for y in (2022, 2023, 2024))
        # 2022: a Virgin Islands row exists only in that year's table; with it the printed total equals its parts exactly
        self.assertEqual((v22["virgin_islands_usd"], v22["total_sent_usd"], v22["parts_sum_usd"]), (1833, 439091946, 439091946))
        self.assertEqual((v23["total_sent_usd"], v23["parts_sum_usd"]), (168380271, 168380264))
        self.assertEqual((v24["total_sent_usd"], v24["parts_sum_usd"], v24["international_usd"], v24["electronic_no_geography_usd"]), (325179539, 325179542, 1967782, 48411598))
        facts = {y: dict(rows[f"{y}-summary"]["detail"]["facts"]) for y in (2022, 2023, 2024)}
        self.assertEqual(facts[2022]["Printed total against the listed parts"], "equal")
        self.assertIn("printed total higher", facts[2023]["Printed total against the listed parts"])
        self.assertIn("printed total lower", facts[2024]["Printed total against the listed parts"])
        self.assertFalse(any(r["id"].endswith("-state-VI") for r in rows.values()))  # outside the 52 listed jurisdictions: an extra, not a state row

    def test_places_links_are_real_state_codes(self):
        for name, b in self.builds.items():
            for r in b["rows"]:
                for link in r["item"]["links"]:
                    if link["url"].startswith("/places/"):
                        self.assertIn(link["url"].split("/")[2], P.STATES)
                    if link["url"].startswith("/companies/"):
                        self.assertRegex(link["url"], r"^/companies/\d{10}$")

    def test_ranked_states_have_ranks_and_dc_pr_do_not(self):
        rows = {r["id"]: r for r in self.builds["ftc_sentinel_states"]["rows"]}
        for year in range(2017, 2025):
            self.assertIsNone(rows[f"DC-{year}"]["item"]["metrics"]["fraud_other_rank"])
            self.assertIsNone(rows[f"PR-{year}"]["item"]["metrics"]["identity_theft_rank"])
            ranks = sorted(r["item"]["metrics"]["fraud_other_rank"] for r in rows.values() if r["id"].endswith(str(year)) and r["item"]["metrics"]["fraud_other_rank"])
            self.assertEqual(ranks, list(range(1, 51)))

    def test_no_state_total_exceeds_the_national_total(self):
        rows = self.builds["ftc_sentinel_states"]["rows"]
        nat = {r["id"]: r for r in self.builds["ftc_sentinel_national"]["rows"]}
        for year in range(2017, 2025):
            state_sum = sum(r["item"]["metrics"]["total_loss_usd"] or 0 for r in rows if r["id"].endswith(f"-{year}"))
            self.assertLess(state_sum, nat[f"US-{year}"]["item"]["fraud_summary"]["total_loss_usd"])

    def test_puerto_rico_rows_exist_without_a_places_link(self):  # D3
        for name, b in self.builds.items():
            self.assertNotIn("/places/PR", json.dumps(b["rows"]), name)
        states = {r["id"]: r for r in self.builds["ftc_sentinel_states"]["rows"]}
        self.assertEqual(states["PR-2024"]["state"], "PR")
        self.assertIsNotNone(states["PR-2024"]["item"]["metrics"]["fraud_other_reports"])
        self.assertTrue(any(link["url"] == "/places/DC" for link in states["DC-2024"]["item"]["links"]))
        refunds = {r["id"] for r in self.builds["ftc_refunds"]["rows"]}
        self.assertTrue({"2022-state-PR", "2023-state-PR", "2024-state-PR"} <= refunds)

    def test_dnc_tables_are_complete_apart_from_the_unranked_dc_and_pr(self):  # D5
        for r in self.builds["ftc_dnc_states"]["rows"]:
            m = r["item"]["metrics"]
            unranked = r["state"] in ("DC", "PR")
            for key in ("complaints", "complaints_per100k", "registrations", "registrations_per100k"):
                self.assertIsNotNone(m[key], (r["id"], key))
            for key in ("complaints_rank", "registrations_rank"):
                self.assertEqual(m[key] is None, unranked, (r["id"], key))
        by_id = {r["id"]: r["item"]["metrics"] for r in self.builds["ftc_dnc_states"]["rows"]}
        self.assertEqual(by_id["DE-FY2022"]["complaints_per100k"], 1537)  # was damaged to 537 in the text extraction
        self.assertEqual(by_id["TX-FY2023"]["registrations_rank"], 48)
        cov = self.builds["ftc_dnc_states"]["summary"]["coverage"]
        self.assertTrue(all(c["complaints_per100k"] == 52 and c["registrations_per100k"] == 52 for c in cov.values()))

    def test_case_name_follows_the_official_pdf(self):  # D4
        ids = {r["id"]: r for r in self.builds["ftc_refunds"]["rows"]}
        self.assertIn("2022-closed-geniux", ids)
        self.assertNotIn("2022-closed-genius", ids)
        self.assertEqual(ids["2022-closed-geniux"]["title"], "Geniux")

    def test_percentages_are_displayed_as_printed(self):  # D2
        ids = {r["id"]: r for r in self.builds["ftc_refunds"]["rows"]}
        self.assertEqual(ids["2023-first_distribution-arete-financial"]["item"]["cells"]["pct_cashed"], "66.55%")
        self.assertEqual(ids["2024-first_distribution-lca-vision-lasikplus"]["item"]["cells"]["pct_cashed"], "93.0%")
        self.assertEqual(ids["2022-closed-click-4-support"]["item"]["cells"]["pct_cashed"], "39%")
        for r in ids.values():
            cell = r["item"]["cells"].get("pct_cashed")
            value = (r["item"].get("values") or {}).get("pct_cashed")
            if cell not in (None, "Not recorded") and value is not None:
                self.assertAlmostEqual(float(cell.rstrip("%")), value, places=6)

    def test_every_hash_is_labelled_and_matches_its_file(self):
        import hashlib
        for name, b in self.builds.items():
            for ref in b["inputs"]:
                h = hashlib.sha256()
                with open(os.path.join(C.ROOT, ref["path"]), "rb") as handle:
                    for chunk in iter(lambda: handle.read(1 << 20), b""):
                        h.update(chunk)
                self.assertEqual(h.hexdigest(), ref["sha256"], (name, ref["path"]))
            paths = {ref["path"]: ref["sha256"] for ref in b["inputs"]}
            for r in b["rows"]:
                prov = r["item"].get("provenance") or {}
                self.assertNotIn("sha256", prov)
                if prov.get("capture"):
                    self.assertEqual(paths[prov["capture"]], prov["capture_sha256"])
                if prov.get("official_pdf"):
                    self.assertEqual(paths[prov["official_pdf"]], prov["official_pdf_sha256"])
            for key, src in (b["summary"].get("sources") or {}).items():
                self.assertIn("capture_sha256", src)
                self.assertNotIn("sha256", src)
        for r in self.builds["ftc_sentinel_states"]["rows"]:
            self.assertIn("official_pdf_sha256", r["item"]["provenance"])

    def test_refund_rows_keep_published_names_and_link_only_exact_matches(self):
        rows = self.builds["ftc_refunds"]["rows"]
        cases = [r for r in rows if r["filters"]["kind"] == ["case"]]
        self.assertTrue(cases)
        for r in cases:
            linked = [link["url"] for link in r["item"]["links"] if link["url"].startswith("https://www.ftc.gov/enforcement/refunds/")]
            if linked:
                prog = linked[0].rsplit("/", 1)[-1]
                self.assertTrue(any(R.program_match_key(p["title"]) == R.case_key(r["title"]) for p in self.builds["ftc_refund_programs"]["rows"] if p["id"] == prog))
        self.assertFalse([r for r in rows if "&amp;" in r["title"]])

    def test_published_rows_and_summaries_name_no_third_party_service(self):
        import re
        for name, b in self.builds.items():
            self.assertNotRegex(json.dumps({"summary": b["summary"], "listing": b["listing_block"], "label": b["label"]}), VENDOR_NAMES, name)
            hits = [r["id"] for r in b["rows"] if re.search(VENDOR_NAMES, json.dumps(r))]
            self.assertEqual(hits, [], name)


if __name__ == "__main__":
    unittest.main()
