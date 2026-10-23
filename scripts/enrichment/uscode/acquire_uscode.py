"""Download the current US Code release point (USLM XML, one zip per title) from the Office of the Law Revision Counsel.

  python3 -I -B scripts/enrichment/uscode/acquire_uscode.py [--release <id>]

Writes private/acq/uscode/<release>/xml_usc<NN>@<release>.zip (unchanged bytes), the download page it read
(gzip), and private/acq/uscode/<release>/release.json (release id, law date, title rows). Every file has a line in
private/acq/uscode/_manifest.jsonl (url, path, sha256, bytes, retrieved_at, status, Last-Modified).
Without --release the current release point named on https://uscode.house.gov/download.html is used.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402
import olrc  # noqa: E402

MANIFEST = fetchlib.ACQ / "_manifest.jsonl"


def fetch_page(url, out):
    entry = fetchlib.fetch_file(url, out, MANIFEST, gzip_body=True)
    with fetchlib.open_raw(out) as handle:
        return handle.read().decode("utf-8"), entry


def acquire(release=None):
    stamp = fetchlib.now()[:10]
    page, page_entry = fetch_page(olrc.BASE + "download.html", fetchlib.ACQ / "pages" / f"download.{stamp}.html.gz")
    current = olrc.parse_current(page)
    if release and release != current["id"]:
        rp_page_url = olrc.BASE + f"download/{release}.html"
        page, page_entry = fetch_page(rp_page_url, fetchlib.ACQ / "pages" / f"{release}.{stamp}.html.gz")
        titles = olrc.parse_title_rows(page, release, base=olrc.BASE + "download/")
        info = {"id": release, "titles": titles}
    else:
        info = current
    rp = info["id"]
    out_dir = fetchlib.ACQ / rp
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for row in info["titles"]:
        url = olrc.title_zip_url(rp, row["key"])
        if row["xml_url"] != url:
            raise SystemExit(f"unexpected zip url {row['xml_url']} (expected {url})")
        entry = fetchlib.fetch_file(url, out_dir / f"xml_usc{row['key']}@{rp}.zip", MANIFEST)
        files.append({**row, "path": entry["path"], "sha256": entry["sha256"], "bytes": entry["bytes"],
                      "last_modified": entry.get("last_modified"), "retrieved_at": entry["retrieved_at"]})
        print(json.dumps({"title": row["key"], "bytes": entry["bytes"], "sha256": entry["sha256"][:16]}), flush=True)
    meta = {k: v for k, v in info.items() if k != "titles"}
    meta.update({"page": page_entry["url"], "page_sha256": page_entry["sha256"], "titles": files,
                 "retrieved_at": fetchlib.now()})
    (out_dir / "release.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps({"release": rp, "titles": len(files), "bytes": sum(f["bytes"] for f in files),
                      "requests": fetchlib.COUNTS}))
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--release")
    acquire(ap.parse_args().release)
