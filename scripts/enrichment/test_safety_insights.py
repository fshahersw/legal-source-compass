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

    def test_acronyms_survive_headline_casing(self):
        self.assertEqual(b.headline_case("FSD COLLISIONS IN REDUCED VISIBILITY"), "FSD Collisions in Reduced Visibility")
        self.assertEqual(b.headline_case("DTN AIR BAG INFLATOR RUPTURE"), "DTN Air Bag Inflator Rupture")


if __name__ == "__main__":
    unittest.main()
