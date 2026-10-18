"""Check each official URL listed on the Violation Tracker data-source pages (robots.txt respected, one GET each).

Only the agency pages the list links to are requested; no Violation Tracker record pages are read.
Raw bytes: private/acq/third_party_data/catalog_pages/<key>.bin; results: catalog_pages/_checks.jsonl.

Usage: python3 -I -B check_catalog_urls.py
"""
import concurrent.futures
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_sources as cs  # noqa: E402
import vt_parse as vp  # noqa: E402

OUT = os.path.join(cs.ACQ, "catalog_pages")
VT = os.path.join(cs.ACQ, "violationtracker")
FED_URL = "https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources"
STATE_URL = "https://violationtracker.goodjobsfirst.org/pages/local-state-data-sources"
TITLE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)


def entries():
    fed = vp.parse_federal(open(os.path.join(VT, "violation-tracker-data-sources.html"), encoding="utf-8").read(), FED_URL)
    st = vp.parse_state_local(open(os.path.join(VT, "local-state-data-sources.html"), encoding="utf-8").read(), STATE_URL)
    return fed + st


def check(url):
    line = {"url": url, "checked_at": cs.now()}
    allowed, robots_status, robots_error = cs.robots_allows(url)
    line["robots_status"] = robots_status
    if not allowed:
        line.update({"outcome": "robots_unreachable" if (robots_status is None or robots_status >= 500) else "robots_disallowed", "error": robots_error})
        return line
    res = cs.get(url)
    body = res.pop("body")
    path = os.path.join(OUT, cs.key_of(url) + ".bin")
    with open(path, "wb") as handle:
        handle.write(body)
    match = TITLE.search(body[:200000])
    title = " ".join(match.group(1).decode("utf-8", "replace").split())[:200] if match else ""
    line.update({k: res[k] for k in ("status", "final_url", "content_type", "truncated", "error")})
    line.update({"path": os.path.relpath(path, cs.ROOT), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "page_title": title})
    with cs._mlock, open(os.path.join(cs.ACQ, "_manifest.jsonl"), "a") as manifest:
        manifest.write(json.dumps({"url": url, "final_url": res["final_url"], "path": line["path"], "sha256": line["sha256"], "bytes": line["bytes"],
                                   "retrieved_at": line["checked_at"], "http_status": res["status"], "content_type": res["content_type"],
                                   "method": "direct (catalog URL check)", "error": res["error"]}) + "\n")
    return line


def main():
    os.makedirs(OUT, exist_ok=True)
    urls = []
    for entry in entries():
        for _, url in entry["links"]:
            if url not in urls:
                urls.append(url)
    checks_path = os.path.join(OUT, "_checks.jsonl")
    done = set()
    if os.path.exists(checks_path):
        done = {json.loads(raw)["url"] for raw in open(checks_path)}
    todo = [u for u in urls if u not in done]
    print("urls", len(urls), "to check", len(todo), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool, open(checks_path, "a") as out:
        for n, line in enumerate(pool.map(check, todo), 1):
            out.write(json.dumps(line) + "\n")
            out.flush()
            if n % 50 == 0:
                print(n, "checked", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
