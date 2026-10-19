"""Turn the acquired rule documents into documents.json + sections.jsonl (work files for the builder and insights).

  python3 -I -B scripts/enrichment/court_rules/extract_rules.py

Reads only private/acq/court_rules/ (raw bytes + _manifest.jsonl) and the reviewed source lists in this folder. Writes:
  private/build/court_rules/text/<doc_id>.txt     plain-text rendering of each document (textlib.py), quotes are checked
                                                   against the section text taken from it
  private/build/court_rules/work/documents.json   one entry per rule document (retrieved or not, with the reason)
  private/build/court_rules/work/sections.jsonl   one entry per rule-level section (or page, where no rule headings exist)
NV and MN parsing follows the markup notes in Vaquill-AI/open-us-law scripts/court_rules/ingest_{nv,mn}_court_rules.py
(Apache-2.0); no data from that project is used.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
import sections as S  # noqa: E402
import textlib  # noqa: E402

ROOT = fetchlib.ROOT
ACQ = fetchlib.ACQ
BUILD = os.path.join(ROOT, "private", "build", "court_rules")
TEXT_DIR = os.path.join(BUILD, "text")
WORK = os.path.join(BUILD, "work")

FEDERAL = [
    # id, name, citation prefix, page, levels, alt text source key
    ("us-frcp", "Federal Rules of Civil Procedure", "Fed. R. Civ. P.", "frcp", ["district"]),
    ("us-frcrp", "Federal Rules of Criminal Procedure", "Fed. R. Crim. P.", "frcrp", ["district"]),
    ("us-fre", "Federal Rules of Evidence", "Fed. R. Evid.", "fre", ["district", "appellate", "bankruptcy"]),
    ("us-frap", "Federal Rules of Appellate Procedure", "Fed. R. App. P.", "frap", ["appellate"]),
    ("us-frbp", "Federal Rules of Bankruptcy Procedure", "Fed. R. Bankr. P.", "frbp", ["bankruptcy"]),
]
PAGE_URL = "https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/"
FEDERAL_PAGES = {"frcp": "federal-rules-civil-procedure", "frcrp": "federal-rules-criminal-procedure", "fre": "federal-rules-evidence",
                 "frap": "federal-rules-appellate-procedure", "frbp": "federal-rules-bankruptcy-procedure"}

MN_SETS = {
    "cp": ("Minnesota Rules of Civil Procedure", ["trial"]),
    "cr": ("Minnesota Rules of Criminal Procedure", ["trial"]),
    "ev": ("Minnesota Rules of Evidence", ["trial"]),
    "ap": ("Minnesota Rules of Civil Appellate Procedure", ["appellate", "supreme"]),
    "gp": ("Minnesota General Rules of Practice for the District Courts", ["trial"]),
    "ju": ("Minnesota Juvenile Court Rules", ["trial"]),
    "pr": ("Minnesota Professional Rules", ["trial", "appellate", "supreme"]),
    "ra": ("Minnesota Rules of Public Access to Records of the Judicial Branch", ["trial", "appellate", "supreme"]),
    "sg": ("Minnesota Sentencing Guidelines", ["trial"]),
    "ms": ("Minnesota Miscellaneous Rules", ["trial", "appellate", "supreme"]),
    "dc": ("Minnesota District Court Special Rules", ["trial"]),
}
NV_APPELLATE = {"NRAP", "NRAD"}
NV_ALL = {"SCR", "SCR_CJC", "SCR_RGSRCR", "SCR_RJE", "SCR_AudTranEquip", "SCR_Fees", "SCR_REE", "SCR_Addenda", "RPC", "Conduct_CWC", "MRRS", "PCD"}
FL_LEVELS = {"2": ["trial", "appellate", "supreme"], "9": ["appellate", "supreme"]}
TX_SETS = {
    "trcp": ("Texas Rules of Civil Procedure", ["trial"]),
    "trap": ("Texas Rules of Appellate Procedure", ["appellate", "supreme"]),
    "tre": ("Texas Rules of Evidence", ["trial"]),
    "efile_crim": ("Statewide Rules Governing Electronic Filing in Criminal Cases", ["trial", "appellate", "supreme"]),
    "trja": ("Texas Rules of Judicial Administration", ["trial", "appellate", "supreme"]),
    "tdrpc": ("Texas Disciplinary Rules of Professional Conduct", ["trial", "appellate", "supreme"]),
    "appellate_conduct": ("Texas Standards for Appellate Conduct", ["appellate", "supreme"]),
}
PART_LABEL = {"civil": "Civil", "criminal": "Criminal", "combined": "Civil and criminal", "patent": "Patent", "adr": "ADR",
              "appellate": "Circuit rules", "iop": "Internal operating procedures"}


def latest_manifest() -> dict[str, dict]:
    """Latest successful manifest entry per stored path (later rows supersede earlier ones for the same path)."""
    out: dict[str, dict] = {}
    for row in fetchlib.read_manifest():
        if row.get("http_status") == 200:
            out[row["path"]] = row
    return out


def by_url(manifest: dict[str, dict]) -> dict[str, dict]:
    out = {}
    for row in manifest.values():
        out[row["url"]] = row
    return out


def save_text(doc_id: str, text: str) -> tuple[str, str]:
    os.makedirs(TEXT_DIR, exist_ok=True)
    path = os.path.join(TEXT_DIR, f"{doc_id}.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return os.path.relpath(path, ROOT), hashlib.sha256(text.encode("utf-8")).hexdigest()


def section_rows(doc_id: str, secs: list[S.Section], url_for) -> list[dict]:
    rows = []
    for n, s in enumerate(secs, start=1):
        rows.append({
            "id": f"{doc_id}:{n:04d}", "doc": doc_id, "ordinal": n, "label": s.label, "number": s.number,
            "title": s.title, "page": s.page, "text": s.text, "source_url": url_for(s), "split": s.family,
            **({"occurrence": s.extra["occurrence"]} if s.extra.get("occurrence") else {}),
            **{k: s.extra[k] for k in ("part", "parts") if k in s.extra},
        })
    return rows


def pdf_doc(doc: dict, raw: dict | None, text_raw: dict | None = None) -> tuple[dict, list[dict]]:
    """Render, split and describe one PDF document; text_raw is an alternative file that carries the text layer."""
    src = text_raw or raw
    if not raw:
        doc.setdefault("status", "not_retrieved")
        return doc, []
    doc.update(sha256=raw["sha256"], bytes=raw["bytes"], retrieved_at=raw["retrieved_at"], raw_path=raw["path"])
    if text_raw:
        doc.update(text_source_url=text_raw["url"], text_source_sha256=text_raw["sha256"], text_source_path=text_raw["path"])
    text = textlib.pdf_text(os.path.join(ROOT, src["path"]))
    words = len(re.findall(r"[A-Za-z]{3,}", text))
    pages = text.count(textlib.PAGE_BREAK) + 1
    doc["pages"] = pages
    if words < pages * 15:
        doc.update(status="no_text_layer", sections=0, note="The PDF has no usable text layer (scanned images); text was not extracted.")
        return doc, []
    secs, method = S.split_sections(text)
    doc["text_path"], doc["text_sha256"] = save_text(doc["id"], text)
    doc.update(status="text", chars=len(text), sections=len(secs), split=method, coverage=S.coverage(secs, text))
    base = doc["url"]
    return doc, section_rows(doc["id"], secs, lambda s: f"{base}#page={s.page}")


# ------------------------------------------------------------------ federal
def federal_docs(m: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    docs, rows = [], []
    for doc_id, name, cite, key, levels in FEDERAL:
        raw = m.get(f"private/acq/court_rules/federal/{key}.pdf")
        alt = m.get(f"private/acq/court_rules/federal/{key}_govinfo.pdf")
        doc = {"id": doc_id, "scope": "federal_national", "title": name, "citation": cite, "levels": levels, "courts": [],
               "state": "", "part": "national", "publisher": "Administrative Office of the U.S. Courts (uscourts.gov)",
               "url": raw["url"] if raw else None, "found_on": PAGE_URL + FEDERAL_PAGES[key], "format": "pdf"}
        if alt:
            doc["note"] = ("The uscourts.gov PDF has no usable text layer; section text comes from the same House Judiciary "
                           "Committee print published on govinfo.gov.")
        doc, secs = pdf_doc(doc, raw, alt)
        if alt:  # sections point at the file their text came from
            for s in secs:
                s["source_url"] = f"{alt['url']}#page={s['page']}"
        docs.append(doc)
        rows.extend(secs)
    return docs, rows


# ------------------------------------------------------------------ local rules
def acquire_results() -> dict[tuple[str, int], dict]:
    path = os.path.join(ACQ, "local", "acquire_log.jsonl")
    out = {}
    for line in open(path, encoding="utf-8"):
        row = json.loads(line)
        if "court" in row and "idx" in row and "page" not in row and row.get("result") != "pages_done":
            out[(row["court"], row["idx"])] = row
    return out


def html_rule_doc(doc: dict, raw: dict) -> tuple[dict, list[dict]]:
    """A court's rules published as one HTML page (cand criminal local rules)."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(fetchlib.load_raw(raw["path"]).decode("utf-8", "replace"), "lxml")
    main = soup.find("main") or soup.find("article") or soup.body or soup
    for tag in main.find_all(["nav", "header", "footer", "script", "style"]):
        tag.decompose()
    text = textlib.html_fragment_text(main)
    secs, method = S.split_sections(text)
    doc.update(sha256=raw["sha256"], bytes=raw["bytes"], retrieved_at=raw["retrieved_at"], raw_path=raw["path"])
    doc["text_path"], doc["text_sha256"] = save_text(doc["id"], text)
    doc.update(status="text", chars=len(text), sections=len(secs), split=method, coverage=S.coverage(secs, text), pages=None)
    return doc, section_rows(doc["id"], secs, lambda s: doc["url"])


def html_pages_doc(doc: dict, raw: dict, court: str, idx: int, part: str, m: dict) -> tuple[dict, list[dict]]:
    """An index page linking one HTML page per rule (D. Or.): each rule page is one section."""
    from bs4 import BeautifulSoup

    folder = f"private/acq/court_rules/local/{court}/doc{idx}_{part}_pages/"
    pages = sorted((p, r) for p, r in m.items() if p.startswith(folder))
    rows, texts = [], []
    for n, (path, row) in enumerate(pages, start=1):
        soup = BeautifulSoup(fetchlib.load_raw(path).decode("utf-8", "replace"), "lxml")
        body = soup.find(attrs={"itemprop": "articleBody"}) or soup.find(class_="item-page") or soup.find("main") or soup.body
        h = soup.find(class_="contentheading") or soup.find("h1") or soup.find("h2")
        heading = " ".join(h.get_text(" ", strip=True).split()) if h else f"Rule page {n}"
        text = textlib.html_fragment_text(body).strip()
        mm = re.match(r"^(L\.?\s?R\.?|LR)\s*([0-9][0-9A-Za-z.\-]*)\s*[-–—:.]?\s*(.*)$", heading)
        label = f"LR {mm.group(2)}" if mm else heading[:40]
        title = (mm.group(3) if mm else heading).strip() or heading
        texts.append(f"{heading}\n{text}")
        rows.append({"id": f"{doc['id']}:{n:04d}", "doc": doc["id"], "ordinal": n, "label": label,
                     "number": mm.group(2) if mm else str(n), "title": title, "page": None, "text": text,
                     "source_url": row["url"], "split": "html_page", "sha256": row["sha256"], "retrieved_at": row["retrieved_at"]})
    full = "\n\f\n".join(texts)
    doc.update(sha256=raw["sha256"], bytes=raw["bytes"], retrieved_at=raw["retrieved_at"], raw_path=raw["path"])
    doc["text_path"], doc["text_sha256"] = save_text(doc["id"], full)
    doc.update(status="text" if rows else "not_retrieved", chars=len(full), sections=len(rows), split="html_pages", coverage=1.0 if rows else 0.0,
               pages=None, rule_pages=len(rows))
    return doc, rows


def local_docs(m: dict[str, dict]) -> tuple[list[dict], list[dict], dict]:
    sources = json.load(open(os.path.join(HERE, "local_rules_sources.json")))
    results = acquire_results()
    docs, rows = [], []
    parts_seen: dict[str, int] = defaultdict(int)
    for court, entries in sorted(sources["courts"].items()):
        for idx, entry in enumerate(entries):
            part = entry["part"]
            parts_seen[f"{court}-{part}"] += 1
            doc_id = f"{court}-{part}" + (f"-{parts_seen[f'{court}-{part}']}" if parts_seen[f"{court}-{part}"] > 1 else "")
            fmt = entry.get("format", "pdf")
            doc = {"id": doc_id, "scope": "federal_local", "title": entry["title"], "part": part, "courts": [court],
                   "levels": ["appellate"] if court.startswith("ca") else ["district"], "state": "", "url": entry["url"],
                   "found_on": entry["found_on"], "format": fmt, "publisher": "The court's own website"}
            for key in ("note", "retrieval_note"):
                if entry.get(key):
                    doc[key] = entry[key]
            result = results.get((court, idx), {})
            ext = "pdf" if fmt == "pdf" else "html.gz"
            raw = m.get(f"private/acq/court_rules/local/{court}/doc{idx}_{part}.{ext}")
            if raw and raw["url"] != entry["url"]:
                raw = None  # a stored file from an earlier choice for this slot
            if str(result.get("result", "")).startswith("robots"):
                doc.update(status="robots_disallowed", note=(doc.get("note", "") + " The court's robots.txt disallows automated "
                                                             "retrieval of this file; it was not downloaded.").strip())
                docs.append(doc)
                continue
            if fmt == "pdf":
                doc, secs = pdf_doc(doc, raw)
            elif fmt == "html" and raw:
                doc, secs = html_rule_doc(doc, raw)
            elif fmt == "html_pages" and raw:
                doc, secs = html_pages_doc(doc, raw, court, idx, part, m)
            else:
                doc["status"], secs = "not_retrieved", []
            docs.append(doc)
            rows.extend(secs)
    return docs, rows, sources.get("skipped", {})


# ------------------------------------------------------------------ Minnesota
def mn_docs(m: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    from bs4 import BeautifulSoup

    by_set: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for path, row in m.items():
        mm = re.match(r"private/acq/court_rules/state/mn/rules/([a-z]+)/([a-z_]+)/([\w.]+)\.html\.gz$", path)
        if mm:
            by_set[mm.group(1)].append((path, row))
    docs, rows = [], []
    for code, (name, levels) in MN_SETS.items():
        entries = by_set.get(code, [])
        doc = {"id": f"mn-{code}", "scope": "state", "state": "MN", "title": name, "part": code, "levels": levels, "courts": [],
               "url": f"https://www.revisor.mn.gov/court_rules/{code}/", "found_on": "https://www.revisor.mn.gov/court_rules/",
               "format": "html_pages", "publisher": "Minnesota Office of the Revisor of Statutes"}
        parsed = []
        for path, row in entries:
            soup = BeautifulSoup(fetchlib.load_raw(path).decode("utf-8", "replace"), "lxml")
            cont = next((d for d in soup.find_all("div", class_="court_rule") if (d.get("id") or "").startswith("courtr.")), None)
            head = cont.find(class_="courtr_no") if cont else None
            if not cont or not head:
                continue
            heading = " ".join(head.get_text(" ", strip=True).split())
            sub = soup.find(class_="subtype_header")
            comments = cont.find_all("div", class_="comment")
            comment_chars = sum(len(c.get_text(" ", strip=True)) for c in comments)
            for c in comments:
                c.decompose()
            for a in cont.find_all("a", class_="permalink"):
                a.decompose()
            text = textlib.html_fragment_text(cont).strip()
            mm = re.match(r"^Rule\s+([\w.]+)\.?\s*(.*)$", heading)
            number = (mm.group(1) if mm else heading).rstrip(".")
            title = (mm.group(2) if mm else heading).strip() or heading
            if re.search(r"^\[?\s*(repealed|reserved|renumbered|abrogated)", title, re.I) and len(text) < 300:
                pass  # kept: the official page says so
            subtype = " ".join(sub.get_text(" ", strip=True).split()) if sub else ""
            parsed.append((subtype, _num_key(number), number, title, text, row, comment_chars))
        parsed.sort(key=lambda t: (t[0], t[1]))
        texts = []
        for n, (subtype, _k, number, title, text, row, comment_chars) in enumerate(parsed, start=1):
            label = f"Rule {number}"
            rows.append({"id": f"mn-{code}:{n:04d}", "doc": f"mn-{code}", "ordinal": n, "label": label, "number": number,
                         "title": title, "page": None, "text": text, "source_url": row["url"], "split": "html_page",
                         "group": subtype or None, "sha256": row["sha256"], "retrieved_at": row["retrieved_at"],
                         **({"comment_chars_not_included": comment_chars} if comment_chars else {})})
            texts.append(f"{label}. {title}\n{text}")
        full = "\n\f\n".join(texts)
        if parsed:
            doc["text_path"], doc["text_sha256"] = save_text(doc["id"], full)
            doc.update(status="text", chars=len(full), sections=len(parsed), split="html_pages", coverage=1.0, pages=None,
                       retrieved_at=max(p[5]["retrieved_at"] for p in parsed), rule_pages=len(parsed),
                       note="One official page per rule. Advisory committee comments printed with a rule are not part of the stored text.")
        else:
            doc["status"] = "not_retrieved"
        docs.append(doc)
    return docs, rows


def _num_key(number: str):
    parts = re.findall(r"\d+|[A-Za-z]+", number)
    return [(0, int(p)) if p.isdigit() else (1, p) for p in parts]


# ------------------------------------------------------------------ Nevada
def nv_docs(m: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    from bs4 import BeautifulSoup

    docs, rows = [], []
    for path, row in sorted(m.items()):
        mm = re.match(r"private/acq/court_rules/state/nv/sets/([A-Za-z0-9_]+)\.html?\.gz$", path)
        if not mm:
            continue
        slug = mm.group(1)
        html = fetchlib.load_raw(path).decode("cp1252", "replace")
        soup = BeautifulSoup(html, "lxml")
        title = " ".join((soup.title.get_text(" ", strip=True) if soup.title else slug).split())
        levels = ["appellate", "supreme"] if slug in NV_APPELLATE else (["trial", "appellate", "supreme"] if slug in NV_ALL else ["trial"])
        doc_id = f"nv-{slug.lower().replace('_', '-')}"
        doc = {"id": doc_id, "scope": "state", "state": "NV", "title": title, "part": slug, "levels": levels, "courts": [],
               "url": row["url"], "found_on": "https://www.leg.state.nv.us/CourtRules/", "format": "html",
               "publisher": "Nevada Legislature (Legislative Counsel Bureau)", "sha256": row["sha256"], "bytes": row["bytes"],
               "retrieved_at": row["retrieved_at"], "raw_path": row["path"]}
        body = soup.body or soup
        heads = []
        for a in body.find_all("a", attrs={"name": True}):
            am = re.match(r"^[A-Za-z_]+Rule([0-9A-Za-z_]+)$", a["name"])
            p = a.find_parent("p")
            if am and p is not None and p not in [h[1] for h in heads]:
                heads.append((am.group(1).replace("_", "."), p, a["name"]))
        blocks = body.find_all("p")
        index = {id(p): i for i, p in enumerate(blocks)}
        texts = []
        for n, (number, p, anchor) in enumerate(heads, start=1):
            start = index.get(id(p))
            end = index.get(id(heads[n][1])) if n < len(heads) else len(blocks)
            if start is None or end is None:
                continue
            heading = " ".join(p.get_text(" ", strip=True).replace("\xa0", " ").split())
            hm = re.match(r"^Rule\s+[\w.]+\.?\s*(.*)$", heading)
            rtitle = (hm.group(1) if hm else heading).strip(" .") or f"Rule {number}"
            parts = [" ".join(b.get_text(" ", strip=True).replace("\xa0", " ").split()) for b in blocks[start:end]]
            text = "\n".join(t for t in parts if t)
            rows.append({"id": f"{doc_id}:{len(rows) + 1 - sum(1 for r in rows if r['doc'] != doc_id):04d}", "doc": doc_id,
                         "ordinal": n, "label": f"Rule {number}", "number": number, "title": rtitle, "page": None, "text": text,
                         "source_url": f"{row['url']}#{anchor}", "split": "html_anchor"})
            texts.append(text)
        full = textlib.tidy_lines("\n\f\n".join(texts)) if texts else ""
        if texts:
            doc["text_path"], doc["text_sha256"] = save_text(doc_id, full)
            doc.update(status="text", chars=len(full), sections=len(texts), split="html_anchor", coverage=1.0, pages=None)
        else:
            plain = textlib.html_fragment_text(body)
            secs = S.page_sections(plain) if plain.strip() else []
            doc["text_path"], doc["text_sha256"] = save_text(doc_id, plain)
            doc.update(status="text" if plain.strip() else "no_text", chars=len(plain), sections=1 if plain.strip() else 0,
                       split="whole_page", coverage=1.0, pages=None)
            if plain.strip():
                rows.append({"id": f"{doc_id}:0001", "doc": doc_id, "ordinal": 1, "label": "Full text", "number": "1",
                             "title": title, "page": None, "text": plain.strip(), "source_url": row["url"], "split": "whole_page"})
        docs.append(doc)
    # renumber section ids per document in order
    counters: dict[str, int] = defaultdict(int)
    for r in rows:
        counters[r["doc"]] += 1
        r["id"] = f"{r['doc']}:{counters[r['doc']]:04d}"
        r["ordinal"] = counters[r["doc"]]
    return docs, rows


# ------------------------------------------------------------------ Florida and Texas (PDF)
def fl_docs(m: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    index = m.get("private/acq/court_rules/state/fl/ctproc_index.html.gz")
    names = {}
    if index:
        html = fetchlib.load_raw(index["path"]).decode("utf-8", "replace")
        for url, text in re.findall(r'<a\b[^>]*href="([^"]+\.pdf)"[^>]*>(.*?)</a>', html, re.S | re.I):
            names[url] = " ".join(re.sub(r"<[^>]+>", " ", text).split())
    docs, rows = [], []
    for path, row in sorted(m.items()):
        mm = re.match(r"private/acq/court_rules/state/fl/chapter_(\d+)_.*\.pdf$", path)
        if not mm:
            continue
        ch = mm.group(1)
        label = names.get(row["url"], f"Chapter {ch}")
        title = "Florida " + re.sub(r"^Chapter\s+\d+\s*[–-]\s*", "", label)
        doc = {"id": f"fl-ch{ch}", "scope": "state", "state": "FL", "title": title, "part": f"chapter {ch}",
               "levels": FL_LEVELS.get(ch, ["trial"]), "courts": [], "url": row["url"], "found_on": "https://www.floridabar.org/rules/ctproc/",
               "format": "pdf", "publisher": "The Florida Bar (Rules Regulating The Florida Bar and Florida Rules of Court)",
               "chapter_label": label}
        doc, secs = pdf_doc(doc, row)
        docs.append(doc)
        rows.extend(secs)
    return docs, rows


def tx_docs(m: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    docs, rows = [], []
    for path, row in sorted(m.items()):
        mm = re.match(r"private/acq/court_rules/state/tx/([a-z_]+?)_[A-Za-z0-9].*\.pdf$", path)
        if not mm:
            continue
        key = next((k for k in sorted(TX_SETS, key=len, reverse=True) if os.path.basename(path).startswith(k + "_")), None)
        if not key:
            continue
        name, levels = TX_SETS[key]
        doc = {"id": f"tx-{key.replace('_', '-')}", "scope": "state", "state": "TX", "title": name, "part": key, "levels": levels,
               "courts": [], "url": row["url"], "found_on": "https://www.txcourts.gov/rules-forms/rules-standards/", "format": "pdf",
               "publisher": "Texas Judicial Branch (txcourts.gov)"}
        doc, secs = pdf_doc(doc, row)
        docs.append(doc)
        rows.extend(secs)
    return docs, rows


def nj_docs() -> list[dict]:
    log = os.path.join(ACQ, "state", "acquire_log.jsonl")
    blocked = [json.loads(l) for l in open(log, encoding="utf-8") if '"state": "nj"' in l]
    when = blocked[-1]["at"] if blocked else None
    return [{"id": "nj-rules-of-court", "scope": "state", "state": "NJ", "title": "New Jersey Rules of Court", "part": "rules",
             "levels": ["trial", "appellate", "supreme"], "courts": [], "url": "https://www.njcourts.gov/attorneys/rules-of-court",
             "found_on": "https://www.njcourts.gov/attorneys/rules-of-court", "format": "html", "publisher": "New Jersey Judiciary",
             "status": "blocked_automated_access", "checked_at": when,
             "note": "njcourts.gov answers automated requests with an HTTP 403 bot-protection page (checked for the rules page and a "
                     "rule PDF); the rules were not retrieved. The official page opens in the source panel for reading."}]


def main():
    m = latest_manifest()
    all_docs, all_rows = [], []
    for fn in (federal_docs, mn_docs, nv_docs, fl_docs, tx_docs):
        d, r = fn(m)
        all_docs += d
        all_rows += r
        print(fn.__name__, len(d), "docs", len(r), "sections", flush=True)
    d, r, skipped = local_docs(m)
    all_docs += d
    all_rows += r
    print("local_docs", len(d), "docs", len(r), "sections")
    all_docs += nj_docs()
    ids = [x["id"] for x in all_docs]
    assert len(ids) == len(set(ids)), "duplicate document ids"
    sids = [x["id"] for x in all_rows]
    assert len(sids) == len(set(sids)), "duplicate section ids"
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, "documents.json"), "w", encoding="utf-8") as handle:
        json.dump({"generated_at": fetchlib.utc_now(), "skipped_courts": skipped, "documents": all_docs}, handle, indent=1)
    with open(os.path.join(WORK, "sections.jsonl"), "w", encoding="utf-8") as handle:
        for row in all_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    status = defaultdict(int)
    for x in all_docs:
        status[x.get("status", "?")] += 1
    print(json.dumps({"documents": len(all_docs), "sections": len(all_rows), "status": status}))


if __name__ == "__main__":
    main()
