"""Maryland — General Assembly (mgaleg.maryland.gov) Annotated Code statute text, "in effect as of October 1st".

/mgawebsite/api/Laws/GetArticles?enactments=true and /api/Laws/GetSections?articleCode=<a>&enactments=true list the
articles and sections; /mgawebsite/Laws/StatuteText?article=<a>&section=<s>&enactments=true prints one section in
#StatuteText: "Article - <name>", "§5–101.", then the text. No catchlines are printed; the hierarchy is article >
title (the number before the dash, as the publisher numbers sections). No robots.txt (404); 1 request/second.
The article PDFs (Statute_Web/<a>/<a>.pdf) carry the same text with hard line wraps and are not used.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "mgaleg.maryland.gov"
BASE = f"https://{HOST}/mgawebsite"
LANDING = BASE + "/Laws/Statutes"
MD = r"(?:md\.?\s?code(?:\s?ann\.?)?,?\s?|md\.?\s?)?"

# code key, Bluebook abbreviation (after "Md. Code Ann., "), aliases
ARTICLES = {
    "GAG": ("Agriculture", "Agric.", ["Agriculture", "AG"]),
    "GAB": ("Alcoholic Beverages and Cannabis", "Alc. Bev. & Cannabis", ["Alcoholic Beverages and Cannabis", "Alc. Bev.", "AB"]),
    "GBO": ("Business Occupations and Professions", "Bus. Occ. & Prof.", ["Business Occupations and Professions", "BOP"]),
    "GBR": ("Business Regulation", "Bus. Reg.", ["Business Regulation", "BR"]),
    "GCL": ("Commercial Law", "Com. Law", ["Commercial Law", "CL"]),
    "GCA": ("Corporations and Associations", "Corps. & Ass'ns", ["Corporations and Associations", "CA"]),
    "GCS": ("Correctional Services", "Corr. Servs.", ["Correctional Services", "CS"]),
    "GCJ": ("Courts and Judicial Proceedings", "Cts. & Jud. Proc.", ["Courts and Judicial Proceedings", "Courts & Jud. Proc.", "CJP", "CJ"]),
    "GCR": ("Criminal Law", "Crim. Law", ["Criminal Law", "CR"]),
    "GCP": ("Criminal Procedure", "Crim. Proc.", ["Criminal Procedure", "CP"]),
    "GEC": ("Economic Development", "Econ. Dev.", ["Economic Development", "EC"]),
    "GED": ("Education", "Educ.", ["Education", "ED"]),
    "GEL": ("Election Law", "Elec. Law", ["Election Law", "EL"]),
    "GEN": ("Environment", "Env't", ["Environment", "Envir.", "EN"]),
    "GET": ("Estates and Trusts", "Est. & Trusts", ["Estates and Trusts", "ET"]),
    "GFL": ("Family Law", "Fam. Law", ["Family Law", "FL"]),
    "GFI": ("Financial Institutions", "Fin. Inst.", ["Financial Institutions", "FI"]),
    "GGP": ("General Provisions", "Gen. Provis.", ["General Provisions", "GP"]),
    "GHG": ("Health - General", "Health-Gen.", ["Health - General", "Health General", "Health-General", "HG"]),
    "GHO": ("Health Occupations", "Health Occ.", ["Health Occupations", "HO"]),
    "GHS": ("Housing and Community Development", "Hous. & Cmty. Dev.", ["Housing and Community Development", "HCD"]),
    "GHU": ("Human Services", "Hum. Servs.", ["Human Services", "HS"]),
    "GIN": ("Insurance", "Ins.", ["Insurance", "IN"]),
    "GLE": ("Labor and Employment", "Lab. & Empl.", ["Labor and Employment", "LE"]),
    "GLU": ("Land Use", "Land Use", ["LU"]),
    "GLG": ("Local Government", "Local Gov't", ["Local Government", "LG"]),
    "GNR": ("Natural Resources", "Nat. Res.", ["Natural Resources", "NR"]),
    "GPS": ("Public Safety", "Pub. Safety", ["Public Safety", "PS"]),
    "GPU": ("Public Utilities", "Pub. Util.", ["Public Utilities", "PUA", "PU"]),
    "GRP": ("Real Property", "Real Prop.", ["Real Property", "RP"]),
    "GSF": ("State Finance and Procurement", "State Fin. & Proc.", ["State Finance and Procurement", "SFP"]),
    "GSG": ("State Government", "State Gov't", ["State Government", "SG"]),
    "GSP": ("State Personnel and Pensions", "State Pers. & Pens.", ["State Personnel and Pensions", "SPP"]),
    "GTG": ("Tax - General", "Tax-Gen.", ["Tax - General", "Tax General", "Tax-General", "TG"]),
    "GTP": ("Tax - Property", "Tax-Prop.", ["Tax - Property", "Tax Property", "Tax-Property", "TP"]),
    "GTR": ("Transportation", "Transp.", ["Transportation", "TR"]),
}

META = lib.StateMeta(
    state="MD",
    code_name="Annotated Code of Maryland",
    publisher="General Assembly of Maryland — Department of Legislative Services (mgaleg.maryland.gov)",
    publisher_url=LANDING,
    official_source=True,
    access="html",
    hosts=(HOST,),
    parser="md-mgaleg-statutetext/1",
    min_interval_s=1.0,
    codes=tuple(
        lib.Code(key, f"{name} Article", f"Md. Code Ann., {abbr} § {{n}}",
                 lib.alias_patterns(aliases + [abbr], prefix=MD))
        for key, (name, abbr, aliases) in ARTICLES.items()
    ),
    terms_note="Statute text published by the Department of Legislative Services; no robots.txt on the host.",
    update_cadence="Statutes in effect as of October 1 (enactments=true); refresh each October and after special sessions.",
)

# the number ends at the first period followed by a space or the line end ("§2–103.1." is 2–103.1, not 2–103)
MARK_RE = re.compile(r"^§\s*([0-9][0-9A-Za-z.–\-]*?)\.(?:\s+(.*))?$")


def parse_section(page: lib.Fetched) -> tuple[str, str]:
    root = lxml_html.document_fromstring(page.body)
    box = root.get_element_by_id("StatuteText")
    for button in list(box.iter("button")):
        button.drop_tree()
    lines = lib.html_text(lxml_html.tostring(box, encoding="unicode")).split("\n")
    for i, line in enumerate(lines):
        match = MARK_RE.match(line)
        if match:
            body = ([match.group(2)] if match.group(2) else []) + [l for l in lines[i + 1:] if l not in ("Previous", "Next")]
            return match.group(1), "\n".join(body)
    raise RuntimeError(f"no § marker in {page.url}")


SAMPLE = {"GCJ": re.compile(r"^5-1\d\d$")}


def acquire(ctx: lib.RunContext) -> None:
    landing = ctx.fetch(LANDING)
    option = re.search(r"Yes \(Show statutes in effect as of October 1st of this year\)", lib.html_text(landing.body))
    ctx.edition(edition_label=None, currency_statement=option.group(0) if option else None, currency_source_url=LANDING)
    for key, (name, _abbr, _aliases) in ARTICLES.items():
        if ctx.sample is not None and key not in SAMPLE:
            continue
        if not ctx.want_more():
            break
        listing = ctx.fetch(f"{BASE}/api/Laws/GetSections?articleCode={key.lower()}&enactments=true",
                            method="publisher_api", headers={"Accept": "application/json"})
        sections = [s["DisplayText"] for s in json.loads(listing.body)]
        if ctx.sample is not None:
            sections = [s for s in sections if SAMPLE[key].match(s.replace("–", "-"))]
        for display in sections:
            if not ctx.want_more():
                break
            page = ctx.fetch(f"{BASE}/Laws/StatuteText?article={key.lower()}&section={urllib.parse.quote(display, safe='')}&enactments=true")
            printed, text = parse_section(page)
            number = printed.replace("–", "-")
            if number != display.replace("–", "-"):
                raise RuntimeError(f"{key} {display}: page prints § {printed}")
            title = number.split("-", 1)[0]
            path = [{"level": "title", "label": "Title", "number": title, "heading": None}]
            heading = None
            status, marker = lib.classify_status(None, text)
            ctx.section(code=key, number=number, heading=heading, text=text if not status else ("" if len(text) < 120 else text),
                        source=page, path=path, status=status, status_marker=marker)
