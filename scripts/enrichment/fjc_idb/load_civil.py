"""Load the official FJC Integrated Database civil file (1988 forward) into a typed DuckDB table.

Source: https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present
(file https://www.fjc.gov/sites/default/files/idb/textfiles/cv88on.zip, tab-delimited, one row per civil case).
The 2 GB text file is extracted to a temporary path, read once by DuckDB, then deleted; the zip stays under
private/acq/fjc_idb with its sha256 in _manifest.jsonl. Codes are kept as published; "-8" (missing) becomes NULL.
"""
from __future__ import annotations

import json
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import duckdb  # noqa: E402

ZIP = os.path.join(ROOT, "private", "acq", "fjc_idb", "cv88on.zip")
TMP = os.path.join(ROOT, "private", "scratch", "cl_tmp", "cv88on.txt")
DB = os.path.join(ROOT, "private", "acq", "fjc_idb", "fjc_civil.duckdb")

DATE = "TRY_STRPTIME({c}, '%m/%d/%Y')::DATE"


def dt(c: str) -> str:
    return DATE.format(c=c)


def num(c: str) -> str:
    # -8 is the codebook's "missing"; blanks are NULL too
    return f"CASE WHEN {c} IN ('-8', '') THEN NULL ELSE TRY_CAST({c} AS BIGINT) END"


def txt(c: str) -> str:
    return f"CASE WHEN {c} IN ('-8', '') THEN NULL ELSE trim({c}) END"


COLUMNS = [
    ("circuit", "VARCHAR", txt("CIRCUIT")),
    ("district", "VARCHAR", txt("DISTRICT")),
    ("office", "VARCHAR", txt("OFFICE")),
    ("docket", "VARCHAR", txt("DOCKET")),
    ("origin", "SMALLINT", num("ORIGIN")),
    ("filedate", "DATE", dt("FILEDATE")),
    ("fdateuse", "DATE", dt("FDATEUSE")),
    ("juris", "SMALLINT", num("JURIS")),
    ("nos", "INTEGER", num("NOS")),
    ("titl", "VARCHAR", txt("TITL")),
    ("section", "VARCHAR", txt("SECTION")),
    ("residenc", "VARCHAR", txt("RESIDENC")),
    ("jury", "VARCHAR", txt("JURY")),
    ("classact", "SMALLINT", num("CLASSACT")),
    ("demanded", "INTEGER", num("DEMANDED")),
    ("county", "VARCHAR", txt("COUNTY")),
    ("arbit", "VARCHAR", txt("ARBIT")),
    ("mdldock", "VARCHAR", txt("MDLDOCK")),
    ("plt", "VARCHAR", txt("PLT")),
    ("def", "VARCHAR", txt("DEF")),
    ("transdat", "DATE", dt("TRANSDAT")),
    ("transoff", "VARCHAR", txt("TRANSOFF")),
    ("transdoc", "VARCHAR", txt("TRANSDOC")),
    ("transorg", "VARCHAR", txt("TRANSORG")),
    ("termdate", "DATE", dt("TERMDATE")),
    ("tdateuse", "DATE", dt("TDATEUSE")),
    ("trclact", "SMALLINT", num("TRCLACT")),
    ("procprog", "SMALLINT", num("PROCPROG")),
    ("disp", "SMALLINT", num("DISP")),
    ("noj", "SMALLINT", num("NOJ")),
    ("amtrec", "INTEGER", num("AMTREC")),
    ("judgment", "SMALLINT", num("JUDGMENT")),
    ("trmarb", "VARCHAR", txt("TRMARB")),
    ("prose", "SMALLINT", num("PROSE")),
    ("ifp", "VARCHAR", txt("IFP")),
    ("statuscd", "VARCHAR", txt("STATUSCD")),
    ("tapeyear", "INTEGER", num("TAPEYEAR")),
]


def main() -> None:
    t0 = time.time()
    os.makedirs(os.path.dirname(TMP), exist_ok=True)
    with zipfile.ZipFile(ZIP) as z, z.open("cv88on.txt") as src, open(TMP, "wb") as dst:
        while True:
            b = src.read(1 << 24)
            if not b:
                break
            dst.write(b.decode("cp1252", errors="replace").encode("utf-8"))  # the file is single-byte text
    if os.path.exists(DB):
        os.remove(DB)
    con = duckdb.connect(DB)
    con.execute("PRAGMA threads=3")
    select = ", ".join(f"{expr} AS {name}" for name, _, expr in COLUMNS)
    con.execute(
        f"CREATE TABLE civil AS SELECT {select} FROM read_csv('{TMP}', delim='\t', header=true, all_varchar=true, "
        f"quote='', escape='', ignore_errors=true, store_rejects=true, rejects_table='rej_civil', "
        f"max_line_size=1048576)"
    )
    rows = con.execute("SELECT count(*) FROM civil").fetchone()[0]
    rej = con.execute("SELECT count(*) FROM rej_civil").fetchone()[0]
    rng = con.execute("SELECT min(filedate), max(filedate), min(termdate), max(termdate) FROM civil").fetchone()
    con.execute("CHECKPOINT")
    con.close()
    os.remove(TMP)
    out = {"rows": rows, "rejected_records": rej, "filedate_range": [str(rng[0]), str(rng[1])], "termdate_range": [str(rng[2]), str(rng[3])], "seconds": round(time.time() - t0, 1)}
    print(json.dumps(out))
    with open(os.path.join(os.path.dirname(DB), "fjc_civil.done.json"), "w") as h:
        json.dump(out, h, indent=1)


if __name__ == "__main__":
    try:
        main()
    except BaseException:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
        os._exit(1)
    sys.stdout.flush()
    os._exit(0)
