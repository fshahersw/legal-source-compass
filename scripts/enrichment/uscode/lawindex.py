"""Identity of enacted laws (Statutes at Large + PLAW) and exact-key resolution of Code citations to them.

Law ids: "stat-<volume>-<page>" from the Statutes at Large citation GovInfo prints (citableAs "118 Stat. 542"),
with "-2", "-3"... for later measures starting on the same page; "pl-<congress>-<number>" for a public law GovInfo
publishes in PLAW without a Statutes at Large page yet; "stat-<volume>-doc<n>" for a measure printed without a Stat.
citation (n = its position in the volume file).

Resolution (resolve_group) uses only keys printed in the citation, never names or similarity:
  /us/pl/<c>/<n>             public law number  -> laws carrying that number
  /us/act/<yyyy-mm-dd>/ch<n> act date + chapter -> laws enacted that day with that chapter number
  /us/stat/<v>/<p>           Statutes at Large page: alone, only a law that starts on that page; with a law key,
                             the law's pages must contain it (else the citation is "inconsistent")
Exactly one candidate resolves; none is "not_found"; several are "ambiguous". Unresolved citations are counted,
never guessed.
"""
import re
from collections import defaultdict

PL_REF = re.compile(r"^/us/pl/(\d{1,3})/(\d{1,4})(?:/|$)")
ACT_REF = re.compile(r"^/us/act/(\d{4}-\d{2}-\d{2})/ch(\d{1,4})(?:/|$)")
STAT_REF = re.compile(r"^/us/stat/(\d{1,3})/(\d{1,5})(?:/|$)")
USC_REF = re.compile(r"^/us/usc/t(\d{1,2}[a-zA-Z]?)/s([^/\s]+)")


def law_label(law):
    pl = law.get("public_law")
    if pl:
        return f"Pub. L. {pl['congress']}–{pl['number']}"
    if law.get("chapter") is not None and law.get("enacted"):
        return f"Act of {law['enacted']}, ch. {law['chapter']}"
    t = (law.get("type") or "Measure").strip()
    return f"{t} {law.get('doc_number') or ''}".strip()


def stat_label(law):
    s = law.get("stat")
    return f"{s['volume']} Stat. {s['page']}" if s else None


class LawIndex:
    def __init__(self, laws):
        self.laws = {law["id"]: law for law in laws}
        self.by_pl = defaultdict(list)
        self.by_act = defaultdict(list)
        self.by_stat_start = defaultdict(list)
        for law in laws:
            pl = law.get("public_law")
            if pl:
                self.by_pl[(pl["congress"], pl["number"])].append(law["id"])
            if law.get("chapter") is not None and law.get("enacted"):
                self.by_act[(law["enacted"], law["chapter"])].append(law["id"])
            if law.get("stat"):
                self.by_stat_start[(law["stat"]["volume"], law["stat"]["page"])].append(law["id"])

    def page_check(self, law_id, volume, page):
        """True when the cited Statutes at Large page lies within the law's printed pages, False when it cannot,
        None when GovInfo's file records no page for the law (no check possible)."""
        law = self.laws[law_id]
        s = law.get("stat")
        vol = s["volume"] if s else law.get("volume")
        if s:
            lo = s["page"]
        elif law.get("first_page"):
            lo = law["first_page"] - 1     # a measure may begin on the page before its first page break
        else:
            return None
        if vol != volume:
            return False
        hi = law.get("page_hi") or law.get("last_page")
        if hi is None:
            return page >= lo
        return lo <= page <= max(hi, lo)

    def resolve_group(self, refs, dates=()):
        """refs: [[href, printed]...] of one citation; dates: ISO dates printed in it.
        -> (law_id | None, method_or_reason)."""
        pl = act = stat = None
        for href, _ in refs:
            if pl is None and (m := PL_REF.match(href)):
                pl = (int(m.group(1)), int(m.group(2)))
            elif act is None and (m := ACT_REF.match(href)):
                act = (m.group(1), int(m.group(2)))
            elif stat is None and (m := STAT_REF.match(href)):
                stat = (int(m.group(1)), int(m.group(2)))
        dates = set(dates or ())
        if pl:
            cands, method = list(self.by_pl.get(pl, [])), "public law number"
        elif act:
            cands, method = list(self.by_act.get(act, [])), "act date and chapter"
        elif stat:
            # a Statutes at Large page alone resolves only to a law starting on it whose enactment date is printed too
            if not dates:
                return None, "stat_page_without_law_reference"
            cands = [c for c in self.by_stat_start.get(stat, []) if self.laws[c].get("enacted") in dates]
            if len(cands) == 1:
                return cands[0], "Statutes at Large start page + date"
            return None, "ambiguous" if cands else "not_found"
        else:
            return None, "no_law_reference"
        if not cands:
            return None, "not_found"
        if len(cands) == 1:
            if stat and self.page_check(cands[0], *stat) is False:
                return None, "inconsistent"
            return cands[0], method + (" + Stat. page" if stat else "")
        narrowed = cands
        if stat:
            narrowed = [c for c in cands if self.page_check(c, *stat)]
            method += " + Stat. page"
        if len(narrowed) != 1 and dates:
            narrowed = [c for c in (narrowed or cands) if self.laws[c].get("enacted") in dates]
            method += " + date"
        if len(narrowed) == 1:
            return narrowed[0], method
        return None, "ambiguous" if narrowed else "inconsistent"


def split_citation(items):
    """One printed citation may name several laws ("Pub. L. 90-206, § 225(l), as added Pub. L. 101-194, § 701(i),
    Nov. 30, 1989, 103 Stat. 1764"): each public-law or act reference opens a sub-citation, and the dates and
    Statutes at Large pages printed after it (before the next law reference) belong to it.
    items: [["ref", href, text] | ["date", iso]] in printed order -> [{"refs": [[href, text]], "dates": [...]}]."""
    subs, cur = [], None
    for it in items:
        if it[0] == "ref" and (PL_REF.match(it[1]) or ACT_REF.match(it[1])):
            cur = {"refs": [[it[1], it[2]]], "dates": []}
            subs.append(cur)
        elif it[0] == "ref" and STAT_REF.match(it[1]):
            if cur is None:
                cur = {"refs": [], "dates": []}
                subs.append(cur)
            cur["refs"].append([it[1], it[2]])
        elif it[0] == "date":
            if cur is None:
                cur = {"refs": [], "dates": []}
                subs.append(cur)
            cur["dates"].append(it[1])
    return [s for s in subs if s["refs"]]


def section_index(units_by_title):
    """{(title_key, section number with '-' for the en dash): unit id} for units OLRC identifies as sections."""
    out = {}
    dup = set()
    for tkey, units in units_by_title.items():
        for u in units:
            ident = u.get("identifier") or ""
            for one in ident.split(" "):
                m = re.fullmatch(r"/us/usc/t" + re.escape(tkey) + r"/s([^/\s]+)", one)
                if not m or "..." in m.group(1):
                    continue
                k = (tkey, m.group(1).replace("–", "-"))
                if k in out and out[k] != f"{tkey}:{u['key']}":
                    dup.add(k)
                out.setdefault(k, f"{tkey}:{u['key']}")
    for k in dup:
        out.pop(k, None)   # two units share the number: no exact target
    return out, dup


def usc_target(href, index):
    m = USC_REF.match(href)
    if not m:
        return None
    return index.get((m.group(1).lower(), m.group(2).replace("–", "-")))
