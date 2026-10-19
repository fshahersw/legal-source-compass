"""Fetch the home page of every federal court website listed on uscourts.gov's "Court Website Links" page.

The uscourts.gov Federal Court Finder is disallowed for crawlers in robots.txt, so addresses come from each court's own site.
One GET per court home page (robots.txt honoured per host, < 2 requests/second per host, identifying User-Agent); bodies are kept
unchanged under private/acq/court_locations/sites/<host>/ and recorded in _manifest.jsonl. A second pass may fetch one linked
location/contact page per court (--contact), chosen by link text on the home page.

    python3 -I -B scripts/enrichment/court_locations/fetch_sites.py [--contact]
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetchlib  # noqa: E402

LINKS = os.path.join(fetchlib.ACQ, "uscourts", "court-website-links.html")
# National courts not listed on the Court Website Links page (their own official sites).
EXTRA = [("https://www.cit.uscourts.gov/", "Court of International Trade"), ("https://www.uscfc.uscourts.gov/", "Court of Federal Claims"),
         ("https://www.jpml.uscourts.gov/", "Judicial Panel on Multidistrict Litigation"), ("https://www.supremecourt.gov/", "Supreme Court of the United States")]
CONTACT_TEXT = re.compile(r"^(court )?(locations?|contact( us)?|courthouses?|clerk'?s? office locations?|office locations?|addresses|directions|hours (and|&) locations?|locations (and|&) hours)$", re.I)


def court_sites() -> list[tuple[str, str]]:
    page = open(LINKS, encoding="utf-8").read()
    seen, out = set(), []
    for url, label in re.findall(r'<a[^>]+href="(https?://[^"]*uscourts\.gov[^"]*)"[^>]*>(.*?)</a>', page, re.S):
        host = urllib.parse.urlparse(url).netloc.lower()
        if host in seen or not re.match(r"^(www\.)?[a-z0-9]+\.uscourts\.gov$", host) or host in ("www.uscourts.gov", "pacer.uscourts.gov"):
            continue
        seen.add(host)
        text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", label)).split())
        if re.search(r"prob(ation)?\s*/\s*pretrial|pretrial services|probation office", text, re.I):
            continue  # probation and pretrial offices are not courts
        out.append((f"https://{host}/", text))
    for url, text in EXTRA:
        if urllib.parse.urlparse(url).netloc not in seen:
            out.append((url, text))
    return out


def get(url: str, rel: str):
    try:
        status, body, hdrs = fetchlib.fetch(url, rel, retries=2, timeout=45)
        return {"url": url, "status": status, "final_url": hdrs.get("X-Final-URL"), "bytes": len(body)}
    except PermissionError as e:
        return {"url": url, "status": None, "error": f"robots: {e}"}
    except Exception as e:  # noqa: BLE001 - recorded, not raised: one court's outage must not stop the others
        return {"url": url, "status": None, "error": str(e)[:200]}


def contact_link(home_html: str, base: str) -> str | None:
    for href, label in re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', home_html, re.S):
        text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", label)).split())
        if CONTACT_TEXT.match(text):
            url = urllib.parse.urljoin(base, href)
            if urllib.parse.urlparse(url).netloc == urllib.parse.urlparse(base).netloc:
                return url
    return None


LOCATION_TEXT = re.compile(r"^(court locations?(/district map| and entry requirements)?|locations?( and| &) hours|office locations?( and| &) hours|"
                           r"(court|clerk'?s?) ?(office )?locator|clerks? offices?|clerk'?s office information|visitors|find a location|"
                           r"(seattle|tacoma|spokane|providence)[a-z ]*courthouse|court location|locations?)$", re.I)


def location_links(home_html: str, base: str, have: set[str]) -> list[str]:
    out = []
    for href, label in re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', home_html, re.S):
        text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", label)).split())
        url = urllib.parse.urljoin(base, href)
        if LOCATION_TEXT.match(text) and urllib.parse.urlparse(url).netloc == urllib.parse.urlparse(base).netloc and url not in have and url not in out:
            out.append(url)
    return out[:3]


def main(argv):
    sites = court_sites()
    log_path = os.path.join(fetchlib.ACQ, "sites_log.jsonl")
    if "--locations" in argv:
        # third pass, only for sites where no address was found yet: up to three pages named as locations/visitor pages
        import locations_lib as ll

        done = {json.loads(l)["url"] for l in open(fetchlib.MANIFEST, encoding="utf-8") if '"http_status": 200' in l}
        jobs = []
        for url, label in sites:
            host = urllib.parse.urlparse(url).netloc
            folder = os.path.join(fetchlib.ACQ, "sites", host)
            files = [os.path.join(folder, f) for f in os.listdir(folder)] if os.path.isdir(folder) else []
            if not files or any(ll.find_addresses(ll.page_lines(open(f, encoding="utf-8", errors="replace").read())) for f in files):
                continue
            home = os.path.join(folder, "index.html")
            if os.path.exists(home):
                for link in location_links(open(home, encoding="utf-8", errors="replace").read(), url, done):
                    jobs.append((link, f"sites/{host}/loc_{fetchlib.slug(link)}.html", host))
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda j: {**get(j[0], j[1]), "host": j[2], "kind": "locations"}, jobs))
    elif "--contact" in argv:
        jobs = []
        for url, label in sites:
            host = urllib.parse.urlparse(url).netloc
            home = os.path.join(fetchlib.ACQ, "sites", host, "index.html")
            if not os.path.exists(home):
                continue
            link = contact_link(open(home, encoding="utf-8", errors="replace").read(), url)
            if link:
                jobs.append((link, f"sites/{host}/contact_{fetchlib.slug(link)}.html", host))
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda j: {**get(j[0], j[1]), "host": j[2], "kind": "contact"}, jobs))
    else:
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda s: {**get(s[0], f"sites/{urllib.parse.urlparse(s[0]).netloc}/index.html"),
                                               "label": s[1], "kind": "home"}, sites))
    with open(log_path, "a", encoding="utf-8") as h:
        for r in results:
            h.write(json.dumps(r, sort_keys=True) + "\n")
    ok = sum(1 for r in results if r.get("status") == 200)
    print(f"{len(results)} requested, {ok} ok")
    for r in results:
        if r.get("status") != 200:
            print("  ", r.get("url"), r.get("status"), r.get("error", "")[:120])


if __name__ == "__main__":
    main(sys.argv[1:])
