"""Why the 1997-2003 editions are not published: how accurate is the OCR text layer of the scanned profiles?

The 1997-2003 FCMS files are scans with an OCR text layer (garbled court names such as "CALFORNIA NORTHERN", numbers such as
"1009" for 10.9). The columns of the September 2003 edition (1998-2003) and of the other early editions overlap the born-digital
September 2004 edition (1999-2004), so OCR-read values can be compared with the born-digital ones for the overlapping years.
This module reports the share of overlapping cells that match exactly. It is run by the builder and its result goes into the
analytics summary; no OCR value is ever written to a corpus row.
"""
from collections import defaultdict

import jsonio


def compare(parsed_dir, index):
    """Returns {'editions': [...per OCR edition...], 'overall': {...}} comparing OCR cells with born-digital cells for the same
    court, measure and period end (district and appeals files separately)."""
    born = defaultdict(dict)  # (kind, court, measure, period) -> value from born-digital editions (earliest edition)
    ocr_files = []
    for key, meta in sorted(index.items()):
        if meta["status"] != "parsed":
            continue
        d = jsonio.load(parsed_dir / f"{key}.json.gz")
        if d["ocr_text_layer"]:
            ocr_files.append(d)
            continue
        for p in d["pages"]:
            if not p.get("court_id"):
                continue
            for m, vals in p["values"].items():
                if m.startswith("pct_change"):
                    continue
                for period, v in vals.items():
                    born[(d["kind"], p["court_id"], m, period)].setdefault(d["period_end"], v)
    rows, tot = [], {"compared": 0, "equal": 0}
    for d in ocr_files:
        cmp, eq, pages_named, pages = 0, 0, 0, 0
        for p in d["pages"]:
            pages += 1
            if not p.get("court_id"):
                continue
            pages_named += 1
            for m, vals in p["values"].items():
                if m.startswith("pct_change"):
                    continue
                for period, v in vals.items():
                    ref = born.get((d["kind"], p["court_id"], m, period))
                    if not ref or v is None:
                        continue
                    ref_vals = [x for x in ref.values() if x is not None]
                    if not ref_vals:
                        continue
                    cmp += 1
                    eq += 1 if v in ref_vals else 0
        rows.append({"edition": d["edition"], "kind": d["kind"], "period_end": d["period_end"], "pages_read": pages, "pages_with_court_id": pages_named,
                     "pages_excluded": len(d["excluded"]), "cells_compared": cmp, "cells_equal": eq,
                     "match_rate": round(eq / cmp, 4) if cmp else None})
        tot["compared"] += cmp
        tot["equal"] += eq
    tot["match_rate"] = round(tot["equal"] / tot["compared"], 4) if tot["compared"] else None
    return {"editions": rows, "overall": tot}
