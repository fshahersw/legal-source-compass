"""Parse every downloaded FCMS district and court-of-appeals profile PDF into normalized JSON.

Input: private/acq/uscourts_fcms/editions.json (written by `acquire.py files`) and the PDFs it lists.
Output: private/acq/uscourts_fcms/parsed/<edition>__<kind>.json (derived, regenerable) plus
private/acq/uscourts_fcms/parsed/_index.json with per-file status (parsed / image_only / failed pages).

Values are the printed tokens parsed to numbers (commas and % removed); a printed dash is kept as null with a
'dash' marker. Nothing is imputed. Pages whose rows do not match the expected measure order are excluded and
listed with the reason.

Usage: python3 -I -B extract.py [edition-slug ...]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import courts  # noqa: E402
import layout  # noqa: E402
import measures  # noqa: E402
import profiles  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "uscourts_fcms"
OUT = ACQ / "parsed"
LOOKUPS = ROOT / "private" / "build" / "uscourts_fcms" / "lookups"
MONTHS = {"Mar": "03-31", "Jun": "06-30", "Sep": "09-30", "Dec": "12-31"}


def load_spine():
    rows = json.loads((LOOKUPS / "court_spine.json").read_text())["rows"]
    return {r[0]: (r[1], r[2]) for r in rows}


def has_text(path):
    out = subprocess.run(["pdftotext", "-l", "3", str(path), "-"], capture_output=True).stdout
    return len(re.sub(rb"\s+", b"", out)) > 200


def values_of(row, years):
    out, flags = {}, {}
    for y in years:
        num, flag = measures.parse_value(row["values"].get(y))
        out[y] = num
        if flag and flag != "absent":
            flags[y] = flag
    return out, flags


def standing_of(row):
    out = {}
    for k, tok in row.get("standing", {}).items():
        num, flag = measures.parse_value(tok)
        out[k] = num if num is not None else ("dash" if flag == "dash" else None)
    return out


TOLERANCES = (3.0, 4.5, 6.0)  # vertical tolerance (points) for grouping words into lines; first that fits the row order wins


def read_pages(path, kind, check):
    """Yield (page number, parsed page, classification) for every PDF page.

    Each page is read with increasingly tolerant line grouping (older editions print a row's label a few points off
    its values); the first tolerance whose rows satisfy `check(parsed)` -> (ok, classification) is used, otherwise the
    first reading is returned so the exclusion can be reported with its labels.
    """
    for number, page in enumerate(layout.pdf_words(Path(path)), 1):
        first = None
        for tol in TOLERANCES:
            parsed = profiles.read_page(page, kind, tol)
            if parsed is None:
                break
            parsed["page"] = number
            parsed["tol"] = tol
            ok, cls = check(parsed)
            if first is None:
                first = (parsed, cls)
            if ok:
                first = (parsed, cls)
                break
        if first is None:
            yield number, None, None
        else:
            yield number, first[0], first[1]


def _check_district(page):
    if not page.get("panels"):
        return False, None
    cls = measures.classify(page["panels"][0], measures.DISTRICT)
    return not cls[2], cls


def _check_circuit(page):
    panels = page.get("panels", [])
    if len(panels) == 2:
        l, r = measures.classify(panels[0], measures.CIRCUIT_LEFT), measures.classify(panels[1], measures.CIRCUIT_RIGHT)
        return not (l[2] or r[2]), ("both", l, r)
    if len(panels) == 1:
        l, r = measures.classify(panels[0], measures.CIRCUIT_LEFT), measures.classify(panels[0], measures.CIRCUIT_RIGHT)
        if l[2] and r[2]:
            # labels off their value lines: fall back to the fixed sequence of value lines (exact count required)
            l = measures.classify_positional(panels[0], measures.keys_of(measures.CIRCUIT_LEFT))
            r = measures.classify_positional(panels[0], measures.keys_of(measures.CIRCUIT_RIGHT, drop=("panels",)), True)
        return (not l[2]) or (not r[2]), ("single", l, r)
    return False, None


def merge_earlier_pct(entry):
    """2004-2009 editions: the change over last year (one column) and over earlier years (the other columns) are
    printed on two lines; the columns are disjoint, so they merge into one row of the same meaning as the later
    single-line format (value under year Y = current year over year Y). The second line's standing stays under
    'pct_change_filings_earlier_years'."""
    values, flags, standing = entry["values"], entry["flags"], entry["standing"]
    earlier = values.pop("pct_change_filings_earlier_years", None)
    last = values.pop("pct_change_filings_last_year", None)
    if earlier is None and last is None:
        return
    merged = values["pct_change_filings"]
    for extra, name in ((earlier, "pct_change_filings_earlier_years"), (last, "pct_change_filings_last_year")):
        if extra is None:
            continue
        for y, v in extra.items():
            if merged.get(y) is None and v is not None:
                merged[y] = v
        fl = flags.pop(name, None)
        if fl:
            flags.setdefault("pct_change_filings", {}).update(fl)
    # standings of the two printed lines keep distinct keys: "last_year" (first line) and "earlier_years" (second line)
    if earlier is not None and "pct_change_filings" in standing:
        standing["pct_change_filings_last_year"] = standing.pop("pct_change_filings")   # 2004-2009: line 1 = last year
    if last is not None and "pct_change_filings" in standing:
        standing["pct_change_filings_earlier_years"] = standing.pop("pct_change_filings")  # 2011: line 2 = earlier years


def parse_district(path, spine):
    result = {"pages": [], "excluded": []}
    for number, page, cls in read_pages(path, "district", _check_district):
        if page is None or not page.get("panels"):
            result["excluded"].append({"page": number, "reason": "no year header (not a profile page)"})
            continue
        years = page["years"][0]
        rows = page["panels"][0]
        assigned, unmatched, missing = cls
        name = page["name"].strip()
        national = not name or name in ("ALL DISTRICT COURTS", "UNITED STATES", "NATIONAL TOTALS", "NATIONAL")
        entry = {"page": page["page"], "name": name or "ALL DISTRICT COURTS", "years": years}
        if national:
            entry["court_id"] = "national"
            entry["match"] = "national page"
        else:
            cid, usps, method = courts.resolve_district(name, spine)
            entry.update({"court_id": cid, "usps": usps, "match": method})
        if missing:
            result["excluded"].append({"page": page["page"], "name": entry["name"], "reason": "rows did not match the expected order", "missing": missing,
                                       "labels": [r["label"] for r in rows]})
            continue
        entry["values"], entry["flags"], entry["standing"], entry["stray"] = {}, {}, {}, {}
        for key, row in assigned.items():
            entry["values"][key], fl = values_of(row, years)
            if fl:
                entry["flags"][key] = fl
            st = standing_of(row)
            if st:
                entry["standing"][key] = st
            if row["stray"]:
                entry["stray"][key] = row["stray"]
        merge_earlier_pct(entry)
        entry["tol"] = page["tol"]
        entry["unmatched"] = [r["label"] for r in unmatched]
        result["pages"].append(entry)
    return result


def parse_circuit(path, spine):
    result = {"pages": [], "excluded": []}
    for number, page, cls in read_pages(path, "circuit", _check_circuit):
        if page is None or len(page.get("panels", [])) not in (1, 2) or cls is None:
            result["excluded"].append({"page": number, "reason": "no year header (not a profile page)"})
            continue
        mode, left_cls, right_cls = cls
        if mode == "both":
            ly, ry = page["years"]
            left, right = page["panels"]
            a_left, u_left, m_left = left_cls
            a_right, u_right, m_right = right_cls
            part = "both"
        else:
            # single-panel editions print the overall caseload and the per-panel measures on two facing pages;
            # each page is matched against both halves and must match one of them completely
            ly = ry = page["years"][0]
            rows = page["panels"][0]
            if not left_cls[2]:
                left, right, part = rows, [], "left"
                a_left, u_left, m_left, a_right, u_right, m_right = left_cls[0], left_cls[1], [], {}, [], []
            else:
                left, right, part = [], rows, "right"
                a_left, u_left, m_left, a_right, u_right, m_right = {}, [], [], right_cls[0], right_cls[1], right_cls[2]
        name = page["name"].strip()
        national = not name or name in ("ALL CIRCUITS", "UNITED STATES", "NATIONAL", "NATIONAL TOTALS")
        entry = {"page": page["page"], "name": name or "ALL CIRCUITS", "years": ly, "part": part}
        if ly != ry:
            result["excluded"].append({"page": page["page"], "name": entry["name"], "reason": "left and right panel years differ"})
            continue
        if national:
            entry["court_id"], entry["match"] = "national", "national page"
        else:
            cid, method = courts.resolve_circuit(name, spine)
            entry.update({"court_id": cid, "match": method})
        if m_left or m_right:
            result["excluded"].append({"page": page["page"], "name": entry["name"], "reason": "rows did not match the expected order", "missing": m_left + m_right,
                                       "labels_left": [r["label"] for r in left], "labels_right": [r["label"] for r in right]})
            continue
        entry["values"], entry["flags"], entry["standing"], entry["stray"] = {}, {}, {}, {}
        for key, row in list(a_left.items()) + list(a_right.items()):
            if key == "judgeships" and any("/" in tok for tok in row["values"].values()):
                # 2004-2009 editions print "12/4.0" = judgeships/panels in one cell
                judges, panels = {}, {}
                for y, tok in row["values"].items():
                    a, _, b = tok.partition("/")
                    judges[y], panels[y] = a, b
                entry["values"]["judgeships"], fl1 = values_of({"values": judges}, ly)
                entry["values"]["panels"], fl2 = values_of({"values": panels}, ly)
                if fl1:
                    entry["flags"]["judgeships"] = fl1
                if fl2:
                    entry["flags"]["panels"] = fl2
                st = standing_of(row)
                if st:
                    entry["standing"][key] = st
                continue
            entry["values"][key], fl = values_of(row, ly)
            if fl:
                entry["flags"][key] = fl
            st = standing_of(row)
            if st:
                entry["standing"][key] = st
            if row["stray"]:
                entry["stray"][key] = row["stray"]
        merge_earlier_pct(entry)
        entry["tol"] = page["tol"]
        entry["unmatched"] = [r["label"] for r in u_left + u_right]
        result["pages"].append(entry)
    return result


def main(selected):
    editions = json.loads((ACQ / "editions.json").read_text())
    spine = load_spine()
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / "_index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() and selected else {}
    done = set()
    for ed in editions:
        if (selected and ed["edition"] not in selected) or ed["edition"] in done:
            continue  # editions.json lists March 2023 twice (two page URLs, same files)
        done.add(ed["edition"])
        for kind in ("district", "circuit"):
            f = ed.get(kind)
            key = f"{ed['edition']}__{kind}"
            if not f:
                index[key] = {"status": "no_file"}
                continue
            path = ROOT / f["path"]
            if not has_text(path):
                index[key] = {"status": "image_only", "file": f["path"], "url": f["url"], "sha256": f["sha256"]}
                continue
            parsed = parse_district(path, spine) if kind == "district" else parse_circuit(path, spine)
            parsed.update({"edition": ed["edition"], "period_end": ed["period_end"], "kind": kind, "file": f["path"], "url": f["url"],
                           "sha256": f["sha256"], "page_url": ed["page_url"]})
            (OUT / f"{key}.json").write_text(json.dumps(parsed, sort_keys=True))
            years = sorted({y for p in parsed["pages"] for y in p["years"]})
            index[key] = {"status": "parsed", "pages": len(parsed["pages"]), "excluded": len(parsed["excluded"]), "years": years,
                          "file": f["path"], "url": f["url"], "sha256": f["sha256"],
                          "unmapped": [p["name"] for p in parsed["pages"] if not p.get("court_id")]}
            print(json.dumps({key: {k: v for k, v in index[key].items() if k in ("status", "pages", "excluded", "unmapped")}}))
    index_path.write_text(json.dumps(index, indent=1, sort_keys=True))


def check_file(path, kind):
    """Developer aid: parse one PDF and print a compact summary of accepted and excluded pages."""
    spine = load_spine()
    parsed = parse_district(Path(path), spine) if kind == "district" else parse_circuit(Path(path), spine)
    for p in parsed["pages"]:
        print(p["page"], p["name"], p["court_id"], p["match"], p["years"][0], "-", p["years"][-1], "unmatched:", p["unmatched"], "stray:", p["stray"] or "")
    for x in parsed["excluded"]:
        print("EXCLUDED", json.dumps(x)[:600])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--file":
        check_file(sys.argv[2], sys.argv[3])
    else:
        main(set(sys.argv[1:]))
