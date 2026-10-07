#!/usr/bin/env python3
"""Documented pre-publication review of one landed state (batch 4).

Steps (all recorded in the report): section count vs the publisher TOC (evidence supplied by the state's verification), N random landed
sections re-fetched LIVE from the publisher (fresh requests, not the retained originals) and diffed on citation, heading and text,
currency/edition as landed, and the retrieval routes (proxied content is graded and flagged). Any mismatch -> 'held' (quarantine, not public).
All checks pass -> `corpus_publisher_code_review_v2(state, 'reviewed', true, note)`.

    review_publisher_code_v2.py --landing /tmp/sc4/de/landing --state DE --toc-ok "evidence" --report path.md [--n 20] [--seed 1] [--apply]

State-agnostic: reads the shared landing packet (manifest/units/sections.jsonl, see batch-c LANDING-PACKET.md) of any batch, so every
batch can run it after landing. `--toc-ok` is the proof that parsed section counts equal the publisher's own section markers PER PAGE
(index/subchapter pages with zero sections are a red flag, not a pass); leave it empty and the state is held.
A state is reviewed only when every one of the --n sampled sections matches. Proxied units hold the state unless
--proxied-accepted quotes the owner decision accepting them; --live-proxy firecrawl re-fetches a challenged official page fresh.
--blocks section-doc,history-doc additionally requires every live <p> paragraph and <td>/<th> table cell inside those containers
to appear in the stored text or history.

Two directions are checked per sampled section. Forward: the stored text appears in the live page. Reverse: every live line (paragraph,
list item, table cell, bare text between paragraphs, PDF/RTF line) of the section's live region appears in the stored row. On HTML pages
the region is confined to the publisher's element holding the section text. It runs from the section's heading to whichever comes first:
the next sibling section of the same unit (located by its own stored text; siblings come from sections.jsonl or, for a sample packet, an
optional neighbors.jsonl of {unit_key, citation_path, heading, text_head, hierarchy}), a line opening another section number of the same
printed shape or a structural division (the manifest's levels), or an "Annotations" heading. Lines after the row's own stored history are
the publisher's notes and annotations and are skipped, unless a second printed version of the same section number follows.
A live line is excused only when it is made of the row's own stored fields (number, citation, heading, hierarchy labels, history, status
note, currency statement) or a following sibling's hierarchy labels, is a bare page number, or recurs verbatim on another sampled page of
the same host (site chrome).
"""
import argparse
import hashlib
import html as html_mod
import io
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "b4"))          # sc_common (archive/fetch helpers, browser-UA retry)
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "ecfr-text"))  # pgrest (service-role PostgREST from the environment)
import sc_common as sc  # noqa: E402


def live_text(body, url):
    if body[:5] == b"{\\rtf":
        from striprtf.striprtf import rtf_to_text

        return rtf_to_text(sc.decode_html(body)[0])
    if body[:5] == b"%PDF-":
        try:
            import pymupdf

            with pymupdf.open(stream=body, filetype="pdf") as document:
                return "".join(page.get_text("text") for page in document)
        except Exception as exc:
            import shutil

            if not shutil.which("pdftotext"):
                raise RuntimeError("PDF live text requires pymupdf or pdftotext") from exc
            with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
                f.write(body)
                f.flush()
                return subprocess.run(
                    ["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, check=True
                ).stdout
    s, _ = sc.decode_html(body)
    if s.lstrip()[:1] in "{[":
        try:
            doc = json.loads(s)
            out = []

            def walk(v):
                if isinstance(v, str):
                    out.append(sc.html_text(v) if "<" in v else v)
                elif isinstance(v, dict):
                    for x in v.values():
                        walk(x)
                elif isinstance(v, list):
                    for x in v:
                        walk(x)
            walk(doc)
            return "\n".join(out)
        except ValueError:
            pass
    return sc.html_text(s)


def california_leginfo_live_html(url: str) -> tuple[str | None, str]:
    """Official section HTML when Cloudflare blocks direct fetch (Firecrawl CLI)."""
    import subprocess
    import tempfile

    tmp = tempfile.mkdtemp(prefix="ca-leginfo-")
    out = os.path.join(tmp, "page.html")
    cmd = [
        "npx",
        "--yes",
        "firecrawl-cli@latest",
        "scrape",
        url,
        "--wait-for",
        "8000",
        "--format",
        "rawHtml",
        "-o",
        out,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=180)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None, "firecrawl_cli_failed"
    if not os.path.isfile(out):
        return None, "firecrawl_cli_empty"
    return open(out, encoding="utf-8", errors="replace").read(), "firecrawl_cli"


def firecrawl_live(url: str) -> tuple[int, bytes, dict]:
    """A fresh (maxAge 0, never a cached copy) Firecrawl rawHtml of the official page, for hosts that challenge direct requests."""
    import urllib.request

    key = os.environ.get("FIRECRAWL_API_KEY", "")
    if not key:
        raise SystemExit("FIRECRAWL_API_KEY not in environment")
    body = json.dumps({"url": url, "formats": ["rawHtml"], "maxAge": 0}).encode()
    for attempt in range(4):
        req = urllib.request.Request("https://api.firecrawl.dev/v1/scrape", method="POST", data=body,
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                doc = json.loads(r.read())
        except Exception as exc:  # noqa: BLE001 - recorded in the report row
            err = str(exc)[:200]
            continue
        data = doc.get("data") or {}
        meta = data.get("metadata") or {}
        html = (data.get("rawHtml") or "").encode("utf-8")
        if meta.get("statusCode") == 200 and html:
            return 200, html, {"scrape_id": meta.get("scrapeId"), "cache_state": meta.get("cacheState")}
        err = f"source status {meta.get('statusCode')}"
    return 0, b"", {"error": err}


def texas_zip_chapter_live(arc, code: str, publisher_member: str) -> str | None:
    """Official HTML chapter member from the live publisher code ZIP (tcss.legis.texas.gov)."""
    zip_url = f"https://tcss.legis.texas.gov/resources/Zips/{code}.htm.zip"
    rec = arc.fetch(zip_url, accept="*/*", min_bytes=0)
    if rec.get("state") != "complete":
        return None
    with zipfile.ZipFile(io.BytesIO(arc.read(rec))) as zf:
        return zf.read(publisher_member).decode("utf-8-sig", "replace")


def html_blocks(body, classes):
    """Text of every <p> paragraph and <td>/<th> cell inside the page's <div class="..."> containers named in `classes`."""
    s, _ = sc.decode_html(body)
    out = []
    tag = re.compile(r"<(/?)div\b[^>]*>", re.I)
    for cls in classes:
        for m in re.finditer(r'<div class="%s"[^>]*>' % re.escape(cls), s, re.I):
            depth, pos = 1, m.end()
            while depth:
                t = tag.search(s, pos)
                if not t:
                    break
                depth += -1 if t.group(1) else 1
                pos = t.end()
            inner = s[m.end():t.start() if t else len(s)]
            for name in ("p", "td", "th"):
                for blk in re.finditer(r"(?is)<%s\b[^>]*>(.*?)</%s\s*>" % (name, name), inner):
                    text = sc.html_text(blk.group(1))
                    if text.strip():
                        out.append((name, text))
    return out


def squash(t):
    t = html_mod.unescape(t)
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
        t = t.replace(dash, "-")
    return re.sub(r"\s+", "", t)


LINE_BLOCKS = ("p", "div", "br", "li", "tr", "td", "th", "caption", "pre", "blockquote",
               "h1", "h2", "h3", "h4", "h5", "h6", "table", "dd", "dt", "center")


def live_lines(body, url):
    """The live document as ordered lines: HTML block elements and table cells each end a line, PDF/RTF keep their own lines."""
    if body[:5] == b"%PDF-" or body[:5] == b"{\\rtf":
        return [x for x in (re.sub(r"\s+", " ", ln).strip() for ln in live_text(body, url).splitlines()) if x]
    s, _ = sc.decode_html(body)
    if s.lstrip()[:1] in "{[":
        try:
            doc = json.loads(s)
        except ValueError:
            doc = None
        if doc is not None:
            out = []

            def walk(v):
                if isinstance(v, str):
                    out.extend(sc.html_text(v, block=LINE_BLOCKS).split("\n") if "<" in v else v.splitlines())
                elif isinstance(v, dict):
                    for x in v.values():
                        walk(x)
                elif isinstance(v, list):
                    for x in v:
                        walk(x)
            walk(doc)
            return [x for x in (re.sub(r"\s+", " ", ln).strip() for ln in out) if x]
    return [x for x in sc.html_text(s, block=LINE_BLOCKS).split("\n") if x.strip()]


PARAGRAPH_TAGS = {"p", "span", "b", "i", "u", "em", "strong", "a", "font", "li", "dd", "dt", "pre", "blockquote", "sup", "sub",
                  "h1", "h2", "h3", "h4", "h5", "h6", "small", "center", "td", "th", "tr", "tbody", "thead", "table"}
BLOCK_TAGS = {"p", "div", "table", "ul", "ol", "li", "section", "article", "pre", "blockquote", "dl",
              "h1", "h2", "h3", "h4", "h5", "h6"}


def container_lines(body, row):
    """Lines of the publisher's HTML element that holds the row's text: the deepest element containing the opening of the stored
    text, widened past paragraph-level tags that hold no block children (so later paragraphs, tables and bare text of the same body
    stay inside). None when the page is not HTML or the opening is not found."""
    if body[:5] in (b"%PDF-", b"{\\rtf"):
        return None
    s, _ = sc.decode_html(body)
    if s.lstrip()[:1] in "{[":
        return None
    import lxml.html

    try:
        root = lxml.html.fromstring(s)
    except (ValueError, lxml.etree.ParserError):
        return None
    for bad in root.xpath("//script|//style"):
        bad.drop_tree()
    needle = squash(row.get("text") or "")[:200]
    if not needle or needle not in squash(root.text_content()):
        return None
    node = root
    while True:
        nxt = next((c for c in node if isinstance(c.tag, str) and needle in squash(c.text_content())), None)
        if nxt is None:
            break
        node = nxt
    while (node.tag in PARAGRAPH_TAGS and node.getparent() is not None
           and not any(isinstance(d.tag, str) and d.tag in BLOCK_TAGS for d in node.iterdescendants())):
        node = node.getparent()
    fragment = lxml.html.tostring(node, encoding="unicode")
    return [x for x in sc.html_text(fragment, block=LINE_BLOCKS).split("\n") if x.strip()]


PAGE_NUMBER = re.compile(r"(?i)^(page)?\d{1,5}(of\d{1,5})?$")
ANNOTATIONS_HEAD = re.compile(r"(?i)^\s*(annotations?|notes of decisions|case notes)\s*[.:]?\s*$")


def _locate(stream, row, after=0, number=""):
    """Squashed-stream offset where a row's stored text starts (whole text, else its first 60 characters), or -1.
    Text that occurs more than once (status lines such as "Repealed by ...") is taken at the occurrence that follows the
    row's own printed number."""
    t = squash(row.get("text") or "")
    if not t:
        return -1, 0
    for needle in (t, t[:60] if len(t[:60]) >= 25 else None):
        if not needle:
            continue
        hits, pos = [], stream.find(needle, after)
        while pos >= 0 and len(hits) < 500:
            hits.append(pos)
            pos = stream.find(needle, pos + 1)
        if not hits:
            continue
        num = squash(number)
        if num and len(hits) > 1:
            for p in hits:
                if num in stream[max(0, p - 400):p]:
                    return p, len(needle)
        return hits[0], len(needle)
    return -1, 0


def _printed_number(row):
    """The row's printed section number: the hierarchy number when it has a separator, else the citation path without suffixes."""
    hier = ((row.get("hierarchy") or [{}])[-1] or {}).get("number") or ""
    path = re.split(r":occurrence:|[~#@]", row.get("citation_path") or "")[0]
    for cand in (hier, path):
        if number_shape(cand) is not None:
            return cand
    return hier


def _header_start(stream, row, text_pos, window=300):
    """Back up from a section's text to its own heading/number when they precede it closely."""
    start = text_pos
    opening = squash(row.get("text") or "")[:300]
    for token in (row.get("heading") or "", ((row.get("hierarchy") or [{}])[-1] or {}).get("number") or ""):
        tok = squash(token)
        if len(tok) < 2 or tok in opening:
            continue
        pos = stream.rfind(tok, max(0, text_pos - window), text_pos + len(tok))
        if 0 <= pos < start:
            start = pos
    return start


def number_shape(number):
    """Regex for printed section numbers shaped like this one (digit runs, letter runs, literal punctuation)."""
    pat = ""
    for m in re.finditer(r"\d+|[A-Za-z]+|.", number or ""):
        t = m.group(0)
        pat += r"\d+" if t.isdigit() else ("[A-Za-z]*" if t.isalpha() else re.escape(t))
    return re.compile(pat) if re.search(r"\d", number or "") and re.search(r"[^0-9A-Za-z]", number or "") else None


def header_line(line, own_number, shape, level_re):
    """True when a live line opens another section (same printed number shape) or a structural division (title, chapter, ...)."""
    if level_re is not None and level_re.match(line):
        return True
    if shape is None:
        return False
    for tok in line.split()[:2]:
        t = tok.lstrip("§(").rstrip(".:,;)")
        if t and t != own_number and shape.fullmatch(t):
            return True
    return False


def level_pattern(levels):
    names = [lv for lv in levels or [] if lv and lv != "section"]
    if not names:
        return None
    alts = "|".join(re.escape(n.capitalize()) + "|" + re.escape(n.upper()) for n in names)
    return re.compile(r"^(?:" + alts + r")\s+[0-9IVXLC][0-9A-Za-z.\-]*(?:\s*[.:\-\u2013\u2014]|\s*$|\s+[A-Z(])")


def section_region(lines, row, siblings, levels=None):
    """(first line, last line, start offset, end offset) of the row's live region, or None when the row cannot be located."""
    sq = [squash(x) for x in lines]
    offsets, total = [], 0
    for x in sq:
        offsets.append(total)
        total += len(x)
    stream = "".join(sq)
    own_number = _printed_number(row)
    pos, length = _locate(stream, row, 0, own_number)
    if pos < 0:
        return None
    start = _header_start(stream, row, pos)
    text_end = pos + length
    own = squash(row.get("text") or "")
    end = total
    for sib in siblings:
        if sib.get("citation_path") == row.get("citation_path"):
            continue
        sib_text = squash(sib.get("text_head") or sib.get("text") or "")
        if not sib_text or sib_text == own or own.startswith(sib_text[:60]):
            continue
        spos, _ = _locate(stream, {"text": sib.get("text_head") or sib.get("text")}, text_end, _printed_number(sib))
        if spos < 0:
            heading = squash(sib.get("heading") or "")
            if len(heading) < 15:
                continue
            spos = stream.find(heading, text_end)
            if spos < 0:
                continue
        else:
            spos = max(text_end, _header_start(stream, sib, spos))
        end = min(end, spos)
    shape, level_re = number_shape(own_number), level_pattern(levels)
    for i, off in enumerate(offsets):
        if off >= end:
            break
        if off >= text_end and (header_line(lines[i], own_number, shape, level_re) or ANNOTATIONS_HEAD.match(lines[i])):
            end = off
            break
    history = squash(row.get("history") or "")
    hist_end = None
    if history:
        hpos = stream.find(history, pos)
        if 0 <= hpos < end:
            hist_end = max(text_end, hpos + len(history))
    first = next(i for i, off in enumerate(offsets) if off + len(sq[i]) > start)
    last = max(i for i, off in enumerate(offsets) if off < end) if end > start else first
    return first, last, start, end, sq, offsets, hist_end, own_number


LABEL_WORDS = re.compile(r"(?i)^(section|sec\.|art\.|article|chapter|title|part|rcw|nrs|rsa|ors|g\.s\.)")


def _strip_labels(piece, tokens):
    """Remove the row's own stored fields (number, heading, hierarchy labels, ...) and printed label words from the front of a
    squashed line, and punctuation from both ends; what is left must be section text."""
    rest = piece
    while rest:
        nxt = re.sub(r"^[^0-9A-Za-z(]+", "", rest)
        nxt = LABEL_WORDS.sub("", nxt)
        for t in tokens:
            if t and nxt.startswith(t):
                nxt = nxt[len(t):]
                break
        if nxt == rest:
            break
        rest = nxt
    return re.sub(r"[^0-9A-Za-z).]+$", "", rest)


def reverse_check(lines, row, siblings, chrome=frozenset(), levels=None):
    """Every live line of the row's region must be stored. Returns {ok, checked, excused_chrome, missing:[...]}."""
    region = section_region(lines, row, siblings, levels)
    if region is None:
        return {"ok": False, "checked": 0, "excused_chrome": 0, "missing": ["section text not located on the live page"]}
    first, last, start, end, sq, offsets, hist_end, own_number = region
    body = squash(row.get("heading") or "") + squash(row.get("text") or "") + squash(row.get("history") or "")
    fields = [row.get("heading"), row.get("citation"), row.get("citation_path"), row.get("history"), row.get("status_note"),
              (row.get("currency") or {}).get("statement"), (row.get("currency") or {}).get("edition")]
    for level in row.get("hierarchy") or []:
        fields += [level.get("number"), level.get("heading")]
    for sib in siblings:
        for level in (sib.get("hierarchy") or [])[:-1]:
            fields += [level.get("number"), level.get("heading")]
    tokens = sorted({squash(x) for x in fields if x and len(squash(x)) >= 1}, key=len, reverse=True)
    checked = excused = 0
    missing = []
    in_notes = False
    for i in range(first, last + 1):
        if hist_end is not None and offsets[i] >= hist_end:
            # After the row's own history line the publisher prints notes and annotations, not section text; a second printed
            # version of the same section number resumes the check.
            toks = [t.lstrip("§(").rstrip(".:,;)") for t in lines[i].split()[:2]]
            if own_number and own_number in toks:
                in_notes, hist_end = False, None
            else:
                in_notes = True
        if in_notes:
            continue
        piece = sq[i][max(0, start - offsets[i]): max(0, end - offsets[i])]
        if not piece:
            continue
        checked += 1
        if piece in body or any(piece in t for t in tokens if len(t) >= len(piece)):
            continue
        rest = _strip_labels(piece, tokens)
        if len(re.sub(r"[^0-9A-Za-z]", "", rest)) <= 4 or rest in body or any(rest in t for t in tokens):
            continue
        if PAGE_NUMBER.match(piece):
            continue
        if sq[i] in chrome:
            excused += 1
            continue
        missing.append(lines[i][:240])
    return {"ok": not missing, "checked": checked, "excused_chrome": excused, "missing": missing}


def ordered_siblings(row, pool, limit=5):
    """Other sections of the row's unit: the next few by span when every one has a span, otherwise all of them."""
    same = [x for x in pool if x.get("unit_key") == row.get("unit_key") and x.get("citation_path") != row.get("citation_path")]
    span = row.get("span")
    if isinstance(span, dict) and all(isinstance(x.get("span"), dict) for x in same):
        later = sorted((x for x in same if x["span"]["start"] >= span["end"]), key=lambda x: x["span"]["start"])
        return later[:limit]
    return same


def site_chrome(pages):
    """Lines that recur verbatim on two or more different sampled pages of the same host."""
    seen = {}
    for url, lines in pages.items():
        host = re.sub(r"^https?://([^/]+).*$", r"\1", url)
        for x in set(squash(ln) for ln in lines):
            seen.setdefault((host, x), set()).add(url)
    out = {}
    for (host, x), urls in seen.items():
        if len(urls) >= 2 and x:
            out.setdefault(host, set()).add(x)
    return {h: frozenset(v) for h, v in out.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--landing", required=True, help="landing packet directory (manifest.json, units.jsonl, sections.jsonl)")
    ap.add_argument("--state", required=True)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261006)
    ap.add_argument("--toc-ok", default="", help="evidence that parsed section counts equal the publisher TOC (empty = not established)")
    ap.add_argument("--report", required=True)
    ap.add_argument("--apply", action="store_true", help="call corpus_publisher_code_review_v2 (service role from the environment)")
    ap.add_argument(
        "--must-include",
        action="append",
        default=[],
        help="citation_path or citation values always included in the live sample",
    )
    ap.add_argument("--live-proxy", choices=["firecrawl"],
                    help="when the direct live fetch is not HTTP 200, re-fetch the same official URL fresh through this proxy")
    ap.add_argument("--proxied-accepted", default="",
                    help="the owner decision accepting proxied copies (quoted in the report); without it proxied units hold the state")
    ap.add_argument("--blocks", default="",
                    help="comma-separated div classes of an HTML live page (e.g. section-doc,history-doc): every <p> paragraph and "
                         "<td>/<th> cell inside them must appear in the stored text or history, or the section fails")
    a = ap.parse_args()
    block_classes = [c.strip() for c in a.blocks.split(",") if c.strip()]
    land = a.landing
    units = {u["unit_key"]: u for u in map(json.loads, open(os.path.join(land, "units.jsonl"), encoding="utf-8"))}
    secs = [json.loads(x) for x in open(os.path.join(land, "sections.jsonl"), encoding="utf-8")]
    manifest = json.load(open(os.path.join(land, "manifest.json")))
    neighbors_path = os.path.join(land, "neighbors.jsonl")
    neighbors = ([json.loads(x) for x in open(neighbors_path, encoding="utf-8")] if os.path.exists(neighbors_path) else None)
    rnd = random.Random(a.seed)
    must_rows = []
    for token in a.must_include:
        for s in secs:
            if s["citation_path"] == token or s.get("citation") == token:
                must_rows.append(s)
                break
    pool = [s for s in secs if s not in must_rows]
    sample_size = min(a.n, len(secs))
    extra = max(0, sample_size - len(must_rows))
    sample = must_rows + (rnd.sample(pool, min(extra, len(pool))) if pool and extra else [])
    tmp = tempfile.mkdtemp(prefix="review-")
    arc = sc.Archive(tmp, min_interval=1.0)
    results = []
    live_docs = {}
    for s in sample:
        u = units[s["unit_key"]]
        live_url = s.get("source_url") or u["source_url"]
        rec = arc.fetch(live_url, accept="*/*", min_bytes=0)
        row = {"citation_path": s["citation_path"], "citation": s["citation"], "url": live_url, "live_status": rec["http_status"],
               "route": rec["route"], "user_agent": rec.get("user_agent"), "ua_retry": rec.get("ua_retry", False)}
        live_body = live_raw = None
        if rec["state"] == "complete":
            live_raw = arc.read(rec)
            live_body = live_text(live_raw, live_url)
        elif a.live_proxy == "firecrawl":
            status, html, meta = firecrawl_live(live_url)
            row.update(direct_status=rec["http_status"], live_status=status, route="firecrawl", ua_retry=False, **meta)
            if html:
                row["live_sha256"] = hashlib.sha256(html).hexdigest()
                live_raw = html
                live_body = live_text(html, live_url)
        elif a.state == "CA" and "leginfo.legislature.ca.gov" in live_url:
            html, route = california_leginfo_live_html(live_url)
            if html:
                live_raw = html.encode("utf-8")
                live_body = live_text(live_raw, live_url)
                row["live_status"] = 200
                row["route"] = route
        if live_body is None:
            row.update(ok=False, why="live fetch failed")
        else:
            live = squash(live_body)
            if (
                a.state == "TX"
                and u.get("publisher_member")
                and squash(s["text"]) not in live
                and "statutes.capitol.texas.gov" in live_url
            ):
                code = s["citation_path"].split(":", 1)[0]
                zip_html = texas_zip_chapter_live(arc, code, u["publisher_member"])
                if zip_html:
                    bulk_url = f"https://tcss.legis.texas.gov/resources/Zips/{code}.htm.zip"
                    live_raw = zip_html.encode("utf-8")
                    live = squash(live_text(live_raw, bulk_url))
                    row["live_route"] = "publisher_zip_member"
            live_docs[live_url] = live_lines(live_raw, live_url)
            row["_lines_url"] = live_url
            row["_container"] = container_lines(live_raw, s)
            number = s["hierarchy"][-1].get("number") or ""
            row["citation_ok"] = bool(number) and squash(number) in live
            if a.state == "TX" and not row["citation_ok"]:
                anchor = s["citation_path"].split("~", 1)[0].split(":", 1)[-1].strip()
                row["citation_ok"] = bool(anchor) and squash(anchor) in live
            if a.state == "CA" and not row["citation_ok"]:
                anchor = s["citation_path"].split("~", 1)[0].split(":", 1)[-1].strip().rstrip(".")
                row["citation_ok"] = bool(anchor) and squash(anchor) in live
            heading = s.get("heading") or ""
            row["heading_ok"] = (not heading) or squash(heading) in live
            if heading and not row["heading_ok"]:
                row["heading_ok"] = squash(re.sub(r"\[[^\]]+\]", "", heading)) in live
            if heading and not row["heading_ok"]:
                row["heading_ok"] = squash(heading.split("[", 1)[0].strip()) in live
            if a.state == "CA" and heading and not row["heading_ok"]:
                row["heading_ok"] = squash(heading.split("(", 1)[0].strip()) in live
            row["text_ok"] = squash(s["text"]) in live
            if rec.get("sha256"):
                row["live_sha256"] = rec["sha256"]
            note = s.get("status_note") or ""
            if note and "[Repealed" in note and row.get("text_ok") and live_url.lower().endswith(".pdf"):
                html_url = live_url[:-4] + ".html"
                hrec = arc.fetch(html_url, accept="*/*", min_bytes=0)
                if hrec["state"] == "complete":
                    live_h = squash(live_text(arc.read(hrec), html_url))
                    if number:
                        row["citation_ok"] = squash(number) in live_h
                    if heading and not row["heading_ok"]:
                        row["heading_ok"] = squash(heading) in live_h
                    if heading and not row["heading_ok"]:
                        row["heading_ok"] = squash(re.sub(r"\[[^\]]+\]", "", heading)) in live_h
            row["ok"] = row["citation_ok"] and row["heading_ok"] and row["text_ok"]
            if block_classes:
                stored = squash(s["text"] + "\n" + (s.get("history") or ""))
                pieces = html_blocks(live_raw, block_classes) if live_raw is not None else []
                missing = [t for _, t in pieces if squash(t) not in stored]
                row.update(blocks=len(pieces), blocks_missing=len(missing), blocks_missing_first=missing[0][:200] if missing else None,
                           blocks_ok=bool(pieces) and not missing,
                           paragraphs=sum(1 for n, _ in pieces if n == "p"), cells=sum(1 for n, _ in pieces if n != "p"))
                row["ok"] = row["ok"] and row["blocks_ok"]
        results.append(row)
    chrome = site_chrome(live_docs)
    for s, row in zip(sample, results):
        url = row.pop("_lines_url", None)
        container = row.pop("_container", None)
        if url is None:
            row["reverse_ok"] = False
            continue
        sibs = ordered_siblings(s, neighbors if neighbors is not None else secs)
        host = re.sub(r"^https?://([^/]+).*$", r"\1", url)
        rev = reverse_check(container or live_docs[url], s, sibs, chrome.get(host, frozenset()),
                            (manifest.get("structure") or {}).get("levels"))
        row.update(reverse_ok=rev["ok"], reverse_lines=rev["checked"], reverse_chrome=rev["excused_chrome"],
                   reverse_missing=rev["missing"][:3])
        row["ok"] = row["ok"] and rev["ok"]
    cur = sorted({(x["currency"]["basis"], x["currency"]["statement"][:200], x["currency"]["through_date"], x["currency"]["edition"]) for x in secs})
    proxied = sum(1 for u in units.values() if u["retrieval_method"] == "proxied_fetch")
    passed = bool(results) and len(results) == sample_size and all(r["ok"] for r in results)
    toc_ok = bool(a.toc_ok.strip())
    proxied_ok = proxied == 0 or bool(a.proxied_accepted.strip())
    decision = "reviewed" if (passed and toc_ok and proxied_ok) else "held"
    lines = [f"## Review {a.state} ({manifest['parser']['name']}/{manifest['parser']['version']})", "",
             f"- Sections landed: {len(secs)}; units: {len(units)}; reviewed on {sc.utc_now()}.",
             f"- Section count vs publisher TOC: {'OK - ' + a.toc_ok if toc_ok else 'NOT ESTABLISHED'}.",
             f"- Live diff: {sum(1 for r in results if r['ok'])}/{len(results)} random sections match the live publisher page (seed {a.seed}); "
             "checks = section number present, heading present, full text present (whitespace-insensitive, quote-normalised), "
             "and reverse: every live line of the section's region (paragraphs, table cells, text outside paragraphs) is stored.",
             f"- Currency as landed: {json.dumps(cur, ensure_ascii=False)}",
             f"- Proxied-fetch units: {proxied} "
             + (f"(accepted by owner decision: {a.proxied_accepted.strip()})." if proxied and a.proxied_accepted.strip()
                else "(any proxied content blocks automatic review)."),
             *([f"- Live fetch: direct first; on a non-200 answer the same official URL is re-fetched fresh through {a.live_proxy} "
                "(maxAge 0, no cached copy)."] if a.live_proxy else []),
             *([f"- Paragraphs and table cells: every <p>, <td> and <th> inside {', '.join(block_classes)} on the live page must appear "
                f"in the stored text or history; {sum(r.get('paragraphs', 0) for r in results)} paragraphs and "
                f"{sum(r.get('cells', 0) for r in results)} cells checked, {sum(r.get('blocks_missing', 0) for r in results)} missing."]
               if block_classes else []),
             f"- Decision: **{decision}**", "",
             "| citation_path | live | route/UA | citation | heading | text | reverse (lines checked / chrome excused) |"
             + (" paragraphs/cells found |" if block_classes else ""),
             "|---|---|---|---|---|---|---|" + ("---|" if block_classes else "")]
    for r in results:
        lines.append(f"| {r['citation_path']} | {r['live_status']} | {r['route']}{'/browser-UA' if r.get('ua_retry') else ''} | "
                     f"{r.get('citation_ok')} | {r.get('heading_ok')} | {r.get('text_ok')} | "
                     f"{r.get('reverse_ok')} ({r.get('reverse_lines', 0)}/{r.get('reverse_chrome', 0)}) |"
                     + (f" {r.get('blocks', 0) - r.get('blocks_missing', 0)}/{r.get('blocks', 0)} |" if block_classes else ""))
    misses = [(r["citation_path"], m) for r in results for m in r.get("reverse_missing") or []]
    if misses:
        lines += ["", "Live lines not found in the stored row (first three per section):", ""]
        lines += [f"- `{p}`: {m.replace('|', '/')}" for p, m in misses]
    with open(a.report, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n\n")
    note = f"batch-4 review {sc.utc_now()}: {sum(1 for r in results if r['ok'])}/{len(results)} live diffs, TOC {'ok' if toc_ok else 'not established'}; see {os.path.basename(a.report)}"
    out = {"state": a.state, "decision": decision, "live_ok": sum(1 for r in results if r["ok"]), "sampled": len(results), "toc_ok": toc_ok, "proxied_units": proxied}
    if a.apply:
        import pgrest
        out["rpc"] = pgrest.rpc("corpus_publisher_code_review_v2", {"p_jurisdiction": a.state, "p_review_status": decision,
                                                                  "p_public_projection_allowed": decision == "reviewed", "p_notes": note})
    print(json.dumps(out, indent=1, default=str))
    if decision != "reviewed":
        sys.exit(1)


if __name__ == "__main__":
    main()
