"""Offline tests for scripts/caselaw_v2 (synthetic records only; no network, no credentials, no private files).

    cd scripts/caselaw_v2 && python3 -B -m unittest -v test_caselaw_v2
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import courts  # noqa: E402
import opinions  # noqa: E402
import rows  # noqa: E402

READ_KEY_APP = re.compile(r"^caselaw/read/2026-09-30/[a-z0-9_./-]+\.jsonl\.gz$")  # src/lib/external/caselaw.ts READ_KEY
OBJECTS_CHECK = re.compile(r"^caselaw/(read|citator)/2026-09-30/[a-z0-9_./-]+[.]jsonl[.]gz$")  # caselaw.objects.key check


def csv_value(v):
    if v is None:
        return ""
    return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'


def opinion_record(oid: int, cluster_id: int | None, html: str = "", plain: str = "", **kw) -> bytes:
    vals = {c: None for c in opinions_columns()}
    vals.update({"id": oid, "date_created": "2020-01-01 00:00:00+00", "date_modified": "2021-02-03 04:05:06+00", "type": "020lead",
                 "per_curiam": "f", "extracted_by_ocr": "f", "author_str": "Keyes", "sha1": "a" * 40, "cluster_id": cluster_id,
                 "html_with_citations": html or None, "plain_text": plain or None})
    vals.update(kw)
    return (",".join(csv_value(vals[c]) for c in opinions_columns()) + "\n").encode("utf-8")


def opinions_columns():
    import extract_text

    return extract_text.COLUMNS


class TierRules(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(common.tier_of_level("SA"), 4)
        self.assertEqual(common.tier_of_level("FD"), 5)
        self.assertEqual(common.tier_of_level("FB"), 6)
        self.assertEqual(common.tier_of_level("TRS"), 7)
        self.assertIsNone(common.tier_of_level("F"))  # stage-2 tiers are not v2's
        self.assertIsNone(common.tier_of_level("S"))
        self.assertIsNone(common.tier_of_level("F", "scotus"))
        self.assertIsNone(common.tier_of_level("SAG"))  # attorney general opinions are not court decisions
        self.assertIsNone(common.tier_of_level("FS", "olc"))  # executive legal opinions, explicit id list
        self.assertIsNone(common.tier_of_level("Zz"))  # unknown codes are never guessed

    def test_groups(self):
        self.assertEqual(common.tiers_for("sa,fd"), [4, 5])
        self.assertEqual(common.tiers_for("all"), [4, 5, 6, 7])
        with self.assertRaises(common.V2Error):
            common.tiers_for("circuits")

    def test_object_key_patterns(self):
        k = common.object_key(4, 7, 3, "0123456789abcdef" * 4)
        self.assertEqual(k, "caselaw/read/2026-09-30/t4/v2/u07/t4-u07-0003-0123456789ab.jsonl.gz")
        self.assertRegex(k, READ_KEY_APP)
        self.assertRegex(k, OBJECTS_CHECK)
        self.assertRegex(common.object_key(5, 15, 0, "f" * 64, "-sample"), OBJECTS_CHECK)


class Registry(unittest.TestCase):
    def test_states_and_levels(self):
        cts = [{"id": "texapp", "jurisdiction": "SA", "full_name": "Court of Appeals of Texas", "in_use": "t"},
               {"id": "nysd", "jurisdiction": "FD", "full_name": "S.D.N.Y."},
               {"id": "tax", "jurisdiction": "FS", "full_name": "Tax Court"},
               {"id": "ca1", "jurisdiction": "F", "full_name": "First Circuit"},
               {"id": "olc", "jurisdiction": "FS", "full_name": "Office of Legal Counsel"},
               {"id": "moctapped", "jurisdiction": "SA", "full_name": "Mo. Ct. App. E.D."}]
        houses = [{"court_id": "texapp", "state": "TX"}, {"court_id": "texapp", "state": "tx"}, {"court_id": "nysd", "state": "NY"},
                  {"court_id": "tax", "state": "DC"}, {"court_id": "ca1", "state": "MA"}, {"court_id": "ca1", "state": "PR"}]
        reg = {c["court_id"]: c for c in courts.build_registry(cts, houses, {"texapp": 10})["courts"]}
        self.assertEqual((reg["texapp"]["tier"], reg["texapp"]["jurisdiction"], reg["texapp"]["expected_clusters"]), (4, "TX", 10))
        self.assertEqual((reg["nysd"]["tier"], reg["nysd"]["jurisdiction"], reg["nysd"]["system"]), (5, "NY", "federal"))
        self.assertEqual((reg["tax"]["tier"], reg["tax"]["jurisdiction"]), (6, None))  # a national court seated in DC is not "DC"
        self.assertEqual((reg["ca1"]["tier"], reg["ca1"]["jurisdiction"]), (None, None))
        self.assertIsNone(reg["olc"]["tier"])
        self.assertTrue(reg["olc"]["excluded"])
        self.assertIsNone(reg["moctapped"]["jurisdiction"])  # no courthouse row: Not recorded, never from the name


class Records(unittest.TestCase):
    def test_cluster_of(self):
        self.assertEqual(opinions.cluster_of(opinion_record(5, 1234)), 1234)
        self.assertIsNone(opinions.cluster_of(opinion_record(5, None)))

    def test_render_one_provenance_and_text(self):
        opinions.init_worker([77], [88])
        html = ('<p>See <span class="citation" data-id="70"><a href="/opinion/77/x/">1 F.3d 2</a></span> and '
                '<span class="citation" data-id="80"><a href="/opinion/88/y/">3 F.3d 4</a></span>.</p>'
                '<p>He said \\"no\\" \u2028 here.</p>')
        rec = opinion_record(9, 55, html=html)
        member, attach, facts = opinions.render_one(rec, (9, 55, 4, "texapp"), 300, 7486, "https://example.invalid/opinions.csv.bz2")
        r = json.loads(zlib.decompress(member, 31).decode("utf-8"))
        self.assertEqual(r["format"], common.READ_FORMAT)
        self.assertEqual((r["opinion_id"], r["cluster_id"], r["court_id"], r["tier"]), (9, 55, "texapp", "t4"))
        self.assertEqual(r["text_sha256"], common.sha256_text(r["text"]))
        self.assertIn('He said \\"no\\"', r["text"])  # the record's own bytes, unescaped once by the CSV reader
        self.assertEqual(r["source"]["record_sha256"], common.sha256_bytes(rec))
        self.assertEqual((r["source"]["segment"], r["source"]["offset"], r["source"]["field"]), (300, 7486, "html_with_citations"))
        import extract_text

        raw = extract_text.split_fields(rec)[extract_text.COL["html_with_citations"]]
        self.assertEqual(r["source"]["raw_sha256"], common.sha256_bytes(raw))
        held = sorted(c[4] for c in r["citations"])
        self.assertEqual(held, [1, 2])  # cluster 77 has a page; 88 is blocked
        self.assertNotIn("stage1", r)
        self.assertEqual(attach["opinion_id"], 9)
        self.assertEqual(facts["held_anchors"], 1)

    def test_plain_text_verbatim(self):
        opinions.init_worker([], [])
        rec = opinion_record(10, 56, plain="  Line one.\n\tLine two \\ end  ")
        member, _a, _f = opinions.render_one(rec, (10, 56, 5, "nysd"), 1, 2, "u")
        r = json.loads(zlib.decompress(member, 31).decode("utf-8"))
        self.assertEqual(r["text"], "  Line one.\n\tLine two \\ end  ")
        self.assertEqual(r["source"]["field"], "plain_text")


class Packing(unittest.TestCase):
    def test_objects_close_only_between_clusters(self):
        with tempfile.TemporaryDirectory() as d:
            w = opinions.ObjectWriter(d, 4, 3, "", target=100)
            closed = []
            seq = [(1, 60), (1, 60), (2, 10), (3, 200), (3, 10), (4, 5)]
            for i, (cid, size) in enumerate(seq):
                # incompressible bytes so each member is about `size` bytes long
                m = common.gzip_member(b"".join(common.sha256_bytes(f"{i}:{j}".encode()).encode() for j in range(size // 64 + 1))[:size * 2])
                c = w.add(m, {"cluster_id": cid, "opinion_id": i})
                if c:
                    closed.append(c)
            last = w.close()
            closed.append(last)
            groups = [[r["cluster_id"] for r in c["rows"]] for c in closed]
            self.assertEqual(groups, [[1, 1], [2, 3, 3], [4]])
            for c in closed:
                data = open(c["path"], "rb").read()
                self.assertEqual(common.sha256_bytes(data), c["sha256"])
                self.assertTrue(c["key"].endswith(f"-{c['sha256'][:12]}.jsonl.gz"))
                self.assertEqual([(o, n) for o, n, _b in common.iter_gzip_members(data)], [(r["s"], r["n"]) for r in c["rows"]])

    def test_deterministic_members(self):
        self.assertEqual(common.gzip_member(b"abc"), common.gzip_member(b"abc"))


class Rows(unittest.TestCase):
    def test_case_row_names(self):
        base = {"cluster_id": 1, "tier": 4, "court_id": "texapp", "date_filed": "2016-01-02", "cited_by": 3, "cited_by_cases": 2}
        r = rows.case_row({**base, "case_name": "  ", "case_name_full": "Full Name v. Other"})
        self.assertEqual((r["case_name"], r["case_name_full"]), ("Full Name v. Other", None))
        r = rows.case_row({**base, "case_name": None, "case_name_full": None})
        self.assertEqual(r["case_name"], "Not recorded")
        r = rows.case_row({**base, "case_name": "A v. B", "case_name_full": "A v. B"})
        self.assertIsNone(r["case_name_full"])
        self.assertEqual((r["cited_by"], r["cited_by_cases"]), (3, 2))

    def test_type_rank(self):
        self.assertLess(rows.type_rank("020lead"), rows.type_rank("040dissent"))
        self.assertEqual(rows.type_rank("zzz"), 13)

    def test_units(self):
        self.assertEqual(opinions.parse_units("3,1,3", 20), [1, 3])
        with self.assertRaises(common.V2Error):
            opinions.parse_units("20", 20)


class Files(unittest.TestCase):
    def test_jsonl_split_only_at_newline(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.jsonl.gz")
            with gzip.open(p, "wt", encoding="utf-8") as h:
                h.write(json.dumps({"t": "a b"}, ensure_ascii=False) + "\n")
            self.assertEqual(common.read_jsonl(p), [{"t": "a b"}])


if __name__ == "__main__":
    unittest.main()
