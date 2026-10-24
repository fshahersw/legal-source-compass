"""Live spot check: re-read N kept files' licence metadata from Commons now and compare with the build.

Usage: python3 -I -B spot_check_live.py [N] [out.json]

One API request (N <= 50 titles, evenly spaced over the rows). Compares licence name, licence link, author (plain
text) and file page for each; prints one line per file and a mismatch count. Nothing is written to the build.
"""
import json
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_commons import API, FIELDS, fetch  # noqa: E402
from licenses import meta_value  # noqa: E402

BUILD = Path("/home/user/legal-source-compass/private/build/court_images/court_images.json")


def main(n=15, out=None):
    rows = json.loads(BUILD.read_text())["rows"]
    step = len(rows) / n
    picked = [rows[int(i * step)] for i in range(n)]
    titles = sorted({r["item"]["photo"]["file"] for r in picked})
    params = {"action": "query", "format": "json", "formatversion": "2", "prop": "imageinfo", "redirects": "1",
              "titles": "|".join(titles), "iiprop": "url|extmetadata", "iiextmetadatafilter": FIELDS,
              "iiextmetadatalanguage": "en"}
    status, body = fetch(API + "?" + urllib.parse.urlencode(params))
    if status != 200:
        raise SystemExit(f"HTTP {status}")
    pages = {p["title"]: p for p in json.loads(body)["query"]["pages"]}
    checks = []
    for r in picked:
        p = r["item"]["photo"]
        info = (pages.get(p["file"], {}).get("imageinfo") or [{}])[0]
        ext = info.get("extmetadata") or {}
        live = {
            "license": meta_value(ext, "LicenseShortName"),
            "license_url": meta_value(ext, "LicenseUrl") or (info.get("descriptionurl", "") + "#Licensing"),
            "author": meta_value(ext, "Artist") or None,
            "source_page": info.get("descriptionurl"),
        }
        ours = {"license": p["license"], "license_url": p["license_url"], "author": p["attribution"],
                "source_page": p["source_page"]}
        diff = [k for k in ours if ours[k] != live[k]]
        checks.append({"court_id": r["id"], "file": p["file"], "ours": ours, "live": live, "match": not diff,
                       "differs": diff})
        print(r["id"], "match" if not diff else f"DIFFERS {diff}", "|", p["license"], "|", (p["attribution"] or "")[:50])
    result = {"checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "checks": checks,
              "mismatches": sum(1 for c in checks if not c["match"])}
    print(json.dumps({"checked": len(checks), "mismatches": result["mismatches"]}))
    if out:
        Path(out).write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 15, sys.argv[2] if len(sys.argv) > 2 else None)
