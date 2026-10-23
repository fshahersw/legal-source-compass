"""Build `fjc_bankruptcy_districts` from the FJC Integrated Database bankruptcy snapshots (FY2008 - June 30, 2026).

Input: private/build/judiciary/agg_bankruptcy.json (extract_idb.py bankruptcy: counts streamed from cpbank08to17.zip and
cpbank18on.zip, 38,193,087 snapshot records). Output: private/build/judiciary/fjc_bankruptcy_districts.json.

Unit: bankruptcy cases. Each fiscal-year snapshot (SNAPSHOT, September 30 of the year) holds one record per case filed,
closed or pending in that year; the codebook's indicators select the cases the AO counts in its published F tables:
  * filed = SNAPFILE 1 (excludes intra-district transfers, as in the published tables);
  * closed = SNAPCLOS 1;  pending at the end of the period = SNAPPEND 1.
Chapter of a filing: ORGFLCHP (original filing chapter) decoded with the code set in force on the filing's own FILEDATE
(codes changed on Oct 17, 2005; a reopened or transferred case filed after that date uses the new codes even if its first
filing was earlier). This rule reproduces Judicial Business Table F-2: 1,637 of 1,674 district-year chapter 7 counts, 1,643 of
1,673 chapter 13, 1,661 of 1,672 chapter 11 and all 1,657 chapter 12 counts are exact for FY2008-FY2025 (verify_bankruptcy.py).
Closed cases use CLCHPT and pending cases CRNTCHP, read the same way. Chapter 15 codes 15a/15m/15n/15x are combined. Business / consumer = NTRDBT
(b = business, c = consumer, o = other, blank = chapter 15 cases since Dec 1, 2015), exactly as recorded. Subchapter V =
CRNTFLSUBCHP or ORGFLSUBCHP "V" (recorded since the 12/31/2022 snapshot). The last snapshot in the file is dated June 30,
2026 and covers the 12 months ending that day (it overlaps FY2025 by three months); it is labelled as such, not as FY2026.
"""
from __future__ import annotations

import collections
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import idb_common as ic  # noqa: E402
import jcodes as jc  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
DATASET = "fjc_bankruptcy_districts"
SOURCE_PAGE = "https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present"
SOURCE_FILES = ["https://www.fjc.gov/sites/default/files/idb/textfiles/cpbank08to17.zip", "https://www.fjc.gov/sites/default/files/idb/textfiles/cpbank18on.zip"]
CHAPTERS = ["7", "11", "12", "13", "15", "9", "304", "not_recorded", "not_in_codebook"]
DEBT = {"b": "business", "c": "consumer", "o": "other", "blank": "not_recorded"}
JUN26 = "2026-06-30"


# Which chapter field and which code set: filings use the ORIGINAL FILING CHAPTER read with the code set of the filing
# instance's own FILEDATE (see the module docstring; chosen because it reproduces Table F-2, see verify_bankruptcy.py);
# closed cases use CLCHPT and pending cases CRNTCHP, read the same way.
CHAPTER_RULE = {"filed": ("org", "file"), "closed": ("cur", "file"), "pending_end": ("cur", "file")}
DEBT_FIELD = "NTRDBT"  # nature of debt on the current record; ORGNTRDBT (first record) is the alternative tested in verify_bankruptcy.py


def chapter_of(measure: str, cur: str, org: str, era_orig: str, era_file: str, rule: dict | None = None) -> str:
    field, era = (rule or CHAPTER_RULE)[measure]
    return jc.chapter(org if field == "org" else cur, era_file if era == "file" else era_orig)


def period_key(p: str) -> tuple:
    return (int(p[:4]), p) if p.isdigit() else (int(p[:4]) + 0.5, p)


def period_label(p: str) -> str:
    return f"FY{p}" if p.isdigit() else "12 months ending Jun 30, 2026"


def empty() -> dict:
    return {"filed": 0, "closed": 0, "pending_end": 0, **{f"filed_ch{c}": 0 for c in CHAPTERS},
            **{f"filed_{d}": 0 for d in DEBT.values()}, "filed_business_ch11": 0, "filed_subchapter_v": 0,
            **{f"closed_ch{c}": 0 for c in CHAPTERS}}


def main() -> None:
    agg = json.loads((BUILD / "agg_bankruptcy.json").read_text())
    spine = {r["id"]: r for r in map(json.loads, (BUILD / "lookups" / "court_spine_xwalk_lookup.jsonl").open())}
    per = collections.defaultdict(empty)  # (court, period)
    cube = collections.Counter()           # (court, period, chapter, debt, measure)
    counts = collections.Counter()
    for period, dist, measure, cur, org, era_orig, era_file, debt_now, sub_v, debt_orig, n in agg["cells"]:
        chapter = chapter_of(measure, cur, org, era_orig, era_file)
        debt = debt_orig if DEBT_FIELD == "ORGNTRDBT" else debt_now
        court = jc.district_court_id(dist) or "not_recorded"
        if court == "not_recorded":
            counts[f"district_not_recorded_{measure}"] += n
        d = DEBT.get(debt, "not_recorded")
        for key in ((court, period), ("national", period)):
            s = per[key]
            if measure == "filed":
                s["filed"] += n
                s[f"filed_ch{chapter}"] += n
                s[f"filed_{d}"] += n
                if chapter == "11" and d == "business":
                    s["filed_business_ch11"] += n
                if sub_v:
                    s["filed_subchapter_v"] += n
            elif measure == "closed":
                s["closed"] += n
                s[f"closed_ch{chapter}"] += n
            elif measure == "pending_end":
                s["pending_end"] += n
        if measure in ("filed", "closed", "pending_end"):
            cube[(court, period, chapter, d, measure)] += n
    for s in per.values():
        s["business_share_pct"] = ic.pct(s["filed_business"], s["filed"])
        s["ch13_share_pct"] = ic.pct(s["filed_ch13"], s["filed"])

    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    links = [{"url": SOURCE_PAGE, "label": "FJC Integrated Database: bankruptcy cases FY2008 to present"},
             {"url": jc.BANKRUPTCY_CODEBOOK, "label": "Bankruptcy codebook (FJC)"}]
    rows = []

    def series(court):
        return [{"period": p, "label": period_label(p), "fy": int(p[:4]) if p.isdigit() else None, **s}
                for (c, p), s in sorted(per.items(), key=lambda kv: period_key(kv[0][1])) if c == court]

    nat = series("national")
    rows.append(record("national", "Federal bankruptcy courts - cases filed, closed and pending by chapter, FY2008-June 2026", None, None, None,
                       {"kind": "national", "series": nat}, next(s for s in nat if s["period"] == "2025"), links))
    for code in sorted(jc.DISTRICTS):
        court = jc.district_court_id(code)
        if not court or not any(c == court for (c, _p) in per):
            continue
        bk = jc.bankruptcy_court_id(court)
        bk = bk if bk in spine and "FB" in (spine[bk].get("type") or []) else None  # a federal bankruptcy court, never another court type
        s = series(court)
        crow = [[p, ch, d, cube.get((court, p, ch, d, "filed"), 0), cube.get((court, p, ch, d, "closed"), 0), cube.get((court, p, ch, d, "pending_end"), 0)]
                for (c, p, ch, d) in sorted({k[:4] for k in cube if k[0] == court}, key=lambda k: (period_key(k[1]), k[2], k[3]))]
        lat = next((x for x in s if x["period"] == "2025"), None)
        rows.append(record(f"district:{court}", f"Bankruptcy cases in the {jc.DISTRICTS[code]} district, FY2008-June 2026", court, bk,
                           jc.district_state(code), {"kind": "district", "court_id": court, "bankruptcy_court_id": bk, "district_label": jc.DISTRICTS[code],
                                                     "series": s, "cube_columns": ["period", "chapter", "nature_of_debt", "filed", "closed", "pending_end"],
                                                     "cube": crow}, lat, links))
    ranks = ic.rank_desc({r["item"]["court_id"]: next((x["filed"] for x in r["item"]["series"] if x["period"] == "2025"), None)
                          for r in rows if r["item"]["kind"] == "district"})
    bus_ranks = ic.rank_desc({r["item"]["court_id"]: next((x["filed_business_ch11"] for x in r["item"]["series"] if x["period"] == "2025"), None)
                              for r in rows if r["item"]["kind"] == "district"})
    for r in rows:
        if r["item"]["kind"] == "district":
            r["item"]["ranks_fy2025"] = {"filed": ranks.get(r["item"]["court_id"]), "business_ch11": bus_ranks.get(r["item"]["court_id"]),
                                         "of": len(ranks)}
    summary = {
        "source": "Federal Judicial Center, Integrated Database (IDB): bankruptcy cases filed, terminated and pending, FY2008 to present (BPNS snapshots)",
        "source_page": SOURCE_PAGE, "source_files": SOURCE_FILES, "codebook": jc.BANKRUPTCY_CODEBOOK,
        "snapshot": "cpbank08to17.zip and cpbank18on.zip (last modified 2026-09-02 on fjc.gov): snapshots Sep 30, 2008 - Sep 30, 2025 and Jun 30, 2026",
        "terms": "Public data published by the Federal Judicial Center (U.S. government work). The FJC and the AO do not vouch for analyses built from it.",
        "grain": "one record per district (94) and one national record; counts of cases by period, chapter and nature of debt; no case-level rows",
        "unit": "bankruptcy cases", "definitions": __doc__.split("Unit: bankruptcy cases.", 1)[1].strip(),
        "denominators": {"business_share_pct": "filings with NTRDBT b / all filings", "ch13_share_pct": "chapter 13 filings / all filings",
                         "min_base": "percentages are omitted when the base is under 10"},
        "quality": {**counts, "files": agg["files"], "snapshot_records": agg["snapshots"], "fjc_published_record_count": 38193087},
        "excluded": "Debtor ZIP and county codes, dollar amounts and case numbers are not used. The FJC notes that debtor ZIP, county and pro se fields for FY2008 - June 2021 were revised in November 2021; none of them is used here.",
        "built_at": built,
    }
    build = {"dataset": DATASET, "label": "Federal bankruptcy courts - cases filed, closed and pending by district, chapter and business/consumer, FY2008-June 2026 (FJC Integrated Database)",
             "listing_block": listing(), "summary": summary, "rows": rows, "built_at": built,
             "inputs": [{"url": u, "path": f["zip"], "sha256": f["sha256"]} for u, f in zip(SOURCE_FILES, agg["files"])]
             + [{"url": jc.BANKRUPTCY_CODEBOOK, "path": "private/acq/judiciary/codebooks/sites/default/files/idb/codebooks/Bankruptcy_IDB_Online_Codebook_rev_02282023.pdf"}]}
    (BUILD / f"{DATASET}.json").write_text(json.dumps(build))
    print(json.dumps({"dataset": DATASET, "records": len(rows), **counts}))


def record(rid, title, court, bk, state, payload, latest, links):
    lat = latest or {}
    facts = [
        ["Cases filed, FY2025", ic.fmt_int(lat.get("filed"))],
        ["Chapter 7 / 11 / 13 filed, FY2025", " / ".join(ic.fmt_int(lat.get(f"filed_ch{c}")) for c in ("7", "11", "13"))],
        ["Business filings (nature of debt b), FY2025", f"{ic.fmt_int(lat.get('filed_business'))} ({ic.fmt_pct(lat.get('business_share_pct'))})"],
        ["Business chapter 11 filings, FY2025", ic.fmt_int(lat.get("filed_business_ch11"))],
        ["Subchapter V filings, FY2025", ic.fmt_int(lat.get("filed_subchapter_v"))],
        ["Cases closed, FY2025", ic.fmt_int(lat.get("closed"))],
        ["Pending on Sep 30, 2025", ic.fmt_int(lat.get("pending_end"))],
        ["Source", "Federal Judicial Center, Integrated Database, bankruptcy snapshots FY2008 to present"],
    ]
    rl = list(links)
    for cid, lbl in ((bk, "Bankruptcy court profile"), (court, "District court profile")):
        if cid:
            rl.insert(0, {"url": f"/courts/{cid}", "label": lbl})
    cells = {"district": payload.get("district_label") or "All districts", "filed_fy2025": ic.fmt_int(lat.get("filed")),
             "business_share_fy2025": ic.fmt_pct(lat.get("business_share_pct")), "ch11_fy2025": ic.fmt_int(lat.get("filed_ch11")),
             "pending_fy2025": ic.fmt_int(lat.get("pending_end"))}
    return {"dataset": DATASET, "id": rid, "category": DATASET, "state": state or "", "title": title,
            "source_url": SOURCE_FILES[1], "item": {"id": rid, "title": title, "subtitle": "FJC Integrated Database, bankruptcy", "cells": cells,
                                                     "badges": [], "links": rl, **payload},
            "detail": {"id": rid, "title": title, "subtitle": "FJC Integrated Database, bankruptcy", "facts": facts, "links": rl},
            "text": f"{rid} {title} bankruptcy chapter 7 11 13 business consumer",
            "filters": {"_listing": ["yes"], "kind": [payload["kind"]], "court": [c for c in (court, bk) if c]}}


def listing():
    return {"page": 1, "limit": 50,
            "columns": [{"key": "district", "label": "District"}, {"key": "filed_fy2025", "label": "Filed FY2025"},
                        {"key": "ch11_fy2025", "label": "Chapter 11 FY2025"}, {"key": "business_share_fy2025", "label": "Business share FY2025"},
                        {"key": "pending_fy2025", "label": "Pending Sep 30, 2025"}],
            "filters": [{"name": "q", "type": "search", "label": "Search"}]}


if __name__ == "__main__":
    main()
