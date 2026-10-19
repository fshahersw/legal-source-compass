"""Turn the acquired state constitutions into constitutions.json + constitution_sections.jsonl (work files).

  python3 -I -B scripts/enrichment/court_rules/extract_constitutions.py [ST ...]

Reads private/acq/court_rules/constitutions/ (raw bytes + manifest) and constitution_sources.json. A text rendering per
state is saved to private/build/court_rules/text/const-<st>.txt; sections are cut from it (constitution_parse.py) or,
where the publisher serves one page per section, taken page by page with article and section numbers read from the
page address.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import constitution_parse as CP  # noqa: E402
import fetchlib  # noqa: E402
import textlib  # noqa: E402
from extract_rules import latest_manifest  # noqa: E402

ROOT = fetchlib.ROOT
BUILD = os.path.join(ROOT, "private", "build", "court_rules")
WORK = os.path.join(BUILD, "work")
TEXT_DIR = os.path.join(BUILD, "text")
SOURCES = os.path.join(HERE, "constitution_sources.json")
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}
PER_SECTION = {"AZ", "ID", "MT", "UT", "KY", "SD"}  # one publisher page (or file) per section


def html_text(raw: bytes, encoding: str = "utf-8") -> str:
    from bs4 import BeautifulSoup

    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        html = raw.decode("utf-16", "replace")
    elif raw[1:2] == b"\x00" and raw[3:4] == b"\x00":  # UTF-16LE without a byte-order mark (sdlegislature.gov)
        html = raw.decode("utf-16-le", "replace")
    else:
        html = raw.decode(encoding, "replace")
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    candidates = [c for c in (soup.find("main"), soup.find(id="content"), soup.find("article")) if c is not None]
    body = soup.body or soup
    # the main block when it carries most of the page's words; otherwise the whole body (some pages wrap only a header in <main>)
    total = len(body.get_text(" ", strip=True))
    main = next((c for c in candidates if len(c.get_text(" ", strip=True)) >= 0.5 * total), body)
    return textlib.html_fragment_text(main)


def section_page_text(raw: bytes, st: str) -> str:
    """The section's own text on a one-section page: the smallest block that still holds the 'Section N' heading."""
    from bs4 import BeautifulSoup

    if raw[:5] == b"%PDF-":
        return ""
    soup = BeautifulSoup(raw.decode("utf-8", "replace"), "lxml")
    for tag in soup.find_all(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    picks = {"MT": soup.find(class_="section-doc"), "UT": soup.find(id="secdiv"), "ID": soup.find(class_="pgbrk"), "AZ": soup.body}
    el = picks.get(st)
    if el is None:
        best = None
        for cand in soup.find_all(["div", "td", "article", "section", "main", "body"]):
            t = " ".join(cand.get_text(" ", strip=True).split())
            if re.search(r"\b(SECTION|Section|Sec\.|§)\s*\d", t) and len(t) >= 40:
                if best is None or len(t) < best[0]:
                    best = (len(t), cand)
        el = best[1] if best else (soup.body or soup)
    return textlib.html_fragment_text(el).strip()


def url_numbers(st: str, url: str) -> tuple[str | None, str | None]:
    if st == "AZ":
        m = re.search(r"/const/(\d+)/(\d+[A-Za-z]?)\.htm", url)
        return (m.group(1), m.group(2)) if m else (None, None)
    if st == "ID":
        m = re.search(r"/Art([IVXL]+)/Sect(\d+[A-Za-z]?)", url)
        return (m.group(1), m.group(2)) if m else (None, None)
    if st == "MT":
        m = re.search(r"/0000-(\d{3})(\w)-\d{4}-(\d{3})(\d)\.html", url)
        if m:
            art = str(int(m.group(1))) if m.group(1).isdigit() and m.group(2) == "0" else m.group(1) + m.group(2)
            sec = str(int(m.group(3))) + ("" if m.group(4) == "0" else f".{m.group(4)}")
            return art, sec
        return None, None
    if st == "UT":
        m = re.search(r"UC_A([IVX]+)_S(\d+[A-Za-z]?)_", url)
        return (m.group(1), m.group(2)) if m else (None, None)
    if st == "SD":
        m = re.search(r"/Statutes/0N-(\d+[A-Z]?)-(\d+[A-Za-z]?(?:\.\d+)?)\.html", url)
        return (m.group(1), m.group(2)) if m else (None, None)
    return None, None


def save_text(name: str, text: str) -> tuple[str, str]:
    os.makedirs(TEXT_DIR, exist_ok=True)
    path = os.path.join(TEXT_DIR, f"{name}.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return os.path.relpath(path, ROOT), hashlib.sha256(text.encode()).hexdigest()


def units_from_text(text: str) -> tuple[list[dict], str]:
    units = CP.split_constitution(text)
    level = CP.structure_level(units)
    if level == "article":
        units = CP.merge_to_articles(units)
    elif level == "document":
        units = [{"article": None, "article_title": None, "section": None, "section_title": None, "start": 0, "text": text.strip()}]
    return units, level


def al_units(files: list[tuple[str, dict]]) -> tuple[list[dict], str, list[dict]]:
    titles_file = next((r for p, r in files if p.endswith("titles.json.gz")), None)
    labels = {}
    if titles_file:
        raw = json.loads(fetchlib.load_raw(titles_file["path"]))["data"]["titles"]
        for row in raw.split("∫"):
            f = row.split("†")
            if len(f) >= 2:
                labels[f[0].strip()] = f[1].strip()
    order = list(labels)
    items = {}
    used = []
    for p, r in files:
        if "/items_" in p:
            used.append(r)
            for it in ((json.loads(fetchlib.load_raw(r["path"])).get("data") or {}).get("constitutionItems") or {}).get("data") or []:
                items[it["codeId"]] = it
    units = []
    article = article_title = None
    from bs4 import BeautifulSoup

    for code_id in order:
        label = labels[code_id]
        am = re.match(r"^Article\s+([IVXLC]+)\s+(.*)$", label)
        if am:
            article, article_title = am.group(1), am.group(2).strip()
            continue
        sm = re.match(r"^Section\s+(\S+)\s+(.*)$", label)
        if not sm or code_id not in items:
            continue
        it = items[code_id]
        body = textlib.html_fragment_text(BeautifulSoup(it.get("content") or "", "lxml")).strip()
        history = (it.get("history") or "").strip()
        text = body + (f"\n{history}" if history else "")
        if body:
            units.append({"article": article, "article_title": article_title, "section": sm.group(1), "section_title": sm.group(2).strip(),
                          "text": text, "url": f"https://alison.legislature.state.al.us/constitution?section={sm.group(1)}"})
    return units, "section" if units else "document", used


def extract_state(st: str, src: dict, m: dict[str, dict]) -> tuple[dict, list[dict]]:
    info = {"state": st, "name": STATE_NAMES[st], "publisher": src.get("publisher"), "url": src.get("found_on") or src.get("url"),
            "kind": src["kind"], "edition_note": src.get("edition_note"), "note": src.get("note")}
    prefix = f"private/acq/court_rules/constitutions/{st}/"
    files = sorted((p, r) for p, r in m.items() if p.startswith(prefix) and os.path.exists(os.path.join(ROOT, p)))
    if src["kind"] == "missing":
        info["status"] = "not_located"
        return info, []
    if not files:
        log_note = None
        info["status"] = "not_retrieved"
        return info, []
    units: list[dict] = []
    level = "document"
    used: list[dict] = []
    if src["kind"] == "al_graphql":
        units, level, used = al_units(files)
    elif st in PER_SECTION:
        parts = [(p, r) for p, r in files if "/part_" in p]
        texts = []
        for p, r in parts:
            raw = fetchlib.load_raw(p)
            if raw[:5] == b"%PDF-":
                t = textlib.pdf_text(os.path.join(ROOT, p), layout=False)
            else:
                t = html_text(raw).strip() if st == "SD" else section_page_text(raw, st)
            if not t:
                continue
            used.append(r)
            art, sec = url_numbers(st, r["url"])
            if st == "KY":
                head = re.search(r"^\s*(?:Section|SECTION)\s+(\d+[A-Za-z]?)\b\.?\s*(.*)$", t, re.M)
                sec = head.group(1) if head else None
                title = CP._title(head.group(2)) if head else None
                if not sec:
                    pm = re.search(r"^\s*(Preamble|PREAMBLE|Bill of Rights|Schedule)", t, re.M)
                    title = pm.group(1) if pm else t.split("\n", 1)[0][:120]
            else:
                head = re.search(r"(?:Section|SECTION|Sec\.|§)\s*\d+[A-Za-z]?\s*\.?\s*(?:\[([^\]]+)\]|([^.\n]{2,120})\.)", t)
                title = (head.group(1) or head.group(2)).strip() if head else None
            units.append({"article": art, "article_title": None, "section": sec, "section_title": title, "text": t, "url": r["url"]})
            texts.append(t)
        level = "section" if sum(1 for u in units if u["section"]) >= 5 else "document"
    else:
        texts = []
        for p, r in files:
            if "/index_" in p or p.endswith("list.json.gz"):
                continue
            raw = fetchlib.load_raw(p)
            if raw[:5] == b"%PDF-":
                t = textlib.pdf_text(os.path.join(ROOT, p), layout=False)
            else:
                t = html_text(raw, src.get("encoding", "utf-8"))
            if len(re.findall(r"[A-Za-z]{3,}", t)) < 20:
                continue
            used.append(r)
            texts.append((t, r))
        if not texts:
            info["status"] = "no_text"
            return info, []
        if len(texts) == 1:
            text, r = texts[0]
            units, level = units_from_text(text)
            for u in units:
                u["url"] = r["url"] + (f"#page={textlib.page_of(text, u['start'])}" if r["url"].lower().endswith(".pdf") or fetchlib.load_raw(r["path"])[:5] == b"%PDF-" else "")
        else:
            for text, r in texts:
                us, lv = units_from_text(text)
                for u in us:
                    u["url"] = r["url"]
                units += us
            level = CP.structure_level(units)
    full = "\n\f\n".join(u["text"] for u in units)
    info["text_path"], info["text_sha256"] = save_text(f"const-{st.lower()}", full)
    info.update(status="text" if units else "no_text", structure=level, units=len(units),
                articles=len({u.get("article") for u in units if u.get("article")}),
                sections=sum(1 for u in units if u.get("section")), chars=len(full),
                retrieved_at=max((r["retrieved_at"] for r in used), default=None),
                files=[{"url": r["url"], "sha256": r["sha256"], "path": r["path"]} for r in used][:400])
    rows = []
    for n, u in enumerate(units, start=1):
        rows.append({"id": f"{st.lower()}-const:{n:04d}", "state": st, "ordinal": n, "article": u.get("article"),
                     "article_title": u.get("article_title"), "section": u.get("section"), "section_title": u.get("section_title"),
                     "text": u["text"], "source_url": u.get("url") or info["url"]})
    return info, rows


def main(argv):
    m = latest_manifest()
    sources = json.load(open(SOURCES))["states"]
    states = [s.upper() for s in argv] or sorted(sources)
    infos, rows = [], []
    for st in states:
        info, r = extract_state(st, sources[st], m)
        infos.append(info)
        rows += r
        print(json.dumps({k: info.get(k) for k in ("state", "status", "structure", "articles", "sections", "units", "chars")}), flush=True)
    os.makedirs(WORK, exist_ok=True)
    if argv:  # partial run: merge into existing work files
        old_infos = {i["state"]: i for i in json.load(open(os.path.join(WORK, "constitutions.json")))["states"]} if os.path.exists(os.path.join(WORK, "constitutions.json")) else {}
        old_rows = [json.loads(l) for l in open(os.path.join(WORK, "constitution_sections.jsonl"), encoding="utf-8")] if os.path.exists(os.path.join(WORK, "constitution_sections.jsonl")) else []
        for i in infos:
            old_infos[i["state"]] = i
        rows = [r for r in old_rows if r["state"] not in states] + rows
        infos = [old_infos[k] for k in sorted(old_infos)]
    with open(os.path.join(WORK, "constitutions.json"), "w", encoding="utf-8") as handle:
        json.dump({"generated_at": fetchlib.utc_now(), "states": infos}, handle, indent=1)
    with open(os.path.join(WORK, "constitution_sections.jsonl"), "w", encoding="utf-8") as handle:
        for r in sorted(rows, key=lambda r: (r["state"], r["ordinal"])):
            handle.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"states": len(infos), "sections": len(rows)}))


if __name__ == "__main__":
    main(sys.argv[1:])
