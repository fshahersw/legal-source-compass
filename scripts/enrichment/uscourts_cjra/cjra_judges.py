"""Judge identities across CJRA reports and strict matching to FJC judge profiles (judge_profiles_fjc).

Identity (never fuzzy): a judge row belongs to the identity (court id, folded surname, folded given names, suffix). Folding is
case-folding, accent stripping, and removal of periods/apostrophes/commas/hyphens as in cjra_parse.fold. The same person printed
with a different set of given names in another report (an added or dropped middle initial) is a different identity: it is not merged.

Profile link (only on a unique exact match): the FJC profile must be in the same court, the FJC name (suffix words removed) must end
with the CJRA surname words, the first given name must be equal, and the remaining given names must have the same initials in the
same order. Exactly one FJC profile may satisfy this; zero or several means no link. Magistrate judges are not in the FJC
directory, so they are never linked.
"""
import json
import re

import cjra_parse as P

SUFFIX_WORDS = P.SUFFIXES
ROMAN = {"II", "III", "IV", "V"}


def fold_words(text):
    return [w for w in P.fold(text).split(" ") if w]


def identity_key(court_id, name):
    """(court id, folded surname, folded given names, suffix) as a stable string, or None when the printed label is not 'SURNAME, GIVEN'."""
    if not name or name.get("format") != "surname_first":
        return None
    surname = " ".join(fold_words(name["surname"]))
    given = " ".join(fold_words(name["given"]))
    return f"{court_id}|{surname}|{given}|{name.get('suffix') or ''}"


def slug(key):
    return re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")


def smart_case(word):
    """Title-case an upper-case name word: McX, O'X, hyphenated parts, initials kept upper. Used only for unmatched, all-upper-case labels."""
    if not word:
        return word
    if re.fullmatch(r"[A-Z]\.?", word):
        return word
    out = []
    for part in word.split("-"):
        sub = []
        for piece in part.split("'"):
            p = piece.capitalize()
            if re.match(r"^Mc[a-z]", p):
                p = "Mc" + p[2:].capitalize()
            sub.append(p)
        out.append("'".join(sub))
    return "-".join(out)


def display_name(name, mixed_case_printed=None, fjc_name=None):
    """Display order 'Given Surname[ Suffix]'. Preference: FJC profile name (exact match), a mixed-case printed form, else title-cased."""
    if fjc_name:
        return fjc_name
    src = mixed_case_printed or name
    given, surname = src["given"], src["surname"]
    if not mixed_case_printed:
        given = " ".join(smart_case(w) for w in given.split(" "))
        surname = " ".join(smart_case(w) for w in surname.split(" "))
    suffix = src.get("suffix")
    suffix = (suffix.upper() if suffix and suffix.upper() in ROMAN else (suffix.capitalize() + "." if suffix else ""))
    return (f"{given} {surname}" + (f" {suffix}" if suffix else "")).strip()


def is_mixed_case(text):
    letters = re.sub(r"[^A-Za-z]", "", text or "")
    return bool(re.search(r"[a-z]", letters)) and bool(re.search(r"[A-Z]", letters))


class FjcIndex:
    """FJC profiles by court: [(tokens without suffix words, profile id, display name)]."""

    def __init__(self, lookup):
        self.by_court = {}
        for j in lookup["judges"]:
            toks = fold_words(j["name"])
            while toks and toks[-1] in SUFFIX_WORDS:
                toks.pop()
            if j["court"] and toks:
                self.by_court.setdefault(j["court"], []).append((toks, j["profile"], j["name"]))

    def match(self, court_id, name):
        """(profile id, fjc name) for a unique exact match, else (None, reason) with reason 'none', 'ambiguous' or 'unparsed'."""
        if not name or name.get("format") != "surname_first":
            return None, "unparsed"
        sur = fold_words(name["surname"])
        giv = fold_words(name["given"])
        if not sur or not giv:
            return None, "unparsed"
        hits = []
        for toks, profile, shown in self.by_court.get(court_id, []):
            if len(toks) < len(sur) + 1 or toks[-len(sur):] != sur:
                continue
            first = toks[:-len(sur)]
            if first[0] != giv[0]:
                continue
            if [w[0] for w in first[1:]] != [w[0] for w in giv[1:]]:
                continue
            hits.append((profile, shown))
        if len(hits) == 1:
            return hits[0], "unique"
        return None, ("ambiguous" if hits else "none")
