"""Pure helpers for the courts_db builder: labels, dates and the parent / appeal graph. No I/O."""
from __future__ import annotations

import re

LEVELS = {
    "colr": "Court of last resort",
    "iac": "Intermediate appellate court",
    "gjc": "General jurisdiction trial court",
    "ljc": "Limited jurisdiction trial court",
    "trial": "Trial court",
    "gjc & iac": "General jurisdiction and intermediate appellate court",
}
TYPES = {
    "trial": "Trial",
    "appellate": "Appellate",
    "special": "Special",
    "bankruptcy": "Bankruptcy",
    "ag": "Attorney General opinions",
    "international": "International",
    "trial & iac": "Trial and intermediate appellate",
}
SYSTEMS = {
    "state": "State",
    "federal": "Federal",
    "tribal": "Tribal",
    "international": "International",
    "special": "Special",
    "colonial": "Colonial",
    "extraterritorial": "Extraterritorial",
}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NOT_RECORDED = "Not recorded"


def label(table: dict, value) -> str:
    """A recorded code as its label; an unknown code is shown as recorded, an empty one as Not recorded."""
    if value is None or str(value).strip() == "":
        return NOT_RECORDED
    return table.get(str(value).strip(), str(value).strip())


def clean_date(value) -> str | None:
    return value if isinstance(value, str) and DATE.match(value) else None


def periods(dates) -> list[dict]:
    """Courts-DB date blocks as {start, end, reorganizations}; malformed dates are dropped, blocks with nothing are skipped."""
    out = []
    for block in dates if isinstance(dates, list) else []:
        if not isinstance(block, dict):
            continue
        start, end = clean_date(block.get("start")), clean_date(block.get("end"))
        reorganizations = sorted({d for d in (clean_date(x) for x in block.get("reorganization") or []) if d})
        if start or end or reorganizations:
            out.append({"start": start, "end": end, "reorganizations": reorganizations})
    return out


def strings(value, limit: int | None = None) -> list[str]:
    items = [s.strip() for s in (value if isinstance(value, list) else []) if isinstance(s, str) and s.strip()]
    seen, out = set(), []
    for s in items:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out[:limit] if limit else out


def parent_chain(court_id: str, by_id: dict) -> list[str]:
    """Ancestors from the immediate parent upward; stops at a missing id or a cycle."""
    out, seen = [], {court_id}
    current = by_id.get(court_id, {}).get("parent")
    while isinstance(current, str) and current in by_id and current not in seen:
        out.append(current)
        seen.add(current)
        current = by_id[current].get("parent")
    return out


def children_index(by_id: dict) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for cid, court in by_id.items():
        parent = court.get("parent")
        if isinstance(parent, str) and parent in by_id and parent != cid:
            index.setdefault(parent, []).append(cid)
    return {k: sorted(v) for k, v in index.items()}


def circuit_id(court: dict, by_id: dict) -> str | None:
    """The court of appeals named by a recorded federal_circuit number (ca1-ca11), only when that id exists."""
    value = court.get("federal_circuit")
    if isinstance(value, int) and 1 <= value <= 11 and f"ca{value}" in by_id:
        return f"ca{value}"
    return None


def appeal_index(by_id: dict) -> dict[str, list[str]]:
    """Courts recorded as appealing to each court: explicit appeal_to, plus a court's own lower_courts list."""
    index: dict[str, set[str]] = {}
    for cid, court in by_id.items():
        target = court.get("appeal_to")
        if isinstance(target, str) and target in by_id and target != cid:
            index.setdefault(target, set()).add(cid)
        for lower in strings(court.get("lower_courts")):
            if lower in by_id and lower != cid:
                index.setdefault(cid, set()).add(lower)
    return {k: sorted(v) for k, v in index.items()}
