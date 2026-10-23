"""Stage 1: find each court's judges listing(s), read every judge page and record the judge's documents.

For every district and bankruptcy court in court_sites.json:
  1. seed pages: the court's home page (read from the court_locations stream's copy of 2026-10-19 when present, else fetched) is scanned
     for links to judge listings; per-court overrides (site_overrides.json) add or replace seeds;
  2. up to MAX_LISTINGS listing pages are fetched (robots.txt obeyed, one request per second per court site), and every link that looks like
     a judge page is collected; sub-listings (District Judges, Magistrate Judges, ...) found on them are followed;
  3. every collected judge page is fetched and parsed (name and title as published, document links);
  4. one JSON file per court is written to private/build/judge_practices/courts/<court_id>.json.

Pages are stored unchanged (gzip) under private/acq/judge_practices/pages/ and are reused on re-runs, so re-running costs no requests
unless --refresh is given. Nothing is fetched twice.

    python3 -I -B scripts/enrichment/judge_practices/crawl_courts.py [--courts a,b] [--workers 10] [--refresh] [--parse-only]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import unicodedata
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetchlib as fl  # noqa: E402
import parse_lib as pl  # noqa: E402

ROOT = fl.ROOT
OUT = os.path.join(ROOT, "private", "build", "judge_practices", "courts")
LOCATIONS_SITES = os.path.join(ROOT, "private", "acq", "court_locations", "sites")
MAX_LISTINGS = 8
MAX_JUDGE_PAGES = 160
STOP_AT = {"n": 7500}  # discovery may use at most this many requests in total; the rest of the budget is for documents and checks
GUESS_PATHS = ["/judges", "/judges-info", "/judges-information", "/judicial-officers", "/our-judges", "/district-judges", "/magistrate-judges"]

STRONG_TEXT = re.compile(
    r"^(?:the |our |u\.?s\.? |united states |federal )?(?:district |bankruptcy |magistrate |article iii |active |senior )?"
    r"(?:judges?|judicial officers?|judge directory|judicial directory)(?: ?(?:&|and|/|-) ?(?:chambers|calendars?|opinions?|procedures?|info(?:rmation)?|"
    r"requirements|biograph\w+|directory|orders))?$|^judges?['’]?s? (?:info|information|directory|page|and chambers|chambers|procedures|requirements|"
    r"contact information.*)$|^list of judges$|^meet the judges$|^judges? ?[&/] ?chambers|^chambers(?: information| rules)?$|^judicial officers|"
    r"^(?:district|magistrate|bankruptcy) judges?(?: directory| information)?$", re.I)
PATH_GOOD = re.compile(r"^/(?:[a-z0-9_]+/)?(?:judges?(?:-info|-information|-directory|-chambers|s)?|judicial-?officers?|our-judges|chambers(?:-information)?|"
                       r"district-judges|magistrate-judges|bankruptcy-judges|judges-and-chambers|united-states-(?:district|magistrate)-judges)"
                       r"(?:/|$|\.|-|\?)", re.I)
PATH_BAD = re.compile(r"(opinions?|calendars?|conduct|disclos|seminar|vacanc|news|employ|hiring|forms?\b|cja|trustee|clerk|jury|"
                      r"misconduct|recusal|assignment|random|wheel|history|biograph|retire|former|archive|photo|portrait|ceremon|"
                      r"hearing|schedule|docket|transcript|ecf|pacer|privacy|accessib|sitemap|contact-us|careers)", re.I)

_print = threading.Lock()


def say(*a) -> None:
    with _print:
        print(*a, flush=True)


def load_roster() -> list[dict]:
    return json.load(open(os.path.join(HERE, "court_sites.json"), encoding="utf-8"))["courts"]


def load_overrides() -> dict:
    p = os.path.join(HERE, "site_overrides.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def home_body(court: dict, refresh: bool) -> tuple[bytes | None, str]:
    url = court["home_url"]
    host = court["host"]
    if not refresh:
        cached = fl.cached_page(url)
        if cached is not None:
            return cached, "stored copy"
        local = os.path.join(LOCATIONS_SITES, host, "index.html")
        if os.path.exists(local):
            with open(local, "rb") as h:
                return h.read(), "court_locations copy of 2026-10-19"
    r = fl.get_page(url, refresh=refresh)
    return (r.body if r.ok else None), f"fetched ({r.status or r.error or r.blocked})"


def link_score(text: str, url: str, host_set: set[str], home: str) -> int:
    u = urllib.parse.urlparse(url)
    if u.netloc.lower() not in host_set:
        return -100
    path = u.path or "/"
    if path == "/" and not u.query:
        return -100
    if fl.pace_key(u.netloc) != fl.pace_key(urllib.parse.urlparse(home).netloc):
        return -100
    t = pl.clean(text).lower()
    s = 0
    if STRONG_TEXT.search(t):
        s += 10
    elif "judge" in t and len(t.split()) <= 4 and not pl.looks_like_judge_link(text):
        s += 3
    if PATH_GOOD.search(path + ("?" + u.query if u.query else "")):
        s += 6
    elif "judge" in path.lower() or "chamber" in path.lower():
        s += 2
    if PATH_BAD.search(path) or PATH_BAD.search(t):
        s -= 8
    if re.search(r"\.(pdf|docx?|jpg|png)$", path, re.I):
        s -= 20
    return s


def host_family(court: dict) -> set[str]:
    h = court["host"]
    bare = h[4:] if h.startswith("www.") else h
    return {h, bare, "www." + bare}


def seed_urls(court: dict, home_html: bytes | None, override: dict, guess: bool = False) -> list[str]:
    if override.get("listing_urls"):
        return list(override["listing_urls"])
    seeds: list[tuple[int, str]] = []
    hosts = host_family(court)
    if home_html:
        for ln in pl.extract_links(home_html, court["home_url"]):
            sc = link_score(ln.text, ln.href, hosts, court["home_url"])
            if sc >= 6:
                seeds.append((sc, ln.href))
    best: dict[str, int] = {}
    for sc, u in seeds:
        best[u] = max(best.get(u, 0), sc)
    ordered = [u for u, _ in sorted(best.items(), key=lambda kv: (-kv[1], len(kv[0])))]
    if guess:
        for g in GUESS_PATHS:
            u = f"https://{court['host']}{g}"
            if u not in ordered:
                ordered.append(u)
    return ordered[:6]


SUBLIST_TEXT = re.compile(r"^(?:u\.?s\.? |united states )?(?:active |senior |article iii |chief )?(?:district|magistrate|bankruptcy|senior|visiting|recalled)?\s*"
                          r"(?:judges?|judicial officers?)(?: directory| information| biographies)?$", re.I)


def listing_entries(body: bytes, base: str, hosts: set[str], ov: dict, audit: list) -> list[pl.Entry]:
    """Judge entries on one listing page: judge-name links (default), links whose address matches ov["entry_href_regex"], and names in the
    page text (ov["text_roster"]); then limited to the court's own site."""
    soup = pl.soup_of(body)
    found: list[pl.Entry] = []
    if not ov.get("skip_link_entries"):
        found += pl.judge_entries(soup, base, audit=audit)
    if ov.get("entry_href_regex"):
        rx_found = pl.regex_entries(pl.extract_links(soup, base), ov["entry_href_regex"], ov.get("exclude_href_regex"),
                                    main_only=bool(ov.get("entry_main_only")), heading=ov.get("entry_heading_regex"))
        if ov.get("row_docs"):
            for e in rx_found:
                e.docs = pl.row_docs(soup, base, e.url, e.name_text or None)
        found += rx_found
    if ov.get("text_roster"):
        found += pl.text_roster(soup, base, scope=ov.get("roster_scope", "main"))
    out: dict[str, pl.Entry] = {}
    for e in found:
        if urllib.parse.urlparse(e.url).netloc.lower() not in hosts or pl.is_home(e.url) or re.search(r"\bclerk\b", e.name_text, re.I):
            continue
        why = pl.former_marker(e.name_text)
        if why:
            audit.append({"url": e.url, "name": e.name_text, "reason": f"not a sitting judge: {why}"})
            continue
        if re.search(r"[-/_]opinions?(?:[-/_.]|$)", urllib.parse.urlparse(e.url).path, re.I):  # "Judge Glenn Opinions": a list of decisions, not the judge's page
            audit.append({"url": e.url, "name": e.name_text, "reason": "an opinions index, not the judge's own page"})
            continue
        if ov.get("exclude_href_regex") and re.search(ov["exclude_href_regex"], e.url):
            continue
        if e.url not in out or (e.name_text and not out[e.url].name_text):
            out[e.url] = e
    return list(out.values())


INDEX_TEXT = re.compile(
    r"(standing orders?|(?:judges?|chambers)['\u2019]?\s*(?:procedures|requirements|practices|preferences|rules)|chambers (?:rules|procedures|practices|info)|"
    r"judge[- ]specific|individual (?:rules|practices|procedures)|practice pointers|orders,? forms|judges?['\u2019]? orders|court(?:room)? procedures by judge|"
    r"judges?['\u2019]? (?:forms|orders))", re.I)
MAX_INDEX_PAGES = 2


def surname(name: str) -> str | None:
    toks = [t for t in pl.norm_name(name).split() if len(t) > 1]
    return toks[-1] if toks else None


ROLE_TOKENS = {"sr", "mag", "judge", "judges", "chief", "senior", "hon", "honorable", "district", "magistrate", "bankruptcy", "u", "s", "us",
               "united", "states", "visiting", "recalled", "the", "court", "jr", "ii", "iii", "iv"}


def words(text: str) -> list[str]:
    t = unicodedata.normalize("NFKD", text or "")
    return re.findall(r"[a-z]+", "".join(c for c in t if not unicodedata.combining(c)).lower())


def names_judge(link_text: str, judge_name: str) -> bool:
    """The link text holds the judge's first and last name, in that order (so two judges with one surname are told apart)."""
    toks = pl.norm_name(judge_name).split()
    w = words(link_text)
    if len(toks) < 2 or toks[0] not in w or toks[-1] not in w:
        return False
    return w.index(toks[0]) < len(w) - 1 - w[::-1].index(toks[-1])


def only_the_name(link_text: str, judge_name: str) -> bool:
    """The link text is nothing but the judge's name with title words ("Mag. Judge Elizabeth Cowan Wright"): it names no document."""
    nm = set(words(judge_name))
    rest = [x for x in words(link_text) if x not in ROLE_TOKENS]
    return bool(rest) and all(x in nm for x in rest)


def attach_index_docs(result: dict, court: dict, hosts: set[str], bodies: list[tuple[str, bytes]], judge_urls: set[str], refresh: bool,
                      parse_only: bool) -> None:
    """Court-level pages that gather judges' own documents (standing orders, chambers rules, judge-specific procedures): documents under a
    heading naming a judge, or whose title names exactly one judge by surname, are attached to that judge. Nothing else is attributed."""
    judges = [j for j in result["judges"] if j.get("name") and j.get("status") == 200]
    if not judges:
        return
    by_surname: dict[str, list[dict]] = {}
    for j in judges:
        sn = surname(j["name"])
        if sn:
            by_surname.setdefault(sn, []).append(j)
    pages: list[str] = []
    for base, body in bodies + [(court["home_url"], fl.cached_page(court["home_url"]) or b"")]:
        if not body:
            continue
        for ln in pl.extract_links(body, base):
            if INDEX_TEXT.search(ln.text) and len(ln.text) < 90 and urllib.parse.urlparse(ln.href).netloc.lower() in hosts \
                    and not pl.FILE_EXT.search(ln.href) and ln.href not in judge_urls and ln.href not in pages and not pl.is_home(ln.href) \
                    and not PATH_BAD.search(urllib.parse.urlparse(ln.href).path.replace("standing-order", "").replace("rules", "")) \
                    and not re.search(r"local-rules|general-orders?|administrative-orders?|judicial-conduct|opinions", ln.href, re.I):
                pages.append(ln.href)
    pages = pages[:MAX_INDEX_PAGES]
    attached = 0
    result["index_pages"] = []
    for url in pages:
        if parse_only and fl.cached_page(url) is None:
            continue
        if fl.request_count() >= STOP_AT["n"]:
            raise fl.BudgetExhausted("discovery request allowance used")
        r = fl.get_page(url, refresh=refresh)
        rec = {"url": url, "status": r.status, "attached": 0}
        result["index_pages"].append(rec)
        if not r.ok:
            continue
        soup = pl.soup_of(r.body)
        found: dict[str, list[pl.DocLink]] = {}
        # (a) a judge's name heads the documents under it
        for e in pl.text_roster(soup, r.final_url or url):
            if not e.docs:
                continue
            sn = surname(pl.strip_name(pl.reorder_last_first(e.name_text)))
            targets = by_surname.get(sn or "", [])
            full = [j for j in targets if pl.norm_name(j["name"]) == pl.norm_name(pl.strip_name(e.name_text))]
            target = full[0] if len(full) == 1 else (targets[0] if len(targets) == 1 else None)
            if target is None:
                continue
            docs, _ = pl.document_links(e.docs, url, hosts)
            found.setdefault(id(target), (target, []))[1].extend(docs)
        # (b) a document whose link text holds exactly one judge's full name, or whose title names exactly one judge by surname
        links = [ln for ln in pl.extract_links(soup, r.final_url or url) if not ln.chrome]
        docs_all, _ = pl.document_links(links, url, hosts)
        index_heading = pl.page_heading(soup) or pl.page_title(soup)
        for d in docs_all:
            full = [j for j in judges if names_judge(d.title, j["name"])]
            if len(full) == 1:
                if index_heading and only_the_name(d.title, full[0]["name"]):
                    # the court's link text is only the judge's name; the page it sits on says what the document is
                    d.note = f"link text on the court's page: {d.title}"
                    d.title = index_heading
                found.setdefault(id(full[0]), (full[0], []))[1].append(d)
                continue
            hay = f"{d.title} {d.heading or ''}".lower()
            hits = [sn for sn in by_surname if re.search(r"\b" + re.escape(sn) + r"\b", hay)]
            if len(hits) == 1 and len(by_surname[hits[0]]) == 1:
                found.setdefault(id(by_surname[hits[0]][0]), (by_surname[hits[0]][0], []))[1].append(d)
        for target, docs in found.values():
            have = {x["url"] for x in target.get("documents") or []}
            for d in docs:
                if d.url in have:
                    continue
                have.add(d.url)
                d.note = f"listed on the court's page {url}" + (f" ({d.note})" if d.note else "")
                target.setdefault("documents", []).append(d.__dict__)
                rec["attached"] += 1
                attached += 1
    result["index_docs_attached"] = attached



def crawl_court(court: dict, override: dict, refresh: bool, parse_only: bool) -> dict:
    cid = court["court_id"]
    result: dict = {"court_id": cid, "host": court["host"], "level": court["level"], "name": court["name"], "shared_with": court["shared_with"],
                    "robots": None, "home": None, "listing_pages": [], "judges": [], "problems": [], "override": override or None}
    hosts = host_family(court)
    if override.get("skip"):
        result["problems"].append(override["skip"])
        return result
    robots = fl.robots_for(court["home_url"])
    result["robots"] = {"status": robots.status, "crawl_delay": robots.delay, "home_allowed": robots.allows(court["home_url"])}
    if not robots.allows(court["home_url"]):
        result["problems"].append("robots.txt disallows the court's pages for this crawler; nothing was fetched")
        return result
    if override.get("adapter") == "cacd_jps":
        import adapter_cacd

        result["home"] = "the court's own judge service (JSON) used by its Judges' Procedures and Schedules app"
        return adapter_cacd.crawl(court, override, refresh, parse_only, result)
    if override.get("adapter") == "hid_cms":
        import adapter_hid

        result["home"] = "the court's own content service (JSON) used by its website"
        return adapter_hid.crawl(court, override, refresh, parse_only, result)
    home_html, home_how = home_body(court, refresh)
    result["home"] = home_how
    queue = seed_urls(court, home_html, override)
    seen_listing: set[str] = set()
    entries: dict[str, pl.Entry] = {}
    listing_of: dict[str, str] = {}
    fetched = 0
    fetched_bodies: list[tuple[str, bytes]] = []
    max_listings = override.get("max_listings", MAX_LISTINGS)
    stage = 0 if "court_locations" in (home_how or "") else 1  # 0: stale home copy used; 1: live home read; 2: guessed addresses tried
    while True:
        if not queue and not entries and stage < 2 and not override.get("listing_urls"):
            stage += 1
            if stage == 1 and not parse_only:
                # the 2026-10-19 copy of the home page may be out of date (sites are rebuilt): read the live one once
                live = fl.get_page(court["home_url"], refresh=True)
                result["home"] = (home_how or "") + "; re-fetched live"
                if live.ok:
                    queue = [u for u in seed_urls(court, live.body, override) if u not in seen_listing]
            if not queue:
                stage = 2
                queue = [u for u in seed_urls(court, None, override, guess=True) if u not in seen_listing]
                result["problems"].append("no judges link found on the home page; common addresses were tried")
        if not queue or fetched >= max_listings:
            break
        url = queue.pop(0)
        if url in seen_listing:
            continue
        seen_listing.add(url)
        if parse_only and fl.cached_page(url) is None:
            continue
        if fl.request_count() >= STOP_AT["n"]:
            raise fl.BudgetExhausted("discovery request allowance used")
        r = fl.get_page(url, refresh=refresh)
        fetched += 0 if r.cached else 1
        rec = {"url": url, "final_url": r.final_url or url, "status": r.status, "blocked": r.blocked, "error": r.error, "cached": r.cached,
               "entries": 0}
        result["listing_pages"].append(rec)
        if not r.ok:
            continue
        base = r.final_url or url
        fetched_bodies.append((base, r.body))
        audit: list = []
        found = listing_entries(r.body, base, hosts, override, audit)
        rec["excluded_entries"] = audit
        rec["entries"] = len(found)
        for e in found:
            if e.url not in entries:
                entries[e.url] = e
                listing_of[e.url] = url
        if override.get("no_sublistings"):
            continue
        for ln in pl.extract_links(r.body, base):
            if ln.chrome and found:
                continue
            if SUBLIST_TEXT.match(pl.clean(ln.text)) and urllib.parse.urlparse(ln.href).netloc.lower() in hosts \
                    and ln.href not in seen_listing and ln.href not in queue and not PATH_BAD.search(ln.href):
                queue.append(ln.href)
    if not entries and not override.get("no_text_fallback"):
        # no judge pages were found by link: read the judges' names from the text of the listing pages themselves
        for base, body in fetched_bodies:
            for e in pl.text_roster(body, base):
                if e.url not in entries and urllib.parse.urlparse(e.url).netloc.lower() in hosts:
                    entries[e.url] = e
                    listing_of[e.url] = base
        if entries:
            result["problems"].append("no judge pages found by link; names read from the text of the listing page (no per-judge page)")
    for extra in override.get("extra_entry_urls", []):
        entries.setdefault(extra, pl.Entry(name_text="", url=extra, heading=None, headings=(), role_text=None))
        listing_of.setdefault(extra, "override")
    # judges the court's page prints in a layout no parser reads (name and title on separate lines, names inside images' captions...): each
    # one is taken only if the name, and the title when one is given, appear verbatim in the text of the page named as the source
    for m in override.get("manual_roster", []):
        src = m["source_url"]
        if parse_only and fl.cached_page(src) is None:
            continue
        if fl.request_count() >= STOP_AT["n"]:
            raise fl.BudgetExhausted("discovery request allowance used")
        r = fl.get_page(src, refresh=refresh)
        lp = next((x for x in result["listing_pages"] if x["url"] == src), None)
        if lp is None:
            lp = {"url": src, "final_url": r.final_url or src, "status": r.status, "blocked": r.blocked, "error": r.error, "cached": r.cached,
                  "entries": 0}
            result["listing_pages"].append(lp)
        if not r.ok:
            result["problems"].append(f"roster source {src} could not be read (HTTP {r.status})")
            continue
        page_text = pl.clean(pl.soup_of(r.body).get_text(" "))
        needles = [m["name"], *([m["title"]] if m.get("title") else [])]
        # the evidence pattern must tie the name to the title as the page prints them together; without it nothing is recorded
        if not all(n in page_text for n in needles) or not m.get("evidence") or not re.search(m["evidence"], page_text):
            result["problems"].append(f"roster entry '{m['name']}' not found as written on {src}; not recorded")
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", m["name"].lower()).strip("-")
        url = f"{(r.final_url or src).split('#')[0]}#{slug}"
        e = pl.Entry(name_text=m["name"], url=url, heading=None, headings=(), role_text=m.get("title"), block=m["name"])
        if url not in entries:
            lp["entries"] += 1
        entries.setdefault(url, e)
        listing_of.setdefault(url, src)
    # judge pages (entries whose address is a fragment of a listing are judges known only from the listing text)
    count = 0
    for url, e in entries.items():
        if count >= MAX_JUDGE_PAGES:
            result["problems"].append(f"stopped at {MAX_JUDGE_PAGES} judge pages")
            break
        if "#" in url:  # real judge-page addresses never carry a fragment (absolute() drops it); text-roster entries always do
            jp = pl.entry_only_judge(e, court["level"])
            sec_docs, sec_excl = pl.document_links(getattr(e, "docs", []) or [], url.split("#")[0], hosts)
            for d in sec_docs:
                d.note = "listed under the judge's name on the court's own page"
            result["judges"].append({
                "link_text": e.name_text, "page_url": url, "final_url": url, "listing_url": listing_of.get(url), "listing_heading": e.heading,
                "status": 200, "blocked": None, "error": None, "sha256": None, "cached": True, "listing_only": True,
                "name_as_published": jp.name_as_published, "name": jp.name, "title_as_published": jp.title_as_published,
                "title_source": jp.title_source, "title_class": jp.title_class, "title_basis": jp.title_basis, "page_title": None,
                "documents": [d.__dict__ for d in sec_docs], "excluded": sec_excl})
            continue
        if parse_only and fl.cached_page(url) is None:
            continue
        if fl.request_count() >= STOP_AT["n"]:
            raise fl.BudgetExhausted("discovery request allowance used")
        r = fl.get_page(url, refresh=refresh)
        count += 1
        judge = {"link_text": e.name_text, "page_url": url, "final_url": r.final_url or url, "listing_url": listing_of.get(url), "listing_heading": e.heading,
                 "status": r.status, "blocked": r.blocked, "error": r.error, "sha256": r.sha256, "cached": r.cached}
        if r.ok:
            jp = pl.parse_judge_page(r.body, r.final_url or url, court_level=court["level"], entry=e, site_hosts=hosts,
                                     page_doc_regex=override.get("page_doc_regex"))
            docs_here = [d.__dict__ for d in jp.documents]
            if getattr(e, "docs", None):
                extra, _ = pl.document_links(e.docs, listing_of.get(url) or url, hosts)
                have = {d["url"] for d in docs_here}
                for d in extra:
                    if d.url not in have:
                        d.note = "listed in the judge's row on the court's own page"
                        docs_here.append(d.__dict__)
            judge.update({
                "name_as_published": jp.name_as_published, "name": jp.name, "title_as_published": jp.title_as_published,
                "title_source": jp.title_source, "title_class": jp.title_class, "title_basis": jp.title_basis, "page_title": jp.page_title,
                "documents": docs_here, "excluded": jp.excluded, "former": jp.former,
            })
        result["judges"].append(judge)
    if not override.get("no_index_docs"):
        attach_index_docs(result, court, hosts, fetched_bodies, set(entries), refresh, parse_only)
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--courts", default="")
    ap.add_argument("--courts-file", default="", help="a file holding a comma-separated list of court ids")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--parse-only", action="store_true", help="use stored pages only; make no requests")
    ap.add_argument("--stop-at", type=int, default=7500)
    args = ap.parse_args()
    STOP_AT["n"] = args.stop_at
    roster = load_roster()
    overrides = load_overrides()
    want = set(filter(None, args.courts.split(",")))
    if args.courts_file:
        want |= set(filter(None, open(args.courts_file, encoding="utf-8").read().strip().split(",")))
    todo = [c for c in roster if not want or c["court_id"] in want]
    os.makedirs(OUT, exist_ok=True)

    def run(court: dict) -> tuple[str, dict | None, str | None]:
        try:
            res = crawl_court(court, overrides.get(court["court_id"], {}), args.refresh, args.parse_only)
            with open(os.path.join(OUT, court["court_id"] + ".json"), "w", encoding="utf-8") as h:
                json.dump(res, h, indent=1, sort_keys=True)
            return court["court_id"], res, None
        except fl.BudgetExhausted as e:
            return court["court_id"], None, f"budget: {e}"
        except Exception as e:  # noqa: BLE001
            return court["court_id"], None, f"{type(e).__name__}: {e}"

    with ThreadPoolExecutor(args.workers) as pool:
        futs = [pool.submit(run, c) for c in todo]
        for f in as_completed(futs):
            cid, res, err = f.result()
            if err:
                say(cid, "ERROR", err)
            else:
                n = len(res["judges"])
                d = sum(len(j.get("documents") or []) for j in res["judges"])
                say(f"{cid:8} listings={len(res['listing_pages'])} judges={n} docs={d}")
    say("requests so far:", fl.request_count())


if __name__ == "__main__":
    main()
