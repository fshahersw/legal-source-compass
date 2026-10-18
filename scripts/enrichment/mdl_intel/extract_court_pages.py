"""Extract quoted facts from official transferee-court MDL pages.

Nothing is paraphrased: every stored statement is a verbatim (whitespace-normalised) sentence, list item or table row
from the page, with its page URL and retrieval date. Orders are links whose anchor text names an order; their date is
the date printed in the same table row / list item (kept as printed, plus ISO when unambiguous).
"""
import hashlib
import re
import urllib.parse
from datetime import date

from bs4 import BeautifulSoup

MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
MON_ABBR = {k[:3]: v for k, v in MONTHS.items()}

class _Leadership:
    """Leadership statements must name a leadership role or an appointment of counsel / leadership / a committee
    (so logistics sentences that merely mention liaison counsel are not counted)."""

    ROLE = re.compile(r"\b(lead counsel|co-lead|steering committee|executive committee|leadership committee)\b", re.I)
    APPOINT = re.compile(r"(?:re)?appoint\w*", re.I)
    OBJECT = re.compile(r"\b(counsel|leadership|committee|liaison)\b", re.I)

    def search(self, s):
        return self.ROLE.search(s) or (self.APPOINT.search(s) and self.OBJECT.search(s))


CATEGORIES = {
    "leadership": _Leadership(),
    "bellwether": re.compile(r"\b(bellwether|pilot (?:case|trial)s?|trial (?:date|setting|pool|selection)|first trial|trials? (?:is|are|will be) (?:set|scheduled))\b", re.I),
    "settlement": re.compile(r"\b(settlement|settled|qualified settlement fund|lien resolution|claims administrator|master settlement)\b", re.I),
}

RE_ORDER_TITLE = re.compile(r"\b(case management order|cmo|pretrial order|pre-trial order|pto|practice and procedure order|common benefit order|transfer order|scheduling order|order no\.?|order \#|amended order|protective order|docket management order)\b", re.I)

DATE_PATTERNS = [
    (re.compile(r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b"), "mdy_long"),
    (re.compile(r"\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),\s*(\d{4})\b"), "mdy_abbr"),
    (re.compile(r"(?<![\d.])(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?![\d])"), "mdy_num"),
    (re.compile(r"(?<!\d)(\d{4})\.(\d{2})\.(\d{2})(?!\d)"), "ymd_dot"),
]


def parse_date(text: str):
    """First unambiguous date printed in text -> (printed, iso). US month/day order for numeric dates (US courts)."""
    for pattern, kind in DATE_PATTERNS:
        m = pattern.search(text or "")
        if not m:
            continue
        try:
            if kind == "mdy_long":
                d = date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
            elif kind == "mdy_abbr":
                d = date(int(m.group(3)), MON_ABBR[m.group(1).lower()[:3]], int(m.group(2)))
            elif kind == "mdy_num":
                d = date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
            else:
                d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            continue
        if 1990 <= d.year <= 2035:
            return m.group(0), d.isoformat()
    return None, None


def all_dates(text: str):
    out = []
    for pattern, kind in DATE_PATTERNS[:2]:
        for m in pattern.finditer(text or ""):
            p, iso = parse_date(m.group(0))
            if iso:
                out.append(iso)
    return sorted(set(out))


def norm(s: str) -> str:
    return " ".join((s or "").split())


def sentences(block: str):
    block = norm(block)
    if len(block) <= 420:
        return [block]
    parts = re.split(r"(?<=[.;])\s+(?=[A-Z(“\"])", block)
    return [p for p in parts if p]


CONTENT_SELECTORS = ["main", "[role=main]", "#main-content", ".l-content", "div.region-content", ".node__content", "article", "#content", "div#main", "#main"]


def main_region(soup):
    best, best_len = None, 0
    for sel in CONTENT_SELECTORS:
        for node in soup.select(sel):
            n = len(norm(node.get_text(" ")))
            if n > best_len:
                best, best_len = node, n
    return best if best is not None and best_len > 150 else (soup.body or soup)


def scoped_roots(soup, mdl):
    """Pages that host several MDLs in tabbed sections (ids like 'MDL3029-orders') are scoped to that MDL's sections."""
    if not mdl:
        return None
    sections = soup.find_all(id=re.compile(rf"^MDL{mdl}(?:-(?!.*-tab$).+)?$"))
    sections = [s for s in sections if not s.get("id", "").endswith("-tab")]
    return sections or None


def sub_page_links(html: bytes, url: str, mdl: int):
    """Same-host links from an MDL hub page whose anchor names orders, schedules, counsel or leadership."""
    soup = BeautifulSoup(html, "lxml")
    host = urllib.parse.urlparse(url).netloc
    out = []
    for a in soup.find_all("a", href=True):
        href = urllib.parse.urljoin(url, a["href"].strip()).split("#")[0]
        anchor = norm(a.get_text(" "))
        p = urllib.parse.urlparse(href)
        if p.netloc != host or href.rstrip("/") == url.rstrip("/") or href.lower().endswith((".pdf", ".doc", ".docx")):
            continue
        if re.search(r"/(court-info|standing-orders|sample-pre-trial-orders|local-rules|forms|judges?|attorney|jury|news$|contact-us)", p.path, re.I):
            continue
        if p.path.rstrip("/") == urllib.parse.urlparse(url).path.rstrip("/"):
            continue  # same page with a different query string (tabs / pagers)
        if re.search(r"\b(no\.?|number)\s*\d", anchor, re.I):
            continue  # an individual order's page, not a list
        if re.search(r"\b(orders?|opinions?|schedul\w*|upcoming|proceedings|counsel|contacts?|leadership|bellwether|trials?|settlement|developments|hearing dates|important documents|case management)\b", anchor, re.I):
            out.append((anchor, href))
    seen, uniq = set(), []
    for anchor, href in out:
        if href not in seen:
            seen.add(href)
            uniq.append({"anchor": anchor[:120], "url": href})
    return uniq[:8]


GENERIC_SLUG = {"litigation", "products", "product", "liability", "marketing", "sales", "practices", "orders", "order", "content", "cases", "management", "court", "proceedings", "scheduling", "opinions", "panel", "information", "multidistrict", "district"}


def shares_slug(sub_url: str, hub_url: str) -> bool:
    """True when the sub-page path shares a distinctive (>=5 letters, non-generic) token with the hub page's own slug
    (the last path segment), e.g. 'talcum' in /j-j-talcum-powder-orders vs /johnson-johnson-talcum-powder-litigation."""
    tok = lambda path: {t for t in re.split(r"[^a-z]+", path.lower()) if len(t) >= 5 and t not in GENERIC_SLUG}
    hub_slug = urllib.parse.urlparse(hub_url).path.rstrip("/").rsplit("/", 1)[-1]
    return bool(tok(urllib.parse.urlparse(sub_url).path) & tok(hub_slug))


RE_ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr\s*>", re.I | re.S)
RE_CELL_SPLIT = re.compile(r"<t[dh]\b", re.I)
RE_SHORT_DATE = re.compile(r"^\s*(\d{1,2})-(\d{1,2})-(\d{2})\s*$")  # CAND docket tables print MM-DD-YY
RE_ORDERISH = re.compile(r"^\s*(?:\[?\w+\]?\s+){0,3}order\b|\border (?:granting|denying|re\b|regarding|on\b|for\b|appointing|setting|selecting|adopting|directing|establishing|vacating|extending|governing|relating|to show cause)", re.I)
RE_NOT_ORDER = re.compile(r"transcript order|proposed order|\[proposed\]|^\s*notice of|^\s*motion\b|^\s*(?:plaintiffs?'?|defendants?'?)\s", re.I)


def is_order_title(text: str) -> bool:
    return bool(text) and not RE_NOT_ORDER.search(text) and bool(RE_ORDER_TITLE.search(text) or RE_ORDERISH.search(text))


def cell_date(cell: str):
    """Date printed in one table cell: long/numeric US formats, or CAND's MM-DD-YY."""
    printed, iso = parse_date(cell)
    if iso:
        return printed, iso
    m = RE_SHORT_DATE.match(cell or "")
    if m:
        try:
            return m.group(0).strip(), date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
        except ValueError:
            return None, None
    return None, None


def raw_rows(html: str):
    """Table rows taken from the raw HTML one <tr> at a time and parsed in isolation, so a malformed tag in one row
    (e.g. '</td' without '>') or nested unquoted <a href=…> cannot merge rows or hide links."""
    for chunk in RE_ROW.findall(html):
        cells = [norm(BeautifulSoup("<td" + c, "html.parser").get_text(" ")) for c in RE_CELL_SPLIT.split(chunk)[1:]]
        links = []
        for m in re.finditer(r"<a\b[^>]*?href\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))[^>]*>(.*?)(?=<a\b|</a\s*>)", chunk, re.I | re.S):
            href = (m.group(1) or m.group(2) or m.group(3) or "").strip()
            text = norm(BeautifulSoup(m.group(4), "html.parser").get_text(" "))
            if href:
                links.append((href, text))
        yield cells, links


def row_order(cells, links, url):
    """One order from one table row: date from the row's first date cell; title from the order-like link text, or
    the description cell when the link text is only a docket number."""
    if not links:
        return None
    printed, iso = None, None
    for c in cells[:2]:
        printed, iso = cell_date(c)
        if iso:
            break
    best = None
    for href, text in links:
        if is_order_title(text):
            best = (href, text)
            break
    if not best:
        desc = max(cells, key=len) if cells else ""
        if is_order_title(desc):
            best = (links[0][0], desc)
    if not best:
        return None
    href, text = best
    return {"title": text[:240], "url": urllib.parse.urljoin(url, href), "row_text": " | ".join(cells)[:400], "date_printed": printed, "date": iso, "source": "table_row"}


def has_nested_blocks(node) -> bool:
    return node.find(["tr", "li", "p", "table", "dd", "ul", "ol"]) is not None


def extract(html: bytes, url: str, retrieved: str, mdl: int | None = None) -> dict:
    raw = html.decode("utf-8", "replace")
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()
    title = norm((soup.find("h1") or soup.find("title") or soup).get_text(" "))[:300]
    scoped = scoped_roots(soup, mdl)
    root = main_region(soup)
    roots = scoped or [root]
    blocks, orders, seen_blocks, seen_orders = [], [], set(), set()

    # 1) table rows, each parsed on its own from the raw HTML (skipped on multi-MDL pages scoped by section id)
    if not scoped:
        for cells, links in raw_rows(raw):
            text = " | ".join(c for c in cells if c)
            if text and len(text) >= 12 and text not in seen_blocks:
                seen_blocks.add(text)
                blocks.append({"tag": "tr", "text": text})
            o = row_order(cells, links, url)
            if o and o["url"] not in seen_orders:
                seen_orders.add(o["url"])
                orders.append(o)

    # 2) list items, paragraphs and headings that hold no nested blocks (no container-level text)
    nodes = [n for r in roots for n in r.find_all(["p", "li", "h2", "h3", "h4", "dd"] + (["tr"] if scoped else []))]
    for node in nodes:
        if node.find_parent("table") and not scoped:
            continue
        if node.name != "tr" and has_nested_blocks(node):
            continue
        text = norm(node.get_text(" "))
        if not text or len(text) < 12 or text in seen_blocks:
            continue
        seen_blocks.add(text)
        blocks.append({"tag": node.name, "text": text})
        for a in node.find_all("a", href=True):
            href = urllib.parse.urljoin(url, a["href"].strip())
            # some pages split one title across several links to the same file ("C" + "ase Management Order")
            anchor = norm("".join(x.get_text("") for x in node.find_all("a", href=True) if urllib.parse.urljoin(url, x["href"].strip()) == href))
            prev = a.previous_sibling
            prev_text = norm(prev.get_text("") if hasattr(prev, "get_text") else str(prev or ""))
            if anchor[:1].islower() and re.fullmatch(r"[A-Z]", prev_text[-1:] or "") and (len(prev_text) == 1 or prev_text[-2:-1] == " "):
                anchor = prev_text[-1] + anchor  # page splits the first letter into a separate link: "C" + "onditional Transfer Order"
            if not is_order_title(anchor) or href in seen_orders:
                continue
            printed, iso = parse_date(text)
            seen_orders.add(href)
            orders.append({"title": anchor[:240], "url": href, "row_text": text[:400], "date_printed": printed, "date": iso, "source": node.name})

    # a row text repeated on more than half of the page's orders is container text, not a row: its dates are void
    counts = {}
    for o in orders:
        counts[o["row_text"]] = counts.get(o["row_text"], 0) + 1
    for o in orders:
        if len(orders) >= 3 and counts[o["row_text"]] > len(orders) / 2:
            o["date"], o["date_printed"], o["date_void"] = None, None, "row text repeated across most orders"
        number = (re.search(r"\b(?:No\.?|Number|#)\s*([0-9]+[A-Z]?)\b", o["title"], re.I) or re.search(r"\b(?:CMO|PTO)\s*-?\s*([0-9]+[A-Z]?)\b", o["title"], re.I)
                  or re.search(r"\bOrder\s+([0-9]+[A-Z]?)\b", o["title"], re.I))
        o["number"] = number.group(1) if number else None
        o["kind"] = order_kind(o["title"])
        o["vacated"] = bool(re.match(r"\s*vacated\b", o["title"], re.I))

    quotes = []
    for b in blocks:
        for s in sentences(b["text"]):
            for cat, pattern in CATEGORIES.items():
                if pattern.search(s):
                    quotes.append({"category": cat, "text": s[:600], "dates_mentioned": all_dates(s)})
    page_text = " ".join(norm(r.get_text(" ")) for r in roots)
    return {
        "url": url, "retrieved": retrieved, "title": title, "sha256": hashlib.sha256(html).hexdigest(),
        "text_chars": len(page_text), "orders": orders, "quotes": dedupe(quotes), "blocks": len(blocks),
        "leadership_blocks": [b for r in roots for b in leadership_blocks(r)][:12], "scoped_sections": bool(scoped),
        "mentions_mdl": bool(mdl and re.search(rf"(?<!\d)0*{mdl}(?!\d)", page_text + " " + url)),
    }


def order_kind(title: str) -> str:
    t = title.lower()
    if "case management order" in t or re.search(r"\bcmo\b", t):
        return "case_management_order"
    if "pretrial order" in t or "pre-trial order" in t or re.search(r"\bpto\b", t):
        return "pretrial_order"
    if "common benefit" in t:
        return "common_benefit_order"
    if "transfer order" in t or "conditional transfer" in t:
        return "transfer_order"
    if "scheduling" in t:
        return "scheduling_order"
    return "other_order"


def dedupe(quotes):
    seen, out = set(), []
    for q in quotes:
        key = (q["category"], q["text"])
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out


def leadership_blocks(root):
    """Verbatim text that follows a heading naming counsel/leadership (up to 12 following siblings)."""
    out = []
    for h in root.find_all(["h2", "h3", "h4", "strong", "b"]):
        head = norm(h.get_text(" "))
        if not head or len(head) > 120 or not re.search(r"(lead|liaison|steering|executive) (counsel|committee)|leadership|plaintiffs'? counsel|defendants'? counsel", head, re.I):
            continue
        lines = []
        node = h.parent if h.name in ("strong", "b") else h
        for sib in node.find_next_siblings(limit=12):
            if sib.name in ("h2", "h3", "h4"):
                break
            t = norm(sib.get_text(" "))
            if t:
                lines.append(t[:2000])  # full line; contact redaction and display truncation happen in the builder
        if lines:
            out.append({"heading": head, "lines": lines[:12]})
    return out[:12]
