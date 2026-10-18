"""Parse Good Jobs First Violation Tracker data-source pages into factual (agency, jurisdiction, coverage, URL) entries.

Only the source listing is read (agency names, the source type each line names, and the official link it points to).
No penalty records are read. Deterministic: entries keep page order.
"""
import html.parser
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tp_common as tp  # noqa: E402

US_STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY",
    "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV", "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH",
    "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA",
    "WASHINGTON": "WA", "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY", "PUERTO RICO": "PR",
    "GUAM": "GU", "U.S. VIRGIN ISLANDS": "VI", "VIRGIN ISLANDS": "VI", "AMERICAN SAMOA": "AS",
    "NORTHERN MARIANA ISLANDS": "MP", "MULTISTATE": "",
}


class _Blocks(html.parser.HTMLParser):
    """Collect h1-h4 / p / li blocks with their text and links."""

    BLOCKS = {"h1", "h2", "h3", "h4", "p", "li"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.stack, self.skip = [], [], 0
        self.href = None
        self.anchor = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag in self.BLOCKS:
            self.stack.append({"tag": tag, "text": [], "links": []})
        if tag == "a" and self.stack:
            self.href = dict(attrs).get("href")
            self.anchor = []
        if tag == "br" and self.stack:
            self.stack[-1]["text"].append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1
        if tag == "a" and self.stack and self.href is not None:
            self.stack[-1]["links"].append((" ".join("".join(self.anchor).split()), self.href.strip()))
            self.href = None
        if tag in self.BLOCKS and self.stack and self.stack[-1]["tag"] == tag:
            block = self.stack.pop()
            text = " ".join("".join(block["text"]).replace("\xa0", " ").split())
            if self.stack:  # nested block: merge into parent
                self.stack[-1]["text"].append(" " + text + " ")
                self.stack[-1]["links"].extend(block["links"])
            else:
                self.blocks.append({"tag": tag, "text": text, "links": block["links"]})

    def handle_data(self, data):
        if self.skip or not self.stack:
            return
        self.stack[-1]["text"].append(data)
        if self.href is not None:
            self.anchor.append(data)


def blocks(raw_html):
    parser = _Blocks()
    parser.feed(raw_html)
    return parser.blocks


FOOTER = {"Quick Start", "Guides", "Data Sources", "Analyses", "VT UK", "VT Global", "Updates", "Terms of Service", "Privacy Policy"}
GJF_HOSTS = ("goodjobsfirst.org",)


def is_gjf(url):
    host = urllib.parse.urlparse(url or "").netloc.lower()
    return any(host == h or host.endswith("." + h) for h in GJF_HOSTS)


def split_entry(text):
    """'Agency: coverage; also: coverage2' -> (agency, coverage). A line without ': ' is an agency-named resource."""
    if ": " in text:
        agency, coverage = text.split(": ", 1)
        return agency.strip(), coverage.strip()
    return text.strip(), ""


def is_forbidden_link(url):
    """Links to the compiler's own pages (or any host the owner forbade publishing) are never kept as an agency URL."""
    return bool(url) and (is_gjf(url) or bool(tp.forbidden_in_url(url)))


def dedupe_links(links):
    """Drop compiler-site links and repeated URLs (keep the first non-empty anchor per URL), preserving order."""
    out, seen = [], {}
    for anchor, url in links:
        if not url or is_forbidden_link(url):
            continue
        if url in seen:
            if anchor and not out[seen[url]][0]:
                out[seen[url]] = (anchor, url)
            continue
        seen[url] = len(out)
        out.append((anchor, url))
    return out


def norm_url(href, base):
    if not href:
        return None
    href = href.strip()
    if href.startswith("//"):
        href = "https:" + href
    return urllib.parse.urljoin(base, href)


def parse_federal(raw_html, page_url):
    """Entries between the federal intro paragraph and the closing 'jump to state' link."""
    out, active = [], False
    for block in blocks(raw_html):
        text = block["text"]
        if not active:
            if text.startswith("Below are data sources for federal agencies"):
                active = True
            continue
        if text.lower().startswith("jump to state"):
            break
        if block["tag"] != "p" or not text:
            continue
        agency, coverage = split_entry(text)
        raw = [(a, norm_url(h, page_url)) for a, h in block["links"] if h and not h.startswith("#")]
        links = dedupe_links(raw)
        out.append({"jurisdiction": "Federal", "state": "", "agency": agency, "coverage": coverage, "links": links, "line": text,
                    "dropped_forbidden_links": sum(1 for _, u in raw if is_forbidden_link(u))})
    return out


def parse_state_local(raw_html, page_url):
    out, active, state_name = [], False, None
    for block in blocks(raw_html):
        text = block["text"]
        if not active:
            if text.startswith("Violation Tracker coverage for state AGs"):
                active = True
            continue
        if text.lower().startswith("jump to federal") or text in FOOTER:
            break
        if not text:
            continue
        upper = text.upper()
        if block["tag"].startswith("h") or (upper == text and upper in US_STATES):
            if upper in US_STATES:
                state_name = upper
            continue
        if block["tag"] not in ("p", "li") or state_name is None:
            continue
        agency, coverage = split_entry(text)
        raw = [(a, norm_url(h, page_url)) for a, h in block["links"] if h and not h.startswith("#")]
        links = dedupe_links(raw)
        if block["links"] and not links:
            continue  # only compiler navigation links: not a source entry
        out.append({"jurisdiction": state_name.title() if state_name != "DISTRICT OF COLUMBIA" else "District of Columbia",
                    "state": US_STATES[state_name], "agency": agency, "coverage": coverage, "links": links, "line": text,
                    "dropped_forbidden_links": sum(1 for _, u in raw if is_forbidden_link(u))})
    return out


LOCAL_PAT = re.compile(r"\b(County|City|District Attorney|City Attorney|Municipal|Borough|Parish|Township|Village)\b")
# City-named offices that carry no 'City'/'County' word (all listed on the state pages under their state heading).
CITY_PREFIX = re.compile(r"^(Chicago|Denver|Minneapolis|Seattle)\b")
REGIONAL_PAT = re.compile(r"Air Quality Management District|Air Pollution Control District|Clean Air Agency")
SRO = {"Financial Industry Regulatory Authority (securities industry self-regulator authorized by Congress)",
       "Public Company Accounting Oversight Board"}


def level_of(entry):
    """federal | federal_self_regulatory | regional (multi-county / metro air agencies) | local (county, city) | state (everything else on a state page)."""
    agency = entry["agency"]
    if entry["jurisdiction"] == "Federal":
        if agency in SRO:
            return "federal_self_regulatory"
        return "federal"
    if REGIONAL_PAT.search(agency):
        return "regional"
    if LOCAL_PAT.search(agency) or CITY_PREFIX.search(agency):
        return "local"
    return "state"


SOURCE_TYPES = [
    ("open_records_request", re.compile(r"open records request|FOIA|public records request", re.I)),
    ("dataset_download", re.compile(r"dataset|data download|full dataset|data$|violations data|enforcement data|penalty data", re.I)),
    ("press_releases", re.compile(r"press release|announced|announcements|news", re.I)),
    ("docket", re.compile(r"docket", re.I)),
    ("reports", re.compile(r"report|bulletin|agenda", re.I)),
    ("orders_and_actions", re.compile(r"order|action|decision|penalt|settlement|agreement|case|matters|violation|sanction|fine|proceeding|release|disciplin|consent|compromise|judgment", re.I)),
]


def source_types(coverage):
    if not coverage:
        return ["resource"]
    found = [name for name, pat in SOURCE_TYPES if pat.search(coverage)]
    return found or ["other"]


def host_of(url):
    host = urllib.parse.urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def registrable(host):
    """Last two labels, or three for <x>.<state>.us / gov.<cc> style hosts (deterministic, documented)."""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-1] == "us" and len(parts[-2]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def official_domain(host):
    return host.endswith(".gov") or host.endswith(".mil") or host.endswith(".us") or host.endswith(".gov.pr")
