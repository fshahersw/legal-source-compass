"""Discover the local-rules pages and documents on each federal district and circuit court's own website.

  python3 -I -B scripts/enrichment/court_rules/discover_local_rules.py            # all courts
  python3 -I -B scripts/enrichment/court_rules/discover_local_rules.py cand nysd  # some courts

Court list: current district courts and courts of appeals (CourtListener ids, see COURTS); the website host for each is
taken from uscourts.gov's "Court Website Links" page (saved under federal/uscourts/). For each court the home page is
saved, links whose text or address names local rules are followed one level, and every PDF/DOCX/HTML link that names
rules is written to private/build/court_rules/lookups/local_rules_candidates.json for review. Nothing is chosen here;
the reviewed choice lives in local_rules_sources.json (committed), which acquire_local_rules.py downloads.
"""
from __future__ import annotations

import html as htmlmod
import json
import os
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib  # noqa: E402
from links import page_links  # noqa: E402

LINKS_URL = "https://www.uscourts.gov/about-federal-courts/federal-courts-public/court-website-links"
OUT = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "lookups", "local_rules_candidates.json")

DISTRICTS = (
    "akd almd alnd alsd ared arwd azd cacd caed cand casd cod ctd dcd ded flmd flnd flsd gamd gand gasd gud hid iand "
    "iasd idd ilcd ilnd ilsd innd insd ksd kyed kywd laed lamd lawd mad mdd med mied miwd mnd moed mowd msnd mssd mtd "
    "nced ncmd ncwd ndd ned nhd njd nmd nmid nvd nyed nynd nysd nywd ohnd ohsd oked oknd okwd ord paed pamd pawd prd "
    "rid scd sdd tned tnmd tnwd txed txnd txsd txwd utd vaed vawd vid vtd waed wawd wied wiwd wvnd wvsd wyd"
).split()
CIRCUITS = "ca1 ca2 ca3 ca4 ca5 ca6 ca7 ca8 ca9 ca10 ca11 cadc cafc".split()
COURTS = DISTRICTS + CIRCUITS
# CourtListener ids whose uscourts.gov host label differs (host labels as listed on the Court Website Links page).
HOST_ALIAS = {"ared": "are", "idd": "id", "mowd": "mow", "txsd": "txs"}

RULES_TEXT = re.compile(r"\brules?\b", re.I)
FOLLOW_TEXT = re.compile(r"local rules|rules (and|&) (general )?orders|court rules|rules of (practice|court)|^rules$|"
                         r"local (civil|criminal|appellate|patent|admiralty) rules|circuit rules|rules (and|&) procedures|"
                         r"rules, orders|rules (and|&) operating procedures|internal operating procedures", re.I)
FOLLOW_HREF = re.compile(r"local[-_]?rules|/rules(/|$|-)|rules-orders|rules-and-orders|rules-procedures|circuit-rules|/court-rules", re.I)
DOC_EXT = re.compile(r"\.(pdf|docx?)($|\?)", re.I)


def site_hosts() -> dict[str, str]:
    status, body, _ = fetchlib.fetch(LINKS_URL, "federal/uscourts/court-website-links.html")
    page = body.decode("utf-8", "replace")
    hosts = {}
    for url in re.findall(r'href="(https?://[^"]*uscourts\.gov[^"]*)"', page):
        host = urllib.parse.urlparse(url).netloc.lower()
        m = re.match(r"^(?:www\.)?([a-z0-9]+)\.uscourts\.gov$", host)
        if m:
            hosts.setdefault(m.group(1), host)
    return hosts


def same_site(url: str, host: str) -> bool:
    h = urllib.parse.urlparse(url).netloc.lower()
    return h == host or h.replace("www.", "") == host.replace("www.", "")


def discover(court: str, host: str) -> dict:
    base = f"https://{host}/"
    result = {"court": court, "host": host, "home": base, "followed": [], "documents": [], "errors": []}
    try:
        status, body, hdrs = fetchlib.fetch(base, f"local/{court}/home.html", retries=2, timeout=60)
    except Exception as error:
        result["errors"].append(f"home: {str(error)[:200]}")
        return result
    if status != 200:
        result["errors"].append(f"home: HTTP {status}")
        return result
    final = hdrs.get("X-Final-URL", base)
    home_links = page_links(body.decode("utf-8", "replace"), final)
    follow = []
    for url, text in home_links:
        text = htmlmod.unescape(text)
        if not same_site(url, urllib.parse.urlparse(final).netloc.lower()):
            continue
        if DOC_EXT.search(url) and RULES_TEXT.search(text + " " + url):
            result["documents"].append({"url": url, "text": text, "found_on": final})
        elif (FOLLOW_TEXT.search(text) or FOLLOW_HREF.search(url)) and url not in follow and "#" not in url:
            follow.append(url)
    for url in follow[:6]:
        try:
            status, body, hdrs = fetchlib.fetch(url, f"local/{court}/page_{fetchlib.slug(url, 50)}.html", retries=2, timeout=60)
        except Exception as error:
            result["errors"].append(f"{url}: {str(error)[:160]}")
            continue
        result["followed"].append({"url": url, "status": status})
        if status != 200:
            continue
        ctype = hdrs.get("Content-Type", "")
        if "pdf" in ctype.lower():
            result["documents"].append({"url": url, "text": "(followed link is a PDF)", "found_on": final})
            continue
        for link, text in page_links(body.decode("utf-8", "replace"), hdrs.get("X-Final-URL", url)):
            text = htmlmod.unescape(text)
            if DOC_EXT.search(link) or FOLLOW_HREF.search(link) or re.search(r"local rule|\brule\b", text, re.I):
                if any(d["url"] == link for d in result["documents"]):
                    continue
                result["documents"].append({"url": link, "text": text[:160], "found_on": url})
    return result


def main(argv):
    hosts = site_hosts()
    courts = argv or COURTS
    jobs = []
    missing = []
    for court in courts:
        host = hosts.get(court) or hosts.get(HOST_ALIAS.get(court, ""))
        if not host:
            missing.append(court)
            continue
        jobs.append((court, host))
    with ThreadPoolExecutor(12) as pool:
        results = list(pool.map(lambda j: discover(*j), jobs))
    existing = {}
    if os.path.exists(OUT) and argv:
        existing = {r["court"]: r for r in json.load(open(OUT))["courts"]}
    for r in results:
        existing[r["court"]] = r
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump({"generated_at": fetchlib.utc_now(), "links_page": LINKS_URL, "missing_host": missing,
                   "courts": [existing[c] for c in sorted(existing)]}, handle, indent=1)
    print(json.dumps({"courts": len(results), "missing_host": missing,
                      "with_documents": sum(1 for r in results if r["documents"]),
                      "errors": {r["court"]: r["errors"] for r in results if r["errors"]}}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
