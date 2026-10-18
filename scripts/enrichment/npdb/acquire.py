"""Polite fetcher for NPDB public pages and the Public Use Data File (PUF).

Saves response bytes unchanged under private/acq/npdb/ and appends one line per fetch to
private/acq/npdb/_manifest.jsonl (url, path, sha256, bytes, retrieved_at UTC, http status, method).

Usage:
  python3 -I -B scripts/enrichment/npdb/acquire.py pages            # documentation pages listed in PAGES
  python3 -I -B scripts/enrichment/npdb/acquire.py get URL NAME      # one GET
  python3 -I -B scripts/enrichment/npdb/acquire.py puf FORM.json NAME  # POST the PUF download form (fields in FORM.json)
  python3 -I -B scripts/enrichment/npdb/acquire.py dat                 # Data Analysis Tool "NPDB Practitioners" CSV export (skips files already saved)

Other files in private/acq/npdb/ were fetched with the "get" mode (see _manifest.jsonl): Census state population CSVs,
the BLS CPI-U file and the two compliance-map CSV exports (Tableau "Export CSV" of the public compliance views).

The PUF form is the public, click-through path HRSA offers (contact fields + Data Use Agreement checkbox);
no login, CAPTCHA or paywall is involved. Rate limit: one request per 2 s (robots.txt Crawl-delay for usasearch is 2).
"""
import hashlib
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "npdb")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"
UA_CONTACT = "legal-source-compass research (contact: notreelai@gmail.com)"
BASE = "https://www.npdb.hrsa.gov"
DELAY = 2.0

PAGES = [
    ("/resources/publicData.jsp", "pages/publicData.jsp.raw"),
    ("/resources/publicDataStatement.jsp", "pages/publicDataStatement.jsp.raw"),
    ("/resources/puf/pufFormatBackground.jsp", "pages/pufFormatBackground.jsp.raw"),
    ("/resources/puf/pufFormatSpecifications.jsp", "pages/pufFormatSpecifications.jsp.raw"),
    ("/resources/PublicUseDataFile-Format.pdf", "pages/PublicUseDataFile-Format.pdf"),
    ("/resources/npdbstats/npdbMap.jsp", "pages/npdbMap.jsp.raw"),
    ("/analysistool/", "pages/analysistool.raw"),
    ("/resources/aboutStatData.jsp", "pages/aboutStatData.jsp.raw"),
    ("/resources/definitions.jsp", "pages/definitions.jsp.raw"),
    ("/resources/methods.jsp", "pages/methods.jsp.raw"),
    ("/robots.txt", "pages/robots.txt"),
]

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))
_last = [0.0]


def _sleep():
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()


def fetch(url, rel, data=None, referer=None, method_label=None):
    path = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # BLS asks automated clients for a contact address (same contact the stream contract names for sec.gov).
    agent = UA_CONTACT if "bls.gov" in urllib.parse.urlsplit(url).netloc else UA
    headers = {"User-Agent": agent, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    status, info = None, {}
    for attempt in range(4):
        _sleep()
        request = urllib.request.Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
        digest = hashlib.sha256()
        size = 0
        try:
            with _opener.open(request, timeout=600) as response, open(path + ".part", "wb") as out:
                status = response.status
                info = {"content_type": response.headers.get("Content-Type"), "content_disposition": response.headers.get("Content-Disposition"), "final_url": response.geturl()}
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    digest.update(chunk)
                    size += len(chunk)
                    out.write(chunk)
            os.replace(path + ".part", path)
            break
        except urllib.error.HTTPError as error:
            status = error.code
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 2))
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(2 ** (attempt + 2))
                continue
            raise
    entry = {
        "url": url,
        "path": os.path.relpath(path, ROOT),
        "sha256": digest.hexdigest(),
        "bytes": size,
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "http_status": status,
        "method": method_label or ("POST form" if body is not None else "GET direct"),
        **info,
    }
    with open(MANIFEST, "a") as handle:
        handle.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))
    return entry


def main(argv):
    mode = argv[1] if len(argv) > 1 else "pages"
    if mode == "pages":
        for rel_url, rel in PAGES:
            fetch(BASE + rel_url, rel)
    elif mode == "faqs":
        for n in range(1, 16):
            fetch(f"{BASE}/faqs/puf{n}.jsp", f"pages/faqs/puf{n}.jsp.raw")
    elif mode == "get":
        fetch(argv[2], argv[3])
    elif mode == "dat":
        # Public Tableau CSV export of the Data Analysis Tool's second tab (same data as the page's Export CSV button).
        base = "https://tableau.hdw.hrsa.gov/t/BHW/views/NPDBDataAnalysisTool/"
        for name in ("NPDBPractitioners",):
            if not os.path.exists(os.path.join(ACQ, "dat", name + ".csv")):
                fetch(base + name + ".csv", f"dat/{name}.csv", method_label="GET direct (public Tableau CSV export of the Data Analysis Tool view)")
    elif mode == "puf":
        with open(argv[2]) as handle:
            form = json.load(handle)
        # Load the form page first so the session cookie the servlet expects is set.
        fetch(BASE + "/resources/publicData.jsp", "pages/publicData.session.raw")
        fetch(BASE + "/servlet/PublicUseFileServlet", argv[3], data=form, referer=BASE + "/resources/publicData.jsp",
              method_label="POST public PUF download form (Data Use Agreement accepted)")
    else:
        raise SystemExit("unknown mode " + mode)


if __name__ == "__main__":
    main(sys.argv)
