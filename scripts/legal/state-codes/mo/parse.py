"""Parse Missouri Revisor ViewChapter.aspx HTML (mo-revisor-html)."""
import re

from bs4 import BeautifulSoup, NavigableString

WS = re.compile(r"[ \t\r\n\f\v\u00a0\u2002\u2003\u2009\u200b\ufeff]+")
HISTORY = re.compile(r"^\(?L\.\s*\d{4}", re.I)
SEP = re.compile(r"^-{3,}")
DATE_LINE = re.compile(r"^\d+\.\d+[A-Za-z]?\s+\d{1,2}/\d{1,2}/\d{4}\s*-{3,}$")
PRIOR_REV = re.compile(r"^Prior revisions:", re.I)
RSMO_NOTE = re.compile(r"^\(RSMo\s", re.I)


def clean(s):
    s = (s or "").replace("\u00ad", "").replace("\u200b", "")
    return WS.sub(" ", s).strip()


def chapter_number(chapter: str) -> str:
    return str(int(chapter))


def _heading_from_bold(bold, sec_no):
    """Full printed heading from the bold line (without section number or trailing em dash)."""
    head = clean(bold.get_text(" "))
    m = re.match(rf"^{re.escape(sec_no)}\.\s*(.*)$", head)
    if not m:
        return None
    rest = re.sub(r"\s*—\s*$", "", m.group(1)).strip()
    return rest or sec_no


def _inline_lead(p, bold):
    """Statutory text printed in the same paragraph after the bold heading."""
    full = clean(p.get_text(" "))
    bold_txt = clean(bold.get_text(" "))
    if full.startswith(bold_txt):
        full = full[len(bold_txt) :]
    return full.lstrip("—").strip()


def _lines_from_div(div, sec_no):
    """Ordered non-empty text lines inside one section div (includes bare text nodes)."""
    lines = []
    seen = set()

    def add(t):
        t = clean(t)
        if not t or t in ("-", "—"):
            return
        if len(t) <= 2 and not re.search(r"[0-9A-Za-z]{3}", t):
            return
        if t.startswith(sec_no + ".") and "—" in t:
            return
        key = t.casefold()
        if key in seen:
            return
        seen.add(key)
        lines.append(t)

    for child in div.children:
        if isinstance(child, NavigableString):
            add(str(child))
            continue
        if not getattr(child, "name", None):
            continue
        if child.name == "p" and child.find("span", class_="bold"):
            bold = child.find("span", class_="bold")
            lead = _inline_lead(child, bold)
            if lead:
                add(lead)
            continue
        if child.name in ("p", "td", "th", "li"):
            add(child.get_text(" "))
        elif child.name == "div":
            if "foot" in (child.get("class") or []):
                for p in child.find_all("p"):
                    add(p.get_text(" "))
            else:
                for s in child.stripped_strings:
                    add(s)
        elif child.name == "table":
            for cell in child.find_all(["td", "th"]):
                add(cell.get_text(" "))

    return lines


def _split_history(lines):
    """Body text plus trailing publisher history / source lines in `history`."""
    meta = []
    body = list(lines)
    while body:
        last = body[-1]
        if HISTORY.match(last) or (last.startswith("(") and HISTORY.match(last.lstrip("("))):
            meta.insert(0, last)
            body.pop()
            continue
        if RSMO_NOTE.match(last) or PRIOR_REV.match(last) or DATE_LINE.match(last):
            meta.insert(0, last)
            body.pop()
            continue
        if SEP.match(last) or re.fullmatch(r"[\-–—\s]+", last):
            body.pop()
            continue
        break
    history = "\n".join(meta) if meta else None
    return body, history


def parse_chapter(html: str, chapter: str):
    """Return list of {id, heading, text, history, status_note} for one chapter page."""
    ch = chapter_number(chapter)
    soup = BeautifulSoup(html, "lxml")
    out = []
    for div in soup.select("div.norm"):
        p = div.find("p", class_="norm")
        if not p:
            continue
        bold = p.find("span", class_="bold")
        if not bold:
            continue
        sec_no = None
        head = clean(bold.get_text(" "))
        m = re.match(r"^(\d+\.\d+[A-Za-z]?)\.", head)
        if m:
            sec_no = m.group(1)
        if not sec_no or not sec_no.startswith(ch + "."):
            continue
        heading = _heading_from_bold(bold, sec_no)
        if heading is None:
            continue
        lines = _lines_from_div(div, sec_no)
        body, history = _split_history(lines)
        text = "\n".join(body).strip()
        status_note = None
        if not text and not history:
            status_note = heading or sec_no
            heading = None
        out.append(
            {
                "id": sec_no,
                "heading": heading or None,
                "text": text,
                "history": history,
                "status_note": status_note,
            }
        )
    return out
