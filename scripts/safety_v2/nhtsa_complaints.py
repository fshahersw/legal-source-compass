"""NHTSA ODI vehicle complaints received 2020+ → safety.nhtsa_complaints (record level) and the vehicle MDL groups'
monthly complaint series and record links, streamed from the official flat-file zips without storing them.

  python3 -I scripts/safety_v2/nhtsa_complaints.py [--files 2020-2024,2025-2026] [--limit N] [--outdir DIR]

Source: https://static.nhtsa.gov/odi/ffdd/cmpl/COMPLAINTS_RECEIVED_<years>.zip (tab-delimited, field list CMPL.txt,
51 fields since 2026-04-30). The zip is read as a stream (local file header + raw deflate) and never
written to disk; lines are UTF-8 (a line that is not valid UTF-8 is read as cp1252 and counted in the manifest). A
flat-file row is one (complaint, component, vehicle); rows are grouped by ODI number.

Monthly series are written only from a complete read of contiguous files (the default 2020-2024,2025-2026 → 2020-01 ..
the month before the last received date). A --limit sample is a partial read of a file that is not date-sorted, so it
writes records and links only.

Withheld (never stored): VIN, consumer city, dealer name/telephone/city/state/zip, vehicle operator's name (field 51),
tire DOT code. Kept: dates, manufacturer, make/model/year/component per row, crash/fire/injured/deaths, consumer and
incident state, mileage, speed, complaint type, police/medical/towed flags, product type, the complaint description.
"""
import argparse
import json
import re
import struct
import sys
import urllib.request
import zlib
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
import mdl_map  # noqa: E402

BASE = "https://static.nhtsa.gov/odi/ffdd/cmpl/"
FIELDS = ["CMPLID", "ODINO", "MFR_NAME", "MAKETXT", "MODELTXT", "YEARTXT", "CRASH", "FAILDATE", "FIRE", "INJURED", "DEATHS",
          "COMPDESC", "CITY", "STATE", "VIN", "DATEA", "LDATE", "MILES", "OCCURENCES", "CDESCR", "CMPL_TYPE", "POLICE_RPT_YN",
          "PURCH_DT", "ORIG_OWNER_YN", "ANTI_BRAKES_YN", "CRUISE_CONT_YN", "NUM_CYLS", "DRIVE_TRAIN", "FUEL_SYS", "FUEL_TYPE",
          "TRANS_TYPE", "VEH_SPEED", "DOT", "TIRE_SIZE", "LOC_OF_TIRE", "TIRE_FAIL_TYPE", "ORIG_EQUIP_YN", "MANUF_DT",
          "SEAT_TYPE", "RESTRAINT_TYPE", "DEALER_NAME", "DEALER_TEL", "DEALER_CITY", "DEALER_STATE", "DEALER_ZIP", "PROD_TYPE",
          "REPAIRED_YN", "MEDICAL_ATTN", "VEHICLES_TOWED_YN", "STATE_OF_INCIDENT", "VEHICLE_OPERATOR"]
IX = {k: i for i, k in enumerate(FIELDS)}


def stream_zip_member(url, http_block=1 << 20):
    """Yield the decompressed bytes of the first member of a remote zip, reading the response as a stream."""
    req = urllib.request.Request(url, headers={"User-Agent": c.UA})
    with urllib.request.urlopen(req, timeout=300) as resp:
        buf = b""
        while len(buf) < 30:
            more = resp.read(http_block)
            if not more:
                raise RuntimeError("zip ended before the first header")
            buf += more
        sig, _ver, flags, method, _t, _d, _crc, _csize, _usize, nlen, xlen = struct.unpack("<IHHHHHIIIHH", buf[:30])
        if sig != 0x04034B50:
            raise RuntimeError("not a zip local file header")
        while len(buf) < 30 + nlen + xlen:
            buf += resp.read(http_block)
        name = buf[30:30 + nlen].decode("cp437")
        data = buf[30 + nlen + xlen:]
        if method == 0:
            raise RuntimeError("stored members are not supported by the stream reader")
        if method != 8:
            raise RuntimeError(f"unsupported compression method {method}")
        d = zlib.decompressobj(-15)
        stream_zip_member.name = name
        stream_zip_member.raw_bytes = 0
        while True:
            if data:
                stream_zip_member.raw_bytes += len(data)
                out = d.decompress(data)
                if out:
                    yield out
                if d.eof:
                    break
            data = resp.read(http_block)
            if not data:
                break
        tail = d.flush()
        if tail:
            yield tail


DECODE = {"utf8": 0, "cp1252": 0}


def decode(line):
    """The flat files are UTF-8; a line that is not valid UTF-8 (legacy rows) is read as cp1252 and counted."""
    try:
        DECODE["utf8"] += 1
        return line.decode("utf-8")
    except UnicodeDecodeError:
        DECODE["utf8"] -= 1
        DECODE["cp1252"] += 1
        return line.decode("cp1252", errors="replace")


def lines_of(chunks):
    pending = b""
    for chunk in chunks:
        pending += chunk
        *full, pending = pending.split(b"\n")
        for line in full:
            yield decode(line.rstrip(b"\r"))
    if pending:
        yield decode(pending.rstrip(b"\r"))


def yn(v):
    v = (v or "").strip().upper()
    return True if v == "Y" else False if v == "N" else None


def num(v, kind=int):
    v = (v or "").strip()
    if not re.fullmatch(r"-?\d+(\.\d+)?", v):
        return None
    try:
        return kind(float(v)) if kind is int else kind(v)
    except ValueError:
        return None


def parse_rows(lines):
    """Flat-file rows (51 fields; older files 49) as dicts of the kept fields."""
    for line in lines:
        if not line.strip():
            continue
        f = line.split("\t")
        if len(f) < 49:
            continue
        f += [""] * (len(FIELDS) - len(f))
        g = lambda k: f[IX[k]].strip()  # noqa: E731
        yield {
            "odino": g("ODINO"), "manufacturer": g("MFR_NAME"), "make": g("MAKETXT"), "model": g("MODELTXT"),
            "year": g("YEARTXT"), "crash": yn(g("CRASH")), "faildate": c.iso(g("FAILDATE")), "fire": yn(g("FIRE")),
            "injured": num(g("INJURED")), "deaths": num(g("DEATHS")), "component": g("COMPDESC"), "state": g("STATE"),
            "added": c.iso(g("DATEA")), "received": c.iso(g("LDATE")), "miles": num(g("MILES")), "description": f[IX["CDESCR"]].strip(),
            "cmpl_type": g("CMPL_TYPE"), "police": yn(g("POLICE_RPT_YN")), "speed": num(g("VEH_SPEED")), "prod_type": g("PROD_TYPE"),
            "medical": yn(g("MEDICAL_ATTN")), "towed": yn(g("VEHICLES_TOWED_YN")), "incident_state": g("STATE_OF_INCIDENT"),
        }


def group_complaints(rows, since="2020-01-01"):
    """Group flat-file rows by ODI number into one complaint each (items = the distinct make/model/year/component)."""
    out = {}
    for r in rows:
        if not re.fullmatch(r"[1-9]\d{0,9}", r["odino"]) or not r["received"] or r["received"] < since:
            continue
        k = int(r["odino"])
        cpl = out.get(k)
        item = {"make": r["make"], "model": r["model"], "model_year": r["year"] if re.fullmatch(r"(19|20)\d\d", r["year"]) else None,
                "component": r["component"]}
        if cpl is None:
            out[k] = cpl = {
                "odino": k, "received": r["received"], "added": r["added"], "incident_date": r["faildate"],
                "manufacturer": r["manufacturer"] or None, "items": [], "crash": r["crash"], "fire": r["fire"],
                "injured": r["injured"], "deaths": r["deaths"], "consumer_state": r["state"] or None,
                "incident_state": r["incident_state"] or None, "miles": r["miles"], "speed": r["speed"],
                "complaint_type": r["cmpl_type"] or None, "police_report": r["police"], "medical_attention": r["medical"],
                "towed": r["towed"], "product_type": r["prod_type"] or None, "description": (r["description"] or None),
            }
        if item not in cpl["items"]:
            cpl["items"].append(item)
        for flag in ("crash", "fire", "police_report", "medical_attention", "towed"):
            src = {"police_report": "police", "medical_attention": "medical"}.get(flag, flag)
            if r[src] is True:
                cpl[flag] = True
        for n in ("injured", "deaths"):
            if r[n] is not None and (cpl[n] is None or r[n] > cpl[n]):
                cpl[n] = r[n]
        if cpl["description"] and len(cpl["description"]) > 4000:
            cpl["description"] = cpl["description"][:4000]
    return out


def matches(rule, cpl):
    """The vehicle MDL rule (mdl_map): make in list, model contains, component contains, text in the description or a
    component, fire flag — all given parts must hold, on the same item for make/model/component."""
    text = (cpl.get("description") or "").upper()
    comps = " ".join(i["component"] for i in cpl["items"]).upper()
    if rule.get("fire") and not cpl.get("fire"):
        return False
    if rule.get("text") and not any(t in text or t in comps for t in rule["text"]):
        return False
    for i in cpl["items"]:
        if rule.get("make") and i["make"].upper() not in rule["make"]:
            continue
        if rule.get("model") and not any(m in i["model"].upper() for m in rule["model"]):
            continue
        if rule.get("component") and not any(x in i["component"].upper() for x in rule["component"]):
            continue
        return True
    return False


def series_window(spans, last_received, complete):
    """(coverage_from, coverage_to) of the monthly complaint series, or None when the read cannot support complete
    monthly counts: a partial read (--limit; the flat files are not date-sorted) or files that are not contiguous
    (e.g. 2020-2024 and 2025-2026 → 2020-01 .. the month before the last received date, which may still be filling)."""
    if not complete or not spans or not last_received:
        return None
    years = sorted(tuple(int(y) for y in s.split("-")) for s in spans)
    for (a0, a1), (b0, b1) in zip(years, years[1:]):
        if b0 != a1 + 1:
            return None
    through = c.month_add(last_received[:7], -1)
    start = f"{years[0][0]:04d}-01"
    return (start, through) if through >= start else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", default="2020-2024,2025-2026")
    ap.add_argument("--limit", type=int, default=0, help="stop after N flat-file rows per file (validation samples)")
    ap.add_argument("--outdir", default=str(c.BUILD / "nhtsa"))
    ap.add_argument("--chunk-rows", type=int, default=2000)
    args = ap.parse_args()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    complaints, inputs = {}, []
    for span in args.files.split(","):
        url = f"{BASE}COMPLAINTS_RECEIVED_{span}.zip"
        rows, n = [], 0
        gen = stream_zip_member(url)
        for r in parse_rows(lines_of(gen)):
            rows.append(r)
            n += 1
            if args.limit and n >= args.limit:
                break
        if args.limit:
            gen.close()
        part = group_complaints(rows)
        complaints.update(part)
        inputs.append({"url": url, "member": getattr(stream_zip_member, "name", None), "rows": n, "complaints": len(part),
                       "complete": not args.limit, "read_at": c.utc_now(), "decoded_lines": dict(DECODE)})
        del rows
    tag = c.sha256_bytes(c.utc_now().encode())[:6]
    wc = c.ChunkWriter(out / "chunks", f"nhtsa_complaints-{tag}", max_rows=args.chunk_rows, source="nhtsa_complaints")
    for k in sorted(complaints):
        wc.add(complaints[k])
    # vehicle MDL groups: record links, and monthly complaint series only from complete reads of contiguous files
    spans = args.files.split(",")
    last = max(cpl["received"] for cpl in complaints.values())
    window_bounds = series_window(spans, last, not args.limit)
    through = window_bounds[1] if window_bounds else None
    files_read = ", ".join(f"COMPLAINTS_RECEIVED_{s}.zip" for s in spans)
    subjects, links, series = [], [], []
    for e in mdl_map.MDLS:
        if e["kind"] != "vehicle":
            continue
        sid = f"mdl:{e['mdl']}"
        hit = [cpl for cpl in complaints.values() if matches(e["nhtsa"], cpl)]
        links += [{"subject_id": sid, "source": "nhtsa", "record_id": str(cpl["odino"]), "rule": "subject search.nhtsa"} for cpl in hit]
        if not window_bounds:
            continue
        for name, pred, unit in (("nhtsa_complaints", lambda x: True, "complaints received"),
                                 ("nhtsa_complaints_crash", lambda x: x.get("crash"), "complaints reporting a crash"),
                                 ("nhtsa_complaints_fire", lambda x: x.get("fire"), "complaints reporting a fire"),
                                 ("nhtsa_complaints_injury", lambda x: (x.get("injured") or 0) > 0 or (x.get("deaths") or 0) > 0,
                                  "complaints reporting an injury or death")):
            m2 = defaultdict(int)
            for cpl in hit:
                if pred(cpl):
                    m2[cpl["received"][:7]] += 1
            window = c.month_span(window_bounds[0], through)
            series.append({"subject_id": sid, "series": name, "unit": unit, "source_id": "nhtsa_complaints",
                           "query_url": f"{BASE}COMPLAINTS_RECEIVED_{sorted(spans)[0]}.zip",
                           "method": (f"NHTSA complaint flat files ({files_read}), complaints matched to the MDL's title rule "
                                      f"{json.dumps(e['nhtsa'], sort_keys=True)}, counted by the month NHTSA received them"),
                           "coverage_from": window_bounds[0], "coverage_to": through, "retrieved_at": c.utc_now(),
                           "vals": [m2.get(m, 0) for m in window]})
    wl = c.ChunkWriter(out / "chunks", f"record_subjects-{tag}", max_rows=args.chunk_rows, source="nhtsa_complaints")
    for i in range(0, len(links), args.chunk_rows):
        wl.add_group(links[i:i + args.chunk_rows])
    ws = c.ChunkWriter(out / "chunks", f"series-{tag}", max_rows=args.chunk_rows, source="nhtsa_complaints")
    for row in series:
        ws.add(row)
    outputs = []
    for w, target in ((wc, "nhtsa_complaints"), (wl, "record_subjects"), (ws, "series")):
        res = w.close()
        res["target"] = target
        outputs.append(res)
    with open(out / "chunks" / "index.jsonl", "a") as f:
        for res in outputs:
            for ch in res["chunks"]:
                f.write(json.dumps({**ch, "target": res["target"]}) + "\n")
    c.write_manifest(out, "nhtsa_complaints", outputs, inputs,
                     {"complaints": len(complaints), "through": through, "linked": len(links),
                      "series": ("written" if window_bounds else
                                 "not written: monthly series need complete reads of contiguous files (no --limit)"),
                      "withheld_fields": ["VIN", "CITY", "DEALER_NAME", "DEALER_TEL", "DEALER_CITY", "DEALER_STATE", "DEALER_ZIP",
                                          "VEHICLE_OPERATOR", "DOT"]})
    print(json.dumps({"complaints": len(complaints), "links": len(links), "through": through,
                      "rows": {o["target"]: o["rows"] for o in outputs}}))


if __name__ == "__main__":
    main()
