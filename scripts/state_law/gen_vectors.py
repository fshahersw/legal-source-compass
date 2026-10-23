"""Regenerate norm_vectors.json (shared by test_lib.py and state-law-contract.test.mjs): Python is canonical, the
SQL mirrors must reproduce every expectation. Run after changing lib.norm_* or a state module's citation patterns."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from state_law import lib  # noqa: E402

NUMBERS = ["§ 95.11", "13–202", " 2A. ", "Sec. 5-101", "735:5/13-202", "Section 1234", "§§ 12-542", "10:8106",
           "4C1/2", "  Sec 3 "]
CITES = ["Fla. Stat. § 95.11(3)(a)", "Fla. Stat. §§95.11 et seq.", "M.G.L. c. 260, section 2A", "735 ILCS 5/13–202.",
         "(a)", "Cal. Civ. Proc. Code § 335.1", "Code Civ. Proc. sec. 335.1 (b)(2)",
         "Md. Code Ann., Cts. & Jud. Proc. § 5-101", "Mass. Gen. Laws ch. 93A, § 9", "Pen. Code, § 187, subd. (a)",
         "  FLA.  STAT.  §  768.81 ", "Fla. Stat. ch. 95"]
PROBES = {
    "FL": ["Fla. Stat. § 95.11(3)(a)", "F.S. 95.11", "Florida Statutes section 768.81", "Fla. Stat. ch. 95"],
    "CA": ["Cal. Civ. Proc. Code § 335.1", "Code Civ. Proc. § 335.1", "CCP 335.1", "Pen. Code, § 187, subd. (a)",
           "Cal. Penal Code § 187(a)", "Civ. Code § 1714", "Gov't Code § 12940"],
    "IL": ["735 ILCS 5/13-202", "735 Ill. Comp. Stat. 5/13-202", "735 ILCS 5/13-202.1(a)"],
    "MA": ["Mass. Gen. Laws ch. 260, § 2A", "M.G.L. c. 93A, § 9", "G.L. c. 260, s. 2A", "MGL ch. 260 § 4C1/2"],
    "MD": ["Md. Code Ann., Cts. & Jud. Proc. § 5-101", "CJP § 5-101", "Md. Code, Courts and Judicial Proceedings § 5-101"],
}


def codes(state: str):
    spec = importlib.util.spec_from_file_location(state, HERE / "states" / f"{state.lower()}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.META.codes


def build() -> dict:
    out = {"norm_number": [{"input": n, "expected": lib.norm_number(n)} for n in NUMBERS],
           "norm_cite": [{"input": c, "expected": list(lib.norm_cite(c))} for c in CITES], "patterns": []}
    for state, inputs in PROBES.items():
        cs = codes(state)
        pats = [{"code": c.code, "regex": p.regex, "number": p.number} for c in cs for p in c.all_patterns()]
        for text in inputs:
            out["patterns"].append({"state": state, "input": text,
                                    "expected": [list(h) for h in lib.apply_patterns(cs, text)], "patterns": pats})
    return out


if __name__ == "__main__":
    (HERE / "norm_vectors.json").write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n")
    print("wrote norm_vectors.json")
