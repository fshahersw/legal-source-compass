import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import ecfr_text_lib as lib  # noqa: E402

PART = """<?xml version="1.0"?>
<DIV5 N="9" TYPE="PART" VOLUME="1">
<HEAD>PART 9&#x2014;EXAMPLE</HEAD>
<DIV6 N="A" TYPE="SUBPART"><HEAD>Subpart A</HEAD>
<DIV8 N="9.1" TYPE="SECTION" hierarchy_metadata="{&quot;path&quot;:&quot;/on/_SUBSTITUTE_DATE_/title-1/section-9.1&quot;}">
<HEAD>&#xA7; 9.1 Scope &amp; purpose.</HEAD>
<P>(a) <I>Basic purpose.</I> Applies to  all
 firms.</P>
<P>(b) See <E T="03">Note</E>, 15 U.S.C. 1.</P>
<EXTRACT><P>Quoted <SU>1</SU> text.</P></EXTRACT>
<GPOTABLE COLS="2"><BOXHD><CHED H="1">A</CHED></BOXHD><ROW><ENT>one</ENT><ENT>two</ENT></ROW></GPOTABLE>
<CITA>[48 FR 1, Jan. 1, 1984]</CITA>
</DIV8>
<DIV8 N="9.2&#x2013;9.3" TYPE="SECTION"><HEAD>&#xA7;&#xA7; 9.2&#x2013;9.3 [Reserved]</HEAD></DIV8>
</DIV6></DIV5>"""

META = {"name": "Example", "latest_amended_on": "2026-09-01", "latest_issue_date": "2026-09-02", "up_to_date_as_of": "2026-10-02"}


class TextProjection(unittest.TestCase):
    def test_fragments_and_text(self):
        frs = list(lib.section_fragments(PART.encode("utf-8")))
        self.assertEqual([f[0] for f in frs], ["9.1", "9.2\u20139.3"])
        p = lib.parse_section_fragment(frs[0][3])
        self.assertEqual(p["heading"], "\u00a7 9.1 Scope & purpose.")
        self.assertEqual(
            p["text"],
            "(a) Basic purpose. Applies to all firms.\n(b) See Note, 15 U.S.C. 1.\nQuoted 1 text.\none | two",
        )
        self.assertEqual(p["source_note"], "[48 FR 1, Jan. 1, 1984]")
        self.assertNotIn("FR 1", p["text"])

    def test_dash_normalisation_and_reserved(self):
        self.assertEqual(lib.normalize_section_number("\u00a7 9.2\u20139.3"), "9.2-9.3")
        frs = list(lib.section_fragments(PART))
        p = lib.parse_section_fragment(frs[1][3])
        self.assertTrue(lib.is_reserved(p["heading"], p["text"]))
        self.assertEqual(p["text"], "")

    def test_entity_envelope_is_deterministic_and_hash_bound(self):
        frs = list(lib.section_fragments(PART))
        number, start, end, frag = frs[0]
        parsed = lib.parse_section_fragment(frag)
        raw_sha = lib.sha256_hex(PART)
        args = dict(title="1", part="9", section_number=number, parsed=parsed, raw_sha256=raw_sha, raw_bytes_len=len(PART),
                    start=start, end=end, fragment=frag, as_of="2026-10-02", title_meta=META,
                    source_url=lib.part_url("2026-10-02", "1", "9"), retrieved_at="2026-10-06T00:00:00Z", http_status=200)
        a, b = lib.build_entity(**args), lib.build_entity(**args)
        self.assertEqual(a, b)
        self.assertEqual(a["native_id"], "title-1/part-9/section-9.1")
        self.assertEqual(a["provenance"]["record_sha256"], lib.record_sha256(a["data"]))
        self.assertEqual(a["data"]["fragment_sha256"], lib.sha256_hex(PART[start:end]))
        self.assertEqual(a["provenance"]["source_sha256"], raw_sha)
        self.assertTrue(a["provenance"]["source_url"].endswith("/full/2026-10-02/title-1.xml?part=9"))
        lib.assert_integer_domain(a["data"])

    def test_integer_domain_rejects_floats_and_nul(self):
        for bad in ({"x": 1.5}, {"x": "a\x00"}, {"x": "\ud800"}):
            with self.assertRaises(ValueError):
                lib.assert_integer_domain(bad)

    def test_canonical_json_matches_sorted_compact(self):
        self.assertEqual(lib.canonical_json({"b": [1, None, True], "a": "\u00e9"}), '{"a":"\u00e9","b":[1,null,true]}')

    def test_publisher_source_id(self):
        self.assertEqual(lib.parse_oul_source_id("CFR_T21_P1_S1_1"), ("21", "1"))
        self.assertEqual(lib.parse_oul_source_id("CFR_T41_P102_3_S102_3_25"), ("41", "102-3"))
        self.assertEqual(lib.parse_oul_source_id("USC_T18_C95_S1956"), ("18", None))
        self.assertEqual(lib.parse_oul_source_id("TX_X"), (None, None))

    def test_raw_object_key_is_content_addressed(self):
        sha = "ab" + "0" * 62
        self.assertEqual(lib.raw_object_key(sha), "ecfr-text/sha256/ab/" + sha + ".xml")


class BuildPackets(unittest.TestCase):
    def test_every_target_is_classified_once(self):
        import json
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            os.makedirs(os.path.join(work, "raw", "title-1"))
            raw = PART.encode("utf-8")
            with open(os.path.join(work, "raw", "title-1", "part-9.xml"), "wb") as f:
                f.write(raw)
            acq = {"titles": {"by_number": {"1": dict(META, number=1), "2": {"reserved": True}}},
                   "parts": {"title-1-part-9": {"title": "1", "part": "9", "state": "complete", "file": "raw/title-1/part-9.xml",
                                               "sha256": lib.sha256_hex(raw), "bytes": len(raw), "as_of": "2026-10-02",
                                               "url": lib.part_url("2026-10-02", "1", "9"), "retrieved_at": "2026-10-06T00:00:00Z",
                                               "http_status": 200},
                             "title-1-part-8": {"title": "1", "part": "8", "state": "not_found"}}}
            targets = {"cfr": [
                {"title": "1", "part": "9", "section": "9.1", "from": ["federal_regulations_sections"]},
                {"title": "1", "part": "9", "section": "9.2-9.3", "from": ["citation_index"]},
                {"title": "1", "part": "9", "section": "9.9", "from": ["citation_index"]},
                {"title": "1", "part": "8", "section": "8.1", "from": ["citation_index"]},
                {"title": "2", "part": "1", "section": "1.1", "from": ["citation_index"]}]}
            json.dump(acq, open(os.path.join(work, "acquisition.json"), "w"))
            json.dump(targets, open(os.path.join(work, "targets.json"), "w"))
            subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "build_packets.py"), "--work", work],
                           check=True, capture_output=True)
            res = {(r["part"], r["section"]): r["status"] for r in json.load(open(os.path.join(work, "packets", "resolution.json")))}
            self.assertEqual(res, {("9", "9.1"): "acquired", ("9", "9.2-9.3"): "reserved_in_ecfr", ("9", "9.9"): "section_not_in_ecfr",
                                   ("8", "8.1"): "part_not_in_ecfr", ("1", "1.1"): "title_unavailable"})
            man = json.load(open(os.path.join(work, "packets", "manifest.json")))
            self.assertEqual(man["summary"]["entities"], 2)
            batch = json.load(open(os.path.join(work, "packets", "batches", "batch-00000.json")))
            self.assertEqual([e["native_id"] for e in batch], ["title-1/part-9/section-9.1", "title-1/part-9/section-9.2-9.3"])


PAGE = """<html><head><title>U.S.C. Title 9 - ARBITRATION</title></head><body>
<span style="font-weight:bold;font-size:12pt;">9 U.S.C. </span><br/>
<span style="font-size:10pt">United States Code, 2024 Edition</span><br/>
<span style="font-size:10pt">Title 9 - ARBITRATION</span><br/>
<span style="font-size:10pt">CHAPTER 1 - GENERAL PROVISIONS</span><br/>
<span style="font-size:10pt">Sec. 2 - Validity, irrevocability, and enforcement of agreements to arbitrate</span><br/>
<span style="font-size:10pt">From the U.S. Government Publishing Office, <a href="http://www.gpo.gov">www.gpo.gov</a></span><br/><br/>
<!-- documentid:9_2  usckey:090000000000200000000000000000000 currentthrough:20250106 documentPDFPage:1 -->
<!-- field-start:head -->
<h3 class="section-head">&sect;2. Validity &amp; enforcement</h3>
<!-- field-end:head -->
<!-- field-start:statute -->
<p class="statutory-body">A written provision&mdash;</p>
<p class="statutory-body-1em">(1) shall be <i>valid</i>;</p>
<table><tr><th>A</th><td>B</td></tr></table>
<!-- field-end:statute -->
<!-- field-start:sourcecredit -->
<p class="source-credit">(Pub. L. 1, Feb. 12, 1925.)</p>
<!-- field-end:sourcecredit -->
<!-- field-start:notes -->
<!-- field-start:amendment-note -->
<p class="note-body">Amendments text.</p>
<!-- field-end:amendment-note -->
<!-- field-end:notes -->
<!-- field-start:footnote -->
<p class="footnote"><sup>1</sup> So in original.</p>
<!-- field-end:footnote -->
</body></html>"""


class UsCode(unittest.TestCase):
    def test_page_parse_and_entity(self):
        import uscode_text_lib as u
        p = u.parse_section_page(PAGE)
        self.assertEqual((p["title_number"], p["section_number"], p["current_through"], p["edition"]), ("9", "2", "2025-01-06", "2024"))
        self.assertEqual(p["hierarchy"], ["Title 9 - ARBITRATION", "CHAPTER 1 - GENERAL PROVISIONS"])
        self.assertEqual(p["heading"], "\u00a72. Validity & enforcement")
        self.assertEqual(p["text"], "A written provision\u2014\n(1) shall be valid;\nA | B")
        self.assertEqual(p["source_credit"], "(Pub. L. 1, Feb. 12, 1925.)")
        self.assertEqual(p["note_kinds"], ["amendment-note"])
        self.assertFalse(p["repealed"])
        target = {"granule": "USCODE-2024-title9-chap1-sec2", "package": "USCODE-2024-title9"}
        e = u.build_entity(parsed=p, target=target, raw_sha256=lib.sha256_hex(PAGE), raw_bytes_len=len(PAGE),
                           source_url="https://www.govinfo.gov/content/pkg/USCODE-2024-title9/html/USCODE-2024-title9-chap1-sec2.htm",
                           retrieved_at="2026-10-06T00:00:00Z", http_status=200, route="direct")
        self.assertEqual(e["native_id"], "title-9/section-2")
        self.assertFalse(e["data"]["proxied_fetch"])
        self.assertEqual(e["provenance"]["record_sha256"], lib.record_sha256(e["data"]))
        self.assertTrue(e["provenance"]["raw_object_key"].endswith(".htm"))
        lib.assert_integer_domain(e["data"])

    def test_identity_rules(self):
        import uscode_build_packets as b
        mk = lambda sec: {"title_number": "2", "section_number": sec}
        t = {"title": "2", "section": "261"}
        self.assertTrue(b.identity_ok(mk("261"), t))
        self.assertTrue(b.identity_ok(mk("261_to_270"), t))
        self.assertTrue(b.identity_ok(mk("[261"), t))
        self.assertFalse(b.identity_ok(mk("2610"), t))
        self.assertFalse(b.identity_ok({"title_number": "3", "section_number": "261"}, t))


if __name__ == "__main__":
    unittest.main()
