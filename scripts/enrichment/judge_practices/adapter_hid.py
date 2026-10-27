"""D. Haw. adapter: the court's website is a React single-page app (empty HTML shell) that reads its judges and each judge's "requirements"
(the individual rules and practices files) from the court's own content service at https://www.hid.uscourts.gov/cms (a Directus API).
That service is the court's publication of the same data; it is read through the same polite fetch layer (robots.txt, one request per
second), asking only for the fields kept here.

Kept per judge: name and title as the service returns them (the app prints "<title> <first> <middle> <last>"), the address of the judge's page
in the app (/judges/<id>), and the requirement files with the titles the app prints. Not kept: telephone numbers, e-mail addresses, courtroom
managers and reporters, photographs.
"""
from __future__ import annotations

import json
import re
import urllib.parse

import fetchlib as fl
import parse_lib as pl

SITE = "https://www.hid.uscourts.gov"
FIELDS = ("id,first_name,middle_name,last_name,title,type,sort_order,requirements.id,requirements.name,requirements.parent_id,requirements.path,"
          "requirements.sort_order,requirements.directus_file.id,requirements.directus_file.title,requirements.directus_file.type,"
          "requirements.directus_file.filename_download,requirements.directus_file.modified_on")
LIST_URL = f"{SITE}/cms/items/judge?limit=-1&fields={FIELDS}"

MIME_EXT = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.wordperfect": "wpd",
    "application/rtf": "rtf",
}


def crawl(court: dict, override: dict, refresh: bool, parse_only: bool, result: dict) -> dict:
    r = fl.get_page(LIST_URL, refresh=refresh)
    lp = {"url": LIST_URL, "final_url": r.final_url or LIST_URL, "status": r.status, "blocked": r.blocked, "error": r.error, "cached": r.cached,
          "entries": 0, "kind": "content service used by the court's website"}
    result["listing_pages"].append(lp)
    try:
        rows = json.loads(r.body)["data"] if r.ok and r.body else None
    except (ValueError, KeyError, TypeError):
        rows = None
    if not isinstance(rows, list):
        result["problems"].append("the court's content service did not return a list of judges")
        return result
    lp["entries"] = len(rows)
    for row in rows:
        jid = row.get("id")
        title = pl.clean(str(row.get("title") or "")) or None
        parts = [pl.clean(str(row.get(k) or "")) for k in ("first_name", "middle_name", "last_name")]
        name = pl.clean(" ".join(p for p in parts if p))
        if not isinstance(jid, int) or not name:
            continue
        tclass, basis = pl.classify_title(title, court["level"])
        title_source = "court's content service (title)"
        if tclass is None and str(row.get("type") or "") == "District":
            tclass, basis, title_source = "district_judge", "court_data", "court's content service (type: District)"
        page_url = f"{SITE}/judges/{jid}"
        judge = {
            "link_text": name, "page_url": page_url, "final_url": page_url, "listing_url": LIST_URL, "listing_heading": None,
            "status": r.status, "blocked": r.blocked, "error": r.error, "sha256": r.sha256, "cached": r.cached,
            "name_as_published": pl.clean(f"{title or ''} {name}"), "name": pl.strip_name(name), "title_as_published": title,
            "title_source": title_source, "title_class": tclass, "title_basis": basis, "page_title": None, "documents": [], "excluded": [],
            "former": None, "page_kind": "app_page", "data_url": LIST_URL,
        }
        docs, seen = [], set()
        for q in sorted(row.get("requirements") or [], key=lambda q: (q.get("sort_order") is None, q.get("sort_order") or 0, q.get("id") or 0)):
            f = q.get("directus_file") or {}
            fid = str(f.get("id") or "")
            if re.fullmatch(r"[0-9a-f-]{36}", fid):
                url = f"{SITE}/cms/assets/{fid}"  # the file the app links (a Directus asset)
                title_x = pl.clean(str(f.get("title") or q.get("name") or f.get("filename_download") or ""))
                ext = MIME_EXT.get(str(f.get("type") or "").lower())
                if not ext:
                    m = re.search(r"\.([A-Za-z0-9]{2,5})$", str(f.get("filename_download") or ""))
                    ext = m.group(1).lower() if m else None
                mod = str(f.get("modified_on") or "")[:10]
                note = "listed under the judge's requirements on the court's website" + (
                    f" (file last modified {mod} in the court's system)" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", mod) else "")
            else:
                path = str(q.get("path") or "")  # no stored file: the app links the path on the court's own site
                if not path.startswith("/") or path.startswith("//"):
                    continue
                url = SITE + urllib.parse.quote(path, safe="/%()")  # the service stores some paths with raw spaces
                title_x = pl.clean(str(q.get("name") or ""))
                m = re.search(r"\.([A-Za-z0-9]{2,5})$", path)
                ext = m.group(1).lower() if m else None
                note = "listed under the judge's requirements on the court's website"
            if not title_x or url in seen:
                continue
            seen.add(url)
            docs.append(pl.DocLink(title=title_x, url=url, date_text=None, date=None, kind="file", file_type=ext, heading="Judge's Requirements",
                                   note=note).__dict__)
        judge["documents"] = docs
        result["judges"].append(judge)
    return result
