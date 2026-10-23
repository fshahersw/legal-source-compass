"""Build `fjc_appeals_outcomes` from the FJC Integrated Database appeals file (FY2008 - June 30, 2026).

Input: private/build/judiciary/extract_appeals.tsv.gz (extract_idb.py appeals; decoded codes only, no party names or dockets).
Output: private/build/judiciary/fjc_appeals_outcomes.json (publish_build.py build file).

Definitions follow the AO's Judicial Business Table B-5 so that the national, circuit and nature-of-proceeding totals can be
checked against the published table (verify_idb.py does this for FY2025):
  * terminated appeal: STATUSCD L, fiscal year = TAPEYEAR (FY2026 = Oct 1, 2025 - Jun 30, 2026 only);
  * nature of proceeding (the B-5 rows): type at termination (TRMTYPE, else APPTYPE) and, for civil appeals, the nature of
    suit: criminal 13-21; U.S. prisoner petitions = type 3 with NOS 463, 510, 530, 535, 540, 550, 555, 560; other U.S.
    civil = other type 3; private prisoner petitions / other private civil = type 4 likewise; bankruptcy 10-12;
    administrative agency appeals 1-2; original proceedings and miscellaneous applications 6 and 22;
  * terminated on the merits: DISP 1-3, excluding cross appeals and consolidated member appeals (JOINAPP 1 or 2), which the
    AO counts as terminated by consolidation;
  * outcome on the merits (OUTCOME, appeals other than original proceedings): affirmed/enforced 1, affirmed in part and
    reversed in part 3, reversed/vacated 2, dismissed 5, remanded 6, other 7, certificate of appealability denied 9;
    original proceedings use OPDISP (granted 1, denied 2, dismissed 3);
  * percent reversed = reversed (OUTCOME 2) / merits terminations other than original proceedings (the B-5 definition),
    shown only when that base is at least 10 (the B-5 rule);
  * days to disposition = JUDGDATE - DKTDATE (docketing in the court of appeals to final judgment), merits terminations;
    this is not the AO's B-4 interval (which runs from the notice of appeal);
  * origin district = DDIST (district or bankruptcy court whose decision was appealed); agency appeals carry AGENCY instead.
"""
from __future__ import annotations

import collections
import csv
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import idb_common as ic  # noqa: E402
import jcodes as jc  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
DATASET = "fjc_appeals_outcomes"
SOURCE_PAGE = "https://www.fjc.gov/research/idb/appellate-cases-filed-terminated-and-pending-fy-2008-present"
SOURCE_FILE = "https://www.fjc.gov/sites/default/files/idb/textfiles/ap08on_0.zip"
PRISONER_NOS = {463, 510, 530, 535, 540, 550, 555, 560}
NATURE = [
    ("criminal", "Criminal"), ("us_prisoner", "U.S. prisoner petitions"), ("us_civil", "Other U.S. civil"),
    ("private_prisoner", "Private prisoner petitions"), ("private_civil", "Other private civil"), ("bankruptcy", "Bankruptcy"),
    ("administrative", "Administrative agency appeals"), ("original", "Original proceedings and miscellaneous applications"),
    ("not_recorded", "Type not recorded"),
]
NATURE_LABEL = dict(NATURE)
OUT_KEYS = ["affirmed", "partial", "reversed", "dismissed", "remanded", "other", "coa_denied", "outcome_missing",
            "op_granted", "op_denied", "op_dismissed"]


def nature(trmtype: str, nos: str) -> str:
    t = int(trmtype) if trmtype.lstrip("-").isdigit() else None
    if t is None:
        return "not_recorded"
    if t in (1, 2):
        return "administrative"
    if t in (6, 22):
        return "original"
    if t in (10, 11, 12):
        return "bankruptcy"
    if 13 <= t <= 21:
        return "criminal"
    n = int(nos) if nos.isdigit() else None
    if t == 3:
        return "us_prisoner" if n in PRISONER_NOS else "us_civil"
    if t == 4:
        return "private_prisoner" if n in PRISONER_NOS else "private_civil"
    return "not_recorded"


class Acc:
    """Counters plus the day values needed for medians, for one cell."""

    __slots__ = ("c", "days")

    def __init__(self):
        self.c = collections.Counter()
        self.days: list[int] = []

    def add(self, rec: dict) -> None:
        c = self.c
        c["terminated"] += 1
        if rec["consolidated"]:
            c["consolidated"] += 1
        if rec["procedural"]:
            c["procedural"] += 1
        if rec["merits"]:
            c["merits"] += 1
            if rec["nature"] == "original":
                c["merits_original"] += 1
            else:
                c["merits_appeals"] += 1
            c[rec["outcome"]] += 1
            if rec["pub"] is not None:
                c["pub_recorded"] += 1
                c["published"] += rec["pub"]
            if rec["days"] is not None:
                self.days.append(rec["days"])

    def summary(self) -> dict:
        c = self.c
        base = c["merits_appeals"]
        out = {
            "terminated": c["terminated"], "merits": c["merits"], "merits_appeals": base, "merits_original": c["merits_original"],
            "procedural": c["procedural"], "consolidated": c["consolidated"],
            **{k: c[k] for k in OUT_KEYS},
            "reversed_pct": ic.pct(c["reversed"], base),
            "affirmed_pct": ic.pct(c["affirmed"] + c["partial"], base),
            "published_pct": ic.pct(c["published"], c["pub_recorded"]),
            "median_days": ic.median(self.days),
            "days_n": len(self.days),
        }
        return out


def decode(row: dict) -> dict | None:
    """One extract line -> the fields the roll-ups use; None for pending records (counted separately)."""
    if row["status"] != "L":
        return None
    nat = nature(row["trmtype"], row["nos"])
    disp = int(row["disp"]) if row["disp"].lstrip("-").isdigit() else None
    consolidated = row["joinapp"] in ("1", "2")
    merits = disp in jc.MERITS_DISP and not consolidated
    outcome = None
    if merits:
        if nat == "original":
            outcome = {"1": "op_granted", "2": "op_denied", "3": "op_dismissed"}.get(row["opdisp"], "outcome_missing")
        else:
            code = int(row["outcome"]) if row["outcome"].lstrip("-").isdigit() else None
            outcome = jc.OUTCOME_KEY.get(code, "outcome_missing")
    pub = None
    if row["pubstat"].isdigit() and int(row["pubstat"]) in jc.PUBSTAT:
        pub = 1 if int(row["pubstat"]) in jc.PUBLISHED else 0
    return {
        "fy": int(row["fy"]), "circuit": row["circuit"], "origin": row["origin"], "nature": nat, "nos": row["nos"],
        "agency": row["agency"], "merits": merits, "procedural": disp in jc.PROCEDURAL_DISP, "consolidated": consolidated,
        "outcome": outcome, "pub": pub, "days": int(row["days"]) if row["days"].isdigit() and merits else None,
    }


def load(path: Path):
    recs, pending, counts = [], collections.Counter(), collections.Counter()
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            counts["rows"] += 1
            if row["status"] == "S":
                pending[("circuit", row["circuit"])] += 1
                pending[("origin", row["origin"])] += 1
                pending[("national", "")] += 1
                continue
            rec = decode(row)
            if rec is None:
                counts["other_status"] += 1
                continue
            if rec["circuit"] == "not_recorded":
                counts["circuit_not_recorded"] += 1
            recs.append(rec)
    return recs, pending, counts


def rollup(recs, key) -> dict:
    out: dict = collections.defaultdict(Acc)
    for r in recs:
        k = key(r)
        if k is not None:
            out[k].add(r)
    return {k: v.summary() for k, v in out.items()}


def series(cells: dict, group) -> list[dict]:
    """[{fy, ...summary}] for one group key from a (group, fy) roll-up."""
    return [{"fy": fy, "partial": fy == ic.PARTIAL_FY, **s} for (g, fy), s in sorted(cells.items(), key=lambda kv: kv[0][1]) if g == group]


def main() -> None:
    nos_names = jc.parse_nos((BUILD / "appeals_codebook.txt").read_text())
    agencies = jc.parse_appendix((BUILD / "appeals_codebook.txt").read_text(), "AGENCY", "JURIS", r"[A-Z0-9]{1,4}")
    meta = json.loads((BUILD / "extract_appeals.meta.json").read_text())
    recs, pending, counts = load(BUILD / "extract_appeals.tsv.gz")
    spine = {json.loads(line)["id"] for line in (BUILD / "lookups" / "court_spine_xwalk_lookup.jsonl").open()}
    win = [r for r in recs if ic.in_window(r["fy"])]
    latest = [r for r in recs if r["fy"] == ic.LATEST_FY]

    nat_fy = rollup(recs, lambda r: ("national", r["fy"]))
    circ_fy = rollup(recs, lambda r: (r["circuit"], r["fy"]))
    orig_fy = rollup(recs, lambda r: (r["origin"], r["fy"]))
    circ_nature_win = rollup(win, lambda r: (r["circuit"], r["nature"]))
    circ_nature_latest = rollup(latest, lambda r: (r["circuit"], r["nature"]))
    nat_nature_win = rollup(win, lambda r: ("national", r["nature"]))
    nat_nature_latest = rollup(latest, lambda r: ("national", r["nature"]))
    circ_origin_win = rollup(win, lambda r: (r["circuit"], r["origin"]))
    circ_origin_latest = rollup(latest, lambda r: (r["circuit"], r["origin"]))
    origin_nature_win = rollup(win, lambda r: (r["origin"], r["nature"]))
    circ_nos_win = rollup([r for r in win if r["nos"]], lambda r: (r["circuit"], r["nos"]))
    origin_nos_win = rollup([r for r in win if r["nos"]], lambda r: (r["origin"], r["nos"]))
    # comparison base: appeals from district courts of the same circuit, same window
    circ_from_districts_win = rollup([r for r in win if r["origin"] in spine and not r["origin"].startswith("agency")], lambda r: r["circuit"])
    cube = rollup(recs, lambda r: (r["circuit"], r["origin"], r["nature"], r["nos"] or "", r["fy"]))

    def nature_table(cells, group):
        return [{"nature": k, "label": NATURE_LABEL[k], **cells[(group, k)]} for k, _ in NATURE if (group, k) in cells]

    def nos_table(cells, group, top=15):
        rows = [{"nos": int(n), "label": nos_names.get(int(n), f"Code {n} (not in the codebook)"), **s} for (g, n), s in cells.items() if g == group]
        return sorted(rows, key=lambda r: -r["terminated"])[:top]

    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    common_links = [{"url": SOURCE_PAGE, "label": "FJC Integrated Database: appeals FY2008 to present"},
                    {"url": jc.APPEALS_CODEBOOK, "label": "Appeals codebook (FJC)"}]

    # national
    n_series = series(nat_fy, "national")
    lat = next(s for s in n_series if s["fy"] == ic.LATEST_FY)
    rows.append(record("national", "U.S. courts of appeals (12 regional circuits) - appeal outcomes, FY2008-FY2026", "national", None, {
        "kind": "national", "series": n_series, "by_nature_window": nature_table(nat_nature_win, "national"),
        "by_nature_latest": nature_table(nat_nature_latest, "national"), "pending_2026_06_30": pending[("national", "")],
        "circuits": sorted([{"court_id": c, **circ_fy[(c, ic.LATEST_FY)]} for c in jc.CIRCUIT_IDS.values() if (c, ic.LATEST_FY) in circ_fy], key=lambda r: r["court_id"]),
    }, lat, common_links))

    # circuits
    district_reversal = {}
    for code, cid in sorted(jc.CIRCUIT_IDS.items(), key=lambda kv: int(kv[0])):
        cs = series(circ_fy, cid)
        if not cs:
            continue
        lat = next((s for s in cs if s["fy"] == ic.LATEST_FY), None)
        origins = []
        for (c, o), s in circ_origin_win.items():
            if c != cid:
                continue
            entry = {"origin": o, "court_id": o if o in spine else None, "latest": circ_origin_latest.get((c, o)), **s}
            if o.startswith("agency:"):
                code_a = o.split(":", 1)[1]
                entry["label"] = f"Agency: {agencies.get(code_a, code_a)}"
            elif o == "not_recorded":
                entry["label"] = "Origin not recorded"
            else:
                entry["label"] = o
            origins.append(entry)
        origins.sort(key=lambda r: -r["terminated"])
        rows.append(record(f"circuit:{cid}", f"{jc.CIRCUIT_NAMES[code]} - appeal outcomes by origin district, FY2008-FY2026", "circuit", cid, {
            "kind": "circuit", "court_id": cid, "circuit_name": jc.CIRCUIT_NAMES[code], "series": cs,
            "by_nature_window": nature_table(circ_nature_win, cid), "by_nature_latest": nature_table(circ_nature_latest, cid),
            "by_origin_window": origins, "top_nos_window": nos_table(circ_nos_win, cid),
            "pending_2026_06_30": pending[("circuit", cid)],
            "from_districts_window": circ_from_districts_win.get(cid),
        }, lat, common_links))

    # districts (origin courts)
    origin_ids = sorted({o for (o, _fy) in orig_fy if o in spine})
    for oid in origin_ids:
        os_ = series(orig_fy, oid)
        circuits = collections.Counter(r["circuit"] for r in recs if r["origin"] == oid)
        main_circuit = circuits.most_common(1)[0][0]
        lat = next((s for s in os_ if s["fy"] == ic.LATEST_FY), None)
        win_s = rollup([r for r in win if r["origin"] == oid], lambda r: "all").get("all")
        cube_rows = [[fy, c, nat, nos, s["terminated"], s["merits_appeals"], s["affirmed"], s["partial"], s["reversed"], s["dismissed"],
                      s["remanded"], s["other"], s["coa_denied"], s["median_days"]]
                     for (c, o, nat, nos, fy), s in sorted(cube.items(), key=lambda kv: (kv[0][4], kv[0][1], kv[0][2], kv[0][3])) if o == oid]
        district_reversal[oid] = (main_circuit, (win_s or {}).get("reversed_pct"))
        rows.append(record(f"district:{oid}", f"Appeals from {oid} - outcomes in the court of appeals, FY2008-FY2026", "district", oid, {
            "kind": "district", "court_id": oid, "circuit_id": main_circuit, "circuits": dict(circuits), "series": os_,
            "window": win_s, "by_nature_window": nature_table(origin_nature_win, oid), "top_nos_window": nos_table(origin_nos_win, oid),
            "circuit_from_districts_window": circ_from_districts_win.get(main_circuit),
            "pending_2026_06_30": pending[("origin", oid)],
            "cube_columns": ["fy", "circuit", "nature", "nos", "terminated", "merits_appeals", "affirmed", "partial", "reversed",
                             "dismissed", "remanded", "other", "coa_denied", "median_days"],
            "cube": cube_rows,
        }, lat, common_links))

    # ranks of district reversal rates within each circuit (window)
    by_circ = collections.defaultdict(dict)
    for oid, (c, p) in district_reversal.items():
        by_circ[c][oid] = p
    for row in rows:
        it = row["item"]
        if it.get("kind") == "district":
            c = it["circuit_id"]
            ranks = ic.rank_desc(by_circ[c])
            it["reversal_rank_in_circuit"] = ranks.get(it["court_id"])
            it["districts_ranked_in_circuit"] = len(ranks)
            row["detail"]["facts"].append(["Reversal rank among the circuit's districts (FY2021-FY2025, 1 = highest)",
                                           f"{ranks[it['court_id']]} of {len(ranks)}" if it["court_id"] in ranks else "Not recorded (base under 10)"])

    summary = {
        "source": "Federal Judicial Center, Integrated Database (IDB): appellate cases filed, terminated and pending, FY2008 to present",
        "source_page": SOURCE_PAGE, "source_file": SOURCE_FILE, "codebook": jc.APPEALS_CODEBOOK,
        "snapshot": "ap08on_0.zip (last modified 2026-09-01 on fjc.gov): appeals terminated FY2008 through June 30, 2026 and pending on June 30, 2026",
        "terms": "Public data published by the Federal Judicial Center (U.S. government work). The FJC and the AO do not vouch for analyses built from it.",
        "grain": "one record per regional circuit (12), one per origin district court with appeals, one national record; no case-level rows",
        "unit": "appeals (court of appeals docket records)",
        "definitions": __doc__.split("Definitions follow", 1)[1].strip(),
        "window": f"FY{ic.WINDOW[0]}-FY{ic.WINDOW[1]}", "latest_complete_fy": ic.LATEST_FY,
        "partial_fy": f"FY{ic.PARTIAL_FY} = Oct 1, 2025 - Jun 30, 2026",
        "denominators": {
            "reversed_pct": "reversed (OUTCOME 2) / merits terminations other than original proceedings (AO Table B-5 'Percent Reversed')",
            "affirmed_pct": "affirmed (OUTCOME 1) plus affirmed in part/reversed in part (3) / the same base (B-5 counts both as affirmed)",
            "published_pct": "merits terminations with PUBSTAT 2, 4 or 6 / merits terminations with PUBSTAT recorded",
            "median_days": "median of JUDGDATE - DKTDATE over merits terminations with both dates",
            "min_base": "percentages are omitted when the base is under 10",
        },
        "quality": {**counts, "pending_2026_06_30": pending[("national", "")], "extract_rows": meta["rows"], "bad_lines": meta["bad_lines"],
                    "fjc_published_record_count": 1000613},
        "excluded": "Federal Circuit appeals are not in this IDB file. Judge codes are blank on public files and are not used.",
        "built_at": built,
    }
    build = {"dataset": DATASET, "label": "Federal courts of appeals - appeal outcomes by circuit, origin district and nature of suit, FY2008-FY2026 (FJC Integrated Database)",
             "listing_block": listing(), "summary": summary, "rows": rows, "built_at": built,
             "inputs": [{"url": SOURCE_FILE, "path": meta["zip"], "sha256": meta["sha256"]},
                        {"url": jc.APPEALS_CODEBOOK, "path": "private/acq/judiciary/codebooks/sites/default/files/idb/codebooks/Appeals_Codebook_2008_Forward_rev_02102021.pdf"}]}
    (BUILD / f"{DATASET}.json").write_text(json.dumps(build))
    print(json.dumps({"dataset": DATASET, "rows": len(rows), "kinds": collections.Counter(r["item"]["kind"] for r in rows), **counts}))


def record(rid: str, title: str, kind: str, court: str | None, payload: dict, latest: dict | None, links: list) -> dict:
    lat = latest or {}
    facts = [
        ["Appeals terminated, FY2025", ic.fmt_int(lat.get("terminated"))],
        ["Terminated on the merits (excluding original proceedings), FY2025", ic.fmt_int(lat.get("merits_appeals"))],
        ["Percent reversed, FY2025", ic.fmt_pct(lat.get("reversed_pct"))],
        ["Affirmed (including affirmed in part), FY2025", ic.fmt_pct(lat.get("affirmed_pct"))],
        ["Median days from docketing to judgment (merits), FY2025", ic.fmt_int(lat.get("median_days"))],
        ["Pending on June 30, 2026", ic.fmt_int(payload.get("pending_2026_06_30"))],
        ["Source", "Federal Judicial Center, Integrated Database, appeals FY2008 to present (ap08on_0.zip)"],
        ["Definitions", "AO Judicial Business Table B-5 rules; see the dataset summary"],
    ]
    rid_links = list(links)
    if court:
        rid_links.insert(0, {"url": f"/courts/{court}", "label": "Court profile"})
    cells = {"scope": title.split(" - ")[0], "kind": kind, "terminated_fy2025": ic.fmt_int(lat.get("terminated")),
             "reversed_pct_fy2025": ic.fmt_pct(lat.get("reversed_pct")), "median_days_fy2025": ic.fmt_int(lat.get("median_days"))}
    return {
        "dataset": DATASET, "id": rid, "category": DATASET, "state": "", "title": title, "source_url": SOURCE_FILE,
        "item": {"id": rid, "title": title, "subtitle": "FJC Integrated Database, appeals", "cells": cells, "badges": [kind.title()],
                 "links": rid_links, **payload},
        "detail": {"id": rid, "title": title, "subtitle": "FJC Integrated Database, appeals", "facts": facts, "links": rid_links},
        "text": f"{rid} {title} appeals reversal affirmed",
        "filters": {"_listing": ["yes"], "kind": [kind], "court": [court] if court else []},
    }


def listing() -> dict:
    return {"page": 1, "limit": 50,
            "columns": [{"key": "scope", "label": "Court"}, {"key": "kind", "label": "Level"}, {"key": "terminated_fy2025", "label": "Terminated FY2025"},
                        {"key": "reversed_pct_fy2025", "label": "Percent reversed FY2025"}, {"key": "median_days_fy2025", "label": "Median days FY2025"}],
            "filters": [{"name": "q", "type": "search", "label": "Search"},
                        {"name": "kind", "type": "select", "label": "Level", "options": [{"label": "Circuit", "value": "circuit"}, {"label": "Origin district", "value": "district"}, {"label": "National", "value": "national"}]}]}


if __name__ == "__main__":
    main()
