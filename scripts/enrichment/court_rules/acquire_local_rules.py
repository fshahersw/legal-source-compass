"""Download the reviewed local-rules documents (local_rules_sources.json) and the national federal rules.

  python3 -I -B scripts/enrichment/court_rules/acquire_local_rules.py [--federal] [--local] [court ...]

Federal rules: the PDF linked from each rule set's page on uscourts.gov (the page is saved too, for the edition text).
Local rules: each court's chosen documents from its own website (robots.txt honoured, < 2 requests/second per host).
A log line per document goes to private/acq/court_rules/local/acquire_log.jsonl.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

SOURCES = os.path.join(HERE, "local_rules_sources.json")
CANDIDATES = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "lookups", "local_rules_candidates.json")
LOG = os.path.join(fetchlib.ACQ, "local", "acquire_log.jsonl")
_lock = threading.Lock()

FEDERAL = {
    "frcp": ("Federal Rules of Civil Procedure", "https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-civil-procedure"),
    "frap": ("Federal Rules of Appellate Procedure", "https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-appellate-procedure"),
    "fre": ("Federal Rules of Evidence", "https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-evidence"),
    "frcrp": ("Federal Rules of Criminal Procedure", "https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-criminal-procedure"),
    "frbp": ("Federal Rules of Bankruptcy Procedure", "https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-bankruptcy-procedure"),
}


# The uscourts.gov FRAP file (House committee print CPRT-119HPRT61919, per its PDF metadata) has no usable text layer
# (fonts without a Unicode map); govinfo publishes the same committee print as a separate PDF that does.
FEDERAL_ALT = {
    "frap": ("https://www.govinfo.gov/content/pkg/CPRT-119HPRT61919/pdf/CPRT-119HPRT61919.pdf",
             "https://www.govinfo.gov/app/details/CPRT-119HPRT61919"),
}


def log(entry: dict) -> None:
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    entry = {"at": fetchlib.utc_now(), **entry}
    with _lock:
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    print(json.dumps(entry), flush=True)


def get(url: str, rel: str, **kw):
    try:
        status, body, headers = fetchlib.fetch(url, rel, **kw)
        return status, body, headers, None
    except PermissionError as error:
        return None, b"", {}, f"robots: {error}"
    except Exception as error:
        return None, b"", {}, str(error)[:300]


def acquire_federal() -> None:
    for key, (name, page) in FEDERAL.items():
        status, body, headers, err = get(page, f"federal/{key}_page.html")
        if err or status != 200:
            log({"set": key, "url": page, "result": err or f"http_{status}"})
            continue
        html = body.decode("utf-8", "replace")
        m = re.search(r'href="([^"]*/sites/default/files/document/[^"]+\.pdf)"', html)
        if not m:
            log({"set": key, "url": page, "result": "no_pdf_link"})
            continue
        pdf = urljoin(page, m.group(1))
        status, body, headers, err = get(pdf, f"federal/{key}.pdf", gz=False)
        log({"set": key, "name": name, "url": pdf, "result": err or f"http_{status}", "bytes": len(body),
             "content_type": headers.get("Content-Type")})
    for key, (pdf, details) in FEDERAL_ALT.items():
        get(details, f"federal/{key}_govinfo_details.html")
        status, body, headers, err = get(pdf, f"federal/{key}_govinfo.pdf", gz=False)
        log({"set": key, "url": pdf, "result": err or f"http_{status}", "bytes": len(body), "role": "text source"})


def found_on_index() -> dict[str, str]:
    if not os.path.exists(CANDIDATES):
        return {}
    out = {}
    for court in json.load(open(CANDIDATES))["courts"]:
        for doc in court["documents"]:
            out.setdefault(doc["url"], doc["found_on"])
    return out


ITEM_LINK = re.compile(r'<a href="(/index\.php/rules-orders-and-notices/local-rules/[^"]+)" itemprop="url"[^>]*>(.*?)</a>', re.S)


def acquire_doc(court: str, idx: int, doc: dict) -> None:
    url = doc["url"]
    fmt = doc.get("format", "pdf")
    rel_base = f"local/{court}/doc{idx}_{doc['part']}"
    if fmt == "pdf":
        status, body, headers, err = get(url, rel_base + ".pdf", gz=False, timeout=120)
        ctype = headers.get("Content-Type", "")
        ok = status == 200 and body[:5] == b"%PDF-"
        log({"court": court, "idx": idx, "url": url, "result": err or (f"http_{status}" if status != 200 else ("ok" if ok else "not_pdf")),
             "bytes": len(body), "content_type": ctype})
        return
    status, body, headers, err = get(url, rel_base + ".html", gz=True)
    log({"court": court, "idx": idx, "url": url, "result": err or f"http_{status}", "bytes": len(body), "format": fmt})
    if fmt == "html_pages" and status == 200:
        html = body.decode("utf-8", "replace")
        pages = []
        for href, _text in ITEM_LINK.findall(html):
            full = urljoin(url, href)
            if full not in pages:
                pages.append(full)
        for n, page in enumerate(pages):
            st, b2, _, e2 = get(page, f"{rel_base}_pages/{n:03d}.html", gz=True)
            if e2 or st != 200:
                log({"court": court, "idx": idx, "page": page, "result": e2 or f"http_{st}"})
        log({"court": court, "idx": idx, "url": url, "pages": len(pages), "result": "pages_done"})


def acquire_local(only: list[str]) -> None:
    sources = json.load(open(SOURCES))
    jobs = []
    for court, docs in sorted(sources["courts"].items()):
        if only and court not in only:
            continue
        for idx, doc in enumerate(docs):
            jobs.append((court, idx, doc))
    # one worker per court host at a time keeps pacing per host; different hosts run in parallel
    by_court: dict[str, list] = {}
    for job in jobs:
        by_court.setdefault(job[0], []).append(job)

    def run(court_jobs):
        for job in court_jobs:
            acquire_doc(*job)

    with ThreadPoolExecutor(10) as pool:
        list(pool.map(run, by_court.values()))


def main(argv):
    flags = [a for a in argv if a.startswith("--")]
    only = [a for a in argv if not a.startswith("--")]
    if "--federal" in flags or not flags:
        acquire_federal()
    if "--local" in flags or not flags:
        acquire_local(only)


if __name__ == "__main__":
    main(sys.argv[1:])
