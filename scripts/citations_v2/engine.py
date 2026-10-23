"""Canonical citation extractor, Python engine (citations-v2). The TypeScript engine is src/lib/citations/engine.ts.

Both engines read the same pattern table (src/lib/citations/patterns.json, built by build_patterns.py) and implement the
same builders; src/lib/citations/fixtures/golden.json holds texts with the exact expected output, and both test suites
(scripts/citations_v2/test_citations_v2.py and src/lib/citations/engine.test.ts) check their engine against it.

What it extracts (kinds): case (full reporter, neutral and T.C. Memo. citations, with pin, parallel group, court/year
parenthetical and the case name written before it), usc, cfr, cfr_part, federal_register, statutes_at_large, public_law,
constitution_us, constitution_state, federal_rule, local_rule, state_statute, state_regulation, mdl and docket (mentions
only), and short forms (Id., "550 U.S. at 555", "Twombly, supra, at 555", "§ 1983" after a full citation, "Rule 12(b)(6)"
after a federal-rule citation) linked to their antecedent in the same document. Nothing is looked up here.

Offsets are code points of the input string ([start, end) of `matched`), exactly what Postgres substr() reads.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TABLE_PATH = ROOT / "src" / "lib" / "citations" / "patterns.json"
ENGINE = "citations-v2-py"
MAX_CHARS = 2_000_000

# JavaScript whitespace (\s without the u flag)
JS_SPACE = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
_SPACE_RE = re.compile("[" + JS_SPACE + "]+")
_LETTERS = re.compile(r"[^a-z]")
_ALNUM = re.compile(r"[^a-z0-9]")


def js_to_py(pattern: str) -> str:
    """Rewrites the shared dialect for Python's re: \\w \\d \\s as JavaScript reads them, (?<name> groups, $ at the very end."""
    out: list[str] = []
    i, in_class = 0, False
    n = len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\" and i + 1 < n:
            nxt = pattern[i + 1]
            if nxt in "wds":
                inner = {"w": "A-Za-z0-9_", "d": "0-9", "s": JS_SPACE}[nxt]
                out.append(inner if in_class else "[" + inner + "]")
            else:
                out.append(pattern[i : i + 2])
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            elif ch == "[":
                out.append("\\[")
                i += 1
                continue
            out.append(ch)
            i += 1
            continue
        if ch == "[":
            in_class = True
            out.append(ch)
            # a leading ] or ^] stays literal
            if i + 1 < n and pattern[i + 1] == "^":
                out.append("^")
                i += 1
            i += 1
            continue
        if ch == "(" and pattern.startswith("(?<", i) and i + 3 < n and pattern[i + 3] not in "=!":
            out.append("(?P<")
            i += 3
            continue
        if ch == "$":
            out.append(r"\Z")
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _flags(f: str) -> int:
    return re.I if "i" in (f or "") else 0


class Compiled:
    def __init__(self, table: dict):
        self.table = table
        self.rules = []
        for order, r in enumerate(table["rules"]):
            c = dict(r)
            c["order"] = order
            c["rx"] = re.compile(js_to_py(r["pattern"]), _flags(r.get("flags", "")))
            if "item" in r:
                c["item_rx"] = re.compile(js_to_py(r["item"]))
            if "atomic" in r:
                c["atomic_rx"] = {g: re.compile(js_to_py(p)) for g, p in r["atomic"].items()}
            c["anchors_l"] = [a.lower() for a in r.get("anchors", [])]
            self.rules.append(c)
        case = table["case"]
        self.signals = re.compile(js_to_py(case["signals"]))
        self.name_tail = re.compile(js_to_py(case["name_tail"]))
        self.paren = re.compile(js_to_py(case["paren"]))
        self.case_pin = re.compile(js_to_py(case["pin"]))
        self.join = re.compile(js_to_py(case["join"]))
        self.abbrev = set(case["abbreviations"])
        self.pins = {k: re.compile(js_to_py(v)) for k, v in table["pins"].items()}
        self.reporters = table["reporters"]
        self.states = table["states"]
        self.state_abbr = table["state_abbr"]
        self.rule_sets = table["rule_sets"]
        self.rule_set_names = table["rule_set_names"]


def compile_table(table: dict) -> Compiled:
    return Compiled(table)


@lru_cache(maxsize=1)
def default() -> Compiled:
    return Compiled(json.loads(TABLE_PATH.read_text(encoding="utf-8")))


# ------------------------------------------------------------------------------------------------ small helpers
def squash(s: str) -> str:
    return _SPACE_RE.sub(" ", s).strip(" ")


def nospace(s: str) -> str:
    return _SPACE_RE.sub("", s)


def dash(s: str) -> str:
    return s.replace("–", "-").replace("—", "-").replace("‑", "-")


def compact(s: str) -> str:
    return nospace(s).replace("’", "'")


ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}


def roman_to_int(s: str) -> int | None:
    s = s.lower()
    if not s or any(ch not in ROMAN for ch in s):
        return None
    total, prev = 0, 0
    for ch in reversed(s):
        v = ROMAN[ch]
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total


def int_to_roman(n: int) -> str:
    out = []
    for v, sym in ((100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= v:
            out.append(sym)
            n -= v
    return "".join(out)


def lead_number(s: str) -> int:
    m = re.match(r"\d+", s)
    return int(m.group(0)) if m else -1


def apply_filter(c: Compiled, name: str, v: str) -> str:
    if name == "int":
        return str(int(v)) if v.isdigit() else v
    if name == "upper":
        return v.upper()
    if name == "lower":
        return v.lower()
    if name == "squash":
        return squash(v)
    if name == "nospace":
        return nospace(v)
    if name == "dash":
        return dash(v)
    if name == "roman":
        v = v.strip()
        r = roman_to_int(v)
        return str(r) if r is not None else v
    if name == "upper_roman":
        return int_to_roman(int(v)) if v.isdigit() and 0 < int(v) < 400 else v.upper()
    if name == "nocomma":
        return v.replace(",", "")
    if name == "slug":
        return _ALNUM.sub("", v.lower())
    if name == "state":
        return c.states.get(_LETTERS.sub("", v.lower()), "")
    if name == "state_abbr":
        return c.state_abbr.get(c.states.get(_LETTERS.sub("", v.lower()), ""), "")
    if name == "rule_set":
        return c.rule_sets.get(_LETTERS.sub("", v.lower()), "")
    if name == "rule_set_name":
        return c.rule_set_names.get(c.rule_sets.get(_LETTERS.sub("", v.lower()), ""), "")
    if name == "last2":
        return v[-2:]
    if name == "docketnum":
        n = v.lstrip("0") or "0"
        return n if len(n) >= 5 else n.zfill(5)
    raise ValueError(f"unknown template filter {name}")


_PLACE = re.compile(r"\{([a-z_0-9]+)((?:\|[a-z_0-9]+)*)\}")
_OPT = re.compile(r"\[([^\[\]]*)\]")


def render(c: Compiled, template: str, groups: dict) -> str:
    def place(m: re.Match) -> str:
        v = groups.get(m.group(1)) or ""
        if not v:
            return ""
        for f in [x for x in m.group(2).split("|") if x]:
            v = apply_filter(c, f, v)
        return v

    def opt(m: re.Match) -> str:
        inner = m.group(1)
        names = [p.group(1) for p in _PLACE.finditer(inner)]
        if names and all(groups.get(nm) for nm in names):
            return _PLACE.sub(place, inner)
        return ""

    return _PLACE.sub(place, _OPT.sub(opt, template))


def groupdict(m: re.Match) -> dict:
    return {k: v for k, v in m.groupdict().items() if v is not None}


# ------------------------------------------------------------------------------------------------ builders
def _cite(rule: dict, kind: str, start: int, end: int, span: tuple[int, int], match_id: int, key, normalized, fields,
          pin=None, form="full", short=None) -> dict:
    return {
        "kind": kind, "form": form, "short": short, "rule": rule["id"], "start": start, "end": end,
        "span": [span[0], span[1]], "key": key, "normalized": normalized, "pin": pin,
        "fields": {k: v for k, v in fields.items() if v not in (None, "")}, "group": None, "name": None, "paren": None,
        "antecedent": None, "short_status": None, "_match": match_id, "_priority": rule.get("priority", 0),
        "_order": rule["order"],
    }


def reporter_editions(c: Compiled, written: str) -> list[str]:
    return c.reporters.get(compact(written), [])


def build_case(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    written = squash(g["reporter"]).replace("’", "'")
    eds = reporter_editions(c, g["reporter"])
    canonical = eds[0] if len(eds) == 1 else compact(g["reporter"])
    volume = str(int(g["volume"]))
    page = g["page"] if not g["page"].isdigit() else str(int(g["page"]))
    if rule["id"] == "case_tc_memo":
        cite = f"{canonical} {volume}-{page}"
    elif rule["id"] == "case_neutral" and "-" in squash(m.group(0)).replace(" -", "-").replace("- ", "-"):
        cite = f"{volume}-{canonical}-{page}"
    else:
        cite = f"{volume} {canonical} {page}"
    fields = {"volume": volume, "reporter": canonical, "reporter_as_written": written, "page": page, "cite": cite}
    if len(eds) > 1:
        fields["reporter_editions"] = "|".join(eds)
    return [_cite(rule, "case", m.start(), m.end(), (m.start(), m.end()), mid, f"case:{volume}:{canonical}:{page}",
                  cite, fields)]


def build_case_short(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    eds = reporter_editions(c, g["reporter"])
    canonical = eds[0] if len(eds) == 1 else compact(g["reporter"])
    volume = str(int(g["volume"]))
    pin = squash(g["pin"])
    fields = {"volume": volume, "reporter": canonical, "reporter_as_written": squash(g["reporter"]).replace("’", "'")}
    return [_cite(rule, "case", m.start(), m.end(), (m.start(), m.end()), mid, None, f"{volume} {canonical} at {pin}",
                  fields, pin=pin, form="short", short="at")]


def build_statute_list(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    family = rule["family"]
    const = rule.get("const", {})
    title = const.get("title") or str(int(g["title"]))
    label = (g.get("label") or "").strip()
    plural = bool(re.fullmatch(r"(§§|secs\.|sections|parts|pts\.)", label, re.I))
    body_start = m.start("items")
    items = list(rule["item_rx"].finditer(m.group("items")))[: 20 if plural else 1]
    if not items:
        return []
    span_end = body_start + items[-1].end()
    out = []
    appendix = bool(g.get("app"))
    for i, it in enumerate(items):
        ig = groupdict(it)
        s = m.start() if i == 0 else body_start + it.start()
        e = body_start + it.end()
        if family == "usc":
            section, section_end = ig["section"], ig.get("section_end")
            pin = nospace(ig.get("subs", "")) or nospace(ig.get("subs_end", "")) or None
            fields = {"title": title, "section": section}
            sep = m.group("items")[it.end("section") : it.start("section_end")] if section_end else ""
            if (section_end and re.fullmatch(r"\d{1,6}[A-Za-z]{1,4}", section) and re.fullmatch(r"\d{1,4}[A-Za-z]{0,4}", section_end)
                    and re.fullmatch(r"[-–—]", sep) and lead_number(section_end) < lead_number(section)):
                section, section_end = f"{section}-{section_end}", None
                fields["section"] = section
                fields["dash_joined"] = "true"
            t = title + ("a" if appendix else "")
            if appendix:
                fields["appendix"] = "true"
            if section_end:
                fields["section_end"] = section_end
                key = f"usc:{t}:{section}:{section_end}"
                norm = f"{title} U.S.C.{' app.' if appendix else ''} §§ {section}–{section_end}"
            else:
                key = f"usc:{t}:{section}"
                norm = f"{title} U.S.C.{' app.' if appendix else ''} § {section}"
            if g.get("etseq") and i == len(items) - 1:
                fields["et_seq"] = "true"
            out.append(_cite(rule, "usc", s, e, (m.start(), span_end), mid, key, norm, fields, pin=pin))
            continue
        # cfr
        part = int(ig["part"])
        section = ig.get("section")
        part_end_text = ig.get("part_end")
        part_end = int(part_end_text) if part_end_text else None
        section_end = ig.get("section_end")
        pin = nospace(ig.get("subs", "")) or nospace(ig.get("subs_end", "")) or None
        if section:
            fields = {"title": title, "part": str(part), "section": section}
            sep = m.group("items")[it.end("subs") : it.start("part_end")] if part_end_text else ""
            if part_end_text and not section_end and re.fullmatch(r"[-–—]", sep) and part_end < part:
                section = f"{section}-{part_end_text}"
                fields["section"] = section
                fields["dash_joined"] = "true"
                part_end = None
            end = f"{part_end}.{section_end}" if part_end is not None and section_end else None
            if end:
                fields["section_end"] = end
            key = f"cfr:{title}:{part}.{section}" + (f":{end}" if end else "")
            norm = f"{title} C.F.R. §§ {part}.{section}–{end}" if end else f"{title} C.F.R. § {part}.{section}"
            out.append(_cite(rule, "cfr", s, e, (m.start(), span_end), mid, key, norm, fields, pin=pin))
            continue
        # whole parts: "21 C.F.R. Part 11", "21 CFR 11", "parts 210-211" (adjacent parts are two citations)
        adjacent = part_end is not None and part_end > part and part_end - part <= 1
        rng = part_end if part_end is not None and part_end - part > 1 else None
        parts = [part, part_end] if adjacent else [part]
        for j, p in enumerate(parts):
            if adjacent and j == 1:
                ps, pe = body_start + it.start("part_end"), body_start + it.end("part_end")
            elif adjacent:
                ps, pe = s, body_start + it.end("part")
            else:
                ps, pe = s, e
            fields = {"title": title, "part": str(p)}
            if rng:
                fields["part_end"] = str(rng)
            key = f"cfr-part:{title}:{p}" + (f":{rng}" if rng else "")
            norm = f"{title} C.F.R. parts {p}–{rng}" if rng else f"{title} C.F.R. part {p}"
            out.append(_cite(rule, "cfr_part", ps, pe, (m.start(), span_end), mid, key, norm, fields, pin=pin))
    return out


def build_single(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    if rule.get("nonzero") and int(g.get(rule["nonzero"], "0") or "0") == 0:
        return []
    fields = {k: render(c, t, g) for k, t in rule.get("fields", {}).items()}
    for req in rule.get("required", []):
        if not fields.get(req):
            return []
    key = render(c, rule["key"], g)
    norm = render(c, rule["normalized"], g)
    pin = nospace(g.get(rule["pin_group"], "")) or None if rule.get("pin_group") else None
    return [_cite(rule, rule["kind"], m.start(), m.end(), (m.start(), m.end()), mid, key, norm, fields, pin=pin)]


_SIGN_TAIL = re.compile(js_to_py(r"\s*(?:§§?|[Ss]ec(?:tion)?s?\.?|art\.|arts\.|Art\.|[Rr]ule)?\s*$"))
_SUBJECT_DROP = {"cal", "tex", "md", "n", "y", "code", "ann", "law", "l", "laws"}


def build_state_statute(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    for grp, rx in rule.get("atomic_rx", {}).items():
        a = rx.match(m.string, m.start(grp))
        if not a or a.end() != m.end(grp):
            return []
    raw_code = g["code_text"]
    sec = dash(g["sec"])
    code = squash(_SIGN_TAIL.sub("", raw_code)).rstrip(",")
    st = rule["state"]
    title = g.get("title") or g.get("title2")
    if rule["code"] == "ilcs":
        code = squash(raw_code).rstrip("/")
        normalized = f"{code}/{sec}"
        path = f"{int(title)}/{g['act']}/{sec}"
    else:
        if st == "LA" and re.search(js_to_py(r"Civ\.\s*Code"), code):
            normalized = f"{code} {'arts.' if 'arts.' in raw_code else 'art.'} {sec}"
        elif "§" in raw_code:
            normalized = f"{code} § {sec}"
        else:
            normalized = f"{code} {sec}"
        if title:
            path = f"{title}:{sec}"
        elif g.get("chapter"):
            path = f"{g['chapter']}:{sec}"
        else:
            path = sec
    code_id = rule["code"]
    if code_id == "*":
        words = [w.lower() for w in re.findall(r"[A-Za-z]+", code)]
        code_id = "".join(w for w in words if w not in _SUBJECT_DROP) or "code"
    fields = {"state": st, "code": code, "code_id": code_id, "section": sec}
    for k in ("title", "chapter", "act"):
        if g.get(k):
            fields[k] = g[k]
    if g.get("title2"):
        fields["title"] = g["title2"]
    key = f"state-stat:{st}:{code_id}:{path}"[:200]
    return [_cite(rule, "state_statute", m.start(), m.end(), (m.start(), m.end()), mid, key, normalized, fields)]


def build_state_regulation(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    sec = nospace(dash(g.get("sec") or g.get("sec2") or ""))
    if not sec:
        return []
    parts = [nospace(g[k]) for k in ("title", "part", "agency") if g.get(k)] + [sec]
    st = rule["state"]
    fields = {"state": st, "code_id": rule["code"], "section": sec}
    for k in ("title", "part", "agency"):
        if g.get(k):
            fields[k] = g[k]
    key = f"state-reg:{st}:{rule['code']}:{':'.join(parts)}"[:200]
    return [_cite(rule, "state_regulation", m.start(), m.end(), (m.start(), m.end()), mid, key,
                  dash(squash(m.group(0))), fields)]


def build_id(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    fields = {}
    pin = None
    if g.get("pin"):
        pin = squash(g["pin"])
        fields["pin_kind"] = "page"
    if g.get("sec"):
        fields["section"] = dash(nospace(re.sub(r"^§§?", "", g["sec"])))
        sub = re.search(r"(\([a-zA-Z0-9]{1,5}\))+$", fields["section"])
        if sub:
            pin = sub.group(0)
            fields["section"] = fields["section"][: sub.start()]
    if g.get("para"):
        pin = squash(g["para"])
        fields["pin_kind"] = "paragraph"
    return [_cite(rule, "short", m.start(), m.end(), (m.start(), m.end()), mid, None, squash(m.group(0)), fields,
                  pin=pin, form="short", short="id")]


def build_supra(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    name = g["name"]
    sig = c.signals.match(name)
    name_start = m.start("name") + (sig.end() if sig else 0)
    name = name[sig.end():] if sig else name
    if not name:
        return []
    fields = {"name": squash(name)}
    return [_cite(rule, "short", name_start, m.end(), (name_start, m.end()), mid, None, squash(m.group(0)[name_start - m.start():]),
                  fields, pin=squash(g["pin"]) if g.get("pin") else None, form="short", short="supra")]


def build_section_short(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    return [_cite(rule, "short", m.start(), m.end(), (m.start(), m.end()), mid, None, f"§ {dash(g['section'])}",
                  {"section": dash(g["section"])}, pin=nospace(g.get("subs", "")) or None, form="short", short="section")]


def build_rule_short(c: Compiled, rule: dict, m: re.Match, mid: int) -> list[dict]:
    g = groupdict(m)
    return [_cite(rule, "short", m.start(), m.end(), (m.start(), m.end()), mid, None, f"Rule {g['rule']}",
                  {"rule": g["rule"]}, pin=nospace(g.get("subs", "")) or None, form="short", short="rule")]


BUILDERS = {
    "case": build_case, "case_short": build_case_short, "statute_list": build_statute_list, "single": build_single,
    "state_statute": build_state_statute, "state_regulation": build_state_regulation, "id": build_id,
    "supra": build_supra, "section_short": build_section_short, "rule_short": build_rule_short,
}


# ------------------------------------------------------------------------------------------------ page extraction
def _candidates(c: Compiled, text: str) -> tuple[list[dict], list[tuple[int, int]]]:
    lower = None
    cands: list[dict] = []
    furniture: list[tuple[int, int]] = []
    mid = 0
    for r in c.rules:
        if r["anchors"]:
            if "i" in r.get("flags", ""):
                lower = lower if lower is not None else text.lower()
                if not any(a in lower for a in r["anchors_l"]):
                    continue
            elif not any(a in text for a in r["anchors"]):
                continue
        for m in r["rx"].finditer(text):
            if m.end() == m.start():
                continue
            mid += 1
            if r["builder"] == "furniture":
                furniture.append((m.start(), m.end()))
                continue
            cands.extend(BUILDERS[r["builder"]](c, r, m, mid))
    return cands, furniture


def _resolve_overlaps(cands: list[dict]) -> list[dict]:
    cands.sort(key=lambda x: (x["span"][0], -x["span"][1], -x["_priority"], x["_order"], x["start"]))
    kept: list[dict] = []
    last_match, span_end = None, -1
    for x in cands:
        if x["_match"] == last_match:
            kept.append(x)
            continue
        if x["span"][0] < span_end:
            continue
        kept.append(x)
        last_match, span_end = x["_match"], x["span"][1]
    kept.sort(key=lambda x: (x["start"], x["end"], x["_order"]))
    return kept


def _last_sentence_cut(c: Compiled, seg: str) -> int:
    cut = 0
    for m in re.finditer(js_to_py(r"[.!?][\"”’)]*\s+(?=[\"“(]?[A-Z])|\n[ \t]*\n"), seg):
        if seg[m.start()] == ".":
            before = seg[: m.start()]
            w = re.search(js_to_py(r"([A-Za-z][A-Za-z.'’]*)$"), before)
            if w:
                tok = w.group(1)
                low = tok.lower().rstrip(".")
                if not tok[0].islower() or low in c.abbrev or len(low) < 2 or re.fullmatch(r"[a-z](?:\.[a-z])+", low):
                    continue
            elif not re.search(r"[0-9)\"”’]$", before):
                continue
        cut = m.end()
    return cut


_CONNECTORS = {"of", "the", "and", "&", "for", "de", "del", "la", "le", "du", "des", "van", "von", "ex", "rel.", "et",
               "al.", "d/b/a", "a/k/a", "n/k/a", "f/k/a", "y"}
_CORP_SUFFIX = re.compile(r"^(?:Inc|Co|Corp|Ltd|LLC|L\.L\.C|LLP|L\.L\.P|L\.P|LP|P\.C|N\.A|S\.A|AG|PLC|plc|GmbH)\.?,?$")


def _plaintiff_tail(c: Compiled, before: str) -> int:
    """Index in `before` where the first party's name starts (scanning capitalised words back from " v. ")."""
    toks = list(re.finditer(js_to_py(r"\S+"), before))
    start = len(before)
    i = len(toks) - 1
    pending = None
    while i >= 0:
        t = toks[i].group(0)
        bare = t.rstrip(",")
        if c.signals.match(t + " "):
            break
        if t.endswith(",") and i < len(toks) - 1 and not _CORP_SUFFIX.match(toks[i + 1].group(0)):
            break
        if bare[:1].isupper() or bare[:1].isdigit() or bare.startswith(("'", "’", "&")):
            start = toks[i].start()
            pending = None
        elif bare.lower() in _CONNECTORS:
            pending = toks[i].start()
        else:
            break
        i -= 1
    return start


def case_name(c: Compiled, text: str, start: int, floor: int) -> dict | None:
    lo = max(floor, start - 260, 0)
    seg = text[lo:start]
    cut = _last_sentence_cut(c, seg)
    seg = seg[cut:]
    base = lo + cut
    m = c.name_tail.search(seg)
    if not m:
        return None
    s, e = m.start("name"), m.end("name")
    name = seg[s:e]
    v = re.search(js_to_py(r"\s+vs?\.?\s+"), name)
    if v and not re.match(js_to_py(r"(?:In\s+re|IN\s+RE|Ex\s+parte|EX\s+PARTE|(?:In\s+the\s+)?Matter\s+of|Estate\s+of|Application\s+of|Petition\s+of)\s"), name):
        ps = _plaintiff_tail(c, name[: v.start()])
        if ps >= v.start():
            return None
        s += ps
    else:
        sig = c.signals.match(name)
        if sig and not re.match(js_to_py(r"In\s+re\s"), name):
            s += sig.end()
    name = text[base + s : base + e]
    if not name.strip() or len(name) > 240:
        return None
    return {"text": squash(name), "start": base + s, "end": base + e}


def _postprocess(c: Compiled, text: str, kept: list[dict]) -> list[dict]:
    """Pins (cases, Federal Register, Statutes at Large, public laws), parallel groups, parentheticals and case names.
    A pin never runs into the next full citation; a short form read inside a pin ("Pub. L. No. 111-148, § 1501") is part
    of that pin and is dropped."""
    starts = sorted({x["span"][0] for x in kept if x["form"] == "full"})
    covered: list[tuple[int, int]] = []

    def next_start(after: int) -> int:
        for s in starts:
            if s > after:
                return s
        return len(text)

    for x in kept:
        x["_tail"] = x["end"]
        if x["form"] != "full":
            continue
        rx = c.case_pin if x["kind"] == "case" else c.pins.get(x["kind"])
        if rx is not None and x["pin"] is None:
            limit = min(x["end"] + 80, next_start(x["start"]))
            pm = rx.match(text[x["end"] : limit])
            if pm:
                x["pin"] = squash(pm.group("pin"))
                x["_tail"] = x["end"] + pm.end()
                covered.append((x["end"], x["_tail"]))
    if covered:
        kept = [x for x in kept if x["form"] == "full" or not any(a <= x["start"] < b for a, b in covered)]
    group = 0
    prev_tail = -1
    members: list[int] = []

    def close(members: list[int]) -> None:
        if not members:
            return
        last = kept[members[-1]]
        tail = last["_tail"]
        pm = c.paren.match(text[tail : tail + 140])
        paren = None
        if pm:
            court = squash(pm.group("court")).rstrip(",")
            paren = {"court": court, "year": pm.group("year"), "date": squash(pm.group("date")), "start": tail + pm.start(),
                     "end": tail + pm.end()}
        first = members[0]
        floor = kept[first - 1]["_tail"] if first > 0 else 0
        name = case_name(c, text, kept[first]["start"], floor)
        for i in members:
            kept[i]["paren"] = paren
            kept[i]["name"] = name

    for idx, x in enumerate(kept):
        if x["kind"] != "case" or x["form"] != "full":
            close(members)
            members = []
            prev_tail = -1
            continue
        joined = prev_tail >= 0 and bool(c.join.match(text[prev_tail : x["start"]]))
        if not joined:
            close(members)
            members = []
            group += 1
        x["group"] = group
        members.append(idx)
        prev_tail = x["_tail"]
    close(members)
    return kept


def extract(text: str, compiled: Compiled | None = None, max_chars: int = MAX_CHARS) -> list[dict]:
    """Citations of one text (a page or a whole document), short forms linked within it. See module docstring."""
    c = compiled or default()
    source = text[:max_chars]
    cands, furniture = _candidates(c, source)
    if furniture:
        cands = [x for x in cands if x["kind"] != "docket" or all(x["end"] <= a or x["start"] >= b for a, b in furniture)]
    kept = _postprocess(c, source, _resolve_overlaps(cands))
    for x in kept:
        x["matched"] = source[x["start"] : x["end"]]
    link_short_forms(c, [(0, source, kept)])
    return [public(x) for x in kept]


def extract_pages(pages: list[str], compiled: Compiled | None = None) -> list[list[dict]]:
    """Citations of a document given page by page; short forms may refer to a citation on an earlier page. Offsets are
    per page. An antecedent is {"page": index, "index": index in that page's list}."""
    c = compiled or default()
    per_page = []
    for i, text in enumerate(pages):
        source = text[:MAX_CHARS]
        cands, furniture = _candidates(c, source)
        if furniture:
            cands = [x for x in cands if x["kind"] != "docket" or all(x["end"] <= a or x["start"] >= b for a, b in furniture)]
        kept = _postprocess(c, source, _resolve_overlaps(cands))
        for x in kept:
            x["matched"] = source[x["start"] : x["end"]]
        per_page.append((i, source, kept))
    link_short_forms(c, per_page)
    return [[public(x) for x in kept] for _i, _s, kept in per_page]


PUBLIC_FIELDS = ("kind", "form", "short", "rule", "start", "end", "matched", "span", "key", "normalized", "pin", "fields",
                 "group", "name", "paren", "antecedent", "short_status")


def public(x: dict) -> dict:
    return {k: x[k] for k in PUBLIC_FIELDS}


# ------------------------------------------------------------------------------------------------ short forms
STATUTE_KINDS = ("usc", "cfr", "state_statute", "state_regulation")
NOT_ANTECEDENT = ("mdl", "docket", "short")


PAGED_KINDS = ("case", "federal_register", "statutes_at_large")


def _between_is_string_cite(c: Compiled, text: str, a_end: int, b_start: int) -> bool:
    """The two citations sit in one citation sentence joined by a semicolon (a string cite)."""
    gap = text[a_end:b_start]
    return len(gap) < 400 and ";" in gap and _last_sentence_cut(c, gap) == 0


def link_short_forms(c: Compiled, pages: list[tuple[int, str, list[dict]]]) -> None:
    """Sets antecedent, key, kind and short_status of every short form (in reading order across the pages)."""
    history: list[tuple[int, int, dict]] = []  # (page, index, citation) of every full or resolved short citation
    last_rule_set = None
    for p, text, kept in pages:
        for i, x in enumerate(kept):
            if x["form"] == "full":
                if x["kind"] not in ("mdl", "docket"):
                    history.append((p, i, x))
                if x["kind"] == "federal_rule":
                    last_rule_set = x["fields"].get("set")
                continue
            target = None
            status = "none"
            if x["short"] == "id":
                prev = history[-1] if history else None
                if prev:
                    pp, pi, px = prev
                    status = "resolved"
                    if len(history) > 1 and pp == p:
                        qp, qi, qx = history[-2]
                        if qp == p and qx["key"] != px["key"] and (qx["group"] is None or qx["group"] != px["group"]) \
                                and _between_is_string_cite(c, text, qx["end"], px["start"]):
                            status = "ambiguous"
                    if x["fields"].get("pin_kind") == "page" and px["kind"] not in PAGED_KINDS:
                        status = "ambiguous"  # "Id. at 570" names a page; the preceding authority has none
                    sec = x["fields"].get("section")
                    if status == "resolved" and sec:
                        if px["kind"] == "usc":
                            x["key"] = f"usc:{px['fields']['title']}:{sec}"
                            x["normalized"] = f"{px['fields']['title']} U.S.C. § {sec}"
                        elif px["kind"] == "cfr" and "." in sec:
                            x["key"] = f"cfr:{px['fields']['title']}:{sec}"
                            x["normalized"] = f"{px['fields']['title']} C.F.R. § {sec}"
                        elif px["kind"] == "state_statute":
                            f = px["fields"]
                            x["key"] = f"state-stat:{f['state']}:{f['code_id']}:{sec}"
                            x["normalized"] = f"{f['code']} § {sec}"
                        else:
                            status = "ambiguous"
                        if status == "resolved":
                            x["kind"] = px["kind"] if px["kind"] != "cfr_part" else "cfr"
                            target = prev
                    elif status == "resolved":
                        x["key"] = px["key"]
                        x["kind"] = px["kind"]
                        target = prev
            elif x["short"] == "at":
                vol, rep = x["fields"]["volume"], x["fields"]["reporter"]
                pin_page = lead_number(x["pin"].lstrip("*")) if x["pin"] else -1
                cands = [h for h in history if h[2]["kind"] == "case" and h[2]["form"] == "full"
                         and h[2]["fields"].get("volume") == vol and h[2]["fields"].get("reporter") == rep
                         and h[2]["fields"].get("page", "").isdigit() and int(h[2]["fields"]["page"]) <= pin_page]
                keys = {h[2]["key"] for h in cands}
                if len(keys) > 1:
                    nm = re.search(js_to_py(r"([A-Z][A-Za-z'’.&-]+)(?:\s+[A-Z][A-Za-z'’.&-]+)*,\s*$"), text[max(0, x["start"] - 80) : x["start"]])
                    if nm:
                        word = nm.group(1).rstrip(".").lower()
                        named = [h for h in cands if h[2]["name"] and word in re.findall(r"[a-z0-9'’]+", h[2]["name"]["text"].lower())]
                        if len({h[2]["key"] for h in named}) == 1:
                            cands, keys = named, {named[0][2]["key"]}
                if len(keys) == 1:
                    target = cands[-1]
                    status = "resolved"
                    x["key"] = target[2]["key"]
                    x["kind"] = "case"
                elif keys:
                    status = "ambiguous"
            elif x["short"] == "supra":
                words = re.findall(r"[a-z0-9'’]+", x["fields"]["name"].lower())
                cands = []
                if words:
                    for h in history:
                        if h[2]["kind"] == "case" and h[2]["name"]:
                            nw = re.findall(r"[a-z0-9'’]+", h[2]["name"]["text"].lower())
                            if any(nw[k : k + len(words)] == words for k in range(len(nw))):
                                cands.append(h)
                keys = {h[2]["key"] for h in cands}
                groups = {(h[0], h[2]["group"]) for h in cands}
                if len(groups) == 1:
                    target = cands[0]
                    status = "resolved"
                    x["key"] = target[2]["key"]
                    x["kind"] = "case"
                elif keys:
                    status = "ambiguous"
            elif x["short"] == "section":
                sec = x["fields"]["section"]
                cands = [h for h in history if h[2]["kind"] in ("usc", "state_statute") and h[2]["form"] == "full"
                         and h[2]["fields"].get("section") == sec]
                keys = {h[2]["key"] for h in cands}
                if len(keys) == 1:
                    target = cands[-1]
                    status = "resolved"
                    x["key"] = target[2]["key"]
                    x["kind"] = target[2]["kind"]
                elif keys:
                    status = "ambiguous"
            elif x["short"] == "rule":
                if last_rule_set:
                    status = "resolved"
                    x["key"] = f"rule:{last_rule_set}:{x['fields']['rule']}"
                    x["kind"] = "federal_rule"
                    x["fields"]["set"] = last_rule_set
            x["short_status"] = status
            if target is not None:
                tp, ti, tx = target
                own = x["fields"]
                if x["short"] == "id" and own.get("section"):
                    base = {k: v for k, v in tx["fields"].items() if k not in ("section_end", "dash_joined", "et_seq")}
                    x["fields"] = {**base, **own}
                else:
                    x["fields"] = {**tx["fields"], **own}
                x["antecedent"] = ti if len(pages) == 1 else {"page": tp, "index": ti}
                history.append((p, i, x))
            elif x["short"] == "id" and status == "ambiguous":
                pass
