"""Texas — Texas Constitution and Statutes, Texas Legislative Council (statutes.capitol.texas.gov).

Source: the publisher's own download inventory `https://statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json`
lists one HTML archive per code (`https://tcss.legis.texas.gov/resources/Zips/<CODE>.htm.zip`), one HTML file per
chapter (a second chapter with the same number is a separate `.v2.htm` member). The statutes site has no robots.txt
(it answers the SPA shell); tcss.legis.texas.gov answers 404 for robots.txt. Archives are 20 KB - 6 MB each.

Parsing (`tx-html/1`): every chapter file is one `<pre>` of `<p>` blocks. A section starts at the publisher's empty
anchor paragraph (`<a name="16.003">`), may carry centered publisher notes ("Text of section effective on ...",
"Text of section as amended by ..."), then the heading paragraph whose bold link points at
`https://statutes.capitol.texas.gov/Docs/<CODE>/htm/<FILE>#<anchor>` ("Sec. 16.003.  TWO-YEAR LIMITATIONS PERIOD.").
Indented paragraphs are statute text; the first unindented paragraph that starts like a credit line ("Added by Acts",
"Acts 1985", "Amended by:", "Redesignated", "Transferred", "Reenacted") starts the history, which runs to the next
anchor. Centered bold TITLE/SUBTITLE/CHAPTER/SUBCHAPTER lines are hierarchy. Repealed sections are not printed by
the publisher, so `repealed` only comes from a printed marker. The Constitution (CN) is not a statute and is skipped.
"""
from __future__ import annotations

import io
import json
import re
import sys
import zipfile
from pathlib import Path

from lxml import html as lxml_html

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _statb as sb  # noqa: E402

try:  # the shared library (STAT-A); absent only in offline tests
    from state_law import lib  # type: ignore
except Exception:  # pragma: no cover - offline tests use _statb.FakeCtx
    lib = None

INVENTORY_URL = "https://statutes.capitol.texas.gov/assets/StatuteCodeDownloads.json"
ARCHIVE_BASE = "https://tcss.legis.texas.gov/resources"
SITE = "https://statutes.capitol.texas.gov/"
PARSER = "tx-html/1"

# code key -> (Bluebook-style citation template, citation abbreviations accepted by the resolver)
CODES = {
    "AG": ("Agriculture Code", "Tex. Agric. Code § {n}", ["tex. agric. code", "tex. agric. code ann."]),
    "AL": ("Alcoholic Beverage Code", "Tex. Alco. Bev. Code § {n}", ["tex. alco. bev. code", "tex. alco. bev. code ann."]),
    "BC": ("Business & Commerce Code", "Tex. Bus. & Com. Code § {n}", ["tex. bus. & com. code", "tex. bus. & com. code ann."]),
    "BO": ("Business Organizations Code", "Tex. Bus. Orgs. Code § {n}", ["tex. bus. orgs. code", "tex. bus. orgs. code ann."]),
    "CP": ("Civil Practice and Remedies Code", "Tex. Civ. Prac. & Rem. Code § {n}",
           ["tex. civ. prac. & rem. code", "tex. civ. prac. & rem. code ann."]),
    "CR": ("Code of Criminal Procedure", "Tex. Code Crim. Proc. art. {n}",
           ["tex. code crim. proc. art.", "tex. code crim. proc. ann. art."]),
    "ED": ("Education Code", "Tex. Educ. Code § {n}", ["tex. educ. code", "tex. educ. code ann."]),
    "EL": ("Election Code", "Tex. Elec. Code § {n}", ["tex. elec. code", "tex. elec. code ann."]),
    "ES": ("Estates Code", "Tex. Est. Code § {n}", ["tex. est. code", "tex. est. code ann."]),
    "FA": ("Family Code", "Tex. Fam. Code § {n}", ["tex. fam. code", "tex. fam. code ann."]),
    "FI": ("Finance Code", "Tex. Fin. Code § {n}", ["tex. fin. code", "tex. fin. code ann."]),
    "GV": ("Government Code", "Tex. Gov't Code § {n}", ["tex. gov't code", "tex. gov't code ann.", "tex. govt code"]),
    "HS": ("Health and Safety Code", "Tex. Health & Safety Code § {n}",
           ["tex. health & safety code", "tex. health & safety code ann."]),
    "HR": ("Human Resources Code", "Tex. Hum. Res. Code § {n}", ["tex. hum. res. code", "tex. hum. res. code ann."]),
    "IN": ("Insurance Code", "Tex. Ins. Code § {n}", ["tex. ins. code", "tex. ins. code ann."]),
    "I1": ("Insurance Code - Not Codified", "Tex. Ins. Code art. {n}", ["tex. ins. code art.", "tex. ins. code ann. art."]),
    "LA": ("Labor Code", "Tex. Lab. Code § {n}", ["tex. lab. code", "tex. lab. code ann."]),
    "LG": ("Local Government Code", "Tex. Loc. Gov't Code § {n}", ["tex. loc. gov't code", "tex. loc. gov't code ann."]),
    "NR": ("Natural Resources Code", "Tex. Nat. Res. Code § {n}", ["tex. nat. res. code", "tex. nat. res. code ann."]),
    "OC": ("Occupations Code", "Tex. Occ. Code § {n}", ["tex. occ. code", "tex. occ. code ann."]),
    "PW": ("Parks and Wildlife Code", "Tex. Parks & Wild. Code § {n}", ["tex. parks & wild. code", "tex. parks & wild. code ann."]),
    "PE": ("Penal Code", "Tex. Penal Code § {n}", ["tex. penal code", "tex. penal code ann."]),
    "PR": ("Property Code", "Tex. Prop. Code § {n}", ["tex. prop. code", "tex. prop. code ann."]),
    "SD": ("Special District Local Laws Code", "Tex. Spec. Dist. Code § {n}",
           ["tex. spec. dist. code", "tex. spec. dist. code ann.", "tex. spec. dist. local laws code"]),
    "TX": ("Tax Code", "Tex. Tax Code § {n}", ["tex. tax code", "tex. tax code ann."]),
    "TN": ("Transportation Code", "Tex. Transp. Code § {n}", ["tex. transp. code", "tex. transp. code ann."]),
    "UT": ("Utilities Code", "Tex. Util. Code § {n}", ["tex. util. code", "tex. util. code ann."]),
    "WA": ("Water Code", "Tex. Water Code § {n}", ["tex. water code", "tex. water code ann."]),
    "CV": ("Vernon's Civil Statutes", "Tex. Rev. Civ. Stat. art. {n}", ["tex. rev. civ. stat. art.", "tex. rev. civ. stat. ann. art."]),
    "WL": ("Auxiliary Water Laws", "Tex. Rev. Civ. Stat. art. {n} (Auxiliary Water Laws)", []),
}
SKIPPED_CODES = {"CN": "The Texas Constitution is not a statute"}
ARTICLE_CODES = {"CR", "I1", "CV", "WL"}


def _patterns(code):
    """Resolver patterns over lib.norm_cite output ('tex. civ. prac. & rem. code § 16.003')."""
    out = []
    for prefix in CODES[code][2]:
        esc = re.escape(prefix).replace(r"\ ", r"\s*")
        if prefix.endswith("art."):
            out.append((rf"^{esc}\s*([0-9][0-9a-z.()\-]*)$", r"\1"))
        else:
            out.append((rf"^{esc}\s*§\s*([0-9][0-9a-z.\-]*)$", r"\1"))
    return tuple(out)


def _meta():
    if lib is None:
        return None
    codes = tuple(lib.Code(code, name, template, patterns=_patterns(code)) for code, (name, template, _) in CODES.items())
    return lib.StateMeta(
        state="TX", code_name="Texas Statutes", publisher="Texas Legislative Council (Texas Legislature)",
        publisher_url=SITE, official_source=True, access="bulk",
        hosts=("statutes.capitol.texas.gov", "tcss.legis.texas.gov"), codes=codes, parser=PARSER, min_interval_s=1.0,
        terms_note=("Statutory text is public domain (Georgia v. Public.Resource.Org, 2020). The Legislative Council "
                    "publishes per-code HTML archives for download; neither host serves a robots.txt."),
        update_cadence=("Archives are rebuilt as acts take effect (per-code Last-Modified dates differ); re-run "
                        "monthly and after each session's effective dates (September 1, January 1)."))


META = _meta()

HISTORY_START = re.compile(
    r"^(Added by|Acts \d{4}|Amended by|Redesignated|Transferred|Reenacted|Renumbered|Repealed by|Derived from|"
    r"Expired|Recodified|Reenacted)\b")
NOTE = re.compile(r"^(Text of |For text of |For another |For expiration of |This (section|article|chapter) |"
                  r"(Chapter|Subchapter|Article|Section|Title|Subtitle) \S+, consisting of |Without reference to )")
HIER = re.compile(r"^(TITLE|SUBTITLE|CHAPTER|SUBCHAPTER|PART|ARTICLE)\s+([0-9A-Z][0-9A-Za-z.\-]*?)\.?(?:\s+(.*))?$")
LEVEL = {"TITLE": "title", "SUBTITLE": "subtitle", "CHAPTER": "chapter", "SUBCHAPTER": "subchapter",
         "PART": "part", "ARTICLE": "article"}
ORDER = ["TITLE", "SUBTITLE", "CHAPTER", "SUBCHAPTER", "PART", "ARTICLE"]
HEAD = re.compile(r"^(Sec\.|Art\.|SECTION|Section)\s+([0-9A-Za-z][^\s]*?)\.?\s+(.*)$", re.S)


def _p_kind(p):
    cls = (p.get("class") or "").strip()
    style = (p.get("style") or "").replace(" ", "")
    return cls, ("text-indent" in style), ("font-weight:bold" in style)


def _head_link(p, code):
    for a in p.iter("a"):
        href = a.get("href") or ""
        if re.match(rf"https://statutes\.capitol\.texas\.gov/Docs/{code}/htm/[^#]+#.+", href, re.I) and \
                "bold" in (a.get("style") or ""):
            return a
    return None


def _effective(notes, run_date):
    """effective/status from the publisher's 'Text of section effective ...' notes."""
    eff = {"start": None, "end": None, "note": None}
    status, marker = None, None
    if not notes:
        return eff, status, marker
    eff["note"] = " ".join(notes)
    for note in notes:
        m = re.search(r"effective (?:on |)(?:or after )?([A-Z][a-z]+\.? \d{1,2}, \d{4})", note)
        if re.search(r"effective until", note):
            d = sb.parse_us_date(note.split("until", 1)[1])
            if d:
                eff["end"] = d
        elif m and not re.search(r"effective (?:on |)(?:or after )?[A-Z][a-z]+\.? \d{1,2}, \d{4}, (?:to|until)", note):
            d = sb.parse_us_date(m.group(1))
            if d:
                eff["start"] = d
                if d > run_date and note.startswith("Text of section"):
                    status, marker = "future_effective", note
    return eff, status, marker


def parse_member(raw: bytes, code: str, member: str, run_date: str):
    """One publisher chapter file -> {'nodes': [...], 'sections': [...]} in document order (pure function)."""
    doc = lxml_html.fromstring(raw.decode("utf-8-sig"))
    pres = doc.xpath("//body/pre")
    if not pres:
        raise ValueError(f"{member}: no publisher <pre> block")
    # libxml2 closes <pre> at a <table>; everything after it lands beside the <pre> under <body>.
    blocks = []
    for container in [pres[0]] + list(pres[0].itersiblings()):
        items = list(container) if container.tag == "pre" else [container]
        blocks.extend(el for el in items if isinstance(el.tag, str) and el.tag not in ("br", "script", "style"))
    nodes, sections = [], []
    hier: dict[str, tuple] = {}          # label -> (number, heading)
    pending_notes: list[str] = []
    chapter_notes: list[str] = []
    cur = None                           # section being built
    seen_root = False
    last_hier = None

    def path():
        return [(LEVEL[k], hier[k][0], k.title(), hier[k][1]) for k in ORDER if k in hier]

    def close():
        nonlocal cur
        if cur is not None:
            sections.append(cur)
        cur = None

    for ix, el in enumerate(blocks):
        cls, indented, bold = _p_kind(el)
        text = sb.el_text(el)
        names = el.xpath(".//a/@name")
        if el.tag == "p" and not text and names:
            close()                      # anchor paragraph opens the next section block
            pending_notes = []
            last_hier = None
            continue
        if not text:
            continue
        if cls == "center":
            one = sb.one_line(text)
            m = HIER.match(one)
            hier_ok = m and one.split()[0] == one.split()[0].upper() and (
                bold or m.group(1) in ("TITLE", "SUBTITLE", "CHAPTER", "SUBCHAPTER"))
            if m and m.group(1) == "ARTICLE" and (code in ARTICLE_CODES and cur is not None):
                hier_ok = False          # compound V.C.S. statutes print ARTICLE subdivisions inside the section
            if bold and not seen_root and not m:
                seen_root = True         # code name line ("CIVIL PRACTICE AND REMEDIES CODE")
                continue
            if hier_ok:
                close()
                label = m.group(1)
                for child in ORDER[ORDER.index(label):]:
                    hier.pop(child, None)
                hier[label] = (m.group(2), (m.group(3) or "").strip() or None)
                nodes.append({"path": path(), "label": label.title(), "heading": hier[label][1]})
                last_hier = label
                continue
            if bold and last_hier and not re.search(r"[a-z]", one) and cur is None:
                number, heading = hier[last_hier]   # wrapped heading line continues the heading above it
                hier[last_hier] = (number, ((heading or "") + " " + one).strip())
                nodes[-1]["heading"] = hier[last_hier][1]
                continue
            if NOTE.match(one):
                if cur is None:
                    (pending_notes if pending_notes or blocks_has_head_after(blocks, ix, code) else chapter_notes).append(one)
                else:
                    cur["inner_notes"].append(one)
                continue
            # any other centered line inside a section is statute text (form titles, "WARNING", ...)
        link = _head_link(el, code) if el.tag == "p" else None
        if link is not None:
            close()
            head_text = sb.one_line(sb.el_text(link))
            m = HEAD.match(head_text)
            if not m:
                raise ValueError(f"{member}: unparsed heading {head_text[:80]!r}")
            number = m.group(2)
            heading = m.group(3).strip() or None
            anchor = (link.get("href") or "").split("#", 1)[1]
            # statute text printed in the same paragraph after the heading link
            rest_parts = []
            if link.tail:
                rest_parts.append(link.tail)
            for sib in link.itersiblings():
                rest_parts.append(sb.el_text(sib) if len(sib) or sib.text else "")
                if sib.tail:
                    rest_parts.append(sib.tail)
            first = sb.ws("".join(rest_parts))
            cur = {"number": number, "heading": heading, "anchor": anchor, "url": link.get("href"),
                   "notes": list(pending_notes), "inner_notes": [], "body": [first] if first else [],
                   "history": [], "path": path()}
            pending_notes = []
            continue
        if cur is None:
            if NOTE.match(sb.one_line(text)):
                chapter_notes.append(sb.one_line(text))
            continue
        if cur["history"] or (not indented and cls == "left" and HISTORY_START.match(text)):
            cur["history"].append(sb.one_line(text))
            continue
        cur["body"].append(text)
    close()

    out = []
    for s in sections:
        eff, status, marker = _effective(s["notes"] + s["inner_notes"], run_date)
        version = next((n for n in s["notes"] if n.startswith("Text of ")), None)
        text = "\n".join(s["body"])
        out.append({
            "number": s["number"], "heading": s["heading"], "text": text,
            "history": " ".join(s["history"]) or None, "url": s["url"], "anchor": s["anchor"],
            "path": s["path"], "version": version, "effective": eff, "status": status, "status_marker": marker,
            "chapter_notes": chapter_notes,
        })
    return {"nodes": nodes, "sections": out, "chapter_notes": chapter_notes}


def blocks_has_head_after(blocks, ix, code):
    """True when a section heading follows before the next anchor/hierarchy line (note belongs to that section)."""
    for el in blocks[ix + 1:ix + 6]:
        if el.tag == "p" and el.xpath(".//a/@name") and not sb.el_text(el):
            return False
        if el.tag == "p" and _head_link(el, code) is not None:
            return True
    return False


def member_order(name: str):
    m = re.match(r"^[a-z0-9]+\.(.+?)(\.v(\d+))?\.htm$", name, re.I)
    if not m:
        return (sb.natural_key(name), 0)
    return (sb.natural_key(m.group(1)), int(m.group(3) or 1))


CURRENCY_URL = "https://tcss.legis.texas.gov/api/GetProperty/StatutesCurrentMsg"


def acquire(ctx):
    options = getattr(ctx, "options", {}) or {}
    only = [c.strip().upper() for c in options.get("codes", "").split(",") if c.strip()]
    per_code = int(options.get("per_code", 0) or 0)
    run_date = ctx.today.isoformat()
    currency = ctx.fetch(CURRENCY_URL, method="publisher_api")
    statement = sb.one_line(currency.text())
    ctx.edition(edition_label=None, currency_statement=statement or None, currency_source_url=CURRENCY_URL)
    inv = ctx.fetch(INVENTORY_URL, method="publisher_api")
    inventory = json.loads(inv.body)["StatuteCode"]
    for entry in inventory:
        code = entry["code"]
        if code in SKIPPED_CODES or (only and code not in only):
            continue
        if code not in CODES:
            ctx.log(f"unknown code {code} in the publisher inventory; skipped (add it to CODES)")
            continue
        if not re.fullmatch(r"/Zips/[A-Z0-9]{2}\.htm\.zip", entry["Html"]):
            raise ValueError(f"unexpected archive locator {entry['Html']}")
        url = ARCHIVE_BASE + entry["Html"]
        with ctx.stream(url) as handle:
            data = handle.read()
        archive_src = dict(ctx.stream_source)
        archive = zipfile.ZipFile(io.BytesIO(data))
        members = sorted((m for m in archive.namelist() if m.lower().endswith(".htm")), key=member_order)
        if options.get("members"):   # sample runs: restrict to named chapter files (e.g. cp.16.htm)
            keep = {x.strip().lower() for x in options["members"].split(",")}
            members = [m for m in members if m.lower() in keep]
        parsed = []
        counts: dict[str, int] = {}
        for member in members:
            raw = archive.read(member)
            result = parse_member(raw, code, member, run_date)
            parsed.append((member, raw, result))
            for s in result["sections"]:
                counts[s["number"]] = counts.get(s["number"], 0) + 1
        del data, archive
        seen: dict[str, int] = {}
        emitted = 0
        for member, raw, result in parsed:
            if not result["sections"]:
                continue
            src = ctx.member(archive_src, member, raw).source()
            for s in result["sections"]:
                index = None
                if counts[s["number"]] > 1:
                    seen[s["number"]] = seen.get(s["number"], 0) + 1
                    index = seen[s["number"]]
                path = [{"level": lvl, "label": label, "number": num, "heading": head}
                        for lvl, num, label, head in s["path"]]
                source = dict(src, display_url=s["url"])
                if s["status"]:
                    status = {"status": s["status"], "status_marker": s["status_marker"],
                              "status_basis": "publisher_marker"}
                else:
                    status = sb.status_kwargs(s["heading"], s["text"])
                if status is None:
                    ctx.log(f"{code} {s['number']}: no text and no status marker; skipped")
                    continue
                ctx.section(code=code, number=s["number"], heading=s["heading"], text=s["text"], path=path,
                            source=source, history=s["history"], effective=s["effective"], **status,
                            version=s["version"] or (next((n for n in result["chapter_notes"]
                                                           if "consisting of" in n), None) if index else None),
                            version_index=index)
                emitted += 1
                if not ctx.want_more():
                    return
                if per_code and ctx.sample is not None and emitted >= per_code:
                    break
            if per_code and ctx.sample is not None and emitted >= per_code:
                break
