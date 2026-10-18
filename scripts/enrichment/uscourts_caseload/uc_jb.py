"""Parsers for the Judicial Business (12-month periods ending September 30) tables used by stream uscourts_caseload.

Court-row tables (one row per circuit/district, in published order):
  F-2   bankruptcy cases filed by chapter, business/nonbusiness            FY2005-FY2025
  C-4A  civil cases terminated by district and action taken (trial rate)    FY2005-FY2025
  T-1   civil and criminal trials completed by district                     FY2014-FY2025
  S-19  actions transferred by the JPML into/out of each district, pending  FY2005-FY2025
Nature-of-suit table:
  C-4   civil cases terminated by nature of suit and action taken (national) FY2005-FY2025
National summary:
  S-20  cumulative summary of multidistrict litigation                       FY2005-FY2025

Every parser returns plain dicts and a list of check results; nothing is imputed. Field lists are bound to the
column headings detected in each edition (format signatures below); a row whose value count does not match its
edition's layout is reported and not used.
"""
import re
from pathlib import Path

from uc_common import (DASH, SUPERSCRIPTS, RepairedInt, split_tail, court_row, circuit_id, district_id, grid_text, norm_court_label, norm_text, num,
                       pdf_lines, split_footnote, split_tail, to_value, xlsx_raw_grids, zero_if_dash)

F2_A = ["total", "ch7", "ch11", "ch12", "ch13", "bus_total", "bus_ch7", "bus_ch11", "bus_ch12", "bus_ch13", "nonbus_total", "nonbus_ch7", "nonbus_ch11", "nonbus_ch13"]
F2_B = ["total", "ch7", "ch11", "ch13", "other", "bus_total", "bus_ch7", "bus_ch11", "bus_ch13", "bus_other", "nonbus_total", "nonbus_ch7", "nonbus_ch11", "nonbus_ch13"]
F2_B2 = ["total_check", "ch9", "ch12", "ch15", "all_other"]
C4A = ["total", "no_action", "court_total", "before_pretrial", "during_after_pretrial", "trial_total", "trial_nonjury", "trial_jury", "pct_trial"]
T1 = ["all_trials", "civil_total", "civil_nonjury", "civil_jury", "criminal_total", "criminal_nonjury", "criminal_jury"]
S19_B = ["in_12m", "out_12m", "in_cum", "out_cum", "pending"]
S19_A = ["in_12m", "out_12m", "net_12m", "filed_transferee_12m", "closed_remanded_12m", "in_cum", "out_cum", "net_cum", "filed_transferee_cum", "closed_remanded_cum", "pending"]
C4 = ["total", "no_action", "court_total", "before_pretrial", "during_after_pretrial", "trial_total", "trial_nonjury", "trial_jury", "pct_trial"]


def _check(checks, name, ok, detail=""):
    checks.append({"check": name, "ok": bool(ok), "detail": detail})
    return ok


# ---------------------------------------------------------------- court-row tables

def _xlsx_court_rows(grid):
    """(label, [values]) for rows whose first cell is a circuit/district/total label; values are every non-blank
    cell after the label (spacer columns are blank in these workbooks). Reading stops at the table's 'Note' block."""
    rows = []
    for row in grid:
        if not row:
            continue
        label = norm_text(row[0])
        if not label:
            continue
        if re.match(r"^note\b", label, re.I):
            break
        text, _ = split_footnote(label)
        lab = norm_court_label(text)
        if lab != "Total" and not circuit_id(lab) and not district_id(lab):
            continue
        if not re.fullmatch(r"Total|DC|\d{1,2}(st|nd|rd|th)|[A-Z]{2},[A-Z]|[A-Z]{2,3}", lab):
            continue
        values = [to_value(c) for c in row[1:] if c is not None and norm_text(c) != ""]
        rows.append((lab, values))
    return rows


def _pdf_court_rows(path, extras=(), repair=False, unresolved=None):
    """(label, values) for every court row of a PDF table. `unresolved` (a list), when given, collects lines that look like
    a data row (a short non-numeric head and at least three value tokens) but whose label is not a published court label."""
    rows = []
    for page, line in pdf_lines(path):
        if re.match(r"^\d{0,3}\s*NOTE\b", line, re.I):
            break
        parsed = court_row(line, extras, repair)
        if parsed:
            rows.append((parsed[0], parsed[1]))
        elif unresolved is not None:
            label, tail = split_tail(line)
            if tail and len(tail) >= 3 and 0 < len(label) <= 7 and not re.search(r"\d{4}|months|ending", label, re.I):
                unresolved.append(line)
    return rows


PAIR = re.compile(r"([A-Z]{2}, ?[A-Z]|NMI|GUAM|[A-Z]{2})\s+(\d[\d,]*)")


def f2_note_chapters(path):
    """Chapter 9 / chapter 15 cases by district listed in the F-2 NOTE block ('These figures include the following
    cases not reflected elsewhere'). Returns ({"ch9": {label: n}, "ch15": {label: n}}, found_flag).
    PDF: each (district, count) pair is assigned to the column whose 'Chapter N' heading starts nearest to its left
    edge. xlsx (FY2017): columns 0-2 are chapter 9 (district, count, sort order) and 3-5 chapter 15."""
    path = Path(path)
    out = {}
    if path.suffix == ".xlsx":
        grid = xlsx_raw_grids(path)[0][1]
        start = next((i for i, row in enumerate(grid) if row and re.match(r"^note\b", norm_text(row[0]), re.I)), None)
        if start is None:
            return out, False
        heads = []
        for i in range(start, min(start + 4, len(grid))):
            cells = [norm_text(c) for c in grid[i]]
            heads = [(j, re.search(r"Chapter\s*(\d+)", c).group(1)) for j, c in enumerate(cells) if re.search(r"Chapter\s*(\d+)", c)]
            if heads:
                start = i
                break
        for row in grid[start + 1:]:
            cells = [norm_text(c) for c in row]
            if not any(cells):
                continue
            if cells[0].startswith("¹") or re.match(r"^\d\s", cells[0] or ""):
                break
            for k, (j, ch) in enumerate(heads):
                if j < len(cells) and cells[j] and j + 1 < len(cells):
                    lab, n = norm_court_label(cells[j]), to_value(cells[j + 1])
                    if district_id(lab) and num(n) is not None:
                        out.setdefault(f"ch{ch}", {})[lab] = out.get(f"ch{ch}", {}).get(lab, 0) + n
        return out, True
    import pdfplumber

    from uc_common import pdf_words_lines

    text_lines = [line for _, line in pdf_lines(path, method="text")]
    start = next((i for i, line in enumerate(text_lines) if re.search(r"not reflected elsewhere", line, re.I)), None)
    if start is None:
        return out, False
    heads_line = text_lines[start + 1] if start + 1 < len(text_lines) else ""
    triplet = re.compile(r"([A-Z]{2}, ?[A-Z]|NMI|GUAM|[A-Z]{2})\.?\s*-\s*(CHAPTER|SECTION)\s+(\d+)\s*=\s*([\d ]+?)(?=\s+[A-Z]|\s*$)", re.I)
    if triplet.search(heads_line):
        # FY2005-FY2006: 'DC - SECTION 304 = 001 ME - SECTION 304 = 002 ...'
        for line in text_lines[start + 1:]:
            if not triplet.search(line):
                break
            for pm in triplet.finditer(line):
                key = ("ch" if pm.group(2).lower() == "chapter" else "s") + pm.group(3)
                lab, n = norm_court_label(pm.group(1)), int(pm.group(4).replace(" ", ""))
                out.setdefault(key, {})[lab] = out.get(key, {}).get(lab, 0) + n
        return out, True
    # FY2007-FY2016 layouts, read with word positions:
    #   'CHAPTER 9 AR,E = 001 ...' / 'Chapter 9 PA,M 1 ...' sections (a heading owns the pairs to its right on its line),
    #   side-by-side blocks 'CHAPTER 9 ... CHAPTER 15 ...', and two columns under 'Chapter 9  Chapter 15' headings.
    # A line without a heading assigns each pair to the nearest heading column starting at or left of the pair.
    pair_re = re.compile(r"(?<![A-Za-z,.])([A-Z]{2}, ?[A-Z]|NMI|GUAM|[A-Z]{2})\s*(?:=\s*([\d ]*\d)|(\d[\d,]*))(?=\s+[A-Z]|\s*$)")
    head_re = re.compile(r"(CHAPTER|Chapter|SECTION|Section)\s+(\d+)\b")
    found = False
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            lines = pdf_words_lines(page)
            idx = next((i for i, (_, ws) in enumerate(lines) if re.search(r"not reflected elsewhere", " ".join(t for _, t in ws), re.I)), None)
            if idx is None:
                continue
            found = True
            columns = []  # [(x, key)]
            for _, ws in lines[idx + 1:]:
                text = " ".join(t for _, t in ws)
                if re.match(r"^(¹|1\s+SECTION|1\s+Section|Page \d|CHAPTER 15 WAS ADDED)", text) or "defines consumer" in text.lower():
                    break
                pos, cursor = [], 0
                for x, t in ws:
                    at = text.find(t, cursor)
                    pos.append((at, x))
                    cursor = at + len(t)
                x_at = lambda offset: next((x for at, x in pos if at == offset), None)  # noqa: E731
                heads = [(m.start(), x_at(m.start()), ("ch" if m.group(1).lower() == "chapter" else "s") + m.group(2)) for m in head_re.finditer(text)]
                for _, hx, key in heads:
                    columns = [c for c in columns if abs(c[0] - hx) > 20] + [(hx, key)]
                    columns.sort()
                for m in pair_re.finditer(text):
                    if any(m.start() <= h[0] < m.end() for h in heads):
                        continue
                    left_heads = [h for h in heads if h[0] < m.start()]
                    if left_heads:
                        key = left_heads[-1][2]
                    else:
                        x = x_at(m.start())
                        cands = [c for c in columns if x is not None and c[0] <= x + 6]
                        if not cands:
                            continue
                        key = cands[-1][1]
                    lab = norm_court_label(m.group(1))
                    n = int(m.group(2).replace(" ", "")) if m.group(2) else to_value(m.group(3))
                    out.setdefault(key, {})[lab] = out.get(key, {}).get(lab, 0) + n
    return out, found


# Table S-19 misprints a few district labels (PDF editions). A printed label is replaced only when it appears inside the
# circuit named here, and the table's own printed circuit totals then have to reconcile (see the reconciliation check):
#   'AR' printed in the Ninth Circuit block is Arizona (Arkansas has AR,E and AR,W, in the Eighth Circuit);
#   'AK,E' / 'AK,W' printed in the Eighth Circuit block are AR,E / AR,W (Alaska is one district).
S19_LABEL_FIXES = {"AR": ("ca9", "AZ"), "AK,E": ("ca8", "AR,E"), "AK,W": ("ca8", "AR,W")}


def classify(rows, fixes=None):
    """Attach kind (total/circuit/district), court ids and the circuit each district is printed under.
    A single 'DC' row stands for both the D.C. Circuit and the District of Columbia (the tables print it once);
    when 'DC' is printed twice in a row the first is the circuit and the second the district.
    `fixes` ({printed label: (circuit, correct label)}) applies documented misprint corrections (printed label kept in
    entry['printed_label']); a printed label with a fix outside its circuit stays unresolved (kind 'unresolved')."""
    out, current = [], None
    labels = [r[0] for r in rows]
    dc_twice = any(labels[i] == "DC" and labels[i + 1] == "DC" for i in range(len(labels) - 1))
    seen_dc = 0
    for label, values in rows:
        entry = {"label": label, "values": values}
        if label == "Total":
            entry.update(kind="total")
        elif label == "DC":
            seen_dc += 1
            if dc_twice and seen_dc == 1:
                entry.update(kind="circuit", circuit="cadc")
                current = "cadc"
            else:
                entry.update(kind="district" if not dc_twice else "district", court_id="dcd", circuit="cadc", dc_single=not dc_twice)
                current = "cadc"
        elif circuit_id(label):
            current = circuit_id(label)
            entry.update(kind="circuit", circuit=current)
        elif fixes and label in fixes:
            circuit, correct = fixes[label]
            if current == circuit:
                entry.update(kind="district", label=correct, printed_label=label, court_id=district_id(correct), circuit=current)
            else:
                entry.update(kind="unresolved", circuit=current)
        else:
            entry.update(kind="district", court_id=district_id(label), circuit=current)
        out.append(entry)
    return [e for e in out if e["kind"] != "unresolved"]


def additive_checks(table, year, entries, fields, checks, additive, expected_districts=None):
    """Districts sum to their circuit; circuits (DC once) sum to the national total, for additive fields.

    Printed sums are the validation: a group (a circuit's districts for one field, or the circuits for one field) that
    does not sum to its printed total is returned in `flags` as {(label, field)} so the build can mark those cells
    'printed, does not reconcile'. A cell repaired from a period-for-comma misprint ('14.110') is kept only when the group
    it belongs to reconciles; otherwise it is withheld (set to None) and reported. Returns (failures, flags, repaired)."""
    by_kind = {"total": [e for e in entries if e["kind"] == "total"]}
    total = by_kind["total"][0] if by_kind["total"] else None
    circuits = [e for e in entries if e["kind"] == "circuit"]
    single_dc = [e for e in entries if e.get("dc_single")]
    failures, flags, repaired = [], set(), []

    def has_repair(cells):
        return [c for c in cells if isinstance(c, RepairedInt)]

    for f in additive:
        i = fields.index(f)
        groups = []
        if total is not None:
            groups.append(("national", total, circuits + single_dc))
        for c in circuits:
            members = [e for e in entries if e["kind"] == "district" and e.get("circuit") == c["circuit"] and not e.get("dc_single")]
            if members:
                groups.append((c["label"], c, members))
        for name, head, members in groups:
            cells = [m["values"][i] for m in members]
            parts = [zero_if_dash(v) for v in cells]
            target = zero_if_dash(head["values"][i])
            if any(p is None for p in parts) or target is None:
                continue
            reps = has_repair(cells + [head["values"][i]])
            if sum(parts) == target:
                for r in reps:
                    repaired.append(f"{name} {f}: {r.raw} read as {int(r):,} (group sums to the printed total)")
                continue
            failures.append(f"{name} {f}: parts {sum(parts)} vs printed {head['values'][i]}")
            for m in members + [head]:
                if isinstance(m["values"][i], RepairedInt):
                    repaired.append(f"{m['label']} {f}: {m['values'][i].raw} NOT confirmed, withheld")
                    m["values"][i] = None
            flags.add((id(head), f))
            for m in members:
                flags.add((id(m), f))
    _check(checks, f"{table} {year} districts->circuits->total", not failures, "; ".join(failures[:6]))
    return failures, flags, repaired


def _fit(entries, fields, table, year, checks, drop_trailing=0):
    """Bind values to fields. A row with exactly one value too many whose first value is a single digit carries a
    footnote marker after its label (e.g. 'IL,E 1'); that digit is dropped and recorded in entry['footnote']."""
    bad = []
    for e in entries:
        vals = e["values"]
        if drop_trailing and len(vals) == len(fields) + drop_trailing:
            vals = vals[:len(fields)]
        if len(vals) == len(fields) + 1 and isinstance(vals[0], int) and 0 < vals[0] < 10:
            e["footnote"] = vals[0]
            vals = vals[1:]
        if len(vals) != len(fields):
            bad.append(f"{e['label']}:{len(vals)}")
            e["values"] = None
        else:
            e["values"] = vals
    _check(checks, f"{table} {year} row widths ({len(fields)} values)", not bad, ", ".join(bad[:8]))
    return [e for e in entries if e["values"] is not None]


def parse_f2(path, year):
    """Return (entries, fields_by_entry, checks). Format A (FY2005-FY2017): chapters 7/11/12/13 with business and
    nonbusiness splits; format B (FY2018+): chapters 7/11/13 + 'Other' and a second sheet with chapters 9/12/15."""
    checks = []
    path = Path(path)
    second = {}
    if path.suffix == ".xlsx":
        grids = xlsx_raw_grids(path)
        head = grid_text(grids[0][1], 6)
        fmt = "B" if re.search(r"Other\s*/?\s*Chapters", head.replace("/", " ")) else "A"
        rows = _xlsx_court_rows(grids[0][1])
        entries = classify(rows)
        fields = F2_B if fmt == "B" else F2_A
        entries = _fit(entries, fields, "F-2", year, checks, drop_trailing=1 if fmt == "A" else 0)
        if fmt == "B" and len(grids) > 1:
            sub = classify(_xlsx_court_rows(grids[1][1]))
            sub = _fit(sub, F2_B2, "F-2 (9,12,15)", year, checks)
            second = {(e["label"], e.get("court_id"), e["kind"]): dict(zip(F2_B2, e["values"])) for e in sub}
    else:
        fmt, fields = "A", F2_A
        entries = _fit(classify(_pdf_court_rows(path, extras=("AR",), repair=True)), fields, "F-2", year, checks)
    note, note_found = ({}, False)
    if fmt == "A":
        note, note_found = f2_note_chapters(path)
        _check(checks, f"F-2 {year} chapter 9/15 note located", note_found, ",".join(sorted(note)))
    out = []
    for e in entries:
        rec = dict(zip(fields, e["values"]))
        extra = second.get((e["label"], e.get("court_id"), e["kind"]))
        if extra:
            if extra["total_check"] != rec["total"]:
                _check(checks, f"F-2 {year} {e['label']} sheet totals agree", False, f"{extra['total_check']} vs {rec['total']}")
            rec.update(ch9=extra["ch9"], ch12=extra["ch12"], ch15=extra["ch15"])
        out.append({**{k: e.get(k) for k in ("label", "kind", "court_id", "circuit")}, "fields": rec, "format": fmt})
    if fmt == "A" and note_found:
        # The note lists every chapter 9 and 15 case 'not reflected elsewhere'; a district it does not list had none.
        # Circuit and national values are the sums of their districts (DC counted once).
        listed = {lab for ch in note.values() for lab in ch}
        district_labels = {r["label"] for r in out if r["kind"] == "district"}
        unknown = sorted(listed - district_labels)
        _check(checks, f"F-2 {year} note districts exist in table", not unknown, ",".join(unknown))
        sections = sorted(note)  # ch9, ch15 and, in FY2005-FY2006, s304 (section 304 cases before chapter 15)
        for r in out:
            if r["kind"] == "district":
                for s in sections:
                    r["fields"][s] = note[s].get(r["label"], 0)
        bad, withheld = [], set()
        for r in out:
            if r["kind"] != "district":
                continue
            f = {k: zero_if_dash(v) for k, v in r["fields"].items()}
            if None in (f["total"], f["ch7"], f["ch11"], f["ch12"], f["ch13"]):
                continue
            residual = f["total"] - f["ch7"] - f["ch11"] - f["ch12"] - f["ch13"]
            noted = sum(f.get(s, 0) for s in sections)
            if residual != noted:
                bad.append(f"{r['label']}: total-(7+11+12+13)={residual} vs note={noted}")
                withheld.add(r["label"])
                for s in sections:
                    r["fields"][s] = None
        for r in out:
            if r["kind"] in ("circuit", "total"):
                members = [d for d in out if d["kind"] == "district" and (r["kind"] == "total" or d.get("circuit") == r.get("circuit"))]
                for s in sections:
                    vals = [d["fields"].get(s) for d in members]
                    r["fields"][s] = sum(vals) if all(v is not None for v in vals) else None
        _check(checks, f"F-2 {year} total = chapters 7+11+12+13 + chapters listed in the note (per district)", not bad,
               ("withheld 9/15 split for " + ", ".join(sorted(withheld)) + ": " + "; ".join(bad[:6])) if bad else "")
    if fmt == "A":
        for r in out:
            f = {k: zero_if_dash(v) for k, v in r["fields"].items()}
            if None not in (f["total"], f["ch7"], f["ch11"], f["ch12"], f["ch13"]):
                r["fields"]["other_derived"] = f["total"] - f["ch7"] - f["ch11"] - f["ch12"] - f["ch13"]
    # arithmetic inside each row
    bad = []
    for r in out:
        f = {k: zero_if_dash(v) for k, v in r["fields"].items()}
        if None in (f.get("total"), f.get("bus_total"), f.get("nonbus_total")):
            bad.append(r["label"] + ":missing")
            continue
        if f["bus_total"] + f["nonbus_total"] != f["total"]:
            bad.append(f"{r['label']}: bus+nonbus {f['bus_total'] + f['nonbus_total']} != {f['total']}")
        for ch in ("ch7", "ch11", "ch13"):
            if f.get(f"bus_{ch}") is not None and f.get(f"nonbus_{ch}") is not None and f[f"bus_{ch}"] + f[f"nonbus_{ch}"] != f[ch]:
                bad.append(f"{r['label']}: {ch} split")
        if fmt == "B":
            if f["ch7"] + f["ch11"] + f["ch13"] + f["other"] != f["total"]:
                bad.append(f"{r['label']}: 7+11+13+other != total")
            if None not in (f.get("ch9"), f.get("ch12"), f.get("ch15")) and f["ch9"] + f["ch12"] + f["ch15"] != f["other"]:
                bad.append(f"{r['label']}: 9+12+15 != other")
        else:
            if f["ch7"] + f["ch11"] + f["ch12"] + f["ch13"] > f["total"]:
                bad.append(f"{r['label']}: chapters exceed total")
            if f["bus_ch12"] != f["ch12"]:
                bad.append(f"{r['label']}: ch12 is business-only in this layout but differs")
    _check(checks, f"F-2 {year} row arithmetic", not bad, "; ".join(bad[:6]))
    fields_all = list(dict.fromkeys([k for r in out for k in r["fields"]]))
    apply_reconciliation(out, fields_all, "F-2", year, checks, [k for k in fields_all if k not in ("total_check",)])
    return out, checks


def apply_reconciliation(out, fields, table, year, checks, additive):
    """Run additive_checks on parsed court rows, write withheld cells back and mark rows with the fields whose group does
    not reconcile with its printed total ('unreconciled'). Returns the list of repair notes."""
    entries = [{"label": r["label"], "kind": r["kind"], "circuit": r.get("circuit"), "dc_single": r["label"] == "DC" and r["kind"] == "district",
                "values": [r["fields"].get(k) for k in fields]} for r in out]
    failures, flags, repaired = additive_checks(table, year, entries, fields, checks, additive)
    for r, e in zip(out, entries):
        r["fields"] = {**r["fields"], **dict(zip(fields, e["values"]))}
        r["unreconciled"] = sorted(f for (ident, f) in flags if ident == id(e))
    if repaired:
        _check(checks, f"{table} {year} period-for-comma misprints confirmed by reconciliation", all("NOT confirmed" not in n for n in repaired), "; ".join(repaired[:8]))
    return repaired


def parse_simple_court_table(path, year, table):
    """C-4A, T-1, S-19 (court rows)."""
    checks = []
    path = Path(path)
    unresolved = []
    if path.suffix == ".xlsx":
        rows = _xlsx_court_rows(xlsx_raw_grids(path)[0][1])
    else:
        rows = _pdf_court_rows(path, extras=("AR", "IL,E", "AK,E", "AK,W") if table == "S-19" else (), repair=table != "C-4A", unresolved=unresolved)
    entries = classify(rows, S19_LABEL_FIXES if table == "S-19" else None)
    fixed = [f"{e['printed_label']} -> {e['label']}" for e in entries if e.get("printed_label")]
    if fixed:
        _check(checks, f"{table} {year} misprinted district labels corrected by circuit block", True, "; ".join(fixed))
    if table == "C-4A":
        fields = C4A
    elif table == "T-1":
        fields = T1
    else:
        widths = sorted({len(e["values"]) for e in entries if e["kind"] == "total"})
        fields = S19_A if widths and widths[0] == 11 else S19_B
    _check(checks, f"{table} {year} every data-looking line resolved to a published court label", not unresolved, "; ".join(unresolved[:6]))
    entries = _fit(entries, fields, table, year, checks)
    out = [{**{k: e.get(k) for k in ("label", "kind", "court_id", "circuit", "printed_label")}, "fields": dict(zip(fields, e["values"]))} for e in entries]
    bad = []
    for r in out:
        f = {k: zero_if_dash(v) for k, v in r["fields"].items()}
        if table == "C-4A":
            if None in f.values():
                continue
            if f["no_action"] + f["court_total"] != f["total"] or f["before_pretrial"] + f["during_after_pretrial"] + f["trial_total"] != f["court_total"] or f["trial_nonjury"] + f["trial_jury"] != f["trial_total"]:
                bad.append(r["label"])
            pub = num(r["fields"]["pct_trial"])
            if f["total"]:
                computed = 100 * f["trial_total"] / f["total"]
                if pub is not None and abs(round(pub, 1) - round(computed, 1)) > 0.051:
                    bad.append(f"{r['label']} pct {pub} vs {computed:.2f}")
        elif table == "T-1":
            if None in f.values():
                continue
            if f["civil_total"] + f["criminal_total"] != f["all_trials"] or f["civil_nonjury"] + f["civil_jury"] != f["civil_total"] or f["criminal_nonjury"] + f["criminal_jury"] != f["criminal_total"]:
                bad.append(r["label"])
    _check(checks, f"{table} {year} row arithmetic", not bad, "; ".join(bad[:6]))
    additive = [k for k in fields if k not in ("pct_trial", "net_12m", "net_cum")]
    apply_reconciliation(out, fields, table, year, checks, additive)
    return out, checks


# ---------------------------------------------------------------- C-4 (nature of suit)

JURISDICTIONS = {"united states cases": "us", "u.s. cases": "us", "federal question": "federal_question", "diversity of citizenship": "diversity",
                 "local jurisdiction": "local"}
CATEGORY_HEADERS = {"contract actions", "tort actions", "actions under statutes", "civil rights", "prisoner petitions", "social security laws",
                    "immigration", "real property actions", "property rights"}


def norm_nos_label(label):
    """Deterministic label normalisation for matching across editions: footnote marks (superscripts, a leading or trailing
    footnote digit) removed, dash variants and double hyphens unified to '--', trailing period dropped, '(Continued)'
    dropped, whitespace collapsed, case kept."""
    text, _ = split_footnote(label)
    text = text.replace("—", "--").replace("–", "--").replace("−", "--")
    text = re.sub(r"\s*-{1,2}\s*", "--", text) if "--" in text or "—" in str(label) or "–" in str(label) else text
    text = re.sub(r"\s*\(Continued\)\s*$", "", text, flags=re.I)
    text = re.sub(r"\.$", "", text).strip()
    text = re.sub(r"^\d{1,2}\s+(?=[A-Za-z])", "", text)  # leading footnote digit ('5 Labor Management Relations Act')
    text = re.sub(r"(?<=[A-Za-z\)])\s?\d{1,2}$", "", text)  # trailing footnote digit ('Other Personal Injury 1', 'FMLA1')
    return re.sub(r"\s+", " ", text).strip()


# Printed variants of one nature-of-suit row, joined only where the identity is certain: a typo, a spelled-out
# abbreviation and a different abbreviation of the same words. Every other label stays its own series.
NOS_ALIASES = {
    "negotiable instraments": "negotiable instruments",
    "cable/sat. tv": "cable/satellite tv",
    "fmla": "family and medical leave act",
}


def nos_key(label):
    """Series key for a nature-of-suit label: normalised, case-folded, with the explicit NOS_ALIASES applied."""
    key = norm_nos_label(label).casefold()
    return NOS_ALIASES.get(key, key)


def parse_c4(path, year):
    """Rows: {jurisdiction, category, label, occurrence, fields}. Section totals (Total Cases, jurisdiction rows) are
    returned with kind 'total'/'jurisdiction'. Labels that wrap over two PDF lines are joined."""
    checks = []
    path = Path(path)
    raw = []  # (label, values or None)
    if path.suffix == ".xlsx":
        grid = xlsx_raw_grids(path)[0][1]
        started = False
        for row in grid:
            label = norm_text(row[0] if row else "")
            if not started:
                if label.lower().startswith("total cases"):
                    started = True
                else:
                    continue
            if not label or label.upper().startswith("NOTE") or label.startswith("¹") or re.match(r"^\d\s", label):
                if label.upper().startswith("NOTE"):
                    break
                continue
            cells = [c for c in row[1:] if c is not None and norm_text(c) != ""]
            values = [to_value(c) for c in cells]
            raw.append((label, values if values else None))
    else:
        pending = ""
        started = False
        for page, line in pdf_lines(path, method="text"):
            if not started:
                if line.lower().startswith("total cases"):
                    started = True
                else:
                    continue
            if re.match(r"^(Page \d|Table C-4|U\.S\. District Courts|During the|Court Action|During or After|No |Nature of Suit|NOTE|\d{1,3}$)", line):
                if line.startswith("NOTE"):
                    break
                continue
            line = re.sub(r"^\d{1,2}\s+(?=[A-Za-z])", "", line)  # footnote digit printed before a label
            if re.search(r"\(Continued\)\s*$", line):
                continue  # a heading repeated at the top of the next page
            label, values = split_tail(line, 9)
            if values is None:
                _, tail = split_tail(line)
                if tail and len(tail) == 1 and label and label.lower().startswith("social security"):
                    raw.append((label, None))
                    continue
                if not pending and norm_nos_label(line).lower() in JURISDICTIONS:
                    continue  # a jurisdiction heading repeated at the top of the next page (the data row carries the values)
                if not pending and norm_nos_label(line).lower() in CATEGORY_HEADERS:
                    raw.append((line, None))  # a section heading, not the first line of a wrapped label
                    continue
                pending = (pending + " " + line).strip()
                continue
            label = (pending + " " + label).strip() if pending else label
            pending = ""
            raw.append((label, values))
    rows, jurisdiction, category = [], None, None
    occurrences = {}
    bad_width = []
    for label, values in raw:
        clean = norm_nos_label(label)
        low = clean.lower()
        if values is None or (values and len(values) < 9 and all(v is None or v == DASH for v in values)):
            category = clean  # a section heading; some workbooks carry a stray dash in its last column
            continue
        if len(values) == 10 and values[-1] is None:
            values = values[:9]
        if len(values) != 9:
            bad_width.append(f"{clean}:{len(values)}")
            continue
        if low == "total cases":
            rows.append({"kind": "total", "jurisdiction": None, "category": None, "label": "Total Cases", "raw_label": label, "fields": dict(zip(C4, values))})
            continue
        if low in JURISDICTIONS:
            jurisdiction, category = JURISDICTIONS[low], None
            rows.append({"kind": "jurisdiction", "jurisdiction": jurisdiction, "category": None, "label": clean, "raw_label": label, "fields": dict(zip(C4, values))})
            continue
        if low.startswith("#multivalue"):
            rows.append({"kind": "unlabelled", "jurisdiction": jurisdiction, "category": category, "label": clean, "raw_label": label, "fields": dict(zip(C4, values))})
            continue
        key = (jurisdiction, category, clean)
        occurrences[key] = occurrences.get(key, 0) + 1
        rows.append({"kind": "nos", "jurisdiction": jurisdiction, "category": category, "label": clean, "raw_label": label,
                     "occurrence": occurrences[key], "fields": dict(zip(C4, values))})
    _check(checks, f"C-4 {year} row widths (9 values)", not bad_width, ", ".join(bad_width[:8]))
    # row arithmetic
    bad = []
    for r in rows:
        f = {k: zero_if_dash(v) for k, v in r["fields"].items()}
        if None in (f["total"], f["no_action"], f["court_total"], f["before_pretrial"], f["during_after_pretrial"], f["trial_total"], f["trial_nonjury"], f["trial_jury"]):
            bad.append(f"{r['label']}:missing")
            continue
        if f["no_action"] + f["court_total"] != f["total"] or f["before_pretrial"] + f["during_after_pretrial"] + f["trial_total"] != f["court_total"] or f["trial_nonjury"] + f["trial_jury"] != f["trial_total"]:
            bad.append(r["label"])
    _check(checks, f"C-4 {year} row arithmetic", not bad, "; ".join(bad[:8]))
    # jurisdiction sections sum to their jurisdiction row, jurisdictions sum to Total Cases (all eight count columns)
    total = next((r for r in rows if r["kind"] == "total"), None)
    juris = [r for r in rows if r["kind"] == "jurisdiction"]
    count_fields = [f for f in C4 if f != "pct_trial"]

    def section_sum(j, field, skip=()):
        return sum((zero_if_dash(r["fields"][field]) or 0) for r in rows
                   if r["kind"] in ("nos", "unlabelled") and r["jurisdiction"] == j["jurisdiction"] and id(r) not in skip)

    # A row whose label the source prints as '#MULTIVALUE' (a spreadsheet error, also in the PDF) heads a subtotal in
    # FY2025: the rows printed beneath it are memo lines of that subtotal, and the section reconciles exactly in all
    # eight count columns only when they are left out of the section sum. The rule is applied only when that holds.
    memo_notes = []
    for j in juris:
        unl = [i for i, r in enumerate(rows) if r["kind"] == "unlabelled" and r["jurisdiction"] == j["jurisdiction"]]
        if not unl or all(section_sum(j, f) == zero_if_dash(j["fields"][f]) for f in count_fields):
            continue
        i0 = unl[0]
        for n in range(1, 7):
            memo = rows[i0 + 1:i0 + 1 + n]
            if len(memo) == n and all(r["kind"] == "nos" and r["jurisdiction"] == j["jurisdiction"] for r in memo):
                skip = {id(r) for r in memo}
                if all(section_sum(j, f, skip) == zero_if_dash(j["fields"][f]) for f in count_fields):
                    for r in memo:
                        r["memo_of_unlabelled"] = True
                    memo_notes.append(f"{j['jurisdiction']}: {n} rows after the '#MULTIVALUE' row ({', '.join(r['label'] for r in memo)}) are memo lines of its subtotal")
                    break
    if memo_notes:
        _check(checks, f"C-4 {year} rows beneath a '#MULTIVALUE' label are memo lines (section reconciles in all 8 count columns)", True, "; ".join(memo_notes))
    fails = []
    for field in count_fields:
        for j in juris:
            skip = {id(r) for r in rows if r.get("memo_of_unlabelled")}
            parts = section_sum(j, field, skip)
            if parts != zero_if_dash(j["fields"][field]):
                fails.append(f"{j['jurisdiction']} {field}: {parts} vs {j['fields'][field]}")
        if total:
            sm = sum(zero_if_dash(j["fields"][field]) or 0 for j in juris)
            if sm != zero_if_dash(total["fields"][field]):
                fails.append(f"jurisdictions {field}: {sm} vs {total['fields'][field]}")
    _check(checks, f"C-4 {year} sections sum to jurisdiction rows and Total Cases", not fails, "; ".join(fails[:6]))
    return rows, checks


# ---------------------------------------------------------------- S-20 (national MDL summary)

S20_ROWS = [
    ("actions_subjected", r"Total Actions Subjected"),
    ("actions_transferred", r"^Actions Transferred"),
    ("actions_originally_filed", r"Actions Originally Filed"),
    ("terminations_total", r"^Total Terminations"),
    ("terminated_by_transferee", r"Terminated by Transf"),
    ("reassigned_to_transferor", r"Reassigned to Transferor"),
    ("remanded_by_panel", r"Remanded by the Panel"),
    ("pending", r"Presently Pending"),
]
S20_COLUMNS = ["cum_prev2", "m12_prev", "cum_prev", "m12", "cum"]


def _s20_lines(path):
    """[(label, [values])] for the data rows of Table S-20. A row label wrapped over several printed lines is joined; the
    value cells are every numeric/dash cell to the right of the label (workbooks of some editions start one column late)."""
    lines, pend = [], ""
    if Path(path).suffix == ".xlsx":
        for row in xlsx_raw_grids(path)[0][1]:
            cells = []
            for c in row:
                if isinstance(c, str):  # footnote superscripts ('24,731 ¹', a cell holding only '¹') are not values
                    c = "".join(ch for ch in c if ch not in SUPERSCRIPTS and ch != "*")
                if c is not None and norm_text(c) != "":
                    cells.append(c)
            if not cells:
                continue
            label_cell = next((c for c in cells if isinstance(c, str) and to_value(c) is None), None)
            if label_cell is None:
                continue
            idx = cells.index(label_cell)
            label = norm_text(label_cell)
            values = [to_value(c) for c in cells[idx + 1:]]
            if re.match(r"^(Table S-20|Cumulative Summary|During the|Cumulative|Totals as of|Sept\.|1 Revised|\d Revised)", label) or (not values and re.search(r"Sept\. 30", label)):
                continue
            if any(v is None for v in values) or not values:
                pend = (pend + " " + label).strip() if not values else pend
                continue
            lines.append(((pend + " " + label).strip(), values))
            pend = ""
        return lines
    started = False
    for page, line in pdf_lines(path, method="text"):
        if re.match(r"^(Table S-20|Cumulative Summary|During the|Cumulative|Totals as of|Sept\.|\d Revised|1 Revised|Page \d)", line):
            continue
        if not started:
            if re.match(r"^Total Actions Subjected", line):
                started = True
            else:
                continue
        label, values = split_tail(line)
        if values and len(values) >= 3 and all(v is not None for v in values):
            lines.append(((pend + " " + label).strip(), values))
            pend = ""
        else:
            pend = (pend + " " + line).strip()
    return lines


def _drop_footnote_digit(vals):
    """A printed row can carry one footnote digit between its value cells (the superscript marking a revised figure comes
    back from a PDF as a lone '1'-'9'). With six cells, the digit is removed only where the remaining five satisfy both
    cumulative roll-forwards (cum_prev2 + m12_prev = cum_prev and cum_prev + m12 = cum); otherwise the row is left as is."""
    if len(vals) != 6:
        return vals
    fits = []
    for i in (1, 2, 3, 4):
        if isinstance(vals[i], int) and 0 < vals[i] < 10:
            rest = vals[:i] + vals[i + 1:]
            if all(isinstance(v, int) for v in rest) and rest[0] + rest[1] == rest[2] and rest[2] + rest[3] == rest[4]:
                fits.append(rest)
    return fits[0] if len(fits) == 1 else vals


def parse_s20(path, year):
    """Columns as printed in edition y: cumulative as of Sept. 30 of y-2, the 12 months ending Sept. 30 of y-1 (the
    published adjusted figure), cumulative as of y-1, the 12 months ending y, cumulative as of y. Returns
    ({field: {"cum_prev2", "m12_prev", "cum_prev", "m12", "cum"}}, checks). 'Total Actions Presently Pending' prints only the
    three cumulative-date columns (the 12-month cells are dashes or zero)."""
    checks = []
    lines = _s20_lines(path)
    out = {}
    for field, pattern in S20_ROWS:
        hit = next(((lab, vals) for lab, vals in lines if re.search(pattern, lab, re.I)), None)
        if hit is None:
            continue
        vals = _drop_footnote_digit(hit[1])
        if field == "pending":
            if len(vals) == 5:
                vals = [vals[0], vals[2], vals[4]]
            elif len(vals) != 3:
                continue
            out[field] = {"cum_prev2": vals[0], "cum_prev": vals[1], "cum": vals[2]}
        elif len(vals) == 5:
            out[field] = dict(zip(S20_COLUMNS, vals))
    required = {"actions_subjected", "actions_transferred", "actions_originally_filed", "terminations_total", "terminated_by_transferee", "remanded_by_panel", "pending"}
    _check(checks, f"S-20 {year} rows found", required <= set(out), ",".join(sorted(required - set(out))))
    bad = []
    for field, v in out.items():
        if field == "pending":
            continue
        if None in (num(v.get("cum_prev")), num(v.get("m12")), num(v.get("cum"))):
            continue
        if zero_if_dash(v["cum_prev"]) + zero_if_dash(v["m12"]) != zero_if_dash(v["cum"]):
            bad.append(f"{field} cum")
        if None not in (num(v.get("cum_prev2")), num(v.get("m12_prev"))) and zero_if_dash(v["cum_prev2"]) + zero_if_dash(v["m12_prev"]) != zero_if_dash(v["cum_prev"]):
            bad.append(f"{field} prev cum")
    a, t, o = out.get("actions_subjected"), out.get("actions_transferred"), out.get("actions_originally_filed")
    if a and t and o:
        for col in S20_COLUMNS:
            if None not in (num(a.get(col)), num(t.get(col)), num(o.get(col))) and zero_if_dash(t[col]) + zero_if_dash(o[col]) != zero_if_dash(a[col]):
                bad.append(f"transferred + originally filed != subjected ({col})")
    term, by_tr, rem, rea = out.get("terminations_total"), out.get("terminated_by_transferee"), out.get("remanded_by_panel"), out.get("reassigned_to_transferor", {})
    if term and by_tr and rem:
        for col in S20_COLUMNS:
            parts = [zero_if_dash(by_tr.get(col)), zero_if_dash(rem.get(col)), zero_if_dash(rea.get(col)) if rea else 0]
            if None not in parts and zero_if_dash(term.get(col)) is not None and sum(parts) != zero_if_dash(term[col]):
                bad.append(f"terminations parts != total ({col}): {sum(parts)} vs {term[col]}")
    _check(checks, f"S-20 {year} arithmetic (cumulative roll-forward, transferred + originally filed, terminations)", not bad, "; ".join(bad))
    return out, checks
