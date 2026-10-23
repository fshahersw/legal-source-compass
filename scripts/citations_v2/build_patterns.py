"""Builds the canonical citation pattern table (citations-v2) shared by the Python and TypeScript engines.

    python3 -I -B scripts/citations_v2/build_patterns.py            # writes the two generated files
    python3 -I -B scripts/citations_v2/build_patterns.py --check    # exit 1 when a generated file is out of date

Inputs: scripts/citations_v2/pattern_source.py (hand-written rules) and scripts/vendor/reporters-db/reporters.json (Free Law
Project reporter editions and variations, BSD-2). Outputs: src/lib/citations/patterns.json and the identical table as a
TypeScript module, src/lib/citations/patterns.data.ts (Deno and Vite import it without JSON import attributes).

Every pattern is checked against the shared dialect (see pattern_source.py) and compiled by the Python engine here; the
TypeScript test suite compiles the same strings with RegExp.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import pattern_source as src  # noqa: E402

VENDOR = ROOT / "scripts" / "vendor" / "reporters-db"
OUT_JSON = ROOT / "src" / "lib" / "citations" / "patterns.json"
OUT_TS = ROOT / "src" / "lib" / "citations" / "patterns.data.ts"

# Bare words (letters only, no period) that are real modern reporter spellings; every other bare word of reporters-db
# ("Smith", "Black", "Day", "NE", "SW" ...) reads too often as ordinary text between two numbers.
BARE_ALLOWED = {"WL", "US", "SCt", "Cranch"}
# Spellings that are statutory or register abbreviations, never reporters.
NOT_REPORTERS = {"usc", "cfr", "stat", "fedreg", "fr", "publ", "pl", "treasreg", "usca", "uscs"}
# Public-domain (neutral) forms read as "YYYY <form> NNN"; forms without a recorded example or that are not court
# citations are left out.
NEUTRAL_EXCLUDED = {"AWCC", "CIT", "MSPB", "NLRB No.", "T.C. Memo.", "T.C. No.", "T.C. Summary Opinion", "OK AG",
                    "OK JUD ETH", "TN WC", "TN WC App.", "AZ", "FL", "LA", "MS", "NV", "PA", "Tex. Bus.", "Tex. Bus. Ct."}

FORBIDDEN = [
    (re.compile(r"\\b"), "\\b"),
    (re.compile(r"\(\?>"), "atomic group"),
    (re.compile(r"[*+?}]\+"), "possessive quantifier"),
    (re.compile(r"\(\?[aiLmsux]+\)"), "inline flag"),
    (re.compile(r"\(\?P"), "Python-only group syntax"),
    (re.compile(r"\\k<"), "named backreference"),
    (re.compile(r"\{,\d"), "{,n} quantifier"),
]


def compact(s: str) -> str:
    """Spacing-insensitive form of a reporter spelling ("F. Supp. 2d" and "F.Supp.2d" -> "F.Supp.2d")."""
    return re.sub(r"\s+", "", s).replace("’", "'")


def atoms(spelling: str) -> list[str]:
    """Regex atoms of one spelling: literal characters, optional whitespace between period-ended tokens, either apostrophe."""
    tokens: list[str] = []
    for chunk in spelling.split(" "):
        parts = re.findall(r"[^.]+\.|[^.]+$", chunk) or [chunk]
        tokens.extend(parts)
    out: list[str] = []
    for i, tok in enumerate(tokens):
        if i:
            out.append(r"\s?")
        for ch in tok:
            if ch in "'’":
                out.append("['’]")
            elif ch in r".*+?^${}()|[]\/-":
                out.append("\\" + ch)
            else:
                out.append(ch)
    return out


def trie_regex(spellings: list[str]) -> str:
    """One prefix-trie alternation of every spelling: matching costs the spelling's length, longest spelling first."""
    root: dict = {}
    END = ""
    for s in spellings:
        node = root
        for a in atoms(s):
            node = node.setdefault(a, {})
        node[END] = {}

    def emit(node: dict) -> str:
        kids = sorted((k for k in node if k != END), key=lambda k: (k == r"\s?", k))
        alts = [k + emit(node[k]) for k in kids]
        if not alts:
            return ""
        body = alts[0] if len(alts) == 1 else "(?:" + "|".join(alts) + ")"
        if END in node:
            if len(alts) == 1 and not body.startswith("(?:"):
                body = "(?:" + body + ")"
            return body + "?"
        return body

    return emit(root)


def load_reporters():
    data = json.loads((VENDOR / "reporters.json").read_text(encoding="utf-8"))
    canon: dict[str, set[str]] = {}
    case_spellings: set[str] = set()
    neutral_spellings: set[str] = set()
    names: dict[str, str] = {}
    for _root, entries in data.items():
        for d in entries:
            neutral = d["cite_type"] == "neutral"
            for ed in d["editions"]:
                names.setdefault(ed, d.get("name", ""))
            pairs = [(ed, ed) for ed in d["editions"]] + list(d["variations"].items())
            for spelling, edition in pairs:
                canon.setdefault(compact(spelling), set()).add(edition)
                key = re.sub(r"[^a-z]", "", spelling.lower())
                if key in NOT_REPORTERS or re.match(r"^\d", spelling):
                    continue
                if neutral:
                    if spelling not in NEUTRAL_EXCLUDED and edition not in NEUTRAL_EXCLUDED:
                        neutral_spellings.add(spelling)
                    if not re.fullmatch(r"[A-Za-z]+", spelling):
                        case_spellings.add(spelling)
                    continue
                if re.fullmatch(r"[A-Za-z]+", spelling) and spelling not in BARE_ALLOWED:
                    continue
                case_spellings.add(spelling)
    reporters = {k: sorted(v) for k, v in sorted(canon.items())}
    return reporters, sorted(case_spellings), sorted(neutral_spellings), names


def state_names() -> tuple[str, dict[str, str]]:
    usps: dict[str, str] = {}
    spellings = []
    for code, names in src.STATES.items():
        for n in names:
            usps[re.sub(r"[^a-z]", "", n.lower())] = code
            spellings.append(n)
    alt = "|".join(sorted({"".join(atoms(s)) for s in spellings}, key=lambda s: (-len(s), s)))
    return "(?:" + alt + ")", usps


def expand(pattern: str, frags: dict[str, str], depth: int = 0) -> str:
    if depth > 8:
        raise ValueError("fragment recursion")
    out = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: frags[m.group(1)], pattern)
    return expand(out, frags, depth + 1) if "{{" in out else out


def check_dialect(name: str, pattern: str) -> None:
    for rx, what in FORBIDDEN:
        if rx.search(pattern):
            raise ValueError(f"{name}: {what} is not part of the shared dialect")
    # an unescaped "." outside a character class is a wildcard (its line-terminator set differs between the runtimes)
    i, in_class = 0, False
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "[" and not in_class:
            in_class = True
        elif ch == "]" and in_class:
            in_class = False
        elif ch == "." and not in_class:
            raise ValueError(f"{name}: unescaped '.' wildcard at {i}")
        i += 1


def literal_anchors(form: str) -> list[str]:
    """Every literal capitalised token of a form ("Ariz.", "A.", "HRS"): a match always contains one of them, so a text
    holding none can skip the rule (an optimisation only; any extra token just means the rule runs)."""
    if re.search(r"\\\.\?|\\s\?", form):
        return []  # optional periods or spaces ("N\.?Y\.?C\.?R\.?R\.?"): no literal token is certain; the rule always runs
    found = set()
    for m in re.finditer(r"(?<![\\\[])([A-Z][A-Za-z]+)(\\\.)?|(?<![\\\[])([A-Z])\\\.", form):
        tok = m.group(1) or m.group(3)
        found.add(tok + ("." if (m.group(2) or m.group(3)) else ""))
    return sorted(found)


def state_rules(frags: dict[str, str]) -> list[dict]:
    rules = []
    dotted = set(src.DOTTED_STATES)
    for i, (usps, code_id, form) in enumerate(src.STATE_STATUTES):
        sec = "STATE_SEC_DOTTED" if usps in dotted else "STATE_SEC"
        tail = "{{STATE_TAIL}}" + (r"(?!,\s?[0-9])" if usps == "NE" else "")
        anchors = literal_anchors(form)
        rules.append({
            "id": f"state_statute_{usps.lower()}_{i}", "kind": "state_statute", "builder": "state_statute", "priority": 35,
            "state": usps, "code": code_id,
            "pattern": r"(?<![A-Za-z0-9_.])(?<code_text>" + form + r")(?<sec>{{" + sec + "}})" + tail,
            "atomic": {"sec": "{{" + sec + "}}"},
            "anchors": anchors,
        })
    for i, (usps, code_id, form) in enumerate(src.STATE_REGULATIONS):
        anchors = literal_anchors(form)
        rules.append({
            "id": f"state_regulation_{usps.lower()}_{i}", "kind": "state_regulation", "builder": "state_regulation",
            "priority": 36, "state": usps, "code": code_id,
            "pattern": r"(?<![A-Za-z0-9_.])(?:" + form + r")(?![A-Za-z0-9_])(?![-–]\d)",
            "anchors": anchors,
        })
    return rules


def build() -> dict:
    reporters, case_spellings, neutral_spellings, names = load_reporters()
    state_alt, usps = state_names()
    frags = dict(src.FRAGMENTS)
    frags["REPORTER"] = trie_regex(case_spellings)
    frags["NEUTRAL"] = trie_regex(neutral_spellings)
    frags["STATE_NAME"] = state_alt
    rules = []
    for r in src.RULES + state_rules(frags):
        r = dict(r)
        r["pattern"] = expand(r["pattern"], frags)
        check_dialect(r["id"], r["pattern"])
        for opt in ("item",):
            if opt in r:
                r[opt] = expand(r[opt], frags)
                check_dialect(r["id"] + "." + opt, r[opt])
        if "atomic" in r:
            r["atomic"] = {g: expand(p, frags) for g, p in r["atomic"].items()}
        r.setdefault("flags", "")
        r.setdefault("anchors", [])
        rules.append(r)
    case = {k: (expand(v, frags) if isinstance(v, str) else v) for k, v in src.CASE.items()}
    for k in ("signals", "name_tail", "paren", "pin", "join"):
        check_dialect("case." + k, case[k])
    pins = {k: expand(v, frags) for k, v in src.PINS.items()}
    vendor_pin = json.loads((VENDOR / "PINNED.json").read_text(encoding="utf-8"))
    table = {
        "version": src.VERSION,
        "source": {
            "reporters_db": vendor_pin["version"],
            "reporters_json_sha256": hashlib.sha256((VENDOR / "reporters.json").read_bytes()).hexdigest(),
            "pattern_source_sha256": hashlib.sha256((HERE / "pattern_source.py").read_bytes()).hexdigest(),
        },
        "rules": rules,
        "case": case,
        "pins": pins,
        "reporters": reporters,
        "reporter_names": {k: names[k] for k in sorted(names)},
        "states": usps,
        "state_abbr": {code: names[0] for code, names in src.STATES.items()},
        "rule_sets": src.RULE_SETS,
        "rule_set_names": src.RULE_SET_NAMES,
        "dotted_states": src.DOTTED_STATES,
    }
    # every pattern must compile in the Python engine (the TypeScript suite compiles them with RegExp)
    import engine  # noqa: E402  (local import: engine reads the table this function writes)

    engine.compile_table(table)
    return table


def render(table: dict) -> tuple[str, str]:
    js = json.dumps(table, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
    ts = (
        "// GENERATED by scripts/citations_v2/build_patterns.py from scripts/citations_v2/pattern_source.py and the vendored\n"
        "// reporters-db data. Do not edit; edit the source and regenerate. Identical to patterns.json (checked by tests).\n"
        "import type { PatternTable } from \"./types.ts\";\n\n"
        "export const PATTERNS: PatternTable = " + json.dumps(table, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    return js, ts


def main(argv: list[str]) -> int:
    table = build()
    js, ts = render(table)
    if "--check" in argv:
        stale = [p.name for p, body in ((OUT_JSON, js), (OUT_TS, ts)) if not p.exists() or p.read_text(encoding="utf-8") != body]
        if stale:
            print("out of date: " + ", ".join(stale), file=sys.stderr)
            return 1
        print("patterns up to date")
        return 0
    OUT_JSON.write_text(js, encoding="utf-8")
    OUT_TS.write_text(ts, encoding="utf-8")
    print(json.dumps({"rules": len(table["rules"]), "reporter_spellings": len(table["reporters"]),
                      "json_bytes": len(js.encode("utf-8")), "version": table["version"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
