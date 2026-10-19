"""Build the court_rules stream's datasets from the work files (deterministic; no network).

  python3 -I -B scripts/enrichment/court_rules/build_court_rules.py

Inputs: private/build/court_rules/work/{documents.json, sections.jsonl, insights.json, constitutions.json,
constitution_sections.jsonl, regulation_codes.json, regulation_index.jsonl} (made by extract_rules.py, insights.py,
extract_constitutions.py and extract_regulations.py from private/acq/court_rules/ only) and the committed reference files
in this folder. Outputs one build file per dataset in private/build/court_rules/<dataset>.json, in the shape
private/scratch/enrich/publish_build.py publishes unchanged.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
import fetchlib  # noqa: E402
from corpus_writer import listing, record  # noqa: E402
from extract_constitutions import STATE_NAMES  # noqa: E402
from insights import CATEGORIES  # noqa: E402

ROOT = fetchlib.ROOT
BUILD = os.path.join(ROOT, "private", "build", "court_rules")
WORK = os.path.join(BUILD, "work")
COURTS = json.load(open(os.path.join(HERE, "court_spine_federal.json")))["courts"]
STATUS_LABEL = {
    "text": "Retrieved; text extracted", "robots_disallowed": "Not retrieved: the court's robots.txt disallows automated retrieval",
    "no_text_layer": "Retrieved; the PDF has no text layer (scanned)", "blocked_automated_access": "Not retrieved: the host blocks automated requests",
    "not_retrieved": "Not retrieved",
}
CATEGORY_LABEL = {"response_deadline": "Response deadline", "reply_deadline": "Reply deadline", "other_deadline": "Other deadline",
                  "page_limit": "Page limit", "word_limit": "Word or line limit", "formatting": "Formatting", "filing": "Filing and service",
                  "meet_and_confer": "Meet and confer", "pro_hac_vice": "Pro hac vice and admission", "adr": "ADR and mediation",
                  "judge_practice": "Judges' own practices"}
NR = "Not recorded"


def own_text(row: dict, text: str) -> dict:
    """The row's text column holds the provision's own words only (record() would prefix id and title), so the page can
    show it as published; the title is indexed for search separately."""
    row["text"] = text
    return row


CAPS_CUT = re.compile(r"(\b(OF|AND|OR|THE|A|AN|TO|FOR|IN|ON|BY|FROM|WITH|UNDER|AGAINST|BEFORE|AS|AT|INTO|UPON)|[,;:—–-]|[’']S)$")
CAPS_NOT_TITLE = re.compile(r"^(\(|\[|CIRCUIT ADVISORY|ADVISORY COMMITTEE|COMMITTEE NOTE|MODEL FORM|RESERVED\b|"
                            r"(RULE|FRAP|LOCAL|CIRCUIT RULE|LR|L\.R\.)\s*\d)|\b(SHALL|MUST|MAY NOT)\b")
CAPS_WIDE = 38  # a heading line this long has probably reached the printed line width and wrapped


def _caps(s: str) -> bool:
    return bool(re.search(r"[A-Z]", s)) and not re.search(r"[a-z]", s)


def full_title(title: str | None, text: str) -> str | None:
    """A rule heading printed over two lines is joined with its continuation from the section's own text: a hyphenated
    break ("...; Mo-" / "tion for Judgment ...") or, for an all-capitals heading, up to two more all-capitals lines when
    the heading line looks cut (it ends in a connecting word, punctuation or a possessive, or fills the printed line
    width). A sentence, a committee note, a form title, "RESERVED" or another rule label is never joined."""
    if not title:
        return title
    lines = [ln.strip() for ln in text.split("\n")]
    if re.search(r"[a-z]-$", title):
        tail = title.split()[-1]
        for i, ln in enumerate(lines):
            if ln.endswith(tail):
                nxt = next((x for x in lines[i + 1:] if x), "")
                if nxt[:1].islower() and len(nxt) <= 160:
                    return title[:-1] + nxt
                break
        return title
    if not _caps(title) or len(title.split()) < 2:
        return title
    i = next((n for n, ln in enumerate(lines[:4]) if ln.endswith(title)), None)
    if i is None:
        return title
    joined, last = title, lines[i]
    for nxt in [x for x in lines[i + 1:] if x and x != "\f"][:2]:
        if not (_caps(nxt) and len(nxt) <= 80 and not CAPS_NOT_TITLE.search(nxt)):
            break
        if not (CAPS_CUT.search(last) or len(last) >= CAPS_WIDE):
            break
        joined = f"{joined[:-1]}{nxt}" if joined.endswith(("-", "—", "–")) else f"{joined} {nxt}"
        last = nxt
    return joined


def load_jsonl(name):
    with fetchlib.open_text(os.path.join(WORK, name)) as handle:
        return [json.loads(line) for line in handle if line.strip()]


def court_label(cid: str) -> str:
    return COURTS[cid][0] if cid in COURTS else cid


def doc_display_title(d: dict) -> str:
    if d["scope"] == "federal_local":
        return f"{COURTS.get(d['courts'][0], [d['courts'][0], d['courts'][0]])[1]}: {d['title']}"
    return d["title"]


def inputs_of(paths):
    out = []
    for name in paths:
        p = os.path.join(WORK, name)
        body = fetchlib.load_raw(p if os.path.exists(p) else p + ".gz")  # sha256 of the uncompressed content either way
        out.append({"url": None, "path": os.path.relpath(p, ROOT), "sha256": hashlib.sha256(body).hexdigest()})
    return out


# How practice points were proposed; the model itself is not named in published data.
METHOD = "language model at build time; kept only when validated against a word-for-word quote of the rule"


def second_path_note(kept: int) -> str:
    """What verify_court_rules.py found for these insights, from its last run on a build with the same number of rows."""
    path = os.path.join(BUILD, "verification.json")
    v = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    c = v.get("checked") or {}
    if c.get("insights") != kept:
        return "Not yet rechecked by a separate extraction for this build."
    pdf, on_page, pdf_missing = (c.get("insight_quotes_found_in_pdf_by_pypdf", 0), c.get("insight_quotes_on_cited_page_by_pypdf", 0),
                                 c.get("insight_quotes_not_found_in_pdf_by_pypdf", 0))
    html, html_missing = c.get("insight_quotes_found_in_html", 0), c.get("insight_quotes_not_found_in_html", 0)
    skipped = (v.get("not_rechecked") or {}).get("insight_second_path_not_rechecked_pdf_pruned", 0)
    note = (f"Each kept quote was looked for again in the retrieved file by a separate extraction ({v.get('verified_at', 'date not recorded')}): "
            f"{pdf:,} of {pdf + pdf_missing:,} PDF quotes found with pypdf, {on_page:,} of them on their cited page or the next; "
            f"{html:,} of {html + html_missing:,} HTML quotes found in the page's plain text (BeautifulSoup).")
    if skipped:
        note += (f" {skipped:,} quotes were not rechecked: their PDFs were deleted after extraction and the publisher now serves "
                 "different bytes, so the stored text is from the first retrieval.")
    return note


def write_build(dataset, label, rows, listing_block, summary, inputs):
    build = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
             "built_at": fetchlib.utc_now(), "inputs": inputs}
    # written gzipped to spare the shared disk; compress_outputs.py --plain <dataset> restores the plain file to publish it
    path = os.path.join(BUILD, f"{dataset}.json.gz")
    if os.path.exists(path[:-3]):
        os.remove(path[:-3])
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as handle:
        json.dump(build, handle, ensure_ascii=False)
    print(json.dumps({"dataset": dataset, "rows": len(rows), "gzip_bytes": os.path.getsize(path)}))


def build_rules():
    docs = fetchlib.load_json(os.path.join(WORK, "documents.json"))
    sections = load_jsonl("sections.jsonl")
    ins = fetchlib.load_json(os.path.join(WORK, "insights.json"))
    by_doc_sections = Counter(s["doc"] for s in sections)
    kept_by_doc = {d["doc"]: d for d in ins["documents"]}
    doc_rows, sec_rows, ins_rows = [], [], []
    doc_index = {}
    # courts whose website forbids automated access get a record saying so, so their page shows the gap
    for cid, reason in sorted((docs.get("skipped_courts") or {}).items()):
        host = re.search(r"\bat (www\.[a-z0-9.-]+\.gov)\b", reason)
        if cid not in COURTS or any(d["courts"] == [cid] for d in docs["documents"]):
            continue
        docs["documents"].append({"id": f"{cid}-local", "scope": "federal_local", "courts": [cid], "state": "", "levels": [],
                                  "part": "local", "title": "Local Rules", "status": "robots_disallowed", "url": None,
                                  "found_on": f"https://{host.group(1)}/" if host else None, "format": "",
                                  "note": "Open the court's website to read its local rules", "retrieval_note": reason,
                                  "publisher": "The court's own website"})
    for d in docs["documents"]:
        doc_index[d["id"]] = d
        title = doc_display_title(d)
        insights = kept_by_doc.get(d["id"], {}).get("kept", [])
        cats = Counter(i["category"] for i in insights)
        status = d.get("status", "not_retrieved")
        jurisdiction = ("Federal (national)" if d["scope"] == "federal_national" else
                        ("Federal court: " + ", ".join(court_label(c) for c in d["courts"]) if d["scope"] == "federal_local" else STATE_NAMES.get(d["state"], d["state"])))
        links = [{"url": f"/courts/{c}", "label": court_label(c)} for c in d["courts"] if c in COURTS]
        if d["state"]:
            links.append({"url": f"/places/{d['state']}", "label": STATE_NAMES.get(d["state"], d["state"])})
        info = {k: d.get(k) for k in ("scope", "courts", "state", "levels", "part", "url", "found_on", "format", "publisher", "note",
                                       "retrieval_note", "pages", "chars", "split", "coverage", "retrieved_at", "sha256", "bytes",
                                       "text_source_url", "text_source_sha256", "text_sha256", "rule_pages", "citation", "checked_at")}
        info.update(status=status, status_label=STATUS_LABEL.get(status, status), sections=by_doc_sections.get(d["id"], 0),
                    insights=len(insights), insight_categories=dict(cats), title=d["title"], display_title=title)
        facts = [["Jurisdiction", jurisdiction], ["Publisher", d.get("publisher") or NR], ["Official document", d.get("url") or NR],
                 ["Listed on", d.get("found_on") or NR], ["Status", STATUS_LABEL.get(status, status)],
                 ["Sections", str(by_doc_sections.get(d["id"], 0))], ["Extracted practice points", str(len(insights))],
                 ["Retrieved", d.get("retrieved_at") or NR], ["SHA-256 of retrieved file", d.get("sha256") or NR]]
        if d.get("note"):
            facts.append(["Note", d["note"]])
        filters = {"scope": [d["scope"]], "status": [status], "part": [d.get("part") or "rules"]}
        if d["courts"]:
            filters["court"] = d["courts"]
        if d["state"]:
            filters["state"] = [d["state"]]
        if d.get("levels"):
            filters["level"] = d["levels"]
        doc_rows.append(record("court_rule_documents", d["id"], title, source_url=d.get("url") or d.get("found_on"),
                               cells={"document": title, "jurisdiction": jurisdiction, "status": STATUS_LABEL.get(status, status),
                                      "sections": by_doc_sections.get(d["id"], 0), "insights": len(insights)},
                               facts=facts, text=" ".join([title, jurisdiction, d.get("publisher") or ""]), filters=filters,
                               subtitle=jurisdiction, badges=[d["format"].upper()] if d.get("format") else [], links=links, state=d["state"] or "",
                               extra={"rule_document": info}))
    fixed_titles = {}
    for s in sections:
        t = full_title(s["title"], s["text"])
        if t != s["title"]:
            fixed_titles[s["id"]] = t
            s = {**s, "title": t}
        d = doc_index[s["doc"]]
        title = f"{s['label']}. {s['title']}" if s["title"] and s["title"] != s["label"] else s["label"]
        info = {k: s.get(k) for k in ("doc", "ordinal", "label", "number", "title", "page", "source_url", "group", "part", "parts", "occurrence",
                                       "split", "comment_chars_not_included")}
        info["chars"] = len(s["text"])
        filters = {"doc": [s["doc"]], "scope": [d["scope"]]}
        if d["courts"]:
            filters["court"] = d["courts"]
        if d["state"]:
            filters["state"] = [d["state"]]
        sec_rows.append(own_text(record("court_rule_sections", s["id"], title, source_url=s["source_url"],
                                        cells={"rule": title, "document": doc_display_title(d), "page": s.get("page") or NR},
                                        facts=[["Document", doc_display_title(d)], ["Page", str(s["page"]) if s.get("page") else NR],
                                               ["Official source", s["source_url"]]],
                                        text=s["text"], filters=filters, subtitle=doc_display_title(d), state=d["state"] or "",
                                        links=[{"url": f"/records/court_rule_documents/{s['doc']}", "label": "Rule document"}],
                                        extra={"rule_section": info}), s["text"]))
    n_by_doc = defaultdict(int)
    # practice points in reading order for a court page: the court's own (or the state's) rules before the national
    # rules, documents in their listed order, then deadlines, limits, formatting, filing, ... and rule order
    doc_order = {d["id"]: (1 if d["scope"] == "federal_national" else 0, n) for n, d in enumerate(docs["documents"])}
    cat_order = {c: n for n, c in enumerate(CATEGORY_LABEL)}
    sec_order = {s["id"]: s.get("ordinal") or 0 for s in sections}
    for docres in sorted(ins["documents"], key=lambda r: doc_order.get(r["doc"], (2, 0))):
        d = doc_index[docres["doc"]]
        kept = sorted(docres["kept"], key=lambda i: (cat_order.get(i["category"], 99), sec_order.get(i["section_id"], 0)))
        for i in kept:
            if i["section_id"] in fixed_titles:
                i = {**i, "section_title": fixed_titles[i["section_id"]]}
            n_by_doc[d["id"]] += 1
            iid = f"{d['id']}:i{n_by_doc[d['id']]:03d}"
            title = " ".join(f"{i['applies_to'] or CATEGORY_LABEL[i['category']]}: {i['value']}".split())  # display title on one line
            info = {**i, "doc": d["id"], "doc_title": doc_display_title(d), "doc_url": d.get("url"), "category_label": CATEGORY_LABEL[i["category"]],
                    "extraction": METHOD, "prompt_version": docres.get("prompt_version")}
            filters = {"doc": [d["id"]], "category": [i["category"]], "scope": [d["scope"]]}
            if d["courts"]:
                filters["court"] = d["courts"]
            if d["state"]:
                filters["state"] = [d["state"]]
            ins_rows.append(record("court_rule_insights", iid, title, source_url=i["source_url"],
                                   cells={"requirement": title, "category": CATEGORY_LABEL[i["category"]], "rule": i["section_label"],
                                          "document": doc_display_title(d)},
                                   facts=[["Category", CATEGORY_LABEL[i["category"]]], ["Applies to", i["applies_to"] or NR],
                                          ["Value", i["value"]], ["Quote", i["quote"]], ["Rule", f"{i['section_label']} {i['section_title'] or ''}".strip()],
                                          ["Page", str(i["page"]) if i.get("page") else NR], ["Quote check", i["quote_match"]],
                                          ["Official source", i["source_url"]]],
                                   text=" ".join([title, i["quote"], i["section_label"]]), filters=filters, subtitle=doc_display_title(d),
                                   state=d["state"] or "", links=[{"url": f"/records/court_rule_sections/{i['section_id']}", "label": "Rule text"}],
                                   extra={"rule_insight": info}))
    inputs = inputs_of(["documents.json", "sections.jsonl", "insights.json"])
    statuses = Counter(d.get("status") for d in docs["documents"])
    common = {"published_for": "court rules panel on /courts/<id> and the rules section of the law pages",
              "sources": "uscourts.gov and govinfo.gov (federal rules), each federal court's own website (local rules), revisor.mn.gov, "
                         "leg.state.nv.us, floridabar.org, txcourts.gov (state rules); NJ Judiciary blocked automated access",
              "reuse": "Discovery and parsing logic adapted from Vaquill-AI/open-us-law scripts/court_rules (Apache-2.0); none of that project's data is used."}
    write_build("court_rule_documents", "Court rules: federal rules, federal court local rules and state rules of court (official sources, October 2026)", doc_rows,
                listing([("document", "Document"), ("jurisdiction", "Jurisdiction"), ("status", "Status"), ("sections", "Sections"), ("insights", "Practice points")],
                        [("scope", "Scope", {"federal_national": "Federal rules", "federal_local": "Federal local rules", "state": "State rules"})]),
                {**common, "documents": len(doc_rows), "status_counts": dict(statuses),
                 "skipped_courts": docs.get("skipped_courts"), "method": "One record per official rule document with its official address, the page it is linked from, retrieval time and SHA-256."},
                inputs)
    write_build("court_rule_sections", "Court rules: rule-by-rule text (official sources, October 2026)", sec_rows,
                listing([("rule", "Rule"), ("document", "Document"), ("page", "Page")]),
                {**common, "sections": len(sec_rows), "method": "Text renderings: pdftotext -layout (lines stripped, spaces collapsed) or the HTML's visible text. "
                 "Rule-level sections are cut at rule headings; documents without detectable headings are kept page by page; sections over 40,000 characters are split at page breaks into numbered parts. Text before the first rule heading is kept as a Front matter section when it is longer than 400 characters; pages with fewer than 40 characters are not kept in page-by-page documents."},
                inputs)
    write_build("court_rule_insights", "Court rules: deadlines, length limits, formatting, filing, pro hac vice and ADR requirements, each with its quote", ins_rows,
                listing([("requirement", "Requirement"), ("category", "Category"), ("rule", "Rule"), ("document", "Document")],
                        [("category", "Category", CATEGORY_LABEL)]),
                {**common, "insights": len(ins_rows), "extraction": {**{k: v for k, v in ins["summary"].items() if k != "model"}, "method": METHOD},
                 "method": "A language model proposed requirements from keyword-selected sections; a proposal is kept only if its quote occurs in the "
                           "stored section text (exactly, or after collapsing line breaks and spaces), its value occurs inside the quote, its number is "
                           "written in the value and its quote does not run across a running page header or footer. A value that stops mid-phrase is "
                           "continued through its quote to the end of the clause, or dropped. Each practice point names the rule whose text holds its "
                           "quote and the page the quote starts on. Validation rate = kept / proposed.",
                 "second_path": second_path_note(len(ins_rows)), "categories": CATEGORY_LABEL},
                inputs)


def build_constitutions():
    data = fetchlib.load_json(os.path.join(WORK, "constitutions.json"))
    secs = load_jsonl("constitution_sections.jsonl")
    # second-extraction result per provision, written by verify_court_rules.py (absent on a first build)
    check_path = os.path.join(WORK, "constitution_text_check.json")
    checks = fetchlib.load_json(check_path)["provisions"] if os.path.exists(check_path) else {}
    count = Counter(s["state"] for s in secs)
    rows, srows = [], []
    for c in data["states"]:
        st = c["state"]
        status = c.get("status")
        status_label = {"text": "Retrieved", "not_located": "No current official text located", "not_retrieved": "Not retrieved (see note)",
                        "no_text": "Retrieved file has no usable text"}.get(status, status)
        note = c.get("note")
        if status == "not_retrieved" and not note:
            note = "The publisher's server refused automated requests (HTTP 403, a TLS certificate the request could not verify, or robots.txt)."
        info = {k: c.get(k) for k in ("state", "name", "publisher", "url", "kind", "edition_note", "structure", "articles", "sections", "units",
                                       "chars", "retrieved_at", "text_sha256", "cleanup")}
        info.update(status=status, status_label=status_label, note=note, files=len(c.get("files") or []))
        title = f"Constitution of {c['name']}" if st != "DC" else "District of Columbia Home Rule Act (charter)"
        rows.append(record("state_constitutions", st, title, source_url=c.get("url") or "https://www.usa.gov/states-and-territories",
                           cells={"state": c["name"], "status": status_label, "structure": c.get("structure") or NR,
                                  "units": count.get(st, 0), "publisher": c.get("publisher") or NR},
                           facts=[["Publisher", c.get("publisher") or NR], ["Official source", c.get("url") or NR], ["Status", status_label],
                                  ["Edition", c.get("edition_note") or NR], ["Structure parsed", c.get("structure") or NR],
                                  ["Articles", str(c.get("articles") or 0)], ["Sections", str(c.get("sections") or 0)],
                                  ["Retrieved", c.get("retrieved_at") or NR]] + ([["Note", note]] if note else []),
                           text=" ".join([title, c.get("publisher") or ""]), filters={"status": [status or "unknown"]}, subtitle=c.get("publisher") or "",
                           links=[{"url": f"/places/{st}", "label": c["name"]}] if st != "DC" else [], state=st,
                           extra={"constitution": info}))
    for s in secs:
        st = s["state"]
        parts = []
        if s.get("article"):
            parts.append(f"Article {s['article']}")
        if s.get("section"):
            parts.append(f"Section {s['section']}")
        head = ", ".join(parts) or "Text"
        title = f"{STATE_NAMES[st]} Const. {head}" + (f". {s['section_title']}" if s.get("section_title") else (f". {s['article_title']}" if s.get("article_title") and not s.get("section") else ""))
        info = {k: s.get(k) for k in ("state", "ordinal", "article", "article_title", "section", "section_title", "source_url")}
        info["chars"] = len(s["text"])
        chk = checks.get(s["id"])
        if chk and chk.get("windows"):
            share = chk["found"] / chk["windows"]
            info["text_check"] = "confirmed" if share == 1 else ("mostly_confirmed" if share >= 0.9 else "partly_confirmed")
            info["text_check_share"] = round(share, 3)
        else:
            info["text_check"] = "not_checked"
        srows.append(own_text(record("state_constitution_sections", s["id"], title[:300], source_url=s["source_url"],
                                     cells={"provision": title[:300], "state": STATE_NAMES[st]},
                                     facts=[["State", STATE_NAMES[st]], ["Article", s.get("article") or NR], ["Section", s.get("section") or NR],
                                            ["Official source", s["source_url"]]],
                                     text=s["text"], filters={"state": [st], **({"article": [str(s["article"])]} if s.get("article") else {})},
                                     subtitle=STATE_NAMES[st], state=st,
                                     links=[{"url": f"/records/state_constitutions/{st}", "label": f"Constitution of {STATE_NAMES[st]}"}],
                                     extra={"constitution_section": info}), s["text"]))
    inputs = inputs_of(["constitutions.json", "constitution_sections.jsonl"])
    statuses = Counter(c.get("status") for c in data["states"])
    common = {"sources": "each state's legislature, secretary of state or lieutenant governor (see each record)",
              "reuse": "Official-source list follows Vaquill-AI/open-us-law scripts/constitutions (Apache-2.0) where it names an official publisher; no data from that project is used."}
    write_build("state_constitutions", "State constitutions: official publisher, edition and retrieval status by state", rows,
                listing([("state", "State"), ("status", "Status"), ("structure", "Structure"), ("units", "Provisions"), ("publisher", "Publisher")]),
                {**common, "states": len(rows), "status_counts": dict(statuses)}, inputs)
    write_build("state_constitution_sections", "State constitutions: article and section text (official publishers, October 2026)", srows,
                listing([("provision", "Provision"), ("state", "State")]),
                {**common, "sections": len(srows), "method": "Articles and sections are cut where the publisher's text starts a line with 'ARTICLE n' or 'Section n' "
                 "(or a catchword followed by 'SECTION n', or the publisher serves one page per section); where no sections were found the unit is the article, "
                 "or the whole document. Numbers are as printed. Running page headers and footers never open a unit. Table-of-contents entries (headings "
                 "without provision text whose number recurs with text) are not kept; an article's heading line becomes its title; a margin heading printed "
                 "just before its section stays with it. Where unresolved contents entries exceed 5% of sections, the state is kept article by article. "
                 "Each provision's text_check records whether a second extraction of the publisher's file (pypdf for PDFs, BeautifulSoup for HTML) "
                 "contains all of its 60-character windows (confirmed), at least 90% (mostly_confirmed) or less (partly_confirmed)."},
                inputs)


def build_regulations():
    codes = fetchlib.load_json(os.path.join(WORK, "regulation_codes.json"))["codes"]
    idx = load_jsonl("regulation_index.jsonl")
    rows, irows = [], []
    for c in codes:
        st = c["state"]
        status_label = {"indexed": "Table of contents indexed", "blocked": "Not retrieved: the publisher refused automated requests",
                        "not_indexed": "Not indexed"}.get(c["status"], c["status"])
        rows.append(record("state_regulation_codes", st, c["code"], source_url=c["url"],
                           cells={"state": STATE_NAMES[st], "code": c["code"], "status": status_label, "entries": c["entries"]},
                           facts=[["Publisher", c["publisher"]], ["Official table of contents", c["url"]], ["Status", status_label],
                                  ["Index entries", str(c["entries"])], ["Levels", ", ".join(f"{k}: {v}" for k, v in c["levels"].items()) or NR],
                                  ["Retrieved", (c.get("acquisition") or {}).get("at") or NR]] + ([["Error", c["errors"][0]]] if c.get("errors") else []),
                           text=" ".join([c["code"], c["publisher"]]), filters={"status": [c["status"]]}, subtitle=STATE_NAMES[st], state=st,
                           links=[{"url": f"/places/{st}", "label": STATE_NAMES[st]}], extra={"regulation_code": {**c, "status_label": status_label}}))
    n = Counter()
    for e in idx:
        st = e["state"]
        n[st] += 1
        rid = f"{st.lower()}-reg:{n[st]:05d}"
        title = e["citation"] + (f" {e['heading']}" if e.get("heading") else "")
        irows.append(record("state_regulation_index", rid, title[:300], source_url=e["url"],
                            cells={"citation": e["citation"], "heading": e.get("heading") or NR, "agency": e.get("agency") or NR, "level": e["level"]},
                            facts=[["State", STATE_NAMES[st]], ["Level", e["level"]], ["Agency", e.get("agency") or NR], ["Within", e.get("parent") or NR],
                                   ["Status on the publisher's page", e.get("status") or NR], ["Official address", e["url"]], ["Listed on", e["listed_on"]]],
                            text=" ".join(x for x in [e["citation"], e.get("heading"), e.get("agency"), e.get("parent")] if x),
                            filters={"state": [st], "level": [e["level"]]}, subtitle=STATE_NAMES[st], state=st,
                            extra={"regulation_entry": {**e, "ordinal": n[st]}}))
    inputs = inputs_of(["regulation_codes.json", "regulation_index.jsonl"])
    common = {"scope": "Index only: headings of each administrative code's official table of contents; rule bodies were not downloaded.",
              "reuse": "Publishers and page shapes follow Vaquill-AI/open-us-law scripts/regulations (Apache-2.0; logic only)."}
    write_build("state_regulation_codes", "State administrative codes: official publisher and index status (14 states)", rows,
                listing([("state", "State"), ("code", "Code"), ("status", "Status"), ("entries", "Index entries")]), {**common, "states": len(rows)}, inputs)
    write_build("state_regulation_index", "State administrative codes: titles, agencies and chapters as listed by the official publisher", irows,
                listing([("citation", "Citation"), ("heading", "Heading"), ("agency", "Agency"), ("level", "Level")]),
                {**common, "entries": len(irows), "per_state": dict(n)}, inputs)


def main():
    build_rules()
    build_constitutions()
    build_regulations()


if __name__ == "__main__":
    main()
