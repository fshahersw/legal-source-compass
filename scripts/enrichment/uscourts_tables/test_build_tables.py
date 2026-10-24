"""Offline tests for build_tables.py (series building rules) on synthetic normalised tables."""
import copy
import unittest

import build_tables as B
import test_normalize as T


def doc(period, pub="JB", mutate=None, notes=None, title=None):
    n = copy.deepcopy(T.normalized(period=period))
    n["pub"] = pub
    n["months"] = 12
    if notes is not None:
        n["notes"] = notes
    if title is not None:
        n["title"] = title
    if mutate:
        mutate(n)
    return {"norm": n, "source": {"page": f"https://example.test/{period}", "url": f"https://example.test/{period}.xlsx", "sha256": "0" * 64, "format": "xlsx"}}


class UnitTests(unittest.TestCase):
    def test_unit_and_decimals(self):
        self.assertEqual(B.unit_of(["Court Action", "Percent Reaching Trial"], "#,##0.0"), "percent")
        self.assertEqual(B.unit_of(["Median Months"], "#,##0.0"), "months")
        self.assertEqual(B.unit_of(["Weighted Filings per Authorized Judgeship"], "#,##0"), "ratio")
        self.assertEqual(B.unit_of(["Total"], "#,##0"), "count")
        self.assertEqual(B.unit_of(["Mean"], "#,##0.00"), "ratio")
        self.assertEqual(B.unit_of(["Pending"], "0.0%"), "percent")
        self.assertEqual(B.decimals_of("#,##0.0;\\-#,##0.0;0.0"), 1)
        self.assertEqual(B.decimals_of("#,##0"), 0)
        self.assertIsNone(B.decimals_of("General"))

    def test_clean_num(self):
        self.assertEqual(B.clean_num(5.0), 5)
        self.assertEqual(B.clean_num(0.412637863021903), 0.412638)
        self.assertIsNone(B.clean_num(None))
        self.assertEqual(B.clean_num(7), 7)


class SeriesTests(unittest.TestCase):
    def setUp(self):
        self.docs = B.prepare([doc("2023-09-30"), doc("2024-09-30"), doc("2025-09-30")])
        self.cols = B.collect_columns(self.docs)

    def test_series_align_to_periods_in_order(self):
        data, dash, label = B.series_for(self.docs, self.cols, ("district", "nysd"))
        self.assertEqual(label, "NY,S")
        self.assertEqual(len(data["total"]), 3)
        self.assertTrue(all(v is not None for v in data["total"]))
        self.assertEqual(dash, {})

    def test_an_entity_printed_twice_with_different_figures_is_a_gap_and_with_equal_figures_is_read_once(self):
        def twice(n):
            ny = next(r for r in n["rows"] if r["entity_id"] == "nysd")
            n["rows"].append({**ny, "values": [v + 1 if isinstance(v, int) else v for v in ny["values"]]})
            dc = next(r for r in n["rows"] if r["entity_id"] == "dcd")
            n["rows"].append(dict(dc))

        docs = B.prepare([doc("2023-09-30", mutate=twice)])
        self.assertNotIn(("district", "nysd"), docs[0]["rows_by_entity"])
        self.assertIn(("district", "dcd"), docs[0]["rows_by_entity"])
        self.assertEqual(docs[0]["entity_conflicts"], [("district", "nysd")])
        data, _, _ = B.series_for(docs, B.collect_columns(docs), ("district", "nysd"))
        self.assertEqual(data["total"], [None])

    def test_a_period_without_the_court_is_a_gap_not_zero(self):
        def drop_court(n):
            n["rows"] = [r for r in n["rows"] if r["entity_id"] != "nysd"]

        docs = B.prepare([doc("2023-09-30"), doc("2024-09-30", mutate=drop_court)])
        cols = B.collect_columns(docs)
        data, _, _ = B.series_for(docs, cols, ("district", "nysd"))
        self.assertIsNotNone(data["total"][0])
        self.assertIsNone(data["total"][1])

    def test_a_published_dash_is_recorded_as_a_dash_position(self):
        def dash_it(n):
            for r in n["rows"]:
                if r["entity_id"] == "nysd":
                    r["values"][0] = None
                    r["flags"][0] = "dash"

        docs = B.prepare([doc("2023-09-30"), doc("2024-09-30", mutate=dash_it)])
        cols = B.collect_columns(docs)
        data, dash, _ = B.series_for(docs, cols, ("district", "nysd"))
        self.assertIsNone(data["total"][1])
        self.assertEqual(dash["total"], [1])

    def test_prior_year_columns_are_not_series(self):
        def add_prior(n):
            n["columns"][1]["prior"] = True

        docs = B.prepare([doc("2023-09-30", mutate=add_prior)])
        cols = B.collect_columns(docs)
        self.assertNotIn(docs[0]["norm"]["columns"][1]["key"], cols)

    def test_national_series_is_the_total_row(self):
        data, _, label = B.series_for(self.docs, self.cols, ("national", "national"))
        total_row = next(r for r in self.docs[0]["norm"]["rows"] if r["entity"] == "national")
        self.assertEqual(data["total"][0], total_row["values"][0])
        self.assertEqual(label, "Total")


class DocSelectionAndBreakTests(unittest.TestCase):
    def test_same_period_in_two_publications_keeps_the_first_by_priority_and_reports_the_other(self):
        a, b = doc("2024-09-30", pub="JB"), doc("2024-09-30", pub="FJCS")
        chosen, dropped = B.pick_docs([b, a, doc("2023-09-30")])
        self.assertEqual([d["norm"]["period_end"] for d in chosen], ["2023-09-30", "2024-09-30"])
        self.assertEqual(chosen[1]["norm"]["pub"], "JB")
        self.assertEqual(dropped, [{"end": "2024-09-30", "pub": "FJCS", "kept": "JB"}])

    def test_breaks_for_columns_notes_and_title(self):
        def drop_col(n):
            n["columns"].pop()

        docs = B.prepare([
            doc("2023-09-30", notes=["NOTE: Land condemnation cases omitted."]),
            doc("2024-09-30", notes=["NOTE: Land condemnation cases omitted."]),
            doc("2025-09-30", notes=["NOTE: Prisoner petitions omitted."], title="A new title", mutate=drop_col),
        ])
        kinds = [(b["at"], b["kind"]) for b in B.find_breaks(docs)]
        self.assertIn((2, "columns"), kinds)
        self.assertIn((2, "notes"), kinds)
        self.assertIn((2, "title"), kinds)
        self.assertFalse([k for k in kinds if k[0] == 1])

    def test_a_renamed_heading_is_a_break_inside_one_series(self):
        def rename(n):
            n["columns"][0]["label"] = "Count"

        docs = B.prepare([doc("2023-09-30"), doc("2024-09-30", mutate=rename)])
        heading = [b for b in B.find_breaks(docs) if b["kind"] == "heading"]
        self.assertEqual(len(heading), 1)
        self.assertEqual(heading[0]["at"], 1)
        self.assertIn("'Total' became 'Count'", heading[0]["detail"])

    def test_the_change_from_pdf_to_spreadsheet_is_a_source_break_and_equal_footnotes_add_nothing(self):
        note = ["NOTE: Land condemnation cases omitted."]
        old = doc("2015-09-30", notes=list(note))
        old["source"]["format"] = "pdf"
        docs = B.prepare([old, doc("2016-09-30", notes=list(note)), doc("2017-09-30", notes=list(note))])
        breaks = B.find_breaks(docs)
        self.assertEqual([(b["at"], b["kind"]) for b in breaks], [(1, "source")])
        self.assertIn("PDF", breaks[0]["detail"])

    def test_a_footnote_change_quotes_the_new_sentence(self):
        docs = B.prepare([
            doc("2015-09-30", notes=["Note: Case weights are based on the 2003-2004 study. Territorial courts are excluded."]),
            doc("2016-09-30", notes=["Note: Case weights are based on the system approved in March 2016. Territorial courts are excluded."]),
        ])
        notes = [b for b in B.find_breaks(docs) if b["kind"] == "notes"]
        self.assertEqual(len(notes), 1)
        self.assertIn("approved in March 2016", notes[0]["detail"])
        self.assertNotIn("Territorial", notes[0]["detail"])

    def test_numbers_in_notes_do_not_count_as_a_change(self):
        docs = B.prepare([doc("2023-09-30", notes=["NOTE: 5 courts omitted."]), doc("2024-09-30", notes=["NOTE: 7 courts omitted."])])
        self.assertEqual([b for b in B.find_breaks(docs) if b["kind"] == "notes"], [])

    def test_note_groups_share_identical_text(self):
        docs = B.prepare([doc("2023-09-30", notes=["a"]), doc("2024-09-30", notes=["a"]), doc("2025-09-30", notes=["b"])])
        self.assertEqual(B.note_groups(docs), [{"at": [0, 1], "lines": ["a"]}, {"at": [2], "lines": ["b"]}])


class PayloadTests(unittest.TestCase):
    def test_court_payload_shape_and_drop_empty(self):
        docs = B.prepare([doc("2023-09-30"), doc("2024-09-30")])
        cols = B.collect_columns(docs)
        info = {"table": "C-4A", "table_key": "c-4a"}
        nat = B.series_for(docs, cols, ("national", "national"))
        mapping, conflicts = B.circuit_of_districts(docs)
        self.assertEqual(conflicts, [])
        self.assertEqual(mapping["nysd"], "ca2")
        self.assertEqual(mapping["dcd"], "cadc")
        circ = B.series_for(docs, cols, ("circuit", "ca2"))[0]
        payload = B.court_payload("district", "nysd", docs, cols, info, "Title", (nat[0], nat[1]), "ca2", circ, ("district", "nysd"))
        self.assertEqual(payload["v"], 1)
        self.assertEqual(payload["court"], "nysd")
        self.assertEqual(len(payload["periods"]), 2)
        self.assertEqual(payload["src"][0]["end"], "2023-09-30")
        self.assertEqual(payload["circuitId"], "ca2")
        for series in payload["data"].values():
            self.assertEqual(len(series), 2)
        # a column that never has a value is dropped, unless the publisher printed a dash for it
        payload["data"]["total"] = [None, None]
        trimmed = B.drop_empty(payload)
        self.assertNotIn("total", trimmed["data"])
        self.assertNotIn("total", [c["k"] for c in trimmed["cols"]])
        payload["dash"]["total"] = [0, 1]
        kept = B.drop_empty(payload)
        self.assertIn("total", kept["data"])
        self.assertEqual(kept["dash"]["total"], [0, 1])


class CountyBuildTests(unittest.TestCase):
    def test_county_records_are_keyed_by_fips_and_reporting_district(self):
        import build_uscourts_tables as BU

        sheets, _ = T.P.parse_workbook(T.county_workbook())
        docs = []
        for period in ("2025-06-30", "2026-06-30"):
            entry = {"pub": "BF", "table": "F-5A", "period_end": period, "title": "listing", "page": "https://example.test/p"}
            norm = T.N.normalize(sheets[0], entry)
            docs.append({"norm": norm, "source": {"page": "https://example.test/" + period, "url": "https://example.test/f.xlsx", "sha256": "0" * 64, "format": "xlsx"}})
        out = {("tables", "county"): []}
        BU.build_county_group(docs, out, {"unknown_courts": set()})
        ids = [r["id"] for r in out[("tables", "county")]]
        self.assertEqual(len(ids), 97)  # 96 counties + the table record that holds what they share
        self.assertEqual(len(set(ids)), len(ids))
        self.assertIn("table:f-5a", ids)
        self.assertIn("01001:f-5a", ids)
        rec = next(r for r in out[("tables", "county")] if r["id"] == "01001:f-5a")
        ust = rec["item"]["ust"]
        self.assertEqual((ust["scope"], ust["fips"], ust["state"], ust["ref"]), ("county", "01001", "AL", "table:f-5a"))
        self.assertEqual([e["district"] for e in ust["districts"]], ["dcd"])
        self.assertEqual(ust["districts"][0]["data"]["total_all_chapters"], [4, 4])
        self.assertNotIn("src", ust)  # the periods, columns and sources are in the shared record, not repeated in every county
        self.assertEqual(rec["state"], "AL")
        shared = next(r for r in out[("tables", "county")] if r["id"] == "table:f-5a")["item"]["ust"]
        self.assertEqual(shared["districtRows"]["dcd"]["data"]["total_all_chapters"], [5, 5])
        self.assertEqual([p["end"] for p in shared["periods"]], ["2025-06-30", "2026-06-30"])
        self.assertEqual(len(shared["src"]), 2)
        outside = next(r for r in out[("tables", "county")] if r["id"].startswith("12113:"))
        self.assertEqual(outside["item"]["ust"]["districts"][0]["outsideAt"], [0, 1])


if __name__ == "__main__":
    unittest.main()
