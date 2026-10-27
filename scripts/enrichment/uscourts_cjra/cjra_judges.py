"""Judge identities across CJRA reports and strict matching to FJC judge profiles (judge_profiles_fjc).

Identity (never fuzzy): a judge row belongs to the identity (court id, folded surname, folded given names, suffix). Folding is
case-folding, accent stripping, and removal of periods/apostrophes/commas/hyphens as in cjra_parse.fold. The same person printed
with a different set of given names in another report (an added or dropped middle initial) is a different identity: it is not merged.

Profile link (only on a unique exact match): the FJC judge must have served in the same district court, the FJC name (suffix words
removed) must end with the CJRA surname words, the first given name must be equal, and the remaining given names must have the same
initials in the same order (digits printed after a name are footnote markers and are ignored). Where both names print a suffix
(Jr., Sr., III) the suffixes must be equal. A judge whose service in the court ended more than a year before the record's first
listing never matches; when several FJC judges still match, only those whose service overlaps the listings are kept. Exactly one FJC
judge may remain; zero or several means no link. Every FJC judge counts, whatever the current status (active, chief, senior, service
ended). An FJC judge is one judge however many directory profiles or services it has: the /judges profile is the single profile the
FJC directory and the directory record's own FJC bridge (judge_cl_crosswalk.fjc_nid) both name (lookup_from_snapshots). Magistrate
judges are not in the FJC directory; a magistrate judge row links only when the same person later served as a district judge of the
same court under the same name.
"""
import re
from datetime import date

import cjra_parse as P

SUFFIX_WORDS = P.SUFFIXES
ROMAN = {"II", "III", "IV", "V"}
# judge_cl_crosswalk tiers that publish the directory record's FJC bridge as not linked (same set as judges_cross/common.py)
UNLINKED_BRIDGE_TIERS = frozenset({"withheld_for_review", "fjc_conflict", "date_conflict"})
PROFILE_LINK_TEXT = {
    "unique": "Exact unique match to an FJC judge profile in the same court",
    "none": "No FJC profile in this court matched the name exactly",
    "ambiguous": "More than one FJC profile in this court matched; not linked",
    "no_profile": "One FJC judge of this court matched, but no judge profile is established for that FJC judge; not linked",
    "unparsed": "Printed name not in 'SURNAME, GIVEN' form; not linked",
}
PROFILE_LINKS_SUMMARY = ("linked to /judges/<id> (item.match.profile and filters.judge_profile) only when exactly one FJC judge who served in the same "
                         "district court (any status: active, chief, senior or service ended) matches the surname, the first given name and the middle "
                         "initials, with no contradicting suffix and a service that does not end more than a year before the first listing; several "
                         "matching FJC judges are told apart only by service dates overlapping the listings; one FJC judge is one profile")


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


def _date(text):
    """'YYYY-MM-DD' (or a longer ISO string) -> date, else None."""
    if not text or not re.match(r"^\d{4}-\d{2}-\d{2}", str(text)):
        return None
    return date.fromisoformat(str(text)[:10])


def name_suffix(words):
    """(words without trailing suffix words, the last printed suffix word or None)."""
    words = list(words)
    suffix = None
    while words and words[-1] in SUFFIX_WORDS:
        suffix = suffix or words[-1]
        words.pop()
    return words, suffix


def lookup_from_snapshots(fjc_rows, crosswalk_rows):
    """FJC lookup for the CJRA matcher, built from read-only corpus snapshots.

    fjc_rows: judge_profiles_fjc rows {nid, name, status, profiles: [/judges id], services: [{court_id, court_type, commission, termination}]}
    crosswalk_rows: judge_cl_crosswalk rows {judges_id, fjc_nid, tier} (the directory record's own FJC bridge, native ids only); a row whose
    tier publishes the bridge as not linked (withheld_for_review, fjc_conflict, date_conflict) is ignored

    Every FJC judge is included whatever the current status (active, chief, senior, service ended), with one entry per U.S. District
    Court service. The /judges profile of an FJC nid is the profile the two sources name; a nid named with two different profiles, or a
    profile claimed by two nids, is left without a profile (the judge can still be matched, which blocks a wrong link, but is never linked)."""
    by_nid = {}
    conflicts = set()

    def claim(nid, profile):
        if not nid or not profile:
            return
        if by_nid.get(nid, profile) != profile:
            conflicts.add(nid)
        by_nid[nid] = profile

    for f in fjc_rows:
        profiles = sorted(set(f.get("profiles") or []))
        if len(profiles) > 1:
            conflicts.add(f["nid"])
        for p in profiles:
            claim(f["nid"], p)
    for x in crosswalk_rows:
        if x.get("tier") in UNLINKED_BRIDGE_TIERS:
            continue  # the crosswalk publishes this bridge as not linked: never evidence that the nid and the profile are one judge
        claim(x.get("fjc_nid"), x.get("judges_id"))
    owners = {}
    for nid, p in by_nid.items():
        owners.setdefault(p, set()).add(nid)
    for nids in owners.values():
        if len(nids) > 1:
            conflicts.update(nids)
    judges = []
    for f in sorted(fjc_rows, key=lambda r: r["nid"]):
        profile = None if f["nid"] in conflicts else by_nid.get(f["nid"])
        for s in f.get("services") or []:
            if s.get("court_type") != "U.S. District Court" or not s.get("court_id"):
                continue
            judges.append({"nid": f["nid"], "profile": profile, "court": s["court_id"], "level": ["district"], "name": f["name"], "status": f.get("status"),
                           "commission": s.get("commission"), "termination": s.get("termination")})
    return {"judges": judges, "profile_conflicts": sorted(conflicts)}


class FjcIndex:
    """FJC district-court services by court: name tokens, printed suffix, FJC nid, /judges profile, display name and service dates.

    Several lookup entries of one FJC nid (two services in one court, or two directory profiles of one FJC judge) count as one judge;
    entries without a nid are keyed by their profile id."""

    GRACE_DAYS = 366  # a judge may still be printed on the first report after leaving the court

    def __init__(self, lookup):
        self.by_court = {}
        for j in lookup["judges"]:
            toks, suffix = name_suffix(fold_words(j["name"]))
            if j["court"] and toks:
                self.by_court.setdefault(j["court"], []).append({
                    "toks": toks, "suffix": suffix, "key": j.get("nid") or j.get("profile"), "profile": j.get("profile"), "name": j["name"],
                    "start": _date(j.get("commission")), "end": _date(j.get("termination"))})

    @staticmethod
    def _given(name):
        # digits printed after a given name are footnote markers, never part of the name
        return [w for w in fold_words(name["given"]) if not w.isdigit()]

    def match(self, court_id, name, listed=None):
        """((profile id, fjc name), 'unique') for a unique exact match, else (None, reason) with reason 'none', 'ambiguous', 'unparsed'
        or 'no_profile' (exactly one FJC judge matches but no /judges profile is established for it).

        listed: the report dates ('YYYY-MM-DD') the CJRA record is printed in. When given, a service that ended more than a year before
        the first listing never matches, and when several FJC judges match by name only those whose service in the court overlaps the
        listings are kept (a father and son of one name in one court are told apart by their dates, never guessed)."""
        if not name or name.get("format") != "surname_first":
            return None, "unparsed"
        sur = fold_words(name["surname"])
        giv = self._given(name)
        suffix = (name.get("suffix") or "").upper().replace(".", "") or None
        if not sur or not giv:
            return None, "unparsed"
        dates = sorted(d for d in (_date(p) for p in (listed or [])) if d)
        first, last = (dates[0], dates[-1]) if dates else (None, None)
        hits = {}
        for e in self.by_court.get(court_id, []):
            toks = e["toks"]
            if len(toks) < len(sur) + 1 or toks[-len(sur):] != sur:
                continue
            given = toks[:-len(sur)]
            if given[0] != giv[0]:
                continue
            if [w[0] for w in given[1:]] != [w[0] for w in giv[1:]]:
                continue
            if suffix and e["suffix"] and suffix != e["suffix"]:
                continue  # both names print a suffix and they differ: a different person
            if first and e["end"] and (first - e["end"]).days > self.GRACE_DAYS:
                continue
            hits.setdefault(e["key"], []).append(e)
        if len(hits) > 1 and first:
            hits = {k: v for k, v in hits.items()
                    if any((e["start"] is None or e["start"] <= last) and (e["end"] is None or e["end"] >= first) for e in v)}
        if not hits:
            return None, "none"
        if len(hits) > 1:
            return None, "ambiguous"
        entries = next(iter(hits.values()))
        profiles = {e["profile"] for e in entries}
        if profiles == {None}:
            return None, "no_profile"
        if len(profiles) != 1:
            return None, "ambiguous"
        return (entries[0]["profile"], entries[0]["name"]), "unique"


