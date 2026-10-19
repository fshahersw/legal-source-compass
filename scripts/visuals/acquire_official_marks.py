"""Acquire the court mark each federal court shows on its own homepage, for courts that have no artwork yet.

Inputs: the court homepages saved by scripts/enrichment/court_locations/fetch_sites.py (private/acq/court_locations/sites/<host>/
index.html, with their manifest), CourtListener's federal court ids (private/build/court_locations/lookups/cl_courts.json) and the
existing marks (src/lib/visuals/registry.json, src/lib/courts/artwork.ts). A homepage is used only when its host code is exactly the
court id (www.<id>.uscourts.gov), so a site shared by two courts never lends one court's mark to the other.

The image is the homepage <img> whose file name or alt text names a seal; otherwise one whose file name or alt text names the site
logo. Images of PACER, e-filing, jury or social-media services are skipped. The image must be served by the same court host over
HTTPS (robots.txt honoured). Bytes are kept unchanged (private/acq/court_marks/ and public/court-marks/) and recorded with their
SHA-256 in src/lib/courts/officialCourtMarks.json, which scripts/enrichment/verify_court_artwork.mjs checks like the reviewed entries.

Every image was looked at on a contact sheet. REJECTED lists the ones that are not a mark of the court itself; raster images whose
opaque pixels are almost all white or pale (white text meant for a dark header) are dropped because they cannot be read on the site.

    python3 -B scripts/visuals/acquire_official_marks.py
"""
from __future__ import annotations

import hashlib
import html
import io
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "court_locations"))

import fetchlib  # noqa: E402
from PIL import Image  # noqa: E402

SITES = os.path.join(ROOT, "private", "acq", "court_locations", "sites")
OUT_JSON = os.path.join(ROOT, "src", "lib", "courts", "officialCourtMarks.json")
PUBLIC = os.path.join(ROOT, "public", "court-marks")
RAW = os.path.join(ROOT, "private", "acq", "court_marks")
SKIP = re.compile(r"pacer|ejuror|e-juror|efile|e-file|nextgen|cm-?ecf|ecf|twitter|facebook|youtube|linkedin|rss|flickr|instagram|sealed|"
                  r"icon|banner-ad|external|search|arrow|button|spinner|loading|probation|pretrial", re.I)
SEAL = re.compile(r"\bseal\b|_seal|seal_|-seal|seal-|seal\.", re.I)
LOGO = re.compile(r"logo", re.I)
UNSAFE_SVG = re.compile(rb"<script|foreignObject|\son[a-z]+\s*=|javascript:|<image[^>]+href=\"http", re.I)
MAX_BYTES = 1_500_000
MAX_LUMA = 0.75
DESCRIPTION = {"seal": "Court seal image published on the court homepage.", "banner": "Site mark published on the court homepage."}
REJECTED = {
    "nmb": "the homepage logo is the New Mexico state Zia symbol, not a court mark",
    "tnwb": "the matched image is the logo of the court's electronic self-representation service",
    "txwd": "the court name in the logo is white on a transparent background and cannot be read on the site",
}


def legible(body: bytes, ext: str) -> bool:
    """False when a raster mark's opaque pixels are mostly white or pale, i.e. drawn for a dark header."""
    if ext == "svg":
        return True
    im = Image.open(io.BytesIO(body)).convert("RGBA")
    im.thumbnail((128, 128))
    alpha = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    if not alpha.getbbox():
        return False
    luma = im.convert("L")
    hist = luma.histogram(mask=alpha)
    total = sum(hist)
    return sum(i * n for i, n in enumerate(hist)) / total / 255 <= MAX_LUMA


def candidates(page: str, base: str):
    out = []
    for tag in re.findall(r"<img\b[^>]*>", page, re.I):
        src = re.search(r'\bsrc="([^"]+)"', tag) or re.search(r"\bsrc='([^']+)'", tag)
        if not src:
            continue
        alt = re.search(r'\balt="([^"]*)"', tag)
        url = urllib.parse.urljoin(base, html.unescape(src.group(1)).strip())
        name = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]
        alt_text = html.unescape(alt.group(1)) if alt else ""
        if SKIP.search(name) or SKIP.search(alt_text):
            continue
        if SEAL.search(name) or re.search(r"\bseal\b", alt_text, re.I):
            out.append((0, url, alt_text, "seal"))
        elif LOGO.search(name) or re.search(r"\blogo\b", alt_text, re.I):
            out.append((1, url, alt_text, "banner"))
    seen, ordered = set(), []
    for rank, url, alt_text, kind in sorted(out, key=lambda c: c[0]):
        if url not in seen:
            seen.add(url)
            ordered.append((url, alt_text, kind))
    return ordered


def main():
    registry = json.load(open(os.path.join(ROOT, "src", "lib", "visuals", "registry.json")))
    reviewed = set(re.findall(r'courtId: "([a-z0-9]+)"', open(os.path.join(ROOT, "src", "lib", "courts", "artwork.ts")).read()))
    courts = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "private", "build", "court_locations", "lookups", "cl_courts.json")))["rows"]}
    existing, skipped = [], {}
    for entry in json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else []:
        asset = os.path.join(ROOT, "public", entry["assetPath"].lstrip("/"))
        ext = entry["assetPath"].rsplit(".", 1)[-1]
        reason = REJECTED.get(entry["courtId"]) or (None if legible(open(asset, "rb").read(), ext) else "mark is white or pale, drawn for a dark header")
        if reason:
            skipped[entry["courtId"]] = reason
            os.remove(asset)
            continue
        existing.append({**entry, "description": DESCRIPTION[entry["kind"]]})
    have = set(registry["courts"]) | reviewed | {e["courtId"] for e in existing} | set(skipped) | set(REJECTED)
    wanted = sorted(i for i, c in courts.items() if c["in_use"] == "t" and c["jurisdiction"] in ("F", "FD", "FB", "FS") and i not in have)
    os.makedirs(PUBLIC, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    added = []
    for cid in wanted:
        host = f"www.{cid}.uscourts.gov"
        page_path = os.path.join(SITES, host, "index.html")
        if not os.path.exists(page_path):
            skipped[cid] = "no saved homepage at its own host"
            continue
        base = f"https://{host}/"
        cands = candidates(open(page_path, encoding="utf-8", errors="replace").read(), base)
        if not cands:
            skipped[cid] = "no seal or logo image on the homepage"
            continue
        done = False
        for url, alt_text, kind in cands[:3]:
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme != "https" or parsed.netloc.lower() != host:
                continue
            ext = parsed.path.rsplit(".", 1)[-1].lower() if "." in parsed.path else ""
            if ext not in ("png", "svg", "gif", "jpg", "jpeg"):
                continue
            try:
                status, body, _ = fetchlib.fetch(url, None, save=False, retries=2, timeout=40)
            except Exception as error:  # noqa: BLE001 - recorded as a skip reason
                skipped[cid] = f"fetch failed: {str(error)[:80]}"
                continue
            if status != 200 or not body or len(body) > MAX_BYTES:
                skipped[cid] = f"HTTP {status} or size {len(body or b'')}"
                continue
            if ext == "svg":
                if UNSAFE_SVG.search(body) or b"<svg" not in body[:4000].lower():
                    skipped[cid] = "SVG with active content or not an SVG"
                    continue
            else:
                try:
                    im = Image.open(io.BytesIO(body))
                    im.verify()
                    im = Image.open(io.BytesIO(body))
                    if min(im.size) < 40:
                        skipped[cid] = f"image too small {im.size}"
                        continue
                    if not legible(body, ext):
                        skipped[cid] = "mark is white or pale, drawn for a dark header"
                        continue
                except Exception:
                    skipped[cid] = "not a readable image"
                    continue
            ext = "jpg" if ext == "jpeg" else ext
            digest = hashlib.sha256(body).hexdigest()
            with open(os.path.join(RAW, f"{cid}.{ext}"), "wb") as h:
                h.write(body)
            with open(os.path.join(PUBLIC, f"{cid}.{ext}"), "wb") as h:
                h.write(body)
            added.append({
                "courtId": cid, "courtName": courts[cid]["full_name"], "assetPath": f"/court-marks/{cid}.{ext}", "kind": kind,
                "sourcePage": base, "sourceImage": url, "retrievedAt": fetchlib.utc_now()[:10], "sha256": digest,
                "description": DESCRIPTION[kind],
            })
            skipped.pop(cid, None)
            done = True
            break
        if not done and cid not in skipped:
            skipped[cid] = "no candidate on the court's own host"
    entries = sorted(existing + added, key=lambda e: e["courtId"])
    with open(OUT_JSON, "w") as h:
        json.dump(entries, h, indent=2, ensure_ascii=False)
        h.write("\n")
    print(json.dumps({"wanted": len(wanted), "added": len(added), "seal": sum(1 for a in added if a["kind"] == "seal"),
                      "banner": sum(1 for a in added if a["kind"] == "banner"), "skipped": len(skipped)}))
    for k, v in sorted(skipped.items()):
        print("  skip", k, v)


if __name__ == "__main__":
    main()
