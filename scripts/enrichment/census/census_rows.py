"""Pure helpers that turn parsed Census figures into dataset rows: ranks, formatting, request URLs, row payloads."""
from __future__ import annotations

import datetime as dt

import census_load as L
import census_spec as S

NOT_RECORDED = "Not recorded"


def competition_ranks(values: dict[str, float]) -> dict[str, tuple[int, int]]:
    """{key: (rank, n)} with rank 1 = the highest value; ties share a rank and the next rank is skipped (1, 2, 2, 4)."""
    ordered = sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))
    out: dict[str, tuple[int, int]] = {}
    previous: float | None = None
    rank = 0
    for position, (key, value) in enumerate(ordered, 1):
        if previous is None or value != previous:
            rank = position
            previous = value
        out[key] = (rank, len(ordered))
    return out


def fmt(value: float | int | None, kind: str) -> str:
    if value is None:
        return NOT_RECORDED
    if kind == "int":
        return f"{round(value):,}"
    if kind == "dollars":
        return f"${round(value):,}"
    if kind == "dec1":
        return f"{value:.1f}"
    if kind == "pct":
        return f"{value:.1f}%"
    raise ValueError(kind)


def geo_params(level: str, geoid: str) -> dict[str, str]:
    """The ``for``/``in`` parameters that select one geography."""
    if level == "us":
        return {"for": "us:1"}
    if level == "state":
        return {"for": f"state:{geoid}"}
    return {"for": f"county:{geoid[2:]}", "in": f"state:{geoid[:2]}"}


def api_urls(survey: str, year: int, level: str, geoid: str, build_url, cells: list[str] | None = None) -> list[str]:
    """Key-less API requests that return one geography's figures for one vintage (variables split over requests)."""
    cells = cells if cells is not None else S.cells_for_year(year, survey)
    return [
        build_url(f"{year}/acs/{survey}", {"get": "NAME," + ",".join(batch), **geo_params(level, geoid)})
        for batch in S.batches(S.api_variables(cells))
    ]


def period_label(survey: str, year: int) -> str:
    return f"{year - 4}-{year}" if survey == "acs5" else str(year)


def latest_of(series: dict[str, dict[str, list]]) -> dict[str, list]:
    """measure -> [value, moe, year(, "c"|"m")] for the latest year with a value (None values are skipped, never carried forward)."""
    out: dict[str, list] = {}
    for key, by_year in series.items():
        for year in sorted(by_year, reverse=True):
            figure = by_year[year]
            if figure[0] is not None:
                note = [figure[2]] if len(figure) > 2 and isinstance(figure[2], str) else []
                out[key] = [figure[0], figure[1], int(year), *note]
                break
    return out


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def state_usps(geoid: str) -> str:
    """USPS code of a state or county geoid; '' for the nation."""
    if geoid == L.US:
        return ""
    return L.STATE_USPS.get(geoid[:2], "")
