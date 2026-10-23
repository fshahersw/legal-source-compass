"""Code of Colorado Regulations — Colorado Secretary of State (www.sos.state.co.us/CCR).

Index: CCR/NumericalDeptList.do lists departments and their agencies (NumericalCCRDocList.do?deptID=..&agencyID=..);
an agency list gives its rule sets ("5 CCR 1001-3" and title). Rules: the unit is the rule set, the unit the CCR cites
("5 CCR 1001-3"). Its page (DisplayRule.do?action=ruleinfo) prints, for the current version, the effective date, the
filing type (Permanent Rule / Emergency Rule / ...), the adopted date and the Colorado Register publication; the text
is the official PDF (GenerateRulePdf.do?ruleVersionId=..; "The PDF document constitutes the official version of the
rule"). Text is extracted with pdftotext and checked against pypdf's extraction of the same bytes.
Citation form: "5 CCR 1001-3".
"""
from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
from urllib.parse import parse_qs, quote, urlparse

import lib
import model
import parsing

STATE = "CO"
HOST = "https://www.sos.state.co.us"
SAMPLE_AGENCIES = [("16", "1000 Public Health and Environment", "7", "1001 Air Quality Control Commission")]
SAMPLE_UNITS = ["co:5-1001-1", "co:5-1001-2"]
EDITION = "Code of Colorado Regulations, official PDF of the current version (Colorado Secretary of State)"


def _q(url: str) -> str:
    return quote(url, safe=":/?&=%")


def _agency(ctx, dept_id: str, dept_name: str, agency_id: str, agency_name: str, parent: dict | None, nodes: list[dict]) -> None:
    url = _q(f"{HOST}/CCR/NumericalCCRDocList.do?deptID={dept_id}&deptName={dept_name}&agencyID={agency_id}&agencyName={agency_name}")
    r, _e = ctx.get(url, f"index/agency-{dept_id}-{agency_id}.html")
    d = parsing.doc(r.body, r.final_url)
    ag_name = re.sub(r"^\d+\s+", "", agency_name)
    an = model.node(STATE, f"agency-{dept_id}-{agency_id}", level="agency", num=agency_name.split(" ", 1)[0], heading=ag_name,
                    agency=ag_name, parent_id=parent["id"] if parent else None, source_url=url, ordinal=len(nodes))
    nodes.append(an)
    seen = set()
    for tr in d.iter("tr"):
        a = [x for x in tr.iter("a") if "DisplayRule.do" in (x.get("href") or "") and "ruleinfo" in (x.get("href") or "")]
        if not a:
            continue
        href = a[0].get("href")
        series = (parse_qs(urlparse(href).query).get("seriesNum") or [""])[0].strip()
        m = re.fullmatch(r"(\d{1,2}) CCR (\d{3,4}-\d{1,3})", series)
        if not m or series in seen:
            continue
        seen.add(series)
        tds = tr.findall("td")
        title = parsing.one_line(tds[-1].text_content()) if len(tds) > 1 else None
        nodes.append(model.node(STATE, f"{m.group(1)}-{m.group(2)}", level="rule set", num=series, heading=title, agency=ag_name,
                                parent_id=an["id"], source_url=_q(href), citation=series, ordinal=len(nodes)))


def index(ctx) -> list[dict]:
    r, _e = ctx.get(f"{HOST}/CCR/NumericalDeptList.do", "index/depts.html")
    d = parsing.doc(r.body, r.final_url)
    nodes: list[dict] = []
    depts: dict[str, dict] = {}
    seen_agencies: set[tuple[str, str]] = set()
    for a in d.iter("a"):
        h = a.get("href") or ""
        if "NumericalCCRDocList.do" not in h:
            continue
        q = parse_qs(urlparse(h).query)
        did, dname = (q.get("deptID") or [""])[0], (q.get("deptName") or [""])[0]
        aid, aname = (q.get("agencyID") or [""])[0], (q.get("agencyName") or [""])[0]
        if not (did and aid) or (did, aid) in seen_agencies:
            continue  # the department list links each agency more than once
        seen_agencies.add((did, aid))
        if did not in depts:
            depts[did] = model.node(STATE, f"dept-{did}", level="department", num=dname.split(" ", 1)[0], heading=re.sub(r"^[\d,]+\s+", "", dname),
                                    agency=re.sub(r"^[\d,]+\s+", "", dname), source_url=f"{HOST}/CCR/NumericalDeptList.do", ordinal=len(nodes))
            nodes.append(depts[did])
        try:
            _agency(ctx, did, dname, aid, aname, depts[did], nodes)
        except Exception as err:
            ctx.failures.append({"unit": f"agency {did}/{aid}", "error": str(err)[:300]})
    return nodes


def sample_index(ctx) -> list[dict]:
    nodes: list[dict] = []
    for did, dname, aid, aname in SAMPLE_AGENCIES:
        _agency(ctx, did, dname, aid, aname, None, nodes)
    return nodes


def units(nodes: list[dict]) -> list[dict]:
    return [n for n in nodes if n["level"] == "rule set"]


def current_version(html: bytes | str, url: str) -> dict:
    """The current version's row of the rule set page: ruleVersionId, effective/adopted dates, filing type, register."""
    d = parsing.doc(html, url)
    out: dict = {}
    links = [x for x in d.iter("a") if "OpenRuleWindow" in (x.get("onclick") or "")]
    for link in links[:1]:  # the first PDF link is the current version (the archived table follows)
        tr = next((p for p in link.iterancestors() if p.tag == "tr"), None)
        if tr is None:
            break
        a = [link]
        m = re.search(r"OpenRuleWindow\('(\d+)',\s*'([^']+)'", a[0].get("onclick"))
        tds = [parsing.one_line(td.text_content()) or "" for td in tr.findall("td")]
        reg = [x for x in tr.iter("a") if "RegisterContents.do" in (x.get("href") or "")]
        out = {"version_id": m.group(1), "file": m.group(2), "effective": re.sub(r"\s*\(PDF\)$", "", tds[0]),
               "filing_type": tds[1] if len(tds) > 1 else None, "adopted": tds[2] if len(tds) > 2 else None, "register": None}
        if reg:
            q = parse_qs(urlparse(reg[0].get("href")).query)
            vol, num = (q.get("Volume") or [None])[0], (q.get("yearPublishNumber") or [None])[0]
            out["register"] = f"{vol} CR {num} ({parsing.one_line(reg[0].text_content())})" if vol and num else parsing.one_line(reg[0].text_content())
    return out


def pdf_lines(raw: bytes) -> str:
    exe = shutil.which("pdftotext")
    if not exe:
        raise RuntimeError("pdftotext is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        src = f"{tmp}/in.pdf"
        with open(src, "wb") as h:
            h.write(raw)
        out = subprocess.run([exe, "-layout", "-enc", "UTF-8", src, "-"], capture_output=True, timeout=600, check=True)
    lines = [" ".join(x.replace("\xa0", " ").split()) for x in out.stdout.decode("utf-8", "replace").replace("\f", "\n").split("\n")]
    lines = [x for x in lines if x]
    while lines and _banner(lines[0]):  # the rotated banner opens page 1; nothing else is dropped
        lines.pop(0)
    return "\n".join(lines)


# Page 1 of every rule-set PDF carries a rotated side banner ("Code of Colorado Regulations", "Secretary of State",
# "State of Colorado"); text extraction returns it as word fragments ("CodeofCol", "oradoRegul", "ati", "e", "St") at the
# very start of the text. Only that leading run is page furniture: a later line such as "Regulations" is rule text.
BANNERS = ("codeofcoloradoregulations", "secretaryofstate", "stateofcolorado")


def _banner(line: str) -> bool:
    s = re.sub(r"\s+", "", line).lower()
    return 1 <= len(s) <= 25 and s.isalpha() and any(s in b for b in BANNERS)


def pypdf_reference(raw: bytes) -> str:
    from pypdf import PdfReader

    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)


def rules(ctx, unit: dict) -> list[dict]:
    r, page = ctx.get(unit["source_url"], f"rules/{unit['num'].replace(' ', '_')}.html")
    cur = current_version(r.body, r.final_url)
    if not cur.get("version_id"):
        ctx.drop(page)
        return []
    pdf_url = _q(f"{HOST}/CCR/GenerateRulePdf.do?ruleVersionId={cur['version_id']}&fileName={cur['file']}")
    rp, pentry = ctx.get(pdf_url, f"rules/{unit['num'].replace(' ', '_')}.pdf")
    text = pdf_lines(rp.body)
    filing = (cur.get("filing_type") or "").lower()
    emergency = True if "emergency" in filing else (False if "permanent" in filing else None)
    x = model.rule(STATE, number=unit["num"], citation=unit["num"], node_id=unit["id"], heading=unit.get("heading"), text=text,
                   source_url=unit["source_url"], raw_sha256=pentry["sha256"], retrieved_at=pentry["retrieved_at"],
                   agency=unit.get("agency"), history=None, status="active", emergency=emergency,
                   effective_date=model.us_date(cur.get("effective")), adopted_date=model.us_date(cur.get("adopted")),
                   register_citation=cur.get("register"), edition=EDITION,
                   currency=f"Current version: {cur.get('filing_type') or 'filing type not recorded'}, effective {cur.get('effective') or 'not recorded'}")
    ref = lib.squash(pypdf_reference(rp.body))  # a different extraction engine than the pdftotext text
    ctx.check(x, ref, "pypdf extraction of the same PDF, lines compared without order (text: pdftotext -layout)", ordered=False)
    x["text_check"]["heading"] = "not_checked"  # the heading comes from the agency list, not the PDF
    ctx.drop(pentry)
    ctx.drop(page)
    return [x]
