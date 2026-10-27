"""Oklahoma — Oklahoma Statutes, Oklahoma Legislature (oklegislature.gov).

Source: the Legislature's title index `https://www.oklegislature.gov/osStatuesTitle.html` ("Note: The Oklahoma
Constitution and Oklahoma Statutes were last updated on November 18th, 2025." — kept verbatim as the currency
statement) links one complete-title file per title, `.../OK_Statutes/CompleteTitles/os<N>.pdf`, with an RTF twin
`os<N>.rtf` (the publisher's word-processing original, read here).

robots.txt (2026-10-23, and identically in the project's capture of 2026-10-06) reads `User-agent: *` ...
`Disallow: /` (only named search-engine bots are allowed), and the court site (OSCN) sits behind a browser check. A
live run is therefore refused (Blocked). The project's retained originals (96 objects captured 2026-10-06, among them
89 title RTFs) can be re-parsed with `--option source=retained`; NOTE that capture was itself taken while robots.txt
disallowed all agents, so loading an edition built from it waits for an owner/lead decision (see the handoff).

Still held on 2026-10-27 (release state-codes-official-unprojected), on the publisher's own explicit restriction:
robots.txt re-read 2026-10-27 (2,215 bytes, sha256 a676c21fd1960ed2b3b586d43e258958c02b1173e13d5f24968aa9d65554884a):
after `User-agent: *` and a blank line come `Disallow: /cgi-bin/`, `/WebApplication2/`, `/WebApplication21/` and then
`Disallow: /`; the file also disallows `/*.pdf$` and `/cf_pdf/`, and has explicit `User-agent: ClaudeBot` /
`Disallow: /` and `User-agent: GPTBot` / `Disallow: /` groups. RFC 9309 allows empty lines inside a group, so
`Disallow: /` is a rule for every crawler not named (Googlebot, Bingbot, DuckDuckBot); the named ClaudeBot group is
a second, explicit refusal. Python's robotparser ends the `*` group at the blank line, which is why a naive check passes. Releasing it needs an
owner decision on that capture or the Legislative Service Bureau's permission; nothing here bypasses it.

Parsing (`ok-title-rtf/1`): RTF -> text (`_statb.rtf_to_text`, the same rendering the exact-text check uses); a
section starts at a paragraph `§12-2001.  Title.` (number `12:2001` — section numbers are unique only inside a title,
cited `Okla. Stat. tit. 12, § 2001`); following paragraphs are text; the publisher's trailing `NOTE:` paragraphs
(editorial notes) are not kept; the last remaining paragraph is the history when it is a session-law credit
(`R.L. 1910, § 4641.`, `Added by Laws 2009, c. 228, § 1 ...`). A catchline that is a marker with no text
(`Repealed by Laws 1984, c. 164, § 32, eff. Nov. 1, 1984.`) is a status entry. The files print no chapter/article
structure, so the path is the title only.
"""
from __future__ import annotations

import html as _html
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

SITE = "https://www.oklegislature.gov"
INDEX = SITE + "/osStatuesTitle.html"
FILES = SITE + "/OK_Statutes/CompleteTitles/"
PARSER = "ok-title-rtf/1"
HEAD = re.compile(r"^§\s?([0-9]+[A-Za-z]?)-(.+?)\.\s{2,}(.*)$")
HISTORY = re.compile(r"^(?:R\.\s?L\.\s?\d|Added by Laws\b|Amended by Laws\b|From Laws\b|Laws \d{4}\b|Renumbered\b|"
                     r"Repealed by Laws\b|Derived from\b|Enacted by\b|Adopted by\b|Codified\b|Recodified\b)")
NOTE = re.compile(r"^NOTE:")
CURRENCY = re.compile(r"Note: The Oklahoma Constitution and Oklahoma Statutes were last updated on [A-Z][a-z]+ "
                      r"\d{1,2}(?:st|nd|rd|th)?, \d{4}\.")


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="OK", code_name="Oklahoma Statutes", publisher="Oklahoma Legislature", publisher_url=INDEX,
        official_source=True, access="bulk", hosts=("www.oklegislature.gov",),
        codes=(lib.Code("OS", "Oklahoma Statutes", "Okla. Stat. tit. {t}, § {s}",
                        patterns=((r"^okla\.? stat\.?(?: ann\.)?,? tit\.\s*([0-9]+[a-z]?),?\s*§\s*([0-9][0-9a-z.\-]*)$", r"\1:\2"),
                                  (r"^([0-9]+[a-z]?)\s*o\.\s?s\.(?:\s*\d{4})?,?\s*§\s*([0-9][0-9a-z.\-]*)$", r"\1:\2"))),),
        parser=PARSER, min_interval_s=2.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). robots.txt disallows '/' "
                    "for all agents except named search engines (2026-10-23 and in the 2026-10-06 capture): no live "
                    "crawl; retained originals need an owner decision before loading."),
        update_cadence="Complete-title files are regenerated after each session ('last updated on <date>'); re-check "
                       "each autumn.")


META = _meta()


def list_titles(index_html: str):
    out = []
    for num, name in re.findall(r'CompleteTitles/os([0-9]+[A-Za-z]?)\.pdf"\s*>\s*<b>\s*Title\s+[^<]*</b>\s*</a>\s*([^<]*)',
                                index_html, re.I):
        name = re.sub(r"\s*\(\d+KB\)\s*$", "", sb.one_line(_html.unescape(name))).strip() or None
        if num not in [o[0] for o in out]:
            out.append((num, name))
    return out


def parse_title(text: str):
    """[{number, heading, text, history}] from the RTF's plain text (one paragraph per line)."""
    sections, cur = [], None
    for raw in text.split("\n"):
        line = sb.one_line(raw.replace("\t", " "))
        if not line:
            continue
        m = HEAD.match(raw.strip()) or HEAD.match(line)
        if m:
            cur = {"title": m.group(1), "section": m.group(2), "heading": m.group(3).strip() or None, "paras": []}
            sections.append(cur)
            continue
        if cur is not None:
            cur["paras"].append(line)
    for s in sections:
        paras = list(s.pop("paras"))
        dropped = 0
        while paras and NOTE.match(paras[-1]):
            paras.pop()
            dropped += 1
        history = None
        if paras and HISTORY.match(paras[-1]):
            history = paras.pop()
        # a NOTE paragraph printed between the text and the credit line is an editorial note as well
        kept = [p for p in paras if not NOTE.match(p)]
        s["notes_dropped"] = dropped + len(paras) - len(kept)
        s["text"] = "\n".join(kept)
        s["history"] = history
    return sections


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    retained = getattr(ctx, "retained", None)
    if retained is None:
        raise lib.Blocked("www.oklegislature.gov robots.txt disallows '/' for all agents except named search engines; "
                          "no live crawl. Retained originals (2026-10-06): --option source=retained (owner decision "
                          "needed before loading, see the handoff)")
    only = [t.strip().upper() for t in options.get("titles", "").split(",") if t.strip()]
    index = ctx.get(INDEX)
    m = CURRENCY.search(lib.norm_ws(lib.html_text(index.body)))
    ctx.edition(edition_label="Oklahoma Statutes", currency_statement=m.group(0) if m else None,
                currency_source_url=INDEX if m else None)
    titles = list_titles(index.text("latin-1"))
    held = {u.rsplit("/os", 1)[1][:-4].upper(): u for u in retained.urls(FILES + "os") if u.lower().endswith(".rtf")}
    ctx.log(f"{len(titles)} titles listed; {len(held)} title RTFs retained")
    for num, name in titles:
        if only and num.upper() not in only:
            continue
        url = held.get(num.upper())
        if url is None:
            ctx.log(f"Title {num}: no retained RTF; skipped")
            continue
        fetched = ctx.get(url, method="publisher_bulk")
        sections = parse_title(sb.rtf_to_text(fetched.body))
        counts: dict[str, int] = {}
        for s in sections:
            counts[s["section"]] = counts.get(s["section"], 0) + 1
        seen: dict[str, int] = {}
        notes = sum(s["notes_dropped"] for s in sections)
        if notes:
            ctx.log(f"Title {num}: {notes} editorial NOTE paragraphs not kept")
        path = [{"level": "title", "label": "Title", "number": num, "heading": name}]
        for s in sections:
            if s["title"].upper() != num.upper():
                ctx.log(f"§{s['title']}-{s['section']} printed in title {num}; kept under its printed title")
            status = sb.status_kwargs(s["heading"], s["text"])
            if status is None:
                ctx.log(f"§{s['title']}-{s['section']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] != "in_force" and status["status_marker"] == heading:
                heading = None
            index_ = None
            if counts[s["section"]] > 1:
                seen[s["section"]] = seen.get(s["section"], 0) + 1
                index_ = seen[s["section"]]
            ctx.section(code="OS", number=f"{s['title']}:{s['section']}", heading=heading, text=s["text"], path=path,
                        source=fetched, history=s["history"], version_index=index_, **status)
            if not ctx.want_more():
                return
