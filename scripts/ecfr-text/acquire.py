#!/usr/bin/env python3
"""Resumable, checkpointed eCFR Versioner acquisition of part-level XML for the cited CFR sections.

Public, gate-free API (https://www.ecfr.gov/developer-documentation). The API requires compressed transfer.
Requests are sequential with a minimum interval and honour Retry-After; nothing else is fetched.
Every response body is retained verbatim (sha256 of the decoded body, retrieval timestamp, HTTP status, request URL).
Re-running resumes: completed parts are re-verified against their stored checksum and skipped.
"""
import argparse
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from ecfr_text_lib import API_ROOT, part_url, sha256_hex  # noqa: E402

UA = "LegalSourceAtlas-ecfr-text/1 (public-API acquisition; sequential, rate-limited)"


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def http_get(url, *, accept, timeout=300):
    req = urllib.request.Request(url, headers={"Accept": accept, "Accept-Encoding": "gzip", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            enc = r.headers.get("Content-Encoding", "")
            if enc == "gzip":
                body = gzip.decompress(body)
            return r.status, body, {"content_encoding": enc or None, "final_url": r.geturl(), "content_type": r.headers.get("Content-Type")}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {"retry_after": e.headers.get("Retry-After"), "content_type": e.headers.get("Content-Type")}


class Manifest:
    def __init__(self, path):
        self.path = path
        self.data = {"schema_version": "ecfr-text-acquisition/1", "titles": None, "parts": {}}
        if os.path.exists(path):
            with open(path) as f:
                self.data = json.load(f)

    def save(self):
        self.data["updated_at"] = utc_now()
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, indent=1, sort_keys=True)
        os.replace(tmp, self.path)


def fetch_with_retries(url, accept, min_interval, last):
    for attempt in range(6):
        wait = min_interval - (time.monotonic() - last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            status, body, meta = http_get(url, accept=accept)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last[0] = time.monotonic()
            time.sleep(min(120, 5 * 2 ** attempt))
            err = str(e)
            continue
        last[0] = time.monotonic()
        retrieved = utc_now()
        if status == 200:
            return status, body, meta, retrieved
        if status in (429, 500, 502, 503, 504):
            ra = meta.get("retry_after")
            time.sleep(float(ra) if ra and ra.isdigit() else min(300, 10 * 2 ** attempt))
            continue
        return status, body, meta, retrieved
    raise RuntimeError("source stopped after repeated transport failures: " + url)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True, help="working directory holding targets.json; raw/ and acquisition.json are written here")
    ap.add_argument("--min-interval", type=float, default=0.75, help="minimum seconds between requests")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new parts (0 = all)")
    ap.add_argument("--titles", default="", help="comma list of title numbers to restrict to")
    args = ap.parse_args()
    raw_dir = os.path.join(args.work, "raw")
    os.makedirs(raw_dir, exist_ok=True)
    man = Manifest(os.path.join(args.work, "acquisition.json"))
    last = [0.0]

    if not man.data.get("titles"):
        status, body, meta, retrieved = fetch_with_retries(f"{API_ROOT}/titles.json", "application/json", args.min_interval, last)
        if status != 200:
            raise SystemExit(f"titles.json HTTP {status}")
        doc = json.loads(body)
        rel = "raw/titles.json"
        with open(os.path.join(args.work, rel), "wb") as f:
            f.write(body)
        man.data["titles"] = {
            "url": f"{API_ROOT}/titles.json", "retrieved_at": retrieved, "http_status": status, "bytes": len(body),
            "sha256": sha256_hex(body), "file": rel, "api_meta": doc.get("meta"),
            "by_number": {str(t["number"]): t for t in doc["titles"]},
        }
        man.save()
    titles = man.data["titles"]["by_number"]

    with open(os.path.join(args.work, "targets.json")) as f:
        targets = json.load(f)
    wanted = sorted({(v["title"], v["part"]) for v in targets["cfr"]}, key=lambda x: (int(x[0]), x[1]))
    if args.titles:
        keep = set(args.titles.split(","))
        wanted = [w for w in wanted if w[0] in keep]

    done = new = 0
    for title, part in wanted:
        key = f"title-{title}-part-{part}"
        t = titles.get(title)
        if not t or t.get("reserved") or not t.get("up_to_date_as_of"):
            man.data["parts"][key] = {"title": title, "part": part, "state": "title_unavailable"}
            continue
        as_of = t["up_to_date_as_of"]
        old = man.data["parts"].get(key)
        if old and old.get("state") in ("complete", "not_found"):
            if old["state"] == "complete":
                with open(os.path.join(args.work, old["file"]), "rb") as f:
                    if sha256_hex(f.read()) != old["sha256"]:
                        raise SystemExit("retained original failed checksum re-verification: " + key)
            done += 1
            continue
        url = part_url(as_of, title, part)
        status, body, meta, retrieved = fetch_with_retries(url, "application/xml", args.min_interval, last)
        entry = {"title": title, "part": part, "url": url, "as_of": as_of, "http_status": status, "retrieved_at": retrieved,
                 "bytes": len(body), **{k: v for k, v in meta.items() if k in ("content_encoding", "content_type", "final_url")}}
        if status == 200 and body.lstrip().startswith(b"<?xml") and f'N="{part}"'.encode() in body[:2000]:
            rel = f"raw/title-{title}/part-{part}.xml"
            os.makedirs(os.path.dirname(os.path.join(args.work, rel)), exist_ok=True)
            with open(os.path.join(args.work, rel), "wb") as f:
                f.write(body)
            entry.update({"state": "complete", "file": rel, "sha256": sha256_hex(body)})
        elif status in (400, 404):
            entry.update({"state": "not_found", "error_body_sha256": sha256_hex(body)})
        else:
            entry.update({"state": "failed", "error_body_sha256": sha256_hex(body)})
        man.data["parts"][key] = entry
        man.save()
        new += 1
        print(json.dumps({k: entry.get(k) for k in ("title", "part", "state", "http_status", "bytes")}), flush=True)
        if args.limit and new >= args.limit:
            break
    man.save()
    states = {}
    for e in man.data["parts"].values():
        states[e["state"]] = states.get(e["state"], 0) + 1
    print(json.dumps({"parts_wanted": len(wanted), "already_complete": done, "fetched_now": new, "states": states}))


if __name__ == "__main__":
    main()
