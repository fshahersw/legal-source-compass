"""Independent checks of fjc_appeals_outcomes. Prints a JSON report with a failure count; writes verify_appeals.json.

1. Second path: DuckDB SQL over the raw appeals text (unzipped once to a temporary file that is deleted afterwards), with
   the definitions re-implemented in SQL, recomputing every circuit x fiscal-year cell (terminated, merits, reversed,
   affirmed incl. partial, median days) and 300 sampled cells of the origin x nature x NOS x FY cube.
2. Published totals: AO Judicial Business Table B-5 for FY2025 (jb_b5_0930.2025.xlsx, uscourts.gov), every circuit x nature
   of proceeding row: total terminated, merits total, affirmed, dismissed, reversed, remanded, other, COA, percent reversed.
   Exact matches are expected for terminated counts; merits-level differences are reported with their size.
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

sys.path.insert(0, str(fl.ROOT / "private" / "scratch" / "pylib"))
import duckdb  # noqa: E402
import openpyxl  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
TMP = fl.ROOT / "private" / "scratch" / "enrich" / "judiciary" / "tmp_ap08on.txt"
B5 = fl.ACQ / "ao_tables" / "sites" / "default" / "files" / "document" / "jb_b5_0930.2025.xlsx.gz"
CIRC = {"DC": "cadc", "1st": "ca1", "2nd": "ca2", "3rd": "ca3", "4th": "ca4", "5th": "ca5", "6th": "ca6", "7th": "ca7", "8th": "ca8",
        "9th": "ca9", "10th": "ca10", "11th": "ca11"}
B5_ROWS = {"Criminal": "criminal", "U.S. Prisoner Petitions": "us_prisoner", "Other U.S. Civil": "us_civil",
           "Private Prisoner Petitions": "private_prisoner", "Other Private Civil": "private_civil", "Bankruptcy": "bankruptcy",
           "Administrative Agency Appeals": "administrative", "Original Proceedings and Miscellaneous Applications": "original"}

SQL = r"""
CREATE TABLE ap AS SELECT * FROM read_csv('{tmp}', delim='\t', header=true, all_varchar=true, quote='', escape='');
CREATE TABLE t AS SELECT
  CASE WHEN CIRCUIT='0' THEN 'cadc' ELSE 'ca' || CIRCUIT END AS circuit,
  TRY_CAST(TAPEYEAR AS INT) AS fy,
  COALESCE(NULLIF(NULLIF(TRMTYPE,'-8'),''), NULLIF(NULLIF(APPTYPE,'-8'),'')) AS typ,
  TRY_CAST(NOS AS INT) AS nos, DDIST AS ddist, DISP AS disp, OUTCOME AS outcome, OPDISP AS opdisp, JOINAPP AS joinapp,
  TRY_STRPTIME(DKTDATE, '%m/%d/%Y')::DATE AS dkt, TRY_STRPTIME(JUDGDATE, '%m/%d/%Y')::DATE AS judg
FROM ap WHERE STATUSCD = 'L';
CREATE TABLE u AS SELECT *,
  CASE WHEN typ IN ('1','2') THEN 'administrative' WHEN typ IN ('6','22') THEN 'original' WHEN typ IN ('10','11','12') THEN 'bankruptcy'
       WHEN TRY_CAST(typ AS INT) BETWEEN 13 AND 21 THEN 'criminal'
       WHEN typ='3' THEN CASE WHEN nos IN (463,510,530,535,540,550,555,560) THEN 'us_prisoner' ELSE 'us_civil' END
       WHEN typ='4' THEN CASE WHEN nos IN (463,510,530,535,540,550,555,560) THEN 'private_prisoner' ELSE 'private_civil' END
       ELSE 'not_recorded' END AS nature,
  (disp IN ('1','2','3') AND joinapp NOT IN ('1','2')) AS merits
FROM t;
"""


def b5_table():
    wb = openpyxl.load_workbook(io.BytesIO(gzip.decompress(B5.read_bytes())), data_only=True)
    ws = wb.worksheets[0]
    out, circuit = {}, "national"
    for row in ws.iter_rows(values_only=True):
        if not row or row[0] is None or not isinstance(row[1], (int, float)):
            continue
        name = str(row[0]).strip()
        if name == "Total":
            circuit, nat = "national", "all"
        elif name in CIRC:
            circuit, nat = CIRC[name], "all"
        elif name in B5_ROWS:
            nat = B5_ROWS[name]
        else:
            continue
        num = [0 if v in (None, "-") else v for v in row[1:12]]
        out[(circuit, nat)] = {"terminated": num[0], "merits": num[3], "affirmed": num[4], "dismissed": num[5], "reversed": num[6],
                               "remanded": num[7], "other": num[8], "coa": num[9], "pct_reversed": None if row[11] in (None, "-") else row[11]}
    return out


def main() -> None:
    build = json.loads((BUILD / "fjc_appeals_outcomes.json").read_text())
    rows = {r["id"]: r["item"] for r in build["rows"]}
    failures, checks, notes = [], 0, []

    # ---- 1. DuckDB second path
    if not TMP.exists():
        with TMP.open("wb") as out:
            subprocess.run(["unzip", "-p", str(fl.ACQ / "fjc_idb" / "ap08on_0.zip")], stdout=out, check=True)
    con = duckdb.connect()
    for stmt in SQL.format(tmp=str(TMP)).split(";"):
        if stmt.strip():
            con.execute(stmt)
    q = """SELECT circuit, fy, count(*) n, sum(merits::INT) m,
             sum((merits AND nature<>'original')::INT) ma,
             sum((merits AND nature<>'original' AND outcome='2')::INT) rev,
             sum((merits AND nature<>'original' AND outcome IN ('1','3'))::INT) aff,
             median(CASE WHEN merits AND judg>=dkt THEN judg-dkt END) md
           FROM u GROUP BY 1,2"""
    for circuit, fy, n, m, ma, rev, aff, md in con.execute(q).fetchall():
        item = rows.get(f"circuit:{circuit}")
        cell = next((s for s in item["series"] if s["fy"] == fy), None) if item else None
        checks += 1
        got = None if cell is None else (cell["terminated"], cell["merits"], cell["merits_appeals"], cell["reversed"], cell["affirmed"] + cell["partial"], cell["median_days"])
        want = (n, m, ma, rev, aff, None if md is None else float(md))
        if got != want:
            failures.append({"check": "duckdb circuit-fy", "cell": [circuit, fy], "build": got, "duckdb": want})
    cube_cells = []
    for r in rows.values():
        if r.get("kind") == "district":
            cube_cells += [(r["court_id"], c) for c in r["cube"]]
    random.Random(20261022).shuffle(cube_cells)
    for oid, c in cube_cells[:300]:
        fy, circuit, nat, nos = c[0], c[1], c[2], c[3]
        code = next(k for k in jc.DISTRICTS if jc.district_court_id(k) == oid)
        nos_cond = "nos IS NULL OR nature NOT IN ('us_civil','us_prisoner','private_civil','private_prisoner')" if nos == "" else f"nos = {int(nos)}"
        res = con.execute(f"""SELECT count(*), sum((merits AND nature<>'original')::INT), sum((merits AND nature<>'original' AND outcome='2')::INT),
                                     median(CASE WHEN merits AND judg>=dkt THEN judg-dkt END)
                              FROM u WHERE fy={fy} AND circuit='{circuit}' AND nature='{nat}' AND ddist='{code}' AND ({nos_cond})""").fetchone()
        checks += 1
        want = (res[0], res[1] or 0, res[2] or 0, None if res[3] is None else float(res[3]))
        got = (c[4], c[5], c[8], c[13])
        if got != want:
            failures.append({"check": "duckdb cube cell", "cell": [oid, fy, circuit, nat, nos], "build": got, "duckdb": want})
    con.close()
    TMP.unlink()

    # ---- 2. AO Table B-5, FY2025
    b5 = b5_table()
    exact = {"terminated": 0, "merits": 0, "reversed": 0}
    compared = 0
    diffs = []
    for (circuit, nat), pub in sorted(b5.items()):
        item = rows["national"] if circuit == "national" else rows.get(f"circuit:{circuit}")
        if nat == "all":
            mine = next(s for s in item["series"] if s["fy"] == 2025)
        else:
            mine = next((x for x in item["by_nature_latest"] if x["nature"] == nat), None)
        if mine is None:
            if pub["terminated"]:
                failures.append({"check": "b5 row missing", "row": [circuit, nat]})
            continue
        compared += 1
        checks += 1
        orig = nat == "original"
        mine_vals = {
            "terminated": mine["terminated"], "merits": mine["merits"],
            "affirmed": mine["op_denied"] if orig else mine["affirmed"] + mine["partial"],
            "dismissed": mine["op_dismissed"] if orig else mine["dismissed"],
            "reversed": mine["op_granted"] if orig else mine["reversed"],
            "remanded": 0 if orig else mine["remanded"], "other": 0 if orig else mine["other"], "coa": 0 if orig else mine["coa_denied"],
        }
        if nat == "all":  # B-5 circuit rows add original proceedings into affirmed/dismissed/reversed
            for k_mine, k_op in (("affirmed", "op_denied"), ("dismissed", "op_dismissed"), ("reversed", "op_granted")):
                mine_vals[k_mine] += mine[k_op]
        for k in ("terminated", "merits", "reversed"):
            exact[k] += mine_vals[k] == pub[k]
        if mine_vals["terminated"] != pub["terminated"]:
            failures.append({"check": "b5 terminated", "row": [circuit, nat], "build": mine_vals["terminated"], "b5": pub["terminated"]})
        d = {k: mine_vals[k] - pub[k] for k in mine_vals if mine_vals[k] != pub[k]}
        if d:
            diffs.append({"row": [circuit, nat], "build_minus_b5": d})
    report = {"checks": checks, "failures": len(failures), "failure_examples": failures[:20],
              "b5_rows_compared": compared, "b5_exact": exact, "b5_differences": diffs, "notes": notes}
    (BUILD / "verify_appeals.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ("checks", "failures", "b5_rows_compared", "b5_exact")} | {"b5_rows_with_differences": len(diffs)}))


if __name__ == "__main__":
    main()
