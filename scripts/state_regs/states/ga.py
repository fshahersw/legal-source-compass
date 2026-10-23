"""Rules and Regulations of the State of Georgia — Secretary of State (rules.sos.ga.gov). INDEX ONLY.

The site is on the state's domain but is operated by a commercial vendor that claims copyright in the published text
("Copyright (c) 2026 Fastcase, Inc - All rights reserved" on every page). Rule text is therefore not copied. The index
records the department, chapter and subject numbers with their captions as the table of contents prints them, and the
official address of each. Pages: /gac/ (departments), /gac/<dept> (chapters: "Chapter 40-7. ..."), /gac/<chapter>
(subjects: "Subject 40-7-1. RETAIL FOOD SALES"). Subject pages (which print the rule text) are not fetched.
"""
from __future__ import annotations

import re

import model
import parsing

STATE = "GA"
HOST = "https://rules.sos.ga.gov"
SAMPLE_DEPTS = ["40"]
SAMPLE_UNITS: list[str] = []


def _dept(ctx, dnum: str, caption: str | None, nodes: list[dict]) -> None:
    url = f"{HOST}/gac/{dnum}"
    dn = model.node(STATE, dnum, level="department", num=dnum, heading=caption, agency=caption, source_url=url,
                    citation=f"Ga. Comp. R. & Regs. Department {dnum}", ordinal=len(nodes))
    nodes.append(dn)
    r, _e = ctx.get(url, f"index/dept-{dnum}.html")
    d = parsing.doc(r.body, r.final_url)
    chapters = []
    for href, text in parsing.links(d, rf"/gac/{re.escape(dnum)}-[0-9]+$"):
        m = re.match(rf"Chapter\s+({re.escape(dnum)}-[0-9]+)\.?\s*(.*)$", text)
        if m and m.group(1) not in [c[0] for c in chapters]:
            chapters.append((m.group(1), m.group(2) or None))
    for cnum, ccap in chapters:
        curl = f"{HOST}/gac/{cnum}"
        cn = model.node(STATE, cnum, level="chapter", num=cnum, heading=ccap, agency=caption, parent_id=dn["id"],
                        source_url=curl, citation=f"Ga. Comp. R. & Regs. Chapter {cnum}", ordinal=len(nodes))
        nodes.append(cn)
        try:
            rc, _ = ctx.get(curl, f"index/chapter-{cnum}.html")
        except Exception as err:
            ctx.failures.append({"unit": cn["id"], "error": str(err)[:300]})
            continue
        dc = parsing.doc(rc.body, rc.final_url)
        for href, text in parsing.links(dc, rf"/gac/{re.escape(cnum)}-[0-9]+$"):
            m = re.match(rf"Subject\s+({re.escape(cnum)}-[0-9]+)\.?\s*(.*)$", text)
            if not m:
                continue
            snum = m.group(1)
            cap = m.group(2) or None
            nodes.append(model.node(STATE, snum, level="subject", num=snum, heading=cap, agency=caption, parent_id=cn["id"],
                                    source_url=f"{HOST}/gac/{snum}", citation=f"Ga. Comp. R. & Regs. Subject {snum}",
                                    ordinal=len(nodes)))


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{HOST}/gac/", "index/top.html")
    d = parsing.doc(r.body, r.final_url)
    nodes: list[dict] = []
    for href, text in parsing.links(d, r"/gac/[0-9]+$"):
        m = re.match(r"Department\s+([0-9]+)\.?\s*(.*)$", text)
        if not m:
            continue
        try:
            _dept(ctx, m.group(1), m.group(2) or None, nodes)
        except Exception as err:
            ctx.failures.append({"unit": f"department {m.group(1)}", "error": str(err)[:300]})
    return nodes


def sample_index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{HOST}/gac/", "index/top.html")
    d = parsing.doc(r.body, r.final_url)
    caps = {}
    for href, text in parsing.links(d, r"/gac/[0-9]+$"):
        m = re.match(r"Department\s+([0-9]+)\.?\s*(.*)$", text)
        if m:
            caps[m.group(1)] = m.group(2) or None
    nodes: list[dict] = []
    for dnum in SAMPLE_DEPTS:
        _dept(ctx, dnum, caps.get(dnum), nodes)
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return []  # index only: no rule text is acquired


def rules(ctx, unit: dict) -> list[dict]:
    return []
