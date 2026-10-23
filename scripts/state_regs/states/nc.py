"""North Carolina Administrative Code — Office of Administrative Hearings, Rules Division (reports.oah.state.nc.us).

Index: ncac.asp lists titles; ncac.asp?folderName=\\Title ... lists chapters; a chapter page lists its subchapters and
every rule ("15A NCAC 02A .0101", description, with "EXPIRED - " / "REPEALED - " prefixes as printed) with PDF, HTML and
DOC files. Rules: one HTML file per subchapter ("subchapter a rules.html", Word-exported) prints each rule as
"<citation> <CAPTION>", body, "History Note: ...". Citation form: "15A NCAC 02A .0101".
"""
from __future__ import annotations

import re
from urllib.parse import quote, unquote

import model
import parsing

STATE = "NC"
HOST = "http://reports.oah.state.nc.us"
SAMPLE_CHAPTERS = [r"\Title 15A - Environmental Quality\Chapter 02 - Environmental Management"]
SAMPLE_UNITS = ["nc:15a-02a", "nc:15a-02b"]
EDITION = "North Carolina Administrative Code as published by the Office of Administrative Hearings, Rules Division"
CITE = re.compile(r"^(\d{1,2}[A-Z]?) NCAC (\d{1,2}[A-Z]{1,2}) (\.\d{4})\b\s*(.*)$")


def _u(path: str) -> str:
    """Absolute URL with spaces and other unsafe characters percent-encoded (links on the pages are printed raw)."""
    q = quote(path, safe="/:?=&\\%")
    return q if q.startswith("http") else HOST + q


def folder_url(folder: str) -> str:
    return f"{HOST}/ncac.asp?folderName={quote(folder, safe='')}"


def _chapter(ctx, folder: str, title_node: dict | None, nodes: list[dict]) -> None:
    url = folder_url(folder)
    r, _e = ctx.get(url, "index/" + re.sub(r"[^A-Za-z0-9]+", "_", folder)[-80:] + ".html")
    d = parsing.doc(r.body, r.final_url)
    m = re.search(r"Title (\d+[A-Z]?) - ([^\\]+)\\Chapter (\d+[A-Z]?) - (.+)$", folder)
    tnum, tname, cnum, cname = m.groups()
    ch_key = f"{tnum.lower()}-{cnum}"
    ch = model.node(STATE, ch_key, level="chapter", num=f"{tnum} NCAC {cnum}", heading=cname, agency=tname,
                    parent_id=title_node["id"] if title_node else None, source_url=url,
                    citation=f"{tnum} NCAC {cnum}", ordinal=len(nodes), rule_count=0)
    nodes.append(ch)
    sub = None
    for tr in d.iter("tr"):
        num_td = tr.find("td[@class='Number']")
        if num_td is None:
            continue
        a = num_td.find(".//a")
        if a is None:
            continue
        label = parsing.one_line(a.text_content()) or ""
        desc_td = tr.find("td[@class='Description']")
        desc = parsing.one_line(desc_td.text_content()) if desc_td is not None else None
        href = a.get("href") or ""
        sm = re.match(r"SubChapter ([A-Z]{1,2})$", label)
        if sm:
            html_link = [x.get("href") for x in tr.iter("a") if (x.get("href") or "").endswith(" rules.html")]
            key = f"{tnum.lower()}-{cnum}{sm.group(1).lower()}"
            sub = model.node(STATE, key, level="subchapter", num=f"{tnum} NCAC {cnum}{sm.group(1)}", heading=desc,
                             agency=tname, parent_id=ch["id"], citation=f"{tnum} NCAC {cnum}{sm.group(1)}",
                             source_url=_u(html_link[0]) if html_link else _u(href), ordinal=len(nodes), rule_count=0)
            nodes.append(sub)
        elif CITE.match(label) and sub is not None:
            sub["rule_count"] += 1
            ch["rule_count"] += 1


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{HOST}/ncac.asp", "index/top.html")
    d = parsing.doc(r.body, r.final_url)
    nodes: list[dict] = []
    titles = []
    for a in d.iter("a"):
        h = unquote(a.get("href") or "")
        m = re.search(r"folderName=(\\Title (\d+[A-Z]?) - ([^\\]+))$", h)
        if m and m.group(1) not in [t[0] for t in titles]:
            titles.append((m.group(1), m.group(2), m.group(3)))
    for folder, tnum, tname in titles:
        t = model.node(STATE, tnum.lower(), level="title", num=tnum, heading=tname, agency=tname, source_url=folder_url(folder),
                       citation=f"Title {tnum} NCAC", ordinal=len(nodes))
        nodes.append(t)
        try:
            rt, _ = ctx.get(folder_url(folder), "index/title-" + tnum + ".html")
        except Exception as err:
            ctx.failures.append({"unit": t["id"], "error": str(err)[:300]})
            continue
        dt = parsing.doc(rt.body, rt.final_url)
        chapters = []
        for a in dt.iter("a"):
            h = unquote(a.get("href") or "")
            m = re.search(r"folderName=(\\Title [^\\]+\\Chapter [^\\]+)$", h)
            if m and m.group(1) not in chapters:
                chapters.append(m.group(1))
        for folder_c in chapters:
            try:
                _chapter(ctx, folder_c, t, nodes)
            except Exception as err:
                ctx.failures.append({"unit": folder_c, "error": str(err)[:300]})
    return nodes


def sample_index(ctx) -> list[dict]:
    nodes: list[dict] = []
    for folder in SAMPLE_CHAPTERS:
        _chapter(ctx, folder, None, nodes)
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "subchapter"]


STATUS_WORD = re.compile(r"^(Expired|Repealed|Transferred|Recodified)\b.*Eff\.", re.I)


def parse_subchapter(html: bytes | str, url: str, unit: dict, entry: dict) -> list[dict]:
    d = parsing.doc(html, url)
    body = d.find("body")
    lines = parsing.text(body if body is not None else d).split("\n")
    out = []
    cur = None

    def flush():
        if not cur:
            return
        text_lines, hist_lines = [], []
        target = text_lines
        for ln in cur["lines"]:
            if ln.startswith("History Note:"):
                target = hist_lines
            target.append(ln)
        history = "\n".join(hist_lines) or None
        status = "active"
        if not text_lines and hist_lines:
            last = " ".join(hist_lines).split(";")[-1].strip()
            m = re.match(r"(Expired|Repealed|Transferred|Recodified)", last, re.I)
            if m:
                status = m.group(1).lower()
        if status == "active" and not text_lines:
            m = re.search(r"\b(recodified|transferred|repealed|reserved|expired)\b", cur["caption"] or "", re.I)
            if m:
                status = m.group(1).lower()
        citation = f"{cur['t']} NCAC {cur['c']} {cur['n']}"
        rule_url = url.rsplit("/", 1)[0] + "/" + quote(f"{cur['t'].lower()} ncac {cur['c'].lower()} {cur['n']}.html")
        out.append(model.rule(STATE, number=citation, citation=citation, node_id=unit["id"], heading=cur["caption"],
                              text="\n".join(text_lines) or None, source_url=rule_url, raw_sha256=entry["sha256"],
                              retrieved_at=entry["retrieved_at"], agency=unit.get("agency"), history=history,
                              authority=_authority(history), status=status, edition=EDITION))

    for ln in lines:
        m = CITE.match(ln)
        if m:
            flush()
            cur = {"t": m.group(1), "c": m.group(2), "n": m.group(3), "caption": m.group(4) or None, "lines": []}
            continue
        if cur is not None:
            cur["lines"].append(ln)
    flush()
    return out


def _authority(history: str | None) -> str | None:
    if not history:
        return None
    m = re.search(r"History Note:\s*Authority\s+(.+?);\s*(?:\n|Eff\.|Temporary|Emergency|Recodified|Transferred)", history, re.S)
    return " ".join(m.group(1).split()) if m else None


def rules(ctx, unit: dict) -> list[dict]:
    r, entry = ctx.get(unit["source_url"], "rules/" + unit["id"].split(":", 1)[1] + ".html")
    got = parse_subchapter(r.body, r.final_url, unit, entry)
    ref = ctx.reference(entry, "html")
    for x in got:
        ctx.check(x, ref, "html.parser rendering of the subchapter file")
    ctx.drop(entry)
    return got
