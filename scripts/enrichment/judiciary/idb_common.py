"""Shared pure helpers for the judiciary IDB builders (no I/O)."""
from __future__ import annotations

import statistics

LATEST_FY = 2025  # last complete federal fiscal year (Oct 1, 2024 - Sep 30, 2025)
PARTIAL_FY = 2026  # appeals and criminal files: Oct 1, 2025 - Jun 30, 2026 only
WINDOW = (2021, 2025)  # five complete fiscal years used for mixes and comparisons
MIN_DENOMINATOR = 10  # the AO's rule in Table B-5: no percentage when the base is under 10


def pct(a: int | float | None, b: int | float | None, d: int = 1, min_base: int = MIN_DENOMINATOR):
    if a is None or not b or b < min_base:
        return None
    return round(100.0 * a / b, d)


def median(values: list[int | float]):
    return float(statistics.median(values)) if values else None


def in_window(fy: int) -> bool:
    return WINDOW[0] <= fy <= WINDOW[1]


def fy_label(fy: int) -> str:
    return f"FY{fy} (Oct 1, {fy - 1} - Jun 30, {fy}; partial)" if fy == PARTIAL_FY else f"FY{fy}"


def rank_desc(values: dict[str, float | None]) -> dict[str, int]:
    """Competition ranking, 1 = highest; ties share the lowest number; None values are left out."""
    items = sorted(((k, v) for k, v in values.items() if v is not None), key=lambda kv: (-kv[1], kv[0]))
    out, last, rank = {}, None, 0
    for i, (k, v) in enumerate(items, 1):
        if v != last:
            rank, last = i, v
        out[k] = rank
    return out


def fmt_int(v) -> str:
    return "Not recorded" if v is None else f"{int(v):,}"


def fmt_pct(v) -> str:
    return "Not recorded" if v is None else f"{v:.1f}%"
