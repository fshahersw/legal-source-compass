"""Wyoming — Wyoming Statutes, Legislative Service Office (wyoleg.gov).

Source: the "Wyoming Statutes - Files in Download Format" page (`https://wyoleg.gov/stateStatutes/StatutesDownload`,
an Angular page whose template — currency line and title links — ships in the site's own JavaScript chunk; the module
reads that chunk from wyoleg.gov). Currency, verbatim: "This version of the Wyoming Statutes contains changes from the
2026 Budget Session and reflects the contents of the statutes as they exist as of July 1, 2026." One PDF per title:
`https://wyoleg.gov/statutes/compress/TitleNN.pdf` (Title97 is the Constitution and Title99 the non-codified water
projects; both are skipped). No robots.txt (HTTP 404). The LexisNexis annotated edition linked from the same page is
never used.

Parsing (`wy-title-pdf/1`): `pdftotext -layout`; `TITLE 1 - ...`, `CHAPTER 3 - ...`, `ARTICLE 2 - ...`, `PART 1 ...`
lines are hierarchy; a section starts at a line `1-3-105.   Actions other than recovery of real property.` (full
citation then catchline on the same line); its paragraphs (blank-line separated, physical lines joined with a space)
are the text. `1-1-110.   Repealed by Laws 1986, ch. 24, § 2.` is a status entry. The PDFs print no history lines.
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover
    lib = None

SITE = "https://wyoleg.gov"
DOWNLOAD_PAGE = SITE + "/stateStatutes/StatutesDownload"
PARSER = "wy-title-pdf/1"
SECTION = re.compile(r"^(\d{1,2}(?:\.\d)?-\d+(?:\.?[A-Z])?-\d+(?:\.\d+)?)\.(?!\d)\s+(.+)$")
# On the raw layout line a heading has at least two spaces after "<number>." (a wrapped body line that happens to
# start with a citation has one): "     1-3-105.    Actions ..." vs "1-6-107. From the time of filing ...".
LOOSE_SECTION = re.compile(r"^\s*(\d{1,2}(?:\.\d)?-\d+(?:\.?[A-Z])?-\d+(?:\.\d+)?)\.\s+(\S.*)$")
RAW_SECTION = re.compile(r"^\s*(\d{1,2}(?:\.\d)?-\d+(?:\.?[A-Z])?-\d+(?:\.\d+)?)\.\s{2,}(\S.*)$")
HIER = re.compile(r"^(TITLE|CHAPTER|ARTICLE|REVISED ARTICLE|PART|SUBPART)\s+(\d+(?:\.\d+)?(?:\.?[A-Z])?)\.?\s*(?:-\s*)?(.*)$")
LEVEL = {"TITLE": "title", "CHAPTER": "chapter", "ARTICLE": "article", "REVISED ARTICLE": "article", "PART": "part",
         "SUBPART": "subpart"}
ORDER = ["chapter", "article", "part", "subpart"]
SKIP_TITLES = {"97", "99"}


def _meta():
    if lib is None:
        return None
    return lib.StateMeta(
        state="WY", code_name="Wyoming Statutes", publisher="Wyoming Legislature, Legislative Service Office",
        publisher_url=DOWNLOAD_PAGE, official_source=True, access="pdf", hosts=("wyoleg.gov",),
        codes=(lib.Code("WS", "Wyoming Statutes", "Wyo. Stat. Ann. § {n}",
                        patterns=((r"^w\.?\s?s\.?\s*(?:§\s*)?([0-9]+(?:\.[0-9])?-[0-9]+(?:\.?[a-z])?-[0-9.]+)$", r"\1"),
                                  (r"^wyo\. stat\.(?: ann\.)?\s*§\s*([0-9]+(?:\.[0-9])?-[0-9]+(?:\.?[a-z])?-[0-9.]+)$", r"\1"))),),
        parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). No robots.txt; the LSO's "
                    "per-title PDFs are the text-only edition (the annotated edition is a commercial product, unused)."),
        update_cadence="Reissued after each session as of July 1 (the download page's currency line); re-run each July.")


META = _meta()


def pdf_layout_lines(body: bytes) -> list[str]:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(body)
        handle.flush()
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", handle.name, "-"], capture_output=True,
                             check=True, timeout=300).stdout
    return out.decode("utf-8", errors="replace").replace("\f", "\n").split("\n")


def parse_title(lines: list[str]):
    hier: dict[str, tuple] = {}
    sections, cur, para = [], None, []
    title = (None, None)

    def end_para():
        if cur is not None:
            cur["in_heading"] = False
            if para:
                cur["paras"].append(" ".join(para))
        para.clear()

    for raw in lines:
        line = sb.one_line(raw)
        if not line:
            end_para()
            continue
        hm = HIER.match(line)
        if hm and line.upper() == line and not SECTION.match(line):
            end_para()
            if cur:
                sections.append(cur)
                cur = None
            label = hm.group(1)
            if label == "TITLE":
                title = (hm.group(2), hm.group(3).strip() or None)
                hier.clear()
                continue
            level = LEVEL[label]
            for child in ORDER[ORDER.index(level):]:
                hier.pop(child, None)
            hier[level] = (hm.group(2), hm.group(3).strip() or None, label.title())
            continue
        sm = RAW_SECTION.match(raw) or (LOOSE_SECTION.match(raw) if 4 <= len(raw) - len(raw.lstrip()) <= 8 else None)
        if sm and not para and (title[0] is None or sm.group(1).split("-")[0] == title[0]):
            end_para()
            if cur:
                sections.append(cur)
            cur = {"number": sm.group(1), "heading": sb.one_line(sm.group(2)), "paras": [], "in_heading": True,
                   "path": [(lvl, hier[lvl][0], hier[lvl][2], hier[lvl][1]) for lvl in ORDER if lvl in hier]}
            continue
        if cur is not None and cur.get("in_heading") and not cur["paras"] and not para:
            cur["heading"] = cur["heading"] + " " + line      # catchline wrapped onto the next layout line
            continue
        if cur is not None:
            para.append(line)
    end_para()
    if cur:
        sections.append(cur)
    return title, sections


def discover(ctx):
    """(currency statement, [(title key, label, pdf url)]) from the download page's own template chunk."""
    page = ctx.fetch(DOWNLOAD_PAGE)
    main = re.search(r'src="(main-[A-Za-z0-9_-]+\.js)"', page.text())
    if not main:
        raise RuntimeError("download page: no main bundle")
    bundle = ctx.fetch(f"{SITE}/{main.group(1)}")
    for chunk in dict.fromkeys(re.findall(r"chunk-[A-Za-z0-9_-]+\.js", bundle.text("utf-8"))):
        body = ctx.fetch(f"{SITE}/{chunk}")
        text = body.text("utf-8")
        if "Files in Download Format" not in text:
            continue
        currency = re.search(r"This version of the Wyoming Statutes contains changes from [^`]+?\.(?=`)", text)
        urls = list(dict.fromkeys(re.findall(r"https://wyoleg\.gov/statutes/compress/Title([0-9.]+)\.pdf", text)))
        labels = re.findall(r"`(Title ([0-9.]+) [^`]+)`", text)
        names = {num: label for label, num in labels}
        return (currency.group(0) if currency else None, chunk,
                [(k.lstrip("0") or "0", names.get(k.lstrip("0")), f"{SITE}/statutes/compress/Title{k}.pdf") for k in urls])
    raise RuntimeError("download page template chunk not found")


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [t.strip() for t in options.get("titles", "").split(",") if t.strip()]
    currency, chunk, titles = discover(ctx)
    ctx.edition(edition_label="Wyoming Statutes", currency_statement=currency,
                currency_source_url=f"{SITE}/{chunk}" if currency else None)
    titles.sort(key=lambda t: sb.natural_key(t[0]))
    for key, label, url in titles:
        if key in SKIP_TITLES or (only and key not in only):
            continue
        fetched = ctx.fetch(url, method="publisher_bulk")
        (t_no, t_head), sections = parse_title(pdf_layout_lines(fetched.body))
        counts: dict[str, int] = {}
        for s in sections:
            counts[s["number"]] = counts.get(s["number"], 0) + 1
        seen: dict[str, int] = {}
        for s in sections:
            text = "\n".join(s["paras"])
            status = sb.status_kwargs(s["heading"], text)
            if status is None:
                ctx.log(f"W.S. {s['number']}: no text and no marker; skipped")
                continue
            heading = s["heading"]
            if status["status"] != "in_force" and status["status_marker"] == heading:
                heading = None
            index_ = None
            if counts[s["number"]] > 1:
                seen[s["number"]] = seen.get(s["number"], 0) + 1
                index_ = seen[s["number"]]
            path = [{"level": "title", "label": "Title", "number": t_no or key, "heading": t_head}]
            path += [{"level": lvl, "label": lab, "number": num, "heading": head} for lvl, num, lab, head in s["path"]]
            ctx.section(code="WS", number=s["number"], heading=heading, text=text, path=path, source=fetched,
                        version_index=index_, **status)
            if not ctx.want_more():
                return
