"""Tennessee — BLOCKED. The Tennessee Code Annotated is published by LexisNexis for the State; the General Assembly
(capitol.tn.gov / wapp.capitol.tn.gov) links the code only to LexisNexis's public-access site — a commercial host
this project never fetches (AGENTS.md 2026-10-19) — and capitol.tn.gov's robots.txt reads `Disallow: /` (checked
2026-10-23). The corpus' 2021-05-21 third-party RTF edition stays labelled historical (status not_recorded).
Unblocking needs an owner decision or a government-hosted publication of the code text."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

META = lib.StateMeta(
    state="TN", code_name="Tennessee Code Annotated", publisher="Tennessee General Assembly / Tennessee Code Commission",
    publisher_url="https://www.capitol.tn.gov/", official_source=True, access="blocked", hosts=(), parser="tn-blocked/1",
    codes=(lib.Code("TCA", "Tennessee Code Annotated", "Tenn. Code Ann. § {n}",
                    lib.alias_patterns(["Tenn. Code Ann.", "T.C.A.", "Tenn. Code"])),),
    blocked=("Only current text is on LexisNexis (linked from capitol.tn.gov, whose robots.txt disallows '/'); "
             "never fetched."),
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
