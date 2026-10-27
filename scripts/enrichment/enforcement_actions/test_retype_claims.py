"""Offline tests for retype_claims (published settlement_claims_official rows -> typed rows). No network.

  cd scripts/enrichment/enforcement_actions && python3 -B -m unittest -v test_retype_claims
"""
import copy
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retype_claims as rt  # noqa: E402

ACU = ("Residual distribution payments of up to $350 for Recalled Vehicles and $150 for Unrecalled Vehicles for Class "
       "Members who submitted out-of-pocket claims or filed a claim for a residual payment, including those who own or "
       "lease Unrecalled Vehicles;")


def row(rid, title, *, amounts, deadline, cases, cell_amount):
    """A row shaped like the published settlement_claims_official records."""
    links = [{"url": "https://example.org/settlement", "label": "Official settlement page (example.org)"}]
    return {
        "dataset": "settlement_claims_official", "id": rid, "category": "settlement_claims_official", "state": "",
        "title": title, "source_url": "https://example.org/settlement", "ordinal": 7,
        "item": {"id": rid, "title": title, "subtitle": "", "badges": [], "links": list(links),
                 "cells": {"settlement": title, "deadline": deadline or "Not confirmed on the official page", "amount": cell_amount,
                           "court": "Not recorded", "case_number": cases[0] if cases else "Not recorded",
                           "official_page": "example.org", "verified": "deadline, amount, case number"},
                 "settlement": {"name": title, "amounts": amounts,
                                "deadline": {"date": deadline, "status": "confirmed" if deadline else "not_found"},
                                "case_numbers": [{"as_written": c, "status": "stated_on_page"} for c in cases]}},
        "detail": {"id": rid, "title": title, "subtitle": "", "links": list(links),
                   "facts": [["Settlement (name confirmed on the official page)", title], ["Claim deadline", deadline or "Not published"],
                             ["Dollar figures confirmed on the page", "old text"], ["Official page", "https://example.org/settlement"]]},
        "text": title,
        "filters": {"_listing": ["yes"], "court": [], "verified": ["deadline", "amount"], "has_amount": ["yes"], "deadline_state": ["future"]},
    }


ACU_ROW = row("settle:hyundai-and-kia-airbag-control-unit-settlement", "Hyundai and Kia Airbag Control Unit Settlement",
              amounts=[{"status": "confirmed", "sentence": ACU, "value_usd": 350, "page_as_written": "$350"},
                       {"status": "confirmed", "sentence": ACU, "value_usd": 150, "page_as_written": "$150"}],
              deadline="2027-04-08", cases=["2:19-ml-02905-JAK-JPR"], cell_amount="$350")
MOVEIT_ROW = row("settle:cadence-bank-moveit-data-breach-settlement", "Cadence Bank MOVEit Data Breach Settlement",
                 amounts=[{"status": "confirmed (same value)", "value_usd": 100, "page_as_written": "$100.00",
                           "sentence": "to reimbursement of ordinary losses up to $2,500.00; reimbursement of extraordinary losses up to $10,000.00; or an alternative cash payment of up to $100.00 (subject to pro rata reduction or increase pending total claim submission)."}],
                 deadline="2026-06-04", cases=["1:23-md-03083-ADB-PGL"], cell_amount="$100.00")
FUND_ROW = row("settle:realpage-rental-software-antitrust-settlement", "RealPage Rental Software Antitrust Settlement",
               amounts=[{"status": "confirmed", "value_usd": 359925000, "page_as_written": "$359,925,000",
                         "sentence": "The Court has entered final approval of a $359,925,000 Settlement Fund, consisting of settlements."}],
               deadline="2027-01-29", cases=["3:23-md-03071"], cell_amount="$359,925,000")
NO_FACTS_ROW = row("settle:example-no-deadline", "Example Settlement", amounts=[], deadline=None, cases=["8:20-cv-01234"], cell_amount="Not confirmed on the official page")
AS_OF = date(2026, 10, 27)


class RetypeRowTests(unittest.TestCase):
    def test_per_claimant_amount_is_not_the_settlement_amount(self):
        out = rt.retype_row(ACU_ROW, AS_OF)
        cells = out["item"]["cells"]
        self.assertEqual(cells["fund_total"], "Not recorded")
        self.assertEqual(cells["amount"], "Not recorded")
        self.assertEqual(cells["per_claimant"], "$350")
        self.assertEqual([a["role"] for a in out["item"]["settlement"]["amounts"]], ["per_claimant", "per_claimant"])
        self.assertIsNone(out["item"]["settlement"]["fund_total"])

    def test_exact_mdl_docket_link(self):
        out = rt.retype_row(ACU_ROW, AS_OF)
        self.assertEqual(out["item"]["cells"]["mdl"], "MDL 2905")
        self.assertEqual(out["filters"]["mdl"], ["2905"])
        self.assertIn("/matters/lens/2905", [l["url"] for l in out["item"]["links"]])
        none = rt.retype_row(NO_FACTS_ROW, AS_OF)
        self.assertEqual(none["item"]["cells"]["mdl"], "Not recorded")
        self.assertEqual(none["filters"]["mdl"], [])

    def test_deadline_states_and_gaps(self):
        self.assertEqual(rt.retype_row(MOVEIT_ROW, AS_OF)["filters"]["deadline_state"], ["past"])
        self.assertEqual(rt.retype_row(ACU_ROW, AS_OF)["filters"]["deadline_state"], ["upcoming"])
        none = rt.retype_row(NO_FACTS_ROW, AS_OF)
        self.assertEqual(none["item"]["cells"]["deadline"], "Not recorded")
        self.assertEqual(none["filters"]["deadline_state"], ["none"])
        self.assertEqual(none["filters"]["amount_role"], ["none"])

    def test_fund_total_headline_and_facts(self):
        out = rt.retype_row(FUND_ROW, AS_OF)
        self.assertEqual(out["item"]["cells"]["fund_total"], "$359,925,000")
        facts = dict((k, v) for k, v in out["detail"]["facts"])
        self.assertTrue(facts["Settlement fund total"].startswith("$359,925,000"))
        self.assertIn("Settlement fund total", facts["Dollar figures confirmed on the page"])
        self.assertEqual(len([k for k, _ in out["detail"]["facts"] if k == "Dollar figures confirmed on the page"]), 1)

    def test_input_is_not_changed_and_retype_is_idempotent(self):
        before = copy.deepcopy(ACU_ROW)
        once = rt.retype_row(ACU_ROW, AS_OF)
        self.assertEqual(ACU_ROW, before)
        twice = rt.retype_row(once, AS_OF)
        self.assertEqual(once, twice)
        self.assertNotIn("ordinal", once)

    def test_upcoming_deadlines_sort_first(self):
        rows, report = rt.retype_all([MOVEIT_ROW, NO_FACTS_ROW, FUND_ROW, ACU_ROW], AS_OF)
        self.assertEqual([r["id"] for r in rows], [FUND_ROW["id"], ACU_ROW["id"], MOVEIT_ROW["id"], NO_FACTS_ROW["id"]])
        self.assertEqual(report["deadline_state"], {"upcoming": 2, "past": 1, "none": 1})
        # "Not confirmed on the official page" -> "Not recorded" is wording, not a headline change
        self.assertEqual({c["id"] for c in report["headline_changes"]}, {ACU_ROW["id"], MOVEIT_ROW["id"]})
        self.assertEqual([m["mdl"] for m in report["mdl_links"]], [3071, 2905, 3083])

    def test_listing_block_columns(self):
        block = rt.listing_block()
        keys = [c["key"] for c in block["columns"]]
        self.assertEqual(keys[:6], ["settlement", "deadline", "deadline_state", "fund_total", "per_claimant", "mdl"])


if __name__ == "__main__":
    unittest.main()
