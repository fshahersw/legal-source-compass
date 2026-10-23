"""DOL OSHA enforcement data catalog → safety.osha_inspections, safety.osha_violations, safety.osha_accidents.

  python3 -I scripts/safety_v2/osha_build.py [--since 2015-01-01] [--inspections local|remote] [--sample N] [--outdir DIR]

Sources (data.dol.gov OSHA data catalog; each zip holds CSV chunk members, STORED):
  inspection  https://data.dol.gov/data-catalog/OSHA/inspection/OSHA_inspection.zip (local copy of 2026-10-17 in
              private/acq/osha/dol/inspection/ when present, else read through HTTP Range requests)
  violation   https://data.dol.gov/data-catalog/OSHA/violation/OSHA_violation.zip (Range reads, member by member)
  accident    https://data.dol.gov/data-catalog/OSHA/accident/OSHA_accident.zip and accident_injury
Kept: inspections opened on/after --since; their violations (citations whose DELETE_FLAG is 'X' — deleted — are left
out); accident investigations with an event on/after --since, with their injury lines (age and sex left out) and the
inspections they name. Withheld: establishment street and mailing addresses. OSHA Severe Injury Reports are not
included: their record-level file answers 403 to automated requests (osha.gov bot wall) and is not fetched.
"""
import argparse
import csv
import gzip
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

csv.field_size_limit(10 ** 8)
CATALOG = "https://data.dol.gov/data-catalog/OSHA/{0}/OSHA_{0}.zip"
LOCAL_INSPECTIONS = c.ROOT / "private" / "acq" / "osha" / "dol" / "inspection"


def d(v):
    m = re.match(r"(\d{4}-\d{2}-\d{2})", (v or "").strip())
    return m.group(1) if m and not m.group(1).startswith("0") else None


def i(v):
    v = (v or "").strip()
    m = re.fullmatch(r"(-?\d+)(\.0+)?", v)
    return int(m.group(1)) if m else None


def money(v):
    v = (v or "").strip()
    return v if re.fullmatch(r"-?\d{1,12}(\.\d{1,2})?", v) else None


def s(v):
    v = (v or "").strip()
    return v if v and v.lower() not in ("nan", "nat") else None


def csv_rows(fileobj):
    text = io.TextIOWrapper(fileobj, encoding="utf-8-sig", errors="replace", newline="")
    yield from csv.DictReader(text)


def remote_zip(name):
    rf = c.RangeFile(CATALOG.format(name), block=32 << 20)
    return zipfile.ZipFile(io.BufferedReader(rf, buffer_size=32 << 20)), rf


def remote_members(name, last=0):
    """Yield (member name, file) of a catalog zip, in order (or only the last `last` members); sets remote_members.last."""
    z, rf = remote_zip(name)
    infos = z.infolist()[-last:] if last else z.infolist()
    for info in infos:
        with z.open(info) as f:
            yield info.filename, f
    remote_members.last = {"url": CATALOG.format(name), "bytes": rf.size, "last_modified": rf.last_modified,
                           "range_requests": rf.requests, "members_read": [x.filename for x in infos]}


def inspections(args, inputs):
    if args.inspections == "local" and LOCAL_INSPECTIONS.exists():
        files = sorted(LOCAL_INSPECTIONS.glob("*.csv.gz"))
        for p in files:
            inputs.append({"path": str(p.relative_to(c.ROOT)), "sha256": c.sha256_file(p), "url": CATALOG.format("inspection")})
            with gzip.open(p, "rb") as f:
                yield from csv_rows(f)
    else:
        for _, f in remote_members("inspection"):
            yield from csv_rows(f)
        inputs.append(remote_members.last)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2015-01-01")
    ap.add_argument("--inspections", choices=["local", "remote"], default="local")
    ap.add_argument("--sample", type=int, default=0, help="keep at most N inspections (validation sample)")
    ap.add_argument("--violation-members", type=int, default=0, help="read only the last N violation members (sample)")
    ap.add_argument("--outdir", default=str(c.BUILD / "osha"))
    ap.add_argument("--chunk-rows", type=int, default=5000)
    args = ap.parse_args()
    out = Path(args.outdir)
    tag = c.sha256_bytes(c.utc_now().encode())[:6]
    inputs = []
    wi = c.ChunkWriter(out / "chunks", f"osha_inspections-{tag}", max_rows=args.chunk_rows, source="dol_osha")
    kept = set()
    with_violations = None
    if args.sample:  # a sample keeps inspections that have citations in the violation members it reads
        with_violations = set()
        for _, f in remote_members("violation", args.violation_members):
            for r in csv_rows(f):
                nr = i(r.get("ACTIVITY_NR"))
                if nr:
                    with_violations.add(nr)
    for r in inspections(args, inputs):
        nr = i(r.get("ACTIVITY_NR"))
        opened = d(r.get("OPEN_DATE"))
        if not nr or not opened or opened < args.since or nr in kept:
            continue
        if with_violations is not None and nr not in with_violations:
            continue
        kept.add(nr)
        wi.add({"activity_nr": nr, "reporting_id": s(r.get("REPORTING_ID")), "state_flag": s(r.get("STATE_FLAG")),
                "estab_name": s(r.get("ESTAB_NAME")), "site_city": s(r.get("SITE_CITY")), "site_state": s(r.get("SITE_STATE")),
                "site_zip": s(r.get("SITE_ZIP")), "owner_type": s(r.get("OWNER_TYPE")), "naics_code": s(r.get("NAICS_CODE")),
                "sic_code": s(r.get("SIC_CODE")), "insp_type": s(r.get("INSP_TYPE")), "insp_scope": s(r.get("INSP_SCOPE")),
                "safety_hlth": s(r.get("SAFETY_HLTH")), "union_status": s(r.get("UNION_STATUS")), "nr_in_estab": i(r.get("NR_IN_ESTAB")),
                "open_date": opened, "close_conf_date": d(r.get("CLOSE_CONF_DATE")), "close_case_date": d(r.get("CLOSE_CASE_DATE"))})
        if args.sample and len(kept) >= args.sample:
            break
    # violations of the kept inspections
    wv = c.ChunkWriter(out / "chunks", f"osha_violations-{tag}", max_rows=args.chunk_rows, source="dol_osha")
    nv = deleted = 0
    seen = set()
    for name, f in remote_members("violation", args.violation_members):
        for r in csv_rows(f):
            nr = i(r.get("ACTIVITY_NR"))
            if nr not in kept:
                continue
            if (r.get("DELETE_FLAG") or "").strip().upper() == "X":
                deleted += 1
                continue
            cid = (r.get("CITATION_ID") or "").strip()
            if not re.fullmatch(r"[0-9A-Za-z]{1,10}", cid) or (nr, cid) in seen:
                continue
            seen.add((nr, cid))
            nv += 1
            wv.add({"activity_nr": nr, "citation_id": cid, "standard": s(r.get("STANDARD")), "viol_type": s(r.get("VIOL_TYPE")),
                    "issuance_date": d(r.get("ISSUANCE_DATE")), "abate_date": d(r.get("ABATE_DATE")),
                    "current_penalty": money(r.get("CURRENT_PENALTY")), "initial_penalty": money(r.get("INITIAL_PENALTY")),
                    "contest_date": d(r.get("CONTEST_DATE")), "final_order_date": d(r.get("FINAL_ORDER_DATE")),
                    "nr_instances": i(r.get("NR_INSTANCES")), "nr_exposed": i(r.get("NR_EXPOSED")), "gravity": s(r.get("GRAVITY"))})
    inputs.append(remote_members.last)
    # accidents (event on/after since) with injury lines; in a sample, only accidents naming a kept inspection
    injuries = defaultdict(list)
    insp_of = defaultdict(set)
    for _, f in remote_members("accident_injury"):
        for r in csv_rows(f):
            sn = i(r.get("SUMMARY_NR"))
            if not sn:
                continue
            rel = i(r.get("REL_INSP_NR"))
            if rel:
                insp_of[sn].add(rel)
            injuries[sn].append({k: s(r.get(v)) for k, v in (("rel_insp_nr", "REL_INSP_NR"), ("degree_of_inj", "DEGREE_OF_INJ"),
                                 ("nature_of_inj", "NATURE_OF_INJ"), ("part_of_body", "PART_OF_BODY"), ("src_of_injury", "SRC_OF_INJURY"),
                                 ("event_type", "EVENT_TYPE"), ("evn_factor", "EVN_FACTOR"), ("hum_factor", "HUM_FACTOR"),
                                 ("occ_code", "OCC_CODE"), ("task_assigned", "TASK_ASSIGNED"), ("fat_cause", "FAT_CAUSE"))})
    inputs.append(remote_members.last)
    wa = c.ChunkWriter(out / "chunks", f"osha_accidents-{tag}", max_rows=args.chunk_rows, source="dol_osha")
    na = 0
    for _, f in remote_members("accident"):
        for r in csv_rows(f):
            sn = i(r.get("SUMMARY_NR"))
            ev = d(r.get("EVENT_DATE"))
            if not sn or not ev or ev < args.since:
                continue
            if args.sample and not (insp_of.get(sn, set()) & kept):
                continue
            na += 1
            wa.add({"summary_nr": sn, "report_id": s(r.get("REPORT_ID")), "event_date": ev, "event_desc": s(r.get("EVENT_DESC")),
                    "event_keyword": s(r.get("EVENT_KEYWORD")), "fatality": True if (r.get("FATALITY") or "").strip().upper() in ("X", "Y", "1") else None,
                    "sic_list": s(r.get("SIC_LIST")), "state_flag": s(r.get("STATE_FLAG")), "abstract": (s(r.get("ABSTRACT_TEXT")) or "")[:20000] or None,
                    "inspections": sorted(insp_of.get(sn, [])), "injuries": injuries.get(sn, [])})
    inputs.append(remote_members.last)
    outputs = []
    for w, target in ((wi, "osha_inspections"), (wv, "osha_violations"), (wa, "osha_accidents")):
        res = w.close()
        res["target"] = target
        outputs.append(res)
    with open(out / "chunks" / "index.jsonl", "a") as f:
        for res in outputs:
            for ch in res["chunks"]:
                f.write(json.dumps({**ch, "target": res["target"]}) + "\n")
    c.write_manifest(out, "osha", outputs, inputs, {"since": args.since, "inspections": len(kept), "violations": nv,
                     "deleted_citations_left_out": deleted, "accidents": na, "sample": args.sample,
                     "withheld_fields": ["SITE_ADDRESS", "MAIL_STREET", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP", "injury AGE", "injury SEX"],
                     "not_included": "OSHA Severe Injury Reports (record-level file answers 403 to automated requests)"})
    print(json.dumps({"inspections": len(kept), "violations": nv, "deleted_left_out": deleted, "accidents": na}))


if __name__ == "__main__":
    main()
