"""C.D. Cal. adapter: the court publishes its judges and their documents in a Vue single-page app ("Judges' Procedures and Schedules",
https://apps.cacd.uscourts.gov/Jps/) whose HTML is an empty shell. The app reads the court's own public JSON service
(https://apps.cacd.uscourts.gov/JpsApi/judge-list and /judge/<id>, with documents at /file/<id>); that is the court's publication of the same
data, so it is read through the same polite fetch layer (robots.txt, one request per second) and nothing is rendered or bypassed.

Kept per judge: the name and title exactly as the service returns them, the address of the judge's page in the app, and the documents the
page lists under "Documents". Not collected by this adapter: telephone numbers, staff names, calendars and tentative rulings (not a hold:
under the owner decision of 2026-10-27 they may be collected as the court publishes them, which is new acquisition, not yet done). Zoom
credentials stay out: they are access credentials, not data.
"""
from __future__ import annotations

import json
import re
import urllib.parse

import fetchlib as fl
import parse_lib as pl

API = "https://apps.cacd.uscourts.gov/JpsApi"
APP = "https://apps.cacd.uscourts.gov/Jps"
LIST_URL = f"{API}/judge-list?mcalPageLimit=1"

MIME_EXT = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/rtf": "rtf",
    "text/plain": "txt",
}


def _json(r) -> object | None:
    if not r.ok or not r.body:
        return None
    try:
        return json.loads(r.body)
    except ValueError:
        return None


def crawl(court: dict, override: dict, refresh: bool, parse_only: bool, result: dict) -> dict:
    lst = fl.get_page(LIST_URL, refresh=refresh)
    result["listing_pages"].append({"url": LIST_URL, "final_url": lst.final_url or LIST_URL, "status": lst.status, "blocked": lst.blocked,
                                    "error": lst.error, "cached": lst.cached, "entries": 0, "kind": "json service used by the court's app"})
    rows = _json(lst)
    if not isinstance(rows, list):
        result["problems"].append("the court's judge service did not return a list of judges")
        return result
    result["listing_pages"][-1]["entries"] = len(rows)
    for row in rows:
        name = pl.clean(str(row.get("name") or ""))
        alias = str(row.get("urlAlias") or "").strip()
        jid = str(row.get("id") or "")
        if not name or not alias or not re.fullmatch(r"[0-9a-f-]{36}", jid):
            continue
        if len(pl.strip_name(name).split()) < 2:  # a placeholder for visiting judges ("Visiting District Judge"), not a person's name
            result["problems"].append(f"the service lists a placeholder '{name}' ({row.get('title')}); not recorded as a judge")
            continue
        page_url = f"{APP}/{alias}"
        detail_url = f"{API}/judge/{jid}"
        if parse_only and fl.cached_page(detail_url) is None:
            continue
        d = fl.get_page(detail_url, refresh=refresh)
        title = pl.clean(str(row.get("title") or "")) or None
        tclass, basis = pl.classify_title(title, court["level"])
        judge = {
            "link_text": name, "page_url": page_url, "final_url": page_url, "listing_url": LIST_URL, "listing_heading": None,
            "status": d.status, "blocked": d.blocked, "error": d.error, "sha256": d.sha256, "cached": d.cached,
            "name_as_published": name, "name": pl.strip_name(name), "title_as_published": title, "title_source": "court's judge service (title)",
            "title_class": tclass, "title_basis": basis, "page_title": None, "documents": [], "excluded": [], "former": None,
            "page_kind": "app_page", "data_url": detail_url,
        }
        detail = _json(d)
        if isinstance(detail, dict):
            docs = []
            for x in sorted(detail.get("documents") or [], key=lambda x: (x.get("sortOrder") is None, x.get("sortOrder"))):
                did = str(x.get("id") or "")
                title_x = pl.clean(str(x.get("name") or x.get("fileName") or ""))
                if not title_x or not re.fullmatch(r"[0-9a-f-]{36}", did):
                    continue
                ext = MIME_EXT.get(str(x.get("fileType") or "").lower())
                if not ext:
                    m = re.search(r"\.([A-Za-z0-9]{2,5})$", str(x.get("fileName") or ""))
                    ext = m.group(1).lower() if m else None
                docs.append(pl.DocLink(title=title_x, url=f"{API}/file/{did}", date_text=None, date=None, kind="file", file_type=ext,
                                       heading="Documents", note="listed on the judge's page in the court's app").__dict__)
            judge["documents"] = docs
        result["judges"].append(judge)
    return result
