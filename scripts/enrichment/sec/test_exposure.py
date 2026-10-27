"""Offline tests for the tier C rule and the exposure recompute (exposure.py, retype_mdl_links.py). No network.

  cd scripts/enrichment/sec && python3 -B -m unittest -v test_exposure
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exposure as xp  # noqa: E402
import retype_mdl_links as rt  # noqa: E402

TOTAL = 204977


def entry(mdl, tier, role="defendant", pending=1000, change=100, status="pending", counted=None, review=False, dismissed=False):
    counted = (role == "defendant" and not dismissed and not review) if counted is None else counted
    return {"mdl": mdl, "mdl_title": f"MDL {mdl}", "mdl_status": status, "mdl_type": "Products Liability", "pending": pending if status == "pending" else None,
            "change_12m": change if status == "pending" else None, "tier": tier, "role": role, "verified_count": 1,
            "first_verified": "2024-01-01", "last_verified": "2025-01-01", "counts_toward_exposure": counted, "district": "x", "judge": "y",
            "dismissed": dismissed, "review": review, "title_truncated": False}


def link_row(cik, e, series=()):
    link = {**e, "cik": cik, "series": list(series), "review_note": None, "tier_label": "t"}
    return {"id": f"{cik}:{e['mdl']}", "category": "company_sec_mdl_links", "state": "", "title": "t", "source_url": "https://www.sec.gov/x", "ordinal": 0,
            "item": {"id": f"{cik}:{e['mdl']}", "kind": "link", "link": link, "cells": {}, "links": [], "badges": []},
            "detail": {"facts": [["Company", "x"]], "links": []}, "text": "t", "filters": {"tier": [e["tier"]]}}


def profile_row(cik, entries, flags=(), accrual_current=False, accrual_yoy=None):
    exposure, _ = xp.company_exposure(entries, TOTAL)
    return {"id": cik, "category": "company_sec_profiles", "state": "", "title": f"Company {cik}", "source_url": "https://www.sec.gov/x", "ordinal": 0,
            "item": {"id": cik, "kind": "company", "cells": {"pending": f"{exposure['pending_actions']:,}" if exposure["pending_actions"] else "Not recorded"},
                     "badges": [], "links": [],
                     "summary": {"company": {"sic_description": "Pharmaceutical Preparations"}, "mdls": entries, "exposure": exposure,
                                 "flags": list(flags), "accrual_current": accrual_current, "accrual_yoy_pct": accrual_yoy, "pending_series": []}},
            "detail": {"facts": [["Pending actions, linked MDLs where the company is a defendant", "old"]], "links": []},
            "text": "t", "filters": {"tier": [exposure["strongest_tier"] or "none"], "flag": list(flags) or ["none"]}}


def overview_row(coverage):
    return {"id": "summary:overview", "category": "company_sec_profiles", "state": "", "title": "o", "source_url": "https://www.sec.gov/edgar/search/", "ordinal": 99,
            "item": {"id": "summary:overview", "kind": "summary", "overview": {"coverage": coverage, "method": [], "sectors": [],
                     "pending_actions_counted": 0, "pending_actions_counted_ab": 0, "pending_actions_counted_c": 0, "pending_actions_unclear_only": 0}},
            "detail": {"facts": [], "links": []}, "text": "o", "filters": {"_listing": ["no"]}}


class TierRuleTests(unittest.TestCase):
    def test_tier_c_is_flagged_and_never_counted(self):
        out = xp.apply_tier_rule({"tier": "C", "role": "defendant", "dismissed": False, "review_note": None, "counts_toward_exposure": True, "review": False})
        self.assertFalse(out["counts_toward_exposure"])
        self.assertTrue(out["review"])
        self.assertEqual(out["review_note"], xp.TIER_C_NOTE)

    def test_reviewer_note_is_kept_and_a_b_unchanged(self):
        kept = xp.apply_tier_rule({"tier": "C", "role": "defendant", "dismissed": False, "review_note": "Reviewer: indemnity."})
        self.assertEqual(kept["review_note"], "Reviewer: indemnity.")
        a = xp.apply_tier_rule({"tier": "A", "role": "defendant", "dismissed": False, "review_note": None})
        self.assertTrue(a["counts_toward_exposure"])
        self.assertFalse(a["review"])
        self.assertFalse(xp.apply_tier_rule({"tier": "B", "role": "unclear", "dismissed": False, "review_note": None})["counts_toward_exposure"])


class ExposureTests(unittest.TestCase):
    def test_exposure_split_and_null_when_nothing_counts(self):
        exp, pending = xp.company_exposure([entry(2873, "A", pending=15264, change=1322), entry(3094, "C", counted=False, review=True)], TOTAL)
        self.assertEqual(exp["pending_actions"], 15264)
        self.assertEqual(exp["pending_actions_c"], 0)
        self.assertEqual(exp["share_of_all_pending_pct"], 7.45)
        self.assertEqual([l["mdl"] for l in pending], [2873])
        none, _ = xp.company_exposure([entry(3094, "C", counted=False, review=True)], TOTAL)
        self.assertIsNone(none["pending_actions"])  # not recorded, never 0
        self.assertIsNone(none["strongest_tier"])
        self.assertEqual(none["review_links"], 1)

    def test_flags_recomputed_from_exposure(self):
        exp, _ = xp.company_exposure([entry(1, "A", pending=400, change=200), entry(2, "B", pending=10, change=1), entry(3, "A", pending=5, change=0)], TOTAL)
        self.assertEqual(xp.exposure_flags(["accrual_heavy", "multi_mdl"], exp, True, 80.0), ["accrual_surge", "accrual_heavy", "docket_growth", "multi_mdl"])
        empty, _ = xp.company_exposure([], TOTAL)
        self.assertEqual(xp.exposure_flags(["accrual_surge", "docket_growth", "expense_spike"], empty, True, 80.0), ["expense_spike"])


class RetypeTests(unittest.TestCase):
    def setUp(self):
        a = entry(2873, "A", pending=15264, change=1322)
        c = entry(3094, "C", pending=4139, change=1296)  # published counted, no review: the defect being fixed
        self.links = [link_row("0000030554", a, [{"date": "2026-09-01", "pending": 15000}, {"date": "2026-10-01", "pending": 15264}]),
                      link_row("0000030554", c, [{"date": "2026-10-01", "pending": 4139}]),
                      link_row("0000059478", entry(3094, "C", pending=4139, change=1296), [{"date": "2026-10-01", "pending": 4139}])]
        self.profiles = [profile_row("0000030554", [copy.deepcopy(a), copy.deepcopy(c)], flags=["docket_growth"]),
                         profile_row("0000059478", [entry(3094, "C", pending=4139, change=1296)], flags=["docket_growth"]),
                         overview_row([{"mdl": 2873, "status": "pending", "pending": 15264, "companies": [{"cik": "0000030554", "tier": "A", "role": "defendant", "counted": True, "dismissed": False, "review": False}]},
                                       {"mdl": 3094, "status": "pending", "pending": 4139, "companies": [
                                           {"cik": "0000030554", "tier": "C", "role": "defendant", "counted": True, "dismissed": False, "review": False},
                                           {"cik": "0000059478", "tier": "C", "role": "defendant", "counted": True, "dismissed": False, "review": False}]}])]

    def test_published_exposure_must_reproduce(self):
        self.assertEqual(rt.check_reproduces(self.profiles, TOTAL), [])
        broken = copy.deepcopy(self.profiles)
        broken[0]["item"]["summary"]["exposure"]["pending_actions"] = 1
        self.assertEqual(len(rt.check_reproduces(broken, TOTAL)), 1)

    def test_links_and_profiles_after_retype(self):
        links, profiles, report = rt.retype_all(self.links, self.profiles, TOTAL)
        tier_c = [l for l in links if l["item"]["link"]["tier"] == "C"]
        self.assertTrue(all(not l["item"]["link"]["counts_toward_exposure"] and l["item"]["link"]["review"] for l in tier_c))
        self.assertEqual(tier_c[0]["filters"]["counted"], ["no"])
        self.assertIn(xp.TIER_C_NOTE, dict(tier_c[0]["detail"]["facts"])[rt.COUNT_FACT])
        by_id = {p["id"]: p for p in profiles}
        chemours = by_id["0000030554"]["item"]["summary"]
        self.assertEqual(chemours["exposure"]["pending_actions"], 15264)
        self.assertEqual(chemours["exposure"]["pending_actions_c"], 0)
        self.assertEqual(chemours["pending_series"], [{"date": "2026-09-01", "pending": 15000, "mdls": 1}, {"date": "2026-10-01", "pending": 15264, "mdls": 1}])
        only_c = by_id["0000059478"]
        self.assertIsNone(only_c["item"]["summary"]["exposure"]["pending_actions"])
        self.assertEqual(only_c["item"]["cells"]["pending"], "Not recorded")
        self.assertEqual(only_c["filters"]["tier"], ["none"])
        self.assertEqual(only_c["filters"]["flag"], ["none"])
        ov = by_id["summary:overview"]["item"]["overview"]
        self.assertEqual((ov["pending_actions_counted"], ov["pending_actions_counted_c"]), (15264, 0))
        self.assertEqual(report["tier_c_counted_after"], 0)
        self.assertEqual(report["tier_c_links_changed"], 2)


if __name__ == "__main__":
    unittest.main()
