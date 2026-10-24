"""Independent check of private/build/court_images/court_images.json.

  python3 -I -B verify_court_images.py [--fetch] [--sheets <dir>]

Offline checks (always): every row's court id is in court_spine with the same title; licence name, licence link,
author, source page and rendition URLs equal what a second, separate parse of the stored Commons responses gives;
the licence code is a kept one; renditions are scaled thumbnails at Wikimedia standard widths (display 960, or 500
for originals 501-960 px wide; thumbnail 330), never originals; their sizes equal the decoded measurements.
--fetch [--sample N]: downloads N rows' renditions again (evenly spaced, default 25; 0 = all), one request every two
seconds, checks HTTP 200 and an image content type, decodes the pixels and compares width and height with the row.
Image bytes are not stored, except that --sheets writes contact sheets of the thumbnails for visual review.
Prints failure counts; exit status 1 when any check fails.
"""
import argparse
import gzip
import html
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path("/home/user/legal-source-compass")
BUILD = ROOT / "private" / "build" / "court_images"
ACQ = ROOT / "private" / "acq" / "court_images" / "commons"
MEASURED = ROOT / "private" / "acq" / "court_images" / "renditions" / "_manifest.jsonl"
UA = "LegalSourceAtlas/1.0 (research; court building photo check; notreelai@gmail.com) python-urllib/3"
KEPT_CODES = re.compile(r"^(pd|cc0|cc-by-\d(\.\d)?(-[a-z]{2,})?|cc-by-sa-\d(\.\d)?(-[a-z]{2,})?)$")


def text_of(field):
    if not isinstance(field, dict):
        return ""
    value = re.sub(r"<[^>]*>", " ", str(field.get("value", "")))
    return " ".join(html.unescape(value).replace(" ", " ").split())


def second_parse():
    """title -> {'display': imageinfo, 'thumb': imageinfo} from every stored HTTP-200 response."""
    ok = {}
    for line in open(ACQ / "_manifest.jsonl"):
        e = json.loads(line)
        if e["status"] == 200:
            ok[e["path"]] = e["pass"]
    out = {}
    for path, kind in ok.items():
        for page in json.loads(gzip.open(path).read())["query"]["pages"]:
            if page.get("imageinfo"):
                out.setdefault(page["title"], {})[kind] = page["imageinfo"][0]
    return out


def measurements():
    out = {}
    if MEASURED.exists():
        for line in open(MEASURED):
            e = json.loads(line)
            if e.get("status") == 200 and e.get("width"):
                out[e["url"]] = (e["width"], e["height"])
    return out


def offline(rows, spine, parsed):
    failures = []
    sizes = measurements()
    for row in rows:
        cid = row["id"]
        p = row["item"]["photo"]
        if cid not in spine or spine[cid]["title"] != row["title"]:
            failures.append((cid, "court id or title differs from court_spine"))
        info = parsed.get(p["file"])
        if not info or not {"display", "thumb", "mid"} <= set(info):
            failures.append((cid, "file not in stored responses"))
            continue
        d, t, m = info["display"], info["thumb"], info["mid"]
        ext = d.get("extmetadata") or {}
        code = text_of(ext.get("License")).lower()
        if not KEPT_CODES.match(code):
            failures.append((cid, f"licence code {code!r} is not kept"))
        if text_of(ext.get("NonFree")).lower() == "true":
            failures.append((cid, "non-free"))
        if p["license"] != text_of(ext.get("LicenseShortName")):
            failures.append((cid, "licence name differs"))
        deed = text_of(ext.get("LicenseUrl"))
        if p["license_url"] != (deed or d["descriptionurl"] + "#Licensing"):
            failures.append((cid, "licence link differs"))
        if (p["attribution"] or "") != text_of(ext.get("Artist")):
            failures.append((cid, "author differs"))
        if p["source_page"] != d["descriptionurl"] or row["source_url"] != d["descriptionurl"]:
            failures.append((cid, "source page differs"))
        want_display = d["thumburl"] if d["width"] > 960 else m["thumburl"]
        want_width = 960 if d["width"] > 960 else 500
        if d["width"] <= 500:
            failures.append((cid, "original too small for a standard display rendition"))
        if p["display"]["url"] != want_display or p["thumb"]["url"] != t["thumburl"]:
            failures.append((cid, "rendition URL differs"))
        for key, width in (("display", want_width), ("thumb", 330)):
            url = p[key]["url"]
            if not re.search(rf"/thumb/.+/(?:lossy-)?(?:page\d+-)?{width}px-[^/]+$", url.split("?")[0]):
                failures.append((cid, f"{key} is not a {width} px standard thumbnail"))
            if sizes.get(url) != (p[key]["width"], p[key]["height"]) or p[key]["width"] != width:
                failures.append((cid, f"{key} size differs from the decoded measurement"))
        two = p.get("display_2x")
        two_ok = two and re.search(r"/thumb/.+/(?:lossy-)?(?:page\d+-)?1920px-[^/]+$", two["url"].split("?")[0])
        if two and (not two_ok or two["width"] != 1920 or d["width"] <= 1920):
            failures.append((cid, "2x rendition is not a scaled 1920 px thumbnail"))
        if not p["verified_at"]:
            failures.append((cid, "no verified_at"))
    return failures


def contract(build):
    """The build-file rules of CONTRACT.md: id format, required keys, unique ids, dataset/category, no ordinal,
    a source_url and a title on every row, JSON round-trip stable."""
    failures = []
    ds = build.get("dataset", "")
    if not re.fullmatch(r"[a-z0-9_]{1,80}", ds):
        failures.append(("build", "bad dataset id"))
    for key in ("label", "listing_block", "summary", "rows", "built_at", "inputs"):
        if key not in build:
            failures.append(("build", f"missing {key}"))
    rows = build.get("rows") or []
    if len({r.get("id") for r in rows}) != len(rows):
        failures.append(("build", "duplicate ids"))
    for r in rows:
        if r.get("dataset") != ds or r.get("category") != ds or "ordinal" in r:
            failures.append((r.get("id"), "dataset/category/ordinal"))
        if not str(r.get("source_url") or "").startswith(("http://", "https://", "/")):
            failures.append((r.get("id"), "no source_url"))
        if not str(r.get("title") or "").strip():
            failures.append((r.get("id"), "empty title"))
    if json.loads(json.dumps(rows)) != rows:
        failures.append(("build", "rows not JSON round-trip stable"))
    return failures


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def fetch_checks(rows, sheets_dir, sample):
    from PIL import Image

    if sample and sample < len(rows):
        step = len(rows) / sample
        rows = [rows[int(i * step)] for i in range(sample)]
    failures, thumbs, last = [], [], 0.0
    for row in rows:
        p = row["item"]["photo"]
        for key in ("display", "thumb"):
            wait = 2.0 - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.monotonic()
            try:
                status, ctype, body = get(p[key]["url"])
            except Exception as error:  # noqa: BLE001 - every failure is reported, none is retried silently
                failures.append((row["id"], f"{key} fetch failed: {error}"))
                continue
            if status != 200 or not ctype.startswith("image/"):
                failures.append((row["id"], f"{key} HTTP {status} {ctype}"))
                continue
            img = Image.open(io.BytesIO(body))
            if img.size != (p[key]["width"], p[key]["height"]):
                failures.append((row["id"], f"{key} decoded {img.size} != {(p[key]['width'], p[key]['height'])}"))
            if key == "thumb" and sheets_dir:
                img.thumbnail((330, 330))
                thumbs.append((row["id"], img.convert("RGB")))
        print(row["id"], "checked", flush=True)
    if sheets_dir:
        write_sheets(thumbs, Path(sheets_dir))
    return failures


def write_sheets(thumbs, out):
    from PIL import Image, ImageDraw

    out.mkdir(parents=True, exist_ok=True)
    cols, rows_per, cell_w, cell_h = 6, 5, 230, 190
    per = cols * rows_per
    for n in range(0, len(thumbs), per):
        sheet = Image.new("RGB", (cols * cell_w, rows_per * cell_h), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (cid, img) in enumerate(thumbs[n:n + per]):
            x, y = (i % cols) * cell_w, (i // cols) * cell_h
            copy = img.copy()
            copy.thumbnail((cell_w - 10, cell_h - 26))
            sheet.paste(copy, (x + 5, y + 5))
            draw.text((x + 5, y + cell_h - 18), cid, fill="black")
        sheet.save(out / f"sheet_{n // per:02d}.jpg", quality=80)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--sheets")
    parser.add_argument("--sample", type=int, default=25)
    args = parser.parse_args(argv)
    build = json.loads((BUILD / "court_images.json").read_text())
    spine = {r["id"]: r for r in json.load(open(BUILD / "lookups" / "court_spine.json"))}
    rows = build["rows"]
    failures = contract(build) + offline(rows, spine, second_parse())
    print(json.dumps({"rows": len(rows), "offline_failures": len(failures)}))
    for f in failures[:40]:
        print("  OFFLINE", f)
    if args.fetch:
        fetched = fetch_checks(rows, args.sheets, args.sample)
        print(json.dumps({"fetch_failures": len(fetched)}))
        for f in fetched[:40]:
            print("  FETCH", f)
        failures += fetched
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
