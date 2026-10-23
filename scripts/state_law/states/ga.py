"""Georgia — BLOCKED. The Official Code of Georgia Annotated is published by LexisNexis for the Code Revision
Commission; the General Assembly's site (www.legis.ga.gov, checked 2026-10-23 in its own app bundle) links the code
only to http://www.lexisnexis.com/hottopics/gacode and an advance.lexis.com container — a commercial host this
project never fetches (AGENTS.md 2026-10-19). No government-hosted current text of the code exists to acquire.
The existing third-party Georgia Commons 2025 edition in the corpus stays labelled third-party/historical.
Unblocking needs an owner decision or a Code Revision Commission/government-hosted publication."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

META = lib.StateMeta(
    state="GA", code_name="Official Code of Georgia Annotated", publisher="Georgia General Assembly / Code Revision Commission",
    publisher_url="https://www.legis.ga.gov/", official_source=True, access="blocked", hosts=(), parser="ga-blocked/1",
    codes=(lib.Code("OCGA", "Official Code of Georgia", "Ga. Code Ann. § {n}",
                    lib.alias_patterns(["O.C.G.A.", "OCGA", "Ga. Code Ann.", "Ga. Code"])),),
    blocked=("Only current text is on LexisNexis (lexisnexis.com/hottopics/gacode, advance.lexis.com), linked from "
             "www.legis.ga.gov; commercial host, never fetched."),
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
