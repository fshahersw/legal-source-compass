"""Acquire each state's constitution from the official publisher listed in constitution_sources.json.

  python3 -I -B scripts/enrichment/court_rules/acquire_constitutions.py [ST ...]

Raw bytes go unchanged to private/acq/court_rules/constitutions/<ST>/ (HTML and JSON gzip-compressed), with manifest rows;
one log line per state in private/acq/court_rules/constitutions/acquire_log.jsonl. robots.txt is honoured and a host that
answers with an error or a bot wall is recorded, never worked around. The Alabama and South Dakota legislatures serve their
constitution pages from public JSON APIs used by their own websites; those API responses are stored as the raw files.
Alabama query shape follows Vaquill-AI/open-us-law scripts/constitutions/ingest_state_constitutions.py (Apache-2.0).
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
from links import page_links  # noqa: E402

SOURCES = os.path.join(HERE, "constitution_sources.json")
LOG = os.path.join(fetchlib.ACQ, "constitutions", "acquire_log.jsonl")
_lock = threading.Lock()


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


def crawl(st: str, start, patterns: list[str], rewrite: list[str] | None = None) -> tuple[int, int, list[str]]:
    """Follow links level by level; the pages reached by the last pattern are the parts. Returns (ok, failed, errors)."""
    level_urls = list(start) if isinstance(start, list) else [start]
    ok = failed = 0
    errors: list[str] = []
    for depth, pat in enumerate(patterns):
        nxt: list[str] = []
        for url in level_urls:
            rel = f"constitutions/{st}/index_{depth}_{fetchlib.slug(url, 50)}.html"
            status, body, headers, err = get(url, rel)
            if err or status != 200:
                errors.append(f"{url}: {err or status}")
                continue
            for link, _text in page_links(body.decode("utf-8", "replace"), headers.get("X-Final-URL", url)):
                link = link.split("#")[0]
                if re.search(pat, link) and link not in nxt:
                    nxt.append(link)
        if depth == len(patterns) - 1 and rewrite:
            nxt = [re.sub(rewrite[0], rewrite[1], u) for u in nxt]
        level_urls = nxt
    for n, url in enumerate(level_urls):
        ext = "pdf" if url.lower().endswith(".pdf") else "html"
        status, body, headers, err = get(url, f"constitutions/{st}/part_{n:04d}.{ext}", gz=None if ext == "html" else False)
        if err or status != 200:
            failed += 1
            errors.append(f"{url}: {err or status}")
        else:
            ok += 1
    return ok, failed, errors[:10]


AL_GRAPHQL = "https://alison.legislature.state.al.us/graphql"


def al_graphql(st: str, src: dict) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json", "Origin": "https://alison.legislature.state.al.us"}
    q = json.dumps({"query": "query constitutionTitles { titles: constitutionTitles }"}).encode()
    status, body, _h, err = get(AL_GRAPHQL, f"constitutions/{st}/titles.json", data=q, headers=headers, gz=True)
    if err or status != 200:
        return {"result": err or f"http_{status}"}
    titles = json.loads(body)["data"]["titles"]
    pairs = []
    for row in titles.split("∫"):
        fields = row.split("†")
        if len(fields) >= 2 and fields[0].strip() and fields[0].strip() != "codeId":
            pairs.append((fields[0].strip(), fields[1].strip()))
    ids, started = [], False
    for code_id, label in pairs:  # articles and their sections, stopping at the first other row (local provisions)
        if re.match(r"^Article\s+[IVXLC]+\s", label):
            started = True
            ids.append(code_id)
        elif re.match(r"^Section\s+\S+", label) and started:
            ids.append(code_id)
        elif started:
            break
    got = 0
    for i in range(0, len(ids), 40):
        batch = json.dumps(ids[i:i + 40])
        query = json.dumps({"query": f"query {{ constitutionItems(where: {{ codeId: {{ in: {batch} }} }}) {{ data {{ codeId displayId title content history }} }} }}"}).encode()
        status, body, _h, err = get(AL_GRAPHQL, f"constitutions/{st}/items_{i // 40:03d}.json", data=query, headers=headers, gz=True)
        if err or status != 200:
            return {"result": err or f"http_{status}", "items": got}
        got += len(((json.loads(body).get("data") or {}).get("constitutionItems") or {}).get("data") or [])
    return {"result": "ok", "items": got, "titles": len(pairs)}


def sd_api(st: str, src: dict) -> dict:
    status, body, _h, err = get(src["url"], f"constitutions/{st}/list.json", gz=True)
    if err or status != 200:
        return {"result": err or f"http_{status}"}
    rows = json.loads(body)
    ok = failed = 0
    for row in rows:
        statute = row.get("Statute")
        if not statute:
            continue
        url = f"https://sdlegislature.gov/api/Statutes/{statute}.html?all=true"  # the article's list of sections
        st2, b2, _h2, e2 = get(url, f"constitutions/{st}/article_{re.sub(r'[^A-Za-z0-9.-]', '_', statute)}.html", gz=True)
        if e2 or st2 != 200:
            failed += 1
            continue
        page = b2.decode("utf-16-le", "replace") if b2[1:2] == b"\x00" else b2.decode("utf-8", "replace")
        ids = []
        for sid in re.findall(rf"\b({re.escape(statute)}-\d+[A-Za-z]?(?:\.\d+)?)\b", page):
            if sid not in ids:
                ids.append(sid)
        if not ids:  # an article without separate sections (e.g. the preamble): the article page is the text
            ok += 1
            continue
        for sid in ids:
            st3, _b3, _h3, e3 = get(f"https://sdlegislature.gov/api/Statutes/{sid}.html?all=true",
                                    f"constitutions/{st}/part_{re.sub(r'[^A-Za-z0-9.-]', '_', sid)}.html", gz=True)
            if e3 or st3 != 200:
                failed += 1
            else:
                ok += 1
    return {"result": "ok" if not failed else "partial", "parts": ok, "failed": failed}


def ut_xcode(st: str, src: dict) -> dict:
    """Utah: each Article_X.html names its current version file in `versionDefault`; that file links each section as
    `...?v=<section version file>`; the section version files hold the text."""
    ok = failed = 0
    errors = []
    n = 0
    for start in src["starts"]:
        base = start.rsplit("/", 1)[0]
        status, body, _h, err = get(start, f"constitutions/{st}/index_0_{fetchlib.slug(start, 40)}.html")
        m = re.search(r'versionDefault\s*=\s*"([A-Za-z0-9_]+)"', body.decode("utf-8", "replace")) if body else None
        if err or status != 200 or not m:
            failed += 1
            errors.append(f"{start}: {err or status or 'no version'}")
            continue
        ver_url = f"{base}/{m.group(1)}.html"
        status, body, _h, err = get(ver_url, f"constitutions/{st}/index_1_{m.group(1)}.html")
        if err or status != 200:
            failed += 1
            errors.append(f"{ver_url}: {err or status}")
            continue
        seen = []
        for v in re.findall(r"\?v=(UC_A[IVX]+_S\d+[A-Za-z]?_\d+)", body.decode("utf-8", "replace")):
            if v not in seen:
                seen.append(v)
        for v in seen:
            st2, _b, _h2, e2 = get(f"{base}/{v}.html", f"constitutions/{st}/part_{n:04d}.html")
            n += 1
            if e2 or st2 != 200:
                failed += 1
                errors.append(f"{v}: {e2 or st2}")
            else:
                ok += 1
    return {"result": "ok" if ok and not failed else ("partial" if ok else "failed"), "parts": ok, "failed": failed, "errors": errors[:5]}


def acquire(st: str, src: dict) -> None:
    if src["kind"] == "ut_xcode":
        log({"state": st, "kind": "ut_xcode", **ut_xcode(st, src)})
        return
    kind = src["kind"]
    if kind == "missing":
        log({"state": st, "result": "missing", "note": src.get("note")})
        return
    if kind in ("pdf", "html", "rtf"):
        ext = {"pdf": "pdf", "html": "html", "rtf": "rtf"}[kind]
        status, body, headers, err = get(src["url"], f"constitutions/{st}/document.{ext}", gz=(kind != "pdf"), timeout=180)
        ok = status == 200 and (kind != "pdf" or body[:5] == b"%PDF-")
        log({"state": st, "kind": kind, "url": src["url"], "result": err or ("ok" if ok else f"http_{status}"), "bytes": len(body),
             "content_type": headers.get("Content-Type")})
        return
    if kind == "list":
        ok = failed = 0
        errors = []
        for n, url in enumerate(src["urls"]):
            status, body, headers, err = get(url, f"constitutions/{st}/part_{n:04d}.html")
            if err or status != 200:
                failed += 1
                errors.append(f"{url}: {err or status}")
            else:
                ok += 1
        log({"state": st, "kind": kind, "result": "ok" if ok and not failed else ("partial" if ok else "failed"), "parts": ok,
             "failed": failed, "errors": errors[:5]})
        return
    if kind in ("index", "index2"):
        patterns = src.get("links") or ([src["link"]] + ([src["link2"]] if kind == "index2" else []))
        ok, failed, errors = crawl(st, src.get("starts") or src["url"], patterns, src.get("link2_rewrite"))
        log({"state": st, "kind": kind, "result": "ok" if ok and not failed else ("partial" if ok else "failed"), "parts": ok,
             "failed": failed, "errors": errors[:5]})
        return
    if kind == "al_graphql":
        log({"state": st, "kind": kind, **al_graphql(st, src)})
        return
    if kind == "sd_api":
        log({"state": st, "kind": kind, **sd_api(st, src)})
        return
    log({"state": st, "result": f"unknown kind {kind}"})


def main(argv):
    sources = json.load(open(SOURCES))["states"]
    states = [s.upper() for s in argv] or sorted(sources)
    with ThreadPoolExecutor(10) as pool:
        list(pool.map(lambda st: acquire(st, sources[st]), states))


if __name__ == "__main__":
    main(sys.argv[1:])
