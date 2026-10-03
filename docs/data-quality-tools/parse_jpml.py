"""Parse the captured JPML CM/ECF text reports (read-only). Output: parsed_*.json next to this file."""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
SRC = "C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/full-matter-audit/"
HERE = os.path.dirname(os.path.abspath(__file__))


def clean(s):
    return re.sub(r"\s+", " ", s).strip()


def parse_actions(path):
    """Distribution of Pending MDL Dockets by Actions Pending: district, judge (title), MDL, caption, pending, total."""
    rows = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"^\s{0,4}(?P<district>[A-Z]{1,4})?\s+(?P<judge>[A-Z][^()]*?\([^)]*\))\s+MDL\s*-(?P<mdl>\d{3,4})\s+(?P<cap>.+?)\s{2,}(?P<pend>[\d,]+)\s+(?P<tot>[\d,]+)\s*$", line)
        if not m:
            continue
        rows.append({
            "mdl": int(m["mdl"]), "district": (m["district"] or "").strip() or None, "judge_title": clean(m["judge"]),
            "caption": clean(m["cap"]), "pending": int(m["pend"].replace(",", "")), "total": int(m["tot"].replace(",", "")),
        })
    return rows


def parse_dockets(path):
    """Docket Summary Listing: MDL number, caption (may wrap), transferee judge (surname, first), district, master docket, dates."""
    lines = open(path, encoding="utf-8").read().split("\n")
    rows = []
    i = 0
    pat = re.compile(r"^\s{0,6}(?P<mdl>\d{3,4})\s+(?P<cap>.+?)\s{2,}(?P<judge>[A-Z][A-Za-z'’.\- ]+,\s[^\d]*?)\s{2,}(?P<district>[A-Z]{1,4})\s+(?P<docket>\d:\d{2}-[a-z]{2}-\d{1,5})\s+(?P<filed>\d{2}/\d{2}/\d{4})\s+(?P<transferred>\d{2}/\d{2}/\d{4})\s*(?P<closed>\d{2}/\d{2}/\d{4})?\s*$")
    while i < len(lines):
        m = pat.match(lines[i])
        if m:
            cap = clean(m["cap"])
            # wrapped caption: following non-empty line indented, without MDL number / date columns
            j = i + 1
            while j < len(lines) and lines[j].strip() and not re.match(r"^\s{0,6}\d{3,4}\s", lines[j]) and not re.search(r"\d{2}/\d{2}/\d{4}", lines[j]) and "CM/ECF" not in lines[j] and not lines[j].startswith("http"):
                cap += " " + clean(lines[j])
                j += 1
            rows.append({
                "mdl": int(m["mdl"]), "caption": cap, "judge": clean(m["judge"]), "district": m["district"], "master_docket": m["docket"],
                "date_filed": m["filed"], "date_transferred": m["transferred"], "date_closed": m["closed"],
            })
        i += 1
    return rows


out = {}
for tag, name in (("2026-10-01", "jpml-2026-10-01.txt"), ("2026-09-01", "jpml-2026-09-01.txt")):
    out["actions_" + tag] = parse_actions(SRC + name)
out["dockets_2026-10-01"] = parse_dockets(SRC + "jpml-master-dockets-2026-10-01.txt")
for k, v in out.items():
    print(k, len(v))
json.dump(out, open(os.path.join(HERE, "parsed_jpml.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
