"""Shared, pure helpers for the third_party_data stream (no network, no I/O beyond what callers pass in)."""
import os
import re
import unicodedata
import urllib.parse


def atomic_write(path, text):
    """Write text through a temp file in the same directory and an atomic rename, so a full disk or a crash never leaves a truncated file."""
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# Owner decision 2026-10-18: no PUBLISHED field may name or point to the compilations the datasets were derived from.
# These names live only in private files (private/acq manifests, private/build REPORT.md) and in this stream's code.
FORBIDDEN_SUBSTRINGS = ("settlesignal", "settle signal", "settle-signal", "goodjobsfirst", "good jobs first", "goodjobs",
                        "violation tracker", "violationtracker", "violation-tracker", "advottic", "gjf")
FORBIDDEN_HOSTS = ("settlesignal.com", "goodjobsfirst.org", "violationtracker.goodjobsfirst.org", "advottic.com")
# Multi-word names are also checked with whitespace, '_', '.' and '-' removed ("Settle_Signal", "Good-Jobs  First", "Violation. Tracker").
FORBIDDEN_COMPACT = ("settlesignal", "goodjobsfirst", "violationtracker", "advottic")
_INVISIBLE = dict.fromkeys(map(ord, "­​‌‍⁠﻿"), None)


def _fold(text):
    return unicodedata.normalize("NFKC", text).translate(_INVISIBLE).casefold()


def forbidden_in_text(text):
    """First forbidden name found in text (case-insensitive substring, NFKC, invisible characters dropped), else None."""
    folded = _fold(str(text))
    for name in FORBIDDEN_SUBSTRINGS:
        if name in folded:
            return name
    compact = re.sub(r"[\s_.\-]+", "", folded)  # only whitespace, '_', '.' and '-' are treated as separators, so "violation; tracker" is not a hit
    for name in FORBIDDEN_COMPACT:
        if name in compact:
            return name
    return None


def forbidden_host(host):
    host = (host or "").lower().strip(".")
    return next((h for h in FORBIDDEN_HOSTS if host == h or host.endswith("." + h)), None)


def forbidden_in_url(url):
    """Forbidden host (or name inside the URL), else None."""
    parts = urllib.parse.urlparse(str(url or "").strip())
    return forbidden_host(parts.hostname) or forbidden_in_text(url)


def find_forbidden(obj, path="$"):
    """Yield (path, kind, offending_text) for every forbidden name or host in dict KEYS and string VALUES, recursively."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            hit = forbidden_in_text(key)
            if hit:
                yield f"{path}.{key}", "key", hit
            yield from find_forbidden(value, f"{path}.{key}")
    elif isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            yield from find_forbidden(value, f"{path}[{index}]")
    elif isinstance(obj, str):
        hit = forbidden_in_url(obj) if obj.lower().startswith(("http://", "https://", "//")) else forbidden_in_text(obj)
        if hit:
            yield path, "value", hit


def public_wording(text):
    """Reword a private reviewer note so it no longer names the compilation (the evidence itself is untouched)."""
    if text is None:
        return None
    out = re.sub(r"\bthe SettleSignal title\b", "the compiled title", text, flags=re.I)
    out = re.sub(r"\bSettleSignal['’]s\b", "the compilation's", out, flags=re.I)
    out = re.sub(r"\bSettleSignal\b", "the compilation", out, flags=re.I)
    out = out.replace(" (the first build mis-levelled it as state; vt_parse.level_of now returns local)", "")
    return out.replace(" under private/acq", "")

MONEY = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(million|billion|M|B)\b)?", re.I)
CAPTION = re.compile(r"^(?P<p>[^()]+?)\s+v(?:s)?\.?\s+(?P<d>[^()]+?)$", re.I)
PAREN = re.compile(r"\(([^()]*\bv(?:s)?\.?\s[^()]*)\)")
AGGREGATOR_HOSTS = {"claimdepot.com", "topclassactions.com", "classaction.org", "openclassactions.com", "classactionrebates.com",
                    "settlementclaims.org", "lawsuitlegit.com"}
WIRE_HOSTS = {"prnewswire.com", "globenewswire.com", "businesswire.com", "accesswire.com", "einpresswire.com"}
ORG_HOSTS = {"nylag.org", "maldef.org", "ppsl.org", "lsccounsel.com"}
COMPANY_HOSTS = {"subscribe.rollingstone.com"}
SOURCE_CLASS_LABELS = {
    "government": "Government page (agency refund / enforcement)",
    "court": "Court page",
    "settlement_website": "Settlement website (administrator / settlement-specific site)",
    "press_release": "Press release (wire service)",
    "counsel_or_org": "Class counsel or organisation page",
    "company_page": "Company page",
    "aggregator": "Third-party aggregator (not a primary source)",
    "none": "No source URL",
}


def host_of(url):
    host = urllib.parse.urlparse(url or "").netloc.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def source_class(url):
    """Deterministic class of a cited source URL by host (documented lists above)."""
    host = host_of(url)
    if not host:
        return "none"
    if host in AGGREGATOR_HOSTS:
        return "aggregator"
    if host in WIRE_HOSTS:
        return "press_release"
    if host.endswith("uscourts.gov") or ".courts." in host or host.startswith("courts."):
        return "court"
    if host.endswith(".gov") or host.endswith(".mil") or host.endswith(".us"):
        return "government"
    if host in ORG_HOSTS:
        return "counsel_or_org"
    if host in COMPANY_HOSTS:
        return "company_page"
    return "settlement_website"


def money_values(text):
    values = []
    for whole, cents, scale in MONEY.findall(text or ""):
        number = float(whole.replace(",", "") + ("." + cents if cents else ""))
        if scale:
            number *= 1e9 if scale.lower() in ("billion", "b") else 1e6
        values.append(round(number, 2))
    return values


def norm_title(text):
    text = unicodedata.normalize("NFKC", text or "").replace("’", "'").replace("‘", "'").casefold()
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"[^\w$&' ]+", " ", text)
    return " ".join(text.split())


def norm_url(url):
    """Lower-case scheme/host, drop 'www.', default ports, fragment and trailing slash; keep path and query."""
    if not url:
        return ""
    parts = urllib.parse.urlparse(url.strip())
    path = parts.path.rstrip("/")
    query = ("?" + parts.query) if parts.query else ""
    return host_of(url) + path + query


def caption(title):
    """'Polk v. American Well Corp.' (whole title or a parenthetical) -> ('Polk', 'American Well Corp.'), else None."""
    title = " ".join((title or "").split())
    match = PAREN.search(title)
    candidate = match.group(1) if match else title
    cap = CAPTION.match(candidate.strip())
    if not cap:
        return None
    return cap.group("p").strip(" ,"), cap.group("d").strip(" ,")


def norm_company(name):
    """Documented normalisation for exact company matching: NFKC, casefold, '&amp;'->'&', drop '.' and ',', collapse spaces.
    No abbreviation expansion, no suffix removal, no fuzzy matching."""
    text = unicodedata.normalize("NFKC", name or "").replace("&amp;", "&").casefold()
    text = text.replace(".", "").replace(",", "")
    return " ".join(text.split())


def exact_company(name, index):
    """Return (cik, status) where status is matched | no_match | ambiguous. index: normalised name -> [cik, ...]."""
    key = norm_company(name)
    if not key:
        return None, "no_name"
    ciks = index.get(key, [])
    if len(ciks) == 1:
        return ciks[0], "matched"
    if len(ciks) > 1:
        return None, "ambiguous"
    return None, "no_match"


def tokens(text):
    return {t for t in norm_title(text).split() if len(t) > 2}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def deadline_state(deadline, as_of):
    if not deadline:
        return "unknown"
    if deadline < as_of:
        return "passed"
    from datetime import date
    days = (date.fromisoformat(deadline) - date.fromisoformat(as_of)).days
    return "within_30_days" if days <= 30 else "future"
