"""Shared row and build-file shape for full state codes (state_statutes stream).

A section row follows src/lib/law/stateCodeContract.ts ("Published dataset"): the official citation and heading
in `title`, the title-filter value on `filters.title`, the chapter label on `item.cells.chapter`, citation /
history / edition / currency in `detail.facts`, the published body in `detail.sections[0].text` under a heading
that starts with "Section text". Rows are built with corpus_writer.record() and then pruned of empty fields so
they stay lean: the body is stored once (detail.sections), `text` carries only id + title for search.
"""
import datetime
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402

SECTION_TEXT_HEADING = "Section text"


def prune(value):
    """Drop empty strings, lists and dicts recursively (keeps 0 and False)."""
    if isinstance(value, dict):
        out = {k: prune(v) for k, v in value.items()}
        return {k: v for k, v in out.items() if v not in ("", None, [], {})}
    if isinstance(value, list):
        out = [prune(v) for v in value]
        return [v for v in out if v not in ("", None, [], {})]
    return value


def section_row(dataset, state, rid, *, citation, heading, title_value, chapter_label, body, source_url,
                edition, currency, history=None, status=None, extra_facts=()):
    """One section row. `body` is the printed text (paragraphs joined by newlines) or None for a status stub."""
    title = f"{citation} {heading}".strip() if heading else citation
    facts = [["Citation", citation]]
    if status:
        facts.append(["Status as printed", status])
    facts.extend([list(f) for f in extra_facts])
    if history:
        facts.append(["Source note", history])
    facts.append(["Edition", edition])
    facts.append(["Currency", currency])
    cells = {"chapter": chapter_label}
    if status:
        cells["status"] = status
    row = cw.record(dataset, rid, title, source_url=source_url, cells=cells, facts=facts, text="",
                    filters={"title": [title_value]}, state=state)
    row["detail"]["sections"] = [{"heading": SECTION_TEXT_HEADING, "text": body}] if body else []
    # Lean shape: no empty subtitle/badges/links, no duplicate id or links inside detail.
    row["detail"].pop("id", None)
    row["detail"].pop("subtitle", None)
    return prune(row)


def listing_block(rows, title_labels, qualification):
    """Listing with a `title` select filter whose options carry exact section counts, in code order."""
    counts = {}
    for row in rows:
        value = row["filters"]["title"][0]
        counts[value] = counts.get(value, 0) + 1
    block = cw.listing([("chapter", "Chapter"), ("status", "Status")], filters=[("title", "Title", {v: title_labels[v] for v in counts})])
    for option in block["filters"][1]["options"]:
        option["count"] = counts[option["value"]]
    block["qualification"] = qualification
    return block


def digest(rows):
    return hashlib.sha256("\n".join(json.dumps(r, sort_keys=True) for r in rows).encode()).hexdigest()


def write_build(path, *, dataset, label, rows, listing, summary, inputs):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate ids")
    build = {
        "dataset": dataset,
        "label": label,
        "listing_block": listing,
        "summary": summary,
        "rows": rows,
        "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "inputs": inputs,
    }
    if json.loads(json.dumps(build["rows"])) != build["rows"]:
        raise ValueError("rows not JSON round-trip stable")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(build, ensure_ascii=False, separators=(",", ":")))
    return build


def row_bytes(row):
    """Compact JSON size of the stored columns (an estimate before pg_column_size is measured)."""
    return len(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode())
