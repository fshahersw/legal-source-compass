"""Acquire state court rules from the official publishers the open-us-law court_rules scrapers target.

Discovery logic adapted from Vaquill-AI/open-us-law scripts/court_rules/ingest_{mn,nv,fl,tx,nj}_court_rules.py
(Apache-2.0, Copyright Vaquill AI). Only the scrapers' logic is reused; none of that project's data is used.

  python3 -I -B scripts/enrichment/court_rules/acquire_state_rules.py mn nv fl tx nj

Raw bytes are stored unchanged under private/acq/court_rules/state/<st>/ (HTML gzip-compressed) with manifest rows.
Sources:
  MN  https://www.revisor.mn.gov/court_rules/            Office of the Revisor of Statutes (HTML, one page per rule)
  NV  https://www.leg.state.nv.us/CourtRules/            Nevada Legislature (HTML, one page per rule set)
  FL  https://www.floridabar.org/rules/ctproc/           The Florida Bar (index HTML + one PDF per chapter)
  TX  https://www.txcourts.gov/rules-forms/rules-standards/  Texas Judicial Branch (index HTML + one PDF per rule set)
  NJ  https://www.njcourts.gov/attorneys/rules-of-court  NJ Judiciary (bot wall: recorded and skipped)
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib  # noqa: E402

LOG = os.path.join(fetchlib.ACQ, "state", "acquire_log.jsonl")
_log_lock = threading.Lock()


def log(entry: dict) -> None:
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    entry = {"at": fetchlib.utc_now(), **entry}
    with _log_lock:
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    print(json.dumps(entry), flush=True)


def get(url: str, rel: str, **kw):
    try:
        status, body, headers = fetchlib.fetch(url, rel, **kw)
    except PermissionError as error:
        log({"url": url, "result": "robots_disallow", "detail": str(error)})
        return None, None
    except Exception as error:  # network failure after retries
        log({"url": url, "result": "error", "detail": str(error)[:300]})
        return None, None
    if status != 200:
        log({"url": url, "result": f"http_{status}", "bytes": len(body)})
        return status, None
    return status, body


# ---------------------------------------------------------------- Minnesota
MN_BASE = "https://www.revisor.mn.gov"
MN_SETS = ["cp", "cr", "ev", "ap", "gp", "ju", "pr", "ra", "sg", "ms", "dc"]
_ID_PLAIN_RE = re.compile(r"/court_rules/([a-z]+)/id/([\w.]+)/")
_ID_SUBTYPE_RE = re.compile(r"/court_rules/([a-z]+)/subtype/([a-z]+)/id/([\w.]+)/")
_RULE_INDEX_RE = re.compile(r'href="(/court_rules/rule/[\w-]+)"')


def mn_rule_url(code: str, subtype: str, rid: str) -> str:
    if subtype:
        return f"{MN_BASE}/court_rules/{code}/subtype/{subtype}/id/{rid}/"
    return f"{MN_BASE}/court_rules/{code}/id/{rid}/"


def acquire_mn() -> None:
    _, landing = get(f"{MN_BASE}/court_rules/", "state/mn/index.html")
    refs: set[tuple[str, str, str]] = set()
    for code in MN_SETS:
        queue, seen = [f"/court_rules/{code}/"], set()
        while queue:
            path = queue.pop()
            if path in seen:
                continue
            seen.add(path)
            _, body = get(MN_BASE + path, "state/mn/index/" + fetchlib.slug(MN_BASE + path) + ".html")
            if not body:
                continue
            html = body.decode("utf-8", "replace")
            for c, st, rid in _ID_SUBTYPE_RE.findall(html):
                if c == code:
                    refs.add((code, st, rid))
            for c, rid in _ID_PLAIN_RE.findall(html):
                if c == code:
                    refs.add((code, "", rid))
            for href in _RULE_INDEX_RE.findall(html):
                if href not in seen:
                    queue.append(href)
        log({"state": "mn", "set": code, "index_pages": len(seen), "rules_so_far": len(refs)})
    for code, st, rid in sorted(refs):
        url = mn_rule_url(code, st, rid)
        get(url, f"state/mn/rules/{code}/{st or '_'}/{rid}.html")
    log({"state": "mn", "result": "done", "rules": len(refs)})


# ---------------------------------------------------------------- Nevada
NV_BASE = "https://www.leg.state.nv.us/CourtRules/"


def acquire_nv() -> None:
    _, body = get(NV_BASE, "state/nv/index.html")
    if not body:
        return
    html = body.decode("utf-8", "replace")
    pages = []
    for href in re.findall(r'href="([A-Za-z0-9_]+\.html?)"', html):
        if href not in pages:
            pages.append(href)
    for href in pages:
        get(urljoin(NV_BASE, href), f"state/nv/sets/{href}")
    log({"state": "nv", "result": "done", "rule_set_pages": len(pages)})


# ---------------------------------------------------------------- Florida
FL_INDEX = "https://www.floridabar.org/rules/ctproc/"
FL_CHAPTER_RE = re.compile(r"Chapter\s+(\d+)\s*[–-]")


def acquire_fl() -> None:
    _, body = get(FL_INDEX, "state/fl/ctproc_index.html")
    if not body:
        return
    html = body.decode("utf-8", "replace")
    found = 0
    for m in re.finditer(r'<a\b[^>]*href="([^"]+\.pdf)"[^>]*>(.*?)</a>', html, re.S | re.I):
        url, text = m.group(1), " ".join(re.sub(r"<[^>]+>", " ", m.group(2)).split())
        cm = FL_CHAPTER_RE.search(text)
        if not cm:
            continue
        found += 1
        get(url, f"state/fl/chapter_{cm.group(1)}_{fetchlib.slug(url, 50)}.pdf", gz=False)
    log({"state": "fl", "result": "done", "chapter_pdfs": found})


# ---------------------------------------------------------------- Texas
TX_INDEX = "https://www.txcourts.gov/rules-forms/rules-standards/"
TX_WANTED = {
    "texas-rules-of-civil-procedure": "trcp",
    "texas-rules-of-appellate-procedure": "trap",
    "texas-rules-of-evidence": "tre",
    "statewide-rules-governing-electronic-filing-in-criminal-cases": "efile_crim",
    "texas-rules-of-judicial-administration": "trja",
    "texas-disciplinary-rules-of-professional-conduct": "tdrpc",
    "standards-for-appellate-conduct": "appellate_conduct",
}


def acquire_tx() -> None:
    _, body = get(TX_INDEX, "state/tx/rules_standards_index.html")
    if not body:
        return
    html = body.decode("utf-8", "replace")
    done = set()
    for url in re.findall(r'href="([^"]*/media/\d+/[^"]+\.pdf)"', html, re.I):
        full = urljoin(TX_INDEX, url)
        name = full.rsplit("/", 1)[-1].lower()
        for key, short in TX_WANTED.items():
            if name.startswith(key) and short not in done:
                done.add(short)
                get(full, f"state/tx/{short}_{fetchlib.slug(full, 50)}.pdf", gz=False)
    log({"state": "tx", "result": "done", "pdfs": sorted(done)})


# ---------------------------------------------------------------- New Jersey
NJ_INDEX = "https://www.njcourts.gov/attorneys/rules-of-court"
NJ_SAMPLE_PDF = "https://www.njcourts.gov/sites/default/files/r4-5.pdf"


def acquire_nj() -> None:
    for url in (NJ_INDEX, NJ_SAMPLE_PDF):
        try:
            status, body, headers = fetchlib.fetch(url, None, retries=1)
            blocked = status == 403 and b"incapsula" in body.lower() or (status == 403 and b"NOINDEX" in body)
            log({"state": "nj", "url": url, "http_status": status, "bytes": len(body), "bot_wall": bool(blocked)})
        except Exception as error:
            log({"state": "nj", "url": url, "result": "error", "detail": str(error)[:300]})


ACQUIRERS = {"mn": acquire_mn, "nv": acquire_nv, "fl": acquire_fl, "tx": acquire_tx, "nj": acquire_nj}


def main(argv):
    states = argv or list(ACQUIRERS)
    threads = [threading.Thread(target=ACQUIRERS[s], name=s) for s in states]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    main(sys.argv[1:])
