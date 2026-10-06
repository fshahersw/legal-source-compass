"""Shared, stdlib-only toolkit for batch-4 state-code acquisition (NH ME MT RI DE SD ND AK VT WY).

Credentials come only from the environment (EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY for storage uploads,
FIRECRAWL_API_KEY / TAVILY_API_KEY for the proxied fallback). Nothing secret is stored, logged or written.

Archive: every response body is kept verbatim under <work>/raw/ with sha256 + retrieval time + status + route in the append-only
<work>/receipts.jsonl. Re-running skips URLs already captured (checksum re-verified). Requests to one host are serialized and spaced.
"""
import gzip
import hashlib
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "LegalSourceAtlas-statecodes/1 (official-source acquisition; sequential, rate-limited)"
KEY_PREFIX = "state-codes/sha256"


def sha256_hex(b):
    if isinstance(b, str):
        b = b.encode("utf-8")
    return hashlib.sha256(b).hexdigest()


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def object_key(sha):
    return f"{KEY_PREFIX}/{sha[:2]}/{sha}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Archive:
    def __init__(self, work, min_interval=1.0, max_redirects=5):
        self.work = work
        self.raw = os.path.join(work, "raw")
        os.makedirs(self.raw, exist_ok=True)
        self.receipts_path = os.path.join(work, "receipts.jsonl")
        self.min_interval = min_interval
        self.max_redirects = max_redirects
        self._lock = threading.Lock()
        self._last = {}
        self.index = {}
        if os.path.exists(self.receipts_path):
            with open(self.receipts_path) as f:
                for line in f:
                    r = json.loads(line)
                    self.index[r["url"]] = r

    def _wait(self, host):
        with self._lock:
            now = time.monotonic()
            at = max(now, self._last.get(host, 0) + self.min_interval)
            self._last[host] = at
        if at > now:
            time.sleep(at - now)

    def _http(self, url, accept="*/*", timeout=180, extra=None):
        opener = urllib.request.build_opener(_NoRedirect)
        hops = []
        cur = url
        for _ in range(self.max_redirects + 1):
            self._wait(urllib.parse.urlparse(cur).hostname)
            h = {"User-Agent": UA, "Accept": accept, "Accept-Encoding": "gzip"}
            h.update(extra or {})
            req = urllib.request.Request(cur, headers=h)
            try:
                with opener.open(req, timeout=timeout) as r:
                    body = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        body = gzip.decompress(body)
                    return r.status, body, {"final_url": cur, "redirects": hops, "content_type": r.headers.get("Content-Type"),
                                            "etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified")}
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                    hops.append({"status": e.code, "location": e.headers["Location"]})
                    cur = urllib.parse.urljoin(cur, e.headers["Location"])
                    continue
                return e.code, e.read(), {"final_url": cur, "redirects": hops, "retry_after": e.headers.get("Retry-After"),
                                          "content_type": e.headers.get("Content-Type")}
        return 310, b"", {"final_url": cur, "redirects": hops, "error": "too many redirects"}

    def fetch(self, url, rel=None, accept="*/*", force=False, attempts=5, route="direct", accept_status=(200,)):
        """Capture one URL. Returns the receipt (dict); body at os.path.join(self.work, receipt['file']) when state == 'complete'."""
        old = self.index.get(url)
        if old and old.get("state") == "complete" and not force:
            return old
        status, body, meta, retrieved = 0, b"", {}, None
        for attempt in range(attempts):
            try:
                if route == "direct":
                    status, body, meta = self._http(url, accept=accept)
                else:
                    status, body, meta = proxied_fetch(url, route)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                meta = {"error": str(e)[:200]}
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            retrieved = utc_now()
            if status in (429, 500, 502, 503, 504):
                ra = meta.get("retry_after")
                time.sleep(float(ra) if ra and str(ra).isdigit() else min(300, 10 * 2 ** attempt))
                continue
            break
        rec = {"url": url, "http_status": status, "retrieved_at": retrieved or utc_now(), "bytes": len(body), "route": route,
               **{k: v for k, v in meta.items() if v not in (None, [])}}
        if status in accept_status and body:
            sha = sha256_hex(body)
            rel = rel or f"{sha[:2]}/{sha}"
            path = os.path.join(self.raw, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(body)
            rec.update({"state": "complete", "sha256": sha, "file": os.path.join("raw", rel)})
        else:
            rec.update({"state": "failed", "error_body_sha256": sha256_hex(body)})
        with self._lock:
            with open(self.receipts_path, "a") as f:
                f.write(json.dumps(rec, sort_keys=True) + "\n")
            self.index[url] = rec
        return rec

    def read(self, receipt):
        with open(os.path.join(self.work, receipt["file"]), "rb") as f:
            b = f.read()
        if sha256_hex(b) != receipt["sha256"]:
            raise SystemExit("retained original failed checksum: " + receipt["url"])
        return b

    def get(self, url, **kw):
        """fetch + return decoded text; raises if not complete."""
        rec = self.fetch(url, **kw)
        if rec["state"] != "complete":
            raise RuntimeError(f"fetch failed {rec['http_status']}: {url}")
        return self.read(rec)


def proxied_fetch(url, route):
    """Bot-block fallback. Official hosts only; the returned content hash is what is retained, route recorded as proxied."""
    if route == "firecrawl":
        key = os.environ.get("FIRECRAWL_API_KEY", "")
        if not key:
            raise SystemExit("FIRECRAWL_API_KEY not in environment")
        req = urllib.request.Request("https://api.firecrawl.dev/v1/scrape", method="POST",
                                     data=json.dumps({"url": url, "formats": ["rawHtml"]}).encode(),
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=240) as r:
            doc = json.loads(r.read())
        d = doc.get("data") or {}
        return (d.get("metadata") or {}).get("statusCode", 0), (d.get("rawHtml") or "").encode("utf-8"), \
            {"final_url": (d.get("metadata") or {}).get("url", url), "proxy": "firecrawl", "proxied_fetch": True}
    raise SystemExit("unknown proxied route " + route)


# ----------------------------------------------------------------------------------- storage (private corpus-originals)
def _storage(method, key, body=None, timeout=300):
    base = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    k = os.environ.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "")
    if urllib.parse.urlparse(base).hostname != "xosqzzsnhxcyehcnirpa.supabase.co" or not k:
        raise SystemExit("corpus Supabase credentials are required in the environment")
    h = {"apikey": k}
    if not k.startswith("sb_"):
        h["Authorization"] = "Bearer " + k
    if body is not None:
        h["Content-Type"] = "application/octet-stream"
        h["x-upsert"] = "false"
    req = urllib.request.Request(f"{base}/storage/v1/object/corpus-originals/{key}", data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def upload_originals(work, workers=4):
    """Upload every complete original (content-addressed key state-codes/sha256/<2>/<sha>) and verify by whole-object GET."""
    import concurrent.futures
    arc = Archive(work)
    rp = os.path.join(work, "upload_receipts.json")
    receipts = json.load(open(rp)) if os.path.exists(rp) else {}
    todo = {}
    for r in arc.index.values():
        if r.get("state") == "complete" and not receipts.get(r["sha256"], {}).get("verified"):
            todo[r["sha256"]] = r
    lock = threading.Lock()

    def one(sha, r):
        body = arc.read(r)
        key = object_key(sha)
        st, _ = _storage("POST", key, body)
        if st not in (200, 201, 400, 409):
            time.sleep(3)
            st, _ = _storage("POST", key, body)
        gs, back = _storage("GET", key)
        ok = gs == 200 and sha256_hex(back) == sha and len(back) == len(body)
        with lock:
            receipts[sha] = {"key": key, "bytes": len(body), "verified": ok, "upload_http_status": st, "verified_at": utc_now()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for f in [ex.submit(one, s, r) for s, r in todo.items()]:
            f.result()
    tmp = rp + ".tmp"
    json.dump(receipts, open(tmp, "w"), indent=1, sort_keys=True)
    os.replace(tmp, rp)
    complete = {r["sha256"] for r in arc.index.values() if r.get("state") == "complete"}
    return {"objects": len(complete), "verified": sum(1 for s in complete if receipts.get(s, {}).get("verified"))}


# ----------------------------------------------------------------------------------- text helpers
def collapse(s):
    return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip()


def html_text(fragment, block=("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "dd", "dt", "center")):
    """Plain text of an HTML fragment: block tags end a line, entities decoded, whitespace collapsed per line."""
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", fragment)
    s = re.sub(r"(?i)<(/?)(" + "|".join(block) + r")\b[^>]*>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    lines = [collapse(html.unescape(x)) for x in s.split("\n")]
    return "\n".join(x for x in lines if x)


def decode_html(raw):
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace"), "utf-8-replace"


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")


def write_packet(work, state, *, source, edition, chapters, sections, extra=None):
    """Stage a packet: chapters.jsonl (hash-bound chapter text), sections.jsonl (code-point spans into chapter text), manifest.json.

    chapters: list of {native_id, path:[{type,number,heading}], heading, text, raw_sha256s:[...], source_urls:[...]}
    sections: list of {chapter_native_id, citation, number, heading, start, end, history, flags, published_fields:{...}}  (start/end are
              Unicode code-point offsets into the chapter text; the section text is text[start:end])
    """
    out = os.path.join(work, "packet")
    os.makedirs(out, exist_ok=True)
    ch_rows, by_id = [], {}
    for c in chapters:
        row = {k: v for k, v in c.items() if k != "text"}
        row["text_sha256"] = sha256_hex(c["text"])
        row["text_codepoints"] = len(c["text"])
        ch_rows.append(row)
        by_id[c["native_id"]] = c["text"]
    os.makedirs(os.path.join(out, "chapter-text"), exist_ok=True)
    for c in chapters:
        with open(os.path.join(out, "chapter-text", sha256_hex(c["text"]) + ".txt"), "w", encoding="utf-8") as f:
            f.write(c["text"])
    bad = [s["citation"] for s in sections if not (0 <= s["start"] < s["end"] <= len(by_id[s["chapter_native_id"]]))]
    if bad:
        raise SystemExit("section spans outside chapter text: " + ", ".join(bad[:5]))
    sec_rows = [dict(s, text_sha256=sha256_hex(by_id[s["chapter_native_id"]][s["start"]:s["end"]])) for s in sections]
    write_jsonl(os.path.join(out, "chapters.jsonl"), ch_rows)
    write_jsonl(os.path.join(out, "sections.jsonl"), sec_rows)
    man = {"schema_version": "state-code-staging/1", "state": state, "source": source, "edition": edition,
           "chapters": len(ch_rows), "sections": len(sec_rows), "created_at": utc_now(),
           "chapters_sha256": sha256_hex("\n".join(json.dumps(r, sort_keys=True) for r in ch_rows)),
           "sections_sha256": sha256_hex("\n".join(json.dumps(r, sort_keys=True) for r in sec_rows)), **(extra or {})}
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(man, f, indent=1, sort_keys=True)
    return man
