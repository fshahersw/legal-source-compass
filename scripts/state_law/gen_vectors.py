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
           "4C1/2", "  Sec 3 ", "79-32,117", "31\u20133302.06a", "[3-1210.12]"]
CITES = ["Fla. Stat. § 95.11(3)(a)", "Fla. Stat. §§95.11 et seq.", "M.G.L. c. 260, section 2A", "735 ILCS 5/13–202.",
         "(a)", "Cal. Civ. Proc. Code § 335.1", "Code Civ. Proc. sec. 335.1 (b)(2)",
         "Md. Code Ann., Cts. & Jud. Proc. § 5-101", "Mass. Gen. Laws ch. 93A, § 9", "Pen. Code, § 187, subd. (a)",
         "  FLA.  STAT.  §  768.81 ", "Fla. Stat. ch. 95", "K.S.A. 2025 Supp. 79-32,117(a)", "14 M.R.S. § 752-C(1)"]
PROBES = {
    "FL": ["Fla. Stat. § 95.11(3)(a)", "F.S. 95.11", "Florida Statutes section 768.81", "Fla. Stat. ch. 95"],
    "CA": ["Cal. Civ. Proc. Code § 335.1", "Code Civ. Proc. § 335.1", "CCP 335.1", "Pen. Code, § 187, subd. (a)",
           "Cal. Penal Code § 187(a)", "Civ. Code § 1714", "Gov't Code § 12940"],
    "IL": ["735 ILCS 5/13-202", "735 Ill. Comp. Stat. 5/13-202", "735 ILCS 5/13-202.1(a)"],
    "MA": ["Mass. Gen. Laws ch. 260, § 2A", "M.G.L. c. 93A, § 9", "G.L. c. 260, s. 2A", "MGL ch. 260 § 4C1/2"],
    "MD": ["Md. Code Ann., Cts. & Jud. Proc. § 5-101", "CJP § 5-101", "Md. Code, Courts and Judicial Proceedings § 5-101"],
    "AZ": ["A.R.S. § 12-542", "Ariz. Rev. Stat. Ann. § 12-542(1)", "ARS 12-542"],
    "KY": ["KRS 413.140(1)(a)", "Ky. Rev. Stat. Ann. § 413.140"],
    "LA": ["La. R.S. 9:5604", "La. Stat. Ann. § 9:5604", "La. Civ. Code art. 3492", "La. C.C.P. art. 1001"],
    "AL": ["Ala. Code § 6-2-38", "Ala. Code 1975, § 6-2-38(l)", "Code of Alabama § 6-2-38"],
    "CT": ["Conn. Gen. Stat. § 52-577", "C.G.S. § 52-584", "General Statutes § 52-577"],
    "DE": ["10 Del. C. § 8106", "Del. Code Ann. tit. 10, § 8106(a)", "tit. 10, § 8119"],
    "DC": ["D.C. Code § 12-301(a)(8)", "D.C. Official Code § 28:2-725", "DC Code § 12-301"],
    "HI": ["Haw. Rev. Stat. § 657-7", "HRS § 657-1.5", "Hawaii Revised Statutes § 657-7"],
    "ID": ["Idaho Code § 5-219(4)", "I.C. § 5-219", "Idaho Code Ann. § 5-224"],
    "IA": ["Iowa Code § 614.1(2)", "Iowa Code Ann. § 614.8A", "I.C.A. § 614.1"],
    "KS": ["K.S.A. 60-513(a)(4)", "K.S.A. 2025 Supp. 79-32,117", "Kan. Stat. Ann. § 60-513a"],
    "ME": ["14 M.R.S. § 752", "14 M.R.S.A. § 752-C", "Me. Rev. Stat. tit. 14, § 752", "22-A M.R.S. § 205"],
    "AK": ["AS 09.10.070", "Alaska Stat. § 09.10.070(a)", "A.S. 09.10.010"],
    "IN": ["Ind. Code § 34-11-2-4", "IC 34-11-2-4(a)", "Ind. Code Ann. § 1-1-3.5-1.5"],
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
