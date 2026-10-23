"""Wisconsin — Wisconsin Statutes, Legislative Reference Bureau (docs.legis.wisconsin.gov).

Source: the LRB's statutes listing `https://docs.legis.wisconsin.gov/statutes/statutes` links every chapter
(`/document/statutes/<ch>`); each chapter is also published as plain text, `.../statutes/statutes/<ch>.txt` (the
same text as the `.json` rendition's `content`). The LRB's certification `.../statutes/prefaces/certificate.txt` is
kept verbatim as the currency statement ("The Legislative Reference Bureau certifies that each section of the updated
2023-24 Wisconsin Statutes for publication under s. 35.18 (1) (b) on October 1, 2026, ..."). robots.txt disallows only
search, feed and frame paths.

On 2026-10-23 docs.legis.wisconsin.gov reset the TLS connection from this network (no HTTP answer), so the live path
is untested here; the project's retained originals (captured 2026-10-06 while robots.txt allowed /statutes/: 470
chapter .txt files) are re-parsed with `--option source=retained`.

Parsing (`wi-chapter-txt/1`): `CHAPTER 893` + name line; the chapter's table of contents (`893.01 Civil actions;
objection as to time of commencing.`) gives every section number and catchline; in the body a section starts at a
line `<number> <catchline>` from that table (the rest of the line is the first text paragraph); following lines are
text up to the `History:` line (kept verbatim, without the label); everything after it up to the next section — the
LRB's annotations, case notes, committee notes, law-review references — is not kept, nor are `NOTE:` paragraphs.
`SUBCHAPTER n` + name lines are hierarchy.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

SITE = "https://docs.legis.wisconsin.gov"
LISTING = SITE + "/statutes/statutes"
CERTIFICATE = SITE + "/statutes/prefaces/certificate.txt"
PARSER = "wi-chapter-txt/1"
SEC = re.compile(r"^(\d+[A-Z]?\.\d+[a-z]*)\s+(.*)$")
SUBCHAPTER = re.compile(r"^SUBCHAPTER\s+([IVXLC]+[A-Z]?)$")
CERT = re.compile(r"The Legislative Reference Bureau certifies that each section of the updated \d{4}-\d{2} Wisconsin "
                  r"Statutes for publication under s\. 35\.18 \(1\) \(b\) on [A-Z][a-z]+ \d{1,2}, \d{4}, has been "
                  r"compared with .*? and that all sections appear to be correctly printed\.")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="WI", code_name="Wisconsin Statutes", publisher="Wisconsin Legislative Reference Bureau",
        publisher_url=LISTING, official_source=True, access="bulk", hosts=("docs.legis.wisconsin.gov",),
        codes=(lib.Code("WS", "Wisconsin Statutes", "Wis. Stat. § {n}",
                        patterns=((r"^wis\.? stat\.?(?: ann\.)?\s*§\s*([0-9]+[a-z]?\.[0-9]+[a-z]*)$", r"\1"),
                                  (r"^(?:s\.|§)\s*([0-9]+[a-z]?\.[0-9]+[a-z]*),?\s*stats?\.$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020); the LRB's annotations "
                    "are not kept. robots.txt disallows only search/feed/frame paths."),
        update_cadence="The LRB republishes updated statutes after acts take effect (certificate dated each "
                       "publication); re-run after each certificate date.")


META = _meta()


def _is_caps(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters) and not SEC.match(line)


def _caps_run(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        if not line:
            continue
        if not _is_caps(line):
            break
        out.append(line)
    return out


def parse_chapter(text: str):
    lines = [sb.one_line(x) for x in text.replace("\r\n", "\n").split("\n")]
    chapter = name = None
    for i, line in enumerate(lines[:6]):
        m = re.match(r"^CHAPTER\s+(\d+[A-Z]?)$", line)
        if m:
            chapter = m.group(1)
            name = lines[i + 1] if i + 1 < len(lines) and lines[i + 1] else None
            break
    toc: dict[str, str] = {}
    first = None
    body_start = None
    for i, line in enumerate(lines):
        m = SEC.match(line)
        if not m:
            continue
        if first is None:
            first = m.group(1)
        elif m.group(1) == first:
            body_start = i
            break
        toc.setdefault(m.group(1), m.group(2).strip())
    if body_start is None:
        return {"chapter": chapter, "name": name, "sections": [], "missing": sorted(toc)}
    # the subchapter in force at the body start is the one printed just before it
    sections, cur, mode = [], None, None
    sub = None
    pending_sub = None
    for i in range(body_start - 1, -1, -1):
        sm = SUBCHAPTER.match(lines[i])
        if sm:
            sub = (sm.group(1), " ".join(_caps_run(lines[i + 1:body_start])) or None)
            break
        if SEC.match(lines[i]) and i < body_start - 1:
            break
    seen = set()
    for line in lines[body_start:]:
        m = SEC.match(line)
        if m and m.group(1) in toc and m.group(1) not in seen and line[len(m.group(1)):].strip().startswith(toc[m.group(1)]):
            number = m.group(1)
            seen.add(number)
            rest = line[len(number):].strip()[len(toc[number]):].strip()
            cur = {"number": number, "heading": toc[number] or None, "lines": [rest] if rest else [], "history": None,
                   "subchapter": sub}
            sections.append(cur)
            mode = "text"
            pending_sub = None
            continue
        sm = SUBCHAPTER.match(line)
        if sm:
            pending_sub = [sm.group(1), [], True]
            mode = "sub"
            continue
        if mode == "sub" and pending_sub is not None:
            # the subchapter name is printed in capitals; a committee note may follow it (not kept)
            if line and _is_caps(line) and pending_sub[2]:
                pending_sub[1].append(line)
            elif line:
                pending_sub[2] = False
            sub = (pending_sub[0], " ".join(pending_sub[1]) or None)
            continue
        if cur is None or mode != "text" or not line:
            continue
        if line.startswith("History:"):
            cur["history"] = line[len("History:"):].strip() or None
            mode = "annotations"
            continue
        if line.startswith("NOTE:"):
            continue
        cur["lines"].append(line)
    for s in sections:
        s["text"] = "\n".join(s.pop("lines"))
    return {"chapter": chapter, "name": name, "sections": sections, "missing": sorted(set(toc) - seen)}


def pdf_font_streams(body: bytes):
    """(small, body) streams of the chapter PDF's words, alphanumerics only, split by printed size: the LRB sets
    statute text in the body size (8.3 pt) and annotations/notes in a smaller size (6.5 pt)."""
    import collections
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(body)
        handle.flush()
        out = subprocess.run(["pdftotext", "-bbox", "-enc", "UTF-8", handle.name, "-"], capture_output=True, check=True,
                             timeout=300).stdout.decode("utf-8", errors="replace")
    words = [(float(y1) - float(y0), _html_unescape(w)) for y0, y1, w in
             re.findall(r'<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)</word>', out)]
    if not words:
        return "", ""
    sizes = collections.Counter(round(h, 1) for h, _ in words)
    body_size = sizes.most_common(1)[0][0]
    small = "".join(_key(w) for h, w in words if round(h, 1) < body_size * 0.9)
    big = "".join(_key(w) for h, w in words if round(h, 1) >= body_size * 0.9)
    return small, big


def _html_unescape(text: str) -> str:
    import html

    return html.unescape(text)


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def trim_annotations(lines: list[str], small: str, big: str):
    """For a section that prints no History: line: keep the heading-line paragraph and each following paragraph
    until the first one the PDF prints in the annotation size only. Returns (kept lines, number dropped)."""
    if not lines:
        return lines, 0
    for i in range(1, len(lines)):
        key = _key(lines[i])
        for width in (60, 30):
            k = key[:width]
            if len(k) < 15:
                break
            in_small, in_big = k in small, k in big
            if in_small or in_big:
                if in_small and not in_big:
                    return lines[:i], len(lines) - i
                break
    return lines, 0


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    retained = getattr(ctx, "retained", None)
    cert = ctx.get(CERTIFICATE)
    m = CERT.search(lib.norm_ws(cert.text("utf-8")))
    ctx.edition(edition_label="Wisconsin Statutes (updated)", currency_statement=m.group(0) if m else None,
                currency_source_url=CERTIFICATE if m else None)
    if retained is not None:
        chapters = [u.rsplit("/", 1)[1][:-4] for u in retained.urls(SITE + "/statutes/statutes/")
                    if re.search(r"/statutes/statutes/[0-9]+[A-Za-z]?\.txt$", u)]
    else:
        listing = ctx.get(LISTING)
        chapters = list(dict.fromkeys(re.findall(r'href="/document/statutes/([0-9]+[A-Za-z]?)"', listing.text())))
    chapters = sorted(set(chapters), key=sb.natural_key)
    if only:
        chapters = [c for c in chapters if c in only]
    ctx.log(f"{len(chapters)} chapters")
    for ch in chapters:
        fetched = ctx.get(f"{SITE}/statutes/statutes/{ch}.txt", method="publisher_bulk")
        parsed = parse_chapter(fetched.text("utf-8"))
        if parsed["missing"]:
            ctx.log(f"ch. {ch}: {len(parsed['missing'])} table-of-contents entries not found in the body: "
                    f"{parsed['missing'][:5]}")
        no_history = [s for s in parsed["sections"] if not s["history"]]
        if no_history:
            # the plain text gives no boundary between such a section's text and its annotations; the chapter PDF
            # prints them in different sizes, so it decides where the statute text ends
            try:
                pdf = ctx.get(f"{SITE}/statutes/statutes/{ch}.pdf", method="publisher_bulk")
                small, big = pdf_font_streams(pdf.body)
            except (KeyError, RuntimeError) as exc:  # no PDF retained/available (Blocked is a RuntimeError): do not guess
                ctx.log(f"ch. {ch}: chapter PDF unavailable ({exc}); {len(no_history)} sections without History: "
                        f"skipped")
                small = big = None
            for s in no_history:
                if small is None:
                    s["skip"] = True
                    continue
                kept, dropped = trim_annotations(s["text"].split("\n") if s["text"] else [], small, big)
                s["text"] = "\n".join(kept)
                if dropped:
                    ctx.log(f"Wis. Stat. § {s['number']}: {dropped} annotation paragraphs (set in the PDF's note size) "
                            f"not kept")
        for s in parsed["sections"]:
            if s.get("skip"):
                continue
            status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"Wis. Stat. § {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] != "in_force" and status["status_marker"] == heading:
                heading = None
            path = [{"level": "chapter", "label": "Chapter", "number": parsed["chapter"] or ch,
                     "heading": parsed["name"]}]
            if s["subchapter"]:
                path.append({"level": "subchapter", "label": "Subchapter", "number": s["subchapter"][0],
                             "heading": s["subchapter"][1]})
            ctx.section(code="WS", number=s["number"], heading=heading, text=s["text"], path=path, source=fetched,
                        history=s["history"], **status)
            if not ctx.want_more():
                return
