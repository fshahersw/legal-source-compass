#!/usr/bin/env python3
"""Local capture broker so research workers can use the Firecrawl/Tavily proxy without ever seeing a key.

Run once from a shell that has FIRECRAWL_API_KEY / TAVILY_API_KEY exported (environment only, nothing written):
    nohup python3 scripts/limitations/backfill/proxy-capture-server.py > /tmp/lim/proxy-server.log 2>&1 &
Workers then call:
    curl -s "http://127.0.0.1:8765/capture?st=NY&id=ny-op-example&url=https%3A%2F%2Fwww.nycourts.gov%2F...&via=firecrawl"
The broker only runs capture.py --via, which refuses publisher terms gates, secondary publishers and unlisted hosts,
and only for hosts that block direct fetches (it first tries a direct fetch and refuses to proxy a host that answers).
It binds to 127.0.0.1 only and never returns or logs the keys.
"""
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("LIM_PROXY_PORT", "8765"))


def direct_fetch_ok(url: str) -> bool:
    try:
        r = requests.get(url, headers={"User-Agent": "LegalSourceAtlas-primary-source-review/1.0"}, timeout=40)
        text = r.text[:6000].lower()
        blocked = r.status_code in (401, 403, 429) or "just a moment" in text or "verify you are human" in text \
            or "security check" in text or "validate your browser" in text or "radware" in text
        return r.status_code == 200 and not blocked and len(r.content) > 1500
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != "/capture":
            return self.reply(404, {"ok": False, "error": "unknown path"})
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        st, cid, url, via = q.get("st", ""), q.get("id", ""), q.get("url", ""), q.get("via", "firecrawl")
        if not re.fullmatch(r"[A-Za-z]{2}", st) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,80}", cid) \
                or not url.startswith("https://") or via not in ("firecrawl", "tavily"):
            return self.reply(400, {"ok": False, "error": "bad parameters"})
        if q.get("force") != "1" and direct_fetch_ok(url):
            return self.reply(409, {"ok": False, "error": "host answers direct requests; use capture.py without a proxy"})
        p = subprocess.run([sys.executable, os.path.join(HERE, "capture.py"), st, cid, url, "--via", via],
                           capture_output=True, text=True, timeout=300, env=os.environ.copy())
        out = (p.stdout.strip().splitlines() or [p.stderr.strip()[-300:]])[-1]
        try:
            body = json.loads(out)
        except Exception:
            body = {"ok": False, "error": out[:300]}
        self.reply(200 if body.get("ok") else 502, body)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
