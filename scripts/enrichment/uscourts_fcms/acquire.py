"""Acquire Federal Court Management Statistics (FCMS) archive files from www.uscourts.gov.

Step "pages": read the FCMS landing page and every period page it links (plus the archive year pages),
store the HTML unchanged under private/acq/uscourts_fcms/pages/ and write links.json (period -> file links).
Step "files": download the district and circuit profile files (PDF and any Excel/CSV edition) listed in
links.json, unchanged, under private/acq/uscourts_fcms/files/<period>/.

Every response is listed in private/acq/uscourts_fcms/_manifest.jsonl (url, path, sha256, bytes,
retrieved_at UTC, http status, method). Rate limit: one request per second (fetchutil).

Usage: python3 -I -B acquire.py pages | probe | files [--only district,circuit] | excel | terms | one <file url> <period folder>
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchutil as fu  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "uscourts_fcms"
MANIFEST = ACQ / "_manifest.jsonl"
BASE = "https://www.uscourts.gov"
LANDING = BASE + "/data-news/reports/statistical-reports/federal-court-management-statistics"
HREF = re.compile(r'href="([^"]+)"', re.I)
FILE_EXT = re.compile(r"\.(pdf|xlsx|xls|csv|zip)(\?|$)", re.I)


def slug_of(url):
    """Unique file-system name for a page URL: its path below the host, slashes replaced by '__'."""
    path = url.split("://", 1)[-1].split("/", 1)[-1].rstrip("/")
    for prefix in ("data-news/reports/statistical-reports/federal-court-management-statistics/", "data-news/data-tables/"):
        if path.startswith(prefix):
            path = path[len(prefix):]
    return re.sub(r"[^A-Za-z0-9._-]+", "__", path) or "landing"


def store(url, status, data, path, method="direct urllib GET"):
    if status == 200 and data:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    fu.append_manifest(MANIFEST, {
        "url": url, "path": str(path.relative_to(ROOT)) if status == 200 and data else None,
        "sha256": fu.sha256(data) if data else None, "bytes": len(data), "retrieved_at": fu.now_utc(),
        "status": status, "method": method,
    })


def page_links(html):
    out = []
    for href in HREF.findall(html):
        href = href.replace("&amp;", "&")
        if href.startswith("/"):
            href = BASE + href
        if href not in out:
            out.append(href)
    return out


_CACHE = {}


def fetch_page(url, name):
    """GET a page once: a page already stored with a 200 manifest entry is read from disk (no re-request)."""
    path = ACQ / "pages" / f"{name}.html"
    if not _CACHE:
        for e in fu.read_manifest(MANIFEST):
            if e.get("status") == 200 and e.get("path"):
                _CACHE[e["url"]] = e
    hit = _CACHE.get(url)
    if hit and (ROOT / hit["path"]).exists():
        return 200, (ROOT / hit["path"]).read_bytes().decode("utf-8", "replace")
    status, data, final = fu.get(url)
    store(url, status, data, path)
    return status, data.decode("utf-8", "replace") if data else ""


def wanted(u):
    # FCMS period pages live under the FCMS report path; their tables under data-tables/<date>/federal-court-
    # management-statistics/. Other statistical series (Federal Judicial Caseload Statistics tables) are not followed.
    if not u.startswith(BASE) or "#" in u or FILE_EXT.search(u) or u.rstrip("/") == LANDING:
        return False
    return u.startswith(LANDING + "/") or ("/data-tables/" in u and "/federal-court-management-statistics/" in u) \
        or u.startswith(BASE + "/statistics-reports/federal-court-management-statistics-")


def step_pages(seeds=None, links=None):
    """Crawl the landing page's period pages (default) or only `seeds`, merging into `links`."""
    if seeds is None:
        status, html = fetch_page(LANDING, "landing")
        if status != 200:
            raise SystemExit(f"landing page status {status}")
        seeds = [u for u in page_links(html) if wanted(u)]
    period_pages = seeds
    seen, queue, links = set(), list(period_pages), (links if links is not None else {})
    while queue:
        url = queue.pop(0)
        key = url.rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        status, body = fetch_page(url, slug_of(url))
        files = [u for u in page_links(body) if FILE_EXT.search(u)] if status == 200 else []
        children = []
        # Period pages link their data-table pages; archive year pages can link further period pages
        # (for example December 2016 under 1997).
        for u in page_links(body):
            if wanted(u):
                children.append(u.rstrip("/"))
                if u.rstrip("/") not in seen:
                    queue.append(u)
        title = re.search(r"<title>(.*?)</title>", body, re.S)
        links[key] = {"status": status, "title": re.sub(r"\s+", " ", title.group(1)).strip() if title else None,
                      "files": [f for f in files if "guide-vol" not in f], "children": children}
    (ACQ / "links.json").write_text(json.dumps(links, indent=1, sort_keys=True))
    print(json.dumps({"pages": len(links), "with_files": sum(1 for v in links.values() if v["files"])}))


MONTH_END = {"march": "03-31", "june": "06-30", "september": "09-30", "december": "12-31"}


def step_probe(first_year=2004, last_year=2026):
    """Request the period page of every quarter-end slot that links.json does not know yet.

    The landing page does not link every published period (September 2023 is published but unlinked), so each
    missing <month>-<year> slug is requested once; a 404 is recorded in the manifest and nothing else is done.
    Pages that exist are crawled like step_pages (their data-table children are followed) and merged into links.json.
    """
    links = json.loads((ACQ / "links.json").read_text())
    known = {k.rsplit("/", 1)[-1] for k in links}
    today = fu.now_utc()[:10]
    found = []
    for year in range(first_year, last_year + 1):
        for month, end in MONTH_END.items():
            slug = f"federal-court-management-statistics-{month}-{year}"
            if slug in known or f"{year}-{end}" > today:
                continue
            url = f"{LANDING}/{slug}"
            status, _ = fetch_page(url, slug_of(url))
            if status == 200:
                found.append(url)
    if found:
        step_pages(seeds=found, links=links)
    print(json.dumps({"probed_found": found}))


def kind_of(file_url):
    """district / circuit profile, or other (summaries, comparisons, case participation)."""
    name = file_url.rsplit("/", 1)[-1].lower()
    if any(x in name for x in ("comparison", "summary", "sumary", "participation", "appcp")):
        return "other"
    # file-name spellings seen on the site: fcms_na_distprofile..., fcms_na_disprofile... (March/December 2023
    # typo), district_fcms_..., fcms_district_profiles_..., district-fcms-profiles-... (2012-2014)
    if "distprofile" in name or "disprofile" in name or name.startswith(("district_fcms", "district-fcms")) \
            or "district_profiles" in name or "district-fcms-profiles" in name:
        return "district"
    if "appprofile" in name or name.startswith(("appeals_fcms", "appeals-fcms")) or "appeals_profiles" in name \
            or "appeals-fcms-profiles" in name:
        return "circuit"
    return "other"


def period_of(page_url):
    """Period end date implied by a period page slug; archive year pages (1997-2003) are September editions."""
    slug = page_url.rstrip("/").rsplit("/", 1)[-1]
    m = re.search(r"(march|june|september|december)-(\d{4})$", slug)
    if m:
        return f"{m.group(2)}-{MONTH_END[m.group(1)]}", slug
    m = re.search(r"federal-court-management-statistics-(\d{4})$", slug)
    if m:
        return f"{m.group(1)}-09-30", slug
    return None, slug


def editions_from_links(links):
    editions = []
    for page, entry in sorted(links.items()):
        if "/data-tables/" in page:
            continue
        period_end, slug = period_of(page)
        if not period_end:
            continue
        files = list(entry["files"])
        for child in entry.get("children", []):
            if "/data-tables/" in child and child in links:
                files += [f for f in links[child]["files"] if f not in files]
        chosen = {}
        for kind in ("district", "circuit"):
            pdfs = [f for f in files if kind_of(f) == kind and f.lower().endswith(".pdf")]
            excel = [f for f in files if kind_of(f) == kind and re.search(r"\.xlsx?$", f.lower())]
            chosen[kind] = {"pdf": pdfs[0] if pdfs else None, "pdf_alternatives": pdfs[1:], "excel": excel}
        editions.append({"edition": slug, "period_end": period_end, "page_url": page, "files": chosen})
    return editions


def step_excel():
    """Download the Excel editions of the profiles (.xlsx/.xls) that editions.json lists, unchanged, beside the PDFs.

    The Excel files are the publisher's own structured copy of the same tables; extract.py does not read them, the
    independent check (verify_uscourts_fcms.py) compares the PDF extraction with the .xlsx ones.
    """
    editions = json.loads((ACQ / "editions.json").read_text())
    ok = {e["url"]: e for e in fu.read_manifest(MANIFEST) if e.get("status") == 200 and e.get("path")}
    seen, count, failed = set(), 0, []
    for ed in editions:
        for kind in ("district", "circuit"):
            for url in ed.get(kind + "_excel_urls") or []:
                if url in seen:
                    continue
                seen.add(url)
                path = ACQ / "files" / ed["edition"] / url.rsplit("/", 1)[-1].split("?")[0]
                if url in ok and path.exists():
                    continue
                status, data, _ = fu.get(url)
                store(url, status, data, path)
                count += 1
                if status != 200:
                    failed.append([url, status])
    print(json.dumps({"excel_urls": len(seen), "downloaded": count, "failed": failed}))


DEFINITION_FILES = [
    "https://www.uscourts.gov/sites/default/files/document/explanation-of-selected-terms-2025.pdf",
    "https://www.uscourts.gov/sites/default/files/2024-12/explanation_of_judicial_caseload_profiles_district.xlsx",
    "https://www.uscourts.gov/sites/default/files/2024-12/explanation_of_judicial_caseload_profiles_appeals.xlsx",
]


def step_definitions():
    """Download the publisher's explanation-of-terms files that the FCMS period pages link (unchanged)."""
    for url in DEFINITION_FILES:
        path = ACQ / "definitions" / url.rsplit("/", 1)[-1]
        if path.exists():
            continue
        status, data, _ = fu.get(url)
        store(url, status, data, path)
        print(json.dumps({"url": url, "status": status, "bytes": len(data)}))


def step_terms():
    """Fetch robots.txt and the site's privacy/security policy page once (unchanged) so the terms read are on record."""
    for url, name in ((BASE + "/robots.txt", "robots.txt"), (BASE + "/privacy-security-policy", "privacy-security-policy.html")):
        status, data, _ = fu.get(url)
        store(url, status, data, ACQ / "terms" / name)
        print(json.dumps({"url": url, "status": status, "bytes": len(data)}))


def step_files(only):
    links = json.loads((ACQ / "links.json").read_text())
    editions = editions_from_links(links)
    ok = {e["url"]: e for e in fu.read_manifest(MANIFEST) if e.get("status") == 200 and e.get("path")}
    out, count = [], 0
    for ed in editions:
        rec = {"edition": ed["edition"], "period_end": ed["period_end"], "page_url": ed["page_url"]}
        for kind in ("district", "circuit"):
            if only and kind not in only:
                continue
            url = ed["files"][kind]["pdf"]
            rec[kind + "_excel_urls"] = ed["files"][kind]["excel"]
            if not url:
                rec[kind] = None
                continue
            name = url.rsplit("/", 1)[-1].split("?")[0]
            path = ACQ / "files" / ed["edition"] / name
            if not (url in ok and path.exists()):
                status, data, _ = fu.get(url)
                store(url, status, data, path)
                count += 1
                ok = {e["url"]: e for e in fu.read_manifest(MANIFEST) if e.get("status") == 200 and e.get("path")}
            m = ok.get(url)
            rec[kind] = {"url": url, "path": m["path"], "sha256": m["sha256"], "bytes": m["bytes"]} if m else None
        out.append(rec)
    (ACQ / "editions.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"editions": len(out), "downloaded": count,
                      "missing": [r["edition"] + ":" + k for r in out for k in ("district", "circuit") if not r.get(k)]}))


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "pages"
    only = set()
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    if step == "pages":
        step_pages()
    elif step == "probe":
        step_probe()
    elif step == "files":
        step_files(only)
    elif step == "excel":
        step_excel()
    elif step == "terms":
        step_terms()
    elif step == "definitions":
        step_definitions()
    elif step == "one":  # python3 acquire.py one <file url> <period folder>
        url, folder = sys.argv[2], sys.argv[3]
        status, data, _ = fu.get(url)
        store(url, status, data, ACQ / "files" / folder / url.rsplit("/", 1)[-1])
        print(json.dumps({"url": url, "status": status, "bytes": len(data)}))
    else:
        raise SystemExit(__doc__)
