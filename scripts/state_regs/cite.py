"""Citation keys for state administrative code rules (mirrors state_regs.cite_key in database/contracts/state-regs-v1.sql).

  cite_key("OH", "Ohio Adm.Code 3745-31-03")      -> "3745-31-3"
  cite_key("NC", "15A NCAC 02D .0101")             -> "15a-2d-101"
  cite_key("IL", "35 Ill. Adm. Code 101.100")      -> "35-101.100"

A key identifies one rule within its state. The resolver (public.state_reg_resolve_v1) matches a key exactly and never
falls back to a nearby rule: no key, or no rule with that key, is "unresolved".
"""
from __future__ import annotations

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "cite_patterns.json"), encoding="utf-8") as _h:
    PATTERNS = json.load(_h)["patterns"]

_BY_STATE: dict[str, list[tuple[re.Pattern, str]]] = {}
for _st, _ord, _pat, _tpl in sorted(PATTERNS, key=lambda p: (p[0], p[1])):
    _BY_STATE.setdefault(_st, []).append((re.compile(_pat, re.I), _tpl))

LEADING_ZEROS = re.compile(r"(^|[^0-9])0+([0-9])")


def normalize_key(s: str) -> str:
    s = s.lower()
    prev = None
    while prev != s:  # "0-0-01" style runs need repeated passes, like the SQL loop
        prev = s
        s = LEADING_ZEROS.sub(r"\1\2", s)
    return s


def cite_key(state: str, citation: str | None) -> str | None:
    """The rule key of a citation in the state's form, or None when no pattern of the state matches."""
    if not citation:
        return None
    text = " ".join(citation.replace("\xa0", " ").split())
    for pat, tpl in _BY_STATE.get(state.upper(), []):
        m = pat.search(text)
        if m:
            key = re.sub(r"\\(\d)", lambda g: m.group(int(g.group(1))) or "", tpl)
            return normalize_key(key)
    return None


def states() -> list[str]:
    return sorted(_BY_STATE)
