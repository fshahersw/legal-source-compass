"""Python port of the shared citation parser src/lib/assistant/citations.ts (the parser the assistant's cite checker uses).

Deterministic extraction of full legal citations: case reporters, U.S.C., C.F.R., Statutes at Large, public laws and Federal
Register pages. Short forms (Id., supra, "576 U.S. at 650") are not citations and are skipped. No lookup happens here.

Parity: scripts/documents/fixtures/citation_parity.json holds texts with the TypeScript parser's output; test_documents.py
checks this module against it and src/lib/documents/citationParity.test.ts checks the TypeScript module against the same file.
JavaScript regex classes are reproduced exactly: \\w and \\d are ASCII, \\s is JavaScript whitespace (it includes the no-break
space). Offsets are str indexes (code points); they equal the TypeScript UTF-16 offsets for text without astral characters.
Beyond the TypeScript fields, list and range items carry `item_start` / `item_end`: the absolute span of that one item, so a
caller can give every item of "§§ 1331, 1332" its own exact offsets.
"""

from __future__ import annotations

import re

W = r"[A-Za-z0-9_]"
NW = r"[^A-Za-z0-9_]"
D = r"[0-9]"
S = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"
_S_RE = re.compile(S + "+")


def js(pattern: str) -> str:
    """Rewrites \\w, \\d and \\s of a JavaScript-style pattern into explicit classes (outside and inside brackets)."""
    out = []
    i = 0
    in_class = False
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            nxt = pattern[i + 1]
            if nxt in "wds":
                inner = {"w": "A-Za-z0-9_", "d": "0-9", "s": S[1:-1]}[nxt]
                out.append(inner if in_class else "[" + inner + "]")
                i += 2
                continue
            out.append(pattern[i : i + 2])
            i += 2
            continue
        if ch == "[" and not in_class:
            in_class = True
        elif ch == "]" and in_class:
            in_class = False
        out.append(ch)
        i += 1
    return "".join(out)


REPORTERS = [
    # Federal
    "U.S.", "S. Ct.", "L. Ed.", "L. Ed. 2d", "F.", "F.2d", "F.3d", "F.4th", "F. Supp.", "F. Supp. 2d", "F. Supp. 3d",
    "F. App'x", "Fed. App'x", "Fed. Appx.", "F. Appx.", "F. Cas.", "F.R.D.", "B.R.", "Fed. Cl.", "Cl. Ct.", "Ct. Cl.",
    "Ct. Int'l Trade", "C.C.P.A.", "T.C.", "B.T.A.", "Vet. App.", "M.J.", "C.M.A.", "C.M.R.", "App. D.C.", "U.S. App. D.C.",
    "WL", "U.S. LEXIS", "U.S. App. LEXIS", "U.S. Dist. LEXIS", "Bankr. LEXIS",
    # Regional
    "A.", "A.2d", "A.3d", "P.", "P.2d", "P.3d", "N.E.", "N.E.2d", "N.E.3d", "N.W.", "N.W.2d", "S.E.", "S.E.2d", "S.W.",
    "S.W.2d", "S.W.3d", "So.", "So. 2d", "So. 3d", "Cal. Rptr.", "Cal. Rptr. 2d", "Cal. Rptr. 3d", "N.Y.S.", "N.Y.S.2d",
    "N.Y.S.3d", "Ill. Dec.",
    # State official reporters (most cited)
    "Cal.", "Cal. 2d", "Cal. 3d", "Cal. 4th", "Cal. 5th", "Cal. App.", "Cal. App. 2d", "Cal. App. 3d", "Cal. App. 4th",
    "Cal. App. 5th", "N.Y.", "N.Y.2d", "N.Y.3d", "A.D.", "A.D.2d", "A.D.3d", "Misc.", "Misc. 2d", "Misc. 3d", "Ill.",
    "Ill. 2d", "Ill. App.", "Ill. App. 2d", "Ill. App. 3d", "Mass.", "Mass. App. Ct.", "Pa.", "Pa. Super.", "Pa. Commw.",
    "N.J.", "N.J. Super.", "Wash.", "Wash. 2d", "Wash. App.", "Ohio St.", "Ohio St. 2d", "Ohio St. 3d", "Ohio App.",
    "Ohio App. 2d", "Ohio App. 3d", "Mich.", "Mich. App.", "Wis.", "Wis. 2d", "Minn.", "Md.", "Md. App.", "Conn.",
    "Conn. App.", "Va.", "Va. App.", "Ga.", "Ga. App.", "N.C.", "N.C. App.", "S.C.", "Ariz.", "Ariz. App.", "Colo.", "Or.",
    "Or. App.", "Haw.", "Kan.", "Kan. App. 2d", "Mo.", "Neb.", "Nev.", "N.M.", "Okla.", "Vt.", "W. Va.", "Wyo.", "Ala.",
    "Ark.", "Del.", "Del. Ch.", "Fla.", "Ind.", "Ind. App.", "Ky.", "La.", "Me.", "Miss.", "Mont.", "N.D.", "N.H.", "R.I.",
    "S.D.", "Tenn.", "Tex.", "Tex. Crim.",
]

_JS_SPECIAL = set(".*+?^${}()|[]\\")


def _js_escape(token: str) -> str:
    return "".join("\\" + c if c in _JS_SPECIAL else c for c in token)


def reporter_pattern(r: str) -> str:
    tokens: list[str] = []
    for chunk in r.split(" "):
        parts = re.findall(r"[^.]+\.|[^.]+$", chunk)
        tokens.extend(parts if parts else [chunk])
    return "\\s?".join(_js_escape(t).replace("'", "['’]") for t in tokens)


REPORTER_ALT = "|".join(reporter_pattern(r) for r in sorted(REPORTERS, key=lambda r: -len(r)))

CASE_RE = re.compile(js(r"(?<![\w.§-])(\d{1,4})\s+(" + REPORTER_ALT + r")\s+(\d{1,7})(?![\w])"))

USC_SEC = r"\d{1,6}(?:[a-zA-Z]{1,4}(?:-\d{1,4}[a-zA-Z]{0,4})*)?"
CFR_SEC = r"\d{1,6}[a-zA-Z]{0,4}(?:(?:\([a-z0-9]{1,4}\))?-\d{1,4}[a-zA-Z]{0,4}(?!\.\d))*"
SUBS = r"(?:\([a-zA-Z0-9]{1,5}\))*"
RANGE = r"\s*(?:[-–—]|\s(?:to|through)\s)\s*"
LIST_SEP = r"\s*(?:,\s*(?:and\s+|or\s+|&\s*)?|(?:and|or|&)\s+)"
NOT_NEXT_CITE = (
    r"(?![\d\s]*(?:U\.?\s?S\.?\s?C|C\.?\s?F\.?\s?R|Stat\.|Fed\.\s?Reg|F\.\s?R\.|FR(?![A-Za-z0-9_])|(?:"
    + REPORTER_ALT
    + r")\s+\d))"
)
USC_ITEM = USC_SEC + SUBS + "(?:" + RANGE + USC_SEC + SUBS + ")?"
USC_RE = re.compile(
    js(
        r"(?<![\w.])(\d{1,2})\s*U\.?\s?S\.?\s?(?:Code|C\.?(?:\s?A\.?|\s?S\.?)?)(?![A-Za-z])\s*(§§|§|[Ss]ecs?\.|[Ss]ections?|[Ss]ec\.)?\s*("
        + USC_ITEM
        + "(?:"
        + LIST_SEP
        + NOT_NEXT_CITE
        + USC_ITEM
        + ")*)"
    )
)
USC_ITEM_RE = re.compile(js("(" + USC_SEC + ")(" + SUBS + ")(?:" + RANGE + "(" + USC_SEC + ")(" + SUBS + "))?"))

CFR_NUM = r"\d{1,4}(?:\." + CFR_SEC + ")?"
CFR_ITEM = CFR_NUM + SUBS + "(?:" + RANGE + CFR_NUM + SUBS + ")?"
CFR_RE = re.compile(
    js(
        r"(?<![\w.])(\d{1,2})\s*C\.?\s?F\.?\s?R\.?(?![A-Za-z])\s*(§§|§|[Ss]ecs?\.|[Ss]ections?|[Pp]arts?|[Pp]ts?\.)?\s*("
        + CFR_ITEM
        + "(?:"
        + LIST_SEP
        + NOT_NEXT_CITE
        + CFR_ITEM
        + ")*)"
    )
)
CFR_ITEM_RE = re.compile(
    js(r"(\d{1,4})(?:\.(" + CFR_SEC + "))?(" + SUBS + ")(?:" + RANGE + r"(\d{1,4})(?:\.(" + CFR_SEC + "))?(" + SUBS + "))?")
)

STAT_RE = re.compile(js(r"(?<![\w.])(\d{1,3})\s+Stat\.\s+(\d{1,5})(?![\w])"))
PUBL_RE = re.compile(js(r"(?<![\w.])(?:Pub(?:lic)?\.?\s*L(?:aw)?\.?|P\.\s?L\.)\s*(?:No\.?\s*)?(\d{1,3})\s*[-–‑]\s*(\d{1,4})(?![\w])"))
FR_RE = re.compile(js(r"(?<![\w.])(\d{1,3})\s+(?:Fed\.\s?Reg\.|F\.\s?R\.|FR)(?![A-Za-z.])\s+(\d{1,3}(?:,\d{3})+|\d{1,6})(?![\w])"))
PIN_RE = re.compile(js(r"^,\s*((?:at\s+)?\d{1,7}(?:\s*[-–—]\s*\d{1,7})?(?:\s*n\.\s*\d{1,3})?)"))
_JOIN_RE = re.compile(js(r"^\s*,\s*$"))
_PLURAL_RE = re.compile(r"^(§§|secs\.|sections|parts|pts\.)$", re.I)


def squash(s: str) -> str:
    return _S_RE.sub(" ", s).strip(" ")


def _subs(s: str | None) -> str:
    return _S_RE.sub("", s) if s else ""


def _plural(label: str | None) -> bool:
    return bool(label) and bool(_PLURAL_RE.match(label))


def _used_span(m: re.Match, items: list[re.Match]) -> tuple[str, int, int]:
    """The part of a statutory match actually used: up to the last list item taken. Returns (written, end, body_start)."""
    body_start = len(m.group(0)) - len(m.group(3))
    last = items[-1] if items else None
    length = body_start + last.start() + len(last.group(0)) if last else len(m.group(0))
    return squash(m.group(0)[:length]), m.start() + length, m.start() + body_start


def _case_citations(text: str) -> list[dict]:
    out = []
    for m in CASE_RE.finditer(text):
        volume = int(m.group(1))
        page = int(m.group(3))
        reporter = squash(m.group(2)).replace("’", "'")
        out.append(
            {
                "kind": "case",
                "text": squash(m.group(0)),
                "key": f"case:{volume} {_S_RE.sub('', reporter).replace('’', chr(39))} {page}",
                "normalized": f"{volume} {reporter} {page}",
                "start": m.start(),
                "end": m.end(),
                "pin": None,
                "volume": volume,
                "reporter": reporter,
                "page": page,
            }
        )
    return out


def _usc_citations(text: str) -> list[dict]:
    out = []
    for m in USC_RE.finditer(text):
        title = int(m.group(1))
        items = list(USC_ITEM_RE.finditer(m.group(3)))[: 20 if _plural(m.group(2)) else 1]
        written, end, body = _used_span(m, items)
        for i, item in enumerate(items):
            section = item.group(1)
            section_end = item.group(3)
            pin = _subs(item.group(2)) or _subs(item.group(4)) or None
            out.append(
                {
                    "kind": "usc",
                    "text": written,
                    "key": f"usc:{title}:{section}" + (f":{section_end}" if section_end else ""),
                    "normalized": f"{title} U.S.C. §§ {section}–{section_end}" if section_end else f"{title} U.S.C. § {section}",
                    "start": m.start(),
                    "end": end,
                    "pin": pin,
                    "title": title,
                    "section": section,
                    "sectionEnd": section_end,
                    "item_start": m.start() if i == 0 else body + item.start(),
                    "item_end": body + item.end(),
                }
            )
    return out


def _cfr_citations(text: str) -> list[dict]:
    out = []
    for m in CFR_RE.finditer(text):
        title = int(m.group(1))
        items = list(CFR_ITEM_RE.finditer(m.group(3)))[: 20 if _plural(m.group(2)) else 1]
        written, span_end, body = _used_span(m, items)
        for i, item in enumerate(items):
            part = int(item.group(1))
            section = item.group(2)
            end_part = int(item.group(4)) if item.group(4) else None
            end_section = item.group(5)
            pin = _subs(item.group(3)) or _subs(item.group(6)) or None
            item_start = m.start() if i == 0 else body + item.start()
            if section:
                end = f"{end_part}.{end_section}" if end_part is not None and end_section else None
                out.append(
                    {
                        "kind": "cfr",
                        "text": written,
                        "key": f"cfr:{title}:{part}.{section}" + (f":{end}" if end else ""),
                        "normalized": f"{title} C.F.R. §§ {part}.{section}–{end}" if end else f"{title} C.F.R. § {part}.{section}",
                        "start": m.start(),
                        "end": span_end,
                        "pin": pin,
                        "title": title,
                        "part": part,
                        "section": section,
                        "sectionEnd": end,
                        "item_start": item_start,
                        "item_end": body + item.end(),
                    }
                )
            else:
                # "21 C.F.R. Part 11", "21 CFR 11" and "parts 210-211" name whole parts.
                adjacent = end_part is not None and end_part > part and end_part - part <= 1
                parts = [part, end_part] if adjacent else [part]
                rng = end_part if end_part is not None and end_part - part > 1 else None
                for j, p in enumerate(parts):
                    if adjacent and j == 1:
                        p_start, p_end = body + item.start(4), body + item.end(4)
                    elif adjacent:
                        p_start, p_end = item_start, body + item.end(1)
                    else:
                        p_start, p_end = item_start, body + item.end()
                    out.append(
                        {
                            "kind": "cfr",
                            "text": written,
                            "key": f"cfr-part:{title}:{p}" + (f":{rng}" if rng else ""),
                            "normalized": f"{title} C.F.R. parts {p}–{rng}" if rng else f"{title} C.F.R. part {p}",
                            "start": m.start(),
                            "end": span_end,
                            "pin": pin,
                            "title": title,
                            "part": p,
                            "sectionEnd": str(rng) if rng else None,
                            "item_start": p_start,
                            "item_end": p_end,
                        }
                    )
    return out


def _simple_citations(text: str) -> list[dict]:
    out = []
    for m in STAT_RE.finditer(text):
        volume, page = int(m.group(1)), int(m.group(2))
        out.append({"kind": "statute", "text": squash(m.group(0)), "key": f"stat:{volume}:{page}",
                    "normalized": f"{volume} Stat. {page}", "start": m.start(), "end": m.end(), "pin": None,
                    "volume": volume, "page": page})
    for m in PUBL_RE.finditer(text):
        congress, law = int(m.group(1)), int(m.group(2))
        out.append({"kind": "public_law", "text": squash(m.group(0)), "key": f"pl:{congress}:{law}",
                    "normalized": f"Pub. L. No. {congress}-{law}", "start": m.start(), "end": m.end(), "pin": None,
                    "congress": congress, "law": law})
    for m in FR_RE.finditer(text):
        volume, page = int(m.group(1)), int(m.group(2).replace(",", ""))
        out.append({"kind": "federal_register", "text": squash(m.group(0)), "key": f"fr:{volume}:{page}",
                    "normalized": f"{volume} Fed. Reg. {page}", "start": m.start(), "end": m.end(), "pin": None,
                    "volume": volume, "page": page})
    return out


def extract_citations(text: str, limit: int = 200) -> list[dict]:
    """Every full citation in `text`, in reading order, at most `limit` (as extractCitations in citations.ts)."""
    source = text[:200_000]
    allc = _case_citations(source) + _usc_citations(source) + _cfr_citations(source) + _simple_citations(source)
    allc.sort(key=lambda c: (c["start"], -c["end"]))
    kept: list[dict] = []
    span_start = span_end = -1
    for c in allc:
        # Items split out of one statutory list share its span; anything else overlapping an earlier match is dropped.
        if c["start"] == span_start and c["end"] == span_end:
            kept.append(c)
            continue
        if c["start"] < span_end:
            continue
        kept.append(c)
        span_start, span_end = c["start"], c["end"]
    out: list[dict] = []
    group = 0
    previous_case_end = -1
    for i, c in enumerate(kept):
        pinned = c["kind"] in ("case", "statute", "federal_register")
        nxt = next((n for n in kept[i + 1 :] if n["start"] > c["start"]), None)
        pin = PIN_RE.match(source[c["end"] : c["end"] + 40]) if pinned else None
        tail = c["end"]
        pin_text = c["pin"]
        if pin and not (nxt and nxt["start"] < c["end"] + len(pin.group(0))):
            pin_text = _S_RE.sub(" ", pin.group(1))
            tail = c["end"] + len(pin.group(0))
        if c["kind"] != "case":
            out.append({**c, "pin": pin_text, "group": None})
            previous_case_end = -1
            continue
        joined = previous_case_end >= 0 and bool(_JOIN_RE.match(source[previous_case_end : c["start"]]))
        if not joined:
            group += 1
        out.append({**c, "pin": pin_text, "group": group})
        previous_case_end = tail
    return out[:limit]


TS_FIELDS = ("kind", "text", "key", "normalized", "start", "end", "pin", "group", "volume", "reporter", "page", "title",
             "part", "section", "sectionEnd", "congress", "law")


def ts_view(c: dict) -> dict:
    """The fields citations.ts returns (for the parity fixture)."""
    return {k: c[k] for k in TS_FIELDS if k in c}
