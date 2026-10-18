"""Download official JPML statistics PDFs and hearing-session notices (raw, unchanged) into private/acq/mdl-intel/jpml.

Discovery: the JPML statistics page (/statistics-info) and hearing-session archive (/hearing-session-orders-archive)
are parsed for links; every linked PDF is saved byte-for-byte with a manifest of URL -> file, status, sha256.
"""
import concurrent.futures as cf
import hashlib
import json
import sys
import urllib.parse
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
from fetchutil import ACQ, fetch  # noqa: E402

BASE = "https://www.jpml.uscourts.gov"
PAGES = {
    "statistics": f"{BASE}/statistics-info",
    "hearing_archive": f"{BASE}/hearing-session-orders-archive",
    "hearing_current": f"{BASE}/hearing-information",
    "panel_orders": f"{BASE}/panel-orders",
    "pending_mdls": f"{BASE}/pending-mdls-0",
    "quarterly": f"{BASE}/mdl-quarterly-caseload-summary",
}


def links(html: bytes, base: str):
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = urllib.parse.urljoin(base, a["href"])
        if href.lower().endswith(".pdf") and "jpml.uscourts.gov" in href:
            out.append({"text": " ".join(a.get_text(" ").split()), "url": href})
    return out


def main():
    manifest = {"retrieved": date.today().isoformat(), "pages": {}, "files": []}
    targets = {}
    for key, url in PAGES.items():
        body, path, status = fetch(url, "pages", refresh=True)
        found = links(body, url)
        manifest["pages"][key] = {"url": url, "status": status, "file": str(path.relative_to(ACQ)), "pdfs": found}
        for item in found:
            targets.setdefault(item["url"], {"text": item["text"], "page": key})

    def grab(url):
        body, path, status = fetch(url, "jpml")
        return url, status, path, hashlib.sha256(body).hexdigest() if body else None, len(body)

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for url, status, path, digest, size in pool.map(grab, sorted(targets)):
            manifest["files"].append({"url": url, **targets[url], "status": status, "file": str(path.relative_to(ACQ)), "sha256": digest, "bytes": size})
    (ACQ / "jpml_manifest.json").write_text(json.dumps(manifest, indent=1))
    ok = sum(1 for f in manifest["files"] if f["status"] == 200)
    print(json.dumps({"pdfs": len(manifest["files"]), "ok": ok}))


if __name__ == "__main__":
    main()
