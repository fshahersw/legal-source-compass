"""California — Office of Legislative Counsel `pubinfo` bulk export (official), state-law/1 parser.

Source: https://downloads.leginfo.legislature.ca.gov/pubinfo_<session-year>.zip, rebuilt weekly (Sunday night) with
daily delta zips. Tables used: CODES_TBL, LAW_TOC_TBL, LAW_TOC_SECTIONS_TBL, LAW_SECTION_TBL and the per-section
CAML LOB members (LAW_SECTION_TBL_<n>.lob). The constitution (CONS) is excluded (not statute).

Full run: one streamed pass over the archive (~1.3 GB, nothing written to disk). Sample run: HTTP range requests for
the zip directory, the three LAW tables and N section members only. robots.txt on the download host: none (404).
Status comes only from the publisher's history line: "Operative <date>" in the future -> future_effective,
"Inoperative <date>" past -> expired, "Repealed as of <date>" past -> repealed; future end dates go to effective.end.
"""
from __future__ import annotations

import collections
import datetime as dt
import pathlib
import re
import struct
import sys
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

HOST = "downloads.leginfo.legislature.ca.gov"
ARCHIVE = "pubinfo_2025.zip"  # 2025-26 session database; switches to pubinfo_2027.zip with the next session
URL = f"https://{HOST}/{ARCHIVE}"
CAL = r"(?:cal(?:ifornia)?\.?\s?)?"

# (key, publisher name, Bluebook citation abbreviation, extra citation aliases as people write them)
_CODES = [
    ("BPC", "Business and Professions Code", "Cal. Bus. & Prof. Code", ["Bus. & Prof. Code", "Business and Professions Code", "B&P Code", "BPC"]),
    ("CCP", "Code of Civil Procedure", "Cal. Civ. Proc. Code", ["Code Civ. Proc.", "Civ. Proc. Code", "Code of Civil Procedure", "C.C.P.", "CCP"]),
    ("CIV", "Civil Code", "Cal. Civ. Code", ["Civ. Code", "Civil Code"]),
    ("COM", "Commercial Code", "Cal. Com. Code", ["Com. Code", "Commercial Code", "U. Com. Code"]),
    ("CORP", "Corporations Code", "Cal. Corp. Code", ["Corp. Code", "Corporations Code"]),
    ("EDC", "Education Code", "Cal. Educ. Code", ["Educ. Code", "Ed. Code", "Education Code"]),
    ("ELEC", "Elections Code", "Cal. Elec. Code", ["Elec. Code", "Elections Code"]),
    ("EVID", "Evidence Code", "Cal. Evid. Code", ["Evid. Code", "Evidence Code"]),
    ("FAM", "Family Code", "Cal. Fam. Code", ["Fam. Code", "Family Code"]),
    ("FIN", "Financial Code", "Cal. Fin. Code", ["Fin. Code", "Financial Code"]),
    ("FGC", "Fish and Game Code", "Cal. Fish & Game Code", ["Fish & G. Code", "Fish & Game Code", "Fish and Game Code"]),
    ("FAC", "Food and Agricultural Code", "Cal. Food & Agric. Code", ["Food & Agr. Code", "Food & Agric. Code", "Food and Agricultural Code"]),
    ("GOV", "Government Code", "Cal. Gov't Code", ["Gov. Code", "Govt. Code", "Gov't Code", "Government Code"]),
    ("HNC", "Harbors and Navigation Code", "Cal. Harb. & Nav. Code", ["Harb. & Nav. Code", "Harbors and Navigation Code"]),
    ("HSC", "Health and Safety Code", "Cal. Health & Safety Code", ["Health & Saf. Code", "Health & Safety Code", "Health and Safety Code"]),
    ("INS", "Insurance Code", "Cal. Ins. Code", ["Ins. Code", "Insurance Code"]),
    ("LAB", "Labor Code", "Cal. Lab. Code", ["Lab. Code", "Labor Code"]),
    ("MVC", "Military and Veterans Code", "Cal. Mil. & Vet. Code", ["Mil. & Vet. Code", "Military and Veterans Code"]),
    ("PEN", "Penal Code", "Cal. Penal Code", ["Pen. Code", "Penal Code"]),
    ("PROB", "Probate Code", "Cal. Prob. Code", ["Prob. Code", "Probate Code"]),
    ("PCC", "Public Contract Code", "Cal. Pub. Cont. Code", ["Pub. Contract Code", "Pub. Cont. Code", "Public Contract Code"]),
    ("PRC", "Public Resources Code", "Cal. Pub. Res. Code", ["Pub. Resources Code", "Pub. Res. Code", "Public Resources Code"]),
    ("PUC", "Public Utilities Code", "Cal. Pub. Util. Code", ["Pub. Util. Code", "Pub. Utilities Code", "Public Utilities Code"]),
    ("RTC", "Revenue and Taxation Code", "Cal. Rev. & Tax. Code", ["Rev. & Tax. Code", "Revenue and Taxation Code"]),
    ("SHC", "Streets and Highways Code", "Cal. Sts. & High. Code", ["Sts. & Hy. Code", "Sts. & High. Code", "Streets and Highways Code"]),
    ("UIC", "Unemployment Insurance Code", "Cal. Unemp. Ins. Code", ["Unemp. Ins. Code", "Unemployment Insurance Code"]),
    ("VEH", "Vehicle Code", "Cal. Veh. Code", ["Veh. Code", "Vehicle Code"]),
    ("WAT", "Water Code", "Cal. Water Code", ["Wat. Code", "Water Code"]),
    ("WIC", "Welfare and Institutions Code", "Cal. Welf. & Inst. Code", ["Welf. & Inst. Code", "Welfare and Institutions Code", "W&I Code"]),
]

META = lib.StateMeta(
    state="CA",
    code_name="California Codes",
    publisher="California Legislature — Office of Legislative Counsel (leginfo.legislature.ca.gov)",
    publisher_url="https://leginfo.legislature.ca.gov/faces/codes.xhtml",
    official_source=True,
    access="bulk",
    hosts=(HOST,),
    parser="ca-pubinfo-law/1",
    min_interval_s=1.0,
    codes=tuple(
        lib.Code(key, name, f"{abbr} § {{n}}", lib.alias_patterns(aliases + [abbr.replace("Cal. ", "")], prefix=CAL))
        for key, name, abbr, aliases in _CODES
    ),
    terms_note=(
        "California statutes are public; the Legislative Counsel publishes the law database as the pubinfo bulk "
        "export for public download (downloads.leginfo.legislature.ca.gov, no robots.txt). The leginfo web pages "
        "answer automated clients with HTTP 403 and are not used."
    ),
    update_cadence="pubinfo_<session>.zip rebuilt weekly (Sunday night); daily delta zips Mon–Sat; re-check weekly.",
)

KEEP = {"CODES_TBL.dat", "LAW_TOC_TBL.dat", "LAW_TOC_SECTIONS_TBL.dat", "LAW_SECTION_TBL.dat"}
LOB_RE = re.compile(r"^LAW_SECTION_TBL_\d+\.lob$")
NODE_RE = re.compile(
    r"^(DIVISION|TITLE|PART|CHAPTER|ARTICLE|SUBCHAPTER|SUBARTICLE|SUBPART|SUBDIVISION)\s+([0-9]+[0-9A-Za-z.]*?)\.?\s+(.*)$"
)
LEVEL = {"DIVISION": "division", "TITLE": "title", "PART": "part", "CHAPTER": "chapter", "ARTICLE": "article",
         "SUBCHAPTER": "subchapter", "SUBARTICLE": "subarticle", "SUBPART": "subpart", "SUBDIVISION": "subdivision"}
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
DATE = rf"({MONTHS}) (\d{{1,2}}), (\d{{4}})"
OPERATIVE_RE = re.compile(rf"(?<![Ii]n)(?:Section )?[Oo]perative (?:on )?{DATE}[^.]*\.?")
INOPERATIVE_RE = re.compile(rf"[Ii]noperative (?:on )?{DATE}[^.]*\.?")
REPEALED_RE = re.compile(rf"Repealed (?:as of|on) {DATE}[^.]*\.?")


def _date(match: re.Match) -> dt.date:
    month = MONTHS.split("|").index(match.group(1)) + 1
    return dt.date(int(match.group(3)), month, int(match.group(2)))


def parse_dat(body: bytes, ncols: int) -> list[tuple[bytes, list[str | None]]]:
    """pubinfo .dat: one row per line, tab-separated, strings wrapped in backticks, NULL bare."""
    rows = []
    for line in body.split(b"\n"):
        if not line.strip():
            continue
        fields = line.rstrip(b"\r").split(b"\t")
        if len(fields) != ncols:
            raise ValueError(f"expected {ncols} columns, got {len(fields)}: {line[:120]!r}")
        values: list[str | None] = []
        for raw in fields:
            text = raw.decode("utf-8")
            if text == "NULL":
                values.append(None)
            elif len(text) >= 2 and text[0] == "`" and text[-1] == "`":
                values.append(text[1:-1])
            else:
                values.append(text)
        rows.append((line.rstrip(b"\r"), values))
    return rows


def status_of(history: str | None, effective_date: str | None, today: dt.date) -> dict:
    """Status + effective dates from the publisher's history line only."""
    history = history or ""
    start = effective_date[:10] if effective_date else None
    end = None
    out = {"status": None, "marker": None}
    operative = OPERATIVE_RE.search(history)
    if operative:
        when = _date(operative)
        if when > today:
            return {"status": "future_effective", "marker": operative.group(0).strip(),
                    "effective": {"start": when.isoformat(), "end": None, "note": None}}
        start = max(start or "", when.isoformat())
    inoperative = INOPERATIVE_RE.search(history)
    repealed = REPEALED_RE.search(history)
    if inoperative:
        when = _date(inoperative)
        if when <= today:
            out = {"status": "expired", "marker": inoperative.group(0).strip()}
        else:
            end = when.isoformat()
    if out["status"] is None and repealed:
        when = _date(repealed)
        if when <= today:
            out = {"status": "repealed", "marker": repealed.group(0).strip()}
        else:
            end = min(end, when.isoformat()) if end else when.isoformat()
    out["effective"] = {"start": start or None, "end": end, "note": None}
    return out


class Tables:
    """The four LAW tables, indexed for section assembly and document order."""

    def __init__(self, codes_body: bytes, toc_body: bytes, toc_sections_body: bytes, sections_body: bytes):
        self.codes = [v for _l, v in parse_dat(codes_body, 2) if v[0] != "CONS"]
        self.toc = [(l, v) for l, v in parse_dat(toc_body, 19) if v[0] != "CONS" and v[7] == "Y"]
        self.toc_sections = [(l, v) for l, v in parse_dat(toc_sections_body, 13) if v[1] != "CONS"]
        self.sections = [(l, v) for l, v in parse_dat(sections_body, 18) if v[1] != "CONS" and v[15] == "Y"]
        self.by_lob = {v[14]: (l, v) for l, v in self.sections}
        self.node = {(v[0], v[13]): (l, v) for l, v in self.toc}
        version_place = {v[11]: (v[2], int(v[4] or 0)) for _l, v in self.toc_sections}
        groups: dict[tuple[str, str], list] = collections.defaultdict(list)
        for line, v in self.sections:
            groups[(v[1], v[2])].append((line, v))
        self.groups = groups
        code_order = {c[0]: i for i, c in enumerate(self.codes)}

        def tp_key(tp: str | None) -> tuple:
            return tuple(int(p) if p.isdigit() else 10**6 for p in (tp or "999999").split("."))

        order = []
        for (code, num), versions in groups.items():
            place = version_place.get(versions[0][1][7])
            tree, pos = place if place else (None, 10**7)
            order.append((code_order.get(code, 999), tp_key(tree), pos, _num_key(num), code, num))
        order.sort()
        self.ordinal: dict[tuple[str, str], int] = {}
        next_ordinal = 0
        for *_k, code, num in order:
            self.ordinal[(code, num)] = next_ordinal
            next_ordinal += len(groups[(code, num)])
        self.treepath = {v[7]: version_place.get(v[7], (None, 0))[0] for _l, v in self.sections}

    def path(self, code: str, treepath: str | None) -> list[dict]:
        if not treepath:
            return []
        parts = treepath.split(".")
        out = []
        for i in range(1, len(parts) + 1):
            hit = self.node.get((code, ".".join(parts[:i])))
            if not hit:
                continue
            out.append(node_step(hit[1][6]))
        return out


def _num_key(num: str) -> tuple:
    return tuple(int(p) if p.isdigit() else p for p in re.findall(r"\d+|[A-Za-z]+", num or ""))


def node_step(heading: str | None) -> dict:
    heading = lib.norm_ws(re.sub(r"\s*\[[^\]]*\]\s*$", "", heading or ""))
    match = NODE_RE.match(heading)
    if match:
        return {"level": LEVEL[match.group(1)], "label": match.group(1).title(), "number": match.group(2).rstrip("."),
                "heading": match.group(3) or None}
    return {"level": "other", "label": heading or "Provisions", "number": None, "heading": heading or None}


def emit_nodes(ctx: lib.RunContext, tables: Tables) -> None:
    def tp_key(row: list) -> tuple:
        return tuple(int(p) for p in row[13].split(".") if p.isdigit())

    code_order = {c[0]: i for i, c in enumerate(tables.codes)}
    for _line, v in sorted(tables.toc, key=lambda lv: (code_order.get(lv[1][0], 999), tp_key(lv[1]))):
        if v[0] in code_order:
            ctx.ensure_path(v[0], tables.path(v[0], v[13]))


def emit_group(ctx: lib.RunContext, tables: Tables, code: str, num: str, lobs: dict[str, lib.Fetched],
               rows: dict[str, lib.Fetched]) -> None:
    versions = tables.groups[(code, num)]
    decorated = []
    for line, v in versions:
        state = status_of(v[13], v[6], ctx.today)
        decorated.append(((state["effective"]["start"] or "", v[0]), line, v, state))
    decorated.sort(key=lambda item: item[0])
    base = tables.ordinal[(code, num)]
    for k, (_key, _line, v, state) in enumerate(decorated):
        lob = lobs[v[14]]
        text = lib.caml_text(lob.body)
        path = tables.path(code, tables.treepath.get(v[7]))
        ctx.section(
            code=code, number=num.rstrip("."), heading=None, text=text, history=v[13], source=lob,
            also=[rows[v[14]]], path=path, status=state["status"], status_marker=state.get("marker"),
            effective=state["effective"], version=v[13] if len(decorated) > 1 else None,
            version_index=k + 1 if len(decorated) > 1 else None, ordinal=base + k,
        )


# ------------------------------------------------------------------------------------------------- sample (ranges)

def _zip_directory(ctx: lib.RunContext) -> dict[str, tuple]:
    tail = ctx.fetch(URL, headers={"Range": "bytes=-65536"}, accept_status=(206,), method="publisher_bulk")
    total = int(tail.headers["content-range"].rsplit("/", 1)[1])
    ctx.last_modified = tail.headers.get("last-modified")
    b = tail.body
    locator = b.rfind(b"PK\x06\x07")
    base = total - len(b)
    if locator >= 0:
        eocd64 = struct.unpack("<Q", b[locator + 8: locator + 16])[0] - base
        cd_size = struct.unpack("<Q", b[eocd64 + 40: eocd64 + 48])[0]
        cd_off = struct.unpack("<Q", b[eocd64 + 48: eocd64 + 56])[0]
    else:
        eocd = b.rfind(b"PK\x05\x06")
        cd_size, cd_off = struct.unpack("<II", b[eocd + 12: eocd + 20])
    cd = ctx.fetch(URL, headers={"Range": f"bytes={cd_off}-{cd_off + cd_size - 1}"}, accept_status=(206,),
                   method="publisher_bulk").body
    entries, pos = {}, 0
    while cd[pos:pos + 4] == b"PK\x01\x02":
        (_vm, _vn, _fl, meth, _t, _d, _crc, cs, us, nl, xl, cl, _dn, _ia, _ea, off) = struct.unpack(
            "<HHHHHHIIIHHHHHII", cd[pos + 4: pos + 46])
        name = cd[pos + 46: pos + 46 + nl].decode("cp437")
        extra = cd[pos + 46 + nl: pos + 46 + nl + xl]
        if 0xFFFFFFFF in (cs, us, off):
            p = 0
            while p + 4 <= len(extra):
                hid, hl = struct.unpack("<HH", extra[p:p + 4])
                vals, q = extra[p + 4: p + 4 + hl], 0
                if hid == 1:
                    if us == 0xFFFFFFFF:
                        us, q = struct.unpack("<Q", vals[q:q + 8])[0], q + 8
                    if cs == 0xFFFFFFFF:
                        cs, q = struct.unpack("<Q", vals[q:q + 8])[0], q + 8
                    if off == 0xFFFFFFFF:
                        off = struct.unpack("<Q", vals[q:q + 8])[0]
                p += 4 + hl
        if name in KEEP or LOB_RE.match(name):
            entries[name] = (off, cs, meth)
        pos += 46 + nl + xl + cl
    return entries


def _range_member(ctx: lib.RunContext, name: str, entry: tuple, keep_source: bool = True) -> lib.Fetched:
    off, cs, meth = entry
    got = ctx.fetch(URL, headers={"Range": f"bytes={off}-{off + 30 + len(name) + 4096 + cs}"}, accept_status=(206,),
                    method="publisher_bulk")
    nl, xl = struct.unpack("<HH", got.body[26:30])
    data = got.body[30 + nl + xl: 30 + nl + xl + cs]
    body = zlib.decompress(data, -15) if meth == 8 else data
    return ctx.member(got, name, body) if keep_source else lib.Fetched(
        url=URL, final_url=URL, status=200, headers={}, body=body, sha256="", bytes=len(body),
        retrieved_at=got.retrieved_at, method="publisher_bulk", member=name)


SAMPLE_PICKS = [("CCP", "335.1."), ("CCP", "340.8."), ("CCP", "415.20."), ("CIV", "1714."), ("CIV", "3294."),
                ("PEN", "187."), ("FIN", "21300."), ("FAC", "513."), ("BPC", "17200."), ("GOV", "12940."),
                ("EVID", "1152."), ("LAB", "1102.5."), ("VEH", "23152."), ("HSC", "11350."), ("WIC", "15610.07.")]


def _row_source(ctx: lib.RunContext, table_member: lib.Fetched, line: bytes, v: list) -> lib.Fetched:
    return ctx.member(table_member.source(), f"LAW_SECTION_TBL.dat#id={v[0]}", line)


def acquire_sample(ctx: lib.RunContext) -> None:
    entries = _zip_directory(ctx)
    bodies = {name: _range_member(ctx, name, entries[name], keep_source=False) for name in sorted(KEEP)}
    tables = Tables(bodies["CODES_TBL.dat"].body, bodies["LAW_TOC_TBL.dat"].body,
                    bodies["LAW_TOC_SECTIONS_TBL.dat"].body, bodies["LAW_SECTION_TBL.dat"].body)
    ctx.edition(edition_label=None, currency_statement=None, currency_source_url=URL,
                source_last_modified=f"{ARCHIVE} Last-Modified {ctx.last_modified}" if ctx.last_modified else None)
    picks = [key for key in SAMPLE_PICKS if key in tables.groups]
    extra = sorted(k for k in tables.groups if k[0] == "CCP" and k not in picks)[: max(0, (ctx.sample or 0) - len(picks))]
    sec_member = bodies["LAW_SECTION_TBL.dat"]
    for code, num in picks + extra:
        if not ctx.want_more():
            break
        lobs, rows = {}, {}
        for line, v in tables.groups[(code, num)]:
            lobs[v[14]] = _range_member(ctx, v[14], entries[v[14]])
            rows[v[14]] = _row_source(ctx, sec_member, line, v)
        emit_group(ctx, tables, code, num, lobs, rows)
    ctx.log(f"sample: {ctx.section_count} sections from {len(picks + extra)} numbers; tables: "
            f"{len(tables.sections)} section versions, {len(tables.toc)} TOC nodes")


# ------------------------------------------------------------------------------------------------- full (stream)

def acquire_full(ctx: lib.RunContext) -> None:
    tables: Tables | None = None
    held: dict[str, bytes] = {}
    pending_lobs: dict[str, bytes] = {}
    done = 0
    with ctx.stream(URL) as stream:
        modified = ctx._stream_meta.get("last_modified")
        ctx.edition(edition_label=None, currency_statement=None, currency_source_url=URL,
                    source_last_modified=f"{ARCHIVE} Last-Modified {modified}" if modified else None)
        archive = {"url": URL, "retrieved_at": ctx._stream_meta["retrieved_at"], "sha256": "0" * 64, "bytes": 0}
        for name, body in lib.iter_zip_members(stream, want=lambda n: n in KEEP or bool(LOB_RE.match(n))):
            if name in KEEP:
                held[name] = body
                if len(held) == len(KEEP):
                    tables = Tables(held["CODES_TBL.dat"], held["LAW_TOC_TBL.dat"], held["LAW_TOC_SECTIONS_TBL.dat"],
                                    held["LAW_SECTION_TBL.dat"])
                    held.clear()
                    emit_nodes(ctx, tables)
                    for lob_name, lob_body in pending_lobs.items():
                        done += _emit_lob(ctx, tables, archive, lob_name, lob_body)
                    pending_lobs.clear()
                continue
            if tables is None:
                pending_lobs[name] = body
            else:
                done += _emit_lob(ctx, tables, archive, name, body)
    if tables is None:
        raise RuntimeError("archive ended before the LAW tables were read")
    ctx.log(f"stream done: {done} section versions emitted of {len(tables.sections)}")


_group_lobs: dict[tuple[str, str], dict[str, bytes]] = {}


def _emit_lob(ctx: lib.RunContext, tables: Tables, archive: dict, name: str, body: bytes) -> int:
    hit = tables.by_lob.get(name)
    if not hit:
        return 0
    _line, v = hit
    key = (v[1], v[2])
    bucket = _group_lobs.setdefault(key, {})
    bucket[name] = body
    versions = tables.groups[key]
    if len(bucket) < len(versions):
        return 0
    lobs = {n: ctx.member(archive, n, b) for n, b in bucket.items()}
    rows = {}
    for line, vv in versions:
        rows[vv[14]] = ctx.member(archive, f"LAW_SECTION_TBL.dat#id={vv[0]}", line)
    emit_group(ctx, tables, key[0], key[1], lobs, rows)
    del _group_lobs[key]
    return len(versions)


def acquire(ctx: lib.RunContext) -> None:
    if ctx.sample is not None:
        acquire_sample(ctx)
    else:
        acquire_full(ctx)
