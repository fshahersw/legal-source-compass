"""Parse Missouri Revisor ViewChapter.aspx HTML (mo-revisor-html)."""
import re

from bs4 import BeautifulSoup

WS = re.compile(r"[ \t\r\n\f\v\u00a0\u2002\u2003\u2009]+")
HISTORY = re.compile(r"^\(?L\.\s", re.I)
SEP = re.compile(r"^-{3,}")


def clean(s):
    return WS.sub(" ", s or "").strip()


def chapter_number(chapter: str) -> str:
    return str(int(chapter))


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
        head = clean(bold.get_text(" "))
        m = re.match(r"^(\d+\.\d+[A-Za-z]?)\.\s*(.*?)\s*—\s*(.*)$", head)
        if not m:
            m2 = re.match(r"^(\d+\.\d+[A-Za-z]?)\.\s*(.*?)\s*—\s*$", head)
            if not m2:
                continue
            sec_no, heading, lead = m2.group(1), m2.group(2), ""
        else:
            sec_no, heading, lead = m.group(1), m.group(2), m.group(3)
        if not sec_no.startswith(ch + "."):
            continue
        lines = []
        if lead:
            lines.append(lead)
        full_p = clean(p.get_text(" "))
        if not lead:
            dash = full_p.find("—")
            if dash >= 0:
                tail = clean(full_p[dash + 1 :])
                if tail:
                    lines.append(tail)
        history = None
        status_note = None
        for el in div.find_all(["p", "td", "li"]):
            if el is p:
                continue
            t = clean(el.get_text(" "))
            if not t or t in ("­", "-"):
                continue
            if HISTORY.match(t):
                history = t.strip("()")
                break
            if SEP.match(t):
                continue
            if t.startswith(sec_no + "."):
                continue
            lines.append(t)
        text = "\n".join(lines).strip()
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
