"""Acquire the Revised Code of Washington from the Washington State Legislature (Office of the Code Reviser).

Usage: python3 -I -B acquire_wa.py <acq_dir> [--titles 9A,28A] [--interval 0.5]

1. https://app.leg.wa.gov/RCW/default.aspx            the RCW title list (publisher's table of contents)
2. https://app.leg.wa.gov/RCW/default.aspx?Cite={title}  each title's chapter list
3. https://app.leg.wa.gov/RCW/default.aspx?cite={chapter}&full=true   each chapter with every section's text
Same official surface as open-us-law scripts/state_scrapers/.../wa/statutes/scrapeWA.py (Apache-2.0, Vaquill AI),
which walks title -> chapter -> section; here one full-chapter page replaces the per-section requests.
app.leg.wa.gov serves no robots.txt (404), so no path is disallowed.
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

BASE = "https://app.leg.wa.gov/RCW/default.aspx"


def cites(html, pattern):
    return list(dict.fromkeys(m.group(1) for m in re.finditer(r"[?&][Cc]ite=(" + pattern + r")(?=['\"&#])", html)))


def fetch(acq, manifest_path, done, url, name, interval):
    if url in done and done[url]["status"] == 200 and Path(done[url]["path"]).exists():
        return fetchlib.read_raw(done[url]).decode("utf-8", "replace")
    status, body = fetchlib.get(url, interval=interval, timeout=180)
    entry = fetchlib.store(manifest_path, acq / name, url, status, body)
    done[url] = entry
    if status != 200:
        raise RuntimeError(f"{url}: HTTP {status}")
    return body.decode("utf-8", "replace")


def main(acq_dir, only_titles, interval):
    acq = Path(acq_dir)
    manifest_path = acq / "_manifest.jsonl"
    done = fetchlib.load_manifest(manifest_path)
    toc = fetch(acq, manifest_path, done, BASE, "toc/titles.html.gz", interval)
    titles = cites(toc, r"\d+[A-Z]?")
    print("titles", len(titles), " ".join(titles), flush=True)
    for title in titles:
        if only_titles and title not in only_titles:
            continue
        page = fetch(acq, manifest_path, done, f"{BASE}?Cite={title}", f"titles/{title}.html.gz", interval)
        chapters = cites(page, re.escape(title) + r"\.\d+[A-Z]?")
        print(f"title {title}: chapters {len(chapters)}", flush=True)
        # Up to 4 connections (the host answers in ~3 s), but request starts are spaced `interval` apart for the
        # host (fetchlib), so the rate stays <= 1 / interval requests per second (2 per second at 0.5 s).
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda c: fetch(acq, manifest_path, done, f"{BASE}?cite={c}&full=true", f"chapters/{c}.html.gz", interval), chapters))


if __name__ == "__main__":
    args = sys.argv[1:]
    only = set(args[args.index("--titles") + 1].split(",")) if "--titles" in args else None
    interval = float(args[args.index("--interval") + 1]) if "--interval" in args else 0.5
    main(args[0], only, interval)
