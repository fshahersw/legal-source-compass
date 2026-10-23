"""Washington Administrative Code — Office of the Code Reviser, app.leg.wa.gov/wac (HTML).

Index: default.aspx lists titles ("Title 173" + agency); default.aspx?cite=<title> lists chapters with captions.
Rules: default.aspx?cite=<chapter>&full=true prints every section of the chapter (number, caption, body, history note in
brackets). The history note's first entry is the latest filing: "WSR 25-05-042 ..., filed 2/12/25, effective 3/15/25".
Citation form: "WAC 173-400-010".
"""
from __future__ import annotations

import re

import model
import parsing

STATE = "WA"
BASE = "https://app.leg.wa.gov/wac/default.aspx"
SAMPLE_UNITS = ["wa:173-400", "wa:296-24"]
EDITION = "Washington Administrative Code as published by the Office of the Code Reviser (app.leg.wa.gov)"
SAMPLE_TITLES = ["173", "296"]


def _title_nodes(ctx, titles: list[tuple[str, str | None]]) -> list[dict]:
    nodes: list[dict] = []
    for num, agency in titles:
        url = f"{BASE}?cite={num}"
        t = model.node(STATE, f"title-{num}", level="title", num=num, heading=agency, agency=agency, source_url=url,
                       citation=f"Title {num} WAC", ordinal=len(nodes))
        nodes.append(t)
        try:
            r, _e = ctx.get(url, f"index/title-{num}.html")
        except Exception as err:
            ctx.failures.append({"unit": t["id"], "error": str(err)[:300]})
            continue
        d = parsing.doc(r.body, r.final_url)
        h2 = d.find(".//h2")
        if h2 is not None and not agency:
            t["heading"] = t["agency"] = parsing.one_line(h2.text_content())
        for tr in d.iter("tr"):
            a = tr.find(".//a")
            tds = tr.findall("td")
            if a is None or len(tds) < 2:
                continue
            m = re.search(r"cite=([0-9]+[A-Z]?-[0-9]+[A-Z]?)$", a.get("href") or "")
            if not m or not m.group(1).startswith(num + "-"):
                continue
            ch = m.group(1)
            nodes.append(model.node(STATE, ch, level="chapter", num=ch, heading=parsing.one_line(tds[-1].text_content()),
                                    agency=t["agency"], parent_id=t["id"], source_url=f"{BASE}?cite={ch}",
                                    citation=f"Chapter {ch} WAC", ordinal=len(nodes)))
    return nodes


def index(ctx) -> list[dict]:
    r, _e = ctx.get(BASE, "index/top.html")
    d = parsing.doc(r.body, r.final_url)
    titles = []
    for tr in d.iter("tr"):
        tds = tr.findall("td")
        a = tr.find(".//a")
        if a is None or not tds:
            continue
        m = re.search(r"cite=([0-9]+[A-Z]?)$", a.get("href") or "")
        if not m or "Title" not in (a.text_content() or ""):
            continue
        agency = parsing.one_line(tds[1].text_content()) if len(tds) > 1 else None
        if (m.group(1), agency) not in titles:
            titles.append((m.group(1), agency))
    return _title_nodes(ctx, titles)


def sample_index(ctx) -> list[dict]:
    return _title_nodes(ctx, [(t, None) for t in SAMPLE_TITLES])


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "chapter"]


WSR = re.compile(r"WSR\s+(\d{2}-\d{2}-\d{3})")
EFFECTIVE = re.compile(r"effective\s+(\d{1,2}/\d{1,2}/\d{2,4})")
FILED = re.compile(r"filed\s+(\d{1,2}/\d{1,2}/\d{2,4})")


def parse_chapter(html: bytes | str, url: str, unit: dict, entry: dict) -> list[dict]:
    d = parsing.doc(html, url)
    root = d.get_element_by_id("ContentPlaceHolder1_dlSectionContent", None)
    if root is None:
        return []
    out = []
    for a in root.iter("a"):
        num = a.get("name")
        if not num or not re.fullmatch(r"[0-9]+[A-Z]?-[0-9]+[A-Z]?-[0-9]+[A-Z]?", num):
            continue
        divs = []
        sib = a.getnext()
        while sib is not None and not (sib.tag == "a" and sib.get("name")):
            if sib.tag == "div":
                divs.append(sib)
            sib = sib.getnext()
        if len(divs) < 2:
            continue
        caption = parsing.one_line(divs[1].text_content())
        body_divs = divs[2:]
        history = None
        if body_divs and "margin-top:15pt" in (body_divs[-1].get("style") or "").replace(" ", ""):
            history = parsing.one_line(body_divs[-1].text_content())
            body_divs = body_divs[:-1]
        text = "\n".join(t for t in (parsing.text(b) for b in body_divs) if t) or None
        latest = history.split(";")[0] if history else ""
        wsr = WSR.search(latest)
        eff = EFFECTIVE.search(latest)
        status = "active"
        if caption and re.search(r"\b(repealed|recodified|decodified|expired)\b", caption, re.I) and not text:
            status = re.search(r"\b(repealed|recodified|decodified|expired)\b", caption, re.I).group(1).lower()
        emergency = None
        out.append(model.rule(STATE, number=num, citation=f"WAC {num}", node_id=unit["id"], heading=caption, text=text,
                              source_url=f"{BASE}?cite={num}", raw_sha256=entry["sha256"], retrieved_at=entry["retrieved_at"],
                              agency=unit.get("agency"), history=history,
                              authority=_authority(latest), status=status, emergency=emergency,
                              effective_date=model.us_date(eff.group(1)) if eff else None,
                              register_citation=f"WSR {wsr.group(1)}" if wsr else None, edition=EDITION,
                              currency=_currency(d)))
    return out


def _authority(latest: str) -> str | None:
    m = re.search(r"Statutory Authority:\s*(.+?)\.\s+WSR", latest)
    return m.group(1).strip() if m else None


def _currency(d) -> str | None:
    for p in d.iter("p"):
        t = parsing.one_line(p.text_content()) or ""
        if t.startswith("Last update:"):
            return t
    return None


def rules(ctx, unit: dict) -> list[dict]:
    r, entry = ctx.get(f"{BASE}?cite={unit['num']}&full=true", f"rules/{unit['num']}.html")
    got = parse_chapter(r.body, r.final_url, unit, entry)
    ref = ctx.reference(entry, "html")
    for x in got:
        ctx.check(x, ref, "html.parser rendering of the full-chapter page")
    ctx.drop(entry)
    return got
