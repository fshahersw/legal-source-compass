"""Independent checks of fjc_criminal_districts. Prints a JSON summary with a failure count; writes verify_criminal.json.

1. Second path: pandas (C parser, chunked, reading the raw zip through `unzip -p`, not the extract) recomputes, for every
   district x fiscal year, filed (CTFILTRN), terminated (CTTRTRN), disposed (CTTR), pending (CTPNWOF), convicted (DISP1 in
   4, 5, 8, 9, 17, 19 among CTTR) and prison sentences, plus 300 sampled offense x disposition x sentence cube cells with
   the offense rule applied independently.
2. Published totals, AO Judicial Business FY2025: Table D (filings, terminations, pending by district, including
   transfers), Table D-4 (national dispositions) and Table D-5 (national sentence types and the median prison term).
"""
from __future__ import annotations

import gzip
import io
import json
import random
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import jcodes as jc  # noqa: E402

import openpyxl  # noqa: E402
import pandas as pd  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
DOCS = fl.ACQ / "ao_tables" / "sites" / "default" / "files" / "document"
USECOLS = ["FISCALYR", "DISTRICT", "CTFILTRN", "CTTRTRN", "CTTR", "CTPNWOF", "DISP1", "PRISTOT", "PROBTOT", "FINETOT", "TOFFCD1"]
AO_DIST = {"NY,N": "nynd", "NY,E": "nyed", "NY,S": "nysd", "NY,W": "nywd"}


def ao_district_id(label: str) -> str | None:
    """'NY,S' / 'ME' / 'DC' style labels of Table D -> court id, through the codebook district names."""
    label = label.strip()
    if label in AO_DIST:
        return AO_DIST[label]
    st, _, reg = label.partition(",")
    usps = {v.upper(): k for k, v in jc.USPS.items()}
    name = {"GUAM": "Guam", "NMI": "Northern Mariana Islands", "VI": "Virgin Islands", "PR": "Puerto Rico", "DC": "District of Columbia"}.get(st) or usps.get(st)
    if not name:
        return None
    if not reg:
        code = next((k for k, v in jc.DISTRICTS.items() if v == name), None)
    else:
        region = {"N": "Northern", "S": "Southern", "E": "Eastern", "W": "Western", "M": "Middle", "C": "Central"}[reg]
        code = next((k for k, v in jc.DISTRICTS.items() if v == f"{name} - {region}"), None)
    return jc.district_court_id(code) if code else None


def table_rows(name: str):
    wb = openpyxl.load_workbook(io.BytesIO(gzip.decompress((DOCS / name).read_bytes())), data_only=True)
    return wb.worksheets[0].iter_rows(values_only=True)


def main() -> None:
    build = json.loads((BUILD / "fjc_criminal_districts.json").read_text())
    items = {r["id"]: r["item"] for r in build["rows"]}
    offenses = jc.parse_offenses((BUILD / "appeals_codebook.txt").read_text())
    failures, checks = [], 0

    # ---- 1. pandas second path from the raw zip
    proc = subprocess.Popen(["unzip", "-p", str(fl.ACQ / "fjc_idb" / "cr96on.zip")], stdout=subprocess.PIPE)
    agg = {}
    sample_keys = []
    cube = {}
    for r in build["rows"]:
        if r["item"]["kind"] == "district":
            sample_keys += [(r["item"]["court_id"], tuple(c[:4]), c[4]) for c in r["item"]["cube"]]
    random.Random(1022).shuffle(sample_keys)
    sample = {(c, k): n for c, k, n in sample_keys[:300]}
    reader = pd.read_csv(proc.stdout, sep="\t", dtype=str, usecols=USECOLS, chunksize=500_000, quoting=3, encoding="cp1252", keep_default_na=False)
    conv_codes = {"4", "5", "8", "9", "17", "19"}
    for chunk in reader:
        chunk["court"] = chunk["DISTRICT"].str.strip().map(lambda c: jc.district_court_id(c) or "not_recorded")
        chunk["fy"] = chunk["FISCALYR"].astype(int)
        disposed = chunk["CTTR"] == "1"
        conv = disposed & chunk["DISP1"].isin(conv_codes)
        pris = pd.to_numeric(chunk["PRISTOT"], errors="coerce")
        prison = conv & ((pris > 0) | pris.isin([-1, -4, -5]))
        g = pd.DataFrame({"court": chunk["court"], "fy": chunk["fy"], "filed": (chunk["CTFILTRN"] == "1").astype(int),
                          "terminated": (chunk["CTTRTRN"] == "1").astype(int), "disposed": disposed.astype(int),
                          "pending": (chunk["CTPNWOF"] == "1").astype(int), "convicted": conv.astype(int), "prison": prison.astype(int)})
        for key, row in g.groupby(["court", "fy"]).sum().iterrows():
            a = agg.setdefault(key, [0] * 6)
            for i, col in enumerate(["filed", "terminated", "disposed", "pending", "convicted", "prison"]):
                a[i] += int(row[col])
        sub = chunk[disposed]
        for rec in sub.itertuples(index=False):
            dg = jc.CRIM_DISP_GROUP.get(int(rec.DISP1), "not_recorded") if rec.DISP1.lstrip("-").isdigit() and rec.DISP1 != "-8" else "not_recorded"
            key = (rec.court, (int(rec.fy), jc.offense_group(rec.TOFFCD1, offenses), dg,
                               jc.sentence_type(dg, rec.PRISTOT, rec.PROBTOT, rec.FINETOT)))
            if key in sample:
                cube[key] = cube.get(key, 0) + 1
    proc.wait()
    for (court, fy), vals in agg.items():
        item = items.get(f"district:{court}")
        if not item:
            if court != "not_recorded":
                failures.append({"check": "district missing", "court": court})
            continue
        s = next((x for x in item["series"] if x["fy"] == fy), None)
        checks += 1
        got = None if s is None else [s["filed"], s["terminated"], s["disposed"], s["pending"], s["convicted"], s["sent_prison"]]
        if got != vals:
            failures.append({"check": "pandas district-fy", "cell": [court, fy], "build": got, "pandas": vals})
    for key, n in sample.items():
        checks += 1
        if cube.get(key, 0) != n:
            failures.append({"check": "pandas cube cell", "cell": [key[0], *key[1]], "build": n, "pandas": cube.get(key, 0)})

    # ---- 2. AO tables FY2025
    ao = {"d_rows": 0, "d_exact": {"filed": 0, "terminated": 0, "pending": 0}, "d_diffs": []}
    for row in table_rows("jb_d_0930.2025.xlsx.gz"):
        if not row or row[0] is None or not isinstance(row[1], (int, float)):
            continue
        label = str(row[0]).strip()
        cid = ao_district_id(label)
        if label == "Total":
            item = items["national"]
        elif cid and f"district:{cid}" in items:
            item = items[f"district:{cid}"]
        else:
            continue
        s = next(x for x in item["series"] if x["fy"] == 2025)
        ao["d_rows"] += 1
        checks += 1
        mine = {"filed": s["filed"], "terminated": s["terminated"], "pending": s["pending"]}
        pub = {"filed": row[2], "terminated": row[5], "pending": row[8]}
        for k in mine:
            ao["d_exact"][k] += mine[k] == pub[k]
        if mine != pub:
            ao["d_diffs"].append({"row": label, "build": mine, "table_d": pub})
            if mine != pub:
                failures.append({"check": "Table D filings, terminations, pending", "row": label, "build": mine, "table_d": pub})
    nat = next(x for x in items["national"]["series"] if x["fy"] == 2025)
    d4 = next(r for r in table_rows("jb_d4_0930.2025.xlsx.gz") if r and r[0] == "Total")
    mine_d4 = [nat["disposed"], nat["disposed"] - nat["convicted"], nat["disp_acquitted_bench"], nat["disp_acquitted_jury"], nat["convicted"],
               nat["disp_convicted_plea"], nat["disp_convicted_bench"], nat["disp_convicted_jury"]]
    pub_d4 = [d4[1], d4[2], d4[4], d4[5], d4[6], d4[7], d4[8], d4[9]]
    ao["d4_total"] = {"build": mine_d4, "table_d4": pub_d4, "columns": ["disposed", "not convicted", "acquitted bench", "acquitted jury",
                                                                       "convicted", "plea", "convicted bench", "convicted jury"]}
    checks += 1
    if mine_d4[0] != pub_d4[0] or mine_d4[4] != pub_d4[4]:
        failures.append({"check": "Table D-4 totals", **ao["d4_total"]})
    d5 = next(r for r in table_rows("jb_d5_0930.2025.xlsx.gz") if r and str(r[0]).strip() == "Total")
    ao["d5_total"] = {"sentenced_build": nat["convicted"], "sentenced_d5": d5[1], "prison_build": nat["sent_prison"], "prison_d5": d5[2],
                      "prison_plus_sealed_build": nat["sent_prison"] + nat["sent_sealed"], "median_prison_build": nat["median_prison_months"],
                      "median_prison_d5": d5[9], "fine_only_build": nat["sent_fine_only"], "fine_only_d5": d5[19]}
    report = {"checks": checks, "failures": len(failures), "failure_examples": failures[:20], "ao": ao}
    (BUILD / "verify_criminal.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({"checks": checks, "failures": len(failures), "d_rows": ao["d_rows"], "d_exact": ao["d_exact"], "d4": ao["d4_total"], "d5": ao["d5_total"]}))


if __name__ == "__main__":
    main()
