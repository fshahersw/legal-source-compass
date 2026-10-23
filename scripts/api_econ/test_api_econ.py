"""Offline tests of the api-econ builders' pure parts (synthetic inputs, temporary files; no network, no credentials).

  python3 -I -B -m unittest scripts/api_econ/test_api_econ.py      (run from the repository root)
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_bls  # noqa: E402
import build_life_tables as blt  # noqa: E402
import build_ssa_awi as awi  # noqa: E402
import build_state_rates as sr  # noqa: E402
import crosscheck_pji as pji  # noqa: E402
import econ_common as ec  # noqa: E402
import verify_life_tables as vlt  # noqa: E402


def xlsx(rows: list[list[str]]) -> bytes:
    """A minimal workbook: shared strings for text, numbers as <v>."""
    strings: list[str] = []
    cells = []
    for r, row in enumerate(rows, 1):
        out = []
        for c, v in enumerate(row):
            ref = f"{chr(65 + c)}{r}"
            if v is None:
                continue
            if isinstance(v, str):
                strings.append(v)
                out.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
            else:
                out.append(f'<c r="{ref}"><v>{v}</v></c>')
        cells.append(f'<row r="{r}">{"".join(out)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/sharedStrings.xml", f'<sst {ns}>' + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData>{"".join(cells)}</sheetData></worksheet>')
    return buf.getvalue()


class LifeTables(unittest.TestCase):
    def test_titles_as_published(self):
        cases = {
            "Table 1. Life table for the total population: United States, 2024": ("total", "total"),
            "Table 2. Life table for males: United States, 2024": ("total", "male"),
            "Table 6. Life table for Hispanic females: United States, 2022": ("hispanic", "female"),
            "Table 8. Life table for American Indian and Alaska Native, non-Hispanic males: United States, 2024": ("nh_aian", "male"),
            "Table 7. Life table for the non-Hispanic American Indian or Alaska Native population: United States, 2019": ("nh_aian", "total"),
            "Table 18 Life table for White, non-Hispanic females: United States, 2023": ("nh_white", "female"),
            "Table 10. Life table for the non-Hispanic black population: United States, 2018": ("nh_black", "total"),
        }
        for title, want in cases.items():
            self.assertEqual(blt.classify(title), want, title)
        with self.assertRaises(ValueError):
            blt.classify("Table 3. Something else: United States, 2024")

    def test_parse_normalises_dashes_and_open_interval(self):
        rows = [["Table 1. Life table for the total population: United States, 2021", None],
                ["Age (years)", "q"], [None, "qx", "lx", "dx", "Lx", "Tx", "ex"]]
        rows += [[f"{a}‒{a + 1}", "0.001", "100000", "10", "99990", "7000000", f"{70 - a}.25"] for a in range(100)]
        rows += [["100 and older", "1", "1000", "1000", "2000", "2000", "2.16"], ["SOURCE: NCHS", None]]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.xlsx"
            p.write_bytes(xlsx(rows))
            title, table = blt.parse_table(p)
        self.assertTrue(title.startswith("Table 1."))
        self.assertEqual(table[0][0], "0-1")
        self.assertEqual(table[-1][0], "100 and over")
        self.assertEqual(len(table), 101)

    def test_printed_rounding(self):
        self.assertEqual(blt.ex_display("78.971031188964844"), "79.0")
        self.assertEqual(blt.ex_display("78.95"), "79.0")
        self.assertEqual(vlt.printed(["0-1", "5.5314125493168831E-3", "100000", "553.14", "99515.4453125", "7897103", "78.97"])[1:],
                         ["0.005531", "100,000", "553", "99,515", "7,897,103", "79.0"])


class Awi(unittest.TestCase):
    def test_stated_value_not_a_computation_factor(self):
        text = ("The national average wage index for 1995 is $23,753.53 times $23,700.11 divided by $22,786.73, which equals "
                "$24,705.66. Therefore, the national average wage index for calendar year 1995 is determined to be $24,705.66.")
        self.assertEqual(awi.STATED.findall(text), [("1995", "24,705.66")])
        self.assertEqual(awi.STATED.findall("(3) The national average wage index for 1994 to be $23,753.53;"), [("1994", "23,753.53")])
        self.assertEqual(awi.STATED.findall("In addition, the national average wage index for 2024 is $69,846.57."), [("2024", "69,846.57")])
        self.assertEqual(awi.BASE.findall("It is based on the 2023 national average wage index of $66,621.80, which was"), [("2023", "66,621.80")])


class Bls(unittest.TestCase):
    def test_tsv_and_series_ids(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x"
            p.write_text("series_id        \tyear\tperiod\t       value\tfootnote_codes\nCUUR0000SA0      \t2025\tM10\t           -\tX\n", encoding="latin-1")
            self.assertEqual(build_bls.tsv(p), [{"series_id": "CUUR0000SA0", "year": "2025", "period": "M10", "value": "-", "footnote_codes": "X"}])
        import re
        pat = re.compile(r"^OEU([NSM])(\d{7})000000(\d{6})(\d{2})$")
        self.assertEqual(pat.match("OEUS060000000000000000013").groups(), ("S", "0600000", "000000", "13"))
        self.assertIsNone(pat.match("OEUS060000033300000000013"))  # an industry other than cross-industry


class Pji(unittest.TestCase):
    def test_monday_to_sunday_rule(self):
        for judgment in ("2026-10-12", "2026-10-14", "2026-10-18"):
            self.assertEqual(pji.week_for(judgment), ("2026-10-09", "2026-10-12", "2026-10-18"))
        self.assertEqual(pji.week_for("2026-01-04"), ("2025-12-26", "2025-12-29", "2026-01-04"))
        self.assertEqual(pji.mdy("10/9/2026"), "2026-10-09")


class Common(unittest.TestCase):
    def test_keys_never_recorded(self):
        self.assertEqual(ec.redact("https://api.census.gov/data?get=NAME&key=abc123&for=us:1"),
                         "https://api.census.gov/data?get=NAME&key=[removed]&for=us:1")
        self.assertIn("api_key=[removed]", ec.redact("https://x/fred?series_id=A&api_key=zzz"))

    def test_build_files_refuse_bad_rows(self):
        row = ec.record("econ_test", "a", "A", source_url="https://example.gov/x?key=secret", cells={}, facts=[], text="", filters={})
        with tempfile.TemporaryDirectory() as d, self.assertRaises(SystemExit):
            ec.write_build(Path(d), "econ_test", "T", ec.listing([], []), {}, [row], [])
        ok = ec.record("econ_test", "a", "A", source_url="https://example.gov/x", cells={}, facts=[], text="", filters={})
        with tempfile.TemporaryDirectory() as d:
            info = ec.write_build(Path(d), "econ_test", "T", ec.listing([], []), {}, [ok], [])
            body = json.loads((Path(d) / "econ_test.json").read_text())
        self.assertEqual(info["rows"], 1)
        self.assertEqual(set(body), {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs"})


class StateRates(unittest.TestCase):
    def test_entries_are_cited(self):
        for e in sr.ENTRIES:
            self.assertIn(e["source"], sr.SOURCES)
            self.assertTrue(sr.SOURCES[e["source"]].startswith(("https://", "http://www.leg.state.fl.us/")))
            self.assertGreater(len(e["quote"]), 40)
            self.assertIn(e["kind"], ("prejudgment", "postjudgment"))
            if e["rate_type"] == "fixed":
                self.assertTrue(e["rate_percent"])
        self.assertEqual(sr.norm("a \n  b"), "a b")


if __name__ == "__main__":
    unittest.main()
