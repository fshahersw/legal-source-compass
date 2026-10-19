"""Independent checks of the SCAC builds: published totals re-read from the page text, market series recomputed with the csv module,
Spearman recomputed with a separate rank routine, and every court link checked against CourtListener's exact court names.

    python3 -I -B scripts/enrichment/scac/verify_scac.py
"""
from __future__ import annotations

import csv
import html
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
RAW = os.path.join(ROOT, "private", "acq", "scac", "raw")
OUT = os.path.join(ROOT, "private", "build", "scac")


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((y - mb) ** 2 for y in b) ** 0.5
    return cov / (va * vb)


def daily(rel):
    out = {}
    with open(os.path.join(RAW, rel), encoding="utf-8") as h:
        for row in csv.DictReader(h):
            k = [c for c in row if c != "observation_date"][0]
            try:
                out[row["observation_date"]] = float(row[k])
            except ValueError:
                pass
    return out


def main():
    fails = []
    stats = {r["id"]: r for r in json.load(open(os.path.join(OUT, "scac_statistics.json")))["rows"]}
    align = {r["id"]: r for r in json.load(open(os.path.join(OUT, "scac_trend_alignment.json")))["rows"]}

    # 1. totals re-read from page text
    page = open(os.path.join(RAW, "securities.stanford.edu/charts.html"), encoding="utf-8").read()
    yrs = {int(a): int(b) for a, b in re.findall(r"'(\d{4})',\s*cnt:\s*(\d+)", page)}
    for y, n in yrs.items():
        if stats[f"year:{y}"]["item"]["cells"]["filings"] != n:
            fails.append(f"year {y}")
    circ = html.unescape(re.sub(r"<[^>]+>", " ", open(os.path.join(RAW, "securities.stanford.edu/circuits.html"), encoding="utf-8").read()))
    for label in ("2nd", "9th", "D.C."):
        m = re.search(r"\s" + re.escape(label) + r"\s+(\d+)\s", circ)
        rid = "circuit:" + re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
        if not m or int(m.group(1)) != stats[rid]["item"]["cells"]["filings"]:
            fails.append(f"circuit {label}")

    # 2. market series recomputed
    vix = daily("fred.stlouisfed.org/graph__fredgraph.csv__q_df68d320aa.bin")
    nas = daily("fred.stlouisfed.org/graph__fredgraph.csv__q_650a63dc0b.bin")
    for y in (2001, 2008, 2020):
        vals = [v for d, v in vix.items() if d.startswith(str(y))]
        if round(sum(vals) / len(vals), 2) != align[f"year:{y}"]["item"]["cells"]["vix_mean"]:
            fails.append(f"vix {y}")
        last = lambda yy: nas[max(d for d in nas if d.startswith(str(yy)))]
        if round(100 * (last(y) / last(y - 1) - 1), 2) != align[f"year:{y}"]["item"]["cells"]["nasdaq_return_pct"]:
            fails.append(f"nasdaq {y}")
    z = zipfile.ZipFile(os.path.join(RAW, "mba.tuck.dartmouth.edu/pages__faculty__ken.french__ftp__F-F_Research_Data_Factors_CSV.zip"))
    body = z.read(z.namelist()[0]).decode("latin-1")
    tail = body[body.index("Annual Factors"):]
    row08 = next(l for l in tail.splitlines() if l.strip().startswith("2008,"))
    p = [float(x) for x in row08.split(",")[1:]]
    if round(p[0] + p[3], 2) != align["year:2008"]["item"]["cells"]["market_return_pct"]:
        fails.append("ff 2008")

    # 3. Spearman recomputed for every association record
    checked = 0
    for rid, r in align.items():
        if not rid.startswith("corr:"):
            continue
        pts = [p for p in r["item"]["profile"]["points"] if p["x"] is not None and p["y"] is not None]
        rho = pearson(ranks([p["x"] for p in pts]), ranks([p["y"] for p in pts]))
        checked += 1
        if abs(rho - r["item"]["profile"]["rho"]) > 1e-9 or len(pts) != r["item"]["profile"]["n"]:
            fails.append(f"{rid}: {rho} vs {r['item']['profile']['rho']}")

    # 4. court links name exactly the court shown
    courts = {c["id"]: c for c in json.load(open(os.path.join(OUT, "lookups", "cl_courts_federal.json")))["rows"]}
    links = 0
    for rid, r in stats.items():
        prof = r["item"]["profile"]
        if prof["kind"] == "circuit" and prof["court_id"] and prof["court_id"] not in courts:
            fails.append(f"{rid}: unknown court {prof['court_id']}")
        for row in prof.get("rows", []):
            if row["court_id"]:
                links += 1
                if courts[row["court_id"]]["short_name"] != row["court"]:
                    fails.append(f"{rid}: {row['court']} -> {row['court_id']}")
    result = {"years": len(yrs), "correlations_recomputed": checked, "trend_court_links": links, "failures": fails}
    json.dump(result, open(os.path.join(OUT, "verification.json"), "w"), indent=1)
    print(json.dumps(result))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
