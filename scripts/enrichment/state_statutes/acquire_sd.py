"""Acquire the South Dakota Codified Laws from the South Dakota Legislature (official publisher).

Usage: python3 -I -B acquire_sd.py <acq_dir>

1. The official statutes sitemap (https://sdlegislature.gov/Statutes.xml and its parts) = the publisher's own
   table of contents: every title, chapter and section URL it publishes.
2. One whole-title document per title: https://sdlegislature.gov/api/Statutes/{title}.html?all=true
   (chapter contents plus every section's catchline, text and Source note).

Approach adapted from open-us-law scripts/statutes/sd_bulk/client.py (Apache-2.0, Vaquill AI): one whole-title
request per title, titles enumerated including the letter-suffixed titles (23A, 29A, 57A...). Here the title
list comes from the official sitemap instead of probing labels. None of open-us-law's bundled data is used.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

SITE = "https://sdlegislature.gov"
LOC = re.compile(r"<loc>([^<]+)</loc>")


def main(acq_dir):
    acq = Path(acq_dir)
    manifest = acq / "_manifest.jsonl"
    done = fetchlib.load_manifest(manifest)
    index_url = f"{SITE}/Statutes.xml"
    status, body = fetchlib.get(index_url)
    fetchlib.store(manifest, acq / "sitemap" / "Statutes.xml.gz", index_url, status, body)
    urls = []
    for part in LOC.findall(body.decode("utf-8")):
        status, part_body = fetchlib.get(part)
        name = part.rsplit("/", 1)[-1]
        fetchlib.store(manifest, acq / "sitemap" / f"{name}.gz", part, status, part_body)
        urls.extend(LOC.findall(part_body.decode("utf-8")))
    titles = sorted(
        {m.group(1) for u in urls if (m := re.fullmatch(re.escape(SITE) + r"/Statutes/(\d+[A-Z]?)", u))},
        key=lambda t: (int(re.match(r"\d+", t).group()), t),
    )
    print(f"sitemap urls={len(urls)} titles={len(titles)}: {' '.join(titles)}")
    for label in titles:
        url = f"{SITE}/api/Statutes/{label}.html?all=true"
        if url in done and done[url]["status"] == 200:
            continue
        status, raw = fetchlib.get(url, interval=1.5, timeout=300)
        entry = fetchlib.store(manifest, acq / "titles" / f"{label}.html.gz", url, status, raw)
        print(f"title {label}: status={status} bytes={entry['bytes']} stored={entry['stored_bytes']}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
