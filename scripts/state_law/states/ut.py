"""Utah — Utah Code, Office of Legislative Research and General Counsel (le.utah.gov).

Source: `https://le.utah.gov/xcode/code.html` lists the titles (`TitleN/N.html`); each title page names its current
version file (`versionDefault`, e.g. `C78B_1800010118000101`) and offers that whole title as XML,
`https://le.utah.gov/xcode/TitleN/<version>.xml` (title > chapter > part > section, with histories, catchlines,
subsections and `<effdate>`/`<enddate>` for dated versions). The publisher states: "The Office of Legislative Research
and General Counsel is the official publisher of the Utah Code. The code provisions available above constitute the
current and official electronic record of the Utah Code." robots.txt: `Crawl-delay: 10` (honored; ~90 title files).

Parsing (`ut-title-xml/1`): one record per `<section>`; heading = `<catchline>`; history = each `<history>` line;
text = the section's own text plus one line per `<subsection>`, prefixed with the subsection's own label taken from
its `number` attribute (`78B-2-307(1)(a)` -> `(a)`), as the publisher's web page prints it. `<effdate>` later than
the run date -> `future_effective` (the same number then appears as a current and a future version, `@1`/`@2`);
`<enddate>` -> `effective.end`. A section whose only text is "Reserved." / "Repealed ..." is a status entry.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

BASE = "https://le.utah.gov/xcode/"
INDEX = BASE + "code.html"
PARSER = "ut-title-xml/1"
SKIP = {"histories", "catchline", "effdate", "enddate", "contingent"}
OFFICIAL = ("The Office of Legislative Research and General Counsel is the official publisher of the Utah Code. The "
            "code provisions available above constitute the current and official electronic record of the Utah Code.")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="UT", code_name="Utah Code", publisher="Utah State Legislature, Office of Legislative Research and General Counsel",
        publisher_url=INDEX, official_source=True, access="bulk", hosts=("le.utah.gov",),
        codes=(lib.Code("UC", "Utah Code", "Utah Code Ann. § {n}",
                        patterns=((r"^utah code(?: ann\.)?\s*§\s*([0-9]+[a-z]?-[0-9]+[a-z]?-[0-9a-z.]+)$", r"\1"),
                                  (r"^u\.?c\.?a\.?\s*(?:§\s*)?([0-9]+[a-z]?-[0-9]+[a-z]?-[0-9a-z.]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=10.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt asks for "
                    "Crawl-delay: 10; the module reads one XML file per title."),
        update_cadence="New versions take effect on each session's effective dates (usually May); re-run after each "
                       "effective date and quarterly.")


META = _meta()


def label_of(number: str | None) -> str:
    m = re.search(r"(\([^()]+\))$", number or "")
    return m.group(1) if m else ""


def _inline(el) -> str:
    return "".join(el.itertext())


def render(el, labelled: bool) -> list[str]:
    """Lines of a section or subsection: own text, then one line per nested subsection (document order)."""
    lines: list[str] = []
    buf: list[str] = [label_of(el.get("number")) + " " if labelled else "", el.text or ""]

    def inline(node):
        """Inline content (xref, ext_ref, format, tab ...) joins the line; a nested <eol/> breaks it."""
        if node.tag == "eol":
            flush()
            return
        if node.tag == "tab":
            buf.append(" ")
        buf.append(node.text or "")
        for sub in node:
            inline(sub)
            buf.append(sub.tail or "")

    def flush():
        text = sb.one_line("".join(buf))
        if text and text not in ("(" + ")",) and not re.fullmatch(r"\([^()]+\)", text):
            lines.append(text)
        elif text and re.fullmatch(r"\([^()]+\)", text):
            lines.append(text)     # a label with no own text (its children follow)
        buf.clear()

    for child in el:
        tag = child.tag
        if tag in SKIP:
            buf.append(child.tail or "")
            continue
        if tag == "subsection":
            flush()
            lines.extend(render(child, True))
            buf.append(child.tail or "")
            continue
        if tag == "eol":
            flush()                      # the publisher's explicit line break
            buf.append(child.tail or "")
            continue
        inline(child)
        buf.append(child.tail or "")
    flush()
    # a bare label line directly followed by its first child line reads as "(1) (a) text"; keep the publisher's
    # structure but do not emit an empty label on its own when the next line starts the same branch
    out = []
    for line in lines:
        if out and re.fullmatch(r"\([^()]+\)", out[-1]):
            out[-1] = out[-1] + " " + line
        else:
            out.append(line)
    return out


def _us_date(text: str | None):
    m = re.fullmatch(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*", text or "")
    return f"{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else None


def parse_title(raw: bytes):
    root = ET.fromstring(raw)
    out = []

    def catch(el):
        c = el.find("catchline")
        return sb.one_line(_inline(c)) if c is not None else None

    def walk(el, path):
        for child in el:
            if child.tag in ("chapter", "part"):
                walk(child, path + [(child.tag, child.get("number"), catch(child))])
            elif child.tag == "section":
                hist = [sb.one_line(_inline(h)) for h in child.findall("histories/history")]
                eff = child.find("effdate")
                end = child.find("enddate")
                out.append({"number": child.get("number"), "heading": catch(child), "lines": render(child, False),
                            "history": "\n".join(h for h in hist if h) or None, "path": list(path),
                            "effdate": eff.text.strip() if eff is not None and eff.text else None,
                            "enddate": end.text.strip() if end is not None and end.text else None})
    walk(root, [])
    return {"number": root.get("number"), "heading": catch(root), "sections": out}


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [t.strip() for t in options.get("titles", "").split(",") if t.strip()]
    run_date = ctx.today.isoformat()
    index = ctx.get(INDEX)
    script = ctx.get(BASE + "js/code.js")          # the index page's own script appends the publisher statement
    stated = OFFICIAL in lib.norm_ws(re.sub(r"<br\s*/?>", " ", script.text("utf-8")))
    ctx.edition(edition_label="Utah Code", currency_statement=OFFICIAL if stated else None,
                currency_source_url=BASE + "js/code.js" if stated else None)
    m = re.search(r'var versionDefault="([^"]+)"', index.text())
    if not m:
        raise RuntimeError("code.html names no table-of-contents version")
    toc = ctx.get(f"{BASE}{m.group(1)}.html")
    titles = list(dict.fromkeys(re.findall(r'href="(Title[0-9A-Za-z]+)/[0-9A-Za-z]+\.html\?v=([A-Za-z0-9_]+)"', toc.text())))
    if only:
        titles = [t for t in titles if t[0][5:] in only]
    ctx.log(f"{len(titles)} titles listed in the table of contents")
    for title_dir, version in titles:
        fetched = ctx.get(f"{BASE}{title_dir}/{version}.xml", method="publisher_bulk")
        parsed = parse_title(fetched.body)
        counts: dict[str, int] = {}
        for s in parsed["sections"]:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in parsed["sections"]:
            text = "\n".join(s["lines"])
            effective = None
            status = None
            if s["effdate"] or s["enddate"]:
                start, end = _us_date(s["effdate"]), _us_date(s["enddate"])
                effective = {"start": start, "end": end, "note": None}
                if start and start > run_date:
                    status = {"status": "future_effective", "status_marker": s["effdate"], "status_basis": "publisher_marker"}
            if status is None:
                status = sb.status_kwargs(s["heading"], text)
            if status is None:
                ctx.log(f"Utah Code § {s['number']}: no text and no marker; skipped")
                continue
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            path = [{"level": "title", "label": "Title", "number": parsed["number"], "heading": parsed["heading"]}]
            path += [{"level": lvl, "label": lvl.title(), "number": num, "heading": head} for lvl, num, head in s["path"]]
            ctx.section(code="UC", number=s["number"], heading=s["heading"], text=text, path=path,
                        source=dict(fetched.source(), display_url=f"{BASE}{title_dir}/{title_dir}.html"),
                        history=s["history"], effective=effective,
                        version=(s["effdate"] or s["enddate"]) if index_ else None, version_index=index_, **status)
            if not ctx.want_more():
                return
