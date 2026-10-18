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
from bs4.element import NavigableString, PreformattedString, Tag

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


CLIP_MARK = " …"


def clip(text: str, limit: int) -> str:
    """Text unchanged when it fits; otherwise cut at the last space at or before `limit` and marked with ' …', so a
    stored line or quote never ends mid-word (a single word longer than the limit is kept whole up to its end)."""
    if text is None or len(text) <= limit:
        return text
    space = text.rfind(" ", 0, limit + 1)
    if space <= 0:
        nxt = text.find(" ", limit)
        return text if nxt < 0 else text[:nxt] + CLIP_MARK
    return text[:space].rstrip() + CLIP_MARK


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


GENERIC_SLUG = {"litigation", "products", "product", "liability", "marketing", "sales", "practices", "orders", "order", "content", "cases", "management", "court", "proceedings", "scheduling", "opinions", "panel", "information", "multidistrict", "district",
                # court-administration words: a judge's biography page shares them with the court's duty-judge schedules
                "judge", "judges", "senior", "assignment", "assignments", "schedule", "schedules", "magistrate", "chief"}


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
                    quotes.append({"category": cat, "text": clip(s, 600), "dates_mentioned": all_dates(s)})
    page_text = " ".join(norm(r.get_text(" ")) for r in roots)
    return {
        "url": url, "retrieved": retrieved, "title": title, "sha256": hashlib.sha256(html).hexdigest(),
        "text_chars": len(page_text), "orders": orders, "quotes": dedupe(quotes), "blocks": len(blocks),
        "leadership_blocks": [b for r in roots for b in leadership_blocks(r)][:LEAD_BLOCKS], "scoped_sections": bool(scoped),
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


RE_LEAD_HEADING = re.compile(  # 'liason' and 'plantiff' as some pages misspell them ("CO-LEAD PLANTIFF'S COUNSEL")
    r"(lead|liaison|liason|steering|executive|advisory|coordinating|coordination) (counsel|committee)|lead co-?counsel|leadership"
    r"|(?:plaintiff|plantiff|defendant)(?:s['’]|['’]s|s)? counsel",
    re.I,
)
LEAD_HEADING_TAGS = ["h2", "h3", "h4", "h5", "strong", "b"]
LEAD_STOP_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
LEAD_LINE_BREAKS = {"br", "hr", "p", "li", "td", "th", "tr", "div", "dd", "dt", "table", "tbody", "thead", "ul", "ol",
                    "section", "article", "blockquote", "address"} | LEAD_STOP_TAGS
LEAD_BLOCKS = 16  # headings kept per page
LEAD_LINES = 400  # lines kept per heading before contact redaction; the count beyond it is recorded in lines_total
LEAD_LINE_CHARS = 2000
RE_ECF_PARTY = re.compile(r"^represented by$", re.I)  # CM/ECF party listing: counsel of record, not appointed leadership
RE_UPDATED = re.compile(r"^Last\s+Updated\s*:?\s*(.{6,40})$", re.I)


def updated_line(text: str):
    """A 'Last Updated: July 20, 2015' line printed under a role heading (the page's own date for that list), or None.
    It is page metadata, not a name or firm, so it is recorded as the block's `updated` text, verbatim."""
    m = RE_UPDATED.match(text or "")
    return text if m and parse_date(m.group(1))[1] else None


def _rank(el) -> int:
    """Heading rank: h1-h6 by level; an inline <strong>/<b> label ranks below every h-tag."""
    return int(el.name[1]) if re.fullmatch(r"h[1-6]", el.name or "") else 7


def is_lead_heading_text(head: str) -> bool:
    return bool(head) and len(head) <= 120 and bool(RE_LEAD_HEADING.search(head)) and not is_order_title(head)


def is_lead_heading(el) -> bool:
    """A heading naming a leadership role. An inline <strong>/<b> containing a comma ("Jane Doe, Liaison Counsel") is a
    name with its role, kept as a line, and a heading naming an order ("Order: Plaintiffs' Leadership") is not a role."""
    head = norm(el.get_text(" "))
    return is_lead_heading_text(head) and not (el.name in ("strong", "b") and "," in head)


def _standalone(el) -> bool:
    """A <strong>/<b> that holds all of its parent's text is printed as its own line (a label or a name)."""
    return el.parent is not None and norm(el.parent.get_text(" ")) == norm(el.get_text(" "))


def _anchor(h, root):
    """The element a heading stands for: the heading itself, or its outermost ancestor (below root) holding nothing else."""
    node, text = h, norm(h.get_text(" "))
    while node.parent is not None and node.parent is not root and node is not root and norm(node.parent.get_text(" ")) == text:
        node = node.parent
    return node


RE_DOC_LINK = re.compile(r"\.(?:pdf|docx?|wpd)(?:$|[?#])", re.I)


def _line_tokens(nodes, head_ids):
    """Text lines in document order: every block element, <br> and standalone <strong>/<b> ends a line, so a name and
    a firm printed in separate elements stay separate lines. Each line is the elements' own text, whitespace-normalised.
    A leadership heading yields ("head", element); any other h1-h6 yields ("stop", element); a link to a document
    (orders, PDFs) yields ("doc", element); a standalone <strong>/<b> yields ("label", text) instead of ("line", text)."""
    out, buf = [], []

    def flush():
        text = norm(" ".join(buf))
        buf.clear()
        if text:
            out.append(("line", text))

    def walk(node):
        if isinstance(node, NavigableString):
            if not isinstance(node, PreformattedString):  # comments, CDATA, doctype carry no page text
                buf.append(str(node))
            return
        if not isinstance(node, Tag) or node.name in ("script", "style", "noscript", "template"):
            return
        if id(node) in head_ids:
            flush()
            out.append(("head", node))
            return
        if node.name in LEAD_STOP_TAGS:
            flush()
            out.append(("stop", node))
            return
        if node.name == "a" and RE_DOC_LINK.search(node.get("href") or ""):
            flush()
            out.append(("doc", node))
            return
        label = node.name in ("strong", "b") and _standalone(node)
        breaks = label or node.name in LEAD_LINE_BREAKS
        if breaks:
            flush()
        start = len(out)
        for child in node.children:
            walk(child)
        if breaks:
            flush()
        if label:
            out[start:] = [("label", v) if k == "line" else (k, v) for k, v in out[start:]]

    for n in nodes:
        walk(n)
    flush()
    return out


def leadership_blocks(root):
    """Leadership as listed under headings naming counsel or a committee, without overlap: a heading's lines are the
    text after it (inside its section) up to the next leadership heading or any other h1-h6. Each line is the text of
    one element (li, p, td, div, standalone strong, or a run between <br>s), verbatim; nothing is split or merged
    beyond the page's own element boundaries. A heading followed directly by another leadership heading
    ("PLAINTIFFS' COUNSEL" above "Plaintiffs' Co-Lead Counsel") is recorded as the `group` of the headings under it,
    up to the next such group heading, a heading of higher rank, or (for an h1-h6 group) the next heading of its own
    level. A 'Last Updated: <date>' line is kept as the block's `updated` text rather than as a line; a group's
    `updated` text applies to the headings under it that print none of their own. Three layouts where the role is not
    a heading above the names are read by their own readers, and headings inside them are not read again: quicktabs
    (role = tab link, names = tab page), column tables (role = <th> above a column) and role-per-row tables
    (role = first of two cells, names = second cell)."""
    column_blocks, handled = [], set()  # handled: tables / rows / tab pages already read by a layout-specific reader
    for tab_page, blocks in _quicktab_blocks(root):
        column_blocks.append((tab_page, blocks))
        handled.add(id(tab_page))
    for table in root.find_all("table"):
        if any(id(p) in handled for p in table.parents):
            continue
        blocks = _column_table_blocks(table)
        if blocks is not None:
            column_blocks.append((table, blocks))
            handled.add(id(table))
            continue
        for tr, block in _row_table_blocks(table):
            column_blocks.append((tr, [block]))
            handled.add(id(tr))
    found = [h for h in root.find_all(LEAD_HEADING_TAGS) if is_lead_heading(h) and not any(id(p) in handled for p in h.parents)]
    found_ids = {id(h) for h in found}
    heads = [h for h in found if not any(id(p) in found_ids for p in h.parents)]  # a <strong> inside an <h3> is one heading
    head_ids = {id(h) for h in heads}
    scopes = {}
    for h in heads:
        node = _anchor(h, root)
        tokens = _line_tokens(list(node.next_siblings), head_ids)
        lines, first, last_label, updated = [], None, False, None
        for kind, value in tokens:
            if kind in ("line", "label"):
                if updated is None and updated_line(value):
                    updated, last_label = value, False
                    continue
                lines.append(value)
                last_label = kind == "label"
                continue
            if kind == "doc" and last_label:
                lines.pop()  # a bold label right before a list of documents ("Key Documents") titles that list
            first = kind
            break
        under = []
        for kind, value in tokens:
            if kind in ("stop", "doc"):
                break
            if kind == "head":
                under.append(value)
        scopes[id(h)] = {"lines": lines, "group": not lines and first == "head", "under": under, "updated": updated}
    group_of, updated_of = {}, {}
    for h in heads:
        s = scopes[id(h)]
        if not s["group"]:
            continue
        rank = _rank(h)
        for sub in s["under"]:
            if scopes[id(sub)]["group"] or _rank(sub) < rank or (rank < 7 and _rank(sub) == rank):
                break  # the next group, a higher heading, or the next heading at this group's own level
            group_of.setdefault(id(sub), norm(h.get_text(" ")))
            if s["updated"]:
                updated_of.setdefault(id(sub), s["updated"])
    ordered = [(h, {"heading": norm(h.get_text(" ")), "group": group_of.get(id(h)), "lines": scopes[id(h)]["lines"],
                    "updated": scopes[id(h)]["updated"] or updated_of.get(id(h))}) for h in heads]
    ordered += [(table, b) for table, blocks in column_blocks for b in blocks]
    position = {id(el): i for i, el in enumerate(root.find_all(True))}
    ordered.sort(key=lambda pair: position.get(id(pair[0]), 0))  # document order (sort is stable within a table)
    out = []
    for _, b in ordered:
        lines = b["lines"]
        if not lines or all(is_lead_heading_text(ln) for ln in lines):
            continue  # nothing listed under the heading but other role labels
        if any(RE_ECF_PARTY.match(ln) for ln in lines):
            continue  # a docket's party / counsel-of-record listing
        out.append({"heading": b["heading"], "group": b["group"], "lines": [clip(ln, LEAD_LINE_CHARS) for ln in lines[:LEAD_LINES]], "lines_total": len(lines),
                    "updated": b.get("updated")})
    return out[:LEAD_BLOCKS]


def _cell_lines(cell):
    """Lines of one table cell, headings included as text."""
    heading_ids = {id(x) for x in cell.find_all(LEAD_HEADING_TAGS + ["h1", "h6"])}
    out = []
    for kind, value in _line_tokens([cell], heading_ids):
        text = value if kind in ("line", "label") else norm(value.get_text(" "))
        if text:
            out.append(text)
    return out


def _column_table_blocks(table):
    """Counsel tables whose header row names a role per column (<th>Plaintiff Co-Lead Counsel</th> above the names in
    the same column). Returns one block per role column, or None when the table is not laid out that way (no header
    row of <th> cells naming a role, or a body row with more cells than the header)."""
    rows = [tr for tr in table.find_all("tr") if tr.find_parent("table") is table]
    if len(rows) < 2:
        return None
    cells = lambda tr: [c for c in tr.find_all(["th", "td"], recursive=False)]
    header = cells(rows[0])
    if not header or any(c.name != "th" for c in header):
        return None
    columns = []
    for cell in header:
        lines = _cell_lines(cell)
        roles = [ln for ln in lines if is_lead_heading_text(ln)]
        columns.append({"heading": roles[-1], "group": roles[-2] if len(roles) > 1 else None, "lines": []} if roles else None)
    if not any(columns):
        return None
    for tr in rows[1:]:
        body = cells(tr)
        if len(body) > len(header):
            return None
        for i, cell in enumerate(body):
            if columns[i] is not None:
                columns[i]["lines"] += _cell_lines(cell)
    return [c for c in columns if c is not None]


def _row_table_blocks(table):
    """Counsel tables that print one role per row: a two-cell row whose first cell is only a role label
    ("Plaintiffs' Co-Lead Counsel:") and whose second cell lists the names (N.D. Ohio MDL pages). Returns
    [(tr, block)] for those rows; other rows of the same table (descriptions, judges, special masters) are not read."""
    out = []
    for tr in table.find_all("tr"):
        if tr.find_parent("table") is not table:
            continue
        cells = tr.find_all(["td", "th"], recursive=False)
        if len(cells) != 2 or cells[0].find("table") or cells[1].find("table"):
            continue
        role = norm(cells[0].get_text(" "))
        if not is_lead_heading_text(role):
            continue
        lines = _cell_lines(cells[1])
        if lines:
            out.append((tr, {"heading": role, "group": None, "lines": lines}))
    return out


RE_QUICKTAB_ID = re.compile(r"^quicktabs-tab-(.+)$")
SUB_HEAD_INLINE = {"strong", "b", "em", "i", "u", "span", "font"}


def _quicktab_subheads(page):
    """Role sub-headings inside a tab page: an h2-h6 / strong / b naming a role (as is_lead_heading), or a <p> that holds
    only a role label (no line break, link or block inside it), e.g. <p>SANOFI DEFENDANTS' LEAD COUNSEL</p>."""
    subs, sub_ids = [], set()
    for el in page.find_all(LEAD_HEADING_TAGS + ["h6", "p"]):
        if any(id(p) in sub_ids for p in el.parents):
            continue
        if el.name == "p":
            if el.find(lambda t: t.name not in SUB_HEAD_INLINE) or not is_lead_heading_text(norm(el.get_text(" "))):
                continue
        elif not is_lead_heading(el):
            continue
        subs.append(el)
        sub_ids.add(id(el))
    return subs


def _quicktab_blocks(root):
    """Drupal quicktabs pages (E.D. La. MDL contacts): the role names are the tab links (<a class="quicktabs-tab"
    id="quicktabs-tab-X-1">Plaintiffs' Liaison Counsel</a>) and the names are in the matching tab page
    (id="quicktabs-tabpage-X-1"). Returns [(tab page, blocks)] for tabs whose label names a role: one block headed by
    the tab label, and one per role sub-heading inside the page with the tab label as its group. Lines are read as in
    leadership_blocks, up to any other h1-h6 or a list of documents."""
    out = []
    for a in root.find_all("a", id=RE_QUICKTAB_ID):
        label = norm(a.get_text(" "))
        page = root.find(id="quicktabs-tabpage-" + RE_QUICKTAB_ID.match(a["id"]).group(1))
        if page is None or not is_lead_heading_text(label):
            continue
        subs = _quicktab_subheads(page)
        blocks, current = [], {"heading": label, "group": None, "lines": []}
        for kind, value in _line_tokens(list(page.children), {id(s) for s in subs}):
            if kind in ("line", "label"):
                current["lines"].append(value)
            elif kind == "head":
                blocks.append(current)
                current = {"heading": norm(value.get_text(" ")), "group": label, "lines": []}
            else:
                break  # another section heading or a list of documents ends the tab's counsel list
        blocks.append(current)
        out.append((page, [b for b in blocks if b["lines"]]))
    return out
