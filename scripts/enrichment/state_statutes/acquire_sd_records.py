"""Fetch the publisher's single-statute record for every section the SD sitemap lists that has no section document
in the whole-title responses (mostly repealed or transferred entries printed only as a catchline):
acquire_sd_records.py <acq_dir> [--interval 0.6].

Endpoint: https://sdlegislature.gov/api/Statutes/Statute/{number} (JSON: Statute, Type, CatchLine, Html).
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402
import parse_sd  # noqa: E402

SECTION = re.compile(r"^\d+[A-Z]?-\d+[A-Z]*-\d+[A-Za-z]*(?:\.\d+[A-Za-z]*)*(?:\([0-9A-Za-z]{1,4}\))*$")


def missing_numbers(manifest):
    sitemap, documented = [], set()
    for url, entry in sorted(manifest.items()):
        if re.search(r"/Statutes\.\d+\.xml$", url):
            for loc in re.findall(r"<loc>([^<]+)</loc>", fetchlib.read_raw(entry).decode("utf-8")):
                number = loc.rsplit("/Statutes/", 1)[-1]
                if SECTION.match(number):
                    sitemap.append(number)
        elif url.endswith(".html?all=true"):
            documented.update(s["number"] for s in parse_sd.parse_title(fetchlib.read_raw(entry))["sections"])
    return [n for n in dict.fromkeys(sitemap) if n not in documented]


def main(acq_dir, interval):
    acq = Path(acq_dir)
    manifest_path = acq / "_manifest.jsonl"
    manifest = fetchlib.load_manifest(manifest_path)
    need = missing_numbers(manifest)
    print("sitemap sections without a section document:", len(need), flush=True)
    todo = [n for n in need if not (f"{parse_sd.SITE}/api/Statutes/Statute/{n}" in manifest
                                    and manifest[f"{parse_sd.SITE}/api/Statutes/Statute/{n}"]["status"] in (200, 404))]
    print("still to fetch:", len(todo), flush=True)

    def one(number):
        url = f"{parse_sd.SITE}/api/Statutes/Statute/{number}"
        status, body = fetchlib.get(url, interval=interval)
        safe = re.sub(r"[^0-9A-Za-z.\-]", "_", number)
        fetchlib.store(manifest_path, acq / "records" / f"{safe}.json.gz", url, status, body)

    # Up to 4 connections (each answer takes ~2 s); request starts are spaced `interval` apart per host, so the
    # rate stays <= 2 per second at 0.5 s.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for count, _ in enumerate(pool.map(one, todo), 1):
            if count % 250 == 0:
                print("fetched", count, flush=True)
    print("done, fetched", len(todo))


if __name__ == "__main__":
    args = sys.argv[1:]
    interval = float(args[args.index("--interval") + 1]) if "--interval" in args else 0.6
    main(args[0], interval)
