"""Exact-key matching of published names to existing records. Nothing here is fuzzy.

Agencies: an Inspector General's published name ("Department of Justice OIG") is matched to a Federal Register agency
record only when both reduce to the same key under the documented normalisation below and exactly one agency has that
key. A key shared by two agencies is ambiguous and never linked; a name with no agency of the same key stays unlinked.

  agency_key(name):
    1. casefold; "&" -> "and"; drop punctuation ( . , ' ( ) ); hyphens and slashes become spaces; collapse spaces
    2. drop a trailing inspector-general marker: "oig", "office of inspector general", "office of the inspector general"
    3. drop a leading "the", then a leading "u s" / "us" / "united states" (the Federal Register writes "Postal Service",
       "Agency for International Development"; the OIG directory writes "U.S. Postal Service")
    4. "department of (the) X" -> "x department" (the Federal Register's form for cabinet departments)

Companies: the same normalisation the existing enforcement builders use (enforcement_actions/extract.normalize_company).
"""
import re
from collections import defaultdict

_PUNCT = re.compile(r"[.,'’()]")
_SEP = re.compile(r"[-/]")
_WS = re.compile(r"\s+")
_OIG_TAIL = re.compile(r"\s+(?:oig|office of (?:the )?inspector general)$")


def agency_key(name):
    if not name:
        return ""
    s = name.casefold().replace("&amp;", "&").replace("&", " and ")
    s = _PUNCT.sub("", s)
    s = _SEP.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    s = _OIG_TAIL.sub("", s)
    if s.startswith("the "):
        s = s[4:]
    for prefix in ("united states ", "us "):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    m = re.fullmatch(r"department of (?:the )?(.+)", s)
    if m:
        s = f"{m.group(1)} department"
    return s


class Agencies:
    """FR agency lookup: key -> id for keys held by exactly one agency."""

    def __init__(self, rows):
        by_key = defaultdict(set)
        self.titles = {}
        for agency_id, title in rows:
            agency_id = str(agency_id)
            self.titles[agency_id] = title
            key = agency_key(title)
            if key:
                by_key[key].add(agency_id)
        self.unique = {k: next(iter(v)) for k, v in by_key.items() if len(v) == 1}
        self.ambiguous = {k: sorted(v) for k, v in by_key.items() if len(v) > 1}
        self.stats = {"names_tried": 0, "matched": 0, "ambiguous": 0, "unmatched": 0}
        self._cache = {}

    def match(self, name):
        """{id, title, key} for an exact unique key match, else None. Stats count each distinct name once."""
        if name in self._cache:
            return self._cache[name]
        result = self._match(name)
        self._cache[name] = result
        return result

    def _match(self, name):
        key = agency_key(name)
        if not key:
            return None
        self.stats["names_tried"] += 1
        if key in self.ambiguous:
            self.stats["ambiguous"] += 1
            return None
        agency_id = self.unique.get(key)
        if agency_id is None:
            self.stats["unmatched"] += 1
            return None
        self.stats["matched"] += 1
        return {"id": agency_id, "title": self.titles[agency_id], "key": key}


class Companies:
    """SEC registrant lookup on the existing exact key (enforcement_actions.extract.normalize_company).

    A name matches only when its key equals the key of exactly one registrant; a key shared by two registrants is
    ambiguous and never links. Names are never compared by similarity."""

    def __init__(self, rows, normalize):
        self.normalize = normalize
        by_key = defaultdict(set)
        self.names = {}
        for cik, title in rows:
            if not str(cik).isdigit():
                continue
            self.names[str(cik)] = title
            key = normalize(title)
            if key:
                by_key[key].add(str(cik))
        self.unique = {k: next(iter(v)) for k, v in by_key.items() if len(v) == 1}
        self.ambiguous = {k: sorted(v) for k, v in by_key.items() if len(v) > 1}
        self.stats = {"tried": 0, "matched": 0, "ambiguous": 0}

    def match(self, name):
        key = self.normalize(name)
        if not key:
            return None
        self.stats["tried"] += 1
        if key in self.ambiguous:
            self.stats["ambiguous"] += 1
            return None
        cik = self.unique.get(key)
        if cik is None:
            return None
        self.stats["matched"] += 1
        return {"cik": cik, "registrant": self.names[cik], "key": key, "method": "exact normalised name equality"}
