"""Live spot check: request a sample of the display/thumbnail URLs in the build files once, decode the image and
compare its pixel size with the stated width/height. Image bytes are not stored.

  python3 -I -B spot_check_urls.py [N]      (N per dataset, default 8)

Per-host pacing: upload.wikimedia.org / thumb.wikimedia.org 3 s, agency-logos.federalregister.gov 1 s, tile.loc.gov
5 s, committee sites 2 s. www.fjc.gov is not sampled (its robots.txt crawl delay of 30 s is used by the FJC page
fetch). Writes spot_check_urls.json in the build folder; SVG marks are checked for HTTP 200 and an SVG content type.
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import BUILD, Pacer, host, http_get, now_utc, write_json  # noqa: E402

PACE = {"upload.wikimedia.org": 3.0, "thumb.wikimedia.org": 3.0, "agency-logos.federalregister.gov": 1.0,
        "tile.loc.gov": 5.0}
DATASETS = ["court_images", "court_buildings", "judge_portraits_open", "agency_images", "committee_marks",
            "company_logos_open", "state_capitol_images"]


def objects(ds, row):
    item = row["item"]
    if ds == "court_images":
        yield item["photo"]["display"]
    elif ds == "court_buildings":
        yield item["buildings"][0]["photo"]["display"]
        yield item["buildings"][0]["photo"]["thumb"]
    elif ds == "judge_portraits_open":
        yield item["portrait"]["thumb"]
    elif ds == "agency_images":
        for p in item["photos"][:1]:
            yield p["display"]
        for m in item["marks"][:1]:
            yield {"url": m["url"], "width": m["width"], "height": m["height"], "mime": m["mime"]}
    elif ds == "committee_marks":
        m = item["mark"]
        yield {"url": m["url"], "width": m["width"], "height": m["height"], "mime": m["mime"]}
    elif ds == "company_logos_open":
        yield item["logo"]["display"]
    elif ds == "state_capitol_images":
        yield item["photo"]["display"]


def main(per=8):
    from PIL import Image

    pacers = {}
    results = []
    for ds in DATASETS:
        rows = json.load(open(BUILD / f"{ds}.json"))["rows"]
        if ds == "court_images":
            rows = rows[189:]
        picked = [o for r in rows for o in objects(ds, r) if host(o["url"]) != "www.fjc.gov"]
        step = max(1, len(picked) // per)
        for o in picked[::step][:per]:
            h = host(o["url"])
            pacers.setdefault(h, Pacer(PACE.get(h, 2.0))).wait()
            status, ctype, body, _ = http_get(o["url"], accept="image/*", max_bytes=8 * 1024 * 1024)
            got = None
            if status == 200 and body and "svg" not in ctype:
                try:
                    with Image.open(io.BytesIO(body)) as img:
                        got = list(img.size)
                except Exception:  # noqa: BLE001 - recorded as a failure
                    got = None
            ok = status == 200 and (("svg" in ctype) if (o.get("mime") or "").endswith("svg+xml") or
                                    o["url"].split("?")[0].endswith(".svg") else got == [o["width"], o["height"]])
            # A 429 after the polite retries is the host's rate limit for this shared address: not checked.
            match = None if status == 429 else ok
            results.append({"dataset": ds, "url": o["url"], "status": status, "content_type": ctype,
                            "stated": [o["width"], o["height"]], "decoded": got, "match": match,
                            "checked_at": now_utc()})
            print(ds, status, got, [o["width"], o["height"]],
                  "not checked (rate limited)" if match is None else "ok" if ok else "MISMATCH", o["url"][-70:],
                  flush=True)
    write_json(BUILD / "spot_check_urls.json", results)
    print("checked", sum(1 for r in results if r["match"] is not None), "mismatches",
          sum(1 for r in results if r["match"] is False), "rate limited", sum(1 for r in results if r["match"] is None))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8)
