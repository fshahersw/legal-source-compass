"""Build `fjc_criminal_districts` from the FJC Integrated Database criminal defendants file (FY1996 - June 30, 2026).

Input: private/build/judiciary/extract_criminal.tsv.gz (extract_idb.py criminal; coded fields only, names are blank on the
public file and are not read). Output: private/build/judiciary/fjc_criminal_districts.json.

Unit: defendants. The file holds one record per defendant per fiscal-year snapshot (FISCALYR); the codebook's count flags
pick the defendants the AO counts in its published tables for that year:
  * filed = CTFILTRN 1 (filings including inter-district transfers, as in Judicial Business Table D);
  * terminated = CTTRTRN 1 (terminations including transfers, Table D);
  * disposed = CTTR 1 (terminations excluding transfers: the base of Tables D-4 and D-5, dispositions and sentences);
  * pending = CTPNWOF 1 (pending at the end of the snapshot excluding defendants who had been fugitives more than 12 months,
    as in Table D); pending_incl_fugitives = CTPN 1.
Disposition groups follow the columns of Table D-4 (DISP1 codes listed in jcodes.CRIM_DISP_GROUP_LABEL). Sentence type of a
convicted defendant from PRISTOT / PROBTOT / FINETOT (jcodes.sentence_type): prison (months > 0, under one month, life or
death), probation, fine only, no sentence recorded, sealed. Median prison months: PRISTOT > 0 among convicted defendants with
a prison term (life, death, sealed and under-one-month codes excluded, as in the D-5 median). Days to termination:
TERMDATE - PROCDATE (the AO's interval since FY2012). Offense: AO offense code of the most serious charge (FOFFCD1 at
filing, TOFFCD1 at disposition) with the description from the FJC appeals codebook Appendix B; offense categories are
this project's grouping of those codes (jcodes.OFFENSE_GROUPS), not the AO's D2 categories. FY2026 = Oct 1, 2025 -
Jun 30, 2026 only.
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
DATASET = "fjc_criminal_districts"
SOURCE_PAGE = "https://www.fjc.gov/research/idb/criminal-defendants-filed-terminated-and-pending-fy-1996-present"
SOURCE_FILE = "https://www.fjc.gov/sites/default/files/idb/textfiles/cr96on.zip"
SENTENCES = ["prison", "probation", "fine_only", "no_sentence", "sealed"]
DISP_GROUPS = list(jc.CRIM_DISP_GROUP_LABEL)


class Acc:
    __slots__ = ("c", "prison", "days")

    def __init__(self):
        self.c = collections.Counter()
        self.prison: list[int] = []
        self.days: list[int] = []

    def summary(self) -> dict:
        c = self.c
        conv = c["convicted"]
        return {
            "filed": c["filed"], "terminated": c["terminated"], "disposed": c["disposed"], "pending": c["pending"], "pending_incl_fugitives": c["pending_incl_fugitives"], "convicted": conv,
            **{f"disp_{g}": c[f"disp_{g}"] for g in DISP_GROUPS},
            **{f"sent_{s}": c[f"sent_{s}"] for s in SENTENCES},
            "conviction_pct": ic.pct(conv, c["disposed"]),
            "plea_pct": ic.pct(c["disp_convicted_plea"], conv),
            "trial_pct": ic.pct(c["disp_convicted_bench"] + c["disp_convicted_jury"] + c["disp_acquitted_bench"] + c["disp_acquitted_jury"], c["disposed"]),
            "prison_pct": ic.pct(c["sent_prison"], conv),
            "median_prison_months": ic.median(self.prison), "prison_n": len(self.prison),
            "median_days_to_termination": ic.median(self.days), "days_n": len(self.days),
        }


def decode(row: dict, offenses: dict[str, str]) -> dict:
    disp = jc.as_int(row["disp1"])
    group = jc.CRIM_DISP_GROUP.get(disp, "not_recorded") if disp is not None else "not_recorded"
    disposed = row["cttr"] == "1"
    sent = jc.sentence_type(group, row["pristot"], row["probtot"], row["finetot"]) if disposed else None
    p = jc.as_int(row["pristot"])
    return {
        "fy": int(row["fy"]), "court": jc.district_court_id(row["district"]) or "not_recorded",
        "filed": row["ctfiltrn"] == "1", "terminated": row["cttrtrn"] == "1", "disposed": disposed, "pending": row["ctpnwof"] == "1", "pending_all": row["ctpn"] == "1",
        "off_f": jc.offense_group(row["foffcd1"], offenses), "off_t": jc.offense_group(row["toffcd1"], offenses),
        "code_f": row["foffcd1"], "code_t": row["toffcd1"], "disp": group, "sent": sent,
        "prison": p if (disposed and group in jc.CONVICTED and p is not None and p > 0) else None,
        "days": int(row["procdays"]) if disposed and row["procdays"].isdigit() else None,
        "counsel": jc.as_int(row["tcounsel"]) if disposed else None,
    }


def add(acc: Acc, r: dict) -> None:
    c = acc.c
    c["filed"] += r["filed"]
    c["terminated"] += r["terminated"]
    c["pending"] += r["pending"]
    c["pending_incl_fugitives"] += r["pending_all"]
    if r["disposed"]:
        c["disposed"] += 1
        c[f"disp_{r['disp']}"] += 1
        if r["disp"] in jc.CONVICTED:
            c["convicted"] += 1
            c[f"sent_{r['sent']}"] += 1
        if r["prison"] is not None:
            acc.prison.append(r["prison"])
        if r["days"] is not None:
            acc.days.append(r["days"])


def main() -> None:
    text = (BUILD / "appeals_codebook.txt").read_text()
    offenses = jc.parse_offenses(text)
    meta = json.loads((BUILD / "extract_criminal.meta.json").read_text())
    spine = {json.loads(line)["id"] for line in (BUILD / "lookups" / "court_spine_xwalk_lookup.jsonl").open()}
    by_fy = collections.defaultdict(Acc)            # (court, fy)
    nat_fy = collections.defaultdict(Acc)           # fy
    off_win = collections.defaultdict(Acc)          # (court, offense group) window, by group at disposition / filing
    code_win = collections.defaultdict(collections.Counter)  # court -> AO code at disposition (window, disposed)
    counsel_win = collections.defaultdict(collections.Counter)
    cube = collections.Counter()                    # (court, fy, offense group, disp group, sentence) disposed defendants
    fcube = collections.Counter()                   # (court, fy, offense group) filed defendants
    counts = collections.Counter()
    with gzip.open(BUILD / "extract_criminal.tsv.gz", "rt", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            counts["rows"] += 1
            r = decode(row, offenses)
            if r["court"] == "not_recorded":
                counts["district_not_recorded"] += 1
            add(by_fy[(r["court"], r["fy"])], r)
            add(nat_fy[r["fy"]], r)
            if r["filed"]:
                fcube[(r["court"], r["fy"], r["off_f"])] += 1
            if r["disposed"]:
                cube[(r["court"], r["fy"], r["off_t"], r["disp"], r["sent"] or "not_convicted")] += 1
                counts["offense_group_" + r["off_t"]] += 1
            if ic.in_window(r["fy"]):
                if r["disposed"]:
                    add(off_win[(r["court"], "t:" + r["off_t"])], r)
                    code_win[r["court"]][r["code_t"]] += 1
                    if r["counsel"] is not None:
                        counsel_win[r["court"]][r["counsel"]] += 1
                if r["filed"]:
                    off_win[(r["court"], "f:" + r["off_f"])].c["filed"] += 1
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    links = [{"url": SOURCE_PAGE, "label": "FJC Integrated Database: criminal defendants FY1996 to present"},
             {"url": jc.CRIMINAL_CODEBOOK, "label": "Criminal codebook (FJC)"}]
    rows = []
    nat_series = [{"fy": fy, "partial": fy == ic.PARTIAL_FY, **acc.summary()} for fy, acc in sorted(nat_fy.items())]
    rows.append(record("national", "Federal district courts - criminal defendants, FY1996-FY2026", None, None,
                       {"kind": "national", "series": nat_series}, next(s for s in nat_series if s["fy"] == ic.LATEST_FY), links))
    courts = sorted({c for (c, _fy) in by_fy if c in spine})
    groups = [k for k, _l, _w in jc.OFFENSE_GROUPS] + ["regulatory_other", "not_in_codebook", "not_recorded"]
    for court in courts:
        series = [{"fy": fy, "partial": fy == ic.PARTIAL_FY, **acc.summary()} for (c, fy), acc in sorted(by_fy.items(), key=lambda kv: kv[0][1]) if c == court]
        offense_rows = []
        for g in groups:
            t = off_win.get((court, "t:" + g))
            f = off_win.get((court, "f:" + g))
            if not t and not f:
                continue
            s = t.summary() if t else Acc().summary()
            s["filed"] = f.c["filed"] if f else 0
            offense_rows.append({"group": g, "label": jc.OFFENSE_GROUP_LABEL[g], **s})
        top_codes = [{"code": k, "label": offenses.get(k, "Not recorded" if k in ("", "-8") else f"Code {k} (not in the codebook)"), "disposed": v}
                     for k, v in code_win[court].most_common(12)]
        ctotal = sum(counsel_win[court].values())
        counsel = [{"code": k, "label": jc.label(jc.COUNSEL, k), "disposed": v, "share_pct": ic.pct(v, ctotal)} for k, v in counsel_win[court].most_common()]
        crows = [[fy, og, dg, st, n] for (c, fy, og, dg, st), n in sorted(cube.items(), key=lambda kv: tuple(str(x) for x in kv[0])) if c == court]
        frows = [[fy, og, n] for (c, fy, og), n in sorted(fcube.items(), key=lambda kv: tuple(str(x) for x in kv[0])) if c == court]
        lat = next((s for s in series if s["fy"] == ic.LATEST_FY), None)
        rows.append(record(f"district:{court}", f"Criminal defendants in {court}, FY1996-FY2026", court, jc.district_state(next(k for k in jc.DISTRICTS if jc.district_court_id(k) == court)), {
            "kind": "district", "court_id": court, "series": series, "offenses_window": offense_rows, "top_offense_codes_window": top_codes,
            "counsel_window": counsel,
            "cube_columns": ["fy", "offense_group", "disposition", "sentence_type", "defendants_disposed"], "cube": crows,
            "filings_cube_columns": ["fy", "offense_group", "defendants_filed"], "filings_cube": frows,
        }, lat, links))
    ranks = {m: ic.rank_desc({r["item"]["court_id"]: (next((s for s in r["item"]["series"] if s["fy"] == ic.LATEST_FY), {}) or {}).get(m)
                               for r in rows if r["item"]["kind"] == "district"}) for m in ("filed", "prison_pct", "median_prison_months", "trial_pct")}
    for r in rows:
        if r["item"]["kind"] == "district":
            r["item"]["ranks_latest"] = {m: v.get(r["item"]["court_id"]) for m, v in ranks.items()}
    summary = {
        "source": "Federal Judicial Center, Integrated Database (IDB): criminal defendants filed, terminated and pending, FY1996 to present",
        "source_page": SOURCE_PAGE, "source_file": SOURCE_FILE, "codebook": jc.CRIMINAL_CODEBOOK,
        "offense_code_list": jc.APPEALS_CODEBOOK + " (Appendix B, criminal offense codes)",
        "snapshot": "cr96on.zip (last modified 2026-08-27 on fjc.gov): fiscal-year snapshots FY1996 through June 30, 2026",
        "terms": "Public data published by the Federal Judicial Center (U.S. government work). The FJC and the AO do not vouch for analyses built from it.",
        "grain": "one record per district court (94) and one national record; counts of defendants, no person-level rows",
        "unit": "defendants", "definitions": __doc__.split("Unit: defendants.", 1)[1].strip(),
        "offense_groups": [{"group": k, "label": lbl, "rule": "AO offense code description contains: " + ", ".join(w)} for k, lbl, w in jc.OFFENSE_GROUPS]
        + [{"group": "regulatory_other", "label": jc.OFFENSE_GROUP_LABEL["regulatory_other"], "rule": "any other code in the codebook list (9400 and 9923 included)"}],
        "disposition_groups": jc.CRIM_DISP_GROUP_LABEL, "sentence_types": jc.SENTENCE_TYPE_LABEL,
        "denominators": {"conviction_pct": "convicted / disposed (CTTR)", "plea_pct": "convicted by plea / convicted",
                         "trial_pct": "convicted or acquitted after a bench or jury trial / disposed", "prison_pct": "prison sentences / convicted",
                         "min_base": "percentages are omitted when the base is under 10"},
        "window": f"FY{ic.WINDOW[0]}-FY{ic.WINDOW[1]}", "latest_complete_fy": ic.LATEST_FY,
        "partial_fy": f"FY{ic.PARTIAL_FY} = Oct 1, 2025 - Jun 30, 2026",
        "quality": {**counts, "extract_rows": meta["rows"], "bad_lines": meta["bad_lines"], "fjc_published_record_count": 6323251},
        "excluded": "Defendant names (blank on the public file), judge codes (blank), docket numbers and county codes are not used.",
        "built_at": built,
    }
    build = {"dataset": DATASET, "label": "Federal district courts - criminal defendants by offense category, disposition and sentence type, FY1996-FY2026 (FJC Integrated Database)",
             "listing_block": listing(), "summary": summary, "rows": rows, "built_at": built,
             "inputs": [{"url": SOURCE_FILE, "path": meta["zip"], "sha256": meta["sha256"]},
                        {"url": jc.CRIMINAL_CODEBOOK, "path": "private/acq/judiciary/codebooks/sites/default/files/idb/codebooks/Criminal_Code_Book_1996_Forward.pdf"}]}
    (BUILD / f"{DATASET}.json").write_text(json.dumps(build))
    print(json.dumps({"dataset": DATASET, "records": len(rows), **{k: v for k, v in counts.items() if not k.startswith("offense_group_")}}))


def record(rid, title, court, state, payload, latest, links):
    lat = latest or {}
    facts = [
        ["Defendants filed, FY2025 (including transfers)", ic.fmt_int(lat.get("filed"))],
        ["Defendants terminated, FY2025 (including transfers)", ic.fmt_int(lat.get("terminated"))],
        ["Convicted, FY2025", f"{ic.fmt_int(lat.get('convicted'))} of {ic.fmt_int(lat.get('disposed'))} disposed ({ic.fmt_pct(lat.get('conviction_pct'))})"],
        ["Convicted by plea, FY2025", ic.fmt_pct(lat.get("plea_pct"))],
        ["Prison sentences among convicted, FY2025", ic.fmt_pct(lat.get("prison_pct"))],
        ["Median prison term, FY2025", "Not recorded" if lat.get("median_prison_months") is None else f"{lat['median_prison_months']:g} months"],
        ["Median days from proceeding to termination, FY2025", ic.fmt_int(lat.get("median_days_to_termination"))],
        ["Pending at the end of FY2025", ic.fmt_int(lat.get("pending"))],
        ["Source", "Federal Judicial Center, Integrated Database, criminal defendants FY1996 to present (cr96on.zip)"],
    ]
    rl = list(links)
    if court:
        rl.insert(0, {"url": f"/courts/{court}", "label": "Court profile"})
    cells = {"court": court or "All districts", "filed_fy2025": ic.fmt_int(lat.get("filed")), "terminated_fy2025": ic.fmt_int(lat.get("terminated")),
             "plea_pct_fy2025": ic.fmt_pct(lat.get("plea_pct")), "prison_pct_fy2025": ic.fmt_pct(lat.get("prison_pct"))}
    return {"dataset": DATASET, "id": rid, "category": DATASET, "state": state or "", "title": title, "source_url": SOURCE_FILE,
            "item": {"id": rid, "title": title, "subtitle": "FJC Integrated Database, criminal defendants", "cells": cells, "badges": [],
                     "links": rl, **payload},
            "detail": {"id": rid, "title": title, "subtitle": "FJC Integrated Database, criminal defendants", "facts": facts, "links": rl},
            "text": f"{rid} {title} criminal defendants sentencing", "filters": {"_listing": ["yes"], "kind": [payload["kind"]], "court": [court] if court else []}}


def listing():
    return {"page": 1, "limit": 50,
            "columns": [{"key": "court", "label": "District"}, {"key": "filed_fy2025", "label": "Filed FY2025"}, {"key": "terminated_fy2025", "label": "Terminated FY2025"},
                        {"key": "plea_pct_fy2025", "label": "Plea share FY2025"}, {"key": "prison_pct_fy2025", "label": "Prison share FY2025"}],
            "filters": [{"name": "q", "type": "search", "label": "Search"}]}


if __name__ == "__main__":
    main()
