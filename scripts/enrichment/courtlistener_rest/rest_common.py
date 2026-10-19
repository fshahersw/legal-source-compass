"""Shared paths, lookups and small pure helpers for the courtlistener_rest builders (no DuckDB import here, safe to unit-test)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CL_DIR = os.path.join(ROOT, "scripts", "enrichment", "courtlistener")
for p in (HERE, CL_DIR, os.path.join(ROOT, "scripts", "enrichment"), os.path.join(ROOT, "private", "scratch", "pylib")):
    if p not in sys.path:
        sys.path.insert(0, p)

import clb_common as cc  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
OUT = os.path.join(ROOT, "private", "build", "courtlistener_rest")
LOOK = os.path.join(OUT, "lookups")
CLB_BUILD = os.path.join(ROOT, "private", "build", "courtlistener")
SPINE = os.path.join(ROOT, "private", "build", "fjc_idb", "lookups", "court_spine.json")
TERMS = "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page."
BULK = cc.BULK_BASE
BANKRUPTCY_URL = BULK + "randoms/bankruptcy-dockets-2022-09-19.csv.bz2"
UNMATCHED_URL = BULK + "unmatched-citations-2026-09-30.csv.bz2"
PAREN_URL = BULK + "parentheticals-2026-09-30.csv.bz2"
ORAL_URL = BULK + "oral-arguments-2026-09-30.csv.bz2"
DOCKETS_URL = BULK + "dockets-2026-09-30.csv.bz2"
ORIGIN_URL = BULK + "originating-court-information-2026-09-30.csv.bz2"
PANEL_URL = BULK + "search_opinioncluster_panel-2026-09-30.csv.bz2"
JOINED_URL = BULK + "search_opinion_joined_by-2026-09-30.csv.bz2"
CLUSTERS_URL = BULK + "opinion-clusters-2026-09-30.csv.bz2"
OPINIONS_URL = BULK + "opinions-2026-09-30.csv.bz2"
COURTS_URL = BULK + "courts-2026-09-30.csv.bz2"
PEOPLE_URL = BULK + "people-db-people-2026-09-30.csv.bz2"
FD_URL = BULK + "financial-disclosures-2026-09-30.csv.bz2"

# Published id sets these builders link to, checked against the live catalog on 2026-10-19 with a read-only query:
# SELECT dataset, count(*), md5(string_agg(id, ',' ORDER BY id COLLATE "C")) FROM corpus_records WHERE dataset IN (...) GROUP BY dataset
PUBLISHED_IDS = {
    "clb_judge_dockets": (7362, "7654ff3fa3472c36c19e978d47be9257"),
    "clb_top_cited": (1000, "e4c6bcaf18bd6310b32035bb7a6a9c72"),
    "clb_court_profiles": (2768, "f28e7197001d811446f6a96e6b0a3009"),
}

# CourtListener's own names for the stored codes (constants in its source code, cl/citations/models.py and cl/search/models.py,
# read 2026-10-19). The labels below restate those constant names and their help text in plain words.
CITATION_TYPE_LABEL = {
    1: "Federal reporter", 2: "State reporter", 3: "Regional reporter", 4: "Specialty reporter", 5: "Early Supreme Court reporter",
    6: "LEXIS citation", 7: "Westlaw citation", 8: "Neutral (public-domain) citation", 9: "Journal",
}
UNMATCHED_STATUS_LABEL = {
    1: "Not in CourtListener's citation table",
    2: "Now in the citation table; citing opinion not yet relinked",
    3: "Resolved: now matched and relinked",
    4: "Failed: matches more than one opinion cluster",
    5: "Failed: could not be resolved",
}
# Status codes that mean the citation is still unresolved in this snapshot (1 not found, 4 ambiguous, 5 failed); 2 is found but not yet relinked.
UNRESOLVED_STATUSES = (1, 4, 5)

# PACER case-type code inside a bankruptcy docket number (office:yy-tt-nnnnn), shown as recorded.
DN_TYPE_LABEL = {"bk": "bk (bankruptcy case)", "ap": "ap (adversary proceeding)", "mp": "mp (miscellaneous proceeding)", "none": "No case-type code in the number"}


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def fmt_int(n) -> str | None:
    return None if n is None else f"{int(n):,}"


def pct_text(part, whole, digits: int = 1) -> str | None:
    s = cc.share(part, whole, digits)
    return None if s is None else f"{s}%"


def quantiles(q) -> dict | None:
    """DuckDB list [p10, p25, p50, p75, p90] (or [p25, p50, p75, p90]) -> rounded dict; None when missing."""
    if not q:
        return None
    keys = ["p10", "p25", "p50", "p75", "p90"] if len(q) == 5 else ["p25", "p50", "p75", "p90"]
    if any(v is None for v in q):
        return None
    return {k: cc.r1(float(v)) for k, v in zip(keys, q)}


def ids_digest(ids) -> str:
    return hashlib.md5(",".join(sorted(ids)).encode()).hexdigest()


def published_ids(dataset: str) -> set[str]:
    """Record ids of a published clb_* dataset, read from its build file and accepted only when count and digest equal the live catalog's."""
    path = os.path.join(CLB_BUILD, dataset + ".json")
    ids = {r["id"] for r in json.load(open(path))["rows"]}
    n, digest = PUBLISHED_IDS[dataset]
    if len(ids) != n or ids_digest(ids) != digest:
        raise SystemExit(f"{dataset}: build file ids differ from the published ids (count {len(ids)} vs {n}); refresh the lookup")
    return ids


def spine_ids() -> set[str]:
    return set(json.load(open(SPINE))["ids"])


def court_link(cid, spine: set[str]):
    return f"/courts/{cid}" if cid and cid in spine else None


def judge_record_link(pid, judge_ids: set[str]):
    """/records/clb_judge_dockets/<person id>, only when that exact id is a published record."""
    return f"/records/clb_judge_dockets/{pid}" if pid is not None and str(pid) in judge_ids else None


def write(spec_by_id: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    for ds, spec in spec_by_id.items():
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")


def split_names(judges: str | None) -> list[str]:
    """Split a recorded panel string ("Kozinski, W. Fletcher, and Bybee") into names as written; empty parts and a leading "and "
    (the serial comma case) dropped. Mirrors the SQL in build_rest_work (step oa)."""
    if not judges:
        return []
    parts = re.split(r"\s*(?:,|;|&|\sand\s)\s*", judges)
    out = []
    for p in parts:
        p = re.sub(r"^\s*and\s+", "", p, flags=re.I)
        p = re.sub(r"\s+", " ", p).strip()
        if len(p) >= 2 and p.lower() != "and":
            out.append(p)
    return out


AO_CODE = re.compile(
    r"^(?P<last>.+?)\s*[-_.,]\s*(?P<init>[A-Za-z]{1,6}(?: [A-Za-z]{1,2})?)?[.\s]*(?P<pos>[A-Za-z]{1,2}[0-9]?)[.\s]+(?P<cir>[0-9]{2}|[A-Z]{2,4}|--)(?=[^A-Za-z0-9]|$)"
    r"(?:[.\s_]+(?P<dist>[A-Z]{2,4})(?=[^A-Za-z0-9]|$))?")
JW_NAME = re.compile(r"^(?P<name>.+?) Financial Disclosure Report")
NOMINATION_NAME = re.compile(r"^(?P<last>[^,]+),")
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}
NUMBERED_CIRCUITS = {f"{n:02d}" for n in range(1, 12)}  # the numbered regional circuits; other codes (DC, FC, SUP, TAX...) are not compared


def letters(s: str | None) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalpha())


def name_tokens(s: str | None) -> list[str]:
    """Letters-only words of a name; suffixes (Jr, Sr, II...) dropped, also when glued to the surname (HaynesJr, BattenSr)."""
    out = []
    for w in re.split(r"[\s\-.,_']+", s or ""):
        t = letters(w)
        if not t or t in SUFFIXES:
            continue
        base = w.rstrip(".")
        # a capitalised Jr/Sr glued to the end of a longer word ("HaynesJr", "TraxlerJR"); lower-case endings are part of the name
        if len(t) >= 5 and t[-2:] in ("jr", "sr") and len(base) >= 2 and base[-2].isupper() and base[-2:].lower() == t[-2:]:
            t = t[:-2]
        out.append(t)
    return out


def parse_filer_file(download_path: str | None) -> dict | None:
    """The filer identity carried by a disclosure report's original file name, or None when the name has no recognisable pattern.

    * AO-coded names (`King-RB. B. 05. TXW_R_17.tiff`): surname, initials, position code, circuit code, district code
      (a national court written `J1. --. TAX` takes its court code as the circuit).
    * Judicial Watch names (`Robert B King Financial Disclosure Report for 2010.pdf`): every word of the name.
    * Nomination names (`King, Robert- B.pdf`): the surname before the comma.
    """
    from urllib.parse import unquote

    if not download_path:
        return None
    base = unquote(download_path.rsplit("/", 1)[-1]).strip()
    if "/judicial-watch/" in download_path:
        m = JW_NAME.match(base)
        return {"kind": "name", "words": m.group("name")} if m else None
    if "/nomination/" in download_path:
        m = NOMINATION_NAME.match(base)
        return {"kind": "name", "words": m.group("last").strip()} if m else None
    m = AO_CODE.match(base)
    if not m:
        return None
    cir = m.group("cir")
    return {"kind": "ao", "words": m.group("last").strip(), "initials": (m.group("init") or "").strip() or None, "position": m.group("pos").upper(),
            "circuit": cir if cir in NUMBERED_CIRCUITS else None, "court_code": cir if cir != "--" else None, "district": m.group("dist")}


def surname_matches(file_words: str | None, person_last: str | None) -> bool | None:
    """Exact check that the file name carries the person's surname: some run of 1-3 consecutive file-name words, letters only and
    suffixes dropped, equals the whole recorded surname or (for a compound surname such as Garcia-Gregory) one of its parts.
    No similarity scoring: a misspelt file name does not match. None when either side has no letters."""
    f = name_tokens(file_words)
    p = name_tokens(person_last)
    if not f or not p:
        return None
    runs = {"".join(f[i:j]) for i in range(len(f)) for j in range(i + 1, min(len(f), i + 3) + 1)}
    wanted = {"".join(p)} | {t for t in p if len(t) >= 3}
    return bool(runs & wanted)


def report_check(parsed: dict | None, person_last: str | None) -> str:
    """'match' when the report's file name carries the person's surname, 'mismatch' when it carries another, 'unchecked' otherwise."""
    if not parsed:
        return "unchecked"
    ok_name = surname_matches(parsed.get("words"), person_last)
    return "unchecked" if ok_name is None else ("match" if ok_name else "mismatch")


def attribution(person_last: str | None, parsed: list[dict | None]) -> dict:
    """Person-level check of the reports CourtListener attributes to one person.

    Each report is 'match', 'mismatch' or 'unchecked' (report_check). Among matching AO-coded reports, more than one numbered
    circuit (01-11) is a conflict: it can be a move between circuits or two judges with the same surname (CourtListener matched the
    reports, not this project). Status: 'conflict', 'consistent' (at least one matching report and no conflict) or 'unchecked'.
    """
    from collections import Counter

    checks = [report_check(p, person_last) for p in parsed]
    circuits: Counter = Counter(p["circuit"] for p, c in zip(parsed, checks) if p and c == "match" and p["kind"] == "ao" and p.get("circuit"))
    status = "conflict" if len(circuits) > 1 else ("consistent" if "match" in checks else "unchecked")
    return {"status": status, "circuits": dict(sorted(circuits.items())), "checks": checks, "match": checks.count("match"),
            "mismatch": checks.count("mismatch"), "unchecked": checks.count("unchecked")}


def interval_ok(a, b) -> bool:
    """Both dates recorded and the second not before the first (the only intervals used in timing figures)."""
    return a is not None and b is not None and b >= a
