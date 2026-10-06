#!/usr/bin/env python3
"""Seed a backfill capture from a source already held in the protected limitations bundle.

Usage: seed.py ST CAPTURE_ID EXISTING_SOURCE_ID
Reads $LIM_BUNDLE (default /tmp/lim/data/limitations) sources.json and its text file. The capture keeps the
original capture time and URL (seeded=true) and is marked intermediary when the bundle method records a
rendering service (Firecrawl/Tavily) rather than a direct HTTP response.
"""
import hashlib, json, os, sys
from urllib.parse import urlparse
sys.path.insert(0, os.path.dirname(__file__))
from capture import host_class, WORK

bundle = os.environ.get("LIM_BUNDLE", "/tmp/lim/data/limitations")
st, cid, sid = sys.argv[1].upper(), sys.argv[2], sys.argv[3]
src = next((s for s in json.load(open(f"{bundle}/sources.json"))["sources"] if s["id"] == sid), None)
if not src:
    sys.exit(f"no bundle source {sid}")
text = open(f"{bundle}/text/{os.path.basename(src['textPath'])}", "rb").read()
if hashlib.sha256(text).hexdigest() != src["sha256"]:
    sys.exit("bundle text hash mismatch")
cls = host_class(urlparse(src["url"]).hostname or "")
if cls == "blocked_secondary":
    sys.exit("secondary host")
out = os.path.join(WORK, "captures", st)
os.makedirs(out, exist_ok=True)
raw_meta = src.get("rawCapture")
meta = {
    "id": cid, "state": st, "url": src["url"], "finalUrl": src["url"], "status": 200,
    "contentType": "text/plain", "hostClass": cls, "finalHostClass": cls,
    "retrievedAt": src["capturedAt"], "seeded": True, "seededFrom": sid,
    "intermediary": bool(any(k in src["method"].lower() for k in ("firecrawl", "tavily")) and not raw_meta),
    "extraction": src["method"], "rawSha256": (raw_meta or {}).get("sha256", src["sha256"]),
    "rawBytes": (raw_meta or {}).get("byteLength", len(text)), "textSha256": src["sha256"], "textBytes": len(text),
}
open(f"{out}/{cid}.raw", "wb").write(text)
open(f"{out}/{cid}.txt", "wb").write(text)
json.dump(meta, open(f"{out}/{cid}.json", "w"), indent=1)
print(json.dumps({"ok": True, "id": cid, "seededFrom": sid, "retrievedAt": meta["retrievedAt"], "intermediary": meta["intermediary"]}))
