"""Minnesota Rules — Office of the Revisor of Statutes, www.revisor.mn.gov/rules (HTML).

Index: /rules/numerical/ lists every chapter with its title and agency (one request). Rules: /rules/<chapter>/full prints
every part of the chapter (headnote, subparts, Statutory Authority, History, Published Electronically). The History
note lists State Register citations oldest first ("8 SR 2275; ...; 46 SR 1209"); the last is the latest filing.
Citation form: "Minn. R. 7011.0010".
"""
from __future__ import annotations

import re

import model
import parsing

STATE = "MN"
BASE = "https://www.revisor.mn.gov/rules"
SAMPLE_UNITS = ["mn:1400", "mn:7011"]
EDITION = "Minnesota Rules as published by the Office of the Revisor of Statutes (revisor.mn.gov)"


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{BASE}/numerical/", "index/numerical.html")
    d = parsing.doc(r.body, r.final_url)
    nodes = []
    for tr in d.iter("tr"):
        tds = tr.findall("td")
        if len(tds) < 2:
            continue
        a = tds[0].find(".//a")
        if a is None:
            continue
        m = re.search(r"/rules/([0-9]{3,4}[A-Z]?)/?$", a.get("href") or "")
        if not m:
            continue
        ch = m.group(1)
        agency = parsing.one_line(tds[2].text_content()) if len(tds) > 2 else None
        nodes.append(model.node(STATE, ch, level="chapter", num=ch, heading=parsing.one_line(tds[1].text_content()),
                                agency=agency, source_url=f"{BASE}/{ch}/", citation=f"Minn. R. ch. {ch}",
                                ordinal=len(nodes)))
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "chapter"]


def unit(state: str, node_id: str) -> dict:
    ch = node_id.split(":", 1)[1]
    return model.node(STATE, ch, level="chapter", num=ch, heading=None, source_url=f"{BASE}/{ch}/", citation=f"Minn. R. ch. {ch}")


SR = re.compile(r"(\d+\s+SR\s+\d+)")


def parse_full(html: bytes | str, url: str, unit: dict, entry: dict) -> list[dict]:
    d = parsing.doc(html, url)
    agency_el = d.find_class("agency")
    agency = parsing.one_line(agency_el[0].text_content()) if agency_el else unit.get("agency")
    out = []
    for part in d.find_class("part"):
        pid = part.get("id") or ""
        m = re.fullmatch(r"rule\.([0-9]{4}\.[0-9]{4})", pid)
        if not m:
            continue
        number = m.group(1)
        h1 = part.find(".//h1")
        headnote = parsing.one_line(h1.text_content()) if h1 is not None else ""
        heading = headnote[len(number):].strip() if headnote.startswith(number) else headnote or None
        if h1 is not None:
            h1.drop_tree()
        text = parsing.text(part, skip_classes=("permalink",)) or None
        extra = {}
        sib = part.getnext()
        while sib is not None and "part" not in (sib.get("class") or "").split():
            cls = (sib.get("class") or "").split()
            for k in ("stat_auth", "history", "published"):
                if k in cls:
                    p = sib.find(".//p")
                    extra[k] = parsing.one_line(p.text_content()) if p is not None else None
            sib = sib.getnext()
        status = "active"
        sm = re.match(r"\[(Repealed|Renumbered|Expired|Obsolete)\b", (text or "").strip(), re.I)
        sm = sm if sm and len(text or "") < 300 else None
        if sm:
            status = sm.group(1).lower()
        hist = extra.get("history")
        regs = SR.findall(hist or "")
        out.append(model.rule(STATE, number=number, citation=f"Minn. R. {number}", node_id=unit["id"], heading=heading,
                              text=text, source_url=f"{BASE}/{number}/", raw_sha256=entry["sha256"],
                              retrieved_at=entry["retrieved_at"], agency=agency, history=hist, authority=extra.get("stat_auth"),
                              status=status, register_citation=regs[-1] if regs else None, edition=EDITION,
                              currency=f"Published Electronically: {extra['published']}" if extra.get("published") else None))
    return out


def rules(ctx, unit: dict) -> list[dict]:
    r, entry = ctx.get(f"{BASE}/{unit['num']}/full", f"rules/{unit['num']}.html")
    got = parse_full(r.body, r.final_url, unit, entry)
    ref = ctx.reference(entry, "html")
    for x in got:
        ctx.check(x, ref, "html.parser rendering of the full-chapter page")
    ctx.drop(entry)
    return got
