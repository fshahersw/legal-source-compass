"""Check that the official source each SettleSignal record cites can be retrieved today (robots.txt respected).

For every record: url = official_settlement_url, else official_claim_url. Per host, robots.txt is read once
(urllib.robotparser, our User-Agent); disallowed URLs are not fetched. Each allowed URL is fetched once (GET,
25 s timeout, one retry on network error / 5xx), the response bytes kept unchanged under
private/acq/third_party_data/official_pages/<key>.bin (first 3 MB) and a check line written to
private/acq/third_party_data/official_pages/_checks.jsonl. Every request is also logged in the stream manifest.

Usage: python3 -I -B check_sources.py [--limit N]
"""
import concurrent.futures
import datetime
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
OUT = os.path.join(ACQ, "official_pages")
UA = "legal-source-compass research (Seeger Weiss internal research)"
# No owner-supplied contact address exists, so sec.gov gets the same plain agent as every host (never an invented address).
UA_SEC = UA
MAX_BYTES = 3 * 1024 * 1024
HOST_INTERVAL = 1.0

_locks, _last, _robots = {}, {}, {}
_glock = threading.Lock()
_mlock = threading.Lock()


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def key_of(url):
    return hashlib.sha1(url.encode()).hexdigest()[:20]


def _host_wait(host):
    with _glock:
        lock = _locks.setdefault(host, threading.Lock())
    lock.acquire()
    gap = time.time() - _last.get(host, 0)
    if gap < HOST_INTERVAL:
        time.sleep(HOST_INTERVAL - gap)
    return lock


def _host_done(host, lock):
    _last[host] = time.time()
    lock.release()


def get(url, limit=MAX_BYTES, timeout=25):
    host = urllib.parse.urlparse(url).netloc.lower()
    result = {}
    for attempt in range(2):
        lock = _host_wait(host)
        try:
            agent = UA_SEC if (host == "sec.gov" or host.endswith(".sec.gov")) else UA
            req = urllib.request.Request(url, headers={"User-Agent": agent, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read(limit + 1)
                result = {"status": resp.status, "final_url": resp.geturl(), "content_type": resp.headers.get("Content-Type", ""),
                          "body": body[:limit], "truncated": len(body) > limit, "error": None}
        except urllib.error.HTTPError as err:
            try:
                body = err.read(limit) or b""
            except Exception:
                body = b""
            result = {"status": err.code, "final_url": url, "content_type": (err.headers or {}).get("Content-Type", "") if err.headers else "",
                      "body": body, "truncated": False, "error": f"HTTP {err.code}"}
        except Exception as err:  # DNS, TLS, timeout, reset
            result = {"status": None, "final_url": url, "content_type": "", "body": b"", "truncated": False,
                      "error": (type(err).__name__ + ": " + str(err))[:240]}
        finally:
            _host_done(host, lock)
        retry = result["status"] is None or (result["status"] or 0) >= 500
        if not retry:
            break
        time.sleep(3)
    return result


def robots_allows(url):
    parts = urllib.parse.urlparse(url)
    base = f"{parts.scheme}://{parts.netloc}"
    with _glock:
        cached = _robots.get(base)
    if cached is None:
        res = get(base + "/robots.txt", limit=512 * 1024, timeout=20)
        parser = urllib.robotparser.RobotFileParser()
        if res["status"] == 200:
            parser.parse(res["body"].decode("utf-8", "replace").splitlines())
            state = parser
        elif res["status"] is not None and 400 <= res["status"] < 500:
            state = "allow_all"  # RFC 9309 s2.3.1.3: robots.txt "unavailable" (4xx) -> crawler MAY access
        else:
            state = "disallow_all"  # RFC 9309 s2.3.1.4: "unreachable" (5xx / network error) -> assume complete disallow
        with _glock:
            _robots[base] = (state, res["status"], res["error"])
        cached = (state, res["status"], res["error"])
    state, status, error = cached
    if state == "allow_all":
        return True, status, error
    if state == "disallow_all":
        return False, status, error
    return state.can_fetch(UA, url), status, error


def check(record):
    url = record["official_settlement_url"] or record["official_claim_url"]
    line = {"settlesignal_url": record["url"], "url": url, "checked_at": now()}
    if not url:
        line.update({"outcome": "no_url"})
        return line
    allowed, robots_status, robots_error = robots_allows(url)
    line["robots_status"] = robots_status
    if not allowed:
        unreachable = robots_status is None or robots_status >= 500
        line.update({"outcome": "robots_unreachable" if unreachable else "robots_disallowed", "error": robots_error})
        return line
    res = get(url)
    body = res.pop("body")
    key = key_of(url)
    path = os.path.join(OUT, key + ".bin")
    with open(path, "wb") as handle:
        handle.write(body)
    lower = body.decode("utf-8", "replace").lower()
    line.update({k: res[k] for k in ("status", "final_url", "content_type", "truncated", "error")})
    line.update({"path": os.path.relpath(path, ROOT), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
                 "mentions_settlement": any(w in lower for w in ("settlement", "class action", "refund", "claim", "restitution", "redress"))})
    with _mlock, open(os.path.join(ACQ, "_manifest.jsonl"), "a") as manifest:
        manifest.write(json.dumps({"url": url, "final_url": res["final_url"], "path": line["path"], "sha256": line["sha256"],
                                   "bytes": line["bytes"], "retrieved_at": line["checked_at"], "http_status": res["status"],
                                   "content_type": res["content_type"], "method": "direct (official-source check)", "error": res["error"]}) + "\n")
    return line


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    data = json.load(open(os.path.join(ACQ, "settlesignal", "settlements.json"), encoding="utf-8"))
    records = data["settlements"][:limit] if limit else data["settlements"]
    os.makedirs(OUT, exist_ok=True)
    done = set()
    checks_path = os.path.join(OUT, "_checks.jsonl")
    if os.path.exists(checks_path):
        for raw in open(checks_path):
            done.add(json.loads(raw)["settlesignal_url"])
    todo = [r for r in records if r["url"] not in done]
    print("to check", len(todo), "already", len(done), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool, open(checks_path, "a") as out:
        for n, line in enumerate(pool.map(check, todo), 1):
            out.write(json.dumps(line) + "\n")
            out.flush()
            if n % 50 == 0:
                print(n, "checked", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
