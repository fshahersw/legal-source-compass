"""Illinois Administrative Code — Illinois General Assembly, Joint Committee on Administrative Rules (www.ilga.gov).

robots.txt sets Crawl-delay: 10 for every agent, so every request to www.ilga.gov is at least 10 s apart.
Index: commission/jcar/admincode/titles.html lists the titles; the JCAR file directory ftp/JCAR/AdminCode/<title>/ lists
one HTML file per section ("035001010A01000R.html": title 035, part 00101, ...) with its modification date and size, so
the index carries section counts per part (part captions are not printed there: "Not recorded"). Rules: each section
file prints the TITLE / SUBTITLE / CHAPTER / PART / SECTION banner, the section text and "(Source: Amended at 43 Ill. Reg.
9674, effective August 22, 2019)". The site states that its database is not the official text (the certified copy
filed with the Secretary of State is); that statement is kept as the edition note.
Citation form: "35 Ill. Adm. Code 101.100".
"""
from __future__ import annotations

import gzip
import json
import os
import re

import lib
import model
import parsing

STATE = "IL"
HOST = "https://www.ilga.gov"
FTP = f"{HOST}/ftp/JCAR/AdminCode"
SAMPLE_TITLES = ["035"]
SAMPLE_UNITS = ["il:35-101"]
SAMPLE_LIMIT = 12
EDITION = ("Illinois Administrative Code database maintained and updated weekly by the Illinois General Assembly; the site "
           "states it is not the official text (the certified copy filed with the Secretary of State is)")
FILE = re.compile(r"^(\d{3})(\d{5})(\w+)R\.html$")
LISTING = re.compile(r"(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(\d+)\s+<A HREF=\"[^\"]+\">([^<]+)</A>", re.I)


def _files_path() -> str:
    return os.path.join(lib.BUILD, STATE, "section-files.json.gz")


def _title(ctx, tnum: str, tname: str | None, nodes: list[dict], files: dict, limit: int | None = None) -> None:
    t = model.node(STATE, str(int(tnum)), level="title", num=str(int(tnum)), heading=tname, source_url=f"{FTP}/{tnum}/",
                   citation=f"Title {int(tnum)} Ill. Adm. Code", ordinal=len(nodes))
    nodes.append(t)
    r, _e = ctx.get(f"{FTP}/{tnum}/", f"index/ftp-{tnum}.html")
    parts: dict[str, list] = {}
    for date, _time, size, name in LISTING.findall(r.text()):
        m = FILE.match(name)
        if not m:
            continue
        parts.setdefault(m.group(2), []).append({"file": name, "modified": model.us_date(date), "bytes": int(size)})
    for pnum in sorted(parts, key=int):
        part = str(int(pnum))
        listed = parts[pnum][:limit] if limit else parts[pnum]
        key = f"{int(tnum)}-{part}"
        nodes.append(model.node(STATE, key, level="part", num=part, heading=None, parent_id=t["id"],
                                source_url=f"{FTP}/{tnum}/", citation=f"{int(tnum)} Ill. Adm. Code {part}",
                                ordinal=len(nodes), rule_count=len(listed)))
        files[f"il:{key}"] = [dict(x, url=f"{FTP}/{tnum}/{x['file']}") for x in listed]


def _titles(ctx) -> list[tuple[str, str]]:
    r, _e = ctx.get(f"{HOST}/commission/jcar/admincode/titles.html", "index/titles.html")
    out = []
    for href, label in re.findall(r"<a href='(\d{3})/\d{3}parts\.html' class='links'>(.*?)</a>", r.text(), re.S):
        name = re.sub(r"^TITLE\s+\d+:\s*", "", " ".join(label.split()))
        out.append((href, name))
    return out


def index(ctx) -> list[dict]:
    nodes: list[dict] = []
    files: dict = {}
    for tnum, tname in _titles(ctx):
        try:
            _title(ctx, tnum, tname, nodes, files)
        except Exception as err:
            ctx.failures.append({"unit": f"title {tnum}", "error": str(err)[:300]})
    with gzip.open(_files_path(), "wt", encoding="utf-8") as h:
        json.dump(files, h)
    return nodes


def sample_index(ctx) -> list[dict]:
    names = dict(_titles(ctx))
    nodes: list[dict] = []
    files: dict = {}
    for tnum in SAMPLE_TITLES:
        _title(ctx, tnum, names.get(tnum), nodes, files, limit=SAMPLE_LIMIT)
    os.makedirs(os.path.dirname(_files_path()), exist_ok=True)
    with gzip.open(_files_path(), "wt", encoding="utf-8") as h:
        json.dump(files, h)
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "part"]


SOURCE = re.compile(r"^\(Source:\s*(.+)\)$", re.S)
REG = re.compile(r"(\d+\s+Ill\.\s*Reg\.\s+\d+)")
EFF = re.compile(r"effective\s+([A-Z][a-z]+\.?\s+\d{1,2},\s*\d{4})")


def parse_section(html: bytes | str, url: str, unit: dict, entry: dict, file_meta: dict) -> dict | None:
    d = parsing.doc(html, url)
    meta = d.find(".//meta[@name='sectionname']")
    name = parsing.one_line(meta.get("content")) if meta is not None else None
    m = re.match(r"Section\s+(\d+\.\d+[a-z]?)\s+(.*)$", name or "")
    if not m:
        return None
    number, heading = m.group(1), m.group(2) or None
    banner = d.find_class("heading")
    agency = None
    if banner:
        bt = parsing.text(banner[0])
        cm = re.search(r"^CHAPTER [^:]+:\s*(.+)$", bt, re.M)
        agency = cm.group(1).strip() if cm else None
    paras = []
    for p in d.iter("p"):
        t = parsing.one_line(p.text_content())
        if t:
            paras.append(t)
    if paras and re.match(r"Section\s+" + re.escape(number) + r"\b", paras[0]):
        paras = paras[1:]
    source = None
    if paras and SOURCE.match(paras[-1]):
        source = paras.pop()
    title = unit["citation"].split(" Ill.")[0]
    reg = REG.search(source or "")
    eff = EFF.search(source or "")
    emergency = True if source and re.search(r"emergency", source, re.I) else None
    status = "active"
    if heading and re.search(r"\((repealed|reserved)\)", heading, re.I) and not paras:
        status = re.search(r"\((repealed|reserved)\)", heading, re.I).group(1).lower()
    return model.rule(STATE, number=number, citation=f"{title} Ill. Adm. Code {number}", node_id=unit["id"], heading=heading,
                      text="\n".join(paras) or None, source_url=url, raw_sha256=entry["sha256"], retrieved_at=entry["retrieved_at"],
                      agency=agency, history=source, status=status, emergency=emergency,
                      effective_date=model.us_date(eff.group(1)) if eff else None,
                      register_citation=reg.group(1) if reg else None, edition=EDITION,
                      currency=f"Section file last modified {file_meta['modified']} (JCAR file directory)" if file_meta.get("modified") else None)


_FILES: dict | None = None


def rules(ctx, unit: dict) -> list[dict]:
    global _FILES
    if _FILES is None:
        with gzip.open(_files_path(), "rt", encoding="utf-8") as h:
            _FILES = json.load(h)
    out = []
    for f in _FILES.get(unit["id"], []):
        r, entry = ctx.get(f["url"], "rules/" + f["file"])
        x = parse_section(r.body, r.final_url, unit, entry, f)
        if x:
            ctx.check(x, ctx.reference(entry, "html"), "html.parser rendering of the section file")
            out.append(x)
        ctx.drop(entry)
    return out
