"""Mississippi — BLOCKED. The Mississippi Code of 1972 Annotated is published by LexisNexis; the Secretary of State
(sos.ms.gov) and the Legislature point readers to LexisNexis's public-access site — a commercial host this project
never fetches (AGENTS.md 2026-10-19). legislature.ms.gov failed TLS verification from this network on 2026-10-23
(incomplete certificate chain) and publishes bills and session laws, not the code text. The corpus' 2020-07-08
third-party RTF edition stays labelled historical (status not_recorded). Unblocking needs an owner decision or a
government-hosted publication of the code text."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

META = lib.StateMeta(
    state="MS", code_name="Mississippi Code of 1972", publisher="Mississippi Legislature / Joint Legislative Committee on Compilation",
    publisher_url="https://www.legislature.ms.gov/", official_source=True, access="blocked", hosts=(), parser="ms-blocked/1",
    codes=(lib.Code("MC", "Mississippi Code of 1972", "Miss. Code Ann. § {n}",
                    lib.alias_patterns(["Miss. Code Ann.", "Miss. Code"])),),
    blocked="Only current text is on LexisNexis (pointed to by sos.ms.gov and the Legislature); never fetched.",
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
