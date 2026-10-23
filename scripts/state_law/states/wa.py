"""Washington — Revised Code of Washington, Office of the Code Reviser (app.leg.wa.gov).

Source: `https://app.leg.wa.gov/RCW/default.aspx` (title list; prints "Last update: <date>"), each title page
`default.aspx?Cite=<title>` (chapter table) and each full chapter `default.aspx?cite=<chapter>&full=true` (every
section's catchline, text and bracketed session-law history). No robots.txt (HTTP 404). The Statute Law Committee
names the certified PDFs of the RCW Archive as the official publication; the online RCW is the same publisher's
current text and carries the update date.

Parsing (`wa-rcw-full-chapter/1`) reuses the reviewed page parser `scripts/enrichment/state_statutes/parse_wa.py`
(state_code_wa build, 2026-10-19: 52,518 rows, 0 verification failures): cite heading `RCW 9A.32.030`, catchline
`<h3>`, text `<div>`s (tables row by row), history `[1997 c 196 s 3; ...]`; the Code Reviser's `NOTES:` are not kept.
A section printed twice with different notes (`(Effective until July 1, 2027.)` / `(Effective July 1, 2027.)`,
`(as amended by 1989 c 175)`) gives one record per printed version (`@1`, `@2`), version = the printed note.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "enrichment" / "state_statutes"))
import _statb as sb  # noqa: E402
import parse_wa  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

BASE = "https://app.leg.wa.gov/RCW/default.aspx"
PARSER = "wa-rcw-full-chapter/1"


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="WA", code_name="Revised Code of Washington", publisher="Washington State Legislature, Office of the Code Reviser",
        publisher_url=BASE, official_source=True, access="html", hosts=("app.leg.wa.gov",),
        codes=(lib.Code("RCW", "Revised Code of Washington", "Wash. Rev. Code § {n}",
                        patterns=((r"^rcw\s*(?:§\s*)?([0-9]+[a-z]?\.[0-9]+[a-z]?\.[0-9a-z.\-]+)$", r"\1"),
                                  (r"^wash\. rev\. code(?: ann\.)?\s*§\s*([0-9]+[a-z]?\.[0-9]+[a-z]?\.[0-9a-z.\-]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). app.leg.wa.gov has no "
                    "robots.txt. Code Reviser notes are not kept."),
        update_cadence="Sections are updated as session laws take effect (the index prints 'Last update'); re-run "
                       "after each effective date wave (June/July) and quarterly.")


META = _meta()


def _effective(note: str | None, run_date: str):
    if not note:
        return None, None
    m = re.search(r"\((Effective|Expires)[^()]*\)", note)
    if not m:
        return {"start": None, "end": None, "note": note}, None
    text = m.group(0)
    eff = {"start": None, "end": None, "note": note}
    if re.search(r"until|Expires", text):
        eff["end"] = sb.parse_us_date(text)
        return eff, None
    eff["start"] = sb.parse_us_date(text)
    if eff["start"] and eff["start"] > run_date:
        return eff, text
    return eff, None


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only_titles = [t.strip() for t in options.get("titles", "").split(",") if t.strip()]
    only_chapters = [c.strip() for c in options.get("chapters", "").split(",") if c.strip()]
    run_date = ctx.today.isoformat()
    index = ctx.get(BASE)
    page = lib.norm_ws(lib.html_text(index.body))
    m = re.search(r"Last update:\s*[A-Z][a-z]+ \d{1,2}, \d{4}", page)
    ctx.edition(edition_label="Revised Code of Washington", currency_statement=m.group(0) if m else None,
                currency_source_url=BASE)
    titles = list(dict.fromkeys(re.findall(r"[?&][Cc]ite=(\d+[A-Z]?)(?=['\"&#])", index.text())))
    if only_titles:
        titles = [t for t in titles if t in only_titles]
    for title in titles:
        tfetch = ctx.get(f"{BASE}?Cite={title}")
        tpage = parse_wa.parse_title_page(tfetch.text())
        title_step = {"level": "title", "label": "Title", "number": title, "heading": tpage["caption"] or None}
        for cite, caption in tpage["chapters"]:
            if only_chapters and cite not in only_chapters:
                continue
            fetched = ctx.get(f"{BASE}?cite={cite}&full=true")
            page_ = parse_wa.parse_chapter_page(fetched.text())
            for err in page_["errors"]:
                ctx.log(f"chapter {cite}: {err}")
            path = [title_step, {"level": "chapter", "label": "Chapter", "number": cite,
                                 "heading": page_["caption"] or caption or None}]
            counts: dict[str, int] = {}
            for s in page_["sections"]:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
            seen: dict[str, int] = {}
            for s in page_["sections"]:
                text = "\n".join(s["paragraphs"])
                eff, future_marker = _effective(s.get("version_note"), run_date)
                if future_marker:
                    status = {"status": "future_effective", "status_marker": future_marker,
                              "status_basis": "publisher_marker"}
                else:
                    status = sb.status_kwargs(s["heading"], text)
                if status is None:
                    ctx.log(f"RCW {s['number']}: no text and no marker; skipped")
                    continue
                index_ = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index_ = seen[s["number"]]
                ctx.section(code="RCW", number=s["number"], heading=s["heading"], text=text, path=path,
                            source=dict(fetched.source(), display_url=f"{BASE}?cite={s['number']}"),
                            history=s["history"], effective=eff,
                            version=s.get("version_note") if index_ else None, version_index=index_, **status)
                if not ctx.want_more():
                    return
