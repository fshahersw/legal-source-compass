"""Parse Utah Code xcode section XML (le.utah.gov) for landing and live review."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

_HISTORY_LINE = re.compile(
    r"^\s*(?:Renumbered|Amended|Repealed|Transferred|Created|Enacted)[^.]*(?:\.|$)",
    re.I,
)


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if tag else ""


def load_section(body):
    raw = body if isinstance(body, bytes) else body.encode("utf-8", "replace")
    root = ET.fromstring(raw)
    return root, {}


def _elem_text(el) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def section_history(section) -> str | None:
    notes = []
    for child in section:
        if _local(child.tag).lower() != "histories":
            continue
        for sub in child:
            if _local(sub.tag).lower() == "history":
                txt = _elem_text(sub)
                if txt:
                    notes.append(txt)
    if not notes:
        return None
    return " ".join(notes)


def section_body(section) -> str:
    intro = ""
    subs: list[str] = []
    for child in section:
        tag = _local(child.tag).lower()
        if tag in ("effdate", "histories", "catchline", "modyear"):
            continue
        if tag == "tab":
            if child.tail and child.tail.strip():
                intro = child.tail.strip()
            continue
        if tag == "subsection":
            num = child.get("number") or ""
            m = re.search(r"\((\d+)\)\s*$", num)
            label = f"({m.group(1)})" if m else ""
            txt = _elem_text(child)
            subs.append(f"{label} {txt}".strip() if label else txt)
            continue
        txt = _elem_text(child)
        if txt:
            subs.append(txt)
    if subs:
        return (intro + "\n" + "\n".join(subs)).strip() if intro else "\n".join(subs)
    return intro
