"""Offline tests of the state administrative code stream (no network).

  python3 -I -B -m unittest discover -s scripts/state_regs -p "test_*.py"

Parsers run on excerpts of real publisher pages (fixtures/, MANIFEST.json gives their URLs and full-page hashes); every
parsed rule's text, heading and history must be found, line by line in order, in the independent rendering of the same
bytes. Citation keys must equal the shared vectors (also checked against SQL by state-regs-contract.test.mjs).
"""
from __future__ import annotations

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib  # noqa: E402
import model  # noqa: E402
from cite import cite_key, PATTERNS  # noqa: E402
from sources import SOURCES, check  # noqa: E402
from states import fl, il, mi, mn, nc, oh, or_, wa, worddoc  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
ENTRY = {"sha256": "0" * 64, "retrieved_at": "2026-10-23T00:00:00Z"}


def fixture(name: str) -> bytes:
    with open(os.path.join(FIX, name), "rb") as h:
        return h.read()


def checked(rules: list[dict], raw: bytes, test: unittest.TestCase) -> None:
    ref = lib.squash(lib.html_text(raw))
    for r in rules:
        model.check_rule(r)
        for field in ("text", "heading", "history"):
            if r[field]:
                ok, share = lib.contained(r[field], ref)
                test.assertTrue(ok, f"{r['id']} {field} share={share}")


class Sources(unittest.TestCase):
    def test_registry(self):
        check()
        self.assertEqual(len(SOURCES), 51)
        blocked = {s["state"] for s in SOURCES if s["status"] in ("commercial_only", "paid_official", "vendor_operated")}
        self.assertTrue({"CA", "NY", "NJ", "VT", "MA", "GA"} <= blocked)
        for s in SOURCES:
            self.assertFalse(lib.is_commercial(s["code_url"]), s["state"])

    def test_commercial_hosts_refused(self):
        for u in ("https://govt.westlaw.com/calregs/", "https://advance.lexis.com/x", "https://law.justia.com/x",
                  "https://www.casetext.com/x", "https://codes.findlaw.com/x", "https://public.fastcase.com/x"):
            self.assertTrue(lib.is_commercial(u), u)
            with self.assertRaises(lib.Blocked):
                lib.fetch(u)
        self.assertFalse(lib.is_commercial("https://codes.ohio.gov/ohio-administrative-code"))


class Cite(unittest.TestCase):
    def test_vectors(self):
        with open(os.path.join(HERE, "cite_vectors.json")) as h:
            vec = json.load(h)["vectors"]
        for v in vec:
            self.assertEqual(cite_key(v["state"], v["citation"]), v["key"], v)

    def test_no_fallback(self):
        self.assertIsNone(cite_key("OH", "Chapter 3745-31"))
        self.assertIsNone(cite_key("TX", "Title 16"))
        self.assertIsNone(cite_key("ZZ", "1.1"))
        self.assertEqual(len({(p[0], p[1]) for p in PATTERNS}), len(PATTERNS))


class Model(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(model.us_date("August 14, 2025"), "2025-08-14")
        self.assertEqual(model.us_date("3/15/25"), "2025-03-15")
        self.assertEqual(model.us_date("7-10-14"), "2014-07-10")
        self.assertIsNone(model.us_date("13/40/2025"))
        self.assertIsNone(model.us_date("sometime"))

    def test_rule_rejects_bad_values(self):
        with self.assertRaises(AssertionError):
            model.rule("OH", number="1", citation="Ohio Adm.Code 3745-4-01", node_id=None, heading=None, text="x",
                       source_url="ftp://x", raw_sha256="0" * 64, retrieved_at="x")
        with self.assertRaises(ValueError):
            model.rule("OH", number="1", citation="Chapter 3745-4", node_id=None, heading=None, text="x",
                       source_url="https://x", raw_sha256="0" * 64, retrieved_at="x")

    def test_containment_is_ordered_and_exact(self):
        ref = lib.squash("Alpha line one.\n§\nBeta line two.")
        self.assertEqual(lib.contained("Alpha line one.\nBeta line two.", ref), (True, 1.0))
        self.assertFalse(lib.contained("Beta line two.\nAlpha line one.", ref)[0])
        self.assertFalse(lib.contained("Alpha line one changed.", ref)[0])


class Parsers(unittest.TestCase):
    def test_ohio(self):
        raw = fixture("oh_chapter_excerpt.html")
        unit = {"id": "oh:chapter-3745-4", "agency": "Ohio Environmental Protection Agency"}
        rules = oh.parse_chapter(raw, "https://codes.ohio.gov/ohio-administrative-code/chapter-3745-4", unit, ENTRY)
        self.assertEqual([r["id"] for r in rules], ["oh:3745-4-1", "oh:3745-4-2"])
        r = rules[0]
        self.assertEqual(r["citation"], "Ohio Adm.Code 3745-4-01")
        self.assertEqual(r["heading"], "Purpose and applicability.")
        self.assertEqual(r["effective_date"], "2025-07-10")
        self.assertTrue(r["text"].startswith("(A) The purpose of this chapter, credible data rules,"))
        self.assertIn("Five Year Review Date: 7/10/2030", r["history"])
        self.assertEqual(r["currency"], "Last updated July 10, 2025 at 10:03 AM")
        checked(rules, raw, self)

    def test_washington(self):
        raw = fixture("wa_chapter_excerpt.html")
        rules = wa.parse_chapter(raw, "https://app.leg.wa.gov/wac/default.aspx?cite=173-400&full=true",
                                 {"id": "wa:173-400", "agency": "Ecology"}, ENTRY)
        self.assertEqual([r["number"] for r in rules], ["173-400-010", "173-400-020", "173-400-025"])
        r = rules[1]
        self.assertEqual(r["register_citation"], "WSR 25-05-042")
        self.assertEqual(r["effective_date"], "2025-03-15")
        self.assertEqual(r["source_url"], "https://app.leg.wa.gov/wac/default.aspx?cite=173-400-020")
        self.assertEqual(r["currency"], "Last update: 8/11/26")
        checked(rules, raw, self)

    def test_minnesota(self):
        raw = fixture("mn_full_excerpt.html")
        rules = mn.parse_full(raw, "https://www.revisor.mn.gov/rules/1400/full", {"id": "mn:1400"}, ENTRY)
        self.assertGreaterEqual(len(rules), 3)
        for r in rules:
            self.assertRegex(r["number"], r"^1400\.\d{4}$")
        repealed = [r for r in rules if r["status"] == "repealed"]
        for r in repealed:
            self.assertTrue(r["text"].startswith("[Repealed"))
        checked(rules, raw, self)

    def test_oregon(self):
        raw = fixture("or_division_excerpt.html")
        rules = or_.parse_division(raw, "https://secure.sos.state.or.us/oard/displayDivisionRules.action?selectedDivision=2550",
                                   {"id": "or:581-001", "agency": "Oregon Department of Education"}, ENTRY)
        self.assertEqual(len(rules), 3)
        self.assertTrue(all("JSESSIONID" not in r["source_url"] for r in rules))
        r = [x for x in rules if x["number"] == "581-001-0005"]
        if r:
            self.assertEqual(r[0]["effective_date"], "2012-04-02")
            self.assertTrue(r[0]["history"].startswith("ODE 10-2012"))
        checked(rules, raw, self)

    def test_north_carolina(self):
        raw = fixture("nc_subchapter_excerpt.html")
        url = ("http://reports.oah.state.nc.us/ncac/title%2015a%20-%20environmental%20quality/chapter%2002%20-%20"
               "environmental%20management/subchapter%20a/subchapter%20a%20rules.html")
        rules = nc.parse_subchapter(raw, url, {"id": "nc:15a-02a", "agency": "Environmental Quality"}, ENTRY)
        self.assertEqual([r["number"] for r in rules][:2], ["15A NCAC 02A .0101", "15A NCAC 02A .0102"])
        self.assertEqual(rules[0]["status"], "expired")
        self.assertIsNone(rules[0]["text"])
        self.assertEqual(rules[1]["id"], "nc:15a-2a-102")
        checked(rules, raw, self)

    def test_michigan(self):
        raw = fixture("mi_set_excerpt.html")
        rules = mi.parse_set(raw, "https://ars.apps.lara.state.mi.us/AdminCode/DownloadAdminCodeFile?FileName=x&ReturnHTML=True",
                             {"id": "mi:r-336.201", "agency": "EGLE"}, ENTRY)
        self.assertEqual([r["number"] for r in rules], ["R 336.201", "R 336.202", "R 336.203"])
        self.assertEqual(rules[0]["history"], "History: 1980 AACS.")
        for r in rules:
            self.assertNotIn("Courtesy of Michigan Administrative Rules", r["text"] or "")
        checked(rules, raw, self)

    def test_illinois(self):
        raw = fixture("il_section.html")
        unit = {"id": "il:35-101", "citation": "35 Ill. Adm. Code 101"}
        r = il.parse_section(raw, "https://www.ilga.gov/ftp/JCAR/AdminCode/035/035001010A01000R.html", unit, ENTRY,
                             {"modified": "2023-04-15"})
        self.assertEqual(r["citation"], "35 Ill. Adm. Code 101.100")
        self.assertEqual(r["register_citation"], "43 Ill. Reg. 9674")
        self.assertEqual(r["effective_date"], "2019-08-22")
        self.assertEqual(r["agency"], "POLLUTION CONTROL BOARD")
        checked([r], raw, self)

    def test_florida_word_file(self):
        raw = fixture("fl_rule.doc")
        text = worddoc.doc_text(raw)
        self.assertRegex(text.split("\n")[0], r"^\d+[A-Z]*-\d+\.\d+")
        number = text.split()[0]
        r = fl.parse_rule(text, {"number": number, "title": None, "effective": None}, {"id": "fl:x", "agency": None},
                          ENTRY, "https://www.flrules.org/gateway/ChapterHome.asp?Chapter=x")
        self.assertTrue(r["history"].startswith(("Rulemaking Authority", "Specific Authority")))
        ref = lib.squash(text)
        for field in ("heading", "history"):
            self.assertTrue(lib.contained(r[field], ref)[0], field)


if __name__ == "__main__":
    unittest.main()
