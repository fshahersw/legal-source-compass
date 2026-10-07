"""Shared DC Council Code helpers (official HTML at code.dccouncil.gov)."""
import importlib.util
import re
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "dc_parse_bulk",
    Path(__file__).resolve().parents[2] / "dc-parse-bulk.py",
)
dc = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader
_SPEC.loader.exec_module(dc)

HOST = dc.HOST
CODE_PREFIX = "/us/dc/council/code/"
parse_article = dc.parse_article


def section_citation_path(native_id: str) -> str:
    """e.g. /us/dc/council/code/sections/28:2-725 -> 28:2-725"""
    m = re.fullmatch(r"/us/dc/council/code/sections/(.+)", native_id)
    if not m:
        raise ValueError(f"not a section native_id: {native_id}")
    return m.group(1)


def chapter_key_from_parent(parent_id: str | None) -> str:
    if not parent_id:
        return "unknown"
    return parent_id.removeprefix(CODE_PREFIX).replace("/", "-") or "root"
