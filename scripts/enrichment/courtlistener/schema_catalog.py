"""Parse CourtListener's published database schema (schema-YYYY-MM-DD.sql) and bulk load script.

The schema SQL lists every table (138 on 2026-09-30), column types, foreign keys and COMMENT ON COLUMN descriptions; the
load script (load-bulk-data-YYYY-MM-DD.sh) lists which tables have a public bulk CSV and in which column order. Tables that
exist in the schema but have no bulk file (for example attorneys, parties, docket entries, RECAP documents) are reported as
"no public bulk file" rather than inferred.
"""
from __future__ import annotations

import re
from collections import OrderedDict

CREATE = re.compile(r"CREATE TABLE public\.(\w+) \((.*?)\n\);", re.S)
COMMENT_COL = re.compile(r"COMMENT ON COLUMN public\.(\w+)\.(\w+) IS '((?:[^']|'')*)';")
COMMENT_TAB = re.compile(r"COMMENT ON TABLE public\.(\w+) IS '((?:[^']|'')*)';")
FK = re.compile(r"ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT \w+ FOREIGN KEY \((\w+)\) REFERENCES public\.(\w+)\((\w+)\)", re.S)
COPY = re.compile(r"\\COPY public\.(\w+) \((.*?)\) FROM '\$BULK_DIR/([^']+?)-\d{4}-\d{2}-\d{2}\.csv'", re.S)


def parse_schema(sql: str) -> dict:
    tables: "OrderedDict[str, dict]" = OrderedDict()
    for name, body in CREATE.findall(sql):
        cols = []
        for line in body.split("\n"):
            line = line.strip().rstrip(",")
            if not line or line.startswith("CONSTRAINT") or line.startswith("PRIMARY KEY") or line.startswith("UNIQUE"):
                continue
            m = re.match(r'^"?(\w+)"?\s+(.+)$', line)
            if not m:
                continue
            col, rest = m.groups()
            not_null = "NOT NULL" in rest
            typ = re.sub(r"\s+(NOT NULL|DEFAULT .*|GENERATED .*)$", "", rest).strip()
            cols.append({"name": col, "type": typ, "not_null": not_null, "comment": None})
        tables[name] = {"columns": cols, "comment": None, "foreign_keys": []}
    for t, c, text in COMMENT_COL.findall(sql):
        for col in tables.get(t, {}).get("columns", []):
            if col["name"] == c:
                col["comment"] = text.replace("''", "'")
    for t, text in COMMENT_TAB.findall(sql):
        if t in tables:
            tables[t]["comment"] = text.replace("''", "'")
    for t, c, rt, rc in FK.findall(sql):
        if t in tables:
            tables[t]["foreign_keys"].append({"column": c, "references": rt, "referenced_column": rc})
    return tables


def parse_bulk_files(script: str) -> dict[str, dict]:
    """table -> {file (stem without date), columns (load order)} from the COPY statements."""
    out = {}
    for table, cols, stem in COPY.findall(script):
        out[table] = {"file": stem, "columns": [c.strip() for c in cols.replace("\n", " ").split(",") if c.strip()]}
    return out
