"""Stage 2: download every practice document a judge page links, store it unchanged in the private bucket, extract its text.

For each unique document URL found by crawl_courts.py:
  download (robots.txt obeyed; one request per second per court site, or the site's Crawl-delay) -> SHA-256 and size ->
  upload unchanged to corpus-originals at judge_practices/<retrieval date>/<sha256>.<ext> with whole-object SHA-256 readback
  (scripts/enrichment/caselaw/store.py pattern) -> extract plain text (extract_text.py) -> delete the local copy.
The local copy exists only between download and the verified upload; a failed upload leaves a record with the error and no local file.
One JSON record per URL is written to private/build/judge_practices/docs/<sha1(url)[:20]>.json and is the resume point.

Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY are read from the environment (or, as store.py does, from private/scratch/env.sh into this
process only); nothing is printed.

    python3 -I -B scripts/enrichment/judge_practices/fetch_docs.py [--courts a,b] [--workers 24] [--stop-at 14200] [--no-upload]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract_text as xt  # noqa: E402
import fetchlib as fl  # noqa: E402

ROOT = fl.ROOT
COURTS = os.path.join(ROOT, "private", "build", "judge_practices", "courts")
DOCS = os.path.join(ROOT, "private", "build", "judge_practices", "docs")
TMP = os.path.join(ROOT, "private", "acq", "judge_practices", "tmp_docs")

_print = threading.Lock()


def say(*a) -> None:
    with _print:
        print(*a, flush=True)


def doc_key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:20]


def record_path(url: str) -> str:
    return os.path.join(DOCS, doc_key(url) + ".json")


def collect_jobs(only: set[str]) -> dict[str, list[dict]]:
    """site (pace key) -> [{url, kind, file_type, titles, courts}] in a stable order, one entry per document URL."""
    seen: dict[str, dict] = {}
    for name in sorted(os.listdir(COURTS)):
        if not name.endswith(".json"):
            continue
        cid = name[:-5]
        if only and cid not in only:
            continue
        court = json.load(open(os.path.join(COURTS, name), encoding="utf-8"))
        for j in court.get("judges", []):
            for d in j.get("documents") or []:
                e = seen.setdefault(d["url"], {"url": d["url"], "kind": d["kind"], "file_type": d["file_type"], "titles": [], "courts": set(),
                                               "host": urllib.parse.urlparse(d["url"]).netloc.lower()})
                e["courts"].add(cid)
                if d["title"] not in e["titles"]:
                    e["titles"].append(d["title"])
    by_site: dict[str, list[dict]] = defaultdict(list)
    for e in seen.values():
        by_site[fl.pace_key(e["host"])].append(e)
    for jobs in by_site.values():
        jobs.sort(key=lambda e: (e["kind"] != "file", e["url"]))
    return by_site


def xt_ext(url: str) -> str | None:
    m = re.search(r"\.([A-Za-z0-9]{2,5})(?:$|[?#])", urllib.parse.urlparse(url).path)
    return m.group(1).lower() if m else None


def wrapper_file(body: bytes, page_url: str) -> str | None:
    """The one file a thin web page carries (little text of its own and a link to a document), else None."""
    import parse_lib as pl

    soup = pl.soup_of(body)
    root = pl.main_root(soup)
    text = pl.clean(root.get_text(" "))
    files = [ln for ln in pl.extract_links(soup, page_url) if not ln.chrome and pl.FILE_EXT.search(ln.href)]
    if files and len(text) < 600:
        return files[0].href
    # a CMS file node whose template keeps the site header in the main region: the page title is the file's name and its one content link is that file
    title = pl.clean(soup.title.get_text()).split("|")[0].strip().lower() if soup.title else ""
    if len(files) == 1 and title and pl.clean(files[0].text).lower() == title:
        return files[0].href
    return None


def ext_for(detected: str, url_ext: str | None) -> str:
    if detected in ("pdf", "docx", "doc", "rtf", "wpd", "odt", "xlsx", "xls", "pptx", "ppt", "html", "txt", "zip"):
        return detected
    return url_ext or "bin"


def process(job: dict, store, upload: bool, stop_at: int) -> dict:
    url = job["url"]
    rec: dict = {"url": url, "titles": job["titles"], "courts": sorted(job["courts"]), "kind": job["kind"], "file_type_from_url": job["file_type"],
                 "status": None, "error": None, "blocked": None}
    robots = fl.robots_for(url)
    if not robots.allows(url):
        rec.update(blocked="robots", error="robots.txt disallows this address")
        return rec
    if fl.request_count() >= stop_at:
        raise fl.BudgetExhausted("document request allowance used")
    r = fl.get(url, "document", interval=max(fl.MIN_INTERVAL, robots.delay), store=False)
    rec.update(status=r.status, final_url=r.final_url or url, retrieved_at=fl.utc_now(), content_type_header=r.ctype or None, blocked=r.blocked,
               error=r.error)
    if not r.ok or not r.body:
        rec["error"] = rec["error"] or (f"HTTP {r.status}" if r.status != 200 else "empty response")
        return rec
    body = r.body
    detected = xt.detect_type(body[:4096], job["file_type"], r.ctype)
    if detected == "html" and job["kind"] in ("page", "file"):  # "file": a link that looks like a file but answers with the CMS page that carries it
        target = wrapper_file(body, r.final_url or url)
        if target and fl.pace_key(urllib.parse.urlparse(target).netloc) == fl.pace_key(urllib.parse.urlparse(url).netloc):
            # a thin page that only carries one file (a CMS "content" node): the file is the document, the page is recorded as its wrapper
            rec["wrapper"] = {"url": url, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
            if not robots.allows(target):
                rec.update(blocked="robots", error="robots.txt disallows the file this page carries")
                return rec
            if fl.request_count() >= stop_at:
                raise fl.BudgetExhausted("document request allowance used")
            r2 = fl.get(target, "document", interval=max(fl.MIN_INTERVAL, robots.delay), store=False)
            if not r2.ok or not r2.body:
                rec.update(status=r2.status, error=r2.error or f"HTTP {r2.status} for the file this page carries", file_url=target)
                return rec
            rec.update(file_url=target, final_url=r2.final_url or target, content_type_header=r2.ctype or None)
            r, body = r2, r2.body
            job = {**job, "file_type": xt_ext(target)}
            detected = xt.detect_type(body[:4096], job["file_type"], r.ctype)
    sha = hashlib.sha256(body).hexdigest()
    ext = ext_for(detected, job["file_type"])
    rec.update(sha256=sha, bytes=len(body), detected_type=detected, file_type=ext)
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(TMP, f"{doc_key(url)}.{ext}")
    try:
        with open(path, "wb") as h:
            h.write(body)
        if detected == "html" and job["kind"] == "file":
            rec["note"] = "address returned a web page, not the file its link suggests"
        if upload:
            date = rec["retrieved_at"][:10]
            try:
                receipt = store.put(path, date, sha, len(body), ext)
                rec["storage"] = {k: receipt[k] for k in ("bucket", "key", "state", "sha256", "bytes", "readback_sha256", "readback_bytes",
                                                          "readback_ok", "verified_at", "content_type")}
            except Exception as e:  # noqa: BLE001 - recorded; the document stays unarchived
                rec["storage_error"] = f"{type(e).__name__}: {str(e)[:200]}"
        ex = xt.extract(path, detected)
        text, counts = xt.redact(ex.text) if ex.text else ("", {"access_codes": 0})
        capped, truncated, total = xt.cap(text)
        rec.update(text=capped, text_chars=len(capped), text_chars_total=total, text_truncated=truncated, text_method=ex.method, pages=ex.pages,
                   text_error=ex.error, redactions=counts, text_sha256=hashlib.sha256(capped.encode()).hexdigest() if capped else None)
    finally:
        if os.path.exists(path):
            os.remove(path)
    return rec


def run_site(site: str, jobs: list[dict], store, upload: bool, stop_at: int, force: bool) -> tuple[str, int, int, str | None]:
    done = failed = 0
    for job in jobs:
        out = record_path(job["url"])
        if os.path.exists(out) and not force:
            prev = json.load(open(out, encoding="utf-8"))
            if prev.get("status") == 200 and (prev.get("storage", {}).get("readback_ok") or not upload):
                done += 1
                continue
        try:
            rec = process(job, store, upload, stop_at)
        except fl.BudgetExhausted as e:
            return site, done, failed, f"budget: {e}"
        except Exception as e:  # noqa: BLE001
            rec = {"url": job["url"], "titles": job["titles"], "courts": sorted(job["courts"]), "error": f"{type(e).__name__}: {str(e)[:200]}"}
        os.makedirs(DOCS, exist_ok=True)
        with open(out, "w", encoding="utf-8") as h:
            json.dump(rec, h, sort_keys=True)
        if rec.get("status") == 200 and not rec.get("error"):
            done += 1
        else:
            failed += 1
    return site, done, failed, None


PAGE_TEXT_TITLE = "Text on the judge's page"


def collect_pagetext_jobs(only: set[str]) -> list[dict]:
    """Judge pages that carry the judge's practices in their own text (extract_text.inline_practices). The page bytes are the stored copy of the
    crawl (no new request); the page is the document, the judge it belongs to is the owner."""
    seen: dict[str, dict] = {}
    for name in sorted(os.listdir(COURTS)):
        if not name.endswith(".json"):
            continue
        cid = name[:-5]
        if only and cid not in only:
            continue
        court = json.load(open(os.path.join(COURTS, name), encoding="utf-8"))
        for j in court.get("judges", []):
            url = j["page_url"]
            if j.get("status") != 200 or j.get("listing_only") or j.get("data_url") or j.get("former") or not j.get("name") or "#" in url:
                continue
            e = seen.get(url)
            if e is None:
                body = fl.cached_page(url)
                if body is None or xt.inline_practices(body) is None:
                    continue
                e = seen[url] = {"url": url, "kind": "pagetext", "file_type": "html", "titles": [PAGE_TEXT_TITLE], "courts": set(),
                                 "host": urllib.parse.urlparse(url).netloc.lower()}
            e["courts"].add(cid)
    return list(seen.values())


def process_pagetext(job: dict, store, upload: bool, manifest: dict[str, dict]) -> dict:
    url = job["url"]
    body = fl.cached_page(url)
    m = manifest.get(url) or {}
    rec: dict = {"url": url, "titles": job["titles"], "courts": sorted(job["courts"]), "kind": "pagetext", "file_type_from_url": "html", "status": 200,
                 "error": None, "blocked": None, "final_url": m.get("final_url") or url, "retrieved_at": m.get("retrieved_at"),
                 "content_type_header": m.get("content_type") or "text/html"}
    sha = hashlib.sha256(body).hexdigest()
    rec.update(sha256=sha, bytes=len(body), detected_type="html", file_type="html", manifest_sha256_matches=(m.get("sha256") == sha))
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(TMP, f"{doc_key(url)}.html")
    try:
        with open(path, "wb") as h:
            h.write(body)
        if upload:
            date = (rec["retrieved_at"] or fl.utc_now())[:10]
            try:
                receipt = store.put(path, date, sha, len(body), "html")
                rec["storage"] = {k: receipt[k] for k in ("bucket", "key", "state", "sha256", "bytes", "readback_sha256", "readback_bytes",
                                                          "readback_ok", "verified_at", "content_type")}
            except Exception as e:  # noqa: BLE001
                rec["storage_error"] = f"{type(e).__name__}: {str(e)[:200]}"
        ex = xt.html_text(body)
        text, counts = xt.redact_page(ex.text)
        capped, truncated, total = xt.cap(text)
        rec.update(text=capped, text_chars=len(capped), text_chars_total=total, text_truncated=truncated,
                   text_method=ex.method, pages=None, text_error=None, redactions=counts,
                   text_sha256=hashlib.sha256(capped.encode()).hexdigest() if capped else None)
    finally:
        if os.path.exists(path):
            os.remove(path)
    return rec


def run_pagetext(jobs: list[dict], store, upload: bool, force: bool, workers: int = 8) -> tuple[int, int]:
    manifest = fl.load_manifest_index()
    done = failed = 0
    os.makedirs(DOCS, exist_ok=True)

    def one(job: dict) -> bool:
        out = record_path(job["url"])
        if os.path.exists(out) and not force:
            prev = json.load(open(out, encoding="utf-8"))
            if prev.get("status") == 200 and (prev.get("storage", {}).get("readback_ok") or not upload):
                return True
        try:
            rec = process_pagetext(job, store, upload, manifest)
        except Exception as e:  # noqa: BLE001
            rec = {"url": job["url"], "titles": job["titles"], "courts": sorted(job["courts"]), "kind": "pagetext", "error": f"{type(e).__name__}: {str(e)[:200]}"}
        with open(out, "w", encoding="utf-8") as h:
            json.dump(rec, h, sort_keys=True)
        return rec.get("status") == 200 and not rec.get("error") and (bool(rec.get("storage", {}).get("readback_ok")) or not upload)

    with ThreadPoolExecutor(workers) as pool:
        for ok in pool.map(one, jobs):
            done += ok
            failed += not ok
    return done, failed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--courts", default="")
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--stop-at", type=int, default=14200)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="at most this many documents per site (testing)")
    ap.add_argument("--page-text-only", action="store_true", help="only the judge pages that carry practices in their own text (no requests)")
    args = ap.parse_args()
    if args.page_text_only:
        jobs = collect_pagetext_jobs(set(filter(None, args.courts.split(","))))
        say(f"{len(jobs)} judge pages carry practices in their own text")
        store = None
        if not args.no_upload:
            import docstore

            store = docstore.DocStore()
        ok, bad = run_pagetext(jobs, store, not args.no_upload, args.force)
        say(f"page texts: ok={ok} failed={bad}")
        return
    by_site = collect_jobs(set(filter(None, args.courts.split(","))))
    if args.limit:
        by_site = {k: v[: args.limit] for k, v in by_site.items()}
    total = sum(len(v) for v in by_site.values())
    say(f"{total} documents on {len(by_site)} sites; requests so far {fl.request_count()}")
    store = None
    if not args.no_upload:
        import docstore

        store = docstore.DocStore()
    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        futs = [pool.submit(run_site, s, j, store, not args.no_upload, args.stop_at, args.force) for s, j in sorted(by_site.items(), key=lambda kv: -len(kv[1]))]
        for f in as_completed(futs):
            site, done, failed, err = f.result()
            say(f"{site:10} ok={done} failed={failed}" + (f" STOP {err}" if err else ""))
    say(f"finished in {time.time() - t0:.0f}s; requests {fl.request_count()}")


if __name__ == "__main__":
    main()
