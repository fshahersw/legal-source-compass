#!/usr/bin/env python3
"""Re-fetch MO chapter captures that are too small or failed parse."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "b4"))
from sweep import BROWSER_UA, fetch_one  # noqa: E402
import sc_common as sc  # noqa: E402
from parse import parse_chapter  # noqa: E402


def main():
    root = pathlib.Path("/tmp/sc/MO")
    units = {u["unit_key"]: u for u in json.load(open(root / "stored_units.json"))}
    receipts = json.load(open(root / "receipts.json"))
    gaps = json.load(open(root / "landing/gaps.json"))
    arc = sc.Archive(str(root), min_interval=0.35, user_agent=BROWSER_UA)
    for g in gaps:
        uk = g["unit_key"]
        unit = units[uk]
        res = fetch_one(arc, unit)
        if res.get("ok"):
            receipts[uk] = res
    json.dump(receipts, open(root / "receipts.json", "w"), indent=1)
    fixed = []
    for uk, rec in receipts.items():
        html_s = (root / rec["stored_path"]).read_bytes().decode("utf-8", "replace")
        ch = uk.replace("ch", "")
        if parse_chapter(html_s, ch):
            fixed.append(uk)
    print(json.dumps({"receipts": len(receipts), "parseable": len(fixed)}))


if __name__ == "__main__":
    main()
