"""Deliberate, one-time downloads from fjc.gov for the judiciary stream (owner permission of 2026-10-22).

Rules applied: each file is fetched once (a stored file is never re-requested), strictly one request at a time, at least
35 s between any two requests to fjc.gov (the gap is persisted across processes by fetchlib), never in parallel, no
crawling: only the exact URLs listed here. Before any file over 100 MB the free space on /home/user is checked and the
download is skipped if less than 3 GB would remain.

  python3 -I -B acquire_fjc.py pages        IDB landing pages for the three datasets + the three codebooks
  python3 -I -B acquire_fjc.py appeals      ap08on_0.zip   (about 34 MB)
  python3 -I -B acquire_fjc.py criminal     cr96on.zip     (about 242 MB)
  python3 -I -B acquire_fjc.py bankruptcy   cpbank18on.zip and cpbank08to17.zip (about 846 MB and 1,404 MB)
  python3 -I -B acquire_fjc.py bio          Biographical Directory category file other-nominations-recess.csv
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

IDB = "https://www.fjc.gov/sites/default/files/idb"
PAGES = [
    ("idb_pages", "https://www.fjc.gov/research/idb/appellate-cases-filed-terminated-and-pending-fy-2008-present"),
    ("idb_pages", "https://www.fjc.gov/research/idb/criminal-defendants-filed-terminated-and-pending-fy-1996-present"),
    ("idb_pages", "https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present"),
    ("codebooks", IDB + "/codebooks/Appeals%20Codebook%202008%20Forward%20rev%2002102021.pdf"),
    ("codebooks", IDB + "/codebooks/Criminal%20Code%20Book%201996%20Forward.pdf"),
    ("codebooks", IDB + "/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf"),
]
FILES = {
    "appeals": [(IDB + "/textfiles/ap08on_0.zip", "ap08on_0.zip", 40)],
    "criminal": [(IDB + "/textfiles/cr96on.zip", "cr96on.zip", 260)],
    "bankruptcy": [(IDB + "/textfiles/cpbank18on.zip", "cpbank18on.zip", 900), (IDB + "/textfiles/cpbank08to17.zip", "cpbank08to17.zip", 1500)],
}
BIO = [("fjc_bio", "https://www.fjc.gov/sites/default/files/history/other-nominations-recess.csv")]
FLOOR_GB = 3.0


def free_gb() -> float:
    return shutil.disk_usage("/home/user").free / 1e9


def main(step: str) -> None:
    if step == "pages":
        for subdir, url in PAGES:
            status, body, path = fl.fetch(url, subdir, gz=not url.endswith(".pdf"), method="direct urllib GET (FJC permission 2026-10-22, single deliberate request)")
            print(json.dumps({"url": url, "status": status, "bytes": len(body), "path": str(path) if path else None}))
        return
    if step == "bio":
        for subdir, url in BIO:
            status, body, path = fl.fetch(url, subdir, gz=False, method="direct urllib GET (FJC Biographical Directory export, single request)")
            print(json.dumps({"url": url, "status": status, "bytes": len(body), "path": str(path) if path else None}))
        return
    for url, name, approx_mb in FILES[step]:
        dest = fl.ACQ / "fjc_idb" / name
        if dest.exists():
            print(json.dumps({"url": url, "skipped": "already stored", "path": str(dest)}))
            continue
        room = free_gb() - approx_mb / 1000
        if room < FLOOR_GB:
            print(json.dumps({"url": url, "skipped": f"only {free_gb():.2f} GB free; would leave {room:.2f} GB"}))
            continue
        entry = fl.download_file(url, dest, method="direct urllib GET streamed to disk (FJC permission 2026-10-22, single deliberate request)")
        print(json.dumps(entry))
        print(json.dumps({"free_gb_after": round(free_gb(), 2)}))


if __name__ == "__main__":
    main(sys.argv[1])
