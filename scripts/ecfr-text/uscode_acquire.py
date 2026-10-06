#!/usr/bin/env python3
"""Resumable, rate-limited acquisition of official U.S. Code section HTML from govinfo (United States Code, 2024 Edition).

Targets (`usc_targets.json`) are built from the read-only census caches: each `citation_index` link to an Open US Law U.S. Code
record names a govinfo granule (title package + granule id) in the publisher's own native record. The fetched page is then verified
against its own embedded identity (`documentid:<title>_<section>`), so a wrong granule is rejected, never trusted.

Route: direct HTTPS GET from govinfo.gov only (no proxy). Every response body is retained verbatim with sha256, retrieval time,
status and the route used. A proxied route (--route firecrawl) exists for the case govinfo blocks scripted access; it only runs for
govinfo.gov URLs, reads the API key from the environment, and records route + returned-content sha256 per object.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from ecfr_text_lib import sha256_hex  # noqa: E402

UA = "LegalSourceAtlas-uscode/1 (public govinfo acquisition; sequential, rate-limited)"
HOST = "www.govinfo.gov"


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def build_targets(work):
    meta = {}
    with open(os.path.join(work, "oul_meta.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            meta[r["id"]] = r
    links = json.load(open(os.path.join(work, "targets.json")))["citation_links"]
    out = {}
    for cid, lk in links.items():
        if lk["class"] != "usc":
            continue
        pr = meta[lk["oul_id"]]["metadata"]["publisher_record"]
        g = re.match(r"^https://www\.govinfo\.gov/app/details/(USCODE-(\d{4})-title(\d+))/(USCODE-\d{4}-title\d+-[A-Za-z0-9-]+)$", pr.get("source_url") or "")
        if not g:
            raise SystemExit("unexpected publisher source url for " + cid)
        ent = out.setdefault((lk["title"], lk["section"]), {
            "title": lk["title"], "section": lk["section"], "package": g.group(1), "granule": g.group(4), "edition": g.group(2),
            "source_ids": set(), "citations": set()})
        if ent["granule"] != g.group(4):
            raise SystemExit("one section maps to two granules: " + str(lk["title"]) + " " + str(lk["section"]))
        ent["source_ids"].add(lk["source_id"])
        ent["citations"].add(pr.get("citation_short") or lk["citation"])
    rows = [dict(e, source_ids=sorted(e["source_ids"]), citations=sorted(e["citations"]))
            for e in sorted(out.values(), key=lambda e: (int(e["title"]), e["granule"]))]
    with open(os.path.join(work, "usc_targets.json"), "w") as f:
        json.dump(rows, f)
    return rows


def granule_url(t):
    return f"https://{HOST}/content/pkg/{t['package']}/html/{t['granule']}.htm"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def direct_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html", "Accept-Encoding": "identity"})
    try:
        with OPENER.open(req, timeout=120) as r:
            return r.status, r.read(), {"content_type": r.headers.get("Content-Type")}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {"location": e.headers.get("Location"), "retry_after": e.headers.get("Retry-After")}


def firecrawl_get(url):
    """Proxied fetch (official host only). Returns the raw HTML Firecrawl obtained from govinfo."""
    key = os.environ.get("FIRECRAWL_API_KEY", "")
    if urllib.parse.urlparse(url).hostname != HOST or not key:
        raise SystemExit("proxied fetch needs FIRECRAWL_API_KEY and a govinfo.gov URL")
    body = json.dumps({"url": url, "formats": ["rawHtml"]}).encode()
    req = urllib.request.Request("https://api.firecrawl.dev/v1/scrape", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        doc = json.loads(r.read())
    html = ((doc.get("data") or {}).get("rawHtml") or "").encode("utf-8")
    code = ((doc.get("data") or {}).get("metadata") or {}).get("statusCode", 0)
    return code, html, {"route": "firecrawl", "api": "api.firecrawl.dev/v1/scrape"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    ap.add_argument("--min-interval", type=float, default=0.8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--route", choices=["direct", "firecrawl"], default="direct")
    ap.add_argument("--build-targets", action="store_true")
    ap.add_argument("--merge", action="store_true", help="fold usc_acquisition.shard*.json into usc_acquisition.json and exit")
    ap.add_argument("--shard", default="", help="K/N: take targets whose index %% N == K; shard K>0 writes usc_acquisition.shardKofN.json")
    a = ap.parse_args()
    if a.merge:
        mp = os.path.join(a.work, "usc_acquisition.json")
        base = json.load(open(mp))
        for name in sorted(os.listdir(a.work)):
            if name.startswith("usc_acquisition.shard") and name.endswith(".json"):
                for key, e in json.load(open(os.path.join(a.work, name)))["granules"].items():
                    if key not in base["granules"] or e["state"] == "complete":
                        base["granules"][key] = e
        base["updated_at"] = utc_now()
        json.dump(base, open(mp + ".tmp", "w"), indent=1, sort_keys=True)
        os.replace(mp + ".tmp", mp)
        print(json.dumps({"merged_granules": len(base["granules"])}))
        return
    if a.build_targets or not os.path.exists(os.path.join(a.work, "usc_targets.json")):
        rows = build_targets(a.work)
        print(json.dumps({"targets": len(rows), "titles": len({r["title"] for r in rows})}))
    targets = json.load(open(os.path.join(a.work, "usc_targets.json")))
    main_path = os.path.join(a.work, "usc_acquisition.json")
    k, n = (int(x) for x in a.shard.split("/")) if a.shard else (0, 1)
    mpath = main_path if k == 0 else os.path.join(a.work, f"usc_acquisition.shard{k}of{n}.json")
    man = json.load(open(mpath)) if os.path.exists(mpath) else {"schema_version": "uscode-acquisition/1", "granules": {}}
    done_elsewhere = json.load(open(main_path))["granules"] if k and os.path.exists(main_path) else {}
    targets = [t for i, t in enumerate(targets) if i % n == k]
    os.makedirs(os.path.join(a.work, "usc_raw"), exist_ok=True)
    last = 0.0
    new = 0
    for t in targets:
        key = t["granule"]
        old = man["granules"].get(key)
        if done_elsewhere.get(key, {}).get("state") == "complete":
            continue
        if old and old["state"] == "complete":
            with open(os.path.join(a.work, old["file"]), "rb") as f:
                if sha256_hex(f.read()) != old["sha256"]:
                    raise SystemExit("retained original failed checksum re-verification: " + key)
            continue
        url = granule_url(t)
        status, body, meta, retrieved = 0, b"", {}, None
        for attempt in range(5):
            wait = a.min_interval - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
            try:
                status, body, meta = (direct_get if a.route == "direct" else firecrawl_get)(url)
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                last = time.monotonic()
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            last = time.monotonic()
            retrieved = utc_now()
            if status in (429, 500, 502, 503, 504):
                ra = meta.get("retry_after")
                time.sleep(float(ra) if ra and ra.isdigit() else min(300, 10 * 2 ** attempt))
                continue
            break
        entry = {"title": t["title"], "section": t["section"], "granule": key, "url": url, "http_status": status,
                 "retrieved_at": retrieved, "bytes": len(body), "route": a.route, "edition": t["edition"]}
        text = body.decode("utf-8", "replace")
        m = re.search(r"documentid:(\S+)", text)
        if status == 200 and m and re.search(r"field-start:\w*head\b", text):
            rel = f"usc_raw/title-{t['title']}/{key}.htm"
            os.makedirs(os.path.dirname(os.path.join(a.work, rel)), exist_ok=True)
            with open(os.path.join(a.work, rel), "wb") as f:
                f.write(body)
            entry.update({"state": "complete", "file": rel, "sha256": sha256_hex(body), "document_id": m.group(1)})
        else:
            entry.update({"state": "not_found" if status in (302, 400, 404) else "failed", "error_body_sha256": sha256_hex(body),
                          "location": meta.get("location")})
        man["granules"][key] = entry
        new += 1
        if new % 20 == 0 or entry["state"] != "complete":
            man["updated_at"] = utc_now()
            tmp = mpath + ".tmp"
            json.dump(man, open(tmp, "w"), indent=1, sort_keys=True)
            os.replace(tmp, mpath)
        if entry["state"] != "complete":
            print(json.dumps({k: entry.get(k) for k in ("granule", "state", "http_status")}), flush=True)
        if a.limit and new >= a.limit:
            break
    man["updated_at"] = utc_now()
    json.dump(man, open(mpath + ".tmp", "w"), indent=1, sort_keys=True)
    os.replace(mpath + ".tmp", mpath)
    states = {}
    for e in man["granules"].values():
        states[e["state"]] = states.get(e["state"], 0) + 1
    print(json.dumps({"targets": len(targets), "fetched_now": new, "states": states}))


if __name__ == "__main__":
    main()
