"""Offline tests for the expert-ruling parser and builder (synthetic printed texts; no network, no private files).

Run: cd scripts/enrichment/judge_rulings && python -B -m unittest -v test_build_judge_expert_rulings
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_judge_expert_rulings as B  # noqa: E402
import rulings_parse as R  # noqa: E402


def one(text):
    out = R.parse(text)
    return [(r["outcome"], r["movant_side"]) for r in out]


class Outcomes(unittest.TestCase):
    def test_decretal_words(self):
        self.assertEqual(R.outcome_of("granting in part and denying in part"), "granted_in_part")
        self.assertEqual(R.outcome_of("Granting in Part, Denying in Part, and Denying in Part as Moot"), "granted_in_part")
        self.assertEqual(R.outcome_of("denying as moot"), "denied_as_moot")
        self.assertEqual(R.outcome_of("denied without prejudice"), "denied")
        self.assertEqual(R.outcome_of("granting in its entirety"), "granted")
        self.assertEqual(R.outcome_of("Denying in Part and Reserving in Part"), "not_determined")
        self.assertEqual(R.outcome_of("deferring"), "deferred")


class Parse(unittest.TestCase):
    def test_active_and_passive_rulings_with_movant_as_printed(self):
        self.assertEqual(one("Order denying Defendants' Motion to Exclude Expert Testimony of Katherine Keyes (Related Doc # 1858 ). Judge Dan Aaron Polster on 8/26/19."),
                         [("denied", "defendants")])
        self.assertEqual(one("IT IS ORDERED that Defendants' Motion to exclude certain opinions of Dr. Laura Plunkett 5108 is DENIED. "
                             "IT IS FURTHER ORDERED that Defendants' Motion to exclude certain opinions of Dr. David Kessler 5111 is DENIED."),
                         [("denied", "defendants"), ("denied", "defendants")])
        self.assertEqual(one("ORDER DENYING META'S MOTION TO EXCLUDE EXPERT TESTIMONY OF CARL SABA AND DENYING IN PART AND GRANTING IN PART "
                             "PLAINTIFF'S MOTION TO EXCLUDE EXPERT TESTIMONY OF JUSTIN MCCRARY by Judge Yvonne Gonzalez Rogers"),
                         [("denied", "not_printed"), ("granted_in_part", "plaintiffs")])

    def test_shared_disposition_and_movant_across_joined_motions(self):
        t = ("ORDER GRANTING Plaintiffs' 624 Motion to Exclude Timothy Ulatwoski and 625 Motion to Exclude Reynaldo Librojo. Ethicon is hereby "
             "PRECLUDED from calling them as expert witnesses. Defendant Ethicon's 631 Motion to Exclude Dr. Sean Orenstein and 632 Motion to "
             "Exclude Dr. Eric Pauli are DENIED. Signed by Judge Richard W. Story on 11/25/2020.")
        self.assertEqual(one(t), [("granted", "plaintiffs"), ("granted", "plaintiffs"), ("denied", "defendants"), ("denied", "defendants")])

    def test_numbered_motion_list_after_a_plural_headline(self):
        t = ("ORDER GRANTING IN PART AND DENYING IN PART RULE 702 MOTIONS TO EXCLUDE PLAINTIFFS' EXPERTS' GENERAL CAUSATION OPINIONS by Judge "
             "Yvonne Gonzalez Rogers Granting in Part and Denying in Part 2292 Motion; Denying 2295 Motion.")
        out = R.parse(t)
        self.assertEqual([(r["outcome"], r["motion_numbers"]) for r in out], [("granted_in_part", ["2292"]), ("denied", ["2295"])])

    def test_plural_passive_motions_split_by_number_but_not_the_rule_number(self):
        t = "Defendants' motions to exclude Dr. Spector 605 and Dr. Sucre 592 under Federal Rule of Evidence 702 are denied without prejudice."
        self.assertEqual(sorted(n for r in R.parse(t) for n in r["motion_numbers"]), ["592", "605"])

    def test_scheduling_stipulation_and_leave_orders_are_not_rulings(self):
        for t in ["ORDER TO MODIFY BRIEFING SCHEDULE FOR ALTRIA'S 3866 MOTION TO STRIKE OR EXCLUDE PORTIONS OF SUPPLEMENTAL EXPERT REPORT granting 3877 STIPULATION.",
                  "ORDER THAT PLAINTIFFS UNCONTESTED MOTION FOR LEAVE TO FILE SINGLE BRIEF IN OPPOSITION TO DEFENDANTS MOTIONS TO EXCLUDE EXPERT OPINIONS (DOC. NO. 375), IS GRANTED.",
                  "ORDER granting 4259 Motion for Extension of Time. Rule 702 motions on general causation experts due by September 24, 2026.",
                  "ORDER AND REASONS GRANTING 17940 Motion for Summary Judgment and DENYING 17998 Motion for Leave to File Affidavit of Medical Expert.",
                  "Order by Judge William H. Orrick granting 2682 Stipulation. The Non-Management Directors may file an omnibus motion in support of their Daubert motion."]:
            self.assertEqual(R.parse(t), [], t)

    def test_a_non_expert_motion_to_exclude_is_not_a_ruling(self):
        self.assertEqual(R.parse("ORDER granting Motion to Exclude Untimely Exhibits."), [])


class Attribution(unittest.TestCase):
    def test_single_matching_signer(self):
        self.assertEqual(R.attribution("ORDER granting ... Signed by Senior Judge David G Campbell on 1/9/2026.", "David G. Campbell"),
                         ("mdl_transferee_judge+printed_signer", "David G Campbell"))
        self.assertEqual(R.attribution("Order denying ... Judge Dan Aaron Polster on 8/26/19.", "Dan A. Polster")[0], "mdl_transferee_judge+printed_signer")
        self.assertEqual(R.attribution("ORDER ... Signed by JUDGE M CASEY RODGERS on 3/4/2021.", "Margaret Catharine Rodgers")[0], "mdl_transferee_judge+printed_signer")

    def test_magistrate_joint_and_missing_signers_are_not_attributed(self):
        self.assertEqual(R.attribution("ORDER Granting ... Signed by Magistrate Judge Rukhsanah L. Singh on 5/13/2025.", "Michael Andre Shipp")[0], "magistrate_judge_named")
        self.assertEqual(R.attribution("ORDER ... Signed by Judge Edmund A. Sargus and Magistrate Judge Kimberly A. Jolson on 03/09/2020.", "Edmund A. Sargus Jr.")[0],
                         "magistrate_judge_named")
        self.assertEqual(R.attribution("ORDER ... Signed by Judge Edmund A. Sargus and Kimberly A. Jolson on 03/09/2020.", "Edmund A. Sargus Jr.")[0], "several_signers")
        self.assertEqual(R.attribution("Evidentiary Motions Order No. 35, Granting Defendants' Motion to Exclude ...", "Edmund A. Sargus Jr.")[0], "no_signer_printed")
        self.assertEqual(R.attribution("ORDER ... Signed by Judge Jane Doe on 1/1/2026.", "John Roe")[0], "signer_differs")
        self.assertEqual(R.attribution("ORDER that 2340 SPECIAL MASTER REPORT AND RECOMMENDATION is adopted. Signed by Judge Joy Flowers Conti.", "Joy Flowers Conti")[0],
                         "report_and_recommendation")
        self.assertEqual(R.attribution("ORDER ... Signed by Judge Jane Doe.", None)[0], "mdl_judge_not_linked")

    def test_same_surname_needs_a_compatible_first_given_name(self):
        # another judge of the same surname signing on the MDL docket is never attributed to the linked judge
        self.assertEqual(R.attribution("ORDER ... Signed by Judge Robert Rodgers on 3/4/2021.", "Margaret Catharine Rodgers"),
                         ("signer_differs", "Robert Rodgers"))
        self.assertEqual(R.attribution("ORDER ... Signed by Judge R. Campbell on 1/9/2026.", "David G. Campbell")[0], "signer_differs")
        self.assertTrue(R.first_given_compatible("M CASEY RODGERS", "Margaret Catharine Rodgers"))
        self.assertTrue(R.first_given_compatible("Dan Aaron Polster", "Dan A. Polster"))
        self.assertFalse(R.first_given_compatible("Rodgers", "Margaret Catharine Rodgers"))  # no given name printed: cannot agree


def cand(cid, source, mdl, date, text, url="https://www.govinfo.gov/x"):
    return {"id": cid, "source": source, "mdl": mdl, "court_id": "azd", "docket_number": "2:23-md-03081", "date": date, "text": text, "source_url": url}


class Builder(unittest.TestCase):
    def setUp(self):
        t1 = "ORDER granting in part and denying in part Plaintiffs' 4818 motion to exclude the expert opinions of Daniel Bergsagel, M.D. Signed by Senior Judge David G Campbell on 1/9/2026."
        t2 = "Evidentiary Motions Order No. 35, Granting Defendants' Motion to Exclude Plaintiff's Expert Dr. Dipak Panigrahy"
        self.cands = [cand("d1", "documents", "3081", "2026-01-09", t1), cand("e1", "sw_docket_entries_v1", "3081", "2026-01-09", t1, "https://www.courtlistener.com/docket/1/"),
                      cand("d2", "documents", "2846", "2023-10-25", t2)]
        self.mdls = [{"id": "3081", "title": "IN RE: Bard Implanted Port", "judge_links": [{"display_name": "David G. Campbell"}]},
                     {"id": "2846", "title": "IN RE: Davol", "judge_links": [{"display_name": "Edmund A. Sargus Jr."}]}]
        self.packet = {"decisions": [{"id": "3081", "outcome": "confirmed", "profile": "camp", "link_evidence": "cl_docket_assigned_to"},
                                     {"id": "2846", "outcome": "confirmed", "profile": "sarg", "link_evidence": "cl_docket_assigned_to"}]}
        self.labels = {"d1": {"rulings": [{"outcome": "granted_in_part", "movant_side": "plaintiffs"}]},
                       "e1": {"rulings": [{"outcome": "granted_in_part", "movant_side": "plaintiffs"}]},
                       "d2": {"rulings": [{"outcome": "granted", "movant_side": "defendants"}]}}

    def test_same_ruling_printed_twice_is_one_record_attributed_once(self):
        rows, rollups, tallies, _, _ = B.build(self.cands, self.mdls, self.packet, self.labels)
        self.assertEqual(len(rows), 2)
        bard = next(r for r in rows if r["filters"]["mdl"] == ["3081"])
        self.assertEqual(bard["filters"]["judge_profile"], ["camp"])
        self.assertEqual(len(bard["item"]["sources"]), 2)
        self.assertIn("Decision as printed", [f[0] for f in bard["detail"]["facts"]])
        davol = next(r for r in rows if r["filters"]["mdl"] == ["2846"])
        self.assertNotIn("judge_profile", davol["filters"])  # no signer printed: published unattributed
        self.assertEqual(davol["item"]["attribution"]["basis"], "no_signer_printed")
        self.assertEqual([r["filters"]["judge_profile"] for r in rollups], [["camp"]])
        self.assertEqual((tallies["parsed"], tallies["agree"], tallies["labelled"]), (3, 3, 3))

    def test_summary_reports_precision_recall_and_coverage(self):
        rows, rollups, tallies, _, _ = B.build(self.cands, self.mdls, self.packet, self.labels)
        s = B.summary(rows, rollups, tallies, {"x": "y"})
        self.assertEqual(s["audit"]["parser_precision_before_dedupe"], 1.0)
        self.assertEqual(s["coverage"], {"judges_with_1": 1, "judges_with_5": 0, "judges_with_20": 0})
        self.assertIn("in-sample", s["audit"]["in_sample"])

    def test_rulings_the_labels_contradict_are_held_out(self):
        labels = dict(self.labels, d2={"rulings": [{"outcome": "denied", "movant_side": "defendants"}]})  # the label disagrees with the parse
        rows, rollups, tallies, _, held = B.build(self.cands, self.mdls, self.packet, labels)
        self.assertEqual(held, ["document:d2:1"])
        self.assertEqual([r["filters"]["mdl"] for r in rows], [["3081"]])
        s = B.summary(rows, rollups, tallies, {"x": "y"}, held)
        self.assertEqual((s["audit"]["published_precision"], s["audit"]["held_out_disagreeing"]), (1.0, ["document:d2:1"]))
        self.assertEqual(s["audit"]["parser_precision_before_dedupe"], round(2 / 3, 3))
        self.assertFalse(s["audit"]["independent_review"])
        self.assertIn("not an independent review", s["audit"]["method"])

    def test_name_variant_mdl_links_never_attribute(self):
        packet = {"decisions": [{"id": "3081", "outcome": "review", "profile": None}, {"id": "2846", "outcome": "review", "profile": None}]}
        rows, rollups, _, _, _ = B.build(self.cands, self.mdls, packet, self.labels)
        self.assertTrue(all("judge_profile" not in r["filters"] for r in rows))
        self.assertEqual(rollups, [])


if __name__ == "__main__":
    unittest.main()
