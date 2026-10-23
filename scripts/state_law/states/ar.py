"""Arkansas — BLOCKED. The Arkansas Code of 1987 Annotated is published by LexisNexis; the General Assembly's site
(arkleg.state.ar.us, checked 2026-10-23) links the code only to https://advance.lexis.com/ — a commercial host this
project never fetches (AGENTS.md 2026-10-19). The legislature's own pages list code sections amended by acts
(/Acts/CodeSectionsAmended), not the code text. The corpus' 2020-11-06 third-party RTF edition stays labelled
historical. Unblocking needs an owner decision or a government-hosted publication of the code."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

META = lib.StateMeta(
    state="AR", code_name="Arkansas Code", publisher="Arkansas General Assembly / Arkansas Code Revision Commission",
    publisher_url="https://arkleg.state.ar.us/", official_source=True, access="blocked", hosts=(), parser="ar-blocked/1",
    codes=(lib.Code("ACA", "Arkansas Code", "Ark. Code Ann. § {n}",
                    lib.alias_patterns(["Ark. Code Ann.", "A.C.A.", "Ark. Code"])),),
    blocked="Only current text is on LexisNexis (advance.lexis.com), linked from arkleg.state.ar.us; never fetched.",
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
