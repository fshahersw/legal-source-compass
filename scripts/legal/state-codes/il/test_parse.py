#!/usr/bin/env python3
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse import parse_act, path_for

ACT100_TEXT = (
    "Sec. 1. Any person holding office under the Constitution of the State of Illinois and every elected official of local "
    "government or of any school district who is convicted in any court of the State of Illinois or of the United States "
    "of a felony, bribery, perjury, or other infamous crime, as understood in Section 1 of Article XIII of the Constitution "
    "of 1970, shall be, upon conviction, ineligible to continue in such office.\n"
    "If, subsequently, a final order reverses the conviction, eligibility to hold the office, to the extent of the original "
    "term then remaining, is restored, and the officer shall be reinstated, for the duration of the term of office remaining. "
    "Each such officer shall be promptly repaid all compensation withheld from him as a result of his removal. No rights of an "
    "officer under any pension plan subject to the jurisdiction of this State, of which the officer is a member at the time "
    "of his ineligibility for office, shall be abridged if the officer is returned to office by this Act.\n"
    "After conviction and until a final order of reversal, there shall be no payment of compensation to any such officer. "
    "Upon the conviction and ineligibility of any person under this Act, a successor shall be chosen according to law. This "
    "successor shall hold office for the remainder of the term or until a final order reversing the conviction is entered."
)


class IlParseTest(unittest.TestCase):
    def test_act_100_matches_landed_rows(self):
        root = Path("/tmp/sc/IL2")
        if not (root / "receipts.jsonl").exists():
            self.skipTest("IL2 sweep artifacts not present")
        html = None
        for line in open(root / "receipts.jsonl", encoding="utf-8"):
            r = json.loads(line)
            if r.get("label") == "act:act-100":
                html = (root / r["stored_path"]).read_text(encoding="utf-8")
                break
        self.assertIsNotNone(html)
        _, secs = parse_act(html)
        self.assertEqual(len(secs), 2)
        by_path = {}
        counts = {}
        for s in secs:
            counts[s["citation"]] = counts.get(s["citation"], 0) + 1
            by_path[path_for(s["citation"], counts[s["citation"]])] = s
        self.assertEqual(
            by_path["5 ILCS 280/0.01"]["text"],
            "Sec. 0.01. Short title. This Act may be cited as the Officials Convicted of Infamous Crimes Act.",
        )
        self.assertEqual(by_path["5 ILCS 280/1"]["text"], ACT100_TEXT)


if __name__ == "__main__":
    unittest.main()
