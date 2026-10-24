"""Display objects built from the visual registry's own recorded fields (owner decision 2026-10-24: no licence
re-check; carry licence, licence URL, author, credit, source page, image URLs and sizes as recorded).

Renditions: for a Wikimedia Commons original (upload.wikimedia.org/wikipedia/commons/x/xy/Name) a thumbnail URL is
derived at a Wikimedia standard width (960, 500, 330) narrower than the recorded original width, with the height
scaled by MediaWiki's rule (round(height * width / original width)); SVG originals are rasterised by Wikimedia at
any standard width. Any other image keeps the URL as recorded (the registry thumbnail_url when present, else
image_url) with the recorded width and height. Only https URLs are used.

Automatic identity checks kept (not rights): the court_images ARTWORK title rule (a photograph of a sculpture is not
the building), demolished/former buildings (registry.py), https only.
"""
import re
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "court_images"))
from build_court_images import ARTWORK  # noqa: E402

STANDARD = (960, 500, 330)
DERIVABLE = re.compile(r"(?i)\.(jpe?g|png|gif|svg)$")


def https(url):
    try:
        p = urllib.parse.urlsplit(url or "")
    except ValueError:
        return None
    return url if p.scheme == "https" and p.netloc and not p.username and not p.password else None


def license_family(text):
    """public domain | cc0 | cc by | cc by-sa | other, read from the recorded licence text only."""
    t = " ".join((text or "").lower().split())
    if re.match(r"public domain\b", t):
        return "public domain"
    if re.match(r"cc0\b", t):
        return "cc0"
    if re.match(r"cc by-sa \d", t):
        return "cc by-sa"
    if re.match(r"cc by \d", t):
        return "cc by"
    return "other"


def is_deed(url):
    p = urllib.parse.urlsplit(url or "")
    return p.scheme == "https" and p.netloc == "creativecommons.org" and p.path.startswith(("/licenses/",
                                                                                          "/publicdomain/"))


def commons_original(url):
    """(hash path 'a/ab', file name) for an upload.wikimedia.org Commons original or thumbnail URL; else None."""
    p = urllib.parse.urlsplit(url or "")
    if p.netloc not in ("upload.wikimedia.org", "thumb.wikimedia.org"):
        return None
    parts = p.path.split("/")
    if len(parts) >= 6 and parts[1:3] == ["wikipedia", "commons"]:
        if parts[3] == "thumb" and len(parts) >= 7:
            return f"{parts[4]}/{parts[5]}", parts[6]
        if parts[3] != "thumb" and len(parts) == 6:
            return f"{parts[3]}/{parts[4]}", parts[5]
    return None


def commons_thumb(original_url, width):
    found = commons_original(original_url)
    if not found:
        return None
    path, name = found
    suffix = ".png" if name.lower().endswith(".svg") else ""
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/{name}/{width}px-{name}{suffix}"


def scaled_height(width, height, new_width):
    return max(1, int(round(height * new_width / width))) if width and height else None


def url_file_name(url):
    """The URL's file name with underscores read as spaces (so word rules see 'Mural lobby.jpg')."""
    return urllib.parse.unquote(urllib.parse.urlsplit(url or "").path.rsplit("/", 1)[-1]).replace("_", " ")


def file_title(asset):
    """The image's own title (Commons 'File:...' as recorded, else the image URL's file name)."""
    t = asset.get("source_title") or asset.get("file_title") or ""
    if t.startswith("File:"):
        return t
    return url_file_name(asset.get("image_url")) or t


def artwork(asset):
    """ARTWORK title rule on the recorded title and on the image file name."""
    texts = [file_title(asset), asset.get("source_title") or "", url_file_name(asset.get("image_url"))]
    return any(ARTWORK.search(t) for t in texts if t)


def renditions(asset, kind, image_url=None, width=None, height=None):
    """(display, thumb, basis) or (None, None, reason). kind: building | portrait | logo | mark."""
    image = https(image_url or asset.get("image_url"))
    if not image:
        return None, None, "image URL not https"
    w = width if width is not None else asset.get("original_width")
    h = height if height is not None else asset.get("original_height")
    vector = image.lower().split("?")[0].endswith(".svg")
    found = commons_original(image)
    if found and DERIVABLE.search(found[1]) and (vector or (isinstance(w, int) and isinstance(h, int))):
        top = 960 if kind == "building" else 500
        if vector:
            dw, tw = top, 330
            if not (isinstance(w, int) and isinstance(h, int)):
                return None, None, "SVG without a recorded size"
        else:
            dw = next((s for s in STANDARD if s <= top and w > s), None)
            tw = 330 if w > 330 else None
        if dw:
            display = {"url": commons_thumb(image, dw), "width": dw, "height": scaled_height(w, h, dw)}
            thumb = ({"url": commons_thumb(image, tw), "width": tw, "height": scaled_height(w, h, tw)}
                     if tw else dict(display))
            return display, thumb, "Wikimedia standard-width thumbnail; height scaled from the recorded size"
    if not (isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0):
        return None, None, "no recorded width and height"
    recorded = https(asset.get("thumbnail_url")) if image_url is None else None
    if found and recorded and recorded != image:
        # A recorded Commons thumbnail names its own standard width (".../1280px-Name" or "lossy-page1-1280px-");
        # its height follows MediaWiki's rule. Other hosts' thumbnails carry no recorded size and are not used.
        m = re.search(r"(?:/|-)(\d+)px-[^/]+$", urllib.parse.urlsplit(recorded).path)
        if m and int(m.group(1)) in (330, 500, 960, 1280, 1920) and int(m.group(1)) < w:
            tw = int(m.group(1))
            same = {"url": recorded, "width": tw, "height": scaled_height(w, h, tw)}
            return same, dict(same), "recorded thumbnail URL; height scaled from the recorded size"
    same = {"url": image, "width": w, "height": h}
    return same, dict(same), "image URL and size as recorded"


def author_of(asset):
    for k in ("author", "creator_credit"):
        v = (asset.get(k) or "").strip() if isinstance(asset.get(k), str) else ""
        if v:
            return v
    return None


def credit_of(asset):
    for k in ("credit", "credit_line", "creator_credit", "author"):
        v = (asset.get(k) or "").strip() if isinstance(asset.get(k), str) else ""
        if v:
            return v
    return None


def photo(asset, kind):
    """(photo dict, None) or (None, reason): the shared photo shape plus rights_status, from recorded fields."""
    if kind != "logo" and artwork(asset):
        return None, "photograph of an artwork (title names a sculpture, statue, mural, relief or fresco)"
    page = https(asset.get("source_page_url"))
    if not page:
        return None, "source page URL not https"
    display, thumb, basis = renditions(asset, kind)
    if not display:
        return None, basis
    licence = (asset.get("license") or "").strip() or "Not recorded"
    lurl = https(asset.get("license_url")) or None
    return {
        "file_page": page,
        "display": display,
        "thumb": thumb,
        "license": licence,
        "license_family": license_family(licence),
        "license_url": lurl,
        "license_url_is_deed": is_deed(lurl),
        "author": author_of(asset),
        "credit": credit_of(asset),
        "verified_at": asset.get("fetched_at") or None,
        "rights_status": asset.get("rights_status") or "Not recorded",
        "size_basis": basis,
        "image_url": https(asset.get("image_url")),
        "original": {"width": asset.get("original_width"), "height": asset.get("original_height"),
                     "mime": asset.get("mime") or None},
        "file": file_title(asset),
        "restrictions": asset.get("restrictions") or asset.get("other_restrictions") or None,
        "date": asset.get("photo_date") or asset.get("image_date") or None,
    }, None


def mark(asset):
    """(mark dict, None) or (None, reason): committee / agency mark shape plus rights_status, as recorded."""
    url = https(asset.get("image_url"))
    if not url:
        return None, "mark URL not https"
    w, h = asset.get("original_width"), asset.get("original_height")
    if not (isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0):
        return None, "no recorded width and height"
    page = https(asset.get("source_page_url"))
    policy = [p for p in asset.get("policy_evidence") or [] if https(p.get("url"))]
    policy_url = https(asset.get("license_url")) or https(asset.get("rights_evidence_url")) or (
        policy[0]["url"] if policy else None)
    evidence = asset.get("rights_evidence")
    quote = evidence if isinstance(evidence, str) and evidence.strip() else None
    notes = [x for x in (asset.get("special_emblem_restrictions"), asset.get("branding_context"),
                         asset.get("currentness")) if isinstance(x, str) and x.strip()]
    return {
        "url": url, "width": w, "height": h, "mime": asset.get("mime") or None, "source_page": page,
        "policy_url": policy_url, "policy_quote": quote, "branding_note": " ".join(notes) or None,
        "verified_at": asset.get("fetched_at") or None, "rights_status": asset.get("rights_status") or "Not recorded",
        "license": (asset.get("license") or "").strip() or "Not recorded",
        "license_family": license_family(asset.get("license")), "asset_type": asset.get("asset_type") or None,
    }, None
