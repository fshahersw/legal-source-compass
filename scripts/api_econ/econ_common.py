"""Shared helpers for the api-econ builders (wave 1025): polite HTTP with a recorded manifest, a minimal XLSX reader,
build-file writing in the enrichment contract format, and secrets loading that never prints a key.

Build files: {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs"} — what
private/scratch/enrich/publish_build.py validates and publishes (lead only). Rows come from corpus_writer.record.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "enrichment"))
import corpus_writer  # noqa: E402  (record/listing helpers only; nothing here publishes)

ACQ = ROOT / "private" / "acq" / "w1025_api-econ"
BUILD = ROOT / "private" / "build" / "w1025_api-econ"
UA = "LegalSourceAtlas research contact@legal-source-atlas.example"
NOT_RECORDED = "Not recorded"

record = corpus_writer.record
listing = corpus_writer.listing


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def secret(name: str) -> str:
    """A key from the environment or private/scratch/secrets.env (never printed or written)."""
    if os.environ.get(name):
        return os.environ[name]
    path = ROOT / "private" / "scratch" / "secrets.env"
    for line in path.read_text().splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m and m.group(1) == name:
            return m.group(2).strip().strip('"').strip("'")
    raise SystemExit(f"{name} is not set")


_KEY_PARAM = re.compile(r"([?&](?:api[_-]?key|registrationkey|key)=)[^&]*", re.I)


def redact(url: str) -> str:
    return _KEY_PARAM.sub(r"\1[removed]", url)


class Http:
    """One request at a time per host with a minimum spacing, bounded retries, and a manifest of every response
    (URL with any key removed, status, bytes, sha256, UTC time)."""

    def __init__(self, min_interval: float = 1.0, timeout: int = 90):
        self.min_interval = min_interval
        self.timeout = timeout
        self.last: dict[str, float] = {}
        self.requests: list[dict] = []

    def _space(self, host: str) -> None:
        prev = self.last.get(host)
        if prev is not None:
            wait = prev + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
        self.last[host] = time.monotonic()

    def get(self, url: str, *, headers: dict | None = None, data: bytes | None = None, method: str | None = None,
            record_url: str | None = None) -> bytes:
        host = urllib.parse.urlsplit(url).netloc
        hdrs = {"User-Agent": UA, "Accept": "*/*", **(headers or {})}
        for attempt in range(1, 5):
            self._space(host)
            req = urllib.request.Request(url, headers=hdrs, data=data, method=method or ("POST" if data else "GET"))
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    body = res.read()
                    status = res.status
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    retry = e.headers.get("Retry-After")
                    time.sleep(min(120, int(retry)) if retry and retry.isdigit() else 5 * attempt)
                    continue
                raise RuntimeError(f"HTTP {e.code} for {redact(record_url or url)}") from None
            except urllib.error.URLError:
                if attempt < 4:
                    time.sleep(5 * attempt)
                    continue
                raise RuntimeError(f"network error for {redact(record_url or url)}") from None
            self.requests.append({
                "url": redact(record_url or url), "status": status, "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(), "retrieved_at": utc_now(),
                **({"method": "POST", "body_sha256": hashlib.sha256(data).hexdigest()} if data else {}),
            })
            return body
        raise RuntimeError("unreachable")


import urllib.parse  # noqa: E402


def save_raw(path: Path, body: bytes, url: str, manifest: Path) -> dict:
    """Keep response bytes unchanged and append a manifest line."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    entry = {"url": redact(url), "path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(body).hexdigest(),
             "bytes": len(body), "retrieved_at": utc_now(), "status": 200, "method": "direct GET"}
    with manifest.open("a") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


# ------------------------------------------------------------------------------------------------ XLSX (stdlib)
_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx(path: Path, sheet: int = 1) -> list[list[str | None]]:
    """Cells of one worksheet as text exactly as stored (<v> of numbers unchanged, shared and inline strings resolved)."""
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", _NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")))
        root = ET.fromstring(z.read(f"xl/worksheets/sheet{sheet}.xml"))
    rows: list[list[str | None]] = []
    for r in root.iter(f"{{{_NS['m']}}}row"):
        cells: dict[int, str | None] = {}
        for c in r.findall("m:c", _NS):
            t = c.get("t")
            v = c.find("m:v", _NS)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{_NS['m']}}}t"))
            else:
                val = v.text if v is not None else None
            cells[_col_index(c.get("r"))] = val
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(i) for i in range(width)])
    return rows


# ------------------------------------------------------------------------------------------------ build files
def digest(rows: list[dict]) -> str:
    return hashlib.sha256("\n".join(json.dumps(row, sort_keys=True) for row in rows).encode()).hexdigest()


def write_build(out_dir: Path, dataset: str, label: str, listing_block: dict, summary: dict, rows: list[dict],
                inputs: list[dict]) -> dict:
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate ids")
    for r in rows:
        if r["dataset"] != dataset or r["category"] != dataset:
            raise SystemExit(f"{dataset}: row {r['id']} carries another dataset")
        if not str(r.get("source_url") or "").startswith(("http://", "https://")):
            raise SystemExit(f"{dataset}: row {r['id']} has no source_url")
    if json.loads(json.dumps(rows)) != rows:
        raise SystemExit(f"{dataset}: rows are not JSON round-trip stable")
    if re.search(r"[?&](api[_-]?key|registrationkey|key)=(?!\[removed\])", json.dumps(rows), re.I):
        raise SystemExit(f"{dataset}: a row carries a credential-like URL parameter")
    out_dir.mkdir(parents=True, exist_ok=True)
    body = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": {**summary, "rows": len(rows)},
            "rows": rows, "built_at": utc_now(), "inputs": inputs}
    path = out_dir / f"{dataset}.json"
    path.write_text(json.dumps(body))
    info = {"file": str(path.relative_to(ROOT)), "dataset": dataset, "rows": len(rows), "bytes": path.stat().st_size,
            "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "rows_sha256": digest(rows)}
    print(json.dumps(info))
    return info
