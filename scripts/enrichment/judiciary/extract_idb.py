"""First pass over the FJC IDB appeals, criminal and bankruptcy files: decode codes and keep only aggregate-ready fields.

  python3 -I -B extract_idb.py appeals      -> private/build/judiciary/extract_appeals.tsv.gz   (one line per appeal record)
  python3 -I -B extract_idb.py criminal     -> private/build/judiciary/extract_criminal.tsv.gz  (one line per defendant snapshot)
  python3 -I -B extract_idb.py bankruptcy   -> private/build/judiciary/agg_bankruptcy.json      (counts only)

No names, docket numbers, judge codes, ZIP or county codes are carried over: the extracts hold only the coded fields the
published aggregates need, and stay private. The raw zips are read through `unzip -p` (idb_stream); nothing uncompressed is
written to disk. Each output records the zip's sha256 (from the acquisition manifest), its row count and the lines rejected
for a wrong column count.
"""
from __future__ import annotations

import collections
import gzip
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import idb_stream  # noqa: E402
import jcodes as jc  # noqa: E402

ACQ = fl.ACQ / "fjc_idb"
OUT = fl.ROOT / "private" / "build" / "judiciary"
ZIPS = {"appeals": ACQ / "ap08on_0.zip", "criminal": ACQ / "cr96on.zip",
        "bankruptcy": [ACQ / "cpbank08to17.zip", ACQ / "cpbank18on.zip"]}

APPEALS_FIELDS = ["fy", "status", "circuit", "origin", "type_group", "trmtype", "nos", "agency", "disp", "outcome", "procterm",
                  "method", "pubstat", "days", "dktdate", "judgdate", "joinapp", "opdisp", "apptype"]
CRIMINAL_FIELDS = ["fy", "district", "ctfil", "cttr", "ctpn", "foffcd1", "toffcd1", "disp1", "pristot", "probtot", "finetot",
                   "procdate", "termdate", "tcounsel", "procdays", "ctfiltrn", "cttrtrn", "status", "ctpnwof"]


def days_between(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    d = (date.fromisoformat(b) - date.fromisoformat(a)).days
    return d if d >= 0 else None


def appeal_record(r: dict) -> dict:
    """Decode one appeals row into the extract fields (pure; unit-tested)."""
    status = r.get("STATUSCD", "").strip()
    trm = jc.as_int(r.get("TRMTYPE"))
    app = jc.as_int(r.get("APPTYPE"))
    typ = trm if trm is not None else app
    group = jc.APPEAL_TYPE_GROUP.get(typ, "not_recorded") if typ is not None else "not_recorded"
    ddist = r.get("DDIST", "").strip()
    origin = jc.district_court_id(ddist)
    agency = r.get("AGENCY", "").strip()
    if origin is None:
        origin = f"agency:{agency}" if group == "administrative" and agency not in ("", "-8", "-9") else "not_recorded"
    nos = jc.as_int(r.get("NOS")) if group in ("civil_us", "civil_private") else None
    dkt = jc.mdy_to_iso(r.get("DKTDATE"))
    judg = jc.mdy_to_iso(r.get("JUDGDATE"))
    return {
        "fy": r.get("TAPEYEAR", "").strip(), "status": status, "circuit": jc.circuit_id(r.get("CIRCUIT", "")) or "not_recorded",
        "origin": origin, "type_group": group, "trmtype": "" if typ is None else str(typ), "nos": "" if nos is None else str(nos),
        "agency": agency if group == "administrative" else "", "disp": r.get("DISP", "").strip(), "outcome": r.get("OUTCOME", "").strip(),
        "procterm": r.get("PROCTERM", "").strip(), "method": r.get("METHOD", "").strip(), "pubstat": r.get("PUBSTAT", "").strip(),
        "days": "" if status != "L" else str(days_between(dkt, judg) if days_between(dkt, judg) is not None else ""),
        "dktdate": dkt or "", "judgdate": judg or "", "joinapp": r.get("JOINAPP", "").strip(), "opdisp": r.get("OPDISP", "").strip(),
        "apptype": "" if app is None else str(app),
    }


def criminal_record(r: dict) -> dict:
    proc = jc.mdy_to_iso(r.get("PROCDATE"))
    term = jc.mdy_to_iso(r.get("TERMDATE"))
    pd = days_between(proc, term) if r.get("CTTR", "").strip() == "1" else None
    return {
        "fy": r.get("FISCALYR", "").strip(), "district": r.get("DISTRICT", "").strip(), "ctfil": r.get("CTFIL", "").strip(),
        "cttr": r.get("CTTR", "").strip(), "ctpn": r.get("CTPN", "").strip(), "foffcd1": r.get("FOFFCD1", "").strip(),
        "toffcd1": r.get("TOFFCD1", "").strip(), "disp1": r.get("DISP1", "").strip(), "pristot": r.get("PRISTOT", "").strip(),
        "probtot": r.get("PROBTOT", "").strip(), "finetot": r.get("FINETOT", "").strip(), "procdate": proc or "",
        "termdate": term or "", "tcounsel": r.get("TCOUNSEL", "").strip(), "procdays": "" if pd is None else str(pd),
        "ctfiltrn": r.get("CTFILTRN", "").strip(), "cttrtrn": r.get("CTTRTRN", "").strip(), "status": r.get("STATUSCD", "").strip(), "ctpnwof": r.get("CTPNWOF", "").strip(),
    }


def write_extract(kind: str, fields: list[str], decode) -> None:
    zpath = ZIPS[kind]
    dest = OUT / f"extract_{kind}.tsv.gz"
    tmp = dest.with_suffix(".part")
    n = bad = 0
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=5) as out:
        out.write("\t".join(fields) + "\n")
        for r in idb_stream.rows(zpath):
            if r.get("__bad__"):
                bad += 1
                continue
            rec = decode(r)
            out.write("\t".join(rec[f] for f in fields) + "\n")
            n += 1
    tmp.replace(dest)
    meta = {"kind": kind, "zip": str(zpath.relative_to(fl.ROOT)), "sha256": zip_sha(zpath), "rows": n, "bad_lines": bad, "extract": str(dest.relative_to(fl.ROOT))}
    (OUT / f"extract_{kind}.meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta))


def zip_sha(zpath: Path) -> str | None:
    rel = str(zpath.relative_to(fl.ROOT))
    for line in fl.MANIFEST.read_text().splitlines():
        e = json.loads(line)
        if e.get("path") == rel:
            return e["sha256"]
    return None


def bankruptcy_key(r: dict):
    """Counting keys of one snapshot record (pure; unit-tested): (period, district, measure, raw chapter codes, eras, nature
    of debt, subchapter V, original nature of debt). Chapter codes stay raw here; the builder decodes them with the code set of the right era."""
    snap = jc.mdy_to_iso(r.get("SNAPSHOT"))
    if not snap:
        return []
    fy = int(snap[:4]) + (1 if snap[5:7] in ("10", "11", "12") else 0)
    partial = not snap.endswith("-09-30")
    period = snap if partial else str(fy)
    dist = r.get("DISTRICT", "").strip()
    orig = jc.mdy_to_iso(r.get("ORGFLDT")) or ""
    filed = jc.mdy_to_iso(r.get("FILEDATE")) or ""
    era_orig = "new" if (orig or filed) >= "2005-10-17" else "old"
    era_file = "new" if filed >= "2005-10-17" else "old"
    debt = r.get("NTRDBT", "").strip().lower() or "blank"
    debt_orig = r.get("ORGNTRDBT", "").strip().lower() or "blank"
    sub_v = "V" in (r.get("CRNTFLSUBCHP", "") + r.get("ORGFLSUBCHP", "")).upper()
    cur = r.get("CRNTCHP", "").strip().lower()
    org = r.get("ORGFLCHP", "").strip().lower()
    out = []
    if r.get("SNAPFILE", "").strip() == "1":
        out.append((period, dist, "filed", cur, org, era_orig, era_file, debt, sub_v, debt_orig))
    if r.get("SNAPCLOS", "").strip() == "1":
        out.append((period, dist, "closed", (r.get("CLCHPT", "").strip().lower() or cur), org, era_orig, era_file, debt, sub_v, debt_orig))
    if r.get("SNAPPEND", "").strip() == "1":
        out.append((period, dist, "pending_end", cur, org, era_orig, era_file, debt, sub_v, debt_orig))
    return out


def agg_bankruptcy() -> None:
    counts: collections.Counter = collections.Counter()
    snaps: collections.Counter = collections.Counter()
    files = []
    for zpath in ZIPS["bankruptcy"]:
        n = bad = 0
        for r in idb_stream.rows(zpath):
            if r.get("__bad__"):
                bad += 1
                continue
            n += 1
            snaps[r.get("SNAPSHOT", "").strip()] += 1
            for key in bankruptcy_key(r):
                counts[key] += 1
        files.append({"zip": str(zpath.relative_to(fl.ROOT)), "sha256": zip_sha(zpath), "rows": n, "bad_lines": bad})
        print(json.dumps(files[-1]), flush=True)
    out = {"files": files, "snapshots": dict(sorted(snaps.items())),
           "cells": [[*k, v] for k, v in sorted(counts.items(), key=lambda kv: tuple(str(x) for x in kv[0]))]}
    (OUT / "agg_bankruptcy.json").write_text(json.dumps(out))
    print(json.dumps({"cells": len(out["cells"]), "snapshots": out["snapshots"]}))


def main(kind: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if kind == "appeals":
        write_extract("appeals", APPEALS_FIELDS, appeal_record)
    elif kind == "criminal":
        write_extract("criminal", CRIMINAL_FIELDS, criminal_record)
    elif kind == "bankruptcy":
        agg_bankruptcy()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1])
