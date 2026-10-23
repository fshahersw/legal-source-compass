"""Copy stored court pages into fixtures/ for the offline parser tests.

Each fixture is a page body as the court published it, reduced for size and privacy: <script>, <style>, <svg>, <noscript> and comments are
removed, inline data images are dropped, e-mail addresses become chambers@example.invalid and telephone numbers (000) 000-0000. Nothing else
is edited. fixtures/INDEX.json records each fixture's source URL, retrieval time (from the request manifest) and the original SHA-256.

    python3 -I -B scripts/enrichment/judge_practices/make_fixtures.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetchlib as fl  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures")

# name -> url (all fetched by crawl_courts.py; names say which court and kind of page)
PAGES = {
    "nysd_listing_district.html": "https://www.nysd.uscourts.gov/judges/district-judges",
    "nysd_judge_liman.html": "https://www.nysd.uscourts.gov/hon-lewis-j-liman",
    "nysd_judge_parker_magistrate.html": "https://www.nysd.uscourts.gov/hon-katharine-h-parker",
    "cand_listing.html": "https://www.cand.uscourts.gov/judges",
    "cand_judge_ygr.html": "https://www.cand.uscourts.gov/judges/ygr/gonzalez-rogers-yvonne",
    "alsd_listing.html": "https://www.alsd.uscourts.gov/judges-information",
    "alsd_judge_dubose.html": "https://www.alsd.uscourts.gov/judges/us-district-judge-kristi-k-dubose",
    "kyed_listing_table.html": "https://www.kyed.uscourts.gov/judges",
    "cod_listing.html": "http://www.cod.uscourts.gov/JudicialOfficers.aspx",
    "cod_judge_domenico.html": "http://www.cod.uscourts.gov/JudicialOfficers/ActiveArticleIIIJudges/HonDanielDDomenico.aspx",
}
EXTRA = os.path.join(HERE, "fixture_pages.json")  # optional: more {name: url} added while triaging courts

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
PHONE = re.compile(r"(?<![\d\-])(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]\s?\d{3}[\s.\-]\d{4}\b")


def reduce(body: bytes) -> bytes:
    t = body.decode("utf-8", "replace")
    t = re.sub(r"<(script|style|svg|noscript)\b[^>]*>.*?</\1>", "", t, flags=re.S | re.I)
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', "", t, flags=re.I)
    t = re.sub(r'(src|href)="data:[^"]*"', r'\1=""', t)
    t = EMAIL.sub("chambers@example.invalid", t)
    t = PHONE.sub("(000) 000-0000", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.encode("utf-8")


def main() -> None:
    pages = dict(PAGES)
    if os.path.exists(EXTRA):
        pages.update(json.load(open(EXTRA, encoding="utf-8")))
    manifest = fl.load_manifest_index()
    os.makedirs(FIXTURES, exist_ok=True)
    index = {}
    for name, url in sorted(pages.items()):
        body = fl.cached_page(url)
        if body is None:
            print("missing from the page store:", url)
            continue
        out = reduce(body)
        with open(os.path.join(FIXTURES, name), "wb") as h:
            h.write(out)
        m = manifest.get(url, {})
        index[name] = {"url": url, "retrieved_at": m.get("retrieved_at"), "original_sha256": hashlib.sha256(body).hexdigest(),
                       "original_bytes": len(body), "fixture_bytes": len(out)}
        print(f"{name:40} {len(body):>8} -> {len(out):>8}")
    with open(os.path.join(FIXTURES, "INDEX.json"), "w", encoding="utf-8") as h:
        json.dump(index, h, indent=1, sort_keys=True)
        h.write("\n")


if __name__ == "__main__":
    main()
