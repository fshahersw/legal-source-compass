"""Parse the acquired administrative-code tables of contents into regulation_index.jsonl + regulation_codes.json.

  python3 -I -B scripts/enrichment/court_rules/extract_regulations.py

Index only: each entry is one heading in the publisher's own table of contents (title, agency, chapter, part or rule
set) with its citation as printed, its heading, the agency where the page names it and the official address. Nothing is
inferred; a heading the page does not print is left empty. Reads private/acq/court_rules/regulations/ only.
"""
from __future__ import annotations

import html as htmlmod
import json
import os
import re
import sys
from urllib.parse import parse_qs, unquote, urljoin, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
from acquire_regulations import SOURCES  # noqa: E402
from extract_rules import latest_manifest  # noqa: E402
from links import page_links  # noqa: E402

WORK = os.path.join(fetchlib.ROOT, "private", "build", "court_rules", "work")


def clean(s: str) -> str:
    return " ".join(htmlmod.unescape(re.sub(r"<[^>]+>", " ", s or "")).split())


def files(m: dict, st: str, prefix: str = "") -> list[tuple[str, dict]]:
    base = f"private/acq/court_rules/regulations/{st}/{prefix}"
    return sorted((p, r) for p, r in m.items() if p.startswith(base) and os.path.exists(os.path.join(fetchlib.ROOT, p)))


def text_of(row: dict) -> str:
    raw = fetchlib.load_raw(row["path"])
    return raw.decode("utf-8", "replace")


def entry(st: str, level: str, citation: str, heading: str | None, url: str, row: dict, agency: str | None = None,
          parent: str | None = None, status: str | None = None) -> dict:
    # headings keep the publisher's words; only runs of whitespace (line breaks inside a heading) become one space
    return {"state": st, "level": level, "citation": citation.strip(), "heading": re.sub(r"\s+", " ", heading or "").strip() or None,
            "agency": (agency or "").strip() or None, "parent": parent, "status": status, "url": url,
            "listed_on": row["url"], "retrieved_at": row["retrieved_at"], "page_sha256": row["sha256"]}


# A row of the Secretary of State's agency list: the CCR number links to the rule set, the next cell is its title.
CO_ROW = re.compile(r'<TD[^>]*>\s*<a href="([^"]*DisplayRule\.do\?[^"]*ruleinfo[^"]*)"[^>]*>(.*?)</a>\s*</TD>\s*<TD[^>]*>(.*?)</TD>',
                    re.S | re.I)


def co_titles(html: str) -> dict[str, str]:
    """{rule-set link as printed: the title in the same table row}; a row without a title cell is left out."""
    return {htmlmod.unescape(link): clean(title) for link, _, title in CO_ROW.findall(html) if clean(title)}


def parse_co(m):
    out = []
    for p, r in files(m, "CO", "agency_"):
        q = parse_qs(urlparse(r["url"]).query)
        dept = (q.get("deptName") or [""])[0]
        agency = (q.get("agencyName") or [""])[0]
        html = text_of(r)
        titles = {urljoin(r["url"], link): title for link, title in co_titles(html).items()}
        for link, text in page_links(html, r["url"]):
            if "DisplayRule.do" not in link or "ruleinfo" not in link:
                continue
            series = (parse_qs(urlparse(link).query).get("seriesNum") or [""])[0].strip()
            if not series:
                continue
            # The link text repeats the CCR number; the heading is the row's Title cell (none when the row has none).
            heading = titles.get(link)
            if heading is None and clean(text) != series:
                heading = clean(text)
            out.append(entry("CO", "rule set", series, heading, link, r, agency=re.sub(r"^\d+\s+", "", agency),
                             parent=re.sub(r"^[\d,]+\s+", "", dept)))
    return out


def parse_id(m):
    out = []
    for p, r in files(m, "ID", "fetch-documents"):
        for d in json.loads(fetchlib.load_raw(r["path"])).get("data", []):
            num = str(d.get("documentNumber") or "").strip()
            if not num:
                continue
            out.append(entry("ID", "chapter", f"IDAPA {num}", d.get("documentName"), d.get("file") or "https://adminrules.idaho.gov/rules/current/",
                             r, agency=d.get("agency")))
    return out


def parse_ks(m):
    out = []
    for p, r in files(m, "KS", "agency-regulation"):
        for link, text in page_links(text_of(r), r["url"]):
            mm = re.search(r"/KAR/(\d{4})/(\1_KAR_Volumes_(?:Book_\d+|Index)\.pdf)$", link)
            if mm:  # the citation is the published file name; the heading is the link text, when the page gives one
                out.append(entry("KS", "bound volume", mm.group(2), clean(text) or None, link, r))
    return out


def parse_ky(m):
    out = []
    titles = {}
    idx = files(m, "KY", "index")
    if idx:
        for link, text in page_links(text_of(idx[0][1]), idx[0][1]["url"]):
            mm = re.search(r"/law/kar/titles/(\d+)$", link)
            if mm:
                titles[mm.group(1)] = clean(text)
    for p, r in files(m, "KY", "title_"):
        t = r["url"].rstrip("/").rsplit("/", 1)[-1]
        tname = re.sub(r"\s+(Current|Expired|Repealed)$", "", re.sub(r"^Title\s+\d+\s*[—-]\s*", "", titles.get(t, "")))
        out.append(entry("KY", "title", f"Title {t} KAR", tname or None, r["url"], r))
        for mm in re.finditer(r'<a href="(\d+)"><div><span class="kar-number">Chapter (\d+)</span>.*?<span class="kar-name">(.*?)</span></div><div class="kar-status ([a-z-]+)">', text_of(r), re.S):
            out.append(entry("KY", "chapter", f"{t} KAR {mm.group(2)}", clean(mm.group(3)), f"{r['url'].rstrip('/')}/{mm.group(1)}", r,
                             agency=tname or None, parent=f"Title {t}", status=mm.group(4)))
    return out


def parse_md(m):
    out = []
    for p, r in files(m, "MD", "index.json"):
        tree = json.loads(fetchlib.load_raw(r["path"]))

        def walk(node, depth, parent):
            sc, t, et = node.get("sc"), node.get("t"), node.get("et")
            if sc and t and et == "container":
                level = {1: "title", 2: "subtitle", 3: "chapter"}.get(sc.count(".") + 1, "container")
                out.append(entry("MD", level, f"COMAR {sc}", t, f"https://regs.maryland.gov/us/md/exec/comar/{sc}", r, parent=parent))
                parent = f"COMAR {sc}"
            for child in node.get("c") or []:
                if isinstance(child, dict) and child.get("et") == "container":
                    walk(child, depth + 1, parent)

        roots = tree if isinstance(tree, list) else (tree.get("c") or [tree])
        for root in roots:
            if isinstance(root, dict):
                walk(root, 0, None)
    return out


def parse_mn(m):
    out = []
    for p, r in files(m, "MN", "numerical"):
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", text_of(r), re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if len(cells) < 2:
                continue
            link = re.search(r'href="([^"]*/rules/(\d{3,4}[A-Z]?)/?)"', cells[0])
            if not link:
                continue
            out.append(entry("MN", "chapter", f"Minn. R. ch. {link.group(2)}", clean(cells[1]), urljoin(r["url"], link.group(1)), r,
                             agency=clean(cells[2]) if len(cells) > 2 else None))
    return out


def parse_nm(m):
    out = []
    seen = set()
    for p, r in files(m, "NM", "title_"):
        url = r["url"].rstrip("/") + "/"
        tm = re.search(r"/title-(\d+)-([^/]+)/$", url)
        if not tm:
            continue
        html = text_of(r)
        h = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
        out.append(entry("NM", "title", f"Title {tm.group(1)} NMAC", clean(h.group(1)) if h else None, url, r))
        for link, text in page_links(html, url):
            if link.startswith(url) and re.search(r"/chapter-(\d+)-[^/]+/?$", link) and link not in seen:
                seen.add(link)
                cm = re.search(r"/chapter-(\d+)-", link)
                heading = re.sub(r"^Chapter\s+\d+\s*[–—-]\s*", "", clean(text))
                out.append(entry("NM", "chapter", f"{tm.group(1)}.{int(cm.group(1))} NMAC", heading, link, r, parent=f"Title {tm.group(1)}"))
    return out


def parse_oh(m):
    out = []
    for p, r in files(m, "OH", "agency_"):
        html = text_of(r)
        h = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
        agency = clean(h.group(1)) if h else None
        for mm in re.finditer(r'href="(/ohio-administrative-code/chapter-([0-9:]+-[0-9.]+))"[^>]*>Chapter [^<]*<span[^>]*>\|</span>\s*([^<]*)</a>', html):
            out.append(entry("OH", "chapter", f"Ohio Adm.Code Chapter {mm.group(2)}", clean(mm.group(3)), urljoin(r["url"], mm.group(1)), r,
                             agency=agency))
    return out


def parse_sc(m):
    out = []
    for p, r in files(m, "SC", "statmast"):
        html = text_of(r)
        for mm in re.finditer(r"CHAPTER\s+(\d+[A-Z]?)\s*-\s*([^<]+)", html):
            num = mm.group(1)
            out.append(entry("SC", "chapter", f"S.C. Code Regs. Chapter {num}", clean(mm.group(2)),
                             f"https://www.scstatehouse.gov/getfile.php?TYPE=CODEOFREGS&CHAPTER={num}", r))
    return out


def parse_va(m):
    out = []
    agency_names = {}
    for p, r in files(m, "VA", "agencies_"):
        data = json.loads(fetchlib.load_raw(r["path"]))
        t = data.get("TitleNumber")
        out.append(entry("VA", "title", f"{t} VAC", data.get("TitleName"), f"https://law.lis.virginia.gov/admincode/title{t}/", r))
        for ag in data.get("AgencyList") or []:
            agency_names[(str(t), str(ag.get("AgencyNumber")))] = ag.get("AgencyName")
    for p, r in files(m, "VA", "chapters_"):
        mm = re.search(r"chapters_(\d+)_(\d+)\.json", p)
        data = json.loads(fetchlib.load_raw(r["path"]))
        for ag in (data.get("AgencyList") or []) if isinstance(data, dict) else []:
            for ch in ag.get("ChapterList") or []:
                t, a, c = mm.group(1), mm.group(2), ch.get("ChapterNumber")
                if not re.fullmatch(r"\d+[A-Za-z]?", str(c or "")):
                    continue  # "Preface" (the agency summary) is not a chapter and has no chapter citation
                out.append(entry("VA", "chapter", f"{t}VAC{a}-{c}", ch.get("ChapterName"),
                                 f"https://law.lis.virginia.gov/admincode/title{t}/agency{a}/chapter{c}/", r,
                                 agency=agency_names.get((t, a)), parent=f"{t} VAC"))
    return out


def parse_wa(m):
    out = []
    for p, r in files(m, "WA", "title_"):
        tm = re.search(r"WAC(?:%20| )+(\d+[A-Z]?)(?:%20| )+TITLE", r["url"])
        if not tm:
            continue
        t = tm.group(1)
        out.append(entry("WA", "title", f"Title {t} WAC", None, r["url"], r))
        for link, text in page_links(text_of(r), r["url"]):
            cm = re.search(r"WAC(?:%20| )+(\d+[A-Z]?)(?:%20| )+-(\d+[A-Z]?)(?:%20| )+CHAPTER/?$", link)
            if cm:
                out.append(entry("WA", "chapter", f"Chapter {cm.group(1)}-{cm.group(2)} WAC", None, link, r, parent=f"Title {t}"))
    return out


# After a chapter link the Legislature's table of contents prints "(PDF: <icon link>)" and then " - <heading>".
WI_TAIL = re.compile(r'\s*(?:<span class="pdfLink">.*?</span>\s*)?(?:</span>\s*)?[-\u2013\u2014]\s*([^<]{2,300})', re.S)


def wi_entries(html: str) -> list[tuple[str, str, str | None]]:
    """[(link path, chapter label, heading)] from one agency page; the "Using the code" help page lists none."""
    node = re.search(r'<span id="nodePath">([^<]*)</span>', html)
    if node and node.group(1).rstrip("/").endswith("/using"):
        return []
    out = []
    for mm in re.finditer(r'href="(/document/administrativecode/ch\.%20([^"]+?))"[^>]*>([^<]*)</a>', html):
        if mm.group(1).endswith(".pdf"):
            continue
        tail = WI_TAIL.match(html, mm.end())
        heading = clean(tail.group(1)) if tail else None
        out.append((mm.group(1), unquote(mm.group(2)), heading or None))
    return out


def parse_wi(m):
    out = []
    seen = set()
    for p, r in files(m, "WI", "agency_"):
        agency = unquote(r["url"].rsplit("/", 1)[-1])
        for path, label, heading in wi_entries(text_of(r)):
            if path in seen:
                continue
            seen.add(path)
            out.append(entry("WI", "chapter", f"Wis. Admin. Code ch. {label}", heading,
                             urljoin(r["url"], path), r, agency=agency))
    return out


PARSERS = {"CO": parse_co, "ID": parse_id, "KS": parse_ks, "KY": parse_ky, "MD": parse_md, "MN": parse_mn, "NM": parse_nm,
           "OH": parse_oh, "SC": parse_sc, "VA": parse_va, "WA": parse_wa, "WI": parse_wi}


def acquisition_results() -> dict:
    latest = {}
    path = os.path.join(fetchlib.ACQ, "regulations", "acquire_log.jsonl")
    for line in open(path, encoding="utf-8"):
        row = json.loads(line)
        latest[row["state"]] = row
    return latest


def main():
    m = latest_manifest()
    results = acquisition_results()
    rows, codes = [], []
    for st, src in sorted(SOURCES.items()):
        res = results.get(st, {})
        parsed = PARSERS[st](m) if st in PARSERS else []
        seen = set()
        uniq = []
        for e in parsed:
            key = (e["level"], e["citation"])
            if key in seen:
                continue
            seen.add(key)
            uniq.append(e)
        rows += uniq
        levels = {}
        for e in uniq:
            levels[e["level"]] = levels.get(e["level"], 0) + 1
        status = "indexed" if uniq else ("blocked" if st in ("IL", "ME") else "not_indexed")
        codes.append({"state": st, "code": src["code"], "publisher": src["publisher"], "url": src["url"], "status": status,
                      "entries": len(uniq), "levels": levels, "acquisition": {k: res.get(k) for k in ("result", "parts", "failed", "at")},
                      "errors": (res.get("errors") or [])[:3]})
        print(json.dumps({"state": st, "status": status, "entries": len(uniq), "levels": levels}))
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, "regulation_codes.json"), "w", encoding="utf-8") as handle:
        json.dump({"generated_at": fetchlib.utc_now(), "codes": codes}, handle, indent=1)
    with open(os.path.join(WORK, "regulation_index.jsonl"), "w", encoding="utf-8") as handle:
        for r in rows:
            handle.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(json.dumps({"entries": len(rows)}))


if __name__ == "__main__":
    main()
