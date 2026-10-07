"""Parse Utah Code xcode section XML (le.utah.gov) for landing and live review."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

_HISTORY_LINE = re.compile(
    r"^\s*(?:Renumbered|Amended|Repealed|Transferred|Created|Enacted)[^.]*(?:\.|$)",
    re.I,
)
_LABEL_SUFFIX = re.compile(r"\(([^)]+)\)$")


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if tag else ""


def load_section(body):
    raw = body if isinstance(body, bytes) else body.encode("utf-8", "replace")
    root = ET.fromstring(raw)
    return root, {}


def _elem_text(el) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def _subsection_label(number: str) -> str:
    m = _LABEL_SUFFIX.search(number or "")
    return f"({m.group(1)})" if m else ""


def _subsection_lines(el) -> list[str]:
    """One output line per nested subsection label, matching Utah xcode XML nesting."""
    label = _subsection_label(el.get("number") or "")
    intro_parts: list[str] = []
    nested: list[str] = []
    if el.text and el.text.strip():
        intro_parts.append(el.text.strip())
    for child in el:
        tag = _local(child.tag).lower()
        if tag == "subsection":
            nested.extend(_subsection_lines(child))
        else:
            t = _elem_text(child)
            if t:
                intro_parts.append(t)
        if child.tail and child.tail.strip():
            intro_parts.append(child.tail.strip())
    intro = re.sub(r"\s+", " ", " ".join(intro_parts)).strip()
    out: list[str] = []
    if label:
        if intro:
            out.append(f"{label} {intro}")
        else:
            out.append(label)
    elif intro:
        out.append(intro)
    out.extend(nested)
    return out


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


def _mixed_prose(section) -> str:
    """Operative text when the section has no subsections (inline xrefs after <tab/>)."""
    parts: list[str] = []
    if section.text and section.text.strip():
        parts.append(section.text.strip())
    for child in section:
        tag = _local(child.tag).lower()
        if tag in ("effdate", "histories", "catchline", "modyear", "tab"):
            if tag == "tab" and child.tail and child.tail.strip():
                parts.append(child.tail.strip())
            continue
        if tag == "subsection":
            continue
        txt = _elem_text(child)
        if txt:
            parts.append(txt)
        if child.tail and child.tail.strip():
            parts.append(child.tail.strip())
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def section_body(section) -> str:
    has_sub = any(_local(c.tag).lower() == "subsection" for c in section)
    if not has_sub:
        return _mixed_prose(section)
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
            subs.extend(_subsection_lines(child))
            continue
        txt = _elem_text(child)
        if txt:
            subs.append(txt)
    if subs:
        return (intro + "\n" + "\n".join(subs)).strip() if intro else "\n".join(subs)
    return intro
