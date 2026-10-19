"""Local, read-only stand-in for the corpus REST API that serves this stream's build files, so the agency pages can be
checked in a browser before the datasets are published. It answers only what those pages read:

  GET  /rest/v1/corpus_records?select=...&dataset=eq.X[&id=eq.Y][&order=ordinal.asc][&limit=N]
  GET  /rest/v1/corpus_datasets?select=...[&id=eq.X]
  POST /rest/v1/rpc/corpus_query_bounded   {p_dataset, p_filters, p_q, p_limit, p_offset}
Anything else returns an empty list. Rows are the build files' rows unchanged (ordinal = position).

Usage: python3 -I -B scripts/enrichment/agencies_fr/mock_corpus.py [port]   (then run the dev server with
EXTERNAL_SUPABASE_URL=http://127.0.0.1:<port> EXTERNAL_SUPABASE_KEY=local-mock)
"""
import glob
import json
import os
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "..", "..", "..", "private", "build", "agencies_fr")
ROWS, CATALOG = {}, []
for path in sorted(glob.glob(os.path.join(BUILD, "*.json"))):
    if os.path.basename(path) in ("build_stats.json", "verify_report.json"):
        continue
    with open(path, encoding="utf-8") as fh:
        build = json.load(fh)
    rows = [dict(r, ordinal=i) for i, r in enumerate(build["rows"])]
    ROWS[build["dataset"]] = rows
    CATALOG.append({"id": build["dataset"], "label": build["label"], "ready": True, "imported_records": len(rows),
                    "metadata": {"id": build["dataset"], "label": build["label"], "ready": True,
                                 "listing": {**build["listing_block"], "total": len(rows)}, "summary": build["summary"]}})


def path_value(row, path):
    parts = re.split(r"(->>|->)", path)
    value = row.get(parts[0])
    i = 1
    while i < len(parts) and value is not None:
        op, key = parts[i], parts[i + 1]
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
        alias, _, path = field.partition(":") if ":" in field else (None, None, field)
        name = alias or re.split(r"->>|->", path)[-1]
        out[name] = path_value(row, path)
    return out


def eq_filters(params):
    return {k: v[3:] for k, v in params.items() if isinstance(v, str) and v.startswith("eq.") and k not in ("select",)}


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
            f = eq_filters(params)
            rows = ROWS.get(f.get("dataset"), [])
            if "id" in f:
                rows = [r for r in rows if r["id"] == f["id"]]
            return self.send([project(r, params.get("select")) for r in rows[:limit]])
        if table == "corpus_datasets":
            f = eq_filters(params)
            rows = [c for c in CATALOG if "id" not in f or c["id"] == f["id"]]
            return self.send([project(r, params.get("select")) for r in rows[:limit]])
        return self.send([])

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path.endswith("/rpc/corpus_query_bounded"):
            rows = ROWS.get(body.get("p_dataset"), [])
            for key, value in (body.get("p_filters") or {}).items():
                rows = [r for r in rows if str(value) in [str(x) for x in (r.get("filters") or {}).get(key, [])]]
            q = (body.get("p_q") or "").lower()
            if q:
                rows = [r for r in rows if q in (r.get("text") or "").lower()]
            offset, limit = int(body.get("p_offset") or 0), int(body.get("p_limit") or 50)
            return self.send({"items": [r["item"] for r in rows[offset:offset + limit]], "total": len(rows),
                              "total_capped": False})
        return self.send([])


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5299
    print(json.dumps({"port": port, "datasets": {k: len(v) for k, v in ROWS.items()}}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
