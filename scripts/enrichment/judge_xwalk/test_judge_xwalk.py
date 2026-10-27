"""Unit tests for the judge crosswalk normalisers (python3 -I -B -m unittest scripts/enrichment/judge_xwalk/test_judge_xwalk.py)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import xwalk_lib as xl  # noqa: E402


class Names(unittest.TestCase):
    def test_honorifics_and_suffix(self):
        self.assertEqual(xl.record_name("Judge Barrington Daniels Parker Jr."), (("barrington", "daniels", "parker"), frozenset({"jr"})))
        self.assertEqual(xl.record_name("Hon. Mary Jane Bowes"), (("mary", "jane", "bowes"), frozenset()))
        self.assertEqual(xl.record_name("Clifford R. Anderson III"), (("clifford", "r", "anderson"), frozenset({"iii"})))

    def test_hyphen_and_apostrophe_split_identically(self):
        self.assertEqual(xl.record_name("Panayotta D. Augustin-Birch")[0], ("panayotta", "d", "augustin", "birch"))
        full, suffix, *_ = xl.cl_name("Panayotta", "D.", "Augustin-Birch", None)
        self.assertEqual(full, ("panayotta", "d", "augustin", "birch"))
        self.assertEqual(xl.record_name("Sandra Day O'Connor")[0], xl.cl_name("Sandra", "Day", "O'Connor", None)[0])

    def test_cl_suffix_codes_and_suffix_inside_middle(self):
        full, suffix, f, m, l = xl.cl_name("Donald", " E., Jr.", "Van Luven", None)
        self.assertEqual(full, ("donald", "e", "van", "luven"))
        self.assertEqual(suffix, frozenset({"jr"}))
        self.assertEqual(xl.cl_name("John", "", "Roe", "3")[1], frozenset({"iii"}))
        self.assertEqual(xl.cl_name("John", "", "Roe", "1")[1], frozenset())

    def test_middle_compatibility(self):
        self.assertTrue(xl.middle_compatible(("m",), ("martin",)))
        self.assertTrue(xl.middle_compatible((), ("martin",)))
        self.assertTrue(xl.middle_compatible(("martin",), ("martin",)))
        self.assertFalse(xl.middle_compatible(("m",), ("lee",)))
        self.assertFalse(xl.middle_compatible(("a", "b"), ("anne",)))

    def test_no_fuzzy_matching(self):
        self.assertNotEqual(xl.record_name("Jon Smith")[0], xl.record_name("John Smith")[0])
        self.assertNotEqual(xl.record_name("Chris Martin")[0], xl.record_name("Christopher Martin")[0])


class Courts(unittest.TestCase):
    def test_federal_district_forms(self):
        a = xl.court_aliases("District Court, N.D. Illinois", "N.D. Illinois")
        self.assertIn(xl.norm_court("U.S. District Court for the Northern District of Illinois"), a)
        self.assertIn(xl.norm_court("United States District Court for the Northern District of Illinois"), a)
        b = xl.court_aliases("District Court, D. New Jersey", "D. New Jersey")
        self.assertIn(xl.norm_court("U.S. District Court for the District of New Jersey"), b)

    def test_bankruptcy_appeals_and_dc(self):
        self.assertIn(xl.norm_court("U.S. Bankruptcy Court for the District of Delaware"), xl.court_aliases("United States Bankruptcy Court, D. Delaware", "D. Delaware"))
        self.assertIn(xl.norm_court("U.S. Court of Appeals for the First Circuit"), xl.court_aliases("Court of Appeals for the First Circuit", "First Circuit"))
        self.assertIn(xl.norm_court("U.S. Court of Appeals for the District of Columbia Circuit"), xl.court_aliases("Court of Appeals for the D.C. Circuit", "D.C. Circuit"))

    def test_state_trial_court_forms(self):
        self.assertIn(xl.norm_court("228th District Court of Texas"), xl.court_aliases("Texas 228th Judicial District Court", None))
        self.assertIn(xl.norm_court("Monterey County Superior Court"), xl.court_aliases("Superior Court of California, County of Monterey", None))
        self.assertIn(xl.norm_court("Kings County Supreme Court"), xl.court_aliases("New York Supreme Court, Kings County", None))
        self.assertEqual(xl.norm_court("CO - Denver County Court"), xl.norm_court("Denver County Court"))

    def test_partial_names_do_not_resolve(self):
        self.assertNotIn(xl.norm_court("228th District Court of Oklahoma"), xl.court_aliases("Texas 228th Judicial District Court", None))
        self.assertNotIn(xl.norm_court("Northern District of Illinois Bankruptcy"), xl.court_aliases("District Court, N.D. Illinois", "N.D. Illinois"))


class Positions(unittest.TestCase):
    def test_untyped_positions_need_a_judicial_title(self):
        types = {"jud", "mag"}
        self.assertTrue(xl.is_judicial("jud", None, types))
        self.assertFalse(xl.is_judicial("clerk", "Law Clerk", types))
        self.assertTrue(xl.is_judicial(None, "Deputy Supervising Judge", types))
        self.assertFalse(xl.is_judicial(None, "Clerk to the Hon. Barrington D. Parker, Jr.", types))
        self.assertFalse(xl.is_judicial(None, "Principal Law Clerk to Administrative Judge", types))

    def test_term_years(self):
        self.assertEqual(xl.term_years("January 2024 to December 2033"), (2024, 2033))
        self.assertEqual(xl.term_years(None), (None, None))


import build_mdl_judge_links as BM  # noqa: E402
import mdl_judge_links as ML  # noqa: E402
import patch_sql as PS  # noqa: E402
import snapshot_io as SIO  # noqa: E402


class SnapshotIo(unittest.TestCase):
    def test_extracts_rows_from_a_saved_console_result(self):
        body = ('Below is the result ... within the below <untrusted-data-ab12> boundaries.\n\n<untrusted-data-ab12>\n'
                '[{"x": "[{\\"a\\": 1}]"}]\n</untrusted-data-ab12>\n\nUse this data ...')
        import json as _json
        rows = SIO.extract_rows(_json.dumps({"result": body}))
        self.assertEqual(SIO.single_column(rows), [{"a": 1}])

    def test_bare_array_and_single_column_guard(self):
        self.assertEqual(SIO.single_column(SIO.extract_rows('[{"v": [1, 2]}]')), [1, 2])
        with self.assertRaises(ValueError):
            SIO.single_column([{"a": 1, "b": 2}])


class PatchSql(unittest.TestCase):
    def test_literals_are_quoted_and_run_ids_stable(self):
        self.assertEqual(PS.lit("O'Hearn"), "'O''Hearn'")
        self.assertEqual(PS.lit(None), "null")
        self.assertEqual(PS.values([("a", None), ("b", 2)]), "('a', null),\n    ('b', 2)")
        self.assertEqual(PS.run_id("x"), PS.run_id("x"))
        self.assertNotEqual(PS.run_id("x"), PS.run_id("y"))
        with self.assertRaises(ValueError):
            PS.values([])

    def test_apply_is_md5_guarded(self):
        self.assertIn("md5(to_jsonb(r)::text) = c.original_record->>'row_md5'", PS.apply_statement("mdls", "i", PS.run_id("x")))


def mdl(mid, profile=None, kind=None, assigned=None, printed="Jane Q. Roe", person=None, basis=None, entity="judge-entity-1", links=True):
    return {"id": mid, "mdl_number": int(mid), "row_md5": "a" * 32, "status": "pending", "judge_name_as_printed": printed, "judge_profile_id": profile,
            "judge_match_kind": kind, "judge_entity_id": entity if profile else None, "judge_cl_person_id": person, "judge_cl_person_basis": basis,
            "cl_assigned_to_id": None, "cl_docket_id": "123", "court_id": "njd", "master_docket": "2:19-md-2904", "assigned": assigned,
            "judge_links": [{"basis": "jpml_name_court", "match_kind": kind, "entity_id": entity, "display_name": "Jane Quinn Roe",
                             "links": [{"url": f"#judge/{profile}", "label": "Judge profile"}]}] if profile and links else []}


def assignment(person, *profiles):
    return [{"person": person, "evidence_sha256": "e" * 64, "run_id": "r", "name": {"first": "Jane", "middle": "Q", "last": "Roe", "suffix": ""},
             "profiles": [{"judges_id": p, "tier": t, "fjc_nid": "1", "name": "Jane Quinn Roe", "entity_id": "judge-entity-1"} for p, t in profiles]}]


class MdlJudgeLinks(unittest.TestCase):
    """Exact MDL judge links: docket assignment -> crosswalk exact_id; name variants only as needs review."""

    def test_person_profile_prefers_the_exact_id_row_over_a_stub(self):
        self.assertEqual(ML.person_profile([{"judges_id": "stub", "tier": "parent_profile_link"}, {"judges_id": "p", "tier": "exact_id"}]), ("p", "exact_id"))
        self.assertEqual(ML.person_profile([{"judges_id": "p", "tier": "exact_name_same_court"}]), ("p", "exact_name_same_court"))
        self.assertEqual(ML.person_profile([{"judges_id": "p", "tier": "compatible_name_same_court"}]), (None, "compatible_name_only"))
        self.assertEqual(ML.person_profile([{"judges_id": "a", "tier": "exact_id"}, {"judges_id": "b", "tier": "exact_id"}]), (None, "several_exact_id_profiles"))
        self.assertEqual(ML.person_profile([]), (None, "no_profile_for_person"))

    def test_docket_assignment_confirms_a_name_variant_link(self):
        d = ML.classify(mdl("2738", "p", "middle_initial", assignment("2955", ("p", "exact_id")), person="2955", basis="judge_profile_native_bridge"))
        self.assertEqual((d["outcome"], d["profile"], d["link_evidence"], d["review"]), ("confirmed", "p", "cl_docket_assigned_to", None))
        self.assertEqual(d["cl_person_basis"], "judge_profile_native_bridge+cl_docket_assigned_to")

    def test_unconfirmed_name_variant_becomes_needs_review(self):
        d = ML.classify(mdl("1663", "p", "middle_initial", None, person="576", basis="judge_profile_native_bridge"))
        self.assertEqual((d["outcome"], d["profile"], d["review"], d["cl_person"]), ("review", None, "name_variant_unconfirmed", None))
        d = ML.classify(mdl("3060", "p", "middle_initial", assignment("10140", ("p", "compatible_name_same_court"))))
        # the docket person stays only in cl_assigned_to_id: never judge_cl_person_id (read as "presides over an MDL") on a needs-review MDL
        self.assertEqual((d["outcome"], d["profile"], d["cl_person"], d["person"], d["review"]), ("review", None, None, "10140", "name_variant_unconfirmed"))

    def test_review_with_an_assignee_of_another_name_is_flagged_as_differing(self):
        a = assignment("10116")
        a[0]["name"] = {"first": "Lorenzo", "middle": "F", "last": "Garcia", "suffix": ""}
        d = ML.classify(mdl("3119", "p", "middle_initial", a, printed="Matthew L. Garcia"))
        self.assertEqual((d["outcome"], d["review"], d["cl_person"], d["person_name"]), ("review", "cl_assigned_to_differs", None, "Lorenzo F Garcia"))

    def test_names_differ_compares_exact_first_and_surname(self):
        self.assertTrue(ML.names_differ("Matthew L. Garcia", "Lorenzo F Garcia"))
        self.assertTrue(ML.names_differ("Robert J. Shelby", "James O. Browning"))
        self.assertFalse(ML.names_differ("Mary M. Rowland", "Mary M Rowland"))
        self.assertFalse(ML.names_differ("Thomas W. Thrash, Jr", "Thomas Woodrow Thrash Jr."))
        self.assertFalse(ML.names_differ("J. Philip Calabrese", "James Philip Calabrese"))  # a lone initial needs only the same letter
        self.assertFalse(ML.names_differ("Jane Roe", None))  # unknown: never a disagreement

    def test_disagreeing_docket_assignment_links_neither(self):
        d = ML.classify(mdl("3051", "thrash", "exact", assignment("2787", ("ross", "exact_id")), person="3225"))
        self.assertEqual((d["outcome"], d["profile"], d["review"], d["person_profile"]), ("conflict", None, "cl_assigned_to_differs", "ross"))
        self.assertIsNone(d["cl_person"])  # neither the JPML judge's bridge person nor the docket person
        d = ML.classify(mdl("2695", None, None, assignment("430", ("browning", "exact_id")), printed="Robert J. Shelby"))
        self.assertEqual((d["outcome"], d["profile"], d["cl_person"]), ("conflict", None, None))

    def test_new_link_only_when_no_judge_is_printed(self):
        d = ML.classify(mdl("2606", None, None, assignment("1829", ("kugler", "exact_id")), printed=None))
        self.assertEqual((d["outcome"], d["profile"]), ("new", "kugler"))

    def test_exact_name_link_stands_and_flags_an_unresolved_docket_person(self):
        d = ML.classify(mdl("3074", "p", "exact", assignment("1719")))
        self.assertEqual((d["outcome"], d["profile"], d["link_evidence"], d["review"]), ("kept_exact", "p", "jpml_exact_name_court", "cl_assigned_to_unresolved"))
        self.assertIsNone(d["cl_person"])  # an unresolved assignee is never written as the linked judge's person
        d = ML.classify(mdl("1358", "p", "exact", None, person="733", basis="judge_profile_native_bridge"))
        self.assertEqual((d["outcome"], d["cl_person"]), ("kept_exact", "733"))

    def test_exact_name_link_contradicted_by_the_docket_person_is_a_conflict(self):
        d = ML.classify(mdl("9", "p", "exact", assignment("2"), person="1"))
        self.assertEqual((d["outcome"], d["profile"]), ("conflict", None))


class BuildMdlJudgeLinks(unittest.TestCase):
    def test_targets_skip_bulk_assigned_and_put_name_variants_first(self):
        snap = [mdl("3000", None, None, None), mdl("1663", "p", "middle_initial", None), mdl("2738", "p", "middle_initial", assignment("1", ("p", "exact_id")))]
        t = BM.targets(snap)
        self.assertEqual([x["mdl"] for x in t], ["1663", "3000"])

    def test_live_header_used_only_on_a_unique_exact_docket_match(self):
        snap = [mdl("1663", "p", "middle_initial", None), mdl("1917", "q", "middle_initial", None)]
        live = [{"mdl": "1663", "identity_matches": True, "assigned_to": "576", "assigned_to_str": "Claire C. Cecchi", "source_url": "https://x", "retrieved_at": "2026-10-27T12:00:00Z", "source_sha256": "f" * 64},
                {"mdl": "1917", "identity_matches": True, "assigned_to": "9"}, {"mdl": "1917", "identity_matches": True, "assigned_to": "10"}]
        merged, used = BM.merge_live(snap, live, [{"judges_id": "p", "cl_person_id": "576", "tier": "exact_id"}])
        self.assertEqual(used, ["1663"])
        ds = BM.decisions(merged)
        self.assertEqual((ds[0]["outcome"], ds[0]["profile"], ds[0]["item_patch"]["cl_assigned_to_as_of"]), ("confirmed", "p", "2026-10-27"))
        # the live header's source URL and sha256 travel onto the record and its judge link
        self.assertEqual((ds[0]["item_patch"]["cl_assigned_to_source_url"], ds[0]["item_patch"]["cl_assigned_to_evidence_sha256"]), ("https://x", "f" * 64))
        self.assertEqual((ds[0]["judge_links"][0]["source_url"], ds[0]["judge_links"][0]["evidence_sha256"]), ("https://x", "f" * 64))
        self.assertEqual(ds[1]["outcome"], "review")  # two dockets matched: never picked

    def test_patches_and_contract(self):
        snap = [mdl("2738", "p", "middle_initial", assignment("2955", ("p", "exact_id"))), mdl("1663", "c", "middle_initial", None),
                mdl("3051", "thrash", "exact", assignment("2787", ("ross", "exact_id")), person="3225"), mdl("2606", None, None, assignment("1829", ("kugler", "exact_id")), printed=None)]
        ds = BM.decisions(snap)
        by = {d["id"]: d for d in ds}
        self.assertEqual(by["1663"]["item_patch"]["judge_profile_id"], None)
        # judge_links holds only a linked judge: review and conflict MDLs get [] and their candidates go to judge_link_candidates
        self.assertEqual(by["1663"]["judge_links"], [])
        self.assertNotIn("links", by["1663"]["judge_link_candidates"][0])
        self.assertTrue(by["1663"]["judge_link_candidates"][0]["needs_review"])
        self.assertNotIn("cl_assigned_to_id", by["1663"]["item_patch"])  # no docket person: the recorded value stays
        self.assertEqual(by["3051"]["judge_links"], [])
        self.assertEqual([e["relation"] for e in by["3051"]["judge_link_candidates"]], ["jpml_printed_judge", "courtlistener_docket_assignment"])
        self.assertTrue(all("links" not in e and e["needs_review"] for e in by["3051"]["judge_link_candidates"]))
        self.assertEqual(by["2606"]["judge_links"][0]["links"], [{"url": "#judge/kugler", "label": "Judge profile"}])
        self.assertIsNone(by["2738"]["judge_link_candidates"])
        sql = BM.render_sql(ds, ML.tally(ds, snap), {"mdls_judges": "x"})
        self.assertIn("jsonb_build_object('judge_link_candidates', t.cands)", sql)
        self.assertIn("'{listing,facets,judge_resolved}', fc.o", sql)  # the stored facet follows the changed filters
        self.assertIn("'{listing,facets}', c.original_record->'listing_facets'", sql)  # and is restored by the rollback
        self.assertIn("md5(to_jsonb(r)::text) = c.original_record->>'row_md5'", sql)
        self.assertIn("('c', '1663', 'drop')", sql)
        self.assertIn("('kugler', '2606', 'add')", sql)
        self.assertNotIn("delete from", sql.lower())
        self.assertNotIn("insert into", BM.preview_sql(ds).lower())


if __name__ == "__main__":
    unittest.main()
