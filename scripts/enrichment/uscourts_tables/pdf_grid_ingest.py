"""Read the PDF-only editions that the row-count reader (pdf_backfill.py) could not read, with the word-position reader (pdf_grid.py)
and column names matched from a reference workbook edition by heading words (pdf_align.py).

This path reads editions whose column set differs from the spreadsheet editions (a column added or dropped), wide tables printed
in halves on alternate pages, BAPCPA PDFs that print a sort-order code column, circuit labels spelled in other ways, and the
category tables (nature of suit, offense ...) with wrapped row labels. An edition is kept only when ALL of these hold:

  * the title names the listing's table and period (an edition printed under the table's earlier number, "Table S-1" for the
    listing's B-10, is accepted only when no other table of that period has that number and the title words agree);
  * every PDF column is matched to a reference column, in order and in one way only, by its own heading words and its group
    headings (pdf_align.py), and the halves of a wide table list the same rows in the same order;
  * court tables: the same set of courts as the reference (national, circuit and district rows; sub-rows by nature of proceeding
    are not compared), every court row has a figure or a dash in every column, no court printed twice, and every roll-up holds
    (the Total over the circuits, each circuit over its districts);
  * category tables: every data row has a figure or a dash in every column, and no row total is smaller than the rows printed under
    it (the hierarchy read as for the table's workbook editions: indentation, or the printed sums).
The build then reconciles every period against the totals it prints (reconcile.py), as for every other table-period.

Usage: python3 -I -B pdf_grid_ingest.py [--tables C-2A,B-1] [--pubs JB,STFJ] [--force] [--limit N]
"""
import gzip
import json
import re
import sys
import warnings
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import checks as C  # noqa: E402
import entities as E  # noqa: E402
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402
import pdf_align as A  # noqa: E402
import pdf_grid as G  # noqa: E402
import reconcile as R  # noqa: E402
import utx_parse as P  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
GRID_VERSION = "grid-2026-10-25.6"
COURT_SCOPES = ("district", "bankruptcy", "appeals")
MAX_REFERENCES = 6
CIRCUIT_NAMES = {"DISTRICT OF COLUMBIA": "DC", "D.C.": "DC", "FIRST": "1ST", "SECOND": "2ND", "THIRD": "3RD", "FOURTH": "4TH", "FIFTH": "5TH",
                 "SIXTH": "6TH", "SEVENTH": "7TH", "EIGHTH": "8TH", "NINTH": "9TH", "TENTH": "10TH", "ELEVENTH": "11TH", "FEDERAL": "Fed."}
NATIONAL = {"ALL CIRCUITS", "ALL DISTRICTS", "TOTAL", "U.S. TOTAL", "ALL COURTS", "TOTAL ALL CIRCUITS", "ALL"}
SORT_CODE = re.compile(r"^(?:0\.0|\d{2,3})$")
warnings.filterwarnings("ignore")


def court_label(label):
    """The label the court tables use: "1ST CIRCUIT" and "First" -> "1ST", "ALL CIRCUITS" -> "TOTAL", "NY, S" -> "NY,S"."""
    t = re.sub(r"\s+", " ", label.strip()).upper()
    t = re.sub(r"\s*(?:\.{2,}|…)+$", "", t)  # dot leaders ("DC......", "1ST...")
    t = re.sub(r"^\d{1,4}\s+(?=[A-Z]{2}\b|[A-Z]{2},)", "", t)  # a page number printed on the same line as the row ("132 AL,S")
    t = re.sub(r"\s+CIRCUIT$", "", t)
    if t in NATIONAL:
        return "TOTAL"
    if t in CIRCUIT_NAMES:
        return CIRCUIT_NAMES[t]
    return re.sub(r",\s+", ",", t)


def load_references():
    """{table_key: [(period_end, pub, normalized first sheet)]} for the workbook editions (any scope)."""
    refs = defaultdict(list)
    for path in sorted(PARSED.glob("*/*/*.json.gz")):
        doc = json.loads(gzip.decompress(path.read_bytes()))
        if doc["source"].get("format") == "pdf":
            continue
        for sheet in doc["sheets"]:
            if sheet.get("sheet_index", 0) == 0:
                keep = {k: sheet[k] for k in ("pub", "table", "table_key", "period_end", "scope", "columns", "rows", "months", "row_kinds", "label_header", "title")}
                refs[sheet["table_key"]].append((sheet["period_end"], sheet["pub"], keep))
    return refs


def candidates(refs, entry):
    key = N.table_slug(entry["table"])
    later = [r for r in refs.get(key, []) if r[0] > entry["period_end"]]
    later.sort(key=lambda r: (r[1] != entry["pub"], r[0]))
    out, seen = [], set()
    for end, pub, sheet in later:
        signature = tuple(c["key"] for c in sheet["columns"])
        if signature in seen:
            continue
        seen.add(signature)
        out.append(sheet)
        if len(out) >= MAX_REFERENCES:
            break
    return out


def title_words(text):
    words = {w[:-1] if w.endswith("s") and not w.endswith("ss") else w for w in re.findall(r"[a-z]{4,}", text.lower())}
    return words - {"court", "during", "period", "month", "ending", "table", "case", "fiscal", "year", "u.s."}


def check_title(block, entry, listing_ids, listing_titles=None):
    """[] or reasons: the printed table id and period against the listing (a renumbered edition: see the module docstring)."""
    text = " ".join(block["title"])
    reasons, warnings_ = [], []
    m = P.TABLE_ID.match(text) or re.search(r"Table\s+([A-Z]{0,4}-?\d+[A-Z]?)", text)
    printed = P.printed_table_id(m).replace(" ", "") if m is not None and m.re is P.TABLE_ID else (m.group(1).upper() if m else "")
    listed = entry["table"].upper().replace(" ", "")
    base = re.sub(r"\(.*?\)|CASES$|RETIRED$", "", listed)
    unprefixed = re.sub(r"^(BAPCPA|WIRE)", "", listed)
    if printed and printed not in (listed, base, unprefixed) and re.sub(r"^(BAPCPA|WIRE)", "", printed) not in (listed, base, unprefixed):
        other = {t.upper().replace(" ", ""): t for t in listing_ids}
        shared = title_words(text) & title_words(entry.get("title") or "")
        # the columns are matched to this table's own spreadsheet editions afterwards; here the title must share at least two
        # significant words with the listing's title ("Pro Se Appeals ... Sources" and "Pro Se Cases Filed, by Source")
        need = 2
        # the period's listing may give the printed number to another table (in 1997-2000 BAP-1 was printed as "Table B-10" while the
        # listing's B-10 is the old S-1): then this edition's title must agree with this listing title better than with that one's
        rival_title = (listing_titles or {}).get(other.get(printed), "") if printed in other else ""
        rival = title_words(text) & title_words(rival_title)
        # a rival whose listing title is unknown cannot be ruled out: the edition is not taken
        if len(shared) < need or (printed in other and (not rival_title or len(shared) <= len(rival))):
            reasons.append(f"title table {printed} != listing {listed}")
        else:
            warnings_.append(f"This edition prints the table's earlier number ({printed}); the publisher's listing files it as {entry['table']}.")
    phrase, end = P.parse_period_phrase(re.sub(r"\s+", " ", text))
    if end and end != entry["period_end"]:
        reasons.append(f"period in title {end} differs from listing {entry['period_end']}")
    if not end:
        reasons.append("no period in the title")
    return reasons, warnings_, phrase


def drop_sort_code(block):
    """A last column printing only order codes ("0.0" for the Total, "00", "01" for circuits, "010" for districts) is the publisher's
    sort key, not a statistic (the spreadsheets head it "Sort Order"): it is removed before the columns are matched."""
    rows = [r for r in block["rows"] if r["kind"] == "data"]
    if not rows or block["ncols"] < 2:
        return False
    raw = [(r.get("raw") or [None])[-1] for r in rows]
    if not all(t is not None and SORT_CODE.match(t) for t in raw):
        return False
    if not any(t == "0.0" for t in raw):
        return False
    for r in block["rows"]:
        if r["kind"] == "data":
            r["values"], r["flags"], r["raw"] = r["values"][:-1], r["flags"][:-1], (r.get("raw") or [])[:-1]
    block["ncols"] -= 1
    for line in block["headers"]:
        for w in line:
            if w["band"] == block["ncols"]:
                w["band"] = None
    return True


def known_labels(refs_for_key):
    out = set()
    for _, _, sheet in refs_for_key:
        for r in sheet["rows"]:
            if not r.get("section"):
                out.add(G.norm_label(r["label"]))
    return out


def clean_category_label(label, known):
    """A footnote digit printed at text size after a label ("ASBESTOS 1") is dropped when the label without it is one the workbooks
    print; nothing else is changed."""
    m = re.match(r"^(.*\D)\s+\d$", label)
    if m and G.norm_label(m.group(1)) in known and G.norm_label(label) not in known:
        return m.group(1).strip()
    m = re.match(r"^\d{1,4}\s+(\D.*)$", label)  # a page number printed on the same line as the row
    if m and G.norm_label(m.group(1)) in known and G.norm_label(label) not in known:
        return m.group(1).strip()
    return label


INDENT_TOL = 4.0  # points: label starts this close are one indentation level (the text layer places them 1-2 points apart)


def indent_levels(xs):
    """{x0: level} grouping label start positions into indentation levels, left to right."""
    out, level, prev = {}, -1, None
    for x in sorted(set(xs)):
        if prev is None or x - prev > INDENT_TOL:
            level += 1
        out[x] = level
        prev = x
    return out


def build_norm(entry, ref, blocks, mappings, hierarchy_mode, known):
    """(norm, reasons) for the edition: columns from the matched reference columns, rows from the blocks joined side by side."""
    scope = ref["scope"]
    joined = []
    for b in blocks:
        joined.append([r for r in G.join_rows(b["rows"], known)])
    # the halves of a wide table list the same rows in the same order
    labels = [[(r["section"], G.norm_label(r["label"])) for r in rows] for rows in joined]
    if any(lab != labels[0] for lab in labels[1:]):
        return None, ["the halves of the table do not list the same rows"]
    columns, seen = [], set()
    for part, mapping in enumerate(mappings):
        for pos, c in enumerate(mapping):
            if c is None:
                continue
            if c["key"] in seen:
                return None, [f"the column {c['key']} is matched twice"]
            seen.add(c["key"])
            # where the figure stands on the PDF line (part of the table, position, figures per line), for the second-path check
            columns.append({**c, "marks": [], "index": len(columns), "pdf_part": part, "pdf_pos": pos, "pdf_width": len(mapping)})
    rows = []
    for k, first in enumerate(joined[0]):
        values, flags = [], []
        if not first["section"]:
            for rows_b, mapping in zip(joined, mappings):
                values += [v for v, c in zip(rows_b[k]["values"], mapping) if c is not None]
                flags += [f for f, c in zip(rows_b[k]["flags"], mapping) if c is not None]
        label = first["label"]
        rows.append({"label_raw": label, "label": label, "indent": first["x0"] or 0, "section": first["section"], "values": values if not first["section"] else None,
                     "flags": flags if not first["section"] else None, "row": None, "marks": first["marks"], "cell_marks": {}})
    reasons = []
    hierarchy, ambiguous = "indent", []
    if scope in COURT_SCOPES:
        out = []
        for r in rows:
            if r["section"]:
                continue
            lab = court_label(r["label"])
            entity = N.classify_row(scope, lab)
            out.append({**r, "label": E.clean_label(lab), "entity": entity[0], "entity_id": entity[1], "path": [E.clean_label(lab)]})
        rows = out
    elif entry["pub"] == "WIRETAP":
        rows, why = wiretap_paths(rows, known)
        if rows is None:
            return None, [why]
        hierarchy = "state headings"
    else:
        levels = indent_levels([r["indent"] for r in rows])
        for r in rows:
            r["label"] = clean_category_label(r["label"], known)
            r["indent"] = levels[r["indent"]]
        rows, hierarchy, ambiguous = N.category_rows(rows, columns, hierarchy_mode)
    norm = {"pub": entry["pub"], "table": entry["table"], "table_key": N.table_slug(entry["table"]), "period_end": entry["period_end"],
            "months": ref.get("months"), "period_phrase": None, "title": entry["title"] or ref["title"], "title_listing": entry["title"], "printed_table_id": None,
            "scope": scope, "row_kinds": ref.get("row_kinds"), "label_header": ref.get("label_header"), "columns": columns, "rows": rows,
            "notes": [n for b in blocks for n in b["notes"]][:40], "note_marks": {}, "sheet": None, "problems": [], "hierarchy": hierarchy,
            "ambiguous_rows": ambiguous, "sheet_index": 0}
    return norm, reasons


WIRE_TABLES = {"Wire 2", "Wire 3", "Wire 4", "Wire 5", "Wire 6"}  # one row per reporting jurisdiction (wiretap.py reads the workbooks)


STRUCTURAL_HEADINGS = {"FEDERAL JURISDICTIONS", "STATE JURISDICTIONS", "LOCAL JURISDICTIONS", "STATE AND LOCAL JURISDICTIONS"}


def wiretap_paths(rows, known=frozenset()):
    """(rows with paths, None) or (None, reason) for a Wiretap jurisdiction table printed as PDF (1997-2015). Two layouts:

      * TOTAL, FEDERAL, then each state or territory as a heading without figures and its local jurisdictions (1997-2014);
      * TOTAL, FEDERAL TOTAL and the federal districts, then each state with its own row of figures and its jurisdictions (2015, as
        in the workbooks): read with the Wiretap workbook reader's own sums (wiretap.structure).

    A jurisdiction is [state, jurisdiction] as in the workbook editions. A label printed on two lines with the second in parentheses
    ("1ST JUDICIAL DISTRICT" / "(JEFFERSON)") is one label; "FEDERAL JURISDICTIONS" and similar headings only divide the table."""
    import wiretap as W

    joined = []
    base = min((r["indent"] or 0) for r in rows) if rows else 0
    rows = list(rows)
    for k, r in enumerate(rows):
        lab = re.sub(r"[*†‡]+$", "", E.clean_label(r["label"])).strip()
        key = W.key_of(lab)
        if r["section"] and key in STRUCTURAL_HEADINGS:
            continue
        nxt = rows[k + 1] if k + 1 < len(rows) else None
        if r["section"] and key not in W.STATES and nxt is not None and not nxt["section"] and nxt["label"].strip().startswith("("):
            # the first line of a label whose second line carries the figures ("19TH JUDICIAL CIRCUIT" / "(SAINT LUCIE) 5 ...")
            rows[k + 1] = {**nxt, "label": f"{lab} {nxt['label'].strip()}"}
            continue
        if r["section"] and key not in W.STATES and joined and not joined[-1]["section"]:
            prev = joined[-1]["label"]
            # the second line of a label printed under the line with its figures: in parentheses ("(JEFFERSON)"), closing a parenthesis
            # the first line opened ("4TH JUDICIAL DISTRICT (EL" / "PASO)"), after a comma ("PENNSYLVANIA," / "EASTERN"), indented under
            # it ("STATE ATTORNEY" / "  GENERAL"), or completing a label the workbook editions print ("STATE ATTORNEY GENERAL")
            if lab.startswith("(") or prev.count("(") > prev.count(")") or prev.endswith((",", "-", "/")) or (r["indent"] or 0) > base + 2 \
                    or G.norm_label(f"{prev} {lab}") in known:
                joined[-1] = {**joined[-1], "label": f"{prev} {lab}"}
                continue
        joined.append({**r, "label": lab})
    keys = [W.key_of(r["label"]) for r in joined]
    state_rows = [r for r, k in zip(joined[2:], keys[2:]) if k in W.STATES and not r["section"]]
    state_heads = [r for r, k in zip(joined, keys) if r["section"]]
    if state_rows and not state_heads:
        data = [r for r in joined if not r["section"]]
        positions = W.clean_positions(data, list(range(len(data[0]["values"] or []))))
        W.structure.dropped = []
        out, why = W.structure(data, positions)
        if out is None:
            return None, why
        return [{**r, "path": path, "entity": "national" if path == ["Total"] else "category",
                 "entity_id": "national" if path == ["Total"] else "/".join(P.slug(x) for x in path), "indent": len(path) - 1} for r, path in out], None
    out, state, federal = [], None, None
    for r in joined:
        lab, key = r["label"], W.key_of(r["label"])
        if r["section"]:
            if key not in W.STATES:
                return None, f"the heading '{lab}' is not a state or territory name"
            state = lab
            continue
        if key == "TOTAL" and not out:
            out.append({**r, "path": ["Total"], "entity": "national", "entity_id": "national", "indent": 0})
        elif key in ("FEDERAL", "FEDERAL TOTAL") and federal is None and state is None:
            federal = lab
            out.append({**r, "path": [lab], "entity": "category", "entity_id": P.slug(lab), "indent": 0})
        elif state is None and federal is not None:
            out.append({**r, "path": [federal, lab], "entity": "category", "entity_id": "/".join(P.slug(x) for x in (federal, lab)), "indent": 1})
        elif state is not None:
            out.append({**r, "path": [state, lab], "entity": "category", "entity_id": "/".join(P.slug(x) for x in (state, lab)), "indent": 1})
        else:
            return None, f"'{lab}' is printed before the Total and FEDERAL rows"
    if not out or out[0]["entity"] != "national" or federal is None:
        return None, "the table does not open with TOTAL and FEDERAL"
    return out, None


def letters_in_order(block, ref):
    """(mapping, "") or (None, reason) for a Wiretap table whose column headings are printed rotated and slanted, letter by letter,
    so the text layer gives single letters stacked over each column ("T", "o", "t", "a", "l"). The columns are taken in the order of
    the workbook edition's columns only when the edition prints exactly as many figure columns and, following the slant of the
    printed headings back to the line they stand on, the letters over each figure column are the letters of that column's workbook
    heading: all of them, plus at most letters of its group heading. The table's own sums are checked afterwards."""
    from collections import Counter

    if block["ncols"] != len(ref["columns"]):
        return None, f"no match of the PDF's column headings to the reference columns ({block['ncols']} figure columns, {len(ref['columns'])} in the workbook)"
    bnds = block["pages"][0].get("bands") or []
    if len(bnds) != block["ncols"]:
        return None, "no match of the PDF's column headings to the reference columns"
    # every heading letter over the figure columns, wherever the slant took it (the row-label heading, left of them, is not one)
    letters = [w for line in block["headers"] for w in line if re.search(r"[A-Za-z]", w["text"]) and "top" in w and w["x0"] >= bnds[0][0]]
    if not letters:
        return None, "no match of the PDF's column headings to the reference columns"
    base = max(w["top"] for w in letters)
    want = []
    for c in ref["columns"]:
        path = c.get("path") or [""]
        want.append((Counter(re.sub(r"[^a-z]", "", path[-1].lower())), Counter(re.sub(r"[^a-z]", "", " ".join(path[:-1]).lower())), path[-1]))
    for slope in [k / 20 for k in range(0, 21)]:
        per_band = [Counter() for _ in range(block["ncols"])]
        for w in letters:
            x = (w["x0"] + w["x1"]) / 2 - slope * (base - w["top"])
            band = next((i for i, (lo, hi) in enumerate(bnds) if lo <= x < hi), None)
            if band is None:
                break
            per_band[band].update(re.sub(r"[^a-z]", "", w["text"].lower()))
        else:
            if all(leaf and not (got - leaf - group) and not (leaf - got) for got, (leaf, group, _) in zip(per_band, want)):
                return list(ref["columns"]), ""
    return None, "no match of the PDF's column headings to the reference columns (the letters over the columns are not those of the workbook headings)"


def wiretap_gates(norm):
    """[] or reasons: in every count column the Total equals FEDERAL plus every local jurisdiction, and FEDERAL equals its districts
    where the edition lists them (a printed dash counts as no orders); a jurisdiction printed twice in one state with different figures
    cannot be told apart."""
    reasons = []
    rows = [r for r in norm["rows"] if not r.get("section")]
    total = rows[0]
    federal = next(r for r in rows if len(r["path"]) == 1 and r["entity"] == "category")
    districts = [r for r in rows if r["path"][0] == federal["path"][0] and len(r["path"]) == 2]
    local = [r for r in rows if len(r["path"]) == 2 and r["path"][0] != federal["path"][0]]
    import wiretap as W

    positions = [i for i in C.additive_columns(norm) if "." not in (norm["columns"][i].get("fmt") or "") and "%" not in (norm["columns"][i].get("fmt") or "")]
    # a column with a text cell keeps its cells as printed. Where its only text cells are the report's codes (NP: no prosecutor's
    # report, NR: not reported, NI: never installed), the Total must equal the figures printed in it, the coded cells adding nothing
    clean = W.clean_positions(rows, positions)
    coded = [i for i in positions if i not in clean and all(f in (None, "blank", "dash", "textnum") or re.fullmatch(r"text:N[PRI]", f or "")
                                                             for f in ((r["flags"] or [None] * (i + 1))[i] for r in rows))]
    positions = clean + coded
    if not positions:
        return ["no count column whose text cells are only the report's codes, to check the table's totals"]
    for i in positions:
        key = norm["columns"][i]["key"]
        t, ok = R._num(total, i) if (total["flags"] or [None] * (i + 1))[i] != "blank" else (0, True)
        parts = sum(R._num(r, i)[0] or 0 for r in [federal] + local)  # a blank cell is no orders, as in the workbook reader
        if not ok or parts is None or t != parts:
            reasons.append(f"Total {key} {t} != FEDERAL plus the local jurisdictions {parts}")
        if districts:
            f, ok = R._num(federal, i)
            d = sum(R._num(r, i)[0] or 0 for r in districts)
            if not ok or d is None or f != d:
                reasons.append(f"FEDERAL {key} {f} != its districts {d}")
    keys = [c["key"] for c in norm["columns"]]
    if keys and keys[0] == "total" and len(keys) > 2:
        # Table 3 (major offenses): every row's Total is the sum of its offense columns
        for r in rows:
            t, ok = R._num(r, 0)
            parts = sum(R._num(r, i)[0] or 0 for i in range(1, len(keys)))  # a dash is no intercepts
            if not ok or t != parts:
                reasons.append(f"{r['label']}: Total {t} != the offense columns {parts}")
                break
    return reasons[:5]


def drop_twice_printed(norm):
    """A jurisdiction printed twice in one state with different figures ("NEW YORK / STATE ATTORNEY GENERAL" in 2012) cannot be told
    apart by its label: both rows are left out of the period (the table's sums were tested with them), as the workbook reader does."""
    seen, twice = {}, set()
    for r in norm["rows"]:
        k = tuple(r["path"])
        if k in seen and seen[k] != r["values"]:
            twice.add(k)
        seen.setdefault(k, r["values"])
    if twice:
        norm["rows"] = [r for r in norm["rows"] if tuple(r["path"]) not in twice]
        norm["ambiguous_rows"] = [{"label": " / ".join(k)} for k in sorted(twice)]
        return [f"Printed twice with different figures and no other label to tell them apart, so left out of this period: {', '.join(' / '.join(k) for k in sorted(twice))}."]
    return []


def heading_text(block, band):
    """The heading words printed in one column band of a block, in reading order (for the note on columns not stored)."""
    return " ".join(w["text"] for line in block["headers"] for w in line if w["band"] == band and not w["mark"]).strip() or f"column {band + 1}"


def merge_blocks(blocks, mappings):
    """Blocks whose columns take the same reference columns are pages of one part (in page order); blocks with other columns are the
    other parts of a wide table, joined side by side by build_norm."""
    order, parts = [], {}
    for b, mapping in zip(blocks, mappings):
        key = tuple(c["key"] if c is not None else None for c in mapping)
        if key not in parts:
            parts[key] = {"rows": [], "notes": [], "mapping": mapping}
            order.append(key)
        parts[key]["rows"].extend(b["rows"])
        parts[key]["notes"].extend(b["notes"])
    for k in order:  # pages of one part in page order (a continued page may print other headings over the label column)
        parts[k]["rows"].sort(key=lambda r: (r.get("page", 0), r.get("top", 0)))
    return [parts[k] for k in order], [parts[k]["mapping"] for k in order]


def circuit_of_rows(rows):
    """{district id: id of the circuit row printed above it}."""
    out, current = {}, None
    for r in rows:
        if r.get("section"):
            continue
        if r["entity"] == "circuit":
            current = r["entity_id"]
        elif r["entity"] == "district" and current:
            out.setdefault(r["entity_id"], current)
    return out


def court_gates(norm, ref, text):
    reasons, warn = [], []
    got = {(r["entity"], r["entity_id"]) for r in norm["rows"] if r["entity"] in ("national", "circuit", "district")}
    want = {(r["entity"], r["entity_id"]) for r in ref["rows"] if not r.get("section") and r["entity"] in ("national", "circuit", "district")}
    no_federal = ref["scope"] == "appeals" and (want - got) == {("circuit", "cafc")} and not (got - want) and \
        re.search(r"does not include data for the u\.?s\.? court of appeals for the federal circuit", re.sub(r"\s+", " ", text), re.I)
    arkansas_split = ref["scope"] == "bankruptcy" and (want - got) == {("district", "arcomb")} and (got - want) == {("district", "ared"), ("district", "arwd")}
    # an edition that prints the circuits as headings without figures ("1ST" over its districts): the circuits are gaps there
    no_circuit_rows = bool(want - got) and all(k == "circuit" for k, _ in want - got) and not (got - want) and not any(k == "circuit" for k, _ in got)
    if no_circuit_rows:
        warn.append("This edition prints the circuits as headings without figures; the circuit rows are not recorded for this period.")
    # an edition that lists fewer or other district courts than the reference (a court with no row that year, the two Arkansas
    # bankruptcy courts printed apart): accepted only for a district or bankruptcy table that prints its Total and its circuits, when
    # every roll-up of the edition holds over the courts it prints (checked below), so no court's figures can be missing from a sum
    other_districts = got != want and not (no_federal or arkansas_split or no_circuit_rows) and ref["scope"] in ("district", "bankruptcy") and \
        all(k == "district" for k, _ in (want - got) | (got - want)) and ("national", "national") in got and any(k == "circuit" for k, _ in got)
    if got != want and not no_federal and not arkansas_split and not no_circuit_rows and not other_districts:
        reasons.append(f"court set differs: missing {sorted(want - got)[:6]} extra {sorted(got - want)[:6]}")
    if no_federal:
        warn.append("The edition's own note says the Federal Circuit is not included in this table.")
    if arkansas_split:
        warn.append("This edition prints the Eastern and Western Arkansas bankruptcy courts as separate courts.")
    court_rows = [r for r in norm["rows"] if r["entity"] in ("national", "circuit", "district")]
    if len(court_rows) != len({(r["entity"], r["entity_id"]) for r in court_rows}):
        dup = [(r["entity"], r["entity_id"]) for r in court_rows]
        if any(dup.count(d) > 1 and len({tuple(x["values"]) for x in court_rows if (x["entity"], x["entity_id"]) == d}) > 1 for d in set(dup)):
            reasons.append("a court is printed twice with different figures")
    blanks = [r["label"] for r in court_rows if "blank" in (r["flags"] or [])]
    if blanks:
        reasons.append(f"court rows with an empty cell: {blanks[:3]}")
    if not reasons:
        fails = C.rollup_failures(norm)
        if fails:
            reasons.append(f"{len(fails)} roll-up identity failures, first {fails[0]}")
    if not reasons and other_districts:
        tests = []
        R.court_tests(norm, C.additive_columns(norm), tests)
        tested = {t["entity"] for t in tests if t["kind"] == "circuit"}
        # the circuit each changed court is printed under: in the reference for a court this edition leaves out, here for one it adds
        home = {**circuit_of_rows(ref["rows"]), **circuit_of_rows(norm["rows"])}
        changed = {i for _, i in (want - got) | (got - want)}
        unchecked = sorted(i for i in changed if home.get(i) not in tested)
        if not any(t["kind"] == "national" for t in tests) or unchecked:
            reasons.append(f"court set differs (missing {sorted(i for _, i in want - got)[:6]}, extra {sorted(i for _, i in got - want)[:6]}) "
                           f"and no circuit roll-up checks {unchecked[:6] or 'the Total'}")
        else:
            names = lambda keys: ", ".join(sorted(i for _, i in keys)) or "none"  # noqa: E731
            warn.append(f"This edition lists other district courts than the spreadsheet editions (not printed: {names(want - got)}; "
                        f"printed in addition: {names(got - want)}); its Total and circuit roll-ups hold over the courts it prints.")
    return reasons, warn


def decimal_counts(norm):
    """[] or a reason: a count column (a whole-number column of the spreadsheet editions) that prints a figure with decimals ("0.5"
    where the row's other columns make it a count of 5) cannot be read as a count, so the edition is not taken."""
    bad = []
    for i in C.additive_columns(norm):
        fmt = norm["columns"][i].get("fmt") or ""
        if "." in fmt or "%" in fmt:
            continue
        for r in norm["rows"]:
            v = (r.get("values") or [None] * (i + 1))[i]
            if isinstance(v, float) and not v.is_integer():
                bad.append(f"{r['label']} {norm['columns'][i]['key']} {v}")
    return [f"a count column prints figures with decimals: {', '.join(bad[:3])}"] if bad else []


def category_gates(norm):
    reasons = []
    blanks = [r["label"] for r in norm["rows"] if "blank" in (r["flags"] or [])]
    if blanks:
        reasons.append(f"rows with an empty cell: {blanks[:3]}")
    hard = [t for t in R.period_tests(norm) if not t["ok"] and t["kind"] in ("parent", "depth0") and t["sum"] > t["printed"]]
    if hard:
        reasons.append(f"{len(hard)} row totals smaller than the rows under them, first {hard[0]['entity']} {hard[0]['col']}: {hard[0]['printed']} vs {hard[0]['sum']}")
    if not [r for r in norm["rows"] if not r.get("section")]:
        reasons.append("no data rows")
    return reasons


def read_entry(key, entry, refs, modes, listing_ids, listing_titles=None):
    """(doc, None) or (None, {"key", "reasons"})."""
    data = F.read_stored(F.ROOT / entry["path"])
    try:
        pages = G.read_pdf(data)
    except Exception as error:  # a damaged PDF is reported, not repaired
        return None, {"key": key, "reasons": [f"the PDF could not be read: {str(error)[:100]}"]}
    blocks = G.blocks_of(pages)
    if not blocks:
        return None, {"key": key, "reasons": ["no table rows found in the text layer"]}
    problems = [p for b in blocks for p in b["problems"]]
    if problems:
        return None, {"key": key, "reasons": problems[:2]}
    title_reasons, warn, phrase = check_title(blocks[0], entry, listing_ids, listing_titles)
    if title_reasons:
        return None, {"key": key, "reasons": title_reasons}
    sort_dropped = any([drop_sort_code(b) for b in blocks]) or any(p.get("sort_codes") for p in pages)
    cands = candidates(refs, entry)
    if not cands:
        return None, {"key": key, "reasons": ["no workbook edition of this table to name the columns"]}
    known = known_labels(refs.get(N.table_slug(entry["table"]), []))
    text = " ".join(" ".join(b["notes"]) for b in blocks)
    tried = []
    for ref in cands:
        mappings, why = [], ""
        for b in blocks:
            mapping, why = A.align(b, ref, entry["period_end"])
            if mapping is None and entry["pub"] == "WIRETAP":
                mapping, why2 = letters_in_order(b, ref)
                why = why2 if mapping is None else ""
            if mapping is None:
                break
            mappings.append(mapping)
        if why:
            tried.append({"reference": f"{ref['pub']} {ref['period_end']}", "reasons": [why]})
            continue
        merged, mmaps = merge_blocks(blocks, mappings)
        dropped_cols = [heading_text(b, i) for b, mp in zip(blocks, mappings) for i, c in enumerate(mp) if c is None]
        norm, reasons = build_norm(entry, ref, merged, mmaps, modes.get(N.table_slug(entry["table"])), known)
        if norm is None:
            tried.append({"reference": f"{ref['pub']} {ref['period_end']}", "reasons": reasons})
            continue
        if norm["scope"] in COURT_SCOPES:
            reasons, w2 = court_gates(norm, ref, text)
        elif entry["pub"] == "WIRETAP":
            reasons = wiretap_gates(norm)
            w2 = [] if reasons else drop_twice_printed(norm)
        else:
            reasons, w2 = category_gates(norm), []
        reasons = decimal_counts(norm) + reasons
        if reasons:
            tried.append({"reference": f"{ref['pub']} {ref['period_end']}", "reasons": reasons})
            continue
        norm["period_phrase"] = phrase
        norm["reference"] = {"pub": ref["pub"], "period_end": ref["period_end"]}
        norm["warnings"] = warn + w2 + ([f"{len(set(dropped_cols))} columns of this edition have no counterpart in the spreadsheet editions and are not stored: " + "; ".join(sorted(set(dropped_cols)))[:300]] if dropped_cols else []) + (["The last column of the PDF prints the publisher's sort-order codes; it is not a statistic and is left out."] if sort_dropped else []) + [
            f"Rows were read from the positions of the words in the PDF text layer; column names come from the {ref['pub']} spreadsheet edition of "
            f"{ref['period_end']}, matched by the headings this edition prints." + (" The table is printed in parts with different columns; the parts are joined row by row." if len(merged) > 1 else "")]
        doc = {"parser_version": GRID_VERSION,
               "source": {"pub": entry["pub"], "table": entry["table"], "period_end": entry["period_end"], "page": entry["page"], "url": entry["url"],
                          "sha256": entry["sha256"], "bytes": entry["bytes"], "format": "pdf"},
               "sheets": [norm], "rejected_sheets": [], "reader": "pdf_grid"}
        return doc, None
    return None, {"key": key, "tried": tried}


def main():
    want = {t.strip().upper() for t in sys.argv[sys.argv.index("--tables") + 1].split(",")} if "--tables" in sys.argv else set()
    pubs = set(sys.argv[sys.argv.index("--pubs") + 1].split(",")) if "--pubs" in sys.argv else set()
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    force = "--force" in sys.argv
    index = json.loads((F.ACQ / "files_index.json").read_text())
    evals = BUILD / "hierarchy_evals.json"
    modes = json.loads(evals.read_text()).get("modes", {}) if evals.exists() else {}
    listing_ids = defaultdict(set)
    listing_titles = defaultdict(dict)
    for e in index.values():
        listing_ids[(e["pub"], e["period_end"])].add(e["table"])
        listing_titles[(e["pub"], e["period_end"])][e["table"]] = e.get("title") or ""
    refs = load_references()
    report = {"accepted": 0, "rejected": [], "kept_other_reader": 0, "by_table": {}}
    done, seen_keys = 0, []
    for key, entry in sorted(index.items()):
        if entry.get("format") != "pdf" or entry.get("status") != 200 or entry["pub"] in ("JFF", "FCMS", "CJRA"):
            continue
        if entry["pub"] == "WIRETAP" and entry["table"] not in WIRE_TABLES:
            continue  # statutes (Table 1), multi-year summaries (7-10) and order-by-order listings (A-1, B-1) are not jurisdiction tables
        if want and entry["table"].upper() not in want:
            continue
        if pubs and entry["pub"] not in pubs:
            continue
        target = PARSED / entry["pub"] / entry["period_end"] / (N.table_slug(entry["table"]) + ".json.gz")
        seen_keys.append(key)
        if target.exists():
            have = json.loads(gzip.decompress(target.read_bytes()))
            if have.get("reader") != "pdf_grid":
                report["kept_other_reader"] += 1  # read by the row-count reader or a workbook: never replaced here
                continue
            if not force and have.get("parser_version") == GRID_VERSION and have["source"]["sha256"] == entry["sha256"]:
                report["accepted"] += 1
                report["by_table"][entry["table"]] = report["by_table"].get(entry["table"], 0) + 1
                continue
        doc, rejected = read_entry(key, entry, refs, modes, listing_ids[(entry["pub"], entry["period_end"])] - {entry["table"]},
                                   listing_titles[(entry["pub"], entry["period_end"])])
        done += 1
        if doc is None:
            report["rejected"].append(rejected)
            if target.exists():
                have = json.loads(gzip.decompress(target.read_bytes()))
                if have.get("reader") == "pdf_grid":
                    target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(gzip.compress(json.dumps(doc, sort_keys=True).encode(), compresslevel=6, mtime=0))
            report["accepted"] += 1
            report["by_table"][entry["table"]] = report["by_table"].get(entry["table"], 0) + 1
        if done % 100 == 0:
            print(f"  {done} read; accepted {report['accepted']}", flush=True)
        if limit and done >= limit:
            break
    path = BUILD / "pdf_grid_report.json"
    if (want or pubs) and path.exists():
        # a run over some tables or publications keeps the other entries of the last full run's report; the accepted counts are
        # those of the parsed files this reader wrote
        old = json.loads(path.read_text())
        mine = {r["key"] for r in report["rejected"]} | set(seen_keys)
        report["rejected"] = [r for r in old.get("rejected", []) if r["key"] not in mine] + report["rejected"]
        by_table = defaultdict(int)
        for f in PARSED.glob("*/*/*.json.gz"):
            d = json.loads(gzip.decompress(f.read_bytes()))
            if d.get("reader") == "pdf_grid":
                by_table[d["source"]["table"]] += 1
        report["accepted"], report["by_table"] = sum(by_table.values()), dict(by_table)
        report["kept_other_reader"] = old.get("kept_other_reader", report["kept_other_reader"])
    path.write_text(json.dumps(report, indent=1))
    print(json.dumps({"accepted": report["accepted"], "rejected": len(report["rejected"]), "kept_other_reader": report["kept_other_reader"]}))


if __name__ == "__main__":
    main()
