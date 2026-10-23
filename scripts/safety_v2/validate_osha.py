"""Parser checks of the staged OSHA sample with an independent CSV reader (DuckDB read_csv) over the same official files.

osha.gov's establishment pages refuse automated requests and the DOL API needs a registered key, so the record values
are checked against the catalog files themselves, read by a different parser: inspections from the local catalog copy
(private/acq/osha/dol/inspection), violations and accidents from the catalog members the build read (extracted to a
scratch file under the build folder, deleted afterwards). Writes <outdir>/validation.json; exits 1 on any mismatch.

  PYTHONPATH=private/scratch/pylib python3 scripts/safety_v2/validate_osha.py [--outdir DIR] [--n 25]
"""
import argparse
import gzip
import json
import random
import shutil
import sys
import zipfile
import io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
import osha_build as ob  # noqa: E402
import duckdb  # noqa: E402


def staged(outdir, target):
    rows = []
    for f in sorted((Path(outdir) / "chunks").glob(f"{target}-*.jsonl.gz")):
        rows += [json.loads(line) for line in gzip.open(f)]
    return rows


def extract(name, member, dest):
    z, _ = ob.remote_zip(name)
    with z.open(member) as src, open(dest, "wb") as out:
        shutil.copyfileobj(src, out, 1 << 20)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default=str(c.BUILD / "osha"))
    ap.add_argument("--n", type=int, default=25)
    ap.add_argument("--seed", type=int, default=1025)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    out = Path(args.outdir)
    manifest = json.loads((out / "manifest.json").read_text())
    con = duckdb.connect()
    con.execute("set threads=2")
    checks, bad = [], 0

    ins = staged(out, "osha_inspections")
    files = [str(c.ROOT / x["path"]) for x in manifest["inputs"] if x.get("path", "").endswith(".csv.gz")]
    sample = rnd.sample(ins, min(args.n, len(ins)))
    ids = [r["activity_nr"] for r in sample]
    got = {row[0]: row for row in con.execute(
        f"select ACTIVITY_NR::bigint, ESTAB_NAME, SITE_STATE, NAICS_CODE::varchar, INSP_TYPE, left(OPEN_DATE::varchar, 10) "
        f"from read_csv({files!r}, header=true, all_varchar=true) where ACTIVITY_NR::bigint in ({','.join(map(str, ids))})").fetchall()}
    for r in sample:
        g = got.get(r["activity_nr"])
        ours = (r["activity_nr"], r["estab_name"], r["site_state"], r["naics_code"], r["insp_type"], r["open_date"])
        ok = g is not None and tuple(None if v in ("", None) else v for v in g) == ours
        bad += not ok
        checks.append({"kind": "inspection", "id": r["activity_nr"], "ok": ok, "staged": ours, "duckdb": g})

    vio = staged(out, "osha_violations")
    vmeta = next((x for x in manifest["inputs"] if "violation" in x.get("url", "")), None)
    if vio and vmeta and len(vmeta.get("members_read", [])) == 1:
        tmp = out / "_violation_member.csv"
        extract("violation", vmeta["members_read"][0], tmp)
        try:
            vs = rnd.sample(vio, min(args.n, len(vio)))
            keys = ",".join(f"({v['activity_nr']}, '{v['citation_id']}')" for v in vs)
            got = {(row[0], row[1]): row for row in con.execute(
                f"select ACTIVITY_NR::bigint, CITATION_ID, STANDARD, VIOL_TYPE, left(ISSUANCE_DATE, 10), CURRENT_PENALTY, INITIAL_PENALTY "
                f"from read_csv('{tmp}', header=true, all_varchar=true) where (ACTIVITY_NR::bigint, CITATION_ID) in ({keys})").fetchall()}
            for v in vs:
                g = got.get((v["activity_nr"], v["citation_id"]))
                norm = lambda x: None if x in ("", None) else x  # noqa: E731
                ok = g is not None and (norm(g[2]), norm(g[3]), norm(g[4]), norm(g[5]), norm(g[6])) == (
                    v["standard"], v["viol_type"], v["issuance_date"], v["current_penalty"], v["initial_penalty"])
                bad += not ok
                checks.append({"kind": "violation", "id": [v["activity_nr"], v["citation_id"]], "ok": ok,
                               "staged": [v["standard"], v["viol_type"], v["issuance_date"], v["current_penalty"], v["initial_penalty"]],
                               "duckdb": g})
        finally:
            tmp.unlink(missing_ok=True)

    acc = staged(out, "osha_accidents")
    if acc:
        z, _ = ob.remote_zip("accident")
        tmp = out / "_accident_member.csv"
        with z.open(z.infolist()[0]) as src, open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        try:
            sa = rnd.sample(acc, min(args.n, len(acc)))
            got = {row[0]: row for row in con.execute(
                f"select SUMMARY_NR::bigint, left(EVENT_DATE, 10), EVENT_DESC, ABSTRACT_TEXT from read_csv('{tmp}', header=true, "
                f"all_varchar=true, max_line_size=10000000) where SUMMARY_NR::bigint in ({','.join(str(a['summary_nr']) for a in sa)})").fetchall()}
            for a in sa:
                g = got.get(a["summary_nr"])
                ok = g is not None and g[1] == a["event_date"] and (g[2] or None) == a["event_desc"] and (g[3] or "")[:20000].strip() == (a["abstract"] or "")
                bad += not ok
                checks.append({"kind": "accident", "id": a["summary_nr"], "ok": ok})
        finally:
            tmp.unlink(missing_ok=True)

    (out / "validation.json").write_text(json.dumps({"checked": len(checks), "mismatches": bad, "at": c.utc_now(), "checks": checks},
                                                    indent=1, default=str))
    print(json.dumps({"checked": len(checks), "mismatches": bad}))
    if bad:
        for ch in checks:
            if not ch["ok"]:
                print(json.dumps(ch, default=str)[:600])
        sys.exit(1)


if __name__ == "__main__":
    main()
