"""Ohio Administrative Code — Ohio Legislative Service Commission, codes.ohio.gov (HTML).

Index: /ohio-administrative-code lists agencies ("3745 | Environmental Protection Agency", sub-agencies "109:1"); each
agency page lists its chapters. A chapter page prints every rule of the chapter in full (heading, Effective, Promulgated
Under, authenticated PDF link, body, "Last updated ...", Supplemental Information), so one request per chapter carries
its rules. Rule citation form: "Ohio Adm.Code 3745-31-03".
"""
from __future__ import annotations

import re

import lib
import model
import parsing

STATE = "OH"
BASE = "https://codes.ohio.gov/ohio-administrative-code"
SAMPLE_UNITS = ["oh:chapter-3745-4", "oh:chapter-4901:1-10"]
EDITION = "codes.ohio.gov (Ohio Legislative Service Commission), rules published on their effective dates"


def _agency_key(href: str) -> str | None:
    m = re.search(r"/ohio-administrative-code/([0-9]{3,4}(?::[0-9]+)?)$", href)
    return m.group(1) if m else None


def index(ctx, limit_agencies: int | None = None) -> list[dict]:
    r, _e = ctx.get(BASE, "index/top.html")
    d = parsing.doc(r.body, r.final_url)
    nodes: list[dict] = []
    agencies = []
    for href, label in parsing.links(d, r"/ohio-administrative-code/[0-9]{3,4}(:[0-9]+)?$"):
        key = _agency_key(href)
        if not key:
            continue
        name = label.split("|", 1)[1].strip() if "|" in label else None
        agencies.append((key, href, name))
    for key, href, name in agencies[:limit_agencies]:
        a = model.node(STATE, f"agency-{key}", level="agency", num=key, heading=name, agency=name, source_url=href,
                       citation=f"Ohio Adm.Code {key}", ordinal=len(nodes))
        nodes.append(a)
        try:
            ra, _ = ctx.get(href, f"index/agency-{key.replace(':', '_')}.html")
        except Exception as err:
            ctx.failures.append({"unit": a["id"], "error": str(err)[:300]})
            continue
        da = parsing.doc(ra.body, ra.final_url)
        for ch_href, ch_label in parsing.links(da, r"/ohio-administrative-code/chapter-[0-9:.-]+$"):
            num = ch_href.rsplit("chapter-", 1)[1]
            heading = ch_label.split("|", 1)[1].strip() if "|" in ch_label else None
            nodes.append(model.node(STATE, f"chapter-{num}", level="chapter", num=num, heading=heading, agency=name,
                                    parent_id=a["id"], source_url=ch_href, citation=f"Ohio Adm.Code Chapter {num}",
                                    ordinal=len(nodes)))
    return nodes


def sample_index(ctx) -> list[dict]:
    """The two agencies of the sample chapters (3745 Environmental Protection Agency, 4901:1 PUCO) and their chapters."""
    out = []
    for key in ("3745", "4901:1"):
        href = f"{BASE}/{key}"
        ra, _ = ctx.get(href, f"index/agency-{key.replace(':', '_')}.html")
        da = parsing.doc(ra.body, ra.final_url)
        h1 = da.find(".//h1")
        name = parsing.one_line(h1.text_content()).split("|", 1)[-1].strip() if h1 is not None else None
        a = model.node(STATE, f"agency-{key}", level="agency", num=key, heading=name, agency=name, source_url=href,
                       citation=f"Ohio Adm.Code {key}", ordinal=len(out))
        out.append(a)
        for ch_href, ch_label in parsing.links(da, r"/ohio-administrative-code/chapter-[0-9:.-]+$"):
            num = ch_href.rsplit("chapter-", 1)[1]
            heading = ch_label.split("|", 1)[1].strip() if "|" in ch_label else None
            out.append(model.node(STATE, f"chapter-{num}", level="chapter", num=num, heading=heading, agency=name,
                                  parent_id=a["id"], source_url=ch_href, citation=f"Ohio Adm.Code Chapter {num}",
                                  ordinal=len(out)))
    return out


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "chapter"]


STATUS = re.compile(r"\b(rescinded|reserved|repealed|expired)\b", re.I)


def parse_chapter(html: bytes | str, url: str, unit: dict, entry: dict) -> list[dict]:
    d = parsing.doc(html, url)
    out = []
    for cell in d.find_class("name-cell"):
        a = cell.find(".//span[@class='content-head-text']/a")
        if a is None:
            continue
        head = parsing.one_line(a.text_content()) or ""
        m = re.match(r"Rule\s+([0-9:.-]+)\s*\|?\s*(.*)$", head)
        if not m:
            continue
        number, heading = m.group(1), (m.group(2) or None)
        info = {}
        for mod in cell.find_class("laws-section-info-module"):
            lab = mod.find_class("label")
            val = mod.find_class("value")
            if lab and val:
                info[parsing.one_line(lab[0].text_content()).rstrip(":")] = parsing.one_line(val[0].text_content())
        body = cell.find_class("laws-body")
        text = None
        currency = None
        if body:
            b = body[0]
            notice = b.find_class("laws-notice")
            currency = parsing.one_line(notice[0].text_content()) if notice else None
            text = parsing.text(b, skip_classes=("laws-notice",)) or None
        supp = cell.find_class("laws-additional-information")
        history = None
        authority = None
        if supp:
            parts = []
            for strong in supp[0].iter("strong"):
                lab = parsing.one_line(strong.text_content())
                sib = strong.getnext()
                val = parsing.one_line(sib.text_content()) if sib is not None and sib.tag == "span" else None
                if lab and val:
                    parts.append(f"{lab} {val}")
                    if lab.rstrip(":") == "Authorized By":
                        authority = val
            history = "\n".join(parts) or None
        st = STATUS.search(heading or "")
        status = st.group(1).lower() if st else "active"
        rule_url = parsing.absolute(url, a.get("href"))
        out.append(model.rule(STATE, number=number, citation=f"Ohio Adm.Code {number}", node_id=unit["id"], heading=heading,
                              text=text, source_url=rule_url, raw_sha256=entry["sha256"], retrieved_at=entry["retrieved_at"],
                              agency=unit.get("agency"), history=history, authority=authority or info.get("Promulgated Under"),
                              status=status, effective_date=model.us_date(info.get("Effective")), edition=EDITION,
                              currency=currency))
    return out


def rules(ctx, unit: dict) -> list[dict]:
    r, entry = ctx.get(unit["source_url"], f"rules/{unit['id'].split(':', 1)[1].replace(':', '_')}.html")
    got = parse_chapter(r.body, r.final_url, unit, entry)
    ref = ctx.reference(entry, "html")
    for x in got:
        ctx.check(x, ref, "html.parser rendering of the chapter page")
    ctx.drop(entry)
    return got


def unit(state: str, node_id: str) -> dict:
    num = node_id.split("chapter-", 1)[1]
    return model.node(STATE, f"chapter-{num}", level="chapter", num=num, heading=None, source_url=f"{BASE}/chapter-{num}",
                      citation=f"Ohio Adm.Code Chapter {num}")
