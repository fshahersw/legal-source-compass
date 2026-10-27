"""New York — Consolidated Laws, NY State Senate OpenLegislation pages (www.nysenate.gov/legislation/laws).

Publisher: the New York State Senate's OpenLegislation service, which prints the Consolidated Laws one page per law,
container (article, title, part ...) and section: `https://www.nysenate.gov/legislation/laws/<LAW>[/<node>]`, starting
at the index `.../laws/CONSOLIDATED`.

Access (re-read 2026-10-23): direct requests to www.nysenate.gov get a Cloudflare challenge (HTTP 403), the
OpenLegislation API answers 401 without a key (none provisioned), and the Legislative Retrieval System's robots.txt reads
`Disallow: /`. This module therefore NEVER fetches live (a run without retained originals is Blocked). It re-parses the
project's retained captures of these pages: 41,517 nysenate.gov URLs taken 2026-10-06/07 through a third-party fetch
proxy (Firecrawl, retrieval_method `proxied_fetch`, maxAge 0), content-addressed and sha256-checked in private Storage,
which the owner accepted on 2026-10-07 (scripts/legal/state-codes/ny/capture.py), as for Pennsylvania. Release
2026-10-27 (owner decision "dont withhold any data. If its accurate and valuable, USE IT"): the capture is the official
publisher's own pages (the 2026-10-08 review compared 20/20 sections with the live site), so it is loaded, labelled
"captured via fetch proxy from nysenate.gov" in the edition's terms note and load note.

Parsing (`ny-openleg-html/3`, same markup as scripts/legal/state-codes/ny/parse.py v2): each page prints its own table of
contents (`ul.nys-openleg-items-container > li.nys-openleg-result-item-container > a`, "SECTION 2-A ...", "ARTICLE 2
...", "RULE 3211 ..."); the module walks it depth-first from the CONSOLIDATED index, in printed order. A SECTION or RULE
page (`.nys-openleg-result-title-headline`) prints its catchline (`.nys-openleg-result-title-short`) and its text in
one `.nys-openleg-result-text` block (`<br>` = line break); the leading "§ 101. Short title." (or "Rule 3211. ...")
is the number and catchline and is not kept in `text`. Container pages give the path (level = the printed word:
ARTICLE -> article, TITLE -> title, PART -> part ...; any other word -> other with its printed label). Container pages
are never sections (the 1,358 title-level rows the older parser v1 produced stay out). Each page's
"Viewing most recent revision (from YYYY-MM-DD)" line is the publisher's revision stamp, not an effective date, and is
not stored as one. A printed SECTION/RULE entry whose page is not in the capture, or prints no text, is ledgered in
rejects.jsonl.gz ("unavailable: ..."), never dropped silently; load.py then needs --accept-rejects naming the gap.
"""
from __future__ import annotations

import re
import sys
import urllib.parse
from pathlib import Path

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

HOST = "www.nysenate.gov"
BASE = f"https://{HOST}"
LAWS = BASE + "/legislation/laws/"
INDEX = LAWS + "CONSOLIDATED"
UNCACHED = "?view=all"
PARSER = "ny-openleg-html/3"
NODE_URL = re.compile(r"^https://www\.nysenate\.gov/legislation/laws/([A-Z][A-Z0-9]{1,6})(?:/([^/?#]+))?$")
LEAF_TYPES = ("SECTION", "RULE")
NOT_FOUND = "The requested entry could not be found."
PROXY_LABEL = "captured via fetch proxy from nysenate.gov"
# "§ 101. Short title. …", "§§ 5-a. …", "Rule 3211. Motion to dismiss. …", "Section 2. …"
PREFIX_RE = re.compile(r"^(?:§+|Rule|Section)\s*([0-9A-Za-z][0-9A-Za-z.*\-]*?)\.(?=\s|$)\s*")
LEVEL_WORDS = {"TITLE": "title", "SUBTITLE": "subtitle", "DIVISION": "division", "SUBDIVISION": "subdivision",
               "PART": "part", "SUBPART": "subpart", "CHAPTER": "chapter", "SUBCHAPTER": "subchapter",
               "ARTICLE": "article", "SUBARTICLE": "subarticle", "APPENDIX": "appendix"}

# law id (the publisher's own key, used in its URLs) -> (name as the CONSOLIDATED index prints it, citation template,
# common abbreviations people cite it by). Names and ids: the 2026-10-06/07 capture (93 laws).
_NY = r"(?:n\.?\s?y\.?\s?)?"
LAWS_TABLE: dict[str, tuple[str, str, list[str]]] = {
    "ABC": ("Alcoholic Beverage Control", "", ["Alco. Bev. Cont. Law", "ABC Law"]),
    "ABP": ("Abandoned Property", "", ["Aband. Prop. Law"]),
    "ACA": ("Arts and Cultural Affairs", "", ["Arts & Cult. Aff. Law"]),
    "ACG": ("Alternative County Government", "", ["Alt. County Gov't Law"]),
    "AGM": ("Agriculture & Markets", "", ["Agric. & Mkts. Law", "Agriculture and Markets Law"]),
    "BNK": ("Banking", "", ["Banking Law"]),
    "BSC": ("Business Corporation", "", ["Bus. Corp. Law", "BCL"]),
    "BVO": ("Benevolent Orders", "", ["Benev. Orders Law"]),
    "CAL": ("Canal", "", ["Canal Law"]),
    "CAN": ("Cannabis", "", ["Cannabis Law"]),
    "CCO": ("Cooperative Corporations", "", ["Coop. Corp. Law"]),
    "CNT": ("County", "", ["County Law"]),
    "COM": ("Economic Development Law", "", ["Econ. Dev. Law"]),
    "COR": ("Correction", "", ["Correct. Law", "Correction Law"]),
    "CPL": ("Criminal Procedure", "", ["Crim. Proc. Law", "CPL"]),
    "CVP": ("Civil Practice Law & Rules", "N.Y. C.P.L.R. {n}",
            ["C.P.L.R.", "CPLR", "Civ. Prac. L. & R.", "Civil Practice Law and Rules", "C.P.L.R. Rule", "CPLR Rule"]),
    "CVR": ("Civil Rights", "", ["Civ. Rights Law"]),
    "CVS": ("Civil Service", "", ["Civ. Serv. Law"]),
    "DCD": ("Debtor & Creditor", "", ["Debt. & Cred. Law", "Debtor and Creditor Law"]),
    "DOM": ("Domestic Relations", "", ["Dom. Rel. Law", "DRL"]),
    "EDN": ("Education", "", ["Educ. Law"]),
    "EDP": ("Eminent Domain Procedure", "", ["Em. Dom. Proc. Law", "EDPL"]),
    "ELD": ("Elder", "", ["Elder Law"]),
    "ELN": ("Election", "", ["Elec. Law"]),
    "EML": ("Employers' Liability", "", ["Empl'rs Liab. Law"]),
    "ENG": ("Energy", "", ["Energy Law"]),
    "ENV": ("Environmental Conservation", "", ["Envtl. Conserv. Law", "ECL"]),
    "EPT": ("Estates, Powers & Trusts", "", ["Est. Powers & Trusts Law", "EPTL", "Estates, Powers and Trusts Law"]),
    "EXC": ("Executive", "", ["Exec. Law"]),
    "FIS": ("Financial Services Law", "", ["Fin. Serv. Law"]),
    "GAS": ("General Associations", "", ["Gen. Ass'ns Law"]),
    "GBS": ("General Business", "", ["Gen. Bus. Law", "GBL"]),
    "GCN": ("General Construction", "", ["Gen. Constr. Law"]),
    "GCT": ("General City", "", ["Gen. City Law"]),
    "GMU": ("General Municipal", "", ["Gen. Mun. Law", "GML"]),
    "GOB": ("General Obligations", "", ["Gen. Oblig. Law", "GOL"]),
    "HAY": ("Highway", "", ["High. Law"]),
    "IND": ("Indian", "", ["Indian Law"]),
    "ISC": ("Insurance", "", ["Ins. Law"]),
    "JUD": ("Judiciary", "", ["Jud. Law"]),
    "LAB": ("Labor", "", ["Lab. Law"]),
    "LEG": ("Legislative", "", ["Legis. Law"]),
    "LFN": ("Local Finance", "", ["Local Fin. Law"]),
    "LIE": ("Lien", "", ["Lien Law"]),
    "LLC": ("Limited Liability Company Law", "", ["Ltd. Liab. Co. Law"]),
    "MDW": ("Multiple Dwelling", "", ["Mult. Dwell. Law"]),
    "MHA": ("Municipal Housing Authorities", "", ["Mun. Hous. Auth. Law"]),
    "MHR": ("Municipal Home Rule", "", ["Mun. Home Rule Law"]),
    "MHY": ("Mental Hygiene", "", ["Mental Hyg. Law", "MHL"]),
    "MIL": ("Military", "", ["Mil. Law"]),
    "MRE": ("Multiple Residence", "", ["Mult. Resid. Law"]),
    "NAV": ("Navigation", "", ["Nav. Law"]),
    "NPC": ("Not-for-Profit Corporation", "", ["Not-for-Profit Corp. Law", "N-PCL"]),
    "PAR": ("Parks, Recreation and Historic Preservation", "", ["Parks Rec. & Hist. Preserv. Law"]),
    "PBA": ("Public Authorities", "", ["Pub. Auth. Law"]),
    "PBB": ("Public Buildings", "", ["Pub. Bldgs. Law"]),
    "PBG": ("Public Housing", "", ["Pub. Hous. Law"]),
    "PBH": ("Public Health", "", ["Pub. Health Law", "PHL"]),
    "PBL": ("Public Lands", "", ["Pub. Lands Law"]),
    "PBO": ("Public Officers", "", ["Pub. Off. Law"]),
    "PBS": ("Public Service", "", ["Pub. Serv. Law"]),
    "PEN": ("Penal", "", ["Penal Law"]),
    "PEP": ("Personal Property", "", ["Pers. Prop. Law"]),
    "PML": ("Racing, Pari-Mutuel Wagering and Breeding Law", "", ["Rac. Pari-Mut. Wag. & Breed. Law"]),
    "PPD": ("New York State Printing and Public Documents", "N.Y. State Printing and Public Documents Law § {n}",
            ["State Print. & Pub. Docs. Law"]),
    "PTR": ("Partnership", "", ["P'ship Law"]),
    "PVH": ("Private Housing Finance", "", ["Priv. Hous. Fin. Law"]),
    "RAT": ("Rapid Transit", "", ["Rapid Trans. Law"]),
    "RCO": ("Religious Corporations", "", ["Relig. Corp. Law"]),
    "REL": ("Rural Electric Cooperative", "", ["Rural Elec. Coop. Law"]),
    "RPA": ("Real Property Actions & Proceedings", "", ["Real Prop. Acts. Law", "RPAPL",
                                                         "Real Property Actions and Proceedings Law"]),
    "RPP": ("Real Property", "", ["Real Prop. Law", "RPL"]),
    "RPT": ("Real Property Tax", "", ["Real Prop. Tax Law", "RPTL"]),
    "RRD": ("Railroad", "", ["R.R. Law"]),
    "RSS": ("Retirement & Social Security", "", ["Retire. & Soc. Sec. Law"]),
    "SAP": ("State Administrative Procedure Act", "", ["A.P.A.", "SAPA", "State Admin. Proc. Act"]),
    "SCC": ("Second Class Cities", "", ["Second Class Cities Law"]),
    "SLG": ("Statute of Local Governments", "", ["Stat. Local Gov'ts"]),
    "SOS": ("Social Services", "", ["Soc. Serv. Law"]),
    "STF": ("State Finance", "", ["State Fin. Law"]),
    "STL": ("State", "", ["State Law"]),
    "STT": ("State Technology", "", ["State Tech. Law"]),
    "SWC": ("Soil & Water Conservation Districts", "", ["Soil & Water Conserv. Dist. Law"]),
    "TAX": ("Tax", "", ["Tax Law"]),
    "TCP": ("Transportation Corporations", "", ["Transp. Corp. Law"]),
    "TRA": ("Transportation", "", ["Transp. Law"]),
    "TWN": ("Town", "", ["Town Law"]),
    "UCC": ("Uniform Commercial Code", "N.Y. U.C.C. Law § {n}", ["U.C.C. Law"]),
    "VAT": ("Vehicle & Traffic", "", ["Veh. & Traf. Law", "VTL", "Vehicle and Traffic Law"]),
    "VAW": ("Volunteer Ambulance Workers' Benefit", "", ["Vol. Ambul. Workers' Ben. Law"]),
    "VET": ("Veterans' Services", "", ["Veterans' Servs. Law"]),
    "VIL": ("Village", "", ["Village Law"]),
    "VOL": ("Volunteer Firefighters' Benefit", "", ["Vol. Firefighters' Ben. Law"]),
    "WKC": ("Workers' Compensation", "", ["Workers' Comp. Law", "WCL"]),
}


def citation_template(law: str) -> str:
    name, template, _aliases = LAWS_TABLE[law]
    if template:
        return template
    if name.endswith((" Law", " Act")) or name.startswith("Statute of"):
        return f"N.Y. {name} § {{n}}"
    return f"N.Y. {name} Law § {{n}}"


def _meta():
    if lib is None:
        return None
    codes = []
    for law, (name, _template, aliases) in LAWS_TABLE.items():
        # the UCC alias needs the "N.Y." prefix (a bare "U.C.C." citation names no state)
        prefix = None if law == "UCC" else _NY
        cite_aliases = ["N.Y. U.C.C. Law", "N.Y. U.C.C."] if law == "UCC" else aliases
        codes.append(lib.Code(law, name, citation_template(law), lib.alias_patterns(cite_aliases, prefix=prefix)))
    return lib.StateMeta(
        state="NY", code_name="Consolidated Laws of New York",
        publisher="New York State Senate (OpenLegislation, nysenate.gov)",
        publisher_url=INDEX, official_source=True, access="html", hosts=(HOST,), codes=tuple(codes), parser=PARSER,
        min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The publisher's pages were "
                    f"{PROXY_LABEL}: obtained on 2026-10-06/07 through a third-party fetch proxy (Firecrawl) that passed "
                    "the publisher's browser check, which this project's own fetcher does not pass; the owner accepted "
                    "these copies on 2026-10-07 as for Pennsylvania (scripts/legal/state-codes/ny/capture.py), and they "
                    "were released into the in-force layer on 2026-10-27. Never fetched live."),
        update_cadence=("Each page prints its own revision date; a refresh needs an OpenLegislation API key (free, from "
                        "the Senate) or a new owner-accepted capture."))


META = _meta()


def canon(href: str) -> str:
    href = href.split("#", 1)[0].split("?", 1)[0].rstrip("/")
    if href.startswith("/"):
        href = BASE + href
    return urllib.parse.unquote(href)


def split_url(url: str):
    match = NODE_URL.match(url)
    return (match.group(1), match.group(2)) if match else (None, None)


def _cls(name: str) -> str:
    return f"contains(concat(' ', normalize-space(@class), ' '), ' {name} ')"


def _one(root, name: str):
    found = root.xpath(f"//*[{_cls(name)}]")
    return found[0] if found else None


def _flat(el) -> str:
    return sb.ws(el.text_content()) if el is not None else ""


def parse_page(body: bytes, url: str) -> dict:
    """One OpenLegislation page: headline, catchline, revision line, printed table of contents and text block."""
    html = body.decode("utf-8", "replace")
    root = lxml_html.document_fromstring(html)
    law, node = split_url(url)
    headline = _flat(_one(root, "nys-openleg-result-title-headline"))
    word = headline.split(" ", 1)[0].upper() if headline else ""
    blocks = root.xpath(f"//*[{_cls('nys-openleg-result-text')}]")
    toc = []
    for item in root.xpath(f"//ul[{_cls('nys-openleg-items-container')}]//li[{_cls('nys-openleg-result-item-container')}]"):
        anchors = item.xpath(".//a[@href]")
        if not anchors:
            continue
        label = _flat(anchors[0])
        toc.append((canon(anchors[0].get("href")), label, label.split(" ", 1)[0].upper() if label else ""))
    text = (lib.html_text(lxml_html.tostring(blocks[0], encoding="unicode", with_tail=False))
            if (blocks and lib) else "")
    return {
        "url": url, "law": law, "node": node,
        "not_found": NOT_FOUND in sb.ws(root.text_content()) and not headline,
        "statute_page": bool(root.xpath(f"//*[{_cls('nys-openleg-statute-container')}]")) or bool(headline),
        "headline": headline or None, "type": word or None,
        "number": headline.split(" ", 1)[1].strip() if " " in headline else None,
        "heading": _flat(_one(root, "nys-openleg-result-title-short")) or None,
        "revision": _flat(_one(root, "nys-openleg-history-published")) or None,
        "toc": toc, "text_blocks": len(blocks), "text": text,
        "leaf": word in LEAF_TYPES,
    }


def split_text(text: str, number: str | None, heading: str | None) -> tuple[str | None, str]:
    """(number as printed in the text, text without the leading "§ 101. Short title.") — the prefix is removed only when
    its number is the page's number (case-insensitive), and the catchline only when it follows word for word."""
    match = PREFIX_RE.match(text)
    if not match or (number and match.group(1).lower() != number.lower()):
        return None, text
    rest = text[match.end():]
    words = sb.ws(heading or "").split(" ") if heading else []
    if words and words[0]:
        # the page's catchline "Short title" is printed in the text as "Short title."
        printed = re.match(r"\s*" + r"\s+".join(re.escape(w) for w in words) + r"\.?(?=\s|$)", rest)
        if printed:
            rest = rest[printed.end():]
    return match.group(1), rest.lstrip(" \n")


def level_step(page: dict) -> dict:
    word = (page["type"] or "").upper()
    level = LEVEL_WORDS.get(word, "other")
    return {"level": level, "label": word.title() or "Division", "number": page["number"], "heading": page["heading"]}


class _Walk:
    def __init__(self, ctx, retained):
        self.ctx = ctx
        self.by_key: dict[str, list[str]] = {}
        for u in retained.urls(LAWS):
            plain = u[:-len(UNCACHED)] if u.endswith(UNCACHED) else u
            self.by_key.setdefault(canon(plain), []).append(u)
        for urls in self.by_key.values():
            urls.sort(key=lambda u: u.endswith(UNCACHED))  # the plain URL first
        self.seen: set[str] = set()
        self.sections = 0

    def page(self, key: str):
        """The first retained capture of this page (plain URL, then ?view=all) that is a statute page."""
        for url in self.by_key.get(key, []):
            fetched = self.ctx.get(url)
            parsed = parse_page(fetched.body, key)
            if parsed["statute_page"] and not parsed["not_found"]:
                return fetched, parsed
        return None, None

    def unavailable(self, law: str | None, label: str, key: str, why: str) -> None:
        """A printed entry the capture cannot supply: ledgered (load.py refuses until the gap is named)."""
        self.ctx.reject(code=law, number=label, reason=f"unavailable: {key} {why}", source={"url": key})

    def walk(self, key: str, law: str, path: list[dict], label: str | None = None, word: str | None = None) -> None:
        if key in self.seen or not self.ctx.want_more():
            return
        self.seen.add(key)
        if key not in self.by_key:
            self.unavailable(law, label or key, key, "is printed in the table of contents but is not in the retained "
                                                     "capture")
            return
        fetched, page = self.page(key)
        if page is None:
            if word in LEAF_TYPES or word is None:
                self.unavailable(law, label or key, key, "has no retained capture that prints the page (not-found "
                                                         "answer)")
            return
        if page["leaf"]:
            self.emit(law, page, fetched, path)
            return
        child_path = path if split_url(key)[1] is None else path + [level_step(page)]
        children = [c for c in page["toc"] if c[0] not in self.seen and split_url(c[0])[0] == law]
        self.ctx.prefetch(self.by_key[c][0] for c, _l, _w in children if c in self.by_key)
        for child, child_label, child_word in children:
            if not self.ctx.want_more():
                return
            self.walk(child, law, child_path, child_label, child_word)

    def emit(self, law: str, page: dict, fetched, path: list[dict]) -> None:
        printed, text = split_text(page["text"], page["number"], page["heading"])
        number = printed or page["number"]
        if not number:
            self.ctx.reject(code=law, number=page["headline"] or page["url"], reason="no section number printed",
                            source=fetched)
            return
        status = sb.status_kwargs(page["heading"], text)
        if status is None:
            self.unavailable(law, number, page["url"], "prints no section text")
            return
        heading = page["heading"]
        if status["status"] not in ("in_force", "future_effective") and status["status_marker"] == heading:
            heading = None
        if self.ctx.section(code=law, number=number, heading=heading, text=text, path=path, source=fetched,
                            **status):
            self.sections += 1


def acquire(ctx):
    retained = getattr(ctx, "retained", None)
    if retained is None:
        raise lib.Blocked("www.nysenate.gov answers a browser check (HTTP 403) and the OpenLegislation API needs a key; "
                          "this module never fetches live. Re-parse the owner-accepted retained capture: "
                          "--option source=retained")
    options = getattr(ctx, "options", {}) or {}
    only = {law.strip().upper() for law in options.get("laws", "").split(",") if law.strip()}
    walk = _Walk(ctx, retained)
    fetched, index = walk.page(INDEX)
    if index is None:
        raise RuntimeError("the CONSOLIDATED index is not in the retained capture")
    walk.seen.add(INDEX)
    ctx.edition(edition_label=None, currency_statement=None, currency_source_url=None)
    laws = [(u, label) for u, label, _w in index["toc"] if split_url(u)[0] and split_url(u)[1] is None]
    ctx.log(f"{len(laws)} laws printed on the CONSOLIDATED index; {len(walk.by_key)} retained pages")
    for url, label in laws:
        law = split_url(url)[0]
        if only and law not in only:
            continue
        if law not in LAWS_TABLE:
            walk.unavailable(law, label, url, "is a law this module does not declare (add it to LAWS_TABLE)")
            continue
        walk.walk(url, law, [], label)
        if not ctx.want_more():
            break
    ctx.log(f"{walk.sections} sections from {len(walk.seen)} pages")
