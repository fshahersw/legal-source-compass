"""Acquire every letter in FDA's current warning-letter table on FDA.gov (letters posted from 2021), raw bytes unchanged.

Usage: python -I -B scripts/enrichment/fda_warning_letters/fetch_warning_letters.py [--acq DIR]

The warning-letter page (FDA_WARNINGS) renders a server-side DataTable. Its Drupal settings name the AJAX view
(warning_letter_solr_index) and the total row count. This fetcher reads those settings from the page, then reads the
whole table 100 rows at a time, newest posted date first, and writes every response body unchanged to
<acq>/raw/warning_letters/page_<start>.json with a manifest (url, sha256, bytes, retrieved_at, http status).
If the posted-date order leaves a gap (ties shift between pages), it reads the table a second time in ascending
order; the builder unions both passes on the letter URL and checks the union against the table total.

Only www.fda.gov is contacted (no openFDA quota is used). One request every PAUSE seconds.
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import wl_parse as wp  # noqa: E402

ROOT = HERE.parents[2]
USER_AGENT = "LegalSourceAtlas/1.0 (legal-source-compass research)"
PAUSE = 2.0
PAGE = 100


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/html"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            return err.code, err.read()
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"no response for {url}")


def save(out, name, url, status, body, manifest):
    path = out / name
    path.write_bytes(body)
    manifest.append({
        "file": name, "url": url, "http_status": status, "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def page_url(ajax, start, direction):
    params = {key: str(value) for key, value in ajax["data"].items()}
    params.update({"draw": "1", "start": str(start), "length": str(PAGE), "order[0][column]": "0", "order[0][dir]": direction})
    return "https://www.fda.gov" + ajax["url"] + "?" + urllib.parse.urlencode(params)


def read_pass(out, ajax, total, direction, manifest):
    seen = set()
    for start in range(0, total, PAGE):
        url = page_url(ajax, start, direction)
        status, body = get(url)
        save(out, f"page_{direction}_{start:05d}.json", url, status, body, manifest)
        if status != 200:
            raise SystemExit(f"HTTP {status} at start={start}")
        doc = json.loads(body)
        if doc.get("recordsFiltered") != total:
            raise SystemExit(f"table total changed during the read: {doc.get('recordsFiltered')} != {total}")
        for row in wp.parse_rows(doc):
            seen.add(row["path"])
        print(direction, start, len(seen), file=sys.stderr)
        time.sleep(PAUSE)
    return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--acq", default=str(ROOT / "private" / "acq" / "de-fda-exact"))
    args = ap.parse_args()
    out = Path(args.acq) / "raw" / "warning_letters"
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    status, body = get(wp.FDA_WARNINGS)
    save(out, "index.html", wp.FDA_WARNINGS, status, body, manifest)
    if status != 200:
        raise SystemExit(f"HTTP {status} for the index page")
    ajax, total = wp.table_settings(body.decode("utf-8"))
    time.sleep(PAUSE)
    seen = read_pass(out, ajax, total, "desc", manifest)
    passes = ["desc"]
    if len(seen) < total:
        seen |= read_pass(out, ajax, total, "asc", manifest)
        passes.append("asc")
    summary = {
        "schema_version": "fda-warning-letter-index-acquisition/1",
        "source": wp.FDA_WARNINGS,
        "view_name": ajax["data"].get("view_name"),
        "table_total": total,
        "distinct_letters_read": len(seen),
        "passes": passes,
        "files": manifest,
    }
    (out / "manifest.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "files"}))


if __name__ == "__main__":
    main()
