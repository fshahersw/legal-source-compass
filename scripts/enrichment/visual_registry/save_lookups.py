"""Turn read-only corpus query results (saved as text) into JSON lookups, checked against the live md5 fingerprint.

  python3 -I -B save_lookups.py <name> <live_md5>

Each lookups/<name>.txt holds the exact string a read-only SELECT aggregated (string_agg in a fixed order); the
same query's md5 is passed on the command line. A text whose md5 differs is refused (a transcription error or a
changed table), so a lookup is only ever the live table's exact content.
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import BUILD  # noqa: E402

QUERIES = {
    "committees": ("congress_committees, level committee, current yes: id=chamber=system_code=website, '|' joined, "
                   "ordered by id (C collation)"),
    "company_profiles": "company_sec_profiles rows with item.summary: id, ',' joined, ordered by id (C collation)",
    "fr_agencies": "fr_agency_profiles rows for the registry's agency fr_ids: id=title, ' | ' joined, ordered by id::int",
    "committee_titles": "congress_committees titles of the committees with a lead: id=title, '|' joined, ordered by id",
    "judge_fjc": ("judge_profiles_fjc rows whose filters.fjc_nid is one of the FJC node ids read from the FJC pages: "
                  "fjc_nid=title=judge_profile values (',' joined), '|' joined, ordered by fjc_nid (C collation)"),
    "judge_photos": ("judges rows for those judge_profile ids: id=1 when item.photo_url is a non-empty string, else "
                     "id=0, '|' joined, ordered by id (C collation)"),
    "state_judges": ("judges rows whose normalised title (lower case, runs of non a-z0-9 as one space, trimmed) "
                     "equals a state/special-court registry judge's normalised name in a state named by that "
                     "person's registry roles (state_judges.py sql): id=title=states(';')=has photo_url(1/0), "
                     "'|' joined, ordered by id (C collation)"),
}


def parse(name, text):
    if name == "committees":
        out = {}
        for part in text.split("|"):
            cid, chamber, code, website = part.split("=", 3)
            out[cid] = {"chamber": chamber, "system_code": code, "website": website}
        return out
    if name == "company_profiles":
        return sorted(text.split(","))
    if name == "fr_agencies":
        out = {}
        for part in text.split(" | "):
            aid, title = part.split("=", 1)
            out[aid] = title
        return out
    if name == "committee_titles":
        return dict(part.split("=", 1) for part in text.split("|"))
    if name == "judge_fjc":
        out = {}
        for part in text.split("|"):
            nid, rest = part.split("=", 1)
            title, profiles = rest.rsplit("=", 1)
            out[nid] = {"title": title, "judge_profile": [p for p in profiles.split(",") if p]}
        return out
    if name == "state_judges":
        rows = []
        for part in text.split("|"):
            jid, rest = part.split("=", 1)
            title, states, photo = rest.rsplit("=", 2)
            rows.append({"id": jid, "title": title, "states": [s for s in states.split(";") if s],
                         "has_photo": photo == "1"})
        return rows
    if name == "judge_photos":
        return {k: v == "1" for k, v in (part.split("=", 1) for part in text.split("|"))}
    raise SystemExit(f"unknown lookup {name}")


def main(name, live_md5):
    src = BUILD / "lookups" / f"{name}.txt"
    text = src.read_text().rstrip("\n")
    digest = hashlib.md5(text.encode()).hexdigest()
    if digest != live_md5:
        raise SystemExit(f"{name}: md5 {digest} differs from the live query's {live_md5}")
    data = parse(name, text)
    meta = {"query": QUERIES[name], "md5": digest, "live_md5": live_md5, "rows": len(data),
            "checked_live_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "project": "corpus (read-only)"}
    (BUILD / "lookups" / f"{name}.json").write_text(json.dumps({"meta": meta, "data": data}, indent=1) + "\n")
    print(name, "rows", len(data), "md5 ok")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
