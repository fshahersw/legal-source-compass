"""Florida Administrative Code — Florida Department of State, Administrative Code and Register (www.flrules.org).

Index: gateway/organization.asp lists departments (department.asp?id=62); a department page lists its divisions
(Division.asp?DivID=...); a division page lists its chapters (ChapterHome.asp?Chapter=62-296). Rules: a chapter page
lists every rule in effect (number, title, effective date as printed) with the latest rule file (readFile.asp ... .doc,
a Word 97-2003 document). The rule file prints "<number> <title>.", the body and the history note ("Rulemaking Authority
... Law Implemented ... History–New 1-1-96, Amended 7-10-14."). Text comes from the Word file (states/worddoc.py) and is
checked against LibreOffice's conversion of the same bytes. Citation form: "Fla. Admin. Code R. 62-296.320".
"""
from __future__ import annotations

import os
import re
from urllib.parse import quote

import model
import parsing
from states import worddoc

STATE = "FL"
HOST = "https://www.flrules.org"
SAMPLE_UNITS = ["fl:62-296", "fl:64b8-9"]
SAMPLE_LIMIT = 12
FULL_CHECK_EVERY = int(os.environ.get("STATE_REGS_DOC_CHECK_EVERY", "20"))
EDITION = "Florida Administrative Code as published by the Florida Department of State (flrules.org), latest rule file"


def _get_doc(ctx, url, rel):
    return ctx.get(url, rel)


def _division(ctx, div_url: str, dept: dict, nodes: list[dict]) -> None:
    r, _e = ctx.get(div_url, "index/div-" + re.sub(r"\D+", "", div_url.split("DivID=")[-1]) + ".html")
    d = parsing.doc(r.body, r.final_url)
    title = d.find(".//title")
    heading = parsing.one_line(title.text_content()).split(" - Florida Administrative")[0] if title is not None else None
    dv = model.node(STATE, "div-" + div_url.split("DivID=")[-1], level="division", num=None, heading=heading,
                    agency=dept.get("heading"), parent_id=dept["id"], source_url=div_url, ordinal=len(nodes))
    nodes.append(dv)
    for href, label in parsing.links(d, r"ChapterHome\.asp\?Chapter="):
        num = href.split("Chapter=")[-1].strip()
        heading = label.split(":", 1)[1].strip() if ":" in label else None
        nodes.append(model.node(STATE, num.lower(), level="chapter", num=num, heading=heading, agency=dept.get("heading"),
                                parent_id=dv["id"], source_url=f"{HOST}/gateway/ChapterHome.asp?Chapter={quote(num)}",
                                citation=f"Fla. Admin. Code ch. {num}", ordinal=len(nodes)))


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{HOST}/gateway/organization.asp", "index/organization.html")
    d = parsing.doc(r.body, r.final_url)
    nodes: list[dict] = []
    seen = set()
    for tr in d.iter("tr"):
        a = [x for x in tr.iter("a") if re.search(r"Department\.asp\?.*DeptID=", x.get("href") or "", re.I)]
        if not a:
            continue
        href = a[0].get("href")
        did = re.search(r"DeptID=([^&]+)", href).group(1)
        if did in seen:
            continue
        seen.add(did)
        cells = [parsing.one_line(td.text_content()) for td in tr.findall("td")]
        name = next((c for c in cells if c and c != did and not c.isdigit()), None)
        dept = model.node(STATE, f"dept-{did.lower()}", level="department", num=did, heading=name, agency=name,
                          source_url=href, citation=f"Fla. Admin. Code title {did}", ordinal=len(nodes))
        nodes.append(dept)
        try:
            rd, _ = ctx.get(href, f"index/dept-{did}.html")
            dd = parsing.doc(rd.body, rd.final_url)
            divs = [h for h, _t in parsing.links(dd, r"(?i)Division\.asp\?.*DivID=")]
        except Exception as err:
            ctx.failures.append({"unit": dept["id"], "error": str(err)[:300]})
            continue
        for div_url in divs:
            try:
                _division(ctx, div_url, dept, nodes)
            except Exception as err:
                ctx.failures.append({"unit": div_url, "error": str(err)[:300]})
    return nodes


def sample_index(ctx) -> list[dict]:
    """The sample needs no index crawl: its chapters are addressed directly (unit())."""
    return []


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "chapter"]


def unit(state: str, node_id: str) -> dict:
    num = node_id.split(":", 1)[1].upper()
    return model.node(STATE, num.lower(), level="chapter", num=num, heading=None,
                      source_url=f"{HOST}/gateway/ChapterHome.asp?Chapter={quote(num)}", citation=f"Fla. Admin. Code ch. {num}")


def chapter_rows(html: bytes | str, url: str) -> list[dict]:
    d = parsing.doc(html, url)
    rows = []
    for tr in d.find_class("results"):
        tds = tr.findall("td")
        doc = [a.get("href") for a in tr.iter("a") if "readFile.asp" in (a.get("href") or "")]
        num_a = [a for a in tr.iter("a") if "RuleNo.asp" in (a.get("href") or "")]
        if not num_a or len(tds) < 4:
            continue
        rows.append({"number": parsing.one_line(num_a[0].text_content()), "title": parsing.one_line(tds[2].text_content()),
                     "effective": parsing.one_line(tds[3].text_content()), "doc": doc[0] if doc else None})
    return rows


HIST = re.compile(r"^(Rulemaking Authority|Specific Authority|Rulemaking Specific Authority|Authority)\b")


def parse_rule(text: str, row: dict, unit: dict, entry: dict, url: str) -> dict:
    lines = text.split("\n")
    number = row["number"]
    heading = row["title"]
    if lines and lines[0].startswith(number):
        first = lines.pop(0)[len(number):].strip()
        heading = first or heading
    hist_idx = next((i for i in range(len(lines) - 1, -1, -1) if HIST.match(lines[i])), None)
    history = None
    if hist_idx is not None:
        history = "\n".join(lines[hist_idx:])
        lines = lines[:hist_idx]
    auth = re.match(r"(Rulemaking Authority|Specific Authority)\s+(.+?)(?:\s+Law Implemented|\s+History|$)", history or "")
    status = "repealed" if re.search(r"\bRepealed\b", (history or "").split("History")[-1][-40:]) and not lines else "active"
    return model.rule(STATE, number=number, citation=f"Fla. Admin. Code R. {number}", node_id=unit["id"], heading=heading,
                      text="\n".join(lines) or None, source_url=f"{HOST}/gateway/RuleNo.asp?id={quote(number)}",
                      raw_sha256=entry["sha256"], retrieved_at=entry["retrieved_at"], agency=unit.get("agency"),
                      history=history, authority=auth.group(2).strip() if auth else None, status=status,
                      effective_date=model.us_date(row.get("effective")), edition=EDITION,
                      currency=f"Latest rule file listed on the chapter page ({url})")


def rules(ctx, unit: dict) -> list[dict]:
    r, centry = ctx.get(unit["source_url"], "rules/chapter-" + unit["num"] + ".html")
    rows = chapter_rows(r.body, r.final_url)
    if ctx.run == "sample":
        rows = rows[:SAMPLE_LIMIT]
    out = []
    for i, row in enumerate(rows):
        if not row["doc"]:
            ctx.failures.append({"unit": f"{unit['id']} {row['number']}", "error": "no rule file listed"})
            continue
        doc_url = parsing.absolute(HOST + "/gateway/", row["doc"]).replace(" ", "%20")
        rd, entry = ctx.get(doc_url, "rules/" + row["number"] + ".doc")
        try:
            text = worddoc.doc_text(rd.body)
        except Exception as err:
            ctx.failures.append({"unit": f"{unit['id']} {row['number']}", "error": f"Word file not readable: {err}"[:300]})
            ctx.drop(entry)
            continue
        x = parse_rule(text, row, unit, entry, unit["source_url"])
        if ctx.run == "sample" or i % FULL_CHECK_EVERY == 0:
            ctx.check(x, ctx.reference(entry, "doc"), "LibreOffice text conversion of the same rule file")
        else:
            x["text_check"] = {"method": f"not checked (LibreOffice check runs on 1 in {FULL_CHECK_EVERY} rules of a full run)",
                               "text": "not_checked", "heading": "not_checked", "history": "not_checked"}
        out.append(x)
        ctx.drop(entry)
    ctx.drop(centry)
    return out
