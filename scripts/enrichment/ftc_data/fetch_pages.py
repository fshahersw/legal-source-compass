"""Fetch ftc.gov HTML pages and data files directly (robots.txt allows them; Crawl-delay 5 s is observed).

  python3 -I -B fetch_pages.py NAME URL [NAME URL ...]

Raw bytes are stored unchanged, gzip-compressed, under private/acq/ftc_data/pages/<NAME>.gz (or files/<NAME> for data
files whose name ends in .csv/.xlsx/.zip/.xls: stored as served) and recorded in _manifest.jsonl. A URL already in the
manifest with status 200 is skipped. Nothing here uses a key.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ftc_http as fh  # noqa: E402

DATA_EXT = (".csv", ".xlsx", ".xls", ".zip", ".pdf")


def already(url):
    if not os.path.exists(fh.MANIFEST):
        return None
    import json

    found = None
    with open(fh.MANIFEST, encoding="utf-8") as handle:
        for line in handle:
            entry = json.loads(line)
            if entry["url"] == url and entry.get("status") == 200 and entry.get("path"):
                found = entry
    return found


def fetch(fetcher, name, url):
    prior = already(url)
    if prior and os.path.exists(os.path.join(fh.ROOT, prior["path"])):
        print("skip (have)", url)
        return prior
    is_data = name.lower().endswith(DATA_EXT)
    path = os.path.join(fh.ACQ, "files" if is_data else "pages", name if is_data else name + ".gz")
    entry, resp = fetcher.fetch_to_file(url, path, "direct GET (urllib), robots.txt Crawl-delay observed", gz=not is_data)
    print(entry["status"], entry["bytes"], url)
    return entry


def main(argv):
    fetcher = fh.Fetcher()
    if len(argv) % 2:
        raise SystemExit("usage: NAME URL pairs")
    for i in range(0, len(argv), 2):
        fetch(fetcher, argv[i], argv[i + 1])


if __name__ == "__main__":
    main(sys.argv[1:])
