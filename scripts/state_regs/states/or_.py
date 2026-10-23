"""Oregon Administrative Rules — Secretary of State, Archives Division, Oregon Administrative Rules Database (OARD, HTML).

Index: ruleSearch.action carries the chapter list (<option value="<internal id>">581 - Oregon Department of Education);
displayChapterRules.action?selectedChapter=<id> lists the chapter's divisions and, under each, its rules (number and
caption), so the index carries rule counts. Rules: displayDivisionRules.action?selectedDivision=<id> prints every rule of
the division (number, caption, body, Statutory/Other Authority, Statutes/Other Implemented, History newest first).
Session ids in links are removed. Citation form: "OAR 581-001-0005".
"""
from __future__ import annotations

import re

import model
import parsing

STATE = "OR"
BASE = "https://secure.sos.state.or.us/oard"
SAMPLE_CHAPTERS = ["137"]   # internal id of chapter 581 (Oregon Department of Education)
SAMPLE_UNITS = ["or:581-001", "or:581-002"]
EDITION = "Oregon Administrative Rules Database (Oregon Secretary of State, Archives Division)"


def _clean_url(u: str) -> str:
    return re.sub(r";JSESSIONID_OARD=[^?]*", "", u)


def _chapter(ctx, cid: str, label: str | None, nodes: list[dict]) -> None:
    url = f"{BASE}/displayChapterRules.action?selectedChapter={cid}"
    r, _e = ctx.get(url, f"index/chapter-{cid}.html")
    d = parsing.doc(r.body, r.final_url)
    h1 = d.find(".//div[@id='content']/h1")
    h2 = d.find(".//div[@id='content']/h2")
    agency = parsing.one_line(h1.text_content()) if h1 is not None else None
    num = re.sub(r"^Chapter\s+", "", parsing.one_line(h2.text_content()) or "") if h2 is not None else (label or "").split(" - ")[0]
    if not re.fullmatch(r"[0-9]{3}", num or ""):
        raise RuntimeError(f"chapter number not found on {url}")
    ch = model.node(STATE, num, level="chapter", num=num, heading=agency, agency=agency, source_url=url,
                    citation=f"OAR chapter {num}", ordinal=len(nodes))
    nodes.append(ch)
    acc = d.get_element_by_id("accordion", None)
    if acc is None:
        return
    current = None
    for el in acc:
        if el.tag == "h3":
            a = el.find(".//a")
            if a is None:
                continue
            m = re.search(r"selectedDivision=(\d+)", a.get("href") or "")
            label_txt = parsing.one_line(a.text_content()) or ""
            dm = re.match(r"Division\s+(\d+)\s*-\s*(.*)$", label_txt)
            if not m or not dm:
                continue
            dnum = f"{num}-{int(dm.group(1)):03d}"
            current = model.node(STATE, dnum, level="division", num=dnum, heading=dm.group(2) or None, agency=agency,
                                 parent_id=ch["id"], citation=f"OAR {num}, division {dm.group(1)}",
                                 source_url=f"{BASE}/displayDivisionRules.action?selectedDivision={m.group(1)}",
                                 ordinal=len(nodes), rule_count=0)
            nodes.append(current)
        elif el.tag == "div" and current is not None:
            current["rule_count"] = len(re.findall(r"ruleVrsnRsn=\d+", parsing.lxml.html.tostring(el, encoding="unicode")))


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{BASE}/ruleSearch.action", "index/search.html")
    d = parsing.doc(r.body, r.final_url)
    chapters = []
    for opt in d.iter("option"):
        v = opt.get("value") or ""
        label = parsing.one_line(opt.text_content()) or ""
        if v.isdigit() and re.match(r"\d{3}\s+-\s+", label) and (v, label) not in chapters:
            chapters.append((v, label))
    nodes: list[dict] = []
    for cid, label in chapters:
        try:
            _chapter(ctx, cid, label, nodes)
        except Exception as err:
            ctx.failures.append({"unit": f"chapter {label}", "error": str(err)[:300]})
    return nodes


def sample_index(ctx) -> list[dict]:
    nodes: list[dict] = []
    for cid in SAMPLE_CHAPTERS:
        _chapter(ctx, cid, None, nodes)
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "division"]


EFF = [re.compile(r"effective\s+(\d{1,2}/\d{1,2}/\d{4})", re.I), re.compile(r"cert\.\s*ef\.\s*(\d{1,2}-\d{1,2}-\d{2,4})", re.I)]


def parse_division(html: bytes | str, url: str, unit: dict, entry: dict) -> list[dict]:
    d = parsing.doc(html, url)
    out = []
    for div in d.find_class("rule_div"):
        ps = [p for p in div if p.tag == "p"]
        if not ps:
            continue
        head = ps[0]
        a = head.find(".//a")
        if a is None:
            continue
        number = parsing.one_line(a.text_content())
        if not number or not re.fullmatch(r"\d{3}-\d{3}-\d{4}", number):
            continue
        strongs = head.findall(".//strong")
        caption = parsing.one_line(strongs[1].text_content()) if len(strongs) > 1 else None
        foot = None
        for p in reversed(ps[1:]):
            if p.find(".//b") is not None and re.search(r"History:|Statutory/Other Authority:", p.text_content()):
                foot = p
                break
        body_ps = [p for p in ps[1:] if p is not foot]
        text = "\n".join(t for t in (parsing.text(p) for p in body_ps) if t) or None
        authority = implemented = None
        history_lines: list[str] = []
        if foot is not None:
            ft = parsing.text(foot)
            m = re.search(r"Statutory/Other Authority:\s*(.+)", ft)
            authority = m.group(1).strip() if m else None
            m = re.search(r"Statutes/Other Implemented:\s*(.+)", ft)
            implemented = m.group(1).strip() if m else None
            if "History:" in ft:
                history_lines = [x for x in ft.split("History:", 1)[1].split("\n") if x.strip()]
        latest = history_lines[0] if history_lines else ""
        eff = None
        for rx in EFF:
            m = rx.search(latest)
            if m:
                eff = model.us_date(m.group(1))
                break
        temp = bool(re.search(r"\(Temp\)|temporary", latest, re.I))
        rid = re.search(r"ruleVrsnRsn=(\d+)", a.get("href") or "")
        status = "active"
        if caption and re.search(r"\b(repealed|renumbered)\b", caption, re.I) and not text:
            status = re.search(r"\b(repealed|renumbered)\b", caption, re.I).group(1).lower()
        out.append(model.rule(STATE, number=number, citation=f"OAR {number}", node_id=unit["id"], heading=caption, text=text,
                              source_url=f"{BASE}/viewSingleRule.action?ruleVrsnRsn={rid.group(1)}" if rid else _clean_url(url),
                              raw_sha256=entry["sha256"], retrieved_at=entry["retrieved_at"], agency=unit.get("agency"),
                              history="\n".join(history_lines) or None,
                              authority="; ".join(x for x in [authority and f"Statutory/Other Authority: {authority}",
                                                              implemented and f"Statutes/Other Implemented: {implemented}"] if x) or None,
                              status=status, emergency=True if temp else None, effective_date=eff, edition=EDITION))
    return out


def rules(ctx, unit: dict) -> list[dict]:
    r, entry = ctx.get(unit["source_url"], f"rules/{unit['num']}.html")
    got = parse_division(r.body, r.final_url, unit, entry)
    ref = ctx.reference(entry, "html")
    for x in got:
        ctx.check(x, ref, "html.parser rendering of the division page")
    ctx.drop(entry)
    return got
