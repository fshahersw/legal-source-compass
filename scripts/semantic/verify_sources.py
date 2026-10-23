"""Check that the build files the semantic index reads are the rows the corpus holds, by one aggregate hash per dataset.

    python3 -I -B scripts/semantic/verify_sources.py local --corpus us_code_sections     # prints the local count and hash
    python3 -I -B scripts/semantic/verify_sources.py sql --corpus us_code_sections       # prints the read-only SQL to run

The hash covers, for every row in id order (C collation / code-point order): md5 of id, title, source_url and text joined by
chr(31), then md5 of the concatenation of those row hashes. Equal counts and hashes mean the build file and corpus_records agree
byte for byte on those four columns. Run the SQL with the read-only SQL tool (project xosqzzsnhxcyehcnirpa) and compare.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import sources as src  # noqa: E402

SQL = (
    "select count(*) as n, md5(string_agg(md5(id || chr(31) || coalesce(title, '') || chr(31) || coalesce(source_url, '') || chr(31) "
    "|| coalesce(text, '')), '' order by id collate \"C\")) as h from public.corpus_records where dataset = '{dataset}'"
)


def row_hash(row: dict) -> str:
    parts = [row["id"], row.get("title") or "", row.get("source_url") or "", row.get("text") or ""]
    return hashlib.md5("\x1f".join(parts).encode("utf-8")).hexdigest()


def local_aggregate(path: str) -> tuple[int, str]:
    rows = sorted(src._load_rows(path), key=lambda r: r["id"])
    h = hashlib.md5()
    for r in rows:
        h.update(row_hash(r).encode())
    return len(rows), h.hexdigest()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mode", choices=["local", "sql"])
    p.add_argument("--corpus", required=True, choices=list(src.SOURCE_FILES))
    args = p.parse_args(argv)
    if args.mode == "sql":
        print(SQL.format(dataset=args.corpus))
    else:
        n, h = local_aggregate(src.SOURCE_FILES[args.corpus])
        print(f"{args.corpus}: rows={n} hash={h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
