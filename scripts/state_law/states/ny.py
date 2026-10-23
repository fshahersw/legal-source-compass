"""New York — BLOCKED (pending an API key). The official consolidated and unconsolidated laws are published by the
Legislature: the NY State Senate's Open Legislation service (legislation.nysenate.gov, `/api/3/laws/{lawId}`, JSON
with the full law tree and text) and the Legislative Retrieval System (public.leginfo.state.ny.us).

State on 2026-10-23: www.nysenate.gov answers a browser check (HTTP 403 challenge) — never bypassed; the Open
Legislation API answers 401 without a key and no key is provisioned (registration is free, on the Senate's site);
public.leginfo.state.ny.us's robots.txt reads `Disallow: /` (its index page had been requested once before robots.txt
was read — disclosed in the handoff; nothing from it is used). The corpus' retained New York pages were captured
through a third-party fetch proxy, not directly from the publisher, so they are not re-parsed here.

Unblocking: provision an Open Legislation API key (environment, never committed) and add the `/api/3/laws` parser;
the citation patterns below already resolve "N.Y. <Law> Law § n" / "CPLR n" forms per code."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

META = lib.StateMeta(
    state="NY", code_name="Consolidated Laws of New York", publisher="New York State Legislature (NY State Senate Open Legislation)",
    publisher_url="https://legislation.nysenate.gov/", official_source=True, access="blocked", hosts=(), parser="ny-blocked/1",
    codes=(lib.Code("CPLR", "Civil Practice Law and Rules", "N.Y. C.P.L.R. {n}",
                    lib.alias_patterns(["N.Y. C.P.L.R.", "CPLR", "C.P.L.R."])),),
    blocked=("nysenate.gov answers a browser check (403); the Open Legislation API needs a key (401, none provisioned); "
             "LRS robots.txt disallows '/'. Never bypassed."),
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
