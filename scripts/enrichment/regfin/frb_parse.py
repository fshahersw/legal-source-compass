"""Parse the Federal Reserve Board enforcement-actions lists.

Inputs are the files the public search page itself loads (https://www.federalreserve.gov/supervisionreg/files/):
ea-cms-recent.json and ea-old.json ({"eaitems": [...]}) with stable ids, and enforcementactions.csv (the same rows
without ids, used as a second path to check the JSON). Fields keep the Board's wording (Data Definitions page):
Effective Date, Termination Date, Individual, Individual Affiliation, Banking Organization, Action, URL, Name, Note.
A termination date of 1950-01-01 in the JSON is the Board's placeholder for "none published" and becomes None.
"""
import csv
import html
import io
import json
import re

import names

BOARD = "https://www.federalreserve.gov"
PLACEHOLDER_TERMINATION = "1950-01-01"

# Type families, first keyword in the Board's type text wins. Labels are ours; `type` itself stays as published.
TYPE_FAMILIES = [
    ("Written agreements", re.compile(r"written agreement", re.I)),
    ("Cease-and-desist and consent orders", re.compile(r"cease and desist|consent order", re.I)),
    ("Civil money penalties", re.compile(r"civil money penalty", re.I)),
    ("Prohibitions and suspensions", re.compile(r"prohibition|suspension", re.I)),
    ("Section 19 letters", re.compile(r"section 19", re.I)),
    ("Prompt corrective action", re.compile(r"prompt corrective action", re.I)),
    ("Notices of intent", re.compile(r"notice of intent", re.I)),
    ("Amendments and modifications", re.compile(r"amendment|modification", re.I)),
]
OTHER_FAMILY = "Other order types"
FAMILY_LABELS = [f for f, _ in TYPE_FAMILIES] + [OTHER_FAMILY]


def type_family(action_type):
    """Family of the earliest-mentioned action name in the Board's type text (combinations count once, under the first)."""
    best, best_pos = OTHER_FAMILY, None
    for label, rx in TYPE_FAMILIES:
        m = rx.search(action_type or "")
        if m and (best_pos is None or m.start() < best_pos):
            best, best_pos = label, m.start()
    return best


def absolute_url(url):
    """Board-relative links become absolute https URLs; anything not http(s) or site-relative becomes None."""
    u = (url or "").strip()
    if not u:
        return None
    if u.startswith("//"):
        u = "https:" + u
    if u.startswith("/"):
        return BOARD + u
    return u if re.match(r"https?://", u, re.I) else None


def unresolved_url(url):
    """The Board's URL text when it is present but cannot be used as a link (not http(s), not site-relative), else None.
    The Board writes 'DNE' (does not exist) for actions that have no document; that is 'no link', not a value."""
    u = (url or "").strip()
    if not u or u.upper() == "DNE" or absolute_url(u):
        return None
    return u


_A_TAG = re.compile(r"<a\s+[^>]*href=(['\"])(.*?)\1[^>]*>(.*?)</a>", re.I | re.S)
_ANY_TAG = re.compile(r"<[^>]+>")


def note_parts(note):
    """The Board's Note may carry an <a> link. Returns (plain_text, [{label, url}]) with tags removed, links kept apart."""
    raw = note or ""
    links = []
    for m in _A_TAG.finditer(raw):
        url = absolute_url(html.unescape(m.group(2)))
        label = names.clean_space(html.unescape(_ANY_TAG.sub("", m.group(3))))
        if url and label:
            links.append({"label": label, "url": url})
    text = names.clean_space(html.unescape(_ANY_TAG.sub("", _A_TAG.sub(lambda m: m.group(3), raw))))
    return (text or None), links


def organizations(text):
    """Split the Board's organization string into segments with the legal name and 'City, State' location separated."""
    out = []
    for seg in names.split_organizations(text):
        name, loc = names.org_name_without_location(seg)
        out.append({"as_written": seg, "name": name, "location": loc, "key": names.normalize_company(name)})
    return out


def load_json(path):
    with open(path, encoding="utf-8-sig") as handle:
        return json.load(handle)["eaitems"]


def action_from_item(item):
    """One JSON item -> structured action. Raises ValueError for an item without id, effective date or type."""
    def text(key):
        # The Board's recent-actions JSON carries HTML entities (&amp;) that its CSV does not; both decode to the same text.
        return names.clean_space(html.unescape(item.get(key) or ""))

    aid = str(item.get("id") or "").strip()
    edt = (item.get("edt") or "").strip()
    typ = text("type")
    if not aid or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", edt) or not typ:
        raise ValueError(f"unusable Board item: {item!r}")
    tdt = (item.get("tdt") or "").strip()
    terminated = tdt if re.fullmatch(r"\d{4}-\d{2}-\d{2}", tdt) and tdt != PLACEHOLDER_TERMINATION else None
    individual = text("person") or None
    note_text, note_links = note_parts(item.get("note"))
    return {
        "id": aid,
        "effective_date": edt,
        "year": edt[:4],
        "termination_date": terminated,
        "type": typ,
        "type_family": type_family(typ),
        "subject": "individual" if individual else "organization",
        "individual": individual,
        "individual_affiliation": text("porg") or None,
        "banking_organization": text("bkorg") or None,
        "organizations": organizations(text("bkorg")),
        "affiliations": organizations(text("porg")),
        "url": absolute_url(html.unescape(item.get("url") or "")),
        "url_unresolved": unresolved_url(html.unescape(item.get("url") or "")),
        "url_label": text("urlname") or None,
        "note": note_text,
        "note_links": note_links,
    }


def csv_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(io.StringIO(handle.read())))


def _q(value):
    """The Board's CSV writes an embedded double quote as a single quote; compare with both as single quotes."""
    return value.replace('"', "'") if isinstance(value, str) else value


def csv_signature(row):
    """Comparable tuple for a CSV row (second path): the same fields the JSON item carries, in the Board's wording."""
    term = (row.get("Termination Date") or "").strip() or None
    return tuple(
        _q(v)
        for v in (
            (row.get("Effective Date") or "").strip(),
            term,
            names.clean_space(row.get("Individual")) or None,
            names.clean_space(row.get("Individual Affiliation")) or None,
            names.clean_space(row.get("Banking Organization")) or None,
            names.clean_space(row.get("Action")),
            absolute_url(row.get("URL")),
            names.clean_space(row.get("Name")) or None,
        )
    )


def action_signature(action):
    return tuple(
        _q(v)
        for v in (
            action["effective_date"],
            action["termination_date"],
            action["individual"],
            action["individual_affiliation"],
            action["banking_organization"],
            action["type"],
            action["url"],
            action["url_label"],
        )
    )
