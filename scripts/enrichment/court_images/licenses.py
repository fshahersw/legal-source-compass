"""Parse stored Commons imageinfo responses and decide, from the file's own metadata, whether its licence is kept.

Kept: public domain, CC0, CC BY (any version or port) and CC BY-SA (any version or port). Everything else is excluded
with a reason: NC, ND, fair use / non-free, GFDL-only, other licences (e.g. "Attribution", "No restrictions"), files
that are missing, and files whose metadata states no licence.
"""
import gzip
import html
import json
import re

KEPT = ("public domain", "cc0", "cc by", "cc by-sa")


def plain(value):
    """HTML extmetadata value as plain text: tags removed, entities decoded, whitespace collapsed."""
    if value is None:
        return ""
    text = re.sub(r"(?is)<br\s*/?>", " ", str(value))
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    return " ".join(text.split())


def meta_value(ext, key):
    field = (ext or {}).get(key)
    return plain(field.get("value")) if isinstance(field, dict) else ""


def load_responses(paths):
    """{title -> page} across responses; titles the API normalised or redirected map to the final page as well."""
    pages, alias = {}, {}
    for path in paths:
        data = json.loads(gzip.open(path).read())
        query = data.get("query") or {}
        for n in query.get("normalized") or []:
            alias[n["from"]] = n["to"]
        for r in query.get("redirects") or []:
            alias[r["from"]] = r["to"]
        for page in query.get("pages") or []:
            pages[page["title"]] = page
    return pages, alias


def resolve(title, pages, alias):
    seen = set()
    while title in alias and title not in seen:
        seen.add(title)
        title = alias[title]
    return pages.get(title)


def licence_family(ext):
    """('public domain' | 'cc0' | 'cc by' | 'cc by-sa' | None, exclusion reason or None)."""
    short = meta_value(ext, "LicenseShortName")
    code = meta_value(ext, "License").lower()
    nonfree = meta_value(ext, "NonFree").lower()
    if nonfree in ("true", "1", "yes"):
        return None, "non-free / fair use"
    s = short.lower()
    if not short and not code:
        return None, "no licence stated in file metadata"
    if re.search(r"\bnc\b|-nc\b|noncommercial|non-commercial", s + " " + code):
        return None, "non-commercial (NC) licence"
    if re.search(r"\bnd\b|-nd\b|noderiv|no derivatives", s + " " + code):
        return None, "no-derivatives (ND) licence"
    if code == "cc0" or s in ("cc0", "cc0 1.0") or s.startswith("cc0 "):
        return "cc0", None
    if code.startswith("pd") or s == "public domain" or s.startswith("public domain"):
        return "public domain", None
    if re.fullmatch(r"cc-by-sa-\d(\.\d)?(-[a-z]{2,})?", code) or re.fullmatch(r"cc by-sa \d(\.\d)?( [a-z]{2,})?", s):
        return "cc by-sa", None
    if re.fullmatch(r"cc-by-\d(\.\d)?(-[a-z]{2,})?", code) or re.fullmatch(r"cc by \d(\.\d)?( [a-z]{2,})?", s):
        return "cc by", None
    if "gfdl" in s or "gfdl" in code:
        return None, "GFDL without a CC BY / CC BY-SA licence in the metadata"
    return None, f"other licence ({short or code})"


def file_facts(page):
    """The facts a kept row carries, read from one Commons page in the display pass; None if the page is unusable."""
    if not page or page.get("missing") or page.get("invalid") or not page.get("imageinfo"):
        return None
    info = page["imageinfo"][0]
    ext = info.get("extmetadata") or {}
    family, reason = licence_family(ext)
    artist = meta_value(ext, "Artist")
    credit = meta_value(ext, "Credit")
    return {
        "title": page["title"],
        "family": family,
        "exclusion": reason,
        "license": meta_value(ext, "LicenseShortName"),
        "license_code": meta_value(ext, "License"),
        "license_url": meta_value(ext, "LicenseUrl"),
        "artist": artist,
        "credit": credit,
        "attribution_required": meta_value(ext, "AttributionRequired").lower() == "true",
        "usage_terms": meta_value(ext, "UsageTerms"),
        "restrictions": meta_value(ext, "Restrictions"),
        "object_name": meta_value(ext, "ObjectName"),
        "date_original": meta_value(ext, "DateTimeOriginal"),
        "description_url": info.get("descriptionurl", ""),
        "original_url": info.get("url", ""),
        "width": info.get("width"),
        "height": info.get("height"),
        "mime": info.get("mime", ""),
        "sha1": info.get("sha1", ""),
        "timestamp": info.get("timestamp", ""),
        "display_url": info.get("thumburl", ""),
        "display_width": info.get("thumbwidth"),
        "display_height": info.get("thumbheight"),
    }


def thumb_facts(page):
    if not page or page.get("missing") or not page.get("imageinfo"):
        return None
    info = page["imageinfo"][0]
    return {"thumb_url": info.get("thumburl", ""), "thumb_width": info.get("thumbwidth"),
            "thumb_height": info.get("thumbheight")}
