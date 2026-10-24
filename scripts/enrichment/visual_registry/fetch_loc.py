"""Read Library of Congress item records (JSON API) and check IIIF rendition sizes.

  python3 -I -B fetch_loc.py items            # https://www.loc.gov/item/<id>/?fo=json for every LOC lead
  python3 -I -B fetch_loc.py iiif <urls.json> # GET each tile.loc.gov IIIF URL once; record HTTP status and the
                                              # decoded width/height (image bytes are not stored)

loc.gov robots.txt sets Crawl-Delay: 5, so requests are sequential, one every 5 seconds (tile.loc.gov is held to the
same pace). Item JSON is stored unchanged (gzip) under cache/loc_items/ with a manifest; IIIF checks are recorded
in cache/loc_iiif/_manifest.jsonl (url, status, content type, bytes, sha256, width, height, retrieved_at).
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import BUILD, CACHE, Pacer, Store, http_get, now_utc, sha256_bytes  # noqa: E402

SPACING = 5.0
MAX_IMAGE = 8 * 1024 * 1024


def items():
    ids = json.load(open(BUILD / "leads.json"))["fetch"]["loc_items"]
    store = Store("loc_items")
    pacer = Pacer(SPACING)
    for item in ids:
        if store.done(item):
            continue
        url = f"https://www.loc.gov/item/{item}/?fo=json"
        pacer.wait()
        status, ctype, body, _ = http_get(url, accept="application/json")
        store.put(item, url, status, body, f"{item}.json.gz", content_type=ctype)
        print(item, status, len(body), flush=True)


def iiif(urls_path):
    from PIL import Image

    urls = json.load(open(urls_path))
    out = CACHE / "loc_iiif"
    out.mkdir(parents=True, exist_ok=True)
    manifest = out / "_manifest.jsonl"
    done = set()
    if manifest.exists():
        for line in open(manifest):
            e = json.loads(line)
            if e["status"] == 200 and e.get("width"):
                done.add(e["url"])
    pacer = Pacer(SPACING)
    with open(manifest, "a") as m:
        for url in urls:
            if url in done:
                continue
            pacer.wait()
            status, ctype, body, _ = http_get(url, accept="image/*", max_bytes=MAX_IMAGE)
            entry = {"url": url, "status": status, "content_type": ctype, "bytes": len(body),
                     "sha256": sha256_bytes(body) if body else None, "width": None, "height": None,
                     "retrieved_at": now_utc()}
            if status == 200 and body and len(body) <= MAX_IMAGE and ctype.startswith("image/"):
                try:
                    with Image.open(io.BytesIO(body)) as img:
                        entry["width"], entry["height"] = img.size
                        entry["format"] = img.format
                except Exception as error:  # noqa: BLE001 - recorded, never guessed
                    entry["decode_error"] = str(error)[:200]
            m.write(json.dumps(entry) + "\n")
            m.flush()
            print(status, entry["width"], entry["height"], url[-70:], flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "items":
        items()
    elif sys.argv[1] == "iiif":
        iiif(sys.argv[2])
    else:
        raise SystemExit("usage: fetch_loc.py items | iiif <urls.json>")
