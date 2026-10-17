"""Acquire court seals (Free Law Project seal-rookery) and state flags (Wikimedia Commons) into public/visuals.

Every asset is stored locally with the source URL, the source and stored SHA-256 and its license, and is
recorded in src/lib/visuals/registry.json:
  courts       federal court seals, keyed by CourtListener court id
  stateCourts  state court seals, keyed by CourtListener court id (only used for state-system courts)
  flags        state and District of Columbia flags, keyed by USPS code

Raster originals are reduced to at most 256 px PNG; SVGs are kept only when small and free of script,
event handlers or foreign objects, otherwise they are rasterized.

Usage: python scripts/visuals/acquire_marks.py [--only=courts|flags]
"""
import concurrent.futures as futures
import hashlib
import io
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.error
import urllib.request
import time

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REGISTRY = os.path.join(ROOT, "src", "lib", "visuals", "registry.json")
PUBLIC = os.path.join(ROOT, "public", "visuals")
CA = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
CONTEXT = ssl.create_default_context(cafile=CA) if CA else ssl.create_default_context()
AGENT = "legal-source-compass-visuals/1.0 (court and state identification artwork)"
ROOKERY_REV = "784c3238bac3958395f83131b9acb206b67be5e8"
ROOKERY = f"https://raw.githubusercontent.com/freelawproject/seal-rookery/{ROOKERY_REV}/seal_rookery/seals/"
UNSAFE_SVG = re.compile(rb"<script|foreignObject|\son[a-z]+\s*=|javascript:|<image[^>]+href=\"http", re.I)
FEDERAL_IDS = {"scotus", "cadc", "cafc", "uscfc", "tax", "armfor", "fisc", "fiscr", "cbca", "asbca", "cjdpa", "aoc", "jpml", "cit", "cavc"}

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
FLAG_FILES = {"GA": "Flag of Georgia (U.S. state).svg", "DC": "Flag of Washington, D.C..svg", "WA": "Flag of Washington.svg"}


def get(url, attempts=6):
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": AGENT})
        try:
            with urllib.request.urlopen(request, context=CONTEXT, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (429, 503) and attempt < attempts - 1:
                time.sleep(int(error.headers.get("Retry-After") or 0) or 3 * 2 ** attempt)
                continue
            raise


def sha(data):
    return hashlib.sha256(data).hexdigest()


def store(folder, key, data, kind):
    """Write a safe SVG or a <=256 px PNG; return (relative path, stored bytes)."""
    os.makedirs(os.path.join(PUBLIC, folder), exist_ok=True)
    if kind == "svg" and len(data) <= 400_000 and not UNSAFE_SVG.search(data):
        path = f"/visuals/{folder}/{key}.svg"
        body = data
    else:
        if kind == "svg":
            raise ValueError("SVG is too large or contains active content; no local SVG rasterizer is used")
        image = Image.open(io.BytesIO(data))
        image = image.convert("RGBA")
        image.thumbnail((256, 256), Image.LANCZOS)
        out = io.BytesIO()
        image.save(out, format="PNG", optimize=True)
        body = out.getvalue()
        path = f"/visuals/{folder}/{key}.png"
    with open(os.path.join(ROOT, "public", path.lstrip("/")), "wb") as handle:
        handle.write(body)
    return path, body


def court_seal(court_id, meta):
    for ext in ("png", "svg", "jpg", "gif"):
        url = f"{ROOKERY}orig/{court_id}.{ext}"
        try:
            data = get(url)
        except Exception:
            continue
        federal = court_id in FEDERAL_IDS or bool(re.search(r"United States|Circuit|Federal|Bankruptcy Appellate", meta.get("name") or ""))
        folder = "courts" if federal else "state-courts"
        try:
            path, body = store(folder, court_id, data, "svg" if ext == "svg" else "raster")
        except Exception as error:
            return court_id, None, f"convert failed: {error}"
        return court_id, {
            "name": meta.get("name") or court_id,
            "kind": "community-court-mark",
            "path": path,
            "source": url,
            "sourceSha256": sha(data),
            "sha256": sha(body),
            "license": "Government work per Free Law Project seal-rookery image license; identification only",
            "repositoryRevision": ROOKERY_REV,
            "_section": "courts" if federal else "stateCourts",
        }, None
    return court_id, None, "no original image"


def flag(usps):
    title = FLAG_FILES.get(usps) or f"Flag of {STATE_NAMES[usps]}.svg"
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "query", "titles": f"File:{title}", "prop": "imageinfo", "iiprop": "url|sha1|extmetadata", "iiurlwidth": "320", "format": "json"})
    pages = json.loads(get(api))["query"]["pages"]
    info = next(iter(pages.values())).get("imageinfo")
    if not info:
        return usps, None, f"no Commons file {title}"
    info = info[0]
    data = get(info["url"])
    meta = info.get("extmetadata") or {}
    license_name = (meta.get("LicenseShortName") or {}).get("value") or "Public domain"
    try:
        if len(data) > 40_000:
            raise ValueError("large flag SVG; the small rendered thumbnail is enough for an identification mark")
        path, body = store("flags", usps, data, "svg")
    except ValueError:
        # Commons renders a PNG thumbnail of the same file revision; use it when the SVG is not safe to ship.
        data = get(info["thumburl"])
        path, body = store("flags", usps, data, "raster")
        info["url"] = info["thumburl"]
    return usps, {
        "name": STATE_NAMES[usps],
        "kind": "state-flag",
        "path": path,
        "source": info["url"],
        "sourcePage": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/File:{title.replace(' ', '_')}",
        "sourceSha256": sha(data),
        "sha256": sha(body),
        "license": f"{license_name} (Wikimedia Commons); state flag shown for identification only",
        "description": "State flag; not an official seal and no endorsement implied",
    }, None


def main(argv):
    only = next((a.split("=", 1)[1] for a in argv if a.startswith("--only=")), None)
    registry = json.load(open(REGISTRY))
    registry.setdefault("stateCourts", {})
    registry.setdefault("flags", {})
    failures = []
    if only in (None, "courts"):
        index = json.loads(get(ROOKERY + "seals.json"))
        wanted = {k: v for k, v in index.items() if v.get("has_seal") and k not in registry["courts"] and k not in registry["stateCourts"]}
        with futures.ThreadPoolExecutor(8) as pool:
            for court_id, entry, error in pool.map(lambda kv: court_seal(*kv), wanted.items()):
                if entry:
                    registry[entry.pop("_section")][court_id] = entry
                else:
                    failures.append((court_id, error))
    if only in (None, "flags"):
        for usps in STATE_NAMES:
            if usps in registry["flags"]:
                continue
            try:
                usps, entry, error = flag(usps)
            except Exception as failure:
                entry, error = None, str(failure)
            time.sleep(1)
            if True:
                if entry:
                    registry["flags"][usps] = entry
                else:
                    failures.append((usps, error))
    for section in ("courts", "stateCourts", "flags"):
        registry[section] = dict(sorted(registry[section].items()))
    with open(REGISTRY, "w") as handle:
        json.dump(registry, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(json.dumps({"courts": len(registry["courts"]), "stateCourts": len(registry["stateCourts"]), "flags": len(registry["flags"]), "failures": failures}))


if __name__ == "__main__":
    main(sys.argv[1:])
