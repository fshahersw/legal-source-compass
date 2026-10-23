"""CPSC NEISS sample cases → safety.neiss_cases (HELD: see below), from the yearly NEISS files already acquired unchanged
in private/acq/neiss/tsv/neiss<year>.tsv.gz (https://www.cpsc.gov/cgibin/NEISSQuery/Data/Archived%20Data/<year>/neiss<year>.tsv).

  python3 -I scripts/safety_v2/neiss_cases.py [--years 2021-2025] [--limit N] [--outdir DIR]

HOLD: the owner removed the earlier `cpsc_injury_data` collection (NEISS 2025 sample rows) on 2026-10-05 and AGENTS.md
says it is not reacquired without a new instruction. These chunks are staged only; public.safety_load_v1 refuses
neiss_cases unless the call carries {"confirmed_by_lead": "<date> <note>"} (load.py --confirm-neiss), which the lead passes
only after confirming that the owner's 2026-10-23 request for record-level product-safety data covers NEISS case records.
The collection id is new (safety.neiss_cases); cpsc_injury_data is never restored.

NEISS records are a probability sample, not a census: national estimates need the weights (Weight), strata and PSUs
kept on every row, and CPSC's reliability rules (estimates below 1,200, fewer than 20 cases or CV above 33% are unstable).
"""
import argparse
import gzip
import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

SRC = c.ROOT / "private" / "acq" / "neiss" / "tsv"
URL = "https://www.cpsc.gov/cgibin/NEISSQuery/Data/Archived%20Data/{y}/neiss{y}.tsv"
INT_FIELDS = {"Age": "age", "Sex": "sex", "Race": "race", "Hispanic": "hispanic", "Body_Part": "body_part", "Diagnosis": "diagnosis",
              "Body_Part_2": "body_part_2", "Diagnosis_2": "diagnosis_2", "Disposition": "disposition", "Location": "location",
              "Fire_Involvement": "fire_involvement", "Product_1": "product_1", "Product_2": "product_2", "Product_3": "product_3",
              "Alcohol": "alcohol", "Drug": "drug", "PSU": "psu"}
TEXT_FIELDS = {"Other_Race": "other_race", "Other_Diagnosis": "other_diagnosis", "Other_Diagnosis_2": "other_diagnosis_2",
               "Narrative_1": "narrative", "Stratum": "stratum"}


def small(v):
    v = (v or "").strip()
    return int(v) if re.fullmatch(r"-?\d{1,5}", v) and -32768 <= int(v) <= 32767 else None


def parse(row, year):
    """One NEISS row (dict from the TSV header) → a neiss_cases loader row. Codes are kept as published."""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", row["Treatment_Date"].strip())
    if not m or not row["CPSC_Case_Number"].strip().isdigit():
        return None
    out = {"case_number": int(row["CPSC_Case_Number"]), "treatment_date": f"{m.group(3)}-{m.group(1)}-{m.group(2)}", "file_year": year}
    for k, v in INT_FIELDS.items():
        out[v] = small(row.get(k))
    for k, v in TEXT_FIELDS.items():
        t = (row.get(k) or "").strip()
        out[v] = t or None
    w = (row.get("Weight") or "").strip()
    out["weight"] = float(w) if re.fullmatch(r"\d+(\.\d+)?", w) else None
    return out


def physical_lines(path):
    """Physical lines of a NEISS file: the record terminator is CRLF; a bare LF inside a narrative stays in the record.
    Decoded as cp1252 (the files are Windows-encoded), as the earlier NEISS builder does."""
    raw = gzip.open(path, "rb")
    text = io.TextIOWrapper(raw, encoding="cp1252", errors="replace", newline="\r\n")
    for line in text:
        yield line[:-2] if line.endswith("\r\n") else line.rstrip("\n")
    text.close()


def records(path, stats):
    """Rows as header → value dicts. A record split by a stray break (fewer than 24 tabs) is rejoined with the next
    physical line(s), no separator inserted; more than 24 tabs (a tab inside the narrative) keeps the first 21 fields,
    the last 3, and joins the rest as the narrative. Unrepairable fragments are counted and skipped, never guessed."""
    it = physical_lines(path)
    header = [h.strip().strip('"') for h in next(it).split("\t")]
    ntab = len(header) - 1
    buf = None
    for line in it:
        if buf is None and line == "":
            continue
        if buf is not None:
            if line.count("\t") == ntab and buf.count("\t") < ntab:
                stats["fragments_skipped"] += 1
                buf = None
            else:
                buf += line
                if buf.count("\t") == ntab:
                    stats["rejoined"] += 1
                    yield dict(zip(header, buf.split("\t")))
                    buf = None
                elif buf.count("\t") > ntab:
                    stats["fragments_skipped"] += 1
                    buf = None
                continue
        t = line.count("\t")
        if t == ntab:
            yield dict(zip(header, line.split("\t")))
        elif t < ntab:
            buf = line
        else:
            f = line.split("\t")
            stats["narrative_tabs_merged"] += 1
            yield dict(zip(header, f[:21] + ["\t".join(f[21:-3])] + f[-3:]))
    if buf is not None:
        stats["fragments_skipped"] += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2021-2025")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--outdir", default=str(c.BUILD / "neiss"))
    ap.add_argument("--chunk-rows", type=int, default=5000)
    ap.add_argument("--check-corpus", action="store_true",
                    help="compare each year's case count and weight sum with the published neiss_national_years record (read-only)")
    args = ap.parse_args()
    a, _, b = args.years.partition("-")
    years = list(range(int(a), int(b or a) + 1))
    out = Path(args.outdir)
    tag = c.sha256_bytes(c.utc_now().encode())[:6]
    w = c.ChunkWriter(out / "chunks", f"neiss_cases-{tag}", max_rows=args.chunk_rows, source="cpsc_neiss")
    inputs, stats = [], {}
    for y in years:
        path = SRC / f"neiss{y}.tsv.gz"
        n = kept = 0
        wsum = 0.0
        repair = {"rejoined": 0, "narrative_tabs_merged": 0, "fragments_skipped": 0}
        for row in records(path, repair):
            n += 1
            rec = parse(row, y)
            if rec is None:
                continue
            kept += 1
            wsum += rec["weight"] or 0
            w.add(rec)
            if args.limit and kept >= args.limit:
                break
        inputs.append({"path": str(path.relative_to(c.ROOT)), "sha256_gz": c.sha256_file(path), "url": URL.format(y=y), "records": n})
        stats[y] = {"records": n, "cases": kept, "weight_sum": round(wsum, 4), "complete": not args.limit, **repair}
    res = w.close()
    res["target"] = "neiss_cases"
    with open(out / "chunks" / "index.jsonl", "a") as f:
        for ch in res["chunks"]:
            f.write(json.dumps({**ch, "target": "neiss_cases"}) + "\n")
    c.write_manifest(out, "neiss_cases", [res], inputs, {"held": True, "years": stats,
                     "hold_reason": "owner removal of cpsc_injury_data (2026-10-05); load only with the lead's confirmation"})
    print(json.dumps({"years": stats, "rows": res["rows"]}))
    if args.check_corpus:
        check_corpus(out, stats)


def check_corpus(out, stats):
    """Exact check: every complete year's case count equals, and its weight sum rounds to, the estimate CPSC publishes
    (as recorded in the corpus dataset neiss_national_years, built from CPSC's own query-builder figures)."""
    import os
    import urllib.request
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/corpus_records?select=id,item&dataset=eq.neiss_national_years"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    with urllib.request.urlopen(urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}), timeout=60) as r:
        pub = {row["id"]: row["item"]["cells"] for row in json.loads(r.read().decode())}
    checks, bad = [], 0
    for y, st in stats.items():
        if not st["complete"] or str(y) not in pub:
            continue
        p = pub[str(y)]
        ok = st["cases"] == p["cases"] and round(st["weight_sum"]) == p["estimate"]
        bad += not ok
        checks.append({"year": y, "cases": [st["cases"], p["cases"]], "estimate": [round(st["weight_sum"]), p["estimate"]], "ok": ok})
    (out / "validation.json").write_text(json.dumps({"checks": checks, "mismatches": bad, "at": c.utc_now()}, indent=1))
    print(json.dumps({"checked": len(checks), "mismatches": bad}))
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
