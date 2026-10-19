"""Build clb_oral_arguments: oral-argument recordings in CourtListener by court, argument year and recorded judge name, with durations.

Source: oral-arguments-2026-09-30.csv.bz2 (slim table oral_argument: docket id, duration in seconds, transcript flag, the `judges`
text as recorded) joined by exact docket id to dockets-2026-09-30 (court, date argued). Aggregated by build_rest_work.py (r_oa_*).
Judge names are the recording's own `judges` text split at commas, semicolons, "&" and " and "; they are counted per court as written
(case-insensitive) and never linked to a person, because the text usually holds surnames only.
"""
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DATASET = "clb_oral_arguments"
TOP_NAMES = 20
MIN_DUR = 10  # recordings needed before a yearly or per-name median is shown


def grouped(con, sql, key="court_id"):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    out: dict = {}
    for r in cur.fetchall():
        rec = dict(zip(cols, r))
        out.setdefault(rec[key], []).append(rec)
    return out


def minutes(secs):
    return None if secs is None else cc.r1(float(secs) / 60.0)


def build() -> dict:
    con = duckdb.connect(os.path.join(rc.DB, "rest_work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(rc.DB, "small.duckdb"), read_only=True)
    spine = rc.spine_ids()
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    base = {r["court_id"]: r for v in grouped(con, "SELECT * FROM r_oa_court").values() for r in v}
    dur = {r["court_id"]: r for v in grouped(con, "SELECT * FROM r_oa_dur").values() for r in v}
    years = grouped(con, "SELECT * FROM r_oa_year ORDER BY court_id, yr")
    stt = grouped(con, "SELECT * FROM r_oa_stt ORDER BY court_id, stt_status")
    names = grouped(con, "SELECT * FROM r_oa_name ORDER BY court_id, n DESC, key")
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": rc.ORAL_URL, "path": "slim table private/acq/courtlistener/db/oral_argument.duckdb", "sha256": None},
              {"url": rc.DOCKETS_URL, "path": "slim table private/acq/courtlistener/db/docket.duckdb (court, date argued)", "sha256": None},
              {"url": rc.COURTS_URL, "path": "small.duckdb courts", "sha256": None}]
    rows = []
    nat_years: dict[int, dict] = {}
    unattributed = base.get(None)
    for cid in sorted(k for k in base if k):
        b = base[cid]
        c = courts.get(cid, {"name": cid, "jur": None})
        n = b["n"]
        d = dur.get(cid)
        q = rc.quantiles(d["q"]) if d else None
        dmin = {k: minutes(v) for k, v in q.items()} if q else None
        series = []
        for y in years.get(cid, []):
            if y["yr"] is None:
                continue
            series.append({"yr": int(y["yr"]), "recordings": y["n"], "median_minutes": minutes(y["p50_secs"]) if y["with_duration"] >= MIN_DUR else None,
                           "hours": cc.r1((y["total_secs"] or 0) / 3600.0), "with_transcript": y["with_transcript"]})
            ny = nat_years.setdefault(int(y["yr"]), {"recordings": 0, "hours": 0.0, "with_transcript": 0})
            ny["recordings"] += y["n"]
            ny["hours"] += (y["total_secs"] or 0) / 3600.0
            ny["with_transcript"] += y["with_transcript"]
        nm = [{"name": r["name"], "recordings": r["n"], "median_minutes": minutes(r["p50_secs"]) if r["n"] >= MIN_DUR else None,
               "first_year": r["first_yr"], "last_year": r["last_yr"]} for r in names.get(cid, [])[:TOP_NAMES]]
        stt_mix = [{"code": r["stt_status"], "recordings": r["n"]} for r in stt.get(cid, [])]
        hours = cc.r1((b["total_secs"] or 0) / 3600.0)
        profile = {"court_id": cid, "name": c["name"], "recordings": n, "dockets": b["dockets"], "with_argued_date": b["with_argued"], "implausible_argued": b["implausible_argued"],
                   "first_argued": str(b["first_argued"]) if b["first_argued"] else None, "last_argued": str(b["last_argued"]) if b["last_argued"] else None,
                   "with_duration": b["with_duration"], "total_hours": hours, "duration_minutes": ({"n": d["n"], **dmin, "max": minutes(d["max_secs"])} if dmin else None),
                   "with_transcript": b["with_transcript"], "transcript_pct": cc.share(b["with_transcript"], n), "with_judges_text": b["with_judges"],
                   "judges_text_pct": cc.share(b["with_judges"], n), "by_year": series, "names": nm, "names_listed_from": b["with_judges"],
                   "transcription_status_codes": stt_mix, "source_codes": {"C": b["src_c"], "H": b["src_h"]},
                   "first_created": str(b["first_created"]) if b["first_created"] else None, "last_created": str(b["last_created"]) if b["last_created"] else None}
        sub = f"{n:,} recordings · {hours:,.0f} hours" + (f" · median {dmin['p50']:,.0f} minutes" if dmin else "") + (f" · argued {b['first_argued'].year}–{b['last_argued'].year}" if b["first_argued"] else "")
        rows.append(writer.record(
            DATASET, cid, f"{c['name']}: oral-argument recordings in CourtListener", source_url=rc.ORAL_URL, subtitle=sub,
            cells={"court": c["name"], "recordings": n, "first_year": b["first_argued"].year if b["first_argued"] else None, "last_year": b["last_argued"].year if b["last_argued"] else None,
                   "median_minutes": dmin["p50"] if dmin else None, "hours": hours, "transcript_pct": cc.share(b["with_transcript"], n), "judges_pct": cc.share(b["with_judges"], n)},
            badges=["CourtListener bulk data", "Recordings in the collection"],
            facts=rc.facts([("Court (CourtListener id)", f"{c['name']} ({cid})"), ("Recordings", f"{n:,} on {b['dockets']:,} dockets"),
                            ("Argument dates (docket date argued)", f"{b['first_argued']} to {b['last_argued']}" if b["first_argued"] else None),
                            ("Recorded length", f"{hours:,.1f} hours in all; median {dmin['p50']:,.1f} minutes (middle half {dmin['p25']:,.1f}–{dmin['p75']:,.1f}), n = {d['n']:,}" if dmin else None),
                            ("With a machine transcript", f"{b['with_transcript']:,} ({cc.share(b['with_transcript'], n)}%)"),
                            ("With judges named in the recording's text", f"{b['with_judges']:,} ({cc.share(b['with_judges'], n)}%)"),
                            ("Most frequently named", "; ".join(f"{x['name']} ({x['recordings']:,})" for x in nm[:6]) or None),
                            ("Counting", "Recordings are attributed to the court of their docket; years are the docket's date argued; names are the recording's judges text as written, not linked to people.")]),
            text=f"oral argument recordings {c['name']} {cid}", filters={"court": [cid]},
            links=[{"label": "Oral-arguments bulk file", "url": rc.ORAL_URL}] + ([{"label": "Court profile", "url": f"/courts/{cid}"}] if cid in spine else []),
            extra={"profile": profile}))
    rows.sort(key=lambda r: -r["item"]["cells"]["recordings"])
    total = sum(b["n"] for b in base.values())
    ov = {"recordings": total, "courts": len(rows), "unattributed": unattributed["n"] if unattributed else 0,
          "by_year": [{"yr": y, "recordings": v["recordings"], "hours": cc.r1(v["hours"]), "with_transcript": v["with_transcript"]} for y, v in sorted(nat_years.items())],
          "by_court": [{"court_id": r["id"], "name": r["item"]["cells"]["court"], "recordings": r["item"]["cells"]["recordings"], "median_minutes": r["item"]["cells"]["median_minutes"],
                        "link": f"/courts/{r['id']}" if r["id"] in spine else None} for r in rows]}
    rows.append(writer.record(
        DATASET, "overview:all", "Oral-argument recordings in CourtListener: overview", source_url=rc.ORAL_URL, subtitle=f"{total:,} recordings · {len(rows)} courts",
        cells={"court": "All courts", "recordings": total, "first_year": None, "last_year": None, "median_minutes": None, "hours": cc.r1(sum(v["hours"] for v in nat_years.values())),
               "transcript_pct": None, "judges_pct": None},
        badges=["CourtListener bulk data"],
        facts=rc.facts([("Recordings", f"{total:,}"), ("Courts", len(rows)), ("Recordings whose docket is not in the docket file", ov["unattributed"])]),
        text="oral argument recordings overview", filters={"court": ["all"]}, links=[{"label": "Oral-arguments bulk file", "url": rc.ORAL_URL}], extra={"profile": ov}))
    summary = {
        "source": "CourtListener bulk data: oral-arguments and dockets (Free Law Project)", "snapshot": cc.SNAPSHOT, "terms": rc.TERMS,
        "totals": {"recordings": total, "courts": len(rows) - 1},
        "definitions": {"recording": "one row of the oral-arguments file (an audio file); a docket can have several",
                        "year": "year of the docket's date_argued; recordings without it are counted in the court total only",
                        "length": "the recording's duration field in seconds, shown in minutes; zero or missing durations are left out of length figures; yearly and per-name medians need 10 recordings",
                        "transcript": "the recording carries CourtListener's machine (speech-to-text) transcript",
                        "names": "the recording's judges text split at commas, semicolons, & and ' and ', counted case-insensitively within the court and shown in their most common spelling; usually surnames, never linked to a person"},
        "caveats": ["The collection holds recordings CourtListener gathered from court websites; courts that do not publish audio are absent.",
                    "Names are as typed by the source; the same judge can appear under two spellings, and a few recordings carry placeholder text.",
                    "Durations are the files' lengths, which can include silence before and after the argument."],
        "grain": "one record per court with recordings plus an overview record"}
    return {DATASET: {
        "dataset": DATASET, "label": "Oral-argument recordings in CourtListener by court, year and named judge, with lengths (Sept 30, 2026)",
        "listing_block": writer.listing([("court", "Court"), ("recordings", "Recordings"), ("first_year", "First year argued"), ("last_year", "Last year argued"), ("median_minutes", "Median minutes"),
                                         ("hours", "Hours"), ("transcript_pct", "With transcript %"), ("judges_pct", "Judges named %")], []),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs}}


if __name__ == "__main__":
    rc.write(build())
