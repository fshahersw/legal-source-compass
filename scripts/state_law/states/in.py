"""Indiana — Indiana General Assembly, Office of Code Revision, Indiana Code (iga.in.gov), state-law/1.

The General Assembly publishes the annual code as one bulk file, https://iga.in.gov/ic/<year>/<year>-Indiana-Code-html.zip
(2026_Indiana_Code_HTML/<title>.html, one file per title). Requested with this project's honest User-Agent the URL
returns the site's JavaScript application shell instead of the archive, so a fresh run stops as blocked; the
supported path is retained mode, which re-reads the archive this project captured from that URL on 2026-10-06
(sha256-checked) — run.py in --retained-index FILE or --option source=retained.

A title file prints div.title / div.article / div.chapter / div.section headers (span#ic_number "IC 34-11-2-4",
span#shortdescription "Injury or forfeiture of penalty actions"), each followed by its paragraphs: the text ("Sec. 4.
(a) …"), p.derivation ("[Pre-1998 Recodification Citation: …]", editorial, not kept) and the italic history ("As added
by P.L.1-1998, SEC.6. Amended by …"). Repealed and expired sections print shortdescription "Repealed"/"Expired" and
only their history. A section with two versions prints both (ids 10-11-2-13 and 10-11-2-13-b), each opening with an
italic note ("Note: This version of section effective until 7-1-2027. …" / "… effective 7-1-2027. …"): a version whose
end date has passed is ledgered as superseded, a version whose start date is ahead is future_effective.
"""
from __future__ import annotations

import datetime as dt
import io
import pathlib
import re
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from lxml import html as lxml_html  # noqa: E402

from state_law import lib  # noqa: E402

HOST = "iga.in.gov"
YEAR = "2026"
ZIP_URL = f"https://{HOST}/ic/{YEAR}/{YEAR}-Indiana-Code-html.zip"

META = lib.StateMeta(
    state="IN",
    code_name="Indiana Code",
    publisher="Indiana General Assembly — Legislative Services Agency, Office of Code Revision (iga.in.gov)",
    publisher_url=f"https://{HOST}/laws/{YEAR}/ic/titles/1",
    official_source=True,
    access="bulk",
    hosts=(HOST,),
    parser="in-iga-code-html/1",
    min_interval_s=1.0,
    codes=(lib.Code("IC", "Indiana Code", "Ind. Code § {n}",
                    lib.alias_patterns(["Ind. Code Ann.", "Ind. Code", "IC", "I.C.", "Indiana Code"])),),
    terms_note=("Annual Indiana Code from the General Assembly's bulk HTML archive. The archive URL serves an "
                "application shell to non-browser clients, so editions are built from the copy this project captured "
                "from that URL (retained mode). Recodification citations are not kept."),
    update_cadence="Annual code after each session; re-check each summer for the next archive.",
)

HISTORY_RE = re.compile(r"^(?:As added by|Amended by|Repealed by|As amended by|Formerly|Expired|Acts \d{4}|"
                        r"Renumbered|Recodified|Transferred|As added and amended|Added by)")
# "Note: This version of section effective until 7-1-2027. ...", and the notes naming the act:
# "Note: This version of section amended by P.L.152-2026, SEC.497, effective 7-1-2027. See also preceding ..." and the
# undated "... amended by P.L.248-2017, SEC.8. See also preceding version ..." (two acts amended the section; both
# versions are printed and both apply)
NOTE_RE = re.compile(r"^Note: This version of section (?:(?:amended|added) by P\.L\.\s?[0-9]+-[0-9]+, SEC\.\s?[0-9A-Za-z.]+"
                     r"(?:, |\.\s|$))?(?:effective (until )?(\d{1,2})-(\d{1,2})-(\d{4}))?")
HEADER_KINDS = ("title", "article", "chapter", "section")


def _p_kind(p) -> str:
    cls = p.get("class") or ""
    if cls == "derivation":
        return "skip"
    text = lib.norm_ws(p.text_content())
    if not text:
        return "skip"
    italic = "".join(i.text_content() for i in p.iter("i"))
    if lib.norm_ws(italic) == text:
        if text.startswith("Note: This version of section") and NOTE_RE.match(text):
            return "note"
        if HISTORY_RE.match(text):
            return "history"
    return "text"


def parse_title(body: bytes, today: dt.date) -> list[dict]:
    root = lxml_html.document_fromstring(lib.decode_bytes(body, "utf-8"))
    out: list[dict] = []
    path: dict[str, dict] = {}
    current: dict | None = None
    for el in root.body.iterchildren():
        cls = el.get("class") or ""
        if el.tag == "div" and cls in HEADER_KINDS:
            num_el = el.find(".//span[@id='ic_number']")
            desc_el = el.find(".//span[@id='shortdescription']")
            ic_number = lib.norm_ws(num_el.text_content()) if num_el is not None else ""
            desc = lib.norm_ws(desc_el.text_content()) if desc_el is not None else None
            number = ic_number[3:] if ic_number.startswith("IC ") else ic_number
            if cls == "section":
                current = {"number": number, "heading": desc or None, "lines": [], "history": [], "note": None,
                           "path": [path[k] for k in ("title", "article", "chapter") if k in path]}
                out.append(current)
            else:
                current = None
                step_number = number.rsplit("-", 1)[-1] if cls != "title" else number
                label = {"title": "Title", "article": "Article", "chapter": "Chapter"}[cls]
                heading = re.sub(rf"^{label}\s+[0-9A-Za-z.]+\.\s*", "", desc or "", flags=re.I) or desc
                path[cls] = {"level": cls, "label": label, "number": step_number, "heading": heading or None}
                for lower in HEADER_KINDS[HEADER_KINDS.index(cls) + 1:]:
                    path.pop(lower, None)
            continue
        if current is None or el.tag != "p":
            continue
        kind = _p_kind(el)
        text = lib.html_text(lxml_html.tostring(el, encoding="unicode", with_tail=False))
        if kind == "text":
            current["lines"].append(text)
        elif kind == "history":
            current["history"].append(text)
        elif kind == "note":
            current["note"] = text
    for item in out:
        item["status"] = item["marker"] = item["effective"] = None
        item["superseded"] = False
        note = item["note"]
        nm = NOTE_RE.match(note or "")
        if nm and nm.group(4):
            when = dt.date(int(nm.group(4)), int(nm.group(2)), int(nm.group(3)))
            if nm.group(1):  # effective until <date>
                item["effective"] = {"start": None, "end": when.isoformat(), "note": note}
                item["superseded"] = when <= today
            else:
                item["effective"] = {"start": when.isoformat(), "end": None, "note": note}
                if when > today:
                    item["status"], item["marker"] = "future_effective", note
    return out


def acquire(ctx: lib.RunContext) -> None:
    archive = ctx.get(ZIP_URL, keep_raw=False)
    if not archive.body.startswith(b"PK"):
        raise lib.Blocked(f"{ZIP_URL} did not return the archive (the publisher serves an application shell to this "
                          "client); run in retained mode")
    zf = zipfile.ZipFile(io.BytesIO(archive.body))
    members = [i for i in zf.infolist() if re.search(rf"/{YEAR}_Indiana_Code_HTML/[0-9]+[A-Z]?\.html$", i.filename)]
    members.sort(key=lambda i: (int(re.search(r"/([0-9]+)[A-Z]?\.html$", i.filename).group(1)), i.filename))
    newest = max((dt.datetime(*i.date_time) for i in members), default=None)
    ctx.edition(edition_label=f"{YEAR} Indiana Code", currency_statement=None, currency_source_url=ZIP_URL,
                source_last_modified=f"title files dated {newest:%Y-%m-%d} in the archive" if newest else None)
    if ctx.sample is not None:
        members = [i for i in members if i.filename.endswith("/34.html")]
    for info in members:
        if not ctx.want_more():
            break
        member = ctx.member(archive, info.filename, zf.read(info))
        items = parse_title(member.body, ctx.today)
        if ctx.sample is not None:
            items = [i for i in items if i["number"].startswith("34-11-")]
        counts: dict[str, int] = {}
        for item in items:
            counts[item["number"]] = counts.get(item["number"], 0) + 1
        seen: dict[str, int] = {}
        for item in items:
            if not ctx.want_more():
                break
            seen[item["number"]] = seen.get(item["number"], 0) + 1
            if item["superseded"]:
                ctx._rejects.write({"state": "IN", "code": "IC", "number": item["number"], "reason": "superseded version",
                                    "source_url": member.url, "source_sha256": member.sha256})
                continue
            multi = counts[item["number"]] > 1
            ctx.section(code="IC", number=item["number"], heading=item["heading"], text="\n".join(item["lines"]),
                        history="\n".join(item["history"]) or None, source=member, path=item["path"],
                        status=item["status"], status_marker=item["marker"], effective=item["effective"],
                        version=item["note"] if multi else None, version_index=seen[item["number"]] if multi else None)
