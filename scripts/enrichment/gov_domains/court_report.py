"""Write private/build/gov_domains/court_domains.md: registered government domains that belong to courts, mapped to court
directory entries only on an exact name match.

  python3 -I -B scripts/enrichment/gov_domains/court_report.py

Reads private/build/gov_domains/gov_domains.json (the build) and private/build/gov_domains/lookups/court_spine.json (a
read-only copy of the court directory made by save_mcp_rows.py). Changes nothing else; the lead decides what the court pages
show. Matching rules are in court_domains_lib.py.
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import court_domains_lib as cd  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "gov_domains")


def cell(text) -> str:
    return str(text if text not in (None, "") else "Not recorded").replace("|", "/").replace("\n", " ")


def table(headers: list[str], rows: list[list]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(cell(c) for c in row) + " |" for row in rows]
    return out


def publisher_line(gov: dict) -> str:
    return "; ".join(f"{field}: {text}" for field, text in cd.publisher_names(gov)) or "no publisher name"


def type_line(gov: dict) -> str:
    parts = []
    if gov.get("cisa") and gov["cisa"].get("type"):
        parts.append(f"CISA {gov['cisa']['type']}")
    for r in (gov.get("gsa") or {}).get("rows", []):
        if r.get("type"):
            parts.append(f"GSA {r['type']}")
    return "; ".join(dict.fromkeys(parts)) or "type not recorded"


def main() -> None:
    with open(os.path.join(BUILD, "gov_domains.json"), encoding="utf-8") as handle:
        build = json.load(handle)
    with open(os.path.join(BUILD, "lookups", "court_spine.json"), encoding="utf-8") as handle:
        spine = json.load(handle)
    with open(os.path.join(BUILD, "lookups", "court_spine.meta.json"), encoding="utf-8") as handle:
        spine_meta = json.load(handle)
    titles, shorts = cd.directory_index(spine)
    entries = []
    for row in build["rows"]:
        gov = row["item"]["gov"]
        ok, why = cd.is_candidate(gov)
        if ok:
            entries.append({"gov": gov, "why": why, "kind": cd.classify_name(gov), "match": cd.match_court(gov, titles, shorts)})
    status = Counter(e["match"]["status"] for e in entries)
    kind = Counter(e["kind"] for e in entries)
    matched = sorted((e for e in entries if e["match"]["status"] == "matched"), key=lambda e: (e["match"]["court"]["id"], e["gov"]["host"]))
    lines = [
        "# Court domains in the government registries",
        "",
        f"Built from `gov_domains` ({len(build['rows']):,} entries; CISA .gov registry zone export "
        f"{build['summary']['snapshot']['cisa_zone_export_utc']}, GSA list commit date {build['summary']['snapshot']['gsa_commit_date']}) "
        f"and a read-only copy of the court directory `court_spine` ({len(spine):,} entries; {spine_meta['rows']:,} rows saved).",
        "",
        "## Method",
        "",
        "- A registry entry is a **candidate** when a name its publisher gives (CISA organization or suborganization; GSA agency, "
        "maintaining office or note) contains the word Court, Courts, Judicial or Judiciary, or when only its domain text contains "
        "\"court\" or \"judic\". Words inside other words (Courthouse, Courtland) do not count in a publisher name.",
        "- A candidate is **matched** to a court directory entry only when one of its publisher names equals the entry's title "
        "(case and spacing ignored, nothing else), exactly one entry has that title, and the publisher's state does not "
        "contradict the entry's state. Nothing is matched on part of a name, a similar name, the domain text or a short name.",
        "- Same title in another state, short-name-only equality and ambiguity are listed apart and never matched. The court pages "
        "are not changed; the lead decides.",
        "",
        "## Counts",
        "",
        f"- Candidates: **{len(entries)}** ({', '.join(f'{k}: {v}' for k, v in sorted(kind.items()))})",
        f"- Matched exactly to one directory entry: **{status['matched']}** (distinct courts: {len({e['match']['court']['id'] for e in matched})})",
        f"- Same title as a directory entry in another state (not matched): **{status['state_differs']}**",
        f"- Equal to a short name only (not matched): **{status['short_name_only']}**",
        f"- Ambiguous (several directory entries share the title): **{status['ambiguous']}**",
        f"- Unmatched: **{status['unmatched']}**",
        "",
        "## Matched exactly",
        "",
        *table(
            ["Domain", "Registry type", "Publisher name", "Publisher state", "Directory entry", "Directory title", "Check"],
            [[e["gov"]["host"], type_line(e["gov"]), e["match"]["name"], ", ".join(e["gov"]["states"]), f"/courts/{e['match']['court']['id']}", e["match"]["court"]["title"], e["match"]["detail"]] for e in matched],
        ),
        "",
    ]
    for key, heading in (("state_differs", "Same title in another state (not matched)"), ("ambiguous", "Ambiguous (not matched)"), ("short_name_only", "Equal to a short name only (not matched)")):
        rows = sorted((e for e in entries if e["match"]["status"] == key), key=lambda e: e["gov"]["host"])
        lines += [f"## {heading}", ""]
        if rows:
            lines += table(["Domain", "Registry type", "Publisher name", "Publisher state", "Why not matched"], [[e["gov"]["host"], type_line(e["gov"]), e["match"]["name"], ", ".join(e["gov"]["states"]), e["match"]["detail"]] for e in rows])
        else:
            lines.append("None.")
        lines.append("")
    for k in ("names a court", "office or body around a court", "domain text only"):
        rows = sorted((e for e in entries if e["match"]["status"] == "unmatched" and e["kind"] == k), key=lambda e: e["gov"]["host"])
        lines += [f"## Unmatched: {k} ({len(rows)})", ""]
        if rows:
            lines += table(["Domain", "Registry type", "Publisher names", "State"], [[e["gov"]["host"], type_line(e["gov"]), publisher_line(e["gov"]), ", ".join(e["gov"]["states"])] for e in rows])
        else:
            lines.append("None.")
        lines.append("")
    path = os.path.join(BUILD, "court_domains.md")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    print(os.path.relpath(path, ROOT), "candidates", len(entries), dict(status))


if __name__ == "__main__":
    main()
