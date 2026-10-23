"""South Dakota — South Dakota Codified Laws, Legislative Research Council (sdlegislature.gov).

Source: the official sitemap `https://sdlegislature.gov/Statutes.xml` (its parts list every title, chapter and
section URL the publisher serves) and one whole-title document per title,
`https://sdlegislature.gov/api/Statutes/<title>.html?all=true` (UTF-16 LE without a byte-order mark): title contents,
each chapter's contents, then one HTML document per section. robots.txt lists the sitemaps and disallows only
viewer/logo paths. The statutes page prints its effective date ("Effective September 3, 2026" banner documents
precede dated sections).

Parsing (`sd-whole-title/1`) reuses the reviewed parser `scripts/enrichment/state_statutes/parse_sd.py`
(state_code_sd build, 2026-10-19: 47,734 rows, 0 verification failures): heading paragraph (SENU number + CL
catchline), text paragraphs, `Source:` paragraph = history; Code Commission notes after the source are not kept;
chapter appendices (court rules, forms) are not code sections. A stub whose heading is a status
(`Repealed by SL 2012, ch 23, § 1.`) is a status entry; an "Effective <date>" banner dates the following section
(`future_effective` when later than the run date).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "enrichment" / "state_statutes"))
import _statb as sb  # noqa: E402
import parse_sd  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

SITE = "https://sdlegislature.gov"
PARSER = "sd-whole-title/1"
STATUS_WORDS = {"repealed": "repealed", "transferred": "transferred", "expired": "expired", "reserved": "reserved",
                "renumbered": "renumbered"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="SD", code_name="South Dakota Codified Laws", publisher="South Dakota Legislature, Legislative Research Council",
        publisher_url=f"{SITE}/Statutes", official_source=True, access="api", hosts=("sdlegislature.gov",),
        codes=(lib.Code("SDCL", "South Dakota Codified Laws", "S.D. Codified Laws § {n}",
                        patterns=((r"^sdcl\s*(?:§\s*)?([0-9]+[a-z]?-[0-9]+[a-z]*-[0-9a-z.]+)$", r"\1"),
                                  (r"^s\.d\. codified laws\s*§\s*([0-9]+[a-z]?-[0-9]+[a-z]*-[0-9a-z.]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.5,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020); SDCL 2-16-8 copyright "
                    "covers the Code Commission's publication, of which only statute text, catchlines and source notes "
                    "are kept. robots.txt lists the statute sitemaps."),
        update_cadence="Sections change on their effective dates (July 1 and session-specific dates); re-run each "
                       "July and quarterly.")


META = _meta()


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [t.strip() for t in options.get("titles", "").split(",") if t.strip()]
    run_date = ctx.today.isoformat()
    if only:
        titles = list(only)   # bounded sample: the ~24 MB sitemap is not needed to name the titles
    else:
        sitemap = ctx.fetch(f"{SITE}/Statutes.xml", method="publisher_api")
        urls = []
        for part in re.findall(r"<loc>([^<]+)</loc>", sitemap.text("utf-8")):
            if part.endswith(".xml"):
                body = ctx.fetch(part, method="publisher_api")
                urls.extend(re.findall(r"<loc>([^<]+)</loc>", body.text("utf-8")))
                del body
            else:
                urls.append(part)
        titles = sorted({m.group(1) for u in urls
                         if (m := re.fullmatch(re.escape(SITE) + r"/Statutes/(\d+[A-Z]?)", u))}, key=sb.natural_key)
    ctx.edition(edition_label="South Dakota Codified Laws", currency_statement=None,
                currency_source_url=f"{SITE}/Statutes")
    ctx.log(f"{len(titles)} titles in the official sitemap")
    for title in titles:
        fetched = ctx.fetch(f"{SITE}/api/Statutes/{title}.html?all=true", method="publisher_api")
        parsed = parse_sd.parse_title(fetched.body)
        for err in parsed["errors"]:
            ctx.log(f"title {title}: {err}")
        tlines = (parsed["title"] or {}).get("lines") or []
        title_head = next((l for l in tlines if not re.match(r"^TITLE\s", l, re.I)), None)
        chapter_heads = {}
        for ch in parsed["chapters"]:
            lines = [l for l in ch["lines"] if not re.match(r"^CHAPTER\s", l, re.I)]
            chapter_heads[ch["number"]] = lines[0] if lines else None
        counts: dict[str, int] = {}
        for s in parsed["sections"]:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in parsed["sections"]:
            text = "\n".join(s["paragraphs"])
            chapter = s["number"].rsplit("-", 1)[0]
            path = [{"level": "title", "label": "Title", "number": title, "heading": title_head},
                    {"level": "chapter", "label": "Chapter", "number": chapter, "heading": chapter_heads.get(chapter)}]
            effective, status = None, None
            if s.get("effective"):
                start = sb.parse_us_date(s["effective"])
                effective = {"start": start, "end": None, "note": s["effective"]}
                if start and start > run_date:
                    status = {"status": "future_effective", "status_marker": s["effective"],
                              "status_basis": "publisher_marker"}
            heading = s["heading"]
            if status is None and s.get("status") and not text:
                word = s["status"].lower()
                status = {"status": STATUS_WORDS.get(word, "not_recorded"), "status_marker": heading,
                          "status_basis": "publisher_marker"}
                heading = None
            if status is None:
                status = sb.status_kwargs(heading, text)
            if status is None:
                ctx.log(f"SDCL {s['number']}: no text and no marker; skipped")
                continue
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            history = s["source"] or None
            ctx.section(code="SDCL", number=s["number"], heading=heading, text=text, path=path,
                        source=dict(fetched.source(), display_url=f"{SITE}/Statutes/{s['number']}"),
                        history=history, effective=effective, version=s.get("effective") if index_ else None,
                        version_index=index_, **status)
            if not ctx.want_more():
                return
