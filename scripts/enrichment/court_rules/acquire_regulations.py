"""Acquire the table-of-contents pages of the state administrative codes covered by the open-us-law regulations scrapers.

  python3 -I -B scripts/enrichment/court_rules/acquire_regulations.py [ST ...]

Index only (title / agency / chapter headings with their official addresses); rule bodies are not downloaded. Publishers
and page shapes follow Vaquill-AI/open-us-law scripts/regulations/ingest_<st>_regulations.py (Apache-2.0; logic only).
Raw pages go unchanged to private/acq/court_rules/regulations/<ST>/ (gzip) with manifest rows; one log line per state.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urljoin

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
from links import page_links  # noqa: E402

LOG = os.path.join(fetchlib.ACQ, "regulations", "acquire_log.jsonl")
_lock = threading.Lock()

SOURCES = {
    "CO": {"code": "Code of Colorado Regulations", "publisher": "Colorado Secretary of State", "url": "https://www.sos.state.co.us/CCR/NumericalDeptList.do"},
    "ID": {"code": "Idaho Administrative Code (IDAPA)", "publisher": "Idaho Office of the Administrative Rules Coordinator", "url": "https://adminrules.idaho.gov/rules/current/"},
    "IL": {"code": "Illinois Administrative Code", "publisher": "Illinois General Assembly, Joint Committee on Administrative Rules", "url": "https://ilga.gov/ftp/JCAR/AdminCode/"},
    "KS": {"code": "Kansas Administrative Regulations", "publisher": "Kansas Secretary of State", "url": "https://sos.ks.gov/publications/agency-regulation-resources.html"},
    "KY": {"code": "Kentucky Administrative Regulations", "publisher": "Kentucky Legislative Research Commission", "url": "https://apps.legislature.ky.gov/law/kar/titles.htm"},
    "MD": {"code": "Code of Maryland Regulations (COMAR)", "publisher": "Maryland Division of State Documents", "url": "https://regs.maryland.gov/us/md/exec/comar/index.json"},
    "ME": {"code": "Code of Maine Rules", "publisher": "Maine Secretary of State", "url": "https://www.maine.gov/sos/rulemaking/agency-rules"},
    "MN": {"code": "Minnesota Administrative Rules", "publisher": "Minnesota Office of the Revisor of Statutes", "url": "https://www.revisor.mn.gov/rules/numerical/"},
    "NM": {"code": "New Mexico Administrative Code (NMAC)", "publisher": "New Mexico State Records Center and Archives", "url": "https://www.srca.nm.gov/page-sitemap.xml"},
    "OH": {"code": "Ohio Administrative Code", "publisher": "Ohio Legislative Service Commission (codes.ohio.gov)", "url": "https://codes.ohio.gov/ohio-administrative-code"},
    "SC": {"code": "South Carolina Code of Regulations", "publisher": "South Carolina Legislative Council", "url": "https://www.scstatehouse.gov/coderegs/statmast.php"},
    "VA": {"code": "Virginia Administrative Code", "publisher": "Virginia Division of Legislative Automated Systems (law.lis.virginia.gov)", "url": "https://law.lis.virginia.gov/api/AdministrativeCodeGetTitleListOfJson"},
    "WA": {"code": "Washington Administrative Code", "publisher": "Washington Office of the Code Reviser", "url": "https://lawfilesext.leg.wa.gov/law/wac/"},
    "WI": {"code": "Wisconsin Administrative Code", "publisher": "Wisconsin State Legislature (Legislative Reference Bureau)", "url": "https://docs.legis.wisconsin.gov/code/admin_code"},
}


def log(entry: dict) -> None:
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    entry = {"at": fetchlib.utc_now(), **entry}
    with _lock:
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    print(json.dumps(entry), flush=True)


def get(url: str, rel: str, **kw):
    url = quote(url, safe=":/?&=%#,;+@!$'()*~")
    try:
        status, body, headers = fetchlib.fetch(url, rel, gz=True, **kw)
        return status, body, headers, None
    except PermissionError as error:
        return None, b"", {}, f"robots: {error}"
    except Exception as error:
        return None, b"", {}, str(error)[:300]


def follow(st: str, url: str, pattern: str, prefix: str, limit: int = 2000) -> tuple[int, int, list[str]]:
    """Fetch url, then every link on it matching pattern. Returns (ok, failed, errors)."""
    status, body, headers, err = get(url, f"regulations/{st}/index.html")
    if err or status != 200:
        return 0, 1, [f"{url}: {err or status}"]
    links = []
    for link, _t in page_links(body.decode("utf-8", "replace"), headers.get("X-Final-URL", url)):
        link = link.split("#")[0]
        if re.search(pattern, link) and link not in links:
            links.append(link)
    ok = failed = 0
    errors = []
    for n, link in enumerate(links[:limit]):
        s2, _b, _h, e2 = get(link, f"regulations/{st}/{prefix}_{n:04d}.html")
        if e2 or s2 != 200:
            failed += 1
            errors.append(f"{link}: {e2 or s2}")
        else:
            ok += 1
    return ok, failed, errors


def acquire(st: str) -> None:
    src = SOURCES[st]
    url = src["url"]
    try:
        if st == "CO":
            ok, failed, errors = follow(st, url, r"NumericalCCRDocList\.do\?deptID=", "agency")
        elif st == "KY":
            ok, failed, errors = follow(st, url, r"/law/kar/titles/\d+$", "title")
        elif st == "OH":
            ok, failed, errors = follow(st, url, r"/ohio-administrative-code/[0-9:]+$", "agency")
        elif st == "WI":
            ok, failed, errors = follow(st, url, r"/document/administrativecode/[^/?]+$", "agency")
        elif st == "WA":
            ok, failed, errors = follow(st, url, r"/law/wac/WAC(%20)+\d+[A-Z]?(%20)+TITLE/?$", "title")
        elif st == "MN":
            status, body, _h, err = get(url, "regulations/MN/numerical.html")
            ok, failed, errors = (1, 0, []) if status == 200 else (0, 1, [err or str(status)])
        elif st == "SC":
            status, body, _h, err = get(url, "regulations/SC/statmast.html")
            ok, failed, errors = (1, 0, []) if status == 200 else (0, 1, [err or str(status)])
        elif st == "MD":
            status, body, _h, err = get(url, "regulations/MD/index.json")
            ok, failed, errors = (1, 0, []) if status == 200 else (0, 1, [err or str(status)])
        elif st == "KS":
            status, body, _h, err = get(url, "regulations/KS/agency-regulation-resources.html")
            ok, failed, errors = (1, 0, []) if status == 200 else (0, 1, [err or str(status)])
        elif st in ("IL", "ME"):
            status, body, _h, err = get(url, f"regulations/{st}/index.html")
            ok, failed, errors = (1, 0, []) if status == 200 else (0, 1, [err or f"HTTP {status}"])
        elif st == "ID":
            status, body, _h, err = get(url, "regulations/ID/current.html")
            m = re.search(r"var\s+dfmFetchDocuments\s*=\s*(\{.*?\})\s*;", body.decode("utf-8", "replace"), re.S) if body else None
            if not m:
                ok, failed, errors = 0, 1, [err or f"no listing configuration on page (HTTP {status})"]
            else:
                cfg = json.loads(m.group(1))
                base = cfg.get("rest_base", "https://adminrules.idaho.gov/wp-json/dfm-document-display")
                payload = json.dumps({"azurePayload": {"documentType": cfg.get("document_type", "currentRules")}, "updateAgency": True}).encode()
                s2, b2, _h2, e2 = get(base + "/fetch-documents", "regulations/ID/fetch-documents.json", data=payload,
                                      headers={"X-WP-Nonce": cfg["nonce"], "Content-Type": "application/json", "Referer": url})
                ok, failed, errors = (1, 0, []) if s2 == 200 else (0, 1, [e2 or f"HTTP {s2}"])
        elif st == "VA":
            status, body, _h, err = get(url, "regulations/VA/titles.json")
            ok = failed = 0
            errors = []
            if status == 200:
                ok += 1
                for t in json.loads(body):
                    num = t.get("TitleNumber")
                    s2, b2, _h2, e2 = get(f"https://law.lis.virginia.gov/api/AdministrativeCodeGetAgencyListOfJson/{num}", f"regulations/VA/agencies_{num}.json")
                    if s2 != 200:
                        failed += 1
                        errors.append(f"title {num}: {e2 or s2}")
                        continue
                    ok += 1
                    data = json.loads(b2)
                    for ag in (data.get("AgencyList") or []) if isinstance(data, dict) else []:
                        an = ag.get("AgencyNumber")
                        s3, _b3, _h3, e3 = get(f"https://law.lis.virginia.gov/api/AdministrativeCodeChapterListOfJson/{num}/{an}", f"regulations/VA/chapters_{num}_{an}.json")
                        if s3 != 200:
                            failed += 1
                            errors.append(f"{num}/{an}: {e3 or s3}")
                        else:
                            ok += 1
            else:
                failed, errors = 1, [err or f"HTTP {status}"]
        elif st == "NM":
            ok = failed = 0
            errors = []
            titles = []
            for n, sm in enumerate(["https://www.srca.nm.gov/page-sitemap.xml", "https://www.srca.nm.gov/page-sitemap2.xml"]):
                status, body, _h, err = get(sm, f"regulations/NM/sitemap_{n}.xml")
                if status != 200:
                    failed += 1
                    errors.append(f"{sm}: {err or status}")
                    continue
                ok += 1
                for loc in re.findall(r"<loc>([^<]+)</loc>", body.decode("utf-8", "replace")):
                    if re.search(r"/nmac-titles/title-\d+-[^/]+/$", loc) and loc not in titles:
                        titles.append(loc)
            for n, t in enumerate(titles):
                s2, _b, _h2, e2 = get(t, f"regulations/NM/title_{n:03d}.html")
                if s2 != 200:
                    failed += 1
                    errors.append(f"{t}: {e2 or s2}")
                else:
                    ok += 1
        else:
            ok, failed, errors = 0, 1, ["no acquirer"]
    except Exception as error:  # recorded per state
        ok, failed, errors = 0, 1, [str(error)[:300]]
    log({"state": st, "result": "ok" if ok and not failed else ("partial" if ok else "failed"), "parts": ok, "failed": failed,
         "errors": errors[:5], "url": url})


def main(argv):
    states = [s.upper() for s in argv] or sorted(SOURCES)
    with ThreadPoolExecutor(14) as pool:
        list(pool.map(acquire, states))


if __name__ == "__main__":
    main(sys.argv[1:])
