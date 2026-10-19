"""Acquire the North Dakota Century Code from the North Dakota Legislative Branch (official publisher).

Usage: python3 -I -B acquire_nd.py <acq_dir> [--interval 0.5] [--workers 4] [--only t12-1]

1. https://ndlegis.gov/general-information/north-dakota-century-code/index.html: the publisher's full contents,
   one link per section (cencode/t{title}c{chapter}.pdf#nameddest={section}) with the section name.
2. Every chapter PDF it links (https://ndlegis.gov/cencode/t12-1c16.pdf ...), which carries the section text.
Same official sources as open-us-law scripts/state_scrapers/.../nd/statutes/scrapeND.py (Apache-2.0, Vaquill AI).
ndlegis.gov robots.txt disallows only admin, search and similar paths; /cencode/ is allowed.
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

INDEX = "https://ndlegis.gov/general-information/north-dakota-century-code/index.html"
SITE = "https://ndlegis.gov"


def main(acq_dir, interval, workers, only):
    acq = Path(acq_dir)
    manifest_path = acq / "_manifest.jsonl"
    done = fetchlib.load_manifest(manifest_path)
    if INDEX in done and done[INDEX]["status"] == 200:
        html = fetchlib.read_raw(done[INDEX]).decode("utf-8", "replace")
    else:
        status, body = fetchlib.get(INDEX, interval=interval, timeout=300)
        fetchlib.store(manifest_path, acq / "index.html.gz", INDEX, status, body)
        html = body.decode("utf-8", "replace")
    pdfs = list(dict.fromkeys(re.findall(r'href="(/cencode/t[0-9-]+c[0-9a-z-]+\.pdf)', html)))
    if only:
        pdfs = [p for p in pdfs if p.startswith(f"/cencode/{only}c")]
    todo = [p for p in pdfs if not (SITE + p in done and done[SITE + p]["status"] == 200)]
    print("chapter pdfs", len(pdfs), "to fetch", len(todo), flush=True)

    def one(path):
        status, body = fetchlib.get(SITE + path, interval=interval, timeout=180)
        fetchlib.store(manifest_path, acq / "pdf" / (path.rsplit("/", 1)[-1] + ".gz"), SITE + path, status, body)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for count, _ in enumerate(pool.map(one, todo), 1):
            if count % 200 == 0:
                print("fetched", count, flush=True)
    print("done")


if __name__ == "__main__":
    args = sys.argv[1:]
    opt = lambda name, default: args[args.index(name) + 1] if name in args else default  # noqa: E731
    main(args[0], float(opt("--interval", 0.5)), int(opt("--workers", 4)), opt("--only", None))
