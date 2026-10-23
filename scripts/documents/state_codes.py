"""State statute citations in running text ("Cal. Civ. Code § 1714", "735 ILCS 5/13-202", "N.J.S.A. 2A:58C-2").

A citation is taken only when a state's own code abbreviation is written out and a section number starting with a digit
follows; the state is the one the abbreviation names, never inferred from context. Each match keeps its exact span. These
citations are extracted and kept unresolved (documents/1 links only federal law, case law and MDL numbers).
"""

from __future__ import annotations

import re

from citations import js, squash

SEC = r"(?P<sec>[0-9][0-9A-Za-z]*(?:[.:/-][0-9A-Za-z]+)*(?:\([0-9A-Za-z]{1,5}\))*)"
SIGN = r"\s*(?:§§?|[Ss]ec(?:tion)?s?\.?)\s*"
OPT_SIGN = r"\s*(?:§§?|[Ss]ec(?:tion)?s?\.?)?\s*"
ANN = r"(?:\s+Ann\.)?"
WORD = r"(?:[A-Z][A-Za-z'’]*\.?|&)"

# (USPS, pattern before the section). Each pattern must name one state unambiguously.
FORMS: list[tuple[str, str]] = [
    ("AL", r"Ala\.\s+Code" + SIGN),
    ("AK", r"Alaska\s+Stat\." + ANN + SIGN),
    ("AZ", r"(?:Ariz\.\s+Rev\.\s+Stat\." + ANN + r"|A\.R\.S\.)" + SIGN),
    ("AR", r"Ark\.\s+Code" + ANN + SIGN),
    ("CA", r"Cal\.\s+(?:" + WORD + r"\s+){1,5}Code" + ANN + SIGN),
    ("CA", r"Cal\.\s+Code\s+Civ\.\s+Proc\." + SIGN),
    ("CO", r"(?:Colo\.\s+Rev\.\s+Stat\." + ANN + r"|C\.R\.S\.)" + SIGN),
    ("CT", r"Conn\.\s+Gen\.\s+Stat\." + ANN + SIGN),
    ("DE", r"Del\.\s+Code" + ANN + r"\s+tit\.\s*\d{1,2},?" + SIGN),
    ("DC", r"D\.C\.\s+Code" + ANN + SIGN),
    ("FL", r"Fla\.\s+Stat\." + ANN + SIGN),
    ("GA", r"(?:O\.C\.G\.A\.|Ga\.\s+Code" + ANN + r")" + SIGN),
    ("HI", r"Haw\.\s+Rev\.\s+Stat\." + ANN + SIGN),
    ("ID", r"Idaho\s+Code" + ANN + SIGN),
    ("IL", r"\d{1,4}\s+ILCS\s+\d{1,4}[A-Za-z]?/"),
    ("IN", r"Ind\.\s+Code" + ANN + SIGN),
    ("IA", r"Iowa\s+Code" + ANN + SIGN),
    ("KS", r"(?:Kan\.\s+Stat\." + ANN + r"|K\.S\.A\.)(?:\s+\d{4}\s+Supp\.)?" + OPT_SIGN),
    ("KY", r"(?:Ky\.\s+Rev\.\s+Stat\." + ANN + r"|KRS)" + OPT_SIGN),
    ("LA", r"(?:La\.\s+R\.S\.|La\.\s+Rev\.\s+Stat\." + ANN + r")" + OPT_SIGN),
    ("LA", r"La\.\s+Civ\.\s+Code" + ANN + r"\s+(?:art\.|arts\.|Art\.)\s*"),
    ("ME", r"(?:Me\.\s+Rev\.\s+Stat\." + ANN + r"\s+tit\.\s*\d{1,2}(?:-[A-Z])?,?|\d{1,2}(?:-[A-Z])?\s+M\.R\.S\.(?:A\.)?)" + SIGN),
    ("MD", r"Md\.\s+Code" + ANN + r",\s*(?:" + WORD + r"\s+){1,6}" + r"(?=§)" + SIGN),
    ("MA", r"(?:Mass\.\s+Gen\.\s+Laws(?:\s+Ann\.)?|M\.G\.L\.(?:A\.)?|G\.\s?L\.)\s+(?:ch\.|c\.)\s*\d{1,3}[A-Z]{0,2},?" + SIGN),
    ("MI", r"Mich\.\s+Comp\.\s+Laws" + ANN + SIGN),
    ("MN", r"Minn\.\s+Stat\." + ANN + SIGN),
    ("MS", r"Miss\.\s+Code" + ANN + SIGN),
    ("MO", r"Mo\.\s+Rev\.\s+Stat\." + SIGN),
    ("MT", r"Mont\.\s+Code" + ANN + SIGN),
    ("NE", r"Neb\.\s+Rev\.\s+Stat\." + ANN + SIGN),
    ("NV", r"(?:Nev\.\s+Rev\.\s+Stat\." + ANN + r"|NRS)" + OPT_SIGN),
    ("NH", r"N\.H\.\s+Rev\.\s+Stat\." + ANN + SIGN),
    ("NJ", r"(?:N\.J\.S\.A\.|N\.J\.\s+Stat\." + ANN + r")" + OPT_SIGN),
    ("NM", r"N\.M\.\s+Stat\." + ANN + SIGN),
    ("NY", r"N\.Y\.\s+(?:" + WORD + r"\s+){0,4}(?:Law|L\.)" + r"(?:\s+Ann\.)?" + SIGN),
    ("NY", r"(?:N\.Y\.\s*)?C\.P\.L\.R\.\s*(?:§§?\s*|[Rr]ule\s+)?"),
    ("NC", r"N\.C\.\s+Gen\.\s+Stat\." + ANN + SIGN),
    ("ND", r"N\.D\.\s+Cent\.\s+Code" + SIGN),
    ("OH", r"Ohio\s+Rev\.\s+Code" + ANN + SIGN),
    ("OK", r"Okla\.\s+Stat\." + ANN + r"\s+tit\.\s*\d{1,2},?" + SIGN),
    ("OR", r"(?:Or\.\s+Rev\.\s+Stat\." + ANN + r"|ORS)" + OPT_SIGN),
    ("PA", r"\d{1,3}\s+(?:Pa\.\s*C\.\s*S\.(?:\s*A\.)?|Pa\.\s+Stat\." + ANN + r"|P\.S\.)" + SIGN),
    ("RI", r"R\.I\.\s+Gen\.\s+Laws" + SIGN),
    ("SC", r"S\.C\.\s+Code" + ANN + SIGN),
    ("SD", r"S\.D\.\s+Codified\s+Laws" + SIGN),
    ("TN", r"Tenn\.\s+Code" + ANN + SIGN),
    ("TX", r"Tex\.\s+(?:" + WORD + r"\s+){1,6}Code" + ANN + SIGN),
    ("UT", r"Utah\s+Code" + ANN + SIGN),
    ("VT", r"Vt\.\s+Stat\." + ANN + r"\s+tit\.\s*\d{1,2},?" + SIGN),
    ("VA", r"Va\.\s+Code" + ANN + SIGN),
    ("WA", r"(?:Wash\.\s+Rev\.\s+Code" + ANN + r"|RCW)" + OPT_SIGN),
    ("WV", r"W\.\s?Va\.\s+Code" + ANN + SIGN),
    ("WI", r"Wis\.\s+Stat\." + ANN + SIGN),
    ("WY", r"Wyo\.\s+Stat\." + ANN + SIGN),
]

_FORMS = [(usps, re.compile(js(r"(?<![A-Za-z0-9_.])(?P<code>" + form + r")" + SEC + r"(?![A-Za-z0-9_])(?!\s+Supp\.)"))) for usps, form in FORMS]
_SIGN_TAIL = re.compile(js(r"\s*(?:§§?|[Ss]ec(?:tion)?s?\.?|art\.|arts\.|Art\.|[Rr]ule)?\s*$"))


def state_code_citations(text: str) -> list[dict]:
    """State statute citations in reading order; overlapping matches keep the earliest, then the longest."""
    found = []
    for usps, rx in _FORMS:
        for m in rx.finditer(text):
            sec = m.group("sec")
            code = squash(_SIGN_TAIL.sub("", m.group("code"))).rstrip(",")
            if usps == "IL":
                code = squash(m.group("code")).rstrip("/")
                normalized = f"{code}/{sec}"
            elif usps == "LA" and re.search(r"Civ\.\s*Code", code):
                normalized = f"{code} art. {sec}"
            else:
                normalized = f"{code} § {sec}"
            found.append(
                {
                    "kind": "state_code",
                    "start": m.start(),
                    "end": m.end(),
                    "state": usps,
                    "code": code,
                    "section": sec,
                    "normalized": normalized,
                    "key": f"state:{usps}:{code}:{sec}"[:200],
                }
            )
    found.sort(key=lambda c: (c["start"], -c["end"]))
    out, last_end = [], -1
    for c in found:
        if c["start"] < last_end:
            continue
        out.append(c)
        last_end = c["end"]
    return out
