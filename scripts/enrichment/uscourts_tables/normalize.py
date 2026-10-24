"""Turn one parsed sheet (utx_parse) plus its listing entry into a normalised table-period object.

The normalised object keeps the published words (title, period phrase, column heading paths, row labels, footnotes) and
adds only deterministic structure: a stable column key (heading words slugged, years made relative to the period so
"2025" in the 2025 edition and "2024" in the 2024 edition are the same column "y0"), a row entity (national total,
circuit, district, bankruptcy district, or a category path built from indentation and section rows) and a scope.
Nothing is computed from values here.
"""
import re

import entities as E
import save_lookups as L
import utx_parse as P

# The court ids a row may carry: the 94 districts (bankruptcy courts are keyed by their district), former districts the directory
# lists (save_lookups.HISTORICAL_DISTRICTS) and the combined Arkansas bankruptcy court.
KNOWN_COURTS = set(L.pairs(L.DISTRICT_SUFFIX)) | set(L.HISTORICAL_DISTRICTS) | {"arcomb"}

YEAR = re.compile(r"^(?:FY\s?)?((?:19|20)\d{2})$")
PCT_WORDS = re.compile(r"percent|change|%|rate|share", re.I)


def table_slug(table):
    return re.sub(r"[^a-z0-9]+", "-", table.lower()).strip("-")


def months_of(phrase, default=None):
    if not phrase:
        return default
    if re.match(r"as\s+of", phrase, re.I):
        return 0  # a point in time (cases pending as of a date), not a period
    m = re.search(r"(\d+)[-\s]Months?", phrase, re.I)
    if m:
        return int(m.group(1))
    words = {"one": 1, "two": 2, "three": 3, "six": 6, "twelve": 12}
    m = re.search(r"\b(one|two|three|six|twelve)[-\s]Months?", phrase, re.I)
    if m:
        return words[m.group(1).lower()]
    if re.search(r"quarter", phrase, re.I):
        return 3
    if re.search(r"calendar\s+year", phrase, re.I):
        return 12
    return default


DATE_IN_TEXT = re.compile(r"\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b")
YEAR_IN_TEXT = re.compile(r"\b((?:19|20)\d{2})\b")


def _rel(delta):
    return f"y{'m' if delta < 0 else ''}{abs(delta)}"


def relative_text(element, period_year):
    """Heading text with its dates and years made relative to the period's year, so "Not Terminated as of June 30, 2024" in the
    2025 edition and "... June 30, 2025" in the 2026 edition are the same column."""
    text = DATE_IN_TEXT.sub(lambda m: f"{m.group(1)} {m.group(2)} {_rel(int(m.group(3)) - period_year)}", element)
    return YEAR_IN_TEXT.sub(lambda m: _rel(int(m.group(1)) - period_year), text)


# The publisher re-worded the top-level headings of the same count columns over time ("Filings" until 2021, "Commenced" in some
# editions, "Filed" since): they are one series. Only these exact top-level headings are merged, and every change of wording is
# recorded as a "heading" break at the period it happens (build_tables.find_breaks).
HEADING_SYNONYMS = {"filings": "filed", "commenced": "filed", "terminations": "terminated"}


def column_key(path, period_year):
    parts = []
    for n, element in enumerate(path):
        m = YEAR.match(element.strip())
        if m:
            parts.append(f"y{int(m.group(1)) - period_year}")
        else:
            slug = P.slug(relative_text(element, period_year))
            parts.append(HEADING_SYNONYMS.get(slug, slug) if n == 0 else slug)
    return "/".join(parts) or "col"


def is_prior_year_column(path, period_year):
    """A column that repeats an earlier year's figure (the prior-year value printed beside the current year)."""
    if any(PCT_WORDS.search(e) for e in path):
        return False
    for element in path:
        m = YEAR.match(element.strip())
        if m and int(m.group(1)) < period_year:
            return True
    return False


def scope_of(rows, title, label_header=()):
    kinds = {"district": 0, "circuit": 0, "total": 0, "other": 0}
    for r in rows:
        if r["section"]:
            continue
        label = E.clean_label(r["label"])
        if E.is_national(label):
            kinds["total"] += 1
        elif E.district_id(label):
            kinds["district"] += 1
        elif E.circuit_id(label) and re.match(r"^(\d{1,2}(st|nd|rd|th)|DC|Fed\.?)$", label, re.I):
            kinds["circuit"] += 1
        else:
            kinds["other"] += 1
    bankruptcy = bool(re.search(r"bankruptcy", title, re.I)) and not re.search(r"appeal", title, re.I)
    if re.search(r"\bcounty\b", " ".join(label_header), re.I) and kinds["district"] >= 40:
        return "county", kinds
    if kinds["district"] >= 40:
        return ("bankruptcy" if bankruptcy else "district"), kinds
    if kinds["circuit"] >= 8 and kinds["district"] < 5:
        return "appeals", kinds
    return "category", kinds


def split_title(title_raw):
    """(table id as printed, title text, period phrase) from the joined title block."""
    text = re.sub(r"\s+", " ", title_raw).strip()
    m = P.TABLE_ID.match(text)
    rest = text[m.end():].strip() if m else text
    phrase, _ = P.parse_period_phrase(rest)
    if phrase:
        rest = rest.replace(phrase, "").strip()
        if not re.match(r"as\s+of", phrase, re.I):
            # some editions print the data-extraction date after the period ("... Ending September, 2020 as of November 18, 2020")
            rest = re.sub(r"\s+as of [A-Z][a-z]+\.? \d{1,2}, \d{4}\s*$", "", rest)
    rest = re.sub(r"[\s,]+$", "", rest)
    rest = re.sub(r"^[\s.:\-–—]+", "", rest)
    return (P.printed_table_id(m) if m else None), rest, phrase


def county_code(row, code_pos):
    """(5-digit FIPS code, printed outside the district's own territory) of a county row; (None, False) for any other row. The
    code cell is text such as "11001" or "12113*"; a leading zero lost to a numeric cell is restored to five digits."""
    if code_pos is None or not row.get("values"):
        return None, False
    value, flag = row["values"][code_pos], (row["flags"] or [None] * (code_pos + 1))[code_pos]
    starred = "*" in "".join((row.get("cell_marks") or {}).get(str(code_pos), []))
    if value is not None and flag == "textnum" and 1 <= value < 100000:
        return f"{int(value):05d}", starred
    if isinstance(flag, str) and flag.startswith("text:"):
        raw = flag[5:]
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 5:
            return digits, "*" in raw
    if isinstance(value, (int, float)) and flag is None and float(value).is_integer() and 1000 <= value < 100000:
        return f"{int(value):05d}", False
    return None, False


def classify_row(scope, label):
    """(entity kind, entity id) of a court-table row label. Bankruptcy courts are keyed by their district's id (a bankruptcy
    court is a unit of the district court); the combined Arkansas bankruptcy court ("AR") covers two districts and has no
    single district id, so it is the entity "arcomb" (kept in the sums, never linked to a court page)."""
    clean = E.clean_label(label)
    if E.is_national(clean):
        return "national", "national"
    if scope == "appeals":
        cid = E.circuit_id(clean)
        return ("circuit", cid) if cid else ("other", P.slug(label))
    cid = E.circuit_id(clean) if re.match(r"^\d{1,2}(st|nd|rd|th)$", clean, re.I) else None
    if cid:
        return "circuit", cid
    did = "arcomb" if (scope == "bankruptcy" and clean.upper() == "AR") else E.district_id(clean, "d")
    if did and did not in KNOWN_COURTS:
        # A district code that names no court ("AK,E" and "AK,W" in the 8th Circuit block of Judicial Business S-19 FY2017, where
        # every other edition prints AR,E and AR,W; "AR" outside a bankruptcy table, where Arkansas has two district courts): it
        # stays a row of its circuit block, so the block's printed roll-up is still tested, but it is never given a court id.
        return "district", f"unmatched:{clean}"
    return ("district", did) if did else ("other", P.slug(label))


def normalize(sheet, entry, hierarchy_mode=None):
    """hierarchy_mode for a category table: None reads the rows' paths from indentation unless the table repeats a label under the
    same parent with different figures (then from its sums); "sums" reads them from the sums whenever the sums form a tree
    (ingest.py decides this per table, so every edition of one table is read the same way); "indent" never uses the sums."""
    period_end = entry["period_end"]
    period_year = int(period_end[:4])
    printed_id, title, phrase = split_title(sheet["title_raw"])
    problems = []
    if sheet["period_end_from_title"] and sheet["period_end_from_title"] != period_end:
        problems.append(f"period in title {sheet['period_end_from_title']} differs from listing {period_end}")
    columns = []
    for c in sheet["columns"]:
        key = column_key(c["path"], period_year)
        columns.append({
            "index": c["index"], "key": key, "path": c["path"], "label": " / ".join(c["path"]), "fmt": c["fmt"], "marks": c.get("marks", []),
            "prior": is_prior_year_column(c["path"], period_year),
        })
    seen = {}
    for c in columns:
        if c["key"] in seen:
            seen[c["key"]] += 1
            c["key"] = f"{c['key']}~{seen[c['key']]}"
        else:
            seen[c["key"]] = 1
    scope, kinds = scope_of(sheet["rows"], title, sheet.get("label_header", ()))
    if scope == "category" and sum(1 for r in sheet["rows"] if not r["section"] and re.search(r"\.\.$", r["label"].rstrip())) >= 40:
        # Bankruptcy Filings workbooks before 2009 are mainframe printouts: dot-leader row labels ("DC......") and column headings
        # stacked over unmerged cells ("CHAP." over "7"), so a column cannot be named from them without guessing.
        problems.append("legacy printout layout (dot-leader labels, stacked unmerged headings) is not parsed")
    if scope != "county" and re.search(r"\bby county\b|\bcounty cases\b", title, re.I):
        # Bankruptcy Filings F-5A before 2016 lists counties alphabetically with no district rows, so the reporting district of a
        # county is not stated in the table.
        problems.append("county table whose rows are not grouped under their reporting district is not parsed")
    rows = []
    section_stack = []
    code_pos = None
    if scope == "county":
        code_pos = next((i for i, c in enumerate(columns) if [e.lower() for e in c["path"]] == ["county code"]), None)
        if code_pos is not None:
            columns[code_pos]["prior"] = True  # an attribute of the row (the county's FIPS code), not a series
    district_context = None
    for r in sheet["rows"]:
        label = r["label"]
        if scope == "county":
            if r["section"]:
                continue
            code, outside = county_code(r, code_pos)
            if code:
                rows.append({**r, "entity": "county", "entity_id": f"{code}:{district_context or 'unknown'}", "path": [E.clean_label(label)], "county_code": code,
                             "district": district_context, "outside_district": outside})
                continue
            entity = classify_row("bankruptcy", label)
            if entity[0] == "district":
                district_context = entity[1]
            rows.append({**r, "entity": entity[0], "entity_id": entity[1], "path": [E.clean_label(label)]})
            continue
        if scope in ("district", "bankruptcy", "appeals"):
            if r["section"]:
                continue
            entity = classify_row(scope, label)
            rows.append({**r, "entity": entity[0], "entity_id": entity[1], "path": [E.clean_label(label)]})
            continue
        # category table: indentation and section rows give the path
        indent = r["indent"]
        while section_stack and section_stack[-1][0] >= indent:
            section_stack.pop()
        if r["section"]:
            section_stack.append((indent, label))
            continue
        path = [s[1] for s in section_stack] + [label]
        key = "/".join(P.slug(p) for p in path)
        entity = "national" if E.is_national(label) and not section_stack else "category"
        rows.append({**r, "entity": entity, "entity_id": "national" if entity == "national" else key, "path": path})
        # a row with figures ("Contract Actions, Total") is also the parent of the more deeply indented rows that follow it, so
        # the same child label under two parents ("Marine") stays two rows
        section_stack.append((indent, label))
    hierarchy, ambiguous, warnings = "indent", [], []
    want_sums = hierarchy_mode == "sums" or (hierarchy_mode is None and bool(repeated_entities(rows)))
    if scope == "category" and want_sums:
        resolved = rows_by_sums(sheet["rows"], columns)
        if resolved is not None:
            rows, ambiguous = resolved
            hierarchy = "sums"
            warnings.append("The row hierarchy was read from the table's own totals: each block row equals, in every count column, the "
                            "sum of the rows printed under it (the table's indentation does not show its blocks).")
            if ambiguous:
                warnings.append(f"{len(ambiguous)} rows print the same label twice in one block with different figures and no heading "
                                f"between them ({', '.join(sorted({a['label'] for a in ambiguous})[:4])}); they are left out of this period.")
    return {
        **({"warnings": warnings} if warnings else {}),
        "pub": entry["pub"], "table": entry["table"], "table_key": table_slug(entry["table"]),
        "period_end": period_end, "months": months_of(phrase, None), "period_phrase": phrase,
        "title": title, "title_listing": entry["title"], "printed_table_id": printed_id,
        "scope": scope, "row_kinds": kinds, "label_header": sheet["label_header"],
        "columns": columns, "rows": rows, "notes": sheet["notes"], "note_marks": sheet.get("note_marks", {}), "sheet": sheet["sheet"],
        "problems": problems, "hierarchy": hierarchy, "ambiguous_rows": ambiguous,
    }


def category_rows(sheet_rows, columns, hierarchy_mode=None):
    """(rows, hierarchy, ambiguous) for the rows of a category table read from another source than a workbook (a PDF text layer):
    the same path rules as normalize(): indentation and section rows, or the table's printed sums (rows_by_sums) when the mode is
    "sums" or, with no mode, when indentation leaves a label repeated under one parent with different figures."""
    rows, stack = [], []
    for r in sheet_rows:
        label, indent = r["label"], r["indent"]
        while stack and stack[-1][0] >= indent:
            stack.pop()
        if r["section"]:
            stack.append((indent, label))
            continue
        path = [s[1] for s in stack] + [label]
        key = "/".join(P.slug(p) for p in path)
        entity = "national" if E.is_national(label) and not stack else "category"
        rows.append({**r, "entity": entity, "entity_id": "national" if entity == "national" else key, "path": path})
        stack.append((indent, label))
    want_sums = hierarchy_mode == "sums" or (hierarchy_mode is None and bool(repeated_entities(rows)))
    if want_sums:
        resolved = rows_by_sums(sheet_rows, columns)
        if resolved is not None:
            return resolved[0], "sums", resolved[1]
    return rows, "indent", []


def repeated_entities(rows):
    """Entity ids a category table prints more than once with different figures (labels repeated under the same parent)."""
    first, repeated = {}, set()
    for r in rows:
        if r["entity_id"] in first and first[r["entity_id"]] != r["values"]:
            repeated.add(r["entity_id"])
        first.setdefault(r["entity_id"], r["values"])
    return repeated


def rows_by_sums(sheet_rows, columns):
    """(rows, ambiguous) with each row's path taken from the table's printed sums (hierarchy.resolve), or None when the sums do not
    form a tree. A path the table still prints twice with different figures (C-4 prints "Consumer Credit" twice in one block with no
    heading between) cannot be told apart: those rows are left out of the period and listed in `ambiguous`; neither is chosen."""
    import hierarchy as H
    import reconcile as R

    data = [r for r in sheet_rows]
    # every count column is a test of the tree, the earlier years a multi-year table prints beside the current one included
    positions = R.additive_positions({"columns": [{**c, "prior": False} for c in columns]})
    parents = H.resolve(data, positions)
    if parents is None:
        return None
    paths = H.paths(data, parents)
    rows = []
    for i, r in enumerate(data):
        if i not in paths:
            continue
        path = paths[i]
        key = "/".join(P.slug(p) for p in path)
        entity = "national" if E.is_national(r["label"]) and len(path) == 1 else "category"
        rows.append({**r, "entity": entity, "entity_id": "national" if entity == "national" else key, "path": path})
    repeated = repeated_entities(rows)
    ambiguous = [{"label": r["label"], "path": r["path"], "row": r.get("row")} for r in rows if r["entity_id"] in repeated]
    return [r for r in rows if r["entity_id"] not in repeated], ambiguous
