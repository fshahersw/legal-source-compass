"""Parser for the Office of the Law Revision Counsel's USLM 1.0 XML of the United States Code.

parse_title(stream, title_key) yields ('container', rec) and ('unit', rec) events in document order and a final
('meta', {...}). Units are sections, court rules (appendix titles) and reorganization plans (title 5 appendix) that
are not inside a note, a quotation or another unit.

Text rendering rules (verify_uscode.py re-derives the words by a separate, regex-based path):
- A unit's body is a list of lines [indent, text], or [indent, [cells...], "tr"|"th"] for table rows. A new line
  starts at every subdivision (subsection, paragraph, subparagraph, clause, subclause, item, subitem, subsubitem),
  every <p>, <continuation>, <proviso> and table row. A subdivision's number and heading open its line, followed by
  its chapeau or inline content, as OLRC prints it.
- indent is OLRC's own class "indentN" on the element when present; otherwise the parent's indent + 1 for a nested
  subdivision and the parent's indent for any other block.
- Whitespace runs collapse to one space; characters are kept as printed (quotes, dashes, section signs).
- A footnote reference prints as "[n]"; the footnote text is listed separately (footnotes: [[n, text]]).
- Notes (<notes type="uscNote">) are listed as {group, topic, heading, lines, footnotes, refs}; crossHeading notes
  ("Editorial Notes", "Statutory Notes and Related Subsidiaries") set the group of the notes that follow.
Nothing is added or reworded; repealed, omitted, transferred, renumbered, reserved and vacant units keep the status
OLRC marks (@status).
"""
import re
import xml.etree.ElementTree as ET

NS = "{http://xml.house.gov/schemas/uslm/1.0}"
XH = "{http://www.w3.org/1999/xhtml}"
OTHER_NS = {"http://purl.org/dc/elements/1.1/": "dc:", "http://purl.org/dc/terms/": "dcterms:"}
CONTAINERS = {"title", "subtitle", "chapter", "subchapter", "part", "subpart", "division", "subdivision", "article",
              "level", "compiledAct", "courtRules", "reorganizationPlans", "appendix"}
UNITS = {"section", "courtRule", "reorganizationPlan"}
BLOCKING = UNITS | {"quotedContent", "note", "notes", "toc", "meta"}
LEVELS = ["subsection", "paragraph", "subparagraph", "clause", "subclause", "item", "subitem", "subsubitem"]
LEVEL_SET = set(LEVELS)
LINE_BLOCKS = {"p", "continuation", "proviso", "x:p"}
WRAPPERS = {"content", "chapeau", "quotedContent", "x:div", "x:ul", "x:ol", "x:li", "x:blockquote", "figure"}
TABLES = {"x:table", "table"}
SKIP_IN_BODY = {"num", "heading", "sourceCredit", "notes", "toc", "layout"}
INLINE_BREAKS = {"p", "x:p", "x:div", "x:li", "x:tr", "x:td", "x:th", "content", "chapeau", "continuation",
                 "proviso", "subsection", "paragraph", "subparagraph", "clause", "subclause", "item", "subitem",
                 "subsubitem", "quotedContent", "column", "tocItem", "x:table"}
STATUSES = {"repealed", "omitted", "transferred", "renumbered", "vacant", "reserved", "unknown"}
WS = re.compile(r"\s+")
INDENT = re.compile(r"\bindent(\d+)\b")


def local(tag):
    if not isinstance(tag, str):
        return ""
    if tag.startswith(NS):
        return tag[len(NS):]
    if tag.startswith(XH):
        return "x:" + tag[len(XH):]
    if tag.startswith("{"):
        uri, name = tag[1:].split("}", 1)
        return OTHER_NS.get(uri, "?:") + name
    return tag


def norm(text):
    return WS.sub(" ", text or "").strip()


FIRST = re.compile(r"\bfirstIndent(-?\d+)\b")


def class_indent(el):
    """(indent, first_line_indent) from OLRC's class "indentN firstIndent-K" (a hanging first line starts at N-K),
    or None when the element carries no indent class."""
    cls = el.get("class") or ""
    m = INDENT.search(cls)
    if not m:
        return None
    base = int(m.group(1))
    f = FIRST.search(cls)
    first = base + min(int(f.group(1)), 0) if f else base
    return base, max(first, 0)


def is_footnote(el):
    return local(el.tag) == "note" and el.get("type") == "footnote"


def is_block(el):
    t = local(el.tag)
    return t in LEVEL_SET or t in LINE_BLOCKS or t in WRAPPERS or t in TABLES or t in UNITS or t in CONTAINERS


def has_block_child(el):
    return any(is_block(c) for c in el)


class Inline:
    """Collects inline text; footnote refs become [n]; footnotes go to a shared list."""

    def __init__(self, footnotes):
        self.parts = []
        self.footnotes = footnotes

    def node(self, el, with_tail=True):
        t = local(el.tag)
        if is_footnote(el):
            num = el.find(NS + "num")
            n = norm("".join(num.itertext())) if num is not None else ""
            inner = Inline(self.footnotes)
            if el.text:
                inner.parts.append(el.text)
            for c in el:
                if c is num:
                    if c.tail:
                        inner.parts.append(c.tail)
                    continue
                inner.node(c)
            if self.footnotes is not None:
                self.footnotes.append([n, inner.text()])
        elif t == "ref" and "footnoteRef" in (el.get("class") or ""):
            # a footnote reference prints as a separate token "[n]"
            self.parts.append(" [" + norm("".join(el.itertext())) + "] ")
        elif t in ("x:br", "br"):
            self.parts.append(" ")
        elif t in INLINE_BREAKS:
            # paragraphs inside a table cell or note print as separate lines: never glue their words
            self.parts.append(" ")
            if el.text:
                self.parts.append(el.text)
            for c in el:
                self.node(c)
            self.parts.append(" ")
        else:
            if el.text:
                self.parts.append(el.text)
            for c in el:
                self.node(c)
        if with_tail and el.tail:
            self.parts.append(el.tail)

    def inner(self, el):
        if el.text:
            self.parts.append(el.text)
        for c in el:
            self.node(c)
        return self

    def text(self):
        return norm("".join(self.parts))


def inline_text(el, footnotes=None):
    return Inline(footnotes).inner(el).text()


class Renderer:
    """Turns a unit's (or a note's) body into lines and footnotes."""

    def __init__(self):
        self.lines = []
        self.footnotes = []

    def add(self, indent, text):
        text = norm(text)
        if text:
            self.lines.append([indent, text])

    def table(self, el, indent):
        for tr in el.iter(XH + "tr"):
            cells, kind = [], "tr"
            for cell in tr:
                t = local(cell.tag)
                if t in ("x:td", "x:th"):
                    cells.append(inline_text(cell, self.footnotes))
                    if t == "x:th":
                        kind = "th"
            if any(cells):
                self.lines.append([indent, cells, kind])

    def block(self, el, indent, lead="", lead_indent=None, heading_lead=False):
        """Render one block element at `indent` (OLRC's class overrides it); `lead` opens its first line.
        heading_lead: `lead` is a subdivision's number and heading (printed on its own line when nothing follows)."""
        t = local(el.tag)
        own = class_indent(el)
        base, first = (own if own is not None else (indent, indent))
        if lead_indent is not None and own is None:
            first = lead_indent
        if t in TABLES:
            if lead and heading_lead:
                self.lines.append([first, norm(lead), "h"])
            else:
                self.add(first, lead)
            # a table sits at the indent of the text that introduces it
            self.table(el, self.lines[-1][0] if self.lines else base)
            return
        if t in LEVEL_SET or t in UNITS or t in CONTAINERS:
            num = el.find(NS + "num")
            head = el.find(NS + "heading")
            bits = [lead,
                    inline_text(num, self.footnotes) if num is not None else "",
                    inline_text(head, self.footnotes) if head is not None else ""]
            self.mixed(el, base, first, " ".join(b for b in bits if b), skip=SKIP_IN_BODY,
                       heading_lead=head is not None)
            return
        if not has_block_child(el):
            self.add(first, " ".join(b for b in [lead, inline_text(el, self.footnotes)] if b))
            return
        self.mixed(el, base, first, lead, skip=(), with_text=True, heading_lead=heading_lead)

    def mixed(self, el, base, first, lead, skip, with_text=False, heading_lead=False):
        """Mixed content: inline runs join the pending line; block children start new lines.
        The first line emitted sits at `first` (OLRC's hanging first line), later ones at `base`."""
        pending = Inline(self.footnotes)
        state = {"first": True}
        lead = norm(lead)

        def only_lead(text):
            return state["first"] and heading_lead and bool(lead) and text == lead

        def flush(text):
            text = norm(text)
            if text:
                indent = first if state["first"] else base
                if only_lead(text):
                    # a subdivision's number and heading printed on their own line
                    self.lines.append([indent, text, "h"])
                else:
                    self.add(indent, text)
                state["first"] = False

        if lead:
            pending.parts.append(lead + " ")
        if with_text and el.text:
            pending.parts.append(el.text)
        for child in el:
            t = local(child.tag)
            if t in skip:
                if child.tail and t not in ("num", "heading"):
                    pending.parts.append(child.tail)
                continue
            if t in ("content", "chapeau") and not has_block_child(child) and class_indent(child) is None:
                pending.node(child)
                pending.parts.append(" ")
                continue
            if not is_block(child):
                pending.node(child)
                continue
            text = pending.text()
            pending = Inline(self.footnotes)
            if t in WRAPPERS and class_indent(child) is None:
                # a wrapper of blocks: the pending text opens its first line
                self.block(child, base, lead=text, lead_indent=first if state["first"] else base,
                           heading_lead=only_lead(norm(text)))
                state["first"] = False
            else:
                flush(text)
                state["first"] = False
                if t in LEVEL_SET or t in UNITS or t in CONTAINERS:
                    self.block(child, base + 1)
                else:
                    self.block(child, base)
            if child.tail:
                pending.parts.append(child.tail)
        flush(pending.text())


def render_body(unit):
    r = Renderer()
    r.mixed(unit, 0, 0, "", skip=SKIP_IN_BODY)
    return r.lines, r.footnotes


def render_notes(notes_el):
    out = []
    group = None
    for note in notes_el:
        if local(note.tag) != "note":
            continue
        head = note.find(NS + "heading")
        if note.get("role") == "crossHeading":
            group = inline_text(head) if head is not None else ""
            continue
        r = Renderer()
        heading = inline_text(head, r.footnotes) if head is not None else ""
        r.mixed(note, 0, 0, "", skip={"num", "heading"}, with_text=True)
        out.append({"group": group, "topic": note.get("topic"), "heading": heading,
                    "lines": r.lines, "footnotes": r.footnotes, "refs": refs_in(note)})
    return out


LAW_REF = ("/us/pl/", "/us/stat/", "/us/act/", "/us/usc/", "/us/rs/")


def refs_in(el):
    """Law, Statutes at Large, Revised Statutes and Code references (href, printed text) inside an element."""
    out = []
    for ref in el.iter(NS + "ref"):
        href = ref.get("href") or ""
        if href.startswith(LAW_REF):
            out.append([href, norm("".join(ref.itertext()))])
    return out


def source_credit_groups(sc):
    """Split a sourceCredit into its ';'-separated citations: text, refs, dates and `items` (refs and dates in
    printed order, ["ref", href, text] / ["date", iso]) so a citation naming two laws ("..., as added Pub. L. ...")
    can be split into one sub-citation per law."""
    groups = []
    cur = {"text": [], "refs": [], "dates": [], "items": []}

    def flush():
        text = norm("".join(cur["text"])).strip(" ;().")
        if text or cur["refs"]:
            groups.append({"text": text, "refs": list(cur["refs"]), "dates": list(cur["dates"]),
                           "items": list(cur["items"])})
        cur["text"], cur["refs"], cur["dates"], cur["items"] = [], [], [], []

    def emit(s):
        if not s:
            return
        pieces = s.split(";")
        for i, piece in enumerate(pieces):
            if i:
                flush()
            cur["text"].append(piece)

    def rec(node, top):
        if not top and local(node.tag) == "ref":
            txt = norm("".join(node.itertext()))
            cur["text"].append(txt)
            if node.get("href"):
                cur["refs"].append([node.get("href"), txt])
                cur["items"].append(["ref", node.get("href"), txt])
            emit(node.tail)
            return
        if not top and local(node.tag) == "date" and re.fullmatch(r"\d{4}-\d{2}-\d{2}", node.get("date") or ""):
            cur["dates"].append(node.get("date"))
            cur["items"].append(["date", node.get("date")])
        emit(node.text)
        for c in node:
            rec(c, False)
        if not top:
            emit(node.tail)

    rec(sc, True)
    flush()
    return groups


def section_key(identifier, title_key):
    """Route key of a unit from its OLRC identifier: '/us/usc/t42/s2000e–2' -> '2000e-2';
    '/us/usc/t18a/pl/91/538/s1' -> 'pl_91_538_s1'; '/us/usc/t28a/courtRules/Civil/rule4' -> 'courtRules_Civil_rule4'.
    OLRC section numbers contain no ASCII hyphen, so the en dash maps to '-' reversibly."""
    path = identifier
    prefix = f"/us/usc/t{title_key}/"
    if path.startswith(prefix):
        path = path[len(prefix):]
    elif path.startswith("/us/usc/"):
        path = path[len("/us/usc/"):]
    path = path.replace("–", "-").strip("/")
    if re.fullmatch(r"s[^/]+", path):
        return path[1:]
    return path.replace("/", "_")


def unit_key_from_num(num_value):
    """Key for a unit OLRC printed without an identifier (e.g. num value '1201 to 1203' -> '1201-to-1203')."""
    return re.sub(r"[^A-Za-z0-9.]+", "-", (num_value or "").replace("–", "-")).strip("-") or "unnumbered"


def parse_title(stream, title_key):
    """Yield ('container', rec), ('unit', rec) in document order, then ('meta', {...})."""
    stack = []
    containers = []
    cstack = []
    meta = {}
    seen_keys = {}
    ordinal = 0
    for ev, el in ET.iterparse(stream, events=("start", "end")):
        tag = local(el.tag)
        if ev == "start":
            if tag in CONTAINERS and not any(t in BLOCKING for t, _ in stack):
                rec = {"index": len(containers), "kind": tag, "identifier": el.get("identifier"),
                       "status": el.get("status") if el.get("status") in STATUSES else None,
                       "parent": cstack[-1] if cstack else None, "depth": len(cstack),
                       "num": None, "num_value": None, "heading": None}
                containers.append(rec)
                cstack.append(rec["index"])
                el.set("__c", str(rec["index"]))
            stack.append((tag, el))
            continue
        stack.pop()
        parent = stack[-1][1] if stack else None
        if parent is not None and local(parent.tag) == "meta":
            if tag == "property":
                meta[el.get("role")] = norm(el.text)
            else:
                meta[tag] = norm(el.text)
            continue
        if tag in ("num", "heading") and parent is not None and parent.get("__c") is not None:
            rec = containers[int(parent.get("__c"))]
            if tag == "num":
                rec["num"] = inline_text(el)
                rec["num_value"] = el.get("value")
            else:
                rec["heading"] = inline_text(el)
            continue
        if tag in CONTAINERS and el.get("__c") is not None:
            idx = int(el.get("__c"))
            if cstack and cstack[-1] == idx:
                cstack.pop()
            yield "container", containers[idx]
            el.clear()
            continue
        if tag in UNITS and not any(t in BLOCKING for t, _ in stack):
            ordinal += 1
            yield "unit", unit_record(el, tag, title_key, [containers[i] for i in cstack], seen_keys, ordinal)
            el.clear()
    yield "meta", meta


def unit_record(el, tag, title_key, ancestors, seen_keys, ordinal):
    identifier = norm(el.get("identifier")) or None
    num = el.find(NS + "num")
    head = el.find(NS + "heading")
    num_value = num.get("value") if num is not None else None
    if identifier and " " in identifier:
        # one printed unit standing for several sections (e.g. "§§ 3, 4."): OLRC lists each identifier
        key = "+".join(section_key(i, title_key) for i in identifier.split(" "))
    elif identifier:
        key = section_key(identifier, title_key)
    else:
        key = unit_key_from_num(num_value)
        if ancestors:
            # printed without an identifier inside an act or plan: qualify by the enclosing container's position
            key = f"c{ancestors[-1]['index']}-{key}"
    n = seen_keys.get(key, 0) + 1
    seen_keys[key] = n
    if n > 1:
        key = f"{key}~{n}"
    # footnotes in printed order: number, heading, body, source credit
    footnotes = []
    num_text = inline_text(num, footnotes) if num is not None else None
    heading = inline_text(head, footnotes) if head is not None else None
    lines, body_notes = render_body(el)
    footnotes.extend(body_notes)
    sc = el.find(NS + "sourceCredit")
    credit = inline_text(sc, footnotes) if sc is not None else None
    notes_el = el.find(NS + "notes")
    status = el.get("status")
    return {
        "kind": tag,
        "key": key,
        "repeat": n,
        "identifier": identifier,
        "ordinal": ordinal,
        "num": num_text,
        "num_value": num_value,
        "heading": heading,
        "heading_refs": refs_in(head) if head is not None else [],
        "heading_dates": [d.get("date") for d in head.iter(NS + "date")
                          if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.get("date") or "")] if head is not None else [],
        "status": status if status in STATUSES else None,
        "ancestors": [a["index"] for a in ancestors],
        "lines": lines,
        "footnotes": footnotes,
        "source_credit": credit,
        "source_credit_groups": source_credit_groups(sc) if sc is not None else [],
        "notes": render_notes(notes_el) if notes_el is not None else [],
    }
