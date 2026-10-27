import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_safety_insights as b  # noqa: E402


def enforcement(i, firm, date, reason="Listeria monocytogenes", cls="Class II"):
    return {"id": f"r{i}", "title": f"Product {i}", "filters": {"firm_norm": firm, "sort_date": date},
            "snippet": reason, "firm": firm.title(), "cls": cls, "dates": {"report_date": date, "recall_initiation_date": date}}


class PoissonTest(unittest.TestCase):
    def test_surprise_grows_with_excess(self):
        self.assertEqual(b.poisson_surprise(2, 5), 0.0)
        self.assertGreater(b.poisson_surprise(20, 2), b.poisson_surprise(8, 2))
        self.assertGreater(b.poisson_surprise(8, 2), 1.3)


class DetectorTest(unittest.TestCase):
    def test_firm_cluster_flags_sudden_burst_and_collapses_product_rows(self):
        end = dt.date(2026, 9, 1)
        rows = [enforcement(i, "ACME FOODS", (end - dt.timedelta(days=i * 7)).isoformat(), reason=f"Listeria lot {i}") for i in range(10)]
        # Ten product rows for one event must count once.
        rows += [enforcement(100 + i, "ACME FOODS", end.isoformat(), reason="Listeria lot 0") for i in range(10)]
        rows += [enforcement(200, "ACME FOODS", "2023-01-05")]
        data = {"agency_safety_openfda_food_enforcement": rows}
        insights = b.Builder(data).build()
        cluster = next(i for i in insights if i["kind"] == "firm_cluster")
        self.assertEqual(cluster["metric"]["recent"], 10)
        self.assertIn("ACME", cluster["headline"].upper())
        self.assertTrue(cluster["evidence"])
        self.assertTrue(all(e["dataset"] == "agency_safety_openfda_food_enforcement" for e in cluster["evidence"]))

    def test_steady_firm_is_not_flagged(self):
        rows = []
        start = dt.date(2022, 1, 1)
        for i in range(60):
            rows.append(enforcement(i, "STEADY INC", (start + dt.timedelta(days=i * 30)).isoformat(), reason=f"cgmp {i}"))
        insights = b.Builder({"agency_safety_openfda_drug_enforcement": rows}).build()
        self.assertFalse([i for i in insights if i["kind"] == "firm_cluster"])

    def test_cpsc_death_boilerplate_is_not_a_reported_death(self):
        self.assertIsNone(b.DEATH.search("Recalled Due to Risk of Serious Injury or Death from Tip-Over"))
        self.assertIsNotNone(b.DEATH.search("Two deaths reported after the dresser tipped over"))
        self.assertIsNotNone(b.DEATH.search("a 2-year-old child died"))

    def test_scores_are_bounded_and_severity_is_assigned(self):
        builder = b.Builder({})
        builder.add(kind="crl_cluster", agency="FDA", entity="x", headline="h", summary="s", score=10_000, serious=False,
                    metric={}, series=[], evidence_rows=[], method="m", as_of=dt.date(2026, 1, 1))
        insight = builder.insights[0]
        self.assertLessEqual(insight["score"], 100)
        self.assertEqual(insight["severity"], "high")

    def test_firm_cluster_counts_fda_event_ids_not_reason_texts(self):
        end = dt.date(2026, 9, 1)
        # One FDA event (event_id 9001) with 48 products and 31 different reason texts, as in the Silver Moon recall.
        rows = []
        for i in range(48):
            row = enforcement(i, "SILVER MOON LP", end.isoformat(), reason=f"Undeclared allergen variant {i % 31}", cls="Class I")
            row["event_id"] = "9001"
            rows.append(row)
        # Three more distinct events in the window.
        for j in range(3):
            row = enforcement(100 + j, "SILVER MOON LP", (end - dt.timedelta(days=20 * (j + 1))).isoformat())
            row["event_id"] = f"90{10 + j}"
            rows.append(row)
        builder = b.Builder({"agency_safety_openfda_food_enforcement": rows})
        events = builder.fda_events("agency_safety_openfda_food_enforcement")
        self.assertEqual(len(events), 4)
        big = next(e for e in events if e["event_id"] == "9001")
        self.assertEqual(len(big["rows"]), 48)
        self.assertEqual(big["class"], "Class I")
        self.assertEqual(builder.fallback_rows, {})
        # Four events is below the cluster threshold of four recent events? It is exactly four: never 31 or 51.
        insights = b.Builder({"agency_safety_openfda_food_enforcement": rows}).build()
        for cluster in [i for i in insights if i["kind"] == "firm_cluster"]:
            self.assertEqual(cluster["metric"]["recent"], 4)
            self.assertEqual(cluster["metric"]["product_rows"], 51)

    def test_rows_without_event_id_are_counted_as_fallback(self):
        builder = b.Builder({"agency_safety_openfda_drug_enforcement": [enforcement(1, "X INC", "2026-01-01")]})
        builder.fda_events("agency_safety_openfda_drug_enforcement")
        self.assertEqual(builder.fallback_rows, {"agency_safety_openfda_drug_enforcement": 1})

    def test_explicit_death_words_and_negation(self):
        self.assertTrue(b.explicit_death("CPSC believes that nine children ... have drowned, after gaining access"))
        self.assertTrue(b.explicit_death("An infant suffocated in the sleeper."))
        self.assertTrue(b.explicit_death("A consumer was killed when the unit fell."))
        self.assertTrue(b.explicit_death("A child was strangled by the cord."))
        self.assertFalse(b.explicit_death("No one has died. Two minor burns were reported."))
        self.assertFalse(b.explicit_death("Risk of serious injury or death from drowning."))
        self.assertFalse(b.explicit_death(None))

    def test_cpsc_reads_the_api_dataset_and_flags_untagged_deaths(self):
        self.assertIn("agency_safety_cpsc_recalls_api", b.SOURCES)
        self.assertNotIn("agency_safety_cpsc_recalls_local", b.SOURCES)
        rows = []
        for i in range(4):
            rows.append({"id": f"cpsc-api:{i}", "title": f"Pools recalled {i}", "filters": {},
                         "cells": {"date": f"2026-0{i + 1}-15", "hazard": "Drowning", "death_mention": "No", "firm": "Pool Co"},
                         "injuries": "Two children have drowned.", "hazards": ["Drowning hazard"]})
        rows.append({"id": "cpsc-api:9", "title": "Dresser recalled due to risk of serious injury or death", "filters": {},
                     "cells": {"date": "2026-05-01", "hazard": "Tip-over", "death_mention": "No"},
                     "injuries": "None reported.", "hazards": []})
        insights = b.Builder({"agency_safety_cpsc_recalls_api": rows}).build()
        fatal = next(i for i in insights if i["entity"] == "CPSC fatality-linked recalls")
        self.assertEqual(fatal["metric"]["recent"], 4)
        self.assertEqual(fatal["metric"]["untagged_by_source"], 4)
        self.assertTrue(all(e["dataset"] == "agency_safety_cpsc_recalls_api" for e in fatal["evidence"]))
        missed = next(i for i in insights if i["entity"] == "CPSC deaths missed by the death tag")
        self.assertEqual(missed["metric"]["recent"], 4)

    def test_warning_letter_themes_carry_the_sample_caveat(self):
        rows = []
        for i in range(12):
            rows.append({"id": f"wl{i}", "title": f"CGMP adulterated drug {i}", "filters": {"sort_date": f"2026-0{1 + i % 6}-10"}, "snippet": "CGMP"})
        rows.append({"id": "wl-old", "title": "CGMP letter", "filters": {"sort_date": "2023-01-10"}, "snippet": "CGMP"})
        insights = b.Builder({"agency_safety_fda_warning_letters": rows}).build()
        themed = [i for i in insights if i["entity"].startswith("FDA warning letters")]
        self.assertTrue(themed)
        for insight in themed:
            self.assertIn("uneven 1,000-row sample", insight["method"])
            self.assertIn("Uneven sample", insight["tags"])
            self.assertIn("caveat", insight["metric"])

    def test_packet_writes_rows_summary_and_flags_without_publishing(self):
        import json
        import tempfile
        builder = b.Builder({})
        builder.add(kind="crl_cluster", agency="FDA", entity="x", headline="h", summary="s", score=50, serious=False,
                    metric={"recent": 1}, series=[], evidence_rows=[{"dataset": "d", "id": "1", "title": "t", "date": None, "note": None}],
                    method="m", as_of=dt.date(2026, 1, 1))
        with tempfile.TemporaryDirectory() as tmp:
            rows = b.to_rows(builder.insights, "2026-10-27T00:00:00+00:00")
            b.write_packet(tmp, builder.insights, rows, "2026-10-27T00:00:00+00:00", {"d": [1, 2]}, {})
            self.assertEqual(sorted(os.listdir(tmp)), ["flags.tsv", "rows.jsonl", "summary.json"])
            with open(os.path.join(tmp, "summary.json"), encoding="utf-8") as fh:
                summary = json.load(fh)
            self.assertEqual(summary["insights"], 1)
            self.assertEqual(summary["sources"], {"d": 2})

    def test_acronyms_survive_headline_casing(self):
        self.assertEqual(b.headline_case("FSD COLLISIONS IN REDUCED VISIBILITY"), "FSD Collisions in Reduced Visibility")
        self.assertEqual(b.headline_case("DTN AIR BAG INFLATOR RUPTURE"), "DTN Air Bag Inflator Rupture")


if __name__ == "__main__":
    unittest.main()
