"""Offline tests for settle_types (amount roles, MDL docket links, deadline states). Sentences are copied from
settlement_claims_official rows as published (official settlement pages), so the rules are tested on real wording.

  cd scripts/enrichment/enforcement_actions && python3 -B -m unittest -v test_settle_types
"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settle_types as st  # noqa: E402

ACU = ("Residual distribution payments of up to $350 for Recalled Vehicles and $150 for Unrecalled Vehicles for Class "
       "Members who submitted out-of-pocket claims or filed a claim for a residual payment, including those who own or "
       "lease Unrecalled Vehicles;")

# (sentence, figure as written, value, expected role, expected detail or None)
CASES = [
    (ACU, "$350", 350, "per_claimant", None),
    (ACU, "$150", 150, "per_claimant", None),
    ("The Court has entered final approval of a $359,925,000 Settlement Fund, consisting of settlements.", "$359,925,000", 359925000, "fund_total", None),
    ("Plaintiffs and John Deere have reached a proposed settlement (the “Settlement”) consisting of $99 million in cash , plus interest accruing since January 15, 2026.", "$99 million", 99e6, "fund_total", None),
    ("At the time of this Notice, the total value of the Settlement is estimated by Plaintiffs’ expert to be between $392.9 million and $747 million (including injunctive relief).", "$392.9 million", 392.9e6, "other", "estimate"),
    ("In lieu of making a claim for Out-Of-Pocket Losses and Attested Time, Class Members may make a claim for an alternative cash payment of $75.00 .", "$75.00", 75, "per_claimant", None),
    ("For the Certified Group, the payment is expected to be approximately $300.", "$300", 300, "per_claimant", None),
    ("The proposed Settlement requires Defendant to pay $4.7 million into a Settlement Fund.", "$4.7 million", 4.7e6, "fund_total", None),
    ("Settlement Class Counsel will also request Service Awards for each of the Settlement Class Representatives not to exceed $2,500 each (or $5,000 total) in recognition of their work.", "$5,000", 5000, "other", "service_award"),
    ("The Settlement provides for the creation of a $6,100,000 Settlement Fund to pay for: (1) Notice and Administrative Expenses, (2) a Fee and Expense Award.", "$6,100,000", 6.1e6, "fund_total", None),
    ("A $950,000.00 (“Settlement Fund”) settlement has been reached in a class action lawsuit against Peco Foods Inc.", "$950,000.00", 950000, "fund_total", None),
    ("For those Settlement Class Members who select the cash payment option, if approved by the Court, Defendant will make available up to $350,000.00 under the Settlement to pay cash claims.", "$350,000.00", 350000, "cap", None),
    ("from a $4,200,000 class action settlement .", "$4,200,000", 4.2e6, "fund_total", None),
    ("The Proposed Class Action Settlement includes a maximum payment by Defendant of $382,500.00 (“Maximum Settlement Fund”), depending on how many Class Members submit a claim.", "$382,500.00", 382500, "fund_total", None),
    ("After estimated deductions, the average net recovery is approximately $1.49 per share.", "$1.49", 1.49, "per_claimant", None),
    ("Notice and administration expenses: Up to $500,000", "$500,000", 500000, "other", "fees_costs"),
    ("Service awards to plaintiffs: Up to $230,000 total", "$230,000", 230000, "other", "service_award"),
    ("Teva will pay $35 million into a Settlement Fund for:", "$35 million", 35e6, "fund_total", None),
    ("• Unreimbursed litigation costs and expenses of up to $890,000;", "$890,000", 890000, "other", "fees_costs"),
    ("• Service awards of $25,000 to each of the four class representatives.", "$25,000", 25000, "other", "service_award"),
    ("Statement of Class Recovery : Subject to Court approval, Lead Plaintiff, on behalf of the Class, has agreed to settle the Action in exchange for a payment of $17,750,000 in cash.", "$17,750,000", 17.75e6, "fund_total", None),
    ("Settlement Benefits are subject to an aggregate cap of $300,000 for all Approved Claims combined.", "$300,000", 300000, "cap", None),
    ("The FTC is sending 7,481 payments totaling more than $409,000 to people who bought products from Roca Labs.", "$409,000", 409000, "other", "distribution"),
    ("FTC Sends More Than $449,000 to Consumers Harmed by ‘Extended Vehicle Warranty’ Scam", "$449,000", 449000, "other", "distribution"),
    ("They jointly paid disgorgement of $109,220,000 , prejudgment interest of $6,620,000 and a civil money penalty of $109,220,000 ; however, these amounts", "$6,620,000", 6.62e6, "other", "penalty"),
    ("Class Members will receive direct equal payments from Settlement Fund of up to $25.", "$25", 25, "per_claimant", None),
    ("Settlement Class Members who submit valid claims can receive a $6.00 cash payment per eligible Product, with a limit of up to 2 eligible Products per household (for a total of $12).", "$12", 12, "per_claimant", None),
    ("people who accepted their first payment and paid Student Debt Doctor more than $155.", "$155", 155, "other", "threshold"),
    ("Herbalife will pay $12,500,000 into a Settlement Fund.", "$12,500,000", 12.5e6, "fund_total", None),
    ("A consent order required Fay Servicing to pay $3 million in consumer redress and a $2 million civil money penalty.", "$3 million", 3e6, "fund_total", None),
    ("The settlement provides for $3,200 payments for each of the 34 class members.", "$3,200", 3200, "per_claimant", None),
    ("For adults with three years of residency during the Class Period, $6,000;", "$6,000", 6000, "per_claimant", None),
    ("Persons included in the Settlement will be eligible to submit a Claim Form to receive a payment of up to $107.00 .", "$107.00", 107, "per_claimant", None),
    ("Teva has agreed to a $3 million Settlement and Granules and Heritage have agreed to a $2.55 million Settlement to resolve the claims.", "$2.55 million", 2.55e6, "fund_total", None),
    ("represents a total aggregate gross recovery of three million dollars ($3,000,000.00) cash plus an additional amount", "$3,000,000.00", 3e6, "fund_total", None),
    ("To resolve the lawsuit, Defendants have agreed to pay Two Million Four Hundred Thousand Dollars ($2,400,000) for the", "$2,400,000", 2.4e6, "fund_total", None),
    ("The Respondents were also ordered to pay $12,500,000.00 in civil money penalties to the U.S. Treasury.", "$12,500,000.00", 12.5e6, "other", "penalty"),
    ("payment from the settlement fund or attorneys’ fees in the aggregate of $30,000 for service awards to the named plaintiffs", "$30,000", 30000, "other", "service_award"),
    ("Every class member will receive at least a $20.00 check.", "$20.00", 20, "per_claimant", None),
    ("estimated average recovery per share of PSG common stock will be approximately $0.34 before deduction from the Settlement Fund of Court-approved fees", "$0.34", 0.34, "per_claimant", None),
    ("Springfield has agreed to pay up to a maximum of $825,000.00 (the “Settlement Amount”) to cover payments to approximately 147 class members", "$825,000.00", 825000, "fund_total", None),
    ("Blog: $505 million in refunds sent to payday loan customers", "$505 million", 505e6, "other", "distribution"),
    ("Here, consumers’ compensable harm is equal to the $ 53,885,244.", "$ 53,885,244", 53885244, "other", "estimate"),
    # a fund amount with "gross" before its defined-term parenthetical is the fund, not one claimant's payment
    ("If approved by the Court, the Settlement will provide for the payment of $2,750,000 gross (the “Settlement Amount”), plus interest as it accrues, minus attorneys’ fees, expenses, compensatory awards to Co-Lead Plaintiffs, Notice and Administration Expenses, and Taxes on interest, to persons and",
     "$2,750,000", 2.75e6, "fund_total", None),
    # money added to the class's distribution pool is part of a fund, never a per-claimant amount
    ("Theranos, and the Theranos ABC has agreed to allocate a portion of the limited remaining Theranos assets to the Class, which will add approximately $1.33 million to the money available for distribution to the Class and increase the settlement payment amounts for Class Members.",
     "$1.33 million", 1.33e6, "other", "fund_addition"),
    # explicit per-unit wording still makes a large figure per claimant (constructed sentence, not from a page)
    ("Each of the two estates will receive $150,000 each under the settlement.", "$150,000", 150000, "per_claimant", None),
]


class AmountRoleTests(unittest.TestCase):
    def test_published_sentences(self):
        for sentence, written, value, role, detail in CASES:
            with self.subTest(figure=written, sentence=sentence[:60]):
                got = st.classify_amount(sentence, written, value)
                self.assertEqual(got["role"], role, got)
                if detail:
                    self.assertEqual(got["detail"], detail, got)
                if got["role_basis"] is not None:
                    self.assertIn(got["role_basis"].lower(), sentence.lower())

    def test_per_claimant_amount_is_never_the_headline(self):
        typed = st.type_amounts([
            {"page_as_written": "$350", "value_usd": 350, "sentence": ACU},
            {"page_as_written": "$150", "value_usd": 150, "sentence": ACU},
        ])
        self.assertIsNone(st.headline(typed))
        self.assertEqual(st.first_of(typed, "per_claimant")["page_as_written"], "$350")

    def test_headline_is_the_largest_fund_total(self):
        typed = st.type_amounts([
            {"page_as_written": "$403,730.00", "value_usd": 403730, "sentence": "(i) alleged unpaid overtime and liquidated damages totaling a maximum of $403,730.00 of the Maximum"},
            {"page_as_written": "$750,000.00", "value_usd": 750000, "sentence": "The total maximum amount to be paid by Defendant to settle the lawsuit is $750,000.00 and shall consist of the following"},
            {"page_as_written": "$265,000.00", "value_usd": 265000, "sentence": "(iii) attorneys' fees and litigation costs in the maximum amount of $265,000.00 payable to counsel"},
        ])
        self.assertEqual(st.headline(typed)["value_usd"], 750000)
        self.assertEqual(typed[2]["role"], "other")

    def test_a_large_figure_needs_per_unit_wording_to_be_per_claimant(self):
        got = st.classify_amount("Class Members may receive a payment of $2,000,000.", "$2,000,000", 2e6)
        self.assertNotEqual(got["role"], "per_claimant")
        self.assertEqual(st.classify_amount("Class Members may receive a payment of $2,000.", "$2,000", 2000)["role"], "per_claimant")

    def test_agency_order_total_with_a_penalty_is_not_the_fund(self):
        redress = "The Bureau’s order requires Honda Finance to come into compliance with the law, pay $10.3 million in consumer redress, and pay a $2.5 million civil money penalty to the Bureau."
        typed = st.type_amounts([
            {"page_as_written": "$10.3 million", "value_usd": 10.3e6, "sentence": redress},
            {"page_as_written": "$2.5 million", "value_usd": 2.5e6, "sentence": redress},
            {"page_as_written": "$12.8 Million", "value_usd": 12.8e6, "sentence": "CFPB Orders Honda’s Auto Financing Arm to Pay $12.8 Million for COVID-19 and Other Credit Reporting Failures"},
        ])
        self.assertEqual([(a["role"], a["detail"]) for a in typed],
                         [("fund_total", None), ("other", "penalty"), ("other", "order_total")])
        self.assertEqual(st.headline(typed)["page_as_written"], "$10.3 million")
        self.assertNotIn("bare_pay", typed[2])
        # without a penalty on the row, "to pay $X" stays the fund total
        alone = st.type_amounts([{"page_as_written": "$4.7 million", "value_usd": 4.7e6, "sentence": "Acme agreed to pay $4.7 million to resolve the claims."}])
        self.assertEqual(alone[0]["role"], "fund_total")
        # redress wording next to "to pay" is a named fund, kept even with a penalty on the row
        td = "The order requires TD Bank to take steps to prevent future violations and to pay $7.76 million in redress to affected consumers and a $20 million civil money penalty."
        typed = st.type_amounts([{"page_as_written": "$7.76 million", "value_usd": 7.76e6, "sentence": td},
                                 {"page_as_written": "$20 million", "value_usd": 20e6, "sentence": td}])
        self.assertEqual([a["role"] for a in typed], ["fund_total", "other"])

    def test_a_small_figure_is_never_a_fund(self):
        got = st.classify_amount("Fees totaling $79.85 were not paid.", "$79.85", 79.85)
        self.assertNotEqual(got["role"], "fund_total")

    def test_missing_figure_is_unclear(self):
        self.assertEqual(st.classify_amount("No dollar figure here.", "$5", 5)["detail"], "unclear")
        self.assertEqual(st.classify_amount(None, "$5", 5)["role"], "other")


class MdlLinkTests(unittest.TestCase):
    def test_exact_mdl_docket_forms(self):
        self.assertEqual(st.mdl_from_case_number("2:19-ml-02905-JAK-JPR"), 2905)
        self.assertEqual(st.mdl_from_case_number("3:23-md-03071"), 3071)
        self.assertEqual(st.mdl_from_case_number("1:23-md-03083-ADB-PGL"), 3083)
        self.assertEqual(st.mdl_from_case_number("2:18-mn-2873-RMG"), 2873)

    def test_other_case_numbers_never_link(self):
        for text in ("1:23-cv-03083", "MDL No. 2905", "No. 2905", "2:19-cv-02905-ml", "", None, "3:23-md-"):
            self.assertIsNone(st.mdl_from_case_number(text), text)

    REG = st.registry_index([{"mdl_number": 2905, "master_docket": "2:19-ml-2905", "cl_court_id": "cacd"},
                             {"mdl_number": 2406, "master_docket": "2:25-md-10000", "cl_court_id": "alnd"}])

    def test_links_dedupe_by_mdl(self):
        links = st.mdl_links([{"as_written": "2:19-ml-02905-JAK-JPR"}, {"as_written": "2:19-ml-02905"}, {"as_written": "8:20-cv-01234"}], self.REG)
        self.assertEqual([l["mdl"] for l in links], [2905])

    def test_link_only_when_the_case_number_is_the_registry_master_docket(self):
        self.assertEqual(st.verified_mdl("2:19-ml-02905-JAK-JPR", self.REG), 2905)
        self.assertEqual(st.verified_mdl("2:19-ml-02905", self.REG, ["cacd"]), 2905)
        self.assertIsNone(st.verified_mdl("2:19-ml-02905", self.REG, ["mad"]))       # page names another court
        self.assertIsNone(st.verified_mdl("8:19-ml-02905", self.REG))                # another office's docket
        self.assertIsNone(st.verified_mdl("2:20-ml-02905", self.REG))                # another year's docket
        self.assertIsNone(st.verified_mdl("2:19-md-02905", self.REG))                # md, not ml
        self.assertIsNone(st.verified_mdl("1:24-md-03999", self.REG))                # not in the registry
        self.assertIsNone(st.verified_mdl("2:25-md-10000", self.REG))                # docket number is not the MDL number
        self.assertEqual(st.mdl_links([{"as_written": "2:19-ml-02905"}], {}), [])


class DeadlineTests(unittest.TestCase):
    def test_states_against_the_as_of_date(self):
        ref = date(2026, 10, 27)
        self.assertEqual(st.deadline_state("2026-06-04", ref), "past")
        self.assertEqual(st.deadline_state("2026-10-26", ref), "past")
        self.assertEqual(st.deadline_state("2026-10-27", ref), "within_30_days")
        self.assertEqual(st.deadline_state("2026-11-26", ref), "within_30_days")
        self.assertEqual(st.deadline_state("2027-04-08", "2026-10-27"), "upcoming")
        self.assertEqual(st.deadline_state(None, ref), "none")
        self.assertEqual(st.deadline_state("not a date", ref), "none")


if __name__ == "__main__":
    unittest.main()
