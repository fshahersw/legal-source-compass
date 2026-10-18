"""Acquire raw EPA ECHO files for the epa_echo stream into private/acq/epa_echo/ (bytes unchanged).

Each fetch appends one line to private/acq/epa_echo/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at (UTC), http_status, method}

Usage:
  python3 -I -B scripts/enrichment/epa_echo/acquire.py <name> [<name> ...]
  python3 -I -B scripts/enrichment/epa_echo/acquire.py url <url> <relative/dest/path>
  python3 -I -B scripts/enrichment/epa_echo/acquire.py case_reports <case number> [...]

Named targets are listed in TARGETS. Rate-limited (>= 0.6 s between requests to a host), retried with backoff.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "epa_echo")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"

TARGETS = {
    # Landing pages (HTML, kept for link discovery and file-date provenance)
    "page_downloads": ("https://echo.epa.gov/tools/data-downloads", "pages/data-downloads.html"),
    "page_fec_summary": ("https://echo.epa.gov/tools/data-downloads/icis-fec-download-summary", "pages/icis-fec-download-summary.html"),
    "exporter_columns": ("https://echo.epa.gov/system/files/echo_exporter_columns_7-16-2025_0.xlsx", "echo_exporter_columns_7-16-2025_0.xlsx"),
    "page_echo_faq": ("https://echo.epa.gov/resources/general-info/echo-faq", "pages/echo-faq.html"),
    "page_epa_disclaimers": ("https://www.epa.gov/web-policies-and-procedures/epa-disclaimers", "pages/epa-disclaimers.html"),
    # ICIS FE&C enforcement case files (cases, penalties, defendants, violations, facilities, milestones)
    "case_zip": ("https://echo.epa.gov/files/echodownloads/case_downloads.zip", "case_downloads.zip"),
    # ECHO Exporter (one row per facility, program flags, formal actions, SNC/HPV status)
    "exporter_zip": ("https://echo.epa.gov/files/echodownloads/echo_exporter.zip", "echo_exporter.zip"),
    # Census Vintage 2025 state population (denominator for per-capita figures)
    "census_states": ("https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv", "census/NST-EST2025-ALLDATA.csv"),
}

CASE_REPORT_URL = "https://echodata.epa.gov/echo/case_rest_services.get_case_report?p_id={}&output=JSON"

_last = {}


def _wait(host):
    gap = time.time() - _last.get(host, 0)
    if gap < 0.6:
        time.sleep(0.6 - gap)
    _last[host] = time.time()


def fetch(url, rel, timeout=1800):
    dest = os.path.join(ACQ, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    host = urllib.request.urlparse(url).netloc
    status = None
    for attempt in range(5):
        _wait(host)
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            digest = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(request, timeout=timeout) as response, open(tmp, "wb") as out:
                status = response.status
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    digest.update(chunk)
                    size += len(chunk)
                    out.write(chunk)
            os.replace(tmp, dest)
            entry = {
                "url": url,
                "path": os.path.relpath(dest, ROOT),
                "sha256": digest.hexdigest(),
                "bytes": size,
                "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "http_status": status,
                "method": "direct HTTPS GET (urllib, User-Agent: %s)" % UA,
            }
            with open(MANIFEST, "a") as manifest:
                manifest.write(json.dumps(entry) + "\n")
            print(json.dumps(entry), flush=True)
            return entry
        except urllib.error.HTTPError as error:
            status = error.code
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
            print("retry", url, error.code, flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == 4:
                raise
            print("retry", url, error, flush=True)
        time.sleep(2 ** attempt * 3)


def main(argv):
    os.makedirs(ACQ, exist_ok=True)
    if argv[:1] == ["url"]:
        fetch(argv[1], argv[2])
        return
    if argv[:1] == ["case_reports"]:
        # ECHO case report REST service (official), one JSON per case number, for spot checks
        for number in argv[1:]:
            fetch(CASE_REPORT_URL.format(number), f"case_reports/{number}.json", timeout=120)
        return
    for name in argv:
        url, rel = TARGETS[name]
        fetch(url, rel)


if __name__ == "__main__":
    main(sys.argv[1:])
