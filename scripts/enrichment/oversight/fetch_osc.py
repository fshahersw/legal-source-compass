"""Harvest the U.S. Office of Special Counsel (osc.gov) publications.

  python3 -I -B scripts/enrichment/oversight/fetch_osc.py [--skip-fragments]

osc.gov has no robots.txt (404) and no terms restricting reading of public pages; requests are paced at one per 1.1 s
with a descriptive User-Agent. What is read:
  * resource list pages (reports, testimonies, Hatch Act advisory opinions): raw HTML, unchanged
  * the site's own public search index (Pagefind static files): the case (whistleblower public file) and
    press-release fragments, unchanged
All raw bytes go to private/acq/oversight/osc/ and are recorded in the manifest. Re-running skips files on disk.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402
import pagefind as pf  # noqa: E402

BASE = "https://www.osc.gov"
OSC = os.path.join(cm.ACQ, "osc")
PAGES = {
    "reports": "/resources/reports/",
    "testimonies": "/resources/testimonies/",
    "advisory_opinions": "/services/hatch-act/advisoryopinion/",
    "cases_index": "/cases/",
    "news_index": "/news/",
}


def get_raw(fetcher, url, dest):
    """Fetch url once (skip when dest exists); store bytes unchanged; return the bytes."""
    if os.path.exists(dest):
        with open(dest, "rb") as handle:
            return handle.read()
    status, body, _, _ = fetcher.get(url)
    if status != 200:
        raise SystemExit(f"{url}: HTTP {status}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "wb") as handle:
        handle.write(body)
    os.replace(tmp, dest)
    cm.record_manifest(url, dest, body, status, "direct GET (public page / static search-index file)")
    return body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-fragments", action="store_true")
    args = parser.parse_args()
    fetcher = cm.Fetcher()
    for name, path in PAGES.items():
        get_raw(fetcher, BASE + path, os.path.join(OSC, "pages", f"{name}.html"))
    entry = get_raw(fetcher, f"{BASE}/pagefind/pagefind-entry.json", os.path.join(OSC, "pagefind", "pagefind-entry.json"))
    index_hash = pf.parse_entry(entry)
    meta_raw = get_raw(fetcher, f"{BASE}/pagefind/pagefind.{index_hash}.pf_meta", os.path.join(OSC, "pagefind", f"{index_hash}.pf_meta"))
    meta = pf.parse_meta(meta_raw)
    ct_hash = meta["filters"]["content-type"]
    ct_raw = get_raw(fetcher, f"{BASE}/pagefind/filter/{ct_hash}.pf_filter", os.path.join(OSC, "pagefind", f"{ct_hash}.pf_filter"))
    content_type = pf.parse_filter(ct_raw)
    sizes = {k: len(v) for k, v in content_type["values"].items()}
    cm.log("fetch_osc", f"index {index_hash}: {len(meta['pages'])} pages; content-type values {sizes}")
    if args.skip_fragments:
        return
    done = 0
    for value in ("case", "press-release"):
        hashes = pf.case_page_hashes(meta, content_type, value)
        for h in hashes:
            get_raw(fetcher, f"{BASE}/pagefind/fragment/{h}.pf_fragment", os.path.join(OSC, "fragments", f"{h}.pf_fragment"))
            done += 1
            if done % 100 == 0:
                cm.log("fetch_osc", f"fragments {done} ({value}) stats {fetcher.stats}")
    cm.log("fetch_osc", f"done: {done} fragments; stats {fetcher.stats}")
    print(f"fragments: {done}; stats {fetcher.stats}")


if __name__ == "__main__":
    main()
