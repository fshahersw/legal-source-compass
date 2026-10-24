"""Offline tests for scripts/state_law/lib.py, run.py plumbing and verify.py (synthetic bytes only)."""
from __future__ import annotations

import gzip
import io
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from state_law import lib  # noqa: E402
from state_law import verify as verify_mod  # noqa: E402


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]):
        self.pages = pages
        self.requests = 0

    def get(self, url, *, data=None, headers=None, method="publisher_page", accept_status=(200,)):
        body = self.pages[url]
        self.requests += 1
        import hashlib

        return lib.Fetched(url=url, final_url=url, status=200, headers={"content-type": "text/html"}, body=body,
                           sha256=hashlib.sha256(body).hexdigest(), bytes=len(body), retrieved_at="2026-10-24T00:00:00Z",
                           method=method)


META = lib.StateMeta(
    state="ZZ", code_name="Test Statutes", publisher="Test Legislature", publisher_url="https://law.example.gov/",
    official_source=True, access="html", hosts=("law.example.gov",), parser="zz-test/1",
    codes=(lib.Code("TS", "Test Statutes", "Test Stat. § {n}"),
           lib.Code("TT", "Titled Code", "Test Code Ann. tit. {t}, § {s}",
                    patterns=((r"(\d+)\s?t\.?\s?c\.?\s?§\s?([0-9a-z.\-]+)", r"\1:\2"),))),
)


class NormTests(unittest.TestCase):
    def test_norm_number(self):
        self.assertEqual(lib.norm_number("§ 95.11"), "95.11")
        self.assertEqual(lib.norm_number("13–202"), "13-202")
        self.assertEqual(lib.norm_number(" 2A. "), "2a")
        self.assertEqual(lib.norm_number("Sec. 5-101"), "5-101")
        self.assertEqual(lib.norm_number("735:5/13-202"), "735:5/13-202")

    def test_norm_cite(self):
        self.assertEqual(lib.norm_cite("Fla. Stat. § 95.11(3)(a)"), ("fla. stat. § 95.11", "(3)(a)"))
        self.assertEqual(lib.norm_cite("Fla. Stat. §§95.11 et seq."), ("fla. stat. § 95.11", None))
        self.assertEqual(lib.norm_cite("M.G.L. c. 260, section 2A"), ("m.g.l. c. 260, § 2a", None))
        self.assertEqual(lib.norm_cite("735 ILCS 5/13–202."), ("735 ilcs 5/13-202", None))
        self.assertEqual(lib.norm_cite("(a)"), ("(a)", None))

    def test_template_patterns(self):
        regex, number = lib.template_regex("Fla. Stat. § {n}")
        self.assertEqual(number, r"\1")
        hits = lib.apply_patterns(META.codes, "Test Stat. § 1.23(4)")
        self.assertEqual(hits, [("TS", "1.23")])
        self.assertEqual(lib.apply_patterns(META.codes, "Test Code Ann. tit. 10, § 8106"), [("TT", "10:8106")])
        self.assertEqual(lib.apply_patterns(META.codes, "10 T.C. § 8106"), [("TT", "10:8106")])
        self.assertEqual(lib.apply_patterns(META.codes, "Other Stat. § 1"), [])
        self.assertEqual(lib.format_citation("Test Code Ann. tit. {t}, § {s}", "10:8106"), "Test Code Ann. tit. 10, § 8106")

    def test_classify_status(self):
        self.assertEqual(lib.classify_status("Repealed by Laws 2020, ch. 5.", ""), ("repealed", "Repealed by Laws 2020, ch. 5."))
        self.assertEqual(lib.classify_status(None, "[Reserved]")[0], "reserved")
        self.assertEqual(lib.classify_status("Renumbered as § 12-3-4.", None)[0], "renumbered")
        self.assertEqual(lib.classify_status("Definitions.", "In this chapter, repealed statutes mean ..."), (None, None))
        # a catchline that merely starts with a marker word is not a marker
        for heading in ("Transferred employees; rights.", "Reserved powers.", "Repealed laws; savings clause.",
                        "Repealed Laws Not Revived.", "Sunset.", "Terminated employees, benefits."):
            self.assertEqual(lib.classify_status(heading, None), (None, None), heading)
        self.assertEqual(lib.classify_status("Reserved for future use.", None)[0], "reserved")
        self.assertEqual(lib.classify_status("Expired July 1, 2020.", None)[0], "expired")
        self.assertEqual(lib.classify_status("Limitations. [Repealed]", None), ("repealed", "[Repealed]"))

    def test_xml_text_inline_and_instructions(self):
        body = ('<section xmlns="https://code.dccouncil.us/schemas/dc-library" '
                'xmlns:codify="https://code.dccouncil.us/schemas/codify"><num>1-1</num><para><num>(9)</num>'
                '<text>for a violation of <cite path="x">§ 7-1201.01(11)</cite>— 1 year;</text>'
                '<codify:repeal doc="D.C. Law 25-217"/></para><text>a<br/>b</text></section>').encode()
        self.assertEqual(lib.xml_text(body), "1-1\n(9)\nfor a violation of § 7-1201.01(11)— 1 year;\na\nb")

    def test_html_text(self):
        html = b"<html><head><title>x</title><script>var a=1</script></head><body><p>A&nbsp;b <i>c</i></p><div>d<br>e</div></body></html>"
        self.assertEqual(lib.html_text(html), "A b c\nd\ne")
        self.assertEqual(lib.html_text("<p>(1) One;</p><p>(2) Two &amp; three.</p>"), "(1) One;\n(2) Two & three.")

    def test_ids(self):
        self.assertEqual(lib.node_id("FL", "FS", [("title", "VIII"), ("chapter", "95")]), "FL:FS/title:VIII/chapter:95")
        self.assertEqual(lib.node_id("IL", "ILCS", [("chapter", "735"), ("act", "5/1")]), "IL:ILCS/chapter:735/act:5%2F1")
        self.assertEqual(lib.node_id("CA", "CIV", [("division", None)]), "CA:CIV/division:~0")
        self.assertEqual(lib.node_id("CA", "CIV", [("other", None, "Preliminary Provisions")]), "CA:CIV/other:~preliminary-provisions")
        self.assertEqual(lib.section_id("MA", "MGL", "260:2A"), "MA:MGL:260:2A")
        self.assertEqual(lib.section_id("CA", "CIV", "1234", 2), "CA:CIV:1234@2")
        with self.assertRaises(lib.ModelError):
            lib.section_id("CA", "CIV", "1@2")


class ZipTests(unittest.TestCase):
    def test_stream_zip_with_descriptors(self):
        raw = io.BytesIO()

        class NoSeek(io.RawIOBase):
            def writable(self):
                return True

            def write(self, b):
                raw.write(b)
                return len(b)

        with zipfile.ZipFile(NoSeek(), "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("a/one.txt", "first member " * 50)
            archive.writestr("b/two.html", b"<p>second</p>")
            archive.writestr("c/three.txt", "")
        raw.seek(0)
        got = dict(lib.iter_zip_members(io.BufferedReader(raw), want=lambda name: not name.startswith("c/")))
        self.assertEqual(got, {"a/one.txt": ("first member " * 50).encode(), "b/two.html": b"<p>second</p>"})
        seekable = io.BytesIO()
        with zipfile.ZipFile(seekable, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("x.txt", "stored")
        seekable.seek(0)
        self.assertEqual(list(lib.iter_zip_members(seekable)), [("x.txt", b"stored")])


class RunContextTests(unittest.TestCase):
    def test_end_to_end_and_verify(self):
        page = (b"<html><body><h1>Chapter 1 GENERAL</h1><p>1.01 Definitions.</p><p>(1) Words mean words.</p>"
                b"<p>(2) Other words.</p><p>History.\xe2\x80\x94s. 1, ch. 1.</p><p>1.02 Repealed.</p></body></html>")
        with tempfile.TemporaryDirectory() as tmp:
            out, raw = pathlib.Path(tmp, "out"), pathlib.Path(tmp, "raw")
            fetcher = FakeFetcher({"https://law.example.gov/ch1.html": page})
            ctx = lib.RunContext(META, out, raw, sample=10, fetcher=fetcher, log=lambda m: None)
            ctx.edition(edition_label="2026 Test Statutes", currency_statement="Current through the 2026 session.")
            fetched = ctx.fetch("https://law.example.gov/ch1.html")
            path = [{"level": "chapter", "label": "Chapter", "number": "1", "heading": "GENERAL"}]
            sid = ctx.section(code="TS", number="1.01", heading="Definitions.", text="(1) Words mean words.\n(2) Other words.",
                              history="History.—s. 1, ch. 1.", source=fetched, path=path)
            sid2 = ctx.section(code="TS", number="1.02", heading="Repealed.", text="", source=fetched, path=path)
            with self.assertRaises(lib.ModelError):
                ctx.section(code="TS", number="1.03", heading="X", text="<p>markup</p>", source=fetched, path=path)
            with self.assertRaises(lib.ModelError):
                ctx.section(code="TS", number="1.01", heading="Dup", text="dup", source=fetched, path=path)
            # a rejected duplicate keeps no ordinal: the next section is still written
            sid3 = ctx.section(code="TS", number="1.02", heading="Repealed.", text="", source=fetched, path=path,
                               version="b", version_index=2)
            edition = ctx.finish()
            self.assertEqual(sid, "ZZ:TS:1.01")
            self.assertEqual(sid3, "ZZ:TS:1.02@2")
            self.assertEqual(edition["counts"]["by_status"], {"in_force": 1, "repealed": 2})
            self.assertEqual([r["ordinal"] for r in lib.read_jsonl(ctx.dir / "sections.jsonl.gz")], [0, 1, 2])
            rows = list(lib.read_jsonl(ctx.dir / "sections.jsonl.gz"))
            self.assertEqual(rows[0]["citation"], "Test Stat. § 1.01")
            self.assertEqual(rows[0]["status_basis"], "current_compilation")
            self.assertEqual(rows[1]["section_id"], sid2)
            self.assertEqual(rows[1]["status_marker"], "Repealed.")
            nodes = list(lib.read_jsonl(ctx.dir / "nodes.jsonl.gz"))
            self.assertEqual([n["node_id"] for n in nodes], ["ZZ:TS", "ZZ:TS/chapter:1"])
            result = verify_mod.verify(ctx.dir, raw)
            self.assertTrue(result["ok"], result["failures"])
            self.assertEqual(result["counts"]["checked_against_raw"], 3)

    def test_verify_catches_fabricated_text(self):
        page = b"<p>2.01 Scope.</p><p>Real words only.</p>"
        with tempfile.TemporaryDirectory() as tmp:
            out, raw = pathlib.Path(tmp, "out"), pathlib.Path(tmp, "raw")
            ctx = lib.RunContext(META, out, raw, sample=5, fetcher=FakeFetcher({"https://law.example.gov/2": page}),
                                 log=lambda m: None)
            fetched = ctx.fetch("https://law.example.gov/2")
            ctx.section(code="TS", number="2.01", heading="Scope.", text="Invented words.", source=fetched, path=[])
            ctx.finish()
            result = verify_mod.verify(ctx.dir, raw)
            self.assertFalse(result["ok"])
            self.assertEqual(result["failures"][0]["check"], "quote_text")

    def test_host_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = lib.RunContext(META, pathlib.Path(tmp), None, fetcher=FakeFetcher({}), log=lambda m: None)
            with self.assertRaises(lib.ModelError):
                ctx.fetch("https://www.commercial-host.example.com/x")


class EffectiveMarkerTests(unittest.TestCase):
    def test_dated_markers(self):
        import datetime as _dt
        today = _dt.date(2026, 10, 24)
        past = lib.effective_marker("(Effective until January 1, 2026) Surrender of Custody of Minor", today)
        self.assertEqual((past["status"], past["effective"]["end"]), ("expired", "2026-01-01"))
        both = lib.effective_marker("(Effective July 1, 2026; Effective until October 1, 2026)", today)
        self.assertEqual((both["status"], both["effective"]["start"], both["effective"]["end"]),
                         ("expired", "2026-07-01", "2026-10-01"))
        cond = lib.effective_marker("(Effective until September 30, 2025, Unless Extended by the Legislature) Board", today)
        self.assertEqual(cond["status"], "not_recorded")
        self.assertEqual(lib.effective_marker("(Effective January 1, 2027) New text", today)["status"], "future_effective")
        self.assertEqual(lib.effective_marker("[Effective until October 1, 2027] Screening", today), {})
        self.assertEqual(lib.effective_marker("Contract of Employment Effective until Superseded or Cancelled.", today), {})
        thru = lib.effective_marker("License: Expiration; renewal. [Effective through June 30, 2027.]", today)
        self.assertEqual(thru, {})
        self.assertEqual(lib.effective_marker("License. [Effective through October 23, 2026.]", today)["status"], "expired")
        self.assertEqual(lib.effective_marker("License. [Effective July 1, 2027.]", today)["status"], "future_effective")
        for contingent in ("(Effective Upon Ratification of Proposed Constitutional Amendment) Dispositions of Proceeds",
                           "(Effective once contingency met. Contingent expiration, see note.)"):
            self.assertEqual(lib.effective_marker(contingent, today)["status"], "not_recorded", contingent)
        self.assertEqual(lib.effective_marker("(Effective until contingency met)", today), {})
        nv = lib.effective_marker("Powers and duties of Board. [Effective on the effective date of the initial contract "
                                  "entered into pursuant to section 4 of this act.]", today)
        self.assertEqual(nv["status"], "not_recorded")
        self.assertEqual(lib.effective_marker("Powers. [Effective until the effective date of the initial contract.]", today), {})
        # Vermont: "[Section N effective until <date>; see also section N effective <date>, set out below]"
        vt_out = lib.effective_marker("Citation of 16- to 18-year-olds [Section 5206 effective until July 1, 2027; see also "
                                      "section 5206 effective July 1, 2027, set out below]", today)
        self.assertEqual(vt_out, {})
        vt_in = lib.effective_marker("Citation of 16- to 19-year-olds [Section 5206 effective July 1, 2027; see also section "
                                     "5206 effective until July 1, 2027, set out above]", today)
        self.assertEqual((vt_in["status"], vt_in["effective"]["start"], vt_in["effective"]["end"]),
                         ("future_effective", "2027-07-01", None))
        vt_cond = lib.effective_marker("Definitions [Effective July 1, 2029 if contingency met; see also 32 V.S.A. chapter 154 "
                                       "effective until contingency met, set out above]", today)
        self.assertEqual(vt_cond["status"], "not_recorded")
        self.assertEqual(lib.effective_marker("Purpose [Contingently enacted]", today)["status"], "not_recorded")
        self.assertEqual(lib.effective_marker("Purpose and policy [Contingently repealed; effective until contingency met]",
                                              today), {})
        # Nevada's event versions: the outgoing "[Effective until ...]" text stays in force, the incoming one is not
        # recorded (whether the event occurred is not printed); "on the later of <date>, or <event>" is not yet in
        # effect while the date is ahead
        repeal = "the date of the repeal of 42 U.S.C. § 666, the federal law requiring each state to establish procedures.]"
        self.assertEqual(lib.effective_marker("Fees. [Effective until 2 years after " + repeal, today), {})
        self.assertEqual(lib.effective_marker("Fees. [Effective 2 years after " + repeal, today)["status"], "not_recorded")
        court = "a court of competent jurisdiction enters a judgment determining that subsection 2 is unconstitutional.]"
        self.assertEqual(lib.effective_marker("Deposits. [Effective until the date upon which " + court, today), {})
        self.assertEqual(lib.effective_marker("Deposits. [Effective from the date " + court, today)["status"], "not_recorded")
        self.assertEqual(lib.effective_marker("Fees. [Effective from July 1, 2027.]", today), {})
        notify = "or the date on which the Director notifies the Governor that sufficient resources are available.]"
        self.assertEqual(lib.effective_marker("Fees. [Effective until the earlier of December 31, 2026, " + notify, today), {})
        later = lib.effective_marker("Fees. [Effective on the later of January 1, 2027, " + notify, today)
        self.assertEqual((later["status"], later["effective"]["start"]), ("future_effective", None))
        self.assertEqual(lib.effective_marker("Fees. [Effective on the later of January 1, 2026, " + notify, today)["status"],
                         "not_recorded")
        self.assertEqual(lib.effective_marker("License. [Effective on the later of the date on which the Director notifies "
                                              "the Governor, or the date on which the Director notifies the Bureau.]",
                                              today)["status"], "not_recorded")
        self.assertEqual(lib.effective_marker("(Effective on July 1, 2027) Rates", today)["status"], "future_effective")

    def test_first_line_and_module_dates(self):
        import datetime as _dt
        today = _dt.date(2026, 10, 24)
        line = lib.effective_line("Section effective July 1, 2027. See, also, section 57-3-20 effective until July 1, "
                                  "2027.\nThe responsibilities ...", today)
        self.assertEqual((line["status"], line["effective"]["start"]), ("future_effective", "2027-07-01"))
        self.assertEqual(lib.effective_line("Section effective until July 1, 2027. See, also, ...", today), {})
        upon = lib.effective_line("Section effective upon the approval and ratification of an amendment to Section 7, "
                                  "Article VI of the South Carolina Constitution. The referendum ...", today)
        self.assertEqual(upon["status"], "not_recorded")
        self.assertEqual(lib.effective_line("Section effective until the approval and ratification of an amendment.", today), {})
        done = lib.status_from_dates({"start": None, "end": "2026-07-01", "note": None}, "(Effective until July 1, 2026)", today)
        self.assertEqual((done["status"], done["status_marker"]), ("expired", "(Effective until July 1, 2026)"))
        self.assertEqual(lib.status_from_dates({"start": "2026-07-01", "end": None, "note": None}, None, today), {})

    def test_section_applies_the_rules_when_the_module_passes_no_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = lib.RunContext(META, pathlib.Path(tmp, "out"), None, sample=10,
                                 fetcher=FakeFetcher({"https://law.example.gov/v": b"<p>x</p>"}), log=lambda m: None,
                                 today=__import__("datetime").date(2026, 10, 24))
            ctx.edition(edition_label=None, currency_statement=None)
            src = ctx.fetch("https://law.example.gov/v")
            ctx.section(code="TS", number="9.01", heading="Report", text="Old text.", source=src, path=[],
                        version="(Effective until July 1, 2026)", version_index=1,
                        effective={"start": None, "end": "2026-07-01", "note": None})
            ctx.section(code="TS", number="9.01", heading="Report", text="New text.", source=src, path=[],
                        version="(Effective July 1, 2026)", version_index=2,
                        effective={"start": "2026-07-01", "end": None, "note": None})
            ctx.section(code="TS", number="9.02", heading="Duties.", text="Section effective July 1, 2027. See, also, ...\nX.",
                        source=src, path=[])
            # the generic default some modules pass for any entry with text does not hide a dated marker
            ctx.section(code="TS", number="9.03", heading="Rates", text="Old rate.", source=src, path=[],
                        status="in_force", status_basis="current_compilation", version="(Expires July 1, 2026)",
                        effective={"start": None, "end": "2026-07-01", "note": "(Expires July 1, 2026)"})
            ctx.section(code="TS", number="9.04", heading="(For contingent effective date, see Acts 2025, c. 1) Zones",
                        text="New zones.", source=src, path=[], status="in_force", status_basis="current_compilation")
            ctx.finish()
            rows = list(lib.read_jsonl(ctx.dir / "sections.jsonl.gz"))
            self.assertEqual([r["status"] for r in rows],
                             ["expired", "in_force", "future_effective", "expired", "not_recorded"])


class VectorTests(unittest.TestCase):
    def test_vectors_are_current(self):
        from state_law import gen_vectors

        stored = json.loads((HERE / "norm_vectors.json").read_text())
        self.assertEqual(stored, json.loads(json.dumps(gen_vectors.build())))


if __name__ == "__main__":
    unittest.main()
