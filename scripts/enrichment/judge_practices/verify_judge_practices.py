"""Verification of the judge_practices stream (run after the crawl, the document stage and the build).

    python3 -I -B scripts/enrichment/judge_practices/verify_judge_practices.py pages  [--n 30] [--seed 1023]
    python3 -I -B scripts/enrichment/judge_practices/verify_judge_practices.py docs   [--n 30] [--seed 1023]
    python3 -I -B scripts/enrichment/judge_practices/verify_judge_practices.py counts
    python3 -I -B scripts/enrichment/judge_practices/verify_judge_practices.py texts  [--n 10] [--seed 1023]

pages   re-fetches random judge pages live (robots.txt and pacing as in the crawl; the stored copy is not touched) and compares: HTTP status,
        SHA-256 of the bytes, and - when the bytes differ - whether the page still parses to the same name, title and documents.
docs    re-downloads random documents live and compares the SHA-256 and size with the document record and with a whole-object readback of the
        stored original in the private bucket.
counts  compares, for every court, the number of judges recorded from each listing page with a second, independent count made directly from the
        stored text of that listing page (a different method from the crawl's parsers); prints every court where they differ.
texts   extracts the text of random stored PDFs again by a different method (pypdf) and compares it with the stored text.
Results are printed as JSON lines plus a summary; failures are counted, never hidden.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import random
import re
import sys
import urllib.parse
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetchlib as fl  # noqa: E402
import parse_lib as pl  # noqa: E402

ROOT = fl.ROOT
COURTS = os.path.join(ROOT, "private", "build", "judge_practices", "courts")
DOCS = os.path.join(ROOT, "private", "build", "judge_practices", "docs")


def load_courts() -> dict[str, dict]:
    return {f[:-5]: json.load(open(os.path.join(COURTS, f), encoding="utf-8")) for f in sorted(os.listdir(COURTS)) if f.endswith(".json")}


def live_get(url: str, kind: str):
    robots = fl.robots_for(url)
    if not robots.allows(url):
        return fl.Result(url=url, blocked="robots", error="robots.txt disallows")
    return fl.get(url, kind, store=False, interval=max(fl.MIN_INTERVAL, robots.delay))


def parse_fields(body: bytes, url: str, level: str, hosts: set[str]) -> dict:
    jp = pl.parse_judge_page(body, url, court_level=level, site_hosts=hosts)
    return {"name": pl.norm_name(jp.name or ""), "title": jp.title_as_published, "docs": sorted(d.url for d in jp.documents)}


# ---------------------------------------------------------------------------------------------------------------------------------- pages
def verify_pages(n: int, seed: int, exclude: set[str]) -> None:
    courts = load_courts()
    pool = []
    for cid, c in courts.items():
        for j in c["judges"]:
            if j.get("status") == 200 and j.get("name") and not j.get("listing_only") and "#" not in j["page_url"] and not j.get("data_url") \
                    and fl.cached_page(j["page_url"]) is not None and fl.pace_key(urllib.parse.urlparse(j["page_url"]).netloc) not in exclude:
                pool.append((cid, j))
    rnd = random.Random(seed)
    sample = rnd.sample(pool, min(n, len(pool)))
    c = Counter()
    for cid, j in sample:
        url = j["page_url"]
        old = fl.cached_page(url)
        r = live_get(url, "page")
        row = {"court": cid, "url": url, "name": j["name"], "status": r.status, "error": r.error, "blocked": r.blocked}
        if not r.ok:
            c["fetch_failed"] += 1
            print(json.dumps(row))
            continue
        row["sha256_stored"] = hashlib.sha256(old).hexdigest()
        row["sha256_live"] = r.sha256
        row["sha256_equal"] = row["sha256_stored"] == row["sha256_live"]
        hosts = {urllib.parse.urlparse(url).netloc.lower()}
        level = courts[cid]["level"]
        a, b = parse_fields(old, url, level, hosts), parse_fields(r.body, url, level, hosts)
        row["parse_equal"] = a == b
        row["name_equal"] = a["name"] == b["name"]
        row["title_equal"] = a["title"] == b["title"]
        row["docs_equal"] = a["docs"] == b["docs"]
        row["recorded_name_on_page"] = pl.norm_name(j["name"]).split()[-1] in pl.norm_name(r.body.decode("utf-8", "replace"))
        c["checked"] += 1
        c["sha256_equal"] += row["sha256_equal"]
        c["parse_equal"] += row["parse_equal"]
        c["name_equal"] += row["name_equal"]
        c["title_equal"] += row["title_equal"]
        c["docs_equal"] += row["docs_equal"]
        c["recorded_name_on_page"] += row["recorded_name_on_page"]
        if not row["parse_equal"]:
            row["diff"] = {"stored": a, "live": b}
        print(json.dumps(row))
    summary = dict(c)
    summary["sample"] = len(sample)
    summary["failures"] = {"fetch_failed": c["fetch_failed"], "name_changed": c["checked"] - c["name_equal"], "title_changed": c["checked"] - c["title_equal"],
                           "documents_changed": c["checked"] - c["docs_equal"], "recorded_name_missing_on_live_page": c["checked"] - c["recorded_name_on_page"]}
    print("SUMMARY", json.dumps(summary))


# ---------------------------------------------------------------------------------------------------------------------------------- docs
def verify_docs(n: int, seed: int, exclude: set[str]) -> None:
    import docstore

    store = docstore.DocStore()
    pool = []
    for f in sorted(os.listdir(DOCS)):
        d = json.load(open(os.path.join(DOCS, f), encoding="utf-8"))
        if d.get("status") == 200 and (d.get("storage") or {}).get("readback_ok") and d.get("sha256") and d.get("kind") != "pagetext" \
                and fl.pace_key(urllib.parse.urlparse(d["url"]).netloc) not in exclude:
            pool.append(d)
    rnd = random.Random(seed)
    sample = rnd.sample(pool, min(n, len(pool)))
    c = Counter()
    for d in sample:
        url = d.get("file_url") or d["url"]
        r = live_get(url, "document")
        row = {"url": url, "status": r.status, "error": r.error, "blocked": r.blocked, "sha256_record": d["sha256"], "bytes_record": d.get("bytes")}
        key = d["storage"]["key"]
        st, sha, size = store.readback(key)
        row.update(bucket_status=st, bucket_sha256=sha, bucket_bytes=size, bucket_equals_record=(sha == d["sha256"] and size == d.get("bytes")))
        c["bucket_equals_record"] += row["bucket_equals_record"]
        if r.ok and r.body:
            row.update(sha256_live=r.sha256, bytes_live=len(r.body), live_equals_record=(r.sha256 == d["sha256"] and len(r.body) == d.get("bytes")))
            c["checked_live"] += 1
            c["live_equals_record"] += row["live_equals_record"]
        else:
            c["fetch_failed"] += 1
        print(json.dumps(row))
    summary = dict(c)
    summary["sample"] = len(sample)
    summary["failures"] = {"fetch_failed": c["fetch_failed"], "live_sha256_or_size_differs": c["checked_live"] - c["live_equals_record"],
                           "bucket_readback_differs": len(sample) - c["bucket_equals_record"]}
    print("SUMMARY", json.dumps(summary))


# ---------------------------------------------------------------------------------------------------------------------------------- counts
INDEP = re.compile(r"(?:\bHon(?:orable|\.)?|\bJudge|\bJudges)\s+((?:[A-Z][\w'’\-]*\.?\s+){0,3}[A-Z][\w'’\-]+(?:,\s*(?:Jr|Sr|II|III|IV)\.?)?)")
INDEP_STOP = re.compile(r"\b(?:court|district|bankruptcy|chambers|procedures?|calendar|information|conduct|opinions?|rules?|orders?|clerk|united|states|"
                        r"magistrate|senior|chief|the|and|for|please|contact|forms?|biograph\w*|hearing|self|scheduled|vacan\w*|judges?)\b", re.I)


def independent_names(body: bytes) -> set[str]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(body, "lxml")
    for t in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        t.decompose()
    root = soup.find("main") or soup.find(attrs={"role": "main"}) or soup.find(id=re.compile("content", re.I)) or soup.body or soup
    text = " ".join(root.get_text(" ").split())
    out = set()
    for m in INDEP.finditer(text):
        nm = m.group(1).strip()
        if INDEP_STOP.search(nm):
            continue
        toks = pl.norm_name(nm).split()
        if len(toks) >= 2:
            out.add(" ".join([toks[0], toks[-1]]))
    return out


def verify_counts() -> None:
    courts = load_courts()
    rows, bad = [], 0
    for cid, c in courts.items():
        if not c["listing_pages"] and not c["judges"]:
            rows.append({"court": cid, "recorded": 0, "independent": None, "note": (c.get("problems") or ["no listing read"])[0][:90]})
            continue
        independent: set[str] = set()
        for lp in c["listing_pages"]:
            if lp.get("status") != 200 or lp.get("kind"):
                continue
            body = fl.cached_page(lp["url"])
            if body:
                independent |= independent_names(body)
        recorded = {}
        for j in c["judges"]:
            if j.get("name") and j.get("status") == 200 and not j.get("former"):
                toks = pl.norm_name(j["name"]).split()
                if len(toks) >= 2:
                    recorded[" ".join([toks[0], toks[-1]])] = j["name"]
        if c["judges"] and any(j.get("data_url") for j in c["judges"]):
            rows.append({"court": cid, "recorded": len(recorded), "independent": None, "note": "judges come from the court's JSON service (no listing text to count)"})
            continue
        only_rec = sorted(set(recorded) - independent)
        only_ind = sorted(independent - set(recorded))
        row = {"court": cid, "recorded": len(recorded), "independent": len(independent), "missed_by_crawl": only_ind[:12], "not_seen_by_independent": only_rec[:12]}
        row["equal"] = not only_ind and not only_rec
        bad += (not row["equal"])
        rows.append(row)
    for r in rows:
        print(json.dumps(r))
    comparable = [r for r in rows if r.get("independent") is not None]
    print("SUMMARY", json.dumps({"courts": len(rows), "comparable": len(comparable), "equal": sum(1 for r in comparable if r["equal"]),
                                 "crawl_misses_names_the_independent_count_sees": sum(1 for r in comparable if r["missed_by_crawl"]),
                                 "crawl_has_names_the_independent_count_does_not_see": sum(1 for r in comparable if r["not_seen_by_independent"])}))


# ---------------------------------------------------------------------------------------------------------------------------------- texts
def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def verify_texts(n: int, seed: int) -> None:
    import docstore
    from pypdf import PdfReader

    store = docstore.DocStore()
    pool = []
    for f in sorted(os.listdir(DOCS)):
        d = json.load(open(os.path.join(DOCS, f), encoding="utf-8"))
        if d.get("status") == 200 and d.get("detected_type") == "pdf" and (d.get("storage") or {}).get("readback_ok") and (d.get("text_chars") or 0) > 500:
            pool.append(d)
    rnd = random.Random(seed)
    sample = rnd.sample(pool, min(n, len(pool)))
    out = []
    for d in sample:
        key = d["storage"]["key"]
        r = store.storage.s.get(store.storage._object_url(key, True), headers=store.storage.h, params={"readback": hashlib.sha1(key.encode()).hexdigest()},
                                timeout=600)
        row = {"url": d["url"], "key": key, "http": r.status_code}
        if r.status_code != 200 or hashlib.sha256(r.content).hexdigest() != d["sha256"]:
            row["error"] = "stored original unreadable or its SHA-256 differs from the record"
            out.append(row)
            print(json.dumps(row))
            continue
        reader = PdfReader(io.BytesIO(r.content))
        second = " ".join((p.extract_text() or "") for p in reader.pages)
        stored = d.get("text") or ""
        w2, w1 = words(second), words(stored)
        cap = min(len(w1), len(w2), 3000)
        s1, s2 = set(w1[:cap * 3]), set(w2[:cap * 3])
        row.update(pages_pdf=len(reader.pages), pages_record=d.get("pages"), words_stored=len(w1), words_second=len(w2),
                   coverage_of_second_in_stored=round(len([w for w in w2[:cap] if w in set(w1)]) / max(1, cap), 3),
                   coverage_of_stored_in_second=round(len([w for w in w1[:cap] if w in set(w2)]) / max(1, cap), 3),
                   stored_starts=" ".join(stored.split())[:120], second_starts=" ".join(second.split())[:120])
        out.append(row)
        print(json.dumps(row))
    ok = [r for r in out if "error" not in r and r["coverage_of_second_in_stored"] >= 0.9 and r["coverage_of_stored_in_second"] >= 0.9]
    print("SUMMARY", json.dumps({"sample": len(out), "agree_at_90_percent_both_ways": len(ok),
                                 "failures": [r["url"] for r in out if r not in ok]}))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["pages", "docs", "counts", "texts"])
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1023)
    ap.add_argument("--exclude-sites", default="", help="comma-separated court site labels (e.g. txs,azd) to leave out while another process is downloading from them")
    a = ap.parse_args()
    ex = set(filter(None, a.exclude_sites.split(",")))
    {"pages": lambda: verify_pages(a.n, a.seed, ex), "docs": lambda: verify_docs(a.n, a.seed, ex), "counts": verify_counts,
     "texts": lambda: verify_texts(a.n, a.seed)}[a.what]()


if __name__ == "__main__":
    main()
