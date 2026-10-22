"""Exact-key cross-references: companies (company_sec_profiles CIK) and courts (court_spine ids).

Company matching: the documented normalisation in extract.normalize_company must give exactly one registrant;
a key shared by two registrants is ambiguous and never linked. Court links use only ids present in the saved
court_spine lookup.
"""
import json
import os
from collections import defaultdict

import extract as ex

HERE = os.path.dirname(os.path.abspath(__file__))


class Companies:
    def __init__(self, path=os.path.join(HERE, "lookup_company_sec_profiles.json")):
        with open(path, encoding="utf-8") as handle:
            rows = json.load(handle)["rows"]
        keys = defaultdict(set)
        self.names = {}
        for cik, title in rows:
            if not cik.isdigit():
                continue
            self.names[cik] = title
            key = ex.normalize_company(title)
            if key:
                keys[key].add(cik)
        self.unique = {k: next(iter(v)) for k, v in keys.items() if len(v) == 1}
        self.ambiguous = {k: sorted(v) for k, v in keys.items() if len(v) > 1}
        self.stats = {"tried": 0, "matched": 0, "ambiguous": 0}

    def match(self, name):
        """{cik, registrant, method, key} or None. Ambiguous keys never match."""
        key = ex.normalize_company(name)
        if not key:
            return None
        self.stats["tried"] += 1
        if key in self.ambiguous:
            self.stats["ambiguous"] += 1
            return None
        cik = self.unique.get(key)
        if not cik:
            return None
        self.stats["matched"] += 1
        return {"cik": cik, "registrant": self.names[cik], "method": "exact normalised name equality", "key": key}


class Courts:
    def __init__(self, path=os.path.join(HERE, "lookup_court_spine_ids.json")):
        with open(path, encoding="utf-8") as handle:
            self.names = json.load(handle)["courts"]

    def valid(self, court_id):
        return court_id in self.names

    def name(self, court_id):
        return self.names.get(court_id)
