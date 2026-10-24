"""Group normalised table-periods into series and shape them into the uscourts_tables_* record payloads.

Pure functions only (no file or network access) so they are unit-tested; build_uscourts_tables.py reads the parsed files,
calls these and writes the build files. Rules that keep the series honest:

  * a series is keyed by (table key, column key); a period with no such column gets null, never zero and never a carried
    value; a published dash is recorded as a dash position (value null);
  * columns that only repeat the prior year's figure (the previous year printed beside the current year) are not series;
  * if two publications print the same table for the same period end, the first by priority (JB, STFJ, FJCS, BF) is used
    and the other is listed in the source note (never averaged or merged);
  * a change of column set, footnote wording or title between consecutive periods is recorded as a break at that period;
  * floats are rounded to 6 decimals (the cells carry up to 15 digits; the published display uses 0 to 2);
  * a percent-formatted workbook cell (a fraction, displayed times 100) is stored as the printed percentage.
"""
import re
from collections import OrderedDict

import entities as E

PUB_PRIORITY = {"JB": 0, "STFJ": 1, "FJCS": 2, "BF": 3}
ROUND = 6


def clean_num(v):
    if v is None:
        return None
    if isinstance(v, float):
        if v.is_integer() and abs(v) < 1e15:
            return int(v)
        return round(v, ROUND)
    return v


def printed_value(v, fmt, from_book=True, flag=None):
    """The figure as printed. A workbook cell formatted as a percentage holds a fraction (0.901298 is printed 90.1%), so its value
    is the fraction times 100; every other cell, a text cell and any figure read from a PDF (printed as 90.1) is taken as it is."""
    if from_book and flag is None and fmt and "%" in fmt and isinstance(v, (int, float)) and not isinstance(v, bool):
        return v * 100
    return v


def decimals_of(fmt):
    if not fmt or fmt == "General" or fmt == "@":
        return None
    first = fmt.split(";")[0]
    m = re.search(r"\.(0+)", first)
    return len(m.group(1)) if m else 0


def unit_of(path, fmt):
    """Unit of a column from its heading words (whole words: "misdemeanor" is not "mean") and its number format."""
    words = " ".join(path).lower()
    if "percent" in words or "%" in words or (fmt and "%" in fmt):
        return "percent"
    if re.search(r"\bmonths?\b", words):
        return "months"
    if re.search(r"\bdays?\b", words):
        return "days"
    if re.search(r"\bper (?:authorized )?judgeships?\b|\bper panel\b|\bweighted\b|\bratios?\b|\baverages?\b|\bmeans?\b|\bper case\b|\bper judge\b", words):
        return "ratio"
    d = decimals_of(fmt)
    return "count" if d in (0, None) else "number"


def norm_sig(text):
    return re.sub(r"[^a-z]+", " ", text.lower()).strip()


def pick_docs(docs):
    """One document per period end (first publication by priority wins); returns (chosen sorted by end, dropped)."""
    by_end = {}
    for d in docs:
        by_end.setdefault(d["norm"]["period_end"], []).append(d)
    chosen, dropped = [], []
    for end in sorted(by_end):
        group = sorted(by_end[end], key=lambda d: PUB_PRIORITY.get(d["norm"]["pub"], 9))
        chosen.append(group[0])
        dropped.extend({"end": end, "pub": g["norm"]["pub"], "kept": group[0]["norm"]["pub"]} for g in group[1:])
    return chosen, dropped


def source_entry(doc):
    n, s = doc["norm"], doc["source"]
    return {"pub": n["pub"], "end": n["period_end"], "page": s.get("page"), "url": s["url"], "sha256": s.get("sha256"), "fmt": s.get("format"), "sheet": n.get("sheet")}


def value_columns(norm):
    return [(i, c) for i, c in enumerate(norm["columns"]) if not c.get("prior")]


def collect_columns(docs):
    """Ordered column catalogue over all periods: key -> {label, path, unit, dec}; the label comes from the latest period."""
    cols = OrderedDict()
    for d in docs:
        for _, c in value_columns(d["norm"]):
            info = cols.setdefault(c["key"], {"k": c["key"], "label": c["label"], "path": c["path"], "unit": None, "dec": None, "first": d["norm"]["period_end"]})
            info["label"], info["path"] = c["label"], c["path"]
            info["le"] = d["norm"]["period_end"]  # the period whose edition worded this label
            info["unit"] = unit_of(c["path"], c["fmt"])
            info["dec"] = decimals_of(c["fmt"])
    return cols


def row_index(norm):
    """({(entity, entity_id): row}, [conflicting entities]) for the data rows of a normalised table.

    An entity the table prints twice with the same figures is read once. An entity printed twice with different figures (a row
    and a footnoted row with the same label, "2nd" and "2ND") cannot be told apart by its label, so it is left out of this
    period (a gap) and listed in the conflicts; neither row is chosen."""
    out, conflicts = {}, set()
    for r in norm["rows"]:
        if r["section"]:
            continue
        key = (r["entity"], r["entity_id"])
        if key in out:
            if out[key]["values"] != r["values"]:
                conflicts.add(key)
            continue
        out[key] = r
    for key in conflicts:
        del out[key]
    return out, sorted(conflicts)


def series_for(docs, cols, entity_key):
    """({col: [value per period]}, {col: [period index printed as a dash]}, label as printed in the latest period) for one entity."""
    n = len(docs)
    data = {k: [None] * n for k in cols}
    dash = {k: [] for k in cols}
    label = None
    for i, d in enumerate(docs):
        row = d["rows_by_entity"].get(entity_key)
        if row is None:
            continue
        label = row["label"]
        from_book = (d.get("source") or {}).get("format") != "pdf"
        for ci, c in value_columns(d["norm"]):
            if c["key"] not in data:
                continue
            pos = d["col_pos"][c["key"]]
            v = row["values"][pos]
            if v is not None:
                flag = (row["flags"] or [None] * (pos + 1))[pos]
                data[c["key"]][i] = clean_num(printed_value(v, c.get("fmt"), from_book, flag))
            elif (row["flags"] or [None] * (pos + 1))[pos] == "dash":
                dash[c["key"]].append(i)
    return data, {k: v for k, v in dash.items() if v}, label


def prepare(docs):
    for d in docs:
        n = d["norm"]
        d["rows_by_entity"], d["entity_conflicts"] = row_index(n)
        d["col_pos"] = {c["key"]: i for i, c in enumerate(n["columns"]) if not c.get("prior")}
    return docs


def marks_block(docs, keys, entity_key):
    """Footnotes the publisher attached to this row's label or cells (col None / a column key) or to a column heading, with the
    period positions where each applies: [{"at": [...], "col": key | None, "text": "² The higher number ..."}]. A mark whose
    note text is not in the table is left out (and counted by the caller)."""
    groups = OrderedDict()
    for i, d in enumerate(docs):
        n = d["norm"]
        notes = n.get("note_marks", {})
        row = d["rows_by_entity"].get(entity_key)
        if row:
            for m in row.get("marks") or []:
                if notes.get(m):
                    groups.setdefault((None, notes[m]), []).append(i)
            for pos, ms in (row.get("cell_marks") or {}).items():
                col = n["columns"][int(pos)] if int(pos) < len(n["columns"]) else None
                for m in ms:
                    if col is not None and not col.get("prior") and col["key"] in keys and notes.get(m):
                        groups.setdefault((col["key"], notes[m]), []).append(i)
        for _, c in value_columns(n):
            if c["key"] in keys:
                for m in c.get("marks") or []:
                    if notes.get(m):
                        groups.setdefault((c["key"], notes[m]), []).append(i)
    return [{"at": sorted(set(at)), "col": col, "text": text} for (col, text), at in groups.items()]


def note_groups(docs):
    groups = OrderedDict()
    for i, d in enumerate(docs):
        lines = tuple(d["norm"]["notes"])
        if lines:
            groups.setdefault(lines, []).append(i)
    return [{"at": at, "lines": list(lines)} for lines, at in groups.items()]


def new_sentences(previous, current):
    """Sentences of the current footnote lines that the previous period's footnotes do not contain (numbers ignored)."""
    split = lambda lines: [t.strip() for t in re.split(r"(?<=[.!?])\s+", " ".join(lines)) if t.strip()]  # noqa: E731
    seen = {norm_sig(t) for t in split(previous)}
    return [t for t in split(current) if norm_sig(t) not in seen]


def find_breaks(docs):
    """Breaks in the series: a change of column set, title wording or footnote wording against the previous period of the
    SAME publication (Judicial Business, Statistical Tables and Caseload Statistics word the same table slightly
    differently, so comparing across publications would flag every period)."""
    breaks = []
    prev_by_pub = {}
    for i, d in enumerate(docs):
        n = d["norm"]
        cur = {"cols": {c["key"] for _, c in value_columns(n)}, "notes": norm_sig(" ".join(n["notes"])), "title": norm_sig(n["title"]), "title_text": n["title"], "note_lines": n["notes"],
               "labels": {c["key"]: (norm_sig(re.sub(r"\b(?:19|20)\d{2}\b", "", c["label"])), c["label"]) for _, c in value_columns(n)}}
        cur["fmt"] = (d.get("source") or {}).get("format")
        prev = prev_by_pub.get(n["pub"])
        if prev is not None:
            renamed = [(k, prev["labels"][k][1], v[1]) for k, v in cur["labels"].items() if k in prev["labels"] and prev["labels"][k][0] != v[0]]
            if renamed:
                k, old, new = renamed[0]
                more = f" (and {len(renamed) - 1} more columns)" if len(renamed) > 1 else ""
                breaks.append({"at": i, "kind": "heading", "detail": f"A column heading is worded differently from the previous period: '{old}' became '{new}'{more}; the series continues under the same column."})
            added, removed = sorted(cur["cols"] - prev["cols"]), sorted(prev["cols"] - cur["cols"])
            if added or removed:
                bits = []
                if added:
                    bits.append("columns added: " + ", ".join(added[:6]) + (" ..." if len(added) > 6 else ""))
                if removed:
                    bits.append("columns removed: " + ", ".join(removed[:6]) + (" ..." if len(removed) > 6 else ""))
                breaks.append({"at": i, "kind": "columns", "detail": "; ".join(bits)})
            if cur["title"] != prev["title"] and not (prev.get("fmt") == "pdf" and cur["fmt"] != "pdf"):
                breaks.append({"at": i, "kind": "title", "detail": f"The table title is worded differently from the previous period: '{prev['title_text'][:110]}' became '{n['title'][:110]}'."})
            if prev.get("fmt") == "pdf" and cur["fmt"] != "pdf":
                breaks.append({"at": i, "kind": "source", "detail": "Earlier periods were read from the published PDF (figures as printed; footnotes as printed, not linked to cells); this and later periods come from the published spreadsheet."})
            if cur["notes"] != prev["notes"]:
                added_text = " ".join(t[:240] for t in new_sentences(prev["note_lines"], n["notes"])[:2])
                breaks.append({"at": i, "kind": "notes", "detail": "The footnotes differ from the previous period's" + (f": {added_text}" if added_text else ".")})
        prev_by_pub[n["pub"]] = cur
    return breaks


def circuit_of_districts(docs):
    """{district id: circuit id} from row order in the latest period that prints circuit roll-up rows; plus conflicts."""
    mapping, conflicts = {}, []
    for d in docs:
        current = None
        seen = {}
        for r in d["norm"]["rows"]:
            if r["section"]:
                continue
            if r["entity"] == "circuit":
                current = r["entity_id"]
            elif r["entity"] == "district":
                if r["entity_id"] in ("dcd", "dcb"):
                    seen[r["entity_id"]] = "cadc"
                elif current:
                    seen[r["entity_id"]] = current
        for k, v in seen.items():
            if k in mapping and mapping[k] != v:
                conflicts.append((k, mapping[k], v, d["norm"]["period_end"]))
            mapping[k] = v
    return mapping, conflicts


def periods_block(docs):
    periods, sources = [], []
    for i, d in enumerate(docs):
        n = d["norm"]
        periods.append({"end": n["period_end"], "months": n.get("months"), "pub": n["pub"], "src": i})
        sources.append(source_entry(d))
    return periods, sources


def court_payload(scope, court_id, docs, cols, table, title, nat, circuit_id, circ, entity_key, rollup_of=None):
    data, dash, label = series_for(docs, cols, entity_key)
    periods, sources = periods_block(docs)
    payload = {
        "v": 1, "scope": scope, "court": court_id, "courtLabel": label, "table": table["table"], "tableKey": table["table_key"], "title": title,
        "periods": periods, "cols": [{k: c[k] for k in ("k", "label", "unit", "dec", "le")} for c in cols.values()],
        "data": data, "dash": dash, "nat": nat[0], "natDash": nat[1], "circuitId": circuit_id, "circ": circ,
        "notes": note_groups(docs), "breaks": find_breaks(docs), "src": sources,
        "marks": marks_block(docs, set(cols), entity_key),
    }
    if rollup_of:
        payload["rollupOf"] = rollup_of
    return payload


def drop_empty(payload):
    """Drop columns with no value and no printed dash anywhere (the table never printed anything for this court) from a court
    payload. A column that is only dashes is kept: the publisher printed a dash for this court, which is information."""
    keep = [c for c in payload["cols"] if any(v is not None for v in payload["data"].get(c["k"], [])) or payload["dash"].get(c["k"])]
    if not keep:
        return None
    keys = {c["k"] for c in keep}
    payload = dict(payload)
    payload["cols"] = keep
    payload["data"] = {k: v for k, v in payload["data"].items() if k in keys}
    payload["dash"] = {k: v for k, v in payload["dash"].items() if k in keys}
    payload["nat"] = {k: v for k, v in payload["nat"].items() if k in keys}
    payload["natDash"] = {k: v for k, v in payload["natDash"].items() if k in keys}
    payload["marks"] = [m for m in payload.get("marks", []) if m["col"] is None or m["col"] in keys]
    if payload.get("circ"):
        payload["circ"] = {k: v for k, v in payload["circ"].items() if k in keys}
    return payload


def category_rows(docs, cols):
    """Rows of a category (national) table over all periods, keyed by the row's path: [{k,label,path,depth,data,dash}]."""
    order, labels = OrderedDict(), {}
    for d in docs:
        for r in d["norm"]["rows"]:
            if r["section"]:
                continue
            key = r["entity_id"]
            order.setdefault(key, True)
            labels[key] = (r["label"], r["path"])
    out = []
    for key in order:
        data, dash, label = series_for(docs, cols, ("national" if key == "national" else "category", key))
        if not any(v is not None for series in data.values() for v in series):
            continue
        lab, path = labels[key]
        kept = {k: v for k, v in data.items() if any(x is not None for x in v)}
        out.append({"k": key, "label": lab, "path": path, "depth": max(0, len(path) - 1), "data": kept, "dash": dash,
                    "marks": [m for m in marks_block(docs, set(kept), ("national" if key == "national" else "category", key)) if m["col"] is None or m["col"] in kept]})
    return out
