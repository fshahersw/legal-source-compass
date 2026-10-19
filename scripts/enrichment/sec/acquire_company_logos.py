"""Acquire each registrant's site icon from the website the company names in its own annual report.

Input: private/build/sec_statements/raw_results.json (website per CIK, from build_company_statements.py; the investor-relations
site when no website is named and its domain carries the company's name). For each site the
homepage is read and the icon it declares is used: apple-touch-icon first (sized for display), then the largest declared
PNG/SVG icon, then /favicon.ico. The image must be served from the company's own domain (the site's host or a subdomain
of its registrable domain), over HTTPS, with robots.txt honoured. Raster images of at least 32 px are kept; ICO files are
converted to PNG; anything larger than 256 px is scaled down. Original bytes are hashed; the stored copy is hashed too.

Output: public/company-logos/<cik>.<png|svg> and private/build/sec_statements/logos.json
({cik: {path, source_page, source_image, sha256_original, sha256, width, height, retrieved}}), plus the reason for every skip.

    python3 -I -B scripts/enrichment/sec/acquire_company_logos.py
"""
from __future__ import annotations

import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "court_locations"))
import fetchlib  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = HERE.parents[2]
BUILD = ROOT / "private" / "build" / "sec_statements"
PUBLIC = ROOT / "public" / "company-logos"
UNSAFE_SVG = re.compile(rb"<script|foreignObject|\son[a-z]+\s*=|javascript:|<image[^>]+href=\"http", re.I)
MAX_BYTES = 2_000_000
CURRENT_SINCE = "2024-07-01"


def registrable(host: str) -> str:
    parts = host.lower().split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def icon_candidates(page: str, base: str) -> list[tuple[int, str, str]]:
    out = []
    for tag in re.findall(r"<link\b[^>]*>", page, re.I):
        rel = (re.search(r'\brel=["\']([^"\']+)["\']', tag, re.I) or [None, ""])[1].lower()
        href = re.search(r'\bhref=["\']([^"\']+)["\']', tag, re.I)
        if not href or "icon" not in rel:
            continue
        sizes = re.search(r'\bsizes=["\'](\d+)x(\d+)["\']', tag, re.I)
        size = int(sizes.group(1)) if sizes else 0
        url = urllib.parse.urljoin(base, html.unescape(href.group(1).strip()))
        rank = 3 if "apple-touch-icon" in rel else 2 if url.lower().split("?")[0].endswith(".svg") else 1
        out.append((rank * 10000 + size, url, "apple-touch-icon" if "apple-touch-icon" in rel else "icon"))
    out.sort(reverse=True)
    out.append((0, urllib.parse.urljoin(base, "/favicon.ico"), "favicon"))
    return out


def own_domain(url: str, site_host: str) -> bool:
    p = urllib.parse.urlparse(url)
    return p.scheme == "https" and p.hostname is not None and registrable(p.hostname) == registrable(site_host)


def acquire(cik: str, site: str) -> tuple[dict | None, str | None]:
    host = site if "://" not in site else urllib.parse.urlparse(site).netloc
    page_url = f"https://{host}/"
    try:
        status, body, headers = fetchlib.fetch(page_url, None, save=False, retries=1, timeout=30)
    except PermissionError:
        return None, "robots.txt disallows the homepage"
    except Exception as error:  # noqa: BLE001
        return None, f"homepage not reachable: {str(error)[:80]}"
    final = headers.get("X-Final-URL", page_url)
    final_host = urllib.parse.urlparse(final).hostname or host
    if status != 200:
        return None, f"homepage HTTP {status}"
    if registrable(final_host) != registrable(host):
        return None, f"homepage redirects to another domain ({final_host})"
    page = body.decode("utf-8", errors="replace")
    for _rank, url, kind in icon_candidates(page, final)[:5]:
        if not own_domain(url, final_host):
            continue
        try:
            st, img, _ = fetchlib.fetch(url, None, save=False, retries=1, timeout=30)
        except Exception:  # noqa: BLE001 - try the next candidate
            continue
        if st != 200 or not img or len(img) > MAX_BYTES:
            continue
        original_sha = hashlib.sha256(img).hexdigest()
        if url.lower().split("?")[0].endswith(".svg") or img.lstrip()[:5] in (b"<svg ", b"<?xml"):
            if UNSAFE_SVG.search(img) or b"<svg" not in img[:4000].lower():
                continue
            out_bytes, ext, size = img, "svg", (None, None)
        else:
            try:
                im = Image.open(io.BytesIO(img))
                if getattr(im, "n_frames", 1) > 1 or im.format == "ICO":
                    sizes = sorted(im.info.get("sizes") or [im.size], key=lambda s: -s[0]) if im.format == "ICO" else [im.size]
                    if im.format == "ICO" and sizes:
                        im.size = sizes[0]
                im = im.convert("RGBA")
            except Exception:  # noqa: BLE001
                continue
            if min(im.size) < 32:
                continue
            im.thumbnail((256, 256), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            im.save(buffer, "PNG", optimize=True)
            out_bytes, ext, size = buffer.getvalue(), "png", im.size
        PUBLIC.mkdir(parents=True, exist_ok=True)
        (PUBLIC / f"{cik}.{ext}").write_bytes(out_bytes)
        return {"path": f"/company-logos/{cik}.{ext}", "source_page": final, "source_image": url, "kind": kind,
                "sha256_original": original_sha, "sha256": hashlib.sha256(out_bytes).hexdigest(),
                "width": size[0], "height": size[1], "retrieved": time.strftime("%Y-%m-%d", time.gmtime())}, None
    return None, "no usable icon of at least 32 px on the company's own domain"


def own_ir_site(name: str, ir_site: str | None) -> bool:
    """An investor-relations site counts as the company's own domain only when its registrable domain carries a word of
    the company's name (abbottinvestor.com for Abbott), which rules out shared IR hosting providers."""
    if not ir_site:
        return False
    label = registrable(ir_site.split("/")[0]).split(".")[0]
    words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) >= 4 and w not in ("corp", "corporation", "company", "group", "holdings", "international", "industries", "incorporated")]
    return any(w in label for w in words)


def site_of(profile: dict) -> str | None:
    if profile.get("website"):
        return profile["website"]
    return profile["ir_website"] if own_ir_site(profile.get("name") or "", profile.get("ir_website")) else None


def main():
    results = json.loads((BUILD / "raw_results.json").read_text())
    sites = {r["cik"]: site_of(r["profile"]) for r in results if site_of(r["profile"])}
    # A site named by several co-registrants is one company's site; only registrants with their own ticker get it.
    owners: dict[str, list[str]] = {}
    for cik, site in sites.items():
        owners.setdefault(site, []).append(cik)
    ticker = {r["cik"]: bool(r["profile"]["tickers"]) for r in results}
    # A registrant that stopped filing may no longer own the domain its old report names; only current filers get a logo.
    last_report = {r["cik"]: max((f["date"] for f in r["filings"] if f["form"] in ("10-K", "10-Q", "20-F", "40-F")), default="") for r in results}
    wanted = {cik: site for cik, site in sites.items() if (len(owners[site]) == 1 or ticker[cik]) and last_report[cik] >= CURRENT_SINCE}
    skipped = {cik: ("no 10-K, 10-Q or 20-F filed since " + CURRENT_SINCE + "; the website its last report names may have changed hands"
                     if last_report[cik] < CURRENT_SINCE else "website shared with co-registrants and no ticker of its own")
               for cik in sites if cik not in wanted}

    def one(item):
        cik, site = item
        return cik, *acquire(cik, site)

    logos = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for cik, logo, reason in pool.map(one, sorted(wanted.items())):
            if logo:
                logos[cik] = logo
            else:
                skipped[cik] = reason
    for cik in [r["cik"] for r in results if r["cik"] not in sites]:
        skipped[cik] = "no website of the company's own named in the annual report"
    for stale in PUBLIC.glob("*"):
        if stale.stem not in logos or logos[stale.stem]["path"] != f"/company-logos/{stale.name}":
            stale.unlink()
    (BUILD / "logos.json").write_text(json.dumps(logos, indent=1, sort_keys=True))
    (BUILD / "logos_skipped.json").write_text(json.dumps(skipped, indent=1, sort_keys=True))
    print("logos", len(logos), "skipped", len(skipped))
    from collections import Counter
    print(Counter(v.split(":")[0].split("(")[0].strip() for v in skipped.values()).most_common(8))


if __name__ == "__main__":
    main()
