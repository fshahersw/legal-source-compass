"""Extraction driver: every registered report's text layer through the specs for its family."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_inventory  # noqa: E402
import cra_specs as S  # noqa: E402
import cra_tables as T  # noqa: E402
import cra_text  # noqa: E402

EXTRACTORS = {"cr_filings": [S.extract_filings], "cr_settlements": [S.extract_settlements], "cr_accounting": [S.extract_accounting]}


def context(rep: dict) -> dict:
    pages = cra_text.pages_of(rep["sha256"])
    return {"id": rep["id"], "pages": pages, "printed": T.printed_pages(pages), "report": rep}


def run(family: str | None = None, only: str = "") -> tuple[S.Result, list[dict]]:
    res = S.Result()
    reps = [r for r in cra_inventory.reports() if (family is None or r["family"] == family) and only in r["id"]]
    for rep in reps:
        ctx = context(rep)
        for fn in EXTRACTORS.get(rep["family"], []):
            fn(res, ctx)
    return res, reps
