"""Parsers for federal court websites: judge listing pages, judge pages and the practice documents they link.

Pure functions over HTML bytes (no network), so they can be tested on stored fixtures. Nothing here guesses: a title is the words the
site prints (and `title_class` a deterministic reading of them), a date is only taken from text printed beside the link, and values
that cannot be read are None ("Not recorded" downstream). Chambers phone numbers, e-mail addresses and courtroom deputy names are
never extracted: the parsers read the name, the title, the page address and the document links only.
"""
from __future__ import annotations

import datetime
import html as htmlmod
import re
import unicodedata
import urllib.parse
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, NavigableString, Tag

# --------------------------------------------------------------------------------------------------------------------------
# text helpers


def clean(text: str | None) -> str:
    """Whitespace-collapsed text (NBSP and zero-width characters included)."""
    if not text:
        return ""
    text = htmlmod.unescape(text).replace(" ", " ").replace("​", "").replace("﻿", "")
    return " ".join(text.split())


def soup_of(body: bytes) -> BeautifulSoup:
    soup = BeautifulSoup(body, "lxml")
    for t in soup(["script", "style", "noscript", "template", "svg"]):
        t.decompose()
    return soup


CHROME_TOKEN = re.compile(
    r"^(?:nav|navbar|navigation|menu|menus|megamenu|footer|breadcrumbs?|masthead|topbar|skip|skip-link|skiplink|utility|utilitynav|social|dropdown|"
    r"pager|alerts?|notice-bar|searchbox|search-form|toolbar|tabs|tabs-primary|tabs-secondary|sidebar|sidebar-first|sidebar-second|"
    r"region-sidebar-first|region-sidebar-second|region-navigation|region-header|region-footer|region-alerts|header|site-header|header-top)$|"
    r"(?:^|[-_])(?:menu|navbar|nav|footer|breadcrumbs?|megamenu|navigation)$|^(?:block-menu|block-system-main-menu|block-superfish|block-views-block-notice)",
    re.I)


def _class_tokens(el: Tag) -> list[str]:
    cls = el.get("class") or []
    if isinstance(cls, str):
        cls = cls.split()
    toks = [t for t in cls if not re.match(r"^(?:has|no|with|without|not|page|node|section|path|html|front)-", t, re.I)]
    if el.get("id"):
        toks.append(el["id"])
    return toks


def main_root(soup: BeautifulSoup) -> Tag:
    """The element that holds the page's own content (not the site header, menus or footer)."""
    body = soup.body or soup
    for finder in (
        lambda: soup.find("main"),
        lambda: soup.find(attrs={"role": "main"}),
        lambda: soup.find("div", id="main-content"),
        lambda: soup.find(class_="l-content"),
        lambda: soup.find(class_="region-content"),
        lambda: soup.find(id="content"),
        lambda: soup.find(id="main"),
        lambda: soup.find(class_="main-container"),
        lambda: soup.find(class_="main-content"),
        lambda: soup.find(id="primary"),
        lambda: soup.find(id="maincontent"),
        lambda: soup.find("article"),
    ):
        el = finder()
        if isinstance(el, Tag) and el.find("a", href=True) is not None and len(el.get_text(" ", strip=True)) > 80:
            return el
    return body


def in_chrome(el: Tag, root: Tag | None = None) -> bool:
    """True when the element sits outside the main content root, or inside nav/footer/aside/menu/breadcrumb markup below it."""
    if root is not None and root.name != "body" and el is not root and root not in el.parents:
        return True
    for parent in [el, *el.parents]:
        if not isinstance(parent, Tag):
            continue
        if root is not None and parent is root:
            break
        if parent.name in ("nav", "footer", "aside") or (parent.name == "header" and root is None):
            return True
        if parent.name in ("body", "html", "[document]"):
            continue
        if any(CHROME_TOKEN.search(t) for t in _class_tokens(parent)):
            return True
    return False


# --------------------------------------------------------------------------------------------------------------------------
# links with their context


@dataclass
class Link:
    text: str
    href: str            # absolute, fragment removed
    chrome: bool         # inside nav/header/footer/aside/menu
    heading: str | None  # nearest heading above (any level)
    headings: tuple[str, ...]  # heading stack h1..h6 at that point
    block: str           # text of the surrounding list item / row / paragraph (links and all), capped
    title_attr: str = ""


HEADING = re.compile(r"^h[1-6]$")
BLOCK_PARENTS = ("li", "tr", "p", "dd", "dt", "td", "div", "section", "article")


def is_home(url: str) -> bool:
    """The site's front page. A query string makes it another page on sites that route through `/?q=judge/...`."""
    u = urllib.parse.urlparse(url)
    return u.path in ("", "/") and not u.query


def absolute(base: str, href: str) -> str | None:
    href = htmlmod.unescape(href or "").strip()
    if not href or href.startswith(("#", "javascript:", "mailto:", "tel:", "data:", "sms:")):
        return None
    try:
        url = urllib.parse.urljoin(base, href)
    except ValueError:
        return None
    url, _ = urllib.parse.urldefrag(url)
    if not url.startswith(("http://", "https://")):
        return None
    return url.replace(" ", "%20")


def _block_text(a: Tag, cap: int = 500) -> str:
    node: Tag | None = a
    for _ in range(4):
        parent = node.parent if node is not None else None
        if not isinstance(parent, Tag):
            break
        node = parent
        if node.name in ("li", "tr", "p", "dd", "dt"):
            return clean(node.get_text(" "))[:cap]
    return clean(a.parent.get_text(" "))[:cap] if isinstance(a.parent, Tag) else ""


def _table_column_heading(a: Tag, cache: dict) -> str | None:
    td = a.find_parent(["td", "th"])
    if td is None:
        return None
    table = td.find_parent("table")
    row = td.find_parent("tr")
    if table is None or row is None:
        return None
    if id(table) not in cache:
        heads: list[str] = []
        first = table.find("tr")
        if first is not None:
            for cell in first.find_all(["th", "td"], recursive=False):
                text = clean(cell.get_text(" "))
                span = int(cell.get("colspan") or 1) if str(cell.get("colspan") or "1").isdigit() else 1
                heads.extend([text] * span)
        cache[id(table)] = heads
    heads = cache[id(table)]
    if row is table.find("tr"):
        return None
    idx = 0
    for cell in row.find_all(["th", "td"], recursive=False):
        if cell is td:
            break
        idx += int(cell.get("colspan") or 1) if str(cell.get("colspan") or "1").isdigit() else 1
    if idx < len(heads) and re.search(r"judges?|judicial|magistrate|chambers", heads[idx], re.I) and len(heads[idx]) <= 70:
        return heads[idx]
    return None


def extract_links(body: bytes | BeautifulSoup, base_url: str) -> list[Link]:
    soup = body if isinstance(body, BeautifulSoup) else soup_of(body)
    top = soup.body or soup
    root = main_root(soup)
    out: list[Link] = []
    stack: dict[int, str] = {}
    cols: dict = {}
    for el in top.descendants:
        if not isinstance(el, Tag):
            continue
        if HEADING.match(el.name or ""):
            if in_chrome(el, root):
                continue  # site banner / menu headings say nothing about the links below them
            level = int(el.name[1])
            text = clean(el.get_text(" "))
            for k in [k for k in stack if k >= level]:
                del stack[k]
            if text:
                stack[level] = text
            continue
        if el.name in ("strong", "b", "th", "legend") and not el.find("a"):
            text = clean(el.get_text(" "))
            if text and len(text) <= 60 and re.search(r"judges?|judicial", text, re.I) and not re.search(r"[.!?]$", text) \
                    and not in_chrome(el, root):
                stack[7] = text
            continue
        if el.name != "a" or not el.get("href"):
            continue
        href = absolute(base_url, el["href"])
        if not href:
            continue
        text = clean(el.get_text(" ")) or clean(el.get("title") or el.get("aria-label") or "")
        headings = tuple(stack[k] for k in sorted(stack))
        col = _table_column_heading(el, cols)
        if col:
            headings = (*[h for h in headings if h != stack.get(7)], col)
        out.append(Link(text=text, href=href, chrome=in_chrome(el, root), heading=headings[-1] if headings else None,
                        headings=headings, block=_block_text(el), title_attr=clean(el.get("title") or "")))
    return out


# --------------------------------------------------------------------------------------------------------------------------
# titles


ROLE_MODS = {"sr.", "mag.", "inactive", "chief", "senior", "visiting", "recalled", "recall", "retired", "acting", "u.s.", "us", "u.s", "united", "states", "district",
             "magistrate", "bankruptcy", "circuit", "article", "iii", "full-time", "part-time", "the", "court", "for", "of", "appeals", "u. s."}
ROLE_CORE = re.compile(r"\bjudges?\b", re.I)


def role_phrase(text: str) -> str | None:
    """The title words printed around the word 'Judge' ("Chief United States District Judge"), exactly as printed, or None.

    Modifiers are collected to the left of the first 'Judge' only (not 'Judge for the Southern District of ...')."""
    text = clean(text)
    m = ROLE_CORE.search(text)
    if not m:
        return None
    left = text[: m.start()].split()
    kept: list[str] = []
    for word in reversed(left):
        w = word.strip(",;:()").lower()
        if w in ROLE_MODS and word[0].isupper() or w in ROLE_MODS and w in ("u.s.", "us"):
            kept.append(word.strip(",;:("))
        else:
            break
    kept.reverse()
    while kept and (kept[0].lower() in ("the", "for", "of", "court", "appeals") or kept[0].upper().strip(".") in ("II", "III", "IV")):
        kept.pop(0)  # "Clark, III United States Magistrate Judge": the III belongs to the name
    phrase = " ".join([*kept, m.group(0)])
    right = text[m.end():]
    sbd = re.match(r"(?:\s+[\w.'’\-]+){0,5},?\s+(sitting\s+by\s+designation)", right, re.I)  # "Judge Peter G. Cary, sitting by designation"
    if sbd:
        phrase += " " + sbd.group(1)
    else:
        q = re.search(r"\(?\b(on\s+recall|recalled|recall|senior\s+status)\b\)?", right[:80], re.I)
        if q and not re.search(r"\bjudge\b", right[: q.start()], re.I):
            phrase += " " + q.group(0).strip("() ")
    return phrase


TITLE_CLASSES = ("district_judge", "senior_district_judge", "chief_district_judge", "magistrate_judge", "chief_magistrate_judge",
                 "senior_magistrate_judge", "bankruptcy_judge", "chief_bankruptcy_judge", "other")


def classify_title(text: str | None, court_level: str | None = None) -> tuple[str | None, str | None]:
    """(title_class, basis): title_class from the printed words; if they name no court level, from the court's own type
    (basis "court_type"); (None, None) when no title was printed."""
    if not text:
        return None, None
    t = clean(text).lower()
    if "sitting by designation" in t or "visiting" in t or ("circuit" in t and "district" not in t and "bankruptcy" not in t and "magistrate" not in t):
        return "other", "text"
    chief = "chief" in t
    senior = "senior" in t or "recall" in t or bool(re.search(r"\bsr\b\.?", t))  # "Sr. Judge" is the court's abbreviation of Senior
    if "bankruptcy" in t:
        return ("chief_bankruptcy_judge" if chief else "bankruptcy_judge"), "text"
    if "magistrate" in t or re.search(r"\bmag\b\.?", t):
        if chief:
            return "chief_magistrate_judge", "text"
        return ("senior_magistrate_judge" if senior and "recall" in t else "magistrate_judge"), "text"
    if "district" in t or "article iii" in t:
        if senior:
            return "senior_district_judge", "text"
        return ("chief_district_judge" if chief else "district_judge"), "text"
    if court_level == "bankruptcy":
        return ("chief_bankruptcy_judge" if chief else "bankruptcy_judge"), "court_type"
    if court_level == "district" and senior:
        return "senior_district_judge", "court_type"
    if court_level == "district" and chief:
        return "chief_district_judge", "court_type"
    return None, None


TITLE_LABEL = {
    "district_judge": "District Judge", "senior_district_judge": "Senior District Judge", "chief_district_judge": "Chief District Judge",
    "magistrate_judge": "Magistrate Judge", "chief_magistrate_judge": "Chief Magistrate Judge", "senior_magistrate_judge": "Recalled Magistrate Judge",
    "bankruptcy_judge": "Bankruptcy Judge", "chief_bankruptcy_judge": "Chief Bankruptcy Judge", "other": "Other judicial title",
}


# --------------------------------------------------------------------------------------------------------------------------
# judge names


HON = re.compile(r"^(?:the\s+)?(?:hon\.?|honorable)\s+", re.I)
LEAD_ROLE = re.compile(
    r"^(?:(?:the\s+)?(?:inactive|chief|senior|sr\.?|mag\.?|visiting|recalled|recall|u\.?\s?s\.?|united\s+states|district|magistrate|bankruptcy|circuit|article\s+iii)\s+)*"
    r"judge\s+", re.I)
TRAIL_ROLE = re.compile(
    r"\s*[,\-–—|(]\s*(?:(?:chief|senior|visiting|recalled|recall|retired|u\.?\s?s\.?|united\s+states|district|magistrate|bankruptcy|circuit)\s+)*"
    r"(?:judge|court).*$", re.I)
PAREN = re.compile(r"\s*\([^)]*\)\s*$")

NOT_JUDGE = re.compile(
    r"(?:\binfo(?:rmation)?\b|procedures?|calendars?|schedules?|vacanc|opinions?|conduct|disclos|seminar|requirements?|\brules?\b|"
    r"\bduty\b|assignments?|biograph|directory|\bchambers\b|courtroom|\bforms?\b|search|\blists?\b|appointment|selection|example|proposed|"
    r"hearings?|dockets?|resume|employment|hiring|\bfaq|e-?mail|phone|telephone|mailing|address|contact|specific|assistants?|staff|"
    r"reappointment|notices?|news|announcement|history|former|emerit|\bpro se\b|consent|reports?|statistics|orders?\b|judgeship|"
    r"\bjudges(?:'|’)?\b(?!\s*$)|judicial|justice\b|committee|council|conference|honor roll|meet\b|welcome|about|\bsitting\b|"
    r"\bdesignation\b|visiting|case\s+assignment|random|wheel|duty|library|bar\b|oath|investiture|ceremon|portrait|photo|"
    r"transcripts?|recording|zoom|webex|teleconference|remote|telephonic|video)", re.I)


GENERIC_TAIL = re.compile(r"\s*[-\u2013\u2014|,:]?\s*(?:chambers(?:\s+(?:directory|information|page|contact information))?|opinions?|biograph(?:y|ies)|"
                          r"instructions\s+and\s+forms|(?:court\s+)?procedures?|practices|rules|home\s+page)\s*$", re.I)
GENERIC_NAMES = {"biography", "biographies", "judge", "judges", "home", "chambers", "opinions", "procedures", "information", "page", "remote", "access",
                 "welcome", "zoom", "telephonic", "appearances", "guidelines", "notice", "notices", "contact", "calendar", "calendars", "tba", "tbd",
                 "vacant", "vacancy", "vacancies"}
FUNCTION_WORDS = {"of", "and", "the", "for", "to", "in", "on", "a", "an", "with", "role"}


def person_like(name: str | None, *, allow_single: bool = False) -> bool:
    """A usable personal name: letters, not a page label ("Biography"), no function words, one token only when allowed (surname pages)."""
    if not name:
        return False
    toks = [t for t in re.split(r"\s+", name) if re.search(r"[A-Za-z]", t)]
    if not toks or len(toks) > 7 or re.search(r"\d", name):
        return False
    # a middle name may be an ordinary word ("M. Page Kelley", "Denise Page Hood"); the first and last words never are page labels
    edge = toks if len(toks) <= 2 else [toks[0], toks[-1]]
    if any(t.lower().strip(".,") in GENERIC_NAMES for t in edge) or any(t in FUNCTION_WORDS for t in toks):  # "A" is an initial; only lower case "a" is a word
        return False
    if re.search(r"\b(?:united states|court|district|bankruptcy|office|clerk|division|department|probation|pretrial|services|committee|library)\b", name, re.I):
        return False
    return len(toks) >= 2 or (allow_single and len(toks[0]) >= 3)


def resolve_name(candidates: list[str | None]) -> tuple[str | None, str | None]:
    """(name as published, name): the first candidate text (page heading, listing link text, page title) that yields a usable personal name."""
    single: tuple[str, str] | None = None
    for c in candidates:
        if not c:
            continue
        n = strip_name(reorder_last_first(clean(c)))
        published = proc_title_name(clean(c)) or clean(c)
        if person_like(n):
            return published, n
        if single is None and person_like(n, allow_single=True):
            single = (published, n)
    return single if single else (None, None)


PROC_BEFORE = re.compile(r"^.*?\b(?:procedures?|requirements|practices|rules|calendar|chambers|orders?)\b.*?\b(?:before|of|for)\s+(?:the\s+)?"
                         r"(?=(?:hon\.?\s*|honorable\s+)\S)", re.I)
LOCATION_TAIL = re.compile(r"\s+[-–—]\s+[A-Z][A-Za-z.]*(?:\s[A-Z][A-Za-z.]*)?$")


def proc_title_name(text: str) -> str | None:
    """The judge as a page titled "Procedures for Hearings before Hon. Frank J. Santoro - Norfolk" prints the name ("Hon. Frank J. Santoro"), else None."""
    pb = PROC_BEFORE.match(text)
    if not pb:
        return None
    rest = LOCATION_TAIL.sub("", text[pb.end():])
    return re.sub(r"^(hon\.)(?=[A-Za-z])", r"\1 ", rest, flags=re.I)


def strip_name(text: str) -> str:
    """The person's name from a link or heading: honorific, title words and trailing role removed; parentheses kept out."""
    t = clean(text)
    if ">" in t:  # a breadcrumb ("HOME >> JUDGES > CHIEF JUDGE JACOB A. BROWN"): the last step is the page's own name
        t = clean(t.rsplit(">", 1)[-1])
    t = re.sub(r"^(?:biography|profile|about|chambers of|information)\s*[-\u2013\u2014:]\s*(?=\S)", "", t, flags=re.I)
    named = proc_title_name(t)
    if named:  # "Procedures for Hearings before Hon. Frank J. Santoro - Norfolk": the page is titled by what it holds and the judge it is for
        t = named
    t = HON.sub("", t)
    t = LEAD_ROLE.sub("", t)
    t = TRAIL_ROLE.sub("", t)
    t = PAREN.sub("", t)
    t = re.sub(r"\s*[,;]\s*$", "", t)
    t = re.sub(r"\s+(?:(?:circuit|district|magistrate|bankruptcy|senior|chief|u\.?\s?s\.?|united\s+states)\s+)+judge.*$", "", t, flags=re.I)
    for _ in range(3):
        t2 = GENERIC_TAIL.sub("", t)
        if t2 == t:
            break
        t = t2
    t = clean(t)
    return t.title() if len(t) > 3 and t.isupper() else t  # "JACOB A. BROWN" (a breadcrumb in capitals) -> "Jacob A. Brown"


ROLE_WORDS =re.compile(r"\b(?:hon|honorable|the|inactive|chief|senior|visiting|recalled|recall|u\.?\s?s\.?|united|states|district|magistrate|bankruptcy|circuit|"
                        r"article|iii|judge|judges|court|for|of)\b\.?", re.I)


def looks_like_judge_link(text: str) -> bool:
    """A link whose text is a judge's name with an honorific or the word Judge ("Hon. Ronnie Abrams", "Judge Terry F. Moorer",
    "Vince Chhabria, District Judge"). Pages about judges in general ("Judge Information", "Judges' Calendars") are not."""
    t = clean(text)
    if not t or len(t) > 120 or len(t) < 6:
        return False
    if HON.match(t):
        rest = HON.sub("", t)
        return bool(re.search(r"[A-Za-z]{2,}", rest)) and not re.match(r"(?:judges|justices)\b", rest, re.I) \
            and not re.search(r"\b(?:biograph|opinions?|calendars?|vacanc|procedures?|rules\b|info)", rest, re.I)
    if not re.search(r"\bjudge\b", t, re.I):
        return False
    if re.search(r"\bjudges\b", t, re.I) and not re.search(r"\bjudge\b", re.sub(r"\bjudges\b", "", t, flags=re.I), re.I):
        return False
    if NOT_JUDGE.search(re.sub(r"\bjudge\b|\bchief\b|\bsenior\b|\bu\.?s\.?\b|\bdistrict\b|\bmagistrate\b|\bbankruptcy\b|\bunited states\b",
                               "", t, flags=re.I)):
        return False
    name = strip_name(t)
    if len(re.sub(r"[^A-Za-z]", "", ROLE_WORDS.sub(" ", name))) < 3:
        return False  # only title words ("U.S. Bankruptcy Judge")
    words = [w for w in re.split(r"\s+", name) if re.search(r"[A-Za-z]", w)]
    return 1 <= len(words) <= 8 and bool(re.match(r"[A-ZÀ-Ý]", name[:1] or "a"))


def norm_name(name: str) -> str:
    """Lower-case letters of the name with accents folded, suffixes (Jr., Sr., II, III, IV) and honorifics dropped."""
    t = unicodedata.normalize("NFKD", clean(name))
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = HON.sub("", t)
    t = re.sub(r"\b(?:jr|sr|ii|iii|iv|v)\b\.?", " ", t)
    t = re.sub(r"[^a-z ]", " ", t)
    return " ".join(t.split())


# --------------------------------------------------------------------------------------------------------------------------
# listing pages


@dataclass
class Entry:
    name_text: str            # link text as published
    url: str
    heading: str | None       # nearest heading in the listing
    headings: tuple[str, ...]
    role_text: str | None     # title words printed with the entry (link text or its row), if any
    block: str = ""
    listing_title: str | None = None  # the listing page's own heading ("United States District Judges")
    menu_role: str | None = None      # title words printed with a link to the same page in the site's menu, if richer
    docs: list = field(default_factory=list)  # links printed under the judge's name on the listing page itself (Link objects)


FORMER_PATH = re.compile(r"(portrait|former|retired|emerit|memoriam|past-judges|deceased|history|historical|honor-roll|legacy|taxonomy/term|"
                         r"\d{4}-present|1789)", re.I)
FORMER_HEADING = re.compile(r"\b(?:former|retired|emerit\w*|past|late|deceased|in memoriam|history|historical|portraits?)\b", re.I)


FORMER_MARK = re.compile(r"\(\s*(?:ret(?:ired)?|dec(?:eased)?|emerit(?:us|a)|ret\.? ?\d{4}|d\.? ?\d{4}|in memoriam)\.?\s*\)", re.I)


def former_marker(text: str) -> str | None:
    """"Judge Diane Finkle (ret.)", "Judge Arthur N. Votolato (dec.)": a listing that marks the person as retired or deceased in the link text."""
    m = FORMER_MARK.search(text or "")
    return f"the listing marks the name '{m.group(0)}'" if m else None


def is_former(url: str, headings: tuple[str, ...]) -> str | None:
    """Why an entry is not a sitting judge (a portrait gallery of former judges, a history page), or None."""
    path = urllib.parse.urlparse(url).path
    m = FORMER_PATH.search(path)
    if m:
        return f"address contains '{m.group(1)}'"
    for h in headings:
        m = FORMER_HEADING.search(h)
        if m:
            return f"under the heading '{h[:60]}'"
    return None


def judge_entries(body: bytes | BeautifulSoup, base_url: str, *, strict: bool = True, audit: list | None = None) -> list[Entry]:
    """Links on a listing page that look like judge pages. Prefers links outside site chrome; if there are fewer than two,
    falls back to all links on the page (some sites list judges only in the navigation)."""
    soup = body if isinstance(body, BeautifulSoup) else soup_of(body)
    links = extract_links(soup, base_url)
    entries = _entries_from(links, strict)
    title = page_heading(soup) or page_title(soup)
    kept: list[Entry] = []
    for e in entries:
        why = is_former(e.url, e.headings)
        if why:
            if audit is not None:
                audit.append({"url": e.url, "name": e.name_text, "reason": f"not a sitting judge: {why}"})
            continue
        e.listing_title = title
        kept.append(e)
    return kept


PERSON_NAME = re.compile(
    r"^(?:[A-Z][A-Za-z'’À-ſ.\-]*)(?:\s+(?:[A-Z][A-Za-z'’À-ſ.\-]*|[A-Z]\.|de|van|von|del|la|di|da|le|bin|ibn))"
    r"{1,5}(?:,?\s*(?:Jr\.?|Sr\.?|II|III|IV))?$")
PERSON_STOP = re.compile(r"(?:motions?|hearings?|appearances?|conference|pointers?|liens?|discovery|procedures?|orders?|notices?|plans?|chapter|"
                         r"claims?|cases?|trial|practices?|guidelines?|checklist|template|sample|requests?|applications?|petitions?|local|general|"
                         r"standing|reporting|debtors?|creditors?|filings?|fees?|exhibits?|witness|jury|calendar|protocol|policies|technology|"
                         r"clerk|chambers|court|office|staff|department|division|district|bankruptcy|united|states|center|bar\b|committee|"
                         r"school|university|library|probation|pretrial|services|program|trustee|attorney|counsel|marshal|reporter|interpreter|"
                         r"judges?|judicial|opinions?|rules?|forms?|home|about|contact|news|jury|fees?|search|login|map|faq|policy|"
                         r"directory|information|calendar|schedule|biograph|hours|locations?|employment|careers?|vacanc|privacy|accessibility)", re.I)
JUDGE_CONTEXT = re.compile(r"judges?\b|judicial|magistrate|chambers", re.I)


def is_person_name(text: str) -> bool:
    t = clean(text)
    t = PAREN.sub("", t)
    if not 5 <= len(t) <= 60 or PERSON_STOP.search(t):
        return False
    if "," in t and not re.search(r",\s*(?:Jr\.?|Sr\.?|II|III|IV)$", t):
        t = " ".join(reversed([x.strip() for x in t.split(",", 1)]))
    return bool(PERSON_NAME.match(t))


def _entries_from(links: list[Link], strict: bool = True) -> list[Entry]:
    def role_of(ln: Link) -> str | None:
        return role_phrase(ln.text) or (role_phrase(ln.block) if ln.block and len(ln.block) < 400 else None)

    def pick(pool: list[Link]) -> list[Entry]:
        seen: dict[str, Entry] = {}
        for ln in pool:
            if is_home(ln.href) or FILE_EXT.search(ln.href):
                continue  # the home page, or a document (a PDF named for a judge is a document, not the judge's page)
            if not looks_like_judge_link(ln.text):
                continue
            if re.search(r"\bclerk\b|\bchief deputy\b|\bcourt executive\b", ln.text, re.I):
                continue
            e = Entry(name_text=ln.text, url=ln.href, heading=ln.heading, headings=ln.headings, role_text=role_of(ln), block=ln.block)
            seen.setdefault(ln.href, e)
        return list(seen.values())

    def pick_names(pool: list[Link]) -> list[Entry]:
        """Links whose text is only a person's name, under a judges heading or at a judge-like address (`/judge-dlb`, `/judges/smith`)."""
        seen: dict[str, Entry] = {}
        for ln in pool:
            path = urllib.parse.urlparse(ln.href).path
            if is_home(ln.href) or not is_person_name(ln.text) or FILE_EXT.search(ln.href) or FILE_PATH.search(path) \
                    or re.search(r"taxonomy/term|/node/\d+$", path):
                continue
            ctx = any(JUDGE_CONTEXT.search(h) for h in ln.headings)
            if not (ctx or re.search(r"judge|chambers|biograph", path, re.I)):
                continue
            seen.setdefault(ln.href, Entry(name_text=ln.text, url=ln.href, heading=ln.heading, headings=ln.headings, role_text=role_of(ln),
                                           block=ln.block))
        by_dir: dict[str, list[Entry]] = {}
        for e in seen.values():
            by_dir.setdefault(urllib.parse.urlparse(e.url).path.rsplit("/", 1)[0], []).append(e)
        return [e for group in by_dir.values() if len(group) >= 2 for e in group]

    main_pool = [ln for ln in links if not ln.chrome]
    menu_roles: dict[str, str] = {}
    for ln in links:
        if ln.chrome and ln.text and looks_like_judge_link(ln.text):
            ph = role_phrase(ln.text)
            if ph and ph.lower() not in ("judge", "judges"):
                menu_roles.setdefault(ln.href, ph)
    main = pick(main_pool)
    for e in main:
        e.menu_role = menu_roles.get(e.url)
    if len(main) < 2:
        named = pick_names(main_pool)
        if len(named) >= 2:
            main = named + [e for e in main if e.url not in {n.url for n in named}]
            for e in main:
                e.menu_role = menu_roles.get(e.url)
    if len(main) >= 2 or not strict:
        return main
    return pick(links)


# --------------------------------------------------------------------------------------------------------------------------
# dates and documents

MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
                                      "november", "december"], 1)}
MONTH_RE = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
DATE_PATTERNS = [
    re.compile(rf"\b({MONTH_RE})\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I),
    re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})\b"),
]
STATED_CUE = re.compile(r"(updated|revised|rev\.?|effective|amended|issued|dated|as of|eff\.?|last modified|posted|published)", re.I)


def _month_num(s: str) -> int | None:
    s = s.lower().rstrip(".")
    for name, n in MONTHS.items():
        if name.startswith(s[:3]) and name.startswith(s[: min(len(s), 4)]) or name == s:
            return n
    return None


def parse_date(text: str) -> tuple[str | None, str | None]:
    """(date as printed, ISO date). Only a full day-month-year printed in the text counts; month-only or year-only text gives
    (printed text, None) when a cue word such as 'updated' or 'revised' precedes it, else (None, None)."""
    t = clean(text)
    m = DATE_PATTERNS[0].search(t)
    if m:
        mon = _month_num(m.group(1))
        if mon:
            try:
                return m.group(0), f"{int(m.group(3)):04d}-{mon:02d}-{int(m.group(2)):02d}"
            except ValueError:
                pass
    m = DATE_PATTERNS[1].search(t)
    if m:
        mon, day, year = int(m.group(1)), int(m.group(2)), m.group(3)
        year = int(year) + 2000 if len(year) == 2 else int(year)
        if 1 <= mon <= 12 and 1 <= day <= 31 and 1990 <= year <= 2100:
            return m.group(0), f"{year:04d}-{mon:02d}-{day:02d}"
    cue = STATED_CUE.search(t)
    if cue:
        m = re.search(rf"\b({MONTH_RE})\s+(\d{{4}})\b", t[cue.start():], re.I)
        if m:
            return m.group(0), None
    return None, None


FILE_EXT = re.compile(r"\.(pdf|docx?|rtf|wpd|odt|xlsx?|pptx?|txt|zip)(?:$|[?#])", re.I)
FILE_PATH = re.compile(r"(/sites/[^/]+/files/|/files?/\d+|/file/|/docs?/|/documents?/|/pdfs?/|/download|/_?uploads?/|/media/|/attachments?/|/sites/default/files)", re.I)
IMAGE_EXT = re.compile(r"\.(jpe?g|png|gif|svg|webp|ico|bmp|mp3|mp4|mov|wmv|avi|vcf|ics)(?:$|[?#])", re.I)

PRACTICE_WORDS = re.compile(
    r"(practices?|procedures?|standing order|individual rules?|chambers rules?|preferences|requirements|guidelines|policy|policies|"
    r"scheduling order|case management|protective order|model order|proposed order|trial|pretrial|pre-trial|discovery|motion|"
    r"civil|criminal|bankruptcy|adversary|chapter\s*\d+|orders?|instructions|forms?|rules?|checklist|sample|template|letter|"
    r"settlement|mediation|consent|jury|exhibits?|sentencing|plea|hearings?|telephon|remote|video|zoom|electronic|courtroom)", re.I)
NOT_PRACTICE_TEXT = re.compile(
    r"(law clerk|\bintern(ship)?s?\b|hiring|employment|vacancy|biograph|\bbio\b|resume|curriculum|\bcv\b|calendar|seminar|disclos|portrait|"
    r"photo|press release|newsletter|honor roll|investiture|ceremon|directory|phone list|e-?mail address|contact information)", re.I)
HTML_LINK_WORDS = re.compile(
    r"(practices|procedures|standing orders?|individual rules?|chambers rules?|rules of|preferences|requirements|guidelines|"
    r"civil (?:cases|case|practices)|criminal (?:cases|case|practices)|courtroom (?:rules|procedures|policies)|trial procedures|"
    r"case management|judge.s (?:rules|procedures|practices|preferences|page))", re.I)


def file_ext(url: str) -> str | None:
    path = urllib.parse.urlparse(url).path
    m = re.search(r"\.([A-Za-z0-9]{2,5})$", path)
    if m and m.group(1).lower() in ("pdf", "doc", "docx", "rtf", "wpd", "odt", "xls", "xlsx", "ppt", "pptx", "txt", "zip", "htm", "html", "php", "aspx", "asp", "cfm", "jsp"):
        return m.group(1).lower()
    return None


@dataclass
class DocLink:
    title: str
    url: str
    date_text: str | None
    date: str | None
    kind: str                 # "file" | "page"
    file_type: str | None     # pdf, docx, ... or "html"
    heading: str | None
    note: str | None = None


GENERIC_LINK = re.compile(r"^\(?\[?(?:pdf|doc|docx|word|rtf|wpd|xls|xlsx|download|view|open|click here|here|link|file|read more|more|form|print|"
                          r"adobe|acrobat|ms word|word document|pdf document)\]?\)?(?:\s*[,\-]?\s*[\d.,]+\s*(?:kb|mb))?$", re.I)
FILETYPE_TOKEN = re.compile(r"\(?\[?\b(?:pdf|docx?|word|rtf|wpd|xlsx?)\b\]?\)?(?:\s*[,\-]?\s*[\d.,]+\s*(?:kb|mb))?", re.I)


def title_from_block(link: "Link") -> str:
    """Title for a link whose own text is only "(PDF)" or "here": the surrounding row or item text with file-type tokens removed."""
    block = link.block
    if not block:
        return ""
    t = FILETYPE_TOKEN.sub(" ", block)
    t = re.sub(r"\s+(?:here|click here|download|view)\b", " ", t, flags=re.I)
    return clean(t).strip(" -:;,|")


def clean_doc_title(text: str) -> str:
    t = clean(text)
    t = re.sub(r"\s*\(?\b(?:pdf|docx?|rtf|wpd)\b[,\s]*[\d.,]+\s*(?:kb|mb|bytes?)\)?\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+(?:pdf|docx?|rtf)\s*,?\s*[\d.,]+\s*(?:kb|mb)\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*\[\s*(?:pdf|docx?)[^\]]*\]\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*\((?:pdf|docx?|rtf)(?:[^)]*)\)\s*$", "", t, flags=re.I)
    return clean(t)


def date_beside(link: Link) -> tuple[str | None, str | None]:
    """A date printed beside the link (same list item or row) after removing the link text itself; never a date from a file name."""
    block = link.block
    if not block:
        return None, None
    rest = block.replace(link.text, " ", 1) if link.text and link.text in block else block
    d = parse_date(rest)
    if d != (None, None):
        return d
    return parse_date(link.text)


def document_links(links: list[Link], page_url: str, site_host: set[str], *, judge_urls: set[str] | None = None,
                   page_doc_regex: str | None = None) -> tuple[list[DocLink], list[dict]]:
    """Document links on a judge page: files by extension or path, plus ordinary pages whose link text names practices, procedures,
    standing orders or rules. Returns (documents, excluded) where excluded lists links skipped and why (audit)."""
    docs: list[DocLink] = []
    excluded: list[dict] = []
    seen: set[str] = set()
    judge_urls = judge_urls or set()
    for ln in links:
        if ln.chrome:
            continue
        host = urllib.parse.urlparse(ln.href).netloc.lower()
        if ln.href in seen or ln.href == page_url:
            continue
        text = clean_doc_title(ln.text)
        if not text or GENERIC_LINK.match(text):
            text = clean_doc_title(title_from_block(ln))
            if len(text) > 200:
                text = text[:200].rsplit(" ", 1)[0]
        if not text:
            continue
        is_file = bool(FILE_EXT.search(ln.href)) or (bool(FILE_PATH.search(urllib.parse.urlparse(ln.href).path)) and not IMAGE_EXT.search(ln.href))
        if IMAGE_EXT.search(ln.href):
            continue
        if host not in site_host:
            if is_file and FILE_EXT.search(ln.href) and host.endswith(".uscourts.gov"):
                pass
            else:
                continue
        if is_file:
            if NOT_PRACTICE_TEXT.search(text):
                excluded.append({"url": ln.href, "title": text, "reason": "not a practice document (title)"})
                continue
            ext = file_ext(ln.href) or "file"
            ds, di = date_beside(ln)
            seen.add(ln.href)
            docs.append(DocLink(title=text, url=ln.href, date_text=ds, date=di, kind="file", file_type=ext, heading=ln.heading))
        elif ((HTML_LINK_WORDS.search(text) or (page_doc_regex and re.search(page_doc_regex, ln.href) and PRACTICE_WORDS.search(text)))
              and ln.href not in judge_urls and not NOT_PRACTICE_TEXT.search(text)):
            ds, di = date_beside(ln)
            seen.add(ln.href)
            docs.append(DocLink(title=text, url=ln.href, date_text=ds, date=di, kind="page", file_type="html", heading=ln.heading))
    return docs, excluded


# --------------------------------------------------------------------------------------------------------------------------
# judge pages


def former_reason(text: str, today: datetime.date | None = None) -> str | None:
    """Why a judge page is about a former judge, from words the page itself prints (an appointment end date in the past, "Active: No", a death,
    a service range such as "(1823-1871)" in the heading); None when nothing says so."""
    today = today or datetime.date.today()
    head = clean(text)[:2500]
    m = re.search(r"Appointment End Date:\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})", head)
    if m:
        mon = _month_num(m.group(1))
        if mon:
            try:
                if datetime.date(int(m.group(3)), mon, int(m.group(2))) < today:
                    return f"the page prints an appointment end date in the past ({m.group(0).split(':', 1)[1].strip()})"
            except ValueError:
                pass
    if re.search(r"\bActive:\s*No\b", head):
        return "the page prints 'Active: No'"
    if re.search(r"\b(?:died|passed away|deceased)\b", head[:1200], re.I):
        return "the page reports the judge's death"
    if re.search(r"\(\s*(?:17|18|19|20)\d\d\s*[-\u2013\u2014]\s*(?:17|18|19|20)\d\d\s*\)", head[:300]):
        return "the heading prints a service range in years"
    return None


@dataclass
class JudgePage:
    url: str
    name_as_published: str | None
    name: str | None
    title_as_published: str | None
    title_source: str | None
    title_class: str | None
    title_basis: str | None
    page_title: str | None
    documents: list[DocLink] = field(default_factory=list)
    excluded: list[dict] = field(default_factory=list)
    subpages: list[str] = field(default_factory=list)
    former: str | None = None


def page_heading(soup: BeautifulSoup) -> str | None:
    root = main_root(soup)
    for h in [*root.find_all("h1"), *root.find_all("h2")]:
        if in_chrome(h, root):
            continue
        t = clean(h.get_text(" "))
        if t:
            return t
    return None


def page_title(soup: BeautifulSoup) -> str | None:
    t = soup.find("title")
    if not t:
        return None
    text = clean(t.get_text(" "))
    return re.split(r"\s+[|–—]\s+|\s+-\s+(?=[A-Z])", text)[0].strip() or None


def header_block(soup: BeautifulSoup, h1: Tag | None, cap: int = 320) -> str:
    """Visible text right after the page heading (outside links and site chrome): where sites print "United States District Judge for ..."."""
    if h1 is None:
        return ""
    parts: list[str] = []
    total = 0
    for node in h1.next_elements:
        if isinstance(node, Tag) and (node.name in ("nav", "footer", "aside", "form", "table") or HEADING.match(node.name or "") and node is not h1):
            if node.name != "h1" and total:
                break
        if not isinstance(node, NavigableString):
            continue
        if node.find_parent("a") is not None or node.find_parent(["script", "style"]) is not None:
            continue
        t = clean(str(node))
        if not t:
            continue
        parts.append(t)
        total += len(t)
        if total >= cap:
            break
    return " ".join(parts)[:cap]


COURT_WORD = re.compile(r"district|magistrate|bankruptcy|article iii|circuit", re.I)


def pick_title(evidence: list[tuple[str, str | None]]) -> tuple[str | None, str | None]:
    """The most specific printed title among the evidence: a phrase naming the court level beats one that does not, then the one with
    more title words ("Chief U.S. District Judge" beats "Chief Judge"), then the earlier source. A bare "Judge" is the last resort,
    and a bare "Judges" heading is never a title."""
    best: tuple[tuple[int, int, int], str, str] | None = None
    bare: tuple[str, str] | None = None
    for i, (src, text) in enumerate(evidence):
        phrase = role_phrase(text) if text else None
        if not phrase:
            continue
        if phrase.lower() in ("judge", "judges"):
            if bare is None and not (src.startswith("listing") and src != "listing link text"):
                bare = (phrase, src)
            continue
        if src.startswith("listing") and src != "listing link text":
            continue  # headings are considered separately (they describe a group, not this judge)
        score = (1 if COURT_WORD.search(phrase) else 0, len(phrase.split()), -i)
        if best is None or score > best[0]:
            best = (score, phrase, src)
    if best:
        return best[1], best[2]
    return bare if bare else (None, None)


def listing_heading_title(headings: tuple[str, ...]) -> str | None:
    """Deepest listing heading that names judges ("Magistrate Judges", "Senior Article III Judges")."""
    for h in reversed(headings):
        if re.search(r"\bjudges?\b|judicial officers?", h, re.I) and len(h) <= 70:
            return h
    return None


def decide_title(page_evidence: list[tuple[str, str | None]], entry: Entry | None, court_level: str | None
                 ) -> tuple[str | None, str | None, str | None, str | None]:
    """(title as published, where it was read, title class, basis) from the evidence on the judge's page and in the listing entry."""
    evidence: list[tuple[str, str | None]] = []
    if entry and entry.role_text:
        evidence.append(("listing link text", entry.role_text))
    if entry and entry.menu_role:
        evidence.append(("site menu link text", entry.menu_role))  # the site's own menu entry for this judge
    evidence.extend(page_evidence)
    page_title_text, title_source = pick_title(evidence)
    if entry and (page_title_text is None or page_title_text.lower() in ("judge", "judges")):
        circ = next((h for h in reversed(entry.headings) if re.search(r"court of appeals|\bcircuit\b", h, re.I) and len(h) <= 90), None)
        if circ:  # listed under another court's heading ("U.S. Court of Appeals for the First Circuit"): not a judge of this court
            return circ, "listing heading", "other", "listing"
    listing_text = None
    if entry:
        for cand in (listing_heading_title(entry.headings), entry.listing_title):
            ph = role_phrase(cand) if cand else None
            if ph and ph.lower() not in ("judge", "judges") and (COURT_WORD.search(ph) or (is_group_label(cand) and re.search(r"\b(?:senior|chief|sitting by designation|visiting)\b", ph, re.I))):
                listing_text = cand
                break
    title_text, basis_note = page_title_text, None
    if page_title_text is None or not COURT_WORD.search(page_title_text):
        if listing_text:
            if page_title_text and page_title_text.lower() not in ("judge", "judges"):
                basis_note = "listing"  # modifiers from the page, court level from the listing heading it sits under
            else:
                title_text = listing_text
                title_source = "listing heading" if listing_text == listing_heading_title(entry.headings) else "listing page heading"
                basis_note = "listing"
    class_text = " ".join(x for x in (page_title_text if title_text == page_title_text else None, listing_text if basis_note else None) if x) or title_text
    tclass, basis = classify_title(class_text, court_level)
    if basis_note == "listing" and basis == "text":
        basis = "listing"
    if tclass is None and court_level == "bankruptcy":
        tclass, basis = "bankruptcy_judge", "court_type"  # listed on a bankruptcy court's own site; no title words printed
    return title_text, title_source, tclass, basis


def entry_only_judge(entry: Entry, court_level: str | None) -> JudgePage:
    """A judge known only from a listing (no page of his or her own): name and title as the listing prints them, no documents."""
    name_src = clean(entry.name_text)
    title_text, title_source, tclass, basis = decide_title([("listing entry text", name_src)], entry, court_level)
    return JudgePage(url=entry.url, name_as_published=name_src, name=strip_name(reorder_last_first(name_src)), title_as_published=title_text,
                     title_source=title_source, title_class=tclass, title_basis=basis, page_title=None)


NAV_WORDS = re.compile(r"\b(?:judge|judges|chief|senior|district|magistrate|bankruptcy|united|states|court|home|calendars?|opinions?|chambers|procedures?|"
                       r"biograph\w*|contact|information|search|menu|clerk|visiting|hearings?|schedule)\b", re.I)


def full_name_from_text(text: str, surname: str) -> tuple[str, str] | None:
    """(as printed, name) when a judge known only by surname has one full name printed with an honorific or "Judge" in the given text
    ("Judge Brenda T. Rhoades"); None when the text prints none, or more than one different name ending in that surname."""
    rx = re.compile(r"\b(Hon\.?|Honorable|Judge)\s+((?:[A-Z][\w'’\-]*\.?\s+){1,3}" + re.escape(surname) + r")\b")
    found: dict[str, tuple[str, str]] = {}
    for m in rx.finditer(text):
        toks = m.group(2).split()
        while len(toks) > 2 and toks[0].strip(".").lower() == surname.lower():  # "Maddox Selene D. Maddox": the first word is the neighbouring menu item
            toks = toks[1:]
        cand = " ".join(toks)
        if len(toks) < 2 or toks[0].strip(".").lower() == surname.lower() or NAV_WORDS.search(cand) or not person_like(cand):
            continue
        found.setdefault(norm_name(cand), (clean(f"{m.group(1)} {cand}"), cand))
    return next(iter(found.values())) if len(found) == 1 else None


def parse_judge_page(body: bytes, url: str, *, court_level: str | None = None, entry: Entry | None = None,
                     site_hosts: set[str] | None = None, page_doc_regex: str | None = None) -> JudgePage:
    soup = soup_of(body)
    root = main_root(soup)
    h1_el = next((h for h in root.find_all("h1") if not in_chrome(h, root) and clean(h.get_text(" "))), None) \
        or next((h for h in root.find_all(["h2", "h3"]) if not in_chrome(h, root) and clean(h.get_text(" ")) and
                 not re.match(r"^(?:you are here|judge tabs|contact|quick ?links|navigation)", clean(h.get_text(" ")), re.I)), None)
    h1 = clean(h1_el.get_text(" ")) if h1_el else None
    ptitle = page_title(soup)
    links = extract_links(soup, url)
    hosts = site_hosts or {urllib.parse.urlparse(url).netloc.lower()}

    heads = [clean(h.get_text(" ")) for h in root.find_all(["h1", "h2", "h3"]) if not in_chrome(h, root)]
    judge_heads = [h for h in heads if h and (looks_like_judge_link(h) or role_phrase(h)) and len(h) < 120]
    crumb = next((clean(t.get_text(" ")) for t in root.find_all(["strong", "b", "p", "div", "span", "li"])
                  if not in_chrome(t, root) and ">" in t.get_text() and re.search(r"\bjudge\b", t.get_text(), re.I)
                  and len(clean(t.get_text(" "))) < 140 and not t.find(["p", "div", "li", "ul"])), None)  # "HOME >> JUDGES > CHIEF JUDGE JACOB A. BROWN"
    name_src, name = resolve_name([h1 if h1 and (looks_like_judge_link(h1) or role_phrase(h1) or is_person_name(h1)) else None,
                                   entry.name_text if entry else None, ptitle if ptitle and looks_like_judge_link(ptitle) else None,
                                   *judge_heads, clean(crumb.rsplit(">", 1)[-1]) if crumb else None, h1, ptitle])
    if name and len(name.split()) == 1:  # only a surname so far ("Judge Rhoades"): take the full name when the page itself prints it once, near the top
        full = full_name_from_text(clean(root.get_text(" "))[:2500], name)
        if full:
            name_src, name = full

    evidence: list[tuple[str, str | None]] = []
    evidence.append(("judge page heading", h1))
    evidence.append(("judge page text below the heading", header_block(soup, h1_el)))
    evidence.append(("judge page title", ptitle))
    title_text, title_source, tclass, basis = decide_title(evidence, entry, court_level)
    docs, excluded = document_links(links, url, hosts, page_doc_regex=page_doc_regex)
    return JudgePage(url=url, name_as_published=name_src, name=name, title_as_published=title_text,
                     title_source=title_source, title_class=tclass, title_basis=basis, page_title=ptitle, documents=docs, excluded=excluded,
                     former=former_reason(root.get_text(" ")))


# --------------------------------------------------------------------------------------------------------------------------
# overrides for sites whose judge pages are not found by link text


def row_docs(soup: BeautifulSoup, base_url: str, href: str, heading: str | None = None) -> list[Link]:
    """The other links in the table row or list item that holds the link to `href` (a judge's row: "view procedures", "forms")."""
    for a in soup.find_all("a", href=True):
        if absolute(base_url, a["href"]) != href:
            continue
        row = a.find_parent(["tr", "li"])
        if row is None:
            return []
        others = [t for t in row.find_all("a", href=True) if t is not a and absolute(base_url, t["href"]) != href]
        return _anchor_links(others, base_url, heading)
    return []


def regex_entries(links: list[Link], regex: str, exclude: str | None = None, main_only: bool = False, heading: str | None = None) -> list[Entry]:
    """Links (anywhere on the page, menus included) whose address matches `regex`: for sites whose judge links read only "Biography".
    With `heading`, only links that sit under a heading (or menu group label) matching it."""
    rx = re.compile(regex)
    ex = re.compile(exclude) if exclude else None
    hx = re.compile(heading, re.I) if heading else None
    seen: dict[str, Entry] = {}
    for ln in links:
        if is_home(ln.href) or FILE_EXT.search(ln.href) or not rx.search(ln.href) or (ex and ex.search(ln.href)) or (main_only and ln.chrome):
            continue
        if hx and not any(hx.search(h or "") for h in (ln.headings or (ln.heading,))):
            continue
        named = looks_like_judge_link(ln.text) or is_person_name(ln.text) or bool(re.match(r"^[A-Z][A-Za-z'’\-]+,\s+[A-Z]", ln.text or ""))
        text = ln.text if named else ""
        role = (role_phrase(text) if text else None) or (role_phrase(ln.block) if ln.block and len(ln.block) < 200 else None)
        e = Entry(name_text=text, url=ln.href, heading=ln.heading, headings=ln.headings, role_text=role, block=ln.block)
        if ln.href not in seen or (text and not seen[ln.href].name_text):
            seen[ln.href] = e
    return list(seen.values())


LAST_FIRST = re.compile(r"^([A-Z][A-Za-z'’\-]+(?:\s+(?:van|von|de|del|la|di|da|le|[A-Z][A-Za-z'’\-]+))?),\s+([A-Z][A-Za-z'’.\- ]+?)(?:,?\s+(Jr\.?|Sr\.?|II|III|IV))?$")


def reorder_last_first(name: str) -> str:
    """"Bachus, Alison S." -> "Alison S. Bachus"; any other text is returned unchanged."""
    m = LAST_FIRST.match(clean(name))
    if not m or re.search(r"judge|court", name, re.I):
        return name
    out = f"{m.group(2).strip()} {m.group(1)}"
    return f"{out}, {m.group(3)}" if m.group(3) else out


_JUDGE_LINE = [
    re.compile(r"^(?:the\s+)?(?:hon\.?|honorable)\s+(?P<name>[^,()]+?)(?:,?\s+(?:jr\.?|sr\.?|ii|iii|iv))?"
               r"(?:(?:,\s*|\s[-\u2013\u2014]\s+)(?P<role>[^()]*\bjudge\b.*?))?$", re.I),  # "Hon. A B, Chief Judge" and "Hon. A B - Chief Judge"
    re.compile(r"^(?P<role>(?:(?:chief|senior|sr\.?|mag\.?|u\.?\s?s\.?|united states|district|magistrate|bankruptcy|visiting|recalled)\s+)*)judge\s+"
               r"(?P<name>[^,()]+?)(?:,\s*(?:jr\.?|sr\.?|ii|iii|iv))?$", re.I),
    re.compile(r"^(?P<name>[^,()]+?),\s*(?P<role>(?:(?:chief|senior|u\.?\s?s\.?|united states|district|magistrate|bankruptcy)\s+)*judge\b.*)$",
               re.I),
]
_BLOCKS = ("li", "p", "td", "th", "dd", "dt", "div", "span", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "a", "strong", "b", "blockquote")


def _anchor_links(anchors: list[Tag], base_url: str, heading: str | None) -> list[Link]:
    out = []
    for a in anchors:
        href = absolute(base_url, a.get("href") or "")
        if not href:
            continue
        text = clean(a.get_text(" ")) or clean(a.get("title") or a.get("aria-label") or "")
        out.append(Link(text=text, href=href, chrome=False, heading=heading, headings=(heading,) if heading else (), block=_block_text(a),
                        title_attr=clean(a.get("title") or "")))
    return out


GROUP_LABEL = re.compile(r"^(?:(?:u\.?\s?s\.?|united states|active|senior|article iii|chief|district|bankruptcy|magistrate|court|full-time|part-time)\s+)*"
                         r"(?:judges?|judicial officers)(?:\s+sitting by designation)?$", re.I)


def br_lines(el: Tag) -> list[str]:
    """The text of a block split at its <br> tags, one cleaned line each (empty lines dropped)."""
    out = [""]
    for node in el.descendants:
        if isinstance(node, NavigableString):
            out[-1] += str(node)
        elif isinstance(node, Tag) and node.name == "br":
            out.append("")
    return [x for x in (clean(t) for t in out) if x]


def is_group_label(text: str) -> bool:
    """A line that labels a group of judges ("U.S. District Court Magistrate Judges", "Senior Judges"), as opposed to a judge."""
    t = clean(text)
    if len(t) < 90 and re.match(r"^(?:u\.?\s?s\.?\s+)?court of appeals\b", t, re.I):  # judges of another court listed on the page ("U.S. Court of Appeals ...")
        return True
    return len(t) < 60 and bool(GROUP_LABEL.match(t)) and bool(re.search(r"district|bankruptcy|magistrate|senior|chief|designation|visiting", t, re.I))


def _judge_name(text: str, split: bool) -> str | None:
    """The judge's name when a line of text reads as a judge ("Hon. Brenda K. Sannes, Chief U.S. District Judge", "Judge Richard Schell")."""
    if not 6 <= len(text) <= 110 or (text.endswith((".", ";")) and not re.search(r"\b[A-Z]\.$|Jr\.$|Sr\.$", text)):
        return None
    match_text = re.sub(r"\s*\([^)]*\)\s*$", "", text) if split else text  # "(Recall Status)" after a name
    for rx in _JUDGE_LINE:
        m = rx.match(match_text)
        if not m:
            continue
        name = clean(m.group("name"))
        if not re.match(r"^[A-ZÀ-ÖØ-Þ][\w'’.\-]+(?:\s+[A-ZÀ-ÖØ-Þ][\w'’.\-]+){1,5}$", name):  # accented letters are letters (Raúl, María)
            continue
        if PERSON_STOP.search(name) and not re.search(r"\b(?:de|la|van|von)\b", name):
            continue
        return name
    return None


def text_roster(body: bytes | BeautifulSoup, base_url: str, *, scope: str = "main") -> list[Entry]:
    """Judges named only in the text of a listing (no page of their own): lines such as "Hon. Brenda K. Sannes, Chief U.S. District Judge"
    or "Judge Richard Schell". The entry's address is the listing page itself (with a fragment naming the judge).

    When the line is a heading (or a bold line of its own) the links that follow it, up to the next heading of the same or higher rank or the
    next judge line, are that judge's own documents (a court's "chambers rules" page lists each judge with his or her documents under the
    name); when the line sits in a table row or list item, the links in the same row or item are."""
    soup = body if isinstance(body, BeautifulSoup) else soup_of(body)
    root = main_root(soup) if scope == "main" else (soup.body or soup)
    flat = [e for e in root.descendants if isinstance(e, Tag)]
    stack: dict[int, str] = {}
    found: list[tuple[int, Tag, str, str, str, int | None, tuple[str, ...], bool]] = []   # index, element, text, name, role, section level, headings, from a <br> line
    for i, el in enumerate(flat):
        level: int | None = None
        if HEADING.match(el.name or ""):
            level = int(el.name[1])
            for k in [k for k in stack if k >= level]:
                del stack[k]
            if clean(el.get_text(" ")):
                stack[level] = clean(el.get_text(" "))
        elif el.name not in _BLOCKS or el.find(["li", "p", "td", "tr", "div", "h1", "h2", "h3", "h4"]):
            continue
        lines = [(clean(el.get_text(" ")), False)]
        if el.find("br") and level is None:
            cand = br_lines(el)
            if sum(1 for t in cand if _judge_name(t, True)) >= 2:  # "Hon. A<br>Hon. B<br>Hon. C": one judge to a line
                lines = [(t, True) for t in cand]
        for text, split in lines:
            if is_group_label(text):
                if level is None:  # a heading is already in the stack at its own level
                    for k in [k for k in stack if k >= 6]:
                        del stack[k]
                    stack[6] = text  # a group label that is not a heading ("District Judges", "Mag. Judges") above the names listed under it
                continue
            name = _judge_name(text, split)
            if name:
                lvl = level
                if lvl is None and not split and el.name in ("strong", "b", "p") and not el.find_parent(["li", "td", "tr"]):
                    lvl = 7  # a bold line standing alone heads what follows it
                found.append((i, el, text, name, role_phrase(text) or "", lvl, tuple(stack[k] for k in sorted(stack)), split))
    seen: dict[str, Entry] = {}
    starts = [f[0] for f in found]
    row_judges: dict[int, set[str]] = {}
    for f in found:
        r_ = f[1].find_parent(["tr", "li"])
        if r_ is not None:
            row_judges.setdefault(id(r_), set()).add(norm_name(f[3]))
    row_counts = {k: len(v) for k, v in row_judges.items()}  # judges named in each row (a judge named twice in one row counts once)
    for n, (i, el, text, name, role, level, headings, split) in enumerate(found):
        key = norm_name(name)
        if key in seen:
            continue
        docs: list[Link] = []
        if split:
            pass  # one of several judges in one paragraph: the links nearby do not belong to any one of them
        elif level is not None:
            end = len(flat)
            nxt = starts[n + 1] if n + 1 < len(starts) else len(flat)
            for j in range(i + 1, len(flat)):
                t = flat[j]
                if HEADING.match(t.name or "") and int(t.name[1]) <= min(level, 6):
                    end = j
                    break
                if j >= nxt:
                    end = j
                    break
            anchors = [t for t in flat[i + 1:end] if t.name == "a" and t.get("href") and not in_chrome(t, root)]
            docs = _anchor_links(anchors, base_url, text)
        else:
            row = el.find_parent(["tr", "li"])
            if row is not None and row_counts.get(id(row), 0) <= 1:  # a row that names several judges does not say whose its links are
                anchors = [t for t in row.find_all("a", href=True) if el not in t.parents and t is not el]
                docs = _anchor_links(anchors, base_url, text)
        slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")
        e = Entry(name_text=text, url=f"{base_url.split('#')[0]}#{slug}", heading=headings[-1] if headings else None, headings=headings,
                  role_text=role or None, block=text)
        e.docs = docs
        seen[key] = e
    return list(seen.values())
