"""Michigan Administrative Code — Michigan Office of Administrative Hearings and Rules, ARS (ars.apps.lara.state.mi.us).

Index: AdminCode/AdminCode lists departments; AdminCode/GetBureausByDepartment (JSON) lists bureaus; posting the form
(Department, Bureau) returns the bureau's rule sets: title, first and last rule ("R 336.1101" .. "336.1128") and the
rule-set file, served as PDF or as HTML (DownloadAdminCodeFile?FileName=<file>&ReturnHTML=True). Rules: the HTML rendering
of the rule-set file prints, line by line, "R 336.1101 Purpose.", "Rule 1101. ...", "History: 1980 AACS; ...". The page
markers the publisher's rendering inserts ("Page N", "Courtesy of Michigan Administrative Rules") are not rule text.
Citation form: "Mich Admin Code, R 336.1101".
"""
from __future__ import annotations

import json
import re
import uuid
from urllib.parse import quote

import model
import parsing

STATE = "MI"
HOST = "https://ars.apps.lara.state.mi.us"
SAMPLE = [("Environment, Great Lakes and Energy", "Air Quality Division")]
SAMPLE_UNITS = ["mi:r-336.1101", "mi:r-336.201"]
EDITION = "Michigan Administrative Code as published by the Michigan Office of Administrative Hearings and Rules (ARS)"
MARKERS = re.compile(r"^(Page \d+|Courtesy of Michigan Administrative Rules)$")
RULE = re.compile(r"^R\s+(\d{2,3}\.\d{1,5}[a-z]?)\s*(.*)$")


def _post(ctx, dept: str, bureau: str):
    b = "----lsc" + uuid.uuid4().hex
    body = b""
    for k, v in (("Department", dept), ("Bureau", bureau), ("RuleNumber", ""), ("submit", "Search")):
        body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += f"--{b}--\r\n".encode()
    rel = "index/" + re.sub(r"[^A-Za-z0-9]+", "_", f"{dept}-{bureau}")[:90] + ".html"
    return ctx.get(f"{HOST}/AdminCode/AdminCode", rel, data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}"})


def _bureau(ctx, dept: str, bureau: str, parent: dict, nodes: list[dict]) -> None:
    r, _e = _post(ctx, dept, bureau)
    d = parsing.doc(r.body, r.final_url)
    bnode = model.node(STATE, "bureau-" + re.sub(r"[^a-z0-9]+", "-", f"{dept}-{bureau}".lower()).strip("-")[:80],
                       level="bureau", num=None, heading=bureau, agency=f"{dept}, {bureau}", parent_id=parent["id"],
                       source_url=f"{HOST}/AdminCode/AdminCode", ordinal=len(nodes))
    nodes.append(bnode)
    for tr in d.iter("tr"):
        tds = tr.findall("td")
        html = [a.get("href") for a in tr.iter("a") if "ReturnHTML=True" in (a.get("href") or "")]
        if len(tds) < 5 or not html:
            continue
        title = parsing.one_line(tds[0].text_content())
        start = parsing.one_line(tds[1].text_content()) or ""
        end = parsing.one_line(tds[3].text_content()) or ""
        m = re.match(r"R\s*(\d{2,3}\.\d{1,5}[a-z]?)", start)
        if not m:
            continue
        nodes.append(model.node(STATE, f"r-{m.group(1)}", level="rule set", num=f"R {m.group(1)} to R {end}", heading=title,
                                agency=f"{dept}, {bureau}", parent_id=bnode["id"], source_url=parsing.absolute(HOST, html[0]),
                                citation=f"Mich Admin Code, R {m.group(1)} to R {end}", ordinal=len(nodes)))


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{HOST}/AdminCode/AdminCode", "index/top.html")
    d = parsing.doc(r.body, r.final_url)
    depts = [o.get("value") for o in d.iter("option") if o.get("value") and o.get("value") != "Select Department"]
    nodes: list[dict] = []
    for dept in dict.fromkeys(depts):
        dn = model.node(STATE, "dept-" + re.sub(r"[^a-z0-9]+", "-", dept.lower()).strip("-"), level="department", num=None,
                        heading=dept, agency=dept, source_url=f"{HOST}/AdminCode/AdminCode", ordinal=len(nodes))
        nodes.append(dn)
        try:
            rb, _ = ctx.get(f"{HOST}/AdminCode/GetBureausByDepartment?Department={quote(dept)}",
                            "index/bureaus-" + re.sub(r"[^A-Za-z0-9]+", "_", dept) + ".json")
            bureaus = [b["Value"] for b in json.loads(rb.body) if b.get("Value") and b["Value"] != "All"]
        except Exception as err:
            ctx.failures.append({"unit": dn["id"], "error": str(err)[:300]})
            continue
        for bureau in bureaus:
            try:
                _bureau(ctx, dept, bureau, dn, nodes)
            except Exception as err:
                ctx.failures.append({"unit": f"{dept} / {bureau}", "error": str(err)[:300]})
    return nodes


def sample_index(ctx) -> list[dict]:
    nodes: list[dict] = []
    for dept, bureau in SAMPLE:
        dn = model.node(STATE, "dept-" + re.sub(r"[^a-z0-9]+", "-", dept.lower()).strip("-"), level="department", num=None,
                        heading=dept, agency=dept, source_url=f"{HOST}/AdminCode/AdminCode", ordinal=len(nodes))
        nodes.append(dn)
        _bureau(ctx, dept, bureau, dn, nodes)
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "rule set"]


def parse_set(html: bytes | str, url: str, unit: dict, entry: dict) -> list[dict]:
    d = parsing.doc(html, url)
    lines = [ln for ln in parsing.text(d.find("body") if d.find("body") is not None else d).split("\n") if not MARKERS.match(ln)]
    out = []
    cur = None

    def flush():
        if not cur:
            return
        body, hist = [], []
        state = "body"
        for ln in cur["lines"]:
            if state == "body" and ln.startswith("History:"):
                state = "hist"
            if state == "body":
                body.append(ln)
            elif state == "hist":
                if hist and not re.search(r"AACS|Eff\.|^[0-9;,. ]+$|^\d{4}", ln):
                    state = "after"  # a structural heading (PART ..., SUBPART ...) after the history note
                    continue
                hist.append(ln)
        num = cur["num"]
        heading = cur["heading"] or None
        status = "active"
        text = "\n".join(body) or None
        if heading and re.search(r"\b(rescinded|repealed|reserved)\b", heading, re.I) and (not text or len(text) < 80):
            status = re.search(r"\b(rescinded|repealed|reserved)\b", heading, re.I).group(1).lower()
        out.append(model.rule(STATE, number=f"R {num}", citation=f"Mich Admin Code, R {num}", node_id=unit["id"],
                              heading=heading, text=text, source_url=url, raw_sha256=entry["sha256"],
                              retrieved_at=entry["retrieved_at"], agency=unit.get("agency"), history="\n".join(hist) or None,
                              status=status, edition=EDITION))

    for ln in lines:
        m = RULE.match(ln)
        if m:
            flush()
            cur = {"num": m.group(1), "heading": m.group(2).strip(), "lines": []}
        elif cur is not None:
            cur["lines"].append(ln)
    flush()
    return out


def rules(ctx, unit: dict) -> list[dict]:
    r, entry = ctx.get(unit["source_url"], "rules/" + unit["id"].split(":", 1)[1] + ".html")
    got = parse_set(r.body, r.final_url, unit, entry)
    ref = ctx.reference(entry, "html")
    for x in got:
        ctx.check(x, ref, "html.parser rendering of the rule-set file (publisher's HTML rendering of the PDF)")
    ctx.drop(entry)
    return got
