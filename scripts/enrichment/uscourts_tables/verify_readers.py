"""Second-path checks for the table-periods read by the readers added on 2026-10-25 (no shared code with those readers' parsing):

  1. pdf text: for N random figures read from a PDF by the word-position reader (pdf_grid_ingest.py), the PDF is converted again
     with pdftotext -layout (a different text extraction) and the figure must be printed on a line that starts with the row's label,
     at the same position among that line's figures as the reader placed it, in the part of the table that holds the column.
  2. same table, other publication: where two publications print the same table for the same period end (Judicial Business, the
     Statistical Tables, Caseload Statistics and Bankruptcy Filings overlap at quarter ends), every figure read by one of the new
     readers (word positions, the Bankruptcy Filings printouts, the arithmetic hierarchy) is compared with the other publication's
     figure for the same row and column, read by any reader. Publishers sometimes revise a figure between editions, so a mismatch
     is reported with both values, never resolved.
  3. printouts: every Bankruptcy Filings printout table (bf_legacy.py) is re-checked from its stored figures: total = business +
     nonbusiness and each chapter total = its business + nonbusiness figures, in every row.

Writes private/build/uscourts_tables/verification_readers.json. Usage: python3 -I -B verify_readers.py [--pdf 80] [--seed 1025]
"""
import argparse
import gzip
import json
import random
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
NUMBER = re.compile(r"^(?:-?\d[\d,]*(?:\.\d+)?|-?\.\d+|[-–—­])$")


def docs():
    for path in sorted(PARSED.glob("*/*/*.json.gz")):
        yield path, json.loads(gzip.decompress(path.read_bytes()))


def fmt_tokens(value):
    """The ways a stored figure can be printed: 1234 -> 1,234 or 1234; 12.5 -> 12.5; a float with an integer value -> 7 / 7.0."""
    if isinstance(value, bool) or value is None:
        return set()
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
        v = int(value)
        return {f"{v:,}", str(v), f"{v}.0"}
    s = f"{value:.6f}".rstrip("0").rstrip(".")
    out = {s, s.lstrip("0") if s.startswith("0.") else s, s.replace("-0.", "-.")}
    return out


def layout_lines(data):
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(data)
        handle.flush()
        text = subprocess.run(["pdftotext", "-layout", handle.name, "-"], capture_output=True, text=True, check=True).stdout
    return text.splitlines()


def label_key(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())


SORT_CODE = re.compile(r"^(?:0\.0|\d{2,3}[A-Z]?)$")


def figures_of(line, label):
    """The figures printed after the label on a pdftotext line, or None when the line does not start with the label. A dollar sign
    is not part of a figure ("$999"), and a last token that is a BAPCPA sort code ("11I") is left for the caller."""
    flat = " ".join(line.split())
    key = label_key(label)
    words = flat.split(" ")
    acc, k = "", 0
    while k < len(words) and len(acc) < len(key):
        acc += label_key(words[k])
        k += 1
    if acc != key:
        return None
    rest = [w.lstrip("$") for w in words[k:] if w]
    if rest and SORT_CODE.match(rest[-1]) and not NUMBER.match(rest[-1]):
        rest = rest[:-1] + ["0.0"]  # kept in place of the code so the caller's width test drops it
    if not rest or not all(NUMBER.match(w) for w in rest):
        return None
    return rest


def logical_lines(lines):
    """pdftotext lines, plus each line joined with the one or two after it: a row label printed over two lines ("CONSPIRACY TO
    DEFRAUD THE" / "UNITED STATES 1,830 ...") is then whole on one of them."""
    out = list(lines)
    for i in range(len(lines)):
        if lines[i].strip() and not re.search(r"\d", lines[i]):
            out.append(lines[i] + " " + (lines[i + 1] if i + 1 < len(lines) else ""))
            out.append(lines[i] + " " + (lines[i + 1] if i + 1 < len(lines) else "") + " " + (lines[i + 2] if i + 2 < len(lines) else ""))
    return out


def check_pdf_text(n, rng):
    picks = []
    for path, doc in docs():
        if doc.get("reader") != "pdf_grid":
            continue
        norm = doc["sheets"][0]
        rows = [r for r in norm["rows"] if not r.get("section") and r.get("values")]
        cols = [i for i, c in enumerate(norm["columns"]) if "pdf_pos" in c]
        if rows and cols:
            picks.append((path, doc, rows, cols))
    rng.shuffle(picks)
    out = {"checked": 0, "matched": 0, "not_found": 0, "examples": []}
    for path, doc, rows, cols in picks[:n]:
        norm = doc["sheets"][0]
        r = rng.choice(rows)
        ci = rng.choice(cols)
        col = norm["columns"][ci]
        value = r["values"][ci]
        flag = (r.get("flags") or [None] * (ci + 1))[ci]
        lines = logical_lines(layout_lines(F.read_stored(F.ROOT / doc_path(doc))))
        want = fmt_tokens(value) if value is not None else ({"-", "–", "—", "­"} if flag == "dash" else set())
        hit = False
        for line in lines:
            figs = figures_of(line, r.get("label_raw") or r["label"])
            if figs is not None and len(figs) == col["pdf_width"] + 1 and re.fullmatch(r"0\.0|\d{2,3}[A-Z]?", figs[-1]):
                figs = figs[:-1]  # the BAPCPA sort-order code printed after the figures
            if figs is not None and len(figs) == col["pdf_width"] + 1 and re.fullmatch(r"\d", figs[0]):
                figs = figs[1:]  # a footnote number printed after the label at the text size ("Parole 6")
            if figs is None or len(figs) != col["pdf_width"]:
                continue
            if figs[col["pdf_pos"]] in want:
                hit = True
                break
        out["checked"] += 1
        out["matched" if hit else "not_found"] += 1
        if not hit and len(out["examples"]) < 15:
            out["examples"].append({"file": doc["source"]["url"], "row": r["label"], "column": col["key"], "stored": value, "flag": flag})
    return out


def doc_path(doc):
    index = check_pdf_text.index
    for e in index.values():
        if e.get("sha256") == doc["source"]["sha256"] and e.get("path"):
            return e["path"]
    raise KeyError(doc["source"]["url"])


def check_overlaps():
    """Figures of the same table, period end, row and column printed by two publications."""
    by_key = defaultdict(list)
    for path, doc in docs():
        for norm in doc["sheets"]:
            reader = doc.get("reader") or ("sums" if norm.get("hierarchy") == "sums" else doc["source"].get("format"))
            by_key[(norm["table_key"], norm["period_end"])].append((norm["pub"], reader, norm))
    out = {"pairs": 0, "compared": 0, "equal": 0, "different": 0, "by_reader": {}, "examples": []}
    new_readers = {"pdf_grid", "bf_legacy", "sums"}
    for (tkey, end), items in by_key.items():
        if len(items) < 2 or not any(r in new_readers for _, r, _ in items):
            continue
        for a in range(len(items)):
            for b in range(a + 1, len(items)):
                pa, ra, na = items[a]
                pb, rb, nb = items[b]
                if pa == pb or not ({ra, rb} & new_readers):
                    continue
                out["pairs"] += 1
                ia = {(r.get("entity"), r.get("entity_id")): r for r in na["rows"] if not r.get("section")}
                ib = {(r.get("entity"), r.get("entity_id")): r for r in nb["rows"] if not r.get("section")}
                ca = {c["key"]: i for i, c in enumerate(na["columns"]) if not c.get("prior")}
                cb = {c["key"]: i for i, c in enumerate(nb["columns"]) if not c.get("prior")}
                reader = ra if ra in new_readers else rb
                tally = out["by_reader"].setdefault(reader, {"compared": 0, "equal": 0, "different": 0})
                for ent in set(ia) & set(ib):
                    for key in set(ca) & set(cb):
                        va, vb = ia[ent]["values"][ca[key]], ib[ent]["values"][cb[key]]
                        if va is None or vb is None:
                            continue
                        if "%" in (na["columns"][ca[key]].get("fmt") or "") or "%" in (nb["columns"][cb[key]].get("fmt") or ""):
                            continue  # a workbook percent cell holds a fraction; compared elsewhere
                        out["compared"] += 1
                        tally["compared"] += 1
                        same = abs(float(va) - float(vb)) < 1e-6
                        out["equal" if same else "different"] += 1
                        tally["equal" if same else "different"] += 1
                        if not same and len(out["examples"]) < 25:
                            out["examples"].append({"table": tkey, "period": end, "row": ent[1], "column": key, pa: va, pb: vb, "readers": [ra, rb]})
    return out


def check_printouts():
    out = {"tables": 0, "rows": 0, "failures": 0}
    sums = [("total_filings", ["predominant_nature_of_debt/business_filings/total", "predominant_nature_of_debt/nonbusiness_filings/total"]),
            ("total_chapter_7", ["predominant_nature_of_debt/business_filings/chapter_7", "predominant_nature_of_debt/nonbusiness_filings/chapter_7"]),
            ("total_chapter_11", ["predominant_nature_of_debt/business_filings/chapter_11", "predominant_nature_of_debt/nonbusiness_filings/chapter_11"]),
            ("total_chapter_13", ["predominant_nature_of_debt/business_filings/chapter_13", "predominant_nature_of_debt/nonbusiness_filings/chapter_13"])]
    for path, doc in docs():
        if doc.get("reader") != "bf_legacy":
            continue
        norm = doc["sheets"][0]
        pos = {c["key"]: i for i, c in enumerate(norm["columns"])}
        if "total_filings" not in pos:
            continue
        out["tables"] += 1
        for r in norm["rows"]:
            out["rows"] += 1
            v = [0 if x is None and f == "dash" else x for x, f in zip(r["values"], r["flags"])]
            for total, parts in sums:
                if any(v[pos[p]] is None for p in parts) or v[pos[total]] is None:
                    continue
                if v[pos[total]] != sum(v[pos[p]] for p in parts):
                    out["failures"] += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", type=int, default=80)
    ap.add_argument("--seed", type=int, default=1025)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    check_pdf_text.index = json.loads((F.ACQ / "files_index.json").read_text())
    result = {"pdf_text": check_pdf_text(args.pdf, rng), "other_publication": check_overlaps(), "printouts": check_printouts()}
    (BUILD / "verification_readers.json").write_text(json.dumps(result, indent=1, sort_keys=True))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "examples"} for k, v in result.items()}, indent=1))


if __name__ == "__main__":
    main()
