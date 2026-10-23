"""Local, read-only stand-in for the corpus REST API, so the statute <-> regulation panels can be checked in a browser before
the three datasets are published. It serves this stream's build files unchanged (ordinal = position) plus the two stored
datasets the panels look up by exact id, rebuilt from the lookup files made by make_lookups.py (U.S. Code sections: id and
the citation / heading / status cells; CFR parts: id and title). It answers only what the panels read:

  GET /rest/v1/corpus_records?select=...&dataset=eq.X[&id=eq.Y | &id=in.("a","b")][&filters=cs.{json}][&order=ordinal.asc][&limit=N]
  GET /rest/v1/corpus_datasets?select=...[&id=eq.X]
Anything else returns an empty list.

Usage: python3 -I -B scripts/enrichment/ecfr_authorities/mock_corpus.py [port]   (then run the dev server with
EXTERNAL_SUPABASE_URL=http://127.0.0.1:<port> EXTERNAL_SUPABASE_KEY=local-mock)
"""
import json
import os
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "..", "..", "..", "private", "build", "ecfr_authorities")
DATASETS = ("ecfr_parallel_authorities", "ecfr_subject_index", "ecfr_agencies")
ROWS, CATALOG = {}, []

for name in DATASETS:
    with open(os.path.join(BUILD, f"{name}.json"), encoding="utf-8") as fh:
        build = json.load(fh)
    ROWS[name] = [dict(r, ordinal=i) for i, r in enumerate(build["rows"])]
    CATALOG.append(
        {
            "id": name,
            "label": build["label"],
            "ready": True,
            "imported_records": len(build["rows"]),
            "metadata": {"id": name, "label": build["label"], "ready": True, "listing": {**build["listing_block"], "total": len(build["rows"])}, "summary": build["summary"]},
        }
    )

with open(os.path.join(BUILD, "lookups", "us_code_section_cells.json"), encoding="utf-8") as fh:
    cells = json.load(fh)["cells_by_id"]
ROWS["us_code_sections"] = [
    {"dataset": "us_code_sections", "id": i, "title": f"{c[0]} {c[1]}", "item": {"id": i, "cells": {"citation": c[0], "heading": c[1], "status": c[2]}}, "filters": {"status": [c[2]]}, "ordinal": n}
    for n, (i, c) in enumerate(cells.items())
]
with open(os.path.join(BUILD, "lookups", "ecfr_part_ids.json"), encoding="utf-8") as fh:
    parts = json.load(fh)["parts"]
ROWS["ecfr_sections_full"] = [
    {"dataset": "ecfr_sections_full", "id": i, "title": p["heading"], "filters": {"kind": ["part"], "title": [p["title"]], "part": [p["part"]]}, "ordinal": n}
    for n, (i, p) in enumerate(parts.items())
]
BY_ID = {d: {r["id"]: r for r in rows} for d, rows in ROWS.items()}


def path_value(row, path):
    parts_ = re.split(r"(->>|->)", path)
    value = row.get(parts_[0])
    i = 1
    while i < len(parts_) and value is not None:
        op, key = parts_[i], parts_[i + 1]
        value = value.get(key) if isinstance(value, dict) else None
        if op == "->>" and value is not None and not isinstance(value, str):
            value = json.dumps(value)
        i += 2
    return value


def project(row, select):
    if not select or select == "*":
        return row
    out = {}
    for field in select.split(","):
        alias, path = field.split(":", 1) if ":" in field else (None, field)
        out[alias or re.split(r"->>|->", path)[-1]] = path_value(row, path)
    return out


def contains(filters, wanted):
    for key, values in wanted.items():
        have = (filters or {}).get(key, [])
        if not all(v in have for v in values):
            return False
    return True


def parse_in(value):
    inner = value[value.index("(") + 1 : value.rindex(")")]
    return [x.strip().strip('"') for x in inner.split(",") if x.strip()]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        params = {k: v[-1] for k, v in urllib.parse.parse_qs(url.query).items()}
        table = url.path.rsplit("/", 1)[-1]
        limit = int(params.get("limit", "1000"))
        if table == "corpus_records":
            dataset = params.get("dataset", "")[3:]
            rows = ROWS.get(dataset, [])
            idv = params.get("id", "")
            if idv.startswith("eq."):
                row = BY_ID.get(dataset, {}).get(idv[3:])
                rows = [row] if row else []
            elif idv.startswith("in."):
                rows = [BY_ID.get(dataset, {})[i] for i in parse_in(idv) if i in BY_ID.get(dataset, {})]
            flt = params.get("filters", "")
            if flt.startswith("cs."):
                wanted = json.loads(flt[3:])
                rows = [r for r in rows if contains(r.get("filters"), wanted)]
            return self.send([project(r, params.get("select")) for r in rows[:limit]])
        if table == "corpus_datasets":
            idv = params.get("id", "")
            rows = [c for c in CATALOG if not idv.startswith("eq.") or c["id"] == idv[3:]]
            return self.send([project(r, params.get("select")) for r in rows[:limit]])
        return self.send([])


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5298
    if "unready" in sys.argv:  # check the "not loaded" state of every panel
        for c in CATALOG:
            c["ready"] = False
    print(json.dumps({"port": port, "datasets": {k: len(v) for k, v in ROWS.items()}}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
