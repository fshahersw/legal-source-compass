"""Build the judge_court_pages, judge_practice_documents and judge_court_coverage datasets from the crawl (crawl_courts.py) and the document
stage (fetch_docs.py).

  judge_court_pages          one record per judge per court, as the court's own website lists the judge: name and title as published, the judge's
                             page address, every individual rules / practices / procedures / standing-order / form document linked there, the
                             retrieval time and page hash, and (only on a unique exact match of normalised name plus court) the existing judge profile
  judge_practice_documents   one record per document: its title(s) and dates as published, the official address, the SHA-256 and size of the bytes
                             stored unchanged in the private bucket corpus-originals, and the extracted text (capped) with the method stated
  judge_court_coverage       one record per district or bankruptcy court: how its site lists judges (per-judge pages, one list, none, blocked), the
                             pages read, the counts, and why a court has no judges when it has none

Chambers telephone numbers, e-mail addresses and courtroom deputy names are not extracted from pages and are redacted from document text.

    python3 -I -B scripts/enrichment/judge_practices/build_judge_practices.py
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import fetchlib as fl  # noqa: E402
import parse_lib as pl  # noqa: E402
import profile_match as pm  # noqa: E402

COURTS = os.path.join(ROOT, "private", "build", "judge_practices", "courts")
DOCS = os.path.join(ROOT, "private", "build", "judge_practices", "docs")
OUT = os.path.join(ROOT, "private", "build", "judge_practices")

PAGES_ID, DOCS_ID, COVER_ID = "judge_court_pages", "judge_practice_documents", "judge_court_coverage"
NAME_BAD = re.compile(r"\b(tba|tbd|vacan\w*|open position|to be announced|conflict list|opinions?|calendar|biograph\w*|staff|clerk|seminars?|disclosure|"
                      r"role of|chambers|directory|procedures?)\b", re.I)

TITLE_GROUPS = [
    ("chief_district_judge", "Chief district judges"), ("district_judge", "District judges"), ("senior_district_judge", "Senior district judges"),
    ("chief_magistrate_judge", "Chief magistrate judges"), ("magistrate_judge", "Magistrate judges"),
    ("senior_magistrate_judge", "Recalled magistrate judges"), ("chief_bankruptcy_judge", "Chief bankruptcy judges"),
    ("bankruptcy_judge", "Bankruptcy judges"), ("other", "Other judicial officers listed"), ("unclassified", "Title not stated"),
]
TITLE_LABEL = dict(TITLE_GROUPS)

DOC_KINDS = [
    ("standing_order", re.compile(r"standing order", re.I)),
    ("individual_practices", re.compile(r"(individual|chambers|judge.?s?|civil|criminal)\s+(rules|practices|procedures|practice standards)|practice standards|"
                                         r"practices|courtroom (rules|procedures)|trial procedures", re.I)),
    ("procedures", re.compile(r"procedures?|guidelines|preferences|requirements|policy|policies|instructions", re.I)),
    ("order_or_scheduling", re.compile(r"scheduling|case management|rule 16|rule 26|pretrial|pre-trial|protective order|order setting|proposed order|"
                                       r"standard order|order re", re.I)),
    ("form", re.compile(r"\bforms?\b|consent|checklist|template|sample|cover sheet|exhibit|witness|voir dire|questionnaire|stipulat", re.I)),
]
PAGE_TEXT_TITLE = "Text on the judge's page"
KIND_LABEL = {"page_text": "Text on the judge's page", "standing_order": "Standing order", "individual_practices": "Individual rules / practices", "procedures": "Procedures and guidelines",
              "order_or_scheduling": "Order or scheduling form", "form": "Form or template", "other": "Other document"}


def doc_kind(title: str) -> str:
    for kind, rx in DOC_KINDS:
        if rx.search(title):
            return kind
    return "other"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def valid_judge(j: dict) -> bool:
    name = j.get("name") or ""
    if j.get("status") != 200 or not name or NAME_BAD.search(name) or j.get("former"):
        return False
    return pl.person_like(name, allow_single=True)


def manifest_times() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for e in fl.read_manifest():
        if e.get("status") == 200 and e.get("kind") in ("page", "document"):
            out[e["url"]] = e
    return out


def main() -> None:
    t0 = time.time()
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    roster = {c["court_id"]: c for c in json.load(open(os.path.join(HERE, "court_sites.json"), encoding="utf-8"))["courts"]}
    spine_ids = {json.loads(l)["id"] for l in open(os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups", "court_spine.jsonl"), encoding="utf-8")}
    crawl = {os.path.basename(p)[:-5]: json.load(open(p, encoding="utf-8")) for p in glob.glob(COURTS + "/*.json")}
    docs = {}
    for p in glob.glob(DOCS + "/*.json"):
        d = json.load(open(p, encoding="utf-8"))
        docs[d["url"]] = d
    times = manifest_times()
    index = pm.ProfileIndex()

    # ---- consolidate the judges of each court
    page_rows, doc_judges = [], defaultdict(list)
    cover_rows = []
    totals = Counter()
    link_basis = Counter()
    matrix = Counter()  # title class x profile status
    for cid in sorted(roster):
        c = roster[cid]
        cr = crawl.get(cid)
        judges = [j for j in (cr["judges"] if cr else []) if valid_judge(j)]
        dropped = [j for j in (cr["judges"] if cr else []) if not valid_judge(j)]
        groups: dict[str, list[dict]] = defaultdict(list)
        for j in judges:
            groups[pl.norm_name(j["name"])].append(j)
        # a judge named in a list only as "First Last" and the same judge's own page under "First M. Last": one judge (only when exactly one page fits)
        for key in [k for k, its in groups.items() if len(k.split()) == 2 and all("#" in i["page_url"] for i in its)]:
            first, last = key.split()
            fits = [o for o, its in groups.items() if o != key and len(o.split()) >= 3 and o.split()[0] == first and o.split()[-1] == last
                    and any("#" not in i["page_url"] for i in its)]
            if len(fits) == 1:
                groups[fits[0]].extend(groups.pop(key))
                totals["listing_entries_merged_into_pages"] += 1
        listing_urls = [lp["url"] for lp in (cr["listing_pages"] if cr else []) if lp.get("status") == 200 and lp.get("entries")]
        for key, items in sorted(groups.items()):
            items.sort(key=lambda j: (("#" in j["page_url"]), -(len(j.get("documents") or [])), -bool(j.get("title_class")), j["page_url"]))
            j = items[0]
            seen_docs: dict[str, dict] = {}
            for it in items:
                for d in it.get("documents") or []:
                    seen_docs.setdefault(d["url"], d)
            page_url = j["page_url"]
            fragment = "#" in page_url
            base_url = page_url.split("#")[0]
            for it in items:  # the judge's own page carries the judge's practices in its text: that text is a document of the judge
                pt = docs.get(it["page_url"]) if "#" not in it["page_url"] else None
                if pt and pt.get("kind") == "pagetext" and pt.get("status") == 200:
                    seen_docs.setdefault(it["page_url"], {"url": it["page_url"], "title": PAGE_TEXT_TITLE, "date_text": None, "date": None, "kind": "page",
                                                          "file_type": "html", "note": "the judge's own page; its main text carries the judge's practices"})
            tm = times.get(base_url) or times.get(j.get("final_url", "")) or times.get(j.get("data_url") or "") or {}
            # a page that is an app shell: what was read is the court's own JSON service response (hash of that response)
            tclass = j.get("title_class") or "unclassified"
            m = index.match(cid, j["name"])
            link_basis[(c["level"], tclass.split("_")[-2] if tclass.endswith("judge") and "_" in tclass else tclass, m["status"])] += 1
            rid = f"{cid}-{slug(key)}"
            doc_entries = []
            for url, d in seen_docs.items():
                did = "jpd-" + hashlib.sha1(url.encode()).hexdigest()[:16]
                rec = docs.get(url)
                doc_entries.append({"id": did, "title": d["title"], "url": url, "date_text": d.get("date_text"), "date": d.get("date"),
                                    "file_type": (rec or {}).get("file_type") or d.get("file_type"), "kind": d.get("kind"),
                                    "retrieved": bool(rec and rec.get("status") == 200 and (rec.get("storage") or {}).get("readback_ok")),
                                    "attached_via": d.get("note")})
                doc_judges[url].append({"id": rid, "name": j["name"], "court_id": cid, "title": d["title"], "date_text": d.get("date_text"),
                                        "date": d.get("date"), "judge_id": m.get("judge_id")})
            page_rows.append({"rid": rid, "court": c, "j": j, "key": key, "tclass": tclass, "match": m, "docs": doc_entries, "fragment": fragment,
                              "other_pages": sorted({it["page_url"] for it in items[1:] if it["page_url"] != page_url}),
                              "retrieved_at": tm.get("retrieved_at"), "page_sha256": tm.get("sha256") or j.get("sha256"), "listing_urls": listing_urls})
            totals["judges"] += 1
        # ---- coverage
        kinds = Counter("listing" if "#" in x["page_url"] else "page" for x in judges)
        if not cr:
            status, note = "not_checked", "This court was not crawled."
        elif cr["robots"] and not cr["robots"].get("home_allowed"):
            status, note = "blocked_robots", "The court's robots.txt disallows this crawler; nothing was fetched from the site."
        elif judges:
            status = "ok" if kinds["page"] and not kinds["listing"] else ("list_only" if not kinds["page"] else "mixed")
            note = "; ".join(cr.get("problems") or []) or None
        elif any(lp.get("blocked") for lp in cr["listing_pages"]):
            status, note = "blocked", "The site refused the request; the refusal was not bypassed."
        else:
            status = "no_judges_found"
            note = "; ".join(cr.get("problems") or []) or "No judges list could be read from the pages fetched."
        cover_rows.append({"c": c, "cr": cr, "status": status, "note": note, "judges": judges, "dropped": dropped, "kinds": kinds, "listing_urls": listing_urls})
    ids = [r["rid"] for r in page_rows]
    assert len(ids) == len(set(ids)), "duplicate judge record ids"

    # ---- judge_court_pages rows
    pages_out = []
    for r in sorted(page_rows, key=lambda r: (r["court"]["court_id"], r["tclass"], r["key"])):
        c, j, m = r["court"], r["j"], r["match"]
        title_pub = j.get("title_as_published")
        # words that are the heading the court lists many judges under ("United States Magistrate Judges") are shown as that, not as the judge's title
        heading_title = bool(title_pub) and j.get("title_source") in ("listing heading", "listing page heading")
        title_shown = (f"Listed under “{title_pub}”" if heading_title else title_pub)
        name_pub = j.get("name_as_published") or j["name"]
        level_word = "district" if c["level"] == "district" else "bankruptcy"
        links = [{"url": f"/courts/{c['court_id']}", "label": "Court page"}] if c["court_id"] in spine_ids else []
        if m["status"] == "linked":
            links.insert(0, {"url": f"/judges/{m['judge_id']}", "label": "Judge profile"})
        links.append({"url": j["page_url"].split("#")[0], "label": "Judge's page on the court's website"})
        docs_list = r["docs"]
        facts = [
            ["Name as published", name_pub], ["Name", j["name"]], ["Heading the court lists the judge under" if heading_title else "Title as published", title_pub or "Not recorded"],
            ["Title class (derived from the published words)", TITLE_LABEL.get(r["tclass"], r["tclass"]) + (
                f" — read from {j.get('title_source')}" if j.get("title_source") else "") + (f"; basis: {j.get('title_basis')}" if j.get("title_basis") else "")],
            ["Court", c["name"]], ["Court record", c["court_id"]], ["Page address", j["page_url"]],
            ["Page kind", "A list on the court's page naming the judge (no page of the judge's own)" if r["fragment"] else "The judge's own page on the court's website"],
            ["Retrieved", r["retrieved_at"] or "Not recorded"],
            ["Data read" if j.get("data_url") else "Page SHA-256", (f"{j['data_url']} (SHA-256 of that response: {r['page_sha256'] or 'not recorded'}); the page is a single-page app that shows this data"
                                                                    if j.get("data_url") else (r["page_sha256"] or "Not recorded"))],
            ["Documents linked", len(docs_list)],
            ["Profile link", ("Linked: " + m["basis"]) if m["status"] == "linked" else f"Not linked: {m['reason']}" + (f" ({m['candidates']} candidates)" if m["candidates"] else "")],
            ["Source", "The court's own website; chambers telephone numbers, e-mail addresses and staff names are not copied. Read the judge's page for contact details."],
        ]
        sections = []
        if docs_list:
            sections.append({"heading": "Documents linked from the judge's page", "items": [
                {"title": d["title"], "subtitle": " · ".join(x for x in [d.get("date_text"), (d.get("file_type") or "").upper() or None,
                                                                          None if d["retrieved"] else "not retrieved"] if x),
                 "links": [{"url": d["url"], "label": "Open on the court's website"}, {"url": f"/records/{DOCS_ID}/{d['id']}", "label": "Extracted text and file record"}]}
                for d in docs_list]})
        text = " ".join([name_pub, j["name"], title_pub or "", c["name"]] + [d["title"] for d in docs_list])
        profile = {"status": m["status"], "judge_id": m.get("judge_id"), "basis": m.get("basis"), "reason": m.get("reason"), "candidates": m["candidates"], "candidate_ids": m.get("candidate_ids")}
        judge_page = {
            "id": r["rid"], "court_id": c["court_id"], "court": c["name"], "level": c["level"], "state": c["state"], "name": j["name"],
            "name_as_published": name_pub, "title_as_published": title_pub, "title_class": r["tclass"], "title_label": TITLE_LABEL.get(r["tclass"], r["tclass"]),
            "title_source": j.get("title_source"), "title_basis": j.get("title_basis"), "listing_heading": j.get("listing_heading"),
            "page_url": j["page_url"].split("#")[0], "page_kind": "listing_entry" if r["fragment"] else "judge_page", "other_pages": r["other_pages"],
            "listing_url": j.get("listing_url"), "retrieved_at": r["retrieved_at"], "page_sha256": r["page_sha256"], "data_url": j.get("data_url"), "profile": profile,
            "documents": docs_list,
        }
        pages_out.append(writer.record(
            PAGES_ID, r["rid"], f"{j['name']} — {c['name']}", source_url=j["page_url"].split("#")[0], state=c["state"],
            subtitle=f"{title_shown or TITLE_LABEL.get(r['tclass'], '')} · {c['name']} · {len(docs_list)} document{'s' if len(docs_list) != 1 else ''}",
            cells={"judge": j["name"], "title": title_shown or "Not recorded", "title_class": TITLE_LABEL.get(r["tclass"], r["tclass"]), "court": c["name"],
                   "court_id": c["court_id"], "documents": len(docs_list), "profile": "Linked" if m["status"] == "linked" else "Not linked"},
            badges=["Court's own website"] + (["Judge profile linked"] if m["status"] == "linked" else []),
            facts=facts, text=text, links=links,
            filters={"court": [c["court_id"]], "level": [level_word], "title_class": [r["tclass"]], "has_documents": ["yes" if docs_list else "no"],
                     "profile": [m["status"]], "state": [c["state"]] if c["state"] else [],
                     **({"judge": [m["judge_id"]]} if m["status"] == "linked" else {})},
            extra={"judge_page": judge_page, "sections": sections,
                   # compact form read by the court roster (one query for a whole bench without every document)
                   "roster": {"id": r["rid"], "name": j["name"], "name_as_published": name_pub, "title": title_pub, "title_class": r["tclass"],
                              "title_source": j.get("title_source"), "documents": len(docs_list), "documents_retrieved": sum(1 for d in docs_list if d["retrieved"]),
                              "profile_id": m.get("judge_id") if m["status"] == "linked" else None, "profile_status": m["status"],
                              "page_url": j["page_url"].split("#")[0], "page_kind": "listing_entry" if r["fragment"] else "judge_page"}}))
        # sections live in detail as well
        pages_out[-1]["detail"]["sections"] = sections
        pages_out[-1]["detail"]["qualification"] = ("Names, titles and document titles are shown as the court's website prints them. A title class is a reading of the "
                                                    "printed words, not a statement by the court. Dates are those printed beside the link; none is inferred.")
        totals[f"title_{r['tclass']}"] += 1
        totals[f"profile_{m['status']}"] += 1
        matrix[f"{r['tclass']}|{m['status']}"] += 1

    # ---- judge_practice_documents rows
    docs_out = []
    doc_stats = Counter()
    for url, d in sorted(docs.items()):
        if url not in doc_judges:
            continue  # a stored record whose judge page is no longer part of the roster
        did = "jpd-" + hashlib.sha1(url.encode()).hexdigest()[:16]
        owners = doc_judges[url]
        title = owners[0]["title"]
        titles = sorted({o["title"] for o in owners})
        courts = sorted({o["court_id"] for o in owners})
        c0 = roster[courts[0]]
        got = d.get("status") == 200 and (d.get("storage") or {}).get("readback_ok")
        st = d.get("storage") or {}
        text = (d.get("text") or "").replace("﻿", "")
        kind = "page_text" if d.get("kind") == "pagetext" else doc_kind(title)
        doc = {
            "id": did, "title": title, "titles": titles, "url": url, "final_url": d.get("final_url") or url, "file_type": d.get("file_type") or d.get("file_type_from_url"),
            "detected_type": d.get("detected_type"), "http_status": d.get("status"), "retrieved_at": d.get("retrieved_at"), "bytes": d.get("bytes"),
            "sha256": d.get("sha256"), "stored": bool(got),
            "storage": {"bucket": st.get("bucket"), "key": st.get("key"), "sha256": st.get("sha256"), "bytes": st.get("bytes"), "readback_sha256": st.get("readback_sha256"),
                        "readback_bytes": st.get("readback_bytes"), "readback_ok": bool(st.get("readback_ok")), "verified_at": st.get("verified_at")} if st else None,
            "wrapper": d.get("wrapper"), "file_url": d.get("file_url"), "pages": d.get("pages"), "text_chars": len(text), "text_chars_total": d.get("text_chars_total"),
            "text_truncated": bool(d.get("text_truncated")), "text_method": d.get("text_method"), "text_error": d.get("text_error"), "redactions": d.get("redactions"),
            "text_sha256": hashlib.sha256(text.encode()).hexdigest() if text else None, "error": d.get("error"), "kind": kind, "kind_label": KIND_LABEL[kind],
            "judges": [{"id": o["id"], "name": o["name"], "court_id": o["court_id"], "judge_id": o["judge_id"], "title": o["title"], "date_text": o["date_text"], "date": o["date"]}
                       for o in owners],
        }
        dates = sorted({o["date"] for o in owners if o["date"]})
        facts = [
            ["Title as published" if kind != "page_text" else "Title (assigned: the judge's page itself, not a separate file)", "; ".join(titles)], ["Judge(s)", "; ".join(f"{o['name']} ({o['court_id']})" for o in owners)],
            ["Official address", url], ["Retrieved", d.get("retrieved_at") or "Not retrieved"],
            ["HTTP status", d.get("status") if d.get("status") is not None else (d.get("error") or "Not retrieved")],
            ["File type", (doc["file_type"] or "Not recorded")], ["Size (bytes)", d.get("bytes") if d.get("bytes") is not None else "Not recorded"],
            ["SHA-256 of the bytes", d.get("sha256") or "Not recorded"],
            ["Stored copy", f"{st['bucket']}/{st['key']} (read back, SHA-256 and size match)" if got else "Not stored"],
            ["Date printed beside the link", "; ".join(sorted({o['date_text'] for o in owners if o['date_text']})) or "Not recorded"],
            ["Pages", d.get("pages") if d.get("pages") else "Not recorded"],
            ["Text", f"{len(text):,} characters" + (f" of {d['text_chars_total']:,} (capped)" if d.get("text_truncated") else "") + f"; {d.get('text_method') or 'no extraction'}" if text
             else f"No text: {d.get('text_error') or d.get('error') or 'not extracted'}"],
            ["Redacted from the text", "; ".join(f"{k.replace('_', ' ')}: {v}" for k, v in (d.get("redactions") or {}).items() if v) or "None"],
        ]
        links = [{"url": url, "label": "Open on the court's website"}] + [
            {"url": f"/records/{PAGES_ID}/{o['id']}", "label": f"{o['name']} — judge's page record"} for o in owners[:6]] + [
            {"url": f"/judges/{o['judge_id']}", "label": f"{o['name']} — judge profile"} for o in owners[:6] if o.get("judge_id")]
        docs_out.append(writer.record(
            DOCS_ID, did, title, source_url=url, state=c0["state"],
            subtitle=f"{KIND_LABEL[kind]} · {(doc['file_type'] or '').upper()} · {', '.join(courts)}" + (f" · {dates[-1]}" if dates else ""),
            cells={"title": title, "judge": owners[0]["name"], "court": roster[owners[0]["court_id"]]["name"], "court_id": owners[0]["court_id"],
                   "kind": KIND_LABEL[kind], "file_type": (doc["file_type"] or "").upper(), "date": dates[-1] if dates else "Not recorded",
                   "text": "Yes" if text else "No"},
            badges=["Court's own website"] + (["Original stored"] if got else ["Not retrieved"]), facts=facts,
            text=text, links=links,
            filters={"court": courts, "judge_page": [o["id"] for o in owners], "kind": [kind], "file_type": [doc["file_type"]] if doc["file_type"] else [],
                     "has_text": ["yes" if text else "no"], "stored": ["yes" if got else "no"],
                     "judge": sorted({o["judge_id"] for o in owners if o.get("judge_id")}), "level": sorted({roster[x]["level"] for x in courts})},
            extra={"practice_document": doc}))
        doc_stats["documents"] += 1
        doc_stats["stored"] += bool(got)
        doc_stats["with_text"] += bool(text)
        doc_stats["truncated"] += bool(d.get("text_truncated"))
        doc_stats["bytes"] += d.get("bytes") or 0
        doc_stats["text_chars"] += len(text)
        doc_stats[f"type_{doc['file_type']}"] += 1
        doc_stats[f"kind_{kind}"] += 1
        if d.get("status") != 200:
            doc_stats["failed"] += 1
        for k, v in (d.get("redactions") or {}).items():
            doc_stats[f"redacted_{k}"] += v

    # ---- judge_court_coverage rows
    cover_out = []
    for cv in cover_rows:
        c, cr = cv["c"], cv["cr"]
        by_title = Counter()
        for j in cv["judges"]:
            by_title[j.get("title_class") or "unclassified"] += 1
        names = {pl.norm_name(j["name"]) for j in cv["judges"]}
        my = [r for r in page_rows if r["court"]["court_id"] == c["court_id"]]
        nd = sum(len(r["docs"]) for r in my)
        linked = sum(1 for r in my if r["match"]["status"] == "linked")
        listing_pages = [{"url": lp["url"], "status": lp.get("status"), "judges_found": lp.get("entries"), "blocked": lp.get("blocked")}
                         for lp in (cr["listing_pages"] if cr else [])]
        info = {
            "court_id": c["court_id"], "court": c["name"], "level": c["level"], "state": c["state"], "site": f"https://{c['host']}/", "shared_with": c["shared_with"],
            "status": cv["status"], "note": cv["note"], "judges": len(my), "by_title_class": {k: v for k, v in by_title.items()},
            "judge_pages": cv["kinds"].get("page", 0), "listing_entries": cv["kinds"].get("listing", 0), "documents": nd, "profiles_linked": linked,
            "profiles_not_linked": len(my) - linked, "robots": (cr or {}).get("robots"), "listing_pages": listing_pages,
            "entries_not_included": [{"name": j.get("name") or j.get("link_text"), "url": j["page_url"], "why": "name not usable" if j.get("status") == 200 else f"page returned {j.get('status') or j.get('error')}"}
                                     for j in cv["dropped"]][:30],
            "index_pages": (cr or {}).get("index_pages"), "index_docs_attached": (cr or {}).get("index_docs_attached"),
        }
        cover_out.append(writer.record(
            COVER_ID, c["court_id"], f"{c['name']}: judges on the court's website", source_url=listing_pages[0]["url"] if listing_pages else f"https://{c['host']}/",
            state=c["state"], subtitle=f"{len(my)} judge{'s' if len(my) != 1 else ''} · {nd} documents · {cv['status'].replace('_', ' ')}",
            cells={"court": c["name"], "court_id": c["court_id"], "level": c["level"], "judges": len(my), "documents": nd, "status": cv["status"].replace("_", " ")},
            badges=["Court's own website"], facts=[[k, str(v)] for k, v in [
                ("Court", c["name"]), ("Website", info["site"]), ("Status", cv["status"].replace("_", " ")), ("Judges listed", len(my)),
                ("Judge pages read", info["judge_pages"]), ("Judges named only in a list", info["listing_entries"]), ("Documents linked", nd),
                ("Judges linked to an existing profile", linked), ("Judges with no profile in the corpus", len(my) - linked),
                ("Listing pages read", len(listing_pages)), ("Note", cv["note"] or "None")]],
            text=f"{c['name']} judges roster {cv['status']}", links=[{"url": f"/courts/{c['court_id']}", "label": "Court page"}] if c["court_id"] in spine_ids else [],
            filters={"level": [c["level"]], "status": [cv["status"]], "state": [c["state"]] if c["state"] else []},
            extra={"coverage": info}))

    # ---- specs
    summary_common = {
        "source": "Each federal district and bankruptcy court's own website (judges listing pages, judge pages and the documents they link)",
        "method": ("Listing pages found from each court's home page (or a stated override), judge pages fetched at most once each, documents downloaded unchanged "
                   "and stored in the private bucket corpus-originals under judge_practices/<retrieval date>/ with a whole-object SHA-256 readback. "
                   "robots.txt obeyed (including Crawl-delay); at most one request per second to a court site; no 403 or bot wall bypassed."),
        "privacy": "No chambers telephone number, e-mail address or courtroom deputy name is extracted from a page; document text has e-mail addresses, telephone numbers and staff-contact lines redacted (counts recorded). Originals are stored unchanged.",
        "profile_matching": ("A judge is linked to an existing profile only on a unique exact match of normalised name (case, accents, punctuation and suffixes removed, middle names "
                             "reduced to initials) plus court, using the judge directory and the FJC service lookup; no match, or more than one, leaves the judge unlinked."),
    }
    pages_spec = {
        "dataset": PAGES_ID, "label": "Judges as listed on their court's own website: title, page and individual rules and practices (district and bankruptcy courts)",
        "rows": pages_out,
        "listing_block": writer.listing(
            [("judge", "Judge"), ("title", "Title as published"), ("court", "Court"), ("documents", "Documents"), ("profile", "Profile")],
            [("level", "Court level", {"district": "District courts", "bankruptcy": "Bankruptcy courts"}),
             ("title_class", "Title", {k: v for k, v in TITLE_GROUPS}), ("has_documents", "Documents", {"yes": "With documents", "no": "Without documents"}),
             ("profile", "Profile link", {"linked": "Linked to a profile", "unmatched": "No profile found", "ambiguous": "More than one profile"})]),
        "summary": {**summary_common, "totals": {"records": len(pages_out), "judges_by_title_class": {k[6:]: v for k, v in totals.items() if k.startswith("title_")},
                                                  "profile_links": {k[8:]: v for k, v in totals.items() if k.startswith("profile_")}}}}
    docs_spec = {
        "dataset": DOCS_ID, "label": "Judges' individual rules, practices, procedures, standing orders and forms from court websites (originals stored, text extracted)",
        "rows": docs_out,
        "listing_block": writer.listing(
            [("title", "Title as published"), ("judge", "Judge"), ("court", "Court"), ("kind", "Kind"), ("file_type", "Type"), ("date", "Date printed")],
            [("kind", "Kind", {k: v for k, v in KIND_LABEL.items()}), ("level", "Court level", {"district": "District courts", "bankruptcy": "Bankruptcy courts"}),
             ("has_text", "Text", {"yes": "Text extracted", "no": "No text"}), ("stored", "Original", {"yes": "Stored and verified", "no": "Not stored"})]),
        "summary": {**summary_common, "text": ("Plain text extracted by the method stated on each record (pdftotext, python-docx, LibreOffice or the page's visible text), capped at "
                                              f"{100_000:,} characters per document; the cap and any truncation are recorded. Scanned PDFs have no text layer and no OCR was run."),
                    "totals": {k: v for k, v in doc_stats.items()}}}
    status_count = Counter(cv["status"] for cv in cover_rows)
    cover_spec = {
        "dataset": COVER_ID, "label": "How each federal district and bankruptcy court's website lists its judges (coverage and gaps)", "rows": cover_out,
        "listing_block": writer.listing(
            [("court", "Court"), ("level", "Level"), ("judges", "Judges"), ("documents", "Documents"), ("status", "Status")],
            [("level", "Court level", {"district": "District courts", "bankruptcy": "Bankruptcy courts"}),
             ("status", "Status", {"ok": "Judge pages read", "list_only": "Names read from a list", "mixed": "Pages and lists", "no_judges_found": "No judges list read",
                                   "blocked_robots": "Blocked by robots.txt", "blocked": "Site refused the request", "not_checked": "Not checked"})]),
        "summary": {**summary_common, "totals": {"records": len(cover_out), "by_status": dict(status_count)}}}
    inputs = [{"url": "https://www.uscourts.gov/about-federal-courts/federal-courts-public/court-website-links", "path": "private/acq/court_locations/uscourts/court-website-links.html",
               "sha256": hashlib.sha256(open(os.path.join(ROOT, "private", "acq", "court_locations", "uscourts", "court-website-links.html"), "rb").read()).hexdigest()},
              {"url": "private:judge_directory", "path": "private/build/judge_xwalk/lookups/judges.jsonl",
               "sha256": hashlib.sha256(open(os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups", "judges.jsonl"), "rb").read()).hexdigest()},
              {"url": "private:request_manifest", "path": "private/acq/judge_practices/_manifest.jsonl",
               "sha256": hashlib.sha256(open(fl.MANIFEST, "rb").read()).hexdigest()}]
    os.makedirs(OUT, exist_ok=True)
    for spec in (pages_spec, docs_spec, cover_spec):
        spec["built_at"] = built_at
        spec["inputs"] = inputs
        path = os.path.join(OUT, spec["dataset"] + ".json")
        with open(path + ".tmp", "w", encoding="utf-8") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(spec["dataset"], len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")
    stats = {"courts": len(roster), "coverage_status": dict(status_count), "judges": len(pages_out), "documents": len(docs_out), "doc_stats": dict(doc_stats),
             "title_classes": {k[6:]: v for k, v in totals.items() if k.startswith("title_")}, "profile": {k[8:]: v for k, v in totals.items() if k.startswith("profile_")}, "title_class_x_profile": dict(matrix)}
    with open(os.path.join(OUT, "build_stats.json"), "w", encoding="utf-8") as h:
        json.dump(stats, h, indent=1, sort_keys=True, default=str)
    print(json.dumps(stats, default=str)[:3000])
    print(f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
